// Map deletion and restore behavior remains client-write-through. Stage C
// transition behavior is covered by the server receipt and database fixtures.
import { describe, it, expect, vi } from 'vitest'
import { seedData } from '../src/data/seed'

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; payload?: unknown }>,
}))

vi.mock('../src/lib/supabase', async () => {
  const { tripWriteClient } = await import('./helpers/tripWriteClient')
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
    supabase: tripWriteClient({ from: (t: string) => makeBuilder(t) }),
  }
})

import {
  addStop, deleteStop, restoreStop,
  duplicateTrip, tripById, getSnapshot, _setTripWriteDebounceMs,
} from '../src/store/store'

_setTripWriteDebounceMs(0)

const keralaTrip = seedData.trips[0]
const ownerId = 'owner-test'

function singleTrip() {
  calls.length = 0
  // Write-through needs an identity: persistTripField returns early without a
  // session, so the writes this suite asserts never get scheduled.
  getSnapshot().sessionUserId = ownerId
  return duplicateTrip(keralaTrip, ownerId)
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function tripsUpdates() {
  return calls.filter(c => c.table === 'trips' && c.method === 'update')
}

describe('delete-from-map: deleteStop + restoreStop', () => {
  it('deleteStop removes the stop and writes through', async () => {
    const copy = singleTrip()
    const s = addStop(copy.id, 0, {
      title: 'Map Pin Cafe', category: 'food', locationName: 'Somewhere',
      lat: 10.1, lng: 76.7, description: '', visitMinutes: 30,
      entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'nice-to-have',
      status: 'confirmed',
    })
    calls.length = 0
    deleteStop(copy.id, s.id)
    expect(tripById(copy.id)!.days[0].stops.some(x => x.id === s.id)).toBe(false)
    await flush()
    expect(tripsUpdates().length).toBeGreaterThan(0)
    const persisted = tripsUpdates()[tripsUpdates().length - 1].payload as { days?: Array<{ index: number; stops: Array<{ id?: string }> }> }
    expect(persisted?.days?.some(day => (day.stops ?? []).some(x => x.id === s.id))).toBe(false)
  })

  it('restoreStop (Undo) puts the stop back on its day at its old order', () => {
    const copy = singleTrip()
    const day0 = tripById(copy.id)!.days[0]
    const victim = day0.stops[1]
    const orderBefore = victim.orderInDay
    deleteStop(copy.id, victim.id)
    expect(tripById(copy.id)!.days[0].stops.some(x => x.id === victim.id)).toBe(false)
    restoreStop(copy.id, victim, 0)
    const restored = tripById(copy.id)!.days[0].stops.find(x => x.id === victim.id)
    expect(restored).toBeTruthy()
    expect(restored!.orderInDay).toBe(orderBefore)
  })

  it('deleting an unknown stop is a safe no-op', () => {
    const copy = singleTrip()
    const before = tripById(copy.id)!.days[0].stops.length
    expect(() => deleteStop(copy.id, 'no-such-stop')).not.toThrow()
    expect(tripById(copy.id)!.days[0].stops.length).toBe(before)
  })
})
