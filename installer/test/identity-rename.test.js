// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APPS, ensureApp, NOTES } from '../src/identity.js';

/** A Graph stand-in that holds one registration made by an earlier install. */
const fakeGraph = (/** @type {any} */ existing) => {
  /** @type {{ method: string, path: string, body?: any }[]} */
  const calls = [];
  const graph = {
    get: async (/** @type {string} */ path) => {
      calls.push({ method: 'get', path });
      if (path.startsWith('/applications?')) return { value: path.includes(encodeURIComponent(existing.displayName)) || path.includes(existing.displayName) ? [existing] : [] };
      if (path.startsWith('/servicePrincipals?')) return { value: [{ id: 'sp-1' }] };
      return undefined;
    },
    post: async (/** @type {string} */ path, /** @type {any} */ body) => { calls.push({ method: 'post', path, body }); return { id: 'new', appId: 'new-app' }; },
    patch: async (/** @type {string} */ path, /** @type {any} */ body) => { calls.push({ method: 'patch', path, body }); },
  };
  return { graph: /** @type {any} */ (graph), calls };
};

test('a registration from before the Agent-Monitor rename is adopted and renamed, not duplicated', async () => {
  const old = { id: 'obj-1', appId: 'app-1', displayName: 'AI-Monitor - audit collector', notes: 'Created by the AI-Monitor installer.', requiredResourceAccess: [] };
  const { graph, calls } = fakeGraph(old);
  const app = await ensureApp(graph, { key: 'audit' });
  assert.equal(app.appId, 'app-1');
  assert.equal(app.displayName, APPS.audit.displayName);
  assert.equal(app.created, false);
  assert.ok(!calls.some((c) => c.method === 'post' && c.path === '/applications'));
  assert.deepEqual(calls.find((c) => c.method === 'patch')?.body, { displayName: 'Agent-Monitor - audit collector', notes: NOTES });
});
