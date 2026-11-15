// ============ Creator ranking read model — spec 5.1 tests =============
//
// Logic only: disabled creators excluded, tie order, unpublished routes not
// counted, forksToNext 0 for rank 1, and the style filter. No markup.
import { describe, expect, it } from 'vitest'
import type { CachedUser, PublishedItinerary, PublicUser } from '../src/data/types'
import { rankCreators, rankOf } from '../src/lib/creatorRank'

const NOW = Date.UTC(2026, 10, 15, 12)

function pub(overrides: Partial<PublishedItinerary> = {}): PublishedItinerary {
  return {
    id: 'p1',
    tripId: 't1',
    creatorId: 'c1',
    title: 'Route one',
    tagline: '',
    routeSummary: ['Kochi'],
    durationDays: 3,
    estimatedBudgetPerPersonInr: 10000,
    travelStyle: 'relaxed',
    travelTips: [],
    warningsAndAssumptions: [],
    freeDayIndexes: [0],
    publishedAt: NOW,
    views: 10,
    copies: 5,
    ...overrides,
  }
}

function user(id: string, overrides: Partial<PublicUser['profile']> = {}): PublicUser {
  return {
    id,
    kind: 'public',
    profile: { name: `Creator ${id}`, isCreator: true, creatorAvailable: true, ...overrides },
  }
}

function privateUser(id: string): CachedUser {
  return {
    id,
    kind: 'private',
    email: `${id}@example.com`,
    createdAt: NOW,
    profile: { name: `Private ${id}`, isCreator: true, creatorAvailable: true, travelStyles: [] },
  }
}

describe('rankCreators', () => {
  it('a disabled creator never ranks', () => {
    const users = [user('c1'), user('c2', { creatorAvailable: false })]
    const pubs = [pub({ creatorId: 'c1' }), pub({ id: 'p2', creatorId: 'c2', copies: 100 })]
    const rows = rankCreators(pubs, users)
    expect(rows.map(row => row.id)).toEqual(['c1'])
    expect(rankOf(rows, 'c2')).toBeUndefined()
  })

  it('a creator missing from users never ranks', () => {
    const pubs = [pub({ creatorId: 'unknown' })]
    expect(rankCreators(pubs, [user('c1')])).toEqual([])
  })

  it('unpublished routes are not counted', () => {
    const users = [user('c1')]
    const pubs = [
      pub({ copies: 2, views: 10 }),
      pub({ id: 'p2', copies: 100, views: 500, unpublishedAt: NOW }),
    ]
    const rows = rankCreators(pubs, users)
    expect(rows[0]).toMatchObject({ id: 'c1', plans: 1, forks: 2, views: 10, rank: 1 })
  })

  it('ties follow the creatorList order: forks, plans, name, id', () => {
    const users = [user('a'), user('b'), user('c')]
    const pubs = [
      pub({ id: 'p1', creatorId: 'a', copies: 5, views: 1 }),
      pub({ id: 'p2', creatorId: 'b', copies: 5, views: 1, publishedAt: NOW - 1000 }),
      pub({ id: 'p3', creatorId: 'c', copies: 5, views: 1, publishedAt: NOW - 2000 }),
    ]
    expect(rankCreators(pubs, users).map(row => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('knownFor is the most common style, ties to the earlier TRAVEL_STYLES name', () => {
    const users = [user('c1')]
    const pubs = [
      pub({ travelStyle: 'packed' }),
      pub({ id: 'p2', travelStyle: 'relaxed' }),
      pub({ id: 'p3', travelStyle: 'relaxed' }),
      pub({ id: 'p4', travelStyle: 'packed' }),
    ]
    expect(rankCreators(pubs, users)[0].knownFor).toBe('packed')
  })

  it('knownFor ties pick the alphabetically earlier style, whatever the input order', () => {
    const users = [user('c1')]
    const relaxed = pub({ id: 'p2', travelStyle: 'relaxed' })
    const packed = pub({ id: 'p3', travelStyle: 'packed' })
    expect(rankCreators([relaxed, packed], users)[0].knownFor).toBe('packed')
    expect(rankCreators([packed, relaxed], users)[0].knownFor).toBe('packed')
  })

  it('fork ties break by plans, with shuffled inputs', () => {
    const users = [user('c1'), user('c2')]
    const first = [
      pub({ id: 'p1', creatorId: 'c1', copies: 5, views: 1 }),
      pub({ id: 'p2', creatorId: 'c1', copies: 0, views: 1 }),
      pub({ id: 'p3', creatorId: 'c2', copies: 5, views: 1 }),
    ]
    expect(rankCreators(first, users).map(row => row.id)).toEqual(['c1', 'c2'])
    expect(rankCreators([...first].reverse(), users).map(row => row.id)).toEqual(['c1', 'c2'])
    expect(rankOf(rankCreators(first, users), 'c2')).toEqual({ rank: 2, total: 2, forksToNext: 0 })
  })

  it('the style filter narrows the pool before anything is counted', () => {
    const users = [user('c1')]
    const pubs = [
      pub({ copies: 1, views: 1, travelStyle: 'relaxed' }),
      pub({ id: 'p2', copies: 50, views: 500, travelStyle: 'packed' }),
    ]
    const rows = rankCreators(pubs, users, { style: 'relaxed' })
    expect(rows[0]).toMatchObject({ id: 'c1', plans: 1, forks: 1, views: 1, knownFor: 'relaxed' })
  })

  it('views sum over live routes, private users rank too', () => {
    const pubs = [pub({ views: 7 }), pub({ id: 'p2', views: 8 })]
    const rows = rankCreators(pubs, [privateUser('c1')])
    expect(rows[0]).toMatchObject({ id: 'c1', views: 15 })
  })
})

describe('rankOf', () => {
  it('forksToNext is 0 for rank 1', () => {
    const users = [user('c1'), user('c2')]
    const pubs = [
      pub({ creatorId: 'c1', copies: 10 }),
      pub({ id: 'p2', creatorId: 'c2', copies: 4 }),
    ]
    const rows = rankCreators(pubs, users)
    expect(rankOf(rows, 'c1')).toEqual({ rank: 1, total: 2, forksToNext: 0 })
    expect(rankOf(rows, 'c2')).toEqual({ rank: 2, total: 2, forksToNext: 6 })
  })

  it('undefined for a creator with no live route', () => {
    expect(rankOf([], 'c1')).toBeUndefined()
  })
})
