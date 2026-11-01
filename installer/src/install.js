// @ts-check
/**
 * The commands. Each signs in (when it needs to), works out what's there, and only then changes
 * anything: install shows the plan and waits for approval, and the two broad grants (Reader at the
 * tenant root, System Administrator in every environment in scope) ask again before they run.
 * Everything it makes goes into the install record, so a re-run picks up where it stopped and
 * uninstall removes only what it made.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTokens, createCredential, createTokenProvider, dataverseScope, decodeJwt } from './auth.js';
import { addHandOff, clearHandOff, defaultRecordPath, deleteRecord, emptyRecord, loadRecord, saveRecord } from './config.js';
import { API_PATH, createDataverse } from './dataverse.js';
import { createClient, HttpError } from './http.js';
import {
  addSecret, APPS, assignRootReader, AUDIT_PERMISSIONS, auditResourceAccess, BAP_BASE, deleteApp, ensureApp, findVault,
  grantAuditConsent, graphAuditRole, registerAdminApp, removeRoleAssignment, removeSecret, storeInKeyVault, unregisterAdminApp,
  VAULT_SECRET_NAMES,
} from './identity.js';
import { LANE_D_TABLES, logicalName, provisionLaneD } from './lane-d-tables.js';
import { commandLine } from './launch.js';
import { createCli } from './managed-app/cli.js';
import { ADMIN_STEPS } from './managed-app/errors.js';
import { buildHash, defaultWorkDir, deployTheApp, ensureBuild, removeTheApp, shareTheApp, whyNot } from './managed-app/flow.js';
import { buildPlan, handOffSteps, planMarkdown } from './plan.js';
import { connectionInstructions, deleteConnection, ensureDataverseConnection, FLOW_BASE, listEnvironments, POWERAPPS_BASE, runFlowNow } from './power-platform.js';
import { checkPrereqs, prereqApi } from './prereqs.js';
import { componentParameters, envVarValues, GRANT_FLOW_ID, loadSolutionZip, PLACEHOLDER_SECRET, solution, SOLUTIONS } from './solutions.js';
import { laneF, verifyLanes } from './verify.js';

/** The repo, or the unpacked release: installer\, solution\ and app\ side by side. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const ARM_BASE = 'https://management.azure.com';

/** How long to wait for the grant flow's what-if run before leaving it for a re-run. */
export const WHAT_IF_WAIT_MS = 10 * 60_000;

/**
 * @typedef {object} Options  From the command line.
 * @property {boolean} [yes]
 * @property {string} [tenant]
 * @property {string} [environment]  Its ID, name or URL.
 * @property {'browser' | 'device-code' | 'azure-cli'} [signIn]
 * @property {string} [clientId]
 * @property {string} [keyVault]  Key Vault mode: the vault's name.
 * @property {'Agents' | 'Dataverse'} [scopeMode]
 * @property {string} [viewerGroup]
 * @property {string} [connectionId]
 * @property {string} [config]  The install record's path.
 * @property {string} [savePlan]
 * @property {string} [solutions]  The folder with the solution zips.
 * @property {string} [appDist]
 * @property {boolean} [skipApp]
 * @property {boolean} [sharePoint]  Lane E: true includes it, false leaves it out. Unset keeps the saved choice, else includes it.
 * @property {boolean} [approveGrants]
 * @property {boolean} [approveRootReader]
 * @property {boolean} [deleteData]
 * @property {number} [maxGrants]
 * @property {number} [secretMonths]
 * @property {'audit' | 'sweep'} [app]  rotate-secret: one app only.
 * @property {boolean} [removeOld]  rotate-secret: remove the secret it replaces.
 * @property {string[]} [share]  access: who to share the app with.
 * @property {boolean} [debug]
 *
 * @typedef {object} Deps  What tests replace.
 * @property {import('./ui.js').Ui} ui
 * @property {(resource: import('./auth.js').Resource) => Promise<string>} [getToken]
 * @property {typeof fetch} [fetchImpl]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => Date} [now]
 * @property {import('./managed-app/cli.js').RunCli} [runCli]
 * @property {import('./managed-app/flow.js').RunNpm} [runNpm]
 * @property {(path: string) => Buffer} [readFile]
 * @property {string} [nodeVersion]
 * @property {string} [cliVersion]
 * @property {{ solutions?: string, appSource?: string, appDist?: string, workDir?: string }} [paths]
 * @property {(path: string, text: string) => void} [writeFile]
 */

/** @param {unknown} err */
export const message = (err) => {
  const e = /** @type {any} */ (err);
  const text = String(e?.message ?? err).split('\n')[0];
  return e instanceof HttpError && !text.includes(String(e.status)) ? `${text} (HTTP ${e.status})` : text;
};

/**
 * One client per API, each asking for its own token.
 * @param {(resource: import('./auth.js').Resource) => Promise<string>} getToken
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, debug?: (s: string) => void }} [o]
 */
export function createApis(getToken, o = {}) {
  /** @param {string} baseUrl @param {import('./auth.js').Resource} resource */
  const client = (baseUrl, resource) => createClient({
    baseUrl,
    getToken: () => getToken(resource),
    ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(o.debug ? { debug: o.debug } : {}),
  });
  return {
    graph: client(GRAPH_BASE, 'graph'),
    arm: client(ARM_BASE, 'arm'),
    bap: client(BAP_BASE, 'bap'),
    powerapps: client(POWERAPPS_BASE, 'powerapps'),
    flow: client(FLOW_BASE, 'flow'),
    /** @param {string} url */
    vault: (url) => client(url, 'keyVault'),
    /** @param {string} orgUrl */
    dataverse: (orgUrl) => createDataverse(client(`${orgUrl.replace(/\/$/, '')}${API_PATH}`, dataverseScope(orgUrl)), o.sleep ? { sleep: o.sleep } : {}),
  };
}
/** @typedef {ReturnType<typeof createApis>} Apis */

/**
 * The settings for this run: the flags, else what the record saved, else the defaults.
 * @param {Options} o
 * @param {import('./config.js').InstallRecord} record
 */
export function resolveSettings(o, record) {
  const saved = record.options;
  const keyVault = o.keyVault ?? saved.keyVault?.name;
  return {
    scopeMode: o.scopeMode ?? saved.scopeMode ?? /** @type {'Agents' | 'Dataverse'} */ ('Agents'),
    secretMode: keyVault && (o.keyVault || saved.secretMode === 'keyvault') ? /** @type {const} */ ('keyvault') : /** @type {const} */ ('envvar'),
    keyVault,
    viewerGroup: o.viewerGroup ?? saved.viewerGroup,
    sharePoint: o.sharePoint ?? saved.sharePoint ?? true,
    maxGrants: o.maxGrants ?? saved.maxGrants ?? 25,
    secretMonths: o.secretMonths ?? saved.secretMonths ?? 12,
  };
}
/** @typedef {ReturnType<typeof resolveSettings>} Settings */

/**
 * The record, its path and a save function.
 * @param {Options} o
 * @param {Deps} d
 */
function openRecord(o, d) {
  const path = o.config ?? defaultRecordPath();
  const existing = loadRecord(path);
  const record = existing ?? emptyRecord();
  const save = () => saveRecord(path, record, d.now);
  return { path, record, save, existed: !!existing };
}

/**
 * The paths: the solution zips, the app's source and build, and its work folder.
 * @param {Options} o
 * @param {Deps} d
 */
function paths(o, d) {
  const appSource = d.paths?.appSource ?? join(ROOT, 'app');
  return {
    solutions: o.solutions ?? d.paths?.solutions ?? join(ROOT, 'solution'),
    appSource,
    appDist: o.appDist ?? d.paths?.appDist ?? join(appSource, 'dist'),
    workDir: d.paths?.workDir ?? defaultWorkDir(),
  };
}

/**
 * Reads the solution zips and checks they're the ones expected.
 * @param {string} dir
 * @param {Deps} d
 */
export function loadZips(dir, d = /** @type {Deps} */ ({})) {
  /** @type {Record<string, { bytes: Buffer, version: string }>} */
  const zips = {};
  for (const def of SOLUTIONS) {
    try {
      const z = loadSolutionZip(dir, def, d.readFile);
      zips[def.key] = { bytes: z.bytes, version: z.version };
    } catch (err) {
      if (/** @type {any} */ (err)?.code === 'ENOENT') throw new Error(`${def.file} isn't in ${dir}. Run the installer from the release zip or a clone of the repo, or pass --solutions <folder>.`);
      throw err;
    }
  }
  return zips;
}

/**
 * Signs in once, checks every API gives a token, and reads who signed in.
 * @param {Options} o
 * @param {Deps} d
 * @param {import('./config.js').InstallRecord} record
 */
export async function connect(o, d, record) {
  const { ui } = d;
  const debug = o.debug ? (/** @type {string} */ s) => ui.note(`[debug] ${s}`) : undefined;
  let getToken = d.getToken;
  if (!getToken) {
    const credential = createCredential({
      tenantId: o.tenant ?? record.tenantId,
      method: o.signIn ?? 'browser',
      ...(o.clientId ? { clientId: o.clientId } : {}),
      print: (m) => ui.info(m),
    });
    getToken = createTokenProvider(credential, { ...(d.sleep ? { sleep: d.sleep } : {}), ...(debug ? { debug } : {}) });
    ui.info(o.signIn === 'device-code' ? 'Signing in with a code...' : 'Signing in: a browser window opens.');
  }
  const claims = decodeJwt(await getToken('graph'));
  try {
    await checkTokens(getToken, ['graph', 'arm', 'bap', 'powerapps', 'flow']);
  } catch (err) {
    throw new Error(`${message(err)} If the sign-in app can't get tokens for every API, register a public client app with those delegated permissions and pass --client-id.`, { cause: err });
  }
  if (record.tenantId && claims.tid && record.tenantId !== claims.tid) {
    throw new Error('You signed in to a different tenant from the one in the install record. Sign in to that tenant, or use --config with another record.');
  }
  const apis = createApis(getToken, { ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}), ...(d.sleep ? { sleep: d.sleep } : {}), ...(debug ? { debug } : {}) });
  /** @type {any} */
  const me = await apis.graph.get('/me?$select=id,userPrincipalName');
  const user = { id: /** @type {string} */ (me?.id ?? claims.oid), upn: /** @type {string} */ (me?.userPrincipalName ?? claims.upn ?? claims.preferred_username) };
  ui.ok(`Signed in as ${user.upn}`);
  return { apis, user, tenantId: /** @type {string} */ (claims.tid ?? record.tenantId) };
}

/**
 * The landing environment: --environment, the record's, or a choice.
 * @param {Apis} apis
 * @param {Options} o
 * @param {import('./config.js').InstallRecord} record
 * @param {import('./ui.js').Ui} ui
 */
export async function pickEnvironment(apis, o, record, ui) {
  const all = await listEnvironments(apis.bap);
  const want = (o.environment ?? record.environment?.id)?.replace(/\/$/, '').toLowerCase();
  if (want) {
    const hit = all.find((e) => [e.id, e.name, e.url].some((v) => v && v.toLowerCase() === want));
    if (!hit) throw new Error(`There's no Dataverse environment "${o.environment ?? record.environment?.id}" that you can see.`);
    if (record.environment && record.environment.id !== hit.id && Object.keys(record.solutions).length) {
      throw new Error(`The install record is for another environment (${record.environment.name ?? record.environment.id}). To install into a second one, use --config with another record file.`);
    }
    return hit;
  }
  if (!all.length) throw new Error('You can\'t see any environment with Dataverse. You need System Administrator in the one the landing tables go into.');
  return ui.select(
    'Landing environment: the tables, the flows and the app all go here',
    all.map((e) => ({ name: `${e.name}  ${e.url}${e.type ? `  (${e.type})` : ''}`, value: e })),
    all.find((e) => e.isDefault),
  );
}

/**
 * The solutions this install covers: all of them, less lane E's when it's left out.
 * @param {{ sharePoint?: boolean }} settings
 */
export const selected = (settings) => SOLUTIONS.filter((def) => def.key !== 'sharepoint' || settings.sharePoint !== false);

/**
 * Which solution versions the environment has, by key.
 * @param {import('./dataverse.js').Dataverse} dv
 */
async function installedVersions(dv) {
  /** @type {Record<string, string | undefined>} */
  const out = {};
  for (const def of SOLUTIONS) out[def.key] = (await dv.solutionVersion(def.uniqueName))?.version;
  return out;
}

/**
 * The install: sign in, check, show the plan, and on approval run it step by step.
 * @param {Options} o
 * @param {Deps} d
 * @returns {Promise<number>}
 */
export async function install(o, d) {
  const { ui } = d;
  const now = d.now ?? (() => new Date());
  const sleep = d.sleep ?? ((/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)));
  const { record, save, path: recordPath } = openRecord(o, d);
  const where = paths(o, d);
  const zips = loadZips(where.solutions, d);
  const settings = resolveSettings(o, record);
  if (record.uninstalledAt) delete record.uninstalledAt;

  ui.heading('Sign in');
  const { apis, user, tenantId } = await connect(o, d, record);

  ui.heading('Prerequisites');
  const prereqs = await checkPrereqs({ api: prereqApi(apis), user, scopeMode: settings.scopeMode, withApp: !o.skipApp, sharePoint: settings.sharePoint, ...(d.nodeVersion ? { nodeVersion: d.nodeVersion } : {}) });
  ui.prereqs(prereqs);

  ui.heading('Landing environment');
  const env = await pickEnvironment(apis, o, record, ui);
  ui.ok(`${env.name} (${env.url})`);
  const dv = apis.dataverse(env.url);
  const installed = await installedVersions(dv);

  /** @type {{ name: string, id?: string } | undefined} */
  let vault;
  if (settings.secretMode === 'keyvault' && settings.keyVault) {
    const id = record.options.keyVault?.name === settings.keyVault ? record.options.keyVault.id : await findVault(apis.arm, settings.keyVault);
    if (!id) throw new Error(`Couldn't find the Key Vault "${settings.keyVault}" in a subscription you can read. Check its name, or leave out --key-vault to keep the secrets in the flows' environment variables.`);
    vault = { name: settings.keyVault, id };
  }

  const appHash = !o.skipApp && existsSync(join(where.appDist, 'index.html')) ? buildHash(where.appDist) : undefined;
  const plan = buildPlan({
    record,
    environment: env,
    scopeMode: settings.scopeMode,
    secretMode: settings.secretMode,
    ...(settings.keyVault ? { keyVault: settings.keyVault } : {}),
    ...(settings.viewerGroup ? { viewerGroup: settings.viewerGroup } : {}),
    maxGrants: settings.maxGrants,
    skipApp: !!o.skipApp,
    ...(o.connectionId ? { connectionId: o.connectionId } : {}),
    zipVersions: Object.fromEntries(Object.entries(zips).map(([k, z]) => [k, z.version])),
    installed,
    ...(appHash ? { appHash } : {}),
    signedIn: true,
    sharePoint: settings.sharePoint,
  });
  ui.plan(plan);
  if (o.savePlan) {
    (d.writeFile ?? ((p, t) => writeFileSync(p, t, 'utf8')))(o.savePlan, planMarkdown(plan, { now: now() }));
    ui.ok(`Saved the plan to ${o.savePlan}`);
  }
  if (!(await ui.confirm('Go ahead with this plan?', true))) {
    ui.info('Nothing was changed.');
    return 0;
  }

  record.tenantId = tenantId;
  record.user = { upn: user.upn, oid: user.id };
  record.environment = { id: env.id, name: env.name, url: env.url };
  record.options = {
    ...record.options,
    scopeMode: settings.scopeMode,
    secretMode: settings.secretMode,
    ...(vault ? { keyVault: vault } : {}),
    ...(settings.viewerGroup ? { viewerGroup: settings.viewerGroup } : {}),
    maxGrants: settings.maxGrants,
    secretMonths: settings.secretMonths,
    sharePoint: settings.sharePoint,
  };
  if (!settings.sharePoint) clearHandOff(record, 'audit-consent');
  save();
  ui.note(`Install record: ${recordPath}`);

  const run = createRun({ o, d, ui, apis, dv, record, save, settings, vault, tenantId, user, env, zips, where, prereqs, now, sleep });
  const failed = await run.steps(plan);
  return finish(ui, record, failed, run);
}

/**
 * The install's steps, sharing what they learn: the secrets made this run (only in memory), which
 * solutions' variables changed, and which flows were already restarted.
 * @param {object} c
 * @param {Options} c.o
 * @param {Deps} c.d
 * @param {import('./ui.js').Ui} c.ui
 * @param {Apis} c.apis
 * @param {import('./dataverse.js').Dataverse} c.dv
 * @param {import('./config.js').InstallRecord} c.record
 * @param {() => void} c.save
 * @param {Settings} c.settings
 * @param {{ name: string, id?: string } | undefined} c.vault
 * @param {string} c.tenantId
 * @param {{ id: string, upn: string }} c.user
 * @param {{ id: string, name: string, url: string }} c.env
 * @param {Record<string, { bytes: Buffer, version: string }>} c.zips
 * @param {ReturnType<typeof paths>} c.where
 * @param {import('./prereqs.js').Prereq[]} c.prereqs
 * @param {() => Date} c.now
 * @param {(ms: number) => Promise<void>} c.sleep
 */
export function createRun(c) {
  const { o, d, ui, apis, dv, record, save, settings, tenantId, env } = c;
  /** @type {{ audit?: string, sweep?: string }} */
  const secrets = {};
  /** @type {{ audit?: string, sweep?: string }} */
  const refs = {};
  /** Solutions whose variables changed this run, so their flows restart. */
  const changed = new Set();
  /** Solutions imported this run, so their daily flows run once now. */
  const imported = new Set();
  const restarted = new Set();
  /** @type {string | undefined} */
  let connectionId;
  /** @type {import('./managed-app/flow.js').DeployOutcome | undefined} */
  let appOutcome;
  /** @type {string[]} */
  const notes = [];

  /** @param {'audit' | 'sweep'} key */
  const reg = (key) => (key === 'audit' ? record.auditApp : record.sweepApp);

  if (settings.secretMode === 'keyvault' && c.vault) {
    for (const key of /** @type {const} */ (['audit', 'sweep'])) {
      if (reg(key)?.secretWhere === 'keyvault' && reg(key)?.secretKeyId) refs[key] = `${c.vault.id ?? c.vault.name}/secrets/${VAULT_SECRET_NAMES[key]}`;
    }
  }

  const inputs = () => ({
    tenantId,
    appIds: { ...(record.auditApp ? { audit: record.auditApp.appId } : {}), ...(record.sweepApp ? { sweep: record.sweepApp.appId } : {}) },
    secretMode: settings.secretMode,
    secrets,
    keyVaultRefs: refs,
    scopeMode: settings.scopeMode,
    whatIf: !record.appUserGrant?.approvedAt,
    maxGrants: settings.maxGrants,
  });

  /**
   * Sets a solution's variables to what they should be. Returns whether any changed.
   * @param {import('./solutions.js').SolutionDef} def
   * @param {(v: import('./solutions.js').EnvValue) => boolean} [only]
   */
  async function applyVars(def, only = () => true) {
    let any = false;
    for (const v of envVarValues(def, inputs()).filter(only)) {
      if (await dv.setEnvVar(v.schemaname, v.value)) any = true;
    }
    if (any) changed.add(def.key);
    return any;
  }

  /**
   * Whether an installed solution's flows have no usable secret: the variable is empty or still the
   * packaged placeholder (env var mode), or there's no Key Vault reference yet.
   * @param {import('./solutions.js').SolutionDef} def
   */
  async function lacksSecret(def) {
    if (settings.secretMode === 'keyvault') {
      const kv = await dv.envVar(def.vars.keyVault);
      return !refs[def.app] || kv?.value !== refs[def.app];
    }
    const s = await dv.envVar(def.vars.secret);
    return !s?.value || s.value === PLACEHOLDER_SECRET;
  }

  /**
   * Makes a client secret for an app, when this run hasn't yet, and puts it everywhere that app's
   * solutions read it: every installed solution of that app gets the same one.
   * @param {'audit' | 'sweep'} key
   * @param {{ force?: boolean }} [f]
   */
  async function ensureSecret(key, f = {}) {
    if (!f.force && (secrets[key] || (settings.secretMode === 'keyvault' && refs[key]))) return undefined;
    const app = reg(key);
    if (!app) throw new Error(`The ${APPS[key].displayName} app registration isn't there yet.`);
    const old = app.secretKeyId;
    const made = await addSecret(apis.graph, app, { months: settings.secretMonths, now: c.now });
    secrets[key] = made.secret;
    app.secretKeyId = made.keyId;
    app.secretExpires = made.expires;
    app.secretWhere = settings.secretMode;
    if (settings.secretMode === 'keyvault' && c.vault) {
      refs[key] = await storeInKeyVault(apis.vault, { vault: c.vault, secretName: VAULT_SECRET_NAMES[key], secret: made.secret });
    }
    save();
    ui.ok(`Added a client secret to "${app.displayName}", valid until ${made.expires.slice(0, 10)}${c.vault && settings.secretMode === 'keyvault' ? `, stored in Key Vault ${c.vault.name}` : ''}`);
    const secretNames = (/** @type {import('./solutions.js').SolutionDef} */ def) => [def.vars.secret, def.vars.keyVault, def.vars.usingAkv];
    for (const def of SOLUTIONS.filter((s) => s.app === key)) {
      if (!(await dv.solutionVersion(def.uniqueName))) continue;
      await applyVars(def, (v) => secretNames(def).includes(v.schemaname));
    }
    return old;
  }

  /**
   * Binds a solution's connection references to the Dataverse connection.
   * @param {import('./solutions.js').SolutionDef} def
   */
  async function bindConnection(def) {
    if (!connectionId) return;
    for (const name of def.connectionReferences) {
      if (await dv.setConnectionReference(name, connectionId)) changed.add(def.key);
    }
  }

  /** @param {string} key */
  async function solutionStep(key) {
    const def = solution(key);
    const zip = c.zips[key];
    const need = await dv.importNeeded(def.uniqueName, zip.version);
    if (need.needed) {
      await ensureSecret(def.app);
      const values = envVarValues(def, inputs());
      const progress = ui.progress(`${need.upgrade ? 'Upgrading' : 'Importing'} ${def.uniqueName} ${zip.version}`);
      try {
        await dv.importSolution({ zip: zip.bytes, componentParameters: componentParameters(def, values, connectionId), upgrade: need.upgrade, onStatus: (s) => progress.update(s) });
      } finally {
        progress.done();
      }
      imported.add(key);
      changed.add(key);
      record.solutions[key] = { version: zip.version, importedAt: c.now().toISOString() };
      save();
      ui.ok(`${need.upgrade ? 'Upgraded' : 'Imported'} ${def.uniqueName} ${zip.version}`);
    } else {
      ui.ok(`${def.uniqueName} ${need.installed} is already there`);
      if (await lacksSecret(def)) await ensureSecret(def.app);
    }
    // An import doesn't always take ComponentParameters for an existing variable, so set them anyway.
    await applyVars(def);
    await bindConnection(def);
    if (changed.has(key) && !need.needed) ui.ok(`Updated ${def.uniqueName}'s settings`);
    if (!connectionId) ui.warn('Its connection references aren\'t bound yet: the flows can\'t be turned on until the Dataverse connection works.');
  }

  /**
   * Turns a flow on, or off and on again when its variables changed this run.
   * @param {import('./solutions.js').SolutionDef} def
   * @param {import('./solutions.js').FlowDef} f
   * @returns {Promise<'on' | 'turned-on' | 'restarted' | 'missing'>}
   */
  async function flowOn(def, f) {
    const state = await dv.flowState(f.id);
    if (state === undefined) return 'missing';
    let result = /** @type {'on' | 'turned-on' | 'restarted'} */ ('on');
    if (state === 'off') {
      await dv.setFlowState(f.id, true);
      result = 'turned-on';
    } else if (changed.has(def.key) && !restarted.has(f.id)) {
      await dv.restartFlow(f.id);
      result = 'restarted';
    }
    restarted.add(f.id);
    record.flows[f.id] = 'on';
    save();
    return result;
  }

  /** @param {string} flowId */
  async function startFlow(flowId) {
    await runFlowNow(apis.flow, { environmentId: env.id, flowId });
  }

  /**
   * Waits for the grant flow's run row written after a time.
   * @param {string} since
   */
  async function waitForGrantRun(since) {
    const deadline = Date.now() + WHAT_IF_WAIT_MS;
    const progress = ui.progress('Waiting for the what-if run');
    try {
      for (;;) {
        const row = await dv.latestRow('poc_knowledgesweepruns', ['poc_status', 'poc_rowsfound', 'poc_rowsupdated', 'poc_environmentsfailed'], { since });
        const status = String(row?.poc_status ?? '');
        if (row && status && !/^running/i.test(status)) return row;
        progress.update(row ? status || 'running' : 'waiting for the run to start');
        if (Date.now() > deadline) return undefined;
        await c.sleep(15_000);
      }
    } finally {
      progress.done();
    }
  }

  async function grantStep() {
    const def = solution('appusers');
    const grant = (record.appUserGrant ??= {});
    if (grant.approvedAt) {
      await applyVars(def, (v) => v.schemaname === 'poc_AU_WhatIf');
      ui.ok(`Approved on ${grant.approvedAt.slice(0, 10)}: the grant flow runs for real, weekly.`);
      return;
    }
    if (!connectionId) throw new Error('The grant flow needs the Dataverse connection first.');
    await applyVars(def, (v) => v.schemaname === 'poc_AU_WhatIf');
    await flowOn(def, def.flows[0]);
    const since = new Date(c.now().getTime() - 60_000).toISOString();
    try {
      await startFlow(GRANT_FLOW_ID);
    } catch (err) {
      grant.whatIfAt = c.now().toISOString();
      save();
      ui.warn(`Couldn't start the grant flow from here (${message(err)}). In Power Automate, open "${def.flows[0].name}" in ${env.name}, select Run, and then run the installer again to see the what-if result.`);
      notes.push('Run the grant flow once in what-if mode, then run the installer again to approve the grants.');
      return;
    }
    ui.info('Started the grant flow in what-if mode. It only reports; it changes nothing.');
    const row = await waitForGrantRun(since);
    grant.whatIfAt = c.now().toISOString();
    if (!row) {
      save();
      ui.warn('The what-if run hasn\'t finished yet. Run the installer again in a few minutes to see its result and decide.');
      notes.push('Run the installer again to see the grant flow\'s what-if result and decide.');
      return;
    }
    grant.inScope = Number(row.poc_rowsfound ?? 0);
    grant.missing = Number(row.poc_rowsupdated ?? 0);
    save();
    if (/fail/i.test(String(row.poc_status))) throw new Error(`The what-if run ended "${row.poc_status}". Open the flow's run history in Power Automate for why.`);
    ui.info(`What-if result: ${grant.inScope} environments in scope (${settings.scopeMode} scope mode), ${grant.missing} without the knowledge sweep app user.`);
    const ask = grant.missing
      ? `Add the knowledge sweep as an application user with System Administrator in those ${grant.missing} environments (at most ${settings.maxGrants} a run), and in new ones weekly?`
      : 'Every environment in scope has it already. Let the weekly run add it, with System Administrator, to environments that come into scope later?';
    const approved = o.approveGrants || (await ui.confirm(ask, false));
    if (!approved) {
      grant.declinedAt = c.now().toISOString();
      save();
      ui.warn('Declined. The grant flow stays in what-if mode: it only reports, and the sweep reads only environments that already have the app user.');
      notes.push(`To approve the grants later, run ${commandLine('install --approve-grants')}.`);
      return;
    }
    if (await dv.setEnvVar('poc_AU_WhatIf', 'false')) await dv.restartFlow(GRANT_FLOW_ID);
    grant.approvedAt = c.now().toISOString();
    delete grant.declinedAt;
    save();
    try {
      await startFlow(GRANT_FLOW_ID);
      ui.ok('Approved. The grant flow is running for real now, and weekly after that.');
    } catch (err) {
      ui.ok('Approved. The grant flow runs for real at its next weekly run.');
      ui.note(`Couldn't start it now (${message(err)}); select Run on it in Power Automate to grant today.`);
    }
    if (grant.missing > settings.maxGrants) ui.note(`It adds at most ${settings.maxGrants} a run, so it takes ${Math.ceil(grant.missing / settings.maxGrants)} runs to reach them all.`);
  }

  /** @type {Record<string, { needs?: string[], run: () => Promise<void> }>} */
  const impl = {
    'audit-app': {
      run: async () => {
        const { graphSpId, roleIds } = await graphAuditRole(apis.graph);
        const app = await ensureApp(apis.graph, { key: 'audit', ...(record.auditApp ? { existing: record.auditApp } : {}), requiredResourceAccess: auditResourceAccess(roleIds) });
        record.auditApp = app;
        save();
        ui.ok(`Using the app registration "${app.displayName}"`);
        const consent = await grantAuditConsent(apis.graph, { tenantId, app, graphSpId, roleIds });
        app.consented = consent.consented;
        if (consent.consented) {
          clearHandOff(record, 'audit-consent');
          ui.ok(`Admin consent is granted for ${AUDIT_PERMISSIONS.join(' and ')}`);
        } else {
          addHandOff(record, consent.handOff);
          ui.warn('You can\'t grant admin consent. The link for a Global Administrator is in the next steps; the SharePoint agent flows fail until it\'s granted.');
        }
        save();
      },
    },
    'sweep-app': {
      run: async () => {
        const app = await ensureApp(apis.graph, { key: 'sweep', ...(record.sweepApp ? { existing: record.sweepApp } : {}) });
        record.sweepApp = app;
        save();
        ui.ok(`Using the app registration "${app.displayName}"`);
        const r = await registerAdminApp(apis.bap, app.appId);
        app.adminApp = r.registered;
        if (r.registered) {
          clearHandOff(record, 'admin-app');
          ui.ok('Registered it as a Power Platform admin management application');
        } else {
          addHandOff(record, r.handOff);
          ui.warn('You can\'t register admin management applications. The command for a Power Platform Administrator is in the next steps.');
        }
        save();
      },
    },
    'root-reader': {
      needs: ['sweep-app'],
      run: async () => {
        const app = /** @type {import('./config.js').AppRegistration} */ (record.sweepApp);
        if (app.rootReaderId) {
          ui.ok('The knowledge sweep has Reader at the tenant root already');
          return;
        }
        const ok = o.approveRootReader || (await ui.confirm('Give the knowledge sweep app Reader at the tenant root management group? (Decline to use Dataverse scope mode, which needs no Azure role.)', false));
        if (!ok) {
          settings.scopeMode = 'Dataverse';
          record.options.scopeMode = 'Dataverse';
          save();
          ui.warn('Declined: the knowledge sweep uses Dataverse scope mode instead. It finds environments through Dataverse rather than Resource Graph.');
          return;
        }
        const r = await assignRootReader(apis.arm, { tenantId, app });
        if (r.assigned) {
          app.rootReaderId = r.id;
          clearHandOff(record, 'root-reader');
          ui.ok('Gave the knowledge sweep Reader at the tenant root management group');
        } else {
          addHandOff(record, r.handOff);
          ui.warn('You can\'t assign roles at the tenant root. The command for someone who can is in the next steps.');
        }
        save();
      },
    },
    connection: {
      run: async () => {
        const again = commandLine('install');
        try {
          const conn = await ensureDataverseConnection(apis.powerapps, { environmentId: env.id, userOid: c.user.id, ...((o.connectionId ?? record.connection?.id) ? { connectionId: o.connectionId ?? record.connection?.id } : {}) });
          const created = conn.created || (!!record.connection?.created && record.connection.id === conn.id);
          record.connection = { id: conn.id, created, status: conn.status };
          save();
          if (conn.status === 'Connected' || (o.connectionId && conn.status === 'Unknown')) {
            connectionId = conn.id;
            clearHandOff(record, 'connection');
            save();
            ui.ok(`${conn.created ? 'Created' : 'Using'} the Dataverse connection ${conn.id}`);
            return;
          }
          ui.warn(`The Dataverse connection ${conn.id} isn't signed in yet (${conn.status}).`);
        } catch (err) {
          ui.warn(`Couldn't make a Dataverse connection from here: ${message(err)}`);
        }
        addHandOff(record, { id: 'connection', who: 'You', what: `Make a Microsoft Dataverse connection in ${env.name} for the flows. ${connectionInstructions(env.name, again).join(' ')}` });
        save();
        throw new Error('No working Dataverse connection: the solutions still import, but their flows stay off until you run the installer again with one.');
      },
    },
    'solution-sharepoint': { needs: ['audit-app'], run: () => solutionStep('sharepoint') },
    'lane-d-tables': {
      run: async () => {
        const made = await provisionLaneD(dv.client, { log: { ok: ui.ok, warn: ui.warn, info: ui.note }, sleep: c.sleep });
        record.tablesProvisioned = true;
        save();
        ui.ok(made.length ? `Lane D tables ready (${made.length} changes)` : 'The lane D tables are already there');
      },
    },
    'solution-appusers': { needs: ['sweep-app'], run: () => solutionStep('appusers') },
    'appuser-grant': { needs: ['solution-appusers', 'connection'], run: grantStep },
    'solution-sweep': { needs: ['sweep-app', 'lane-d-tables'], run: () => solutionStep('sweep') },
    flows: {
      needs: ['connection'],
      run: async () => {
        let bad = 0;
        for (const def of selected(settings)) {
          if (!(await dv.solutionVersion(def.uniqueName))) continue;
          for (const f of def.flows) {
            try {
              const r = await flowOn(def, f);
              if (r === 'missing') {
                ui.warn(`"${f.name}" isn't in the environment`);
                bad++;
                continue;
              }
              ui.ok(`${f.name}: ${r === 'turned-on' ? 'turned on' : r === 'restarted' ? 'turned off and on, for its new settings' : 'on'}`);
              if (f.runNow && (r === 'turned-on' || imported.has(def.key))) {
                try {
                  await startFlow(f.id);
                  ui.note('Started its first run');
                } catch (err) {
                  ui.note(`Couldn't start it now (${message(err)}); it runs on its schedule.`);
                }
              }
            } catch (err) {
              ui.fail(`Couldn't turn on "${f.name}": ${message(err)}`);
              bad++;
            }
          }
        }
        if (bad) throw new Error(`${bad} flows aren't on.`);
      },
    },
    verify: {
      run: async () => {
        for (const r of await verifyLanes(dv, { sharePoint: settings.sharePoint })) {
          const text = `Lane ${r.lane}, ${r.name}: ${r.detail}`;
          if (r.state === 'ok') ui.ok(text);
          else if (r.state === 'failed') ui.fail(text);
          else if (r.state === 'pending') ui.info(text);
          else ui.warn(text);
        }
      },
    },
    app: {
      run: async () => {
        const why = whyNot({ ...(d.nodeVersion ? { nodeVersion: d.nodeVersion } : {}), ...(d.cliVersion ? { cliVersion: d.cliVersion } : {}) });
        if (why) {
          record.managedApp = { ...(record.managedApp ?? {}), skipped: { why, steps: [] } };
          save();
          ui.warn(why);
          appOutcome = { state: 'failed' };
          return;
        }
        const build = await ensureBuild({ dist: c.where.appDist, source: c.where.appSource, ui, ...(d.runNpm ? { runNpm: d.runNpm } : {}) });
        if (!build.ok) {
          record.managedApp = { ...(record.managedApp ?? {}), skipped: { why: build.why, steps: [] } };
          save();
          ui.warn(build.why);
          appOutcome = { state: 'failed' };
          return;
        }
        appOutcome = await deployTheApp({
          ui, record, save, run: d.runCli ?? createCli().run, dist: build.dist, workDir: c.where.workDir,
          ...(settings.viewerGroup ? { viewerGroup: settings.viewerGroup } : {}),
        });
      },
    },
    'lane-f': {
      run: async () => {
        const r = laneF(c.prereqs);
        const text = `Lane F, ${r.name}: ${r.detail}`;
        if (r.state === 'ok') ui.ok(text);
        else if (r.state === 'pending') ui.info(text);
        else ui.warn(text);
      },
    },
  };

  return {
    impl,
    notes,
    /**
     * A new secret for one app, put where its flows read it, and their flows restarted. Returns the
     * key ID of the secret it replaced.
     * @param {'audit' | 'sweep'} key
     */
    async rotate(key) {
      const old = await ensureSecret(key, { force: true });
      for (const def of SOLUTIONS.filter((s) => s.app === key)) {
        for (const f of def.flows) {
          if ((await dv.flowState(f.id)) !== 'on') continue;
          await dv.restartFlow(f.id);
          ui.ok(`Restarted "${f.name}", for the new secret`);
        }
      }
      return old;
    },
    get appOutcome() {
      return appOutcome;
    },
    /**
     * Runs the plan's steps in order. A step that fails stops only the steps that need it.
     * @param {import('./plan.js').Plan} plan
     * @returns {Promise<string[]>}  The steps that failed, or couldn't run.
     */
    async steps(plan) {
      /** @type {string[]} */
      const failed = [];
      for (const [i, step] of plan.steps.entries()) {
        const it = impl[step.id];
        if (!it) continue;
        ui.step(i + 1, plan.steps.length, step.title);
        if (step.state === 'skip' && !(step.id === 'root-reader' && settings.scopeMode === 'Agents')) {
          ui.note('Skipped.');
          continue;
        }
        if (step.id === 'root-reader' && settings.scopeMode !== 'Agents') {
          ui.note('Skipped: Dataverse scope mode needs no Azure role.');
          continue;
        }
        const blocked = (it.needs ?? []).filter((n) => failed.includes(n) && n !== 'connection');
        if (blocked.length) {
          ui.warn(`Skipped: it needs ${blocked.map((b) => plan.steps.find((s) => s.id === b)?.title ?? b).join(' and ')}, which didn't finish.`);
          failed.push(step.id);
          continue;
        }
        if ((it.needs ?? []).includes('connection') && failed.includes('connection')) {
          ui.warn('Skipped until the Dataverse connection works.');
          failed.push(step.id);
          continue;
        }
        try {
          await it.run();
        } catch (err) {
          ui.fail(message(err));
          failed.push(step.id);
        }
      }
      return failed;
    },
  };
}

/**
 * The summary: what's left, for whom.
 * @param {import('./ui.js').Ui} ui
 * @param {import('./config.js').InstallRecord} record
 * @param {string[]} failed
 * @param {{ notes: string[], appOutcome?: import('./managed-app/flow.js').DeployOutcome }} run
 */
function finish(ui, record, failed, run) {
  ui.heading(failed.length || record.handoffs.length ? 'Done, with steps left' : 'Done');
  if (record.managedApp?.url) ui.ok(`The app: ${record.managedApp.url}`);
  const again = commandLine('install');
  /** @type {import('./plan.js').NextStep[]} */
  const next = handOffSteps(record.handoffs, again);
  for (const k of /** @type {('createApps' | 'externalArtifacts')[]} */ (record.managedApp?.missing ?? [])) {
    const s = ADMIN_STEPS[k];
    next.push({ title: `Turn on a Managed Apps setting`, who: s.who, why: s.what, link: s.link, linkText: 'How', steps: [`Then run ${commandLine('deploy-app')}.`] });
  }
  if (record.managedApp?.skipped) next.push({ title: 'Deploy the app', who: 'You', why: record.managedApp.skipped.why, steps: [...record.managedApp.skipped.steps, `Then run ${commandLine('deploy-app')}.`] });
  for (const n of run.notes) next.push({ title: n.split('. ')[0].replace(/\.$/, ''), who: 'You', why: n });
  if (next.length) ui.nextSteps(`${next.length} step${next.length === 1 ? '' : 's'} left`, next);
  if (failed.length) {
    ui.warn(`Steps that didn't finish: ${failed.join(', ')}. Fix what's above, then run ${again}: it picks up where it stopped.`);
    return 1;
  }
  ui.note('Every viewer needs Power Apps Premium or Copilot Credits, and their own rights to the data each tab reads.');
  return 0;
}

/**
 * Prints the plan from the record and flags, without signing in.
 * @param {Options} o
 * @param {Deps} d
 */
export async function preview(o, d) {
  const { record } = openRecord(o, d);
  const where = paths(o, d);
  const settings = resolveSettings(o, record);
  /** @type {Record<string, string>} */
  let zipVersions = {};
  try {
    zipVersions = Object.fromEntries(Object.entries(loadZips(where.solutions, d)).map(([k, z]) => [k, z.version]));
  } catch (err) {
    d.ui.warn(message(err));
  }
  const appHash = !o.skipApp && existsSync(join(where.appDist, 'index.html')) ? buildHash(where.appDist) : undefined;
  const plan = buildPlan({
    record,
    scopeMode: settings.scopeMode,
    secretMode: settings.secretMode,
    ...(settings.keyVault ? { keyVault: settings.keyVault } : {}),
    ...(settings.viewerGroup ? { viewerGroup: settings.viewerGroup } : {}),
    maxGrants: settings.maxGrants,
    skipApp: !!o.skipApp,
    ...(o.connectionId ? { connectionId: o.connectionId } : {}),
    zipVersions,
    ...(appHash ? { appHash } : {}),
    sharePoint: settings.sharePoint,
  });
  d.ui.plan(plan);
  d.ui.note('Offline: what\'s already in the environment is read from the install record. install reads the environment itself, and asks before it changes anything.');
  if (o.savePlan) {
    (d.writeFile ?? ((p, t) => writeFileSync(p, t, 'utf8')))(o.savePlan, planMarkdown(plan, { now: (d.now ?? (() => new Date()))() }));
    d.ui.ok(`Saved the plan to ${o.savePlan}`);
  }
  return 0;
}

/**
 * Only the prerequisite checks.
 * @param {Options} o
 * @param {Deps} d
 */
export async function prereqsCommand(o, d) {
  const { record } = openRecord(o, d);
  d.ui.heading('Sign in');
  const { apis, user } = await connect(o, d, record);
  d.ui.heading('Prerequisites');
  const settings = resolveSettings(o, record);
  const items = await checkPrereqs({ api: prereqApi(apis), user, scopeMode: settings.scopeMode, withApp: !o.skipApp, sharePoint: settings.sharePoint, ...(d.nodeVersion ? { nodeVersion: d.nodeVersion } : {}) });
  d.ui.prereqs(items);
  return items.some((p) => p.status === 'missing' && !p.optional) ? 1 : 0;
}

/**
 * What the record says was installed, without signing in.
 * @param {Options} o
 * @param {Deps} d
 */
export async function status(o, d) {
  const { ui } = d;
  const { record, path, existed } = openRecord(o, d);
  if (!existed) {
    ui.info(`No install record at ${path}. Run ${commandLine('install')}, or pass --config.`);
    return 1;
  }
  ui.heading('AI-Monitor install');
  ui.info(`Record: ${path}${record.updatedAt ? ` (updated ${record.updatedAt.slice(0, 16).replace('T', ' ')})` : ''}`);
  if (record.uninstalledAt) ui.warn(`Uninstalled ${record.uninstalledAt.slice(0, 10)}; what's below was left behind on purpose.`);
  if (record.environment) ui.info(`Landing environment: ${record.environment.name ?? record.environment.id} (${record.environment.url})`);
  ui.info(`Scope mode ${record.options.scopeMode ?? 'Agents'}; secrets in ${record.options.secretMode === 'keyvault' ? `Key Vault ${record.options.keyVault?.name}` : 'environment variables'}`);
  const sharePoint = record.options.sharePoint ?? true;
  if (!sharePoint) ui.info('Lane E (SharePoint agents): left out');
  for (const key of /** @type {const} */ (['audit', 'sweep'])) {
    const app = key === 'audit' ? record.auditApp : record.sweepApp;
    if (!app && key === 'audit' && !sharePoint) continue;
    if (!app) ui.warn(`${APPS[key].displayName}: not made yet`);
    else ui.ok(`${app.displayName}: ${app.appId}${app.secretExpires ? `, secret valid until ${app.secretExpires.slice(0, 10)}` : ''}${key === 'audit' && !app.consented ? ', no admin consent yet' : ''}${key === 'sweep' && !app.adminApp ? ', not an admin management app yet' : ''}`);
  }
  for (const def of selected({ sharePoint })) {
    const s = record.solutions[def.key];
    if (s) ui.ok(`Lane ${def.lane}: ${def.uniqueName} ${s.version}, imported ${s.importedAt.slice(0, 10)}`);
    else ui.warn(`Lane ${def.lane}: ${def.uniqueName} not imported by the installer`);
  }
  if (record.tablesProvisioned) ui.ok('Lane D tables made');
  const grant = record.appUserGrant;
  if (grant?.approvedAt) ui.ok(`App user grants approved ${grant.approvedAt.slice(0, 10)}`);
  else if (grant?.whatIfAt) ui.info(`App user grants: what-if only${grant.missing !== undefined ? ` (${grant.missing} of ${grant.inScope} environments missing)` : ''}`);
  const app = record.managedApp;
  if (app?.url) ui.ok(`The app: ${app.url}${app.deployedAt ? ` (deployed ${app.deployedAt.slice(0, 10)})` : ''}`);
  else ui.warn('The app isn\'t deployed yet');
  const secretsSoon = [record.auditApp, record.sweepApp].filter((a) => a?.secretExpires && Date.parse(a.secretExpires) - Date.now() < 30 * 86_400_000);
  for (const a of secretsSoon) ui.warn(`${a?.displayName}'s secret expires ${a?.secretExpires?.slice(0, 10)}. Run ${commandLine('rotate-secret')}.`);
  if (record.handoffs.length) ui.nextSteps(`${record.handoffs.length} hand-off${record.handoffs.length === 1 ? '' : 's'} waiting`, handOffSteps(record.handoffs, commandLine('install')));
  return 0;
}

/**
 * Checks the install in the environment: solutions, flows and the run tables. Changes nothing.
 * @param {Options} o
 * @param {Deps} d
 */
export async function check(o, d) {
  const { ui } = d;
  const { record, existed, path } = openRecord(o, d);
  if (!existed || !record.environment) {
    ui.info(`No install record at ${path}. Run ${commandLine('install')} first, or pass --config.`);
    return 1;
  }
  ui.heading('Sign in');
  const { apis, user } = await connect(o, d, record);
  const dv = apis.dataverse(record.environment.url);
  const sharePoint = record.options.sharePoint ?? true;
  let bad = 0;
  ui.heading(`Solutions in ${record.environment.name ?? record.environment.id}`);
  for (const def of selected({ sharePoint })) {
    const v = await dv.solutionVersion(def.uniqueName);
    if (v) ui.ok(`${def.uniqueName} ${v.version}`);
    else {
      ui.fail(`${def.uniqueName} isn't installed`);
      bad++;
    }
    if (!v) continue;
    for (const f of def.flows) {
      const s = await dv.flowState(f.id);
      if (s === 'on') ui.ok(`  ${f.name}: on`);
      else {
        ui.warn(`  ${f.name}: ${s ?? 'missing'}`);
        bad++;
      }
    }
  }
  ui.heading('Run tables');
  for (const r of await verifyLanes(dv, { sharePoint })) {
    const text = `Lane ${r.lane}, ${r.name}: ${r.detail}`;
    if (r.state === 'ok') ui.ok(text);
    else if (r.state === 'pending') ui.info(text);
    else {
      (r.state === 'failed' ? ui.fail : ui.warn)(text);
      bad++;
    }
  }
  const prereqs = await checkPrereqs({ api: prereqApi(apis), user, scopeMode: record.options.scopeMode ?? 'Agents', withApp: false, sharePoint, ...(d.nodeVersion ? { nodeVersion: d.nodeVersion } : {}) });
  const f = laneF(prereqs);
  (f.state === 'ok' ? ui.ok : ui.warn)(`Lane F, ${f.name}: ${f.detail}`);
  if (record.managedApp?.url) ui.ok(`The app: ${record.managedApp.url}`);
  return bad ? 1 : 0;
}

/**
 * Deploys the app on its own: after a Managed Apps setting was turned on, or to ship a new build.
 * @param {Options} o
 * @param {Deps} d
 */
export async function deployApp(o, d) {
  const { ui } = d;
  const { record, save, existed, path } = openRecord(o, d);
  const where = paths(o, d);
  if (!existed || !record.environment) {
    if (!o.environment) {
      ui.info(`No install record at ${path}. Run ${commandLine('install')} first, or pass --environment.`);
      return 1;
    }
    ui.heading('Sign in');
    const { apis, user, tenantId } = await connect(o, d, record);
    const env = await pickEnvironment(apis, o, record, ui);
    record.tenantId = tenantId;
    record.user = { upn: user.upn, oid: user.id };
    record.environment = { id: env.id, name: env.name, url: env.url };
    save();
  }
  const settings = resolveSettings(o, record);
  const why = whyNot({ ...(d.nodeVersion ? { nodeVersion: d.nodeVersion } : {}), ...(d.cliVersion ? { cliVersion: d.cliVersion } : {}) });
  if (why) {
    ui.fail(why);
    return 1;
  }
  ui.heading('Deploy the app');
  const build = await ensureBuild({ dist: where.appDist, source: where.appSource, ui, ...(d.runNpm ? { runNpm: d.runNpm } : {}) });
  if (!build.ok) {
    ui.fail(build.why);
    return 1;
  }
  if (settings.viewerGroup) record.options.viewerGroup = settings.viewerGroup;
  const r = await deployTheApp({ ui, record, save, run: d.runCli ?? createCli().run, dist: build.dist, workDir: where.workDir, ...(settings.viewerGroup ? { viewerGroup: settings.viewerGroup } : {}) });
  if (r.state === 'not-ready') ui.info(`When the setting is on, run ${commandLine('deploy-app')} again.`);
  return r.state === 'current' || r.state === 'deployed' ? 0 : 1;
}

/**
 * Shares the app with more people or groups.
 * @param {Options} o
 * @param {Deps} d
 */
export async function access(o, d) {
  const { ui } = d;
  const { record, save } = openRecord(o, d);
  if (!record.managedApp?.appId) {
    ui.fail(`The app isn't deployed yet. Run ${commandLine('deploy-app')} first.`);
    return 1;
  }
  let principals = [...(o.share ?? []), ...(o.viewerGroup ? [o.viewerGroup] : [])];
  if (!principals.length) {
    const answer = await ui.input('Share the app with (emails or Entra object IDs, comma-separated)', {
      validate: (v) => (v.split(',').some((x) => x.trim()) ? true : 'Give at least one'),
    });
    principals = answer.split(',').map((x) => x.trim()).filter(Boolean);
  }
  const why = whyNot({ ...(d.nodeVersion ? { nodeVersion: d.nodeVersion } : {}), ...(d.cliVersion ? { cliVersion: d.cliVersion } : {}) });
  if (why) {
    ui.fail(why);
    return 1;
  }
  const r = await shareTheApp({ ui, record, save, run: d.runCli ?? createCli().run, workDir: paths(o, d).workDir, principals });
  if (!r.ok) {
    ui.fail(r.problem.message ?? r.problem.what);
    return 1;
  }
  ui.note('Sharing gives them the app. Each viewer still needs a licence and their own rights to the data behind each tab.');
  return 0;
}

/**
 * Makes a new client secret for each app, puts it where the flows read it, and restarts their flows.
 * @param {Options} o
 * @param {Deps} d
 */
export async function rotateSecret(o, d) {
  const { ui } = d;
  const { record, save, existed, path } = openRecord(o, d);
  if (!existed || !record.environment) {
    ui.info(`No install record at ${path}. Run ${commandLine('install')} first, or pass --config.`);
    return 1;
  }
  const settings = resolveSettings(o, record);
  const keys = /** @type {('audit' | 'sweep')[]} */ (o.app ? [o.app] : ['audit', 'sweep']).filter((k) => (k === 'audit' ? record.auditApp : record.sweepApp));
  if (!keys.length) {
    ui.info('There\'s no app registration in the record to rotate.');
    return 1;
  }
  if (!(await ui.confirm(`Make a new client secret for ${keys.map((k) => `"${APPS[k].displayName}"`).join(' and ')}, put it ${settings.secretMode === 'keyvault' ? `in Key Vault ${settings.keyVault}` : 'into the flows\' variables'}, and restart their flows?`, true))) return 0;
  ui.heading('Sign in');
  const { apis, user, tenantId } = await connect(o, d, record);
  const env = record.environment;
  const dv = apis.dataverse(env.url);
  const vault = settings.secretMode === 'keyvault' && record.options.keyVault ? record.options.keyVault : undefined;
  const run = createRun({
    o, d, ui, apis, dv, record, save, settings, vault, tenantId, user, env: { id: env.id, name: env.name ?? env.id, url: env.url },
    zips: {}, where: paths(o, d), prereqs: [], now: d.now ?? (() => new Date()), sleep: d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  });
  ui.heading('New secrets');
  let failed = 0;
  for (const key of keys) {
    try {
      const old = await run.rotate(key);
      const app = /** @type {import('./config.js').AppRegistration} */ (key === 'audit' ? record.auditApp : record.sweepApp);
      if (old && o.removeOld) {
        await removeSecret(apis.graph, app, old);
        ui.ok(`Removed the old secret from "${app.displayName}"`);
      } else if (old) ui.note(`The old secret still works until it expires. Pass --remove-old to remove it once the flows have run with the new one.`);
    } catch (err) {
      ui.fail(`${APPS[key].displayName}: ${message(err)}`);
      failed++;
    }
  }
  return failed ? 1 : 0;
}

/**
 * Removes what the record says the installer made, after a confirmation. Tables and their rows stay
 * unless --delete-data.
 * @param {Options} o
 * @param {Deps} d
 */
export async function uninstall(o, d) {
  const { ui } = d;
  const { record, save, existed, path } = openRecord(o, d);
  if (!existed) {
    ui.info(`No install record at ${path}, so there's nothing the installer knows it made.`);
    return 1;
  }
  const where = paths(o, d);
  const dataDefs = SOLUTIONS.filter((s) => s.holdsData && record.solutions[s.key]);
  const plainDefs = SOLUTIONS.filter((s) => !s.holdsData && record.solutions[s.key]);
  /** @type {string[]} */
  const lines = [];
  if (record.managedApp?.appId) lines.push('Deletes the app.');
  if (Object.keys(record.flows).length) lines.push(`Turns off ${Object.keys(record.flows).length} flows.`);
  if (plainDefs.length) lines.push(`Deletes the solutions ${plainDefs.map((s) => s.uniqueName).join(', ')}.`);
  const tables = record.tablesProvisioned ? ['the lane D tables'] : [];
  if (dataDefs.length || tables.length) {
    lines.push(o.deleteData
      ? `Deletes ${[...dataDefs.map((s) => s.uniqueName), ...tables].join(', ')}, and every row in their tables (--delete-data).`
      : `Keeps ${[...dataDefs.map((s) => s.uniqueName), ...tables].join(', ')} and their data (add --delete-data to delete them).`);
  }
  if (record.sweepApp?.rootReaderId) lines.push('Removes the knowledge sweep\'s Reader role at the tenant root.');
  if (record.sweepApp?.adminApp) lines.push('Unregisters the knowledge sweep as a Power Platform admin management application.');
  for (const a of [record.auditApp, record.sweepApp]) if (a?.created) lines.push(`Deletes the app registration "${a.displayName}"${a === record.sweepApp ? ', which ends its access in every environment' : ''}.`);
  if (record.connection?.created) lines.push('Deletes the Dataverse connection it made.');
  if (record.options.secretMode === 'keyvault') lines.push(`Leaves the secrets in Key Vault ${record.options.keyVault?.name}: delete them there if you want.`);
  ui.heading('Uninstall');
  for (const l of lines) ui.info(`- ${l}`);
  if (record.appUserGrant?.approvedAt) ui.note('The application users the grant flow added stay in each environment; deleting the knowledge sweep app registration ends their access.');
  if (!(await ui.confirm('Uninstall?', ui.yes))) {
    ui.info('Nothing was changed.');
    return 0;
  }

  let failed = 0;
  /** @param {string} what @param {() => Promise<unknown>} fn */
  const attempt = async (what, fn) => {
    try {
      await fn();
    } catch (err) {
      ui.fail(`${what}: ${message(err)}`);
      failed++;
    }
  };

  if (record.managedApp?.appId) {
    const why = whyNot({ ...(d.nodeVersion ? { nodeVersion: d.nodeVersion } : {}), ...(d.cliVersion ? { cliVersion: d.cliVersion } : {}) });
    if (why) {
      ui.fail(`Couldn't delete the app: ${why}`);
      failed++;
    } else if (!(await removeTheApp({ ui, record, save, run: d.runCli ?? createCli().run, workDir: where.workDir }))) failed++;
  }

  ui.heading('Sign in');
  const { apis } = await connect(o, d, record);
  const env = record.environment;
  if (env) {
    const dv = apis.dataverse(env.url);
    for (const id of Object.keys(record.flows)) {
      await attempt(`Turning off flow ${id}`, async () => {
        if ((await dv.flowState(id)) === 'on') await dv.setFlowState(id, false);
        delete record.flows[id];
        save();
      });
    }
    ui.ok('Turned the flows off');
    const order = [...plainDefs].reverse().concat(o.deleteData ? [...dataDefs].reverse() : []);
    for (const def of order) {
      await attempt(`Deleting ${def.uniqueName}`, async () => {
        const gone = await dv.deleteSolution(def.uniqueName);
        delete record.solutions[def.key];
        save();
        ui.ok(gone ? `Deleted ${def.uniqueName}` : `${def.uniqueName} was already gone`);
      });
    }
    if (o.deleteData && record.tablesProvisioned) {
      await attempt('Deleting the lane D tables', async () => {
        for (const t of [...LANE_D_TABLES].reverse()) {
          if (await dv.deleteTable(logicalName(t))) ui.ok(`Deleted ${logicalName(t)}`);
        }
        delete record.tablesProvisioned;
        save();
      });
    }
    if (record.connection?.created) {
      const conn = record.connection;
      await attempt('Deleting the Dataverse connection', async () => {
        await deleteConnection(apis.powerapps, { environmentId: env.id, connectionId: conn.id });
        delete record.connection;
        save();
        ui.ok('Deleted the Dataverse connection');
      });
    }
  }
  const sweep = record.sweepApp;
  if (sweep?.rootReaderId) {
    await attempt('Removing Reader at the tenant root', async () => {
      await removeRoleAssignment(apis.arm, /** @type {string} */ (sweep.rootReaderId));
      delete sweep.rootReaderId;
      save();
      ui.ok('Removed the knowledge sweep\'s Reader role at the tenant root');
    });
  }
  if (sweep?.adminApp) {
    await attempt('Unregistering the admin management application', async () => {
      await unregisterAdminApp(apis.bap, sweep.appId);
      sweep.adminApp = false;
      save();
      ui.ok('Unregistered the knowledge sweep as an admin management application');
    });
  }
  for (const key of /** @type {const} */ (['audit', 'sweep'])) {
    const app = key === 'audit' ? record.auditApp : record.sweepApp;
    if (!app?.created) continue;
    await attempt(`Deleting "${app.displayName}"`, async () => {
      await deleteApp(apis.graph, app);
      if (key === 'audit') delete record.auditApp;
      else delete record.sweepApp;
      save();
      ui.ok(`Deleted the app registration "${app.displayName}" (it stays in Deleted applications for 30 days)`);
    });
  }

  const leftData = SOLUTIONS.some((s) => record.solutions[s.key]) || record.tablesProvisioned;
  if (failed) {
    ui.warn(`${failed} things weren't removed. Fix what's above and run ${commandLine('uninstall')} again.`);
    return 1;
  }
  if (leftData) {
    record.uninstalledAt = (d.now ?? (() => new Date()))().toISOString();
    record.handoffs = [];
    save();
    ui.ok(`Uninstalled. The data was kept; the record at ${path} lists it, for ${commandLine('uninstall --delete-data')}.`);
  } else {
    deleteRecord(path);
    ui.ok('Uninstalled, and removed the install record.');
  }
  return 0;
}
