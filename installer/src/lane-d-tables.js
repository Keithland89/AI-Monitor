// @ts-check
/**
 * Lane D's tables, made through the Dataverse Web API: the knowledge source landing table and the
 * three tables the daily sweep flow needs (environment manifest, runs, errors), their alternate keys,
 * and the poc_uniquekey column the flow upserts on. A port of
 * solution\knowledge-sweep\Publish-KnowledgeSources.js --provision. Every step checks first, so it's
 * safe to run again.
 */
import { defaultSleep, HttpError } from './http.js';
import { isNotFound } from './dataverse.js';

const PREFIX = 'poc_';
export const KNOWLEDGE_ENTITY = 'poc_agentknowledgesource';
export const KNOWLEDGE_SET = 'poc_agentknowledgesources';

/** @param {string} t */
const label = (t) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.Label',
  LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: t, LanguageCode: 1033 }],
});

/** @param {string} name @param {string} display @param {number} len @param {string} desc */
const S = (name, display, len, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
  SchemaName: PREFIX + name,
  MaxLength: len,
  RequiredLevel: { Value: 'None' },
  DisplayName: label(display),
  Description: label(desc),
});
// Dataverse defaults an integer column to 1..1000, which blocks a zero count and truncates real totals.
/** @param {string} name @param {string} display @param {string} desc */
const I = (name, display, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata',
  SchemaName: PREFIX + name,
  RequiredLevel: { Value: 'None' },
  MinValue: 0,
  MaxValue: 2147483647,
  DisplayName: label(display),
  Description: label(desc),
});
/** @param {string} name @param {string} display @param {number} len @param {string} desc */
const M = (name, display, len, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.MemoAttributeMetadata',
  SchemaName: PREFIX + name,
  MaxLength: len,
  RequiredLevel: { Value: 'None' },
  DisplayName: label(display),
  Description: label(desc),
});
/** @param {string} name @param {string} display @param {string} [desc] */
const D = (name, display, desc) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata',
  SchemaName: PREFIX + name,
  RequiredLevel: { Value: 'None' },
  Format: 'DateAndTime',
  DateTimeBehavior: { Value: 'UserLocal' },
  DisplayName: label(display),
  ...(desc ? { Description: label(desc) } : {}),
});
/** @param {string} name @param {string} display @param {number} len */
const primaryName = (name, display, len) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
  SchemaName: PREFIX + name,
  MaxLength: len,
  IsPrimaryName: true,
  RequiredLevel: { Value: 'None' },
  DisplayName: label(display),
});

/**
 * @typedef {object} TableDef
 * @property {string} schema
 * @property {string} set
 * @property {string} display
 * @property {string} plural
 * @property {string} description
 * @property {Record<string, any>} primary
 * @property {Record<string, any>[]} attributes
 * @property {{ name: string, attributes: string[] }} [key]
 */

/** @type {TableDef} */
export const KNOWLEDGE_TABLE = {
  schema: 'AgentKnowledgeSource',
  set: KNOWLEDGE_SET,
  display: 'Agent knowledge source',
  plural: 'Agent knowledge sources',
  description: 'One row per named knowledge source an agent reads, swept from every environment\'s Dataverse.',
  primary: primaryName('SourceName', 'Source name', 400),
  attributes: [
    S('SourceId', 'Source id', 100, 'botcomponentid of the knowledge-source component - the natural key of a row.'),
    S('AgentKey', 'Agent key', 300, 'environmentId|resourceName, matching Agent[AgentKey] in the model.'),
    S('KnowledgeType', 'Knowledge type', 100, 'Friendly source type, same vocabulary as the ARG knowledge lane.'),
    S('SourceKind', 'Source kind', 100, 'Underlying Copilot Studio source kind.'),
    S('Locator', 'Locator', 1000, 'Site URL, index or connector the agent reads.'),
    S('LocatorHost', 'Locator host', 300, 'Host portion of the locator.'),
    S('EnvironmentName', 'Environment name', 300, 'Environment the agent lives in, carried for standalone querying.'),
    {
      '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata',
      SchemaName: `${PREFIX}IsExternal`,
      RequiredLevel: { Value: 'None' },
      DisplayName: label('Reads outside tenant'),
      OptionSet: {
        '@odata.type': 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata',
        TrueOption: { Value: 1, Label: label('Yes') },
        FalseOption: { Value: 0, Label: label('No') },
      },
    },
    D('CollectedAt', 'Collected at'),
  ],
};

/** @type {TableDef[]} */
export const FLOW_TABLES = [
  {
    schema: 'SweepEnvironment',
    set: 'poc_sweepenvironments',
    display: 'Sweep environment',
    plural: 'Sweep environments',
    description: 'One row per environment the sweep app registration holds an application user in. Global discovery under-reports for an app-only identity, so this manifest - not discovery - is what the daily flow iterates.',
    primary: primaryName('Name', 'Environment name', 300),
    attributes: [
      S('EnvironmentId', 'Environment id', 100, 'Power Platform environment id.'),
      S('ApiUrl', 'API URL', 400, 'Dataverse Web API root for the environment.'),
      D('GrantedAt', 'Granted at', 'When access was last confirmed.'),
    ],
    key: { name: 'EnvironmentId', attributes: [`${PREFIX}environmentid`] },
  },
  {
    schema: 'KnowledgeSweepRun',
    set: 'poc_knowledgesweepruns',
    display: 'Knowledge sweep run',
    plural: 'Knowledge sweep runs',
    description: 'One row per run of the daily knowledge-source sweep flow.',
    primary: primaryName('Name', 'Run', 200),
    attributes: [
      D('StartedAt', 'Started at', 'When the run began. Every row written by the run carries this stamp.'),
      D('FinishedAt', 'Finished at', 'When the run finished.'),
      S('Status', 'Status', 100, 'Running, Completed, Completed with errors, or Failed.'),
      S('FlowRunId', 'Flow run id', 100, 'Power Automate run id, for correlating with the run history.'),
      I('EnvironmentsSwept', 'Environments swept', 'Environments read successfully.'),
      I('EnvironmentsFailed', 'Environments failed', 'Environments that could not be read.'),
      I('RowsFound', 'Rows found', 'Knowledge-source components returned across all environments.'),
      I('RowsCreated', 'Rows created', 'Landing rows created.'),
      I('RowsUpdated', 'Rows updated', 'Landing rows updated in place.'),
      I('RowErrors', 'Row errors', 'Rows that failed to land.'),
      I('RowsDeleted', 'Rows deleted', 'Stale rows tombstoned because this run did not restamp them.'),
    ],
  },
  {
    schema: 'KnowledgeSweepError',
    set: 'poc_knowledgesweeperrors',
    display: 'Knowledge sweep error',
    plural: 'Knowledge sweep errors',
    description: 'One row per environment or record the daily sweep could not process.',
    primary: primaryName('Name', 'Error', 300),
    attributes: [
      S('SourceId', 'Source id', 100, 'botcomponentid, when the failure was for one record.'),
      S('EnvironmentId', 'Environment id', 100, 'Environment the failure occurred in.'),
      M('Error', 'Error', 2000, 'Truncated failure detail.'),
      S('RunId', 'Run id', 100, 'Power Automate run id, matching the sweep run row.'),
    ],
  },
];

/** Every lane D table the installer makes, knowledge table first. */
export const LANE_D_TABLES = [KNOWLEDGE_TABLE, ...FLOW_TABLES];

/** @param {TableDef} t */
export const logicalName = (t) => (PREFIX + t.schema).toLowerCase();

/**
 * The EntityMetadata body that creates a table.
 * @param {TableDef} t
 */
export function tableBody(t) {
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
    SchemaName: PREFIX + t.schema,
    DisplayName: label(t.display),
    DisplayCollectionName: label(t.plural),
    Description: label(t.description),
    OwnershipType: 'UserOwned',
    IsActivity: false,
    HasNotes: false,
    HasActivities: false,
    PrimaryNameAttribute: String(t.primary.SchemaName).toLowerCase(),
    Attributes: [t.primary, ...t.attributes],
  };
}

/**
 * The upsert key for an existing row: the environment part of its agent key, then its source id.
 * @param {{ poc_agentkey?: string | null, poc_sourceid: string }} row
 */
export const uniqueKeyFor = (row) => `${String(row.poc_agentkey || '').split('|')[0]}_${row.poc_sourceid}`.slice(0, 200);

/** How many 10-second checks to make for a table whose create lost its connection: five minutes. */
const TABLE_WAIT_POLLS = 30;

/**
 * Whether a request failed in transit rather than with an HTTP status, so the server may have acted on it.
 * @param {unknown} err
 */
export const isConnectionDrop = (err) => !(err instanceof HttpError) && /failed: /.test(String(/** @type {Error} */ (err)?.message ?? ''));

/**
 * @typedef {object} ProvisionLog
 * @property {(s: string) => void} ok
 * @property {(s: string) => void} warn
 * @property {(s: string) => void} info
 */

/**
 * @param {import('./http.js').HttpClient} client
 * @param {string} path
 */
async function pathExists(client, path) {
  try {
    await client.get(path);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/**
 * Makes one table unless it's there already, and waits until it can be queried.
 * @param {import('./http.js').HttpClient} client
 * @param {TableDef} t
 * @param {{ log: ProvisionLog, sleep: (ms: number) => Promise<void>, dryRun: boolean, changed: string[] }} o
 */
async function ensureTable(client, t, { log, sleep, dryRun, changed }) {
  const exists = (/** @type {string} */ path) => pathExists(client, path);
  const logical = logicalName(t);
  const definition = `/EntityDefinitions(LogicalName='${logical}')?$select=LogicalName`;
  if (await exists(definition)) {
    log.info(`${logical} is already there`);
    return;
  }
  if (dryRun) {
    changed.push(`would create ${logical}`);
    return;
  }
  try {
    await client.post('/EntityDefinitions', tableBody(t), { once: true });
  } catch (err) {
    // Creating a table can outlast the connection, and Dataverse carries on regardless,
    // so wait to see whether it made the table before posting it a second time.
    if (!isConnectionDrop(err)) throw err;
    log.info(`The connection dropped while creating ${logical}. Checking whether Dataverse made it anyway.`);
    let made = false;
    for (let i = 0; i < TABLE_WAIT_POLLS && !made; i++) {
      await sleep(10_000);
      made = await exists(definition);
    }
    if (!made) await client.post('/EntityDefinitions', tableBody(t), { once: true });
  }
  changed.push(`created ${logical}`);
  log.ok(`Created ${logical}`);
  // A new table isn't queryable until the metadata cache catches up.
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    if (await exists(`/${t.set}?$top=1`)) return;
  }
  log.warn(`${t.set} isn't queryable yet. It usually is within a few minutes.`);
}

/**
 * Makes the lane D tables, keys and the upsert column. Returns what it changed.
 * @param {import('./http.js').HttpClient} client  The Dataverse Web API client.
 * @param {{ log: ProvisionLog, sleep?: (ms: number) => Promise<void>, dryRun?: boolean }} o
 */
export async function provisionLaneD(client, { log, sleep = defaultSleep, dryRun = false }) {
  /** @type {string[]} */
  const changed = [];

  /** @param {string} path */
  const exists = (path) => pathExists(client, path);
  /** @param {TableDef} t */
  const createTable = (t) => ensureTable(client, t, { log, sleep, dryRun, changed });

  /**
   * @param {string} entity
   * @param {string} keyName
   * @param {string[]} attributes
   */
  async function createAlternateKey(entity, keyName, attributes) {
    const keys = await client.get(`/EntityDefinitions(LogicalName='${entity}')/Keys?$select=SchemaName`);
    if ((keys?.value ?? []).some((/** @type {any} */ k) => k.SchemaName === PREFIX + keyName)) {
      log.info(`Alternate key ${PREFIX}${keyName} is already there`);
      return;
    }
    if (dryRun) {
      changed.push(`would add alternate key ${PREFIX}${keyName} on ${entity}`);
      return;
    }
    await client.post(`/EntityDefinitions(LogicalName='${entity}')/Keys`, {
      '@odata.type': 'Microsoft.Dynamics.CRM.EntityKeyMetadata',
      SchemaName: PREFIX + keyName,
      DisplayName: label(keyName),
      KeyAttributes: attributes,
    }, { once: true });
    changed.push(`added alternate key ${PREFIX}${keyName} on ${entity}`);
    // The key builds as a system job; an upsert against it fails until it's Active.
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const status = await client.get(`/EntityDefinitions(LogicalName='${entity}')/Keys?$select=SchemaName,EntityKeyIndexStatus`);
      const key = (status?.value ?? []).find((/** @type {any} */ k) => k.SchemaName === PREFIX + keyName);
      if (key?.EntityKeyIndexStatus === 'Active') {
        log.ok(`Alternate key ${PREFIX}${keyName} is active`);
        return;
      }
    }
    log.warn(`Alternate key ${PREFIX}${keyName} is still building. The flow makes duplicates until it's active; run check later.`);
  }

  async function backfillUniqueKey() {
    const id = `${KNOWLEDGE_ENTITY}id`;
    /** @type {any[]} */
    const rows = await client.list(`/${KNOWLEDGE_SET}?$select=${id},poc_sourceid,poc_agentkey,poc_uniquekey`, { headers: { Prefer: 'odata.maxpagesize=5000' } });
    const todo = rows.filter((r) => !r.poc_uniquekey && r.poc_sourceid);
    if (!todo.length) return;
    if (dryRun) {
      changed.push(`would backfill poc_uniquekey on ${todo.length} rows`);
      return;
    }
    for (const r of todo) await client.patch(`/${KNOWLEDGE_SET}(${r[id]})`, { poc_uniquekey: uniqueKeyFor(r) });
    changed.push(`backfilled poc_uniquekey on ${todo.length} rows`);
  }

  // The flow upserts on environment + component, because component IDs repeat across environments.
  async function provisionUpsertKey() {
    const attr = `${PREFIX}uniquekey`;
    if (!(await exists(`/EntityDefinitions(LogicalName='${KNOWLEDGE_ENTITY}')/Attributes(LogicalName='${attr}')?$select=LogicalName`))) {
      if (dryRun) changed.push(`would add ${attr} to ${KNOWLEDGE_ENTITY}`);
      else {
        await client.post(`/EntityDefinitions(LogicalName='${KNOWLEDGE_ENTITY}')/Attributes`, S('UniqueKey', 'Unique key', 200,
          'Environment id and component id joined with an underscore. The daily sweep flow upserts on this, because component ids alone repeat across environments.'), { once: true });
        changed.push(`added ${attr} to ${KNOWLEDGE_ENTITY}`);
        await sleep(10_000);
      }
    }
    if (!dryRun || (await exists(`/EntityDefinitions(LogicalName='${KNOWLEDGE_ENTITY}')?$select=LogicalName`))) await backfillUniqueKey();

    // An old key on poc_sourceid blocks a rebuild and isn't what the flow uses any more.
    const keys = await client.get(`/EntityDefinitions(LogicalName='${KNOWLEDGE_ENTITY}')/Keys?$select=SchemaName,EntityKeyIndexStatus,MetadataId`);
    for (const k of keys?.value ?? []) {
      if (k.SchemaName !== `${PREFIX}SourceId`) continue;
      if (dryRun) changed.push(`would drop the old ${k.SchemaName} key`);
      else {
        await client.del(`/EntityDefinitions(LogicalName='${KNOWLEDGE_ENTITY}')/Keys(${k.MetadataId})`);
        changed.push(`dropped the old ${k.SchemaName} key`);
      }
    }
    await createAlternateKey(KNOWLEDGE_ENTITY, 'UniqueKey', [attr]);
  }

  await createTable(KNOWLEDGE_TABLE);
  for (const t of FLOW_TABLES) await createTable(t);
  if (dryRun && changed.some((c) => c.startsWith('would create'))) {
    changed.push('would add the alternate keys and the poc_uniquekey upsert key');
    return changed;
  }
  for (const t of FLOW_TABLES) if (t.key) await createAlternateKey(logicalName(t), t.key.name, t.key.attributes);
  await provisionUpsertKey();
  return changed;
}
