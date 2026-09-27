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
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const rows = state.tables[table] ?? []
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      update: () => builder, insert: () => builder, delete: () => builder,
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
