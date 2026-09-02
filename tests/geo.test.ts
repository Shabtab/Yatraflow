// ============ pointAtKm — pin a halt at a chosen km along a route ============
// Pure geometry, node env. Guards the interpolation the halt planner uses to
// turn "halt after 100 km" into real coordinates on the day's route chain.
import { describe, it, expect } from 'vitest'
import { pointAtKm } from '../src/lib/geo'

/** Metres of arc per degree of latitude on a 6371 km sphere — haversine's own constant. */
const KM_PER_DEG = (6371 * Math.PI) / 180

/** A straight northward line where `stepKm` km separates each point. */
function line(km: number, stepKm = 50): { lat: number; lng: number }[] {
  const n = Math.round(km / stepKm)
  return Array.from({ length: n + 1 }, (_, i) => ({ lat: (i * stepKm) / KM_PER_DEG, lng: 0 }))
}

describe('pointAtKm', () => {
  it('returns the interpolated coordinate at the requested km', () => {
    const p = pointAtKm(line(300, 50), 100)
    expect(p).not.toBeNull()
    // 100 km along a pure northward line ≈ 100/KM_PER_DEG degrees of latitude
    expect(p!.lat).toBeCloseTo(100 / KM_PER_DEG, 4)
    expect(p!.lng).toBeCloseTo(0, 6)
  })

  it('lands exactly on a supplied point rather than between points', () => {
    const pts = line(200, 50)
    const p = pointAtKm(pts, 50) // the second point of the chain
    expect(p!.lat).toBeCloseTo(pts[1].lat, 4)
  })

  it('clamps a km beyond the route to the last point', () => {
    const pts = line(200, 50)
    const p = pointAtKm(pts, 5000)
    expect(p!.lat).toBeCloseTo(pts[pts.length - 1].lat, 6)
  })

  it('clamps a negative km to the first point', () => {
    const pts = line(200, 50)
    const p = pointAtKm(pts, -10)
    expect(p!.lat).toBeCloseTo(pts[0].lat, 6)
  })

  it('ignores non-finite points and returns null for unusable input', () => {
    expect(pointAtKm([], 100)).toBeNull()
    expect(pointAtKm([{ lat: 1, lng: 1 }], Number.NaN)).toBeNull()
    // the only finite point survives — the function degrades to it, never NaN
    expect(pointAtKm([{ lat: Number.NaN, lng: 1 }, { lat: 2, lng: 1 }], 5)).toEqual({ lat: 2, lng: 1 })
  })

  it('survives a single-point chain (stay day)', () => {
    const p = pointAtKm([{ lat: 12.9, lng: 77.5 }], 100)
    expect(p).toEqual({ lat: 12.9, lng: 77.5 })
  })
})