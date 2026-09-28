// ============ Rain, the road polyline and the journey budget (pure) ============
// #420 slice 6. Five rules that used to live inline in MapTab — a 2,710-line
// component whose closures you had to hold in your head to review one of them.
// Each rule decides a number the plan then spends:
//
//  - WHICH stops the weather join may average. A rejected stop, or one whose
//    geocode never resolved, must not drag the trip's centre to Null Island —
//    the forecast that comes back would be for open ocean.
//  - WHEN the join stays empty rather than guessing: no usable stop at all, or a
//    start date past the forecast horizon. Empty is honest here; a fabricated
//    rain figure is not (it damps the day's cap either way).
//  - WHAT the route polyline is. OSRM hands back `[lng, lat]` pairs while every
//    consumer on this tab walks `{lat, lng}`, so the swap is the whole rule —
//    get it wrong and the detour math measures a corridor in the Arabian Sea.
//  - WHICH journey total the fatigue math spends: OSRM's road total once it has
//    resolved, but not a token one (a 3 km "road total" is a failed measure, not
//    a short trip), and the summed estimate until then.
//  - WHEN rain is drizzle-grade rather than a storm (#141). The cap damps gently
//    for the former and fully for the latter, and the two arrive as one
//    percentage — only the WMO code tells them apart.
//
// Pure and node-testable: the date walk, the forecast-availability probe and the
// forecast rows all arrive as inputs, so this module imports neither lib/weather
// nor the engine, and a test can state a horizon without a network.

export type LatLng = { lat: number; lng: number }

/** The trust floor for OSRM's road total, in km. Below this the measure is a
 *  failure (a partial route, a snapped-to-nothing request) and the summed
 *  estimate is the better number to spend. */
export const ROAD_TOTAL_MIN_KM = 90

/** #141: the rain chance at which a drizzle code starts to matter. */
export const DRIZZLE_MIN_CHANCE_PCT = 40

/** #141: the WMO band that means drizzle-or-light-rain — damped gently. Codes
 *  below it are cloud, codes above it are storms (damped fully by the caller). */
export const WMO_DRIZZLE_MIN = 51
export const WMO_DRIZZLE_MAX = 63

export type WeatherStop = { lat: number; lng: number; status?: string }

/** A stop the weather join may use: not rejected, and actually geocoded. */
function usableStop(s: WeatherStop): boolean {
  return s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng)
}

/**
 * The centre the daily forecast is asked about: the mean of the trip's usable
 * stops, or null when the trip has none.
 *
 * The mean is a compromise the join lives with — one forecast point for a whole
 * corridor — and it is only as good as the stops it averages, which is why the
 * filter above is part of the rule rather than the caller's business.
 */
export function weatherAnchorFrom(stops: readonly WeatherStop[]): LatLng | null {
  let lat = 0
  let lng = 0
  let n = 0
  for (const s of stops) {
    if (!usableStop(s)) continue
    lat += s.lat
    lng += s.lng
    n += 1
  }
  if (n === 0) return null
  return { lat: lat / n, lng: lng / n }
}

export type WeatherFetchRefusal = {
  kind: 'no-stops' | 'no-forecast'
  /** what the caller may log; the tab shows nothing — an empty join is enough */
  reason: string
}

/**
 * Why the weather join cannot be fetched, or null when it can.
 *
 * Two refusals: there is no usable stop to centre on, or the trip's start date is
 * past the forecast horizon. Both leave BOTH arrays null together — a rain figure
 * without its code would let the cap multiplier read a chance it cannot classify,
 * and #141's whole point is that those two must travel as a pair.
 */
export function weatherFetchRefusal(input: {
  stops: readonly WeatherStop[]
  startDate: string
  forecastAvailable: (iso: string) => boolean
}): WeatherFetchRefusal | null {
  const { stops, startDate, forecastAvailable } = input
  if (weatherAnchorFrom(stops) == null) {
    return { kind: 'no-stops', reason: 'the trip has no geocoded stop to centre a forecast on' }
  }
  if (!forecastAvailable(startDate)) {
    return { kind: 'no-forecast', reason: `no forecast covers ${startDate} yet` }
  }
  return null
}

/**
 * OSRM's route geometry as the polyline this tab walks, or null when there is
 * nothing worth walking.
 *
 * `routeGeometry` is `[lng, lat]` pairs (GeoJSON order); every consumer here —
 * the detour measure, the return filter, the along-route distances — reads
 * `{lat, lng}`. Non-finite pairs are dropped rather than propagated, and a
 * polyline needs two points to have a direction at all: one surviving point is
 * null, not a degenerate line.
 */
export function routePolylineFrom(
  geometry: readonly (readonly number[])[] | null | undefined,
): LatLng[] | null {
  if (!geometry) return null
  const pts: LatLng[] = []
  for (const pair of geometry) {
    const lng = pair?.[0]
    const lat = pair?.[1]
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    pts.push({ lat, lng })
  }
  return pts.length >= 2 ? pts : null
}

/**
 * The journey budget the fatigue math spends: OSRM's road total when it resolved
 * and clears the trust floor, otherwise the journey-summed estimate.
 *
 * A falsy or non-finite total is a failed measure, never the number zero — the
 * caller's estimate is the honest fallback for all three cases.
 */
export function journeyKmFrom(
  routeTotalKm: number | null | undefined,
  fallbackKm: number,
): number {
  if (routeTotalKm == null || !Number.isFinite(routeTotalKm)) return fallbackKm
  return routeTotalKm >= ROAD_TOTAL_MIN_KM ? routeTotalKm : fallbackKm
}

export type DayForecastRow = { rainChancePct?: number | null; code?: number | null }
export type DayWeatherJoin = { rainPct: (number | null)[]; codes: (number | null)[] }

/**
 * The forecast rows keyed by ISO date, joined onto the trip's days by index.
 *
 * One entry per day, in day order, with a missing date reading null in BOTH
 * columns rather than borrowing a neighbour's weather. `isoAddDays` is injected
 * so this stays a pure function: the caller owns what "day 3" means, and a test
 * can pin the walk without a calendar.
 */
export function dayWeatherJoin(input: {
  dayCount: number
  startDate: string
  byDate: Readonly<Record<string, DayForecastRow | undefined>>
  isoAddDays: (iso: string, days: number) => string
}): DayWeatherJoin {
  const { dayCount, startDate, byDate, isoAddDays } = input
  const rainPct: (number | null)[] = []
  const codes: (number | null)[] = []
  const days = Math.max(0, Math.floor(dayCount))
  for (let i = 0; i < days; i += 1) {
    const row = byDate[isoAddDays(startDate, i)]
    rainPct.push(row?.rainChancePct ?? null)
    codes.push(row?.code ?? null)
  }
  return { rainPct, codes }
}

/**
 * The first trip day whose rain is drizzle-grade, or -1.
 *
 * #141: a drizzle is a real damper and a storm is a different one, and they can
 * arrive as the same percentage. The chance must clear `DRIZZLE_MIN_CHANCE_PCT`
 * AND the code must sit in the drizzle band — either one alone is not the rule,
 * which is exactly the sort of two-part condition that reads as one part at 2am.
 * Ragged input is fine: a day with no code is simply not a drizzle day.
 */
export function drizzleDayIndex(
  rainPct: readonly (number | null)[] | null | undefined,
  codes: readonly (number | null)[] | null | undefined,
): number {
  if (!rainPct) return -1
  for (let i = 0; i < rainPct.length; i += 1) {
    const p = rainPct[i]
    const c = codes?.[i]
    if (p == null || c == null) continue
    if (p >= DRIZZLE_MIN_CHANCE_PCT && c >= WMO_DRIZZLE_MIN && c <= WMO_DRIZZLE_MAX) return i
  }
  return -1
}
