// ============ Warning identity (#402) + cross-day rest (#423) ============
// #402: every warning the engine emits carries the DAY it belongs to (or
// `null` for a trip-wide one), and surfaces group by that field instead of
// parsing `title` — a display string. The old regex grouping both misfiled
// prefix-less warnings (opening hours) and silently dropped trip-wide ones.
// #423: the night BETWEEN two consecutive days is the one thing neither day
// can see on its own, so `collectWarnings` measures it end-to-start, walking
// days in index order.
import { describe, it, expect } from 'vitest'
import {
  collectWarnings, groupWarnings, dayIndexFromTitle, simulateDay, originOf,
} from '../src/lib/engine'
import type { ScheduleWarning } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Trip, ItineraryStop } from '../src/data/types'

function stop(over: Partial<ItineraryStop> = {}): ItineraryStop {
  return {
    id: 's1', title: 'Stop', category: 'sightseeing', locationName: 'L',
    lat: 15.6, lng: 73.9, description: '', notes: '', visitMinutes: 60,
    openTime: '', closeTime: '', entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', sourceUrl: '', status: 'confirmed', orderInDay: 1,
    ...over,
  } as ItineraryStop
}
function day(index: number, over: Record<string, unknown> = {}) {
  return { id: `d${index}`, index, title: `Day ${index + 1}`, stops: [], ...over } as never
}
function tripOf(days: unknown[], over: Partial<Trip> = {}): Trip {
  const n = Math.max(days.length, 1)
  return {
    id: 't1', name: 'T', startLocation: 'Home',
    startLocationCoords: { lat: 15.5, lng: 73.8 },
    destinations: ['Base'],
    destinationCoords: [{ lat: 15.6, lng: 73.9 }],
    startDate: '2026-09-01', endDate: `2026-09-0${n}`, travellers: 2,
    transportMode: 'car', roundTrip: false, budgetPerPersonInr: 20000,
    travelStyle: 'balanced', fixedCommitments: [], days: days as Trip['days'],
    expenses: [], coverEmoji: '🚗', visibility: 'private', createdAt: 0, updatedAt: 0,
    ...over,
  } as Trip
}
const warn = (warnings: ScheduleWarning[]) => warnings.filter(w => w.code === 'short-rest')

// A day that runs late: start 16:00 + a 7 h visit → departs just past 23:00.
const lateDay = (index: number) => day(index, {
  startTime: '16:00',
  stops: [stop({ id: `late${index}`, orderInDay: 1, visitMinutes: 420 })],
})

describe('warning identity (#402)', () => {
  it('tags every per-day warning with its day.index', () => {
    const trip = seedData.trips[0]
    const warnings = collectWarnings(trip)
    expect(warnings.length).toBeGreaterThan(0)
    for (const w of warnings) {
      if (w.dayIndex === null) continue
      expect(w.dayIndex, `${w.code} must name a real day`).toBeTypeOf('number')
      expect(trip.days.some(d => d.index === w.dayIndex), `${w.code} → day ${w.dayIndex}`).toBe(true)
    }
  })

  it('groups by dayIndex — the union of groups is EVERY warning (nothing dropped)', () => {
    const trip = seedData.trips[0]
    const warnings = collectWarnings(trip)
    const { byDay, tripWide } = groupWarnings(warnings)
    let grouped = 0
    for (const list of byDay.values()) grouped += list.length
    expect(grouped + tripWide.length).toBe(warnings.length)
  })

  it('files a prefix-less warning under its own day (opening hours carry a stop title)', () => {
    // The day arrives ~08:49 and needs an hour, but the stop closes at 09:15 —
    // a `hours` row leads with the stop's title, so the old “Day N:” regex
    // never matched it and the day's pill stayed clean.
    const t = tripOf([day(0, {
      startTime: '08:30',
      stops: [stop({ id: 's-open', title: 'Fort gate', openTime: '08:00', closeTime: '09:15', visitMinutes: 60 })],
    }), day(1)])
    const warnings = collectWarnings(t)
    const hours = warnings.filter(w => w.code === 'hours')
    expect(hours.length).toBeGreaterThan(0)
    expect(hours[0].title.startsWith('Day ')).toBe(false) // the display-string trap
    expect(hours[0].dayIndex).toBe(0)
    const { byDay, tripWide } = groupWarnings(warnings)
    expect(byDay.get(0)).toContain(hours[0])
    expect(tripWide).not.toContain(hours[0])
  })

  it('keeps the accommodation warning as trip-wide, not dropped', () => {
    // 3+ days, a different overnight base every night — the `hotels` warning
    // has no day to belong to, which is exactly why the regex surfaces lost it.
    const hotel = (id: string, place: string) => stop({ id, category: 'hotel', title: 'Hotel ' + id, locationName: place, visitMinutes: 30 })
    const t = tripOf([
      day(0, { stops: [hotel('h0', 'Candolim')] }),
      day(1, { stops: [hotel('h1', 'Panaji')] }),
      day(2, { stops: [hotel('h2', 'Margao')] }),
    ])
    const warnings = collectWarnings(t)
    const hotels = warnings.filter(w => w.code === 'hotels')
    expect(hotels).toHaveLength(1)
    expect(hotels[0].dayIndex).toBeNull()
    expect(groupWarnings(warnings).tripWide).toContain(hotels[0])
  })

  it('falls back to the title prefix only for a legacy shape with no dayIndex', () => {
    const legacy: ScheduleWarning[] = [
      { code: 'travel', severity: 'medium', title: 'Day 3: long travel time', detail: '', fix: '' },
      { code: 'custom', severity: 'low', title: 'Something trip-wide', detail: '', fix: '' },
    ]
    const { byDay, tripWide } = groupWarnings(legacy)
    expect(byDay.get(2)).toHaveLength(1)
    expect(tripWide.map(w => w.code)).toEqual(['custom'])
    expect(dayIndexFromTitle('Day 3: long travel time')).toBe(2)
    expect(dayIndexFromTitle('Stop: arrives before opening')).toBeNull()
  })

  it('day 0 is a real group, not a falsy miss', () => {
    const { byDay } = groupWarnings([
      { code: 'density', severity: 'low', dayIndex: 0, title: 'Day 1 is busy', detail: '', fix: '' },
    ])
    expect(byDay.get(0)).toHaveLength(1)
  })
})

describe('cross-day rest (#423)', () => {
  it('flags a short night before the next day, high under 5 h', () => {
    const t = tripOf([lateDay(0), day(1, { startTime: '03:00' })])
    const endsAt = simulateDay(t.days[0], t, originOf(t, 0), 0).endsAt
    const short = warn(collectWarnings(t))
    expect(short).toHaveLength(1)
    expect(short[0].severity).toBe('high')
    // The warning belongs to the day being woken up, and names both clocks.
    expect(short[0].dayIndex).toBe(1)
    expect(short[0].detail).toContain(endsAt)
    expect(short[0].detail).toContain('03:00')
  })

  it('flags the 5–7 h band as medium', () => {
    const t = tripOf([lateDay(0), day(1, { startTime: '05:00' })])
    const short = warn(collectWarnings(t))
    expect(short).toHaveLength(1)
    expect(short[0].severity).toBe('medium')
  })

  it('stays quiet on a full night', () => {
    const t = tripOf([lateDay(0), day(1, { startTime: '09:00' })])
    expect(warn(collectWarnings(t))).toHaveLength(0)
  })

  it('walks days in index order, never array order', () => {
    const late = lateDay(0)
    const early = day(1, { startTime: '03:00' })
    // Same trip, array reversed — the night is still the night.
    const forward = tripOf([late, early])
    const reversed = tripOf([early, late])
    expect(warn(collectWarnings(forward))).toHaveLength(1)
    expect(warn(collectWarnings(reversed))).toHaveLength(1)
    expect(warn(collectWarnings(reversed))[0].severity).toBe('high')
  })

  it('treats a day that ends after midnight as the late night it is', () => {
    // 16:00 start + a 10 h visit → past 02:00; the next day at 08:00 is a
    // ~6 h night — a raw clock subtraction reads it as ~29 h (a false
    // negative), which is what the mod-1440 normalization is for.
    const t = tripOf([
      day(0, { startTime: '16:00', stops: [stop({ id: 'long', visitMinutes: 600 })] }),
      day(1, { startTime: '08:00' }),
    ])
    const short = warn(collectWarnings(t))
    expect(short).toHaveLength(1)
    expect(short[0].severity).toBe('medium')
  })

  it('reads clocks, not stop counts — a late stopless travel day still counts', () => {
    // Nothing planned, but the day still drives out at 23:30 and the next one
    // wakes at 02:00. Silence here would be the dishonesty, not the warning.
    const t = tripOf([day(0, { startTime: '23:30' }), day(1, { startTime: '02:00' })])
    const short = warn(collectWarnings(t))
    expect(short).toHaveLength(1)
    expect(short[0].severity).toBe('high')
  })

  it('does not double-report the single-day case', () => {
    expect(warn(collectWarnings(tripOf([lateDay(0)])))).toHaveLength(0)
  })
})
