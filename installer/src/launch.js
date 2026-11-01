// @ts-check
/**
 * How the installer was started, so every "run it again" hint can be pasted as is.
 * The PowerShell launcher sets AI_MONITOR_LAUNCHER=pwsh and AI_MONITOR_SHIM to the
 * command it wrote; run from a clone, it's node and the bin script.
 */

/**
 * The command that runs the installer again with these arguments.
 * @param {string} [args]  e.g. 'deploy-app'.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function commandLine(args = '', env = process.env) {
  const tail = args ? ` ${args}` : '';
  if (env.AI_MONITOR_LAUNCHER === 'pwsh' && env.AI_MONITOR_SHIM) return `& "${env.AI_MONITOR_SHIM}"${tail}`;
  return `node bin/ai-monitor-install.js${tail}`;
}

/** Whether the PowerShell launcher started this run. @param {NodeJS.ProcessEnv} [env] */
export const fromLauncher = (env = process.env) => env.AI_MONITOR_LAUNCHER === 'pwsh';
