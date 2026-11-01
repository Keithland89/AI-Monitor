// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandLine, fromLauncher } from '../src/launch.js';

test('run from a clone, the hint is node and the bin script', () => {
  assert.equal(commandLine('status', {}), 'node bin/agent-monitor-install.js status');
  assert.equal(fromLauncher({}), false);
});

test('started by the PowerShell launcher, the hint is the command it wrote', () => {
  const env = { AGENT_MONITOR_LAUNCHER: 'pwsh', AGENT_MONITOR_SHIM: 'C:\\x\\agent-monitor-install.cmd' };
  assert.equal(commandLine('status', env), '& "C:\\x\\agent-monitor-install.cmd" status');
  assert.equal(fromLauncher(env), true);
});

test('a command written before the rename still counts as the launcher', () => {
  const env = { AI_MONITOR_LAUNCHER: 'pwsh', AI_MONITOR_SHIM: 'C:\\x\\ai-monitor-install.cmd' };
  assert.equal(commandLine('', env), '& "C:\\x\\ai-monitor-install.cmd"');
  assert.equal(fromLauncher(env), true);
});
