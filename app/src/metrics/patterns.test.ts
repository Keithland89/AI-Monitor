import { describe, expect, it } from 'vitest'
import type { M365Usage } from '../data/types'
import { copilotFit, outOfHours } from './patterns'

const counts = (outlook: number, word: number) => ({ outlook, word, teams: 0, excel: 0, powerPoint: 0, oneNote: 0 })

const usage: M365Usage = {
  refreshed: '2026-09-03',
  active: 1000,
  services: [],
  // 31 Aug and 1 Sep 2026 are weekdays; 30 Aug is a Sunday and is left out of the typical weekday.
  appDaily: [
    { date: '2026-08-30', counts: counts(50, 5) },
    { date: '2026-08-31', counts: counts(800, 200) },
    { date: '2026-09-01', counts: counts(900, 300) },
  ],
  emailDaily: [],
  teamsDaily: [],
  copilot: [
    { product: 'anyApp', enabled: 200, active: 100 },
    { product: 'outlook', enabled: 200, active: 50 },
    { product: 'word', enabled: 200, active: 80 },
    { product: 'copilotChat', enabled: 200, active: 90 },
  ],
  failed: [],
  collectedAt: '',
}

describe('copilotFit', () => {
  it('ranks apps by weekday users working without Copilot', () => {
    const rows = copilotFit(usage)
    expect(rows.map((r) => r.label)).toEqual(['Outlook', 'Word', 'Copilot Chat'])
    expect(rows[0]).toMatchObject({ typical: 850, active: 50, reach: 0.25, without: 800 })
    expect(rows[1]).toMatchObject({ typical: 250, without: 170, reach: 0.4 })
  })

  it('keeps products with no app usage report last, without a typical day', () => {
    const chat = copilotFit(usage).at(-1)!
    expect(chat.label).toBe('Copilot Chat')
    expect(chat.typical).toBeNaN()
    expect(chat.without).toBeNaN()
  })
})

describe('outOfHours', () => {
  const grid = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0))

  it('counts weekends and hours outside 08 to 18 as out of hours', () => {
    const g = grid()
    g[0][9] = 6 // Monday 09:00
    g[2][17] = 2 // Wednesday 17:00
    g[4][18] = 1 // Friday 18:00
    g[5][10] = 1 // Saturday
    expect(outOfHours(g)).toBeCloseTo(0.2)
  })

  it('is unknown with no turns', () => {
    expect(outOfHours(grid())).toBeNaN()
  })
})
