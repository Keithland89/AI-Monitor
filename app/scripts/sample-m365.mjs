// Adds synthetic Microsoft 365 usage reports to public/sample. The anonymised source has no Graph usage
// reports, so this writes plausible tenant-wide counts sized to the sample: the people who used Copilot in
// the sample set the Copilot numbers, and the rest of the tenant is scaled around them. Each report keeps the
// JSON shape Microsoft Graph returns, wrapped the way the daily flow stores it in Dataverse.
// Seeded, so reruns give the same file.
// Usage: node scripts/sample-m365.mjs   (`npm run sample` runs it after the other sample scripts)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'

const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public', 'sample')
const manifestPath = join(dir, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const copilotUsers = Papa.parse(readFileSync(join(dir, 'interaction-users.csv'), 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data.length

let seed = 20260906
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const jitter = (n, spread = 0.08) => Math.round(n * (1 - spread + rand() * spread * 2))

// Microsoft's usage reports run about two days behind.
const asOf = new Date(`${manifest.asOf.slice(0, 10)}T00:00:00Z`)
const refresh = new Date(asOf)
refresh.setUTCDate(refresh.getUTCDate() - 2)
const reportRefreshDate = refresh.toISOString().slice(0, 10)
const DAYS = 30
const days = Array.from({ length: DAYS }, (_, i) => {
  const d = new Date(refresh)
  d.setUTCDate(d.getUTCDate() - (DAYS - 1 - i))
  return d.toISOString().slice(0, 10)
})
const weekday = (date) => {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay()
  return w === 0 || w === 6 ? 0.12 : 1
}

const ACTIVE = 1180
const services = {
  reportRefreshDate,
  office365Active: ACTIVE, office365Inactive: 64,
  exchangeActive: 1152, exchangeInactive: 92,
  oneDriveActive: 1006, oneDriveInactive: 238,
  sharePointActive: 934, sharePointInactive: 310,
  skypeForBusinessActive: 0, skypeForBusinessInactive: 0,
  yammerActive: 212, yammerInactive: 1032,
  teamsActive: 1128, teamsInactive: 116,
  reportPeriod: 30,
}

// A typical weekday's share of the active base, per app.
const APP_SHARE = { outlook: 0.74, teams: 0.79, word: 0.31, excel: 0.27, powerPoint: 0.13, oneNote: 0.05 }
const apps = {
  reportRefreshDate,
  reportPeriod: 30,
  userCounts: days.map((reportDate) => ({
    reportDate,
    ...Object.fromEntries(Object.entries(APP_SHARE).map(([k, s]) => [k, jitter(ACTIVE * s * weekday(reportDate))])),
  })),
}

const email = days.map((reportDate) => {
  const w = weekday(reportDate)
  return {
    reportRefreshDate, reportDate,
    send: jitter(9800 * w), receive: jitter(41200 * w + 2200), read: jitter(30600 * w + 900),
    meetingCreated: jitter(610 * w), meetingInteracted: jitter(2900 * w),
    reportPeriod: 30,
  }
})

const teams = days.map((reportDate) => {
  const w = weekday(reportDate)
  return {
    reportRefreshDate, reportDate,
    teamChatMessages: jitter(3400 * w), privateChatMessages: jitter(21800 * w + 300),
    calls: jitter(1450 * w), meetings: jitter(1380 * w),
    meetingsOrganizedCount: jitter(560 * w), meetingsAttendedCount: jitter(4100 * w),
    postMessages: jitter(1900 * w), replyMessages: jitter(1500 * w), urgentMessages: jitter(12 * w),
    reportPeriod: 30,
  }
})

// The sample's Copilot users are the 30-day active base; licences run well ahead of use.
const enabled = 250
const any = copilotUsers
const PRODUCT_SHARE = { microsoftTeams: 0.72, outlook: 0.6, word: 0.45, excel: 0.22, powerPoint: 0.27, oneNote: 0.06, loop: 0.03, copilotChat: 0.9 }
const copilot = {
  reportRefreshDate,
  adoptionByProduct: [
    {
      reportPeriod: 30,
      anyAppEnabledUsers: enabled,
      anyAppActiveUsers: any,
      ...Object.fromEntries(Object.entries(PRODUCT_SHARE).flatMap(([k, s]) => [[`${k}EnabledUsers`, enabled], [`${k}ActiveUsers`, Math.round(any * s)]])),
    },
  ],
}

const collectedAt = `${manifest.asOf.slice(0, 10)}T06:00:00Z`
const row = (name, body) => ({ name, payload: JSON.stringify(body), status: '200', collectedAt })
const rows = [
  row('getOffice365ServicesUserCounts', { value: [services] }),
  row('getM365AppUserCounts', { value: [apps] }),
  row('getEmailActivityCounts', { value: email }),
  row('getTeamsUserActivityCounts', { value: teams }),
  row('getMicrosoft365CopilotUserCountSummary', { value: [copilot] }),
]

const NAME = 'm365-usage.json'
writeFileSync(join(dir, NAME), JSON.stringify(rows, null, 2) + '\n')
manifest.files = [...manifest.files.filter((f) => f.name !== NAME), { name: NAME, rows: rows.length }]
manifest.syntheticM365 = true
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Wrote ${NAME}: ${rows.length} reports, ${any} of ${enabled} licensed people using Copilot, ${ACTIVE} active on Microsoft 365.`)
