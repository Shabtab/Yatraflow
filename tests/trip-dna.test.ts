// Horizon 3.3: trip DNA.
// The engine remembers accepted/declined suggestions per trip, builds a small
// preference vector, and reranks + explains new candidates by similarity.
import { describe, it, expect } from 'vitest'
import { buildDnaVector, dnaBoostForHit, dnaNoteForHit, type DnaEvent } from '../src/lib/tripDna'

const TRIP = 'trip-1'

function accept(category: string, n = 1): DnaEvent[] {
  return Array.from({ length: n }, () => ({ tripId: TRIP, action: 'accept' as const, category }))
}

describe('trip DNA', () => {
  it('builds affinity from accepted categories', () => {
    const v = buildDnaVector([...accept('waterfall', 3), ...accept('museum', 1)])
    expect(v.accepts).toBe(4)
    expect(v.categoryAffinity['waterfall']).toBe(3)
  })

  it('boosts hits in a favoured category and ignores others', () => {
    const v = buildDnaVector(accept('waterfall', 3))
    const boostFav = dnaBoostForHit({ category: 'waterfall' }, v)
    const boostOther = dnaBoostForHit({ category: 'museum' }, v)
    expect(boostFav).toBeGreaterThan(0)
    expect(boostOther).toBe(0)
  })

  it('gives no boost without history', () => {
    const v = buildDnaVector([])
    expect(dnaBoostForHit({ category: 'waterfall' }, v)).toBe(0)
    expect(dnaNoteForHit({ category: 'waterfall' }, v)).toBeNull()
  })

  it('notes the streak once affinity reaches two', () => {
    const v = buildDnaVector(accept('waterfall', 3))
    const note = dnaNoteForHit({ category: 'waterfall' }, v)
    expect(note).not.toBeNull()
    expect(note!).toContain('3')
  })

  it('declines dilute affinity instead of erasing it', () => {
    const events: DnaEvent[] = [
      ...accept('waterfall', 3),
      { tripId: TRIP, action: 'decline', category: 'waterfall' },
    ]
    const v = buildDnaVector(events)
    expect(v.categoryAffinity['waterfall']).toBe(2)
    expect(dnaBoostForHit({ category: 'waterfall' }, v)).toBeGreaterThan(0)
  })

  it('bends scoring ties toward favoured categories', async () => {
    const { planRideSegments, scoreHitForSegment } = await import('../src/lib/ridePlan')
    const anchors = [{ lat: 0, lng: 0 }, { lat: 2, lng: 0 }]
    const segs = planRideSegments({ totalKm: 400, driveMinutes: 360 })
    expect(segs.length).toBeGreaterThan(0)
    const seg = segs[0]
    const base = { id: 'x', name: 'X', latitude: 0.5, longitude: 0.01, kind: 'poi' as const }
    const fav = { ...base, id: 'fav', name: 'Fav', category: 'waterfall' }
    const other = { ...base, id: 'other', name: 'Other', category: 'museum' }
    const v = buildDnaVector(accept('waterfall', 3))
    const sFav = scoreHitForSegment(fav, seg, anchors, { dnaVector: v })
    const sOther = scoreHitForSegment(other, seg, anchors, { dnaVector: v })
    const sPlain = scoreHitForSegment(fav, seg, anchors, {})
    expect(sFav).not.toBeNull()
    expect(sOther).not.toBeNull()
    expect(sFav!).toBeLessThan(sOther!)
    expect(sPlain!).toBeGreaterThan(sFav!)
  })
})
