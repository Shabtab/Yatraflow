// Horizon 2 deferred: on-way detour asymmetry.
// A destination ON the route is on-the-way (~0 detour — you pass it); a
// destination off the road pays a one-way spur (scorers double it to out and
// back). Google's real road detour always wins.
import { describe, it, expect } from 'vitest'
import { spurKm, asymmetricDetourKm, asymmetricDetourMinutes, detourKm } from '../src/lib/providers/hits'

// A straight lat/lng polyline running due east at lat 10 (1 km ≈ 0.00899° lng)
const EAST = Array.from({ length: 11 }, (_, i) => ({ lat: 10, lng: 10 + i * 0.009 }))
// A {lat,lng} point sitting right ON the polyline vs. one 5 km south of it
const ON_ROAD = { latitude: 10.0, longitude: 10.09 } as const
const OFF_ROAD = { latitude: 10.0 - 0.045, longitude: 10.09 } as const // ~5 km south

describe('spur distance to the route', () => {
  it('reads ~0 for a point on the road', () => {
    const s = spurKm(ON_ROAD as never, EAST)
    expect(s).not.toBeNull()
    expect(s!).toBeLessThan(0.2)
  })

  it('reads ~5 km for a point 5 km off', () => {
    const s = spurKm(OFF_ROAD as never, EAST)
    expect(s).not.toBeNull()
    expect(s!).toBeGreaterThan(4)
    expect(s!).toBeLessThan(6)
  })
})

describe('asymmetric detour', () => {
  it('charges ~0 for an on-route hit when the polyline is known', () => {
    expect(asymmetricDetourKm(ON_ROAD as never, [], EAST)).toBeLessThan(0.2)
    expect(asymmetricDetourMinutes(ON_ROAD as never, [], EAST, 40)).toBeLessThan(1)
  })

  it('charges the spur for an off-road hit (not doubled here — scorer doubles)', () => {
    expect(asymmetricDetourKm(OFF_ROAD as never, [], EAST)).toBeGreaterThan(4)
  })

  it('stays on the symmetric anchor fallback when no polyline is given', () => {
    // Without geometry, asymmetricDegenerates to the anchor measure.
    const appr = asymmetricDetourKm(OFF_ROAD as never, [{ lat: 10, lng: 10.09 }])
    expect(appr).toBeGreaterThan(2)
  })

  it('never dwarfs Google real road detour', () => {
    const h = { latitude: 10, longitude: 10.09, offRouteKm: 3 }
    expect(asymmetricDetourKm(h as never, [], EAST)).toBe(3)
  })
})