// ============ Scheduling & impact engine ============
// All outputs are transparent estimates. Nothing here claims live data.
import type { Trip, ItineraryStop, ItineraryDay, FixedCommitment } from '../data/types'
import { haversineKm } from './geo'

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

const MODE_SPEED: Record<string, number> = {
  car: 42, motorcycle: 44, taxi: 38, bus: 34, train: 55, flight: 320, mixed: 45,
}
const MODE_COST_PER_KM: Record<string, number> = {
  car: 9, motorcycle: 4.5, taxi: 16, bus: 2.2, train: 1.6, flight: 6.5, mixed: 8,
}

/**
 * Indicative all-India petrol price (₹/litre) used when a trip states its fuel
 * economy. Deliberately surfaced (Budget tab, field hints, StopEditor) — never
 * presented as live data, per the transparency promise.
 */
export const FUEL_PRICE_INR_PER_L = 105

/** Modes where the vehicle's own fuel economy meaningfully sets the ₹/km rate. */
const FUEL_ECONOMY_MODES = new Set<string>(['car', 'motorcycle'])

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
const PLAUSIBLE_KM_PER_L: Record<string, [number, number]> = { car: [8, 35], motorcycle: [12, 75] }

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
  return FUEL_ECONOMY_MODES.has(trip.transportMode) && trip.roundTrip !== false
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
  const m = Math.max(0, Math.round(mins))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function hmToMinutes(hm: string): number {
  if (!hm || !hm.includes(':')) return 0
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + (Number.isFinite(m) ? m : 0)
}

export function addMinutesToClock(startMin: number, mins: number): string {
  let t = startMin + Math.round(mins)
  t = ((t % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export interface LegEstimate {
  distanceKm: number
  durationMinutes: number
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

function coLocates(a: { lat: number; lng: number }, b: { lat: number; lng: number } | null | undefined): boolean {
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
 *  - return days (round trip, final-destination anchor + at most food/rest
 *    halts, outbound planned on an earlier day): the drive back home;
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
  // A round trip whose day holds the final-destination anchor (plus at most
  // food/rest halts) while the outbound drive was planned on an earlier day
  // starts at the turnaround point, not where the previous day ended.
  const anchorAtFinalDest = active.find(s => s.auto && coLocates(s, lastDest))
  const outboundPlannedEarlier = trip.days.some(d =>
    d.index < day.index && d.stops.some(s => s.status !== 'rejected'))
  const isReturnShape = !!(
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
    const isWaypoint = s.auto === true || (s.category === 'travel' && s.visitMinutes === 0 && s.transportCostInrTotal === 0)
    const isHalt = !isWaypoint && (s.category === 'food' || s.category === 'rest') && s.visitMinutes > 0
    const title = cleanPlaceName(s.locationName || s.title)
    const p = { lat: s.lat, lng: s.lng }
    const lg = leg(prev.point, p, prev.title, title)
    cursor += lg.durationMinutes
    const arrive = addMinutesToClock(startMin, cursor - startMin)
    // pure waypoints (auto anchors) count for distance but add no dwell/buffer
    const dwell = isWaypoint ? 0 : s.visitMinutes + A.bufferMinutesPerStop
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

export interface ScheduleWarning {
  code: string
  severity: Severity
  title: string
  detail: string
  fix: string            // recommended action
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

  trip.days.forEach((day) => {
    // simulateDay already builds the day's full unified journey — the drive
    // to the day's destination (or back home) is inside these totals, so no
    // overlay math is needed to make travel/fatigue checks honest.
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
    const n = sim.activeStops.length
    const travelMinutes = sim.totalTravelMinutes
    const travelKm = sim.totalDistanceKm

    // Excessive daily travel (>5h on the road)
    if (travelMinutes > 300) {
      warnings.push({ code: 'travel', severity: 'high', title: `Day ${day.index + 1}: heavy travel time`, detail: `About ${minutesToHM(travelMinutes)} of driving/transit across ${travelKm.toFixed(0)} km.`, fix: 'Move one activity to another day or pick a closer alternative.' })
    } else if (travelMinutes > 210) {
      warnings.push({ code: 'travel', severity: 'medium', title: `Day ${day.index + 1}: long travel time`, detail: `Roughly ${minutesToHM(travelMinutes)} in transit.`, fix: 'Consider starting earlier or dropping an optional stop.' })
    }

    // Fatigue risk: a self-drive day pushing well past ~7 h of wheel time with
    // no proper halt. Distinct from the generic travel warning above — the fix
    // here is a rest/meal halt (long-ride planner), not a route change.
    if (isFuelEconomyMode(trip.transportMode)) {
      const hasHalt = sim.activeStops.some(s => (s.category === 'food' || s.category === 'rest') && !s.auto && s.visitMinutes > 0)
      if (travelMinutes > FATIGUE_DRIVE_MINUTES && !hasHalt) {
        warnings.push({ code: 'fatigue', severity: 'high', title: `Day ${day.index + 1}: fatigue risk on a long drive`, detail: `About ${minutesToHM(travelMinutes)} of wheel time with no meal or rest halt.`, fix: 'Use the long-ride planner on this day to add a halt — or split the drive across two days.' })
      }
    }

    // Too many activities
    if (n > 6) {
      warnings.push({ code: 'density', severity: 'high', title: `Day ${day.index + 1} is over-packed`, detail: `${n} activities in one day leaves almost no slack.`, fix: 'Move one activity to another day.' })
    } else if (n > 5) {
      warnings.push({ code: 'density', severity: 'low', title: `Day ${day.index + 1} is busy`, detail: `${n} activities scheduled.`, fix: 'Keep buffer time in mind before adding more.' })
    }

    // Late finish
    const endMin = hmToMinutes(sim.endsAt)
    if (endMin > hmToMinutes('21:30')) {
      warnings.push({ code: 'late-arrival', severity: 'medium', title: `Day ${day.index + 1} ends very late`, detail: `Last activity wraps around ${sim.endsAt}.`, fix: 'Remove an optional stop or shorten visit durations.' })
    } else if (endMin > hmToMinutes(A.dayEnd)) {
      warnings.push({ code: 'late-arrival', severity: 'low', title: `Day ${day.index + 1} runs past plan`, detail: `Plan ends near ${sim.endsAt}.`, fix: 'Trim an optional stop to protect your evening.' })
    }

    // Opening-hours conflicts
    sim.activeStops.forEach((s, i) => {
      if (!s.openTime || !s.closeTime) return
      const arr = sim.arrivalTimes[i]
      if (hmToMinutes(arr) < hmToMinutes(s.openTime)) {
        warnings.push({ code: 'hours', severity: 'medium', title: `${s.title}: arrives before opening`, detail: `You reach ~${arr}, opens at ${s.openTime}.`, fix: 'Reorder stops so this comes later in the day.' })
      } else if (hmToMinutes(arr) + s.visitMinutes > hmToMinutes(s.closeTime)) {
        warnings.push({ code: 'hours', severity: 'medium', title: `${s.title}: closes too soon after arrival`, detail: `Arrival ~${arr}, but closes at ${s.closeTime} while you need ${minutesToHM(s.visitMinutes)}.`, fix: 'Visit this stop earlier or reduce time here.' })
      }
    })

    // Backtracking: any leg that doubles back within 25 km of a previous point chain
    const pts = sim.activeStops
    for (let i = 1; i < pts.length - 1; i++) {
      const back = legBetween(pts[i], pts[i - 1], A)
      const fwd = legBetween(pts[i], pts[i + 1], A)
      if (back.distanceKm < fwd.distanceKm * 0.55 && fwd.distanceKm > 18) {
        warnings.push({ code: 'backtrack', severity: 'low', title: `Day ${day.index + 1}: route backtracking`, detail: `The order of “${pts[i].title}” adds zig-zag distance.`, fix: 'Reorder stops along one direction.' })
        break
      }
    }

    // No meal window: if the day spans >6h with no food/rest stop
    const hasFoodOrRest = sim.activeStops.some(s => s.category === 'food' || s.category === 'rest')
    const span = endMin - hmToMinutes(A.dayStart)
    if (!hasFoodOrRest && span > 360) {
      warnings.push({ code: 'meals', severity: 'medium', title: `Day ${day.index + 1}: no meal/rest break`, detail: `A ${minutesToHM(span)} day without a planned food or rest stop.`, fix: 'Add a rest period or lunch stop.' })
    }

    // Weather-sensitive outdoor items
    const wCount = sim.activeStops.filter(s => s.weatherSensitive).length
    if (wCount >= 3) {
      warnings.push({ code: 'weather', severity: 'low', title: `Day ${day.index + 1} is weather-dependent`, detail: `${wCount} outdoor stops would all be affected by rain.`, fix: 'Identify an indoor backup for at least one stop.' })
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
      warnings.push({ code: 'commitment', severity: 'high', title: `Conflicts with ${fc.title}`, detail: `Day ${fc.dayIndex + 1} plan reaches its last stop after the ${fc.time} commitment.`, fix: 'Cut an earlier stop so you arrive with buffer.' })
    } else if (lastDepIdx >= 0 && commitMin - hmToMinutes(sim.arrivalTimes[lastDepIdx]) < 45 && sim.activeStops.length > 0) {
      warnings.push({ code: 'buffer', severity: 'medium', title: `Thin buffer before ${fc.title}`, detail: `Less than ~45 min of slack before the ${fc.time} commitment.`, fix: 'Drop one optional stop to protect your connection.' })
    }
  }

  // Hotel/transport changes between days (each new hotel night counts as friction)
  const hotelNights = countHotelNights(trip)
  if (hotelNights >= dayCount && dayCount >= 3) {
    warnings.push({ code: 'hotels', severity: 'low', title: 'Frequent accommodation changes', detail: `About ${hotelNights} different overnight bases in ${dayCount} days means packing/unpacking daily.`, fix: 'Consider a 2-night stay in one base town.' })
  }

  return warnings
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

export function countHotelNights(trip: Trip): number {
  const hotels = new Set<string>()
  trip.days.forEach(d => d.stops.forEach(s => { if (s.category === 'hotel') hotels.add(s.locationName) }))
  return hotels.size
}

export function originOf(trip: Trip, dayIndex: number): { lat: number; lng: number } {
  // Origin = last stop of previous day, else the first fixed point we know.
  for (let d = dayIndex - 1; d >= 0; d--) {
    const stops = trip.days[d]?.stops.filter(s => s.status !== 'rejected') ?? []
    if (stops.length) {
      const last = [...stops].sort((a, b) => a.orderInDay - b.orderInDay)[stops.length - 1]
      return { lat: last.lat, lng: last.lng }
    }
  }
  return firstFixedPoint(trip)
}

export function firstFixedPoint(trip: Trip): { lat: number; lng: number } {
  // A geocoded start (point A) is the trip's true origin when known.
  if (trip.startLocationCoords) return { lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng }
  for (const d of trip.days) {
    const first = [...d.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)[0]
    if (first) return { lat: first.lat, lng: first.lng }
  }
  return { lat: 9.9312, lng: 76.2673 } // Kochi fallback
}

/** Last active stop across the trip's days — the turnaround point of the route. */
export function lastActiveStopPoint(trip: Trip): { lat: number; lng: number } | null {
  for (let d = trip.days.length - 1; d >= 0; d--) {
    const stops = trip.days[d]?.stops.filter(s => s.status !== 'rejected') ?? []
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
  byCategory: Record<string, number>
}

export function computeTotals(trip: Trip, legCorrections?: Record<string, LegEstimate>): TripTotals {
  const A = getAssumptions(trip)
  let travelMinutes = 0, distanceKm = 0, stopCount = 0
  let transportKmCost = 0
  let journeyReturnsHome = false
  trip.days.forEach(day => {
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index, legCorrections)
    travelMinutes += sim.totalTravelMinutes
    distanceKm += sim.totalDistanceKm
    stopCount += day.stops.filter(s => s.status !== 'rejected').length
    // per-leg fuel/fare cost derived from distance
    sim.legs.forEach(l => { transportKmCost += l.distanceKm * (A.inrPerKm ?? 8) })
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
      transportKmCost += ret.distanceKm * (A.inrPerKm ?? 8)
    }
  }

  let sum = 0, essential = 0, optional = 0
  const byCategory: Record<string, number> = {}
  for (const e of trip.expenses) {
    const amt = e.perPerson ? e.amountInr * trip.travellers : e.amountInr
    sum += amt
    byCategory[e.category] = (byCategory[e.category] ?? 0) + amt
    if (e.optional) optional += amt; else essential += amt
  }
  // entry fees from stops not already covered by explicit expenses
  let entryFromStops = 0
  trip.days.forEach(d => d.stops.forEach(s => {
    if (s.status !== 'rejected') entryFromStops += s.entryFeeInrPerPerson * trip.travellers
  }))
  sum += entryFromStops + transportKmCost
  byCategory['entry-fees'] = (byCategory['entry-fees'] ?? 0) + entryFromStops
  byCategory['transport'] = (byCategory['transport'] ?? 0) + transportKmCost
  essential += entryFromStops + transportKmCost

  const dayCount = Math.max(1, trip.days.length)
  return {
    totalCostInr: sum,
    costPerPersonInr: sum / trip.travellers,
    totalTravelMinutes: travelMinutes,
    totalDistanceKm: distanceKm,
    stopCount,
    costPerDayInr: sum / dayCount,
    essentialInr: essential,
    optionalInr: optional,
    byCategory,
  }
}

export function formatInr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN')
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

  return bias
}

