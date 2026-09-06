// Horizon 1.3+1.4: dedupe.
// - Geo-fuzzy: "Echo Point" vs "Echo Point Viewpoint" 200 m apart collapse to 1.
// - Itinerary: candidates near an already-planned stop are dropped.
import { describe, it, expect } from 'vitest'
import { samePlace, dedupeCandidates, filterPlannedNearby } from '../src/lib/providers/hits'
import type { PlaceHit } from '../src/lib/providers/hits'

function hit(name: string, lat: number, lng: number): PlaceHit {
  return { id: name, name, latitude: lat, longitude: lng, kind: 'poi' }
}

describe('suggestion dedupe', () => {
  it('collapses near-duplicate names within 500 m', () => {
    const a = hit('Echo Point', 10.0, 76.0)
    const b = hit('Echo Point Viewpoint', 10.001, 76.001)
    expect(samePlace(a, b)).toBe(true)
    expect(dedupeCandidates([a, b])).toHaveLength(1)
  })

  it('keeps same names far apart', () => {
    const a = hit('Lake View', 10.0, 76.0)
    const b = hit('Lake View', 11.0, 77.0)
    expect(samePlace(a, b)).toBe(false)
    expect(dedupeCandidates([a, b])).toHaveLength(2)
  })

  it('keeps different names close together', () => {
    const a = hit('Fort Gate', 10.0, 76.0)
    const b = hit('Spice Market', 10.0005, 76.0005)
    expect(samePlace(a, b)).toBe(false)
  })

  it('drops candidates near planned stops', () => {
    const planned = [hit('Old Palace', 10.0, 76.0)]
    const near = hit('Old Palace Cafe', 10.005, 76.005)
    const far = hit('Hill Top', 11.0, 77.0)
    const out = filterPlannedNearby([near, far], planned.map(p => ({ lat: p.latitude, lng: p.longitude, name: p.name })))
    expect(out.some(h => h.id === 'Hill Top')).toBe(true)
    expect(out.some(h => h.id === 'Old Palace Cafe')).toBe(false)
  })
})
