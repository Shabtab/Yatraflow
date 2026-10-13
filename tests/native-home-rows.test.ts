// P14 Native home: the decisions the rows and the greeting make.
//
// These are the page's own functions, imported from the page's own module, so
// the rules pinned here are the ones NativeHome.tsx follows. The row order is
// the page's promise: live first, then upcoming, then the rest.
import { describe, expect, it, vi } from 'vitest'
import { greeting, tripPhase } from '../src/pages/NativeHome'
import type { Trip } from '../src/data/types'

/** A trip with the dates this test needs. Everything else is irrelevant here. */
function trip(dates: { start?: string; end?: string }): Trip {
  return {
    id: 't1',
    name: 'Test trip',
    startDate: dates.start,
    endDate: dates.end,
    days: [],
  } as unknown as Trip
}

/** Midnight today, so a day boundary never makes these tests flaky. */
const today = new Date()
today.setHours(0, 0, 0, 0)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const shiftDays = (n: number) => {
  const d = new Date(today)
  d.setDate(d.getDate() + n)
  return iso(d)
}

describe('tripPhase', () => {
  it('is live when today falls inside the range', () => {
    expect(tripPhase(trip({ start: shiftDays(-2), end: shiftDays(2) }))).toBe('live')
  })

  it('is live on the first day of the range', () => {
    expect(tripPhase(trip({ start: shiftDays(0), end: shiftDays(3) }))).toBe('live')
  })

  it('is live on the last day of the range', () => {
    expect(tripPhase(trip({ start: shiftDays(-3), end: shiftDays(0) }))).toBe('live')
  })

  it('is upcoming when the range starts in the future', () => {
    expect(tripPhase(trip({ start: shiftDays(1), end: shiftDays(4) }))).toBe('upcoming')
  })

  it('is other when the range is in the past', () => {
    expect(tripPhase(trip({ start: shiftDays(-5), end: shiftDays(-2) }))).toBe('other')
  })

  it('is other when the trip has no start date', () => {
    expect(tripPhase(trip({}))).toBe('other')
  })

  it('treats a missing end date as a one-day range', () => {
    expect(tripPhase(trip({ start: shiftDays(0) }))).toBe('live')
    expect(tripPhase(trip({ start: shiftDays(-1) }))).toBe('other')
  })
})

describe('greeting', () => {
  it('is one of the four greetings, for any hour of the day', () => {
    const allowed = new Set(['Late night planning', 'Good morning', 'Good afternoon', 'Good evening'])
    for (let hour = 0; hour < 24; hour += 1) {
      const spy = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(hour)
      try {
        expect(allowed.has(greeting()), `hour ${hour}`).toBe(true)
      } finally {
        spy.mockRestore()
      }
    }
  })

  it('is the late-night greeting before 5am', () => {
    const spy = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(3)
    try {
      expect(greeting()).toBe('Late night planning')
    } finally {
      spy.mockRestore()
    }
  })

  it('is the morning greeting from 5am to noon', () => {
    const spy = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(9)
    try {
      expect(greeting()).toBe('Good morning')
    } finally {
      spy.mockRestore()
    }
  })

  it('is the afternoon greeting from noon to 5pm', () => {
    const spy = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14)
    try {
      expect(greeting()).toBe('Good afternoon')
    } finally {
      spy.mockRestore()
    }
  })

  it('is the evening greeting from 5pm', () => {
    const spy = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(21)
    try {
      expect(greeting()).toBe('Good evening')
    } finally {
      spy.mockRestore()
    }
  })
})
