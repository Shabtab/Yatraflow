// ============ Explore page — pure logic ============
import { describe, expect, it } from 'vitest'
import {
  FEATURED_MIN_VIEWS,
  cardColumns,
  creatorList,
  matchesQuery,
  pickFeatured,
  placeTiles,
  routeTrail,
  savedEmptyKind,
} from '../src/lib/explorePage'
import { formatInrShort } from '../src/lib/engine'
import type { PublishedItinerary, User } from '../src/data/types'

const pub = (over: Partial<PublishedItinerary> & { id: string }): PublishedItinerary => ({
  tripId: `trip-${over.id}`,
  creatorId: 'creator-a',
  title: `Plan ${over.id}`,
  tagline: '',
  routeSummary: ['Kochi', 'Munnar'],
  durationDays: 4,
  estimatedBudgetPerPersonInr: 18000,
  travelStyle: 'relaxed',
  travelTips: [],
  warningsAndAssumptions: [],
  freeDayIndexes: [],
  publishedAt: 1_000,
  views: 0,
  copies: 0,
  ...over,
})

const user = (id: string, name: string, isCreator = true): User => ({
  id,
  email: `${id}@example.test`,
  profile: { name, languages: ['en'], travelStyles: [], isCreator },
  createdAt: 1,
})

const stopNames = (count: number, prefix = 's') => Array.from({ length: count }, (_, i) => `${prefix}${i}`)

describe('FEATURED_MIN_VIEWS', () => {
  it('is 25 views', () => {
    expect(FEATURED_MIN_VIEWS).toBe(25)
  })
})

describe('pickFeatured', () => {
  it('returns undefined for an empty list', () => {
    expect(pickFeatured([])).toBeUndefined()
  })

  it('returns undefined when no row has a fork or enough views', () => {
    const pubs = [pub({ id: 'a', views: 24, copies: 0 }), pub({ id: 'b', views: 0, copies: 0 })]
    expect(pickFeatured(pubs)).toBeUndefined()
  })

  it('qualifies a row at exactly FEATURED_MIN_VIEWS views with no fork', () => {
    const row = pub({ id: 'edge', views: FEATURED_MIN_VIEWS, copies: 0 })
    expect(pickFeatured([row])?.id).toBe('edge')
  })

  it('qualifies a row with one fork and no views', () => {
    const row = pub({ id: 'forked', views: 0, copies: 1 })
    expect(pickFeatured([row])?.id).toBe('forked')
  })

  it('ranks by forks first, even when another row has more views', () => {
    const pubs = [pub({ id: 'viewed', views: 900, copies: 1 }), pub({ id: 'forked', views: 10, copies: 2 })]
    expect(pickFeatured(pubs)?.id).toBe('forked')
  })

  it('breaks a fork tie by views', () => {
    const pubs = [pub({ id: 'quiet', views: 30, copies: 2 }), pub({ id: 'loud', views: 80, copies: 2 })]
    expect(pickFeatured(pubs)?.id).toBe('loud')
  })

  it('breaks a fork and view tie by the newest publication', () => {
    const pubs = [
      pub({ id: 'older', views: 40, copies: 1, publishedAt: 100 }),
      pub({ id: 'newer', views: 40, copies: 1, publishedAt: 900 }),
    ]
    expect(pickFeatured(pubs)?.id).toBe('newer')
    expect(pickFeatured([...pubs].reverse())?.id).toBe('newer')
  })

  it('skips unpublished rows even when they would win', () => {
    const pubs = [
      pub({ id: 'gone', copies: 9, views: 999, unpublishedAt: 5 }),
      pub({ id: 'live', copies: 1 }),
    ]
    expect(pickFeatured(pubs)?.id).toBe('live')
  })

  it('returns undefined when every qualifying row is unpublished', () => {
    expect(pickFeatured([pub({ id: 'gone', copies: 3, unpublishedAt: 5 })])).toBeUndefined()
  })

  it('does not reorder the input array', () => {
    const pubs = [pub({ id: 'low', copies: 1 }), pub({ id: 'high', copies: 5 })]
    pickFeatured(pubs)
    expect(pubs.map(p => p.id)).toEqual(['low', 'high'])
  })
})

describe('routeTrail', () => {
  it('gives no stops for an empty route', () => {
    expect(routeTrail([])).toEqual({ stops: [], hidden: 0 })
  })

  it('keeps a one-stop route whole', () => {
    expect(routeTrail(['Goa'])).toEqual({ stops: ['Goa'], hidden: 0 })
  })

  it('keeps a two-stop route whole', () => {
    expect(routeTrail(['Goa', 'Hampi'])).toEqual({ stops: ['Goa', 'Hampi'], hidden: 0 })
  })

  it('keeps every stop when the route is exactly max long', () => {
    expect(routeTrail(stopNames(5))).toEqual({ stops: stopNames(5), hidden: 0 })
  })

  it('keeps the first and last stop and spaces the middle stops evenly', () => {
    // 10 stops, max 5: first, last and three middle picks at offsets 0, 4, 7.
    expect(routeTrail(stopNames(10))).toEqual({ stops: ['s0', 's1', 's5', 's8', 's9'], hidden: 5 })
  })

  it('keeps one middle stop, from the centre, when max is 3', () => {
    expect(routeTrail(stopNames(10), 3)).toEqual({ stops: ['s0', 's4', 's9'], hidden: 7 })
  })

  it('keeps only the first and last stop when max is 2', () => {
    expect(routeTrail(stopNames(5), 2)).toEqual({ stops: ['s0', 's4'], hidden: 3 })
  })

  it('keeps only the first stop when max is 1', () => {
    expect(routeTrail(stopNames(5), 1)).toEqual({ stops: ['s0'], hidden: 4 })
  })

  it('treats a max below 1 as 1', () => {
    expect(routeTrail(stopNames(5), 0)).toEqual({ stops: ['s0'], hidden: 4 })
  })

  it('uses 5 for a NaN max', () => {
    expect(routeTrail(stopNames(10), Number.NaN)).toEqual(routeTrail(stopNames(10), 5))
  })

  it('shows every stop when max is Infinity', () => {
    expect(routeTrail(stopNames(12), Number.POSITIVE_INFINITY)).toEqual({ stops: stopNames(12), hidden: 0 })
  })

  it('defaults max to 5', () => {
    expect(routeTrail(stopNames(9))).toEqual(routeTrail(stopNames(9), 5))
  })

  it('keeps the count, order, ends and distinct stops for many sizes', () => {
    for (let total = 1; total <= 20; total++) {
      for (let cap = 1; cap <= 8; cap++) {
        const route = stopNames(total)
        const { stops, hidden } = routeTrail(route, cap)
        const expectedLength = Math.min(total, cap)
        expect(stops).toHaveLength(expectedLength)
        expect(hidden).toBe(total - expectedLength)
        expect(new Set(stops).size).toBe(stops.length)
        if (total > 0) expect(stops[0]).toBe(route[0])
        if (total > 1 && cap > 1) expect(stops[stops.length - 1]).toBe(route[total - 1])
        const positions = stops.map(stop => route.indexOf(stop))
        expect([...positions].sort((a, b) => a - b)).toEqual(positions)
      }
    }
  })

  it('does not mutate the input route', () => {
    const route = stopNames(10)
    routeTrail(route)
    expect(route).toEqual(stopNames(10))
  })
})

describe('placeTiles', () => {
  it('returns an empty list for no publications', () => {
    expect(placeTiles([])).toEqual([])
  })

  it('counts each live plan once per place, even when the place repeats', () => {
    const pubs = [pub({ id: 'a', routeSummary: ['Goa', 'Goa', 'Hampi'] })]
    expect(placeTiles(pubs)).toEqual([
      { name: 'Goa', count: 1 },
      { name: 'Hampi', count: 1 },
    ])
  })

  it('matches places ignoring case and outer spaces', () => {
    const pubs = [
      pub({ id: 'a', routeSummary: ['Goa'] }),
      pub({ id: 'b', routeSummary: [' goa '] }),
      pub({ id: 'c', routeSummary: ['GOA'] }),
      pub({ id: 'd', routeSummary: ['Goa'] }),
    ]
    expect(placeTiles(pubs)).toEqual([{ name: 'Goa', count: 4 }])
  })

  it('shows the most common spelling', () => {
    const pubs = [
      pub({ id: 'a', routeSummary: ['goa'] }),
      pub({ id: 'b', routeSummary: ['goa'] }),
      pub({ id: 'c', routeSummary: ['Goa'] }),
    ]
    expect(placeTiles(pubs)).toEqual([{ name: 'goa', count: 3 }])
  })

  it('breaks a spelling tie with the smaller spelling', () => {
    const pubs = [pub({ id: 'a', routeSummary: ['goa'] }), pub({ id: 'b', routeSummary: ['Goa'] })]
    expect(placeTiles(pubs)).toEqual([{ name: 'Goa', count: 2 }])
  })

  it('sorts by count, then by name', () => {
    const pubs = [
      pub({ id: 'a', routeSummary: ['Munnar', 'Kochi'] }),
      pub({ id: 'b', routeSummary: ['Kochi', 'Alleppey'] }),
      pub({ id: 'c', routeSummary: ['Kochi', 'Alleppey'] }),
    ]
    expect(placeTiles(pubs)).toEqual([
      { name: 'Kochi', count: 3 },
      { name: 'Alleppey', count: 2 },
      { name: 'Munnar', count: 1 },
    ])
  })

  it('returns the top 6 by default and honours a custom limit', () => {
    const pubs = [pub({ id: 'a', routeSummary: stopNames(10, 'place') })]
    expect(placeTiles(pubs)).toHaveLength(6)
    expect(placeTiles(pubs, [], 2)).toHaveLength(2)
    expect(placeTiles(pubs, [], 0)).toEqual([])
  })

  it('counts a tile as the live plans its click search finds, not only its exact stops', () => {
    // The tile "Goa" is opened by searching "Goa", which also finds a plan whose
    // title says Goa and a plan by a creator named Goa Trips.
    const users = [user('creator-a', 'Asha'), user('creator-b', 'Goa Trips')]
    const pubs = [
      pub({ id: 'stop', routeSummary: ['Goa', 'Hampi'] }),
      pub({ id: 'title', title: 'Goa in March', creatorId: 'creator-a', routeSummary: ['Pune', 'Kochi'] }),
      pub({ id: 'creator', creatorId: 'creator-b', routeSummary: ['Pune', 'Mysore'] }),
      pub({ id: 'gone', routeSummary: ['Goa'], unpublishedAt: 5 }),
    ]
    const goa = placeTiles(pubs, users).find(tile => tile.name === 'Goa')
    expect(goa).toEqual({ name: 'Goa', count: 3 })
    const matched = pubs.filter(p => !p.unpublishedAt && matchesQuery(p, 'Goa', users.find(u => u.id === p.creatorId)?.profile.name))
    expect(matched.map(p => p.id).sort()).toEqual(['creator', 'stop', 'title'])
  })
  it('ignores unpublished rows', () => {
    const pubs = [
      pub({ id: 'gone', routeSummary: ['Goa'], unpublishedAt: 5 }),
      pub({ id: 'live', routeSummary: ['Hampi'] }),
    ]
    expect(placeTiles(pubs)).toEqual([{ name: 'Hampi', count: 1 }])
  })

  it('skips blank place names', () => {
    expect(placeTiles([pub({ id: 'a', routeSummary: ['  ', '', 'Goa'] })])).toEqual([{ name: 'Goa', count: 1 }])
  })
})

describe('matchesQuery', () => {
  it('matches the title, the joined route stops and the creator name, ignoring case', () => {
    const row = pub({ id: 'a', title: 'Spice Coast', routeSummary: ['Kochi', 'Munnar'] })
    expect(matchesQuery(row, 'spice', 'Asha')).toBe(true)
    expect(matchesQuery(row, 'KOCHI munnar', 'Asha')).toBe(true)
    expect(matchesQuery(row, '  asha ', 'Asha')).toBe(true)
    expect(matchesQuery(row, 'goa', 'Asha')).toBe(false)
  })

  it('matches every plan for a blank needle', () => {
    expect(matchesQuery(pub({ id: 'a' }), '   ')).toBe(true)
  })

  it('does not match a creator name it was not given', () => {
    expect(matchesQuery(pub({ id: 'a', routeSummary: ['Goa'] }), 'asha')).toBe(false)
  })
})

describe('creatorList', () => {
  it('returns an empty list for no publications', () => {
    expect(creatorList([], [user('creator-a', 'Asha')])).toEqual([])
  })

  it('counts live plans and sums their forks per creator', () => {
    const users = [user('creator-a', 'Asha')]
    const pubs = [
      pub({ id: 'a1', creatorId: 'creator-a', copies: 3 }),
      pub({ id: 'a2', creatorId: 'creator-a', copies: 4 }),
    ]
    expect(creatorList(pubs, users)).toEqual([
      { id: 'creator-a', name: 'Asha', plans: 2, forks: 7, isCreator: true },
    ])
  })

  it('reports the isCreator flag from the profile', () => {
    const users = [user('creator-a', 'Asha', false)]
    expect(creatorList([pub({ id: 'a1', creatorId: 'creator-a' })], users)[0].isCreator).toBe(false)
  })

  it('skips creators that are not in the users list', () => {
    const users = [user('creator-a', 'Asha')]
    const pubs = [
      pub({ id: 'a1', creatorId: 'creator-a', copies: 1 }),
      pub({ id: 'ghost', creatorId: 'creator-missing', copies: 50 }),
    ]
    expect(creatorList(pubs, users).map(row => row.id)).toEqual(['creator-a'])
  })

  it('does not count unpublished rows, and drops a creator left with none', () => {
    const users = [user('creator-a', 'Asha'), user('creator-b', 'Ben')]
    const pubs = [
      pub({ id: 'a1', creatorId: 'creator-a', copies: 2 }),
      pub({ id: 'b1', creatorId: 'creator-b', copies: 9, unpublishedAt: 5 }),
    ]
    expect(creatorList(pubs, users)).toEqual([
      { id: 'creator-a', name: 'Asha', plans: 1, forks: 2, isCreator: true },
    ])
  })

  it('sorts by forks, then plans, then name', () => {
    const users = [user('c1', 'Zed'), user('c2', 'Amy'), user('c3', 'Bob'), user('c4', 'Cal')]
    const pubs = [
      pub({ id: 'p1', creatorId: 'c1', copies: 5 }),
      pub({ id: 'p2', creatorId: 'c2', copies: 2 }),
      pub({ id: 'p3', creatorId: 'c2', copies: 3 }),
      pub({ id: 'p4', creatorId: 'c3', copies: 5 }),
      pub({ id: 'p5', creatorId: 'c4', copies: 0 }),
    ]
    const ids = creatorList(pubs, users).map(row => row.id)
    // Amy, Bob and Zed all have 5 forks. Amy has 2 plans, so she leads. Bob and
    // Zed have 1 plan each, so the name decides: Bob first. Cal has no forks.
    expect(ids).toEqual(['c2', 'c3', 'c1', 'c4'])
  })

  it('breaks a full tie by name, then by id', () => {
    const users = [user('creator-2', 'Same'), user('creator-1', 'Same')]
    const pubs = [pub({ id: 'x', creatorId: 'creator-2' }), pub({ id: 'y', creatorId: 'creator-1' })]
    expect(creatorList(pubs, users).map(row => row.id)).toEqual(['creator-1', 'creator-2'])
  })

  it('returns the top 5 by default and honours a custom limit', () => {
    const users = Array.from({ length: 8 }, (_, i) => user(`c${i}`, `Name ${i}`))
    const pubs = users.map((u, i) => pub({ id: `p${i}`, creatorId: u.id, copies: i }))
    expect(creatorList(pubs, users)).toHaveLength(5)
    expect(creatorList(pubs, users, 1).map(row => row.id)).toEqual(['c7'])
  })

  it('does not mutate the input arrays', () => {
    const users = [user('c1', 'Zed'), user('c2', 'Amy')]
    const pubs = [pub({ id: 'p1', creatorId: 'c1', copies: 1 }), pub({ id: 'p2', creatorId: 'c2', copies: 4 })]
    creatorList(pubs, users)
    expect(users.map(u => u.id)).toEqual(['c1', 'c2'])
    expect(pubs.map(p => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('cardColumns', () => {
  it('returns Days, Budget, Places and Forks in that order', () => {
    const columns = cardColumns(pub({ id: 'a', durationDays: 4, routeSummary: ['A', 'B', 'C'], copies: 7 }))
    expect(columns.map(column => column.label)).toEqual(['Days', 'Budget', 'Places', 'Forks'])
  })

  it('prints the day count in plural and singular', () => {
    expect(cardColumns(pub({ id: 'a', durationDays: 4 }))[0].value).toBe('4 days')
    expect(cardColumns(pub({ id: 'a', durationDays: 1 }))[0].value).toBe('1 day')
    expect(cardColumns(pub({ id: 'a', durationDays: 0 }))[0].value).toBe('0 days')
  })

  it('prints the budget per person with formatInrShort, like the My trips cards', () => {
    const [, budget] = cardColumns(pub({ id: 'a', estimatedBudgetPerPersonInr: 18000 }))
    expect(budget.value).toBe(`~${formatInrShort(18000)}/person`)
    expect(budget.value).toBe('~₹18k/person')
    expect(budget.value.startsWith('~₹')).toBe(true)
    expect(budget.value.endsWith('/person')).toBe(true)
  })

  it('counts places from the route summary and forks from copies', () => {
    const [, , places, forks] = cardColumns(pub({ id: 'a', routeSummary: ['A', 'B'], copies: 0 }))
    expect(places.value).toBe('2')
    expect(forks.value).toBe('0')
  })
})

describe('savedEmptyKind', () => {
  const base = { pubsCount: 0, filtersActive: false, savedOnly: false, savedCount: 0, signedIn: false }

  it('returns none when the page has rows', () => {
    expect(savedEmptyKind({ ...base, pubsCount: 3, savedOnly: true })).toBe('none')
  })

  it('returns no-saved in the saved-only view with nothing saved', () => {
    expect(savedEmptyKind({ ...base, savedOnly: true, savedCount: 0 })).toBe('no-saved')
  })

  it('returns no-saved even when filters are also on', () => {
    expect(savedEmptyKind({ ...base, savedOnly: true, savedCount: 0, filtersActive: true })).toBe('no-saved')
  })

  it('returns no-match when filters hide every row', () => {
    expect(savedEmptyKind({ ...base, filtersActive: true, savedOnly: true, savedCount: 2 })).toBe('no-match')
  })

  it('returns the signed-in catalog message for an empty catalog', () => {
    expect(savedEmptyKind({ ...base, signedIn: true })).toBe('no-catalog-signed-in')
  })

  it('returns the signed-out catalog message for an empty catalog', () => {
    expect(savedEmptyKind({ ...base, signedIn: false })).toBe('no-catalog-signed-out')
  })

  it('ignores saved count outside the saved-only view', () => {
    expect(savedEmptyKind({ ...base, savedOnly: false, savedCount: 0, signedIn: true })).toBe('no-catalog-signed-in')
  })
})
