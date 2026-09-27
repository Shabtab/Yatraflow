// ============ Scheduling & impact engine ============
// All outputs are transparent estimates. Nothing here claims live data.
import type { Trip, ItineraryStop, ItineraryDay, ID, TravelStyle } from '../data/types'
import { haversineKm } from './geo'
import { STAY_RATE_PER_NIGHT } from './rates'

export interface EngineAssumptions {
  mode: string
  avgSpeedKmph: number
  bufferMinutesPerStop: number
  mealBreakMinutes: number
  dayStart: string
  dayEnd: string
  inrPerKm?: number
  /** user-stated fuel economy (km/L) — present only when it drives inrPerKm */
  kmPerLiter?: number
  /** effective fuel price behind the economy-derived inrPerKm (user's local pump price or the indicative default) */
  fuelPricePerL?: number
  /** true when fuelPricePerL came from the user rather than the indicative default */
  fuelPriceIsUserSet?: boolean
}

/** Average door-to-door speed per mode (km/h) — shared by the scheduling
 *  engine and the Landing page's Plan Bench (issue #37). */
export const MODE_SPEED: Record<string, number> = {
  car: 42, rental: 42, motorcycle: 44, taxi: 38, bus: 34, train: 55, flight: 320, mixed: 45,
}
/** Blended all-in ₹/km rate per mode when no fuel economy is stated. */
export const MODE_COST_PER_KM: Record<string, number> = {
  car: 9, rental: 7.5, motorcycle: 4.5, taxi: 16, bus: 2.2, train: 1.6, flight: 6.5, mixed: 8,
}

/**
 * Indicative all-India petrol price (₹/litre) used when a trip states its fuel
 * economy. Deliberately surfaced (Budget tab, field hints, StopEditor) — never
 * presented as live data, per the transparency promise.
 */
export const FUEL_PRICE_INR_PER_L = 105

/** Indicative car fuel economy (km/L) used wherever a headline "what if" number
 *  is needed before the traveller states their own — the Plan Bench's slider
 *  default, Create Trip's placeholder, and Trip settings' dial when mileage is
 *  unset. It used to be 15 in two places and 18 in a third (#213 Phase 5). */
export const DEFAULT_FUEL_ECONOMY_KML = 15

/** Ground modes whose road measurements are meaningful to the map. */
export const ROAD_MEASURED_MODES = ['car', 'rental', 'motorcycle', 'taxi', 'bus', 'mixed'] as const

/** True when the trip mode receives road measurements/corrections. */
export function isRoadMeasuredMode(mode: string): boolean {
  return (ROAD_MEASURED_MODES as readonly string[]).includes(mode)
}

/** Modes where the vehicle's own fuel economy meaningfully sets the ₹/km rate. */
const FUEL_ECONOMY_MODES = new Set<string>(['car', 'rental', 'motorcycle'])

/** True when the trip mode benefits from a user-stated fuel economy. */
export function isFuelEconomyMode(mode: string): boolean {
  return FUEL_ECONOMY_MODES.has(mode)
}

/**
 * Parse a fuel-economy form input into a sane km/L number, or undefined when
 * blank/implausible (cars do ~12–25 km/L, bikes ~25–45; anything outside
 * 2–80 is a typo, not a vehicle).
 */
export function parseFuelEconomyKmL(raw: string | number | undefined | null): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  return Number.isFinite(n) && n >= 2 && n <= 80 ? n : undefined
}

/** Soft plausibility bands (hard acceptance stays 2–80) — used to nudge, never to block. */
const PLAUSIBLE_KM_PER_L: Record<string, [number, number]> = { car: [8, 35], rental: [8, 35], motorcycle: [12, 75] }

/** True when a stated economy is outside the typical band for the mode — a nudge, not a veto. */
export function isImplausibleFuelEconomy(mode: string, economy: number | undefined): boolean {
  const band = PLAUSIBLE_KM_PER_L[mode]
  return !!band && !!economy && economy > 0 && (economy < band[0] || economy > band[1])
}

/**
 * True when the route should also price the drive back to its start. Defaults
 * to on for self-drive modes (the overwhelmingly common case) — one-way drives
 * opt out explicitly via trip.roundTrip === false.
 */
export function isRoundTrip(trip: Pick<Trip, 'transportMode' | 'roundTrip'>): boolean {
  return isRoadMeasuredMode(trip.transportMode) && trip.roundTrip !== false
}

/**
 * Parse a fuel-price form input (₹/L) into a sane number, or undefined when
 * blank/implausible. A generous 50–250 band covers petrol, diesel and CNG
 * across Indian states without accepting typos.
 */
export function parseFuelPricePerL(raw: string | number | undefined | null): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  return Number.isFinite(n) && n >= 50 && n <= 250 ? n : undefined
}

/** Default planning assumptions shown to users wherever we estimate. */
export function getAssumptions(trip: Pick<Trip, 'transportMode' | 'fuelEconomyKmL' | 'fuelPricePerL'>): EngineAssumptions {
  const mode = trip.transportMode
  const base: EngineAssumptions = {
    mode,
    avgSpeedKmph: MODE_SPEED[mode] ?? 40,
    bufferMinutesPerStop: 15,
    mealBreakMinutes: 60,
    dayStart: '08:30',
    dayEnd: '20:00',
    inrPerKm: MODE_COST_PER_KM[mode],
  }
  // A stated fuel economy beats the blended ₹/km table for self-drive modes:
  // litres burned = distance ÷ economy, so ₹/km = price-per-litre ÷ economy.
  // The price itself is the user's local pump price when stated, else the
  // indicative national average.
  // Validate through parseFuelEconomyKmL so impossible values (e.g. 1 km/L or
  // 500 km/L) are rejected and we fall back to the blended ₹/km table instead
  // of producing a wildly wrong fuel cost / round-trip estimate.
  const economy = parseFuelEconomyKmL(trip.fuelEconomyKmL)
  if (economy && economy > 0 && FUEL_ECONOMY_MODES.has(mode)) {
    const userPrice = parseFuelPricePerL(trip.fuelPricePerL)
    const price = userPrice ?? FUEL_PRICE_INR_PER_L
    return {
      ...base,
      kmPerLiter: economy,
      fuelPricePerL: price,
      fuelPriceIsUserSet: userPrice != null,
      inrPerKm: Math.round((price / economy) * 100) / 100,
    }
  }
  return base
}

export function minutesToHM(mins: number): string {
  // Last-resort display guard: a non-finite input (broken upstream number)
  // would render as "NaNh NaNm" — show an em dash instead of nonsense.
  if (!Number.isFinite(mins)) return '—'
  const m = Math.max(0, Math.round(mins))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** One duration formatter for short rail numbers (detours, dwell): "45 min"
 *  under an hour (minutesToHM's "0h 45m" reads wrong there), minutesToHM
 *  above. #171 — three duration formats used to share one screen. */
export function fmtDur(mins: number): string {
  if (!Number.isFinite(mins)) return '—'
  const m = Math.max(0, Math.round(mins))
  if (m < 60) return `${m} min`
  return minutesToHM(m)
}

export function hmToMinutes(hm: string): number {
  if (!hm || !hm.includes(':')) return 0
  const [h, m] = hm.split(':').map(Number)
  // Corrupt values ("25:99", "9:99") must never silently become a real time —
  // clamp to the valid wall-clock range (#136). A fat-fingered 25:99 reads as
  // 23:59 and the planner's own defer verdict tells the user something's off.
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  const hh = Math.min(23, Math.max(0, Math.floor(h)))
  const mm = Math.min(59, Math.max(0, Math.floor(m)))
  return hh * 60 + mm
}

export function addMinutesToClock(startMin: number, mins: number): string {
  let t = startMin + Math.round(mins)
  t = ((t % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export interface LegEstimate {
  distanceKm: number
  durationMinutes: number
  /** Road geometry for this leg as [lng, lat][], present only when the estimate
   *  came from a routing provider (Google Routes / OSRM). The haversine
   *  fallback has no road shape — consumers must treat it as optional. */
  geometry?: [number, number][]
}

/** Canonical key for a leg between two points (used by the OSRM refinement layer). */
export function legKey(a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
  return `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`
}

/** Distance/duration between two points using demo coordinates (haversine × road factor). */
export function legBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  assumptions: EngineAssumptions,
): LegEstimate {
  const straight = haversineKm(a.lat, a.lng, b.lat, b.lng)
  const roadFactor = 1.25 // roads rarely follow great circles
  const dist = straight * roadFactor
  const dur = (dist / assumptions.avgSpeedKmph) * 60 + 10 // +10 min city-traffic pad per leg
  return { distanceKm: dist, durationMinutes: dur }
}

// ---------------- Day schedule simulation ----------------

export interface ScheduledLeg {
  fromTitle: string
  toTitle: string
  distanceKm: number
  durationMinutes: number
}

export interface DaySchedule {
  dayIndex: number
  startsAt: string           // clock the day starts (per-day override or default)
  arrivalTimes: string[]     // per stop (active stops only)
  departures: string[]
  legs: ScheduledLeg[]
  totalTravelMinutes: number
  totalDistanceKm: number
  activeStops: ItineraryStop[]
  endsAt: string
  /** true when the day's journey already ends back at the trip's start (planned return drive) */
  endsAtStart: boolean
  /** stop time (visit minutes + per-stop buffers) — driving time lives in totalTravelMinutes */
  dwellMinutes: number
}

/**
 * Simulate one day's schedule: arrivals, departures, legs. Rejected stops are
 * skipped. Thin adapter over buildJourney — the day's full journey (including
 * the drive to its destination, or back home on a return day) is what the
 * schedule now describes, so the timeline, warnings, totals and the impact
 * preview all see the same numbers.
 */
export function simulateDay(
  day: { stops: ItineraryStop[]; startTime?: string },
  trip: Trip,
  startOrigin: { lat: number; lng: number },
  dayIndex: number,
  legCorrections?: Record<string, LegEstimate>,
): DaySchedule {
  const j = buildJourney(trip, { ...day, index: dayIndex }, legCorrections, startOrigin)
  // Timeline rows: every stored stop, plus the engine-added destination
  // anchor when the journey needs one. The synthesized START (where the
  // traveller wakes up that morning) is journey context, not a row.
  const rows = j.points.filter(p => !p.synthesized || p.kind === 'destination')
  return {
    dayIndex,
    startsAt: j.startTime,
    arrivalTimes: rows.map(p => p.arrive),
    departures: rows.map(p => p.depart),
    legs: rows.map(p => p.legIn ?? { fromTitle: j.startTitle, toTitle: j.startTitle, distanceKm: 0, durationMinutes: 0 }),
    totalTravelMinutes: j.driveMinutes,
    totalDistanceKm: j.distanceKm,
    activeStops: rows.map(p => p.stop),
    endsAt: rows.length ? rows[rows.length - 1].depart : j.startTime,
    endsAtStart: j.endsAtStart,
    dwellMinutes: j.dwellMinutes,
  }
}

// ---------------- Leg-aware stop insertion ----------------

/** Where you'd be coming from / heading to when inserting a stop on a day. */
export interface LegAnchor {
  name: string
  point: { lat: number; lng: number }
}

/**
 * Current location before the insertion point of `dayIndex`: the last active
 * stop of that day, else the last stop of the nearest previous day, else the
 * trip's geocoded start anchor (point A).
 */
export function predecessorOf(trip: Trip, dayIndex: number): LegAnchor | null {
  const day = trip.days.find(d => d.index === dayIndex)
  if (day) {
    const active = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
    const last = active[active.length - 1]
    if (last) return { name: last.locationName || last.title, point: { lat: last.lat, lng: last.lng } }
  }
  for (let d = dayIndex - 1; d >= 0; d--) {
    const stops = trip.days.find(x => x.index === d)?.stops.filter(s => s.status !== 'rejected') ?? []
    if (stops.length) {
      const last = [...stops].sort((a, b) => a.orderInDay - b.orderInDay)[stops.length - 1]
      return { name: last.locationName || last.title, point: { lat: last.lat, lng: last.lng } }
    }
  }
  if (trip.startLocationCoords) {
    return { name: `${trip.startLocation} (start)`, point: { lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng } }
  }
  return null
}

/**
 * Next destination after the insertion point of `dayIndex`: the first stop of
 * the nearest later day, else the trip's final geocoded destination anchor.
 */
export function nextAfter(trip: Trip, dayIndex: number): LegAnchor | null {
  for (let d = dayIndex + 1; d < trip.days.length; d++) {
    const stops = trip.days.find(x => x.index === d)?.stops.filter(s => s.status !== 'rejected') ?? []
    if (stops.length) {
      const first = [...stops].sort((a, b) => a.orderInDay - b.orderInDay)[0]
      return { name: first.locationName || first.title, point: { lat: first.lat, lng: first.lng } }
    }
  }
  if (trip.destinationCoords?.length) {
    for (let i = trip.destinationCoords.length - 1; i >= 0; i--) {
      const c = trip.destinationCoords[i]
      const name = trip.destinations[i]
      if (c && name) return { name: `${name} (end)`, point: { lat: c.lat, lng: c.lng } }
    }
  }
  return null
}

// ---------------- Unified day journey ----------------
// Every day is ONE journey — a start point, optional halts and visits, and a
// destination with a clock arrival — no matter the distance or mode. This
// single model replaced the old split (plain stop-chain vs ≥350 km "route
// day" overlay vs the long-ride break planner): the timeline, the day
// header, the travel panel, warnings, totals and the impact preview all
// read from it.

export type JourneyPointKind = 'start' | 'waypoint' | 'halt' | 'visit' | 'destination'

export interface JourneyPoint {
  kind: JourneyPointKind
  /** display name — "(start)"/"(end)" suffixes stripped */
  title: string
  lat: number
  lng: number
  /** the stored stop behind this point; synthesized anchors carry auto: true */
  stop: ItineraryStop
  /** true when the engine added this point to close the journey (not a stored stop) */
  synthesized: boolean
  /** the drive INTO this point (null only for a journey that never moves) */
  legIn: ScheduledLeg | null
  arrive: string
  depart: string
  dwellMinutes: number
}

export interface Journey {
  dayIndex: number
  /** outbound = driving toward the trip's next destination; return = driving home */
  direction: 'outbound' | 'return' | 'local'
  startTitle: string
  endTitle: string
  startTime: string
  /** clock arrival at the day's final point */
  arrivalTime: string
  distanceKm: number
  /** wheel time — driving only; halts and visits live in dwellMinutes */
  driveMinutes: number
  dwellMinutes: number
  totalMinutes: number
  transportCostInr: number
  fuelLitres: number | null
  fuelPricePerL: number | null
  points: JourneyPoint[]
  /** food/rest halts planned on this day — they push the arrival later */
  halts: ItineraryStop[]
  /** the journey ends back where the trip started (planned drive home) */
  endsAtStart: boolean
}

/** Strip the "(start)"/"(end)" suffix the UI uses on anchor names. */
function cleanPlaceName(name: string): string {
  return name.replace(/ \((start|end)\)$/, '')
}

/** True when two points sit within ~1 km — the same place, for route purposes. */
export function coLocates(a: { lat: number; lng: number }, b: { lat: number; lng: number } | null | undefined): boolean {
  return !!b && haversineKm(a.lat, a.lng, b.lat, b.lng) < 1
}

/** A pure route endpoint the engine added itself — auto: true, safe to move/delete. */
function synthesizedAnchor(id: string, title: string, p: { lat: number; lng: number }): ItineraryStop {
  return {
    id, title, category: 'travel', locationName: title,
    lat: p.lat, lng: p.lng, visitMinutes: 0,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'must-do', status: 'confirmed', orderInDay: 0, auto: true,
    notes: 'Auto-added destination anchor',
  }
}

/** Where the traveller wakes up on `dayIndex`: last stop of the previous day, else the trip start. */
function dayStartLabel(trip: Trip, dayIndex: number): string {
  for (let d = dayIndex - 1; d >= 0; d--) {
    const stops = trip.days.find(x => x.index === d)?.stops.filter(s => s.status !== 'rejected') ?? []
    if (stops.length) {
      const last = [...stops].sort((a, b) => a.orderInDay - b.orderInDay)[stops.length - 1]
      return cleanPlaceName(last.locationName || last.title)
    }
  }
  return cleanPlaceName(trip.startLocation)
}

/**
 * Build a day's full journey. Shapes it handles (all through the same code
 * path — there is no distance threshold and no separate planner anymore):
 *
 *  - ordinary days: origin → the day's stops → its last stop;
 *  - departure days (Day 1 holds only the start anchor and/or ride halts, or
 *    is empty): the drive to the next planned destination, appended by the
 *    engine as a synthesized destination anchor so the day visibly ENDS
 *    somewhere;
 *  - the trip's final day of a round trip holding the final-destination
 *    anchor + at most food/rest halts (with the outbound planned on an
 *    earlier day): the drive back home;
 *  - one-way tails: the plain chain out to the stored destination anchor.
 */
export function buildJourney(
  trip: Trip,
  day: Pick<ItineraryDay, 'stops' | 'index' | 'startTime'>,
  legCorrections?: Record<string, LegEstimate>,
  /** overrides the resolved start point (tests, special callers) */
  startOriginOverride?: { lat: number; lng: number },
): Journey {
  const A = getAssumptions(trip)
  const active = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
  const nonAuto = active.filter(s => !s.auto)
  const home = trip.startLocationCoords
    ? { lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng }
    : null
  const lastDest = trip.destinationCoords?.length
    ? trip.destinationCoords[trip.destinationCoords.length - 1]
    : undefined
  const origin = startOriginOverride ?? originOf(trip, day.index)
  const startHM = day.startTime ?? A.dayStart
  const startMin = hmToMinutes(startHM)
  const leg = (a: { lat: number; lng: number }, b: { lat: number; lng: number }, fromTitle: string, toTitle: string): ScheduledLeg => {
    const hit = legCorrections?.[legKey(a, b)]
    if (hit) return { fromTitle, toTitle, distanceKm: hit.distanceKm, durationMinutes: hit.durationMinutes }
    const est = legBetween(a, b, A)
    // two points at the same place are not a drive — skip the city-traffic pad
    const samePlace = haversineKm(a.lat, a.lng, b.lat, b.lng) < 0.5
    return {
      fromTitle, toTitle,
      distanceKm: samePlace ? 0 : est.distanceKm,
      durationMinutes: samePlace ? 0 : est.durationMinutes,
    }
  }

  // --- shape: is this day the drive back home? ---------------------------
  // The trip's FINAL day of a round trip holding the final-destination anchor
  // (plus at most food/rest halts) while the outbound drive was planned on an
  // earlier day starts at the turnaround point, not where the previous day
  // ended. Intermediate days parked at the same anchor are stay days — the
  // drive home happens once, at the end of the trip, not on every day.
  const anchorAtFinalDest = active.find(s => s.auto && coLocates(s, lastDest))
  const outboundPlannedEarlier = trip.days.some(d =>
    d.index < day.index && d.stops.some(s => s.status !== 'rejected'))
  const isReturnShape = !!(
    day.index === lastDayIndexOf(trip) &&
    isRoundTrip(trip) && home && anchorAtFinalDest && outboundPlannedEarlier &&
    nonAuto.every(s => (s.category === 'food' || s.category === 'rest') && s.visitMinutes > 0)
  )

  // --- start point ---------------------------------------------------------
  let startTitle: string
  let startPoint: { lat: number; lng: number }
  let startStop: ItineraryStop | null = null
  if (isReturnShape && anchorAtFinalDest) {
    startTitle = cleanPlaceName(anchorAtFinalDest.locationName || anchorAtFinalDest.title)
    startPoint = { lat: anchorAtFinalDest.lat, lng: anchorAtFinalDest.lng }
    startStop = anchorAtFinalDest
  } else if (active.length > 0 && active[0].auto && coLocates(active[0], origin)) {
    // the day opens with its own start anchor at the resolved origin — it IS the start
    startTitle = cleanPlaceName(active[0].locationName || active[0].title)
    startPoint = { lat: active[0].lat, lng: active[0].lng }
    startStop = active[0]
  } else {
    startTitle = dayStartLabel(trip, day.index)
    startPoint = origin
  }

  // --- does the journey need a synthesized destination? --------------------
  let direction: Journey['direction'] = isReturnShape ? 'return' : 'local'
  let synthDest: { title: string; point: { lat: number; lng: number } } | null = null
  if (isReturnShape && home) {
    synthDest = { title: cleanPlaceName(trip.startLocation), point: home }
  } else if (nonAuto.every(s => (s.category === 'food' || s.category === 'rest') && s.visitMinutes > 0)) {
    // The day holds no real visits — just ride halts (or nothing at all): the
    // journey continues on to the next planned destination, so the day visibly
    // ENDS somewhere. Days with real visits end at their last visit instead.
    const target = nextAfter(trip, day.index)
    const lastAnchor = active.length ? active[active.length - 1] : null
    const alreadyThere = (!!lastAnchor && coLocates(lastAnchor, target?.point)) || coLocates(startPoint, target?.point)
    if (target && !alreadyThere) {
      synthDest = { title: cleanPlaceName(target.name), point: target.point }
      direction = 'outbound'
    }
  }

  // --- walk the chain --------------------------------------------------------
  const points: JourneyPoint[] = [{
    kind: 'start', title: startTitle, lat: startPoint.lat, lng: startPoint.lng,
    stop: startStop ?? synthesizedAnchor(`journey_start_${day.index}`, startTitle, startPoint),
    synthesized: !startStop, legIn: null,
    arrive: startHM, depart: startHM, dwellMinutes: 0,
  }]
  const halts: ItineraryStop[] = []
  let cursor = startMin
  let prev = { title: startTitle, point: startPoint }
  const startStopId = startStop?.id
  const chain = startStopId ? active.filter(s => s.id !== startStopId) : active
  for (const s of chain) {
    // A stored stop can carry a missing or non-finite visitMinutes (older rows,
    // hand-edited JSON, partial DB writes). Coerce once — otherwise
    // `undefined + buffer` = NaN silently poisons the day's dwell, its clocks
    // and every total built on top (the impact dialog showed "NaNh NaNm").
    const visitMin = typeof s.visitMinutes === 'number' && Number.isFinite(s.visitMinutes) ? s.visitMinutes : 0
    const isWaypoint = s.auto === true || (s.category === 'travel' && visitMin === 0 && s.transportCostInrTotal === 0)
    const isHalt = !isWaypoint && (s.category === 'food' || s.category === 'rest') && visitMin > 0
    const title = cleanPlaceName(s.locationName || s.title)
    const p = { lat: s.lat, lng: s.lng }
    const lg = leg(prev.point, p, prev.title, title)
    cursor += lg.durationMinutes
    const arrive = addMinutesToClock(startMin, cursor - startMin)
    // pure waypoints (auto anchors) count for distance but add no dwell/buffer
    const dwell = isWaypoint ? 0 : visitMin + A.bufferMinutesPerStop
    cursor += dwell
    const depart = addMinutesToClock(startMin, cursor - startMin)
    points.push({
      kind: isWaypoint ? 'waypoint' : isHalt ? 'halt' : 'visit',
      title, lat: s.lat, lng: s.lng, stop: s, synthesized: false,
      legIn: lg, arrive, depart, dwellMinutes: dwell,
    })
    if (isHalt) halts.push(s)
    prev = { title, point: p }
  }
  if (synthDest) {
    const lg = leg(prev.point, synthDest.point, prev.title, synthDest.title)
    cursor += lg.durationMinutes
    const arrive = addMinutesToClock(startMin, cursor - startMin)
    points.push({
      kind: 'destination', title: synthDest.title,
      lat: synthDest.point.lat, lng: synthDest.point.lng,
      stop: synthesizedAnchor(`journey_dest_${day.index}`, synthDest.title, synthDest.point),
      synthesized: true, legIn: lg, arrive, depart: arrive, dwellMinutes: 0,
    })
  }

  const distanceKm = points.reduce((a, p) => a + (p.legIn?.distanceKm ?? 0), 0)
  const driveMinutes = points.reduce((a, p) => a + (p.legIn?.durationMinutes ?? 0), 0)
  const dwellMinutes = points.reduce((a, p) => a + p.dwellMinutes, 0)
  const lastPoint = points[points.length - 1]
  return {
    dayIndex: day.index,
    direction,
    startTitle,
    endTitle: lastPoint.title,
    startTime: startHM,
    arrivalTime: lastPoint.arrive,
    distanceKm,
    driveMinutes,
    dwellMinutes,
    totalMinutes: driveMinutes + dwellMinutes,
    transportCostInr: points.reduce((a, p) => a + (p.legIn ? p.legIn.distanceKm * (A.inrPerKm ?? 8) : 0), 0),
    fuelLitres: A.kmPerLiter ? distanceKm / A.kmPerLiter : null,
    fuelPricePerL: A.fuelPricePerL ?? null,
    points,
    halts,
    endsAtStart: coLocates(lastPoint, home),
  }
}

/**
 * The day's ride as ONE continuous road polyline, assembled from the per-leg
 * geometry the routing layer (Google Routes / OSRM) already fetched for the
 * distance corrections. Km accumulated along this polyline match the road km
 * the travel panel displays (same source), so a halt planned "after 120 km"
 * lands 120 road-km in — ON the road the map draws — instead of on the
 * straight-line chord between stops, which on curvy highways sits far off the
 * actual road. Returns null when any leg of the chain has no road geometry
 * (offline estimate fallback); callers then fall back to the stop chain.
 */
export function dayRoadPolyline(
  points: JourneyPoint[],
  corrections?: Record<string, LegEstimate>,
): { lat: number; lng: number }[] | null {
  if (!corrections || points.length < 2) return null
  const out: { lat: number; lng: number }[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const geo = corrections[legKey(a, b)]?.geometry
    if (!geo || geo.length < 2) return null
    let seg = geo.map(([lng, lat]) => ({ lat, lng }))
    // The corrections map also carries mirrored legs for return drives, whose
    // stored geometry runs opposite to this leg's actual direction — orient
    // the segment so the concatenated polyline follows the ride start→end.
    if (haversineKm(seg[0].lat, seg[0].lng, b.lat, b.lng) < haversineKm(seg[0].lat, seg[0].lng, a.lat, a.lng)) {
      seg = [...seg].reverse()
    }
    // drop the junction duplicate (the previous leg ends where this one starts)
    const last = out[out.length - 1]
    if (last && haversineKm(last.lat, last.lng, seg[0].lat, seg[0].lng) < 0.02) seg = seg.slice(1)
    out.push(...seg)
  }
  return out.length >= 2 ? out : null
}

/**
 * Road-vs-chord scale of a journey: corrected leg distances (OSRM/Google)
 * summed over the SAME consecutive point pairs as the haversine chord sum.
 * The optimise-day objective is haversine (pairwise road km between arbitrary
 * stops would need N² route calls), but the numbers it shows must speak the
 * road km the travel panel displays — multiply chord figures by this ratio.
 * Returns 1 (no rescale) while corrections are absent or degenerate.
 */
/** How many of a day's legs carry a MEASURED road estimate (#341). Zero means
 *  every “road km” the optimise dialog would print is chord math dressed by a
 *  scale factor of 1 — the honest thing to do is label it an estimate. */
export function measuredLegCount(
  points: Array<{ lat: number; lng: number }>,
  corrections?: Record<string, LegEstimate>,
): number {
  if (!corrections || points.length < 2) return 0
  let n = 0
  for (let i = 0; i < points.length - 1; i++) if (corrections[legKey(points[i], points[i + 1])]) n++
  return n
}

/** How the optimise dialog labels a distance (#341). Its objective is
 *  straight-line, rescaled by the day's road-vs-chord ratio; with no measured
 *  leg that ratio is 1, so the number is chord math and must never be dressed
 *  as a measured road km. Pure, so the rule is testable without a DOM. */
export function optimiseKmLabel(km: number, ratio: number, measuredLegs: number): string {
  const shown = Math.round(km * ratio)
  return measuredLegs === 0 ? `~${shown} km (est.)` : `${shown} km`
}

export function roadScaleRatio(
  points: JourneyPoint[],
  corrections?: Record<string, LegEstimate>,
): number {
  if (!corrections || points.length < 2) return 1
  let chord = 0
  let road = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const c = haversineKm(a.lat, a.lng, b.lat, b.lng)
    chord += c
    road += corrections[legKey(a, b)]?.distanceKm ?? c
  }
  if (chord <= 0) return 1
  const r = road / chord
  return Number.isFinite(r) && r > 0 ? r : 1
}

export interface StopLegEstimate extends LegEstimate {
  /** fuel/fare cost for the leg at the trip mode's ₹/km rate */
  costInr: number
}

/** Distance/time/cost for the leg into a new stop (haversine estimate — OSRM refines in the UI). */
export function estimateLeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  trip: Pick<Trip, 'transportMode' | 'fuelEconomyKmL' | 'fuelPricePerL'>,
): StopLegEstimate {
  const A = getAssumptions(trip)
  const est = legBetween(from, to, A)
  return { ...est, costInr: est.distanceKm * (A.inrPerKm ?? 8) }
}

// ---------------- Warnings ----------------

export type Severity = 'high' | 'medium' | 'low'

/** Wheel time on a self-drive day past which fatigue risk is flagged. */
const FATIGUE_DRIVE_MINUTES = 420

// Cross-day rest thresholds (#423): the night between two days is measured
// end-to-start. Under 5 h is a real problem, under 7 h is worth flagging.
const SHORT_REST_HIGH_MIN = 300
const SHORT_REST_MEDIUM_MIN = 420

export interface ScheduleWarning {
  code: string
  severity: Severity
  title: string
  detail: string
  fix: string            // recommended action
  /** The day this warning belongs to, or `null` for a trip-wide one (hotel
   *  churn). Attached here because `title` is a DISPLAY string — the "Day N:"
   *  prefix is a rendering convention, not a key, and every surface that
   *  parsed it drifted (#402). Optional so a legacy/custom warning shape still
   *  groups through `groupWarnings`' prefix fallback. */
  dayIndex?: number | null
}

export interface HealthResult {
  score: number          // 0–100
  band: 'Comfortable' | 'Manageable' | 'Tight' | 'Unrealistic'
  warnings: ScheduleWarning[]
}

/**
 * All schedule issues for a trip. Used both for the health score and for
 * diffing current-vs-proposed plans in the Impact Preview.
 */
export function collectWarnings(trip: Trip): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = []
  const A = getAssumptions(trip)
  const dayCount = Math.max(1, trip.days.length)

  // The clocks the cross-day rest check after this loop needs. Collected here
  // so the pair walk never re-simulates a day (collectWarnings is on the hot
  // path: every store commit runs it for the timeline strip + the health dial).
  const dayClocks = new Map<number, { startsAt: string; endsAt: string; startMin: number; endMin: number }>()

  trip.days.forEach((day) => {
    // simulateDay already builds the day's full unified journey — the drive
    // to the day's destination (or back home) is inside these totals, so no
    // overlay math is needed to make travel/fatigue checks honest.
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
    const n = sim.activeStops.length
    dayClocks.set(day.index, {
      startsAt: sim.startsAt, endsAt: sim.endsAt,
      startMin: hmToMinutes(sim.startsAt), endMin: hmToMinutes(sim.endsAt),
    })
    const travelMinutes = sim.totalTravelMinutes
    const travelKm = sim.totalDistanceKm

    // Excessive daily travel (>5h on the road)
    if (travelMinutes > 300) {
      warnings.push({ code: 'travel', severity: 'high', dayIndex: day.index, title: `Day ${day.index + 1}: heavy travel time`, detail: `About ${minutesToHM(travelMinutes)} of driving/transit across ${travelKm.toFixed(0)} km.`, fix: 'Move one activity to another day or pick a closer alternative.' })
    } else if (travelMinutes > 210) {
      warnings.push({ code: 'travel', severity: 'medium', dayIndex: day.index, title: `Day ${day.index + 1}: long travel time`, detail: `Roughly ${minutesToHM(travelMinutes)} in transit.`, fix: 'Consider starting earlier or dropping an optional stop.' })
    }

    // Fatigue risk: a self-drive day pushing well past ~7 h of wheel time with
    // no proper halt. Distinct from the generic travel warning above — the fix
    // here is a rest/meal halt (long-ride planner), not a route change.
    if (isFuelEconomyMode(trip.transportMode)) {
      const hasHalt = sim.activeStops.some(s => (s.category === 'food' || s.category === 'rest') && !s.auto && s.visitMinutes > 0)
      if (travelMinutes > FATIGUE_DRIVE_MINUTES && !hasHalt) {
        warnings.push({ code: 'fatigue', severity: 'high', dayIndex: day.index, title: `Day ${day.index + 1}: fatigue risk on a long drive`, detail: `About ${minutesToHM(travelMinutes)} of wheel time with no meal or rest halt.`, fix: 'Use the long-ride planner on this day to add a halt — or split the drive across two days.' })
      }
    }

    // Too many activities
    if (n > 6) {
      warnings.push({ code: 'density', severity: 'high', dayIndex: day.index, title: `Day ${day.index + 1} is over-packed`, detail: `${n} activities in one day leaves almost no slack.`, fix: 'Move one activity to another day.' })
    } else if (n > 5) {
      warnings.push({ code: 'density', severity: 'low', dayIndex: day.index, title: `Day ${day.index + 1} is busy`, detail: `${n} activities scheduled.`, fix: 'Keep buffer time in mind before adding more.' })
    }

    // Late finish
    const endMin = hmToMinutes(sim.endsAt)
    if (endMin > hmToMinutes('21:30')) {
      warnings.push({ code: 'late-arrival', severity: 'medium', dayIndex: day.index, title: `Day ${day.index + 1} ends very late`, detail: `Last activity wraps around ${sim.endsAt}.`, fix: 'Remove an optional stop or shorten visit durations.' })
    } else if (endMin > hmToMinutes(A.dayEnd)) {
      warnings.push({ code: 'late-arrival', severity: 'low', dayIndex: day.index, title: `Day ${day.index + 1} runs past plan`, detail: `Plan ends near ${sim.endsAt}.`, fix: 'Trim an optional stop to protect your evening.' })
    }

    // Opening-hours conflicts
    sim.activeStops.forEach((s, i) => {
      if (!s.openTime || !s.closeTime) return
      const arr = sim.arrivalTimes[i]
      if (hmToMinutes(arr) < hmToMinutes(s.openTime)) {
        warnings.push({ code: 'hours', severity: 'medium', dayIndex: day.index, title: `${s.title}: arrives before opening`, detail: `You reach ~${arr}, opens at ${s.openTime}.`, fix: 'Reorder stops so this comes later in the day.' })
      } else if (hmToMinutes(arr) + s.visitMinutes > hmToMinutes(s.closeTime)) {
        warnings.push({ code: 'hours', severity: 'medium', dayIndex: day.index, title: `${s.title}: closes too soon after arrival`, detail: `Arrival ~${arr}, but closes at ${s.closeTime} while you need ${minutesToHM(s.visitMinutes)}.`, fix: 'Visit this stop earlier or reduce time here.' })
      }
    })

    // Backtracking: any leg that doubles back within 25 km of a previous point chain
    const pts = sim.activeStops
    for (let i = 1; i < pts.length - 1; i++) {
      const back = legBetween(pts[i], pts[i - 1], A)
      const fwd = legBetween(pts[i], pts[i + 1], A)
      if (back.distanceKm < fwd.distanceKm * 0.55 && fwd.distanceKm > 18) {
        warnings.push({ code: 'backtrack', severity: 'low', dayIndex: day.index, title: `Day ${day.index + 1}: Route backtracking`, detail: `The order of “${pts[i].title}” adds zig-zag distance.`, fix: 'Reorder stops along one direction.' })
        break
      }
    }

    // No meal window: if the day spans >6h with no food/rest stop
    const hasFoodOrRest = sim.activeStops.some(s => s.category === 'food' || s.category === 'rest')
    const span = endMin - hmToMinutes(A.dayStart)
    if (!hasFoodOrRest && span > 360) {
      warnings.push({ code: 'meals', severity: 'medium', dayIndex: day.index, title: `Day ${day.index + 1}: no meal/rest break`, detail: `A ${minutesToHM(span)} day without a planned food or rest stop.`, fix: 'Add a rest period or lunch stop.' })
    }

    // Weather-sensitive outdoor items
    const wCount = sim.activeStops.filter(s => s.weatherSensitive).length
    if (wCount >= 3) {
      warnings.push({ code: 'weather', severity: 'low', dayIndex: day.index, title: `Day ${day.index + 1} is weather-dependent`, detail: `${wCount} outdoor stops would all be affected by rain.`, fix: 'Identify an indoor backup for at least one stop.' })
    }
  })

  // Fixed-commitment conflicts: does anything run past a commitment time?
  for (const fc of trip.fixedCommitments) {
    const day = trip.days.find(d => d.index === fc.dayIndex)
    if (!day) continue
    const sim = simulateDay(day, trip, originOf(trip, fc.dayIndex), fc.dayIndex)
    const commitMin = hmToMinutes(fc.time)
    if (fc.type === 'hotel-checkin') continue // check-in is an anchor, not a race
    const lastDepIdx = sim.departures.length - 1
    if (lastDepIdx >= 0 && hmToMinutes(sim.arrivalTimes[lastDepIdx]) > commitMin) {
      warnings.push({ code: 'commitment', severity: 'high', dayIndex: fc.dayIndex, title: `Conflicts with ${fc.title}`, detail: `Day ${fc.dayIndex + 1} plan reaches its last stop after the ${fc.time} commitment.`, fix: 'Cut an earlier stop so you arrive with buffer.' })
    } else if (lastDepIdx >= 0 && commitMin - hmToMinutes(sim.arrivalTimes[lastDepIdx]) < 45 && sim.activeStops.length > 0) {
      warnings.push({ code: 'buffer', severity: 'medium', dayIndex: fc.dayIndex, title: `Thin buffer before ${fc.title}`, detail: `Less than ~45 min of slack before the ${fc.time} commitment.`, fix: 'Drop one optional stop to protect your connection.' })
    }
  }

  // Cross-day rest: the night between two consecutive days is the one thing
  // neither day can see on its own (#423) — a day that ends at 23:40 and a
  // next day starting at 06:00 each look fine in isolation. Days are walked in
  // DAY-ORDER (index), never array order, and each day's clock is its own
  // midnight's, so the rest window is the time from the earlier day's end to
  // the next day's start: 1440 + nextStart − dayEndAbsolute.
  const orderedDays = [...trip.days].sort((a, b) => a.index - b.index)
  for (let i = 0; i < orderedDays.length - 1; i++) {
    const prev = orderedDays[i], next = orderedDays[i + 1]
    const a = dayClocks.get(prev.index), b = dayClocks.get(next.index)
    if (!a || !b) continue
    // The check reads CLOCKS, not stop counts: a stopless travel day still has
    // an end (its synthesized drive), and a late one is still a short night.
    const endOffset = ((a.endMin - a.startMin) % 1440 + 1440) % 1440
    const rest = 1440 + b.startMin - (a.startMin + endOffset)
    if (rest >= SHORT_REST_MEDIUM_MIN) continue
    const severity: Severity = rest < SHORT_REST_HIGH_MIN ? 'high' : 'medium'
    warnings.push({
      code: 'short-rest', severity, dayIndex: next.index,
      title: `Day ${next.index + 1}: short night after Day ${prev.index + 1}`,
      detail: `Day ${prev.index + 1} ends ~${a.endsAt} and Day ${next.index + 1} starts ${b.startsAt} — about ${minutesToHM(rest)} of rest between them.`,
      fix: severity === 'high'
        ? 'Trim the late stop or start the next day later — under 5 h of rest is not a plan.'
        : 'Consider starting the next day a little later, or move one stop off it.',
    })
  }

  // Hotel/transport changes between days (each new hotel night counts as friction)
  const hotelNights = countHotelNights(trip)
  if (hotelNights >= dayCount && dayCount >= 3) {
    warnings.push({ code: 'hotels', severity: 'low', dayIndex: null, title: 'Frequent accommodation changes', detail: `About ${hotelNights} different overnight bases in ${dayCount} days means packing/unpacking daily.`, fix: 'Consider a 2-night stay in one base town.' })
  }

  return warnings
}

/**
 * Group warnings by the day they belong to (#402). Identity comes from
 * `dayIndex` when the engine attached it — never from parsing `title`, which
 * is a display string. The title fallback exists only for warning shapes that
 * predate the field (custom/legacy), and a warning with no day at all is
 * returned as trip-wide rather than dropped — which is exactly how the
 * regex-parsing surfaces used to lose the accommodation warning.
 */
export function groupWarnings(warnings: ScheduleWarning[]): { byDay: Map<number, ScheduleWarning[]>; tripWide: ScheduleWarning[] } {
  const byDay = new Map<number, ScheduleWarning[]>()
  const tripWide: ScheduleWarning[] = []
  for (const w of warnings) {
    const idx = w.dayIndex !== undefined ? w.dayIndex : dayIndexFromTitle(w.title)
    if (idx === null) { tripWide.push(w); continue }
    const list = byDay.get(idx)
    if (list) list.push(w)
    else byDay.set(idx, [w])
  }
  return { byDay, tripWide }
}

/** Last-resort day lookup for a warning that predates `dayIndex`. The “Day N:”
 *  prefix is a rendering convention, so this never runs for engine output. */
export function dayIndexFromTitle(title: string): number | null {
  const m = /^Day (\d+)/.exec(title)
  return m ? Number(m[1]) - 1 : null
}

/** Public API: compute health from collected warnings. */
export function computeHealth(trip: Trip): HealthResult {
  return scoreWarnings(collectWarnings(trip))
}

export function scoreWarnings(warnings: ScheduleWarning[]): HealthResult {
  let score = 100
  for (const w of warnings) {
    score -= w.severity === 'high' ? 11 : w.severity === 'medium' ? 7 : 3
  }
  score = Math.max(5, Math.min(100, score))
  const band = score >= 85 ? 'Comfortable' : score >= 70 ? 'Manageable' : score >= 55 ? 'Tight' : 'Unrealistic'
  return { score, band, warnings }
}

// ---------------- Safe-to-spend (budget pacing) ----------------

/** Trip days not yet over as of `now` (today counts). Before the trip starts
 *  = all days; mid-trip = today + the rest; after it ends = 0. Dirty
 *  startDate/endDate strings clamp to the full-day count rather than NaN. */
export function daysRemaining(trip: Pick<Trip, 'days' | 'startDate' | 'endDate'>, now: Date = new Date()): number {
  const total = trip.days.length
  const start = new Date(`${trip.startDate}T00:00:00`)
  const end = new Date(`${trip.endDate}T23:59:59`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return total
  if (now.getTime() > end.getTime()) return 0
  if (now.getTime() < start.getTime()) return total
  // days from today (inclusive) to the end date: floor + 1 — a partial day
  // still counts as a full remaining day (you can still spend today).
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const ms = end.getTime() - todayStart.getTime()
  return Math.max(1, Math.min(total, Math.floor(ms / 86400000) + 1))
}

/** The pacing number the Budget tab surfaces: how much the group can still
 *  spend per remaining day without blowing the target. Null when no target
 *  is set (budgetPerPersonInr 0) — "set a budget" is the honest answer then,
 *  not a fake infinity. */
export function safeToSpendPerDay(
  trip: Pick<Trip, 'days' | 'startDate' | 'endDate' | 'budgetPerPersonInr' | 'travellers'>,
  spentInr: number,
  now: Date = new Date(),
): { perDayInr: number; perPersonPerDayInr: number; daysLeft: number } | null {
  // #382: an unreadable spend figure is not a small one. The old guard mapped a
  // non-finite perDay to 0, so the one case that most needed saying — this
  // cannot be measured — read as a reassuring ₹0 a day. Return the tile's
  // honest "no number" instead; a huge-but-finite blowout is still a number and
  // still prints, however alarming.
  if (!Number.isFinite(spentInr)) return null
  const target = trip.budgetPerPersonInr * trip.travellers
  if (!(target > 0)) return null
  const daysLeft = daysRemaining(trip, now)
  const remaining = target - spentInr
  const perDay = daysLeft > 0 ? remaining / daysLeft : remaining
  return {
    perDayInr: Number.isFinite(perDay) ? perDay : 0,
    perPersonPerDayInr: (Number.isFinite(perDay) ? perDay : 0) / Math.max(1, trip.travellers),
    daysLeft,
  }
}

export function countHotelNights(trip: Trip): number {
  const hotels = new Set<string>()
  trip.days.forEach(d => d.stops.forEach(s => { if (s.category === 'hotel') hotels.add(s.locationName) }))
  return hotels.size
}

/**
 * Where the traveller is when day `dayIndex` is over, given they woke up at
 * `startPos`. Mirrors buildJourney's closure rules exactly: a day with real
 * visits ends at its last stored stop; a halt-only/anchor-only/empty day
 * continues on to the next planned destination (the synthesized destination)
 * unless the journey is already there; a planned return day ends back home.
 */
/** The trip's last day INDEX. `trip.days.length - 1` is not the same thing on
 *  a sparse trip (a deleted middle day leaves indexes 0,2,3 — #338's shape), and
 *  the return-day shapes below keyed on that count treated Day 3 as an
 *  intermediate day. */
function lastDayIndexOf(trip: Pick<Trip, 'days'>): number {
  return trip.days.reduce((m, d) => Math.max(m, d.index), 0)
}

function dayEndPosition(trip: Trip, dayIndex: number, startPos: { lat: number; lng: number }): { lat: number; lng: number } {
  // By INDEX, not array position: originOf walks 0..dayIndex-1 and a positional
  // lookup handed a sparse trip its own day as the wake-up origin (the day's
  // own legs then measured zero — the #161 index-vs-count class).
  const day = trip.days.find(d => d.index === dayIndex)
  if (!day) return startPos
  const active = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
  if (active.length === 0) return startPos
  const home = trip.startLocationCoords ?? null
  const lastDest = trip.destinationCoords?.length
    ? trip.destinationCoords[trip.destinationCoords.length - 1]
    : undefined
  const nonAuto = active.filter(s => !s.auto)
  const haltOnly = nonAuto.every(s => (s.category === 'food' || s.category === 'rest') && s.visitMinutes > 0)
  const anchorAtFinalDest = active.find(s => s.auto && coLocates(s, lastDest))
  const outboundPlannedEarlier = trip.days.some(d =>
    d.index < day.index && d.stops.some(s => s.status !== 'rejected'))
  if (
    day.index === lastDayIndexOf(trip) && isRoundTrip(trip) && home &&
    anchorAtFinalDest && outboundPlannedEarlier && haltOnly
  ) {
    return home // planned return day: the journey ends back at the start
  }
  const startPoint = active[0].auto && coLocates(active[0], startPos)
    ? { lat: active[0].lat, lng: active[0].lng }
    : startPos
  if (haltOnly) {
    const target = nextAfter(trip, day.index)
    const lastAnchor = active[active.length - 1]
    const alreadyThere = (!!lastAnchor && coLocates(lastAnchor, target?.point)) || coLocates(startPoint, target?.point)
    if (target && !alreadyThere) return target.point // the synthesized destination
  }
  const last = active[active.length - 1]
  return { lat: last.lat, lng: last.lng }
}

export function originOf(trip: Trip, dayIndex: number): { lat: number; lng: number } {
  if (dayIndex <= 0) return firstFixedPoint(trip)
  // The traveller wakes up where the previous day's JOURNEY ended — the
  // synthesized destination on a driving day, not the last stored stop.
  // (Using the raw last stop made every following day replay the outbound
  // drive from a mid-route halt.) Walk the route forward to stay exact.
  let pos = firstFixedPoint(trip)
  for (let d = 0; d < dayIndex; d++) {
    pos = dayEndPosition(trip, d, pos)
  }
  return pos
}

export function firstFixedPoint(trip: Trip): { lat: number; lng: number } {
  // A geocoded start (point A) is the trip's true origin when known.
  if (trip.startLocationCoords) return { lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng }
  // The first day by INDEX, not by array position: an unsorted days array made
  // the trip's "home" the stop that happened to sit first in the array (#338).
  for (const d of [...trip.days].sort((a, b) => a.index - b.index)) {
    const first = [...d.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)[0]
    if (first) return { lat: first.lat, lng: first.lng }
  }
  return { lat: 9.9312, lng: 76.2673 } // Kochi fallback
}

// ---------------- Day route optimization ----------------

/** Route length (km) of one day's stop sequence from a wake-up origin —
 *  straight-line haversine sum. Used to compare orderings; the displayed
 *  km/time always come from the real simulation afterwards. */
export function dayRouteKm(origin: { lat: number; lng: number }, stops: ItineraryStop[]): number {
  let km = 0
  let pos = origin
  for (const s of stops) {
    km += haversineKm(pos.lat, pos.lng, s.lat, s.lng)
    pos = s
  }
  return km
}

export interface OptimizeDayResult {
  /** the re-ordered stops (new array; input untouched). Same order when the
   *  day was already optimal or has <3 movable stops. */
  stops: ItineraryStop[]
  /** route km before → after, for the "saves ~X km" toast */
  beforeKm: number
  afterKm: number
  /** false when there was nothing to improve (≤2 movable stops, or already optimal) */
  changed: boolean
  /** Why the optimiser declined, when it did for a reason the user can act on:
   *  'mid-anchor' = a manually placed waypoint sits mid-day, so the engine's
   *  pinned head/tail model doesn't describe this day (#341). Absent = nothing
   *  to explain (too few movable stops, or already optimal). */
  blocked?: 'mid-anchor'
}

/** Reorder a day's MOVABLE stops to minimise crisscrossing: greedy
 *  nearest-neighbour from the day's wake-up origin, then a full 2-opt
 *  improvement sweep. Auto anchors (start/destination/continuation
 *  waypoints, `auto: true`) are pinned to the front and back of the day —
 *  the engine builds the journey around them, so moving them would rewrite
 *  the route's endpoints rather than tidy the middle. A day that ends at a
 *  stored `hotel`/`rest` stop is pinned at the tail the same way even with no
 *  `auto` flag: `dayEndPosition` returns the day's last stored stop and
 *  `originOf(next day)` walks forward through it, so re-ordering where you
 *  sleep rewrites where tomorrow starts (measured on the shelf itineraries
 *  before this rule: 14 day-pairs, up to 16 km). Rejected stops ride
 *  along untouched. Open-hours constraints are honoured as a tie-break only:
 *  a stop's openTime is compared when two candidates are near-equal, so the
 *  optimizer never produces an ordering that needlessly waits for a closed
 *  door, but hard time windows are left to the user — days are short and
 *  the impact preview will flag impossible clocks. Pure: node-testable. */
export function optimizeDayOrder(
  origin: { lat: number; lng: number },
  stops: ItineraryStop[],
  opts: { hasNextDay?: boolean } = {},
): OptimizeDayResult {
  const sorted = [...stops].sort((a, b) => a.orderInDay - b.orderInDay)
  const active = sorted.filter(s => s.status !== 'rejected')
  const anchors = active.filter(s => s.auto === true)
  // The optimizer only understands anchors at the head/tail of the day. A
  // mid-day auto anchor (an unusual shape — e.g. a manually-moved continuation
  // waypoint) would fall outside the pinned model and get lost, so those days
  // are left untouched rather than guessed at.
  const anchorIdx = anchors.map(a => active.findIndex(s => s.id === a.id))
  const midAnchor = anchors.some((a, i) => anchorIdx[i] !== 0 && anchorIdx[i] !== active.length - 1)
  const head = anchors.length > 0 && anchorIdx[0] === 0 ? anchors[0] : undefined
  const anchorTail = anchors.length > (head ? 1 : 0) && anchorIdx[anchorIdx.length - 1] === active.length - 1
    ? anchors[anchors.length - 1] : undefined
  // Where the day ENDS is not a free variable. `dayEndPosition` reads the last
  // stored stop and `originOf(next day)` walks forward through it, so a night
  // base that slides out of the tail silently moves the next morning's start
  // (on the shelf itineraries that was 14 day-pairs, worst 16.3 km — the day
  // then plans its drive from the evening's last sight instead of the bed). An
  // engine anchor says "keep me last" with `auto`; a stored hotel or rest stop
  // at the tail says it with its category. Only the tail is pinned — a base
  // mid-day is a legitimate overnight and is left where the author put it.
  const lastActive = active[active.length - 1]
  const nightBase = !anchorTail && lastActive && (lastActive.category === 'hotel' || lastActive.category === 'rest')
    ? lastActive
    : undefined
  // #341: the tail is the next day's wake-up point, whatever its category —
  // `dayEndPosition` returns the last stored stop and `originOf(next day)`
  // walks forward through it, so a tail that is neither hotel nor rest is just
  // as load-bearing (a food-tailed day moved the next morning ~16 km on the
  // shelf itineraries). Pinned whenever a later day exists to derive from it;
  // the last day of a trip owns its own tail and stays free.
  const hasNextDay = opts.hasNextDay ?? true
  const storedTail = !anchorTail && hasNextDay && lastActive && !lastActive.auto ? lastActive : undefined
  const tail = anchorTail ?? nightBase ?? storedTail
  // movable = non-auto, non-rejected; rejected ride along after the actives
  const movable = active.filter(s => s.auto !== true && s.id !== tail?.id)
  const beforeKm = dayRouteKm(origin, active)

  if (midAnchor) return { stops: sorted, beforeKm, afterKm: beforeKm, changed: false, blocked: 'mid-anchor' }
  if (movable.length < 3) return { stops: sorted, beforeKm, afterKm: beforeKm, changed: false }

  // Greedy nearest-neighbour with the open-time tie-break (earlier opening
  // first when two candidates sit within ~800 m of each other).
  const remaining = [...movable]
  const order: ItineraryStop[] = []
  let pos = head ?? origin
  const opensAt = (s: ItineraryStop) => (s.openTime && /^\d{2}:\d{2}$/.test(s.openTime) ? hmToMinutes(s.openTime) : Infinity)
  while (remaining.length > 0) {
    let bestIdx = 0
    for (let i = 1; i < remaining.length; i++) {
      const km = haversineKm(pos.lat, pos.lng, remaining[i].lat, remaining[i].lng)
      const kmBest = haversineKm(pos.lat, pos.lng, remaining[bestIdx].lat, remaining[bestIdx].lng)
      const nearTie = Math.abs(km - kmBest) < 0.8
      if (km < kmBest || (nearTie && opensAt(remaining[i]) < opensAt(remaining[bestIdx]))) bestIdx = i
    }
    const [chosen] = remaining.splice(bestIdx, 1)
    order.push(chosen)
    pos = chosen
  }

  // 2-opt: reverse any segment whose swap shortens the route. Anchors stay
  // fixed (head prefix / tail suffix), so only the movable middle is rewired.
  const withAnchors = head ? [head, ...order] : order
  if (tail) withAnchors.push(tail)
  let route = withAnchors
  const kmOf = (r: ItineraryStop[]) => dayRouteKm(origin, r.filter(s => s.status !== 'rejected'))
  let improved = true
  while (improved) {
    improved = false
    const start = head ? 1 : 0
    const end = tail ? route.length - 1 : route.length
    for (let i = start; i < end - 1; i++) {
      for (let j = i + 2; j < end; j++) {
        const cand = [...route]
        // reverse route[i..j]
        const seg = cand.slice(i, j + 1).reverse()
        cand.splice(i, seg.length, ...seg)
        if (kmOf(cand) < kmOf(route) - 1e-9) { route = cand; improved = true }
      }
    }
  }

  const afterKm = kmOf(route)
  const changed = afterKm < beforeKm - 1e-9
  // Re-merge: rejected stops ride along AFTER the actives — the engine and
  // the timeline skip them entirely, so only their slot needs to stay stable
  // (they surface at the day's end if un-rejected later). No stop is dropped.
  // The renumber must not write into the caller's stop objects: the UI calls
  // this in a render-phase memo with LIVE store stops, and mutating their
  // orderInDay here would reorder the day on screen before anyone approved
  // anything (and make the impact preview compare against the already-mutated
  // state). The doc contract is "input untouched" — clone before renumbering.
  const rejected = sorted.filter(s => s.status === 'rejected')
  const finalStops = [...route, ...rejected].map(s => ({ ...s }))
  finalStops.forEach((s, i) => { s.orderInDay = i + 1 })
  return { stops: finalStops, beforeKm, afterKm, changed }
}

/** Last active stop across the trip's days — the turnaround point of the route. */
export function lastActiveStopPoint(trip: Trip): { lat: number; lng: number } | null {
  // The LAST day by index — the turnaround point of the return drive. Walking
  // the array backwards picked whatever sat last in storage, not on the trip
  // (#338: the return leg then started from a mid-route stop).
  for (const day of [...trip.days].sort((a, b) => b.index - a.index)) {
    const stops = day.stops.filter(s => s.status !== 'rejected')
    if (stops.length) {
      const last = [...stops].sort((a, b) => a.orderInDay - b.orderInDay)[stops.length - 1]
      return { lat: last.lat, lng: last.lng }
    }
  }
  return null
}

// ---------------- Totals ----------------

export interface TripTotals {
  totalCostInr: number
  costPerPersonInr: number
  totalTravelMinutes: number
  totalDistanceKm: number
  stopCount: number
  costPerDayInr: number
  essentialInr: number
  optionalInr: number
  /** Lodging honesty line (PLAN-DAY-PLANNER P1-E): priced from hotel-category
   *  stops — bases × rooms × rate — with the formula the Budget tab renders. */
  lodgingInr: number
  lodgingNights: number
  lodgingRooms: number
  lodgingRatePerNight: number
  byCategory: Record<string, number>
  /** Per-day stack for the Budget tab's cost-per-day bars: attached expenses
   *  land on their day, journey fuel on the day that drives it, stop entry
   *  fees on the stop's day, unattached trip-level expenses spread evenly. */
  byDay: { dayIndex: number; expensesInr: number; transportInr: number; totalInr: number; stops: number; distanceKm: number }[]
}

// The ₹-per-room-night table lives in rates.ts, next to the Plan Bench's use
// of it — one source, no mirror to drift (#125b). Travel style never touches
// the bed's price; the STAY BUDGET dial does.

/** The stay-rate vocabulary — the same three keys the settings pills and the
 *  rates table share. */
const STAY_KEYS = ['budget', 'comfort', 'luxury'] as const
type StayKey = (typeof STAY_KEYS)[number]

/** The stay rate key for a trip: its own stayStyle dial, or the legacy
 *  travelStyle (budget/luxury styles carried the pricing before the two
 *  dials were separated) so existing trips never re-price silently.
 *
 *  The stored value is VALIDATED: `stay_style` has no CHECK constraint, so a
 *  stray string ('Luxury', 'premium', a renamed tier) would index
 *  STAY_RATE_PER_NIGHT to undefined and multiply the whole lodging line into
 *  NaN. Anything unrecognised falls through to the legacy rule instead. */
function stayKeyFor(trip: Pick<Trip, 'stayStyle' | 'travelStyle'>): StayKey {
  const stay = trip.stayStyle
  if (stay && (STAY_KEYS as readonly string[]).includes(stay)) return stay as StayKey
  if (trip.travelStyle === 'budget' || trip.travelStyle === 'luxury') return trip.travelStyle
  return 'comfort'
}

/**
 * Lodging identity key (#125a/#146): the STRONGEST available identity wins —
 * 1. provider place-id (same id, one base — no coordinate rounding edge);
 * 2. a ~500 m coordinate cluster (same property, slightly different pins);
 * 3. a normalized name, only when the stop has neither id nor coordinates.
 * Name-string equality used to double-count "Hotel Taj" vs "Hotel Taj,
 * Mumbai" and under-count two hotels in one city; the cluster already fixed
 * the geocoded case, the place-id now covers provider moves that round onto
 * different grid cells.
 */
function lodgingKey(s: Pick<ItineraryStop, 'placeId' | 'lat' | 'lng' | 'locationName' | 'title'>): string {
  if (s.placeId && s.placeId.trim()) return `pid:${s.placeId.trim()}`
  if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
    return `geo:${Math.round(s.lat * 200)}:${Math.round(s.lng * 200)}`
  }
  return `name:${(s.locationName || s.title).trim().toLowerCase().replace(/\s+/g, ' ')}`
}

/** Finite coercion for numbers that arrive from outside the type system —
 *  hydrated rows, hand-edited JSON, partial writes. `undefined * n` is NaN,
 *  and one NaN multiplies through every sum it joins: the timeline rendered
 *  "₹undefined" on the stop and ₹NaN on the strip, the chips and the print
 *  card (#343). Same shape as the visitMinutes guard in simulateDay, applied
 *  to each money field. */
function num0(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

export function computeTotals(trip: Trip, legCorrections?: Record<string, LegEstimate>): TripTotals {
  const A = getAssumptions(trip)
  let travelMinutes = 0, distanceKm = 0, stopCount = 0
  let transportKmCost = 0
  let journeyReturnsHome = false
  // Travellers scales every per-person line; a missing/zero count reads as one
  // rather than poisoning the sums with NaN.
  const travellers = num0(trip.travellers) > 0 ? num0(trip.travellers) : 1
  const dayCount = Math.max(1, trip.days.length)
  // Buckets key on the day's OWN index — the same id entryByDay/lodgingByDay
  // below join on. Positional lookups misattributed the transport/expense half
  // the moment indexes went sparse (deleting a middle day leaves 0,2,3): an
  // out-of-range `byDay[index]` was undefined and the day's money vanished,
  // while the consumers' old clamp showed a stranger's total under the day on
  // screen (#338).
  const byDay = trip.days.map(d => ({ dayIndex: d.index, expensesInr: 0, transportInr: 0, totalInr: 0, stops: 0, distanceKm: 0 }))
  if (byDay.length === 0) byDay.push({ dayIndex: 0, expensesInr: 0, transportInr: 0, totalInr: 0, stops: 0, distanceKm: 0 })
  /** The bucket for a day INDEX — never for an array position. */
  const bucketFor = (index: number | undefined): (typeof byDay)[number] | undefined =>
    index == null ? undefined : byDay.find(b => b.dayIndex === index)
  const entryByDay = new Map<number, number>()
  trip.days.forEach(day => {
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index, legCorrections)
    travelMinutes += sim.totalTravelMinutes
    distanceKm += sim.totalDistanceKm
    const bucket = bucketFor(day.index)
    if (bucket) {
      bucket.stops = day.stops.filter(s => s.status !== 'rejected').length
      bucket.distanceKm = sim.totalDistanceKm
    }
    stopCount += day.stops.filter(s => s.status !== 'rejected').length
    // per-leg fuel/fare cost derived from distance
    sim.legs.forEach(l => {
      const legCost = l.distanceKm * (A.inrPerKm ?? 8)
      transportKmCost += legCost
      if (bucket) bucket.transportInr += legCost
    })
    if (sim.endsAtStart) journeyReturnsHome = true
  })

  // Round trip: the drive back to the start burns fuel too, so it belongs in
  // the budget — unless a planned return day already drives home inside its
  // own journey (adding it again would double-count). Priced with the same
  // assumptions and refined by the OSRM correction for that leg when the UI
  // has fetched one.
  if (isRoundTrip(trip) && !journeyReturnsHome) {
    const turnaround = lastActiveStopPoint(trip)
    if (turnaround) {
      const home = firstFixedPoint(trip)
      const ret = legCorrections?.[legKey(turnaround, home)] ?? legBetween(turnaround, home, A)
      distanceKm += ret.distanceKm
      travelMinutes += ret.durationMinutes
      const retCost = ret.distanceKm * (A.inrPerKm ?? 8)
      transportKmCost += retCost
      // The drive home happens at the end of the trip — charge the LAST day by
      // its index, not its array position (the two differ on an unsorted or
      // sparse trip).
      const lastDay = byDay.reduce((a, b) => (b.dayIndex > a.dayIndex ? b : a))
      lastDay.transportInr += retCost
      lastDay.distanceKm += ret.distanceKm
    }
  }

  let sum = 0, essential = 0, optional = 0
  const byCategory: Record<string, number> = {}
  // stopId → day, so attached expenses land on the day that holds the stop
  const dayIndexOfStop = new Map<ID, number>()
  trip.days.forEach(d => d.stops.forEach(s => dayIndexOfStop.set(s.id, d.index)))
  for (const e of trip.expenses) {
    const amt = num0(e.amountInr) * (e.perPerson ? travellers : 1)
    sum += amt
    byCategory[e.category] = (byCategory[e.category] ?? 0) + amt
    if (e.optional) optional += amt; else essential += amt
    // The expense's own day, matched by INDEX; a stop-attached line follows its
    // stop's day. No clamp and no positional guess — a dayIndex that names no
    // day is treated as unattached (spread with the trip-level costs) instead
    // of being re-attributed to the last day, which is a different budget.
    const b = typeof e.dayIndex === 'number' && Number.isFinite(e.dayIndex) ? bucketFor(e.dayIndex)
      : e.stopId !== undefined ? bucketFor(dayIndexOfStop.get(e.stopId))
        : undefined
    if (b) b.expensesInr += amt
    else for (const bd of byDay) bd.expensesInr += amt / dayCount // unattached trip-level costs spread evenly
  }
  // entry fees from stops not already covered by explicit expenses
  let entryFromStops = 0
  trip.days.forEach(d => d.stops.forEach(s => {
    if (s.status !== 'rejected') {
      const fee = num0(s.entryFeeInrPerPerson) * travellers
      entryFromStops += fee
      entryByDay.set(d.index, (entryByDay.get(d.index) ?? 0) + fee)
    }
  }))
  // Lodging honesty (PLAN-DAY-PLANNER P1-E): the bill priced every cost except
  // the bed. Hotel-category stops — a structural night halt accepted from the
  // ride plan, or a stay added by hand — gain a lodging line: distinct
  // overnight bases × rooms (2 guests per room) × the stay rate for the
  // trip's style. The rate lives in rates.ts next to the Plan Bench's own
  // table — one source, no mirror to drift (#125b). A structural night halt's
  // minutes are still never charged against the day's detour budget.
  //
  // Base identity keys on place-id when the stop carries one, else a ~500 m
  // coordinate cluster, else a normalized name (#125a/#146): "Hotel Taj" vs
  // "Hotel Taj, Mumbai" is one night, not two, and two different pins in one
  // city are two nights, not one.
  const hotelBases = new Set<string>()
  trip.days.forEach(d => d.stops.forEach(s => {
    if (s.category === 'hotel' && s.status !== 'rejected') hotelBases.add(lodgingKey(s))
  }))
  const lodgingNights = hotelBases.size
  const lodgingRooms = Math.max(1, Math.ceil(travellers / 2))
  const lodgingRatePerNight = num0(STAY_RATE_PER_NIGHT[stayKeyFor(trip)])
  const lodgingInr = lodgingNights * lodgingRooms * lodgingRatePerNight
  // Each base's share lands on the first day that holds it, so the per-day
  // stacks keep summing to the trip total (the v0.36 accounting invariant).
  const lodgingByDay = new Map<number, number>()
  const seenBases = new Set<string>()
  const perBaseShare = lodgingNights > 0 ? lodgingInr / lodgingNights : 0
  trip.days.forEach(d => d.stops.forEach(s => {
    if (s.category === 'hotel' && s.status !== 'rejected' && !seenBases.has(lodgingKey(s))) {
      seenBases.add(lodgingKey(s))
      lodgingByDay.set(d.index, (lodgingByDay.get(d.index) ?? 0) + perBaseShare)
    }
  }))
  sum += entryFromStops + transportKmCost + lodgingInr
  byCategory['entry-fees'] = (byCategory['entry-fees'] ?? 0) + entryFromStops
  byCategory['transport'] = (byCategory['transport'] ?? 0) + transportKmCost
  byCategory['accommodation'] = (byCategory['accommodation'] ?? 0) + lodgingInr
  essential += entryFromStops + transportKmCost + lodgingInr
  for (const bd of byDay) bd.totalInr = bd.expensesInr + bd.transportInr + (entryByDay.get(bd.dayIndex) ?? 0) + (lodgingByDay.get(bd.dayIndex) ?? 0)

  return {
    totalCostInr: sum,
    // #213 Phase 6: guarded like costPerDayInr below — travellers is floored at 1
    // above, and `₹∞` / `₹NaN` on the bill is a bad failure mode.
    costPerPersonInr: sum / travellers,
    totalTravelMinutes: travelMinutes,
    totalDistanceKm: distanceKm,
    stopCount,
    costPerDayInr: sum / dayCount,
    essentialInr: essential,
    optionalInr: optional,
    lodgingInr,
    lodgingNights,
    lodgingRooms,
    lodgingRatePerNight,
    byCategory,
    byDay,
  }
}

/** Rupees with Indian grouping, finite-guarded (#369): one NaN or undefined
 *  money field used to render “₹NaN” on every surface that printed it — the
 *  same family as the totals' `num0` coercion (#343), fixed at the formatter so
 *  no caller has to remember. A missing value reads “—”, never “₹0”. */
export function formatInr(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

/** Compact rupees for card tiles — ₹1.2L / ₹5k — tabular-safe rounding.
 *  (TripsList used to carry a private divergent copy of this.) The non-finite
 *  guard is formatInr's own (#369): a NaN falls through every comparison here
 *  and would print as a compact "₹NaN". */
export function formatInrShort(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000) return `₹${Math.round(n / 1000)}k`
  return `₹${Math.round(n)}`
}

// ============ Itinerary-gap awareness (nearby suggestions) ============
// Nearby suggestions should fill what the plan lacks, not duplicate what it
// already has. computeCategoryBias inspects the itinerary and returns additive
// per-category score adjustments consumed by the nearby-suggestion ranking
// (src/lib/geocode.ts). Positive = suggest more of it; negative = the plan
// already covers it.

/** A self-drive day this long without a meal stop wants food ideas. */
const GAP_FOOD_DRIVE_KM = 120
/** Categories are considered "well covered" once the plan has this many stops of them. */
const GAP_COVERED_COUNT = 3

export function computeCategoryBias(trip: Trip): Record<string, number> {
  const bias: Record<string, number> = {}
  const bump = (cat: string, v: number) => { bias[cat] = (bias[cat] ?? 0) + v }
  const active = trip.days.flatMap(d => d.stops.filter(s => s.status !== 'rejected'))

  // A bare itinerary (nothing planned yet): seed a plausible tourist day —
  // things to see & do dominate, meals and stays follow on their own priority.
  if (active.length === 0) {
    bump('sightseeing', 5)
    bump('nature', 5)
    bump('beach', 3)
    bump('temple', 3)
    bump('museum', 3)
    return bias
  }

  // Already-covered categories get demoted so suggestions fill the gaps.
  const counts = new Map<string, number>()
  for (const s of active) counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
  for (const [cat, n] of counts) if (n >= GAP_COVERED_COUNT) bump(cat, -4)

  // Self-drive specifics: long hungry drives and overnight stays.
  if (isFuelEconomyMode(trip.transportMode)) {
    for (const d of trip.days) {
      const stops = d.stops.filter(s => s.status !== 'rejected')
      if (stops.length === 0) continue
      let km = 0
      for (let i = 1; i < stops.length; i++) {
        km += haversineKm(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng)
      }
      const hasFood = stops.some(s => s.category === 'food')
      if (km >= GAP_FOOD_DRIVE_KM && !hasFood) bump('food', 5)
    }
    const hasHotel = active.some(s => s.category === 'hotel')
    if (!hasHotel && trip.days.length >= 2) bump('hotel', 5)
  }

  // Travel-style priors: the style chosen at trip creation steers what the
  // suggestion engine favours — real ranking weights consumed by the nearby
  // POI ranker, not copy. These are the only five styles with an effect beyond
  // cadence/detour-budget/stay-tier; STYLE_COPY in CreateTrip states exactly
  // this, so the chips never promise more than the algorithm does.
  const stylePriors: Partial<Record<TravelStyle, [string, number][]>> = {
    adventure: [['adventure', 4], ['nature', 3]],
    spiritual: [['temple', 4]],
    'food-focused': [['food', 4]],
    creator: [['sightseeing', 3], ['museum', 2]],
  }
  for (const [cat, v] of stylePriors[trip.travelStyle] ?? []) bump(cat, v)

  return bias
}

