// ============ Weather forecast-window regression tests ============
import { describe, it, expect } from 'vitest'
import { forecastAvailable, isoAddDays, weatherAnchor } from '../src/lib/weather'

/** Minimal day shape — the resolver only reads the stop list. */
const day = (stops: Array<{ lat: number; lng: number; status?: string; orderInDay: number }>) => ({ stops })

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

describe('weatherAnchor (#340)', () => {
  it('answers with the day\'s OWN first stop, not the trip\'s', () => {
    // the exact broken case: Day 4 in the mountains must not show Day 1's beach
    const mountains = day([
      { lat: 11.41, lng: 76.69, orderInDay: 2, status: 'confirmed' },
      { lat: 11.50, lng: 76.80, orderInDay: 1, status: 'confirmed' },
    ])
    expect(weatherAnchor(mountains)).toEqual({ lat: 11.50, lng: 76.80 })
  })

  it('is null for a day with no stops — no chip beats another city\'s weather', () => {
    expect(weatherAnchor(day([]))).toBeNull()
  })

  it('is null when every stop lacks finite coordinates (never a guess city)', () => {
    expect(weatherAnchor(day([{ lat: NaN, lng: 76.5, orderInDay: 1 }]))).toBeNull()
    expect(weatherAnchor(day([{ lat: 10.5, lng: Infinity, orderInDay: 1 }]))).toBeNull()
  })

  it('skips a rejected stop and a non-finite one, in order', () => {
    expect(weatherAnchor(day([
      { lat: 10.1, lng: 76.1, orderInDay: 1, status: 'rejected' },
      { lat: NaN, lng: 76.2, orderInDay: 2 },
      { lat: 10.3, lng: 76.3, orderInDay: 3 },
    ]))).toEqual({ lat: 10.3, lng: 76.3 })
  })

  it('does not average two cities into the sea between them', () => {
    // first-stop-wins is the documented choice: a centroid of two far-apart
    // stops lands between them, which is nowhere the traveller will be
    const spread = weatherAnchor(day([
      { lat: 9.93, lng: 76.26, orderInDay: 1 },
      { lat: 15.50, lng: 73.80, orderInDay: 2 },
    ]))
    expect(spread).toEqual({ lat: 9.93, lng: 76.26 })
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
