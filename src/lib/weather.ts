// ============ Weather layer ============
// Daily forecasts per trip day via Open-Meteo (free, keyless, no usage caps
// for this scale). Forecasts are only reliable ~7-14 days out — beyond that
// we show "forecast unavailable" rather than inventing numbers.
export interface DayWeather {
  date: string            // ISO yyyy-mm-dd the forecast is FOR
  code: number            // WMO weather code
  tempMaxC: number
  tempMinC: number
  rainChancePct: number   // max precipitation probability that day
}

const WMO: Record<number, { icon: string; label: string }> = {
  0: { icon: '☀️', label: 'Clear sky' },
  1: { icon: '🌤️', label: 'Mostly clear' },
  2: { icon: '⛅', label: 'Partly cloudy' },
  3: { icon: '☁️', label: 'Overcast' },
  45: { icon: '🌫️', label: 'Fog' },
  48: { icon: '🌫️', label: 'Freezing fog' },
  51: { icon: '🌦️', label: 'Light drizzle' },
  53: { icon: '🌦️', label: 'Drizzle' },
  55: { icon: '🌦️', label: 'Heavy drizzle' },
  61: { icon: '🌧️', label: 'Light rain' },
  63: { icon: '🌧️', label: 'Rain' },
  65: { icon: '🌧️', label: 'Heavy rain' },
  66: { icon: '🧊', label: 'Freezing rain' },
  67: { icon: '🧊', label: 'Freezing rain' },
  71: { icon: '❄️', label: 'Light snow' },
  73: { icon: '❄️', label: 'Snow' },
  75: { icon: '❄️', label: 'Heavy snow' },
  80: { icon: '🌦️', label: 'Rain showers' },
  81: { icon: '🌦️', label: 'Showers' },
  82: { icon: '⛈️', label: 'Violent showers' },
  95: { icon: '⛈️', label: 'Thunderstorm' },
  96: { icon: '⛈️', label: 'Thunderstorm, hail' },
  99: { icon: '⛈️', label: 'Thunderstorm, hail' },
}

/** Icon + human label for a WMO weather code. */
export function wmoInfo(code: number): { icon: string; label: string } {
  return WMO[code] ?? { icon: '🌡️', label: '—' }
}

/** A real, finite number from the API — the honest guard against `?? 0`. */
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Fetch daily forecasts for a set of dates near one coordinate.
 * Returns a map of ISO date → forecast for the dates Open-Meteo could cover.
 *
 * Identical concurrent requests are coalesced onto one in-flight fetch
 * (module-level Map keyed on the request — same pattern as fetchTripIntoCache
 * in store.ts). Without this, N DayWeatherChips mounted for the same trip day
 * (plus the Overview weather card) each fired their own identical Open-Meteo
 * round-trip. The entry is cleared on settle — success or failure — so a
 * failed request is retried on the next mount rather than cached.
 */
const inflightWeather = new Map<string, Promise<Record<string, DayWeather>>>()
const weatherCache = new Map<string, { at: number; data: Record<string, DayWeather> }>()

/** How long a fetched forecast is served from cache before it is re-pulled.
 *  Matches the UI refresh cadence so an open tab stays current without
 *  hammering the API on every remount. */
export const WEATHER_TTL_MS = 5 * 60 * 1000

export function fetchDailyWeather(
  lat: number,
  lng: number,
  startDate: string,
  numDays: number,
  opts: { force?: boolean } = {},
): Promise<Record<string, DayWeather>> {
  const key = `${lat},${lng},${startDate},${numDays}`
  // Serve a fresh-enough cached result so remounts don't flash a spinner and
  // the chip + Overview + Map don't each hit the network for the same day.
  if (!opts.force) {
    const cached = weatherCache.get(key)
    if (cached && Date.now() - cached.at < WEATHER_TTL_MS) return Promise.resolve(cached.data)
  }
  const hit = inflightWeather.get(key)
  if (hit) return hit
  // Only successes are cached — a failed request is retried on the next call
  // rather than frozen as an empty result.
  const p = fetchDailyWeatherOnce(lat, lng, startDate, numDays).then(data => {
    weatherCache.set(key, { at: Date.now(), data })
    return data
  })
  inflightWeather.set(key, p)
  const settle = () => { inflightWeather.delete(key) }
  p.then(settle, settle)
  return p
}

async function fetchDailyWeatherOnce(
  lat: number,
  lng: number,
  startDate: string,
  numDays: number,
): Promise<Record<string, DayWeather>> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&start_date=${startDate}&end_date=${isoAddDays(startDate, Math.max(0, numDays - 1))}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`weather ${res.status}`)
  const data = await res.json()
  const d = data.daily ?? {}
  const out: Record<string, DayWeather> = {}
  const times: string[] = d.time ?? []
  for (let i = 0; i < times.length; i++) {
    const tMax = d.temperature_2m_max?.[i]
    const tMin = d.temperature_2m_min?.[i]
    const rain = d.precipitation_probability_max?.[i]
    const code = d.weather_code?.[i]
    // Publish a day ONLY when we have real numbers for it. The old `?? 0`
    // fallbacks turned a missing field into a confident "0°C / 0%", which is
    // fabricated data; a day we cannot fully read is left absent, so the chip
    // and card render nothing for it rather than inventing a forecast.
    if (!isNum(tMax) || !isNum(tMin) || !isNum(rain)) continue
    out[times[i]] = {
      date: times[i],
      code: isNum(code) ? code : -1,
      tempMaxC: tMax,
      tempMinC: tMin,
      rainChancePct: rain,
    }
  }
  return out
}

/** The device's calendar day as an ISO date — the living plan's "now" (Phase 1).
 *  Local getters, never toISOString (see isoAddDays' note): on +5:30 the UTC
 *  date lags the wall calendar by a day after 18:30. */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** True when the trip start is within Open-Meteo's reliable forecast window. */
export function forecastAvailable(startDate: string): boolean {
  // Parse both dates at UTC midnight so the diff is a true whole-day count
  // and does not shift by the local timezone (bug #6).
  const today = new Date()
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const [y, m, d] = startDate.split('-').map(Number)
  const startUtc = Date.UTC(y, m - 1, d)
  const diffDays = Math.round((startUtc - todayUtc) / 86400000)
  return diffDays <= 15
}

/**
 * WHERE a day's forecast is for: the day's own first placed stop with finite
 * coordinates (#340). The chip used to ask about the trip's very first stop for
 * every day — Day 4 in the mountains showed the beach city's sun — and the
 * `?? 10.5, 76.5` fallback behind it invented a city rather than admitting the
 * day had no anchor.
 *
 * Returns null when the day has none: a transit day, or a day whose stops never
 * geocoded. The chip then renders nothing — an honest absence beats another
 * city's weather. Rejected stops are skipped (they are not visited) and the
 * first stop WINS over a centroid: averaging cities across a long day puts the
 * forecast in the sea between them (the same reason the corridor scan does not
 * blend anchors).
 */
export function weatherAnchor(day: { stops: Array<{ lat: number; lng: number; status?: string; orderInDay: number }> }): { lat: number; lng: number } | null {
  const placed = [...day.stops]
    .filter(s => s.status !== 'rejected')
    .sort((a, b) => a.orderInDay - b.orderInDay)
  for (const s of placed) {
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) return { lat: s.lat, lng: s.lng }
  }
  return null
}

export function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00')
  d.setDate(d.getDate() + days)
  // Format from LOCAL getters — toISOString() shifts the date back a day on
  // positive-UTC-offset timezones (e.g. IST, +5:30) because the local-midnight
  // timestamp converts to a UTC date that is one calendar day behind.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
