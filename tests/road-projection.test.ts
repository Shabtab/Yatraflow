// Horizon 1.1: road-projected positions.
// A U-shaped road has endpoints close as the crow flies but far by road.
// kmFromStartForHit must report road km when given the polyline.
import { describe, it, expect } from 'vitest'
import { kmFromStartForHit, projectOntoPolyline } from '../src/lib/providers/hits'

// U-shape: start (0,0) -> north 15 km -> east 5 km -> south 15 km.
// End is ~5 km straight from start, ~35 km by road.
function uPolyline(): { lat: number; lng: number }[] {
  const pts: { lat: number; lng: number }[] = []
  const kmToDeg = 1 / 111.32
  for (let km = 0; km <= 15; km += 1) pts.push({ lat: km * kmToDeg, lng: 0 })
  for (let km = 1; km <= 5; km += 1) pts.push({ lat: 15 * kmToDeg, lng: km * kmToDeg })
  for (let km = 14; km >= 0; km -= 1) pts.push({ lat: km * kmToDeg, lng: 5 * kmToDeg })
  return pts
}

describe('road-projected positions', () => {
  it('reports road km on a switchback, not straight-line km', () => {
    const poly = uPolyline()
    const endHit = { latitude: 0, longitude: 5 / 111.32 }
    const anchors = [poly[0], poly[poly.length - 1]]
    const straight = kmFromStartForHit(endHit, anchors)
    const road = kmFromStartForHit(endHit, anchors, { routePolyline: poly })
    expect(straight).not.toBeNull()
    expect(road).not.toBeNull()
    // straight-line says ~5 km, road truth is ~35 km
    expect(straight!).toBeLessThan(10)
    expect(road!).toBeGreaterThan(25)
  })

  it('projectOntoPolyline snaps to the nearest segment with cumulative km', () => {
    const poly = uPolyline()
    const r = projectOntoPolyline({ latitude: 0, longitude: 5 / 111.32 }, poly)
    expect(r).not.toBeNull()
    expect(r!.km).toBeGreaterThan(25)
  })

  it('falls back to anchors when no polyline is given', () => {
    const anchors = [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }]
    const v = kmFromStartForHit({ latitude: 1, longitude: 0 }, anchors)
    expect(v).not.toBeNull()
  })
})
