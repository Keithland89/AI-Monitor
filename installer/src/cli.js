// @ts-check
/** Command-line entry point. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultRecordPath, loadRecord } from './config.js';
import { HttpError } from './http.js';
import { access, check, deployApp, install, message, prereqsCommand, preview, rotateSecret, status, uninstall } from './install.js';
import { commandLine } from './launch.js';
import { runWizard } from './server.js';
import { c, createUi } from './ui.js';

export const COMMANDS = ['install', 'update', 'status', 'check', 'deploy-app', 'access', 'rotate-secret', 'uninstall', 'prereqs', 'preview'];

export const help = () => `Switches on AI-Monitor: the knowledge sweep, the app user grants, the SharePoint agent
collector and the app, in one Dataverse environment. It shows a plan and changes nothing until you approve it.

Usage: ${commandLine('[command] [options]')}
       ${commandLine('--ui [options]')}

Commands:
  install          Sign in, check prerequisites, show the plan, then set up the inventory lanes (default).
                   Run it again to carry on, repair, or pick up a new release
  update           install, for an existing install record
  status           What the install record says is installed. No sign-in
  check            Read the environment: solutions, flows and each lane's latest run. Changes nothing
  deploy-app       Build (if needed) and deploy the app again, or after a Managed Apps setting was
                   turned on. Deploys only when the build changed
  access           Share the app with people or groups: access <email|objectId>...
  rotate-secret    New client secrets for the app registrations, put where the flows read them
  uninstall        Remove what the install record says the installer made, after a confirmation.
                   Tables and their data stay unless --delete-data
  prereqs          Check your roles, tenant settings and licences. Read-only
  preview          Print the plan without signing in

Options:
  --ui                     Open the installer in your browser
  --environment <id|url>   The landing Dataverse environment (the app is deployed there too)
  --tenant <id|domain>     The tenant to sign in to
  --device-code            Sign in with a code instead of a browser window
  --use-az                 Use your Azure CLI sign-in
  --client-id <id>         A public client app to sign in with, if the default can't get every token
  --scope-mode <mode>      Agents (default; needs Reader at the tenant root) or Dataverse
  --key-vault <name>       Keep the client secrets in this Key Vault instead of environment variables
  --viewer-group <id>      Share the app with this Entra group
  --connection-id <id>     Use this Dataverse connection for the flows
  --max-grants <n>         Most app users the grant flow adds in one run (default 25)
  --secret-months <n>      How long new client secrets last (default 12, at most 24)
  --approve-root-reader    Approve Reader at the tenant root without asking (Agents mode)
  --approve-grants         Approve the app user grants without asking, after the what-if run
  --skip-app               Leave out the app
  --skip-sharepoint        Leave out lane E (SharePoint agents) and its audit collector app
                           registration with AuditLogsQuery.Read.All. The choice is saved
  --sharepoint             Include lane E again after --skip-sharepoint
  --solutions <folder>     Where the solution zips are (default: ..\\solution)
  --app-dist <folder>      The app's build (default: ..\\app\\dist, built if missing)
  --save-plan <file.md>    Also save the plan as Markdown
  --config <file>          The install record (default: Documents\\AI-Monitor\\ai-monitor-install.json)
  --app <audit|sweep>      rotate-secret: only this app registration
  --remove-old             rotate-secret: remove the secret it replaces
  --delete-data            uninstall: also delete the tables that hold collected data, and their rows
  -y, --yes                Take the defaults without asking. The broad grants still need their own flag
  --verbose                Show more detail when something fails
  -h, --help               This help
  -v, --version            The installer's version
`;

/**
 * @param {string[]} argv
 */
export function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      ui: { type: 'boolean' },
      'no-open': { type: 'boolean' },
      environment: { type: 'string' },
      tenant: { type: 'string' },
      'device-code': { type: 'boolean' },
      'use-az': { type: 'boolean' },
      'client-id': { type: 'string' },
      'scope-mode': { type: 'string' },
      'key-vault': { type: 'string' },
      'viewer-group': { type: 'string' },
      'connection-id': { type: 'string' },
      'max-grants': { type: 'string' },
      'secret-months': { type: 'string' },
      'approve-root-reader': { type: 'boolean' },
      'approve-grants': { type: 'boolean' },
      'skip-app': { type: 'boolean' },
      sharepoint: { type: 'boolean' },
      'skip-sharepoint': { type: 'boolean' },
      solutions: { type: 'string' },
      'app-dist': { type: 'string' },
      'save-plan': { type: 'string' },
      config: { type: 'string' },
      app: { type: 'string' },
      'remove-old': { type: 'boolean' },
      'delete-data': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      verbose: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  const [command = 'install', ...rest] = positionals;
  if (!COMMANDS.includes(command)) throw new Error(`There's no command called "${command}". Run with --help to see them.`);
  if (rest.length && command !== 'access') throw new Error(`${command} doesn't take ${rest.join(' ')}.`);
  if (values.ui && positionals.length) throw new Error('--ui opens a page where you choose what to do. Leave out the command.');
  if (values.ui && values.yes) throw new Error('Choose one of --ui and --yes.');
  if (values['device-code'] && values['use-az']) throw new Error('Choose one of --device-code and --use-az.');
  if (values.sharepoint && values['skip-sharepoint']) throw new Error('Choose one of --sharepoint and --skip-sharepoint.');
  const scopeMode = values['scope-mode'];
  if (scopeMode !== undefined && !['Agents', 'Dataverse'].includes(scopeMode)) throw new Error('--scope-mode is Agents or Dataverse.');
  const app = values.app;
  if (app !== undefined && !['audit', 'sweep'].includes(app)) throw new Error('--app is audit or sweep.');
  if (app !== undefined && command !== 'rotate-secret') throw new Error('--app goes with rotate-secret.');
  if (values['delete-data'] && command !== 'uninstall') throw new Error('--delete-data goes with uninstall.');
  /** @param {string} flag @param {number} min @param {number} max */
  const whole = (flag, min, max) => {
    const raw = /** @type {string | undefined} */ (values[/** @type {keyof typeof values} */ (flag)]);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${flag} must be a whole number from ${min} to ${max}.`);
    return n;
  };
  const maxGrants = whole('max-grants', 1, 500);
  const secretMonths = whole('secret-months', 1, 24);

  /** @type {import('./install.js').Options} */
  const options = {
    yes: !!values.yes,
    signIn: values['use-az'] ? 'azure-cli' : values['device-code'] ? 'device-code' : 'browser',
    debug: !!values.verbose,
    ...(values.tenant ? { tenant: values.tenant } : {}),
    ...(values.environment ? { environment: values.environment } : {}),
    ...(values['client-id'] ? { clientId: values['client-id'] } : {}),
    ...(scopeMode ? { scopeMode: /** @type {'Agents' | 'Dataverse'} */ (scopeMode) } : {}),
    ...(values['key-vault'] ? { keyVault: values['key-vault'] } : {}),
    ...(values['viewer-group'] ? { viewerGroup: values['viewer-group'] } : {}),
    ...(values['connection-id'] ? { connectionId: values['connection-id'] } : {}),
    ...(maxGrants !== undefined ? { maxGrants } : {}),
    ...(secretMonths !== undefined ? { secretMonths } : {}),
    ...(values['approve-root-reader'] ? { approveRootReader: true } : {}),
    ...(values['approve-grants'] ? { approveGrants: true } : {}),
    ...(values['skip-app'] ? { skipApp: true } : {}),
    ...(values.sharepoint ? { sharePoint: true } : values['skip-sharepoint'] ? { sharePoint: false } : {}),
    ...(values.solutions ? { solutions: resolve(values.solutions) } : {}),
    ...(values['app-dist'] ? { appDist: resolve(values['app-dist']) } : {}),
    ...(values['save-plan'] ? { savePlan: resolve(values['save-plan']) } : {}),
    ...(values.config ? { config: resolve(values.config) } : {}),
    ...(app ? { app: /** @type {'audit' | 'sweep'} */ (app) } : {}),
    ...(values['remove-old'] ? { removeOld: true } : {}),
    ...(values['delete-data'] ? { deleteData: true } : {}),
    ...(command === 'access' && rest.length ? { share: rest } : {}),
  };
  return {
    command,
    options,
    ui: !!values.ui,
    open: !values['no-open'],
    verbose: !!values.verbose,
    help: !!values.help,
    version: !!values.version,
  };
}

export function version() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return String(pkg.version);
}

/**
 * Runs one command.
 * @param {string} command
 * @param {import('./install.js').Options} o
 * @param {import('./install.js').Deps} d
 * @returns {Promise<number>}
 */
export async function runCommand(command, o, d) {
  switch (command) {
    case 'install':
      return install(o, d);
    case 'update': {
      const path = o.config ?? defaultRecordPath();
      if (!loadRecord(path)) {
        d.ui.info(`update needs an install record, and there isn't one at ${path}. Run ${commandLine('install')} first, or pass --config.`);
        return 1;
      }
      return install(o, d);
    }
    case 'status':
      return status(o, d);
    case 'check':
      return check(o, d);
    case 'deploy-app':
      return deployApp(o, d);
    case 'access':
      return access(o, d);
    case 'rotate-secret':
      return rotateSecret(o, d);
    case 'uninstall':
      return uninstall(o, d);
    case 'prereqs':
      return prereqsCommand(o, d);
    case 'preview':
      return preview(o, d);
    default:
      throw new Error(`There's no command called "${command}".`);
  }
}

/**
 * Prints why a command stopped, in one line, with more under --verbose.
 * @param {unknown} err
 * @param {boolean} verbose
 * @param {(s: string) => void} write
 * @returns {number}
 */
export function reportError(err, verbose, write) {
  const e = /** @type {any} */ (err);
  if (e?.name === 'ExitPromptError') {
    write('\nCancelled.\n');
    return 130;
  }
  if (/device_code_expired|expired_token|code_expired/i.test(String(e?.message ?? e?.errorCode ?? ''))) {
    write(`\n${c.red('✗')} The sign-in code expired before it was used. Run the installer again and enter the new code within 15 minutes.\n`);
    return 1;
  }
  write(`\n${c.red('✗')} ${message(err)}\n`);
  if (verbose && err instanceof HttpError && err.body) write(`${c.dim(JSON.stringify(err.body, null, 2))}\n`);
  else if (verbose && e?.stack) write(`${c.dim(e.stack)}\n`);
  return 1;
}

/**
 * @param {string[]} argv
 * @param {{ write?: (s: string) => void, deps?: Partial<import('./install.js').Deps> }} [io]  For tests.
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv, io = {}) {
  const write = io.write ?? ((/** @type {string} */ s) => process.stderr.write(s));
  let verbose = false;
  try {
    const args = parseCli(argv);
    verbose = args.verbose;
    if (args.help) {
      (io.write ?? ((/** @type {string} */ s) => process.stdout.write(s)))(help());
      return 0;
    }
    if (args.version) {
      (io.write ?? ((/** @type {string} */ s) => process.stdout.write(s)))(`${version()}\n`);
      return 0;
    }
    if (args.ui) {
      await runWizard({
        open: args.open,
        version: version(),
        run: async (command, ui) => {
          try {
            return await runCommand(command, args.options, { ...io.deps, ui });
          } catch (err) {
            if (/** @type {any} */ (err)?.name === 'ExitPromptError') throw err;
            ui.fail(message(err));
            return 1;
          }
        },
      });
      return 0;
    }
    const ui = io.deps?.ui ?? createUi({ yes: args.options.yes });
    ui.line(c.bold(`AI-Monitor installer ${version()}`));
    return await runCommand(args.command, args.options, { ...io.deps, ui });
  } catch (err) {
    return reportError(err, verbose, write);
  }
}
