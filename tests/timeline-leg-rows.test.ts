// ============ Timeline leg rows & clocks keyed by stop id (#555) ============
// `simulateDay`'s legs are INTO legs: `legs[k]` is the drive that brought you
// TO `activeStops[k]`, and `legs[0]` is the day's opening drive (origin → the
// first row). Rendered lists — the Timeline's `ordered`, the public page's
// `stops` — can also carry rejected stops the simulator skips, so a positional
// read shifts at the first rejected row and shows one stop's times/leg under
// another. The surfaces therefore resolve rows by stop id through
// scheduleRowsById (the accessor printModel's lookup mirrors); the pins below
// encode the contract and exactly which leg each gap and strip must carry —
// including the two wrong directions the surfaces used to read (the gap under
// row k showed the leg INTO row k; the public strip showed the leg into the
// row above it).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { simulateDay, scheduleRowsById, originOf, type DaySchedule } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Trip, ItineraryStop } from '../src/data/types'

const keralaTrip = seedData.trips[0]

// A plausible Goa-ish day: origin Panjim, then Fort, Beach, Museum — each hop
// comfortably over the 0.5 km floor the leg rows render at.
const PANJIM = { lat: 15.4909, lng: 73.8278 }
const FORT = { lat: 15.502, lng: 73.832 }
const BEACH = { lat: 15.56, lng: 73.78 }
const MUSEUM = { lat: 15.45, lng: 73.9 }

function stop(id: string, title: string, p: { lat: number; lng: number }, over: Partial<ItineraryStop> = {}): ItineraryStop {
  return {
    id, title, category: 'sightseeing', locationName: title,
    lat: p.lat, lng: p.lng, visitMinutes: 60,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', status: 'confirmed', orderInDay: 1, ...over,
  }
}

/** One-day trip over the given stops, simulated the way the surfaces do. */
function simFor(stops: ItineraryStop[]): DaySchedule {
  const t = structuredClone(keralaTrip) as Trip
  t.transportMode = 'car'
  t.roundTrip = false
  t.startLocation = 'Panjim'
  t.startLocationCoords = PANJIM
  t.destinations = []
  t.destinationCoords = undefined
  t.fixedCommitments = []
  t.days = [{ id: 'd0', index: 0, stops }] as Trip['days']
  return simulateDay(t.days[0], t, originOf(t, 0), 0)
}

const threeStops = () => [
  stop('f', 'Fort', FORT, { orderInDay: 1 }),
  stop('b', 'Beach', BEACH, { orderInDay: 2 }),
  stop('m', 'Museum', MUSEUM, { orderInDay: 3 }),
]

describe('into-legs: sim.legs[k] is the drive INTO activeStops[k] (#555 contract)', () => {
  it('each leg leads into its own row, and out of the row before it', () => {
    const sim = simFor(threeStops())
    expect(sim.activeStops.map(s => s.id)).toEqual(['f', 'b', 'm'])
    expect(sim.legs).toHaveLength(sim.activeStops.length)          // one leg per row
    sim.activeStops.forEach((s, k) => expect(sim.legs[k].toTitle).toBe(s.title))
    expect(sim.legs[1].fromTitle).toBe('Fort')
    expect(sim.legs[2].fromTitle).toBe('Beach')
  })

  it('legs[0] is the day-opening drive — the first row’s inbound leg', () => {
    const sim = simFor(threeStops())
    const rows = scheduleRowsById(sim)
    expect(rows.get('f')!.legIn).toBe(sim.legs[0])                 // printModel unshifts this one
    expect(rows.get('f')!.legIn.toTitle).toBe('Fort')
    expect(rows.get('f')!.legIn.fromTitle).not.toBe('Fort')        // it comes from the origin, not a row above
  })
})

describe('the gap between two rows carries the drive INTO the row below it', () => {
  it('the 3-stop empirical harness from the issue reads Fort -> Beach, Beach -> Museum', () => {
    const sim = simFor(threeStops())
    const rows = scheduleRowsById(sim)
    // the gap under Fort (above Beach)
    expect(rows.get('b')!.legIn.fromTitle).toBe('Fort')
    // the gap under Beach (above Museum) — the last stop’s incoming leg, which
    // used to render nowhere
    expect(rows.get('m')!.legIn.fromTitle).toBe('Beach')
    expect(rows.get('m')!.legIn).not.toBe(sim.legs[0])
    // the sequence a gap renderer walks:
    expect(['b', 'm'].map(id => { const l = rows.get(id)!.legIn; return `${l.fromTitle} -> ${l.toTitle}` }))
      .toEqual(['Fort -> Beach', 'Beach -> Museum'])
  })

  it('a rejected stop shifts neither a neighbour leg nor its clock', () => {
    const sim = simFor([
      stop('a', 'Fort', FORT, { orderInDay: 1 }),
      stop('bb', 'Beach', BEACH, { orderInDay: 2, status: 'rejected' }),
      stop('c', 'Museum', MUSEUM, { orderInDay: 3 }),
    ])
    const rows = scheduleRowsById(sim)
    // the simulator skips the rejected row entirely...
    expect(sim.activeStops.map(s => s.id)).toEqual(['a', 'c'])
    expect(rows.has('bb')).toBe(false)
    // ...so the third rendered row no longer lines up with sim's arrays:
    expect(sim.arrivalTimes[2]).toBeUndefined()                    // a positional read finds nothing
    expect(rows.get('c')!.arrive).toMatch(/^\d{2}:\d{2}$/)        // the id-keyed read finds C's own clock
    // and the gap under the rejected row carries A -> C (the true origin of
    // the drive), never B's leftovers
    const l = rows.get('c')!.legIn
    expect(`${l.fromTitle} -> ${l.toTitle}`).toBe('Fort -> Museum')
  })
})

describe('the public travelling strip describes the drive INTO its anchor', () => {
  it('shows Fort -> Beach for "Travelling to Beach", not the origin -> Fort drive it used to', () => {
    const sim = simFor([
      stop('a', 'Fort', FORT, { orderInDay: 1 }),
      stop('w', 'Beach', BEACH, { orderInDay: 2, auto: true, category: 'travel', visitMinutes: 0 }),
    ])
    const rows = scheduleRowsById(sim)
    const l = rows.get('w')!.legIn
    expect(`${l.fromTitle} -> ${l.toTitle}`).toBe('Fort -> Beach') // the strip's leg
    expect(sim.legs[0].fromTitle).not.toBe('Fort')                 // the stale one it used to show
    expect(rows.get('w')!.legIn).not.toBe(sim.legs[0])
  })
})

// ============ Wiring: the two surfaces read the schedule by stop id ============
// Pure-helper pins cannot police the component call sites — this bug lived
// entirely in the JSX's index reads. These source pins (the
// tests/timeline-quick-add.test.ts pattern) keep both surfaces on the accessor
// and the Timeline gap pointed at the row BELOW it.
describe('DaySection and PublicItinerary resolve rows by stop id (#555 wiring)', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  /** Code lines only — a comment may name a read the module deliberately does
   *  not make, so `not.toMatch` below judges code. */
  const code = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const day = code(read('src/pages/trip/timeline/DaySection.tsx'))
  const pub = code(read('src/pages/PublicItinerary.tsx'))

  it('neither surface indexes sim.legs/arrivalTimes/departures by render position', () => {
    for (const src of [day, pub]) expect(src).not.toMatch(/sim\.(legs|arrivalTimes|departures)\s*\[/)
  })

  it('both resolve schedule facts through scheduleRowsById', () => {
    expect(day).toMatch(/scheduleRowsById\(sim\)/)
    expect(pub).toMatch(/scheduleRowsById\(sim\)/)
  })

  it('the Timeline gap reads the leg INTO the row below it', () => {
    // the #555 slip was `sim.legs[i]` — the leg into the row ABOVE the gap
    expect(day).toMatch(/simRows\.get\(ordered\[i \+ 1\]\.id\)\?\.legIn/)
    expect(day).not.toMatch(/const leg = sim\.legs\[i\]/)
  })

  it('the strip reads the anchor row’s own inbound leg', () => {
    expect(pub).toMatch(/const inbound = i > 0 \? row\?\.legIn \?\? null : null/)
    expect(pub).not.toMatch(/const inbound = i > 0 \? sim\.legs\[i - 1\]/)
  })
})
