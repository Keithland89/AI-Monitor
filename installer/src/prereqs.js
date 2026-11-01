// @ts-check
/**
 * Read-only checks of what the signed-in user has and lacks: roles, the audit log (for lane E only),
 * the Managed Apps settings, licences and Node. Nothing here writes anything, and a check that can't be read reports
 * "unknown" rather than failing.
 */
import { ADMIN_STEPS } from './managed-app/errors.js';
import { MIN_NODE, nodeOk } from './managed-app/cli.js';

/** @typedef {'met' | 'missing' | 'eligible' | 'unknown'} PrereqStatus */
/**
 * @typedef {object} Prereq
 * @property {string} id
 * @property {string} label
 * @property {PrereqStatus} status
 * @property {string} detail  What was found.
 * @property {string} neededFor
 * @property {string} howTo  How to get it, when it's missing.
 * @property {boolean} [optional]  Only some lanes need it.
 * @property {{ name: string, status: PrereqStatus, detail?: string }[]} [rows]
 */

/** Entra role template IDs, the same in every tenant. */
export const ROLES = /** @type {const} */ ({
  globalAdmin: '62e90394-69f5-4237-9190-012177145e10',
  privilegedRoleAdmin: 'e8611ab8-c189-46e8-94e1-60213ab1f814',
  powerPlatformAdmin: '11648597-926c-4cf3-9c36-bcebb0ba8dcc',
  globalReader: 'f2ef992c-3afb-46b9-b7cf-a126ee74c451',
  aiAdmin: 'd2562ede-74db-457e-a7b6-544e236ebb61',
  securityReader: '5d6b6bb7-de71-4623-b4af-96380a352509',
  appAdmin: '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3',
  cloudAppAdmin: '158c047a-c907-4556-b7ef-446551a6b5f7',
  securityAdmin: '194ae4cb-b126-40b2-bd5b-6091b380977d',
});

const NAMES = {
  [ROLES.globalAdmin]: 'Global Administrator',
  [ROLES.privilegedRoleAdmin]: 'Privileged Role Administrator',
  [ROLES.powerPlatformAdmin]: 'Power Platform Administrator',
  [ROLES.globalReader]: 'Global Reader',
  [ROLES.aiAdmin]: 'AI Administrator',
  [ROLES.securityReader]: 'Security Reader',
  [ROLES.appAdmin]: 'Application Administrator',
  [ROLES.cloudAppAdmin]: 'Cloud Application Administrator',
  [ROLES.securityAdmin]: 'Security Administrator',
};

/** @param {(keyof typeof ROLES)[]} keys */
const pick = (keys) => Object.fromEntries(keys.map((k) => [ROLES[k], NAMES[ROLES[k]]]));

export const LANE_A_ROLES = pick(['powerPlatformAdmin', 'globalReader', 'aiAdmin', 'globalAdmin']);
export const CONSENT_ROLES = pick(['globalAdmin', 'privilegedRoleAdmin']);
export const PP_ADMIN_ROLES = pick(['powerPlatformAdmin', 'globalAdmin']);
export const APP_CREATE_ROLES = pick(['appAdmin', 'cloudAppAdmin', 'globalAdmin']);
export const SECURITY_ROLES = pick(['securityReader', 'securityAdmin', 'globalReader', 'globalAdmin']);

/** Service plans that give Power Apps Premium rights. Copilot Credits are billed per environment and can't be read per user. */
export const PREMIUM_PLANS = { POWERAPPS_PER_USER: 'Power Apps Premium', POWERAPPS_P2: 'Power Apps Plan 2' };
/** Service plans of Defender for Endpoint, which lane F needs. */
export const DEFENDER_PLANS = { WINDEFATP: 'Defender for Endpoint P2', MDE_LITE: 'Defender for Endpoint P1', MDE_SMB: 'Defender for Business' };

const PIM_URL = 'https://entra.microsoft.com/#view/Microsoft_Azure_PIMCommon/ActivationMenuBlade/~/aadmigratedroles';

/** @param {any} err */
const why = (err) => {
  const status = err?.status ? `${err.status} ` : '';
  const msg = String(err?.message ?? err ?? '').split('\n')[0].slice(0, 160);
  return `${status}${msg}`.trim();
};

/**
 * @typedef {object} PrereqApi
 * @property {() => Promise<{ roleTemplateId: string }[]>} myRoles  Active directory roles.
 * @property {(userId: string) => Promise<{ roleDefinitionId: string }[]>} eligibleRoles  PIM roles the user can activate.
 * @property {() => Promise<{ servicePlans?: { servicePlanName: string, provisioningStatus?: string }[] }[]>} licenceDetails
 * @property {() => Promise<{ servicePlans?: { servicePlanName: string }[], consumedUnits?: number }[]>} subscribedSkus
 * @property {() => Promise<{ allowedToCreateApps?: boolean }>} userRolePermissions
 * @property {() => Promise<'on' | 'off' | 'unknown'>} auditLog
 * @property {() => Promise<{ subscriptionId: string, displayName?: string, state?: string }[]>} subscriptions
 */

/**
 * The Graph and ARM calls the checks make.
 * @param {{ graph: import('./http.js').HttpClient, arm: import('./http.js').HttpClient }} c
 * @returns {PrereqApi}
 */
export function prereqApi({ graph, arm }) {
  return {
    myRoles: async () => (await graph.list('/me/transitiveMemberOf/microsoft.graph.directoryRole?$select=roleTemplateId')).map((r) => ({ roleTemplateId: r.roleTemplateId })),
    eligibleRoles: async (userId) => (await graph.list(`/roleManagement/directory/roleEligibilityScheduleInstances?$filter=principalId eq '${userId}'&$select=roleDefinitionId`)),
    licenceDetails: () => graph.list('/me/licenseDetails'),
    subscribedSkus: () => graph.list('/subscribedSkus?$select=servicePlans,consumedUnits'),
    userRolePermissions: async () => (await graph.get('/policies/authorizationPolicy'))?.defaultUserRolePermissions ?? {},
    auditLog: () => auditLogState(graph),
    subscriptions: () => arm.list('/subscriptions?api-version=2020-01-01'),
  };
}

/**
 * Whether the unified audit log is on. Graph can't read the setting itself; an audit log query
 * listing that answers means the service is there. Anything else is unknown, never "off".
 * @param {import('./http.js').HttpClient} graph
 * @returns {Promise<'on' | 'unknown'>}
 */
export async function auditLogState(graph) {
  try {
    await graph.get('/security/auditLog/queries?$top=1', { maxRetries: 1 });
    return 'on';
  } catch {
    return 'unknown';
  }
}

/**
 * @param {{ api: PrereqApi, user: { id: string }, scopeMode?: 'Agents' | 'Dataverse', withApp?: boolean, sharePoint?: boolean, nodeVersion?: string }} ctx
 *   sharePoint: lane E is included (the default). Without it, the audit log and admin consent aren't checked.
 * @returns {Promise<Prereq[]>}
 */
export async function checkPrereqs(ctx) {
  const { api, user } = ctx;
  const sharePoint = ctx.sharePoint !== false;
  const roles = api.myRoles();
  const eligible = api.eligibleRoles(user.id);
  for (const p of [roles, eligible]) p.catch(() => {});

  /**
   * @param {Omit<Prereq, 'status' | 'detail'>} base
   * @param {() => Promise<Pick<Prereq, 'status' | 'detail'> & Partial<Prereq>>} fn
   * @returns {Promise<Prereq>}
   */
  const guard = async (base, fn) => {
    try {
      return { ...base, ...(await fn()) };
    } catch (err) {
      return { ...base, status: 'unknown', detail: `Couldn't check: ${why(err)}` };
    }
  };

  /**
   * An Entra role: active, one the user can activate through PIM, or missing.
   * @param {Omit<Prereq, 'status' | 'detail'>} base
   * @param {Record<string, string>} wanted
   */
  const entraRole = (base, wanted) =>
    guard(base, async () => {
      const active = (await roles).filter((r) => wanted[r.roleTemplateId]);
      if (active.length) return { status: 'met', detail: `Active: ${[...new Set(active.map((r) => wanted[r.roleTemplateId]))].join(', ')}` };
      /** @type {{ roleDefinitionId: string }[] | null} */
      let elig = null;
      try {
        elig = (await eligible).filter((r) => wanted[r.roleDefinitionId]);
      } catch {
        // Reading PIM eligibility needs its own permission; without it, only active roles are known.
      }
      if (elig?.length) {
        return { status: 'eligible', detail: `Not active yet: ${[...new Set(elig.map((r) => wanted[r.roleDefinitionId]))].join(', ')}. Activate it in Privileged Identity Management (${PIM_URL}), then check again.` };
      }
      return { status: 'missing', detail: `You don't have ${Object.values(wanted).join(' or ')} active.` };
    });

  /** @type {Promise<Prereq>[]} */
  const checks = [
    entraRole({
      id: 'lane-a-role',
      label: 'Power Platform Administrator, Global Reader or AI Administrator',
      neededFor: 'Lane A: the app lists every agent in the tenant through the Power Platform admin connector.',
      howTo: 'Ask a Global Administrator for one of these roles. Each viewer of the app needs one too.',
    }, LANE_A_ROLES),
    entraRole({
      id: 'pp-admin',
      label: 'Power Platform Administrator',
      neededFor: 'Listing every environment, and registering the knowledge sweep as a Power Platform admin management application (lane D).',
      howTo: 'Carry on without it: the installer lists the environments you can see, and gives you a command for a Power Platform Administrator to register the app.',
      optional: true,
    }, PP_ADMIN_ROLES),
    ...(sharePoint
      ? [entraRole({
        id: 'consent-role',
        label: 'Global Administrator or Privileged Role Administrator',
        neededFor: 'Granting admin consent for the audit collector\'s AuditLogsQuery.Read.All permission (lane E).',
        howTo: 'Carry on without it: the installer gives you a link for a Global Administrator or Privileged Role Administrator to approve, then you run it again.',
        optional: true,
      }, CONSENT_ROLES)]
      : []),
    guard({
      id: 'create-apps',
      label: 'Can create app registrations',
      neededFor: sharePoint ? 'Creating the knowledge sweep app registration, and the audit collector for lane E.' : 'Creating the knowledge sweep app registration.',
      howTo: 'Ask for Application Administrator or Cloud Application Administrator, or for users to be allowed to register apps.',
    }, async () => {
      const active = (await roles).filter((r) => APP_CREATE_ROLES[r.roleTemplateId]);
      if (active.length) return { status: 'met', detail: `Active: ${[...new Set(active.map((r) => APP_CREATE_ROLES[r.roleTemplateId]))].join(', ')}` };
      const perms = await api.userRolePermissions();
      if (perms.allowedToCreateApps) return { status: 'met', detail: 'Users in this tenant may register apps.' };
      return { status: 'missing', detail: 'Users can\'t register apps here, and you have no app administrator role active.' };
    }),
    entraRole({
      id: 'security-reader',
      label: 'Security Reader (or another role with advanced hunting)',
      neededFor: 'Lane F: the app reads Defender advanced hunting for AI tools on managed devices.',
      howTo: 'Ask a Global Administrator for Security Reader. Each viewer of the Shadow AI tab needs it too.',
      optional: true,
    }, SECURITY_ROLES),
    guard({
      id: 'defender',
      label: 'Defender for Endpoint',
      neededFor: 'Lane F: only onboarded devices are visible.',
      howTo: 'Lane F needs Defender for Endpoint P1 or P2, or Defender for Business, with devices onboarded. The rest works without it.',
      optional: true,
    }, async () => {
      const skus = await api.subscribedSkus();
      const found = new Set(skus.filter((s) => (s.consumedUnits ?? 1) > 0).flatMap((s) => (s.servicePlans ?? []).map((p) => p.servicePlanName)).filter((n) => n in DEFENDER_PLANS));
      if (found.size) return { status: 'met', detail: `In the tenant: ${[...found].map((n) => DEFENDER_PLANS[/** @type {keyof typeof DEFENDER_PLANS} */ (n)]).join(', ')}` };
      return { status: 'missing', detail: 'No Defender for Endpoint plan in the tenant\'s licences.' };
    }),
    guard({
      id: 'foundry-reader',
      label: 'Reader on the Azure subscriptions',
      neededFor: 'The Azure AI Foundry tab: the app lists AI resources in each subscription you can read.',
      howTo: 'Ask a subscription owner for Reader on each subscription with AI Foundry resources. Subscriptions you can\'t read are left out quietly.',
      optional: true,
    }, async () => {
      const subs = (await api.subscriptions()).filter((s) => !s.state || s.state === 'Enabled');
      if (!subs.length) return { status: 'missing', detail: 'You can\'t read any Azure subscription.' };
      return { status: 'met', detail: `You can read ${subs.length} ${subs.length === 1 ? 'subscription' : 'subscriptions'}.` };
    }),
    ...(sharePoint
      ? [guard({
        id: 'audit-log',
        label: 'Unified audit logging',
        neededFor: 'Lane E: the flows read SharePoint agent events from the audit log.',
        howTo: 'Check it\'s on: Microsoft Purview portal > Audit (if it offers "Start recording user and admin activity", it\'s off), or run Get-AdminAuditLogConfig | Format-List UnifiedAuditLogIngestionEnabled in Exchange Online PowerShell.',
      }, async () => {
        const state = await api.auditLog();
        return state === 'on'
          ? { status: /** @type {PrereqStatus} */ ('met'), detail: 'The audit log answers queries.' }
          : { status: /** @type {PrereqStatus} */ ('unknown'), detail: 'Couldn\'t check from here: your sign-in can\'t query the audit log.' };
      })]
      : []),
    guard({
      id: 'licence',
      label: 'Power Apps Premium or Copilot Credits',
      neededFor: 'Opening the app: it uses premium connectors. Each viewer needs it too.',
      howTo: ADMIN_STEPS.licences.what,
    }, async () => {
      const plans = (await api.licenceDetails()).flatMap((l) => l.servicePlans ?? []).filter((p) => !p.provisioningStatus || p.provisioningStatus === 'Success').map((p) => p.servicePlanName);
      const premium = plans.filter((n) => n in PREMIUM_PLANS);
      if (premium.length) return { status: 'met', detail: `You have ${[...new Set(premium.map((n) => PREMIUM_PLANS[/** @type {keyof typeof PREMIUM_PLANS} */ (n)]))].join(', ')}.` };
      return { status: 'unknown', detail: 'You have no Power Apps Premium licence. Copilot Credits can\'t be checked from here: if the environment bills managed apps to credits, that\'s enough.' };
    }),
    Promise.resolve({
      id: 'managed-apps-settings',
      label: 'Managed Apps settings',
      status: /** @type {PrereqStatus} */ ('unknown'),
      detail: 'Couldn\'t check from here; the app\'s deploy step reports them if they\'re off.',
      neededFor: 'Deploying the app: "Allow app creation with the Copilot Managed Runtime CLI" and "External artifacts in managed apps", for the landing environment.',
      howTo: `${ADMIN_STEPS.createApps.what} ${ADMIN_STEPS.externalArtifacts.what}`,
      optional: ctx.withApp === false,
    }),
  ];
  if (ctx.withApp !== false) {
    const version = ctx.nodeVersion ?? process.versions.node;
    checks.push(Promise.resolve({
      id: 'node',
      label: `Node.js ${MIN_NODE} or later`,
      status: /** @type {PrereqStatus} */ (nodeOk(version) ? 'met' : 'missing'),
      detail: `This is Node.js ${version}.`,
      neededFor: 'Deploying the app: the managed apps CLI needs it.',
      howTo: 'Install Node.js 24 LTS from https://nodejs.org/, then run the installer again. Everything else works on this version.',
      optional: true,
    }));
  }
  return Promise.all(checks);
}

/**
 * Which roles the user has, by what they unlock, for the plan.
 * @param {Prereq[]} items
 */
export function prereqSummary(items) {
  const has = (/** @type {string} */ id) => items.find((p) => p.id === id)?.status === 'met';
  return {
    canConsent: has('consent-role'),
    ppAdmin: has('pp-admin'),
    canCreateApps: items.find((p) => p.id === 'create-apps')?.status !== 'missing',
    nodeOk: items.find((p) => p.id === 'node')?.status !== 'missing',
  };
}
