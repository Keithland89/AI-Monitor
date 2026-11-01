// @ts-check
/**
 * The two app registrations, through Microsoft Graph:
 *   - the audit collector, with Graph's AuditLogsQuery.Read.All application permission and admin
 *     consent, for lane E (SharePoint agents). It's only made when lane E is included;
 *   - the knowledge sweep, with no API permissions, registered as a Power Platform admin management
 *     application, for lane D. In Agents scope mode it also needs Reader at the tenant root
 *     management group, which is asked for separately.
 * Each gets a client secret. When the signed-in user can't consent or register, a hand-off says who
 * can and what to run, instead of failing.
 */
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.js';

/** Microsoft Graph's own app ID, the same in every tenant. */
export const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
export const AUDIT_PERMISSION = 'AuditLogsQuery.Read.All';
/** Every Graph application permission the audit collector needs. */
export const AUDIT_PERMISSIONS = [AUDIT_PERMISSION];
/** Azure's built-in Reader role. */
export const READER_ROLE_ID = 'acdd72a7-3385-48ef-bd42-f606fba81ae7';
export const BAP_BASE = 'https://api.bap.microsoft.com';
export const BAP_API_VERSION = '2020-10-01';
/** Written into each app registration's notes, so a re-run without the record can find its own. */
export const NOTES = 'Created by the AI-Monitor installer.';
/** Notes and names on registrations made before the rename, so a re-run adopts them instead of making new ones. */
const LEGACY_NOTES = ['Created by the Agent Monitor installer.', 'Created by the Copilot Inventory installer.'];
const legacyNames = (/** @type {string} */ name) => ['Agent Monitor', 'Copilot Inventory'].map((old) => name.replace('AI-Monitor', old));

export const APPS = /** @type {const} */ ({
  audit: { displayName: 'AI-Monitor - audit collector', purpose: 'Reads the unified audit log for lane E (SharePoint agents).' },
  sweep: { displayName: 'AI-Monitor - knowledge sweep', purpose: 'Reads each environment\'s Dataverse for lane D (agent knowledge sources).' },
});

/** @typedef {import('./http.js').HttpClient} Client */
/** @typedef {import('./config.js').AppRegistration} AppRegistration */
/** @typedef {import('./config.js').HandOff} HandOff */

/** @param {unknown} err */
const denied = (err) => err instanceof HttpError && (err.status === 401 || err.status === 403);
/** @param {string} s */
const q = (s) => s.replace(/'/g, "''");

/**
 * Graph's service principal and the IDs of the audit collector's app roles (AUDIT_PERMISSIONS, in
 * that order), read from the tenant.
 * @param {Client} graph
 */
export async function graphAuditRole(graph) {
  const data = await graph.get(`/servicePrincipals?$filter=appId eq '${GRAPH_APP_ID}'&$select=id,appRoles`);
  const sp = data?.value?.[0];
  if (!sp) throw new Error('Microsoft Graph\'s service principal wasn\'t found in the tenant.');
  const roleIds = AUDIT_PERMISSIONS.map((perm) => {
    const role = (sp.appRoles ?? []).find((/** @type {any} */ r) => r.value === perm);
    if (!role) throw new Error(`Microsoft Graph has no ${perm} permission in this cloud.`);
    return /** @type {string} */ (role.id);
  });
  return { graphSpId: /** @type {string} */ (sp.id), roleIds };
}

/**
 * The requiredResourceAccess for the audit collector.
 * @param {string[]} roleIds
 */
export const auditResourceAccess = (roleIds) => [{ resourceAppId: GRAPH_APP_ID, resourceAccess: roleIds.map((id) => ({ id, type: 'Role' })) }];

/**
 * Finds the app registration the record names, or one this installer made earlier with the same name,
 * or makes it. Then makes sure it has a service principal.
 * @param {Client} graph
 * @param {{ key: 'audit' | 'sweep', existing?: AppRegistration, requiredResourceAccess?: any[] }} o
 * @returns {Promise<AppRegistration>}
 */
export async function ensureApp(graph, { key, existing, requiredResourceAccess = [] }) {
  const { displayName } = APPS[key];
  /** @type {any} */
  let app;
  if (existing?.objectId) {
    try {
      app = await graph.get(`/applications/${existing.objectId}?$select=id,appId,displayName,requiredResourceAccess`);
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
    }
  }
  let created = existing?.created ?? false;
  if (!app) {
    const names = [displayName, ...legacyNames(displayName)].map((n) => `displayName eq '${q(n)}'`).join(' or ');
    const found = await graph.get(`/applications?$filter=${names}&$select=id,appId,displayName,notes,requiredResourceAccess`);
    const mine = (found?.value ?? []).filter((/** @type {any} */ a) => a.notes === NOTES || LEGACY_NOTES.includes(a.notes));
    app = mine.find((/** @type {any} */ a) => a.displayName === displayName) ?? mine[0];
  }
  if (!app) {
    app = await graph.post('/applications', { displayName, signInAudience: 'AzureADMyOrg', notes: NOTES, requiredResourceAccess }, { once: true });
    created = true;
  } else if (requiredResourceAccess.length) {
    // Adds what's missing and keeps what's there, so permissions an earlier install added stay.
    const merged = addAccess(app.requiredResourceAccess, requiredResourceAccess);
    if (merged) await graph.patch(`/applications/${app.id}`, { requiredResourceAccess: merged });
  }
  if (app.displayName !== displayName) {
    await graph.patch(`/applications/${app.id}`, { displayName, notes: NOTES });
  }
  // A new application takes a few seconds to be visible to the service principal call.
  const sp = await ensureServicePrincipal(graph, app.appId);
  return { ...(existing ?? {}), appId: app.appId, objectId: app.id, spId: sp, displayName, created };
}

/**
 * The registration's permissions with the wanted ones added, or null when none are missing.
 * @param {any[] | undefined} have
 * @param {any[]} want
 * @returns {any[] | null}
 */
export function addAccess(have, want) {
  const merged = (have ?? []).map((r) => ({ ...r, resourceAccess: [...(r.resourceAccess ?? [])] }));
  let added = false;
  for (const w of want) {
    let entry = merged.find((r) => r.resourceAppId === w.resourceAppId);
    if (!entry) {
      entry = { resourceAppId: w.resourceAppId, resourceAccess: [] };
      merged.push(entry);
    }
    for (const a of w.resourceAccess ?? []) {
      if (entry.resourceAccess.some((/** @type {any} */ x) => x.id === a.id && x.type === a.type)) continue;
      entry.resourceAccess.push(a);
      added = true;
    }
  }
  return added ? merged : null;
}

/**
 * @param {Client} graph
 * @param {string} appId
 * @returns {Promise<string>}
 */
export async function ensureServicePrincipal(graph, appId) {
  const found = await graph.get(`/servicePrincipals?$filter=appId eq '${appId}'&$select=id`);
  if (found?.value?.[0]?.id) return found.value[0].id;
  const sp = await graph.post('/servicePrincipals', { appId }, { retryOn: [400, 404], maxWaitMs: 60_000 });
  return sp.id;
}

/**
 * The admin consent link for an app, for a hand-off.
 * @param {string} tenantId
 * @param {string} appId
 */
export const adminConsentUrl = (tenantId, appId) => `https://login.microsoftonline.com/${tenantId}/adminconsent?client_id=${appId}`;

/**
 * Grants the audit collector its Graph application permissions (admin consent). Without the rights to,
 * returns a hand-off for a Global Administrator or Privileged Role Administrator.
 * @param {Client} graph
 * @param {{ tenantId: string, app: AppRegistration, graphSpId: string, roleIds: string[] }} o
 * @returns {Promise<{ consented: true } | { consented: false, handOff: HandOff }>}
 */
export async function grantAuditConsent(graph, { tenantId, app, graphSpId, roleIds }) {
  if (!app.spId) throw new Error('The audit collector has no service principal yet.');
  const have = await graph.get(`/servicePrincipals/${app.spId}/appRoleAssignments?$select=appRoleId,resourceId`);
  const granted = new Set((have?.value ?? []).filter((/** @type {any} */ a) => a.resourceId === graphSpId).map((/** @type {any} */ a) => a.appRoleId));
  const missing = roleIds.filter((id) => !granted.has(id));
  try {
    for (const appRoleId of missing) {
      await graph.post(`/servicePrincipals/${graphSpId}/appRoleAssignedTo`, { principalId: app.spId, resourceId: graphSpId, appRoleId }, { once: true });
    }
    return { consented: true };
  } catch (err) {
    if (!denied(err)) throw err;
    return {
      consented: false,
      handOff: {
        id: 'audit-consent',
        who: 'Global Administrator or Privileged Role Administrator',
        what: `Grant admin consent for ${AUDIT_PERMISSIONS.join(' and ')} to "${app.displayName}". Open the link, sign in, and accept. Then run the installer again.`,
        link: adminConsentUrl(tenantId, app.appId),
      },
    };
  }
}

/**
 * Adds a client secret. The secret is returned to put straight into the flows' environment variables
 * or Key Vault; only its key ID and expiry are kept.
 * @param {Client} graph
 * @param {AppRegistration} app
 * @param {{ months?: number, now?: () => Date }} [o]
 * @returns {Promise<{ secret: string, keyId: string, expires: string }>}
 */
export async function addSecret(graph, app, { months = 12, now = () => new Date() } = {}) {
  const end = now();
  end.setMonth(end.getMonth() + months);
  const res = await graph.post(`/applications/${app.objectId}/addPassword`, {
    passwordCredential: { displayName: `AI-Monitor installer ${now().toISOString().slice(0, 10)}`, endDateTime: end.toISOString() },
  }, { once: true });
  return { secret: res.secretText, keyId: res.keyId, expires: res.endDateTime };
}

/**
 * Removes an old client secret, after a rotation.
 * @param {Client} graph
 * @param {AppRegistration} app
 * @param {string} keyId
 */
export async function removeSecret(graph, app, keyId) {
  await graph.post(`/applications/${app.objectId}/removePassword`, { keyId });
}

/**
 * Registers the knowledge sweep as a Power Platform admin management application, so its flow may
 * call addAppUser. Without the rights to, returns a hand-off for a Power Platform Administrator.
 * @param {Client} bap  Base URL BAP_BASE.
 * @param {string} clientId
 * @returns {Promise<{ registered: true } | { registered: false, handOff: HandOff }>}
 */
export async function registerAdminApp(bap, clientId) {
  try {
    await bap.put(`/providers/Microsoft.BusinessAppPlatform/adminApplications/${clientId}?api-version=${BAP_API_VERSION}`, {});
    return { registered: true };
  } catch (err) {
    if (!denied(err)) throw err;
    return {
      registered: false,
      handOff: {
        id: 'admin-app',
        who: 'Power Platform Administrator',
        what: 'Register the knowledge sweep app as a Power Platform admin management application. Run this in PowerShell with the Microsoft.PowerApps.Administration.PowerShell module, then run the installer again.',
        command: `New-PowerAppManagementApp -ApplicationId ${clientId}`,
      },
    };
  }
}

/**
 * Removes the admin management application registration.
 * @param {Client} bap
 * @param {string} clientId
 */
export async function unregisterAdminApp(bap, clientId) {
  try {
    await bap.del(`/providers/Microsoft.BusinessAppPlatform/adminApplications/${clientId}?api-version=${BAP_API_VERSION}`);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
}

/** @param {string} tenantId */
export const rootScope = (tenantId) => `/providers/Microsoft.Management/managementGroups/${tenantId}`;

/**
 * Gives the knowledge sweep Reader at the tenant root management group, for Agents scope mode:
 * Resource Graph's Power Platform rows are tenant-scoped, so a subscription assignment isn't enough.
 * @param {Client} arm
 * @param {{ tenantId: string, app: AppRegistration }} o
 * @returns {Promise<{ assigned: true, id: string } | { assigned: false, handOff: HandOff }>}
 */
export async function assignRootReader(arm, { tenantId, app }) {
  if (!app.spId) throw new Error('The knowledge sweep has no service principal yet.');
  const scope = rootScope(tenantId);
  const roleDefinitionId = `/providers/Microsoft.Authorization/roleDefinitions/${READER_ROLE_ID}`;
  try {
    const have = await arm.get(`${scope}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=principalId eq '${app.spId}'`);
    const hit = (have?.value ?? []).find((/** @type {any} */ a) => String(a.properties?.roleDefinitionId ?? '').toLowerCase().endsWith(READER_ROLE_ID) && String(a.properties?.scope ?? '').toLowerCase() === scope.toLowerCase());
    if (hit) return { assigned: true, id: hit.id };
    const id = randomUUID();
    const res = await arm.put(`${scope}/providers/Microsoft.Authorization/roleAssignments/${id}?api-version=2022-04-01`, {
      properties: { roleDefinitionId, principalId: app.spId, principalType: 'ServicePrincipal' },
    }, { retryOn: [400], maxWaitMs: 60_000 });
    return { assigned: true, id: res?.id ?? `${scope}/providers/Microsoft.Authorization/roleAssignments/${id}` };
  } catch (err) {
    if (!denied(err)) throw err;
    return {
      assigned: false,
      handOff: {
        id: 'root-reader',
        who: 'Someone with User Access Administrator or Owner at the tenant root management group',
        what: 'Give the knowledge sweep app Reader at the tenant root management group (Agents scope mode needs it). Run this, then run the installer again. Or switch to Dataverse scope mode, which needs no Azure role.',
        command: `az role assignment create --assignee ${app.appId} --role Reader --scope ${scope}`,
      },
    };
  }
}

/**
 * Removes a role assignment by its ID.
 * @param {Client} arm
 * @param {string} id
 */
export async function removeRoleAssignment(arm, id) {
  try {
    await arm.del(`${id}?api-version=2022-04-01`);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
}

/**
 * Deletes an app registration. For the knowledge sweep, that revokes its access in every environment.
 * @param {Client} graph
 * @param {AppRegistration} app
 */
export async function deleteApp(graph, app) {
  try {
    await graph.del(`/applications/${app.objectId}`);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
}

/**
 * Stores a client secret in Key Vault, and returns the reference the flows' Key Vault variable takes.
 * @param {(url: string) => Client} vaultClient  A client for the vault's URL.
 * @param {{ vault: { name: string, id?: string }, secretName: string, secret: string }} o
 */
export async function storeInKeyVault(vaultClient, { vault, secretName, secret }) {
  const kv = vaultClient(`https://${vault.name}.vault.azure.net`);
  await kv.put(`/secrets/${secretName}?api-version=7.4`, { value: secret, contentType: 'client secret' });
  return keyVaultRef(vault, secretName);
}

/**
 * The secret reference: the vault's Azure resource ID plus /secrets/<name>.
 * @param {{ name: string, id?: string }} vault
 * @param {string} secretName
 */
export const keyVaultRef = (vault, secretName) => `${vault.id ?? vault.name}/secrets/${secretName}`;

/**
 * Finds a vault's Azure resource ID by its name, across the subscriptions the user can read.
 * @param {Client} arm
 * @param {string} name
 */
export async function findVault(arm, name) {
  const subs = await arm.list('/subscriptions?api-version=2020-01-01');
  for (const sub of subs) {
    const found = await arm.get(`/subscriptions/${sub.subscriptionId}/resources?api-version=2021-04-01&$filter=resourceType eq 'Microsoft.KeyVault/vaults' and name eq '${q(name)}'`);
    if (found?.value?.[0]?.id) return /** @type {string} */ (found.value[0].id);
  }
  return undefined;
}

/** The Key Vault secret names the installer writes. */
export const VAULT_SECRET_NAMES = /** @type {const} */ ({ audit: 'agent-inventory-audit-secret', sweep: 'agent-inventory-sweep-secret' });
