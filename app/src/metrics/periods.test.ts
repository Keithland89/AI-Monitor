import { describe, expect, it } from 'vitest'
import { change, periodChange, splitPeriods, weeklySeries } from './periods'

describe('weeklySeries', () => {
  const rows = ['2026-09-02', '2026-09-01', '2026-08-27', '2026-08-26', '2026-08-01', 'bad'].map((date) => ({ date }))

  it('buckets rows into 7-day windows ending on the last day, oldest first', () => {
    expect(weeklySeries(rows, (r) => r.date, '2026-09-02', (rs) => rs.length, 3)).toEqual([0, 1, 3])
  })

  it('ignores rows outside the window and invalid dates', () => {
    expect(weeklySeries(rows, (r) => r.date, '2026-09-02', (rs) => rs.length, 1)).toEqual([3])
  })

  it('returns nothing when there is no end date', () => {
    expect(weeklySeries(rows, (r) => r.date, '', (rs) => rs.length)).toEqual([])
  })
})

describe('periods', () => {
  const rows = ['2026-09-01', '2026-08-26', '2026-08-25', '2026-08-19', '2026-08-18'].map((date, i) => ({ date, id: 'abcde'[i] }))

  it('splits into this week and the week before', () => {
    const [cur, prev] = splitPeriods(rows, (r) => r.date, '2026-09-01')
    expect(cur.map((r) => r.id)).toEqual(['a', 'b'])
    expect(prev.map((r) => r.id)).toEqual(['c', 'd'])
  })

  it('works out the change, with NaN for a zero base', () => {
    expect(change(12, 10)).toEqual({ current: 12, previous: 10, delta: 2, ratio: expect.closeTo(0.2) })
    expect(change(3, 0).ratio).toBeNaN()
    expect(periodChange(rows, (r) => r.date, '2026-09-01', (rs) => rs.length)).toMatchObject({ current: 2, previous: 2, delta: 0 })
  })
})