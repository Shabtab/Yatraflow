// ============ Signup date-of-birth picker ============
// Sign-up asks for a date of birth, where the year is the part that matters
// most. DobPicker offers direct Year/Month/Day selects. It keeps the
// 'YYYY-MM-DD' value the age gate reads. It forbids a future date. It never
// rolls a 31st or a Feb-29 into the next month.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DobPicker, daysInMonth, composeDob, parseDob, monthCeiling, dayCeiling, clampParts, resolveDob } from '../src/components/DobPicker'
import { isAdultSignup } from '../src/lib/ageGate'

// A fixed "today" so the future caps stay deterministic.
const MAX = '2026-10-18'

describe('dob date math', () => {
  it('counts each month end, including leap Februaries', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(daysInMonth(2026, 1)).toBe(31)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('never assembles a complete date from a partial pick', () => {
    expect(composeDob(0, 0, 0)).toBe('')
    expect(composeDob(1990, 0, 0)).toBe('')
    expect(composeDob(1990, 5, 0)).toBe('')
    expect(composeDob(1990, 5, 12)).toBe('1990-05-12')
  })

  it('parses values and rejects a malformed shape', () => {
    expect(parseDob('1990-05-12')).toEqual({ y: 1990, mo: 5, d: 12 })
    expect(parseDob('')).toBeNull()
    expect(parseDob('nope')).toBeNull()
    expect(parseDob('1990-5-12')).toBeNull() // single-digit month is the wrong shape
    // An impossible date keeps its shape here; the round-trip validity check is
    // ageGate's job (see age-gate.test.ts), not this parser's.
    expect(parseDob('1990-13-40')).toEqual({ y: 1990, mo: 13, d: 40 })
  })

  it('caps the day only inside the current month of the max year', () => {
    expect(dayCeiling(2020, 2, MAX)).toBe(29)  // a leap year, not the max month
    expect(dayCeiling(2026, 6, MAX)).toBe(30)  // a past month of the max year
    expect(dayCeiling(2026, 10, MAX)).toBe(18) // max year + month -> today
    expect(dayCeiling(2026, 12, MAX)).toBe(31) // raw month length; clampParts hides December
  })

  it('caps the month at today inside the max year', () => {
    expect(monthCeiling(1990, MAX)).toBe(12)
    expect(monthCeiling(2026, MAX)).toBe(10)
  })
})

describe('resolveDob — what the selects commit', () => {
  it('stays empty until all three parts are present', () => {
    expect(resolveDob(1990, 0, 0, MAX)).toBe('')
    expect(resolveDob(1990, 5, 0, MAX)).toBe('')
    expect(resolveDob(1990, 5, 12, MAX)).toBe('1990-05-12')
  })

  it('does not roll a 31st into the next month when the month shrinks', () => {
    expect(resolveDob(2020, 1, 31, MAX)).toBe('2020-01-31')
    expect(resolveDob(2020, 2, 31, MAX)).toBe('2020-02-29') // clamped, not 2020-03-02
    expect(resolveDob(2021, 2, 31, MAX)).toBe('2021-02-28')
    expect(resolveDob(2020, 4, 31, MAX)).toBe('2020-04-30')
  })

  it('clamps a Feb-29 birth when the year changes to a non-leap year', () => {
    expect(resolveDob(2024, 2, 29, MAX)).toBe('2024-02-29')
    expect(resolveDob(2026, 2, 29, MAX)).toBe('2026-02-28')
  })

  it('clamps the day at today inside the current month', () => {
    expect(resolveDob(2026, 10, 31, MAX)).toBe('2026-10-18')
    expect(resolveDob(2026, 10, 5, MAX)).toBe('2026-10-05')
  })

  it('F1: clamps a held later month when the year becomes the current year', () => {
    // 1990/December/31 then year -> 2026 must clamp month AND day together,
    // never emitting a future date or leaving a blank month select.
    expect(resolveDob(2026, 12, 31, MAX)).toBe('2026-10-18')
    expect(clampParts(2026, 12, 31, MAX)).toEqual({ y: 2026, mo: 10, d: 18 })
  })
})

function markup(value: string): string {
  return renderToStaticMarkup(createElement(DobPicker, { value, max: MAX, onChange: () => {} }))
}

describe('DobPicker markup', () => {
  it('renders a labeled Year/Month/Day group with bday autocomplete', () => {
    const html = markup('')
    // HTML attribute names are case-insensitive; React's SSR writes autoComplete.
    const low = html.toLowerCase()
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Date of birth"')
    expect(html).toContain('aria-label="Birth year"')
    expect(html).toContain('aria-label="Birth month"')
    expect(html).toContain('aria-label="Birth day"')
    expect(low).toContain('autocomplete="bday-year"')
    expect(low).toContain('autocomplete="bday-month"')
    expect(low).toContain('autocomplete="bday-day"')
  })

  it('offers no year past this year and no month past this month', () => {
    const html = markup('2026-06-15')
    expect(html).toContain('value="2026"') // the newest year on offer
    expect(html).not.toContain('value="2027"')
    expect(html).toContain('>June<')
    expect(html).toContain('>October<') // months stop at the current month
    expect(html).not.toContain('>November<')
    expect(html).not.toContain('>December<')
  })
})

describe('the 18+ gate stays the signup rule (no request is made)', () => {
  const today = new Date(2026, 9, 18) // 2026-10-18, local — matches MAX
  it('blocks an underage composed date', () => {
    expect(isAdultSignup('2010-01-01', today)).toBe(false) // 16
    expect(isAdultSignup('2008-10-19', today)).toBe(false) // 17, birthday tomorrow
  })
  it('allows an adult composed date', () => {
    expect(isAdultSignup('2008-10-18', today)).toBe(true) // exactly 18 today
    expect(isAdultSignup('1990-05-12', today)).toBe(true)
  })
  it('blocks an empty or partial date', () => {
    expect(isAdultSignup('', today)).toBe(false)
    expect(isAdultSignup('1990-05', today)).toBe(false)
  })
})

describe('the signup page wires the picker and keeps the gate', () => {
  const auth = readFileSync(new URL('../src/pages/Auth.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  it('renders the DobPicker and drops the native date input', () => {
    expect(auth).toContain('<DobPicker')
    expect(auth).not.toContain('type="date"')
  })
  it('keeps the 18+ check on the composed value', () => {
    expect(auth).toContain('if (!isAdultSignup(dob, new Date())) {')
  })
})
