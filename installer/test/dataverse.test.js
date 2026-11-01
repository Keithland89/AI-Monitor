// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDataverse } from '../src/dataverse.js';
import { createClient, HttpError } from '../src/http.js';
import { addAccess, adminConsentUrl, AUDIT_PERMISSIONS, BAP_API_VERSION, grantAuditConsent, registerAdminApp } from '../src/identity.js';
import { LANE_D_TABLES, logicalName, provisionLaneD, uniqueKeyFor } from '../src/lane-d-tables.js';
import { laneF, laneOk, verifyLanes } from '../src/verify.js';
import { fakeFetch, noSleep } from './helpers.js';

const BASE = 'https://org.example.test/api/data/v9.2';
/** @param {ReturnType<typeof fakeFetch>} f */
const client = (f, baseUrl = BASE) => createClient({ baseUrl, getToken: async () => 'token', fetchImpl: f.impl, sleep: noSleep });

test('an import posts the zip and follows the system job to success', async () => {
  let polls = 0;
  const f = fakeFetch([
    { method: 'POST', match: /\/ImportSolutionAsync$/, reply: () => ({ AsyncOperationId: 'job-1' }) },
    { match: /\/asyncoperations\(job-1\)/, reply: () => (++polls < 3 ? { statecode: 2, statuscode: 20 } : { statecode: 3, statuscode: 30 }) },
  ]);
  /** @type {string[]} */
  const seen = [];
  const dv = createDataverse(client(f), { sleep: noSleep });
  const r = await dv.importSolution({ zip: new Uint8Array([1, 2, 3]), componentParameters: [{ a: 1 }], onStatus: (s) => seen.push(s) });
  assert.deepEqual(r, { id: 'job-1' });
  const body = f.calls[0].body;
  assert.equal(body.CustomizationFile, Buffer.from([1, 2, 3]).toString('base64'));
  assert.deepEqual(body.ComponentParameters, [{ a: 1 }]);
  assert.equal(body.OverwriteUnmanagedCustomizations, false);
  assert.deepEqual(seen, ['importing', 'importing']);
});

test('an upgrade goes through StageAndUpgrade', async () => {
  const f = fakeFetch([
    { method: 'POST', match: /\/StageAndUpgradeAsync$/, reply: () => ({ AsyncOperationId: 'job-2' }) },
    { match: /\/asyncoperations\(job-2\)/, reply: () => ({ statecode: 3, statuscode: 30 }) },
  ]);
  await createDataverse(client(f), { sleep: noSleep }).importSolution({ zip: new Uint8Array([0]), componentParameters: [], upgrade: true });
  assert.match(f.calls[0].url, /StageAndUpgradeAsync$/);
});

test('a failed import says why', async () => {
  const f = fakeFetch([
    { method: 'POST', match: /\/ImportSolutionAsync$/, reply: () => ({ AsyncOperationId: 'job-3' }) },
    { match: /\/asyncoperations/, reply: () => ({ statecode: 3, statuscode: 31, friendlymessage: 'Missing dependency' }) },
  ]);
  await assert.rejects(createDataverse(client(f), { sleep: noSleep }).importSolution({ zip: new Uint8Array([0]), componentParameters: [] }), /The import failed: Missing dependency/);
});

test('an import that runs past the time limit stops waiting', async () => {
  let t = 0;
  const f = fakeFetch([
    { method: 'POST', match: /ImportSolutionAsync/, reply: () => ({ AsyncOperationId: 'j' }) },
    { match: /asyncoperations/, reply: () => ({ statecode: 1 }) },
  ]);
  const dv = createDataverse(client(f), { sleep: noSleep, now: () => (t += 60_000) });
  await assert.rejects(dv.importSolution({ zip: new Uint8Array([0]), componentParameters: [], timeoutMs: 120_000 }), /still running after 2 minutes/);
});

test('importNeeded compares the installed version with the zip', async () => {
  const f = fakeFetch([{ match: /\/solutions\?/, reply: (_b, url) => (url.includes('SharePointAgentLogging') ? { value: [{ solutionid: 's', version: '1.0.0.7', ismanaged: true }] } : { value: [] }) }]);
  const dv = createDataverse(client(f));
  assert.deepEqual(await dv.importNeeded('SharePointAgentLogging', '1.0.0.8'), { needed: true, upgrade: true, installed: '1.0.0.7' });
  assert.deepEqual(await dv.importNeeded('SharePointAgentLogging', '1.0.0.7'), { needed: false, upgrade: false, installed: '1.0.0.7' });
  assert.deepEqual(await dv.importNeeded('Other', '1.0.0.0'), { needed: true, upgrade: false });
});

test('setEnvVar patches a changed value, adds a missing one, and leaves an equal one', async () => {
  /** @type {Record<string, any>} */
  const defs = {
    poc_A: { environmentvariabledefinitionid: 'd1', environmentvariabledefinition_environmentvariablevalue: [{ environmentvariablevalueid: 'v1', value: 'old' }] },
    poc_B: { environmentvariabledefinitionid: 'd2', environmentvariabledefinition_environmentvariablevalue: [] },
    poc_C: { environmentvariabledefinitionid: 'd3', environmentvariabledefinition_environmentvariablevalue: [{ environmentvariablevalueid: 'v3', value: 'same' }] },
  };
  const f = fakeFetch([
    { method: 'GET', match: /environmentvariabledefinitions\?/, reply: (_b, url) => ({ value: [defs[/schemaname eq '([^']+)'/.exec(decodeURIComponent(url))?.[1] ?? '']].filter(Boolean) }) },
    { method: 'PATCH', match: /environmentvariablevalues\(v1\)/, reply: () => ({ status: 204 }) },
    { method: 'POST', match: /environmentvariablevalues$/, reply: () => ({ status: 204 }) },
  ]);
  const dv = createDataverse(client(f));
  assert.equal(await dv.setEnvVar('poc_A', 'new'), true);
  assert.equal(await dv.setEnvVar('poc_B', 'first'), true);
  assert.equal(await dv.setEnvVar('poc_C', 'same'), false);
  await assert.rejects(dv.setEnvVar('poc_missing', 'x'), /isn't in the environment/);
  const writes = f.calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(writes.map((c) => [c.method, c.body]), [
    ['PATCH', { value: 'new' }],
    ['POST', { schemaname: 'poc_B', value: 'first', 'EnvironmentVariableDefinitionId@odata.bind': '/environmentvariabledefinitions(d2)' }],
  ]);
});

test('restartFlow turns a running flow off and on; latestRow tells missing from empty', async () => {
  const f = fakeFetch([
    { method: 'GET', match: /workflows\(w1\)/, reply: () => ({ statecode: 1 }) },
    { method: 'PATCH', match: /workflows\(w1\)/, reply: () => ({ status: 204 }) },
    { match: /\/missing_set\?/, reply: () => ({ status: 404, body: { error: { message: 'Resource not found' } } }) },
    { match: /\/empty_set\?/, reply: () => ({ value: [] }) },
  ]);
  const dv = createDataverse(client(f));
  await dv.restartFlow('w1');
  assert.deepEqual(f.calls.filter((c) => c.method === 'PATCH').map((c) => c.body.statecode), [0, 1]);
  assert.equal(await dv.latestRow('missing_set', ['a']), undefined);
  assert.equal(await dv.latestRow('empty_set', ['a']), null);
});

test('lane D provisioning in dry-run mode only says what it would create', async () => {
  const f = fakeFetch([{ match: /EntityDefinitions/, reply: () => ({ status: 404, body: { error: { message: 'Not found' } } }) }]);
  /** @type {string[]} */
  const log = [];
  const changed = await provisionLaneD(client(f), { log: { ok: (s) => log.push(s), warn: (s) => log.push(s), info: (s) => log.push(s) }, sleep: noSleep, dryRun: true });
  assert.ok(f.calls.every((c) => c.method === 'GET'), 'a dry run writes nothing');
  for (const t of LANE_D_TABLES) assert.ok(changed.includes(`would create ${logicalName(t)}`), logicalName(t));
  assert.equal(changed.at(-1), 'would add the alternate keys and the poc_uniquekey upsert key');
});

test('lane D provisioning leaves tables that are already there', async () => {
  const f = fakeFetch([
    { method: 'GET', match: /\/Keys\?/, reply: () => ({ value: [{ SchemaName: 'poc_UniqueKey', EntityKeyIndexStatus: 'Active' }, { SchemaName: 'poc_EnvironmentId' }] }) },
    { method: 'GET', match: /EntityDefinitions/, reply: () => ({ LogicalName: 'x' }) },
    { method: 'GET', match: /poc_agentknowledgesources\?/, reply: () => ({ value: [] }) },
  ]);
  const log = { ok: () => {}, warn: () => {}, info: () => {} };
  const changed = await provisionLaneD(client(f), { log, sleep: noSleep });
  assert.ok(!changed.some((c) => c.startsWith('created')));
  assert.ok(!f.calls.some((c) => c.method === 'POST' && /\/EntityDefinitions$/.test(c.url)));
});

/**
 * A Dataverse where every table create loses its connection. `madeAnyway` says whether the server finished the table regardless.
 * @param {boolean} madeAnyway
 */
function droppedCreates(madeAnyway) {
  /** @type {Set<string>} */
  const made = new Set();
  /** @type {Set<string>} */
  const pending = new Set();
  const f = fakeFetch([
    { method: 'GET', match: /\/Keys\?/, reply: () => ({ value: [{ SchemaName: 'poc_UniqueKey', EntityKeyIndexStatus: 'Active' }, { SchemaName: 'poc_EnvironmentId' }] }) },
    {
      method: 'GET',
      match: /EntityDefinitions\(LogicalName='[^']+'\)\?/,
      reply: (_, url) => {
        const name = /LogicalName='([^']+)'/.exec(url)?.[1] ?? '';
        if (pending.has(name) && madeAnyway) made.add(name);
        return made.has(name) ? { LogicalName: name } : { status: 404, body: { error: { message: 'Not found' } } };
      },
    },
    { method: 'GET', match: /EntityDefinitions/, reply: () => ({ LogicalName: 'x' }) },
    {
      method: 'POST',
      match: /\/EntityDefinitions$/,
      reply: (body) => {
        const name = String(body.SchemaName).toLowerCase();
        if (!pending.has(name)) {
          pending.add(name);
          throw new TypeError('fetch failed');
        }
        made.add(name);
        return { status: 204 };
      },
    },
    { method: 'GET', match: /\/poc_\w+\?/, reply: () => ({ value: [] }) },
  ]);
  return f;
}

test('a table create that loses its connection is not posted again once Dataverse has made it', async () => {
  const f = droppedCreates(true);
  const log = { ok: () => {}, warn: () => {}, info: () => {} };
  await provisionLaneD(client(f), { log, sleep: noSleep });
  const posts = f.calls.filter((c) => c.method === 'POST' && /\/EntityDefinitions$/.test(c.url));
  assert.equal(posts.length, LANE_D_TABLES.length, 'one post per table');
});

test('a table create that loses its connection is posted once more if Dataverse never made it', async () => {
  const f = droppedCreates(false);
  const log = { ok: () => {}, warn: () => {}, info: () => {} };
  await provisionLaneD(client(f), { log, sleep: noSleep });
  const posts = f.calls.filter((c) => c.method === 'POST' && /\/EntityDefinitions$/.test(c.url));
  assert.equal(posts.length, LANE_D_TABLES.length * 2, 'two posts per table');
});

test('the upsert key joins the environment and the source', () => {
  assert.equal(uniqueKeyFor({ poc_agentkey: 'env-1|bot-1', poc_sourceid: 'src-1' }), 'env-1_src-1');
});

test('the run tables say ok, pending, failed or missing, and pending is not a failure', async () => {
  /** @type {Record<string, any>} */
  const rows = {
    poc_sharepointagentloggingruns: null,
    poc_knowledgesweepruns: { poc_status: 'Failed', poc_environmentsswept: 3, poc_environmentsfailed: 3, poc_rowsfound: 0, createdon: '2024-05-01T03:00:00Z' },
  };
  /** @type {string[]} */
  const read = [];
  const dv = /** @type {any} */ ({ latestRow: async (/** @type {string} */ set) => { read.push(set); return rows[set]; } });
  const out = await verifyLanes(dv);
  assert.deepEqual(out.map((r) => [r.lane, r.state]), [['E', 'pending'], ['D', 'failed']]);
  assert.match(out[0].detail, /First run pending/);
  assert.deepEqual(read, ['poc_sharepointagentloggingruns', 'poc_knowledgesweepruns'], 'no lane C or G run tables are read');
  assert.equal(laneOk('pending'), true);
  assert.equal(laneOk('failed'), false);

  assert.deepEqual((await verifyLanes(dv, { sharePoint: false })).map((r) => r.lane), ['D'], 'lane E left out');

  const missing = await verifyLanes(/** @type {any} */ ({ latestRow: async () => undefined }));
  assert.ok(missing.every((r) => r.state === 'missing'));
  const broken = await verifyLanes(/** @type {any} */ ({ latestRow: async () => { throw new Error('boom'); } }));
  assert.ok(broken.every((r) => r.state === 'warn'));
});

test('the audit collector asks only for AuditLogsQuery.Read.All, and keeps what it already has', () => {
  assert.deepEqual(AUDIT_PERMISSIONS, ['AuditLogsQuery.Read.All']);
  const graph = '00000003-0000-0000-c000-000000000000';
  const want = [{ resourceAppId: graph, resourceAccess: [{ id: 'audit-role', type: 'Role' }] }];
  const old = [{ resourceAppId: graph, resourceAccess: [{ id: 'old-role', type: 'Role' }] }];
  assert.deepEqual(addAccess(old, want), [{ resourceAppId: graph, resourceAccess: [{ id: 'old-role', type: 'Role' }, { id: 'audit-role', type: 'Role' }] }]);
  assert.equal(addAccess([{ resourceAppId: graph, resourceAccess: [{ id: 'old-role', type: 'Role' }, { id: 'audit-role', type: 'Role' }] }], want), null);
  assert.deepEqual(addAccess(undefined, want), want);
});

test('lane F is a check only', () => {
  /** @param {string} id @param {any} status */
  const p = (id, status) => ({ id, label: id, status, detail: '' });
  assert.equal(laneF(/** @type {any} */ ([p('defender', 'met'), p('security-reader', 'met')])).state, 'ok');
  assert.equal(laneF(/** @type {any} */ ([p('defender', 'missing'), p('security-reader', 'met')])).state, 'missing');
  assert.equal(laneF(/** @type {any} */ ([p('defender', 'met'), p('security-reader', 'missing')])).state, 'warn');
  assert.equal(laneF(/** @type {any} */ ([p('defender', 'unknown'), p('security-reader', 'met')])).state, 'pending');
});

test('the knowledge sweep is registered as an admin management application, or handed off', async () => {
  const ok = fakeFetch([{ method: 'PUT', match: /adminApplications/, reply: () => ({ status: 200, body: {} }) }]);
  assert.deepEqual(await registerAdminApp(client(ok, 'https://api.bap.microsoft.com'), 'client-1'), { registered: true });
  assert.equal(ok.calls[0].url, `https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/adminApplications/client-1?api-version=${BAP_API_VERSION}`);
  assert.equal(BAP_API_VERSION, '2020-10-01');

  const no = fakeFetch([{ method: 'PUT', match: /adminApplications/, reply: () => ({ status: 403, body: { error: { code: 'Forbidden', message: 'no' } } }) }]);
  const r = await registerAdminApp(client(no, 'https://api.bap.microsoft.com'), 'client-1');
  assert.equal(r.registered, false);
  assert.match(!r.registered ? r.handOff.command ?? '' : '', /New-PowerAppManagementApp -ApplicationId client-1/);
});

test('admin consent without the rights becomes a consent link for an admin', async () => {
  const f = fakeFetch([
    { method: 'GET', match: /appRoleAssignments/, reply: () => ({ value: [] }) },
    { method: 'POST', match: /appRoleAssignedTo/, reply: () => ({ status: 403, body: { error: { code: 'Authorization_RequestDenied', message: 'Insufficient privileges' } } }) },
  ]);
  const app = { appId: 'app-1', objectId: 'obj-1', spId: 'sp-1', displayName: 'Agent-Monitor - audit collector' };
  const r = await grantAuditConsent(client(f, 'https://graph.microsoft.com/v1.0'), { tenantId: 'tenant-1', app, graphSpId: 'graph-sp', roleIds: ['role-1', 'role-2'] });
  assert.equal(r.consented, false);
  if (!r.consented) {
    assert.equal(r.handOff.link, adminConsentUrl('tenant-1', 'app-1'));
    assert.match(r.handOff.who, /Global Administrator/);
  }
  const both = [{ appRoleId: 'role-1', resourceId: 'graph-sp' }, { appRoleId: 'role-2', resourceId: 'graph-sp' }];
  const already = fakeFetch([{ method: 'GET', match: /appRoleAssignments/, reply: () => ({ value: both }) }]);
  assert.deepEqual(await grantAuditConsent(client(already, 'https://graph.microsoft.com/v1.0'), { tenantId: 't', app, graphSpId: 'graph-sp', roleIds: ['role-1', 'role-2'] }), { consented: true });
  assert.equal(already.calls.length, 1);
});

test('admin consent grants only the permissions an earlier install lacks', async () => {
  const f = fakeFetch([
    { method: 'GET', match: /appRoleAssignments/, reply: () => ({ value: [{ appRoleId: 'role-1', resourceId: 'graph-sp' }] }) },
    { method: 'POST', match: /appRoleAssignedTo/, reply: () => ({ id: 'assignment-2' }) },
  ]);
  const app = { appId: 'app-1', objectId: 'obj-1', spId: 'sp-1', displayName: 'Agent-Monitor - audit collector' };
  const r = await grantAuditConsent(client(f, 'https://graph.microsoft.com/v1.0'), { tenantId: 't', app, graphSpId: 'graph-sp', roleIds: ['role-1', 'role-2'] });
  assert.deepEqual(r, { consented: true });
  const posts = f.calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(JSON.stringify(posts[0].body), /role-2/);
});

test('HttpError keeps the status', () => {
  const e = new HttpError('x', { status: 404, method: 'GET', url: 'u' });
  assert.equal(e.status, 404);
});
