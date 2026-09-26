// ============ The Timeline's per-day card facts (#347) ============
// These pin the two halves that make the memo on DaySection bite:
//   1. reuse — a day keeps its SAME facts object while none of its inputs moved
//      (and a cache hit skips the engine math entirely), and
//   2. coverage — every trip field the engine reads for that day is IN the key,
//      so a reused fact can never render one edit behind.
// The second half is the load-bearing one: a key that is too coarse is a stale
// render, and a key that is too fine just loses the optimisation.
import { describe, it, expect } from 'vitest'
import { buildDayCards, dayCardKey, reuseDayTotals, reuseWarningGroups, sameDayContent, sameDaySectionProps, type DayCards } from '../src/lib/dayCards'
import { buildJourney, computeTotals, originOf, simulateDay, type ScheduleWarning } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { ItineraryStop, Trip } from '../src/data/types'

const baseTrip = (): Trip => {
  const t = structuredClone(seedData.trips[0])
  t.startLocationCoords = { lat: 9.97, lng: 76.30 }
  return t
}
const daysOf = (t: Trip) => [...t.days].sort((a, b) => a.index - b.index)
const build = (t: Trip, corrections?: Record<string, never>, prev?: DayCards | null) =>
  buildDayCards(t, daysOf(t), corrections as never, prev)
/** The last active stop of a day — the one the NEXT day wakes up from. */
const tailOf = (t: Trip, dayIndex: number): ItineraryStop => {
  const day = t.days.find(d => d.index === dayIndex)!
  const active = day.stops.filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
  return active[active.length - 1]
}

describe('buildDayCards — reuse while a day\'s inputs are unchanged', () => {
  it('hands every day back its own object when nothing changed', () => {
    const t = baseTrip()
    const first = build(t)
    const second = build(t, undefined, first)
    for (const day of daysOf(t)) {
      expect(second.byDay.get(day.index)).toBe(first.byDay.get(day.index))
    }
  })

  it('keeps a day stable when an unrelated trip field changes', () => {
    const t = baseTrip()
    const first = build(t)
    // Budget and crew are not inputs to a day card's journey or schedule.
    const edited = structuredClone(t)
    edited.budgetInr = (edited.budgetInr ?? 0) + 5000
    const second = build(edited, undefined, first)
    for (const day of daysOf(edited)) {
      expect(second.byDay.get(day.index)).toBe(first.byDay.get(day.index))
    }
  })

  it('rebuilds only the edited day when a NON-tail stop moves', () => {
    const t = baseTrip()
    const target = daysOf(t).find(d => d.stops.length >= 2)
    if (!target) throw new Error('fixture needs a day with two stops')
    const first = build(t)
    const edited = structuredClone(t)
    const ordered = [...edited.days.find(d => d.index === target.index)!.stops].sort((a, b) => a.orderInDay - b.orderInDay)
    ordered[0].lat += 0.01
    const second = build(edited, undefined, first)
    expect(second.byDay.get(target.index)).not.toBe(first.byDay.get(target.index))
    for (const day of daysOf(edited)) {
      if (day.index === target.index) continue
      // a mid-day move leaves the day's tail — and therefore the next day's
      // wake-up point — exactly where it was
      expect(second.byDay.get(day.index)).toBe(first.byDay.get(day.index))
    }
  })

  it('rebuilds the NEXT day too when the day\'s tail moves (its origin is an input)', () => {
    const t = baseTrip()
    const target = daysOf(t)[0]
    const next = daysOf(t)[1]
    if (!next) throw new Error('fixture needs two days')
    const first = build(t)
    const edited = structuredClone(t)
    const tail = tailOf(edited, target.index)
    tail.lat += 0.01
    const second = build(edited, undefined, first)
    expect(second.byDay.get(target.index)).not.toBe(first.byDay.get(target.index))
    expect(second.byDay.get(next.index)).not.toBe(first.byDay.get(next.index))
    // ...and the origin really did move, which is WHY it must not be reused
    expect(second.byDay.get(next.index)!.origin).not.toEqual(first.byDay.get(next.index)!.origin)
  })

  it('rebuilds every day when the trip dates move (each chip\'s forecast date)', () => {
    const t = baseTrip()
    const first = build(t)
    const edited = structuredClone(t)
    edited.startDate = '2026-12-01'
    const second = build(edited, undefined, first)
    for (const day of daysOf(edited)) expect(second.byDay.get(day.index)).not.toBe(first.byDay.get(day.index))
    expect(second.byDay.get(daysOf(edited)[0].index)!.startDate).toBe('2026-12-01')
  })

  it('rebuilds every day when the transport mode moves (assumptions + journey shape)', () => {
    const t = baseTrip()
    const first = build(t)
    const edited = structuredClone(t)
    edited.transportMode = t.transportMode === 'car' ? 'train' : 'car'
    const second = build(edited, undefined, first)
    for (const day of daysOf(edited)) expect(second.byDay.get(day.index)).not.toBe(first.byDay.get(day.index))
  })

  it('rebuilds only the day whose fixed commitment changed', () => {
    const t = baseTrip()
    const target = daysOf(t)[1] ?? daysOf(t)[0]
    const first = build(t)
    const edited = structuredClone(t)
    edited.fixedCommitments = [...(edited.fixedCommitments ?? []), {
      id: 'fc-test', title: 'Train at 14:00', type: 'train-departure', dayIndex: target.index, time: '14:00',
    }]
    const second = build(edited, undefined, first)
    expect(second.byDay.get(target.index)).not.toBe(first.byDay.get(target.index))
    expect(second.byDay.get(target.index)!.commitments.map(c => c.id)).toEqual(['fc-test'])
    for (const day of daysOf(edited)) {
      if (day.index === target.index) continue
      expect(second.byDay.get(day.index)).toBe(first.byDay.get(day.index))
    }
  })

  it('rebuilds every day when the measured legs change, and reuses when they do not', () => {
    const t = baseTrip()
    const corrections = { 'leg-1': { distanceKm: 12, durationMinutes: 20, geometry: [[76.3, 9.97], [76.4, 10.1]] } }
    const first = build(t, corrections as never)
    const same = build(t, corrections as never, first)
    for (const day of daysOf(t)) expect(same.byDay.get(day.index)).toBe(first.byDay.get(day.index))
    // a fresh map with equal content is still a new measurement — the facts
    // look corrections up by legKey, so their identity is what counts
    const other = build(t, { ...corrections } as never, first)
    for (const day of daysOf(t)) expect(other.byDay.get(day.index)).not.toBe(first.byDay.get(day.index))
  })

  it('rebuilds everything for a different trip', () => {
    const t = baseTrip()
    const first = build(t)
    const other = baseTrip()
    other.id = `${t.id}-other`
    const second = build(other, undefined, first)
    for (const day of daysOf(other)) expect(second.byDay.get(day.index)).not.toBe(first.byDay.get(day.index))
  })

  it('does not rebuild an earlier day when a LATER day gains its second stop', () => {
    const t = baseTrip()
    const later = daysOf(t)[daysOf(t).length - 1]
    const earlier = daysOf(t)[0]
    if (later.index === earlier.index) throw new Error('fixture needs a day after the first')
    const first = build(t)
    const edited = structuredClone(t)
    const day = edited.days.find(d => d.index === later.index)!
    const tail = [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)[day.stops.length - 1]
    day.stops.push({ ...structuredClone(tail), id: 'extra-stop', orderInDay: day.stops.length + 1 })
    const second = build(edited, undefined, first)
    // the first day still wakes up where it did and still ends at the same
    // anchor — the later day was already non-empty, so its emptiness did not flip
    expect(second.byDay.get(earlier.index)).toBe(first.byDay.get(earlier.index))
    expect(second.byDay.get(later.index)).not.toBe(first.byDay.get(later.index))
  })
})

describe('buildDayCards — the facts say what the engine says', () => {
  it('carries the engine\'s own journey and schedule, origin included', () => {
    const t = baseTrip()
    const cards = build(t)
    for (const day of daysOf(t)) {
      const facts = cards.byDay.get(day.index)!
      const origin = originOf(t, day.index)
      expect(facts.origin).toEqual(origin)
      // the explicit origin override must be the walk buildJourney does itself
      expect(facts.journey).toEqual(buildJourney(t, day, undefined, origin))
      expect(facts.sim).toEqual(simulateDay(day, t, origin, day.index, undefined))
      expect(facts.hasNextDay).toBe(day.index + 1 < t.days.length)
    }
  })

  it('gives a day the anchors and money slice its header renders', () => {
    const t = baseTrip()
    const cards = build(t)
    const totals = computeTotals(t).byDay ?? []
    for (const day of daysOf(t)) {
      const facts = cards.byDay.get(day.index)!
      expect(facts.startDate).toBe(t.startDate)
      expect(facts.homeCenter).toEqual({ lat: 9.97, lng: 76.30 })
      expect(facts.commitments).toEqual((t.fixedCommitments ?? []).filter(c => c.dayIndex === day.index))
      expect(totals.some(b => b.dayIndex === day.index)).toBe(true)
    }
  })
})

describe('dayCardKey — the input list', () => {
  it('is stable for equal inputs and moves when a stop field the engine reads moves', () => {
    const t = baseTrip()
    const day = daysOf(t)[0]
    const origin = originOf(t, day.index)
    const keyOf = (trip: Trip) => dayCardKey(trip, trip.days.find(x => x.index === day.index)!, origin, null, null)
    const base = keyOf(t)
    expect(keyOf(t)).toBe(base)
    const moved = structuredClone(t)
    moved.days[0].stops[0].lat += 0.0001
    expect(keyOf(moved)).not.toBe(base)
    const visited = structuredClone(t)
    visited.days[0].stops[0].visitMinutes += 5
    expect(keyOf(visited)).not.toBe(base)
    const rejected = structuredClone(t)
    rejected.days[0].stops[0].status = 'rejected'
    expect(keyOf(rejected)).not.toBe(base)
  })

  it('does not move for a field no day reads (the memo is allowed to survive)', () => {
    const t = baseTrip()
    const day = daysOf(t)[0]
    const origin = originOf(t, day.index)
    const base = dayCardKey(t, day, origin, null, null)
    const edited = structuredClone(t)
    edited.budgetInr = 99999
    edited.travellers = 9
    expect(dayCardKey(edited, edited.days[0], origin, null, null)).toBe(base)
  })
})

describe('the day-card memo comparator', () => {
  const props = () => ({
    day: daysOf(baseTrip())[0],
    facts: {}, trip: undefined, editable: true, open: false,
    onAdd: () => {}, onEdit: () => {}, warnings: [], dayTotals: undefined, suggestionCache: {},
  })

  it('treats a content-identical day as unchanged — the echo commit case', () => {
    const a = props()
    const b = { ...a, day: structuredClone(a.day) }
    expect(a.day).not.toBe(b.day)
    expect(sameDaySectionProps(a, b)).toBe(true)
  })

  it('notices a real change inside that clone', () => {
    const a = props()
    const b = { ...a, day: structuredClone(a.day) }
    b.day.title = 'Renamed'
    expect(sameDaySectionProps(a, b)).toBe(false)
    const c = { ...a, day: structuredClone(a.day) }
    c.day.stops[0].lat += 0.001
    expect(sameDaySectionProps(a, c)).toBe(false)
    const d = { ...a, day: structuredClone(a.day) }
    d.day.stops = [...d.day.stops, { ...structuredClone(d.day.stops[0]), id: 'added' }]
    expect(sameDaySectionProps(a, d)).toBe(false)
  })

  it('compares every OTHER prop by identity, including ones it does not know', () => {
    const a = props()
    expect(sameDaySectionProps(a, { ...a })).toBe(true)
    expect(sameDaySectionProps(a, { ...a, onAdd: () => {} })).toBe(false)
    expect(sameDaySectionProps(a, { ...a, open: true })).toBe(false)
    expect(sameDaySectionProps(a, { ...a, facts: {} })).toBe(false)
    // a prop added later is compared automatically (the key set is exhaustive)
    const widened = { ...a, somethingNew: undefined } as typeof a
    const changed = { ...a, somethingNew: 1 } as unknown as typeof a
    expect(sameDaySectionProps(widened, changed)).toBe(false)
  })

  it('sameDayContent is safe in the changed direction on anything unstringifiable', () => {
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(sameDayContent(cyc, { self: {} })).toBe(false)
    expect(sameDayContent(undefined, null)).toBe(false)
    expect(sameDayContent(null, null)).toBe(true)
  })
})

describe('reuseDayTotals and reuseWarningGroups — prop identity for the chips', () => {
  it('keeps the previous money slice while its numbers are unchanged', () => {
    const a = { dayIndex: 0, expensesInr: 100, transportInr: 50, totalInr: 150, stops: 3, distanceKm: 12 }
    const prev = reuseDayTotals(null, [a])
    const same = reuseDayTotals(prev, [{ ...a }])
    expect(same.get(0)).toBe(a)
    const changed = reuseDayTotals(prev, [{ ...a, totalInr: 200 }])
    expect(changed.get(0)).not.toBe(a)
    expect(changed.get(0)!.totalInr).toBe(200)
  })

  it('keeps a day\'s warning array while the same warnings repeat', () => {
    const w: ScheduleWarning = { code: 'overloaded', severity: 'high', title: 'Day 1: too full', detail: 'x', fix: 'drop one', dayIndex: 0 }
    const first = reuseWarningGroups(null, new Map([[0, [w]]]))
    const repeat = reuseWarningGroups(first, new Map([[0, [{ ...w }]]]))
    expect(repeat.get(0)).toBe(first.get(0))
    const worse = reuseWarningGroups(first, new Map([[0, [{ ...w, severity: 'medium' }]]]))
    expect(worse.get(0)).not.toBe(first.get(0))
    // a day that gained a warning gets a new array; the untouched day does not
    const two = reuseWarningGroups(first, new Map([[0, [w]], [1, [{ ...w, dayIndex: 1, code: 'short-rest' }]]]))
    expect(two.get(0)).toBe(first.get(0))
    expect(two.get(1)).toHaveLength(1)
  })
})
