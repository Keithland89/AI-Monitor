const DAY = 86_400_000

/** Whole days since 1970-01-01 (UTC) for a yyyy-mm-dd date or ISO timestamp; NaN when blank or invalid. */
export const dayNum = (d: string | null | undefined) => (d ? Math.floor(Date.parse(d.slice(0, 10) + 'T00:00:00Z') / DAY) : NaN)

/** Splits rows into the `days` ending on `end` and the `days` before that. */
export function splitPeriods<T>(rows: readonly T[], date: (r: T) => string | null | undefined, end: string, days = 7): [T[], T[]] {
  const e = dayNum(end)
  const cur: T[] = []
  const prev: T[] = []
  if (Number.isNaN(e)) return [cur, prev]
  for (const r of rows) {
    const ago = e - dayNum(date(r))
    if (ago >= 0 && ago < days) cur.push(r)
    else if (ago >= days && ago < days * 2) prev.push(r)
  }
  return [cur, prev]
}

export interface Change {
  current: number
  previous: number
  delta: number
  /** Relative change; NaN when the previous period is zero. */
  ratio: number
}

export const change = (current: number, previous: number): Change => ({
  current,
  previous,
  delta: current - previous,
  ratio: previous ? current / previous - 1 : NaN,
})

/** A measure for each of the `weeks` 7-day windows ending on `end`, oldest first. Feeds the KPI sparklines. */
export function weeklySeries<T>(rows: readonly T[], date: (r: T) => string | null | undefined, end: string, measure: (rs: T[]) => number, weeks = 12): number[] {
  const e = dayNum(end)
  if (Number.isNaN(e)) return []
  const buckets: T[][] = Array.from({ length: weeks }, () => [])
  for (const r of rows) {
    const ago = e - dayNum(date(r))
    if (ago >= 0 && ago < weeks * 7) buckets[weeks - 1 - Math.floor(ago / 7)].push(r)
  }
  return buckets.map(measure)
}

/** A measure over the last `days` against the `days` before, ending on `end`. */
export function periodChange<T>(rows: readonly T[], date: (r: T) => string | null | undefined, end: string, measure: (rs: T[]) => number, days = 7): Change {
  const [cur, prev] = splitPeriods(rows, date, end, days)
  return change(measure(cur), measure(prev))
}
