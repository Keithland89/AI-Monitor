import { buildDataset } from './build'
import type {
  AgentBase,
  AgentCredit,
  AgentFlow,
  AgentKnowledge,
  AiCostDaily,
  AiCostMeter,
  AzureAIResource,
  CopilotSurface,
  Dataset,
  Environment,
  Interaction,
  KnowledgeSource,
  M365App,
  M365Usage,
  RawData,
  SharePointAgent,
  ShadowDevice,
  ShadowSignal,
  UserRecord,
} from './types'

const AS_OF = '2026-11-03T12:00:00'
const DAYS = 70
const APP_HOSTS = ['M365Copilot', 'Cowork', 'Teams']
const PLATFORM = ['Copilot Studio', 'M365 Copilot Agent Builder', 'Azure AI Foundry', 'SharePoint'] as const
const AGENT_NAMES = [
  'Travel request guide', 'Policy answer assistant', 'Invoice review helper', 'Onboarding companion',
  'Knowledge navigator', 'Service desk triage', 'Contract summary assistant', 'Expense insights',
  'Project brief writer', 'Meeting follow-up helper', 'Sales coach', 'Product feedback analyst',
  'Benefits question helper', 'Research companion', 'Release note drafter', 'Operations planner',
  'Customer response coach', 'Data quality reviewer', 'Training path assistant', 'Risk review helper',
  'Procurement guide', 'Team knowledge assistant', 'Forecast explainer', 'Change summary writer',
]
const REGIONS = ['North Europe', 'West US', 'Australia East', 'Central India']
const CONNECTORS = ['shared_sharepoint', 'shared_teams', 'shared_outlook', 'demo_search']
const APP_NAMES = ['DraftMate', 'NotePilot', 'QueryNest', 'BrightDesk']

function lastUseDays(index: number): number | null {
  if (index % 6 === 0) return null
  if (index % 6 === 1) return 96 + index
  return (index * 9) % 85
}

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function dayOffset(days: number, hour = 12, minute = 0) {
  const date = new Date(`${AS_OF.slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  date.setUTCHours(hour, minute, 0, 0)
  return date.toISOString().slice(0, 19)
}

function makeUsers(): UserRecord[] {
  return Array.from({ length: 12 }, (_, i) => ({
    key: `demo-user-${String(i + 1).padStart(2, '0')}`,
    name: `Demo User ${String(i + 1).padStart(2, '0')}`,
    upn: `user${String(i + 1).padStart(2, '0')}@example.invalid`,
    type: 'User',
  }))
}

function makeEnvironments(): Environment[] {
  return Array.from({ length: 4 }, (_, i) => ({
    id: `demo-environment-${i + 1}`,
    name: ['Demo Development', 'Demo Operations', 'Demo Research', 'Demo Shared'][i],
    region: REGIONS[i],
    type: ['Sandbox', 'Production', 'Production', 'Developer'][i],
    isManaged: i !== 0,
    groupId: `demo-group-${i + 1}`,
    createdAt: dayOffset(300 + i * 50),
    lastModifiedAt: dayOffset(i * 5),
    createdBy: `demo-user-${String(i + 1).padStart(2, '0')}`,
  }))
}

function makeAgents(environments: Environment[], rand: () => number): AgentBase[] {
  return AGENT_NAMES.map((name, i) => {
    const env = environments[i % environments.length]
    const platform = PLATFORM[i % PLATFORM.length]
    const id = `demo-agent-${String(i + 1).padStart(2, '0')}`
    const createdDays = 18 + ((i * 13) % 220)
    const daysSinceUse = lastUseDays(i)
    const owner = i % 9 === 0 ? '' : `demo-user-${String((i % 12) + 1).padStart(2, '0')}`
    const hasConnectors = i % 3 !== 0
    const shared = i % 8 === 0
    const webSearch = i % 6 === 0
    const quarantined = i === 17
    const connectorCount = hasConnectors ? 1 + (i % 2) : 0
    return {
      key: `${env.id}|${id}`,
      id,
      name,
      authoringSurface: platform === 'M365 Copilot Agent Builder' ? 'Copilot Studio Lite' : platform,
      envId: env.id,
      envName: env.name,
      envType: env.type,
      region: env.region,
      schemaName: `demo.schema.agent${String(i + 1).padStart(2, '0')}`,
      orchestration: i % 3 === 0 ? 'Generative' : 'Classic',
      model: ['GPT-4o mini', 'GPT-4o', 'Not specified'][i % 3],
      authentication: i % 9 === 0 ? 'None' : 'Authenticate with Microsoft',
      createdAt: dayOffset(createdDays),
      lastPublishedAt: dayOffset(Math.max(0, createdDays - 2)),
      lastUsed: daysSinceUse === null ? '' : dayOffset(daysSinceUse),
      isQuarantined: quarantined,
      isManaged: i % 5 === 0,
      isGithubCopilotAgent: false,
      isCLIAgent: false,
      webSearch,
      channels: i % 2 === 0 ? 'Teams; Web' : 'Teams',
      channelCount: i % 2 === 0 ? 2 : 1,
      topicCount: 2 + (i % 7),
      toolCount: connectorCount,
      knowledgeCount: 1 + (i % 4),
      connectedAgentCount: i % 10 === 0 ? 1 : 0,
      connectorCount,
      connectorOpsCount: connectorCount * (1 + (i % 3)),
      flowCount: i % 4 === 0 ? 1 : 0,
      sharedUserCount: shared ? 8 + (i % 20) : 2 + (i % 4),
      sharedGroupCount: shared ? 2 : i % 3,
      sharedTenantWide: shared,
      editorUserCount: 1 + (i % 3),
      ownerId: owner,
      createdBy: `demo-user-${String((i % 12) + 1).padStart(2, '0')}`,
      entraAppId: `demo-app-${String(i + 1).padStart(2, '0')}`,
      entraAgentId: `demo-identity-${String(i + 1).padStart(2, '0')}`,
      blueprintId: i % 11 === 0 ? `demo-blueprint-${i + 1}` : '',
      harness: '',
      instructionsCharCount: 200 + Math.floor(rand() * 3000),
      quarantinedAt: quarantined ? dayOffset(4) : '',
      knowledgeTypes: i % 2 === 0 ? 'Public websites; SharePoint sites' : 'Uploaded files',
      graphConnectorCount: i % 5 === 0 ? 1 : 0,
      sharePointSiteCount: 1 + (i % 3),
      publicSiteCount: i % 3,
      fileKnowledgeCount: i % 4,
      dataverseSourceCount: i % 6 === 0 ? 1 : 0,
      titleId: `demo-title-${String(i + 1).padStart(2, '0')}`,
      ...(platform === 'Azure AI Foundry' ? { platform } : {}),
    }
  })
}

function makeSharePointAgents(rand: () => number): SharePointAgent[] {
  return Array.from({ length: 4 }, (_, i) => ({
    key: `demo-sp-item-${String(i + 1).padStart(2, '0')}`,
    name: `SharePoint guide ${i + 1}`,
    fileName: `demo-agent-${i + 1}.agent`,
    siteUrl: `https://example.invalid/sites/demo-${i + 1}`,
    objectUrl: `https://example.invalid/sites/demo-${i + 1}/agent`,
    libraryPath: `Shared Documents/Demo agents/agent-${i + 1}`,
    firstSeenAt: dayOffset(60 + i * 8),
    lastSeenAt: dayOffset(i * 4),
    collectedAt: dayOffset(1),
    lastOperation: i % 2 === 0 ? 'Updated' : 'Viewed',
    lastActor: `user${String(i + 1).padStart(2, '0')}@example.invalid`,
    applicationName: 'Synthetic demo',
    isDeleted: i === 3,
    eventCount: 3 + Math.floor(rand() * 20),
  }))
}

function makeSurfaces(agents: AgentBase[], spAgents: SharePointAgent[]): CopilotSurface[] {
  const byIndex = (i: number) => agents[i]
  const agentSurfaces = agents.map((a, i) => {
    const platform = a.platform ?? (a.authoringSurface === 'Copilot Studio Lite' ? 'M365 Copilot Agent Builder' : a.authoringSurface || 'Copilot Studio')
    return {
      key: `demo-surface-${String(i + 1).padStart(2, '0')}`,
      name: a.name,
      type: platform === 'SharePoint' ? 'SharePoint agent' : `${platform} agent`,
      platform,
      isAgent: true,
      agentKey: a.key,
      matchOn: 'SchemaName' as const,
      isMatched: true,
      spAgentKey: platform === 'SharePoint' ? spAgents[i % spAgents.length]?.key ?? '' : '',
    }
  })
  const sharePointSurfaces = spAgents.map((sp, i) => ({
    key: `demo-sharepoint-surface-${i + 1}`,
    name: sp.name,
    type: 'SharePoint agent',
    platform: 'SharePoint',
    isAgent: true,
    agentKey: byIndex((i * 4) % agents.length).key,
    matchOn: '' as const,
    isMatched: true,
    spAgentKey: sp.key,
  }))
  return [
    ...agentSurfaces,
    ...sharePointSurfaces,
    { key: 'demo-copilot-chat', name: 'Copilot Chat', type: 'M365 Copilot (base)', platform: 'M365 Copilot', isAgent: false, agentKey: '', matchOn: '' as const, isMatched: false, spAgentKey: '' },
    { key: 'demo-cowork', name: 'Cowork', type: 'M365 Copilot (base)', platform: 'M365 Copilot', isAgent: false, agentKey: '', matchOn: '' as const, isMatched: false, spAgentKey: '' },
  ]
}

function makeInteractions(surfaces: CopilotSurface[], agents: AgentBase[], rand: () => number): Interaction[] {
  const rows: Interaction[] = []
  for (let day = 0; day < DAYS; day++) {
    const sessions = 2 + Math.floor(rand() * 5)
    for (let session = 0; session < sessions; session++) {
      const agentIndex = Math.floor(rand() * agents.length)
      const agent = agents[agentIndex]
      const hostIndex = Math.floor(rand() * APP_HOSTS.length)
      const isAgent = rand() > 0.22
      const daysSinceUse = lastUseDays(agentIndex)
      if (isAgent && (daysSinceUse === null || day < daysSinceUse)) continue
      const surface = isAgent
        ? surfaces.find((s) => s.agentKey === agent.key)!
        : surfaces.find((s) => s.key === (hostIndex === 1 ? 'demo-cowork' : 'demo-copilot-chat'))!
      const hour = rand() < 0.18 ? Math.floor(rand() * 5) + 19 : Math.floor(rand() * 9) + 8
      const minute = Math.floor(rand() * 30)
      const user = `user${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}@example.invalid`
      const threadId = `demo-thread-${day}-${session}`
      const turns = 1 + Math.floor(rand() * 3)
      for (let turn = 0; turn < turns; turn++) {
        const time = dayOffset(day, hour, minute + turn * 15)
        rows.push({
          date: time.slice(0, 10),
          time,
          surfaceKey: surface.key,
          agentKey: isAgent ? agent.key : '',
          user,
          appHost: isAgent ? APP_HOSTS[hostIndex] : hostIndex === 1 ? 'Cowork' : 'M365Copilot',
          threadId,
          resourceCount: Math.floor(rand() * 6),
        })
      }
    }
  }
  return rows
}

function makeFlows(envs: Environment[]): AgentFlow[] {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `demo-flow-${i + 1}`,
    name: `Demo follow-up flow ${i + 1}`,
    type: i % 2 ? 'Agent Flow' : 'M365 Agent Flow',
    envId: envs[i % envs.length].id,
    state: i % 5 === 0 ? 'Draft' : 'On',
    createdAt: dayOffset(30 + i * 10),
    region: envs[i % envs.length].region,
    lastUsed: dayOffset(i * 3),
  }))
}

function makeKnowledge(agents: AgentBase[]): { rows: AgentKnowledge[]; sources: KnowledgeSource[] } {
  const rows: AgentKnowledge[] = []
  const sources: KnowledgeSource[] = []
  agents.forEach((a, i) => {
    const type = i % 2 === 0 ? 'SharePoint sites' : 'Public websites'
    rows.push({ agentKey: a.key, type, count: 1 + (i % 4) })
    sources.push({
      agentKey: a.key,
      envId: a.envId,
      agentName: a.name,
      envName: a.envName,
      sourceId: `demo-source-${String(i + 1).padStart(2, '0')}`,
      sourceName: `${a.name} reference ${i + 1}`,
      sourceKind: type,
      knowledgeType: type,
      isExternal: i % 2 === 1,
      locator: `https://example.invalid/demo/reference-${i + 1}`,
      locatorHost: 'example.invalid',
      collectedAt: dayOffset(2),
    })
  })
  return { rows, sources }
}

function makeConnectors(agents: AgentBase[]): RawData['connectors'] {
  return agents.flatMap((agent, i) =>
    Array.from({ length: agent.connectorCount }, (_, j) => ({
      agentKey: agent.key,
      connectorId: CONNECTORS[(i + j) % CONNECTORS.length],
      operationCount: 1 + ((i + j) % 6),
      isMcp: (i + j) % 5 === 0,
    })),
  )
}

function makeResources(): AzureAIResource[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `demo-resource-${i + 1}`,
    name: `Demo AI resource ${i + 1}`,
    parentAccount: `Demo AI account ${1 + (i % 2)}`,
    type: i % 2 ? 'Microsoft.CognitiveServices/accounts' : 'Microsoft.MachineLearningServices/workspaces',
    kind: i % 2 ? 'OpenAI' : 'Project',
    category: i % 2 ? 'Azure OpenAI' : 'AI Foundry account',
    isAgentHost: i % 2 === 0,
    region: REGIONS[i % REGIONS.length],
    resourceGroup: `demo-resource-group-${i + 1}`,
    subscriptionId: `demo-subscription-${i + 1}`,
    sku: 'Standard',
    publicAccess: i % 2 ? 'Disabled' : 'Enabled',
    localAuthOff: i % 2 === 1,
    createdAt: dayOffset(150 + i * 20),
  }))
}

function makeCost(resources: AzureAIResource[], agents: AgentBase[], rand: () => number) {
  const daily: AiCostDaily[] = []
  const meters: AiCostMeter[] = []
  resources.forEach((resource, ri) => {
    const values: number[] = []
    for (let d = 29; d >= 0; d--) {
      const amount = Math.round((12 + ri * 7 + rand() * 24) * 100) / 100
      daily.push({ date: dayOffset(d).slice(0, 10), resourceId: resource.id.toLowerCase(), cost: amount, currency: 'USD' })
      values.push(amount)
    }
    const total = values.reduce((sum, amount) => sum + amount, 0)
    const inputCost = Math.round(total * 0.62 * 100) / 100
    meters.push(
      { resourceId: resource.id.toLowerCase(), meter: 'Demo input usage', cost: inputCost, currency: 'USD' },
      { resourceId: resource.id.toLowerCase(), meter: 'Demo output usage', cost: Math.round((total - inputCost) * 100) / 100, currency: 'USD' },
    )
  })
  const credits: AgentCredit[] = agents.slice(0, 15).map((agent, i) => ({
    agentKey: agent.key,
    envId: agent.envId,
    resourceId: agent.id,
    feature: ['Generative answer', 'Agent action', 'Classic answer'][i % 3],
    product: 'Copilot Studio',
    billed: 120 + i * 37,
    nonBilled: i % 4 === 0 ? 40 + i * 5 : 0,
    lastRefreshed: dayOffset(1),
  }))
  return {
    daily,
    meters,
    credits,
    pool: [
      { currency: 'MCSMessages', purchased: 50000, allocated: 32000, consumed: credits.reduce((sum, row) => sum + row.billed, 0), lastUpdated: dayOffset(1) },
      { currency: 'AI', purchased: 25000, allocated: 9000, consumed: 4210, lastUpdated: dayOffset(1) },
    ],
  }
}

function makeM365(rand: () => number): M365Usage {
  const apps: M365App[] = ['outlook', 'teams', 'word', 'excel', 'powerPoint', 'oneNote']
  const daily = Array.from({ length: 30 }, (_, i) => {
    const date = dayOffset(29 - i).slice(0, 10)
    const weekday = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? 0.38 : 1
    return { date, weekday }
  })
  return {
    refreshed: dayOffset(2).slice(0, 10),
    active: 110,
    services: [
      { key: 'teams', label: 'Teams', active: 98 },
      { key: 'exchange', label: 'Exchange', active: 92 },
      { key: 'sharepoint', label: 'SharePoint', active: 76 },
    ],
    appDaily: daily.map(({ date, weekday }) => ({
      date,
      counts: Object.fromEntries(apps.map((app, i) => [app, Math.round((78 - i * 6) * weekday * (0.9 + rand() * 0.2))])) as Record<M365App, number>,
    })),
    emailDaily: daily.map(({ date, weekday }) => ({
      date,
      sent: Math.round(940 * weekday * (0.9 + rand() * 0.2)),
      received: Math.round(2800 * weekday * (0.9 + rand() * 0.2)),
      read: Math.round(2100 * weekday * (0.9 + rand() * 0.2)),
      meetingsCreated: Math.round(55 * weekday * (0.9 + rand() * 0.2)),
    })),
    teamsDaily: daily.map(({ date, weekday }) => ({
      date,
      channel: Math.round(390 * weekday * (0.9 + rand() * 0.2)),
      chat: Math.round(1600 * weekday * (0.9 + rand() * 0.2)),
      calls: Math.round(150 * weekday * (0.9 + rand() * 0.2)),
      meetings: Math.round(170 * weekday * (0.9 + rand() * 0.2)),
    })),
    copilot: [
      { product: 'anyApp', enabled: 60, active: 36 },
      { product: 'microsoftTeams', enabled: 60, active: 25 },
      { product: 'outlook', enabled: 60, active: 20 },
      { product: 'word', enabled: 60, active: 16 },
      { product: 'excel', enabled: 60, active: 8 },
      { product: 'powerPoint', enabled: 60, active: 10 },
      { product: 'oneNote', enabled: 60, active: 3 },
      { product: 'loop', enabled: 60, active: 2 },
      { product: 'copilotChat', enabled: 60, active: 30 },
    ],
    failed: [],
    collectedAt: dayOffset(2),
  }
}

function makeShadow(rand: () => number): { signals: ShadowSignal[]; devices: ShadowDevice[] } {
  const signals = APP_NAMES.map((appName, i) => ({
    layer: i % 2 ? 'Browser' : 'Endpoint',
    category: i % 2 ? 'AI assistant' : 'Generative AI',
    vendor: ['Northstar Labs', 'Bright Field', 'Open Research', 'Blue Oak'][i],
    appName,
    posture: i % 3 === 0 ? 'Unsanctioned' : 'Unmanaged',
    detected: dayOffset(20 + i * 6).slice(0, 10),
    deviceCount: 2 + Math.floor(rand() * 9),
    userCount: 1 + Math.floor(rand() * 7),
    lastSeen: dayOffset(i * 2),
  }))
  const devices = signals.flatMap((signal, i) =>
    Array.from({ length: Math.min(2, signal.deviceCount) }, (_, j) => ({
      layer: signal.layer,
      deviceName: `DEMO-DEVICE-${String(i * 2 + j + 1).padStart(2, '0')}`,
      appName: signal.appName,
      posture: signal.posture,
      detected: signal.detected,
      detail: 'Synthetic demo observation; not a live detection.',
      userUpn: `user${String(i * 2 + j + 1).padStart(2, '0')}@example.invalid`,
      lastSeen: signal.lastSeen,
    })),
  )
  return { signals, devices }
}

function makeRaw(): RawData {
  const rand = random(0x41a1)
  const environments = makeEnvironments()
  const agents = makeAgents(environments, rand)
  const users = makeUsers()
  const spAgents = makeSharePointAgents(rand)
  const surfaces = makeSurfaces(agents, spAgents)
  const interactions = makeInteractions(surfaces, agents, rand)
  const { rows: knowledge, sources } = makeKnowledge(agents)
  const aiResources = makeResources()
  const cost = makeCost(aiResources, agents, rand)
  const shadow = makeShadow(rand)
  return {
    agents,
    environments,
    flows: makeFlows(environments),
    connectors: makeConnectors(agents),
    knowledge,
    sources,
    spAgents,
    aiResources,
    interactions,
    surfaces,
    users,
    shadowSignals: shadow.signals,
    shadowDevices: shadow.devices,
    credits: cost.credits,
    creditPool: cost.pool,
    aiCostDaily: cost.daily,
    aiCostMeters: cost.meters,
    m365: makeM365(rand),
  }
}

export function syntheticDataset(): Dataset {
  const raw = makeRaw()
  const laneRows: Record<string, number> = {
    agents: raw.agents.length,
    environments: raw.environments.length,
    flows: raw.flows.length,
    foundry: raw.aiResources.length,
    users: raw.users.length,
    interactions: raw.interactions.length,
    knowledge: raw.sources.length,
    sharepoint: raw.spAgents.length,
    shadow: raw.shadowSignals.length,
    credits: raw.credits.length,
    creditpool: raw.creditPool.length,
    aicost: raw.aiCostDaily.length,
    m365usage: 1,
    usage: raw.agents.length,
  }
  const laneDefs = [
    ['agents', 'Agents', 'Local fixture'],
    ['environments', 'Environments', 'Local fixture'],
    ['usage', 'Agent usage', 'Local fixture'],
    ['flows', 'Agent flows', 'Local fixture'],
    ['foundry', 'AI resources', 'Local fixture'],
    ['users', 'Directory users', 'Local fixture'],
    ['interactions', 'Copilot interactions', 'Local fixture'],
    ['knowledge', 'Knowledge sources', 'Local fixture'],
    ['sharepoint', 'SharePoint agents', 'Local fixture'],
    ['shadow', 'Shadow AI', 'Local fixture'],
    ['credits', 'Copilot Credits', 'Local fixture'],
    ['creditpool', 'Capacity pool', 'Local fixture'],
    ['aicost', 'AI spend', 'Local fixture'],
    ['m365usage', 'Microsoft 365 usage reports', 'Local fixture'],
  ] as const
  const lanes = laneDefs.map(([id, label, connector]) => ({
    id,
    label,
    connector,
    state: 'sample' as const,
    rows: laneRows[id] ?? 0,
    detail: 'Synthetic demo data generated locally; no live source queried.',
  }))
  return buildDataset(raw, {
    mode: 'sample',
    asOf: AS_OF,
    lanes,
    runs: [
      { lane: 'interactions', table: 'Demo interaction history', state: 'sample', lastRun: AS_OF, status: 'Synthetic demo fixture' },
      { lane: 'sharepoint', table: 'Demo SharePoint activity', state: 'sample', lastRun: AS_OF, status: 'Synthetic demo fixture' },
      { lane: 'knowledge', table: 'Demo knowledge sources', state: 'sample', lastRun: AS_OF, status: 'Synthetic demo fixture' },
    ],
    namesResolved: true,
  })
}
