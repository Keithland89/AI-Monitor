import Papa from 'papaparse'
import { buildDataset } from './build'
import { usageDate } from './cost'
import { parseM365, type M365ReportRow } from './m365'
import { toBool, toInt, toTime } from './transforms'
import type {
  AgentBase, AgentConnector, AgentCredit, AgentFlow, AgentKnowledge, AiCostDaily, AiCostMeter, AzureAIResource, CopilotSurface, CreditPool, Dataset,
  Environment, Interaction, KnowledgeSource, LaneStatus, RawData, SharePointAgent, ShadowDevice, ShadowSignal, UserRecord,
} from './types'

export const SAMPLE_FILES = [
  'agents', 'environments', 'flows', 'ai-resources', 'sharepoint-agents', 'users', 'shadow-signals', 'shadow-devices',
  'connectors', 'knowledge', 'knowledge-sources', 'surfaces', 'interaction-users', 'interactions',
  'credits', 'credit-pool', 'ai-cost-daily', 'ai-cost-meters',
] as const

export type SampleFile = (typeof SAMPLE_FILES)[number]
/** The Microsoft 365 usage reports ship as JSON, in the same shape the daily flow stores in Dataverse. */
export const SAMPLE_M365 = 'm365-usage.json'

export type SampleTexts = Record<SampleFile, string> & { manifest: string; m365?: string }

type Row = Record<string, string>

const parse = (text: string): Row[] =>
  Papa.parse<Row>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data

export function sampleAgent(r: Row): AgentBase {
  return {
    key: r.AgentKey,
    id: r.AgentId,
    name: r.AgentName,
    authoringSurface: r.AuthoringSurface,
    envId: r.EnvironmentId,
    envName: r.EnvironmentName,
    envType: r.EnvironmentType,
    region: r.Region,
    schemaName: r.SchemaName,
    orchestration: r.Orchestration,
    model: r.Model,
    // CSV cannot tell null from "", and the model's empty values came from absent properties.
    authentication: r.Authentication ? r.Authentication : null,
    createdAt: toTime(r.CreatedAt),
    lastPublishedAt: toTime(r.LastPublishedAt),
    lastUsed: toTime(r.LastUsed),
    isQuarantined: toBool(r.IsQuarantined),
    isManaged: toBool(r.IsManaged),
    isGithubCopilotAgent: toBool(r.IsGithubCopilotAgent),
    isCLIAgent: toBool(r.IsCLIAgent),
    webSearch: toBool(r.WebSearchEnabled),
    channels: r.Channels,
    channelCount: toInt(r.ChannelCount),
    topicCount: toInt(r.TopicCount),
    toolCount: toInt(r.ToolCount),
    knowledgeCount: toInt(r.KnowledgeCount),
    connectedAgentCount: toInt(r.ConnectedAgentCount),
    connectorCount: toInt(r.ConnectorCount),
    connectorOpsCount: toInt(r.ConnectorOpsCount),
    flowCount: toInt(r.FlowCount),
    sharedUserCount: toInt(r.SharedUserCount),
    sharedGroupCount: toInt(r.SharedGroupCount),
    sharedTenantWide: toBool(r.SharedTenantWide),
    editorUserCount: toInt(r.EditorUserCount),
    ownerId: r.OwnerId,
    createdBy: r.CreatedBy,
    entraAppId: r.EntraAppId,
    entraAgentId: r.EntraAgentId,
    blueprintId: r.EntraAgentBlueprintId,
    harness: r.Harness,
    instructionsCharCount: toInt(r.InstructionsCharCount),
    quarantinedAt: toTime(r.QuarantinedAt),
    knowledgeTypes: r.KnowledgeTypes,
    graphConnectorCount: toInt(r.GraphConnectorCount),
    sharePointSiteCount: toInt(r.SharePointSiteCount),
    publicSiteCount: toInt(r.PublicSiteCount),
    fileKnowledgeCount: toInt(r.FileKnowledgeCount),
    dataverseSourceCount: toInt(r.DataverseSourceCount),
    titleId: r.TitleId,
    platform: r.Platform === 'Azure AI Foundry' ? r.Platform : undefined,
  }
}

export function sampleRaw(t: SampleTexts): RawData {
  const environments: Environment[] = parse(t.environments).map((r) => ({
    id: r.EnvironmentId, name: r.EnvironmentName, region: r.Region, type: r.EnvironmentType, isManaged: toBool(r.IsManaged),
    groupId: r.EnvironmentGroupId, createdAt: toTime(r.CreatedAt), lastModifiedAt: toTime(r.LastModifiedAt), createdBy: r.CreatedBy,
  }))
  const flows: AgentFlow[] = parse(t.flows).map((r) => ({
    id: r.FlowId, name: r.FlowName, type: r.FlowType, envId: r.EnvironmentId, state: r.State, createdAt: toTime(r.CreatedAt),
    region: r.Region, lastUsed: toTime(r.LastUsed),
  }))
  const aiResources: AzureAIResource[] = parse(t['ai-resources']).map((r) => ({
    id: r.ResourceId, name: r.ResourceName, parentAccount: r.ParentAccount, type: r.ResourceType, kind: r.Kind, category: r.Category,
    isAgentHost: toBool(r.IsAgentHost), region: r.Region, resourceGroup: r.ResourceGroup, subscriptionId: r.SubscriptionId, sku: r.Sku,
    publicAccess: r.PublicAccess, localAuthOff: toBool(r.LocalAuthOff), createdAt: toTime(r.CreatedAt),
  }))
  const spAgents: SharePointAgent[] = parse(t['sharepoint-agents']).map((r) => ({
    key: r.AgentKey.trim().toLowerCase(), name: r.AgentName, fileName: r.FileName, siteUrl: r.SiteUrl, objectUrl: r.ObjectUrl,
    libraryPath: r.LibraryPath, firstSeenAt: toTime(r.FirstSeenAt), lastSeenAt: toTime(r.LastSeenAt), collectedAt: toTime(r.CollectedAt),
    lastOperation: r.LastOperation, lastActor: r.LastActor, applicationName: r.ApplicationName, isDeleted: toBool(r.IsDeleted),
    eventCount: toInt(r.EventCount),
  }))
  const users: UserRecord[] = parse(t.users).map((r) => ({ key: r.UserKey.toLowerCase(), name: r.DisplayName, upn: r.UserPrincipalName, type: r.PrincipalType }))
  const shadowSignals: ShadowSignal[] = parse(t['shadow-signals']).map((r) => ({
    layer: r.Layer, category: r.Category, vendor: r.Vendor, appName: r.AppName, posture: r.Posture, detected: r.Detected,
    deviceCount: toInt(r.DeviceCount), userCount: r.UserCount ? toInt(r.UserCount) : null, lastSeen: toTime(r.LastSeen),
  }))
  const shadowDevices: ShadowDevice[] = parse(t['shadow-devices']).map((r) => ({
    layer: r.Layer, deviceName: r.DeviceName, appName: r.AppName, posture: r.Posture, detected: r.Detected, detail: r.Detail,
    userUpn: r.UserUpn, lastSeen: toTime(r.LastSeen),
  }))
  const connectors: AgentConnector[] = parse(t.connectors).map((r) => ({
    agentKey: r.AgentKey, connectorId: r.ConnectorId, operationCount: toInt(r.OperationCount), isMcp: toBool(r.IsMcpServer),
  }))
  const knowledge: AgentKnowledge[] = parse(t.knowledge).map((r) => ({ agentKey: r.AgentKey, type: r.KnowledgeType, count: toInt(r.SourceCount) }))
  const sources: KnowledgeSource[] = parse(t['knowledge-sources']).map((r) => ({
    agentKey: r.AgentKey, envId: r.EnvironmentId, agentName: r.AgentName, envName: r.EnvironmentName, sourceId: r.SourceId,
    sourceName: r.SourceName, sourceKind: r.SourceKind, knowledgeType: r.KnowledgeType, isExternal: toBool(r.IsExternal),
    locator: r.Locator, locatorHost: r.LocatorHost, collectedAt: toTime(r.CollectedAt),
  }))
  const surfaceRows = parse(t.surfaces)
  const surfaces: CopilotSurface[] = surfaceRows.map((r) => ({
    key: r.SurfaceKey, name: r.SurfaceName, type: r.SurfaceType, platform: r.Platform, isAgent: toBool(r.IsAgent), agentKey: r.AgentKey,
    matchOn: r.MatchOn, isMatched: toBool(r.IsMatched), spAgentKey: '',
  }))
  const upns = parse(t['interaction-users']).map((r) => r.UserPrincipalName)
  const interactions: Interaction[] = parse(t.interactions).map((r) => {
    const time = toTime(r.CreationTime)
    const s = surfaces[toInt(r.Surface)]
    return {
      date: time.slice(0, 10),
      time,
      surfaceKey: s?.key ?? '',
      agentKey: s?.agentKey ?? '',
      user: upns[toInt(r.User)] ?? '',
      appHost: r.AppHost,
      threadId: `t${r.Thread}`,
      resourceCount: toInt(r.ResourceCount),
    }
  })
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const credits: AgentCredit[] = parse(t.credits).map((r) => ({
    agentKey: r.AgentKey, envId: r.EnvironmentId, resourceId: r.ResourceId, feature: r.Feature, product: r.ProductName,
    billed: num(r.BilledCredits), nonBilled: num(r.NonBilledCredits), lastRefreshed: toTime(r.LastRefreshed),
  }))
  const creditPool: CreditPool[] = parse(t['credit-pool']).map((r) => ({
    currency: r.CurrencyType, purchased: num(r.Purchased), allocated: num(r.Allocated), consumed: num(r.Consumed), lastUpdated: toTime(r.LastUpdated),
  }))
  const aiCostDaily: AiCostDaily[] = parse(t['ai-cost-daily']).map((r) => ({
    date: usageDate(r.UsageDate), resourceId: r.ResourceId.toLowerCase(), cost: num(r.Cost), currency: r.Currency,
  }))
  const aiCostMeters: AiCostMeter[] = parse(t['ai-cost-meters']).map((r) => ({
    resourceId: r.ResourceId.toLowerCase(), meter: r.Meter, cost: num(r.Cost), currency: r.Currency,
  }))
  return {
    agents: parse(t.agents).map(sampleAgent),
    environments, flows, connectors, knowledge, sources, spAgents, aiResources, interactions, surfaces, users, shadowSignals, shadowDevices,
    credits, creditPool, aiCostDaily, aiCostMeters,
    m365: t.m365 ? parseM365(JSON.parse(t.m365) as M365ReportRow[]) : undefined,
  }
}

const SAMPLE_LANES: Omit<LaneStatus, 'state' | 'rows'>[] = [
  { id: 'agents', label: 'Agents (Power Platform inventory)', connector: 'powerplatformadminv2' },
  { id: 'environments', label: 'Environments', connector: 'powerplatformadminv2' },
  { id: 'flows', label: 'Agent flows', connector: 'powerplatformadminv2' },
  { id: 'foundry', label: 'Azure AI Foundry', connector: 'arm' },
  { id: 'users', label: 'Directory users (names)', connector: 'commondataserviceforapps' },
  { id: 'interactions', label: 'Copilot interactions (audit log)', connector: 'commondataserviceforapps' },
  { id: 'knowledge', label: 'Named knowledge sources', connector: 'commondataserviceforapps' },
  { id: 'sharepoint', label: 'SharePoint agents', connector: 'commondataserviceforapps' },
  { id: 'shadow', label: 'Shadow AI (Defender)', connector: 'wdatp' },
  { id: 'credits', label: 'Copilot Credits per agent', connector: 'powerplatformadminv2' },
  { id: 'creditpool', label: 'Tenant capacity (credit pool)', connector: 'powerplatformadminv2' },
  { id: 'aicost', label: 'Azure AI spend (Cost Management)', connector: 'arm' },
  { id: 'm365usage', label: 'Microsoft 365 usage reports', connector: 'commondataserviceforapps' },
]

const SYNTHETIC_COST = 'Synthetic: the anonymised source has no cost data, so these rows are generated from the sample agents and resources.'

export function sampleDataset(t: SampleTexts): Dataset {
  const raw = sampleRaw(t)
  const manifest = JSON.parse(t.manifest) as { asOf: string }
  const rows: Record<string, number> = {
    agents: raw.agents.length, environments: raw.environments.length, flows: raw.flows.length, foundry: raw.aiResources.length,
    users: raw.users.length, interactions: raw.interactions.length, knowledge: raw.sources.length, sharepoint: raw.spAgents.length,
    shadow: raw.shadowSignals.length, credits: raw.credits.length, creditpool: raw.creditPool.length, aicost: raw.aiCostDaily.length,
    m365usage: raw.m365 ? 1 : 0,
  }
  const lanes: LaneStatus[] = SAMPLE_LANES.map((l) => ({
    ...l,
    state: 'sample',
    rows: rows[l.id] ?? 0,
    detail:
      l.id === 'shadow' && rows.shadow === 0
        ? 'The sample ships no Defender rows: the source tenant returned 403 for advanced hunting.'
        : l.id === 'credits' || l.id === 'creditpool' || l.id === 'aicost'
          ? SYNTHETIC_COST
          : l.id === 'm365usage'
            ? 'Synthetic: tenant-wide counts generated to match the sample\'s size.'
            : undefined,
  }))
  return buildDataset(raw, {
    mode: 'sample',
    asOf: toTime(manifest.asOf),
    lanes,
    runs: [
      { lane: 'interactions', table: 'Copilot interaction flow runs', state: 'sample', lastRun: toTime(manifest.asOf), status: 'Sample' },
      { lane: 'sharepoint', table: 'SharePoint agent logging runs', state: 'sample', lastRun: toTime(manifest.asOf), status: 'Sample' },
      { lane: 'knowledge', table: 'Knowledge sweep runs', state: 'sample', lastRun: toTime(manifest.asOf), status: 'Sample' },
    ],
    namesResolved: true,
  })
}

export async function loadSample(base = import.meta.env.BASE_URL): Promise<Dataset> {
  const get = async (name: string) => {
    const res = await fetch(`${base}sample/${name}`)
    if (!res.ok) throw new Error(`Sample file ${name} returned ${res.status}`)
    return res.text()
  }
  const entries = await Promise.all(SAMPLE_FILES.map(async (f) => [f, await get(`${f}.csv`)] as const))
  const texts = { ...Object.fromEntries(entries), manifest: await get('manifest.json'), m365: await get(SAMPLE_M365) } as SampleTexts
  return sampleDataset(texts)
}

