// @ts-check
/**
 * How the installer was started, so every "run it again" hint can be pasted as is.
 * The PowerShell launcher sets AGENT_MONITOR_LAUNCHER=pwsh and AGENT_MONITOR_SHIM to the
 * command it wrote; run from a clone, it's node and the bin script. A shim written before the
 * rename sets AI_MONITOR_* instead.
 */

/** @param {NodeJS.ProcessEnv} env */
const launcher = (env) => env.AGENT_MONITOR_LAUNCHER ?? env.AI_MONITOR_LAUNCHER;
/** @param {NodeJS.ProcessEnv} env */
const shim = (env) => env.AGENT_MONITOR_SHIM ?? env.AI_MONITOR_SHIM;

/**
 * The command that runs the installer again with these arguments.
 * @param {string} [args]  e.g. 'deploy-app'.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function commandLine(args = '', env = process.env) {
  const tail = args ? ` ${args}` : '';
  if (launcher(env) === 'pwsh' && shim(env)) return `& "${shim(env)}"${tail}`;
  return `node bin/agent-monitor-install.js${tail}`;
}

/** Whether the PowerShell launcher started this run. @param {NodeJS.ProcessEnv} [env] */
export const fromLauncher = (env = process.env) => launcher(env) === 'pwsh';
