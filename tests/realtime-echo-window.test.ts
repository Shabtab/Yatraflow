// ============ Realtime echo window for trip writes ============
// `persistTripFieldNow` (src/store/store.ts) records a local write so the
// realtime broadcast of that same write is ignored rather than clobbering
// optimistic state. It used to call markLocalWrite AFTER awaiting the row
// UPDATE, so the guard only covered the moment the write RESOLVED — everything
// before that, i.e. the whole server round trip, was unguarded. A postgres_changes
// echo landing in that hole was treated as a collaborator's edit and replaced
// the freshly reordered `days` with the stale server row: the user accepted the
// impact dialog, saw the change, and then watched it revert.
//
// Two layers here: the guard's own semantics, and the store-level ORDER of
// "arm the guard" vs "await the write", which is the actual regression.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRecentLocalWrite } from '../src/lib/realtimeCore'
import { seedData } from '../src/data/seed'

describe('isRecentLocalWrite — the echo guard itself', () => {
  it('suppresses a write recorded inside the 2s window', () => {
    const recent = new Map([['trips:t1', 1000]])
    expect(isRecentLocalWrite(recent, 'trips', 't1', 1000)).toBe(true)
    expect(isRecentLocalWrite(recent, 'trips', 't1', 2999)).toBe(true)
  })

  it('lets an older write through', () => {
    const recent = new Map([['trips:t1', 1000]])
    expect(isRecentLocalWrite(recent, 'trips', 't1', 3001)).toBe(false)
  })

  it('scopes the guard to the exact table:id pair', () => {
    const recent = new Map([['trips:t1', 1000]])
    expect(isRecentLocalWrite(recent, 'trips', 't2', 1200)).toBe(false)
    expect(isRecentLocalWrite(recent, 'suggestions', 't1', 1200)).toBe(false)
  })
})

// ---- store-level ordering: the actual regression ----
const { calls, state } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string }>,
  state: {
    handlers: {} as Record<string, (payload: unknown) => void>,
    /** resolvers for row UPDATEs the mock deliberately holds open */
    inFlight: [] as Array<() => void>,
    holdUpdates: false,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let method: string | undefined
    const builder: Record<string, unknown> = {}
    const chain = (m: string) => { method = m; return builder }
    builder.update = () => chain('update')
    builder.insert = () => chain('insert')
    builder.upsert = () => chain('upsert')
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
      if (method) calls.push({ table, method })
      // Hold trip UPDATEs open so a test can deliver an echo while the write is
      // genuinely unresolved — the only way to distinguish "armed before the
      // await" from "armed after".
      if (state.holdUpdates && table === 'trips' && method === 'update') {
        return new Promise<{ data: unknown; error: unknown }>(resolve => {
          state.inFlight.push(() => resolve({ data: [], error: null }))
        }).then(res)
      }
      return Promise.resolve({ data: [], error: null }).then(res)
    }
    return builder
  }
  const chainObj: Record<string, unknown> = {
    on: (_k: string, filter: { table: string }, cb: (p: unknown) => void) => {
      state.handlers[filter.table] = cb
      return chainObj
    },
    subscribe: () => ({}),
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      channel: () => chainObj,
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
      },
    },
  }
})

import { duplicateTrip, updateStop, tripById, connectRealtime, _flushTripWrites, _clearRecentLocalWrites } from '../src/store/store'

const keralaTrip = seedData.trips[0]

afterEach(() => {
  calls.length = 0
  state.inFlight.length = 0
  state.holdUpdates = false
})

const orderOf = (tripId: string, day = 0) =>
  [...tripById(tripId)!.days[day].stops]
    .sort((a, b) => a.orderInDay - b.orderInDay)
    .map(s => s.id)

/** A "server row" snapshot of a trip — what a realtime echo would carry. */
function rowOf(tripId: string) {
  const t = tripById(tripId)!
  return {
    id: t.id, owner_id: 'owner-test', name: t.name,
    start_location: t.startLocation, destinations: t.destinations,
    start_date: t.startDate, end_date: t.endDate,
    travellers: t.travellers, transport_mode: t.transportMode,
    budget_per_person_inr: t.budgetPerPersonInr, travel_style: t.travelStyle,
    fixed_commitments: t.fixedCommitments, expenses: t.expenses,
    cover_emoji: t.coverEmoji, visibility: t.visibility,
    days: JSON.parse(JSON.stringify(t.days)),
  }
}

describe('the echo guard is armed before the write is awaited', () => {
  it('a stale echo landing mid-flight does not revert the reorder', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    // Creating the trip performs a write of its own, which arms an echo window.
    // Clear the ledger so the ONLY window in play is the reorder's — otherwise
    // the setup window masks the very bug under test (2s is longer than a test).
    await new Promise(r => setTimeout(r, 0))
    _clearRecentLocalWrites()

    connectRealtime('owner-test')
    expect(state.handlers['trips'], 'realtime handler must be registered').toBeTruthy()

    const before = orderOf(trip.id)
    const staleEcho = rowOf(trip.id) // carries the ORIGINAL order

    state.holdUpdates = true
    updateStop(trip.id, before[0], { orderInDay: 999 })
    const afterLocal = orderOf(trip.id)
    expect(afterLocal, 'the local reorder must have taken effect').not.toEqual(before)
    expect(afterLocal[afterLocal.length - 1]).toBe(before[0])

    _flushTripWrites()
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(state.inFlight.length, 'the row UPDATE must be in flight').toBeGreaterThan(0)

    // The echo arrives while the server still holds the OLD order.
    state.handlers['trips']({ eventType: 'UPDATE', new: staleEcho, old: { id: trip.id } })

    expect(
      orderOf(trip.id),
      'the reorder must survive an echo that lands before the write resolves',
    ).toEqual(afterLocal)

    state.inFlight.forEach(release => release())
    await new Promise(r => setTimeout(r, 0))
    expect(orderOf(trip.id)).toEqual(afterLocal)
  })

  it('persistTripFieldNow arms the guard before awaiting (source-level pin)', () => {
    // The behavioural test above is the real proof; this pins the ordering so a
    // future refactor cannot quietly move markLocalWrite back below the await.
    const src = readFileSync(resolve(__dirname, '../src/store/store.ts'), 'utf8')
    const start = src.indexOf('async function persistTripFieldNow')
    expect(start, 'persistTripFieldNow must exist').toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\n}', start))
    const arm = body.indexOf("markLocalWrite('trips', id)")
    const write = body.indexOf('.update(')
    expect(arm, 'persistTripFieldNow must call markLocalWrite').toBeGreaterThan(-1)
    expect(write, 'persistTripFieldNow must perform a row update').toBeGreaterThan(-1)
    expect(arm, 'the echo guard must be armed BEFORE the row update is issued').toBeLessThan(write)
  })
})
