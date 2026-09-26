// ============ Warning digest (#369) ============
// The Board grouped warnings by PARSING their rendered title and counted DAYS
// while the copy said “route days overloaded”. The digest consumes the engine's
// own identity (`dayIndex` through `groupWarnings`), counts warnings, keeps the
// trip-wide ones, and says “overloaded” only where the engine means it.
import { describe, expect, it } from 'vitest'
import { OVERLOAD_CODES, warningDigest, warningLines, worstSeverity } from '../src/lib/warningDigest'
import type { ScheduleWarning } from '../src/lib/engine'

const w = (
  code: string,
  severity: ScheduleWarning['severity'],
  dayIndex: number | null | undefined,
  title = `${code} title`,
): ScheduleWarning => ({ code, severity, dayIndex, title, detail: `${code} detail`, fix: `fix ${code}` })

describe('warningDigest', () => {
  it('surfaces opening-hours, commitment and travel warnings — none dropped', () => {
    const hours = w('hours', 'medium', 0, 'Taj Mahal: arrives before opening')
    const commitment = w('commitment', 'high', 1, 'Conflicts with Vrinda Express')
    const travel = w('travel', 'high', 0)
    const d = warningDigest([hours, commitment, travel])
    expect(d.total).toBe(3)
    expect(d.dayCount).toBe(2)
    expect(d.byDay.get(0)).toEqual([hours, travel])
    expect(d.byDay.get(1)).toEqual([commitment])
  })

  it('reserves “overloaded” for density / fatigue / travel days', () => {
    expect([...OVERLOAD_CODES].sort()).toEqual(['density', 'fatigue', 'travel'])
    const travel = w('travel', 'high', 0)
    const late = w('late-arrival', 'medium', 1)
    const meal = w('meals', 'medium', 1)
    const d = warningDigest([travel, late, meal])
    expect(d.overloadDays).toBe(1)
    expect(d.summary).toBe('3 warnings across 2 days · 1 overloaded')
    // Late and meal warnings are warnings to review — never “overloaded days”.
    const quiet = warningDigest([late, meal])
    expect(quiet.overloadDays).toBe(0)
    expect(quiet.summary).toBe('2 warnings across 1 day')
  })

  it('counts WARNINGS, not days, and keeps the trip-wide ones', () => {
    const hotels = w('hotels', 'low', null, 'Frequent accommodation changes')
    const d = warningDigest([hotels, w('hours', 'medium', 0)])
    expect(d.tripWide).toEqual([hotels])
    expect(d.total).toBe(2)
    expect(d.dayCount).toBe(1)
    expect(d.summary).toBe('2 warnings across 1 day')
    const only = warningDigest([hotels])
    expect(only.summary).toBe('1 trip-wide warning')
  })

  it('groups a legacy warning that predates `dayIndex` by its Day N prefix', () => {
    const legacy: ScheduleWarning = { code: 'custom', severity: 'low', title: 'Day 3: something', detail: '', fix: '' }
    const d = warningDigest([legacy])
    expect(d.byDay.get(2)).toEqual([legacy])
    expect(d.tripWide).toEqual([])
  })

  it('says nothing when there is nothing to say', () => {
    const d = warningDigest([])
    expect(d.total).toBe(0)
    expect(d.summary).toBe('')
    expect(d.overloadDays).toBe(0)
  })
})

describe('worstSeverity', () => {
  it('ranks the pill from the warnings themselves', () => {
    expect(worstSeverity([])).toBeNull()
    expect(worstSeverity([w('weather', 'low', 0)])).toBe('low')
    expect(worstSeverity([w('weather', 'low', 0), w('meals', 'medium', 0)])).toBe('medium')
    expect(worstSeverity([w('meals', 'medium', 0), w('commitment', 'high', 1)])).toBe('high')
  })
})

describe('warningLines', () => {
  it('reads out every warning with its detail and recommended fix', () => {
    const lines = warningLines([w('hours', 'medium', 0, 'Taj: arrives before opening')]).split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Taj: arrives before opening')
    expect(lines[0]).toContain('hours detail')
    expect(lines[0]).toContain('fix hours')
  })
})
