// @ts-check
/**
 * The plan: every step in order, with what it creates or changes, the role it needs and whether it's
 * already done. It's shown, and can be saved as Markdown, before anything changes. Two steps ask
 * again on their own: Reader at the tenant root, and the System Administrator application users.
 */
import { compareVersions } from './zip.js';
import { SOLUTIONS, solution } from './solutions.js';
import { APPS } from './identity.js';
import { DATA_SOURCES } from './managed-app/steps.js';

/**
 * @typedef {object} PlanStep
 * @property {string} id
 * @property {string} title
 * @property {string[]} changes  What it creates or changes. "Changes nothing" for a check.
 * @property {string} [role]  Who can run it.
 * @property {string} [note]
 * @property {'done' | 'skip'} [state]
 * @property {boolean} [approval]  Asks for its own approval before it runs.
 *
 * @typedef {{ title: string, facts: { label: string, value: string }[], steps: PlanStep[] }} Plan
 *
 * @typedef {object} NextStep
 * @property {string} title
 * @property {boolean} [optional]
 * @property {string} who
 * @property {string} why
 * @property {string} [link]
 * @property {string} [linkText]
 * @property {string[]} [steps]
 * @property {string} [message]  For a hand-off: what to send the admin.
 *
 * @typedef {object} PlanInput
 * @property {import('./config.js').InstallRecord} record
 * @property {{ id: string, name?: string, url: string }} [environment]
 * @property {'Agents' | 'Dataverse'} scopeMode
 * @property {'envvar' | 'keyvault'} secretMode
 * @property {string} [keyVault]
 * @property {string} [viewerGroup]
 * @property {number} maxGrants
 * @property {boolean} [skipApp]
 * @property {string} [connectionId]
 * @property {Record<string, string>} [zipVersions]  By solution key: what the zips hold.
 * @property {Record<string, string | undefined>} [installed]  By solution key: what the environment has. Omitted offline.
 * @property {string} [appHash]  The app's build hash, when the build is there.
 * @property {boolean} [signedIn]
 * @property {boolean} [sharePoint]  Lane E, SharePoint agents. It's the only lane that needs the audit collector. Default true.
 */

/** @param {PlanInput} p @param {string} key */
function solutionState(p, key) {
  const zip = p.zipVersions?.[key] ?? solution(key).version;
  const have = p.installed ? p.installed[key] : p.record.solutions[key]?.version;
  if (!have) return { state: undefined, have };
  return { state: compareVersions(have, zip) >= 0 ? /** @type {const} */ ('done') : undefined, have, zip };
}

/**
 * @param {PlanInput} p
 * @returns {Plan}
 */
export function buildPlan(p) {
  const { record } = p;
  const env = p.environment ?? record.environment;
  const envName = env ? `${env.name ?? env.id}` : 'the landing environment (picked at the start)';
  const secretWhere = p.secretMode === 'keyvault' ? `Key Vault "${p.keyVault ?? record.options.keyVault?.name ?? '?'}"` : 'the flows\' environment variables';
  const agents = p.scopeMode === 'Agents';
  const sharePoint = p.sharePoint !== false;

  /** @type {PlanStep[]} */
  const steps = [];
  steps.push({
    id: 'sign-in',
    title: 'Sign in',
    changes: ['Changes nothing. One sign-in in the browser gets the tokens for Microsoft Graph, Azure, Power Platform and Dataverse.'],
    ...(p.signedIn ? { state: 'done' } : {}),
  });
  steps.push({
    id: 'prereqs',
    title: 'Check prerequisites',
    changes: [`Changes nothing. Reports your roles, ${sharePoint ? 'the audit log, ' : ''}the Managed Apps settings, licences and Node.js.`],
    ...(p.signedIn ? { state: 'done' } : {}),
  });
  steps.push({
    id: 'environment',
    title: 'Confirm the landing environment',
    changes: [`Changes nothing. The landing tables and the app both go into ${envName}: the app reads the tables through the current-environment Dataverse connector.`],
    ...(env ? { state: 'done' } : {}),
  });

  const audit = record.auditApp;
  if (sharePoint) {
    steps.push({
      id: 'audit-app',
      title: `App registration: ${APPS.audit.displayName}`,
      changes: [
        audit ? `Reuses the app registration made earlier (${audit.displayName}).` : `Creates the app registration "${APPS.audit.displayName}", single-tenant, with its service principal.`,
        'Adds the Microsoft Graph application permission AuditLogsQuery.Read.All for lane E and grants admin consent for it.',
        `Adds a client secret when a solution needs one, into ${secretWhere}. Only its key ID and expiry are saved.`,
      ],
      role: 'Can register apps; admin consent needs Global Administrator or Privileged Role Administrator (otherwise you get a link to send them)',
      ...(audit?.consented && Object.keys(record.solutions).length ? { state: 'done' } : {}),
    });
  }

  const sweep = record.sweepApp;
  steps.push({
    id: 'sweep-app',
    title: `App registration: ${APPS.sweep.displayName}`,
    changes: [
      sweep ? `Reuses the app registration made earlier (${sweep.displayName}).` : `Creates the app registration "${APPS.sweep.displayName}", single-tenant, with no API permissions.`,
      'Registers it as a Power Platform admin management application, so the grant flow may add it to environments.',
      `Adds a client secret when a solution needs one, into ${secretWhere}.`,
    ],
    role: 'Can register apps; the admin registration needs Power Platform Administrator (otherwise you get a command to send them)',
    ...(sweep?.adminApp && Object.keys(record.solutions).length ? { state: 'done' } : {}),
  });

  steps.push({
    id: 'root-reader',
    title: 'Reader at the tenant root management group',
    changes: agents
      ? ['Gives the knowledge sweep app the Azure Reader role at the tenant root management group, so Agents scope mode can find the environments that have agents through Resource Graph.']
      : ['Not needed in Dataverse scope mode.'],
    role: 'Owner or User Access Administrator at the tenant root (otherwise you get a command to send them)',
    note: agents ? 'Reader at the root can read every resource in every subscription. Decline it to use Dataverse scope mode instead.' : undefined,
    ...(agents ? (sweep?.rootReaderId ? { state: 'done' } : { approval: true }) : { state: 'skip' }),
  });

  const conn = record.connection;
  steps.push({
    id: 'connection',
    title: 'Dataverse connection for the flows',
    changes: [
      p.connectionId ? 'Uses the connection given with --connection-id.' : conn ? 'Reuses the Dataverse connection made earlier.' : `Reuses your working Microsoft Dataverse connection in ${envName}, or creates one in your name.`,
      'The flows\' connection references are bound to it; the flows run as you.',
    ],
    role: 'Environment Maker or System Administrator in the landing environment',
    ...(conn?.status === 'Connected' ? { state: 'done' } : {}),
  });

  /**
   * @param {string} key
   * @param {string[]} extra
   * @param {Partial<PlanStep>} [more]
   */
  const solutionStep = (key, extra, more = {}) => {
    const def = solution(key);
    const s = solutionState(p, key);
    const zip = p.zipVersions?.[key] ?? def.version;
    steps.push({
      id: `solution-${key}`,
      title: `Lane ${def.lane}: import ${def.uniqueName} ${zip}`,
      changes: [
        s.have && !s.state ? `Upgrades ${def.uniqueName} ${s.have} to ${zip} (stage and upgrade).` : `Imports the managed solution ${def.file} into ${envName}.`,
        `Sets its environment variables: tenant, app registration, ${p.secretMode === 'keyvault' ? 'Key Vault reference' : 'client secret'}.`,
        ...extra,
      ],
      role: 'System Administrator in the landing environment',
      ...(s.state ? { state: s.state } : {}),
      ...more,
    });
  };

  if (sharePoint) solutionStep('sharepoint', ['Brings the SharePoint agent tables and the daily and manual flows.']);
  else {
    const def = solution('sharepoint');
    steps.push({ id: 'solution-sharepoint', title: `Lane ${def.lane}: import ${def.uniqueName}`, changes: ['Left out: lane E (SharePoint agents) isn\'t included. No audit collector app registration is made for it.'], state: 'skip' });
  }
  steps.push({
    id: 'lane-d-tables',
    title: 'Lane D: create the knowledge source tables',
    changes: ['Creates the poc_AgentKnowledgeSource table and the flow tables (sweep environments, runs, errors) with their keys, as Publish-KnowledgeSources.js --provision does. Tables already there are left alone.'],
    role: 'System Administrator in the landing environment',
    ...(record.tablesProvisioned ? { state: 'done' } : {}),
  });
  solutionStep('appusers', [`Scope mode ${p.scopeMode}, MaxGrants ${p.maxGrants}, WhatIf true: the first run only reports which environments it would grant.`]);

  const grant = record.appUserGrant;
  steps.push({
    id: 'appuser-grant',
    title: 'Lane D: grant the knowledge sweep in each environment',
    changes: [
      'Runs the grant flow once in what-if mode and shows how many environments are in scope and missing the app user.',
      `If you approve: sets WhatIf to false and runs it again. It adds the knowledge sweep as an application user with the System Administrator role in each of those environments (at most ${p.maxGrants} a run), and keeps doing so weekly.`,
    ],
    role: 'Power Platform Administrator (the flow runs as the knowledge sweep app)',
    note: 'System Administrator in every environment in scope is broad. You see the what-if result first and can stop there.',
    ...(grant?.approvedAt ? { state: 'done' } : { approval: true }),
  });
  solutionStep('sweep', ['Brings the daily knowledge source sweep flow.']);

  const flowCount = SOLUTIONS.filter((s) => sharePoint || s.key !== 'sharepoint').reduce((n, s) => n + s.flows.length, 0);
  steps.push({
    id: 'flows',
    title: 'Turn the flows on',
    changes: [
      `Turns on the ${flowCount} flows (off and on again when their variables changed, so they pick the new values up).`,
      'Runs each daily flow once now, so the first data lands today.',
    ],
    role: 'The owner of the flows (you)',
  });
  steps.push({
    id: 'verify',
    title: 'Check the run tables',
    changes: ['Changes nothing. Reads the newest row in each lane\'s run table. "First run pending" isn\'t a failure.'],
  });

  const app = record.managedApp;
  const shared = !p.viewerGroup || (app?.sharedWith ?? []).includes(p.viewerGroup);
  steps.push({
    id: 'app',
    title: 'Deploy the app',
    changes: p.skipApp
      ? ['Skipped (--skip-app).']
      : [
        app?.appId ? 'Updates the app deployed earlier, only if its build changed.' : `Creates the app "Agent-Monitor" in ${envName} (ms app init).`,
        `Adds its ${DATA_SOURCES.length} data sources: ${DATA_SOURCES.join(', ')} (each viewer signs in to them the first time).`,
        'Deploys the built app and prints its link.',
        ...(p.viewerGroup ? [`Shares it with the viewer group ${p.viewerGroup}.`] : ['Shares it with nobody yet: run access later, or pass --viewer-group.']),
      ],
    role: 'Environment Maker in the landing environment, with the Managed Apps settings on',
    ...(p.skipApp ? { state: 'skip' } : app?.buildHash && p.appHash && app.buildHash === p.appHash && shared ? { state: 'done' } : {}),
  });
  steps.push({
    id: 'lane-f',
    title: 'Lane F: Defender (check only)',
    changes: ['Changes nothing: lane F has nothing to install. Reports whether Defender for Endpoint and Security Reader are there.'],
  });

  return {
    title: 'The plan',
    facts: [
      { label: 'Landing environment', value: env ? `${env.name ?? env.id} (${env.url})` : 'picked after sign-in' },
      { label: 'Secrets', value: secretWhere },
      { label: 'Knowledge sweep scope mode', value: p.scopeMode },
      { label: 'Lane E (SharePoint agents)', value: sharePoint ? 'included' : 'left out' },
      { label: 'Viewer group', value: p.viewerGroup ?? 'none' },
    ],
    steps,
  };
}

/** Steps that will change something: not done, not skipped and not a check. @param {Plan} plan */
export const pendingSteps = (plan) => plan.steps.filter((s) => !s.state && !s.changes[0].startsWith('Changes nothing'));

/**
 * The plan as Markdown, to save or send for approval.
 * @param {Plan} plan
 * @param {{ now?: Date }} [o]
 */
export function planMarkdown(plan, o = {}) {
  const out = [`# Agent-Monitor install: ${plan.title.toLowerCase()}`, ''];
  if (o.now) out.push(`Made ${o.now.toISOString().slice(0, 16).replace('T', ' ')} UTC.`, '');
  for (const f of plan.facts) out.push(`- **${f.label}:** ${f.value}`);
  out.push('');
  plan.steps.forEach((s, i) => {
    const tag = s.state === 'done' ? ' *(already done)*' : s.state === 'skip' ? ' *(skipped)*' : s.approval ? ' *(asks again before it runs)*' : '';
    out.push(`## ${i + 1}. ${s.title}${tag}`, '');
    for (const ch of s.changes) out.push(`- ${ch}`);
    if (s.role) out.push(`- *Role:* ${s.role}`);
    if (s.note) out.push(`- *Note:* ${s.note}`);
    out.push('');
  });
  return out.join('\n');
}

/**
 * The hand-offs in the record, as next steps.
 * @param {import('./config.js').HandOff[]} handoffs
 * @param {string} again  How to run the installer again.
 * @returns {NextStep[]}
 */
export function handOffSteps(handoffs, again) {
  return handoffs.map((h) => ({
    title: h.what.split('. ')[0],
    who: h.who,
    why: h.what,
    ...(h.link ? { link: h.link, linkText: 'Link' } : {}),
    message: [
      `Please could you do this for the Agent-Monitor install: ${h.what}`,
      ...(h.link ? [h.link] : []),
      ...(h.command ? [h.command] : []),
    ].join('\n'),
    steps: [`When it's done, run ${again}.`],
  }));
}
