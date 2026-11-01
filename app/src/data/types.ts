export type DataMode = 'live' | 'sample'

export type ActivityStatus = 'Active (7d)' | 'Active (30d)' | 'Idle (90d)' | 'Dormant (90d+)' | 'No usage signal'
export type RiskBand = 'High' | 'Medium' | 'Low'

/** An agent as the inventory sources describe it, before any derived column is added. */
export interface AgentBase {
  key: string
  id: string
  name: string
  authoringSurface: string
  envId: string
  envName: string
  envType: string
  region: string
  schemaName: string
  orchestration: string
  model: string
  /** null when the source carried no value at all; "" when it carried an empty string. */
  authentication: string | null
  createdAt: string
  lastPublishedAt: string
  lastUsed: string
  isQuarantined: boolean
  isManaged: boolean
  isGithubCopilotAgent: boolean
  isCLIAgent: boolean
  webSearch: boolean
  channels: string
  channelCount: number
  topicCount: number
  toolCount: number
  knowledgeCount: number
  connectedAgentCount: number
  connectorCount: number
  connectorOpsCount: number
  flowCount: number
  sharedUserCount: number
  sharedGroupCount: number
  sharedTenantWide: boolean
  editorUserCount: number
  ownerId: string
  createdBy: string
  entraAppId: string
  entraAgentId: string
  blueprintId: string
  harness: string
  instructionsCharCount: number
  quarantinedAt: string
  knowledgeTypes: string
  graphConnectorCount: number
  sharePointSiteCount: number
  publicSiteCount: number
  fileKnowledgeCount: number
  dataverseSourceCount: number
  titleId: string
  /** Fixed for Foundry projects; otherwise derived from the authoring surface. */
  platform?: string
}

export interface Agent extends AgentBase {
  platform: string
  isPublished: boolean
  createdByName: string
  ownerName: string
  ownerUpn: string
  ownerPrincipalType: string
  daysSinceLastUse: number | null
  ageDays: number | null
  createdMonth: string
  lastUsedMonth: string
  activityStatus: ActivityStatus
  riskScore: number
  riskBand: RiskBand
  riskFactorCount: number
  riskReasons: string
  agentOrigin: string
  creatorCategory: string
  hasOwner: boolean
  hasInstructions: boolean
  knowledgeTypeCount: number
  hasGraphConnector: boolean
}

export interface RiskDetail {
  agentKey: string
  factor: string
  points: number
}

export interface Environment {
  id: string
  name: string
  region: string
  type: string
  isManaged: boolean
  groupId: string
  createdAt: string
  lastModifiedAt: string
  createdBy: string
}

export interface AgentFlow {
  id: string
  name: string
  type: string
  envId: string
  state: string
  createdAt: string
  region: string
  lastUsed: string
}

export interface AgentConnector {
  agentKey: string
  connectorId: string
  operationCount: number
  isMcp: boolean
}

export interface AgentKnowledge {
  agentKey: string
  type: string
  count: number
}

export interface KnowledgeSource {
  agentKey: string
  envId: string
  agentName: string
  envName: string
  sourceId: string
  sourceName: string
  sourceKind: string
  knowledgeType: string
  isExternal: boolean
  locator: string
  locatorHost: string
  collectedAt: string
}

export interface SharePointAgent {
  key: string
  name: string
  fileName: string
  siteUrl: string
  objectUrl: string
  libraryPath: string
  firstSeenAt: string
  lastSeenAt: string
  collectedAt: string
  lastOperation: string
  lastActor: string
  applicationName: string
  isDeleted: boolean
  eventCount: number
}

export interface AzureAIResource {
  id: string
  name: string
  parentAccount: string
  type: string
  kind: string
  category: string
  isAgentHost: boolean
  region: string
  resourceGroup: string
  subscriptionId: string
  sku: string
  publicAccess: string
  localAuthOff: boolean
  createdAt: string
}

export interface UserRecord {
  key: string
  name: string
  upn: string
  type: string
}

export interface ShadowSignal {
  layer: string
  category: string
  vendor: string
  appName: string
  posture: string
  detected: string
  deviceCount: number
  userCount: number | null
  lastSeen: string
}

export interface ShadowDevice {
  layer: string
  deviceName: string
  appName: string
  posture: string
  detected: string
  detail: string
  userUpn: string
  lastSeen: string
}

export type LaneId = 'agents' | 'environments' | 'usage' | 'flows' | 'foundry' | 'users' | 'knowledge' | 'sharepoint' | 'shadow'

export type LaneState = 'ok' | 'empty' | 'not-set-up' | 'denied' | 'error' | 'sample' | 'loading'

export interface LaneStatus {
  id: LaneId
  label: string
  connector: string
  state: LaneState
  rows: number
  detail?: string
  ms?: number
}

export interface RunInfo {
  lane: string
  table: string
  state: 'ok' | 'not-set-up' | 'error' | 'sample'
  lastRun: string
  status: string
  detail?: string
}

export interface RawData {
  agents: AgentBase[]
  environments: Environment[]
  flows: AgentFlow[]
  connectors: AgentConnector[]
  knowledge: AgentKnowledge[]
  sources: KnowledgeSource[]
  spAgents: SharePointAgent[]
  aiResources: AzureAIResource[]
  users: UserRecord[]
  shadowSignals: ShadowSignal[]
  shadowDevices: ShadowDevice[]
}

export interface Dataset {
  mode: DataMode
  /** The "today" every recency column is measured from. */
  asOf: string
  agents: Agent[]
  riskDetail: RiskDetail[]
  environments: Environment[]
  flows: AgentFlow[]
  connectors: AgentConnector[]
  knowledge: AgentKnowledge[]
  sources: KnowledgeSource[]
  spAgents: SharePointAgent[]
  aiResources: AzureAIResource[]
  users: UserRecord[]
  /** Whether owner and creator ids were resolved to names, which live mode cannot do yet. */
  namesResolved: boolean
  shadowSignals: ShadowSignal[]
  shadowDevices: ShadowDevice[]
  lanes: LaneStatus[]
  runs: RunInfo[]
  appEnvironment?: string
}
