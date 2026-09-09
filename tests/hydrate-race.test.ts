// ============ Hydration race / account isolation (issue #45) ============
// Regression for the cross-account leak: `hydrate(null)` on logout cleared the
// cache and nulled `activeHydrate` WITHOUT awaiting a hydrate that was still in
// flight. That hydrate then resolved and `patch()`ed the previous user's trips —
// and their `sessionUserId` — back into the emptied cache, so whoever used the
// browser next could see, and be treated as, the account that had just signed out.
//
// The fix stamps every auth event with a generation and drops the patch of any
// run whose generation has been superseded. These tests force the dangerous
// ordering deliberately: the mocked queries are gated, so a hydrate can be made
// to resolve *after* a logout or *after* a newer account's hydrate has finished.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TripRow } from '../src/lib/tripRow'

const { state } = vi.hoisted(() => ({
  state: {
    /** Table rows served by the next query. Reassigned between auth events so
     *  each hydrate captures the data belonging to the account it runs for. */
    tables: {} as Record<string, unknown[]>,
    /** Gate per user id; a builder captures the gate of whoever is active when
     *  the query is issued, letting a specific account's hydrate be released late. */
    gates: {} as Record<string, Promise<void>>,
    activeUser: null as string | null,
    authHandler: null as ((event: string, session: unknown) => void) | null,
    resolveSession: null as (() => void) | null,
    sessionUser: null as string | null,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const rows = state.tables[table] ?? []
    const gate = state.gates[state.activeUser ?? ''] ?? Promise.resolve()
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      update: () => builder,
      insert: () => builder,
      delete: () => builder,
      limit: () => builder,
      maybeSingle: () => builder,
      // Chainable + thenable, but the response is withheld until this account's
      // gate is released — that is what makes the race reproducible.
      then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
        gate.then(() => ({ data: rows, error: null })).then(res),
    }
    return builder
  }
  const chain: Record<string, unknown> = { on: () => chain, subscribe: () => ({}) }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      channel: () => chain,
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () =>
          new Promise(resolve => {
            state.resolveSession = () =>
              resolve({ data: { session: state.sessionUser ? { user: { id: state.sessionUser } } : null } })
          }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          state.authHandler = cb
          return { data: { subscription: {} } }
        },
      },
    },
  }
})

/** A row shaped enough for `rowToTrip` to map without throwing. */
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

function memberRow(tripId: string, userId: string) {
  return { trip_id: tripId, user_id: userId, role: 'owner', joined_at: 1 }
}

function rowsFor(tripId: string, userId: string) {
  return {
    profiles: [],
    published_itineraries: [],
    trip_members: [memberRow(tripId, userId)],
    trips: [tripRow(tripId, userId)],
  }
}

/** Let the store's fire-and-forget async work drain. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

function gated(user: string) {
  let release!: () => void
  state.gates[user] = new Promise<void>(r => (release = r))
  return () => release()
}

beforeEach(() => {
  state.tables = {}
  state.gates = {}
  state.activeUser = null
  state.authHandler = null
  state.resolveSession = null
  state.sessionUser = null
})

describe('hydration isolation across sign-out and account switch (#45)', () => {
  it('does not resurrect the signed-out user when hydration resolves after logout', async () => {
    const store = await freshStore()

    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    const releaseA = gated('userA')

    state.sessionUser = 'userA'
    store.init()
    expect(state.authHandler).toBeTruthy()
    state.resolveSession!()
    await flush()

    // The account's queries are still in flight when it signs out.
    state.authHandler!('SIGNED_OUT', null)
    await flush()
    expect(store.getSnapshot().sessionUserId).toBeNull()

    // The late response must be discarded, not patched into the cleared cache.
    releaseA()
    await flush()

    const db = store.getSnapshot()
    expect(db.sessionUserId).toBeNull()
    expect(db.trips).toHaveLength(0)
    expect(store.tripsForUser('userA')).toHaveLength(0)
  })

  it('keeps the previous account out of the cache when it resolves after a switch', async () => {
    const store = await freshStore()

    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    const releaseA = gated('userA')

    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    // Switch accounts while userA's queries are still hanging.
    state.tables = rowsFor('tripB', 'userB')
    state.activeUser = 'userB'
    const releaseB = gated('userB')
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await flush()

    // The NEW account lands first...
    releaseB()
    await flush()
    expect(store.getSnapshot().sessionUserId).toBe('userB')

    // ...and the OLD account resolves last. Without the generation guard its
    // patch wins here and the cache ends up pointing at userA.
    releaseA()
    await flush()

    const db = store.getSnapshot()
    expect(db.sessionUserId).toBe('userB')
    expect(db.trips.map(t => t.id)).toEqual(['tripB'])
    expect(store.tripsForUser('userA')).toHaveLength(0)
  })

  it('still hydrates normally on a single uninterrupted sign-in', async () => {
    const store = await freshStore()

    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    const releaseA = gated('userA')

    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()
    releaseA()
    await flush()

    const db = store.getSnapshot()
    expect(db.sessionUserId).toBe('userA')
    expect(db.trips.map(t => t.id)).toEqual(['tripA'])
  })

  it('hydrates when getSession and onAuthStateChange double-fire for the SAME user', async () => {
    // The refresh-logout bug: on app load BOTH getSession() and
    // onAuthStateChange (INITIAL_SESSION) fire hydrate for the SAME user.
    // The second call used to bump hydrateGen before deduping onto the
    // first call's promise — the first hydrate's patch was then dropped as
    // "stale" (gen superseded) while the second call only awaited it and
    // never patched. Data fetched, nobody wrote it: the app rendered
    // logged-out on every refresh with a perfectly valid token.
    const store = await freshStore()

    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    const releaseA = gated('userA')

    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()            // getSession → hydrate('userA'), gen 1
    await flush()
    // The double-fire: INITIAL_SESSION for the same user, mid-hydration.
    state.authHandler!('INITIAL_SESSION', { user: { id: 'userA' } })
    await flush()

    releaseA()                          // queries resolve — someone must patch
    await flush()

    const db = store.getSnapshot()
    expect(db.sessionUserId).toBe('userA')
    expect(db.trips.map(t => t.id)).toEqual(['tripA'])
    expect(store.tripsForUser('userA')).toHaveLength(1)
  })
})
