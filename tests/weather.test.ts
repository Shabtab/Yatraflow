// ============ Weather forecast-window regression tests ============
import { describe, it, expect } from 'vitest'
import { forecastAvailable } from '../src/lib/weather'

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
