// ============ Creator storefront read model — PLAN-pw12a §5, cases 1-6 ======
//
// Logic only: figures, the publications view, live-only scoping, start
// places, the lead route, and one type-level check that the storefront input
// accepts a `PublicUser`. No class names, no markup.
import { describe, expect, it } from 'vitest'
import type { PublicUser, PublishedItinerary } from '../src/data/types'
import { filterByStart, leadRoute, publishingSince, startPlaces, storefrontFigures, storefrontSections } from '../src/lib/creatorStorefront'

const NOW = Date.UTC(2026, 10, 15, 12)

function pub(overrides: Partial<PublishedItinerary> = {}): PublishedItinerary {
  return {
    id: 'p1',
    tripId: 't1',
    creatorId: 'c1',
    title: 'Route one',
    tagline: '',
    routeSummary: ['Kochi', 'Munnar'],
    durationDays: 3,
    estimatedBudgetPerPersonInr: 10000,
    travelStyle: 'relaxed',
    travelTips: [],
    warningsAndAssumptions: [],
    freeDayIndexes: [0],
    publishedAt: NOW - 86400000,
    views: 10,
    copies: 5,
    ...overrides,
  }
}

function user(overrides: Partial<PublicUser['profile']> = {}): PublicUser {
  return {
    id: 'c1',
    kind: 'public',
    profile: { name: 'Has9', isCreator: true, creatorAvailable: true, ...overrides },
  }
}

describe('storefrontFigures', () => {
  it('case 1: a total is null when the read is not ready, and a real 0 when it is', () => {
    const figures = storefrontFigures([], 'ready')
    expect(figures).toEqual({ liveRoutes: 0, views: 0, forks: 0, free: 0, paid: 0 })
    for (const read of ['reading', 'failed'] as const) {
      expect(storefrontFigures([pub()], read)).toEqual({
        liveRoutes: null,
        views: null,
        forks: null,
        free: null,
        paid: null,
      })
    }
  })
})

describe('storefrontSections', () => {
  it('case 2: the publications view is kept with rows after a failed read', () => {
    const sections = storefrontSections({ user: user(), pubs: [pub()], read: 'failed' })
    expect(sections.pubsView).toBe('kept')
  })

  it('case 2: failed or reading with no rows is never the empty copy', () => {
    expect(storefrontSections({ user: user(), pubs: [], read: 'failed' }).pubsView).toBe('failed')
    expect(storefrontSections({ user: user(), pubs: [], read: 'reading' }).pubsView).toBe('reading')
  })

  it('case 2: empty only after a ready read', () => {
    expect(storefrontSections({ user: user(), pubs: [], read: 'ready' }).pubsView).toBe('empty')
  })

  it('case 6: the storefront input accepts a PublicUser, needing no private field', () => {
    const input: Parameters<typeof storefrontSections>[0] = {
      user: user({ name: 'Public name only' }),
      pubs: [],
      read: 'ready',
    }
    expect(input.user.profile.name).toBe('Public name only')
  })
})

describe('unpublished routes', () => {
  it('case 3: are in no figure, no start-place count and no publishing-since date', () => {
    const pubs = [pub({ id: 'live', views: 10, copies: 2 }), pub({ id: 'gone', unpublishedAt: NOW, views: 100, copies: 50, publishedAt: NOW - 86400000 * 400 })]
    const figures = storefrontFigures(pubs, 'ready')
    expect(figures).toEqual({ liveRoutes: 1, views: 10, forks: 2, free: 1, paid: 0 })
    expect(publishingSince(pubs)).toBe(pubs[0].publishedAt)
    expect(startPlaces(pubs)).toEqual([])
  })
})

describe('startPlaces and filterByStart', () => {
  it('case 4: counts sum to the live routes that have a start', () => {
    const pubs = [
      pub({ id: 'a', routeSummary: ['Kochi', 'Alleppey'] }),
      pub({ id: 'b', routeSummary: ['kochi'] }),
      pub({ id: 'c', routeSummary: ['Munnar'] }),
    ]
    const places = startPlaces(pubs)
    expect(places.map(place => place.place)).toEqual(['Kochi', 'Munnar'])
    expect(places.reduce((sum, place) => sum + place.count, 0)).toBe(3)
  })

  it('case 4: a route with an empty routeSummary is counted under no place', () => {
    const pubs = [
      pub({ id: 'a', routeSummary: ['Kochi'] }),
      pub({ id: 'b', routeSummary: ['Munnar'] }),
      pub({ id: 'c', routeSummary: [] }),
    ]
    const places = startPlaces(pubs)
    expect(places.reduce((sum, place) => sum + place.count, 0)).toBe(2)
    expect(filterByStart(pubs, null).map(p => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('case 4: the filter returns the same objects, in a stable order', () => {
    const a = pub({ id: 'a', routeSummary: ['Kochi'] })
    const b = pub({ id: 'b', routeSummary: ['Munnar'] })
    const filtered = filterByStart([a, b], 'kochi')
    expect(filtered).toEqual([a])
    expect(filtered[0]).toBe(a)
  })
})

describe('leadRoute', () => {
  it('case 5: undefined below the threshold', () => {
    expect(leadRoute([pub({ copies: 2 })])).toBeUndefined()
  })

  it('case 5: the most forked live route, never an unpublished one', () => {
    const winner = pub({ id: 'winner', copies: 9 })
    const gone = pub({ id: 'gone', copies: 50, unpublishedAt: NOW })
    expect(leadRoute([winner, gone])).toBe(winner)
  })
})
