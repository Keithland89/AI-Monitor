// @ts-check
/**
 * The install record: what the installer created and the answers it was given, so a re-run picks up
 * where the last one stopped, `update` can replay it and `uninstall` knows what to remove. It never
 * holds a secret: the client secrets go straight into the environment variables (or Key Vault) and
 * only their key IDs and expiry dates are kept here.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const RECORD_FILE = 'ai-monitor-install.json';
export const RECORD_FOLDER = 'AI-Monitor';
/** Where installs from before the renames keep their record, newest first. */
export const LEGACY_RECORDS = /** @type {const} */ ([
  ['Agent Monitor', 'agent-inventory-install.json'],
  ['Copilot Inventory', 'agent-inventory-install.json'],
]);
export const RECORD_VERSION = 1;

/**
 * @typedef {object} AppRegistration
 * @property {string} appId
 * @property {string} objectId
 * @property {string} [spId]
 * @property {string} displayName
 * @property {boolean} [created]  The installer made it, so uninstall may delete it.
 * @property {boolean} [consented]
 * @property {string} [secretKeyId]
 * @property {string} [secretExpires]
 * @property {'envvar' | 'keyvault'} [secretWhere]  Where the current secret was put.
 * @property {boolean} [adminApp]  Registered as a Power Platform admin management application.
 * @property {string} [rootReaderId]  The role assignment at the tenant root management group.
 *
 * @typedef {object} ManagedAppRecord
 * @property {string} [appId]
 * @property {string} [environmentId]
 * @property {string} [url]
 * @property {string} [buildHash]
 * @property {string} [deployedAt]
 * @property {string[]} [dataSources]
 * @property {string[]} [sharedWith]
 * @property {string[]} [missing]  Admin settings that were off at the last try.
 * @property {{ why: string, steps: string[] }} [skipped]
 *
 * @typedef {object} HandOff
 * @property {string} id
 * @property {string} who
 * @property {string} what
 * @property {string} [link]
 * @property {string} [command]
 *
 * @typedef {object} InstallRecord
 * @property {number} version
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {string} [tenantId]
 * @property {{ upn?: string, oid?: string }} [user]
 * @property {{ id: string, name?: string, url: string }} [environment]
 * @property {{ scopeMode?: 'Agents' | 'Dataverse', secretMode?: 'envvar' | 'keyvault', keyVault?: { name: string, id?: string }, viewerGroup?: string, maxGrants?: number, secretMonths?: number, sharePoint?: boolean }} options
 * @property {AppRegistration} [auditApp]
 * @property {AppRegistration} [sweepApp]
 * @property {{ id: string, created?: boolean, status?: string }} [connection]
 * @property {Record<string, { version: string, importedAt: string }>} solutions
 * @property {boolean} [tablesProvisioned]
 * @property {Record<string, 'on' | 'off'>} flows
 * @property {{ whatIfAt?: string, inScope?: number, missing?: number, approvedAt?: string, declinedAt?: string }} [appUserGrant]
 * @property {ManagedAppRecord} [managedApp]
 * @property {HandOff[]} handoffs
 * @property {string} [uninstalledAt]
 */

/** @returns {InstallRecord} */
export const emptyRecord = () => ({ version: RECORD_VERSION, options: {}, solutions: {}, flows: {}, handoffs: [] });

/**
 * Documents\AI-Monitor\ai-monitor-install.json, or a record that an install from before a rename left in
 * Documents\Agent Monitor or Documents\Copilot Inventory, when there's none in the new folder.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(path: string) => boolean} [exists]
 */
export function defaultRecordPath(env = process.env, exists = existsSync) {
  const home = env.USERPROFILE || env.HOME || homedir();
  const path = join(home, 'Documents', RECORD_FOLDER, RECORD_FILE);
  if (exists(path)) return path;
  return LEGACY_RECORDS.map(([folder, file]) => join(home, 'Documents', folder, file)).find(exists) ?? path;
}

/** Keys that would hold a secret. Key IDs, expiry dates and the secret mode are fine. */
const SECRET_KEYS = /^(secret|secretText|secretValue|clientSecret|password|accessToken|refreshToken|token)$/i;

/**
 * Throws when anything in the record looks like a secret, so one can't be written to disk by mistake.
 * @param {unknown} value
 * @param {string} [path]
 */
export function assertNoSecrets(value, path = 'record') {
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) throw new Error(`${path} looks like a token; tokens are never saved.`);
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(key) && typeof v === 'string' && v) throw new Error(`${path}.${key} looks like a secret; secrets are never saved.`);
    assertNoSecrets(v, `${path}.${key}`);
  }
}

/**
 * @param {string} path
 * @returns {InstallRecord | undefined}
 */
export function loadRecord(path) {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  /** @type {any} */
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object') throw new Error(`${path} isn't an install record.`);
  if (data.version > RECORD_VERSION) throw new Error(`${path} was written by a newer installer (record version ${data.version}). Update the installer.`);
  return { ...emptyRecord(), ...data, options: { ...(data.options ?? {}) }, solutions: { ...(data.solutions ?? {}) }, flows: { ...(data.flows ?? {}) }, handoffs: [...(data.handoffs ?? [])] };
}

/**
 * Writes the record atomically: to a .tmp file, then renamed over the old one.
 * @param {string} path
 * @param {InstallRecord} record
 * @param {() => Date} [now]
 */
export function saveRecord(path, record, now = () => new Date()) {
  assertNoSecrets(record);
  const stamp = now().toISOString();
  record.createdAt ??= stamp;
  record.updatedAt = stamp;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/** @param {string} path */
export function deleteRecord(path) {
  rmSync(path, { force: true });
}

/**
 * Adds or replaces a hand-off (something an admin has to do) by its ID.
 * @param {InstallRecord} record
 * @param {HandOff} handOff
 */
export function addHandOff(record, handOff) {
  record.handoffs = [...record.handoffs.filter((h) => h.id !== handOff.id), handOff];
}

/** @param {InstallRecord} record @param {string} id */
export function clearHandOff(record, id) {
  record.handoffs = record.handoffs.filter((h) => h.id !== id);
}
