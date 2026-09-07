// Horizon 3.1: road personality.
// A straight corridor reads highway; a zigzag corridor reads ghat switchback.
// classifyRoadWindow must separate them from geometry alone.
import { describe, it, expect } from 'vitest'
import { classifyRoadWindow, normalizeLngDelta } from '../src/lib/roadPersonality'

function straightKm(n: number): { lat: number; lng: number }[] {
  const pts: { lat: number; lng: number }[] = []
  const kmToDeg = 1 / 111.32
  for (let km = 0; km <= n; km += 1) pts.push({ lat: km * kmToDeg, lng: 0 })
  return pts
}

function zigzagKm(n: number): { lat: number; lng: number }[] {
  const pts: { lat: number; lng: number }[] = []
  const kmToDeg = 1 / 111.32
  for (let km = 0; km <= n; km += 1) {
    pts.push({ lat: km * kmToDeg, lng: (km % 2 === 0 ? 0 : 2) * kmToDeg })
  }
  return pts
}

describe('road personality', () => {
  it('reads a straight corridor as highway', () => {
    expect(classifyRoadWindow(straightKm(40)).kind).toBe('highway')
  })

  it('reads a zigzag corridor as ghat switchback', () => {
    expect(classifyRoadWindow(zigzagKm(40)).kind).toBe('ghat')
  })

  it('lets a ghat window win over a slow day-average (no false city crawl)', async () => {
    const { planRideSegments } = await import('../src/lib/ridePlan')
    // A slow day (400 km in 20 h) on twisty geometry: the urgent, geometry-true
    // advice is "switchbacks ahead", not the day-level "city crawl" verdict.
    const segs = planRideSegments({ totalKm: 400, driveMinutes: 1200, roadGeometry: zigzagKm(40) })
    expect(segs.length).toBeGreaterThan(0)
    expect(segs.every(s => s.roadPersonality === 'ghat')).toBe(true)
    expect(segs[0].roadWarning).toContain('switchback')
  })

  it('returns no warning on highways, warns before ghats', () => {
    expect(classifyRoadWindow(straightKm(40)).warning).toBeNull()
    const w = classifyRoadWindow(zigzagKm(40)).warning
    expect(w).not.toBeNull()
    expect(w!).toContain('switchback')
  })

  it('keeps a straight road straight across the antimeridian', () => {
    // Guard, not a bug fix: the bearing formula is trig-periodic, so a
    // 179.8°E → 179.8°W step already reads as 0.4° rather than 359.6°.
    // normalizeLngDelta states that assumption explicitly; if anyone swaps in
    // a non-trig bearing, this is where a false "ghat" verdict would surface.
    const kmToDeg = 1 / 111.32
    const pts: { lat: number; lng: number }[] = []
    for (let km = 0; km <= 40; km += 1) {
      const lng = 179.8 + km * kmToDeg
      pts.push({ lat: 0, lng: lng > 180 ? lng - 360 : lng })
    }
    const r = classifyRoadWindow(pts)
    expect(r.twistPerKm).toBeLessThan(0.01)
    expect(r.kind).toBe('highway')
  })

  it('normalizes longitude deltas to the short way round', () => {
    expect(normalizeLngDelta(358)).toBeCloseTo(-2, 10)
    expect(normalizeLngDelta(-358)).toBeCloseTo(2, 10)
    expect(normalizeLngDelta(0.4)).toBeCloseTo(0.4, 10)
  })
})

describe('road personality in segment planning', () => {
  it('tags segments with ghat warnings on twisty geometry', async () => {
    const { planRideSegments } = await import('../src/lib/ridePlan')
    const segs = planRideSegments({ totalKm: 400, driveMinutes: 360, roadGeometry: zigzagKm(40) })
    expect(segs.length).toBeGreaterThan(0)
    const warned = segs.filter(s => s.roadPersonality === 'ghat')
    expect(warned.length).toBeGreaterThan(0)
    expect(warned[0].roadWarning).toContain('switchback')
  })

  it('leaves segments untagged without geometry', async () => {
    const { planRideSegments } = await import('../src/lib/ridePlan')
    const segs = planRideSegments({ totalKm: 400, driveMinutes: 360 })
    expect(segs.length).toBeGreaterThan(0)
    expect(segs.every(s => s.roadPersonality === undefined)).toBe(true)
  })

  it('tags crawl-speed windows as city', async () => {
    const { planRideSegments } = await import('../src/lib/ridePlan')
    // 400 km in 20 h = 20 km/h crawl → city, not highway
    const segs = planRideSegments({ totalKm: 400, driveMinutes: 1200, roadGeometry: straightKm(40) })
    expect(segs.length).toBeGreaterThan(0)
    expect(segs[0].roadPersonality).toBe('city')
  })

  it('keeps highway-speed windows as highway', async () => {
    const { planRideSegments } = await import('../src/lib/ridePlan')
    // 400 km in 5 h = 80 km/h → highway
    const segs = planRideSegments({ totalKm: 400, driveMinutes: 300, roadGeometry: straightKm(40) })
    expect(segs.length).toBeGreaterThan(0)
    expect(segs[0].roadPersonality).toBe('highway')
  })
})
