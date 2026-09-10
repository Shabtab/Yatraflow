// ============ Store persistence contract ============
// Guards that every trip-mutating store call actually writes through to the
// "database" (Supabase) — not just the in-memory cache. Regression for the
// addStop() bug where accepting a suggestion added a stop to the cache but
// never persisted it, so it vanished on reload.
//
// The Supabase module is mocked so these tests never touch the network and can
// assert which tables/methods were invoked. Run under the default node env like
// the other store tests.
import { describe, it, expect, vi } from 'vitest'
import { seedData } from '../src/data/seed'

// Module-level call log shared with the mocked supabase factory (hoisted above
// the vi.mock by vitest so the factory can reference it).
const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; payload?: unknown }>,
}))

vi.mock('../src/lib/supabase', () => {
  // Faithful to postgrest-js, which is LAZY: the builder's constructor only copies
  // config and the request is issued from then(). This mock used to record the call
  // inside update()/insert()/delete() — i.e. it was more eager than the client it
  // stands in for, so it happily reported writes that could never have been sent.
  // Recording now happens at then() time, which is the only thing that can make a
  // `void builder` show up as zero calls. Issue #52.
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
    // Chainable + thenable: the write is issued here, and only here.
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => { if (method) calls.push({ table, method, payload }); resolve({ data: null, error: null }) }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: false,
    supabase: { from: (t: string) => makeBuilder(t) },
  }
})

import { duplicateTrip, addStop, tripById, moveStopBetweenDays, updateStop, _setTripWriteDebounceMs } from '../src/store/store'

// The production 600ms trailing debounce would delay writes past flush()
// (setTimeout 0). Zero it here; coalescing is covered in store-debounce.test.ts.
_setTripWriteDebounceMs(0)

const keralaTrip = seedData.trips[0]
const ownerId = 'owner-test'

function singleTrip() {
  calls.length = 0
  return duplicateTrip(keralaTrip, ownerId)
}

/** Let the store's fire-and-forget async writes flush to the mocked client. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** All trips UPDATE calls captured so far (newest last). */
function tripsUpdates() {
  return calls.filter(c => c.table === 'trips' && c.method === 'update')
}

describe('store persistence write-through', () => {
  it('duplicateTrip writes the trip row plus its members row', async () => {
    singleTrip()
    await flush()
    expect(calls.some(c => c.table === 'trips' && (c.method === 'insert' || c.method === 'update'))).toBe(true)
    expect(calls.some(c => c.table === 'trip_members' && c.method === 'insert')).toBe(true)
  })

  it('addStop persists the trip so the new stop survives a reload', async () => {
    const copy = singleTrip()
    const before = copy.days[0].stops.length
    const s = addStop(copy.id, 0, {
      title: 'Test Viewpoint', category: 'sightseeing', locationName: 'Somewhere',
      lat: 10.1, lng: 76.7, description: 'Added by unit test', visitMinutes: 45,
      entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'nice-to-have',
      status: 'confirmed',
    })
    // Cache reflects the new stop immediately…
    const stop = tripById(copy.id)!.days[0].stops.find(x => x.id === s.id)
    expect(stop?.title).toBe('Test Viewpoint')
    expect(tripById(copy.id)!.days[0].stops.length).toBe(before + 1)
    // …and the trip row was written back to the DB (before this fix, addStop never did).
    await flush()
    expect(tripsUpdates().length).toBeGreaterThan(0)
    const persisted = tripsUpdates()[tripsUpdates().length - 1].payload as { days?: Array<{ index: number; stops: unknown[] }> }
    const targetDay = persisted?.days?.find(d => d.index === 0)
    expect(targetDay?.stops.some(x => (x as { title?: string }).title === 'Test Viewpoint')).toBe(true)
  })

  it('moveStopBetweenDays to an unknown day never drops the stop', () => {
    const copy = singleTrip()
    const day0 = tripById(copy.id)!.days[0]
    const original = day0.stops[0]
    const totalBefore = day0.stops.length
    moveStopBetweenDays(copy.id, original.id, 999) // no such day
    const after = tripById(copy.id)!.days[0].stops
    expect(after.some(s => s.id === original.id)).toBe(true)
    expect(after.length).toBe(totalBefore)
    expect(after.find(s => s.id === original.id)!.orderInDay).toBeGreaterThan(0)
  })

  it('moveStopBetweenDays same-day honors the requested position', () => {
    const copy = singleTrip()
    const day0 = tripById(copy.id)!.days[0]
    const first = day0.stops[0]
    const countBefore = day0.stops.length
    moveStopBetweenDays(copy.id, first.id, 0, 3) // same day, near the end
    const order = tripById(copy.id)!.days[0].stops.find(s => s.id === first.id)!.orderInDay
    expect(order).toBeGreaterThan(1)
    // total count is unchanged for a same-day move
    expect(tripById(copy.id)!.days[0].stops.length).toBe(countBefore)
  })

  it('updateStop write-through on a body field', async () => {
    const copy = singleTrip()
    const stop = copy.days[0].stops[0]
    updateStop(copy.id, stop.id, { visitMinutes: 55 })
    await flush()
    expect(tripsUpdates().length).toBeGreaterThan(0)
  })
})