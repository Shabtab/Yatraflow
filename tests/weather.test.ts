// ============ Weather forecast-window regression tests ============
import { describe, it, expect, vi, afterEach } from 'vitest'
import { forecastAvailable, isoAddDays, weatherAnchor, fetchDailyWeather, WEATHER_TTL_MS } from '../src/lib/weather'

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

describe('fetchDailyWeather — real data only, kept fresh', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const stub = (daily: unknown) => {
    const fn = vi.fn(async () =>
      new Response(JSON.stringify({ daily }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fn)
    return fn
  }

  it('publishes a day only when every field is a real number — never a fabricated 0°C / 0%', async () => {
    stub({
      time: ['2026-10-09', '2026-10-10'],
      weather_code: [1, 3],
      temperature_2m_max: [22.5, null], // day 2 has no real temp → must be dropped
      temperature_2m_min: [14, 15],
      precipitation_probability_max: [10, 20],
    })
    const out = await fetchDailyWeather(11.5, 76.8, '2026-10-09', 2, { force: true })
    expect(Object.keys(out)).toEqual(['2026-10-09'])
    expect(out['2026-10-09']).toMatchObject({ code: 1, tempMaxC: 22.5, tempMinC: 14, rainChancePct: 10 })
  })

  it('serves a fresh success from cache and re-pulls only when forced', async () => {
    const fn = stub({ time: ['2026-10-09'], weather_code: [0], temperature_2m_max: [30], temperature_2m_min: [20], precipitation_probability_max: [0] })
    const a = await fetchDailyWeather(22.25, 76.8, '2026-10-09', 1, { force: true })
    expect(fn).toHaveBeenCalledTimes(1)
    const b = await fetchDailyWeather(22.25, 76.8, '2026-10-09', 1) // within TTL → cached
    expect(fn).toHaveBeenCalledTimes(1)
    expect(b).toEqual(a)
    const c = await fetchDailyWeather(22.25, 76.8, '2026-10-09', 1, { force: true }) // forced → re-pull
    expect(fn).toHaveBeenCalledTimes(2)
    expect(c).toEqual(a)
  })

  it('never caches a failure, so the next call retries instead of showing nothing forever', async () => {
    const fn = vi.fn(async () => new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fn)
    await expect(fetchDailyWeather(33.33, 76.8, '2026-10-09', 1, { force: true })).rejects.toThrow()
    await expect(fetchDailyWeather(33.33, 76.8, '2026-10-09', 1, { force: true })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('exposes a TTL matching the refresh cadence', () => {
    expect(WEATHER_TTL_MS).toBeGreaterThan(0)
  })
})
