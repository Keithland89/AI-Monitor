import { getContext } from '@microsoft/managed-apps/app'
import {
  AzureResourceManagerService, MicrosoftDataverseService, MicrosoftDefenderATPService, PowerPlatformforAdminsV2Service,
} from '../generated'
import type { ResourceQueryRequest } from '../generated/models/PowerPlatformforAdminsV2Model'
import { buildDataset, emptyRaw } from './build'
import { KQL, mapDevices, mapExecuted, mapInstalled, mapNetwork } from './shadow'
import {
  isFoundryProject, joinAgents, projectAgent, projectAzureAIResource, projectConnectors, projectEnvironment, projectFlow,
  projectFoundryAgent, projectKnowledge, projectUsage, str, toBool, toInt, toTime, type ArgItem,
} from './transforms'
import type {
  Dataset, KnowledgeSource, LaneId, LaneState, LaneStatus, RawData, RunInfo, SharePointAgent, UserRecord,
} from './types'

/* ---------- result handling ---------- */

export class LaneError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

interface OpResult<T> {
  success: boolean
  data: T
  error?: Error | { message?: string; status?: number; code?: string }
  skipToken?: string
}

function unwrap<T>(r: OpResult<T>): T {
  if (r.success) return r.data
  const e = r.error as { message?: string; status?: number } | undefined
  const message = e?.message ?? 'The connector call failed.'
  const m = /\b(4\d\d|5\d\d)\b/.exec(message)
  throw new LaneError(message, e?.status ?? (m ? Number(m[1]) : undefined))
}

/** Maps a failure to a lane state; Dataverse "table not found" means the lane was never set up. */
export function classifyError(e: unknown, dataverse = false): { state: LaneState; detail: string } {
  const message = e instanceof Error ? e.message : str(e)
  const status = e instanceof LaneError ? e.status : undefined
  if (status === 401 || status === 403 || /forbidden|unauthori[sz]ed|not authori[sz]ed|insufficient privileges|permission/i.test(message)) {
    return { state: 'denied', detail: message }
  }
  if (dataverse && (status === 404 || /does not exist|could not find|not found|0x80060888/i.test(message))) {
    return { state: 'not-set-up', detail: 'Table not found in this environment. Run the installer to create the landing tables.' }
  }
  return { state: 'error', detail: message }
}

/* ---------- Lane A: Power Platform inventory ---------- */

const MAX_PAGES = 200

export async function queryPowerPlatform(types: string | string[]): Promise<ArgItem[]> {
  const values = (Array.isArray(types) ? types : [types]).map((t) => `'${t}'`)
  const rows: ArgItem[] = []
  let skipToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = {
      TableName: 'PowerPlatformResources',
      Clauses: [
        { $type: 'where', FieldName: 'type', Operator: 'in~', Values: values },
        { $type: 'orderby', FieldNamesAscDesc: { id: 'asc' } },
      ],
      Options: { Top: 1000, ...(skipToken ? { SkipToken: skipToken } : {}) },
    } as unknown as ResourceQueryRequest
    const res = unwrap(await PowerPlatformforAdminsV2Service.QueryResources('2024-10-01', body) as OpResult<unknown>)
    const payload = (res ?? {}) as { data?: ArgItem[]; skipToken?: string; value?: ArgItem[] }
    rows.push(...(payload.data ?? payload.value ?? []))
    skipToken = payload.skipToken
    if (!skipToken) break
  }
  return rows
}

/* ---------- Foundry: Azure Resource Manager ---------- */

const FOUNDRY_FILTER =
  "resourceType eq 'Microsoft.CognitiveServices/accounts' or resourceType eq 'Microsoft.CognitiveServices/accounts/projects' or resourceType eq 'Microsoft.MachineLearningServices/workspaces'"

export type ResourcePage = { value?: ArgItem[]; nextLink?: string }
export type FoundryResult = { resources: ArgItem[]; skipped: number; truncated: number }

/**
 * Reads the first page per subscription. The generated Resources_List has no $skiptoken parameter,
 * so a nextLink cannot be followed; it is counted as a truncated subscription instead.
 */
export async function listFoundryResources(ids: string[], listPage: (subscriptionId: string) => Promise<ResourcePage | undefined>): Promise<FoundryResult> {
  let skipped = 0
  let truncated = 0
  const per = await Promise.all(ids.map(async (id) => {
    try {
      const r = await listPage(id)
      if (r?.nextLink) truncated++
      return (r?.value ?? []).map((x) => ({ ...x, subscriptionId: x.subscriptionId ?? id }))
    } catch {
      skipped++
      return []
    }
  }))
  return { resources: per.flat(), skipped, truncated }
}

export function foundryDetail(r: Pick<FoundryResult, 'skipped' | 'truncated'>): string | undefined {
  const parts = [
    r.skipped ? `${r.skipped} subscription(s) could not be read and were skipped.` : '',
    r.truncated ? `${r.truncated} subscription(s) returned more than one page; results may be truncated.` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

async function loadFoundry(): Promise<FoundryResult> {
  const subs = unwrap(await AzureResourceManagerService.Subscriptions_List('2020-01-01') as OpResult<{ value?: { subscriptionId?: string }[] }>)
  const ids = (subs?.value ?? []).map((s) => s.subscriptionId).filter((s): s is string => !!s)
  return listFoundryResources(ids, async (id) =>
    unwrap(await AzureResourceManagerService.Resources_List(id, FOUNDRY_FILTER, undefined, 1000, '2021-04-01') as OpResult<ResourcePage>))
}

/* ---------- Knowledge sources, SharePoint agents and users: Dataverse in the app's environment ---------- */

const PREFER = 'odata.maxpagesize=5000,odata.include-annotations="OData.Community.Display.V1.FormattedValue"'
const MAX_DATAVERSE_ROWS = 250_000

type DvRow = Record<string, unknown>

const plain = (item: unknown): DvRow => {
  const o = (item ?? {}) as DvRow
  return (o.dynamicProperties as DvRow | undefined) ?? o
}

export function skipTokenFrom(nextLink: string | undefined): string | undefined {
  if (!nextLink) return undefined
  const m = /[?&]\$skiptoken=([^&]+)/i.exec(nextLink)
  return m ? decodeURIComponent(m[1]) : undefined
}

export async function listRecords(entitySet: string, select?: string, filter?: string, orderby?: string, top?: number): Promise<DvRow[]> {
  const rows: DvRow[] = []
  let token: string | undefined
  do {
    const res = unwrap(await MicrosoftDataverseService.ListRecords(entitySet, PREFER, undefined, undefined, select, filter, orderby, undefined, undefined, top, token) as OpResult<{ value?: unknown[]; '@odata.nextLink'?: string }>)
    rows.push(...(res?.value ?? []).map(plain))
    token = top ? undefined : skipTokenFrom(res?.['@odata.nextLink'])
  } while (token && rows.length < MAX_DATAVERSE_ROWS)
  return rows
}

export const TABLES = {
  knowledge: 'poc_agentknowledgesources',
  sharepoint: 'poc_sharepointagents',
  sharepointRuns: 'poc_sharepointagentloggingruns',
  knowledgeRuns: 'poc_knowledgesweepruns',
  users: 'systemusers',
} as const

export function mapKnowledgeSource(r: DvRow): KnowledgeSource {
  const agentKey = str(r.poc_agentkey)
  return {
    agentKey,
    envId: agentKey.split('|')[0] ?? '',
    agentName: '',
    envName: str(r.poc_environmentname),
    sourceId: str(r.poc_sourceid),
    sourceName: str(r.poc_sourcename),
    sourceKind: str(r.poc_sourcekind),
    knowledgeType: str(r.poc_knowledgetype),
    isExternal: toBool(r.poc_isexternal),
    locator: str(r.poc_locator),
    locatorHost: str(r.poc_locatorhost),
    collectedAt: toTime(r.poc_collectedat),
  }
}

export function mapSharePointAgent(r: DvRow): SharePointAgent {
  return {
    key: str(r.poc_agentkey).trim().toLowerCase(),
    name: str(r.poc_name),
    fileName: str(r.poc_filename),
    siteUrl: str(r.poc_siteurl),
    objectUrl: str(r.poc_objecturl),
    libraryPath: str(r.poc_sourcerelativeurl),
    firstSeenAt: toTime(r.poc_firstseenat),
    lastSeenAt: toTime(r.poc_lastseenat),
    collectedAt: toTime(r.poc_collectedat),
    lastOperation: str(r.poc_lastoperation),
    lastActor: str(r.poc_lastactor),
    applicationName: str(r.poc_applicationname),
    isDeleted: toBool(r.poc_isdeleted),
    eventCount: toInt(r.poc_eventcount),
  }
}

export function mapUsers(rows: DvRow[]): UserRecord[] {
  const out = new Map<string, UserRecord>()
  for (const r of rows) {
    const key = str(r.azureactivedirectoryobjectid).toLowerCase()
    if (!key || out.has(key)) continue
    out.set(key, { key, name: str(r.fullname), upn: str(r.internalemailaddress), type: r.applicationid ? 'application' : 'user' })
  }
  return [...out.values()]
}

async function lastRun(lane: string, label: string, table: string): Promise<RunInfo> {
  try {
    const [row] = await listRecords(table, undefined, undefined, 'createdon desc', 1)
    if (!row) return { lane, table: label, state: 'ok', lastRun: '', status: 'No runs recorded yet' }
    const fmt = (k: string) => str(row[`${k}@OData.Community.Display.V1.FormattedValue`]) || str(row[k])
    return {
      lane,
      table: label,
      state: 'ok',
      lastRun: toTime(row.poc_finishedat) || toTime(row.poc_startedat) || toTime(row.createdon),
      status: fmt('poc_status') || fmt('statuscode') || 'Recorded',
    }
  } catch (e) {
    const c = classifyError(e, true)
    return { lane, table: label, state: c.state === 'not-set-up' ? 'not-set-up' : 'error', lastRun: '', status: c.state === 'not-set-up' ? 'Not set up' : 'Could not read', detail: c.detail }
  }
}

/* ---------- Lane F: Defender advanced hunting (the API is due to retire in February 2027) ---------- */

export async function advancedHunting(query: string): Promise<Record<string, unknown>[]> {
  const res = unwrap(await MicrosoftDefenderATPService.AdvancedHunting({ Query: query }) as OpResult<Record<string, unknown>>)
  const rows = (res?.Results ?? res?.results ?? []) as unknown
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}

/* ---------- orchestration ---------- */

const LANES: Record<LaneId, { label: string; connector: string }> = {
  agents: { label: 'Agents (Power Platform inventory)', connector: 'powerplatformadminv2' },
  environments: { label: 'Environments', connector: 'powerplatformadminv2' },
  usage: { label: 'Usage records (last used)', connector: 'powerplatformadminv2' },
  flows: { label: 'Agent flows', connector: 'powerplatformadminv2' },
  foundry: { label: 'Azure AI Foundry', connector: 'arm' },
  users: { label: 'Directory users (names)', connector: 'commondataserviceforapps' },
  knowledge: { label: 'Named knowledge sources', connector: 'commondataserviceforapps' },
  sharepoint: { label: 'SharePoint agents', connector: 'commondataserviceforapps' },
  shadow: { label: 'Shadow AI (Defender)', connector: 'wdatp' },
}

async function lane<T>(id: LaneId, run: () => Promise<{ rows: T[]; detail?: string }>, dataverse = false): Promise<{ rows: T[]; status: LaneStatus }> {
  const started = performance.now()
  try {
    const r = await run()
    return { rows: r.rows, status: { id, ...LANES[id], state: r.rows.length ? 'ok' : 'empty', rows: r.rows.length, detail: r.detail, ms: Math.round(performance.now() - started) } }
  } catch (e) {
    const c = classifyError(e, dataverse)
    return { rows: [], status: { id, ...LANES[id], state: c.state, rows: 0, detail: c.detail, ms: Math.round(performance.now() - started) } }
  }
}

async function appEnvironmentId(): Promise<string | undefined> {
  try {
    return (await getContext()).app.environmentId
  } catch {
    return undefined
  }
}

export type LaneProgress = (status: LaneStatus) => void

export async function loadLive(onLane?: LaneProgress, now = new Date()): Promise<Dataset> {
  const report = <T,>(p: Promise<{ rows: T[]; status: LaneStatus }>) => p.then((r) => (onLane?.(r.status), r))
  const [agentItems, envs, usage, flowItems, foundry, users, sources, spAgents, shadow, runs, appEnv] = await Promise.all([
    report(lane('agents', async () => ({ rows: await queryPowerPlatform('microsoft.copilotstudio/agents') }))),
    report(lane('environments', async () => ({ rows: (await queryPowerPlatform('microsoft.powerplatform/environments')).map(projectEnvironment) }))),
    report(lane('usage', async () => ({ rows: await queryPowerPlatform('microsoft.powerplatformusage/usagerecords') }))),
    report(lane('flows', async () => ({ rows: await queryPowerPlatform(['microsoft.powerautomate/agentflows', 'microsoft.powerautomate/m365agentflows']) }))),
    report(lane('foundry', async () => {
      const r = await loadFoundry()
      return { rows: r.resources, detail: foundryDetail(r) }
    })),
    report(lane('users', async () => ({
      rows: mapUsers(await listRecords(TABLES.users, 'azureactivedirectoryobjectid,fullname,internalemailaddress,applicationid', 'azureactivedirectoryobjectid ne null')),
    }), true)),
    report(lane('knowledge', async () => ({
      rows: (await listRecords(TABLES.knowledge, 'poc_sourceid,poc_agentkey,poc_sourcename,poc_knowledgetype,poc_sourcekind,poc_isexternal,poc_locator,poc_locatorhost,poc_collectedat,poc_environmentname'))
        .map(mapKnowledgeSource).filter((s) => s.agentKey),
    }), true)),
    report(lane('sharepoint', async () => ({ rows: (await listRecords(TABLES.sharepoint)).map(mapSharePointAgent) }), true)),
    report(lane('shadow', async () => {
      const [installed, executed, network, devInstalled, devExecuted] = await Promise.allSettled([
        advancedHunting(KQL.installed()), advancedHunting(KQL.executed()), advancedHunting(KQL.network()),
        advancedHunting(KQL.deviceInstalled()), advancedHunting(KQL.deviceExecuted()),
      ])
      const all = [installed, executed, network, devInstalled, devExecuted]
      const failed = all.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failed.length === all.length) throw failed[0].reason
      const ok = (r: PromiseSettledResult<Record<string, unknown>[]>) => (r.status === 'fulfilled' ? r.value : [])
      const signals = [...mapInstalled(ok(installed)), ...mapExecuted(ok(executed)), ...mapNetwork(ok(network))]
      return {
        rows: [{ signals, devices: mapDevices(ok(devInstalled), ok(devExecuted)) }].filter(() => signals.length > 0),
        detail: failed.length ? `${failed.length} of ${all.length} hunting queries failed.` : undefined,
      }
    })),
    Promise.all([
      lastRun('sharepoint', 'SharePoint agent logging runs', TABLES.sharepointRuns),
      lastRun('knowledge', 'Knowledge sweep runs', TABLES.knowledgeRuns),
    ]),
    appEnvironmentId(),
  ])

  const usageMap = projectUsage(usage.rows)
  const projects = foundry.rows.filter(isFoundryProject)
  const raw: RawData = {
    ...emptyRaw(),
    agents: [
      ...joinAgents(agentItems.rows.map(projectAgent), usageMap, envs.rows),
      ...projects.map(projectFoundryAgent),
    ],
    environments: envs.rows,
    flows: flowItems.rows.map((f) => projectFlow(f, usageMap)),
    connectors: agentItems.rows.flatMap(projectConnectors),
    knowledge: agentItems.rows.flatMap(projectKnowledge),
    sources: sources.rows,
    spAgents: spAgents.rows,
    aiResources: foundry.rows.filter((r) => !str(r.type).toLowerCase().endsWith('deployments')).map(projectAzureAIResource),
    users: users.rows,
    shadowSignals: shadow.rows[0]?.signals ?? [],
    shadowDevices: shadow.rows[0]?.devices ?? [],
  }
  const shadowStatus: LaneStatus = { ...shadow.status, rows: raw.shadowSignals.length }

  return buildDataset(raw, {
    mode: 'live',
    asOf: now.toISOString().slice(0, 19),
    lanes: [
      agentItems.status, envs.status, usage.status, flowItems.status, foundry.status, users.status, sources.status, spAgents.status, shadowStatus,
    ],
    runs,
    namesResolved: users.rows.length > 0,
    appEnvironment: appEnv,
  })
}