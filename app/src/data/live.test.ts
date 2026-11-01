import { describe, expect, it, vi } from 'vitest'

// The SDK only resolves inside a bundler; these helpers never call it.
vi.mock('@microsoft/managed-apps/app', () => ({ getContext: vi.fn() }))
vi.mock('@microsoft/managed-apps/data', () => ({ getClient: vi.fn() }))

import { classifyError, foundryDetail, LaneError, listFoundryResources, mapSharePointAgent, skipTokenFrom } from './live'

describe('live helpers', () => {
  it('reads the Dataverse skip token from a next link', () => {
    expect(skipTokenFrom(undefined)).toBeUndefined()
    expect(skipTokenFrom('https://host/api/data/v9.2/poc_x?$select=a&$skiptoken=%3Ccookie%20page%3D%222%22%2F%3E')).toBe('<cookie page="2"/>')
    expect(skipTokenFrom('https://host/api/data/v9.2/poc_x?$select=a')).toBeUndefined()
  })

  it('classifies permission, missing-table and other failures', () => {
    expect(classifyError(new LaneError('nope', 403)).state).toBe('denied')
    expect(classifyError(new Error('Insufficient privileges to complete the operation')).state).toBe('denied')
    expect(classifyError(new LaneError('Resource not found for the segment poc_x', 404), true).state).toBe('not-set-up')
    expect(classifyError(new LaneError('Resource not found', 404), false).state).toBe('error')
    expect(classifyError('timeout').state).toBe('error')
  })

  it('maps a SharePoint agent row from the landing table', () => {
    expect(mapSharePointAgent({
      poc_agentkey: ' ABC-1 ', poc_name: 'Policy helper', poc_filename: 'Policy helper.agent', poc_siteurl: 'https://example.test/sites/hr',
      poc_lastseenat: '2026-06-01T10:11:12Z', poc_isdeleted: 'false', poc_eventcount: '3',
    })).toMatchObject({ key: 'abc-1', name: 'Policy helper', siteUrl: 'https://example.test/sites/hr', lastSeenAt: '2026-06-01T10:11:12', isDeleted: false, eventCount: 3 })
  })
  it('flags Foundry subscriptions with more pages as truncated and skips failed ones', async () => {
    const pages: Record<string, () => Promise<{ value?: { id: string; subscriptionId?: string }[]; nextLink?: string }>> = {
      one: async () => ({ value: [{ id: 'a' }] }),
      two: async () => ({ value: [{ id: 'b' }, { id: 'c', subscriptionId: 'other' }], nextLink: 'https://management.example.test/subscriptions/two/resources?$skiptoken=abc' }),
      bad: async () => { throw new LaneError('Forbidden', 403) },
    }
    const listPage = vi.fn((id: string) => pages[id]())
    const r = await listFoundryResources(['one', 'two', 'bad'], listPage)
    expect(listPage).toHaveBeenCalledTimes(3)
    expect(r.resources.map((x) => [x.id, x.subscriptionId])).toEqual([['a', 'one'], ['b', 'two'], ['c', 'other']])
    expect(r).toMatchObject({ skipped: 1, truncated: 1 })
    expect(foundryDetail(r)).toBe('1 subscription(s) could not be read and were skipped. 1 subscription(s) returned more than one page; results may be truncated.')
    expect(foundryDetail({ skipped: 0, truncated: 0 })).toBeUndefined()
  })
})
