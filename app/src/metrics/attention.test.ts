import { describe, expect, it } from 'vitest'
import type { Agent } from '../data/types'
import { ATTENTION, attentionCheck, attentionCounts } from './attention'

const agent = (o: Partial<Agent>): Agent =>
  ({ key: 'a', riskBand: 'Low', hasOwner: true, sharedTenantWide: false, authentication: 'Microsoft Entra ID', lastUsed: '2026-09-01T00:00:00', ownerPrincipalType: 'User', ...o }) as Agent

describe('attention checks', () => {
  const agents = [
    agent({ riskBand: 'High', hasOwner: false }),
    agent({ sharedTenantWide: true, authentication: 'None', lastUsed: '' }),
    agent({ sharedTenantWide: true, authentication: '' }),
    agent({ ownerPrincipalType: 'Not resolved in Entra' }),
    agent({}),
  ]

  it('counts every check in severity order', () => {
    expect(attentionCounts(agents).map((c) => [c.check.id, c.count])).toEqual([
      ['high-no-owner', 1],
      ['shared-no-auth', 2],
      ['shared-unused', 1],
      ['owner-unresolved', 1],
    ])
  })

  it('finds a check by id, and nothing for an unknown id', () => {
    expect(attentionCheck('shared-unused')?.test(agents[1])).toBe(true)
    expect(attentionCheck('nope')).toBeUndefined()
  })

  it('has unique ids', () => {
    expect(new Set(ATTENTION.map((c) => c.id)).size).toBe(ATTENTION.length)
  })
})
