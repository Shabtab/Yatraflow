// ============ Road-true halt placement tests ============
// The halt planner places unpinned halts at "after N km" along the day's ride.
// On curvy roads the straight-line stop chain is both the wrong SHAPE (the
// chord between stops sits far off the highway the map draws) and the wrong
// SCALE (road km > straight-line km), so placement must run along the road
// polyline assembled from the routing provider's per-leg geometry.
// Pinned behaviours: polyline assembly + junction dedup, orientation of
// mirrored return-drive legs, null fallback without geometry, on-road
// placement at road-true km, and road-true km projection for hits.
import { describe, it, expect } from 'vitest'
import { dayRoadPolyline, legKey, roadScaleRatio } from '../src/lib/engine'
import type { JourneyPoint, LegEstimate } from '../src/lib/engine'
import { pointAtKm } from '../src/lib/geo'
import { kmFromStartForHit } from '../src/lib/providers/hits'

// 1° lat ≈ 111.2 km; 1° lng at these latitudes ≈ 111.3 km.
const START = { lat: 0, lng: 0 }
const END = { lat: 0.45, lng: 0.6 }
// The real road goes north 0.45° (~50 km) THEN east 0.6° (~66.8 km) — an L the
// straight chord start→end cuts far off. Geometry is [lng, lat][] (GeoJSON).
const L_ROAD: [number, number][] = [[0, 0], [0, 0.45], [0.6, 0.45]]
const ROAD_KM_NORTH = 50
const CHAIN = [START, END] as unknown as JourneyPoint[]

function correctionsWith(geo: [number, number][]): Record<string, LegEstimate> {
  return { [legKey(START, END)]: { distanceKm: 117, durationMinutes: 140, geometry: geo } }
}

describe('dayRoadPolyline', () => {
  it('assembles the road polyline from per-leg geometry', () => {
    const road = dayRoadPolyline(CHAIN, correctionsWith(L_ROAD))
    expect(road).not.toBeNull()
    expect(road!.length).toBe(3)
    expect(road![0]).toEqual(START)
    expect(road![1]).toEqual({ lat: 0.45, lng: 0 })
    expect(road![2]).toEqual(END)
  })

  it('orients mirrored return-drive geometry to the leg’s real direction', () => {
    // The corrections map stores the same geometry under the reversed key for
    // return drives — start→end must survive even when geometry runs end→start.
    const road = dayRoadPolyline(CHAIN, correctionsWith([...L_ROAD].reverse()))
    expect(road).not.toBeNull()
    expect(road![0]).toEqual(START)
    expect(road![road!.length - 1]).toEqual(END)
  })

  it('returns null when any leg lacks road geometry (estimate fallback)', () => {
    expect(dayRoadPolyline(CHAIN, undefined)).toBeNull()
    expect(dayRoadPolyline(CHAIN, {})).toBeNull()
    const noGeo: Record<string, LegEstimate> = { [legKey(START, END)]: { distanceKm: 117, durationMinutes: 140 } }
    expect(dayRoadPolyline(CHAIN, noGeo)).toBeNull()
    expect(dayRoadPolyline([START] as unknown as JourneyPoint[], correctionsWith(L_ROAD))).toBeNull()
  })
})

describe('halt placement on the road', () => {
  const road = dayRoadPolyline(CHAIN, correctionsWith(L_ROAD))!
  const chord = [START, END]

  it('places a mid-ride halt ON the road, not on the chord', () => {
    const onRoad = pointAtKm(road, 58)
    const onChord = pointAtKm(chord, 58)
    // 58 road-km from the start = ~8 km into the eastward segment near the elbow.
    expect(onRoad!.lat).toBeGreaterThan(0.43)
    // The chord interpolation at "58 km" (70% of 83.5 chord-km) drifts far
    // south of the eastward segment — visibly off the road the map draws.
    expect(onChord!.lat).toBeLessThan(0.35)
  })

  it('interprets the halt km on the ROAD scale, matching the displayed distance', () => {
    // The travel panel displays road km (~117 here). Half of that (58 km) must
    // land just past the elbow (~50 road-km in), NOT at 58 chord-km.
    const halfRoadKm = pointAtKm(road, 58)!
    expect(halfRoadKm.lng).toBeGreaterThan(0) // past the northward leg already
    const chordClamped = pointAtKm(chord, 200)! // chord is shorter — clamps to the end
    expect(chordClamped).toEqual(END)
    // …and the road polyline reaches the true end at its full road km.
    expect(pointAtKm(road, 130)).toEqual(END)
  })
})

describe('kmFromStartForHit with the road polyline', () => {
  it('projects a stop onto the road for road-true km', () => {
    const road = dayRoadPolyline(CHAIN, correctionsWith(L_ROAD))!
    // A POI sitting at the elbow is ~50 road-km in — the anchor fallback would
    // call it "0 km" (nearest chain point is the start) and slot it wrongly.
    const km = kmFromStartForHit({ latitude: 0.45, longitude: 0 }, CHAIN.map(p => ({ lat: p.lat, lng: p.lng })), { routePolyline: road })
    expect(km).not.toBeNull()
    expect(Math.abs(km! - ROAD_KM_NORTH)).toBeLessThan(1)
  })
})

describe('roadScaleRatio', () => {
  it('returns the road-vs-chord ratio over the same point pairs', () => {
    // Road 117 km (corrected leg) vs ~83.5 km chord start→end ≈ 1.40.
    const r = roadScaleRatio(CHAIN, correctionsWith(L_ROAD))
    expect(r).toBeGreaterThan(1.3)
    expect(r).toBeLessThan(1.5)
  })

  it('is 1 without corrections, without a covering leg, or for a degenerate span', () => {
    expect(roadScaleRatio(CHAIN, undefined)).toBe(1)
    expect(roadScaleRatio(CHAIN, {})).toBe(1) // legs fall back to haversine ⇒ ratio 1
    expect(roadScaleRatio([START] as unknown as JourneyPoint[], correctionsWith(L_ROAD))).toBe(1)
  })
})
