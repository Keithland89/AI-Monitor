import { describe, expect, it } from 'vitest'
import type { LaneState, LaneStatus } from '../data/types'
import { laneProblem, laneProblems, unknownFrom } from './coverage'

const lane = (state: LaneState, rows = 0, detail?: string): LaneStatus => ({ id: 'shadow', label: 'Shadow AI (Defender)', connector: 'wdatp', state, rows, detail })

describe('lane coverage', () => {
  it('trusts lanes that loaded, are loading, or carry sample rows', () => {
    expect(laneProblem(lane('ok', 4))).toBeNull()
    expect(laneProblem(lane('loading'))).toBeNull()
    expect(laneProblem(lane('sample', 12))).toBeNull()
    expect(laneProblem(undefined)).toBeNull()
  })

  it('makes a failed lane unknown rather than zero, and says how to fix it', () => {
    const p = laneProblem(lane('denied'))!
    expect(p.kind).toBe('failed')
    expect(unknownFrom(p)).toBe('Access denied')
    expect(p.message).toMatch(/Security Reader/)
    expect(unknownFrom(laneProblem(lane('error', 0, 'Timed out.')))).toBe('Could not load')
    expect(laneProblem(lane('error', 0, 'Timed out.'))!.message).toMatch(/Timed out\./)
    expect(unknownFrom(laneProblem(lane('not-set-up')))).toBe('Not set up')
  })

  it('treats a sample lane without rows as absent', () => {
    const p = laneProblem(lane('sample', 0, 'The sample ships no Defender rows.'))!
    expect(p.kind).toBe('absent')
    expect(unknownFrom(p)).toBe('Not in the sample')
  })

  it('keeps an empty lane as a real zero, with a caveat', () => {
    const p = laneProblem(lane('empty'))!
    expect(p.kind).toBe('empty')
    expect(unknownFrom(p)).toBeUndefined()
  })

  it('lists problems for the lanes asked, in order', () => {
    const lanes = [lane('ok', 3), { ...lane('denied'), id: 'foundry' as const, label: 'Azure AI Foundry' }]
    expect(laneProblems(lanes, ['foundry', 'shadow', 'knowledge']).map((p) => p.lane.id)).toEqual(['foundry'])
  })
})
