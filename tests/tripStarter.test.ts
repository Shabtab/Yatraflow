import { describe, it, expect } from 'vitest'
import {
  estimateTripStarter, buildOutlineSeedStops, stayStyleFor, ROAD_FACTOR,
} from '../src/lib/tripStarter'
import { haversineKm } from '../src/lib/geo'
import type { LatLngPoint } from '../src/data/types'

const KOCHI: LatLngPoint = { lat: 9.9312, lng: 76.2673 }
const MUNNAR: LatLngPoint = { lat: 10.0889, lng: 77.0595 }
const THEKKADY: LatLngPoint = { lat: 9.5423, lng: 77.1654 }
const VARKALA: LatLngPoint = { lat: 8.7379, lng: 76.7163 }

const base = {
  startDate: '2026-09-12', endDate: '2026-09-18',
  travellers: 2, mode: 'car' as const,
  orderedPoints: [KOCHI, MUNNAR] as (LatLngPoint | null)[],
  returnCount: 0, roundTrip: false,
  travelStyle: 'balanced' as const,
}

describe('stayStyleFor', () => {
  it('maps the two dedicated rate tiers and defaults the rest to comfort', () => {
    expect(stayStyleFor('budget')).toBe('budget')
    expect(stayStyleFor('luxury')).toBe('luxury')
    expect(stayStyleFor('balanced')).toBe('comfort')
    expect(stayStyleFor('family')).toBe('comfort')
    expect(stayStyleFor('spiritual')).toBe('comfort')
  })
})

describe('estimateTripStarter — dates', () => {
  it('counts days inclusively and derives nights', () => {
    const b = estimateTripStarter(base)
    expect(b.days).toBe(7)
    expect(b.nights).toBe(6)
  })
  it('degrades to zero days on garbage dates', () => {
    const b = estimateTripStarter({ ...base, startDate: 'nope', endDate: '' })
    expect(b.days).toBe(0)
    expect(b.nights).toBe(0)
  })
})

describe('estimateTripStarter — road km', () => {
  it('chains geocoded points and applies the road factor', () => {
    const h = haversineKm(KOCHI.lat, KOCHI.lng, MUNNAR.lat, MUNNAR.lng)
    const b = estimateTripStarter(base)
    expect(b.roadKm).toBe(Math.round(h * ROAD_FACTOR))
    expect(b.roadKm!).toBeGreaterThan(50)
    expect(b.roadKm!).toBeLessThan(140)
  })
  it('doubles a round trip with no custom return stops', () => {
    const h = haversineKm(KOCHI.lat, KOCHI.lng, MUNNAR.lat, MUNNAR.lng)
    const b = estimateTripStarter({ ...base, roundTrip: true })
    expect(b.roadKm).toBe(Math.round(h * ROAD_FACTOR * 2))
  })
  it('does not double the roads when a custom return leg already loops home', () => {
    const pts = [KOCHI, MUNNAR, THEKKADY, VARKALA]
    const leg = (a: LatLngPoint, c: LatLngPoint) => haversineKm(a.lat, a.lng, c.lat, c.lng)
    const b = estimateTripStarter({
      ...base, orderedPoints: pts, returnCount: 1, roundTrip: true,
    })
    const expected = Math.round((leg(KOCHI, MUNNAR) + leg(MUNNAR, THEKKADY) + leg(THEKKADY, VARKALA)) * ROAD_FACTOR)
    expect(b.roadKm).toBe(expected)
  })
  it('returns null road km when nothing is geocoded', () => {
    const b = estimateTripStarter({ ...base, orderedPoints: [null, null] })
    expect(b.roadKm).toBeNull()
    expect(b.transportCost).toBeNull()
    expect(b.perHead).toBeNull()
    expect(b.transportFormula).toBe('')
  })
})

describe('estimateTripStarter — transport by mode', () => {
  it('prices self-drive fuel through economy and pump price', () => {
    const b = estimateTripStarter({ ...base, kmPerL: 15, inrPerL: 105 })
    expect(b.transportCost).toBe(b.roadKm! * 7) // 105 / 15 = ₹7/km exactly
    expect(b.transportFormula).toContain('15 km/L')
    expect(b.transportFormula).toContain('₹105/L')
  })
  it('falls back to the blended table when the economy is a typo', () => {
    const b = estimateTripStarter({ ...base, kmPerL: 999, inrPerL: 105 })
    expect(b.transportCost).toBe(Math.round(b.roadKm! * 9)) // car blended ₹9/km
  })
  it('adds the rental rate on top of self-drive fuel', () => {
    const b = estimateTripStarter({ ...base, mode: 'rental', kmPerL: 15, inrPerL: 105, rentPerDay: 1800 })
    expect(b.transportCost).toBe(b.roadKm! * 7 + 1800 * 7)
    expect(b.transportFormula).toContain('rent')
  })
  it('prices flight through the blended per-km fare', () => {
    const b = estimateTripStarter({ ...base, mode: 'flight' })
    expect(b.transportCost).toBe(Math.round(b.roadKm! * 6.5))
  })
  it('bills local trains at the suburban fare and says so', () => {
    const express = estimateTripStarter({ ...base, mode: 'train' })
    const local = estimateTripStarter({ ...base, mode: 'train', localTrain: true })
    expect(express.transportCost).toBe(Math.round(express.roadKm! * 1.6))
    expect(local.transportCost).toBe(Math.round(local.roadKm! * 0.45))
    expect(local.transportFormula).toContain('local train')
    expect(local.transportCost!).toBeLessThan(express.transportCost!)
  })
  it('ignores the local flag for every mode except train', () => {
    const b = estimateTripStarter({ ...base, mode: 'bus', localTrain: true })
    expect(b.transportCost).toBe(Math.round(b.roadKm! * 2.2))
    expect(b.transportFormula).not.toContain('local')
  })
})

describe('estimateTripStarter — stay, food, per head', () => {
  it('bills stay via rooms and the style tier, meals per head per day', () => {
    const b = estimateTripStarter({ ...base, travellers: 4, travelStyle: 'balanced' })
    expect(b.stayCost).toBe(6 * 2 * 3200) // comfort ₹3200, 4 crew → 2 rooms
    expect(b.mealCost).toBe(7 * 4 * 600)
    expect(b.stayFormula).toContain('₹3200')
  })
  it('uses the budget tier for budget style', () => {
    const b = estimateTripStarter({ ...base, travelStyle: 'budget' })
    expect(b.stayCost).toBe(6 * 1 * 1200)
  })
  it('splits the total per head', () => {
    const b = estimateTripStarter({ ...base, travellers: 4, kmPerL: 15, inrPerL: 105 })
    const total = b.transportCost! + b.stayCost + b.mealCost
    expect(b.perHead).toBe(Math.round(total / 4))
  })
})

describe('estimateTripStarter — tank range', () => {
  it('derives km per tank from tank capacity and economy', () => {
    expect(estimateTripStarter({ ...base, tankL: 45, kmPerL: 15 }).rangeKm).toBe(675)
  })
  it('stays null without a usable tank or economy', () => {
    expect(estimateTripStarter({ ...base, tankL: 45 }).rangeKm).toBeNull()
    expect(estimateTripStarter({ ...base, tankL: 45, kmPerL: 999 }).rangeKm).toBeNull()
    expect(estimateTripStarter({ ...base, tankL: 9999, kmPerL: 15 }).rangeKm).toBeNull()
  })
})

describe('buildOutlineSeedStops', () => {
  const dests = [
    { name: 'Munnar', ...MUNNAR },
    { name: 'Thekkady', ...THEKKADY },
  ]

  it('returns undefined with nothing geocoded or no days', () => {
    expect(buildOutlineSeedStops({ dests: [{ name: 'Nowhere' }], returnCount: 0, dayCount: 5 })).toBeUndefined()
    expect(buildOutlineSeedStops({ dests, returnCount: 0, dayCount: 0 })).toBeUndefined()
  })

  it('never seeds the final destination — the store auto-anchors it', () => {
    expect(buildOutlineSeedStops({ dests: [{ name: 'Munnar', ...MUNNAR }], returnCount: 0, dayCount: 5 })).toBeUndefined()
  })

  it('spreads outbound stops proportionally over the whole range', () => {
    const days = buildOutlineSeedStops({ dests, returnCount: 0, dayCount: 6 })!
    expect(days).toHaveLength(6)
    // Thekkady (last geocoded) is store-anchored, so only Munnar seeds:
    // frac 1/2 over span 5 → day 3
    expect(days[3]).toHaveLength(1)
    expect(days[3][0].title).toBe('Munnar')
    expect(days.flat()).toHaveLength(1)
  })

  it('fills the return leg into the later days', () => {
    const days = buildOutlineSeedStops({
      dests: [...dests, { name: 'Varkala', ...VARKALA }],
      returnCount: 1, dayCount: 6,
    })!
    // outbound span = round(5 × 0.6) = 3 → Munnar day 1, Thekkady day 2
    expect(days[1][0].title).toBe('Munnar')
    expect(days[2][0].title).toBe('Thekkady')
    // Varkala is the final destination → store-anchored, not seeded
    expect(days.flat()).toHaveLength(2)
  })

  it('shapes seeded stops as confirmed must-do sightseeing', () => {
    const days = buildOutlineSeedStops({ dests, returnCount: 0, dayCount: 3 })!
    const stop = days.flat()[0]
    expect(stop.category).toBe('sightseeing')
    expect(stop.status).toBe('confirmed')
    expect(stop.priority).toBe('must-do')
    expect(stop.visitMinutes).toBe(90)
    expect(stop.orderInDay).toBe(1)
    expect(stop.id.startsWith('st_')).toBe(true)
    expect(stop.lat).toBeCloseTo(MUNNAR.lat)
  })

  it('clamps gracefully when destinations outnumber days', () => {
    const five = [
      ...dests,
      { name: 'V', ...VARKALA },
      { name: 'M2', ...MUNNAR },
      { name: 'T2', ...THEKKADY },
    ]
    const days = buildOutlineSeedStops({ dests: five, returnCount: 0, dayCount: 2 })!
    expect(days).toHaveLength(2)
    expect(days.flat()).toHaveLength(4) // final destination is store-anchored
  })

  it('lands everything on day one for a single-day trip', () => {
    const days = buildOutlineSeedStops({ dests, returnCount: 0, dayCount: 1 })!
    expect(days).toHaveLength(1)
    expect(days[0]).toHaveLength(1)
  })
})
