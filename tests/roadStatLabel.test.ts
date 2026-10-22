import { describe, it, expect } from 'vitest'
import { distanceStatLabel, fullyMeasured, roadStateOf } from '../src/lib/roadStatLabel'
import { legKey, type LegEstimate } from '../src/lib/engine'
import type { RoadStatus } from '../src/lib/tripRoad'

// Minimal journey shape the helper reads (a real Journey satisfies it).
const p = (lat: number, lng: number) => ({ lat, lng })
const leg = (distanceKm: number, durationMinutes: number): LegEstimate => ({ distanceKm, durationMinutes })

const KOCHI = p(9.9312, 76.2673)
const MUNNAR = p(10.0889, 77.0595)
const VALPARAI = p(10.3269, 76.9559)

// The Kerala demo day from issue #671: Kochi → Munnar → Valparai.
// Before the road is measured the engine prints ~83 km (haversine × 1.25);
// with the corrections in, the same stops compute ~146 km.
const chordDay = { distanceKm: 83, points: [KOCHI, MUNNAR, VALPARAI] }
const roadDay = { distanceKm: 146, points: [KOCHI, MUNNAR, VALPARAI] }
const measuredCorrections = {
  [legKey(KOCHI, MUNNAR)]: leg(88, 112),
  [legKey(MUNNAR, VALPARAI)]: leg(58, 60),
}

describe('roadStateOf', () => {
  it('pending reads pending, whatever the corrections hold', () => {
    expect(roadStateOf('pending', chordDay, undefined)).toBe('pending')
    expect(roadStateOf('pending', chordDay, measuredCorrections)).toBe('pending')
  })

  it('failed reads failed', () => {
    expect(roadStateOf('failed', chordDay, undefined)).toBe('failed')
    expect(roadStateOf('failed', chordDay, measuredCorrections)).toBe('failed')
  })

  it('ok with a measured leg on this day reads ok (road measured)', () => {
    expect(roadStateOf('ok', chordDay, measuredCorrections)).toBe('ok')
  })

  it('ok with no corrections at all reads not-measured', () => {
    expect(roadStateOf('ok', chordDay, undefined)).toBe('not-measured')
  })

  it('ok with EMPTY corrections reads not-measured (mode never measured)', () => {
    expect(roadStateOf('ok', chordDay, {})).toBe('not-measured')
  })

  it('ok with corrections that MISS this day reads not-measured', () => {
    const elsewhere = { [legKey(p(12.5, 78.2), p(13.1, 77.6))]: leg(60, 80) }
    expect(roadStateOf('ok', chordDay, elsewhere)).toBe('not-measured')
  })

  it('ok with a day that never moves reads not-measured', () => {
    const still = { distanceKm: 0, points: [KOCHI] }
    expect(roadStateOf('ok', still, measuredCorrections)).toBe('not-measured')
  })

  it('ok with only ONE of two legs measured reads partial, not ok', () => {
    // The day's total mixes a measured road leg with a chord leg, so the total
    // is not a road number. `measuredLegCount` is 1, which is enough for the
    // chain status but not enough to call the whole day measured.
    const half = { [legKey(KOCHI, MUNNAR)]: leg(88, 112) }
    expect(roadStateOf('ok', chordDay, half)).toBe('partial')
  })

  it('ok with every leg measured reads ok', () => {
    expect(roadStateOf('ok', chordDay, measuredCorrections)).toBe('ok')
  })
})

describe('fullyMeasured', () => {
  it('is true only when every leg of the day is measured', () => {
    expect(fullyMeasured(chordDay, measuredCorrections)).toBe(true)
    expect(fullyMeasured(chordDay, { [legKey(KOCHI, MUNNAR)]: leg(88, 112) })).toBe(false)
    expect(fullyMeasured(chordDay, undefined)).toBe(false)
  })

  it('is false for a day with no leg to measure', () => {
    expect(fullyMeasured({ points: [KOCHI] }, measuredCorrections)).toBe(false)
    expect(fullyMeasured({ points: [] }, measuredCorrections)).toBe(false)
  })

  it('is false when a keyed leg is the router fallback, not a road number', () => {
    // correctionsFromLegs keeps the legs the router could not measure, flagged
    // `estimated`. They are keyed like a measured leg, so counting keys would
    // pass them and the day would claim a road number it does not have.
    const withFallback = {
      [legKey(KOCHI, MUNNAR)]: leg(88, 112),
      [legKey(MUNNAR, VALPARAI)]: { ...leg(40, 60), estimated: true },
    }
    expect(fullyMeasured(chordDay, withFallback)).toBe(false)
    expect(roadStateOf('ok', chordDay, withFallback)).toBe('partial')
  })
})

describe('distanceStatLabel', () => {
  it('the measured path carries no "~" and never says estimate', () => {
    const label = distanceStatLabel(roadDay, 'ok')
    expect(label).toContain('146 km')
    expect(label).not.toContain('~')
    expect(label.toLowerCase()).not.toContain('estimate')
  })

  it('pending says straight-line estimate and that the road is being measured', () => {
    const label = distanceStatLabel(chordDay, 'pending')
    expect(label).toContain('~83 km')
    expect(label).toContain('straight-line estimate')
    expect(label.toLowerCase()).toContain('measuring')
  })

  it('failed says straight-line estimate and names the failure', () => {
    const label = distanceStatLabel(chordDay, 'failed')
    expect(label).toContain('~83 km')
    expect(label).toContain('straight-line estimate')
    expect(label.toLowerCase()).toContain('failed')
  })

  it('not-measured reuses the Optimise tooltip wording', () => {
    const label = distanceStatLabel(chordDay, 'not-measured')
    expect(label).toContain('~83 km')
    expect(label).toContain('straight-line estimate')
    expect(label).toContain('road not measured yet')
  })

  it('the measured path never says estimate, for any distance', () => {
    for (const km of [0, 0.4, 1, 83, 146, 999.6]) {
      const label = distanceStatLabel({ distanceKm: km, points: [KOCHI, MUNNAR] }, 'ok')
      expect(label.toLowerCase()).not.toContain('estimate')
      expect(label).not.toContain('~')
    }
  })

  it('every unmeasured path says straight-line estimate', () => {
    const states: RoadStatus[] = ['pending', 'failed']
    for (const state of states) {
      expect(distanceStatLabel(chordDay, state)).toContain('straight-line estimate')
    }
    expect(distanceStatLabel(chordDay, 'not-measured')).toContain('straight-line estimate')
  })

  it('a partially measured day keeps the "~" and never says road measured', () => {
    const label = distanceStatLabel(chordDay, 'partial')
    expect(label).toContain('~83 km')
    expect(label).toContain('estimate')
    expect(label).not.toContain('road measured')
  })

  it('issue #671: the same stops flip their wording as the road resolves', () => {
    const before = roadStateOf('pending', chordDay, undefined)
    const after = roadStateOf('ok', roadDay, measuredCorrections)
    const beforeLabel = distanceStatLabel(chordDay, before)
    const afterLabel = distanceStatLabel(roadDay, after)
    expect(beforeLabel).toContain('~83 km')
    expect(beforeLabel).toContain('estimate')
    expect(afterLabel).not.toContain('~')
    expect(afterLabel.toLowerCase()).not.toContain('estimate')
  })
})
