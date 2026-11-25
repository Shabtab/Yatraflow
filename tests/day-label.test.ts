// ============ A day header prints its number once (#995) ============
// A dated day shows a date badge, a "Day 3" kicker and the day's title. The
// title falls back to `Day <n>`, so an untitled dated day printed the same
// words twice, side by side. These cases pin the rule at the pure seam the
// component reads, because the duplicate was invisible to every other check.
import { describe, expect, it } from 'vitest'
import { dayHeaderLabel, defaultDayTitle } from '../src/pages/trip/timeline/dayLabel'

describe('dayHeaderLabel', () => {
  it('prints an untitled day once, with no kicker beside it', () => {
    expect(dayHeaderLabel(0, undefined)).toEqual({ number: null, title: 'Day 1' })
    expect(dayHeaderLabel(2, null)).toEqual({ number: null, title: 'Day 3' })
  })

  it('treats an empty or whitespace-only title as untitled', () => {
    expect(dayHeaderLabel(0, '')).toEqual({ number: null, title: 'Day 1' })
    expect(dayHeaderLabel(4, '   ')).toEqual({ number: null, title: 'Day 5' })
  })

  it('does not repeat a title that already says the day number', () => {
    expect(dayHeaderLabel(0, 'Day 1')).toEqual({ number: null, title: 'Day 1' })
    expect(dayHeaderLabel(1, 'day 2')).toEqual({ number: null, title: 'day 2' })
  })

  it('keeps the kicker for a custom title, and keeps the title verbatim', () => {
    expect(dayHeaderLabel(0, 'Panaji lanes')).toEqual({ number: 'Day 1', title: 'Panaji lanes' })
    expect(dayHeaderLabel(3, '  Back to Kochi  ')).toEqual({ number: 'Day 4', title: 'Back to Kochi' })
  })

  it('reads a custom title that only starts with the day number as custom', () => {
    expect(dayHeaderLabel(0, 'Day 1: Kochi arrival')).toEqual({ number: 'Day 1', title: 'Day 1: Kochi arrival' })
  })

  it('derives the default label from the 1-based day number', () => {
    expect(defaultDayTitle(0)).toBe('Day 1')
    expect(defaultDayTitle(9)).toBe('Day 10')
  })
})
