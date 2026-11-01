// @ts-check
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { main, parseCli, reportError } from '../src/cli.js';
import { fakeFetch, noSleep, quietUi, SOLUTION_DIR, workDir } from './helpers.js';

test('flags become options', () => {
  const a = parseCli(['install', '--environment', 'Landing', '--scope-mode', 'Dataverse', '--max-grants', '10', '--secret-months', '6', '--approve-grants', '--skip-app', '--yes', '--device-code']);
  assert.equal(a.command, 'install');
  assert.equal(a.options.environment, 'Landing');
  assert.equal(a.options.scopeMode, 'Dataverse');
  assert.equal(a.options.maxGrants, 10);
  assert.equal(a.options.secretMonths, 6);
  assert.equal(a.options.approveGrants, true);
  assert.equal(a.options.approveRootReader, undefined);
  assert.equal(a.options.skipApp, true);
  assert.equal(a.options.yes, true);
  assert.equal(a.options.signIn, 'device-code');

  assert.equal(parseCli([]).command, 'install');
  assert.equal(parseCli(['--use-az']).options.signIn, 'azure-cli');
  assert.deepEqual(parseCli(['access', 'viewers@example.test', 'someone@example.test']).options.share, ['viewers@example.test', 'someone@example.test']);
  assert.equal(parseCli(['rotate-secret', '--app', 'sweep']).options.app, 'sweep');
  assert.equal(parseCli(['uninstall', '--delete-data']).options.deleteData, true);
  assert.equal(parseCli(['--ui', '--no-open']).open, false);
  assert.equal(parseCli([]).options.sharePoint, undefined, 'lane E follows the record, or is on');
  assert.equal(parseCli(['--skip-sharepoint']).options.sharePoint, false);
  assert.equal(parseCli(['--sharepoint']).options.sharePoint, true);
});

test('flags that don\'t make sense are refused with a reason', () => {
  /** @type {[string[], RegExp][]} */
  const bad = [
    [['nope'], /no command called "nope"/],
    [['status', 'extra'], /doesn't take extra/],
    [['install', '--ui'], /Leave out the command/],
    [['--ui', '--yes'], /--ui and --yes/],
    [['--device-code', '--use-az'], /--device-code and --use-az/],
    [['--sharepoint', '--skip-sharepoint'], /--sharepoint and --skip-sharepoint/],
    [['--reviewer-email', 'someone@example.test'], /reviewer-email/],
    [['--scope-mode', 'All'], /Agents or Dataverse/],
    [['rotate-secret', '--app', 'other'], /audit or sweep/],
    [['install', '--app', 'audit'], /goes with rotate-secret/],
    [['install', '--delete-data'], /goes with uninstall/],
    [['--max-grants', '0'], /from 1 to 500/],
    [['--max-grants', '2.5'], /from 1 to 500/],
    [['--secret-months', '25'], /from 1 to 24/],
  ];
  for (const [argv, why] of bad) assert.throws(() => parseCli(argv), why, argv.join(' '));
  assert.throws(() => parseCli(['--unknown']));
});

test('help and version print and exit 0', async () => {
  let out = '';
  assert.equal(await main(['--help'], { write: (s) => { out += s; } }), 0);
  for (const cmd of ['install', 'update', 'status', 'check', 'deploy-app', 'access', 'rotate-secret', 'uninstall', 'prereqs', 'preview']) assert.match(out, new RegExp(`\\b${cmd}\\b`));
  out = '';
  assert.equal(await main(['--version'], { write: (s) => { out += s; } }), 0);
  assert.match(out, /^\d+\.\d+\.\d+/);
});

test('a bad flag exits 1 with one line; a cancelled prompt exits 130', async () => {
  let out = '';
  assert.equal(await main(['--max-grants', '900'], { write: (s) => { out += s; } }), 1);
  assert.match(out, /from 1 to 500/);
  out = '';
  const cancelled = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' });
  assert.equal(reportError(cancelled, false, (s) => { out += s; }), 130);
  assert.match(out, /Cancelled/);
  assert.equal(reportError(new Error('expired_token: the code expired'), false, () => {}), 1);
});

test('preview prints the plan offline and saves it as Markdown', async (t) => {
  const w = workDir('preview');
  t.after(w.cleanup);
  const { ui, text } = quietUi();
  /** @type {Record<string, string>} */
  const written = {};
  const code = await main(['preview', '--config', join(w.dir, 'record.json'), '--solutions', SOLUTION_DIR, '--skip-app', '--save-plan', join(w.dir, 'plan.md')], {
    deps: { ui, writeFile: (p, s) => { written[p] = s; }, now: () => new Date('2025-01-01T00:00:00Z') },
  });
  assert.equal(code, 0);
  assert.match(text(), /Lane D: grant the knowledge sweep/);
  assert.match(text(), /SharePointAgentLogging/);
  assert.doesNotMatch(text(), /CopilotInteractionLogging|M365UsageReports|Reports\.Read\.All/);
  const md = written[join(w.dir, 'plan.md')];
  assert.ok(md, 'the plan was saved');
  assert.match(md, /^# /m);
  assert.equal(existsSync(join(w.dir, 'record.json')), false, 'preview makes no install record');
});

test('status and update need an install record', async (t) => {
  const w = workDir('status');
  t.after(w.cleanup);
  const config = join(w.dir, 'record.json');
  const a = quietUi();
  assert.equal(await main(['status', '--config', config], { deps: { ui: a.ui } }), 1);
  assert.match(a.text(), /No install record/);
  const b = quietUi();
  assert.equal(await main(['update', '--config', config], { deps: { ui: b.ui } }), 1);
  assert.match(b.text(), /needs an install record/);

  writeFileSync(config, JSON.stringify({
    version: 1,
    tenantId: '00000000-0000-0000-0000-000000000000',
    environment: { id: 'env-test', name: 'Landing', url: 'https://org.example.test' },
    options: { scopeMode: 'Agents', secretMode: 'envvars' },
    solutions: {
      interactions: { version: '1.0.0.8', importedAt: '2024-01-01T00:00:00Z' },
      sharepoint: { version: '1.0.0.0', importedAt: '2025-01-01T00:00:00Z' },
    },
    flows: {},
    handOffs: [],
  }));
  const c = quietUi();
  assert.equal(await main(['status', '--config', config], { deps: { ui: c.ui } }), 0);
  assert.match(c.text(), /Landing environment: Landing/);
  assert.match(c.text(), /SharePointAgentLogging 1\.0\.0\.0/);
  assert.doesNotMatch(c.text(), /CopilotInteractionLogging/, 'an earlier lane C import is left alone and not listed');
});

/** @param {Record<string, unknown>} claims */
const jwt = (claims) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

test('install changes nothing when the plan is turned down', async (t) => {
  const w = workDir('declined');
  t.after(w.cleanup);
  const config = join(w.dir, 'record.json');
  const { ui, text } = quietUi();
  /** @type {string[]} */
  const asked = [];
  const declining = { ...ui, confirm: async (/** @type {string} */ q) => { asked.push(q); return false; } };
  const token = jwt({ tid: '00000000-0000-0000-0000-000000000001', oid: '00000000-0000-0000-0000-000000000002', upn: 'admin@example.test' });
  const { impl, calls } = fakeFetch([
    { method: 'GET', match: /\/me\?/, reply: () => ({ id: '00000000-0000-0000-0000-000000000002', userPrincipalName: 'admin@example.test' }) },
    {
      method: 'GET',
      match: /scopes\/admin\/environments/,
      reply: () => ({ value: [{ name: 'env-test', properties: { displayName: 'Landing', linkedEnvironmentMetadata: { instanceUrl: 'https://org.example.test/' } } }] }),
    },
    { method: 'GET', match: /./, reply: () => ({ value: [] }) },
  ]);
  const code = await main(['install', '--config', config, '--environment', 'env-test', '--solutions', SOLUTION_DIR, '--skip-app'], {
    deps: { ui: /** @type {any} */ (declining), getToken: async () => token, fetchImpl: impl, sleep: noSleep, nodeVersion: '24.11.0' },
  });
  assert.equal(code, 0, text());
  assert.deepEqual(asked, ['Go ahead with this plan?']);
  assert.match(text(), /Nothing was changed/);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`), [], 'only reads before approval');
  assert.equal(existsSync(config), false, 'no install record before approval');
});
