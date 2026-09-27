// Horizon 3.3: trip DNA.
// The engine remembers accepted/declined suggestions per trip, builds a small
// preference vector, and reranks + explains new candidates by similarity.
import { describe, it, expect } from 'vitest'
import {
  buildDnaVector, buildDnaVectorAcrossTrips, dnaBoostForHit, dnaNoteForHit, slotPatternHint,
  normalizeDnaLog, mergeDnaLogs, loadDnaLog, attachDnaAccount, detachDnaAccount,
  type DnaEvent,
} from '../src/lib/tripDna'

const TRIP = 'trip-1'
const TRIP2 = 'trip-2'

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

  it('learns stop-length preference from accepted visit minutes', () => {
    const events: DnaEvent[] = [
      { tripId: TRIP, action: 'accept', category: 'waterfall', visitMin: 60 },
      { tripId: TRIP, action: 'accept', category: 'museum', visitMin: 120 },
    ]
    const v = buildDnaVector(events)
    expect(v.avgVisitMin).toBeCloseTo(90, 3)
    expect(v.avgDetourMin).toBeNull() // no detour signal recorded yet
  })

  it('learns across trips (no tripId scope) so a past hire nudges later ones', () => {
    const events: DnaEvent[] = [
      { tripId: TRIP, action: 'accept', category: 'waterfall', visitMin: 60 },
      { tripId: TRIP2, action: 'accept', category: 'waterfall' },
      { tripId: TRIP2, action: 'accept', category: 'beach' },
    ]
    const v = buildDnaVectorAcrossTrips(events)
    // both trips' waterfall accepts count toward the cross-trip affinity
    expect(v.categoryAffinity['waterfall']).toBe(2)
    expect(dnaBoostForHit({ category: 'waterfall' }, v)).toBeGreaterThan(0)
  })

  it('keeps a per-trip vector isolated from a different trip', () => {
    const events: DnaEvent[] = [
      { tripId: TRIP, action: 'accept', category: 'waterfall' },
      { tripId: TRIP2, action: 'accept', category: 'waterfall', visitMin: 90 },
    ]
    const v = buildDnaVector(events, TRIP)
    expect(v.categoryAffinity['waterfall']).toBe(1) // only trip-1's
    expect(v.avgVisitMin).toBeNull() // the visitMin was on trip-2
  })
})

describe('slot pattern hints (plan P7.2)', () => {
  const ev = (action: 'accept' | 'decline', category: string, detourMin?: number, haltKind?: string): DnaEvent =>
    ({ tripId: 't1', action, category, detourMin, ...(haltKind ? { haltKind } : {}) })
  it('says nothing until the evidence is real', () => {
    expect(slotPatternHint([ev('accept', 'food', 5, 'meal')], 'meal')).toBeNull()
    expect(slotPatternHint([ev('accept', 'food', 5, 'meal'), ev('accept', 'food', 6, 'meal')], 'meal')).toBeNull()
  })
  it('speaks once the crew has taken the kind three times', () => {
    const log = [ev('accept', 'food', 8, 'meal'), ev('accept', 'food', 10, 'meal'), ev('accept', 'cafe', 6, 'meal'), ev('decline', 'food', 40, 'meal')]
    expect(slotPatternHint(log, 'meal')).toBe('you usually accept about +8 min for these')
  })
  it('reads a no-detour habit', () => {
    const log = [ev('accept', 'transport-hub', 0, 'fuel'), ev('accept', 'transport-hub', 1, 'fuel'), ev('accept', 'transport-hub', 0, 'fuel')]
    expect(slotPatternHint(log, 'fuel')).toBe('you usually take these without a detour')
  })
  it('food accepts do not speak for the fuel part', () => {
    const log = [ev('accept', 'food', 5, 'meal'), ev('accept', 'food', 5, 'meal'), ev('accept', 'food', 5, 'meal')]
    expect(slotPatternHint(log, 'fuel')).toBeNull()
  })
  // The defect this replaced: a town accepted as a NIGHT HALT and a town
  // accepted as LUNCH both log `category: 'rest'`, so a category-only filter
  // incremented every kind's hint from the one accept.
  it('one accept speaks only for its OWN part, whatever the category', () => {
    const log = [ev('accept', 'rest', 3, 'overnight'), ev('accept', 'rest', 4, 'overnight'), ev('accept', 'rest', 5, 'overnight')]
    expect(slotPatternHint(log, 'overnight')).not.toBeNull()
    expect(slotPatternHint(log, 'meal')).toBeNull()
    expect(slotPatternHint(log, 'fuel')).toBeNull()
    expect(slotPatternHint(log, 'stretch')).toBeNull()
  })
  it('a recovery break counts as a stretch, since that is the slot it fills', () => {
    const log = [ev('accept', 'rest', 2, 'rest'), ev('accept', 'rest', 2, 'rest'), ev('accept', 'rest', 2, 'rest')]
    expect(slotPatternHint(log, 'stretch')).toBe('you usually take these without a detour')
  })
  // Events written before `haltKind` existed fall back to the engine's own
  // category list (derived from PURPOSE_FIT) rather than the hand-written one,
  // which had listed `cafe` under meal despite a fit of 1 against a gate of 2.
  it('legacy events still read through the engine category list', () => {
    const legacy = [ev('accept', 'food', 5), ev('accept', 'food', 5), ev('accept', 'rest', 5)]
    expect(slotPatternHint(legacy, 'meal')).toBe('you usually accept about +5 min for these')
    // #344 aligned the pool gate with the scorer's floor (MIN_PURPOSE_FIT),
    // so a cafe (meal fit 1) is now OFFERABLE as a meal and the hint speaks
    // for it — the old null here was the gate-2 disagreement this wave fixed.
    // A category the engine genuinely cannot offer for the kind stays silent:
    // a museum has no meal fit at all.
    const museumOnly = [ev('accept', 'museum', 5), ev('accept', 'museum', 5), ev('accept', 'museum', 5)]
    expect(slotPatternHint(museumOnly, 'meal')).toBeNull()
  })
})

describe('DNA log - merge + account sync (I-16)', () => {
  it('normalizeDnaLog keeps well-formed events and ignores the rest', () => {
    const ok = { tripId: TRIP, action: 'accept' as const, category: 'waterfall' }
    expect(normalizeDnaLog(null)).toEqual([])
    expect(normalizeDnaLog({ nope: 1 })).toEqual([])
    expect(normalizeDnaLog([ok, { tripId: TRIP, action: 'wat' }, { action: 'accept' }, null, 'x'])).toEqual([ok])
  })

  it('merges the account log ahead of the device log', () => {
    const account: DnaEvent[] = [{ tripId: TRIP, action: 'accept', category: 'museum' }]
    const device: DnaEvent[] = [{ tripId: TRIP2, action: 'accept', category: 'waterfall' }]
    expect(mergeDnaLogs(device, account)).toEqual([...account, ...device])
  })

  it('collapses an event both sides know, so a sync cannot double a count', () => {
    const both: DnaEvent = { tripId: TRIP, action: 'accept', category: 'waterfall', detourMin: 20 }
    const merged = mergeDnaLogs([both], [{ ...both }])
    expect(merged).toHaveLength(1)
    expect(buildDnaVector(merged).categoryAffinity['waterfall']).toBe(1)
  })

  it('keeps the newest events when the union passes the cap', () => {
    const many = Array.from({ length: 6 }, (_, i): DnaEvent => ({ tripId: `t${i}`, action: 'accept' }))
    expect(mergeDnaLogs(many.slice(3), many.slice(0, 3), 4).map(e => e.tripId)).toEqual(['t2', 't3', 't4', 't5'])
  })

  it('is device-only with no account attached', () => {
    detachDnaAccount()
    // Node has no localStorage, so the device copy reads empty — the point is
    // that no account state leaks in behind it.
    expect(loadDnaLog()).toEqual([])
  })

  it('degrades quietly when user_dna has not been migrated yet', async () => {
    detachDnaAccount()
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: 'PGRST205', message: "Could not find the table 'public.user_dna' in the schema cache" },
            }),
          }),
        }),
      }),
    } as never
    await expect(attachDnaAccount(client, 'user-1')).resolves.toBeUndefined()
    expect(loadDnaLog()).toEqual([])
  })

  it('adopts the account log, and forgets it on sign-out', async () => {
    detachDnaAccount()
    const log: DnaEvent[] = [{ tripId: TRIP, action: 'accept', category: 'waterfall' }]
    const client = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { log }, error: null }) }) }),
        upsert: () => ({ then: (fn: (r: { error: null }) => void) => fn({ error: null }) }),
      }),
    } as never
    await attachDnaAccount(client, 'user-2')
    expect(loadDnaLog()).toEqual(log)
    detachDnaAccount()
    expect(loadDnaLog()).toEqual([])
  })
})
