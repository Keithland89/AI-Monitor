// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyRecord } from '../src/config.js';
import { buildPlan, handOffSteps, pendingSteps, planMarkdown } from '../src/plan.js';

const ENV = { id: 'env-1', name: 'Landing', url: 'https://landing.example.test' };

/** @param {Partial<import('../src/plan.js').PlanInput>} [more] */
const plan = (more = {}) => buildPlan({ record: emptyRecord(), scopeMode: 'Agents', secretMode: 'envvar', maxGrants: 25, ...more });

test('the plan lists every step in order', () => {
  assert.deepEqual(plan().steps.map((s) => s.id), [
    'sign-in', 'prereqs', 'environment', 'audit-app', 'sweep-app', 'root-reader', 'connection',
    'solution-interactions', 'solution-sharepoint', 'workpatterns-table', 'solution-workpatterns', 'lane-d-tables', 'solution-appusers', 'appuser-grant', 'solution-sweep',
    'flows', 'verify', 'app', 'lane-f', 'lane-cost',
  ]);
});

test('the two broad grants ask again on their own', () => {
  const p = plan();
  assert.equal(p.steps.find((s) => s.id === 'root-reader')?.approval, true);
  assert.equal(p.steps.find((s) => s.id === 'appuser-grant')?.approval, true);
  assert.match(p.steps.find((s) => s.id === 'solution-appusers')?.title ?? '', /WhatIf|AgentAppUserProvisioning/);
  assert.ok(p.steps.find((s) => s.id === 'solution-appusers')?.changes.some((c) => /MaxGrants 25, WhatIf true/.test(c)));
});

test('Dataverse scope mode skips Reader at the tenant root', () => {
  const step = plan({ scopeMode: 'Dataverse' }).steps.find((s) => s.id === 'root-reader');
  assert.equal(step?.state, 'skip');
  assert.equal(step?.approval, undefined);
});

test('installed solutions at the zip version are done, older ones are upgrades', () => {
  const p = plan({
    environment: ENV,
    zipVersions: { interactions: '1.0.0.8', sharepoint: '1.0.0.0', appusers: '1.0.6.0', sweep: '1.0.4.0' },
    installed: { interactions: '1.0.0.8', sharepoint: undefined, appusers: '1.0.5.0', sweep: '1.0.4.1' },
  });
  const by = (/** @type {string} */ id) => p.steps.find((s) => s.id === id);
  assert.equal(by('solution-interactions')?.state, 'done');
  assert.equal(by('solution-sharepoint')?.state, undefined);
  assert.equal(by('solution-appusers')?.state, undefined);
  assert.match(by('solution-appusers')?.changes[0] ?? '', /Upgrades AgentAppUserProvisioning 1\.0\.5\.0 to 1\.0\.6\.0/);
  assert.equal(by('solution-sweep')?.state, 'done');
  assert.equal(by('environment')?.state, 'done');
});

test('offline, the record says what is installed', () => {
  const record = emptyRecord();
  record.solutions.interactions = { version: '1.0.0.8', importedAt: '2024-01-01T00:00:00Z' };
  record.tablesProvisioned = true;
  record.appUserGrant = { approvedAt: '2024-01-01T00:00:00Z' };
  record.sweepApp = { appId: 'a', objectId: 'o', displayName: 'sweep', adminApp: true, rootReaderId: 'r' };
  const p = plan({ record });
  assert.equal(p.steps.find((s) => s.id === 'solution-interactions')?.state, 'done');
  assert.equal(p.steps.find((s) => s.id === 'sweep-app')?.state, 'done');
  assert.equal(p.steps.find((s) => s.id === 'root-reader')?.state, 'done');
  assert.equal(p.steps.find((s) => s.id === 'lane-d-tables')?.state, 'done');
  const grant = p.steps.find((s) => s.id === 'appuser-grant');
  assert.equal(grant?.state, 'done');
  assert.equal(grant?.approval, undefined);
});

test('--skip-app skips the app; an unchanged build is done', () => {
  assert.equal(plan({ skipApp: true }).steps.find((s) => s.id === 'app')?.state, 'skip');
  const record = emptyRecord();
  record.managedApp = { appId: 'a', buildHash: 'h1', url: 'https://example.test/play' };
  assert.equal(plan({ record, appHash: 'h1' }).steps.find((s) => s.id === 'app')?.state, 'done');
  assert.equal(plan({ record, appHash: 'h2' }).steps.find((s) => s.id === 'app')?.state, undefined);
  assert.equal(plan({ record, appHash: 'h1', viewerGroup: 'viewers@example.test' }).steps.find((s) => s.id === 'app')?.state, undefined);
});

test('the app step names its four data sources', () => {
  const step = plan({ environment: ENV }).steps.find((s) => s.id === 'app');
  assert.ok(step?.changes.some((c) => c.includes('arm, powerplatformadminv2, wdatp, commondataserviceforapps')));
  assert.ok(step?.changes.some((c) => c.includes('Landing')));
});

test('Key Vault mode says where the secrets go', () => {
  const p = plan({ secretMode: 'keyvault', keyVault: 'kv-inventory' });
  assert.ok(p.facts.some((f) => f.value === 'Key Vault "kv-inventory"'));
  assert.ok(p.steps.find((s) => s.id === 'solution-sweep')?.changes.some((c) => /Key Vault reference/.test(c)));
});

test('pending steps leave out checks, done and skipped steps', () => {
  const ids = pendingSteps(plan({ scopeMode: 'Dataverse', signedIn: true, environment: ENV })).map((s) => s.id);
  assert.ok(!ids.includes('sign-in'));
  assert.ok(!ids.includes('verify'));
  assert.ok(!ids.includes('lane-f'));
  assert.ok(!ids.includes('lane-cost'));
  assert.ok(!ids.includes('root-reader'));
  assert.ok(ids.includes('solution-interactions'));
  assert.ok(ids.includes('appuser-grant'));
});

test('the plan saves as Markdown', () => {
  const md = planMarkdown(plan({ scopeMode: 'Dataverse' }), { now: new Date('2024-05-01T10:30:00Z') });
  assert.match(md, /^# AI-Monitor install: the plan/);
  assert.match(md, /Made 2024-05-01 10:30 UTC\./);
  assert.match(md, /## 6\. Reader at the tenant root management group \*\(skipped\)\*/);
  assert.match(md, /## 14\. Lane D: grant the knowledge sweep in each environment \*\(asks again before it runs\)\*/);
  assert.match(md, /- \*Role:\* System Administrator in the landing environment/);
  assert.equal((md.match(/^## /gm) ?? []).length, 20);
});

test('hand-offs become next steps with a message to send', () => {
  const [step] = handOffSteps([{ id: 'audit-consent', who: 'Global Administrator', what: 'Grant admin consent. Then run it again.', link: 'https://example.test/consent' }], 'ai-monitor-install');
  assert.equal(step.who, 'Global Administrator');
  assert.equal(step.title, 'Grant admin consent');
  assert.match(step.message ?? '', /https:\/\/example\.test\/consent/);
  assert.deepEqual(step.steps, ['When it\'s done, run ai-monitor-install.']);
});
