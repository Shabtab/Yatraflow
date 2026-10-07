// ============ Snapshot decode runs the file-import repair wall ============
// A share link is a trip document, so decode runs the same wall a file
// import runs. Unusable coords drop; 0-based orders rebuild; stale leg
// fields go. Identity rides back from the payload, so a clean link still
// round-trips losslessly (#368).
import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { encodeTripSnapshot, decodeTripSnapshot } from '../src/lib/snapshot'
import type { Trip } from '../src/data/types'

/** Mirror the wire format snapshot.ts writes: flag byte 1 = deflate-raw,
 *  then base64url under the yf1_ prefix. This encodes a V1 payload by hand. */
function encodeV1Link(trip: Record<string, unknown>): string {
  const json = JSON.stringify({ ...trip, formatVersion: 1 })
  const out = Buffer.concat([Buffer.from([1]), deflateRawSync(json)])
  return 'yf1_' + out.toString('base64url')
}

/** The shape an OLD build shared: 0-based orders, stale leg fields, and one
 *  stop pinned to Null Island. A file like this was refused or repaired; a
 *  link decoded it straight into the app. */
const dirtyTrip = {
  id: 'trip_dirty_v1',
  name: 'Old shared link',
  startLocation: 'Panaji',
  destinations: ['Panaji', 'Palolem'],
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  travellers: 2,
  transportMode: 'car',
  budgetPerPersonInr: 9000,
  travelStyle: 'balanced',
  coverEmoji: '🏖️',
  days: [
    {
      id: 'd1', index: 0, stops: [
        { id: 's2', title: 'Palolem Beach', lat: 15.01, lng: 74.02, visitMinutes: 90, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, category: 'beach', priority: 'must-do', status: 'confirmed', orderInDay: 0, legDistanceKm: 12, arrivalTime: '09:00' },
        { id: 's1', title: 'Null Island pin', lat: 0, lng: 0, visitMinutes: 60, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, category: 'sightseeing', priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      ],
    },
    {
      id: 'd2', index: 1, stops: [
        { id: 's3', title: 'Market', lat: 15.1, lng: 74.1, visitMinutes: 45, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, category: 'shopping', priority: 'must-do', status: 'confirmed', orderInDay: 0 },
      ],
    },
  ],
}

const STALE_LEG_KEYS = ['legDistanceKm', 'arrivalTime', 'departTime', 'legTravelMinutes'] as const

describe('decodeTripSnapshot — the repair wall on a link (#368)', () => {
  it('decodes a dirty v1 link clean: no Null-Island pin, 1-based orders, no stale leg fields', async () => {
    const trip = await decodeTripSnapshot(encodeV1Link(dirtyTrip))
    const stops = trip.days.flatMap(d => d.stops)
    // The (0,0) stop is gone — no patches exist on a link, so the wall drops it.
    expect(stops.map(s => s.title)).toEqual(['Palolem Beach', 'Market'])
    for (const d of trip.days) {
      expect(d.stops.map(s => s.orderInDay)).toEqual(d.stops.map((_, i) => i + 1))
    }
    for (const s of stops) {
      for (const k of STALE_LEG_KEYS) expect(k in s, `${s.id} carries ${k}`).toBe(false)
    }
    // The clean stop survives with its own coordinates.
    expect(trip.days[0].stops[0].lat).toBe(15.01)
    expect(trip.days[0].stops[0].lng).toBe(74.02)
  })

  it('refuses a link whose every stop sits on Null Island', async () => {
    const allBad = {
      ...dirtyTrip,
      days: dirtyTrip.days.map(d => ({ ...d, stops: d.stops.map(s => ({ ...s, lat: 0, lng: 0 })) })),
    }
    await expect(decodeTripSnapshot(encodeV1Link(allBad))).rejects.toThrow('bad data')
  })

  it('a clean current-version link still round-trips losslessly', async () => {
    // The wall was built for foreign files; this guard says it must not
    // rewrite a trip this build encoded. Identity rides back from the payload.
    const cleanTrip = {
      id: 'trip_clean_link',
      name: 'Clean link trip',
      startLocation: 'Panaji',
      destinations: ['Palolem'],
      startDate: '2026-11-01',
      endDate: '2026-11-01',
      travellers: 2,
      transportMode: 'car',
      budgetPerPersonInr: 9000,
      travelStyle: 'relaxed',
      coverEmoji: '🏖️',
      visibility: 'private',
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
      expenses: [],
      fixedCommitments: [],
      days: [
        {
          id: 'd1', index: 0, title: 'Palolem day', stops: [
            {
              id: 's1', title: 'Palolem Beach', category: 'beach', locationName: 'Palolem',
              lat: 15.01, lng: 74.02, visitMinutes: 120, entryFeeInrPerPerson: 0,
              transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 1,
            },
          ],
        },
      ],
    } as unknown as Trip
    const back = await decodeTripSnapshot(await encodeTripSnapshot(cleanTrip))
    expect(back).toEqual(cleanTrip)
  })
})
