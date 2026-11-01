import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { A } from '../metrics/measures'
import { SAMPLE_FILES, sampleDataset, type SampleTexts } from './sample'

const dir = fileURLToPath(new URL('../../public/sample/', import.meta.url))
const read = (name: string) => readFileSync(dir + name, 'utf8')
const texts = { ...Object.fromEntries(SAMPLE_FILES.map((f) => [f, read(`${f}.csv`)])), manifest: read('manifest.json') } as SampleTexts
const ds = sampleDataset(texts)
const manifest = JSON.parse(texts.manifest) as { asOf: string; files: { name: string; rows: number }[] }
const csv = (name: string) => Papa.parse<Record<string, string>>(read(name), { header: true, skipEmptyLines: true }).data

describe('sample', () => {
  it('matches the manifest row counts', () => {
    const counts = Object.fromEntries(manifest.files.map((f) => [f.name, f.rows]))
    expect(ds.agents).toHaveLength(counts['agents.csv'])
    expect(ds.environments).toHaveLength(counts['environments.csv'])
    expect(ds.spAgents).toHaveLength(counts['sharepoint-agents.csv'])
    expect(ds.connectors).toHaveLength(counts['connectors.csv'])
    expect(ds.sources).toHaveLength(counts['knowledge-sources.csv'])
    expect(ds.asOf).toBe(manifest.asOf)
  })

  it('ships inventory files only, with no usage or cost data', () => {
    expect(manifest.files.map((f) => f.name).sort()).toEqual(SAMPLE_FILES.map((f) => `${f}.csv`).sort())
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

  it('has agents in every risk band and a mix of last-used states', () => {
    expect(A.high(ds.agents)).toBeGreaterThan(0)
    expect(A.medium(ds.agents)).toBeGreaterThan(0)
    expect(A.used(ds.agents)).toBeGreaterThan(0)
    expect(A.neverUsed(ds.agents)).toBeGreaterThan(0)
    expect(A.idle(ds.agents) + A.dormant(ds.agents)).toBeGreaterThan(0)
  })
  it('marks every lane as sample', () => {
    expect(ds.mode).toBe('sample')
    expect(ds.lanes.every((l) => l.state === 'sample')).toBe(true)
  })
})
