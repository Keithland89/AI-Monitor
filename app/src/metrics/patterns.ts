import type { CopilotProduct, M365App, M365Usage } from '../data/types'

/** Each Copilot product, the Office app whose daily users it is compared with, and one thing to try there. */
const FITS: { product: CopilotProduct; app?: M365App; label: string; idea: string }[] = [
  { product: 'outlook', app: 'outlook', label: 'Outlook', idea: 'Summarise long threads and draft replies' },
  { product: 'microsoftTeams', app: 'teams', label: 'Teams', idea: 'Recap meetings and catch up on busy chats' },
  { product: 'word', app: 'word', label: 'Word', idea: 'Draft from notes and summarise long files' },
  { product: 'excel', app: 'excel', label: 'Excel', idea: 'Analyse data and write formulas in plain words' },
  { product: 'powerPoint', app: 'powerPoint', label: 'PowerPoint', idea: 'Turn a document into a first-draft deck' },
  { product: 'oneNote', app: 'oneNote', label: 'OneNote', idea: 'Turn meeting notes into actions' },
  { product: 'loop', label: 'Loop', idea: 'Draft and summarise shared pages' },
  { product: 'copilotChat', label: 'Copilot Chat', idea: 'Research across work content and the web' },
]

export interface FitRow {
  label: string
  idea: string
  typical: number
  active: number
  reach: number
  without: number
}

const isWeekday = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d !== 0 && d !== 6
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

/** Where Copilot fits the way people already work: the busiest apps where few licensed people use it yet. */
export function copilotFit(u: M365Usage): FitRow[] {
  const weekdays = u.appDaily.filter((d) => isWeekday(d.date))
  const enabled = u.copilot.find((c) => c.product === 'anyApp')?.enabled ?? 0
  const rows = FITS.flatMap((f) => {
    const c = u.copilot.find((x) => x.product === f.product)
    if (!c) return []
    const typical = f.app ? Math.round(mean(weekdays.map((d) => d.counts[f.app!]))) : NaN
    const licensed = c.enabled || enabled
    return [{
      label: f.label,
      idea: f.idea,
      typical,
      active: c.active,
      reach: licensed ? c.active / licensed : NaN,
      without: Number.isFinite(typical) ? Math.max(0, typical - c.active) : NaN,
    }]
  })
  return rows.sort((a, b) => (Number.isFinite(b.without) ? b.without : -1) - (Number.isFinite(a.without) ? a.without : -1))
}

/** The share of Copilot turns outside Monday to Friday, 08:00 to 18:00 UTC. */
export function outOfHours(grid: number[][]) {
  let total = 0
  let inside = 0
  grid.forEach((hours, d) =>
    hours.forEach((n, h) => {
      total += n
      if (d < 5 && h >= 8 && h < 18) inside += n
    }),
  )
  return total ? 1 - inside / total : NaN
}
