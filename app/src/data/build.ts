import { finaliseAgents } from './transforms'
import type { DataMode, Dataset, LaneStatus, RawData, RunInfo } from './types'

export interface BuildOptions {
  mode: DataMode
  asOf: string
  lanes: LaneStatus[]
  runs: RunInfo[]
  namesResolved: boolean
  appEnvironment?: string
}

/** Assembles the model: derives every agent column and the risk detail, then names the agents behind each knowledge source. */
export function buildDataset(raw: RawData, opt: BuildOptions): Dataset {
  const { agents, riskDetail } = finaliseAgents(raw.agents, {
    asOf: opt.asOf,
    users: raw.users,
    namesResolved: opt.namesResolved,
  })

  const agentByKey = new Map(agents.map((a) => [a.key, a]))
  const envName = new Map(raw.environments.map((e) => [e.id.toLowerCase(), e.name]))
  const sources = raw.sources.map((s) => {
    const a = agentByKey.get(s.agentKey)
    const envId = s.agentKey.split('|')[0] ?? ''
    return {
      ...s,
      agentName: a?.name || 'Agent no longer in inventory',
      envName: a?.envName || envName.get(envId.toLowerCase()) || (envId ? `Unlisted environment (${envId})` : 'Unknown environment'),
    }
  })

  return {
    mode: opt.mode,
    asOf: opt.asOf,
    agents,
    riskDetail,
    environments: raw.environments,
    flows: raw.flows,
    connectors: raw.connectors,
    knowledge: raw.knowledge,
    sources,
    spAgents: raw.spAgents,
    aiResources: raw.aiResources,
    users: raw.users,
    namesResolved: opt.namesResolved,
    shadowSignals: raw.shadowSignals,
    shadowDevices: raw.shadowDevices,
    lanes: opt.lanes,
    runs: opt.runs,
    appEnvironment: opt.appEnvironment,
  }
}

export const emptyRaw = (): RawData => ({
  agents: [], environments: [], flows: [], connectors: [], knowledge: [], sources: [], spAgents: [],
  aiResources: [], users: [], shadowSignals: [], shadowDevices: [],
})