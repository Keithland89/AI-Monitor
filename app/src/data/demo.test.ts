import { describe, expect, it } from 'vitest'
import { I } from '../metrics/measures'
import { syntheticDataset } from './demo'

describe('synthetic dashboard demo data', () => {
  it('is deterministic and uses sample-only lane markers', () => {
    const first = syntheticDataset()
    const second = syntheticDataset()

    expect(second).toEqual(first)
    expect(first.mode).toBe('sample')
    expect(first.lanes.length).toBeGreaterThan(10)
    expect(first.lanes.every((lane) => lane.state === 'sample')).toBe(true)
    expect(first.lanes.every((lane) => lane.connector === 'Local fixture')).toBe(true)
    expect(first.lanes.every((lane) => lane.detail?.includes('no live source queried'))).toBe(true)
  })

  it('provides synthetic relationships and enough history for every dashboard', () => {
    const ds = syntheticDataset()
    const agentKeys = new Set(ds.agents.map((agent) => agent.key))
    const resourceIds = new Set(ds.aiResources.map((resource) => resource.id.toLowerCase()))

    expect(ds.agents).toHaveLength(24)
    expect(ds.agents.every((agent) => agent.name.length > 0 && agent.envName.startsWith('Demo '))).toBe(true)
    expect(new Set(ds.agents.map((agent) => agent.activityStatus))).toEqual(new Set([
      'Active (7d)',
      'Active (30d)',
      'Idle (90d)',
      'Dormant (90d+)',
      'No usage signal',
    ]))
    expect(ds.agents.some((agent) => agent.riskBand === 'High')).toBe(true)
    expect(ds.agents.some((agent) => agent.riskBand === 'Medium')).toBe(true)
    expect(ds.agents.some((agent) => agent.riskBand === 'Low')).toBe(true)
    expect(ds.interactions.length).toBeGreaterThan(200)
    expect(I.runTimeHours(ds.interactions)).toBeGreaterThan(0)
    expect(ds.interactions.every((row) => row.date <= ds.asOf.slice(0, 10))).toBe(true)
    expect(ds.interactions.every((row) => row.user.endsWith('@example.invalid'))).toBe(true)
    expect(ds.interactions.filter((row) => row.agentKey).every((row) => agentKeys.has(row.agentKey))).toBe(true)
    expect(ds.spAgents.length).toBeGreaterThan(0)
    expect(ds.shadowSignals.length).toBeGreaterThan(0)
    expect(ds.m365?.appDaily).toHaveLength(30)
    expect(ds.m365?.copilot.find((row) => row.product === 'anyApp')?.active).toBeGreaterThan(0)
    expect(ds.aiCostDaily.every((row) => resourceIds.has(row.resourceId))).toBe(true)
    expect(ds.runs.every((run) => run.state === 'sample' && run.status === 'Synthetic demo fixture')).toBe(true)
  })
})
