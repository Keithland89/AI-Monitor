// @ts-check
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { installScript, makeZip, releaseBase, releaseFiles, REPO } from '../packaging/release.js';
import { SOLUTIONS } from '../src/solutions.js';
import { readZipEntry } from '../src/zip.js';
import { TEST_DIR, workDir } from './helpers.js';

const SHA = 'ab'.repeat(32);

test('the launcher is filled in as plain ASCII with CRLF, pointing at the release', () => {
  const template = readFileSync(join(TEST_DIR, '..', 'packaging', 'launcher', 'install.ps1'), 'utf8');
  const script = installScript(template, { version: '1.2.3', sha256: SHA.toUpperCase() });
  assert.doesNotMatch(script, /\{\{/);
  assert.match(script, new RegExp(`\\$Sha256 = '${SHA}'`));
  assert.match(script, /\$Version = '1\.2\.3'/);
  assert.ok(script.includes(`${releaseBase(REPO, '1.2.3')}/install.ps1 | iex`));
  assert.ok(!/[^\r]\n/.test(script), 'every line ends with CRLF');
  assert.ok([...script].every((ch) => ch.charCodeAt(0) < 0x7f));
  assert.doesNotMatch(script, /ExecutionPolicy\s+Bypass|-ep\s+bypass/i, 'it never bypasses the execution policy');
});

test('the launcher template refuses bad values and stray placeholders', () => {
  assert.throws(() => installScript('$Sha256 = \'{{SHA256}}\'', { version: '1.2.3', sha256: 'abc' }), /isn't a SHA-256/);
  assert.throws(() => installScript('{{VERSION}}', { version: '1.2.3; rm', sha256: SHA }), /isn't a version/);
  assert.throws(() => installScript('{{OTHER}}', { version: '1.2.3', sha256: SHA }), /unknown placeholder/);
  assert.throws(() => installScript('caf\u00e9 {{VERSION}}', { version: '1.2.3', sha256: SHA }), /plain ASCII/);
});

test('the zip holds the installer, the managed solutions and the app\'s build, and reads back', (t) => {
  const w = workDir('release');
  t.after(w.cleanup);
  const root = w.dir;
  const put = (/** @type {string} */ p, /** @type {string} */ s = p) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), s);
  };
  for (const p of ['installer/package.json', 'installer/package-lock.json', 'installer/README.md', 'installer/managed-cli/package.json', 'installer/managed-cli/package-lock.json', 'installer/bin/agent-monitor-install.js', 'installer/src/cli.js', 'installer/src/web/index.html']) put(p);
  for (const s of SOLUTIONS) put(`solution/${s.file}`);
  for (const old of ['CopilotInteractionLogging_managed.zip', 'M365UsageReports_managed.zip', 'Other.zip']) put(`solution/${old}`);
  put('installer/node_modules/x/index.js');
  assert.throws(() => releaseFiles(root), /app\/dist has no build/);
  put('app/dist/index.html', '<html>'.repeat(200));
  put('app/dist/assets/app.js');
  put('app/src/main.tsx');

  const files = releaseFiles(root);
  assert.ok(files.includes('installer/src/web/index.html'));
  assert.ok(files.includes('app/dist/assets/app.js'));
  assert.equal(files.filter((f) => f.startsWith('solution/')).length, SOLUTIONS.length, 'only the managed solutions');
  assert.deepEqual(files.filter((f) => f.startsWith('solution/')).sort(), ['solution/AgentAppUserProvisioning_managed.zip', 'solution/AgentKnowledgeSourceSweep_managed.zip', 'solution/SharePointAgentLogging_managed.zip'], 'no lane C or G solutions');
  assert.ok(!files.some((f) => f.includes('node_modules') || f.startsWith('app/src')));

  const zip = makeZip(files.map((name) => ({ name, data: readFileSync(join(root, name)) })));
  assert.equal(readZipEntry(zip, 'app/dist/index.html')?.toString(), '<html>'.repeat(200));
  assert.equal(readZipEntry(zip, 'installer/src/cli.js')?.toString(), 'installer/src/cli.js');
  assert.deepEqual(makeZip([{ name: 'a', data: Buffer.from('a') }]), makeZip([{ name: 'a', data: Buffer.from('a') }]), 'the same files make the same zip');
});
