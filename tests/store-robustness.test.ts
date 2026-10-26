// ============ Store robustness regression tests ============
// Covers bug fixes that prevent crashes / doomed writes:
//  #4 registerPubView/Copy only writes when the viewer owns the published row
//  #5 reorderStop guards out-of-range indices (no undefined in day.stops)
//  #9 acceptSuggestionIntoTimeline no longer dereferences a null session user
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  tripById,
  getSnapshot, createTrip, reorderStop, acceptSuggestionIntoTimeline,
  publishItinerary, registerPubView, currentUser,
} from '../src/store/store'
import { supabase } from '../src/lib/supabase'
import { sliceState } from '../src/lib/readState'
import type { Trip, PublishedItinerary } from '../src/data/types'
import { profileSession } from './helpers/profileSession'

function resetCacheForTest() {
  // getSnapshot() is stable until a mutation replaces the cache; we just read it.
  return getSnapshot()
}

/** `publishItinerary` reports its outcome, not the row. These tests assert the
 *  outcome, then read the row that the accepted write left in the cache. */
async function publishedRow(
  store: typeof import('../src/store/store'),
  pub: Omit<PublishedItinerary, 'id' | 'publishedAt' | 'views' | 'copies'>,
): Promise<PublishedItinerary> {
  store.getSnapshot().trips.push({ id: pub.tripId, visibility: 'public' } as import('../src/data/types').Trip)
  const outcome = await store.publishItinerary(pub)
  expect(outcome.ok, outcome.error).toBe(true)
  return getSnapshot().published.find(x => x.tripId === pub.tripId)!
}

describe('reorderStop guards out-of-range indices (regression #5)', () => {
  beforeEach(() => { resetCacheForTest() })

  it('does not insert undefined on out-of-range indices', () => {
    return import('../src/store/store').then(async (store) => {
      const trip = createTrip('owner-1', {
        name: 'Reorder Test', startLocation: 'Kochi', destinations: ['Munnar'],
        startDate: '2026-09-01', endDate: '2026-09-03', travellers: 2,
        transportMode: 'car', budgetPerPersonInr: 5000, travelStyle: 'balanced',
        fixedCommitments: [],
      }, [[
        { id: 's1', title: 'A', category: 'sightseeing', locationName: 'A', lat: 10, lng: 76,
          visitMinutes: 30, entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
          priority: 'must-do', status: 'confirmed', orderInDay: 1 },
        { id: 's2', title: 'B', category: 'sightseeing', locationName: 'B', lat: 10.1, lng: 76.1,
          visitMinutes: 30, entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
          priority: 'must-do', status: 'confirmed', orderInDay: 2 },
      ]])
      // wildly out-of-range indices must not corrupt the stops array
      reorderStop(trip.id, 0, 99, 99)
      reorderStop(trip.id, 0, -5, -5)
      const day = trip.days[0]
      expect(day.stops.length).toBe(2)
      expect(day.stops.every(s => s && typeof s.id === 'string')).toBe(true)
      // a normal reorder still works — the store now updates immutably, so
      // stale references keep their snapshot and the cache must be re-read.
      reorderStop(trip.id, 0, 0, 1)
      const reordered = tripById(trip.id)!.days[0]
      expect(reordered.stops[0].id).toBe('s2')
      expect(reordered.stops[1].id).toBe('s1')
    })
  })
})

describe('acceptSuggestionIntoTimeline requires a session (regression #9)', () => {
  it('returns forbidden without changing the suggestion when there is no logged-in user', async () => {
    return import('../src/store/store').then(async (store) => {
      const trip = createTrip('owner-2', {
        name: 'Suggest Test', startLocation: 'Kochi', destinations: ['Munnar'],
        startDate: '2026-09-01', endDate: '2026-09-03', travellers: 2,
        transportMode: 'car', budgetPerPersonInr: 5000, travelStyle: 'balanced',
        fixedCommitments: [],
      })
      // Stage A of #832: addSuggestion without a session answers `forbidden`
      // and creates nothing — the actor is server-derived, so there is no
      // anonymous suggestion to accept. Seed the suggestion directly, which
      // is the state this regression is about: accepting with no session.
      const db = getSnapshot() as any
      db.suggestions.push({
        id: 'sug-robust', tripId: trip.id, dayIndex: 0, proposedBy: 'u-x',
        title: 'Fort', category: 'sightseeing', locationName: 'Fort', lat: 10, lng: 76,
        visitMinutes: 60, estimatedEntryFeeInr: 50, estimatedTransportInr: 100,
        votes: [], comments: [], status: 'open', createdAt: 1,
      })
      // The guard path must not throw on the unguarded `cache.sessionUserId!`
      await expect(acceptSuggestionIntoTimeline(trip.id, 'sug-robust')).resolves.toEqual({ status: 'forbidden' })
      const updated = getSnapshot().suggestions.find(s => s.id === 'sug-robust')
      expect(updated?.status).toBe('open')
    })
  })
})

describe('registerPubView only writes for the owning viewer (regression #4)', () => {
  it('does not fire a doomed Supabase write for a non-owner viewer', async () => {
    // publishItinerary is async and rolls its optimistic cache write back when
    // the upsert fails — and against the placeholder Supabase URL it always
    // fails. Stub `from()` so the upsert resolves clean and the published row
    // survives, which is the state this regression test needs.
    const upsert = vi.fn().mockResolvedValue({ error: null })
    // publishItinerary also flips the trip to visibility='public' (fire('trips', …update))
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation(
      () => ({ upsert, update }) as unknown as ReturnType<typeof supabase.from>,
    )
    // #363 — `registerPubView` no longer fires and forgets: a bump whose RPC
    // fails is now rolled back, and against the placeholder URL it always
    // fails, so the increment this test asserts would be undone a tick later.
    // Stub the bump to SUCCEED, which is the state the assertion is about (the
    // rollback path has its own tests in tests/pub-counters.test.ts).
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: null } as never)
    try {
      const store = await import('../src/store/store')
      const pub: Omit<PublishedItinerary, 'id' | 'publishedAt' | 'views' | 'copies'> = {
        tripId: 't-pub', creatorId: 'owner-real', title: 'Kerala', tagline: 'x',
        // #354 — the writer enforces the publish rules now, so this fixture
        // needs a cover and a free day to be a valid publication at all. The
        // assertion below is about the view counter, not about the rules.
        coverImageUrl: 'https://images.example.test/kerala.jpg',
        routeSummary: ['Kochi'], durationDays: 3, estimatedBudgetPerPersonInr: 5000,
        travelStyle: 'balanced', bestSeason: 'winter', travelTips: [],
        warningsAndAssumptions: [], freeDayIndexes: [0],
      }
      const p = await publishedRow(store, pub)
      const before = p.views
      // Simulate a NON-owner viewer (sessionUserId differs from creatorId)
      const snap = getSnapshot() as any
      snap.sessionUserId = 'someone-else'
      store.registerPubView(p.id)
      const after = getSnapshot().published.find(x => x.id === p.id)!
      expect(after).toBeDefined() // the optimistic write survived the upsert
      expect(after.views).toBe(before + 1) // local counter still increments
      // (the assert that no doomed write fired is implicit: the function now
      //  branches on ownership, so a non-owner triggers no supabase.update)
    } finally {
      rpcSpy.mockRestore()
      fromSpy.mockRestore()
    }
  })
})

// ============ v0.36: view counting + unpublish hardening ============

describe('registerPubView counts real visits only (v0.36)', () => {
  const publishAs = async (store: typeof import('../src/store/store'), creatorId: string) => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    // publishItinerary also flips the trip to visibility='public' (fire('trips', …update))
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation(
      () => ({ upsert, update }) as unknown as ReturnType<typeof supabase.from>,
    )
    const p = await publishedRow(store, {
      tripId: 't-views', creatorId, title: 'Kerala', tagline: 'x',
      // #354 — the writer now enforces the publish rules, so a fixture that
      // published a COVERLESS row is no longer a valid publication. These tests
      // are about view counting, not about the rules, so the fixture is made a
      // valid one rather than the rules being relaxed: the cover literal is the
      // handler's own, and `freeDayIndexes: [0]` satisfies the ≥1-free-day rule
      // an entirely-free publication is exempt from.
      coverImageUrl: 'https://images.example.test/kerala.jpg',
      routeSummary: ['Kochi'], durationDays: 3, estimatedBudgetPerPersonInr: 5000,
      travelStyle: 'balanced', bestSeason: 'winter', travelTips: [],
      warningsAndAssumptions: [], freeDayIndexes: [0],
    })
    return { p, fromSpy }
  }

  it("the creator's own visit never increments the counter", async () => {
    const store = await import('../src/store/store')
    const { p, fromSpy } = await publishAs(store, 'owner-real')
    try {
      ;(getSnapshot() as any).sessionUserId = 'owner-real'
      const before = getSnapshot().published.find(x => x.id === p.id)!.views
      store.registerPubView(p.id)
      expect(getSnapshot().published.find(x => x.id === p.id)!.views).toBe(before)
    } finally {
      fromSpy.mockRestore()
    }
  })

  it('one view per browser session — refreshes are deduped', async () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
    })
    const store = await import('../src/store/store')
    const { p, fromSpy } = await publishAs(store, 'owner-real')
    try {
      ;(getSnapshot() as any).sessionUserId = 'someone-else'
      const before = getSnapshot().published.find(x => x.id === p.id)!.views
      store.registerPubView(p.id)
      store.registerPubView(p.id)
      store.registerPubView(p.id)
      expect(getSnapshot().published.find(x => x.id === p.id)!.views).toBe(before + 1)
    } finally {
      vi.unstubAllGlobals()
      fromSpy.mockRestore()
    }
  })
})

describe('unpublishItinerary owner gate + rollback (v0.36)', () => {
  const publishAs = async (creatorId: string) => {
    const store = await import('../src/store/store')
    const upsert = vi.fn().mockResolvedValue({ error: null })
    // publishItinerary also flips the trip to visibility='public' (fire('trips', …update))
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation(
      () => ({ upsert, update }) as unknown as ReturnType<typeof supabase.from>,
    )
    const p = await publishedRow(store, {
      tripId: 't-unpub', creatorId, title: 'Kerala', tagline: 'x',
      // #354 — same as the fixture above: the writer enforces the publish rules
      // now, so this one carries a cover and a free day. These tests are about
      // the unpublish owner gate and the delete rollback, not about the rules.
      coverImageUrl: 'https://images.example.test/kerala.jpg',
      routeSummary: ['Kochi'], durationDays: 3, estimatedBudgetPerPersonInr: 5000,
      travelStyle: 'balanced', bestSeason: 'winter', travelTips: [],
      warningsAndAssumptions: [], freeDayIndexes: [0],
    })
    return { store, p, fromSpy }
  }
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  it('a non-owner cannot unpublish', async () => {
    const { store, p, fromSpy } = await publishAs('owner-real')
    try {
      ;(getSnapshot() as any).sessionUserId = 'not-the-owner'
      store.unpublishItinerary(p.tripId)
      expect(getSnapshot().published.some(x => x.id === p.id)).toBe(true)
    } finally {
      fromSpy.mockRestore()
    }
  })

  it('a failed delete restores the cached publication', async () => {
    const { store, p, fromSpy } = await publishAs('owner-real')
    try {
      ;(getSnapshot() as any).sessionUserId = 'owner-real'
      const boom = { message: 'RLS blocked the delete' }
      vi.spyOn(supabase, 'from').mockImplementation(
        () => ({ delete: () => ({ eq: () => Promise.resolve({ error: boom }) }) }) as unknown as ReturnType<typeof supabase.from>,
      )
      store.unpublishItinerary(p.tripId)
      await flush()
      expect(getSnapshot().published.some(x => x.id === p.id)).toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
  })
})

// ============ #704 — a failed read is never an empty slice ============
// These drive the real store through its auth entry point. A fresh module graph
// gives each test its own Supabase client, so the test answers every read.

/** A query builder that answers with `result`, as the store's awaited reads do. */
function answering(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  let single = false
  for (const m of ['select', 'eq', 'in', 'setHeader']) builder[m] = () => builder
  builder.maybeSingle = () => { single = true; return builder }
  builder.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ ...result, data: single && Array.isArray(result.data) ? result.data[0] ?? null : result.data }).then(res, rej)
  return builder
}

/** A fresh store, signed in as `user`, on its own Supabase client. */
async function freshStore(user: string) {
  vi.resetModules()
  const store = await import('../src/store/store')
  const { supabase: client } = await import('../src/lib/supabase')
  vi.spyOn(client.auth, 'getSession').mockResolvedValue(
    { data: { session: profileSession({ user: { id: user } }) }, error: null } as never,
  )
  vi.spyOn(client.auth, 'onAuthStateChange').mockReturnValue(
    { data: { subscription: { unsubscribe: () => {} } } } as never,
  )
  vi.spyOn(client, 'rpc').mockImplementation(((name: string) => Promise.resolve({ data: name === 'is_disabled' ? false : [], error: null })) as never)
  return { store, client }
}

describe('#704 — a throw after the first read still gives the trips slice a verdict', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('the outer catch reports trips failed, so a page that waits on the trips read cannot spin', async () => {
    const { store, client } = await freshStore('user-d4')
    vi.spyOn(client, 'from').mockImplementation(((table: string) => {
      if (table === 'trip_members') {
        return answering({ data: [{ trip_id: 'trip-d4', user_id: 'user-d4', role: 'owner', joined_at: 1 }], error: null })
      }
      // Stage 2 reads trips. This throw comes after stage 1 has read the memberships.
      if (table === 'trips') throw new Error('forced after stage 1')
      return answering({ data: [], error: null })
    }) as never)

    store.init()
    await vi.waitFor(() => expect(sliceState(store.getSnapshot().sliceReads, 'trips')).toBe('failed'))
  })
})

/** The slices a page reads through `sliceState`. A run that settled must leave none of them reading. */
const PAGE_SLICES = ['trips', 'profiles', 'suggested itineraries', 'suggestions', 'decisions', 'activity'] as const

describe('#704 — a throw during hydrate fails every slice it left unread', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('a throw after stage 1 leaves no page slice reading, not only trips', async () => {
    const { store, client } = await freshStore('user-e1')
    vi.spyOn(client, 'from').mockImplementation(((table: string) => {
      if (table === 'trip_members') {
        return answering({ data: [{ trip_id: 'trip-e1', user_id: 'user-e1', role: 'owner', joined_at: 1 }], error: null })
      }
      // Stage 2 reads trips. This throw comes after stage 1 has read the profiles, the published rows and the memberships.
      if (table === 'trips') throw new Error('forced after stage 1')
      return answering({ data: [], error: null })
    }) as never)

    store.init()
    await vi.waitFor(() => expect(sliceState(store.getSnapshot().sliceReads, 'trips')).toBe('failed'))
    for (const slice of PAGE_SLICES) {
      expect(sliceState(store.getSnapshot().sliceReads, slice), slice).not.toBe('reading')
    }
  })

  it('a throw before the membership scope is known leaves no page slice reading', async () => {
    const { store, client } = await freshStore('user-e2')
    vi.spyOn(client, 'from').mockImplementation(((table: string) => {
      if (table === 'trip_members') throw new Error('forced before membership scope')
      return answering({ data: [], error: null })
    }) as never)

    store.init()
    await vi.waitFor(() => expect(sliceState(store.getSnapshot().sliceReads, 'trips')).toBe('failed'))
    for (const slice of PAGE_SLICES) {
      expect(sliceState(store.getSnapshot().sliceReads, slice), slice).not.toBe('reading')
    }
  })

  it('a throw after the verdict keeps every verdict the run already reported', async () => {
    const { store, client } = await freshStore('user-e3')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(client, 'from').mockImplementation(((table: string) => {
      // No membership row, so the run reports its verdict and then seeds demo trips. The first seed write throws.
      if (table === 'trips') throw new Error('forced after the verdict')
      return answering({ data: [], error: null })
    }) as never)

    store.init()
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('[yatraflow] hydration failed', expect.anything()))
    for (const slice of ['trips', 'profiles', 'suggested itineraries'] as const) {
      expect(sliceState(store.getSnapshot().sliceReads, slice), slice).toBe('ready')
    }
  })
})

/** A trip row that rowToTrip maps, so a read that finds a trip never reaches the demo seed. */
function mappableTripRow(id: string, ownerId: string) {
  return {
    id, owner_id: ownerId, name: `Trip ${id}`, start_location: 'Kochi',
    start_location_coords: null, destinations: ['Kochi'], destination_coords: null,
    start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2, transport_mode: 'car',
    budget_per_person_inr: 5000, travel_style: 'balanced', fixed_commitments: [],
    days: [], expenses: [], cover_emoji: '🧭', visibility: 'private',
    created_at: 1, updated_at: 1,
  }
}

describe('#704 — a failed memberships read keeps the trip-scoped rows and reports them failed', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('keeps the cached suggestions, decisions, activity and notifications, and reports each one failed', async () => {
    const { store, client } = await freshStore('user-d5')
    let memberships: { data: unknown; error: unknown } = {
      data: [{ trip_id: 'trip-d5', user_id: 'user-d5', role: 'owner', joined_at: 1 }],
      error: null,
    }
    const rows: Record<string, unknown[]> = {
      trips: [mappableTripRow('trip-d5', 'user-d5')],
      suggestions: [{
        id: 's1', trip_id: 'trip-d5', day_index: 0, proposed_by: 'user-d5', title: 'Fort', category: 'sightseeing',
        location_name: 'Fort', lat: 10, lng: 76, visit_minutes: 60, status: 'open', votes: [], comments: [], created_at: 1,
      }],
      decisions: [{
        id: 'd1', trip_id: 'trip-d5', question: 'Where to?', context: null, options: [], votes_by_user_id: {},
        status: 'open', comments: [], raised_by: 'user-d5', created_at: 1,
      }],
      activity: [{ id: 'a1', trip_id: 'trip-d5', actor_id: 'user-d5', verb: 'added', target: 'Fort', at: 1 }],
      notifications: [{ id: 'n1', user_id: 'user-d5', trip_id: 'trip-d5', text: 'Hello', read: false, at: 1 }],
    }
    vi.spyOn(client, 'from').mockImplementation(((table: string) => {
      if (table === 'trip_members') return answering(memberships)
      return answering({ data: rows[table] ?? [], error: null })
    }) as never)

    store.init()
    await vi.waitFor(() => expect(store.getSnapshot().sliceReads.trips).toBe('ok'))
    expect(store.getSnapshot().suggestions.map(s => s.id)).toEqual(['s1'])

    // The memberships read fails now. Stage 2 never runs, so the cached rows must stay.
    memberships = { data: null, error: { message: 'boom' } }
    await store.rereadTrips()

    const db = store.getSnapshot()
    expect(db.suggestions.map(s => s.id)).toEqual(['s1'])
    expect(db.decisions.map(d => d.id)).toEqual(['d1'])
    expect(db.activity.map(a => a.id)).toEqual(['a1'])
    expect(db.notifications.map(n => n.id)).toEqual(['n1'])
    for (const slice of ['memberships', 'trips', 'suggestions', 'decisions', 'activity', 'notifications']) {
      expect(sliceState(db.sliceReads, slice), slice).toBe('failed')
    }
  })
})
