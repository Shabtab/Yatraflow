// ============ Weather forecast-window regression tests ============
import { describe, it, expect } from 'vitest'
import { forecastAvailable, isoAddDays } from '../src/lib/weather'

describe('forecastAvailable', () => {
  it('is available for a trip starting within 15 days', () => {
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
    expect(forecastAvailable(soon)).toBe(true)
  })
  it('is unavailable for a trip starting far in the future', () => {
    const far = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10)
    expect(forecastAvailable(far)).toBe(false)
  })
  it('does not flip on timezone offset (regression #6)', () => {
    // A trip starting "tomorrow" in a timezone behind UTC must still count as
    // within the window, not be pushed out by a local-time parse shift.
    const tomorrow = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10)
    expect(forecastAvailable(tomorrow)).toBe(true)
  })
})

describe('isoAddDays', () => {
  it('returns the same date for days=0 (no timezone shift)', () => {
    // Regression: toISOString() after a local-midnight parse shifted the date
    // back one day on positive-UTC-offset timezones (e.g. IST, +5:30).
    expect(isoAddDays('2026-08-31', 0)).toBe('2026-08-31')
  })
  it('adds one day correctly', () => {
    expect(isoAddDays('2026-08-31', 1)).toBe('2026-09-01')
  })
  it('handles month boundaries', () => {
    expect(isoAddDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(isoAddDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
