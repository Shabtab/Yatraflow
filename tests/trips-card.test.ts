// ============ My trips cards — pure text helpers ============
import { describe, expect, it } from 'vitest'
import { gridShape, meterPercent, routeLine, startOfLocalDay, travelHoursText } from '../src/lib/tripsCard'
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

describe('gridShape', () => {
  it('never asks for more columns than cards', () => {
    expect(gridShape(1, true)).toMatchObject({ columnsTwo: 1, columnsThree: 1 })
    expect(gridShape(2, true)).toMatchObject({ columnsTwo: 2, columnsThree: 2 })
    expect(gridShape(9, true)).toMatchObject({ columnsTwo: 2, columnsThree: 3 })
  })
  it('keeps one column for an empty grid', () => {
    expect(gridShape(0, true)).toMatchObject({ columnsTwo: 1, columnsThree: 1 })
  })
  it('flags a lone last card in the two-column grid', () => {
    expect(gridShape(3, true).loneLastTwo).toBe(true)
    expect(gridShape(4, true).loneLastTwo).toBe(false)
    expect(gridShape(2, true).loneLastTwo).toBe(false)
  })
  it('flags a lone last card in the three-column grid', () => {
    expect(gridShape(4, true).loneLastThree).toBe(true)
    expect(gridShape(7, true).loneLastThree).toBe(true)
    expect(gridShape(6, true).loneLastThree).toBe(false)
    expect(gridShape(3, true).loneLastThree).toBe(false)
  })
  it('never flags the list layout', () => {
    expect(gridShape(5, false)).toMatchObject({ loneLastTwo: false, loneLastThree: false })
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
