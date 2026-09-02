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

/**
 * Fetch daily forecasts for a set of dates near one coordinate.
 * Returns a map of ISO date → forecast for the dates Open-Meteo could cover.
 */
export async function fetchDailyWeather(
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
    out[times[i]] = {
      date: times[i],
      code: d.weather_code?.[i] ?? -1,
      tempMaxC: d.temperature_2m_max?.[i] ?? 0,
      tempMinC: d.temperature_2m_min?.[i] ?? 0,
      rainChancePct: d.precipitation_probability_max?.[i] ?? 0,
    }
  }
  return out
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

export function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00')
  d.setDate(d.getDate() + days)
  // Format from LOCAL getters — toISOString() shifts the date back a day on
  // positive-UTC-offset timezones (e.g. IST, +5:30) because the local-midnight
  // timestamp converts to a UTC date that is one calendar day behind.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
