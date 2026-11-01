import type {
  ActivityStatus, Agent, AgentBase, AgentConnector, AgentFlow, AgentKnowledge, AzureAIResource, Environment,
  RiskBand, RiskDetail, UserRecord,
} from './types'

/* ---------- value coercion (FnToDateTime / FnToLogical / FnToInt) ---------- */

export const ZERO_GUID = '00000000-0000-0000-0000-000000000000'

export function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = str(v).trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
}

export function toInt(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0
  const n = parseInt(str(v), 10)
  return Number.isFinite(n) ? n : 0
}

/** Normalises any date-ish value to a zone-less "yyyy-mm-ddThh:mm:ss" string, or "" when absent. */
export function toTime(v: unknown): string {
  const s = str(v).trim()
  if (!s) return ''
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(:\d{2})?)?/.exec(s)
  if (m) return `${m[1]}T${m[2] ?? '00:00'}${m[3] ?? ':00'}`
  const t = Date.parse(s)
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 19)
}

const ms = (t: string) => Date.parse(t + 'Z')

/** Duration.Days(to - from): whole elapsed days. */
export function elapsedDays(from: string, to: string): number | null {
  if (!from || !to) return null
  return Math.floor((ms(to) - ms(from)) / 86_400_000)
}

/** DATEDIFF(from, to, DAY): calendar-day boundaries crossed. */
export function dayBoundaries(from: string, to: string): number | null {
  if (!from || !to) return null
  return Math.round((ms(to.slice(0, 10) + 'T00:00:00') - ms(from.slice(0, 10) + 'T00:00:00')) / 86_400_000)
}

/* ---------- Lane A projections (the KQL `project` clauses, done in TypeScript) ---------- */

export interface ArgItem {
  id?: string
  name?: string
  type?: string
  kind?: string
  location?: string
  resourceGroup?: string
  subscriptionId?: string
  sku?: unknown
  properties?: Record<string, unknown>
}

type Bag = Record<string, unknown>
const bag = (v: unknown): Bag => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Bag) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function agentKeyOf(item: ArgItem): string {
  return `${str(item.properties?.environmentId)}|${str(item.name)}`
}

/** Port of the Agent partition's RawAgents projection. */
export function projectAgent(item: ArgItem): AgentBase {
  const p = bag(item.properties)
  const cc = bag(p.componentsCounts)
  const cap = bag(p.capabilitiesCounts)
  const sv = bag(p.sharedWithViewers)
  const se = bag(p.sharedWithEditors)
  const kbt = bag(cc.knowledgeByType)
  const channels = arr(p.channels).map(str)
  return {
    key: agentKeyOf(item),
    id: str(item.name),
    name: str(p.displayName),
    authoringSurface: str(p.createdIn),
    envId: str(p.environmentId),
    envName: '',
    envType: '',
    region: str(item.location),
    schemaName: str(p.schemaName),
    orchestration: str(p.orchestration),
    model: str(p.model),
    // Resource Graph omits null-valued fields, and an absent authentication property deliberately does not score.
    authentication: p.authentication === undefined || p.authentication === null ? null : str(p.authentication),
    createdAt: toTime(p.createdAt),
    lastPublishedAt: toTime(p.lastPublishedAt),
    lastUsed: '',
    isQuarantined: toBool(p.isQuarantined),
    isManaged: toBool(p.isManaged),
    isGithubCopilotAgent: toBool(p.isGithubCopilotAgent),
    isCLIAgent: toBool(p.isCLIAgent),
    webSearch: toBool(p.isWebSearchEnabledForKnowledge),
    channels: channels.join('; '),
    channelCount: channels.length,
    topicCount: toInt(cc.topics),
    toolCount: toInt(cc.tools),
    knowledgeCount: toInt(cc.knowledge),
    connectedAgentCount: toInt(cc.connectedAgents),
    connectorCount: toInt(cap.distinctPowerPlatformConnectors),
    connectorOpsCount: toInt(cap.distinctPowerPlatformConnectorsOperations),
    flowCount: toInt(cap.distinctFlows),
    sharedUserCount: toInt(sv.userCount),
    sharedGroupCount: toInt(sv.groupCount),
    sharedTenantWide: toBool(sv.entireTenant),
    editorUserCount: toInt(se.userCount),
    ownerId: str(p.ownerId),
    createdBy: str(p.createdBy),
    entraAppId: str(p.entraAppId),
    entraAgentId: str(p.entraAgentId),
    blueprintId: str(p.entraAgentBlueprintId),
    harness: str(p.harness),
    instructionsCharCount: toInt(p.instructionsCharactersCount),
    quarantinedAt: toTime(p.quarantinedAt),
    knowledgeTypes: Object.keys(kbt).join('; '),
    graphConnectorCount: toInt(kbt.graphConnectors),
    sharePointSiteCount: toInt(kbt.sharepointSites),
    publicSiteCount: toInt(kbt.publicSites),
    fileKnowledgeCount: toInt(kbt.files),
    dataverseSourceCount: toInt(kbt.dataverseSources),
    titleId: str(p.titleId),
  }
}

/** Usage records: max lastUsed per resource id. */
export function projectUsage(items: ArgItem[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const it of items) {
    const p = bag(it.properties)
    const key = str(p.resourceId).toLowerCase()
    const raw = str(p.lastUsed)
    if (!key || !raw) continue
    const t = toTime(raw)
    const prev = out.get(key)
    if (!prev || t > prev) out.set(key, t)
  }
  return out
}

export function projectEnvironment(item: ArgItem): Environment {
  const p = bag(item.properties)
  return {
    id: str(item.name),
    name: str(p.displayName),
    region: str(item.location),
    type: str(p.environmentType),
    isManaged: toBool(p.isManaged),
    groupId: str(p.environmentGroupId),
    createdAt: toTime(p.createdAt),
    lastModifiedAt: toTime(p.lastModifiedAt),
    createdBy: str(p.createdBy),
  }
}

export function projectFlow(item: ArgItem, usage: Map<string, string>): AgentFlow {
  const p = bag(item.properties)
  const id = str(item.name)
  return {
    id,
    name: str(p.displayName),
    type: str(item.type).toLowerCase().includes('m365agentflows') ? 'M365 Agent Flow' : 'Agent Flow',
    envId: str(p.environmentId),
    state: str(p.state),
    createdAt: toTime(p.createdAt),
    region: str(item.location),
    lastUsed: usage.get(id.toLowerCase()) ?? '',
  }
}

/** AgentConnector partition: mv-expand of powerPlatformConnectors. */
export function projectConnectors(item: ArgItem): AgentConnector[] {
  const p = bag(item.properties)
  const key = agentKeyOf(item)
  return arr(p.powerPlatformConnectors)
    .filter((c) => c !== null && c !== undefined)
    .map((c) => {
      const conn = bag(c)
      const ops = conn.operations
      return {
        agentKey: key,
        connectorId: str(conn.connectorId),
        operationCount: arr(ops).length,
        isMcp: /"type":"MCP"/.test(JSON.stringify(ops ?? null)),
      }
    })
}

const KNOWLEDGE_TYPE: Record<string, string> = {
  files: 'Uploaded files',
  fileGroups: 'File groups',
  publicSites: 'Public websites',
  sharepointSites: 'SharePoint sites',
  dataverseSources: 'Dataverse tables',
  graphConnectors: 'Microsoft Graph connectors',
  powerPlatformConnectors: 'Power Platform connectors',
  bingCustomSearch: 'Bing custom search',
  teamsMessages: 'Teams messages',
  webSearch: 'Web search',
}

export const knowledgeTypeLabel = (k: string) => KNOWLEDGE_TYPE[k] ?? k

/** AgentKnowledge partition: one row per knowledge type with a positive count, plus web search. */
export function projectKnowledge(item: ArgItem): AgentKnowledge[] {
  const p = bag(item.properties)
  const kbt = bag(bag(p.componentsCounts).knowledgeByType)
  const key = agentKeyOf(item)
  const rows: AgentKnowledge[] = []
  for (const [k, v] of Object.entries(kbt)) {
    const n = toInt(v)
    if (n > 0) rows.push({ agentKey: key, type: knowledgeTypeLabel(k), count: n })
  }
  if (toBool(p.isWebSearchEnabledForKnowledge)) rows.push({ agentKey: key, type: 'Web search', count: 1 })
  return rows
}

/* ---------- Foundry (ARM) ---------- */

const segment = (id: string, name: string) => {
  const m = new RegExp(`/${name}/([^/]+)`, 'i').exec(id)
  return m ? m[1] : ''
}

export const isFoundryProject = (r: ArgItem) =>
  str(r.type).toLowerCase().endsWith('accounts/projects') || str(r.kind) === 'Project'

export function projectAzureAIResource(r: ArgItem): AzureAIResource {
  const p = bag(r.properties)
  const id = str(r.id)
  const name = str(r.name)
  const kind = str(r.kind)
  const isProject = isFoundryProject(r)
  const category = isProject ? 'Foundry project' : kind === 'AIServices' ? 'AI Foundry account' : kind === 'Hub' ? 'Foundry hub' : kind === 'OpenAI' ? 'Azure OpenAI' : kind
  return {
    id,
    name: name.split('/').pop() ?? name,
    parentAccount: name.includes('/') ? name.split('/')[0] : '',
    type: str(r.type),
    kind,
    category,
    isAgentHost: isProject,
    region: str(r.location),
    resourceGroup: r.resourceGroup ?? segment(id, 'resourceGroups'),
    subscriptionId: r.subscriptionId ?? segment(id, 'subscriptions'),
    sku: str(bag(r.sku).name),
    publicAccess: str(p.publicNetworkAccess),
    localAuthOff: toBool(p.disableLocalAuth),
    createdAt: toTime(p.createdAtDate),
  }
}

/** The Foundry branch of the Agent partition: one "agent" row per Foundry project. */
export function projectFoundryAgent(r: ArgItem): AgentBase {
  const id = str(r.id)
  const name = str(r.name)
  return {
    key: id,
    id,
    name: name.split('/').pop() ?? name,
    authoringSurface: 'Azure AI Foundry',
    envId: r.subscriptionId ?? segment(id, 'subscriptions'),
    envName: name.includes('/') ? name.split('/')[0] : name,
    envType: 'Azure subscription',
    region: str(r.location),
    schemaName: '',
    orchestration: 'Generative',
    model: 'See deployments',
    authentication: 'Microsoft Entra',
    createdAt: toTime(bag(r.properties).createdAtDate),
    lastPublishedAt: '',
    lastUsed: '',
    isQuarantined: false,
    isManaged: true,
    isGithubCopilotAgent: false,
    isCLIAgent: false,
    webSearch: false,
    channels: 'API / SDK',
    channelCount: 1,
    topicCount: 0,
    toolCount: 0,
    knowledgeCount: 0,
    connectedAgentCount: 0,
    connectorCount: 0,
    connectorOpsCount: 0,
    flowCount: 0,
    sharedUserCount: 0,
    sharedGroupCount: 0,
    sharedTenantWide: false,
    editorUserCount: 0,
    ownerId: '',
    createdBy: '',
    entraAppId: '',
    entraAgentId: '',
    blueprintId: '',
    harness: '',
    instructionsCharCount: 0,
    quarantinedAt: '',
    knowledgeTypes: '',
    graphConnectorCount: 0,
    sharePointSiteCount: 0,
    publicSiteCount: 0,
    fileKnowledgeCount: 0,
    dataverseSourceCount: 0,
    titleId: '',
    platform: 'Azure AI Foundry',
  }
}

/** Joins usage and environment names onto the Copilot Studio agents, as the Agent partition does. */
export function joinAgents(agents: AgentBase[], usage: Map<string, string>, envs: Environment[]): AgentBase[] {
  // Power BI relationships ignore case, and the sources disagree on the case of environment ids.
  const envById = new Map(envs.map((e) => [e.id.toLowerCase(), e]))
  return agents.map((a) => {
    const env = envById.get(a.envId.toLowerCase())
    const envName = a.envName || env?.name || ''
    return {
      ...a,
      lastUsed: a.lastUsed || usage.get(a.id.toLowerCase()) || '',
      envName: envName || `Unlisted: ${a.envId}`,
      envType: a.envType || env?.type || 'Unknown',
      model: a.model || 'Not specified',
    }
  })
}

/* ---------- risk scoring (Agent partition + RiskDetail partition) ---------- */

export const RISK_RULES: { factor: string; points: number; fires: (a: AgentBase) => boolean }[] = [
  { factor: 'No authentication configured', points: 3, fires: (a) => a.authentication === 'None' || a.authentication === 'No authentication' || a.authentication === '' },
  { factor: 'Agent is quarantined', points: 3, fires: (a) => a.isQuarantined },
  { factor: 'Shared with the entire tenant', points: 2, fires: (a) => a.sharedTenantWide },
  { factor: 'Shared tenant-wide and never used', points: 1, fires: (a) => a.sharedTenantWide && !a.lastUsed },
  { factor: 'Web search enabled on knowledge', points: 1, fires: (a) => a.webSearch },
  { factor: 'Uses one or more connectors', points: 1, fires: (a) => a.connectorCount > 0 },
  { factor: 'Connected to other agents', points: 1, fires: (a) => a.connectedAgentCount > 0 },
]

export function riskFactors(a: AgentBase) {
  return RISK_RULES.filter((r) => r.fires(a)).map((r) => ({ factor: r.factor, points: r.points }))
}

export const riskBand = (score: number): RiskBand => (score >= 5 ? 'High' : score >= 3 ? 'Medium' : 'Low')

export function activityStatus(days: number | null): ActivityStatus {
  if (days === null) return 'No usage signal'
  if (days <= 7) return 'Active (7d)'
  if (days <= 30) return 'Active (30d)'
  if (days <= 90) return 'Idle (90d)'
  return 'Dormant (90d+)'
}

export const isActive30 = (s: string) => s === 'Active (7d)' || s === 'Active (30d)'

export function platformOf(a: AgentBase): string {
  if (a.platform) return a.platform
  if (a.authoringSurface === 'Copilot Studio Lite') return 'M365 Copilot Agent Builder'
  if (!a.authoringSurface) return 'Copilot Studio'
  return a.authoringSurface
}

/* ---------- final agent table (Agent partition + calculated columns) ---------- */

export interface FinaliseOptions {
  asOf: string
  users: UserRecord[]
  /** False in live mode when no user directory could be read; ids then stand in for names. */
  namesResolved: boolean
}

export function finaliseAgents(bases: AgentBase[], opt: FinaliseOptions): { agents: Agent[]; riskDetail: RiskDetail[] } {
  const users = new Map(opt.users.map((u) => [u.key.toLowerCase(), u]))
  const seen = new Set<string>()
  const agents: Agent[] = []
  const riskDetail: RiskDetail[] = []
  for (const b of bases) {
    if (seen.has(b.key)) continue
    seen.add(b.key)
    const factors = riskFactors(b)
    const score = factors.reduce((s, f) => s + f.points, 0)
    for (const f of factors) riskDetail.push({ agentKey: b.key, factor: f.factor, points: f.points })

    const creator = b.createdBy ? users.get(b.createdBy.toLowerCase()) : undefined
    const owner = b.ownerId ? users.get(b.ownerId.toLowerCase()) : undefined
    const createdByName = b.createdBy === ZERO_GUID ? 'System / platform' : opt.namesResolved ? creator?.name ?? '' : b.createdBy
    const ownerName = b.ownerId === ZERO_GUID ? 'System / platform' : opt.namesResolved ? owner?.name ?? '' : b.ownerId
    const ownerPrincipalType = owner?.type ? owner.type : 'Not resolved in Entra'

    const agentOrigin = !createdByName ? 'Creator unknown' : createdByName === 'System / platform' ? 'Platform-provisioned' : 'Human-built'
    const creatorCategory =
      b.isManaged && (!createdByName || createdByName === 'System / platform') ? 'Microsoft'
        : !createdByName ? 'Unattributed'
          : b.blueprintId ? 'Built from Microsoft blueprint' : 'Your organization'

    agents.push({
      ...b,
      platform: platformOf(b),
      isPublished: !!b.lastPublishedAt,
      createdByName,
      ownerName,
      ownerUpn: owner?.upn ?? '',
      ownerPrincipalType,
      daysSinceLastUse: elapsedDays(b.lastUsed, opt.asOf),
      ageDays: elapsedDays(b.createdAt, opt.asOf),
      createdMonth: b.createdAt.slice(0, 7),
      lastUsedMonth: b.lastUsed.slice(0, 7),
      activityStatus: activityStatus(dayBoundaries(b.lastUsed, opt.asOf)),
      riskScore: score,
      riskBand: riskBand(score),
      riskFactorCount: factors.length,
      riskReasons: factors.length ? factors.map((f) => `${f.factor} (+${f.points})`).join('; ') : 'No risk factors detected',
      agentOrigin,
      creatorCategory,
      hasOwner: !!ownerName,
      hasInstructions: b.instructionsCharCount > 0,
      knowledgeTypeCount: b.knowledgeTypes ? b.knowledgeTypes.split('; ').length : 0,
      hasGraphConnector: b.graphConnectorCount > 0,
    })
  }
  return { agents, riskDetail }
}

