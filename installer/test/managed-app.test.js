// @ts-check
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createCli, MIN_NODE, nodeOk, parseJson, pinnedVersion } from '../src/managed-app/cli.js';
import { ADMIN_STEPS, explain, notReady } from '../src/managed-app/errors.js';
import { APP_NAME, buildHash, defaultWorkDir, deployTheApp, ensureBuild, removeTheApp, whyNot } from '../src/managed-app/flow.js';
import { addDataSource, createApp, DATA_SOURCES, dataSourceArgs, deployApp, initArgs } from '../src/managed-app/steps.js';
import { emptyRecord } from '../src/config.js';
import { quietUi, TEST_DIR, workDir } from './helpers.js';

const APP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENV_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * A spawn that records each call and answers with what reply() returns.
 * @param {(args: string[]) => { code?: number, stdout?: string, stderr?: string }} reply
 */
function fakeSpawn(reply) {
  /** @type {{ command: string, args: string[], options: any }[]} */
  const calls = [];
  const spawn = /** @type {any} */ ((/** @type {string} */ command, /** @type {string[]} */ args, /** @type {any} */ options) => {
    calls.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {} });
    const r = reply(args.slice(1));
    setImmediate(() => {
      if (r.stdout) child.stdout.write(r.stdout);
      if (r.stderr) child.stderr.write(r.stderr);
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', r.code ?? 0));
    });
    return child;
  });
  return { spawn, calls };
}

/**
 * A RunCli that answers from a table of command prefixes, and records the calls.
 * @param {Record<string, Partial<import('../src/managed-app/cli.js').CliResult>>} answers
 */
function fakeRun(answers) {
  /** @type {{ args: string[], options: any }[]} */
  const calls = [];
  /** @type {import('../src/managed-app/cli.js').RunCli} */
  const run = async (args, options = {}) => {
    calls.push({ args, options });
    const key = Object.keys(answers).find((k) => args.join(' ').startsWith(k));
    const a = key ? answers[key] : {};
    return { ok: true, exitCode: 0, data: {}, stdout: '', stderr: '', ...a };
  };
  return { run, calls };
}

test('the CLI runs as node Bin.js with the JSON flags, never through a shell', async () => {
  const { spawn, calls } = fakeSpawn(() => ({ stdout: '{"success":true,"appId":"x"}' }));
  const { run, bin } = createCli({ cliDir: join(TEST_DIR, 'cli'), spawn, node: 'node-exe' });
  const r = await run(['app', 'deploy'], { cwd: 'work' });
  assert.equal(r.ok, true);
  assert.equal(r.data?.appId, 'x');
  assert.equal(calls[0].command, 'node-exe');
  assert.deepEqual(calls[0].args, [bin, 'app', 'deploy', '--non-interactive', '--json', '--no-color']);
  assert.equal(calls[0].options.cwd, 'work');
  assert.equal(calls[0].options.shell, undefined);
  assert.match(bin, /managed-apps-cli[\\/]dist[\\/]Bin\.js$/);
});

test('a sign-in hands the CLI the terminal', async () => {
  const { spawn, calls } = fakeSpawn(() => ({}));
  const { run, bin } = createCli({ cliDir: 'cli', spawn, node: 'node-exe' });
  await run(['auth', 'login'], { onScreen: true });
  assert.deepEqual(calls[0].args, [bin, 'auth', 'login']);
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('a failure keeps the CLI\'s words and its exit code', async () => {
  const { spawn } = fakeSpawn(() => ({ code: 1, stdout: 'noise\n{"success":false,"errorMessage":"Environment was not found","errorData":{"serverMessage":"404"}}' }));
  const { run } = createCli({ cliDir: 'cli', spawn });
  const r = await run(['app', 'init']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.match(r.error ?? '', /Environment was not found/);
  assert.deepEqual(r.errorData, { serverMessage: '404' });
});

test('success false in the JSON is a failure even on exit 0', async () => {
  const { spawn } = fakeSpawn(() => ({ stdout: '{"success":false,"errorMessage":"nope"}' }));
  const r = await createCli({ cliDir: 'cli', spawn }).run(['app', 'share']);
  assert.equal(r.ok, false);
});

test('the JSON is found after other output', () => {
  assert.deepEqual(parseJson('progress\n{\n  "a": 1\n}\n'), { a: 1 });
  assert.deepEqual(parseJson('{"b":2}'), { b: 2 });
  assert.equal(parseJson('no json here'), undefined);
});

test('init puts the app in the landing environment', () => {
  assert.deepEqual(initArgs({ displayName: APP_NAME, environmentId: ENV_ID }), [
    'app', 'init', '--repo', 'none', '--display-name', 'Agent-Monitor', '--build-type', 'none', '--build-path', './dist', '--environment-id', ENV_ID,
  ]);
});

test('each data source is an action with SSO and no code generation', () => {
  assert.deepEqual(DATA_SOURCES, ['arm', 'powerplatformadminv2', 'wdatp', 'commondataserviceforapps']);
  for (const c of DATA_SOURCES) {
    assert.deepEqual(dataSourceArgs(c), ['app', 'add', 'data-source', '--connector', c, '--as', 'action', '--use-sso', '--skip-codegen']);
  }
});

test('createApp reads the app ID from the CLI, or from ms.config.json', async (t) => {
  const { dir, cleanup } = workDir('init');
  t.after(cleanup);
  const fromData = await createApp(fakeRun({ 'app init': { data: { appId: APP_ID, environmentId: ENV_ID } } }).run, { appDir: dir, displayName: APP_NAME, environmentId: ENV_ID });
  assert.deepEqual(fromData, { ok: true, appId: APP_ID, environmentId: ENV_ID });
  writeFileSync(join(dir, 'ms.config.json'), JSON.stringify({ appId: APP_ID, environmentId: ENV_ID }));
  const fromFile = await createApp(fakeRun({ 'app init': { data: {} } }).run, { appDir: dir, displayName: APP_NAME, environmentId: ENV_ID });
  assert.equal(fromFile.ok && fromFile.appId, APP_ID);
});

test('a data source the app already has is not an error', async () => {
  const r = await addDataSource(fakeRun({ 'app add': { ok: false, exitCode: 1, error: 'Data source arm already exists' } }).run, { appDir: '.', connector: 'arm' });
  assert.deepEqual(r, { ok: true, existed: true });
});

test('deploy returns the play link and warnings', async () => {
  const r = await deployApp(fakeRun({ 'app deploy': { data: { appPlayUri: 'https://example.test/play/app', warnings: ['slow'] } } }).run, { appDir: '.' });
  assert.deepEqual(r, { ok: true, playUrl: 'https://example.test/play/app', warnings: ['slow'] });
});

test('the admin settings that are off are told apart from other failures', () => {
  const base = { ok: false, exitCode: 1, data: undefined, stdout: '', stderr: '' };
  assert.deepEqual(notReady({ ...base, error: 'You do not have permission to create an app in this environment' }), ['createApps']);
  assert.deepEqual(notReady({ ...base, error: 'x', errorData: { errorCode: 'CodeAppOperationNotAllowedInEnvironment' } }), ['externalArtifacts']);
  assert.deepEqual(notReady({ ...base, error: 'timeout' }), []);
});

test('each failure says who fixes it', () => {
  const base = { ok: false, exitCode: 1, data: undefined, stdout: '', stderr: '' };
  assert.equal(explain('init', { ...base, error: 'AADSTS53003: blocked' }).who, 'Entra admin');
  assert.match(explain('deploy', { ...base, error: 'x', timedOut: true }).what, /took too long/);
  assert.match(explain('deploy', { ...base, exitCode: 3, error: 'not signed in' }).what, /sign-in/);
  assert.deepEqual(
    { who: explain('init', { ...base, error: 'ExternalArtifactDeploymentDisabled' }).who, what: explain('init', { ...base, error: 'ExternalArtifactDeploymentDisabled' }).what },
    { who: ADMIN_STEPS.externalArtifacts.who, what: ADMIN_STEPS.externalArtifacts.what },
  );
  assert.match(explain('init', { ...base, error: 'Environment xyz was not found' }).what, /landing environment/);
  assert.equal(explain('data-source', { ...base, error: 'Connector wdatp not found' }).who, 'Power Platform admin');
  assert.match(explain('deploy', { ...base, exitCode: 5, error: 'ENOTFOUND' }).what, /couldn't reach Microsoft/);
  assert.match(explain('deploy', { ...base, error: '429 Too Many Requests' }).what, /busy/);
  const other = explain('deploy', { ...base, error: 'Something odd', errorData: { serverMessage: 'detail' } });
  assert.equal(other.message, 'Something odd');
  assert.equal(other.details, 'detail');
});

test('the app needs Node.js 24.11 or later and the pinned CLI', () => {
  assert.equal(nodeOk('v24.11.0'), true);
  assert.equal(nodeOk('24.12.1'), true);
  assert.equal(nodeOk('22.13.0'), false);
  assert.match(whyNot({ nodeVersion: '22.13.0', cliVersion: '1.0.0' }) ?? '', new RegExp(MIN_NODE.replace(/\./g, '\\.')));
  assert.match(whyNot({ nodeVersion: '24.11.0', cliVersion: '' }) ?? '', /isn't installed/);
  assert.equal(whyNot({ nodeVersion: '24.11.0', cliVersion: '0.29.0' }), undefined);
});

test('MIN_NODE matches the pinned CLI package\'s engines', () => {
  const pkg = JSON.parse(readFileSync(join(TEST_DIR, '..', 'managed-cli', 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, `>=${MIN_NODE}`);
  assert.equal(pinnedVersion(), pkg.dependencies['@microsoft/managed-apps-cli']);
});

/** @param {string} dir */
function makeDist(dir) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

test('the build hash changes only when the build does', (t) => {
  const { dir, cleanup } = workDir('hash');
  t.after(cleanup);
  const dist = makeDist(join(dir, 'dist'));
  const a = buildHash(dist);
  assert.equal(buildHash(dist), a);
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(2)');
  assert.notEqual(buildHash(dist), a);
});

test('a missing build is built with npm ci and npm run build', async (t) => {
  const { dir, cleanup } = workDir('build');
  t.after(cleanup);
  const source = join(dir, 'app');
  mkdirSync(source);
  writeFileSync(join(source, 'package.json'), '{}');
  /** @type {string[]} */
  const ran = [];
  const r = await ensureBuild({
    dist: join(source, 'dist'),
    source,
    ui: quietUi().ui,
    runNpm: async (args, cwd) => {
      ran.push(`${args.join(' ')} @ ${cwd === source}`);
      if (args[0] === 'run') makeDist(join(source, 'dist'));
      return 0;
    },
  });
  assert.deepEqual(ran, ['ci @ true', 'run build @ true']);
  assert.equal(r.ok, true);
  const missing = await ensureBuild({ dist: join(dir, 'nowhere'), ui: quietUi().ui });
  assert.equal(missing.ok, false);
});

test('the app deploys once: init, four data sources, deploy, share; a re-run with the same build does nothing', async (t) => {
  const { dir, cleanup } = workDir('deploy');
  t.after(cleanup);
  const dist = makeDist(join(dir, 'dist'));
  const work = join(dir, 'work');
  const record = emptyRecord();
  record.environment = { id: ENV_ID, name: 'Landing', url: 'https://landing.example.test' };
  record.user = { upn: 'admin@example.test' };
  let saves = 0;
  const { run, calls } = fakeRun({
    'auth status': { data: { signedIn: true, activeAccount: { username: 'admin@example.test' }, accounts: [{ username: 'admin@example.test' }] } },
    'app init': { data: { appId: APP_ID, environmentId: ENV_ID } },
    'app deploy': { data: { appPlayUri: 'https://example.test/play/app' } },
    'app share list': { data: { results: [{ value: [{ principalObjectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] }] } },
    'app share': { data: {} },
  });
  const viewerGroup = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const first = await deployTheApp({ ui: quietUi().ui, record, save: () => { saves++; }, run, dist, workDir: work, viewerGroup });
  assert.deepEqual(first, { state: 'deployed', url: 'https://example.test/play/app' });
  assert.deepEqual(calls.map((c) => c.args.slice(0, 3).join(' ')), [
    'auth status', 'app init --repo', 'app add data-source', 'app add data-source', 'app add data-source', 'app add data-source', 'app deploy', 'app share cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'app share list',
  ]);
  assert.deepEqual(calls[1].args, initArgs({ displayName: APP_NAME, environmentId: ENV_ID }));
  assert.ok(calls.slice(1).every((c) => c.options.cwd === work));
  assert.equal(record.managedApp?.appId, APP_ID);
  assert.deepEqual(record.managedApp?.dataSources, [...DATA_SOURCES]);
  assert.deepEqual(record.managedApp?.sharedWith, [viewerGroup]);
  assert.equal(record.managedApp?.buildHash, buildHash(dist));
  assert.ok(saves > 0);
  assert.equal(readFileSync(join(work, 'dist', 'index.html'), 'utf8'), '<!doctype html>');

  const again = fakeRun({});
  const second = await deployTheApp({ ui: quietUi().ui, record, save: () => {}, run: again.run, dist, workDir: work, viewerGroup });
  assert.equal(second.state, 'current');
  assert.equal(again.calls.length, 0);
});

test('a changed build redeploys without a new init', async (t) => {
  const { dir, cleanup } = workDir('redeploy');
  t.after(cleanup);
  const dist = makeDist(join(dir, 'dist'));
  const work = join(dir, 'work');
  mkdirSync(work);
  writeFileSync(join(work, 'ms.config.json'), JSON.stringify({ appId: APP_ID, environmentId: ENV_ID }));
  const record = emptyRecord();
  record.environment = { id: ENV_ID, url: 'https://landing.example.test' };
  record.managedApp = { appId: APP_ID, environmentId: ENV_ID, buildHash: 'old', url: 'https://example.test/play/app', dataSources: [...DATA_SOURCES] };
  const { run, calls } = fakeRun({ 'auth status': { data: { signedIn: true, activeAccount: { username: 'x@example.test' } } }, 'app deploy': { data: {} }, 'app play': { data: { url: 'https://example.test/play/app2' } } });
  const r = await deployTheApp({ ui: quietUi().ui, record, save: () => {}, run, dist, workDir: work });
  assert.deepEqual(r, { state: 'deployed', url: 'https://example.test/play/app2' });
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(' ')), ['auth status', 'app deploy', 'app play']);
});

test('an admin setting that is off stops the app step as not ready, with who turns it on', async (t) => {
  const { dir, cleanup } = workDir('notready');
  t.after(cleanup);
  const dist = makeDist(join(dir, 'dist'));
  const record = emptyRecord();
  record.environment = { id: ENV_ID, url: 'https://landing.example.test' };
  const { ui, text } = quietUi();
  const { run } = fakeRun({ 'auth status': { data: { signedIn: true, activeAccount: { username: 'x@example.test' } } }, 'app init': { ok: false, exitCode: 1, error: 'ExternalArtifactDeploymentDisabled' } });
  const r = await deployTheApp({ ui, record, save: () => {}, run, dist, workDir: join(dir, 'work') });
  assert.equal(r.state, 'not-ready');
  assert.deepEqual(record.managedApp?.missing, ['externalArtifacts']);
  assert.match(text(), /External artifacts in managed apps/);
});

test('under --yes the CLI is never signed in on screen', async (t) => {
  const { dir, cleanup } = workDir('yes');
  t.after(cleanup);
  const record = emptyRecord();
  record.environment = { id: ENV_ID, url: 'https://landing.example.test' };
  const { run, calls } = fakeRun({ 'auth status': { ok: false, exitCode: 3 } });
  const r = await deployTheApp({ ui: quietUi().ui, record, save: () => {}, run, dist: makeDist(join(dir, 'dist')), workDir: join(dir, 'work') });
  assert.equal(r.state, 'failed');
  assert.ok(!calls.some((c) => c.args[1] === 'login'));
});

test('uninstall deletes the app the record names; one already gone is fine', async () => {
  const record = emptyRecord();
  record.managedApp = { appId: APP_ID, environmentId: ENV_ID };
  const { run, calls } = fakeRun({ 'app delete': { ok: false, exitCode: 6, error: 'not found' } });
  assert.equal(await removeTheApp({ ui: quietUi().ui, record, save: () => {}, run, workDir: join(TEST_DIR, '.work', 'no-such-folder') }), true);
  assert.deepEqual(calls[0].args, ['app', 'delete', '--force', '--app', APP_ID, '--environment-id', ENV_ID]);
  assert.equal(record.managedApp, undefined);
});

test('the app work folder is %LOCALAPPDATA%\\Agent-Monitor\\app, or the one an install from before the rename made', () => {
  const env = { LOCALAPPDATA: join('C:', 'Users', 'someone', 'AppData', 'Local') };
  const fresh = join(env.LOCALAPPDATA, 'Agent-Monitor', 'app');
  const legacy = join(env.LOCALAPPDATA, 'AgentInventory', 'app');
  const aiMonitor = join(env.LOCALAPPDATA, 'AI-Monitor', 'app');
  assert.equal(defaultWorkDir(env, () => false), fresh);
  assert.equal(defaultWorkDir(env, (p) => p === legacy), legacy);
  assert.equal(defaultWorkDir(env, (p) => p === aiMonitor || p === legacy), aiMonitor);
  assert.equal(defaultWorkDir(env, (p) => p === aiMonitor || p === legacy || p === fresh), fresh);
});
