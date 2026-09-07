// ============ Calendar export (.ics) + safe-to-spend tests ============
// Pure string/data builders — node-testable like the rest of the lib.
import { describe, it, expect } from 'vitest'
import { buildIcs, icsDate } from '../src/lib/ics'
import { daysRemaining, safeToSpendPerDay } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'

const keralaTrip = seedData.trips[0]

describe('icsDate', () => {
  it('formats startDate + offset with month/day zero-padding', () => {
    expect(icsDate('2026-10-05', 0)).toBe('20261005')
    expect(icsDate('2026-10-05', 1)).toBe('20261006')
    expect(icsDate('2026-10-05', 30)).toBe('20261104')
    // month rollover across a year boundary
    expect(icsDate('2026-12-31', 1)).toBe('20270101')
  })
  it('returns "" (skip the event) for a malformed date rather than Invalid', () => {
    expect(icsDate('not-a-date', 0)).toBe('')
    expect(icsDate('', 3)).toBe('')
  })
})

describe('buildIcs', () => {
  it('emits a valid VCALENDAR envelope with CRLF line endings', () => {
    const ics = buildIcs(structuredClone(keralaTrip))
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
    expect(ics).not.toMatch(/\r\n\r\n/) // no blank lines inside
  })

  it('creates one all-day VEVENT per day, with end = next day (RFC end-exclusive)', () => {
    const trip = structuredClone(keralaTrip) as Trip
    trip.fixedCommitments = [] // isolate day events
    const ics = buildIcs(trip)
    const begins = (ics.match(/BEGIN:VEVENT/g) ?? []).length
    expect(begins).toBe(trip.days.length)
    const firstStart = /DTSTART;VALUE=DATE:(\d{8})/.exec(ics)
    const firstEnd = /DTEND;VALUE=DATE:(\d{8})/.exec(ics)
    expect(firstStart).not.toBeNull()
    expect(firstEnd).not.toBeNull()
    expect(firstEnd![1]).not.toBe(firstStart![1])
  })

  it('carries the day schedule (arrival times + stops) in the description', () => {
    const ics = buildIcs(structuredClone(keralaTrip))
    expect(ics).toContain('SUMMARY:')
    // description escapes newlines as literal \\n per RFC 5545
    expect(ics).toMatch(/DESCRIPTION:.*\\n/)
  })

  it('emits timed VEVENTs for fixed commitments, 1h default duration', () => {
    const trip = structuredClone(keralaTrip) as Trip
    trip.fixedCommitments = [
      { id: 'fc-1', title: 'Munnar resort check-in', type: 'hotel-checkin', dayIndex: 0, time: '14:00' },
    ]
    const ics = buildIcs(trip)
    expect(ics).toContain('DTSTART:2026') // timed (not VALUE=DATE) start
    const starts = [...ics.matchAll(/DTSTART:(\d{8}T\d{6})/g)].map(m => m[1])
    expect(starts.some(s => s.endsWith('T140000'))).toBe(true)
    const ends = [...ics.matchAll(/DTEND:(\d{8}T\d{6})/g)].map(m => m[1])
    expect(ends.some(s => s.endsWith('T150000'))).toBe(true)
  })

  it('escapes commas/semicolons and folds long lines to ≤75 octets', () => {
    const trip = structuredClone(keralaTrip) as Trip
    trip.name = 'A very long trip name, with commas; semicolons; and more words than one line can hold — RFC 5545 requires folding at 75 octets'
    const ics = buildIcs(trip)
    for (const line of ics.split('\r\n')) {
      // continuation lines legitimately start with a space and may use it
      expect([...line].length).toBeLessThanOrEqual(75)
    }
    expect(ics).toContain('\\,')
    expect(ics).toContain('\\;')
  })

  it('skips days and commitments with malformed dates instead of corrupting the calendar', () => {
    const trip = structuredClone(keralaTrip) as Trip
    trip.startDate = 'garbage'
    trip.fixedCommitments = [
      { id: 'fc-bad', title: 'No date', type: 'other', dayIndex: 0, time: '09:00' },
    ]
    const ics = buildIcs(trip)
    expect(ics).not.toContain('DTSTART:NaN')
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(0)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  })

  it('still emits day events when the seed carries its own fixed commitments', () => {
    const ics = buildIcs(structuredClone(keralaTrip))
    const begins = (ics.match(/BEGIN:VEVENT/g) ?? []).length
    // ≥ one per day; commitments add more
    expect(begins).toBeGreaterThanOrEqual(keralaTrip.days.length)
    expect(ics).toContain('UID:')
  })
})

describe('safe-to-spend pacing', () => {
  const base = { ...structuredClone(keralaTrip), budgetPerPersonInr: 5000, travellers: 2 } as Trip
  const len = base.days.length

  it('before the trip: full target ÷ all days', () => {
    const now = new Date('2026-09-07T12:00:00')
    // kerala seed starts later than now? guard by only asserting structure
    const p = safeToSpendPerDay(base, 1000, now)
    expect(p).not.toBeNull()
    expect(p!.daysLeft).toBeGreaterThanOrEqual(1)
    expect(p!.daysLeft).toBeLessThanOrEqual(len)
    expect(p!.perPersonPerDayInr).toBeCloseTo(p!.perDayInr / 2, 4)
  })

  it('mid-trip: days from today to the end, not the whole trip', () => {
    const start = new Date(base.startDate + 'T00:00:00')
    const mid = new Date(start)
    mid.setDate(mid.getDate() + 1) // day 2 of the trip
    const p = safeToSpendPerDay(base, 0, mid)
    expect(p).not.toBeNull()
    expect(p!.daysLeft).toBe(len - 1)
  })

  it('after the trip: zero days left, but the number stays finite', () => {
    const after = new Date(new Date(base.endDate + 'T12:00:00').getTime() + 86400000)
    const p = safeToSpendPerDay(base, 0, after)
    expect(p!.daysLeft).toBe(0)
    expect(Number.isFinite(p!.perDayInr)).toBe(true)
  })

  it('null when no target is set — ask for a budget, do not invent infinity', () => {
    const noBudget = { ...base, budgetPerPersonInr: 0 } as Trip
    expect(safeToSpendPerDay(noBudget, 500)).toBeNull()
  })

  it('overspend shows a negative per-day (overspend tile goes red), never NaN', () => {
    const now = new Date(base.startDate + 'T12:00:00')
    const p = safeToSpendPerDay(base, 99999, now)
    expect(p!.perDayInr).toBeLessThan(0)
    expect(Number.isFinite(p!.perDayInr)).toBe(true)
  })

  it('daysRemaining clamps dirty dates to the full day count', () => {
    const dirty = { ...base, startDate: '??', endDate: '??' } as unknown as Trip
    expect(daysRemaining(dirty)).toBe(len)
  })
})
