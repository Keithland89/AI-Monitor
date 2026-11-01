import { agentLookup, buildSurfaces, decodeSpo } from './surface'
import { finaliseAgents } from './transforms'
import type { CopilotSurface, DataMode, Dataset, LaneStatus, RawData, RunInfo } from './types'

export interface BuildOptions {
  mode: DataMode
  asOf: string
  lanes: LaneStatus[]
  runs: RunInfo[]
  namesResolved: boolean
  appEnvironment?: string
}

/**
 * Assembles the model: classifies Copilot surfaces, joins interactions to agents and
 * SharePoint agents, then derives every agent column and the risk detail.
 */
export function buildDataset(raw: RawData, opt: BuildOptions): Dataset {
  const lookup = agentLookup(raw.agents)
  let surfaces: CopilotSurface[]
  if (raw.surfaces) {
    const spKeys = new Set(raw.spAgents.map((s) => s.key.trim().toLowerCase()))
    surfaces = raw.surfaces.map((s) => {
      if (s.spAgentKey || s.type !== 'SharePoint agent') return s
      const g = decodeSpo(s.key).itemGuid.toLowerCase()
      return g && spKeys.has(g) ? { ...s, spAgentKey: g, isMatched: true } : s
    })
  } else {
    const ids = raw.appIdentities ?? [...new Set(raw.interactions.map((i) => i.surfaceKey))]
    surfaces = buildSurfaces(ids, lookup, raw.spAgents)
  }
  const surfaceMap = new Map(surfaces.map((s) => [s.key, s]))
  const interactions = raw.interactions.map((i) => (i.agentKey ? i : { ...i, agentKey: surfaceMap.get(i.surfaceKey)?.agentKey ?? '' }))

  const { agents, riskDetail } = finaliseAgents(raw.agents, {
    asOf: opt.asOf,
    users: raw.users,
    interactions,
    namesResolved: opt.namesResolved,
  })

  const agentByKey = new Map(agents.map((a) => [a.key, a]))
  const agentKeyLower = new Map(agents.map((a) => [a.key.toLowerCase(), a.key]))
  // Credits arrive keyed environment|resource; keep the key only when that agent is in the inventory.
  const credits = raw.credits.map((c) => ({ ...c, agentKey: agentKeyLower.get(`${c.envId}|${c.resourceId}`.toLowerCase()) ?? agentKeyLower.get(c.agentKey.toLowerCase()) ?? '' }))
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
    interactions,
    surfaces: surfaceMap,
    users: raw.users,
    namesResolved: opt.namesResolved,
    shadowSignals: raw.shadowSignals,
    shadowDevices: raw.shadowDevices,
    credits,
    creditPool: raw.creditPool,
    aiCostDaily: raw.aiCostDaily,
    aiCostMeters: raw.aiCostMeters,
    m365: raw.m365,
    lanes: opt.lanes,
    runs: opt.runs,
    appEnvironment: opt.appEnvironment,
  }
}

export const emptyRaw = (): RawData => ({
  agents: [], environments: [], flows: [], connectors: [], knowledge: [], sources: [], spAgents: [],
  aiResources: [], interactions: [], users: [], shadowSignals: [], shadowDevices: [],
  credits: [], creditPool: [], aiCostDaily: [], aiCostMeters: [],
})
