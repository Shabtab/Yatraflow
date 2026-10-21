import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  PILOT_CAMPAIGNS, campaignId, campaignFromSearch, withCampaign,
  rememberFork, takeForkAttribution, pendingForkId, finishPendingFork,
} from '../src/lib/growthAttribution'

const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('bounded campaign attribution', () => {
  it('accepts only registered opaque pilot codes', () => {
    for (const id of Object.keys(PILOT_CAMPAIGNS)) expect(campaignId(id)).toBe(id)
    for (const bad of ['Priya', '9845012345', 'person@example.com', 'p_unknown', '', '__proto__', 'constructor', ['p_a7c1d9e4b206']]) {
      expect(campaignId(bad)).toBeNull()
    }
    expect(campaignFromSearch('?campaign=p_a7c1d9e4b206&ref=wa')).toBe('p_a7c1d9e4b206')
    expect(campaignFromSearch('?campaign=person%40example.com')).toBeNull()
    expect(campaignFromSearch('?campaign=p_a7c1d9e4b206&campaign=p_f2b8a064cd19')).toBeNull()
  })

  it('keeps existing source, buyer, and hash data when minting a campaign link', () => {
    const url = '/i/pub_fixture?ref=wa&buyer=opaque#section'
    expect(withCampaign(url, 'p_a7c1d9e4b206')).toBe('/i/pub_fixture?ref=wa&buyer=opaque&campaign=p_a7c1d9e4b206#section')
    expect(withCampaign(url, 'person@example.com')).toBe(url)
    const stamped = withCampaign(url, 'p_a7c1d9e4b206')
    expect(withCampaign(stamped, 'p_f2b8a064cd19')).toBe(stamped)
  })

  it('keeps the SQL validator and scorecard aligned with the five campaign slots', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261015a_growth_attribution.sql', import.meta.url), 'utf8')
    const ids = [...sql.matchAll(/'p_[a-f0-9]{12}'/g)].map(match => match[0].slice(1, -1))
    expect(ids.sort()).toEqual(Object.keys(PILOT_CAMPAIGNS).sort())
    const report = readFileSync(new URL('../supabase/reports/distribution_scorecard.sql', import.meta.url), 'utf8')
    for (const id of ids) expect(report).toContain(`'${id}'`)
    expect(report).toContain('begin transaction read only;')
    expect(report).not.toMatch(/\b[tmsda]\.(name|title|question|description|phone|email)\b/i)
  })
})

describe('explicit sign-in return context', () => {
  it('returns only the matching public plan context once', () => {
    rememberFork('pub_fixture', { source: 'wa', campaign: 'p_a7c1d9e4b206' })
    expect(takeForkAttribution('another_publication')).toBeNull()
    expect(takeForkAttribution('pub_fixture', false)).toEqual({ source: 'wa', campaign: 'p_a7c1d9e4b206' })
    expect(takeForkAttribution('pub_fixture', false)).toEqual({ source: 'wa', campaign: 'p_a7c1d9e4b206' })
    expect(takeForkAttribution('pub_fixture')).toEqual({ source: 'wa', campaign: 'p_a7c1d9e4b206' })
    expect(takeForkAttribution('pub_fixture')).toBeNull()
  })

  it('expires context without linking later unrelated visits', () => {
    vi.useFakeTimers()
    rememberFork('pub_expired', { source: 'creator', campaign: null })
    vi.advanceTimersByTime(31 * 60 * 1000)
    expect(takeForkAttribution('pub_expired')).toBeNull()
  })

  it('drops unrecognized stored fields and tags', () => {
    storage.set('yf.pending-publication-fork', JSON.stringify({
      pubId: 'pub_fixture', source: 'person@example.com', campaign: '9845012345', at: Date.now(), phone: '9845012345',
    }))
    expect(takeForkAttribution('pub_fixture')).toEqual({ source: null, campaign: null })
  })

  it('keeps a pending action ID until confirmed success', () => {
    const first = pendingForkId('owner-test', 'pub_fixture')
    expect(pendingForkId('owner-test', 'pub_fixture')).toBe(first)
    expect(first).toMatch(/^[a-f0-9-]{36}$/)
    expect(pendingForkId('another-owner', 'pub_fixture')).not.toBe(first)
    finishPendingFork('owner-test', 'pub_fixture')
    expect(pendingForkId('owner-test', 'pub_fixture')).not.toBe(first)
    expect([...storage.values()].every(value => !value.includes('phone'))).toBe(true)
  })

  it('retains safe retry behavior when browser storage is denied', () => {
    vi.stubGlobal('sessionStorage', {
      getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') },
    })
    expect(() => rememberFork('pub_private', { source: null, campaign: null })).not.toThrow()
    expect(takeForkAttribution('pub_private')).toBeNull()
    expect(pendingForkId('private-owner', 'pub_private')).toBe(pendingForkId('private-owner', 'pub_private'))
    expect(() => finishPendingFork('private-owner', 'pub_private')).not.toThrow()
  })

  it('creates a valid retry ID when randomUUID is unavailable', () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    vi.stubGlobal('crypto', { getRandomValues })
    const id = pendingForkId('lan-owner', 'pub_lan')
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    expect(pendingForkId('lan-owner', 'pub_lan')).toBe(id)
  })

  it('recovers a pending trip ID after the module reloads in the same tab', async () => {
    const first = pendingForkId('reload-owner', 'pub_reload')
    vi.resetModules()
    const fresh = await import('../src/lib/growthAttribution')
    expect(fresh.pendingForkId('reload-owner', 'pub_reload')).toBe(first)
    fresh.finishPendingFork('reload-owner', 'pub_reload')
  })
})
