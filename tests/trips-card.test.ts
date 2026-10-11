// ============ My trips cards — pure text helpers ============
import { describe, expect, it } from 'vitest'
import { layoutFromPref, meterLabel, meterPercent, routeLine, startOfLocalDay, travelHoursText } from '../src/lib/tripsCard'
import type { ItineraryDay } from '../src/data/types'

const days = (count: number) => Array.from({ length: count }, () => ({ stops: [] }) as unknown as ItineraryDay)

describe('routeLine', () => {
  it('joins the start place, the last destination and the day count', () => {
    const line = routeLine({ startLocation: 'Kochi', destinations: ['Munnar', 'Alleppey'], days: days(4) })
    expect(line).toBe('Kochi → Alleppey · 4 days')
  })
  it('uses the singular for one day', () => {
    expect(routeLine({ startLocation: 'Goa', destinations: ['Goa'], days: days(1) })).toBe('Goa → Goa · 1 day')
  })
  it('ends at the start place when there are no destinations', () => {
    expect(routeLine({ startLocation: 'Pune', destinations: [], days: days(0) })).toBe('Pune → Pune · 0 days')
  })
})

describe('travelHoursText', () => {
  it('rounds minutes to whole hours', () => {
    expect(travelHoursText(767)).toBe('13h')
    expect(travelHoursText(170)).toBe('3h')
    expect(travelHoursText(0)).toBe('0h')
  })
  it('does not print NaN for a bad number', () => {
    expect(travelHoursText(Number.NaN)).toBe('0h')
  })
})

describe('meterPercent', () => {
  it('returns a whole percent', () => {
    expect(meterPercent(1, 3)).toBe(33)
    expect(meterPercent(3, 3)).toBe(100)
  })
  it('stays inside 0 to 100', () => {
    expect(meterPercent(0, 0)).toBe(0)
    expect(meterPercent(5, 3)).toBe(100)
    expect(meterPercent(-1, 3)).toBe(0)
  })
})

describe('meterLabel', () => {
  it('names the planned days out of the total, with the plural verb', () => {
    expect(meterLabel(3, 5)).toBe('3 of 5 days have activities')
  })
  it('reads zero planned of several days as plural', () => {
    expect(meterLabel(0, 3)).toBe('0 of 3 days have activities')
  })
  it('uses the singular noun and verb for one day', () => {
    expect(meterLabel(1, 1)).toBe('1 of 1 day has activities')
    expect(meterLabel(0, 1)).toBe('0 of 1 day has activities')
  })
  it('says there are no days yet when the trip has none', () => {
    expect(meterLabel(0, 0)).toBe('No days yet')
  })
})

describe('startOfLocalDay', () => {
  it('gives the same value for any time on one local day', () => {
    const morning = new Date(2026, 9, 10, 0, 5, 0)
    const night = new Date(2026, 9, 10, 23, 59, 59)
    expect(startOfLocalDay(morning)).toBe(startOfLocalDay(night))
    expect(startOfLocalDay(morning)).toBe(new Date(2026, 9, 10).getTime())
  })
  it('moves on at local midnight', () => {
    expect(startOfLocalDay(new Date(2026, 9, 11, 0, 0, 1))).toBeGreaterThan(startOfLocalDay(new Date(2026, 9, 10, 23, 59, 59)))
  })
})

describe('layoutFromPref', () => {
  it('reads a stored list as the list layout', () => {
    expect(layoutFromPref('list')).toBe('list')
  })
  it('reads the grid, and anything that names no layout, as the grid', () => {
    expect(layoutFromPref('grid')).toBe('grid')
    expect(layoutFromPref('table')).toBe('grid')
    expect(layoutFromPref('')).toBe('grid')
    expect(layoutFromPref(null)).toBe('grid')
    expect(layoutFromPref(undefined)).toBe('grid')
  })
})
