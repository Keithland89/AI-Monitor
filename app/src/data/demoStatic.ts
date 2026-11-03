export interface TelemetryCoverageRow {
  sortOrder: number
  platform: string
  inventory: string
  configuration: string
  sharing: string
  usageSignal: string
  messageVolume: string
  whyNot: string
}

export interface WatchItem {
  category: string
  vendor: string
  appName: string
  posture: string
  softwareMatch: string
  vendorMatch: string
  processName: string
  domain: string
}

export const TELEMETRY_COVERAGE: TelemetryCoverageRow[] = [
  {
    sortOrder: 1,
    platform: 'Copilot Studio',
    inventory: 'Synthetic agents',
    configuration: 'Generated fixture',
    sharing: 'Sample only',
    usageSignal: 'Synthetic last-use values',
    messageVolume: 'Synthetic interactions',
    whyNot: 'Local fixtures only; no telemetry is collected.',
  },
  {
    sortOrder: 2,
    platform: 'M365 Copilot Agent Builder',
    inventory: 'Synthetic agents',
    configuration: 'Generated fixture',
    sharing: 'Sample only',
    usageSignal: 'Synthetic interactions',
    messageVolume: 'Synthetic interactions',
    whyNot: 'Local fixtures only; no telemetry is collected.',
  },
  {
    sortOrder: 3,
    platform: 'Azure AI Foundry',
    inventory: 'Synthetic agents',
    configuration: 'Generated fixture',
    sharing: 'Sample only',
    usageSignal: 'Synthetic last-use values',
    messageVolume: 'Synthetic interactions',
    whyNot: 'Local fixtures only; no telemetry is collected.',
  },
  {
    sortOrder: 4,
    platform: 'SharePoint',
    inventory: 'Synthetic agents',
    configuration: 'Generated fixture',
    sharing: 'Sample only',
    usageSignal: 'Synthetic interactions',
    messageVolume: 'Synthetic interactions',
    whyNot: 'Local fixtures only; no telemetry is collected.',
  },
]

export const RISK_FACTORS = [
  { sortOrder: 1, factor: 'No authentication configured', score: 3, rationale: 'Without authentication, an agent can be reached without a signed-in user.' },
  { sortOrder: 2, factor: 'Agent is quarantined', score: 3, rationale: 'A quarantined agent has been marked for restricted access.' },
  { sortOrder: 3, factor: 'Shared with the entire tenant', score: 2, rationale: 'Tenant-wide sharing exposes the agent to more people.' },
  { sortOrder: 4, factor: 'Shared tenant-wide and never used', score: 1, rationale: 'A broadly shared agent with no usage signal may need review.' },
  { sortOrder: 5, factor: 'Web search enabled on knowledge', score: 1, rationale: 'Web search can introduce information from outside approved knowledge sources.' },
  { sortOrder: 6, factor: 'Uses one or more connectors', score: 1, rationale: 'Connectors let an agent access other services or data.' },
  { sortOrder: 7, factor: 'Connected to other agents', score: 1, rationale: 'Agent-to-agent connections can expand the overall access path.' },
]

const watchItems = [
  { appName: 'DraftMate', vendor: 'Northstar Labs', category: 'Generative AI', posture: 'Unsanctioned' },
  { appName: 'NotePilot', vendor: 'Bright Field', category: 'AI assistant', posture: 'Unmanaged' },
  { appName: 'QueryNest', vendor: 'Open Research', category: 'Generative AI', posture: 'Unmanaged' },
  { appName: 'BrightDesk', vendor: 'Blue Oak', category: 'AI assistant', posture: 'Unsanctioned' },
]

export const SHADOW_WATCHLIST: WatchItem[] = watchItems.map((item) => ({
  ...item,
  softwareMatch: item.appName.toLowerCase(),
  vendorMatch: item.vendor.toLowerCase(),
  processName: `demo-${item.appName.toLowerCase()}.exe`,
  domain: 'example.invalid',
}))
