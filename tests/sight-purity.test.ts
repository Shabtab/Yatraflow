// Sight purity (2026-09-07): See & do must show only real sights. Two leaks
// found when Google data started flowing:
//   1. Google purpose-driven queries stamped hits with the PURPOSE string
//      ('meal', 'fuel', 'overnight') as their category — PURPOSE_FIT has no
//      such keys, so fit=0 and the purpose-fit gate rejected dhabas/pumps/
//      hotels from their OWN segments, dumping them into the leftover pass.
//   2. leftoverAsSight wrapped every unassigned hit — restaurants, dhabas,
//      hotels — in a synthetic 'Sightseeing' segment.
import { describe, it, expect } from 'vitest'
import { leftoverAsSight, type SegmentHit } from '../src/lib/ridePlan'
import { searchNearbyPoisMulti } from '../src/lib/geocode'
import type { PlaceHit } from '../src/lib/providers/hits'
import { afterEach, beforeEach, vi } from 'vitest'
import { quotaResetForTests } from '../src/lib/providers/quota'

const anchors = [{ lat: 0, lng: 0 }, { lat: 5, lng: 0 }]

function hitAt(id: string, category: string, alongKm = 100): PlaceHit {
  return { id, name: id, latitude: alongKm / 111.32, longitude: 0, kind: 'poi', category, alongRouteKm: alongKm }
}

function emptyAssigned(): SegmentHit[] {
  return []
}

describe('leftoverAsSight category gate', () => {
  it('drops restaurants, dhabas, hotels, pumps and cafes — need-based places are not sights', () => {
    const cands = [
      hitAt('Highway Dhaba', 'food'),
      hitAt('Saravana Bhavan', 'food'),
      hitAt('Roadside Cafe', 'cafe'),
      hitAt('Hilltop Hotel', 'hotel'),
      hitAt('Indian Oil Pump', 'transport-hub'),
      hitAt('Rest Area', 'rest'),
    ]
    expect(leftoverAsSight(cands, emptyAssigned(), anchors, {})).toEqual([])
  })

  it('keeps real sight categories in See & do', () => {
    const cands = [
      hitAt('Echo Point', 'sightseeing'),
      hitAt('Athirappilly Falls', 'nature'),
      hitAt('Guruvayur Temple', 'temple'),
      hitAt('Marine Museum', 'museum'),
      hitAt('Kovalam Beach', 'beach'),
    ]
    const out = leftoverAsSight(cands, emptyAssigned(), anchors, {})
    expect(out.map(r => r.hit!.id).sort()).toEqual([
      'Athirappilly Falls', 'Echo Point', 'Guruvayur Temple', 'Kovalam Beach', 'Marine Museum',
    ].sort())
  })

  it('keeps the sight label for kept hits and never labels food as a sight', () => {
    const out = leftoverAsSight([hitAt('Cave', 'sightseeing'), hitAt('Dhaba', 'food')], emptyAssigned(), anchors, {})
    expect(out).toHaveLength(1)
    expect(out[0].segment.purpose).toBe('sight')
    expect(out[0].hit!.category).toBe('sightseeing')
  })
})

describe('Google purpose queries stamp real categories (not purpose strings)', () => {
  beforeEach(() => quotaResetForTests())
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); quotaResetForTests() })

  function googleFetch(places: unknown[]) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('places:searchText')) {
        return new Response(JSON.stringify({ places, routingSummaries: [] }), { status: 200 })
      }
      throw new Error('unexpected fetch: ' + url)
    })
  }

  it('meal-query hits carry category food — not "meal"', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('fetch', googleFetch([
      { id: 'D1', displayName: { text: 'Aroma Dhaba' }, location: { latitude: 0.5, longitude: 0 }, primaryType: 'restaurant', types: ['restaurant', 'food', 'point_of_interest'] },
    ]))
    const hits = await searchNearbyPoisMulti([{ lat: 0, lng: 0 }], 20000, 10, {
      routeCoords: [[0, 0], [0, 5]] as [number, number][],
      purposes: ['meal'],
    })
    const dhaba = hits.find(h => h.name === 'Aroma Dhaba')
    expect(dhaba).toBeDefined()
    expect(dhaba!.category).toBe('food') // RED today: it is 'meal'
  })

  it('fuel-query hits carry category transport-hub, hotel queries hotel', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('fetch', googleFetch([
      { id: 'F1', displayName: { text: 'Bharat Petroleum' }, location: { latitude: 0.5, longitude: 0 }, primaryType: 'gas_station', types: ['gas_station', 'point_of_interest'] },
    ]))
    const fuelHits = await searchNearbyPoisMulti([{ lat: 0, lng: 0 }], 20000, 10, {
      routeCoords: [[0, 0], [0, 5]] as [number, number][],
      purposes: ['fuel'],
      includeFuel: true, // rankAndCap drops transport-hub hits without this
    })
    expect(fuelHits.find(h => h.name === 'Bharat Petroleum')!.category).toBe('transport-hub')

    vi.stubGlobal('fetch', googleFetch([
      { id: 'H1', displayName: { text: 'Munnar Lodge' }, location: { latitude: 0.5, longitude: 0 }, primaryType: 'lodging', types: ['lodging', 'point_of_interest'] },
    ]))
    const hotelHits = await searchNearbyPoisMulti([{ lat: 0, lng: 0 }], 20000, 10, {
      routeCoords: [[0, 0], [0, 5]] as [number, number][],
      purposes: ['overnight'],
    })
    expect(hotelHits.find(h => h.name === 'Munnar Lodge')!.category).toBe('hotel')
  })
})
