// @ts-check
/**
 * What the installer does in the landing environment through the Dataverse Web API: import
 * solutions, set environment variables and connection references, turn flows on and off, and read
 * the run tables.
 */
import { HttpError, defaultSleep } from './http.js';
import { compareVersions } from './zip.js';

export const API_PATH = '/api/data/v9.2';

/** @typedef {ReturnType<typeof import('./http.js').createClient>} Client */

/** @param {string} s */
const q = (s) => s.replace(/'/g, "''");

/** @param {unknown} err */
export const isNotFound = (err) => err instanceof HttpError && err.status === 404;

/**
 * @param {Client} client  Its base URL is the environment's URL plus API_PATH.
 * @param {{ sleep?: (ms: number) => Promise<void>, now?: () => number }} [opts]
 */
export function createDataverse(client, opts = {}) {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  /**
   * The installed solution's version, or undefined.
   * @param {string} uniqueName
   * @returns {Promise<{ id: string, version: string, managed: boolean } | undefined>}
   */
  async function solutionVersion(uniqueName) {
    const data = await client.get(`/solutions?$select=solutionid,version,ismanaged&$filter=uniquename eq '${q(uniqueName)}'`);
    const row = data?.value?.[0];
    return row ? { id: row.solutionid, version: row.version, managed: !!row.ismanaged } : undefined;
  }

  /**
   * Imports a solution zip and waits for the import to finish. An upgrade of an installed managed
   * solution goes through StageAndUpgrade, so components it no longer has are removed.
   * @param {{ zip: Uint8Array, componentParameters: any[], upgrade?: boolean, timeoutMs?: number, onStatus?: (s: string) => void }} o
   */
  async function importSolution({ zip, componentParameters, upgrade = false, timeoutMs = 30 * 60_000, onStatus }) {
    const body = {
      OverwriteUnmanagedCustomizations: false,
      PublishWorkflows: false,
      CustomizationFile: Buffer.from(zip).toString('base64'),
      ComponentParameters: componentParameters,
    };
    const started = await client.post(upgrade ? '/StageAndUpgradeAsync' : '/ImportSolutionAsync', body, { once: true });
    const id = started?.AsyncOperationId;
    if (!id) throw new Error('Dataverse accepted the import but returned no operation to follow.');
    return waitForAsync(id, { timeoutMs, onStatus });
  }

  /**
   * Waits for a system job. statecode 3 is completed; statuscode 30 succeeded, 31 failed, 32 cancelled.
   * @param {string} id
   * @param {{ timeoutMs?: number, onStatus?: (s: string) => void }} [o]
   */
  async function waitForAsync(id, { timeoutMs = 30 * 60_000, onStatus } = {}) {
    const deadline = now() + timeoutMs;
    for (let attempt = 0; ; attempt++) {
      await sleep(attempt ? 10_000 : 5_000);
      const job = await client.get(`/asyncoperations(${id})?$select=statecode,statuscode,message,friendlymessage`);
      if (job.statecode === 3) {
        if (job.statuscode === 30) return { id };
        const why = String(job.friendlymessage || job.message || '').trim();
        throw new Error(`The import ${job.statuscode === 32 ? 'was cancelled' : 'failed'}${why ? `: ${why.slice(0, 800)}` : '.'}`);
      }
      onStatus?.(job.statecode === 0 ? 'waiting to start' : 'importing');
      if (now() > deadline) throw new Error(`The import was still running after ${Math.round(timeoutMs / 60_000)} minutes. Run it again later: it picks up the installed version.`);
    }
  }

  /**
   * Whether the zip needs importing: not installed, or older than the zip.
   * @param {string} uniqueName
   * @param {string} zipVersion
   */
  async function importNeeded(uniqueName, zipVersion) {
    const installed = await solutionVersion(uniqueName);
    if (!installed) return { needed: true, upgrade: false };
    if (compareVersions(installed.version, zipVersion) < 0) return { needed: true, upgrade: installed.managed, installed: installed.version };
    return { needed: false, upgrade: false, installed: installed.version };
  }

  /**
   * An environment variable's definition and current value.
   * @param {string} schemaName
   */
  async function envVar(schemaName) {
    const data = await client.get(`/environmentvariabledefinitions?$select=environmentvariabledefinitionid,schemaname,defaultvalue&$filter=schemaname eq '${q(schemaName)}'&$expand=environmentvariabledefinition_environmentvariablevalue($select=environmentvariablevalueid,value)`);
    const def = data?.value?.[0];
    if (!def) return undefined;
    const current = def.environmentvariabledefinition_environmentvariablevalue?.[0];
    return {
      definitionId: /** @type {string} */ (def.environmentvariabledefinitionid),
      defaultValue: /** @type {string | undefined} */ (def.defaultvalue ?? undefined),
      valueId: /** @type {string | undefined} */ (current?.environmentvariablevalueid),
      value: /** @type {string | undefined} */ (current?.value ?? undefined),
    };
  }

  /**
   * Sets an environment variable's current value. Returns whether it changed.
   * @param {string} schemaName
   * @param {string} value
   */
  async function setEnvVar(schemaName, value) {
    const v = await envVar(schemaName);
    if (!v) throw new Error(`The environment variable ${schemaName} isn't in the environment. Import its solution first.`);
    if (v.value === value) return false;
    if (v.valueId) await client.patch(`/environmentvariablevalues(${v.valueId})`, { value });
    else {
      await client.post('/environmentvariablevalues', {
        schemaname: schemaName,
        value,
        'EnvironmentVariableDefinitionId@odata.bind': `/environmentvariabledefinitions(${v.definitionId})`,
      });
    }
    return true;
  }

  /**
   * Binds a connection reference to a connection. Returns whether it changed.
   * @param {string} logicalName
   * @param {string} connectionId
   */
  async function setConnectionReference(logicalName, connectionId) {
    const data = await client.get(`/connectionreferences?$select=connectionreferenceid,connectionid&$filter=connectionreferencelogicalname eq '${q(logicalName)}'`);
    const ref = data?.value?.[0];
    if (!ref) throw new Error(`The connection reference ${logicalName} isn't in the environment.`);
    if (ref.connectionid === connectionId) return false;
    await client.patch(`/connectionreferences(${ref.connectionreferenceid})`, { connectionid: connectionId });
    return true;
  }

  /**
   * A cloud flow's state: on (statecode 1), off (0), or undefined when it isn't there.
   * @param {string} id
   * @returns {Promise<'on' | 'off' | undefined>}
   */
  async function flowState(id) {
    try {
      const wf = await client.get(`/workflows(${id})?$select=statecode`);
      return wf.statecode === 1 ? 'on' : 'off';
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  /**
   * Turns a flow on or off.
   * @param {string} id
   * @param {boolean} on
   */
  async function setFlowState(id, on) {
    await client.patch(`/workflows(${id})`, on ? { statecode: 1, statuscode: 2 } : { statecode: 0, statuscode: 1 });
  }

  /**
   * Turns a flow off and on again, so it picks up changed environment variables: a flow binds them
   * when it's turned on, not per run.
   * @param {string} id
   */
  async function restartFlow(id) {
    if ((await flowState(id)) === 'on') await setFlowState(id, false);
    await setFlowState(id, true);
  }

  /**
   * The newest row in a table, or null when it has none; undefined when the table isn't there.
   * @param {string} entitySet
   * @param {string[]} columns
   * @param {{ since?: string }} [o]  Only rows created at or after this time.
   */
  async function latestRow(entitySet, columns, o = {}) {
    const filter = o.since ? `&$filter=createdon ge ${o.since}` : '';
    try {
      const data = await client.get(`/${entitySet}?$select=${[...columns, 'createdon'].join(',')}&$orderby=createdon desc&$top=1${filter}`);
      return data?.value?.[0] ?? null;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  /**
   * Deletes a solution. Deleting a managed solution deletes its tables and every row in them.
   * @param {string} uniqueName
   */
  async function deleteSolution(uniqueName) {
    const installed = await solutionVersion(uniqueName);
    if (!installed) return false;
    await client.del(`/solutions(${installed.id})`);
    return true;
  }

  /**
   * Deletes a table and its rows.
   * @param {string} logicalName
   */
  async function deleteTable(logicalName) {
    try {
      await client.del(`/EntityDefinitions(LogicalName='${q(logicalName)}')`);
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  return { client, solutionVersion, importSolution, waitForAsync, importNeeded, envVar, setEnvVar, setConnectionReference, flowState, setFlowState, restartFlow, latestRow, deleteSolution, deleteTable };
}

/** @typedef {ReturnType<typeof createDataverse>} Dataverse */
