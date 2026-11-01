import { isActive30 } from '../data/transforms'
import { hasUsageSignal } from './lifecycle'
import type { Agent, AgentConnector, AgentKnowledge, KnowledgeSource, RiskDetail } from '../data/types'

/* ---------- generic helpers ---------- */

export function distinct<T>(rows: readonly T[], key: (r: T) => string | null | undefined): number {
  const s = new Set<string>()
  for (const r of rows) {
    const k = key(r)
    if (k) s.add(k)
  }
  return s.size
}

export const count = <T,>(rows: readonly T[], pred: (r: T) => boolean) => rows.reduce((n, r) => (pred(r) ? n + 1 : n), 0)
export const sum = <T,>(rows: readonly T[], val: (r: T) => number) => rows.reduce((n, r) => n + val(r), 0)
export const div = (a: number, b: number) => (b ? a / b : NaN)

export function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const g = m.get(k)
    if (g) g.push(r)
    else m.set(k, [r])
  }
  return m
}

export interface Bar {
  key: string
  label: string
  value: number
}

/** Groups rows and measures each group; sorted by value, largest first. Blank keys become "(Blank)". */
export function bars<T>(rows: readonly T[], key: (r: T) => string, measure: (rs: T[]) => number = (rs) => rs.length): Bar[] {
  return [...groupBy(rows, (r) => key(r) || '(Blank)')]
    .map(([k, rs]) => ({ key: k, label: k, value: measure(rs) }))
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

/** Every month from the first to the last key, so trends have no silent gaps. */
export function monthRange(first: string, last: string): string[] {
  if (!first || !last) return []
  const out: string[] = []
  let y = Number(first.slice(0, 4))
  let m = Number(first.slice(5, 7))
  const end = last.slice(0, 7)
  for (let guard = 0; guard < 600; guard++) {
    const k = `${y}-${String(m).padStart(2, '0')}`
    out.push(k)
    if (k >= end) break
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

export function monthly<T>(rows: readonly T[], month: (r: T) => string, measure: (rs: T[]) => number = (rs) => rs.length) {
  const g = groupBy(rows.filter((r) => month(r)), month)
  const keys = [...g.keys()].sort()
  return monthRange(keys[0], keys[keys.length - 1]).map((k) => ({ key: k, values: [measure(g.get(k) ?? [])] }))
}

export function cumulative(points: { key: string; values: number[] }[]) {
  let run = 0
  return points.map((p) => ({ key: p.key, values: [(run += p.values[0])] }))
}

/* ---------- Agent measures ---------- */

export const PLATFORM = {
  studio: 'Copilot Studio',
  builder: 'M365 Copilot Agent Builder',
  foundry: 'Azure AI Foundry',
}

export const ACTIVITY_ORDER = ['Active (7d)', 'Active (30d)', 'Idle (90d)', 'Dormant (90d+)', 'No usage signal']
export const RISK_ORDER = ['High', 'Medium', 'Low']

export const A = {
  count: (a: Agent[]) => a.length,
  platform: (p: string) => (a: Agent[]) => count(a, (x) => x.platform === p),
  published: (a: Agent[]) => count(a, (x) => x.isPublished),
  envsWithAgents: (a: Agent[]) => distinct(a, (x) => x.envId.toLowerCase()),
  active7: (a: Agent[]) => count(a, (x) => x.activityStatus === 'Active (7d)'),
  active30: (a: Agent[]) => count(a, (x) => isActive30(x.activityStatus)),
  idle: (a: Agent[]) => count(a, (x) => hasUsageSignal(x) && x.activityStatus === 'Idle (90d)'),
  dormant: (a: Agent[]) => count(a, (x) => hasUsageSignal(x) && x.activityStatus === 'Dormant (90d+)'),
  neverUsed: (a: Agent[]) => count(a, (x) => !x.lastUsed && hasUsageSignal(x)),
  noUsageSignal: (a: Agent[]) => count(a, (x) => !hasUsageSignal(x)),
  used: (a: Agent[]) => count(a, (x) => !!x.lastUsed),
  avgDaysSinceUse: (a: Agent[]) => {
    const d = a.map((x) => x.daysSinceLastUse).filter((n): n is number => n !== null)
    return div(sum(d, (n) => n), d.length)
  },
  // DAX treats BLANK as equal to "", so agents with no authentication value count here although they do not score risk.
  unauthenticated: (a: Agent[]) => count(a, (x) => x.authentication === 'None' || !x.authentication),
  tenantWide: (a: Agent[]) => count(a, (x) => x.sharedTenantWide),
  quarantined: (a: Agent[]) => count(a, (x) => x.isQuarantined),
  webSearch: (a: Agent[]) => count(a, (x) => x.webSearch),
  high: (a: Agent[]) => count(a, (x) => x.riskBand === 'High'),
  medium: (a: Agent[]) => count(a, (x) => x.riskBand === 'Medium'),
  atRisk: (a: Agent[]) => count(a, (x) => x.riskBand !== 'Low'),
  avgRisk: (a: Agent[]) => div(sum(a, (x) => x.riskScore), a.length),
  /** Shared tenant-wide with no Power Platform last-used date. */
  orphan: (a: Agent[]) => count(a, (x) => x.sharedTenantWide && !x.lastUsed),
  noRiskFactors: (a: Agent[]) => count(a, (x) => x.riskFactorCount === 0),
  avgRiskFactors: (a: Agent[]) => div(sum(a, (x) => x.riskFactorCount), a.length),
  topics: (a: Agent[]) => sum(a, (x) => x.topicCount),
  tools: (a: Agent[]) => sum(a, (x) => x.toolCount),
  knowledge: (a: Agent[]) => sum(a, (x) => x.knowledgeCount),
  multiAgentLinks: (a: Agent[]) => sum(a, (x) => x.connectedAgentCount),
  withKnowledge: (a: Agent[]) => count(a, (x) => x.knowledgeCount > 0),
  withTools: (a: Agent[]) => count(a, (x) => x.toolCount > 0),
  callingAgents: (a: Agent[]) => count(a, (x) => x.connectedAgentCount > 0),
  distinctCreators: (a: Agent[]) => distinct(a, (x) => x.createdByName),
  distinctOwners: (a: Agent[]) => distinct(a, (x) => x.ownerName),
  humanBuilt: (a: Agent[]) => count(a, (x) => x.agentOrigin === 'Human-built'),
  platformBuilt: (a: Agent[]) => count(a, (x) => x.agentOrigin === 'Platform-provisioned'),
  perCreator: (a: Agent[]) => div(A.humanBuilt(a), A.distinctCreators(a)),
  ownersNotResolved: (a: Agent[]) => count(a, (x) => x.ownerPrincipalType === 'Not resolved in Entra'),
  withoutOwners: (a: Agent[]) => count(a, (x) => !x.hasOwner),
  connectedPlatforms: (a: Agent[]) => distinct(a, (x) => x.platform),
  graphConnector: (a: Agent[]) => count(a, (x) => x.hasGraphConnector),
  withInstructions: (a: Agent[]) => count(a, (x) => x.hasInstructions),
  distinctModels: (a: Agent[]) => distinct(a, (x) => x.model),
}

/* ---------- risk detail ---------- */

export const R = {
  instances: (r: RiskDetail[]) => r.length,
  points: (r: RiskDetail[]) => sum(r, (x) => x.points),
  agentsAffected: (r: RiskDetail[]) => distinct(r, (x) => x.agentKey),
}

/* ---------- integrations ---------- */

export const TENANT_TYPES = new Set(['SharePoint sites', 'Dataverse tables', 'Microsoft Graph connectors', 'Teams messages', 'Uploaded files', 'File groups'])
export const EXTERNAL_TYPES = new Set(['Public websites', 'Web search', 'Bing custom search'])

export const C = {
  links: (r: AgentConnector[]) => r.length,
  distinct: (r: AgentConnector[]) => distinct(r, (x) => x.connectorId),
  mcpLinks: (r: AgentConnector[]) => count(r, (x) => x.isMcp),
  mcpAgents: (r: AgentConnector[]) => distinct(r, (x) => (x.isMcp ? x.agentKey : '')),
}

export const K = {
  sources: (r: AgentKnowledge[]) => sum(r, (x) => x.count),
  bindings: (r: AgentKnowledge[]) => r.length,
  grounded: (r: AgentKnowledge[]) => distinct(r, (x) => x.agentKey),
  external: (r: AgentKnowledge[]) => count(r, (x) => EXTERNAL_TYPES.has(x.type)),
  tenant: (r: AgentKnowledge[]) => count(r, (x) => TENANT_TYPES.has(x.type)),
  types: (r: AgentKnowledge[]) => distinct(r, (x) => x.type),
}

export const N = {
  named: (r: KnowledgeSource[]) => r.length,
  hosts: (r: KnowledgeSource[]) => distinct(r, (x) => x.locatorHost),
  external: (r: KnowledgeSource[]) => count(r, (x) => x.isExternal),
  agentsOutside: (r: KnowledgeSource[]) => distinct(r, (x) => (x.isExternal ? x.agentKey : '')),
  agents: (r: KnowledgeSource[]) => distinct(r, (x) => x.agentKey),
}

/** "Knowledge Source Freshness": when the sweep last ran and how stale that is. */
export function freshness(times: string[], asOf: string): string {
  const last = times.filter(Boolean).sort().at(-1)
  if (!last) return 'Never collected'
  const days = Math.floor((Date.parse(asOf + 'Z') - Date.parse(last + 'Z')) / 86_400_000)
  const date = last.slice(0, 10)
  if (days <= 0) return `${date} (today)`
  return days > 7 ? `${date} (${days}d ago - STALE)` : `${date} (${days}d ago)`
}
