// Horizon 3.1: road personality.
// A straight corridor reads highway; a zigzag corridor reads ghat switchback.
// classifyRoadWindow must separate them from geometry alone.
import { describe, it, expect } from 'vitest'
import { classifyRoadWindow } from '../src/lib/roadPersonality'

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

  it('returns no warning on highways, warns before ghats', () => {
    expect(classifyRoadWindow(straightKm(40)).warning).toBeNull()
    const w = classifyRoadWindow(zigzagKm(40)).warning
    expect(w).not.toBeNull()
    expect(w!).toContain('switchback')
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
})
