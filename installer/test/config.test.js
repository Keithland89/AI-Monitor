// @ts-check
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { addHandOff, assertNoSecrets, clearHandOff, defaultRecordPath, deleteRecord, emptyRecord, loadRecord, RECORD_VERSION, saveRecord } from '../src/config.js';
import { workDir } from './helpers.js';

test('the record lives in Documents\\Agent-Monitor', () => {
  const path = defaultRecordPath({ USERPROFILE: join('C:', 'Users', 'someone') });
  assert.equal(path, join('C:', 'Users', 'someone', 'Documents', 'Agent-Monitor', 'agent-monitor-install.json'));
});

test('an install from before a rename keeps using its record in Documents\\AI-Monitor, Documents\\Agent Monitor or Documents\\Copilot Inventory', () => {
  const home = join('C:', 'Users', 'someone');
  const legacy = join(home, 'Documents', 'Copilot Inventory', 'agent-inventory-install.json');
  const monitor = join(home, 'Documents', 'Agent Monitor', 'agent-inventory-install.json');
  const aiMonitor = join(home, 'Documents', 'AI-Monitor', 'ai-monitor-install.json');
  const renamed = join(home, 'Documents', 'Agent-Monitor', 'agent-monitor-install.json');
  assert.equal(defaultRecordPath({ USERPROFILE: home }, (p) => p === legacy), legacy);
  assert.equal(defaultRecordPath({ USERPROFILE: home }, (p) => p === monitor || p === legacy), monitor);
  assert.equal(defaultRecordPath({ USERPROFILE: home }, (p) => p === aiMonitor || p === monitor), aiMonitor);
  assert.equal(defaultRecordPath({ USERPROFILE: home }, (p) => p === aiMonitor || p === legacy || p === renamed), renamed);
});

test('a record saves and loads back the same', (t) => {
  const { dir, cleanup } = workDir('record');
  t.after(cleanup);
  const path = join(dir, 'nested', 'agent-monitor-install.json');
  const record = emptyRecord();
  record.tenantId = 'tenant';
  record.environment = { id: 'env', name: 'Landing', url: 'https://landing.example.test' };
  record.auditApp = { appId: 'app', objectId: 'obj', displayName: 'Agent-Monitor - audit collector', created: true, consented: true, secretKeyId: 'key', secretExpires: '2025-01-01T00:00:00Z', secretWhere: 'envvar' };
  record.solutions.sharepoint = { version: '1.0.0.8', importedAt: '2024-01-01T00:00:00Z' };
  record.flows['flow-1'] = 'on';
  record.managedApp = { appId: 'managed', environmentId: 'env', buildHash: 'abc', dataSources: ['arm'] };
  addHandOff(record, { id: 'admin-app', who: 'Power Platform Administrator', what: 'Register it.', command: 'New-PowerAppManagementApp -ApplicationId app' });

  saveRecord(path, record, () => new Date('2024-02-03T04:05:06Z'));
  assert.ok(!existsSync(`${path}.tmp`), 'the temporary file is renamed away');
  const loaded = loadRecord(path);
  assert.deepEqual(loaded, record);
  assert.equal(loaded?.createdAt, '2024-02-03T04:05:06.000Z');

  saveRecord(path, /** @type {any} */ (loaded), () => new Date('2024-03-01T00:00:00Z'));
  const again = loadRecord(path);
  assert.equal(again?.createdAt, '2024-02-03T04:05:06.000Z');
  assert.equal(again?.updatedAt, '2024-03-01T00:00:00.000Z');

  deleteRecord(path);
  assert.equal(loadRecord(path), undefined);
});

test('a record with a byte order mark, or from an older installer, loads', (t) => {
  const { dir, cleanup } = workDir('bom');
  t.after(cleanup);
  const path = join(dir, 'r.json');
  writeFileSync(path, `\uFEFF${JSON.stringify({ version: 1, tenantId: 't' })}`, 'utf8');
  const r = loadRecord(path);
  assert.equal(r?.tenantId, 't');
  assert.deepEqual(r?.handoffs, []);
  assert.deepEqual(r?.solutions, {});
});

test('a record from a newer installer is refused', (t) => {
  const { dir, cleanup } = workDir('newer');
  t.after(cleanup);
  const path = join(dir, 'r.json');
  writeFileSync(path, JSON.stringify({ version: RECORD_VERSION + 1 }), 'utf8');
  assert.throws(() => loadRecord(path), /newer installer/);
});

test('secrets and tokens are never written', (t) => {
  const { dir, cleanup } = workDir('secrets');
  t.after(cleanup);
  const path = join(dir, 'r.json');
  const record = /** @type {any} */ (emptyRecord());
  record.auditApp = { appId: 'a', clientSecret: 'shh' };
  assert.throws(() => saveRecord(path, record), /record\.auditApp\.clientSecret looks like a secret/);
  assert.ok(!existsSync(path));
  assert.throws(() => assertNoSecrets({ note: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.c2ln' }), /looks like a token/);
  assert.doesNotThrow(() => assertNoSecrets({ secretKeyId: 'k', secretExpires: 'd', secretWhere: 'keyvault', secret: '' }));
});

test('hand-offs replace by ID and clear', () => {
  const record = emptyRecord();
  addHandOff(record, { id: 'a', who: 'x', what: 'one' });
  addHandOff(record, { id: 'a', who: 'x', what: 'two' });
  addHandOff(record, { id: 'b', who: 'y', what: 'three' });
  assert.deepEqual(record.handoffs.map((h) => h.what), ['two', 'three']);
  clearHandOff(record, 'a');
  assert.deepEqual(record.handoffs.map((h) => h.id), ['b']);
});

test('the saved file is readable JSON with a trailing newline', (t) => {
  const { dir, cleanup } = workDir('json');
  t.after(cleanup);
  const path = join(dir, 'r.json');
  saveRecord(path, emptyRecord());
  const text = readFileSync(path, 'utf8');
  assert.ok(text.endsWith('}\n'));
  assert.equal(JSON.parse(text).version, RECORD_VERSION);
});
