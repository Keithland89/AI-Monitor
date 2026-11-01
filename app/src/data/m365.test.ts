import { describe, expect, it } from 'vitest'
import { flattenReport, M365_REPORTS, parseM365 } from './m365'

const services = {
  value: [
    {
      reportRefreshDate: '2026-09-03',
      office365Active: 1180,
      office365Inactive: 40,
      exchangeActive: 1150,
      teamsActive: 1120,
      oneDriveActive: 980,
      sharePointActive: 910,
      yammerActive: 0,
      reportPeriod: 30,
    },
  ],
}

const apps = {
  value: [
    {
      reportRefreshDate: '2026-09-03',
      reportPeriod: 30,
      userCounts: [
        { reportDate: '2026-09-02', outlook: 900, word: 300, excel: 250, powerPoint: 120, oneNote: 40, teams: 950 },
        { reportDate: '2026-09-01', outlook: 880, word: 290, excel: 240, powerPoint: 110, oneNote: 38, teams: 930 },
      ],
    },
  ],
}

const copilot = {
  value: [
    {
      reportRefreshDate: '2026-09-03',
      adoptionByProduct: [
        { reportPeriod: 30, anyAppEnabledUsers: 250, anyAppActiveUsers: 96, wordEnabledUsers: 250, wordActiveUsers: 40, loopEnabledUsers: 0, loopActiveUsers: 0 },
      ],
    },
  ],
}

describe('flattenReport', () => {
  it('keeps flat items as they are', () => {
    expect(flattenReport(services)).toEqual([services.value[0]])
  })

  it('copies parent fields into nested rows', () => {
    const rows = flattenReport(apps)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ reportRefreshDate: '2026-09-03', reportDate: '2026-09-02', outlook: 900 })
    expect(rows[0]).not.toHaveProperty('userCounts')
  })

  it('returns nothing for shapes it does not know', () => {
    expect(flattenReport(null)).toEqual([])
    expect(flattenReport({ error: { code: 'Forbidden' } })).toEqual([])
  })
})

describe('parseM365', () => {
  const row = (name: string, body: unknown, status = '200') => ({ name, payload: JSON.stringify(body), status, collectedAt: '2026-09-05T06:00:00Z' })

  it('reads every report into counts', () => {
    const u = parseM365([
      row(M365_REPORTS.services, services),
      row(M365_REPORTS.apps, apps),
      row(M365_REPORTS.copilot, copilot),
      row(M365_REPORTS.email, { value: [{ reportRefreshDate: '2026-09-03', reportDate: '2026-09-02', send: '10', receive: 20, read: 30, meetingCreated: 4 }] }),
      row(M365_REPORTS.teams, { value: [{ reportRefreshDate: '2026-09-03', reportDate: '2026-09-02', teamChatMessages: 5, privateChatMessages: 50, calls: 7, meetings: 9 }] }),
    ])!
    expect(u.refreshed).toBe('2026-09-03')
    expect(u.active).toBe(1180)
    expect(u.services.map((s) => s.key)).toEqual(['exchange', 'teams', 'oneDrive', 'sharePoint'])
    expect(u.appDaily.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02'])
    expect(u.appDaily[1].counts.outlook).toBe(900)
    expect(u.copilot).toEqual([
      { product: 'anyApp', enabled: 250, active: 96 },
      { product: 'word', enabled: 250, active: 40 },
    ])
    expect(u.emailDaily[0]).toEqual({ date: '2026-09-02', sent: 10, received: 20, read: 30, meetingsCreated: 4 })
    expect(u.teamsDaily[0]).toEqual({ date: '2026-09-02', channel: 5, chat: 50, calls: 7, meetings: 9 })
    expect(u.failed).toEqual([])
    expect(u.collectedAt).toBe('2026-09-05T06:00:00Z')
  })

  it('lists reports that failed and keeps the rest', () => {
    const u = parseM365([row(M365_REPORTS.services, services), row(M365_REPORTS.copilot, { error: 'Forbidden' }, '403'), { name: M365_REPORTS.apps, payload: 'not json' }])!
    expect(u.active).toBe(1180)
    expect(u.copilot).toEqual([])
    expect(u.failed).toEqual([
      { name: M365_REPORTS.copilot, status: '403' },
      { name: M365_REPORTS.apps, status: 'Unreadable response' },
    ])
  })

  it('returns undefined when nothing has data', () => {
    expect(parseM365([])).toBeUndefined()
    expect(parseM365([row(M365_REPORTS.services, { value: [] })])).toBeUndefined()
  })
})
