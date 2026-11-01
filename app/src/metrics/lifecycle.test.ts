import { describe, expect, it } from 'vitest'
import type { Agent } from '../data/types'
import { hasUsageSignal, lifecycleOf, reviewAgents, verdictOf } from './lifecycle'

const agent = (o: Partial<Agent>): Agent =>
  ({
    key: 'A', name: 'Agent', platform: 'Copilot Studio', ageDays: 200, lastUsed: '2026-08-30T00:00:00', daysSinceLastUse: 2, activityStatus: 'Active (7d)',
    riskBand: 'Low', riskScore: 1, hasOwner: true, sharedTenantWide: false, ...o,
  }) as Agent

describe('agent lifecycle', () => {
  it('stages agents by age and the Power Platform last-used date', () => {
    expect(lifecycleOf(agent({ ageDays: 5 }))).toBe('New')
    expect(lifecycleOf(agent({}))).toBe('Active')
    expect(lifecycleOf(agent({ activityStatus: 'Active (30d)' }))).toBe('Active')
    expect(lifecycleOf(agent({ activityStatus: 'Idle (90d)', daysSinceLastUse: 45 }))).toBe('Idle')
    expect(lifecycleOf(agent({ activityStatus: 'Dormant (90d+)', daysSinceLastUse: 120 }))).toBe('Dormant')
    expect(lifecycleOf(agent({ activityStatus: 'No usage signal', lastUsed: '', daysSinceLastUse: null }))).toBe('Never used')
  })

  it('gives each agent a verdict with a reason, retiring before reviewing', () => {
    expect(verdictOf(agent({ daysSinceLastUse: 120, riskBand: 'High' }), 'Dormant')).toEqual({ verdict: 'Retire', reason: 'Not used for 120 days' })
    expect(verdictOf(agent({ lastUsed: '', ageDays: 90 }), 'Never used').verdict).toBe('Retire')
    expect(verdictOf(agent({ riskBand: 'High', riskScore: 7 }), 'Active')).toEqual({ verdict: 'Review', reason: 'High risk (score 7)' })
    expect(verdictOf(agent({ hasOwner: false }), 'Active').reason).toBe('No owner')
    expect(verdictOf(agent({}), 'New').verdict).toBe('Watch')
    expect(verdictOf(agent({ ageDays: 40 }), 'Never used')).toEqual({ verdict: 'Watch', reason: 'Not used yet' })
    expect(verdictOf(agent({ daysSinceLastUse: 45 }), 'Idle')).toEqual({ verdict: 'Watch', reason: 'Last used 45 days ago' })
    expect(verdictOf(agent({}), 'Active').verdict).toBe('Keep')
  })

  it('never judges agents on platforms with no usage signal on use', () => {
    const builder = agent({ platform: 'M365 Copilot Agent Builder', activityStatus: 'No usage signal', lastUsed: '', daysSinceLastUse: null, ageDays: 400 })
    expect(hasUsageSignal(builder)).toBe(false)
    expect(hasUsageSignal(agent({ platform: 'Azure AI Foundry' }))).toBe(false)
    expect(hasUsageSignal(agent({}))).toBe(true)
    expect(lifecycleOf(builder)).toBe('No usage signal')
    expect(lifecycleOf({ ...builder, ageDays: 5 })).toBe('No usage signal')
    expect(verdictOf(builder, 'No usage signal')).toEqual({ verdict: 'Keep', reason: 'No usage signal on this platform' })
    expect(reviewAgents([{ ...builder, riskBand: 'High', riskScore: 6 }])[0]).toMatchObject({ stage: 'No usage signal', verdict: 'Review' })
    const studio = agent({ activityStatus: 'No usage signal', lastUsed: '', daysSinceLastUse: null, ageDays: 400 })
    expect(reviewAgents([studio])[0]).toMatchObject({ stage: 'Never used', verdict: 'Retire' })
  })

  it('reviews a list of agents', () => {
    const [r] = reviewAgents([agent({ activityStatus: 'Idle (90d)', daysSinceLastUse: 50 })])
    expect(r).toMatchObject({ stage: 'Idle', verdict: 'Watch' })
  })
})