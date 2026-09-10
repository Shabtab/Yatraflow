// ============ Debounced trip writes (P4) ============
// persistTripField coalesces a burst of edits into one row UPDATE per trip via
// a trailing 600ms timer. The suite's default is zero-debounce (immediate), so
// this file turns it back ON with fake timers to prove coalescing and the
// _flushTripWrites() escape hatch, then restores the default.
import { describe, it, expect, vi, afterEach } from 'vitest'
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
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => { if (method) calls.push({ table, method, payload }); resolve({ data: null, error: null }) }).then(res)
    return builder
  }
  return { isSupabaseConfigured: false, supabase: { from: (t: string) => makeBuilder(t) } }
})

import { duplicateTrip, updateStop, _setTripWriteDebounceMs, _flushTripWrites } from '../src/store/store'

const keralaTrip = seedData.trips[0]
const updates = () => calls.filter(c => c.table === 'trips' && c.method === 'update').length

afterEach(() => {
  vi.useRealTimers()
  _setTripWriteDebounceMs(0)
  calls.length = 0
})

describe('debounced trip writes (P4)', () => {
  it('coalesces a burst of edits into a single row UPDATE', async () => {
    vi.useFakeTimers()
    _setTripWriteDebounceMs(600)
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    const stop = trip.days[0].stops[0]
    updateStop(trip.id, stop.id, { visitMinutes: 10 })
    updateStop(trip.id, stop.id, { visitMinutes: 20 })
    updateStop(trip.id, stop.id, { visitMinutes: 30 })
    expect(updates()).toBe(0) // nothing written before the window closes
    await vi.advanceTimersByTimeAsync(700)
    expect(updates()).toBe(1) // exactly one trailing UPDATE for the burst
  })

  it('_flushTripWrites() forces pending writes immediately', async () => {
    vi.useFakeTimers()
    _setTripWriteDebounceMs(600)
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    updateStop(trip.id, trip.days[0].stops[0].id, { visitMinutes: 99 })
    expect(updates()).toBe(0)
    _flushTripWrites()
    await vi.advanceTimersByTimeAsync(0)
    expect(updates()).toBe(1)
  })

  it('zero-debounce mode (the suite default) writes immediately', async () => {
    _setTripWriteDebounceMs(0)
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    updateStop(trip.id, trip.days[0].stops[0].id, { visitMinutes: 77 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(updates()).toBeGreaterThan(0)
  })
})
