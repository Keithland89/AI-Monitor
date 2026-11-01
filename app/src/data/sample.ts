import Papa from 'papaparse'
import { buildDataset } from './build'
import { toBool, toInt, toTime } from './transforms'
import type {
  AgentBase, AgentConnector, AgentFlow, AgentKnowledge, AzureAIResource, Dataset, Environment, KnowledgeSource, LaneStatus, RawData, SharePointAgent, ShadowDevice, ShadowSignal, UserRecord,
} from './types'

export const SAMPLE_FILES = [
  'agents', 'environments', 'flows', 'ai-resources', 'sharepoint-agents', 'users', 'shadow-signals', 'shadow-devices',
  'connectors', 'knowledge', 'knowledge-sources',
] as const

export type SampleFile = (typeof SAMPLE_FILES)[number]

export type SampleTexts = Record<SampleFile, string> & { manifest: string }

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
  return {
    agents: parse(t.agents).map(sampleAgent),
    environments, flows, connectors, knowledge, sources, spAgents, aiResources, users, shadowSignals, shadowDevices,
  }
}

const SAMPLE_LANES: Omit<LaneStatus, 'state' | 'rows'>[] = [
  { id: 'agents', label: 'Agents (Power Platform inventory)', connector: 'powerplatformadminv2' },
  { id: 'environments', label: 'Environments', connector: 'powerplatformadminv2' },
  { id: 'flows', label: 'Agent flows', connector: 'powerplatformadminv2' },
  { id: 'foundry', label: 'Azure AI Foundry', connector: 'arm' },
  { id: 'users', label: 'Directory users (names)', connector: 'commondataserviceforapps' },
  { id: 'knowledge', label: 'Named knowledge sources', connector: 'commondataserviceforapps' },
  { id: 'sharepoint', label: 'SharePoint agents', connector: 'commondataserviceforapps' },
  { id: 'shadow', label: 'Shadow AI (Defender)', connector: 'wdatp' },
]

export function sampleDataset(t: SampleTexts): Dataset {
  const raw = sampleRaw(t)
  const manifest = JSON.parse(t.manifest) as { asOf: string }
  const rows: Record<string, number> = {
    agents: raw.agents.length, environments: raw.environments.length, flows: raw.flows.length, foundry: raw.aiResources.length,
    users: raw.users.length, knowledge: raw.sources.length, sharepoint: raw.spAgents.length, shadow: raw.shadowSignals.length,
  }
  const lanes: LaneStatus[] = SAMPLE_LANES.map((l) => ({
    ...l,
    state: 'sample',
    rows: rows[l.id] ?? 0,
    detail:
      l.id === 'shadow' && rows.shadow === 0
        ? 'The sample ships no Defender rows: the source tenant returned 403 for advanced hunting.'
        : undefined,
  }))
  return buildDataset(raw, {
    mode: 'sample',
    asOf: toTime(manifest.asOf),
    lanes,
    runs: [
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
  const texts = { ...Object.fromEntries(entries), manifest: await get('manifest.json') } as SampleTexts
  return sampleDataset(texts)
}

