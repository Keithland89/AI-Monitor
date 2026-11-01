import { createContext, useContext } from 'react'
import type { Agent, AgentConnector, AgentKnowledge, DataMode, Dataset, KnowledgeSource, LaneStatus, RiskDetail } from './types'

export interface Filters {
  env: string
  platform: string
  riskBand: string
  origin: string
}

export const EMPTY_FILTERS: Filters = { env: '', platform: '', riskBand: '', origin: '' }

/** Everything an agent slicer reaches: the agents plus the fact tables related to them. */
export interface Scope {
  filtered: boolean
  agents: Agent[]
  keys: Set<string>
  riskDetail: RiskDetail[]
  connectors: AgentConnector[]
  knowledge: AgentKnowledge[]
  sources: KnowledgeSource[]
}

export function scopeOf(ds: Dataset, f: Filters): Scope {
  const filtered = !!(f.env || f.platform || f.riskBand || f.origin)
  const agents = filtered
    ? ds.agents.filter(
        (a) => (!f.env || a.envName === f.env) && (!f.platform || a.platform === f.platform) && (!f.riskBand || a.riskBand === f.riskBand) && (!f.origin || a.agentOrigin === f.origin),
      )
    : ds.agents
  const keys = new Set(agents.map((a) => a.key))
  const keep = <T extends { agentKey: string }>(rows: T[]) => (filtered ? rows.filter((r) => keys.has(r.agentKey)) : rows)
  return {
    filtered,
    agents,
    keys,
    riskDetail: keep(ds.riskDetail),
    connectors: keep(ds.connectors),
    knowledge: keep(ds.knowledge),
    sources: keep(ds.sources),
  }
}

export interface DataState {
  ds: Dataset
  scope: Scope
  filters: Filters
  setFilter: <K extends keyof Filters>(k: K, v: Filters[K]) => void
  resetFilters: () => void
  agentByKey: Map<string, Agent>
  openAgent: (key: string | null) => void
  /** True when the app runs inside the Managed Apps player, so live connectors can be called. */
  hostAvailable: boolean
  loading: boolean
  progress: LaneStatus[]
  switchMode: (mode: DataMode) => void
  reload: () => void
  notice: string
}

export const DataContext = createContext<DataState | null>(null)

export function useData(): DataState {
  const v = useContext(DataContext)
  if (!v) throw new Error('useData must be used inside DataProvider')
  return v
}
