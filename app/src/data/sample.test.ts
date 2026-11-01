import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { A, I } from '../metrics/measures'
import { SAMPLE_FILES, SAMPLE_M365, sampleDataset, type SampleTexts } from './sample'

const dir = fileURLToPath(new URL('../../public/sample/', import.meta.url))
const read = (name: string) => readFileSync(dir + name, 'utf8')
const texts = { ...Object.fromEntries(SAMPLE_FILES.map((f) => [f, read(`${f}.csv`)])), manifest: read('manifest.json'), m365: read(SAMPLE_M365) } as SampleTexts
const ds = sampleDataset(texts)
const manifest = JSON.parse(texts.manifest) as { asOf: string; files: { name: string; rows: number }[] }
const csv = (name: string) => Papa.parse<Record<string, string>>(read(name), { header: true, skipEmptyLines: true }).data

describe('sample', () => {
  it('matches the manifest row counts', () => {
    const counts = Object.fromEntries(manifest.files.map((f) => [f.name, f.rows]))
    expect(ds.agents).toHaveLength(counts['agents.csv'])
    expect(ds.environments).toHaveLength(counts['environments.csv'])
    expect(ds.interactions).toHaveLength(counts['interactions.csv'])
    expect(ds.surfaces.size).toBe(counts['surfaces.csv'])
    expect(ds.spAgents).toHaveLength(counts['sharepoint-agents.csv'])
    expect(ds.asOf).toBe(manifest.asOf)
  })

  it('is internally consistent', () => {
    const agentKeys = new Set(ds.agents.map((a) => a.key))
    const envIds = new Set(ds.environments.map((e) => e.id.toLowerCase()))
    expect(agentKeys.size).toBe(ds.agents.length)
    // A few agents live in environments the source inventory did not list; the model keeps them too.
    const unlisted = ds.agents.filter((x) => x.platform !== 'Azure AI Foundry' && !envIds.has(x.envId.toLowerCase()))
    expect(unlisted.length).toBeLessThan(ds.agents.length * 0.01)
    expect(ds.agents.filter((a) => a.platform !== 'Azure AI Foundry').every((a) => a.envName)).toBe(true)
    for (const c of ds.connectors) expect(agentKeys.has(c.agentKey), c.agentKey).toBe(true)
    for (const k of ds.knowledge) expect(agentKeys.has(k.agentKey), k.agentKey).toBe(true)
    for (const s of ds.surfaces.values()) if (s.agentKey) expect(agentKeys.has(s.agentKey), s.key).toBe(true)
    for (const i of ds.interactions) {
      expect(ds.surfaces.has(i.surfaceKey)).toBe(true)
      expect(i.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    }
    expect(ds.interactions.every((i) => i.user)).toBe(true)
  })

  it('recomputes the risk score, band and reasons the model shipped', () => {
    const shipped = new Map(csv('agents.csv').map((r) => [r.AgentKey, r]))
    const mismatches = ds.agents.filter((a) => {
      const r = shipped.get(a.key)!
      return Number(r.RiskScore) !== a.riskScore || r.RiskBand !== a.riskBand || r.Platform !== a.platform
    })
    expect(mismatches.map((a) => a.key)).toEqual([])
    const withReasons = ds.agents.filter((a) => shipped.get(a.key)!.RiskReasons)
    for (const a of withReasons) expect(a.riskReasons).toBe(shipped.get(a.key)!.RiskReasons)
  })

  it('keeps every Chat and Cowork row and has agents in every risk band', () => {
    const hosts = new Set(ds.interactions.map((i) => i.appHost.toLowerCase()))
    expect(hosts.has('cowork')).toBe(true)
    expect(hosts.has('m365copilot')).toBe(true)
    expect(A.high(ds.agents)).toBeGreaterThan(0)
    expect(A.medium(ds.agents)).toBeGreaterThan(0)
    expect(I.agentsWithInteractions(ds.interactions)).toBeGreaterThan(0)
  })

  it('joins SharePoint agent usage to the SharePoint inventory', () => {
    const sp = [...ds.surfaces.values()].filter((s) => s.type === 'SharePoint agent')
    expect(sp.length).toBeGreaterThan(0)
    expect(sp.filter((s) => s.spAgentKey).length).toBeGreaterThan(0)
  })

  it('ships Microsoft 365 usage that fits the sample', () => {
    const m = ds.m365!
    expect(m.failed).toEqual([])
    expect(m.refreshed <= ds.asOf.slice(0, 10)).toBe(true)
    expect(m.appDaily).toHaveLength(30)
    expect(m.emailDaily).toHaveLength(30)
    expect(m.teamsDaily).toHaveLength(30)
    const any = m.copilot.find((c) => c.product === 'anyApp')!
    expect(any.active).toBeLessThanOrEqual(any.enabled)
    expect(any.enabled).toBeLessThan(m.active!)
    for (const c of m.copilot) expect(c.active, c.product).toBeLessThanOrEqual(any.active)
    for (const d of m.appDaily) for (const v of Object.values(d.counts)) expect(v).toBeLessThanOrEqual(m.active!)
  })

  it('marks every lane as sample', () => {
    expect(ds.mode).toBe('sample')
    expect(ds.lanes.every((l) => l.state === 'sample')).toBe(true)
  })

  it('ships synthetic cost data that joins to the inventory and the Azure AI listing', () => {
    const counts = Object.fromEntries(manifest.files.map((f) => [f.name, f.rows]))
    expect(ds.credits).toHaveLength(counts['credits.csv'])
    expect(ds.creditPool).toHaveLength(counts['credit-pool.csv'])
    expect(ds.aiCostDaily).toHaveLength(counts['ai-cost-daily.csv'])
    expect(ds.aiCostMeters).toHaveLength(counts['ai-cost-meters.csv'])
    const agentKeys = new Set(ds.agents.map((a) => a.key))
    const joined = ds.credits.filter((c) => c.agentKey)
    expect(joined.length).toBeGreaterThan(ds.credits.length * 0.9)
    for (const c of joined) expect(agentKeys.has(c.agentKey), c.agentKey).toBe(true)
    expect(ds.credits.some((c) => !c.agentKey)).toBe(true)
    const billed = ds.credits.reduce((s, c) => s + c.billed, 0)
    expect(ds.creditPool.find((p) => p.currency === 'MCSMessages')?.consumed).toBe(billed)
    const resources = new Set(ds.aiResources.map((r) => r.id.toLowerCase()))
    for (const d of ds.aiCostDaily) {
      expect(resources.has(d.resourceId), d.resourceId).toBe(true)
      expect(d.date >= '2026-08-07' && d.date <= manifest.asOf.slice(0, 10), d.date).toBe(true)
    }
    // Meter totals add up to each resource's daily spend, to the cent.
    const byRes = new Map<string, number>()
    for (const d of ds.aiCostDaily) byRes.set(d.resourceId, (byRes.get(d.resourceId) ?? 0) + d.cost)
    const byMeter = new Map<string, number>()
    for (const m of ds.aiCostMeters) byMeter.set(m.resourceId, (byMeter.get(m.resourceId) ?? 0) + m.cost)
    for (const [id, total] of byRes) expect(Math.abs((byMeter.get(id) ?? 0) - total), id).toBeLessThan(0.05)
  })
})
