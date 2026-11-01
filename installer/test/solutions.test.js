// @ts-check
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { componentParameters, DATAVERSE_CONNECTOR_ID, envVarValues, GRANT_FLOW_ID, loadSolutionZip, SOLUTIONS, solution } from '../src/solutions.js';
import { SOLUTION_DIR } from './helpers.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const AUDIT = '22222222-2222-2222-2222-222222222222';
const SWEEP = '33333333-3333-3333-3333-333333333333';
/** @type {import('../src/solutions.js').EnvInputs} */
const BASE = { tenantId: TENANT, appIds: { audit: AUDIT, sweep: SWEEP }, secretMode: 'envvar' };
const asMap = (/** @type {import('../src/solutions.js').EnvValue[]} */ values) => Object.fromEntries(values.map((v) => [v.schemaname, v.value]));

test('the solutions import in order: C, E, G, then D (app users, sweep)', () => {
  assert.deepEqual(SOLUTIONS.map((s) => s.key), ['interactions', 'sharepoint', 'workpatterns', 'appusers', 'sweep']);
  assert.deepEqual(SOLUTIONS.map((s) => s.lane), ['C', 'E', 'G', 'D', 'D']);
  assert.equal(GRANT_FLOW_ID, solution('appusers').flows[0].id);
});

test('lane C and E sign in as the audit collector, lane D as the knowledge sweep', () => {
  assert.equal(asMap(envVarValues(solution('interactions'), BASE)).poc_Audit_AppRegID, AUDIT);
  assert.equal(asMap(envVarValues(solution('sharepoint'), BASE)).poc_SP_AppRegID, AUDIT);
  assert.equal(asMap(envVarValues(solution('appusers'), BASE)).poc_AU_AppRegID, SWEEP);
  assert.equal(asMap(envVarValues(solution('sweep'), BASE)).poc_KS_AppRegID, SWEEP);
});

test('each solution gets its tenant, app ID and secret mode', () => {
  for (const def of SOLUTIONS) {
    const values = asMap(envVarValues(def, BASE));
    assert.equal(values[def.vars.tenant], TENANT, def.key);
    assert.equal(values[def.vars.usingAkv], 'false', def.key);
    assert.equal(values[def.vars.secret], undefined, `${def.key}: no secret unless a fresh one was made`);
  }
});

test('a fresh secret goes into the secret variable, marked secret', () => {
  const values = envVarValues(solution('sweep'), { ...BASE, secrets: { sweep: 'fresh-secret' } });
  const secret = values.find((v) => v.schemaname === 'poc_KS_Secret');
  assert.deepEqual(secret, { schemaname: 'poc_KS_Secret', value: 'fresh-secret', secret: true });
  assert.equal(values.find((v) => v.schemaname === 'poc_KS_KeyVaultSecret'), undefined);
});

test('Key Vault mode sets UsingAKV and the reference, never the secret', () => {
  const values = asMap(envVarValues(solution('interactions'), {
    ...BASE, secretMode: 'keyvault', secrets: { audit: 'fresh-secret' }, keyVaultRefs: { audit: '/subscriptions/x/vaults/kv/secrets/agent-inventory-audit-secret' },
  }));
  assert.equal(values.poc_Audit_UsingAKVtruefalse, 'true');
  assert.equal(values.poc_KeyVaultSecret, '/subscriptions/x/vaults/kv/secrets/agent-inventory-audit-secret');
  assert.equal(values.poc_Audit_Secret, undefined);
});

test('the interaction flow gets the reviewer email when one is given', () => {
  assert.equal(asMap(envVarValues(solution('interactions'), { ...BASE, reviewerEmail: 'reviewer@example.test' })).poc_Audit_ReviewerEmail, 'reviewer@example.test');
  assert.equal(asMap(envVarValues(solution('interactions'), BASE)).poc_Audit_ReviewerEmail, undefined);
});

test('the app-user grant starts in what-if mode, Agents scope, 25 grants', () => {
  const values = asMap(envVarValues(solution('appusers'), BASE));
  assert.equal(values.poc_AU_ScopeMode, 'Agents');
  assert.equal(values.poc_AU_WhatIf, 'true');
  assert.equal(values.poc_AU_MaxGrants, '25');
  assert.equal(values.poc_AU_ReassertAll, 'true');
  const real = asMap(envVarValues(solution('appusers'), { ...BASE, scopeMode: 'Dataverse', whatIf: false, maxGrants: 50 }));
  assert.equal(real.poc_AU_ScopeMode, 'Dataverse');
  assert.equal(real.poc_AU_WhatIf, 'false');
  assert.equal(real.poc_AU_MaxGrants, '50');
  assert.equal(asMap(envVarValues(solution('sweep'), BASE)).poc_AU_WhatIf, undefined);
});

test('a solution needs its app registration first', () => {
  assert.throws(() => envVarValues(solution('sweep'), { ...BASE, appIds: { audit: AUDIT } }), /knowledge sweep app registration first/);
});

test('component parameters bind the connection references and set the variables', () => {
  const def = solution('sharepoint');
  const params = componentParameters(def, envVarValues(def, BASE), 'conn-1');
  assert.deepEqual(params[0], {
    '@odata.type': 'Microsoft.Dynamics.CRM.connectionreference',
    connectionreferencelogicalname: 'poc_sharedcommondataserviceforapps_spagent',
    connectionid: 'conn-1',
    connectorid: DATAVERSE_CONNECTOR_ID,
  });
  assert.ok(params.slice(1).every((p) => p['@odata.type'] === 'Microsoft.Dynamics.CRM.environmentvariablevalue'));
  assert.equal(componentParameters(def, [], undefined).length, 0);
});

test('the zips in solution\\ are the solutions and versions the code expects', { skip: !existsSync(SOLUTION_DIR) && 'no solution folder' }, () => {
  for (const def of SOLUTIONS) {
    const zip = loadSolutionZip(SOLUTION_DIR, def);
    assert.equal(zip.uniqueName, def.uniqueName);
    assert.equal(zip.version, def.version, `${def.file} is ${zip.version}; update SOLUTIONS`);
    assert.equal(zip.managed, true, `${def.file} is managed`);
  }
});

test('a zip holding another solution is refused', () => {
  const def = solution('sweep');
  const other = solution('interactions');
  if (!existsSync(SOLUTION_DIR)) return;
  const wrong = loadSolutionZip(SOLUTION_DIR, other).bytes;
  assert.throws(() => loadSolutionZip(SOLUTION_DIR, def, () => wrong), /holds CopilotInteractionLogging/);
});
