import { describe, expect, it } from 'vitest'
import { nextTripStep, nextStepRoute, plannedDayRatio } from '../src/lib/tripNextStep'
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