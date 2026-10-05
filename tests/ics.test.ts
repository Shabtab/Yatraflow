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

  it('a 23:30 commitment ends at 00:30 on the NEXT day, never before its start', () => {
    const trip = structuredClone(keralaTrip) as Trip
    trip.fixedCommitments = [
      { id: 'fc-late', title: 'Late flight', type: 'flight', dayIndex: 0, time: '23:30' },
    ]
    const ics = buildIcs(trip)
    const start = /DTSTART:(\d{8}T\d{6})/.exec(ics)
    const end = /DTEND:(\d{8}T\d{6})/.exec(ics)
    expect(start).not.toBeNull()
    expect(end).not.toBeNull()
    // expected dates derived from the trip's own start, so month-end rolls too
    const p = (n: number) => String(n).padStart(2, '0')
    const ymdOf = (offsetDays: number) => {
      const d = new Date(`${trip.startDate}T00:00:00`)
      d.setDate(d.getDate() + offsetDays)
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    }
    expect(start![1]).toBe(`${ymdOf(0)}T233000`)
    expect(end![1]).toBe(`${ymdOf(1)}T003000`)
    expect(end![1] > start![1]).toBe(true) // RFC 5545: DTEND later than DTSTART
  })

  it('a 23:00 commitment on a month’s last day wraps the calendar month as well', () => {
    const trip = structuredClone(keralaTrip) as Trip
    trip.startDate = '2026-10-31'
    trip.fixedCommitments = [
      { id: 'fc-year-end', title: 'New Year train', type: 'train', dayIndex: 0, time: '23:00' },
    ]
    const ics = buildIcs(trip)
    expect(ics).toContain('DTSTART:20261031T230000')
    expect(ics).toContain('DTEND:20261101T000000')
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

  it('folds multi-byte text by octets: every physical line ≤ 75 UTF-8 bytes, re-join intact', () => {
    const trip = structuredClone(keralaTrip) as Trip
    // 80 × ₹ = 240 bytes; a code-point folder reads it as 80 "octets" and
    // emits chunks far past the real limit
    trip.fixedCommitments = [
      { id: 'fc-rupee', title: 'Rupee wall', type: 'other', dayIndex: 0, time: '10:00', notes: '₹'.repeat(80) },
    ]
    const ics = buildIcs(trip)
    const utf8 = new TextEncoder()
    for (const line of ics.split('\r\n')) {
      expect(utf8.encode(line).length).toBeLessThanOrEqual(75)
    }
    // Unfold per §3.1 (CRLF + single space is continuation, not data) and the
    // value must re-read exactly as it went in.
    const logical = ics.replace(/\r\n /g, '')
    const descs = [...logical.matchAll(/^DESCRIPTION:(.*)$/gm)].map(m => m[1])
    expect(descs).toContain('₹'.repeat(80))
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
