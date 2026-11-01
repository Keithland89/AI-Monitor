import { describe, expect, it } from 'vitest'
import type { Agent } from '../data/types'
import { A, bars, cumulative, div, freshness, monthly, monthRange } from './measures'

describe('agent measures', () => {
  it('counts tenant-wide agents with no Power Platform last-used date', () => {
    const agents = [
      { sharedTenantWide: true, lastUsed: '' },
      { sharedTenantWide: true, lastUsed: '2026-01-01T00:00:00' },
      { sharedTenantWide: false, lastUsed: '' },
    ] as Agent[]
    expect(A.orphan(agents)).toBe(1)
    expect(A.neverUsed(agents)).toBe(2)
  })

  it('keeps no-signal platforms out of never used, idle and dormant, but not out of the risk reason', () => {
    const agents = [
      { platform: 'M365 Copilot Agent Builder', sharedTenantWide: true, lastUsed: '', activityStatus: 'No usage signal' },
      { platform: 'Copilot Studio', sharedTenantWide: false, lastUsed: '', activityStatus: 'No usage signal' },
      { platform: 'Copilot Studio', sharedTenantWide: false, lastUsed: '2026-01-01T00:00:00', activityStatus: 'Dormant (90d+)' },
    ] as Agent[]
    expect(A.neverUsed(agents)).toBe(1)
    expect(A.noUsageSignal(agents)).toBe(1)
    expect(A.dormant(agents)).toBe(1)
    expect(A.idle(agents)).toBe(0)
    expect(A.orphan(agents)).toBe(1)
  })
})

describe('helpers', () => {
  it('sorts bars by value and labels blanks', () => {
    expect(bars(['a', 'b', 'b', ''], (r) => r)).toEqual([
      { key: 'b', label: 'b', value: 2 },
      { key: '(Blank)', label: '(Blank)', value: 1 },
      { key: 'a', label: 'a', value: 1 },
    ])
  })

  it('fills month gaps and accumulates', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    const m = monthly(['2026-01-05', '2026-03-01', '2026-03-09', ''], (d) => d.slice(0, 7))
    expect(m).toEqual([
      { key: '2026-01', values: [1] },
      { key: '2026-02', values: [0] },
      { key: '2026-03', values: [2] },
    ])
    expect(cumulative(m).map((p) => p.values[0])).toEqual([1, 1, 3])
  })

  it('returns NaN on divide by zero, as DIVIDE returns blank', () => {
    expect(Number.isNaN(div(1, 0))).toBe(true)
  })

  it('describes knowledge freshness', () => {
    expect(freshness([], '2026-06-10T00:00:00')).toBe('Never collected')
    expect(freshness(['2026-06-10T00:00:00'], '2026-06-10T08:00:00')).toBe('2026-06-10 (today)')
    expect(freshness(['2026-06-01T00:00:00', '2026-06-08T00:00:00'], '2026-06-10T00:00:00')).toBe('2026-06-08 (2d ago)')
    expect(freshness(['2026-06-01T00:00:00'], '2026-06-10T00:00:00')).toBe('2026-06-01 (9d ago - STALE)')
  })
})
