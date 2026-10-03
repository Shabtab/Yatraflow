// ============ M6 · Together — PR-B behavioral tests ============
// B4 (mark settled) exercises the real mutation surface with a mocked client:
// the write-through contract (AGENTS: every trip mutation persists, the whole
// gate stays green when one doesn't — nothing exercises write-through), the
// activity entry, and the settled flag surviving a tripToRow round-trip (the
// column is a JSONB blob, so a key the mapper drops would vanish silently).
// B1's client gating pins that presence degrades to no-op without a backend.
import { describe, it, expect, vi } from 'vitest'
import { seedData } from '../src/data/seed'

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; payload?: unknown }>,
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let method: string | undefined
    let payload: unknown
    const builder: Record<string, unknown> = {}
    const chain = (m: string, p?: unknown) => { method = m; payload = p; return builder }
    builder.update = (p: unknown) => chain('update', p)
    builder.insert = (p: unknown) => chain('insert', p)
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.lt = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => { if (method) calls.push({ table, method, payload }); resolve({ data: null, error: null }) }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: false,
    supabase: { from: (t: string) => makeBuilder(t) },
  }
})

import {
  duplicateTrip, addExpense, markExpenseSettled, markExpenseUnsettled,
  tripById, _setTripWriteDebounceMs, _flushTripWrites, presenceClient, getSnapshot,
  updateStop, moveStopBetweenDays, _applyRealtimeEventForTest,
  _clearRecentLocalWrites, _clearServerTripTimestamps, setStopStatus,
} from '../src/store/store'
import { tripToRow } from '../src/lib/tripRow'

_setTripWriteDebounceMs(0)

const keralaTrip = seedData.trips[0]
const ownerId = 'owner-test'

function singleTrip() {
  calls.length = 0
  return duplicateTrip(keralaTrip, ownerId)
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function tripsUpdates() {
  return calls.filter(c => c.table === 'trips' && c.method === 'update')
}

/** Feed a postgres_changes payload straight into the store's realtime dispatch
 *  (test hook — dispatchRealtimeEvent is module-private). */
function feedRemoteEvent(payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new?: unknown; old?: unknown }): void {
  _applyRealtimeEventForTest('trips', payload as never)
}

/** Make the NEXT event a genuinely REMOTE one: duplicateTrip/updateStop arm a
 *  2s echo window (markLocalWrite) that would swallow the fed row as our own
 *  echo, and the server-timestamp ledger is a module singleton shared across
 *  tests. Clearing both simulates an elapsed window and a fresh ledger. */
function freshRealtimeLedgers(): void {
  _clearRecentLocalWrites()
  _clearServerTripTimestamps()
}

describe('B4 · markExpenseSettled', () => {
  // #384: settling is owner/editor only (decided 2026-09-25) — these pins
  // exercise the write-through AS the owner the copy carries. The role gate
  // itself is pinned in tests/budget-read-status.test.ts.
  it('writes the settled flag through to the trips row', async () => {
    const trip = singleTrip()
    // #578 — the write is identity-gated (dropped without a session), same as
    // the activity entry below.
    getSnapshot().sessionUserId = ownerId
    await flush()
    calls.length = 0
    addExpense(trip.id, { label: 'Fuel bluff', category: 'transport', amountInr: 2000 })
    markExpenseSettled(trip.id, tripById(trip.id)!.expenses.at(-1)!.id, ownerId)
    await flush()
    expect(tripsUpdates().length).toBeGreaterThan(0)
    const last = tripsUpdates().at(-1)!.payload as { expenses: Array<{ settled?: { by: string; at: number } }> }
    expect(last.expenses.some(e => e.settled?.by === ownerId)).toBe(true)
  })

  it('records the settle in the activity feed', async () => {
    const trip = singleTrip()
    // The activity entry (and its write) is gated on a signed-in session.
    getSnapshot().sessionUserId = ownerId
    addExpense(trip.id, { label: 'Tolls', category: 'tolls-parking', amountInr: 350 })
    const id = tripById(trip.id)!.expenses.at(-1)!.id
    calls.length = 0
    markExpenseSettled(trip.id, id, ownerId)
    await flush()
    const activityRows = calls.filter(c => c.table === 'activity' && c.method === 'insert')
    expect(activityRows.length).toBeGreaterThan(0)
  })

  it('is idempotent — a settled line is not re-marked', async () => {
    const trip = singleTrip()
    await flush()
    addExpense(trip.id, { label: 'Snacks', category: 'food', amountInr: 120 })
    const id = tripById(trip.id)!.expenses.at(-1)!.id
    markExpenseSettled(trip.id, id, ownerId)
    await flush()
    calls.length = 0
    markExpenseSettled(trip.id, id, ownerId)
    await flush()
    expect(tripsUpdates()).toHaveLength(0)
  })

  it('markExpenseUnsettled reopens the line and writes through', async () => {
    const trip = singleTrip()
    await flush()
    addExpense(trip.id, { label: 'Parking', category: 'tolls-parking', amountInr: 80 })
    const id = tripById(trip.id)!.expenses.at(-1)!.id
    markExpenseSettled(trip.id, id, ownerId)
    await flush()
    calls.length = 0
    markExpenseUnsettled(trip.id, id, ownerId)
    await flush()
    expect(tripsUpdates().length).toBeGreaterThan(0)
    const last = tripsUpdates().at(-1)!.payload as { expenses: Array<{ settled?: unknown }> }
    expect(last.expenses.find(e => e.settled)?.id ?? null).toBeNull()
  })

  it('no-ops silently for an unknown trip or expense', async () => {
    singleTrip()
    await flush()
    calls.length = 0
    markExpenseSettled('nope', 'nope', 'u1')
    markExpenseUnsettled('nope', 'nope', null)
    await flush()
    expect(tripsUpdates()).toHaveLength(0)
  })
})

describe('B4 · settled survives the row round-trip', () => {
  it('tripToRow keeps the settled key inside the expenses JSONB', () => {
    const trip = singleTrip()
    trip.expenses.push({ id: 'ex1', label: 'Hotel', category: 'accommodation', amountInr: 3000, settled: { by: 'u9', at: 1234 } })
    const row = tripToRow(trip, ownerId)
    const raw = JSON.parse(JSON.stringify(row.expenses)) as Array<{ id: string; settled?: { by: string } }>
    expect(raw.find(e => e.id === 'ex1')?.settled?.by).toBe('u9')
  })
})

describe('B1 · presence gating', () => {
  it('presenceClient returns null when no backend is compiled in', () => {
    // The mocked module above sets isSupabaseConfigured: false.
    expect(presenceClient()).toBeNull()
  })
})

describe('B0 · debounced flush persists the CAPTURED snapshot', () => {
  // The coalescer's failure mode: the timer (or _flushTripWrites) re-reading
  // tripById(id) at fire time lets a REMOTE update landing inside the debounce
  // window be persisted over the local edit that scheduled the write — the
  // local edit silently vanishes from the DB. The write must carry the
  // snapshot captured AT CALL TIME.
  it('flush persists the call-time snapshot, not the later remote state', async () => {
    _setTripWriteDebounceMs(600)
    try {
      const trip = singleTrip()
      await flush()
      calls.length = 0
      // Local edit → pendingTripWrites holds { timer, trip } with THIS title.
      updateStop(trip.id, tripById(trip.id)!.days[0].stops[0].id, { title: 'Local title' })
      // A remote update lands INSIDE the debounce window: the cache now holds
      // the collaborator's state (a full row swap replaces the day array —
      // simulated by writing the cache directly; the coalescer only ever sees
      // the cache, no realtime machinery needed).
      const cached = tripById(trip.id)!
      cached.name = 'Remote name'
      cached.days = []
      expect(tripById(trip.id)?.name).toBe('Remote name')
      // The trailing write fires — with the CAPTURED snapshot: the local stop
      // edit survives remotely, and the remote days are NOT re-persisted.
      _flushTripWrites()
      await flush()
      const last = tripsUpdates().at(-1)!.payload as { days: Array<{ stops: Array<{ title: string }> }> }
      expect(JSON.stringify(last.days)).toContain('Local title')
      expect(last.days).not.toEqual([])
    } finally {
      _setTripWriteDebounceMs(0)
      _flushTripWrites()
    }
  })

  it('updateStop writes through (control for the B0 rework)', async () => {
    const trip = singleTrip()
    await flush()
    calls.length = 0
    updateStop(trip.id, tripById(trip.id)!.days[0].stops[0].id, { title: 'Renamed' })
    await flush()
    expect(tripsUpdates()).toHaveLength(1)
  })

  // setStopStatus captured the trip BEFORE mutateTrip and persisted that
  // pre-mutation reference — safe only while the flush re-read the cache at
  // fire time; with the B0 coalescer persisting the call-time snapshot
  // verbatim, the write carried the trip WITHOUT the new status and the flip
  // reverted on the next hydration or collaborator sync. The whole suite
  // missed this branch — a green gate shipped a data-loss bug.
  it('setStopStatus persists the trip WITH the new status', async () => {
    const trip = singleTrip()
    await flush()
    calls.length = 0
    const stopId = tripById(trip.id)!.days[0].stops[0].id
    setStopStatus(trip.id, 'done', stopId)
    await flush()
    const updates = tripsUpdates()
    expect(updates).toHaveLength(1)
    const row = updates[0].payload as { days: Array<{ stops: Array<{ id: string; status?: string }> }> }
    const persisted = row.days.flatMap(d => d.stops).find(s => s.id === stopId)
    expect(persisted?.status).toBe('done')
  })

  it('setStopStatus still flips the cached stop (the visible half of the bug)', async () => {
    const trip = singleTrip()
    await flush()
    const stopId = tripById(trip.id)!.days[0].stops[0].id
    setStopStatus(trip.id, 'skipped', stopId)
    expect(tripById(trip.id)!.days[0].stops[0].status).toBe('skipped')
  })
})

describe('B2 · stale-update guard vs the SERVER ledger (store level)', () => {
  type Row = { id: string; updated_at?: number }

  it('a remote UPDATE carrying an equal timestamp applies (pre-trigger normal case)', async () => {
    const trip = singleTrip()
    await flush()
    calls.length = 0
    freshRealtimeLedgers()
    // Simulate the pre-trigger server: every remote row carries the same
    // updated_at. The guard must NOT drop it.
    const remote: Row = { id: trip.id, updated_at: 1, expenses: [{ id: 'ex-r', label: 'Remote lunch', category: 'food', amountInr: 250 }], name: 'Remote name' }
    feedRemoteEvent({ eventType: 'UPDATE', new: remote, old: { id: trip.id } })
    await flush()
    const cached = tripById(trip.id)
    expect(cached?.name).toBe('Remote name')
  })

  it('a remote UPDATE OLDER than the ledger is dropped (reconnect replay)', async () => {
    const trip = singleTrip()
    await flush()
    calls.length = 0
    freshRealtimeLedgers()
    // Seed the ledger with a NEWER server timestamp, as hydration would.
    const fresh: Row = { id: trip.id, updated_at: 5_000, name: 'Newest' }
    feedRemoteEvent({ eventType: 'UPDATE', new: fresh, old: { id: trip.id } })
    await flush()
    expect(tripById(trip.id)?.name).toBe('Newest')

    // Now a replay of an older server row — dropped, cache untouched.
    const replay: Row = { id: trip.id, updated_at: 4_000, name: 'Stale replay' }
    feedRemoteEvent({ eventType: 'UPDATE', new: replay, old: { id: trip.id } })
    await flush()
    expect(tripById(trip.id)?.name).toBe('Newest')
  })

  it('an optimistic local edit does NOT raise the guard (client clock is not the ledger)', async () => {
    const trip = singleTrip()
    await flush()
    calls.length = 0
    // A local edit bumps Trip.updatedAt to Date.now() — far above any server
    // timestamp this test feeds. The guard must still apply a remote row with
    // a SMALLER updated_at, because the comparison reads the server ledger,
    // not the optimistic client clock. The echo window is cleared so the fed
    // row is treated as genuinely remote, not as our own echo.
    updateStop(trip.id, tripById(trip.id)!.days[0].stops[0].id, { title: 'Mine' })
    await flush()
    freshRealtimeLedgers()
    const remote: Row = { id: trip.id, updated_at: 10, name: 'Remote wins on equal' }
    feedRemoteEvent({ eventType: 'UPDATE', new: remote, old: { id: trip.id } })
    await flush()
    expect(tripById(trip.id)?.name).toBe('Remote wins on equal')
  })

  it('moveStopBetweenDays writes through on the found path (B0 sibling parity)', async () => {
    const trip = singleTrip()
    await flush()
    calls.length = 0
    moveStopBetweenDays(trip.id, tripById(trip.id)!.days[0].stops[0].id, 1)
    await flush()
    expect(tripsUpdates().length).toBeGreaterThan(0)
  })
})

describe('#567 — trip_members events route on the composite key, no fabricated id', () => {
  function feedMembership(payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new?: unknown; old?: unknown }): void {
    _applyRealtimeEventForTest('trip_members', payload as never)
  }

  it('a real DELETE payload (replica identity: composite key only) evicts the session user', () => {
    const trip = singleTrip()
    getSnapshot().sessionUserId = ownerId
    // Orphaned sibling rows for this trip — the eviction must cascade them the
    // same way the trips DELETE case does.
    getSnapshot().suggestions = [{ id: 's-orphan', tripId: trip.id }] as never
    getSnapshot().notifications = [{ id: 'n-orphan', tripId: trip.id }] as never
    feedMembership({ eventType: 'DELETE', old: { trip_id: trip.id, user_id: ownerId } })
    const db = getSnapshot()
    expect(db.trips.find(t => t.id === trip.id)).toBeUndefined()
    expect(db.suggestions).toHaveLength(0)
    expect(db.notifications).toHaveLength(0)
  })

  it('a remote role UPDATE lands on an existing trip', () => {
    const trip = singleTrip()
    feedMembership({ eventType: 'INSERT', new: { trip_id: trip.id, user_id: 'crew-9', role: 'owner', joined_at: 1 } })
    expect(tripById(trip.id)!.members.some(m => m.userId === 'crew-9' && m.role === 'owner')).toBe(true)
    feedMembership({ eventType: 'UPDATE', new: { trip_id: trip.id, user_id: 'crew-9', role: 'editor', joined_at: 1 } })
    expect(tripById(trip.id)!.members.find(m => m.userId === 'crew-9')?.role).toBe('editor')
  })

  it('another member\'s DELETE removes just that member, and an unknown trip triggers the fetch', () => {
    const trip = singleTrip()
    feedMembership({ eventType: 'INSERT', new: { trip_id: trip.id, user_id: 'crew-7', role: 'member', joined_at: 1 } })
    feedMembership({ eventType: 'DELETE', old: { trip_id: trip.id, user_id: 'crew-7' } })
    expect(tripById(trip.id)!.members.some(m => m.userId === 'crew-7')).toBe(false)
    expect(getSnapshot().trips.find(t => t.id === trip.id)).toBeTruthy()

    calls.length = 0
    // The unknown-trip branch calls fetchTripIntoCache; with the mock's
    // null-data selects it resolves quietly. The observable contract here:
    // the event ROUTES — nothing throws out of the dispatch, the known trip
    // is untouched, and no write went out under a trip the session cannot see.
    expect(() => feedMembership({ eventType: 'INSERT', new: { trip_id: 'trip-not-in-cache-567', user_id: 'crew-8', role: 'editor', joined_at: 1 } })).not.toThrow()
    expect(tripById(trip.id)!.members.some(m => m.userId === 'crew-8')).toBe(false)
    expect(calls.some(c => c.table === 'trips' && (c.method === 'update' || c.method === 'insert'))).toBe(false)
  })
})
