import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SAMPLE_FILES, sampleDataset, type SampleTexts } from '../data/sample'
import { EMPTY_FILTERS, scopeOf } from '../data/store'
import { TABS } from '../routes'
import { buildContext, buildPrompt, CONTEXT_LIMIT, SUGGESTIONS } from './context'

const dir = fileURLToPath(new URL('../../public/sample/', import.meta.url))
const read = (name: string) => readFileSync(dir + name, 'utf8')
const texts = { ...Object.fromEntries(SAMPLE_FILES.map((f) => [f, read(`${f}.csv`)])), manifest: read('manifest.json') } as SampleTexts
const ds = sampleDataset(texts)

describe('ask context', () => {
  const all = buildContext(ds, scopeOf(ds, EMPTY_FILTERS), EMPTY_FILTERS, { label: 'Overview' })

  it('summarises every area the sample covers, inside the size cap', () => {
    expect(all.length).toBeLessThanOrEqual(CONTEXT_LIMIT + 30)
    for (const h of ['## Agents', '## Ownership', '## Risk', '## Lifecycle review', '## Integrations']) expect(all).toContain(h)
    expect(all).toContain(`No filters: all ${ds.agents.length.toLocaleString('en-GB')} agents.`)
    expect(all).toContain('anonymised sample')
    expect(all).not.toMatch(/NaN|undefined/)
    expect(all).not.toMatch(/Copilot Credits|interactions|audit activity/i)
  })

  it('names the riskiest agents and the agents to act on', () => {
    const named = ds.agents.filter((a) => all.includes(a.name))
    expect(named.length).toBeGreaterThan(5)
  })

  it('follows the filters', () => {
    const platform = ds.agents[0].platform
    const f = { ...EMPTY_FILTERS, platform }
    const scope = scopeOf(ds, f)
    const text = buildContext(ds, scope, f, { label: 'Governance' })
    expect(text).toContain(`Platform = ${platform}`)
    expect(text).toContain(`${scope.agents.length.toLocaleString('en-GB')} of ${ds.agents.length.toLocaleString('en-GB')} agents in view`)
    expect(text).toContain('Page open: Governance.')
  })

  it('flags lanes without data as unknown rather than zero', () => {
    const gapped = { ...ds, lanes: [...ds.lanes, { id: 'shadow' as const, label: 'Shadow AI', connector: 'Defender', state: 'denied' as const, rows: 0, detail: 'Forbidden' }] }
    const text = buildContext(gapped, scopeOf(gapped, EMPTY_FILTERS), EMPTY_FILTERS, { label: 'Shadow AI' })
    expect(text).toMatch(/treat these areas as unknown, not zero\): Shadow AI \(denied: Forbidden\)/)
  })
})

describe('ask prompt', () => {
  it('puts the question last and keeps only the last two turns', () => {
    const history = [1, 2, 3].map((i) => ({ question: `q${i}`, answer: `a${i}` }))
    const p = buildPrompt('  Which agents?  ', 'CTX', history)
    expect(p).toContain('CTX')
    expect(p).not.toContain('Q: q1')
    expect(p).toContain('Q: q2\nA: a2')
    expect(p.endsWith('Question: Which agents?')).toBe(true)
  })

  it('has starter questions for every section', () => {
    for (const t of TABS) expect(SUGGESTIONS[t.id]?.length).toBeGreaterThan(0)
  })
})
