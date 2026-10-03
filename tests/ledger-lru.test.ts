// ============ #579 — bounded ledgers evict by recency, not insertion ============
//
// Both bounded timestamp ledgers evicted `map.keys().next().value` — which is
// oldest-INSERTED, not least-recently-used: a JS `Map.set` on an existing key
// never refreshes the key's position in iteration order. So the trip being
// actively edited (re-seeded by every hydrate, touched by every event) kept its
// original slot and was evicted FIRST once the cap was hit, while entries for
// trips nobody had touched since boot lingered at the front of the queue. Both
// guards fail OPEN on a missing entry, so nothing was lost outright — the two
// guards silently stopped working for exactly the trips they exist for.
//
// Both maps are plain module singletons, so this is a node test with a mocked
// transport: the ledgers are filled through their REAL writers (duplicateTrip
// claims the echo window; hydrate re-seeds the server clock) and read through
// the peek test hooks, so a rewrite of either record function or its eviction
// loop fails this suite rather than quietly reverting the policy.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedData } from '../src/data/seed'
import type { TripRow } from '../src/lib/tripRow'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const { state } = vi.hoisted(() => ({
  state: {
    tables: {} as Record<string, unknown[]>,
    sessionUser: null as string | null,
    authHandler: null as ((event: string, session: unknown) => void) | null,
    resolveSession: null as (() => void) | null,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const rows = state.tables[table] ?? []
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      update: () => builder, insert: () => builder, delete: () => builder,
      is: () => builder, limit: () => builder, order: () => builder,
      maybeSingle: () => builder,
      then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(res),
    }
    return builder
  }
  const chain: Record<string, unknown> = { on: () => chain, subscribe: () => ({}) }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: () => Promise.resolve({ data: [], error: null }),
      channel: () => chain,
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => new Promise(resolve => {
          state.resolveSession = () =>
            resolve({ data: { session: state.sessionUser ? { user: { id: state.sessionUser } } : null } })
        }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          state.authHandler = cb
          return { data: { subscription: {} } }
        },
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  }
})

const keralaTrip = seedData.trips[0]!
const CAP = 500

function tripRow(id: string, ownerId: string): TripRow {
  return {
    id, owner_id: ownerId, name: `Trip ${id}`, start_location: 'Kochi',
    start_location_coords: null, destinations: ['Kochi'], destination_coords: null,
    start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2, transport_mode: 'car',
    budget_per_person_inr: 5000, travel_style: 'balanced', fixed_commitments: [],
    days: [], expenses: [], cover_emoji: '🧭', visibility: 'private',
    created_at: 1, updated_at: 1,
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  state.tables = {}
  state.sessionUser = null
  state.authHandler = null
  state.resolveSession = null
})

describe('#579 — the echo-window ledger evicts the least-recently-written', () => {
  it('keeps a re-recorded id and drops the never-touched oldest one at the cap', async () => {
    vi.resetModules()
    const store = await import('../src/store/store')
    store._clearRecentLocalWrites()
    store._setTripWriteDebounceMs(0)

    // Fill exactly to the cap through the real writer: duplicateTrip persists,
    // and persistTrip claims the echo window synchronously per trip id.
    const ids: string[] = []
    for (let i = 0; i < CAP; i++) {
      ids.push(store.duplicateTrip(keralaTrip, 'owner-test').id)
    }
    await flush()
    expect(store._recentLocalWriteEntry('trips', ids[0]!)).toBeGreaterThan(0)

    // Re-record id #0 three times: each claim must PROMOTE it (delete-then-set).
    // Pre-fix, `Map.set` left it at the front of the iteration order.
    const stop = store.tripById(ids[0]!)!.days[0]!.stops[0]!
    for (let i = 0; i < 3; i++) {
      store.updateStop(ids[0]!, stop.id, { visitMinutes: 45 + i })
    }
    await flush()

    // One more id crosses the cap: the eviction takes the FRONT of the
    // iteration order — which must now be a never-refreshed entry (ids[1]),
    // not the actively-written ids[0].
    const extra = store.duplicateTrip(keralaTrip, 'owner-test').id
    await flush()
    expect(store._recentLocalWriteEntry('trips', extra)).toBeGreaterThan(0)
    expect(store._recentLocalWriteEntry('trips', ids[0]!), 'the actively-written id was evicted first').toBeGreaterThan(0)
    expect(store._recentLocalWriteEntry('trips', ids[1]!), 'the never-touched id survived instead').toBeUndefined()
    // The caps are untouched — the policy changed, not the bounds.
    expect(store._recentLocalWriteEntry('trips', ids[CAP - 1]!)).toBeGreaterThan(0)
  })
})

describe('#579 — the server-clock ledger evicts the least-recently-seeded', () => {
  it('keeps a re-seeded trip and drops the never-refreshed oldest one at the cap', async () => {
    vi.resetModules()
    const store = await import('../src/store/store')
    store._clearServerTripTimestamps()

    // Fill exactly to the cap through the real writer: hydrate re-seeds one
    // entry per visible trip.
    state.tables = {
      profiles: [{ id: 'userA', email: 'a@example.com', name: 'A', is_disabled: false, created_at: 1 }],
      published_itineraries: [],
      trip_members: Array.from({ length: CAP }, (_, i) => ({ trip_id: `t${i + 1}`, user_id: 'userA', role: 'owner', joined_at: 1 })),
      trips: Array.from({ length: CAP }, (_, i) => tripRow(`t${i + 1}`, 'userA')),
    }
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()
    expect(store._serverTripTimestampEntry('t1')).toBeGreaterThan(0)

    // Re-seed t1 alone (a later hydrate of the one trip the user can see):
    // it must move to the end of the iteration order.
    state.tables = { ...state.tables, trips: [tripRow('t1', 'userA')], trip_members: [{ trip_id: 't1', user_id: 'userA', role: 'owner', joined_at: 1 }] }
    state.authHandler!('TOKEN_REFRESHED', { user: { id: 'userA' } })
    await flush()
    expect(store._serverTripTimestampEntry('t1')).toBeGreaterThan(0)

    // One new id crosses the cap: the eviction must take t2 (never refreshed),
    // not t1 (re-seeded a moment ago). Pre-fix, t1 kept its original slot and
    // was dropped first.
    state.tables = { ...state.tables, trips: [tripRow('t501', 'userA')], trip_members: [{ trip_id: 't501', user_id: 'userA', role: 'owner', joined_at: 1 }] }
    state.authHandler!('TOKEN_REFRESHED', { user: { id: 'userA' } })
    await flush()
    expect(store._serverTripTimestampEntry('t501')).toBeGreaterThan(0)
    expect(store._serverTripTimestampEntry('t1'), 'the re-seeded trip was evicted first').toBeGreaterThan(0)
    expect(store._serverTripTimestampEntry('t2'), 'the never-refreshed trip survived instead').toBeUndefined()
    expect(store._serverTripTimestampEntry(`t${CAP}`)).toBeGreaterThan(0)
  })
})

describe('#579 — the promotion lives in the record functions, and only there', () => {
  const src = read('../src/store/store.ts')

  it('both record functions promote with delete-then-set', () => {
    // The pitfall in the issue: a call-site-level "touch" would leave every
    // other writer un-promoted, so the promotion must live inside the record
    // functions themselves.
    expect(src).toMatch(/recentLocalWrites\.delete\(key\)\s+recentLocalWrites\.set\(key, Date\.now\(\)\)/)
    expect(src).toMatch(/serverTripTimestamps\.delete\(id\)\s+serverTripTimestamps\.set\(id, n\)/)
  })

  it('the caps and the eviction shape are untouched', () => {
    // 500 each, and the sweep still takes the front of the iteration order —
    // which promotion made into the true least-recently-used.
    expect(src).toMatch(/MAX_RECENT_WRITES = 500/)
    expect(src).toMatch(/MAX_SERVER_TRIP_TS = 500/)
    expect(src.match(/\.keys\(\)\.next\(\)\.value/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // The clear hooks survive.
    expect(src).toMatch(/export function _clearRecentLocalWrites/)
    expect(src).toMatch(/export function _clearServerTripTimestamps/)
  })
})
