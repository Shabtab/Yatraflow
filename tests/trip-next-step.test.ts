import { describe, expect, it } from 'vitest'
import { nextTripStep, nextStepRoute, plannedDayRatio, statusBucket, isStatusBucket, STATUS_FILTERS, departureLabel } from '../src/lib/tripNextStep'
import type { ItineraryDay, ItineraryStop, Trip } from '../src/data/types'

/* The trip card's next-step line (MR1) and planning bar (MR2) read this
   derivation. These tests pin its order, so a later change to it has to argue
   with a case rather than with memory. */

let seq = 0

function stop(patch: Partial<ItineraryStop> = {}): ItineraryStop {
  seq += 1
  return {
    id: `s${seq}`,
    title: `Stop ${seq}`,
    category: 'sight',
    locationName: 'Somewhere',
    lat: 26.9,
    lng: 75.8,
    visitMinutes: 60,
    entryFeeInrPerPerson: 0,
    transportCostInrTotal: 0,
    priority: 'must-do',
    status: 'confirmed',
    orderInDay: 0,
    ...patch,
  }
}

function day(index: number, stops: ItineraryStop[], patch: Partial<ItineraryDay> = {}): ItineraryDay {
  return { id: `d${index}`, index, stops, ...patch }
}

function trip(patch: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    name: 'Rajasthan Forts',
    startLocation: 'Jaipur',
    destinations: ['Udaipur'],
    startDate: '2026-10-12',
    endDate: '2026-10-18',
    travellers: 2,
    transportMode: 'car',
    days: [],
    ...patch,
  } as Trip
}

describe('nextTripStep', () => {
  it('asks for dates before anything else, because a draft has no days to plan', () => {
    expect(nextTripStep(trip({ startDate: '', endDate: '' }))).toEqual({
      kind: 'add-dates',
      label: 'Set your travel dates',
    })
  })

  it('asks for a first day when the trip has dates but no days', () => {
    expect(nextTripStep(trip())).toEqual({ kind: 'plan-day', label: 'Plan your first day' })
  })

  it('points at the earliest empty day, because it blocks the days after it', () => {
    const t = trip({ days: [day(0, [stop()]), day(1, []), day(2, [])] })
    expect(nextTripStep(t)).toEqual({ kind: 'plan-day', label: 'Plan day 2', dayIndex: 1 })
  })

  it('treats a day whose every stop was rejected as empty, because rejecting leaves nothing to visit', () => {
    const t = trip({
      days: [day(0, [stop({ status: 'rejected' })]), day(1, [stop()])],
      coverImageUrl: 'x.jpg',
    })
    expect(nextTripStep(t)).toEqual({ kind: 'plan-day', label: 'Plan day 1', dayIndex: 0 })
  })

  it('does not let a rejected stop block a day that also has a usable stop', () => {
    const t = trip({
      days: [day(0, [stop({ status: 'rejected' }), stop({ status: 'confirmed' })])],
      coverImageUrl: 'x.jpg',
    })
    expect(nextTripStep(t).kind).toBe('done')
  })

  it('prefers an empty day over an unbooked stop on the same trip', () => {
    const t = trip({ days: [day(0, [stop({ status: 'needs-booking' })]), day(1, [])] })
    expect(nextTripStep(t).kind).toBe('plan-day')
  })

  it('books the earliest stop that needs booking', () => {
    const mehrangarh = stop({ title: 'Mehrangarh Fort', status: 'needs-booking' })
    const t = trip({
      days: [
        day(0, [stop({ status: 'confirmed' })]),
        day(1, [mehrangarh]),
        day(2, [stop({ title: 'Amber Fort', status: 'needs-booking' })]),
      ],
    })
    expect(nextTripStep(t)).toEqual({
      kind: 'book-stop',
      label: 'Book Mehrangarh Fort',
      dayIndex: 1,
      stopId: mehrangarh.id,
    })
  })

  it('sorts by orderInDay rather than array position when picking a stop', () => {
    const t = trip({
      days: [
        day(0, [
          stop({ title: 'Second', status: 'needs-booking', orderInDay: 2 }),
          stop({ title: 'First', status: 'needs-booking', orderInDay: 1 }),
        ]),
      ],
    })
    expect(nextTripStep(t).label).toBe('Book First')
  })

  it('waits for a real blocker before offering a suggestion', () => {
    const pichola = stop({ title: 'Lake Pichola', status: 'suggested' })
    const t = trip({
      days: [day(0, [stop({ status: 'confirmed' })]), day(1, [pichola])],
    })
    expect(nextTripStep(t)).toEqual({
      kind: 'confirm-stop',
      label: 'Confirm Lake Pichola',
      dayIndex: 1,
      stopId: pichola.id,
    })
  })

  it('offers a cover photo only once nothing blocks the trip', () => {
    const t = trip({ days: [day(0, [stop()])] })
    expect(nextTripStep(t)).toEqual({ kind: 'add-cover', label: 'Add a cover photo' })
  })

  it('counts a cover emoji as a cover', () => {
    const t = trip({ days: [day(0, [stop()])], coverEmoji: '🏔' })
    expect(nextTripStep(t).kind).toBe('done')
  })

  it('does not count the default compass emoji as a cover, because every trip is born with it', () => {
    // `trips.cover_emoji` is `not null default '🧭'` and CoverThumb falls back to
    // the same glyph, so a stored 🧭 draws exactly like an empty cover. A live
    // read of every publication found the emoji set on all of them, which made
    // the add-cover step unreachable until this case was fixed.
    const t = trip({ days: [day(0, [stop()])], coverEmoji: '🧭' })
    expect(nextTripStep(t)).toEqual({ kind: 'add-cover', label: 'Add a cover photo' })
  })

  it('prefers a photo over any emoji, because the default emoji cannot be the only cover', () => {
    const t = trip({ days: [day(0, [stop()])], coverEmoji: '🧭', coverImageUrl: 'x.jpg' })
    expect(nextTripStep(t).kind).toBe('done')
  })

  it('reads done only when days are full and a cover exists', () => {
    const t = trip({ days: [day(0, [stop()])], coverImageUrl: 'x.jpg' })
    expect(nextTripStep(t)).toEqual({ kind: 'done', label: 'Ready to travel' })
  })
})

describe('plannedDayRatio', () => {  it('reports 0 percent rather than NaN when the trip has no days', () => {
    expect(plannedDayRatio(trip())).toEqual({ planned: 0, total: 0, pct: 0 })
  })

  it('does not count a day of only rejected stops as planned', () => {
    const t = trip({
      days: [day(0, [stop({ status: 'rejected' })]), day(1, [stop()]), day(2, [])],
    })
    expect(plannedDayRatio(t)).toEqual({ planned: 1, total: 3, pct: 33 })
  })
})

/* #647: the store anchors a new trip's route with automatic stops. An anchor is
   a route point, not an activity, so neither the meter nor the empty-day test
   may count one. These three trips are the decision's own cases: anchor only,
   real stop, and a mix of both. */
describe('#647 an automatic route anchor is not an activity', () => {
  /** What `autoAnchor` in src/store/store.ts writes: no dwell, already confirmed. */
  const anchor = () => stop({ title: 'Start point', auto: true, visitMinutes: 0, status: 'confirmed' })

  it('does not count a day that holds only an anchor', () => {
    const t = trip({ days: [day(0, [anchor()])] })
    expect(plannedDayRatio(t)).toEqual({ planned: 0, total: 1, pct: 0 })
  })

  it('still counts a day that holds a real stop', () => {
    const t = trip({ days: [day(0, [stop()])] })
    expect(plannedDayRatio(t)).toEqual({ planned: 1, total: 1, pct: 100 })
  })

  it('counts the real days of a mixed trip and not the anchored one', () => {
    const t = trip({
      days: [day(0, [anchor()]), day(1, [stop()]), day(2, [anchor(), stop()])],
    })
    expect(plannedDayRatio(t)).toEqual({ planned: 2, total: 3, pct: 67 })
  })

  it('treats an anchor-only day as empty, so the card asks for a plan', () => {
    const t = trip({ days: [day(0, [anchor()]), day(1, [stop()])] })
    expect(nextTripStep(t)).toEqual({ kind: 'plan-day', label: 'Plan day 1', dayIndex: 0 })
  })

  it('blames the anchored day of a mixed trip, not the planned ones', () => {
    const t = trip({ days: [day(0, [stop()]), day(1, [anchor()])] })
    expect(nextTripStep(t)).toEqual({ kind: 'plan-day', label: 'Plan day 2', dayIndex: 1 })
  })

  it('never claims readiness from anchors alone, even with a cover chosen', () => {
    // The defect: one anchor plus a chosen emoji read as 1 of 1 planned and
    // "Ready to travel" while the trip held no activity at all.
    const t = trip({ days: [day(0, [anchor()])], coverEmoji: '🏔' })
    const step = nextTripStep(t)
    expect(step.kind).not.toBe('done')
    expect(step).toEqual({ kind: 'plan-day', label: 'Plan day 1', dayIndex: 0 })
    expect(statusBucket(t)).toBe('planning')
  })

  it('keeps a fully anchored trip out of the Ready filter', () => {
    const t = trip({
      days: [day(0, [anchor()]), day(1, [anchor()])],
      coverImageUrl: 'x.jpg',
    })
    expect(statusBucket(t)).toBe('planning')
  })
})

/** One trip that lands in each bucket, built to clear the branches above it. */
const BUCKET_FIXTURES: { kind: string; trip: Trip }[] = [
  { kind: 'add-dates', trip: trip({ startDate: '', endDate: '' }) },
  { kind: 'plan-day', trip: trip({ days: [day(0, [stop()]), day(1, [])] }) },
  { kind: 'confirm-stop', trip: trip({ days: [day(0, [stop({ status: 'suggested' })])] }) },
  { kind: 'add-cover', trip: trip({ days: [day(0, [stop()])], coverEmoji: '🧭' }) },
  { kind: 'book-stop', trip: trip({ days: [day(0, [stop({ status: 'needs-booking' })])] }) },
  { kind: 'done', trip: trip({ days: [day(0, [stop()])], coverImageUrl: 'x.jpg' }) },
]

describe('statusBucket', () => {
  it('covers every kind the derivation can return', () => {
    for (const f of BUCKET_FIXTURES) {
      expect(nextTripStep(f.trip).kind, f.kind).toBe(f.kind)
      expect(typeof statusBucket(f.trip), f.kind).toBe('string')
    }
  })

  it('puts a booking in its own bucket, so nobody has to look inside "needs planning"', () => {
    const booking = BUCKET_FIXTURES.find(f => f.kind === 'book-stop')!.trip
    expect(statusBucket(booking)).toBe('booking')
  })

  it('groups the unfinished kinds into one planning bucket', () => {
    for (const kind of ['plan-day', 'confirm-stop', 'add-cover']) {
      const f = BUCKET_FIXTURES.find(x => x.kind === kind)!
      expect(statusBucket(f.trip), kind).toBe('planning')
    }
  })

  it('partitions the trips, so the tab counts add up to the page total', () => {
    const counted = new Map<string, number>()
    for (const f of BUCKET_FIXTURES) {
      const b = statusBucket(f.trip)
      counted.set(b, (counted.get(b) ?? 0) + 1)
    }
    const total = [...counted.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(BUCKET_FIXTURES.length)
    expect(counted.get('planning')).toBe(3)
    expect(counted.get('dates')).toBe(1)
    expect(counted.get('booking')).toBe(1)
    expect(counted.get('ready')).toBe(1)
  })
})

describe('isStatusBucket', () => {  it('accepts every filter the page draws', () => {
    for (const f of STATUS_FILTERS) expect(isStatusBucket(f.id), f.id).toBe(true)
  })

  it('rejects junk, so a corrupted pref reads as no filter', () => {
    for (const bad of ['', 'nope', 'ALL', 'null', '__proto__', null, undefined]) {
      expect(isStatusBucket(bad as string), String(bad)).toBe(false)
    }
  })
})

describe('departureLabel', () => {
  const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 9, 30)
  const dated = (startDate: string, endDate: string) => trip({ startDate, endDate })

  it('counts down to a trip that has not left yet', () => {
    expect(departureLabel(dated('2026-10-20', '2026-10-24'), on(2026, 10, 14)))
      .toBe('Departs in 6 days')
  })

  it('says today and tomorrow in words, not numbers', () => {
    expect(departureLabel(dated('2026-10-14', '2026-10-18'), on(2026, 10, 14))).toBe('Departs today')
    expect(departureLabel(dated('2026-10-15', '2026-10-18'), on(2026, 10, 14))).toBe('Departs tomorrow')
  })

  it('says nothing for a trip that has already ended', () => {
    expect(departureLabel(dated('2026-10-01', '2026-10-05'), on(2026, 10, 14))).toBeNull()
  })

  it('says nothing once a trip has departed, even while it is still running', () => {
    // Started yesterday and ends next week. It has LEFT, so a countdown would
    // be counting down to nothing — and "Departs today" would be a day stale.
    expect(departureLabel(dated('2026-10-13', '2026-10-20'), on(2026, 10, 14))).toBeNull()
  })

  it('says nothing for an undated trip, rather than counting from nothing', () => {
    expect(departureLabel(trip({ startDate: '', endDate: '' }), on(2026, 10, 14))).toBeNull()
  })

  it('says nothing for an unparseable date instead of printing NaN days', () => {
    expect(departureLabel(dated('not-a-date', 'also-not'), on(2026, 10, 14))).toBeNull()
  })

  it('refuses an impossible date rather than counting to it', () => {
    expect(departureLabel(dated('2026-02-30', '2026-03-02'), on(2026, 10, 14))).toBeNull()
  })

  it('counts whole days across a daylight-saving change', () => {
    // US DST ends 2026-11-01. Both ends are pinned to local midnight, so a
    // 23-hour day must not shorten the gap to 6.95 and round to 7 twice over.
    const label = departureLabel(dated('2026-11-08', '2026-11-12'), on(2026, 11, 1))
    expect(label).toBe('Departs in 7 days')
  })
})

/* #645: the card's task row and the featured card's button both read this
   builder, so a step's target is pinned once here rather than twice in JSX. */
describe('nextStepRoute', () => {
  it('sends a day step to its own day on the timeline', () => {
    const t = trip({ days: [day(0, [stop()]), day(1, []), day(2, [stop()])] })
    const step = nextTripStep(t)
    expect(step).toEqual({ kind: 'plan-day', label: 'Plan day 2', dayIndex: 1 })
    expect(nextStepRoute(t, step)).toBe('/trip/t1/timeline?day=1')
  })

  it('carries the stop id, so the row opens the stop its label names', () => {
    const t = trip({ days: [day(0, [stop({ id: 'stop-9', status: 'needs-booking' })])] })
    expect(nextStepRoute(t, nextTripStep(t))).toBe('/trip/t1/timeline?day=0&stop=stop-9')
  })

  it('opens Settings for the steps whose fields live there', () => {
    const undated = trip({ startDate: '', endDate: '' })
    expect(nextStepRoute(undated, nextTripStep(undated))).toBe('/trip/t1/settings')
    // The cover picker is in Settings, not on the timeline.
    const coverless = trip({ days: [day(0, [stop()])] })
    expect(nextStepRoute(coverless, nextTripStep(coverless))).toBe('/trip/t1/settings')
  })

  it('falls back to the trip when the step names no day', () => {
    // "Plan your first day" has no day index — adding one happens on the trip.
    const t = trip()
    expect(nextTripStep(t)).toEqual({ kind: 'plan-day', label: 'Plan your first day' })
    expect(nextStepRoute(t, nextTripStep(t))).toBe('/trip/t1')
  })

  it('always answers a usable route, even for a finished trip', () => {
    const t = trip({ days: [day(0, [stop()])], coverImageUrl: 'x.jpg' })
    expect(nextTripStep(t).kind).toBe('done')
    const route = nextStepRoute(t, nextTripStep(t))
    expect(route).toBe('/trip/t1')
    expect(route).not.toMatch(/undefined|null/)
  })
})