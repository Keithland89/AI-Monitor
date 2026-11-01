import { describe, expect, it } from 'vitest'
import { href, NAV_GROUPS, parse, TABS } from './routes'

const route = (hash: string) => {
  const r = parse(hash)
  return `${r.tab.id}/${r.view}`
}

describe('routes', () => {
  it('sends the old SharePoint tab to its Inventory view', () => {
    expect(route('#/sharepoint')).toBe('inventory/sharepoint')
    expect(TABS.some((t) => (t.id as string) === 'sharepoint')).toBe(false)
  })

  it('sends the old lifecycle review to Governance, keeping its parameters', () => {
    const r = parse('#/usage/lifecycle?verdict=Retire')
    expect(`${r.tab.id}/${r.view}`).toBe('governance/lifecycle')
    expect(r.params).toEqual({ verdict: 'Retire' })
  })

  it('sends removed usage, activity and cost views to the Overview', () => {
    for (const hash of ['#/usage', '#/usage/popularity', '#/activity/habits', '#/activity/patterns', '#/cost/credits', '#/cost/azure']) {
      expect(route(hash)).toBe('overview/')
    }
    for (const id of ['usage', 'activity', 'cost']) expect(TABS.some((t) => (t.id as string) === id)).toBe(false)
  })

  it('opens the Governance views', () => {
    expect(route('#/governance')).toBe('governance/risk')
    expect(route('#/governance/lifecycle')).toBe('governance/lifecycle')
  })

  it('falls back to the first view or tab', () => {
    expect(route('#/inventory/nope')).toBe(`inventory/${TABS.find((t) => t.id === 'inventory')!.views[0].id}`)
    expect(parse('#/nope').tab).toBe(TABS[0])
  })

  it('reads page parameters from the hash query', () => {
    expect(parse('#/governance?band=High').params.band).toBe('High')
    expect(parse('#/governance').params).toEqual({})
  })

  it('writes links with only the parameters that are set', () => {
    expect(href('governance', 'lifecycle', { verdict: 'Retire', other: '' })).toBe('#/governance/lifecycle?verdict=Retire')
    expect(href('governance')).toBe('#/governance')
  })

  it('places every section in exactly one nav group', () => {
    const listed = NAV_GROUPS.flatMap((g) => g.tabs)
    expect([...listed].sort()).toEqual(TABS.map((t) => t.id).sort())
  })
})