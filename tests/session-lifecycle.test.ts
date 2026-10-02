// ============ #393 — the session lifecycle keeps its promises ============
//
// Four gaps, all in one lifecycle: the disabled-account sign-out existed but
// was never called (dead code — a disabled account signed in fine and then
// stared at the RLS-emptied catalogs, reading as "my data got deleted"); the
// Trash survived sign-out in the cache (sign-out → open Trash = the previous
// account's trip names); logout rendered Account A's rows until the async auth
// event landed; and an editor's offline edits to a foreign trip queued under
// the OWNER's id — never replayed, never cleared by their own sign-out.
//
// The mock harness is the hydrate-race one's shape (same vi.mock of
// lib/supabase), without its gates: nothing here needs a race, only states.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { TripRow } from '../src/lib/tripRow'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const { state } = vi.hoisted(() => ({
  state: {
    tables: {} as Record<string, unknown[]>,
    rpcs: {} as Record<string, unknown[]>,
    activeUser: null as string | null,
    authHandler: null as ((event: string, session: unknown) => void) | null,
    resolveSession: null as (() => void) | null,
    sessionUser: null as string | null,
    signOuts: 0,
    /** Every row UPDATE the store tries (write-pipeline assertions). */
    updates: [] as Array<{ table: string; payload: unknown }>,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const rows = state.tables[table] ?? []
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      update: (p: unknown) => (state.updates.push({ table, payload: p }), builder),
      insert: () => builder, delete: () => builder,
      limit: () => builder, order: () => builder, maybeSingle: () => builder,
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
      rpc: (name: string) => Promise.resolve({ data: state.rpcs[name] ?? [], error: null }),
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
        signOut: () => { state.signOuts++; return Promise.resolve({ error: null }) },
      },
    },
  }
})

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

function profileRow(id: string, isDisabled = false) {
  return { id, email: `${id}@example.com`, name: 'Traveller', is_disabled: isDisabled, created_at: 1 }
}

function rowsFor(tripId: string, userId: string, isDisabled = false) {
  return {
    profiles: [profileRow(userId, isDisabled)],
    published_itineraries: [],
    trip_members: [{ trip_id: tripId, user_id: userId, role: 'owner', joined_at: 1 }],
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

beforeEach(() => {
  state.tables = {}
  state.rpcs = {}
  state.activeUser = null
  state.authHandler = null
  state.resolveSession = null
  state.sessionUser = null
  state.signOuts = 0
  state.updates = []
})

describe('#393 — the Trash does not outlive the session', () => {
  it('sign-out empties the Trash, not the next visit to the Trash view', async () => {
    const store = await freshStore()
    state.tables = rowsFor('tripA', 'userA')
    state.rpcs = { get_trashed_trips: [tripRow('trashed', 'userA')] }
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    await store.fetchTrashedTrips()
    await flush()
    expect(store.getSnapshot().trashedTrips.map(t => t.id)).toEqual(['trashed'])

    // Old behaviour: the anonymous patch left trashedTrips untouched, so the
    // next person on the device opened the Trash and read the last account's
    // trip names (fetchTrashedTrips only ran on the view switch).
    state.authHandler!('SIGNED_OUT', null)
    await flush()
    expect(store.getSnapshot().sessionUserId).toBeNull()
    expect(store.getSnapshot().trashedTrips).toHaveLength(0)
  })

  it('logout clears the user-visible slices before any auth event lands', async () => {
    const store = await freshStore()
    state.tables = rowsFor('tripA', 'userA')
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()
    expect(store.getSnapshot().sessionUserId).toBe('userA')
    expect(store.getSnapshot().trips.map(t => t.id)).toEqual(['tripA'])

    // No await, no auth event: the instant signOut() is called the cache is
    // already logged-out. Old behaviour: the rows stayed until the event.
    void store.logout()
    const db = store.getSnapshot()
    expect(db.sessionUserId).toBeNull()
    expect(db.trips).toHaveLength(0)
    expect(db.trashedTrips).toHaveLength(0)
    expect(db.suggestions).toHaveLength(0)
    await flush()
  })
})

describe('#393 — a disabled account is told, not emptied', () => {
  it('signs straight back out when the flag is on the in-hand profile', async () => {
    const store = await freshStore()
    state.tables = rowsFor('tripA', 'userA', /* isDisabled */ true)
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    // The check used to have no callers at all: the session resolved, the
    // action succeeded, and the app rendered as an empty account. In a real
    // client the sign-out below emits the auth event that clears the cache;
    // the mock does not, so the event is fired here exactly as the client
    // would.
    expect(state.signOuts).toBe(1)
    state.authHandler!('SIGNED_OUT', null)
    await flush()
    expect(store.getSnapshot().sessionUserId).toBeNull()
  })

  it('a fail-open check never locks a valid user out (the catch still returns false)', async () => {
    const src = read('../src/store/store.ts')
    // The enforcement is the RESTRICTIVE policies; the friendly message must
    // never be able to sign out a legitimate account by throwing.
    expect(src).toMatch(/export async function enforceDisabledCheck\(\): Promise<boolean> \{[\s\S]*?catch \{[\s\S]*?return false/)
  })
})

describe('#393 — the store wires what it promises', () => {
  const src = read('../src/store/store.ts')

  it('the disabled check runs for the LIVE account only, post-hydrate', () => {
    // Generation-guarded: a superseded hydrate must never sign out whoever is
    // signed in now. And it reads the in-hand cache, so it runs where that
    // cache belongs to this account — which is also what a login resolves
    // through, one path for both.
    expect(src).toMatch(/if \(gen === hydrateGen && cache\.sessionUserId === userId\) await enforceDisabledCheck\(\)/)
  })

  it('the write queue is stamped with the editor, not the trip owner', () => {
    expect(src).toMatch(/ownerId: cache\.sessionUserId \?\? owner\?\.userId \?\? id/)
  })

  it('both anonymous patches carry the Trash key', () => {
    // logout's own clear plus the two anon hydrate patches.
    expect(src.match(/trips: \[\], trashedTrips: \[\],/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('the stale "10 demo trips" comments match the three that ship', () => {
    expect(src).not.toMatch(/10 fake trips|10 demo/)
  })
})

// ============ #578 — debounced trip writes do not outlive the session ============
// The 600ms coalescer's timers live in a module Map with no owner and no hook
// into any auth event. A timer that outlives a sign-out re-queues the entry the
// durable wipe deliberately discarded (stamped with the TRIP OWNER, because
// sessionUserId is already null) and sends the UPDATE under whatever JWT is
// live at fire time — the NEXT account's, on an A→B switch in one tab. Losing
// the last ≤600ms of edits at a session transition is the intended trade, the
// exact parallel of the durable wipe.
describe('#578 — debounced trip writes do not outlive the session', () => {
  const tripUpdates = () => state.updates.filter(u => u.table === 'trips')

  afterEach(() => vi.useRealTimers())

  /** Boot the store as `userId` with one owned trip, under fake timers. */
  async function bootedAs(userId: string, tripId = 'tripA') {
    vi.useFakeTimers()
    const store = await freshStore()
    // Same fresh module registry the store was imported from, so this is the
    // exact queue instance its writes land in.
    const queue = await import('../src/lib/writeQueue')
    state.tables = rowsFor(tripId, userId)
    state.sessionUser = userId
    store.init()
    state.resolveSession!()
    await vi.advanceTimersByTimeAsync(10)
    expect(store.getSnapshot().sessionUserId).toBe(userId)
    return { store, queue }
  }

  it('sign-out cancels the pending timer: no UPDATE, no queue entry', async () => {
    const { store, queue } = await bootedAs('userA')
    store._setTripWriteDebounceMs(60)
    expect(store.updateTrip('tripA', { name: 'Edited by A' })).toBe(true)
    // Still inside the coalescer's window — nothing written yet.
    expect(tripUpdates()).toHaveLength(0)

    await store.logout()
    await vi.advanceTimersByTimeAsync(500)

    // Old behaviour: the timer fired AFTER the wipe and re-queued exactly the
    // entry the wipe discarded — stamped with the trip owner's id and sent
    // under the next account's JWT.
    expect(tripUpdates()).toHaveLength(0)
    expect((await queue.pendingWrites()).map(w => w.tripId)).not.toContain('tripA')
  })

  it('an A→B switch in one tab cancels before the timer: nothing lands under B', async () => {
    const { store, queue } = await bootedAs('userA')
    store._setTripWriteDebounceMs(60)
    expect(store.updateTrip('tripA', { name: 'Edited by A' })).toBe(true)

    // The switch never passes through logout(): the auth event hydrates B
    // straight over A's cache, which is the ONLY place the transition shows.
    state.tables = rowsFor('tripB', 'userB')
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await vi.advanceTimersByTimeAsync(500)

    expect(store.getSnapshot().sessionUserId).toBe('userB')
    expect(tripUpdates()).toHaveLength(0)
    expect((await queue.pendingWrites()).map(w => w.tripId)).not.toContain('tripA')
  })

  it('belt-and-braces: a flush that missed the cancel hook still refuses', async () => {
    const { store, queue } = await bootedAs('userA')
    store._setTripWriteDebounceMs(60)
    expect(store.updateTrip('tripA', { name: 'Edited by A' })).toBe(true)

    // No cancel hook runs at all (the pagehide-flush racing a sign-out shape):
    // flip the session by hand and force the flush. The fire-time identity
    // check must refuse BOTH the queue write and the UPDATE.
    store.getSnapshot().sessionUserId = 'userB'
    store._flushTripWrites()
    await vi.advanceTimersByTimeAsync(10)

    expect(tripUpdates()).toHaveLength(0)
    expect((await queue.pendingWrites()).map(w => w.tripId)).not.toContain('tripA')
  })

  it('a write captured under no session is dropped, never stamped with the owner', async () => {
    const { store, queue } = await bootedAs('userA')
    store._setTripWriteDebounceMs(60)
    store.getSnapshot().sessionUserId = null
    expect(store.updateTrip('tripA', { name: 'Edited with nobody signed in' })).toBe(true)
    await vi.advanceTimersByTimeAsync(500)

    // The owner-fallback stamp is #393's zombie entry from the other
    // direction: it would replay under a future session of the OWNER — who
    // never made this edit. Dropped, not guessed.
    expect(tripUpdates()).toHaveLength(0)
    expect((await queue.pendingWrites()).map(w => w.tripId)).not.toContain('tripA')
  })

  it('control: a write captured and fired under the same live session still saves', async () => {
    // The guard must not over-refuse: same identity, same as before.
    const { store } = await bootedAs('userA')
    store._setTripWriteDebounceMs(60)
    expect(store.updateTrip('tripA', { name: 'Edited by A' })).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(tripUpdates()).toHaveLength(1)
  })
})

describe('#578 — the store wires what it promises', () => {
  const src = read('../src/store/store.ts')

  it('cancels on logout AND on any hydrate identity transition', () => {
    // logout covers the sign-out; the hydrate closure is the ONLY place the
    // A→B switch is visible — a fix that touches logout() alone leaves that
    // path wide open (the pitfall the issue pins).
    expect(src).toMatch(/if \(cache\.sessionUserId !== userId\) _cancelTripWrites\(\)/)
    const logoutBody = src.slice(src.indexOf('export async function logout'), src.indexOf('export async function enforceDisabledCheck'))
    expect(logoutBody).toContain('_cancelTripWrites()')
  })

  it('the fire itself checks identity BEFORE claiming anything', () => {
    // The guard runs before markLocalWrite: a refused write must not claim an
    // echo window under the wrong (or no) account either.
    const fn = src.slice(src.indexOf('async function persistTripFieldNow'))
    const guard = fn.indexOf('if (!scheduledFor || cache.sessionUserId !== scheduledFor)')
    const claim = fn.indexOf("markLocalWrite('trips', id)")
    expect(guard, 'the fire-time identity guard is gone').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(claim)
    expect(fn.indexOf('queueWrite({ tripId: id')).toBeGreaterThan(guard)
  })

  it('captures the session at schedule time, beside the snapshot', () => {
    // B0's snapshot-at-call-time contract, extended to identity: the entry
    // carries WHOSE edit it is, so the fire compares against that and not
    // against whoever is signed in when the timer runs.
    expect(src).toMatch(/const scheduledFor = cache\.sessionUserId/)
    expect(src).toMatch(/pendingTripWrites\.set\(id, \{ timer, trip: snapshot, sessionId: scheduledFor \}\)/)
  })
})
