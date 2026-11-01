// @ts-check
/**
 * Putting the app live in the landing environment, from its built files: sign the CLI in, copy
 * app/dist into a work folder, make the folder an app (once), add its four data sources, deploy,
 * and share it. A re-run deploys only when the build changed. When an admin setting is off, the
 * step stops with who turns it on, and the rest of the install isn't affected.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { installedVersion, MIN_NODE, nodeOk } from './cli.js';
import { ADMIN_STEPS, deployAgain, notReady } from './errors.js';
import { addDataSource, authStatus, createApp, DATA_SOURCES, deleteApp, deployApp, isGuid, login, playUrl, readAppConfig, shareApp, switchAccount, verifyShare } from './steps.js';

export const APP_NAME = 'AI-Monitor';

/** The admin settings that keep the app from going live, as people know them. */
export const NOT_READY_NAMES = {
  createApps: 'Allow app creation with the Copilot Managed Runtime CLI',
  externalArtifacts: 'External artifacts in managed apps',
};

/**
 * Where the app's work folder lives: %LOCALAPPDATA%\AI-Monitor\app, or %LOCALAPPDATA%\AgentInventory\app
 * when an install from before the rename made one there, so a re-run updates that app instead of making another.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(path: string) => boolean} [exists]
 */
export function defaultWorkDir(env = process.env, exists = existsSync) {
  const base = env.LOCALAPPDATA || join(env.HOME || homedir(), '.local', 'share');
  const dir = join(base, 'AI-Monitor', 'app');
  const legacy = join(base, 'AgentInventory', 'app');
  return !exists(dir) && exists(legacy) ? legacy : dir;
}

/**
 * A hash of every file in the build, by path and content, so a re-run deploys only a changed build.
 * @param {string} dir
 */
export function buildHash(dir) {
  const hash = createHash('sha256');
  /** @param {string} d @returns {string[]} */
  const walk = (d) => readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  for (const file of walk(dir).sort()) {
    hash.update(relative(dir, file).split(sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** @typedef {(args: string[], cwd: string) => Promise<number | null>} RunNpm */

/**
 * Runs npm with the terminal, as a person would. On Windows npm is a .cmd, which needs a shell.
 * @param {typeof nodeSpawn} [spawn]
 * @returns {RunNpm}
 */
export const npmRunner = (spawn = nodeSpawn) => (args, cwd) => new Promise((resolve) => {
  const child = spawn('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('error', () => resolve(null));
  child.on('exit', (code) => resolve(code));
});

/**
 * The app's built files: --app-dist, or app/dist. When app/dist isn't there but the app's source is,
 * it's built first (npm ci, then npm run build).
 * @param {{ dist: string, source?: string, build?: boolean, runNpm?: RunNpm, ui: import('../ui.js').Ui }} o
 * @returns {Promise<{ ok: true, dist: string } | { ok: false, why: string }>}
 */
export async function ensureBuild({ dist, source, build = true, runNpm = npmRunner(), ui }) {
  if (existsSync(join(dist, 'index.html'))) return { ok: true, dist };
  if (!build || !source || !existsSync(join(source, 'package.json'))) {
    return { ok: false, why: `The app's built files aren't at ${dist}. Use the release zip, which has them, or pass --app-dist.` };
  }
  ui.info(`Building the app in ${source} (npm ci, npm run build)...`);
  for (const args of [['ci'], ['run', 'build']]) {
    const code = await runNpm(args, source);
    if (code !== 0) return { ok: false, why: `npm ${args.join(' ')} failed in ${source}${code === null ? ': is npm installed?' : ` (exit code ${code})`}.` };
  }
  return existsSync(join(dist, 'index.html')) ? { ok: true, dist } : { ok: false, why: `The build finished but ${dist} has no index.html.` };
}

/**
 * Why the app can't be deployed from this PC, or undefined.
 * @param {{ nodeVersion?: string, cliVersion?: string }} [o]
 */
export function whyNot({ nodeVersion = process.versions.node, cliVersion = installedVersion() } = {}) {
  if (!nodeOk(nodeVersion)) return `The managed apps CLI needs Node.js ${MIN_NODE} or later, and this is ${nodeVersion}. Install Node.js 24 LTS, then run ${deployAgain()}.`;
  if (!cliVersion) return `The managed apps CLI isn't installed. Run npm ci in the installer's managed-cli folder, then run ${deployAgain()}.`;
  return undefined;
}

/**
 * @typedef {object} DeployInput
 * @property {import('../ui.js').Ui} ui
 * @property {import('../config.js').InstallRecord} record
 * @property {() => void} save
 * @property {import('./cli.js').RunCli} run
 * @property {string} dist  The built app.
 * @property {string} workDir
 * @property {string} [viewerGroup]  A group's object ID or email.
 * @property {(from: string, to: string) => void} [copy]
 *
 * @typedef {{ state: 'current' | 'deployed' | 'not-ready' | 'failed', url?: string, problem?: import('./errors.js').Problem }} DeployOutcome
 */

/**
 * @param {DeployInput} o
 * @returns {Promise<DeployOutcome>}
 */
export async function deployTheApp(o) {
  const { ui, record, save, run, workDir } = o;
  const env = record.environment;
  if (!env) throw new Error('Pick the landing environment first.');
  const app = (record.managedApp ??= {});
  const hash = buildHash(o.dist);
  const added = new Set(app.dataSources ?? []);
  const sharedOk = !o.viewerGroup || (app.sharedWith ?? []).includes(o.viewerGroup);
  if (app.appId && app.environmentId === env.id && app.buildHash === hash && DATA_SOURCES.every((d) => added.has(d)) && sharedOk) {
    ui.ok(`The app is up to date${app.url ? `: ${app.url}` : '.'}`);
    return { state: 'current', ...(app.url ? { url: app.url } : {}) };
  }

  /** @param {{ problem: import('./errors.js').Problem, result?: import('./cli.js').CliResult }} f @returns {DeployOutcome} */
  const stop = (f) => {
    const off = f.result ? notReady(f.result) : [];
    if (off.length) {
      app.missing = off;
      delete app.skipped;
      save();
      for (const k of off) ui.warn(`"${NOT_READY_NAMES[k]}" is off. ${ADMIN_STEPS[k].who}: ${ADMIN_STEPS[k].what}`);
      return { state: 'not-ready', problem: f.problem };
    }
    app.skipped = { why: f.problem.what, steps: [f.problem.message ?? '', f.problem.details ?? ''].filter(Boolean) };
    save();
    ui.fail(f.problem.message ? `${f.problem.message}` : 'The app step failed.');
    ui.info(`${f.problem.who === 'you' ? '' : `${f.problem.who}: `}${f.problem.what}`);
    if (f.problem.link) ui.note(f.problem.link);
    return { state: 'failed', problem: f.problem };
  };

  const upn = record.user?.upn;
  const auth = await authStatus(run);
  if (!auth.ok) return stop(auth);
  const same = (/** @type {string | undefined} */ a) => !!a && !!upn && a.toLowerCase() === upn.toLowerCase();
  if (!auth.signedIn || (upn && !same(auth.account))) {
    const known = auth.accounts.find(same);
    if (known) {
      const r = await switchAccount(run, known);
      if (!r.ok) return stop(r);
    } else if (ui.yes) {
      return stop({ problem: { who: 'you', what: `The managed apps CLI isn't signed in as ${upn ?? 'you'}. Run ${deployAgain()} without --yes once, to sign it in.` } });
    } else {
      ui.info('The managed apps CLI signs in separately. A browser opens: sign in with the same account.');
      const r = await login(run, { ...(upn ? { account: upn } : {}) });
      if (!r.ok) return stop(r);
    }
  }

  mkdirSync(workDir, { recursive: true });
  const target = join(workDir, 'dist');
  rmSync(target, { recursive: true, force: true });
  (o.copy ?? ((from, to) => cpSync(from, to, { recursive: true })))(o.dist, target);

  let config = readAppConfig(workDir);
  if (config && config.environmentId !== env.id) {
    return stop({ problem: { who: 'you', what: `The app's work folder (${workDir}) is for another environment. Run uninstall for that app, or delete the folder, then run ${deployAgain()}.` } });
  }
  if (!config) {
    const made = await createApp(run, { appDir: workDir, displayName: APP_NAME, environmentId: env.id });
    if (!made.ok) return stop(made);
    app.appId = made.appId;
    app.environmentId = made.environmentId;
    app.dataSources = [];
    added.clear();
    save();
    ui.ok(`Created the app in ${env.name ?? env.id}`);
  } else {
    app.appId = config.appId;
    app.environmentId = config.environmentId;
  }

  for (const connector of DATA_SOURCES) {
    if (added.has(connector)) continue;
    const r = await addDataSource(run, { appDir: workDir, connector });
    if (!r.ok) return stop(r);
    added.add(connector);
    app.dataSources = [...added];
    save();
    ui.ok(`Data source ${connector}${r.existed ? ' was already there' : ' added'}`);
  }

  if (app.buildHash !== hash || !app.url) {
    const progress = ui.progress('Deploying the app');
    progress.update('uploading');
    const d = await deployApp(run, { appDir: workDir });
    progress.done();
    if (!d.ok) return stop(d);
    for (const w of d.warnings) ui.warn(w);
    let url = d.playUrl;
    if (!url) {
      const p = await playUrl(run, { appDir: workDir });
      if (p.ok) url = p.url;
    }
    app.buildHash = hash;
    app.deployedAt = new Date().toISOString();
    if (url) app.url = url;
    delete app.missing;
    delete app.skipped;
    save();
    ui.ok(`Deployed the app${url ? `: ${url}` : ''}`);
  }

  if (o.viewerGroup && !(app.sharedWith ?? []).includes(o.viewerGroup)) {
    const s = await shareTheApp({ ui, record, save, run, workDir, principals: [o.viewerGroup] });
    if (!s.ok) return stop(s);
  }
  return { state: 'deployed', ...(app.url ? { url: app.url } : {}) };
}

/**
 * Shares the app with people or groups, and checks the groups given by object ID took.
 * @param {{ ui: import('../ui.js').Ui, record: import('../config.js').InstallRecord, save: () => void, run: import('./cli.js').RunCli, workDir: string, principals: string[] }} o
 * @returns {Promise<{ ok: true } | { ok: false, problem: import('./errors.js').Problem, result?: import('./cli.js').CliResult }>}
 */
export async function shareTheApp({ ui, record, save, run, workDir, principals }) {
  const app = (record.managedApp ??= {});
  const s = await shareApp(run, { appDir: workDir, principals });
  if (!s.ok) return s;
  for (const w of s.warnings) ui.warn(w);
  const v = await verifyShare(run, { appDir: workDir, ids: principals.filter(isGuid) });
  const missing = v.ok ? v.missing : [];
  const took = principals.filter((p) => !s.rejected.includes(p) && !missing.includes(p));
  app.sharedWith = [...new Set([...(app.sharedWith ?? []), ...took])];
  save();
  if (took.length) ui.ok(`Shared the app with ${took.join(', ')}. Each viewer still needs their own rights to the data and a licence.`);
  for (const p of principals.filter((x) => !took.includes(x))) ui.warn(`Couldn't confirm the app is shared with ${p}.`);
  return { ok: true };
}

/**
 * Deletes the app the record names. One that's already gone isn't an error.
 * @param {{ ui: import('../ui.js').Ui, record: import('../config.js').InstallRecord, save: () => void, run: import('./cli.js').RunCli, workDir: string }} o
 */
export async function removeTheApp({ ui, record, save, run, workDir }) {
  const app = record.managedApp;
  if (!app?.appId) return true;
  const r = await deleteApp(run, { appId: app.appId, ...(app.environmentId ? { environmentId: app.environmentId } : {}), ...(existsSync(workDir) ? { cwd: workDir } : {}) });
  if (!r.ok) {
    ui.fail(`Couldn't delete the app: ${r.problem.message ?? r.problem.what}`);
    return false;
  }
  ui.ok(r.existed ? 'Deleted the app' : 'The app was already gone');
  delete record.managedApp;
  rmSync(join(workDir, 'ms.config.json'), { force: true });
  save();
  return true;
}
