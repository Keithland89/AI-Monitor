import type { CopilotProduct, M365App, M365Usage } from './types'

/** The Graph usage reports the daily flow stores, by the function name it saves each one under. */
export const M365_REPORTS = {
  services: 'getOffice365ServicesUserCounts',
  apps: 'getM365AppUserCounts',
  email: 'getEmailActivityCounts',
  teams: 'getTeamsUserActivityCounts',
  copilot: 'getMicrosoft365CopilotUserCountSummary',
} as const

/** One stored report: the Graph function name, the response body and the HTTP status the flow saw. */
export interface M365ReportRow {
  name: string
  payload: string
  status?: string
  collectedAt?: string
}

type Row = Record<string, unknown>

const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)

const n = (v: unknown) => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(x) ? x : 0
}

const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '')

/**
 * Graph's JSON usage reports put one or more items in `value`. Some items hold the counts directly; others
 * nest them in an array (daily `userCounts`, per-product `adoptionByProduct`). This returns one flat row per
 * count, with the parent's scalar fields (such as reportRefreshDate) copied into each nested row.
 */
export function flattenReport(json: unknown): Row[] {
  const items = isRow(json) && Array.isArray(json.value) ? json.value : Array.isArray(json) ? json : []
  const out: Row[] = []
  for (const item of items) {
    if (!isRow(item)) continue
    const scalars: Row = {}
    const nested: Row[][] = []
    for (const [k, v] of Object.entries(item)) {
      if (Array.isArray(v)) nested.push(v.filter(isRow))
      else if (!isRow(v)) scalars[k] = v
    }
    if (!nested.length) out.push(scalars)
    else for (const list of nested) for (const r of list) out.push({ ...scalars, ...r })
  }
  return out
}

function parsePayload(payload: string): Row[] | null {
  try {
    return flattenReport(JSON.parse(payload))
  } catch {
    return null
  }
}

const SERVICES: [string, string][] = [
  ['exchange', 'Email'],
  ['teams', 'Teams'],
  ['oneDrive', 'OneDrive'],
  ['sharePoint', 'SharePoint'],
  ['yammer', 'Viva Engage'],
]

const APPS: M365App[] = ['outlook', 'teams', 'word', 'excel', 'powerPoint', 'oneNote']

const PRODUCTS: CopilotProduct[] = ['anyApp', 'microsoftTeams', 'outlook', 'word', 'excel', 'powerPoint', 'oneNote', 'loop', 'copilotChat']

const byDate = <T extends { date: string }>(rows: T[]) => {
  // A report can repeat a day across refreshes; keep the last copy of each day.
  const m = new Map<string, T>()
  for (const r of rows) if (r.date) m.set(r.date, r)
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const ok = (status?: string) => !status || /^2\d\d$/.test(status.trim())

/** Turns the stored report rows into tenant-wide counts. Returns undefined when no report has data. */
export function parseM365(rows: M365ReportRow[]): M365Usage | undefined {
  const got = new Map<string, Row[]>()
  const failed: M365Usage['failed'] = []
  let collectedAt = ''
  for (const r of rows) {
    if (r.collectedAt && r.collectedAt > collectedAt) collectedAt = r.collectedAt
    const parsed = ok(r.status) ? parsePayload(r.payload) : null
    if (parsed) got.set(r.name, parsed)
    else failed.push({ name: r.name, status: r.status?.trim() || 'Unreadable response' })
  }
  if (![...got.values()].some((v) => v.length)) return undefined

  const all = [...got.values()].flat()
  const refreshed = all.map((r) => day(r.reportRefreshDate)).filter(Boolean).sort().at(-1) ?? ''

  const svc = got.get(M365_REPORTS.services)?.[0]
  const services = svc
    ? SERVICES.map(([key, label]) => ({ key, label, active: n(svc[`${key}Active`]) })).filter((s) => s.active > 0)
    : []
  const active = svc ? n(svc.office365Active) : null

  const appDaily = byDate(
    (got.get(M365_REPORTS.apps) ?? []).map((r) => ({
      date: day(r.reportDate),
      counts: Object.fromEntries(APPS.map((a) => [a, n(r[a])])) as Record<M365App, number>,
    })),
  )

  const emailDaily = byDate(
    (got.get(M365_REPORTS.email) ?? []).map((r) => ({
      date: day(r.reportDate),
      sent: n(r.send),
      received: n(r.receive),
      read: n(r.read),
      meetingsCreated: n(r.meetingCreated),
    })),
  )

  const teamsDaily = byDate(
    (got.get(M365_REPORTS.teams) ?? []).map((r) => ({
      date: day(r.reportDate),
      channel: n(r.teamChatMessages),
      chat: n(r.privateChatMessages),
      calls: n(r.calls),
      meetings: n(r.meetings),
    })),
  )

  // The summary can carry several periods; prefer the 30-day one, else the first.
  const adoption = got.get(M365_REPORTS.copilot) ?? []
  const cp = adoption.find((r) => n(r.reportPeriod) === 30) ?? adoption[0]
  const copilot = cp
    ? PRODUCTS.map((product) => ({ product, enabled: n(cp[`${product}EnabledUsers`]), active: n(cp[`${product}ActiveUsers`]) })).filter(
        (p) => p.enabled > 0 || p.active > 0,
      )
    : []

  return { refreshed, active, services, appDaily, emailDaily, teamsDaily, copilot, failed, collectedAt }
}
