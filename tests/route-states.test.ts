import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PublishedItinerary, Trip } from '../src/data/types'
import { INDIA_STATE_COUNT, INDIA_STATES } from '../src/data/indiaStates'
import { INDIA_STATE_PATCHES, INDIA_STATE_SHAPES } from '../src/data/indiaStateShapes'
import { coveredStates, publicationFacts } from '../src/lib/creatorFacts'
import { publishColumnPatch } from '../src/lib/publishColumns'
import { locateState, NEAREST_STATE_KM, routePointsForTrip, statesForTrip } from '../src/lib/routeStates'

// G3b step 1: the fixed point list. Coordinates are approximate town centres.
// Pangong Tso uses a point on the Indian (western) shore, not the lake centre.
// Mahe and Yanam sit in the hand-made enclave patches, not in the state rings.
const FIXED_POINTS: { point: string; expected: string; lat: number; lng: number }[] = [
  { point: 'Leh', expected: 'LA', lat: 34.1526, lng: 77.5771 },
  { point: 'Pangong Tso', expected: 'LA', lat: 33.734, lng: 78.26 },
  { point: 'Turtuk', expected: 'LA', lat: 34.799, lng: 76.823 },
  { point: 'Kargil', expected: 'LA', lat: 34.5539, lng: 76.1349 },
  { point: 'Tawang', expected: 'AR', lat: 27.586, lng: 91.859 },
  { point: 'Chandigarh', expected: 'CH', lat: 30.7333, lng: 76.7794 },
  { point: 'Daman', expected: 'DH', lat: 20.3974, lng: 72.8328 },
  { point: 'Diu', expected: 'DH', lat: 20.7144, lng: 70.9874 },
  { point: 'Silvassa', expected: 'DH', lat: 20.2766, lng: 73.0089 },
  { point: 'Mahe', expected: 'PY', lat: 11.7, lng: 75.5333 },
  { point: 'Karaikal', expected: 'PY', lat: 10.9254, lng: 79.838 },
  { point: 'Yanam', expected: 'PY', lat: 16.7333, lng: 82.2167 },
  { point: 'Port Blair', expected: 'AN', lat: 11.6234, lng: 92.7265 },
  { point: 'Kavaratti', expected: 'LD', lat: 10.5626, lng: 72.6369 },
  { point: 'Panaji', expected: 'GA', lat: 15.4909, lng: 73.8278 },
  { point: 'Calangute', expected: 'GA', lat: 15.544, lng: 73.7553 },
  { point: 'Colva', expected: 'GA', lat: 15.2796, lng: 73.9176 },
  { point: 'Palolem', expected: 'GA', lat: 15.01, lng: 74.023 },
  { point: 'Bengaluru', expected: 'KA', lat: 12.9716, lng: 77.5946 },
  { point: 'Coorg/Madikeri', expected: 'KA', lat: 12.4244, lng: 75.7382 },
  { point: 'Delhi', expected: 'DL', lat: 28.6139, lng: 77.209 },
  { point: 'Shimla', expected: 'HP', lat: 31.1048, lng: 77.1734 },
  { point: 'Manali', expected: 'HP', lat: 32.2432, lng: 77.1892 },
  // Negative checks: each of these must stay in its own state, not a neighbour.
  { point: 'Kozhikode', expected: 'KL', lat: 11.2588, lng: 75.7804 },
  { point: 'Kakinada', expected: 'AP', lat: 16.9891, lng: 82.2475 },
  { point: 'Vapi', expected: 'GJ', lat: 20.3714, lng: 72.9049 },
  { point: 'Thanjavur', expected: 'TN', lat: 10.787, lng: 79.1378 },
]

function stop(lat: number, lng: number) {
  return { lat, lng }
}

describe('state lookup on the fixed point list', () => {
  it('places every fixed point in its expected state', () => {
    const rows = FIXED_POINTS.map(row => {
      const hit = locateState(row.lng, row.lat, INDIA_STATE_SHAPES, INDIA_STATE_PATCHES)
      return { ...row, got: hit?.code ?? '-', via: hit?.via ?? 'none', km: hit?.km ?? 0 }
    })
    const lines = rows.map(row => {
      const suffix = row.via === 'nearest' ? ` ${row.km.toFixed(1)} km` : ''
      return `${row.point.padEnd(15)} ${row.expected.padEnd(3)} ${row.got.padEnd(3)} ${row.via}${suffix}`
    })
    console.log(['point           exp got via', ...lines].join('\n'))
    expect(rows.filter(row => row.got !== row.expected).map(row => row.point)).toEqual([])
  })

  it('uses a nearest-state fallback of 10 km and no further', () => {
    expect(NEAREST_STATE_KM).toBe(10)
    expect(locateState(68.5, 18, INDIA_STATE_SHAPES, INDIA_STATE_PATCHES)).toBeUndefined()
  })

  it('checks the two enclave patches before the state rings', () => {
    expect(INDIA_STATE_PATCHES.map(shape => shape.code)).toEqual(['PY'])
    expect(locateState(75.5333, 11.7, INDIA_STATE_SHAPES, INDIA_STATE_PATCHES)?.via).toBe('inside')
    expect(locateState(82.2167, 16.7333, INDIA_STATE_SHAPES, INDIA_STATE_PATCHES)?.code).toBe('PY')
  })
})

describe('statesForTrip', () => {
  const trip = {
    startLocationCoords: { lat: 28.6139, lng: 77.209 },
    destinationCoords: [{ lat: 12.9716, lng: 77.5946 }, { lat: 15.4909, lng: 73.8278 }],
    days: [
      { stops: [stop(12.9716, 77.5946), stop(32.2432, 77.1892)] },
      { stops: [stop(15.4909, 73.8278), stop(12.4244, 75.7382)] },
    ],
  } as unknown as Trip

  it('returns each state once, sorted, from the start, the end and every stop', async () => {
    expect(await statesForTrip(trip)).toEqual(['DL', 'GA', 'HP', 'KA'])
  })

  it('returns no states for a trip with no coordinates', async () => {
    expect(await statesForTrip({ days: [] } as unknown as Trip)).toEqual([])
  })

  it('skips missing and null coordinates', () => {
    const partial = {
      startLocationCoords: undefined,
      destinationCoords: [null],
      days: [{ stops: [stop(Number.NaN, 77)] }],
    } as unknown as Trip
    expect(routePointsForTrip(partial)).toEqual([])
  })
})

describe('route states on a publication', () => {
  it('reads a missing or null column as unknown, and a list as codes', () => {
    expect(publicationFacts({}).stateCodes).toBeUndefined()
    expect(publicationFacts({ state_codes: null }).stateCodes).toBeUndefined()
    expect(publicationFacts({ state_codes: ['GA', 'KA'] }).stateCodes).toEqual(['GA', 'KA'])
    expect(publicationFacts({ state_codes: [] }).stateCodes).toEqual([])
  })

  it('rejects a code outside the 36, a null element, a non-list and more than 36 items', () => {
    expect(() => publicationFacts({ state_codes: ['XX'] })).toThrow()
    expect(() => publicationFacts({ state_codes: ['GA', null] })).toThrow()
    expect(() => publicationFacts({ state_codes: 'GA' })).toThrow()
    expect(() => publicationFacts({ state_codes: Array.from({ length: 37 }, () => 'GA') })).toThrow()
  })

  it('counts the live routes that cover each state, known routes only', () => {
    const pub = (id: string, stateCodes: string[] | undefined, unpublishedAt?: number) =>
      ({ id, stateCodes, unpublishedAt }) as unknown as PublishedItinerary
    const counts = coveredStates([pub('a', ['GA', 'KA']), pub('b', ['GA']), pub('c', undefined), pub('d', ['HP'], 1)])
    expect([...(counts ?? new Map<string, number>()).entries()]).toEqual([['GA', 2], ['KA', 1]])
    expect(coveredStates([pub('c', undefined)])).toBeUndefined()
    expect(coveredStates([pub('e', [])])).toBeUndefined()
  })
})

describe('optional publish columns', () => {
  const values = { plannedKm: 1200, bestMonths: 3, reviewedScope: 'Roads checked', stateCodes: ['GA', 'KA'] }

  it('sends no optional column when the database lacks them all', () => {
    expect(publishColumnPatch(new Set<string>(), values)).toEqual({})
  })

  it('sends only the columns the probe found', () => {
    expect(publishColumnPatch(new Set(['state_codes']), values)).toEqual({ state_codes: ['GA', 'KA'] })
    expect(publishColumnPatch(new Set(['planned_km']), values)).toEqual({ planned_km: 1200 })
  })

  it('sends all four when the migration has run', () => {
    expect(publishColumnPatch(new Set(['planned_km', 'best_months', 'reviewed_scope', 'state_codes']), values))
      .toEqual({ planned_km: 1200, best_months: 3, reviewed_scope: 'Roads checked', state_codes: ['GA', 'KA'] })
  })

  it('clears a code list with null when a route has no codes', () => {
    expect(publishColumnPatch(new Set(['state_codes']), {})).toEqual({ state_codes: null })
  })
})

describe('the G3b migration draft', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261119_creator_route_states.sql', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')

  it('adds the checked column and revokes the helper from anon', () => {
    expect(sql).toContain('add column if not exists state_codes text[]')
    expect(sql).toContain('check (public.valid_route_state_codes(state_codes) is true)')
    expect(sql).toContain('revoke all on function public.valid_route_state_codes(text[]) from public, anon')
    expect(sql).toContain('drop function if exists public.valid_route_state_codes(text[])')
  })

  it('lists exactly the 36 codes and caps the array at 36', () => {
    const listed = (sql.slice(sql.indexOf('array['), sql.indexOf(']::text[]')).match(/'[A-Z]{2}'/g) ?? [])
      .map(code => code.slice(1, -1))
    expect(INDIA_STATE_COUNT).toBe(36)
    expect(listed.length).toBe(36)
    expect([...listed].sort()).toEqual(INDIA_STATES.map(state => state.code).sort())
    expect(sql).toContain('cardinality(p_codes) <= 36')
  })

  it('backfills nothing and leaves the read policy alone', () => {
    expect(sql).not.toMatch(/update\s+public\.published_itineraries/i)
    expect(sql).not.toMatch(/create\s+policy|grant\s+select/i)
    expect(sql).toContain('needs no grant and no view change')
  })
})
