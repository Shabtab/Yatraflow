import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seedData } from '../src/data/seed'

/**
 * Tests for the #46 minor-store-bug sweep.
 *
 * Covers the claims still true against the current tree (#36-11, #36-15, and
 * #36-18 which lives in ./hydrate-partial.test.ts) and pins the two that were
 * NOT, so they stay that way:
 *
 *   - #36-10 "moveStopBetweenDays returns before write-through" — it does not;
 *     the guard path already persists. Pinned below as a control.
 *   - #36-8 "connectRealtime runs after a failed hydrate" — closed by #45's
 *     session guard, pinned in ./hydrate-partial.test.ts.
 */

const state: {
  writes: Array<{ table: string; method: string; payload: any; eqs: Record<string, unknown> }>
  selects: Array<Record<string, unknown>>
  handlers: Record<string, (payload: any) => void>
  runaway: boolean
} = { writes: [], selects: [], handlers: {}, runaway: false }

/** Rows the mocked tables serve. */
let tripRow: any = null
let tripRowsForHydrate: any[] = []
let memberRows: any[] = []
let memberRowsForUser: any[] = []
/** Per-table select failures to inject, as PostgREST reports them ({ error }). */
let tableErrors: Record<string, unknown> = {}
/** When true every read rejects outright — the network-down case. */
let throwAll = false

// The partial-hydrate warning (#36-18) is user-facing, so the ui module is mocked to
// spy on toasts. Nothing here renders, and the store imports nothing else from it.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/supabase', () => {
  /** Hydration and seeding must terminate. If they ever stop terminating, fail the
   *  test fast with a named cause rather than letting the loop grow this mock's
   *  arrays until the worker dies — which is exactly how it first presented. */
  const QUERY_CEILING = 400
  function bump() {
    if (state.selects.length + state.writes.length > QUERY_CEILING) {
      state.runaway = true
      throw new Error('runaway query loop')
    }
  }
  /** Read path: records the filters so a test can count round-trips per trip. */
  function query(table: string) {
    const eqs: Record<string, unknown> = {}
    const infs: Record<string, unknown> = {}
    const qb: any = { table }
    qb.select = () => qb
    qb.eq = (col: string, val: unknown) => { eqs[col] = val; return qb }
    qb.in = (col: string, vals: unknown[]) => { infs[col] = vals; return qb }
    qb.order = () => qb
    qb.limit = () => qb
    const result = () => {
      state.selects.push({ table, ...eqs, ...infs })
      bump()
      if (throwAll) throw new Error('network down')
      if (tableErrors[table]) return { data: [], error: tableErrors[table] }
      if (table === 'trips') {
        // `.eq('id', …)` is fetchTripIntoCache's single-trip read; `.in('id', …)` is
        // the hydration read that decides whether the account looks brand-new.
        if ('id' in eqs) return { data: tripRow, error: null }
        if ('id' in infs) return { data: tripRowsForHydrate, error: null }
        return { data: [], error: null }
      }
      if (table === 'trip_members') {
        if ('user_id' in eqs) return { data: memberRowsForUser, error: null }
        if ('trip_id' in infs) return { data: memberRows, error: null }
        if ('trip_id' in eqs) return { data: memberRows, error: null }
      }
      return { data: [], error: null }
    }
    qb.maybeSingle = async () => result()
    qb.single = async () => result()
    qb.then = (onF: any, onR?: any) => Promise.resolve().then(result).then(onF, onR)
    return qb
  }
  /** Write path: chainable all the way down, like the PostgREST builder. */
  function record(table: string, method: string, payload: any) {
    const eqs: Record<string, unknown> = {}
    const qb: any = {}
    const done = () => {
      state.writes.push({ table, method, payload, eqs: { ...eqs } })
      bump()
      return Promise.resolve({ error: null, data: null })
    }
    const chainable = () => {
      qb.eq = (col: string, val: unknown) => { eqs[col] = val; return qb }
      qb.in = (col: string, vals: unknown[]) => { eqs[col] = String(vals); return qb }
      qb.order = () => qb
      qb.limit = () => qb
      qb.maybeSingle = done
      qb.single = done
      qb.select = () => qb
      qb.then = (onF: any, onR?: any) => done().then(onF, onR)
      return qb
    }
    return chainable()
  }
  const channel = () => ({
    on: (type: string, cfg: any, handler: (payload: any) => void) => {
      if (type === 'postgres_changes') state.handlers[cfg.table] = handler
      return channel()
    },
    subscribe: (cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return channel() },
  })
  const supabase: any = {
    from: (table: string) => ({
      select: () => query(table),
      insert: (p: any) => record(table, 'insert', p),
      update: (p: any) => record(table, 'update', p),
      upsert: (p: any) => record(table, 'upsert', p),
      delete: () => record(table, 'delete', null),
    }),
    auth: {
      _session: { user: { id: 'amelia' } } as { user: { id: string } } | null,
      getSession: async () => ({ data: { session: supabase.auth._session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => {},
    },
    channel: () => channel(),
    removeChannel: () => {},
    realtime: { removeChannel: () => {} },
  }
  return { supabase, isSupabaseConfigured: () => true, SUPABASE_MISSING: '' }
})

const stops = (...titles: string[]) =>
  titles.map((title, i) => ({ id: `stop-${title}`, title, dayIndex: 0, orderInDay: i + 1 }))

const mkTrip = () =>
  ({
    id: 'trip-1',
    title: 'Lisbon',
    destination: 'Lisbon, Portugal',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    attendees: 2,
    ownerId: 'amelia',
    members: [{ userId: 'amelia', role: 'owner', joinedAt: 1 }],
    days: [
      { index: 0, date: '2026-09-01', label: 'Day 1', stops: stops('Alfama', 'Belém') },
      { index: 1, date: '2026-09-02', label: 'Day 2', stops: [] },
    ],
    expenses: [],
    collaborators: [],
  }) as any

const mkSuggestion = () =>
  ({
    id: 'sug-1',
    tripId: 'trip-1',
    title: 'Time Out Market',
    dayIndex: 0,
    proposedBy: 'priya',
    votes: [],
    comments: [],
  }) as any

async function freshStore() {
  vi.resetModules()
  const store = await import('../src/store/store')
  store._setTripWriteDebounceMs(0)
  const db = store.getSnapshot() as any
  db.trips.push(mkTrip())
  db.suggestions.push(mkSuggestion())
  return store
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
/** An account that owns one trip, so hydration has something real to load. */
function account() {
  memberRowsForUser = [{ id: 'tm-1', trip_id: 'trip-1', user_id: 'amelia', role: 'owner', joined_at: 1 }]
  tripRowsForHydrate = [{ ...portoRow(), id: 'trip-1', title: 'Lisbon' }]
  memberRows = [{ id: 'tm-1', trip_id: 'trip-1', user_id: 'amelia', role: 'owner', joined_at: 1 }]
}

/** Drain a chain of awaited microtasks (seeding, hydration) between macrotasks. */
const settle = async (n = 25) => { for (let i = 0; i < n; i++) await tick() }
const verbs = (store: any) => store.activityFor('trip-1').map((a: any) => a.verb)

/**
 * Store with a live realtime channel: init() runs the real subscribe path, and the
 * test keeps a handle on the per-table handlers (as in ./realtime-containment.test.ts)
 * because dispatchRealtimeEvent is module-private.
 */
async function liveStore() {
  vi.resetModules()
  const store = await import('../src/store/store')
  store._setTripWriteDebounceMs(0)
  store.init()
  await tick(); await tick()
  return store
}

const portoRow = () => ({
  id: 'trip-new', title: 'Porto', destination: 'Porto, Portugal',
  start_date: '2026-10-01', end_date: '2026-10-02', days: [], expenses: [],
  cover_url: '', notes: '', template_id: null,
})

beforeEach(() => {
  state.writes = []
  state.selects = []
  state.handlers = {}
  state.runaway = false
  tripRow = null
  tripRowsForHydrate = []
  memberRows = []
  memberRowsForUser = []
  tableErrors = {}
  throwAll = false
  toast.mockClear()
})

describe('#36-11 — vote activity text', () => {
  it('says "upvoted" for a new upvote', async () => {
    const store = await freshStore()
    store.voteSuggestion('trip-1', 'sug-1', 'amelia', 1)
    expect(verbs(store)).toContain('upvoted a suggestion')
  })

  it('says the vote was REMOVED when the same vote is toggled off', async () => {
    const store = await freshStore()
    store.voteSuggestion('trip-1', 'sug-1', 'amelia', 1)
    store.voteSuggestion('trip-1', 'sug-1', 'amelia', 1)

    // The second call takes the upvote back. Logging "upvoted a suggestion" again
    // told everyone the opposite of what happened.
    expect(verbs(store)).toContain('removed their vote on a suggestion')
    expect(store.getSnapshot().suggestions[0].votes).toHaveLength(0)
  })

  it('still says downvoted when a vote flips side', async () => {
    const store = await freshStore()
    store.voteSuggestion('trip-1', 'sug-1', 'amelia', 1)
    store.voteSuggestion('trip-1', 'sug-1', 'amelia', -1)

    expect(verbs(store)).toContain('downvoted a suggestion')
    expect(verbs(store)).not.toContain('removed their vote on a suggestion')
    expect(store.getSnapshot().suggestions[0].votes).toEqual([
      expect.objectContaining({ userId: 'amelia', value: -1 }),
    ])
  })
})

describe('#36-15 — one fetch per trip, not one per event', () => {
  it('coalesces concurrent trip fetches into a single round-trip', async () => {
    const store = await liveStore()
    tripRow = portoRow()
    memberRows = [{ trip_id: 'trip-new', user_id: 'priya', role: 'editor', joined_at: 1 }]
    expect(store.getSnapshot().trips.map((t: any) => t.id)).not.toContain('trip-new')

    // Two membership events for a trip we do not have yet — someone else joining
    // the same trip seconds later, or a reconnect replay. Both land in one tick.
    // Real trip_members rows carry their own PK; a payload without one is dropped
    // by applyRealtimeEvent's `id === undefined` guard.
    for (let i = 0; i < 2; i++) {
      state.handlers.trip_members({ eventType: 'INSERT', new: { id: `tm-${i}`, trip_id: 'trip-new', user_id: `u${i}`, role: 'editor', joined_at: 1 } })
    }
    await tick()

    const tripFetches = state.selects.filter(s => s.table === 'trips' && s.id === 'trip-new')
    expect(tripFetches).toHaveLength(1)
    expect(store.getSnapshot().trips.map((t: any) => t.id)).toContain('trip-new')
  })

  it('releases the in-flight entry when the fetch finds nothing (guards the new path)', async () => {
    // Not a regression test — this code path did not exist before the fix, so it
    // passes either way. It exists so a future refactor that sets the map entry and
    // forgets the `finally` clear fails here: the trip would then never load.
    account()
    const store = await liveStore()
    memberRows = [{ id: 'tm-9', trip_id: 'trip-new', user_id: 'priya', role: 'editor', joined_at: 1 }]

    // First event: the trip row is not readable yet (RLS lag, or deleted in flight),
    // so the fetch resolves having cached nothing.
    tripRow = null
    state.handlers.trip_members({ eventType: 'INSERT', new: { id: 'tm-0', trip_id: 'trip-new', user_id: 'u0', role: 'editor', joined_at: 1 } })
    await tick()
    expect(state.selects.filter(s => s.table === 'trips' && s.id === 'trip-new')).toHaveLength(1)
    expect(store.getSnapshot().trips.map((t: any) => t.id)).not.toContain('trip-new')

    tripRow = portoRow()
    state.handlers.trip_members({ eventType: 'INSERT', new: { id: 'tm-1', trip_id: 'trip-new', user_id: 'u1', role: 'editor', joined_at: 2 } })
    await tick()

    expect(state.selects.filter(s => s.table === 'trips' && s.id === 'trip-new')).toHaveLength(2)
    expect(store.getSnapshot().trips.map((t: any) => t.id)).toContain('trip-new')
  })
})

describe('seed ↔ hydrate recursion (found while testing #46)', () => {
  it('seeds once, not forever, when the seeded trips never come back', async () => {
    // No membership rows for this user and the trips read stays empty, so every
    // re-hydration still looks like a brand-new account. Before the seedIfEmpty
    // guard, hydrate → seed → re-hydrate → seed recursed until the worker OOM'd.
    await liveStore()
    await settle()

    expect(state.runaway, 'hydrate ↔ seed looped without terminating').toBe(false)
    const tripInserts = state.writes.filter(w => w.table === 'trips' && w.method === 'insert')
    expect(tripInserts.length).toBeGreaterThan(0)
    // Exactly one seed pass — not a multiple, and not unbounded.
    expect(tripInserts.length).toBe(seedData.trips.length)
  }, 10_000)
})

describe('#36-10 — control: the guard path still persists', () => {
  it('writes the trip even when the moved stop cannot be found', async () => {
    const store = await freshStore()

    // The issue claims this path "returns before write-through". It does not:
    // commit() + persistTripField() run first. Pinned so a future refactor that
    // drops the persist fails here instead of quietly re-introducing #36-10.
    store.moveStopBetweenDays('trip-1', 'stop-that-does-not-exist', 1)
    await tick()

    const tripWrites = state.writes.filter(w => w.table === 'trips' && w.method === 'update')
    expect(tripWrites).toHaveLength(1)
    expect(tripWrites[0].eqs.id).toBe('trip-1')
    // Nothing was dropped or duplicated by the no-op.
    expect(store.getSnapshot().trips[0].days[0].stops).toHaveLength(2)
  })
})

describe('#36-18 — a partial hydrate says so', () => {
  const toasts = () => toast.mock.calls.map(c => String(c[0]))

  it('names the table that failed instead of rendering an empty app', async () => {
    account()
    tableErrors = { activity: { message: 'permission denied for table activity' } }

    const store = await liveStore()
    await settle()

    expect(toasts().some(m => m.includes('activity'))).toBe(true)
    // Not all-or-nothing: the trip that DID load is still on screen.
    expect(store.getSnapshot().trips.map((t: any) => t.id)).toContain('trip-1')
  })

  it('stays quiet on a clean hydrate', async () => {
    account()
    await liveStore()
    await settle()
    expect(toasts()).toEqual([])
  })

  it('still reports the total failure toast, unchanged', async () => {
    account()
    throwAll = true
    const store = await liveStore()
    await settle()
    expect(toasts().some(m => m.includes('Could not load your data'))).toBe(true)
    void store
  })
})

describe('#36-8 — control: no live channel against a failed hydration', () => {
  it('does not subscribe when hydration never got a session', async () => {
    // Closed by #45's guard: connectRealtime only runs when the cache still belongs
    // to the account being hydrated, and a failed hydrate never claimed one.
    account()
    throwAll = true
    await liveStore()
    await settle()
    expect(Object.keys(state.handlers)).toEqual([])
  })

  it('does subscribe on a clean hydrate', async () => {
    account()
    await liveStore()
    await settle()
    expect(Object.keys(state.handlers)).toContain('trip_members')
  })
})
