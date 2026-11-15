import { describe, expect, it, vi } from 'vitest'
import { PostgrestError } from '@supabase/supabase-js'
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
import { supabase } from '../src/lib/supabase'
import {
  mapCreatorShareSources, mapCreatorPageViews, creatorPageSource, claimCreatorPageView,
  fetchCreatorShareSources, fetchCreatorPageViews, bumpCreatorPageView, CREATOR_PAGE_SOURCES, ownerActivityCsv, failedOwnerRead,
} from '../src/lib/creatorOwnerReads'

describe('owner read boundaries', () => {
  it.each([{ code: 'PGRST202' }, { status: 404 }, { message: 'connection failed' }])('fails closed for %j', error => {
    expect(() => mapCreatorShareSources([], error)).toThrow()
    expect(() => mapCreatorPageViews([], error)).toThrow()
  })
  it('accepts only a successful array, including genuine empty reads', () => {
    expect(mapCreatorShareSources([], null)).toEqual([])
    expect(mapCreatorPageViews([], null)).toEqual([])
    for (const bad of [null, undefined, {}, [null], [{ source: null }]]) {
      expect(() => mapCreatorShareSources(bad, null)).toThrow()
      expect(() => mapCreatorPageViews(bad, null)).toThrow()
    }
  })
  it('maps direct links and bigint counts without changing their meaning', () => {
    expect(mapCreatorShareSources([{ source: null, views: '12', forks: 3 }], null))
      .toEqual([{ source: 'Direct link', views: 12, forks: 3 }])
    expect(mapCreatorPageViews([{ day: '2026-11-15', source: null, visits: '20' }], null))
      .toEqual([{ day: '2026-11-15', source: 'Direct link', visits: 20 }])
  })
  it.each([-1, null, '', 'NaN', 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid counts %j', visits => {
    expect(() => mapCreatorPageViews([{ day: '2026-11-15', source: null, visits }], null)).toThrow()
  })
  it('rejects unknown sources and invalid dates', () => {
    expect(() => mapCreatorShareSources([{ source: 'untrusted', views: 1, forks: 0 }], null)).toThrow()
    expect(() => mapCreatorPageViews([{ day: '2026-02-30', source: null, visits: 1 }], null)).toThrow()
  })
  it('propagates missing RPC failures rather than returning empty rows', async () => {
    const response = { success: false, data: null, error: new PostgrestError({ code: 'PGRST202', message: 'Missing function', details: '', hint: '' }),
      count: null, status: 404, statusText: 'Not Found' } satisfies Awaited<ReturnType<typeof supabase.rpc>>
    vi.mocked(supabase.rpc).mockResolvedValueOnce(response)
    await expect(fetchCreatorShareSources(30)).rejects.toEqual(response.error)
    vi.mocked(supabase.rpc).mockResolvedValueOnce(response)
    await expect(fetchCreatorPageViews(30)).rejects.toEqual(response.error)
  })
  it('keeps a successful read and its timestamp after failure, including an empty read', () => {
    expect(failedOwnerRead(null)).toEqual({ kind: 'failed', data: null, at: null })
    expect(failedOwnerRead({ kind: 'reading', data: null, at: null })).toEqual({ kind: 'failed', data: null, at: null })
    for (const data of [[], [{ source: 'Direct link', views: 3, forks: 1 }]]) {
      expect(failedOwnerRead({ kind: 'ready', data, at: 123 })).toEqual({ kind: 'kept', data, at: 123 })
    }
  })
})

describe('visitor attribution and session claims', () => {
  it('accepts every SQL source and drops arbitrary src values', () => {
    for (const source of CREATOR_PAGE_SOURCES) expect(creatorPageSource(`?src=${source}`)).toBe(source)
    for (const search of ['', '?ref=ig', '?src=ig-reel', '?src=IG', '?src=https://example.invalid']) {
      expect(creatorPageSource(search)).toBeNull()
    }
  })
  it('claims once per creator across mounts and reloads, with separate creators', () => {
    const stored = new Map<string, string>()
    const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) } }
    const claims = new Set<string>()
    expect(claimCreatorPageView('a', 'a', storage, claims)).toBe(false)
    expect(stored.size).toBe(0)
    expect(claimCreatorPageView('a', null, storage, claims)).toBe(true)
    expect(claimCreatorPageView('a', null, storage, claims)).toBe(false)
    expect(claimCreatorPageView('a', null, storage, new Set())).toBe(false)
    expect(claimCreatorPageView('b', 'viewer', storage, claims)).toBe(true)
  })
  it('uses memory when storage throws', () => {
    const claims = new Set<string>()
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(claimCreatorPageView('a', null, storage, claims)).toBe(true)
    expect(claimCreatorPageView('a', null, storage, claims)).toBe(false)
  })
  it('excludes owners and sends only allowlisted sources to the RPC', async () => {
    vi.mocked(supabase.rpc).mockClear()
    await bumpCreatorPageView('owner', 'ig', 'owner')
    expect(supabase.rpc).not.toHaveBeenCalled()
    vi.mocked(supabase.rpc).mockResolvedValue({ success: true, data: null, error: null, count: null, status: 204, statusText: 'No Content' })
    await bumpCreatorPageView('visitor-page', 'ig-reel', null)
    await bumpCreatorPageView('visitor-page', 'ig', null)
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('bump_creator_page_view', { p_creator: 'visitor-page', p_source: null })
  })
  it('names a post only for a post-tagged visit with a real post id', async () => {
    const rpc = vi.mocked(supabase.rpc)
    rpc.mockClear()
    rpc.mockResolvedValue({ success: true, data: null, error: null, count: null, status: 204, statusText: 'No Content' })
    const post = '17110000-0000-4000-8000-0000000000a1'
    await bumpCreatorPageView('tagged-a', 'post', null, post)
    await bumpCreatorPageView('tagged-b', 'ig', null, post)
    await bumpCreatorPageView('tagged-c', 'post', null, 'not-a-uuid')
    await bumpCreatorPageView('tagged-d', 'post', null)
    expect(rpc.mock.calls).toEqual([
      ['bump_creator_page_view', { p_creator: 'tagged-a', p_source: 'post', p_post: post }],
      ['bump_creator_page_view', { p_creator: 'tagged-b', p_source: 'ig' }],
      ['bump_creator_page_view', { p_creator: 'tagged-c', p_source: 'post' }],
      ['bump_creator_page_view', { p_creator: 'tagged-d', p_source: 'post' }],
    ])
  })
})

it('exports the meter counts without feed truncation or buyer fields', () => {
  const daily = Array.from({ length: 25 }, (_, i) => ({ pubId: `route-${i}`, day: '2026-11-15', views: 4, forks: 2 }))
  const csv = ownerActivityCsv(daily, [{ pubId: 'route-0', title: '=private,route', amountPaidInr: 199, feeInr: 0, netInr: 199,
    grantedAt: Date.parse('2026-11-15T01:00:00Z') }], [{ day: '2026-11-15', source: 'Direct link', visits: 150 }], Date.parse('2026-11-15T12:00:00Z'))
  const lines = csv.split('\r\n')
  expect(lines.filter(row => row.startsWith('forked,')).length).toBe(25)
  expect(lines.filter(row => row.startsWith('route-open,')).length).toBe(25)
  const total = (kind: string) => lines.filter(row => row.startsWith(`${kind},`)).reduce((sum, row) => sum + Number(row.split(',')[3]), 0)
  expect(total('route-open')).toBe(100)
  expect(total('forked')).toBe(50)
  expect(lines.filter(row => row.startsWith('page-visit,'))).toEqual(['page-visit,2026-11-15T00:00:00.000Z,,150,'])
  expect(lines.filter(row => row.startsWith('unlocked,')).length).toBe(1)
  expect(csv).toContain('"\'=private,route"')
  expect(csv).not.toMatch(/buyer|user_id|order_id/)
})
