// ============ The itinerary migration chain (#368) ============
// MIGRATIONS used to be identity-only. The real v1 compatibility lived in the
// unversioned normalizer, so the version numbers decorated work done
// elsewhere. The chain now does the v1 shape repairs itself. The normalizer
// stays as version-independent hygiene on top.
import { describe, it, expect } from 'vitest'
import {
  ITINERARY_FORMAT_VERSION, MIGRATIONS, emptyReport, migrateTrip, normalizeTrip,
} from '../src/lib/itinerarySpec'

/** A v1-shaped trip: 0-based stop orders and the four stale leg fields v1's
 *  schema carried. */
function v1Trip(): Record<string, unknown> {
  return {
    id: 'trip_v1', name: 'V1 trip', startLocation: 'Panaji',
    destinations: ['Palolem'], startDate: '2026-11-01', endDate: '2026-11-02',
    travellers: 2, transportMode: 'car', travelStyle: 'balanced', coverEmoji: '🏖️',
    days: [
      {
        id: 'd1', index: 0, stops: [
          { id: 's1', title: 'Beach', lat: 15.01, lng: 74.02, category: 'beach', visitMinutes: 90, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 0, departTime: '08:00', arrivalTime: '09:00', legDistanceKm: 12, legTravelMinutes: 20 },
          { id: 's2', title: 'Market', lat: 15.1, lng: 74.1, category: 'shopping', visitMinutes: 45, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
        ],
      },
      {
        id: 'd2', index: 1, stops: [
          { id: 's3', title: 'Cafe', lat: 15.2, lng: 74.2, category: 'food', visitMinutes: 60, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 0 },
        ],
      },
    ],
  }
}

const STALE_LEG_KEYS = ['departTime', 'arrivalTime', 'legDistanceKm', 'legTravelMinutes'] as const

describe('MIGRATIONS — the chain does the v1 compat it claims (#368)', () => {
  it('migrateTrip(trip, 1) renumbers to 1-based and strips stale leg fields, without the normalizer', () => {
    const migrated = migrateTrip(v1Trip(), 1)
    const days = migrated.days as Array<{ stops: Array<Record<string, unknown>> }>
    for (const d of days) {
      expect(d.stops.map(s => s.orderInDay)).toEqual(d.stops.map((_, i) => i + 1))
      for (const s of d.stops) {
        for (const k of STALE_LEG_KEYS) expect(k in s, `${s.id} carries ${k}`).toBe(false)
      }
    }
  })

  it('the normalizer is idempotent on migrated output and reports no v1 repairs', () => {
    const migrated = migrateTrip(v1Trip(), 1)
    const first = emptyReport()
    const trip = normalizeTrip(migrated, first)
    expect(trip).not.toBeNull()
    // The chain already did the v1 work, so the wall has nothing to re-fix.
    expect(first.repairs).toEqual([])
    expect(first.warnings).toEqual([])
    const second = emptyReport()
    const again = normalizeTrip(trip as unknown as Record<string, unknown>, second)
    expect(second).toEqual(emptyReport())
    expect(again).toEqual(trip)
  })

  it('the chain pattern executes for a future version (v3 smoke)', () => {
    const v2trip = { id: 't', days: [{ id: 'd1', index: 0, stops: [] }] }
    try {
      MIGRATIONS[2] = t => ({ ...t, v3Marker: true })
      const out = migrateTrip(v2trip, 2, 3)
      expect((out as { v3Marker?: boolean }).v3Marker).toBe(true)
    } finally {
      delete MIGRATIONS[2]
    }
  })

  it('a current-version trip passes through untouched', () => {
    const trip = { id: 'trip_v2', days: [{ id: 'd1', index: 0, stops: [{ id: 's1', orderInDay: 1 }] }] }
    expect(migrateTrip(trip, ITINERARY_FORMAT_VERSION)).toBe(trip)
  })
})
