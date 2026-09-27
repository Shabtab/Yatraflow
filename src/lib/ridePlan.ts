// ============ Ride-planning engine (fatigue-budget stop suggestions) ============
// Pure, provider-agnostic. Input: a journey's total km + wheel minutes (and
// whether fuel halts and/or cross-day overnights are wanted). Output: a list of
// segments — "at ~300 km take a meal break", "at ~550 km end the day in a big
// city" — each with an acceptance window. A separate assignment pass maps real
// place hits (POIs + key cities) onto these segments by purpose-fit, detour and
// distance-to-target, so a 1 400 km interstate drive gets suggestions that are
// logically spaced for fatigue instead of an even spray of tourist POIs.
//
// No network, no env — the corridor tests (tests/ridePlan.test.ts) exercise it
// directly.

import { haversineKm } from './geo'
import { classifyRoadWindow, CITY_SPEED_KMH, CITY_CRAWL_WARNING, type RoadKind } from './roadPersonality'
import { dnaBoostForHit, type DnaVector } from './tripDna'
import { hmToMinutes } from './engine'
import { HOME_ZONE_KM, kmFromStartForHit, asymmetricDetourMinutes, dedupeCandidates, type HaltPurpose, type PlaceHit } from './providers/hits'
import { DEFAULT_FIT, PURPOSE_FIT } from './haltFit'

// ---- Fatigue cadence (named constants — later settings can expose them) ----
/** ≈2 h at 70–80 km/h — stretch, hydrate, bio-break. */
export const STRETCH_INTERVAL_KM = 150
/** ≈4 h — the lunch cadence. */
export const MEAL_INTERVAL_KM = 300
/** Default tank range for fuel cadence (honoured per vehicleRangeKm when set). */
export const FUEL_INTERVAL_KM = 450
/** ≈7 h — the cross-day overnight cadence; max daily drive cap is 8 h. */
export const OVERNIGHT_INTERVAL_KM = 550
/** Drift below this km keeps an accepted halt's pin without asking (#143).
 *  Engine-pure (tests + callers import it); the localStorage pin store lives
 *  in uiPrefs. */
export const HALT_PIN_HYSTERESIS_KM = 15

/** Never place two breaks closer than this. */
export const MIN_BREAK_GAP_KM = 110
/** Never propose a stop inside this distance of the journey's end. */
export const ENDNO_KM = 60
/** Drives shorter than this don't need planned breaks at all. */
export const MIN_PLANNED_DRIVE_KM = 90

// ---- Derived clock constants (PLAN-DAY-PLANNER §5 — every number a
// consequence of the engine's own speeds, never an example) ----
/**
 * The fatigue cadence is HOURS, not km: ≈2 h at highway 65–75 km/h is where
 * the 150 km constant came from, but the engine's blended all-India speed
 * (MODE_SPEED.car 42) turns 150 km into 3.6 h. Stretch cadence is therefore
 * clock-first: fires at `STRETCH_CLOCK_MIN` of wheel time, expressed in km at
 * the journey's own blended speed, and never looser than the km cadence.
 */
export const STRETCH_CLOCK_MIN = 120
/** Max wheel hours per driving day (the waking span ≈12.5 h minus ≈2.5 h of
 *  halts). Packed 11 / relaxed 8.5 — see wheelCapHoursFor. */
export const WHEEL_HOURS_CAP = 10
/** The driving day hard-caps at this clock (night-driving default; a settings
 *  exposure later — PLAN-DAY-PLANNER §16.2). */
export const NIGHT_END_MIN = 23 * 60
/** Halt durations in minutes (tea is the stretch cadence landing in a tea window). */
export const HALT_MIN = { stretch: 15, meal: 45, tea: 20, fuel: 15, dinner: 60 } as const

// ---- Fixed biological meal anchors (PLAN-DAY-PLANNER §4) — windows in
// minutes since midnight. Meals are clock facts, not route facts: the car
// stops when the body needs it, wherever the road is. Dinner ends the day. ----
// ONE lunch window, shared by the segment slide and the clock walk (#130):
// 11:30 open respects dhaba reality, 14:30 closes the late-lunch tail. (The
// old private MEAL_WINDOW [11:30] vs LUNCH_WINDOW [12:00] drift meant a meal
// slid to 11:40 was "in window" for segments but "missed" for the clock.)
export const BREAKFAST_WINDOW: [number, number] = [8 * 60, 9 * 60 + 30]
export const LUNCH_WINDOW: [number, number] = [11 * 60 + 30, 14 * 60 + 30]
export const TEA_WINDOW: [number, number] = [16 * 60 + 30, 17 * 60 + 30]
export const DINNER_WINDOW: [number, number] = [20 * 60, 21 * 60]
/** Late starts with less honest wheel time than this before NIGHT_END defer to
 *  tomorrow (PLAN-DAY-PLANNER §4: never silent night driving). Provenance
 *  (#127): 2 h — one anchor cycle plus margin; below it, daylight is a lie. */
export const MIN_HONEST_WHEEL_MIN = 120
/** A waking span shorter than this can't fit the honest anchor pattern — the
 *  day becomes a short hop to a night halt (drive ≤2 h, dinner at the halt).
 *  Provenance (#127): 6 h — half the ≈12.5 h waking span. */
export const HOP_WHEEL_MAX_MIN = 6 * 60
/** The defer proposal's suggested start. */
export const DEFER_START = '06:00'

/** Rain multiplier clamp, single source (#132): 0.5–1, non-numbers → 1. A
 *  clamped torrential input is capped at 0.5 by design — the model has no
 *  "drive faster in rain" tail and understates rather than overpromises. */
export function clampRainFactor(raw: number | undefined): number {
  return Number.isFinite(raw) ? Math.min(1, Math.max(0.5, raw as number)) : 1
}

/**
 * Confidence-weighted rain factor (#141): a 60% CHANCE of drizzle must not
 * equal a 60% chance of a cloudburst, so the cap multiplier separates the
 * probability (the forecast's rain chance) from the severity (the WMO code).
 * Drizzle-class codes damp the probability before it reaches the multiplier;
 * storm-class codes weight it up. Both tails clamp inside [0.5, 1] via
 * clampRainFactor — the model still never "drives faster in rain".
 * Undefined code (probability-only input) reproduces the old arithmetic.
 */
export function rainFactorFor(pct: number | null | undefined, code?: number): number {
  if (pct == null || !Number.isFinite(pct)) return 1
  const c = code
  let severity = 1
  if (c != null && Number.isFinite(c)) {
    if (c >= 95) severity = 1.25        // thunderstorm family
    else if (c >= 71 && c <= 86) severity = 1.1  // heavy snow / violent showers
    else if (c >= 65 || c === 82) severity = 1.1 // heavy rain / violent showers
    else if (c >= 51 && c <= 57) severity = 0.75 // drizzle family
    else if (c >= 61 && c <= 63) severity = 0.9  // light-to-mid rain
  }
  return clampRainFactor(1 - (pct / 200) * severity)
}

/** Style-tuned daily wheel cap, mode-tuned (#126). Packed pushes 11 h;
 *  relaxed rests at 8.5; balanced 10. Case/whitespace-tolerant (#132):
 *  "Packed " is packed, not a silent 10 h.
 *
 *  Mode tuning (#126): a motorcycle rides a full 1.5 h BELOW the same style's
 *  car cap — helmet fatigue and exposure compound, and nobody's life should
 *  depend on an 11 h saddle day. Conducted modes (train/bus/flight/taxi —
 *  someone else drives) are untuned here: the planner refuses to split their
 *  journeys at all (isSelfDrivenMode). Defaults keep every existing caller
 *  (style-only) byte-compatible. */
export function wheelCapHoursFor(travelStyle?: string, transportMode?: string): number {
  const s = (travelStyle ?? '').trim().toLowerCase()
  const base = s === 'packed' ? 11 : s === 'relaxed' ? 8.5 : WHEEL_HOURS_CAP
  if (transportMode === 'motorcycle') return Math.max(4, base - 1.5)
  return base
}

/** Modes where the PLANNER's crew drives: self-drive cars/rentals and
 *  motorcycles get the full fatigue model (wheel caps, day splits, night
 *  halts). Conducted modes — train, bus, flight, taxi — are someone else's
 *  shift: a 3200 km "split verdict" for a flight leg was noise (#126), and
 *  their long-distance legs carry no driving fatigue to plan around. `mixed`
 *  stays plannable (it can include real driving). */
export function isSelfDrivenMode(transportMode?: string): boolean {
  const m = (transportMode ?? '').trim().toLowerCase()
  return m === 'car' || m === 'rental' || m === 'motorcycle' || m === 'mixed'
}

/** Party + mode inputs that move the wheel cap (#142). */
export interface PartyOpts {
  travelStyle?: string
  transportMode?: string
  /** licensed drivers rotating the wheel (default 1; credits cap at 4) */
  driverCount?: number
  /** infants or seniors aboard — shorter days, earlier dinner */
  hasVulnerable?: boolean
}

/**
 * Honest wheel hours for WHO is driving WHAT (#126 + #142). null = conducted
 * mode (isSelfDrivenMode owns that call: train/bus/flight/taxi are someone
 * else's shift). Motorcycle saddle fatigue is already priced into the mode-
 * tuned style cap (#126). Two rotating drivers buy the day real hours (+2 h,
 * +3 h max at 3+); vulnerable passengers shorten it (−1 h). Rails: never
 * below 6 h, never above 12 — even four packed drivers get a sleep.
 */
export function wheelCapHoursForParty(o: PartyOpts): number | null {
  // Gate only an EXPLICIT mode: legacy callers (and every geometry-free test)
  // omit transportMode and keep planning; an omitted mode means "no mode
  // verdict asked for", not "conducted".
  if (o.transportMode != null && !isSelfDrivenMode(o.transportMode)) return null
  let cap = wheelCapHoursFor(o.travelStyle, o.transportMode)
  const drivers = Math.min(Math.max(1, Math.floor(o.driverCount ?? 1)), 4)
  if (drivers >= 2) cap += 2 + Math.min(1, drivers - 2)
  if (o.hasVulnerable) cap -= 1
  return Math.min(12, Math.max(6, cap))
}

/** Meal/night anchors as INPUTS with party-aware defaults (#122). The windows
 *  stop being biological absolutes the moment the party or the light changes;
 *  every default reproduces today's constants exactly. */
export interface AnchorOpts {
  /** default 20:00 — kids/seniors pull it to 19:00 via the caller */
  dinnerStartMin?: number
  /** default 21:00 */
  dinnerEndMin?: number
  /** default 23:00. NIGHT_END assumes dinner-service close + buffer, NOT
   *  daylight safety — latitude/sunset-aware ends land with #124; until then
   *  northern-winter trips should override this explicitly. */
  nightEndMin?: number
  /** default 0 = dinner ends the day. Dhaba-style long drives set ~120:
   *  halt for dinner (60 min dwell), then keep going within this allowance
   *  and the night end. */
  allowPostDinnerDriveMin?: number
}
const ANCHOR_DEFAULTS: Required<AnchorOpts> = {
  dinnerStartMin: DINNER_WINDOW[0],
  dinnerEndMin: DINNER_WINDOW[1],
  nightEndMin: NIGHT_END_MIN,
  allowPostDinnerDriveMin: 0,
}

/** Merge anchor overrides, holding the invariant that the night end stays a
 *  full hour past dinner close — an early dinner must not force an earlier
 *  stop than the meal itself (#122). */
export function resolveAnchors(a?: AnchorOpts): Required<AnchorOpts> {
  const out = { ...ANCHOR_DEFAULTS, ...a }
  out.nightEndMin = Math.max(out.nightEndMin, out.dinnerEndMin + 60)
  return out
}


/**
 * The ONE definition of "does this day count as driving" (#134): the planner
 * earns its stretch segments when EITHER floor is crossed — 90 km of road or
 * 2 h on the wheel — so an 80 km ghat crawl is a DRIVE day on the timeline
 * header too, not a "Drive + local". Both surfaces call this.
 */
export const isDriveDay = (distanceKm: number, driveMinutes: number): boolean =>
  distanceKm >= MIN_PLANNED_DRIVE_KM || driveMinutes >= STRETCH_CLOCK_MIN

/** The Day Planner's split verdict for a journey: pure, geometry-free. */
export interface DriveDaysPlan {
  /** driving days the route demands (≥1) */
  driveDayCount: number
  /** km per driving day — the load-balanced split (minimize max daily wheel) */
  perDay: number
  /** km positions of the night halts (every internal day boundary) */
  nightHalts: number[]
  /** worst daily wheel time after the split, in minutes */
  maxDailyWheelMin: number
}

/**
 * Derive the drive-day split a route DEMANDS from a duration fatigue cap —
 * never from the user's planned day count, and never from a fixed km tick
 * (the old 550 km @ blended 42 km/h demanded a 13.1 h day by the engine's
 * own speed table). `dailyKmBudget = wheelCap × journey speed`, so ghat/
 * city journeys self-shrink (the cap is in hours; slow roads earn fewer km).
 * The split is load-balanced: `perDay = total / count` minimizes the maximum
 * daily wheel time (700 km @ 42 → 2 × 350, never 585 + 115). Single-day
 * verdicts carry no night halts. Style and rain enter as cap multipliers.
 */
export function planDriveDays(input: {
  totalKm: number
  /** wheel time (driving only) for the whole journey */
  driveMinutes: number
  travelStyle?: string
  /** 0.5–1 multiplier on the wheel cap (e.g. rainFactor = 1 − dayRainPct/200) */
  rainFactor?: number
  /** transport mode; non-driven modes (train/bus/flight/mixed) → null verdict (#126) */
  transportMode?: string
  /** licensed drivers rotating the wheel (#142) */
  driverCount?: number
  /** infants/seniors aboard — shorter honest days (#142) */
  hasVulnerable?: boolean
  /** terrain-aware wheel-time profile (#124) — absent = the blended rate */
  profile?: RoadProfilePoint[] | null
}): DriveDaysPlan | null {
  const totalKm = input.totalKm
  const driveMin = input.driveMinutes
  const profile = input.profile ?? null
  if (!Number.isFinite(totalKm) || totalKm <= 0 || !Number.isFinite(driveMin) || driveMin <= 0) return null
  const capH = wheelCapHoursForParty({
    travelStyle: input.travelStyle, transportMode: input.transportMode,
    driverCount: input.driverCount, hasVulnerable: input.hasVulnerable,
  })
  if (capH == null) return null // #126: a timetable trip has no wheel to fatigue
  const rain = clampRainFactor(input.rainFactor)
  const cap = capH * rain
  const kmPerMin = totalKm / driveMin
  const dailyKmBudget = cap * 60 * kmPerMin
  if (totalKm <= dailyKmBudget) {
    return { driveDayCount: 1, perDay: totalKm, nightHalts: [], maxDailyWheelMin: driveMin }
  }
  const count = Math.ceil(totalKm / dailyKmBudget)
  const perDay = totalKm / count
  const endnoDay = Math.min(ENDNO_KM, perDay * 0.15)
  const capKm = totalKm - endnoDay
  const nightHalts: number[] = []
  // Equal km is equal wheel time only when the terrain is uniform (#124): with a
  // profile the boundaries sit where CUMULATIVE TIME is even, so the split keeps
  // minimizing the maximum daily WHEEL TIME as its contract claims.
  const perDayMinutes = driveMin / count
  for (let i = 1; i < count; i++) {
    const km = profile ? (kmAt(profile, perDayMinutes * i) ?? perDay * i) : perDay * i
    if (km < capKm) nightHalts.push(km)
  }
  // The reported worst day must survive the terrain: with a profile it is the
  // real maximum over the (now uneven) spans, not the blended average.
  const spans = [0, ...nightHalts, totalKm]
  let maxDailyWheelMin = perDay / kmPerMin
  if (profile) {
    let worst = perDay / kmPerMin
    for (let i = 1; i < spans.length; i++) {
      const a = minutesAt(profile, spans[i - 1])
      const b = minutesAt(profile, spans[i])
      if (a != null && b != null && b - a > worst) worst = b - a
    }
    maxDailyWheelMin = worst
  }
  return { driveDayCount: count, perDay, nightHalts, maxDailyWheelMin }
}

// ---- The travel clock (PLAN-DAY-PLANNER §4–§5) ----
/** One walked driving day: anchors on the clock, the night halt where the
 *  day's wheel budget or dinner ends it. */
export interface TravelClockDay {
  dayIndex: number
  /** route-km where this day starts driving */
  startKm: number
  /** route-km this day covers (its night halt; the final day ends at the destination) */
  kmCovered: number
  /** km of the night halt (null on the final day — the journey ends) */
  nightHaltKm: number | null
  /** wall-clock arrival at the night halt, minutes since midnight */
  nightHaltEtaMin: number | null
  /** true when the halt lands early enough that dinner is eaten at the halt */
  dinnerAtHalt: boolean
  /** wheel minutes driven this day */
  wheelMin: number
  /** wall-clock minutes spent on halt dwell this day (#129/#138 — the waking
   *  span is wheel + dwell; a day that fits by wheel alone can still overflow) */
  dwellMin: number
  /** final-day wall-clock arrival, minutes since midnight (set when isFinal) */
  arrivalEtaMin: number | null
  /** true when the destination arrival lands after NIGHT_END 23:00 (#138) */
  lateArrival: boolean
  /** meal anchors that fired on the road, in drive order */
  anchors: TravelClockAnchor[]
}

export interface TravelClockAnchor {
  name: 'breakfast' | 'lunch' | 'tea'
  /** route-km where the anchor halt lands */
  km: number
  /** wall-clock the halt starts, minutes since midnight */
  etaMin: number
  /** halt duration in minutes */
  minutes: number
}

export type TravelClockVerdict =
  | { verdict: 'defer'; wheelAvailMin: number; reason: string }
  | { verdict: 'hop'; hopKm: number; nightHaltEtaMin: number; reason: string }
  | {
      verdict: 'ok'
      days: TravelClockDay[]
      /** the drive home, walked separately (#145) — km are RETURN-LEG relative
       *  (0 = destination, totalKm = back home), dayIndex continues the
       *  outbound count; null for one-way trips and circuits. */
      returnDays: TravelClockDay[] | null
      split: DriveDaysPlan | null
    }

/** Module-level default drive start (the planRideSegments-local one is not in
 *  this scope). Derived days 2+ always start here. */
const CLOCK_DEFAULT_START = '08:30'

/** Parse "HH:MM" (or fall back to the 08:30 default) into minutes since midnight. */
function clockStartMin(raw: string | undefined): number {
  if (raw && /^\d{1,2}:\d{2}$/.test(raw)) return hmToMinutes(raw)
  return hmToMinutes(CLOCK_DEFAULT_START)
}

/**
 * A cumulative wheel-time profile (#124): the wheel minutes elapsed at each
 * distance along the route, ascending in km. Built from measured road legs it
 * lets the walk position anchors on the REAL terrain mix — a ghat morning
 * covers far fewer km per hour than the highway afternoon, and one blended
 * `totalKm / driveMinutes` rate placed lunch and the night halt too far along
 * every mixed-terrain day.
 */
export interface RoadProfilePoint { km: number; min: number }

/** Wheel minutes at a distance, linearly interpolated; null when unusable. */
function minutesAt(profile: RoadProfilePoint[], km: number): number | null {
  if (profile.length < 2 || !Number.isFinite(km)) return null
  const first = profile[0]
  const last = profile[profile.length - 1]
  if (km <= first.km) return first.min
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]
    const b = profile[i]
    if (km <= b.km) {
      const span = b.km - a.km
      const t = span > 0 ? (km - a.km) / span : 0
      return a.min + t * (b.min - a.min)
    }
  }
  return last.min
}

/** Distance covered after a duration — the inverse of `minutesAt`; null when unusable. */
function kmAt(profile: RoadProfilePoint[], min: number): number | null {
  if (profile.length < 2 || !Number.isFinite(min)) return null
  const first = profile[0]
  const last = profile[profile.length - 1]
  if (min <= first.min) return first.km
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]
    const b = profile[i]
    if (min <= b.min) {
      const span = b.min - a.min
      const t = span > 0 ? (min - a.min) / span : 0
      return a.km + t * (b.km - a.km)
    }
  }
  return last.km
}

/**
 * Build a wheel-time profile from measured legs (any provider). Null when the
 * legs carry no usable time/distance, so callers keep the blended rate.
 *
 * GRANULARITY (#124): the app routes leg-by-leg between stops, so this only
 * resolves terrain that changes AT a stop — a ghat inside a single leg
 * degenerates to the blended rate. Finer data (provider per-step or
 * per-coordinate durations, or a stated terrain speed model) is a separate
 * decision.
 */
export function roadProfileFromLegs(
  legs: { distanceKm: number; durationMinutes: number; segments?: RoadProfilePoint[] }[],
): RoadProfilePoint[] | null {
  const pts: RoadProfilePoint[] = [{ km: 0, min: 0 }]
  let km = 0
  let min = 0
  for (const leg of legs) {
    if (!Number.isFinite(leg.distanceKm) || !Number.isFinite(leg.durationMinutes)) continue
    if (leg.distanceKm <= 0 || leg.durationMinutes <= 0) continue
    const segs = leg.segments
    if (segs && segs.length >= 2 && segs[segs.length - 1].km > 0) {
      // Intra-leg resolution (#204): OSRM's own per-coordinate distance/duration
      // hops, offset onto the corridor. This is what lets a ghat INSIDE one
      // stop-to-stop leg move the anchors — the gap this issue was filed for.
      for (let i = 1; i < segs.length; i++) {
        const p = segs[i]
        if (!Number.isFinite(p.km) || !Number.isFinite(p.min) || p.km <= segs[i - 1].km) continue
        pts.push({ km: km + p.km, min: min + p.min })
      }
      km += segs[segs.length - 1].km
      min += segs[segs.length - 1].min
      continue
    }
    km += leg.distanceKm
    min += leg.durationMinutes
    pts.push({ km, min })
  }
  return pts.length >= 2 ? pts : null
}

/**
 * The profile of a ROUND TRIP: the outbound profile followed by itself shifted
 * by the outbound totals — the drive home retraces the same road (#124). Used
 * only where a caller bills the whole loop (the split verdict); the clock walks
 * the outbound and reuses one profile for both directed legs.
 */
export function loopProfile(profile: RoadProfilePoint[] | null): RoadProfilePoint[] | null {
  if (!profile || profile.length < 2) return profile
  const last = profile[profile.length - 1]
  return [
    ...profile,
    ...profile.slice(1).map(p => ({ km: p.km + last.km, min: p.min + last.min })),
  ]
}

/**
 * Walk one driving day on the clock. Anchors fire when the car is on the road
 * inside their window (breakfast only for starts before the window opens —
 * an 08:30 start has eaten at home); the day ends at the first of its km
 * budget, dinner (the halt IS dinner), or the wheel cap. The km budget is a
 * CAP — a late start can only cover what the clock allows, and the caller
 * re-balances the remainder over the remaining days.
 *
 * `capKm` (#140): a non-final halt may never land inside the destination
 * exclusion zone the split path already enforces — the boundary clamps to it.
 * The final day ignores the cap: it ENDS at the destination by definition.
 * The destination day is also not exempt from the clock (#138): its arrival
 * ETA is computed and flagged when it lands after NIGHT_END.
 */
function walkClockDay(input: {
  dayIndex: number
  startKm: number
  kmBudget: number
  startMin: number
  kmPerMin: number
  /** true = this day ends at the destination (no night halt) */
  isFinal: boolean
  /** destination exclusion cap — halts never land past this (#140) */
  capKm?: number
  /** meal/night anchor overrides with party-aware defaults (#122) */
  anchors?: AnchorOpts
  /** terrain-aware wheel-time profile (#124) — absent = the blended rate */
  profile?: RoadProfilePoint[] | null
}): TravelClockDay {
  const { dayIndex, startKm, kmBudget, startMin, kmPerMin, isFinal, capKm = Infinity, profile = null } = input
  const { dinnerStartMin, nightEndMin, allowPostDinnerDriveMin } = resolveAnchors(input.anchors)
  const maxKm = startKm + kmBudget
  let t = startMin
  let km = startKm
  let dwellMin = 0
  const anchors: TravelClockAnchor[] = []
  // The two conversions every placement needs — terrain-aware when a profile
  // arrived, the blended rate otherwise (so absent data behaves exactly as
  // before #124).
  const kmAfter = (fromKm: number, minutes: number): number => {
    if (minutes <= 0) return fromKm
    if (profile) {
      const here = minutesAt(profile, fromKm)
      if (here != null) {
        const target = kmAt(profile, here + minutes)
        if (target != null) return Math.max(fromKm, target)
      }
    }
    return fromKm + minutes * kmPerMin
  }
  const minutesFor = (fromKm: number, dKm: number): number => {
    if (dKm <= 0) return 0
    if (profile) {
      const a = minutesAt(profile, fromKm)
      const b = minutesAt(profile, fromKm + dKm)
      if (a != null && b != null) return Math.max(0, b - a)
    }
    return dKm / kmPerMin
  }
  const tryAnchor = (name: TravelClockAnchor['name'], window: [number, number], minutes: number) => {
    if (km >= maxKm - 0.5) return // the budget runs out before this meal matters
    const eta = Math.max(t, window[0])
    if (eta > window[1]) return // window missed — the day started too late for it
    const kmAtEta = kmAfter(km, eta - t)
    if (kmAtEta >= maxKm - 0.5) return // the halt comes first
    km = kmAtEta
    t = eta + minutes
    dwellMin += minutes
    anchors.push({ name, km: Math.round(kmAtEta), etaMin: Math.round(eta), minutes })
  }
  // Breakfast fires only when the day is on the road before the window opens.
  if (startMin < BREAKFAST_WINDOW[0]) tryAnchor('breakfast', BREAKFAST_WINDOW, HALT_MIN.meal)
  tryAnchor('lunch', LUNCH_WINDOW, HALT_MIN.meal)
  tryAnchor('tea', TEA_WINDOW, HALT_MIN.tea)
  if (isFinal) {
    // The destination day gets the full clock check too (#138) — no silent
    // post-night-end arrivals. Arrival = current t + the wheel left to the end.
    const arrivalEtaMin = Math.round(t + minutesFor(km, maxKm - km))
    return { dayIndex, startKm, kmCovered: maxKm, nightHaltKm: null, nightHaltEtaMin: null, dinnerAtHalt: false, wheelMin: Math.round(minutesFor(startKm, maxKm - startKm)), dwellMin, arrivalEtaMin, lateArrival: arrivalEtaMin > nightEndMin, anchors }
  }
  // Non-final days may not push a halt into the exclusion zone (#140): the
  // boundary the day aims for is its budget clamped to the cap.
  const boundary = Math.min(maxKm, capKm)
  // Night halt: drive toward the day's boundary; when the clock reaches dinner
  // first, the halt IS dinner and the boundary moves in (a late start buys a
  // shorter day, never night driving — the night end is the backstop below).
  const wheelToBoundary = minutesFor(km, boundary - km)
  const etaAtBoundary = t + wheelToBoundary
  if (etaAtBoundary <= dinnerStartMin) {
    return { dayIndex, startKm, kmCovered: boundary, nightHaltKm: boundary, nightHaltEtaMin: Math.round(etaAtBoundary), dinnerAtHalt: true, wheelMin: Math.round(minutesFor(startKm, boundary - startKm)), dwellMin, arrivalEtaMin: null, lateArrival: false, anchors }
  }
  // Dinner branch: aim the halt at dinner-open; the ENDNO cap may pull it in
  // earlier, in which case dinner was NOT eaten at the halt (dinnerAtHalt
  // false — the halt row on the map omits the dinner flag).
  const haltEtaIdeal = Math.max(t, dinnerStartMin)
  const idealKm = kmAfter(km, haltEtaIdeal - t)
  const haltKm = Math.min(idealKm, boundary)
  const haltEta = Math.round(t + minutesFor(km, haltKm - km))
  // Dhaba case (#122): when the trip allows post-dinner driving, the day
  // doesn't END at dinner — it halts for the meal (60 min dwell), then keeps
  // going within the allowance and the night end. The day then covers dinner
  // AND the extra leg; the caller reads the single entry's extended cover.
  if (allowPostDinnerDriveMin > 0) {
    const dinnerT = haltEta + HALT_MIN.dinner
    const postWheel = Math.min(allowPostDinnerDriveMin, Math.max(0, nightEndMin - dinnerT))
    const postKm = Math.min(boundary, kmAfter(haltKm, postWheel))
    const covered = postKm > haltKm + 0.5 ? postKm : haltKm
    return { dayIndex, startKm, kmCovered: covered, nightHaltKm: covered, nightHaltEtaMin: Math.round(dinnerT + minutesFor(haltKm, covered - haltKm)), dinnerAtHalt: idealKm <= boundary + 0.5, wheelMin: Math.round(minutesFor(startKm, covered - startKm)), dwellMin: dwellMin + HALT_MIN.dinner, arrivalEtaMin: null, lateArrival: false, anchors }
  }
  return { dayIndex, startKm, kmCovered: haltKm, nightHaltKm: haltKm, nightHaltEtaMin: haltEta, dinnerAtHalt: idealKm <= boundary + 0.5, wheelMin: Math.round(minutesFor(startKm, haltKm - startKm)), dwellMin, arrivalEtaMin: null, lateArrival: false, anchors }
}

/**
 * The Day Planner's one-pass verdict: fixed meal anchors on the clock, a
 * duration cap on wheel time, dinner ends the day — and the start time only
 * ever changes the schedule, never the capacity. Late starts produce honest
 * outcomes: under 2 h of wheel time before NIGHT_END is a defer proposal, a
 * waking span too short for the anchor pattern is a short hop to a night
 * halt, and a late first day shrinks while the remainder re-balances over the
 * following days (still load-balanced — never one 420 km day plus a 41 km
 * crumb). Pure; the fixtures of PLAN-DAY-PLANNER §14 are its spec.
 */
export function planTravelClock(input: {
  totalKm: number
  driveMinutes: number
  /** "HH:MM" drive start of day 1 — derived days default to 08:30 */
  dayStart?: string
  travelStyle?: string
  /** 0.5–1 multiplier on the wheel cap (rain), as in planDriveDays */
  rainFactor?: number
  /** per-day rain % (index = the walked day); beats the scalar when present
   *  (#127) — day 3's cloudburst caps day 3, not the whole trip. */
  dayRainPct?: (number | null)[]
  /** #126 mode gate + #142 party inputs feed the same wheel cap. */
  transportMode?: string
  driverCount?: number
  hasVulnerable?: boolean
  /** #122 party/season anchor overrides. */
  anchors?: AnchorOpts
  /** #145 round trip: walk the drive home as a second, reversed pass. */
  roundTrip?: boolean
  /** WMO code per walked day (#141) — separates drizzle from cloudburst
   *  inside each day's cap multiplier. Index-aligned with dayRainPct. */
  dayWeatherCode?: (number | null)[]
  /** terrain-aware wheel-time profile (#124) — absent = the blended rate */
  profile?: RoadProfilePoint[] | null
}): TravelClockVerdict {
  const totalKm = input.totalKm
  const driveMin = input.driveMinutes
  const anchors = resolveAnchors(input.anchors)
  // #126 mode gate + #142 party cap, one call. null = timetable mode: there is
  // no wheel to fatigue, so there is no drive to plan (empty ok, not a defer).
  const capH = wheelCapHoursForParty({
    travelStyle: input.travelStyle, transportMode: input.transportMode,
    driverCount: input.driverCount, hasVulnerable: input.hasVulnerable,
  })
  if (capH == null) return { verdict: 'ok', days: [], returnDays: null, split: null }
  if (!Number.isFinite(totalKm) || totalKm <= 0 || !Number.isFinite(driveMin) || driveMin <= 0) {
    return { verdict: 'ok', days: [], returnDays: null, split: null }
  }
  const kmPerMin = totalKm / driveMin
  const startMin = clockStartMin(input.dayStart)
  const wheelAvailMin = anchors.nightEndMin - startMin
  if (wheelAvailMin < MIN_HONEST_WHEEL_MIN) {
    return {
      verdict: 'defer',
      wheelAvailMin,
      reason: `Under ${MIN_HONEST_WHEEL_MIN / 60} h of honest wheel time before ${Math.floor(anchors.nightEndMin / 60)}:00 — leave tomorrow by ${DEFER_START} instead`,
    }
  }
  // The rain clamp is per walked day (#127): day i's forecast caps only day
  // i, and the WMO severity code weights the multiplier (#141) — a drizzle
  // damps, a thunderstorm floors out.
  const rainFor = (i: number): number =>
    input.dayRainPct?.[i] != null
      ? rainFactorFor(input.dayRainPct[i], input.dayWeatherCode?.[i] ?? undefined)
      : clampRainFactor(input.rainFactor)
  const capKmFor = (i: number): number => capH * 60 * rainFor(i) * kmPerMin
  const capKmBudget = capKmFor(0)
  if (wheelAvailMin < HOP_WHEEL_MAX_MIN) {
    // Short hop: drive up to 2 h toward a night halt and have dinner there —
    // the real drive starts tomorrow. Never silent night driving.
    const hopMin = Math.min(HALT_MIN.dinner * 2, wheelAvailMin - 60)
    const hopKm = Math.round(hopMin * kmPerMin)
    return {
      verdict: 'hop',
      hopKm,
      nightHaltEtaMin: Math.min(anchors.nightEndMin - 60, startMin + hopMin),
      reason: `Late start — drive ~${hopKm} km to a night halt, eat dinner there, and let the real drive start tomorrow`,
    }
  }
  const split = planDriveDays({
    totalKm, driveMinutes: driveMin, travelStyle: input.travelStyle, rainFactor: input.rainFactor,
    transportMode: input.transportMode, driverCount: input.driverCount, hasVulnerable: input.hasVulnerable,
  })
  if (!split) return { verdict: 'ok', days: [], returnDays: null, split: null }
  // One walked leg (outward or return): split-count days, first day on the
  // real clock, remainder re-balanced, tail guard — extracted so the return
  // walk (#145) runs the identical engine from the destination forward.
  const walkLeg = (firstStartMin: number, dayOffset: number): TravelClockDay[] => {
    const days: TravelClockDay[] = []
    if (split.driveDayCount <= 1) {
      days.push(walkClockDay({ dayIndex: dayOffset, startKm: 0, kmBudget: totalKm, startMin: firstStartMin, kmPerMin, isFinal: true, anchors: input.anchors, profile: input.profile ?? null }))
      return days
    }
    // The same destination exclusion the split path enforces (#140): halts clamp
    // to it; the final day ignores it. Mirrors planDriveDays' endnoDay exactly.
    const endnoDay = Math.min(ENDNO_KM, split.perDay * 0.15)
    const endnoCap = totalKm - endnoDay
    // Day 1 walks the real clock (it may shrink when the start is late); the
    // remainder re-balances over the following days. The count grows honestly
    // when a shrunk first day leaves more than a full cap for the rest.
    const first = walkClockDay({ dayIndex: dayOffset, startKm: 0, kmBudget: Math.min(split.perDay, capKmBudget, totalKm), startMin: firstStartMin, kmPerMin, isFinal: false, capKm: endnoCap, anchors: input.anchors, profile: input.profile ?? null })
    days.push(first)
    let remaining = totalKm - first.kmCovered
    let restDays = split.driveDayCount - 1
    while (restDays > 0 && remaining / restDays > capKmBudget) restDays += 1
    let startKm = first.kmCovered
    for (let i = 1; i <= restDays; i++) {
      // "Final" only when the day's own cap can actually absorb the remainder
      // (#127) — a wet day 2 spills into the tail guard below, not into an
      // over-cap last day.
      const isFinal = i === restDays && remaining <= capKmFor(i) + 0.5
      const budget = isFinal ? remaining : Math.min(remaining / (restDays - i + 1), capKmFor(i))
      const day = walkClockDay({ dayIndex: dayOffset + i, startKm, kmBudget: budget, startMin: hmToMinutes(CLOCK_DEFAULT_START), kmPerMin, isFinal, capKm: isFinal ? Infinity : endnoCap, anchors: input.anchors, profile: input.profile ?? null })
      days.push(day)
      // kmCovered is ABSOLUTE within this leg — the budget is RELATIVE
      // (#137, caught when the walk produced 5 of 9 promised days).
      remaining -= day.kmCovered - startKm
      startKm = day.kmCovered
      if (remaining <= 0.5) break
    }
    // Tail guard (#137): a dinner-halt day can under-cover its budget and the
    // loop above breaks before the destination. Never silently drop route —
    // keep walking capped days until the walk reaches totalKm.
    for (let guard = 0; remaining > 0.5 && guard < 30; guard++) {
      const isFinal = remaining <= capKmFor(days.length) + 0.5
      const day = walkClockDay({
        dayIndex: dayOffset + days.length, startKm, kmBudget: isFinal ? remaining : Math.min(remaining, capKmFor(days.length)),
        startMin: hmToMinutes(CLOCK_DEFAULT_START), kmPerMin, isFinal, capKm: isFinal ? Infinity : endnoCap, anchors: input.anchors, profile: input.profile ?? null,
      })
      days.push(day)
      remaining -= day.kmCovered - startKm
      startKm = day.kmCovered
    }
    return days
  }
  const days = walkLeg(startMin, 0)
  // #145: the drive home is its OWN walk on the reversed corridor — same
  // engine, starting fresh at the destination (next morning's default
  // start; the overnight is implicit in the reset clock). Circuits are not
  // round trips by construction (isRoundTrip keys on the toggle + same
  // start/end), so this never double-walks a loop.
  const returnDays = input.roundTrip && driveMin > 0 ? walkLeg(hmToMinutes(CLOCK_DEFAULT_START), days.length) : null
  return { verdict: 'ok', days, returnDays, split }
}

export interface RidePlanInput {
  totalKm: number
  /** wheel time (driving only) for the whole journey */
  driveMinutes: number
  /** whether fuel halts should be included (self-drive trips) */
  includeFuel?: boolean
  /** EV drive (#144B): replaces the fuel cadence with charge cadence —
   *  closer together (0.8 × range) and a 60-min dwell, labelled "Charge".
   *  Mutually exclusive with includeFuel; callers must not set both. */
  includeCharge?: boolean
  /** true = plan the WHOLE trip (cross-day overnight segments allowed) */
  multiDay?: boolean
  /** vehicle tank range in km — sets the fuel cadence (default FUEL_INTERVAL_KM) */
  vehicleRangeKm?: number
  /** crew-tuned cadence overrides (see cadenceForCrew) — default STRETCH/MEAL_INTERVAL_KM */
  stretchKm?: number
  mealKm?: number
  /** "HH:MM" drive-start per day index — unset days fall back to 08:30 */
  dayStartTimes?: string[]
  /** rain chance percent per day index (null = no forecast) — flags rainy segments */
  dayRainPct?: (number | null)[]
  /** motorcycle rides 1.5 h below the style cap (#126); the day-split for
   *  conducted modes is refused upstream (isSelfDrivenMode), never here */
  transportMode?: string
  /** simplified route geometry {lat,lng}[] — enables road-personality tagging */
  roadGeometry?: { lat: number; lng: number }[]
  /** accepted night-halt pins (#143): route-km keyed by day index. A pinned
   *  day's overnight segment snaps to the pin; drift beyond
   *  HALT_PIN_HYSTERESIS_KM surfaces as `haltDriftToKm`, never a silent move. */
  haltPins?: Record<number, number>
}

/**
 * Fatigue cadence tuned to the crew. Big groups (5+) and relaxed trips tire
 * faster (120/260); packed trips push further between stretches (180/300).
 * Unknown style or small balanced crews get the defaults.
 */
export function cadenceForCrew(
  travellers?: number,
  style?: string,
): { stretchKm: number; mealKm: number } {
  if (style === 'packed') return { stretchKm: 180, mealKm: MEAL_INTERVAL_KM }
  if (style === 'relaxed' || (travellers != null && travellers >= 5)) {
    return { stretchKm: 120, mealKm: 260 }
  }
  return { stretchKm: STRETCH_INTERVAL_KM, mealKm: MEAL_INTERVAL_KM }
}

export interface RideSegment {
  /** 0-based, journey order */
  index: number
  purpose: HaltPurpose
  /** human label — "Short break", "Lunch", "Fuel + stretch", "Overnight — end of day" */
  label: string
  /** ideal km along the route from the journey origin */
  targetKm: number
  /** acceptance window (never below 0, never past totalKm − ENDNO_KM) */
  minKm: number
  maxKm: number
  /** distance since the previous segment target (0 for the first) */
  kmFromPrev: number
  /** est. wheel time since the previous segment target (proportional to km) */
  minutesFromPrev: number
  /** est. wall-clock arrival in minutes since midnight (day start + wheel time) */
  etaMinutes?: number
  /** true when the day's rain chance hits RAIN_PCT_THRESHOLD */
  rainy?: boolean
  /** the day's rain chance percent (null when no forecast) */
  rainPct?: number | null
  /** true when this segment closes a day boundary (overnight stay) */
  dayEnd?: boolean
  /** accepted-halt pin (#143): this overnight holds a user-accepted position */
  haltPinned?: boolean
  /** accepted-halt pin (#143): the re-derived position this pinned halt now
   *  sits driftTo km away from — a proposal the UI asks about, never a move. */
  haltDriftToKm?: number
  /** road personality of this segment's window (present when geometry given) */
  roadPersonality?: RoadKind
  /** human road warning for ghat/city windows, e.g. "rest before the climb" */
  roadWarning?: string | null
  /** human guidance line, e.g. "≈2 h wheel time — stretch & hydrate" */
  hint: string
}

export interface SegmentHit {
  segment: RideSegment
  /** best candidate for this segment, or null when none found */
  hit: PlaceHit | null
  /** lower = better */
  score: number
}

// ---- purpose affinity (category → purposes it serves well) ----
// The purpose-fit tables live in their own leaf module (haltFit) because this
// file imports tripDna for the DNA boost, so a consumer of tripDna's cannot
// import them from here without a cycle. Re-exported so existing callers and
// the sight-purity test keep working unchanged.
export { PURPOSE_FIT, DEFAULT_FIT } from './haltFit'

/** Merge priority when cadence targets collide — the most significant wins the label. */
export const PURPOSE_PRIORITY: Record<HaltPurpose, number> = {
  overnight: 4, meal: 3, fuel: 2, rest: 2, stretch: 1, sight: 0,
}

const PURPOSE_LABEL: Record<HaltPurpose, string> = {
  stretch: 'Short break',
  meal: 'Lunch',
  fuel: 'Fuel + stretch',
  rest: 'Rest break',
  overnight: 'Overnight — end of day',
  sight: 'Sightseeing',
}

const PURPOSE_HINT: Record<HaltPurpose, (mins: number) => string> = {
  stretch: () => '≈2 h wheel time — stretch & hydrate',
  meal: () => '≈4 h — time for a proper meal',
  fuel: () => 'Tank’s running low — refuel while you stretch',
  rest: () => 'Recovery break — rest before carrying on',
  overnight: () => '≈7 h driven today — end the day here and sleep',
  sight: () => 'Worth-a-visit along the way',
}

const PURPOSE_SHORT: Record<HaltPurpose, string> = {
  stretch: 'Stretch', meal: 'Lunch', fuel: 'Fuel', rest: 'Rest', overnight: 'Overnight', sight: 'See',
}

/**
 * Crew overrides must stay sane: finite, positive, inside [50, 1000] km.
 * Garbage in falls back to the standard cadence, never to a crash or a
 * segment every 2 km.
 */
function sanitizedStretchKm(input: RidePlanInput): number {
  const v = input.stretchKm
  return v != null && Number.isFinite(v) && v >= 50 && v <= 1000 ? v : STRETCH_INTERVAL_KM
}

function sanitizedMealKm(input: RidePlanInput): number {
  const v = input.mealKm
  return v != null && Number.isFinite(v) && v >= 50 && v <= 1000 ? v : MEAL_INTERVAL_KM
}

/**
 * Tag each segment with the personality of its road window. The geometry is
 * sliced by cumulative-km fraction (scaled to totalKm); windows with fewer
 * than 2 points borrow neighbours so short urban hops still classify.
 * No geometry (or degenerate input) leaves segments untagged.
 */
function annotateRoadPersonality(
  segments: RideSegment[],
  geometry: { lat: number; lng: number }[] | undefined,
  totalKm: number,
  driveMinutes: number,
): void {
  if (!geometry || geometry.length < 2 || segments.length === 0 || !(totalKm > 0)) return
  const pts = geometry.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (pts.length < 2) return
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversineKm(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng))
  }
  const pathTotal = cum[cum.length - 1]
  if (!(pathTotal > 0.01)) return
  const scale = totalKm / pathTotal
  let prevTarget = 0
  for (const s of segments) {
    const lo = prevTarget
    const hi = s.targetKm
    prevTarget = s.targetKm
    let idx = cum.map((c, i) => ({ c: c * scale, i })).filter(o => o.c > lo && o.c <= hi).map(o => o.i)
    if (idx.length < 2) {
      // widen: nearest point below lo plus nearest above hi
      let below = -1
      let above = -1
      for (let i = 0; i < cum.length; i++) {
        if (cum[i] * scale <= lo) below = i
        if (above === -1 && cum[i] * scale > hi) above = i
      }
      const set = new Set(idx)
      if (below !== -1) set.add(below)
      if (above !== -1) set.add(above)
      idx = [...set].sort((a, b) => a - b)
    }
    if (idx.length < 2) continue
    const slice = idx.map(i => pts[i])
    // Geometry classifies the window (highway / state-road / ghat). The
    // day's AVERAGE speed is a day-level verdict, not a per-window one —
    // deriving per-window speed from the km fraction cancels out to the day
    // average, which used to mislabel every window on a slow day. So: ghat
    // (geometry-true, urgent advice) always wins; the crawl verdict applies
    // to non-ghat windows only when the whole day averages under city speed.
    const dayAvgKmh = driveMinutes > 0 ? totalKm / (driveMinutes / 60) : undefined
    const w = classifyRoadWindow(slice)
    if (w.kind === 'ghat') {
      s.roadPersonality = 'ghat'
      s.roadWarning = w.warning
    } else if (dayAvgKmh != null && Number.isFinite(dayAvgKmh) && dayAvgKmh < CITY_SPEED_KMH) {
      s.roadPersonality = 'city'
      s.roadWarning = CITY_CRAWL_WARNING
    } else {
      s.roadPersonality = w.kind
      s.roadWarning = w.warning
    }
  }
}

/**
 * Split a drive into fatigue-budget segments in journey order. Empty for short
 * drives. Cadences are walked independently, then merged: collisions closer
 * than MIN_BREAK_GAP_KM fold into one segment (priority overnight > meal >
 * fuel/stretch), and nothing lands within ENDNO_KM of the destination.
 */
export function planRideSegments(input: RidePlanInput): RideSegment[] {
  const total = Number.isFinite(input.totalKm) ? Math.max(0, input.totalKm) : 0
  const drive = Number.isFinite(input.driveMinutes) ? Math.max(0, input.driveMinutes) : 0
  // The 90 km floor keeps tiny hops from growing a break cadence — but wheel
  // TIME is the real fatigue currency: 80 km of ghat crawl is 3 h behind the
  // wheel and earns its stretch by the clock (PLAN-DAY-PLANNER §14 fixture —
  // this was the short-trip silence that opened the brainstorm).
  if (total < MIN_PLANNED_DRIVE_KM && drive < STRETCH_CLOCK_MIN) return []
  const includeFuel = !!input.includeFuel && !input.includeCharge
  // #144B: an EV charges on a tighter, 60-min-stop cadence — 0.8 × usable
  // range (buffer for hills/AC), never looser than the fuel stride. Purpose
  // stays 'fuel' (fit tables, priorities, hit matching all keep working);
  // only the label and dwell speak EV.
  const includeCharge = !!input.includeCharge
  const multiDay = !!input.multiDay
  const fuelEvery = Math.max(100, (input.vehicleRangeKm && input.vehicleRangeKm > 0 ? input.vehicleRangeKm : FUEL_INTERVAL_KM) * 0.85)
  const chargeEvery = Math.max(80, Math.min(fuelEvery, (input.vehicleRangeKm && input.vehicleRangeKm > 0 ? input.vehicleRangeKm : FUEL_INTERVAL_KM) * 0.8))
  // The destination exclusion zone scales down for short journeys — a fixed
  // 60 km off a 80 km drive would leave no bookable road at all.
  const endno = Math.min(ENDNO_KM, total * 0.15)
  const cap = total - endno // nothing past here

  // Day boundaries for multi-day plans — derived from the duration fatigue
  // cap (planDriveDays), not the user's day count and not a fixed 550 km tick
  // (550 @ blended 42 km/h = a 13.1 h day by the engine's own speed table).
  // Falls back to the old km tick only when the journey lacks reliable wheel
  // time (planDriveDays verdict null).
  const dayEnds: number[] = []
  if (multiDay) {
    const days = planDriveDays({ totalKm: total, driveMinutes: drive, transportMode: input.transportMode })
    if (days && days.nightHalts.length > 0) dayEnds.push(...days.nightHalts)
    else for (let km = OVERNIGHT_INTERVAL_KM; km < cap; km += OVERNIGHT_INTERVAL_KM) dayEnds.push(km)
  }
  const dayStarts = [0, ...dayEnds]

  // Clock stretch twin — fatigue accrues by hours behind the wheel, not km:
  // 150 km was ≈2 h at highway 65–75 km/h, but at the engine's blended
  // all-India speed (42 km/h) it stretched to 3.6 h. The stretch cadence
  // therefore never waits longer than STRETCH_CLOCK_MIN of wheel time,
  // expressed in km at the journey's own blended speed (never looser than
  // the km cadence — highway journeys keep their 150 km rhythm).
  const journeyKmh = drive > 0 && total > 0 ? (total / drive) * 60 : undefined
  const clockStretchKm = journeyKmh != null && Number.isFinite(journeyKmh) && journeyKmh > 0
    ? (STRETCH_CLOCK_MIN / 60) * journeyKmh
    : Infinity

  // Phase A — in-day cadence relative to each day's start, plus the overnights
  // that close each day. Cadences RESET after an overnight, so day-2's stretch
  // lands ~150 km into day 2, not 600 km from the origin.
  type Raw = { km: number; purposes: HaltPurpose[] }
  const raws: Raw[] = []
  dayStarts.forEach((dayStart, di) => {
    const dayCap = dayEnds[di] ?? Infinity
    const push = (purpose: HaltPurpose, step: number) => {
      for (let km = dayStart + step; km < dayCap && km < cap; km += step) raws.push({ km, purposes: [purpose] })
    }
    push('stretch', Math.min(sanitizedStretchKm(input), clockStretchKm))
    push('meal', sanitizedMealKm(input))
  })
  // Fuel runs on a GLOBAL corridor cadence — the tank carries over night
  // halts, so resetting the step at each day start made fuel structurally
  // impossible whenever the load-balanced day budget (e.g. 350 km) is shorter
  // than the tank stride (450 km range × 0.85 = 382.5): every push overshot
  // the day cap and multi-day plans grew ZERO fuel stops. Measured live on a
  // 1,400 km / 4-day plan: 0 fuel segments before this, 3 after. EV charging
  // (chargeEvery) follows the same corridor cadence; the #144A pass below then
  // folds a fuel tick into a nearby meal/overnight when they coincide.
  if (includeFuel) {
    for (let km = fuelEvery; km < cap; km += fuelEvery) raws.push({ km, purposes: ['fuel'] })
  }
  if (includeCharge) {
    for (let km = chargeEvery; km < cap; km += chargeEvery) raws.push({ km, purposes: ['fuel'] })
  }
  dayEnds.forEach(e => raws.push({ km: e, purposes: ['overnight'] }))
  // #144A — refuel (or charge) where you eat or sleep: a fuel-stride tick
  // landing within 15% of that stride of a meal/overnight raw folds INTO it.
  // One combined stop ("Meal + fuel", "Overnight + charge") beats two stops a
  // few minutes apart at the same place.
  if (includeFuel || includeCharge) {
    const foldGap = Math.max(20, (includeCharge ? chargeEvery : fuelEvery) * 0.15)
    for (let i = raws.length - 1; i >= 0; i--) {
      const f = raws[i]
      if (!f.purposes.includes('fuel')) continue
      const near = raws.find(r => r !== f
        && (r.purposes.includes('meal') || r.purposes.includes('overnight'))
        && Math.abs(r.km - f.km) <= foldGap)
      if (near) {
        near.purposes.push('fuel')
        raws.splice(i, 1)
      }
    }
  }
  if (raws.length === 0) return []

  // Phase B — sort, then collapse within-day collisions closer than
  // MIN_BREAK_GAP_KM. Overnights always open a new merged entry (they close a
  // day — what follows belongs to the next day). A higher-priority incoming
  // target (meal > fuel > stretch) shifts the merged position to its own km.
  // Extracted as collapse() so Phase B3 can re-run it after the B2 slide.
  raws.sort((a, b) => a.km - b.km || PURPOSE_PRIORITY[b.purposes[0]] - PURPOSE_PRIORITY[a.purposes[0]])
  type Merged = { km: number; purposes: HaltPurpose[]; pinned?: boolean; driftTo?: number }
  const collapse = (list: Merged[]): Merged[] => {
    const out: Merged[] = []
    for (const raw of list) {
      const last = out[out.length - 1]
      if (last && last.purposes[0] !== 'overnight' && raw.purposes[0] !== 'overnight' && raw.km - last.km < MIN_BREAK_GAP_KM) {
        const higher = PURPOSE_PRIORITY[raw.purposes[0]] > PURPOSE_PRIORITY[last.purposes[0]]
        // Dedupe: two raws of the same purpose can fold into one entry
        // (both stretches flanking a slid meal), so the label never
        // reads "Stretch + Stretch".
        const folded = higher ? [...raw.purposes, ...last.purposes] : [...last.purposes, ...raw.purposes]
        last.purposes = [...new Set(folded)]
        if (higher) last.km = raw.km
      } else {
        out.push({ km: raw.km, purposes: [...raw.purposes] })
      }
    }
    return out
  }
  let merged: Merged[] = collapse(raws.map(r => ({ km: r.km, purposes: [...r.purposes] })))

/** Meal window in minutes since midnight: lunch must land 11:30–14:30.
 *  Aliased to the exported LUNCH_WINDOW (#130) — the segment slide and the
 *  clock walk can no longer disagree about where lunch starts. */
const MEAL_WINDOW = LUNCH_WINDOW
/** Fallback drive-start when a day has no startTime. */
const DEFAULT_DAY_START = '08:30'

function dayStartMin(dayStartTimes: string[] | undefined, dayIdx: number): number {
  const raw = dayStartTimes?.[dayIdx]
  if (raw && /^\d{1,2}:\d{2}$/.test(raw)) return hmToMinutes(raw)
  return hmToMinutes(DEFAULT_DAY_START)
}

/** Day index for a route-km position given the day-start boundaries. */
function dayIndexAt(km: number, dayStarts: number[]): number {
  let idx = 0
  for (let i = 0; i < dayStarts.length; i++) {
    if (dayStarts[i] <= km) idx = i
  }
  return idx
}

/** Rain flags for a route-km position from the per-day forecast. */
function rainFor(km: number, dayStarts: number[], dayRainPct: (number | null)[] | undefined): { rainy?: boolean; rainPct?: number | null } {
  if (!dayRainPct) return {}
  const pct = dayRainPct[dayIndexAt(km, dayStarts)] ?? null
  if (pct == null) return { rainPct: null }
  return pct >= RAIN_PCT_THRESHOLD ? { rainy: true, rainPct: pct } : { rainPct: pct }
}

/** Est. wall-clock arrival for a route-km position (day start + proportional wheel time). */
function etaAt(km: number, dayStarts: number[], dayStartTimes: string[] | undefined, total: number, drive: number): number {
  const di = dayIndexAt(km, dayStarts)
  const wheel = total > 0 ? (drive * Math.max(0, km - dayStarts[di])) / total : 0
  return dayStartMin(dayStartTimes, di) + wheel
}

  // Phase B2 — journey clock: slide meal targets into the 11:30–14:30 window.
  // ETA = day start + proportional wheel time. Shifts clamp to [0, cap] and
  // merged entries re-sort, so Phase C windows re-derive from moved positions.
  // Overnights are annotated only — moving a day boundary would break cadence.
  const kmPerMin = drive > 0 && total > 0 ? total / drive : 1.4
  const destEta = etaAt(total, dayStarts, input.dayStartTimes, total, drive)
  for (const m of merged) {
    if (!m.purposes.includes('meal')) continue
    const eta = etaAt(m.km, dayStarts, input.dayStartTimes, total, drive)
    if (eta >= MEAL_WINDOW[0] && eta <= MEAL_WINDOW[1]) continue
    const edge = Math.abs(eta - MEAL_WINDOW[0]) <= Math.abs(eta - MEAL_WINDOW[1]) ? MEAL_WINDOW[0] : MEAL_WINDOW[1]
    let target = m.km + (edge - eta) * kmPerMin
    // Final-day slide guard (#131b): a meal may not slide LATER than
    // destination ETA − 90 min — arriving stuffed at midnight helps nobody.
    if (dayIndexAt(m.km, dayStarts) === dayStarts.length - 1 && edge === MEAL_WINDOW[1]) {
      target = Math.min(target, m.km + Math.max(0, destEta - 90 - eta) * kmPerMin)
    }
    m.km = Math.min(cap, Math.max(0, target))
  }
  merged.sort((a, b) => a.km - b.km)

  // Phase B3 — the B2 slide runs after the collision pass, so a slid meal can
  // land within MIN_BREAK_GAP_KM of a neighbour (600 → 504 sits 54 km from the
  // stretch at 450). Re-collapse until stable: every merge strictly reduces
  // the entry count, so the fixpoint terminates.
  for (let pass = 0; pass < 16; pass++) {
    const again = collapse(merged)
    const stable = again.length === merged.length && again.every((e, i) => e.km === merged[i].km)
    merged = again
    merged.sort((a, b) => a.km - b.km)
    if (stable) break
  }

  // Overnight-adjacent absorb (#131a): collapse never touches night-halt
  // pairs, so a slid meal landing just before a halt used to render a
  // double-stop evening. The halt absorbs it instead — dinner at the halt
  // anyway — and a fuel fold is safe: Phase E's corridor advisory re-flags
  // any gap the absorb creates.
  // The absorb is TIME-bounded, not just km-bounded: a slid lunch sits at the
  // 14:30 window edge — on a load-balanced 350 km day that is ~98 km
  // (= 2 h 20 m of wheel time) before the halt, inside the old km bound, so
  // the halt ate lunch on EVERY driving day and no meal card ever survived a
  // multi-day plan (live-verified 2026-09-14). Only a stop within ~1 h of the
  // halt is "dinner at the halt anyway"; an earlier one is a real meal.
  {
    const out: Merged[] = []
    for (const m of merged) {
      const last = out[out.length - 1]
      if (m.purposes[0] === 'overnight' && last && last.purposes[0] !== 'overnight'
        && m.km - last.km < MIN_BREAK_GAP_KM
        && kmPerMin > 0 && (m.km - last.km) / kmPerMin <= 60) {
        out.pop() // the halt serves both — purposes fold into it
        m.purposes = [...new Set([...m.purposes, ...last.purposes])]
      }
      out.push(m)
    }
    merged = out
  }

  // Phase B4 — accepted night-halt pins (#143): a halt the user accepted does
  // not move when an unrelated stop reshapes the plan. Within
  // HALT_PIN_HYSTERESIS_KM the PIN wins silently (sub-threshold drift is
  // noise); beyond it the pin still holds, and the segment carries the
  // derived position as a proposal (`haltDriftToKm`) the UI asks about —
  // never a silent move. Pins key on the NIGHT ordinal (1st accepted halt,
  // 2nd…), stable even when a re-split shifts derived day indices; the
  // caller voids them when the route shape (anchorHash) changes.
  // Runs after every collapse/absorb pass so no merge can shift a pin.
  if (input.haltPins) {
    let night = -1
    for (const m of merged) {
      if (m.purposes[0] !== 'overnight') continue
      const pin = input.haltPins[night += 1]
      if (pin == null || !Number.isFinite(pin)) continue
      if (Math.abs(m.km - pin) > HALT_PIN_HYSTERESIS_KM) {
        m.driftTo = m.km // derived new position — a proposal, not a move
      }
      m.km = pin
      m.pinned = true
    }
    merged.sort((a, b) => a.km - b.km)
  }

  // Dwell-corrected arrival ETAs (#129): etaAt() is proportional WHEEL time,
  // but the wall clock also spends every halt's dwell EARLIER in the same
  // day — without this the last halt of a 350 km day reads ~1 h 20 m early
  // and the "arrive ≈" the panel shows is a lie. Resets at each day boundary
  // (each day's clock starts at its own start). Tea-time breaks are 'stretch'
  // purposes; the 20 min tea dwell belongs to that key.
  const HALT_DWELL: Record<HaltPurpose, number> = {
    // #144B: on an EV the fuel-purpose stop IS a charge stop — 60 min plugged
    // in, not a 15-min pump-and-go. The wall clock must carry that.
    stretch: HALT_MIN.tea, meal: HALT_MIN.meal,
    fuel: includeCharge ? 60 : HALT_MIN.fuel, rest: HALT_MIN.tea, overnight: HALT_MIN.dinner, sight: 0,
  }
  const dwellAhead = new Array<number>(merged.length).fill(0)
  {
    let run = 0
    let di = dayIndexAt(merged[0]?.km ?? 0, dayStarts)
    for (let i = 0; i < merged.length; i++) {
      const d = dayIndexAt(merged[i].km, dayStarts)
      if (d !== di) { di = d; run = 0 }
      dwellAhead[i] = run
      run += merged[i].purposes.reduce((s, p) => s + (HALT_DWELL[p] ?? 0), 0)
    }
  }

  // Phase C — windows = midpoints to neighbours; labels/hints; leg distances
  const segments: RideSegment[] = merged.map((m, i) => {
    const purpose = m.purposes.reduce((acc, p) => (PURPOSE_PRIORITY[p] > PURPOSE_PRIORITY[acc] ? p : acc), m.purposes[0])
    const prevKm = i === 0 ? 0 : merged[i - 1].km
    const nextKm = i === merged.length - 1 ? total : merged[i + 1].km
    const minKm = i === 0 ? 0 : Math.max(0, m.km - (m.km - prevKm) * 0.5)
    const maxKm = i === merged.length - 1 ? Math.min(cap, m.km + (total - m.km) * 0.5) : m.km + (nextKm - m.km) * 0.5
    const kmFromPrev = Math.max(0, m.km - prevKm)
    const minutesFromPrev = total > 0 ? Math.round((drive * kmFromPrev) / total) : 0
    const hasMeal = m.purposes.includes('meal')
    const hasFuel = m.purposes.includes('fuel')
    const extraPurposes = m.purposes.filter(p => p !== purpose)
    // #144: combined labels. EV swaps the fuel word for "charge" everywhere
    // it appears — the purpose stays 'fuel' under the hood (fit tables,
    // priorities, hit matching all keep working).
    const fuelWord = includeCharge ? 'Charge' : 'Fuel'
    const label = hasMeal && hasFuel
      ? includeCharge ? 'Meal + charge' : 'Meal + fuel'
      : purpose === 'overnight' && hasFuel
        ? `Overnight + ${fuelWord.toLowerCase()}`
        : purpose === 'fuel'
          ? includeCharge
            ? extraPurposes.length > 0 ? `Charge + ${extraPurposes.map(p => PURPOSE_SHORT[p]).join(' + ')}` : 'Charge'
            : PURPOSE_LABEL.fuel
          : m.purposes.length > 1 && purpose !== 'overnight'
            ? `${PURPOSE_LABEL[purpose]} + ${extraPurposes.map(p => p === 'fuel' ? fuelWord : PURPOSE_SHORT[p]).join(' + ')}`
            : PURPOSE_LABEL[purpose]
    return {
      index: i,
      purpose,
      label,
      targetKm: m.km,
      minKm,
      maxKm,
      kmFromPrev,
      minutesFromPrev,
      etaMinutes: Math.round(etaAt(m.km, dayStarts, input.dayStartTimes, total, drive) + (dwellAhead[i] ?? 0)),
      ...rainFor(m.km, dayStarts, input.dayRainPct),
      dayEnd: purpose === 'overnight' ? true : undefined,
      haltPinned: m.pinned ? true : undefined,
      haltDriftToKm: m.driftTo != null ? Math.round(m.driftTo) : undefined,
      hint: includeCharge && purpose === 'fuel'
        ? 'Plug in — ≈60 min at the charger; stretch while it fills'
        : PURPOSE_HINT[purpose](minutesFromPrev),
    }
  })
  // Phase D — road personality: slice the route geometry into per-segment
  // windows by cumulative-km fraction and classify each. Geometry-free plans
  // keep segments untagged; hints stay untouched (warnings render separately).
  annotateRoadPersonality(segments, input.roadGeometry, total, drive)
  // Phase E — fuel-corridor advisory: a fuel stop about to cross a long gap to
  // the next scheduled refuel warns "fill the tank" (only when fuel is planned).
  if (includeFuel && input.vehicleRangeKm && input.vehicleRangeKm > 0) {
    fuelGapWarnings(segments, Math.max(100, input.vehicleRangeKm * 0.85), cap)
  }
  return segments
}

/**
 * Fuel-corridor advisory (Horizon 3): warn about a stretch with no planned
 * refuel stop. For each fuel segment, the distance to the next fuel segment or
 * the trip's end is compared against the vehicle's safe stride. When that gap
 * exceeds the stride (you'd be stranded before the next planned stop), the
 * fuel segment earns a "fill the tank" warning. Pure and geometry-free.
 */
export function fuelGapWarnings(
  segments: RideSegment[],
  fuelStrideKm: number,
  capKm: number,
): void {
  if (!(fuelStrideKm > 0) || segments.length === 0) return
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].purpose !== 'fuel') continue
    // next fuel segment or the journey end (no planned refuel beyond here)
    let nextKm = capKm
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j].purpose === 'fuel') { nextKm = segments[j].targetKm; break }
    }
    const gap = Math.max(0, nextKm - segments[i].targetKm)
    if (gap > fuelStrideKm * 1.4) {
      segments[i].roadWarning = (segments[i].roadWarning ?? '')
        ? `${segments[i].roadWarning} · no scheduled fuel for ~${Math.round(gap)} km — fill the tank`
        : `No scheduled fuel for ~${Math.round(gap)} km — fill the tank here`
    }
  }
}

/** A user-entered halt in the manual planner: stop at `km` along the route for `minutes`, serving `purpose`. */
export interface HaltPlanItem {
  km: number
  minutes: number
  purpose: HaltPurpose
  /** The user chose the real spot over the generic on-route break. Carried in
   *  the halt cache since #346 — it used to live only in component state, so
   *  every tab switch silently dropped the ticks. Hydration reads it
   *  defensively (`pin === true`), so payloads cached before the field
   *  existed hydrate unpinned, as they always behaved. */
  pin?: boolean
}

/**
 * Build plan segments from a user's manual halt list (positions chosen by km,
 * not by fatigue cadence). Sorted by km, windows = midpoints to neighbours,
 * nothing past the destination. Returns [] for a short/empty plan.
 */
export function segmentsFromPlan(plan: HaltPlanItem[], totalKm: number, driveMinutes = 0): RideSegment[] {
  const sorted = plan
    .filter(p => Number.isFinite(p.km) && p.km > 0)
    .sort((a, b) => a.km - b.km)
  if (sorted.length === 0 || totalKm <= 0) return []
  return sorted.map((it, i) => {
    const prevKm = i === 0 ? 0 : sorted[i - 1].km
    const nextKm = i === sorted.length - 1 ? totalKm : sorted[i + 1].km
    const minKm = i === 0 ? 0 : Math.max(0, it.km - (it.km - prevKm) * 0.5)
    const maxKm = i === sorted.length - 1 ? it.km + (totalKm - it.km) * 0.5 : it.km + (nextKm - it.km) * 0.5
    const kmFromPrev = Math.max(0, it.km - prevKm)
    const minutesFromPrev = driveMinutes > 0 ? Math.round((driveMinutes * kmFromPrev) / totalKm) : 0
    return {
      index: i,
      purpose: it.purpose,
      label: PURPOSE_LABEL[it.purpose],
      targetKm: it.km,
      minKm,
      maxKm,
      kmFromPrev,
      minutesFromPrev,
      hint: PURPOSE_HINT[it.purpose](minutesFromPrev),
      dayEnd: it.purpose === 'overnight' ? true : undefined,
    }
  })
}

/** How well a hit serves a purpose. 0 = wrong kind of place; 3 = ideal (population/city bonuses cap at 3). */
export function fitScoreForPurpose(h: PlaceHit, purpose: HaltPurpose): number {
  const cat = h.category ?? 'sightseeing'
  const raw = PURPOSE_FIT[cat]?.[purpose] ?? DEFAULT_FIT[purpose] ?? 0
  let b = Math.min(3, raw)
  if (h.isPopulatedPlace && (purpose === 'overnight' || purpose === 'meal' || purpose === 'fuel')) b = Math.min(3, b + 2)
  if ((h.population ?? 0) > 0 && purpose === 'overnight') b = Math.min(3, b + Math.min(3, Math.log10(h.population!) / 2))
  return b
}

export interface AssignOpts {
  homeCenter?: { lat: number; lng: number } | null
  routePolyline?: { lat: number; lng: number }[] | null
  /** door-to-door speed for time-based detour scoring — defaults to 40 km/h */
  speedKmph?: number
  /** trip preference vector — favoured categories score a similarity boost */
  dnaVector?: DnaVector
}

/** Rain chance at or above this means the day counts as rainy. Matches OverviewTab. */
export const RAIN_PCT_THRESHOLD = 60
/** Categories that suffer in the rain. */
const WEATHER_SENSITIVE = new Set(['nature', 'beach', 'temple', 'adventure'])
/** Categories that shelter from it. */
const WEATHER_SHELTERED = new Set(['museum', 'cafe', 'shopping'])

/** purpose-fit adjusted for rain: exposed sights lose a point, sheltered picks gain one. */
function weatherAdjustedFit(h: PlaceHit, purpose: HaltPurpose, rainy: boolean): number {
  const base = fitScoreForPurpose(h, purpose)
  if (!rainy) return base
  const cat = h.category ?? 'sightseeing'
  if (WEATHER_SENSITIVE.has(cat)) return Math.max(0, base - 1)
  if (WEATHER_SHELTERED.has(cat)) return Math.min(3, base + 1)
  return base
}

/**
 * Opening-hours fit: a hit whose reported hours don't contain the segment's
 * arrival clock is degraded. Known hours + no arrival clock (or vice versa)
 * leave the hit untouched. Penalty is minutes a trip would "walk a shut
 * door" away from the ideal — scaled so a full locked-out place is about as
 * bad as a 10 km off-road detour (matches the ×2 minute weight).
 */
export function hoursFitAdj(
  h: Pick<PlaceHit, 'openTime' | 'closeTime'>,
  etaMinutes: number | null | undefined,
): number {
  const eta = etaMinutes
  if (eta == null || !Number.isFinite(eta)) return 0
  const open = h.openTime ? hmToMinutes(h.openTime) : null
  const close = h.closeTime ? hmToMinutes(h.closeTime) : null
  if (open == null || close == null) return 0
  // Normal-day hours (open < close): early or late arrival earns a penalty.
  if (close >= open) {
    if (eta < open) return Math.round((open - eta) / 15) * 2 + 1   // arrived before it opens
    if (eta > close) return Math.round((eta - close) / 15) * 2 + 1 // arrived after it closed
    return 0
  }
  // Overnight place (open > close, e.g. 20:00–06:00): closed during the day's
  // middle; only late-evening starts line up.
  const closed = eta >= close && eta < open
  return closed ? 6 : 0
}
export function scoreHitForSegment(
  h: PlaceHit,
  seg: RideSegment,
  anchors: { lat: number; lng: number }[],
  opts: AssignOpts = {},
): number | null {
  const pos = kmFromStartForHit(h, anchors, { routePolyline: opts.routePolyline ?? undefined })
  if (pos == null) return null // unpositionable hit can't serve a timed segment
  const dist = Math.abs(pos - seg.targetKm)
  const window = Math.max(1, seg.maxKm - seg.minKm)
  const distPenalty = dist > window / 2 ? dist + window : dist
  const fit = weatherAdjustedFit(h, seg.purpose, seg.rainy === true)
  // Need-based purposes never take a wrong-kind place: a college with zero
  // fuel-fit must leave the segment empty (rendered as a gap), not fill it
  // as a bogus petrol pump. Generic breaks stay ungated.
  if ((seg.purpose === 'fuel' || seg.purpose === 'meal' || seg.purpose === 'overnight') && fit < 1) {
    return null
  }
  // A night-halt ANCHOR belongs to the halt it sits near (#189). The upstream
  // city guard filters candidates against ANY halt km, so a town valid for a
  // late halt could still be grabbed by an early segment starved of nearby
  // options — live-verified: a 350 km halt "anchored" on Jhumri Tilaiya,
  // 800 km further down the corridor. Past this bound the segment is honestly
  // empty; a halt 800 km from its halt is not a suggestion.
  if (seg.purpose === 'overnight' && h.isPopulatedPlace && dist > 120) return null
  // Detour scores in minutes at the trip's speed, not flat km: the same
  // off-route distance costs a slow mode more. ×2 keeps the old weight at
  // the 60 km/h reference (10 km = 10 min = 20 points, as before).
  // Asymmetric when route geometry is known: on-the-way hits cost ~0 detour,
  // off-road spurs pay the round trip — so a place you literally pass is not
  // penalized as a "detour".
  const detour = asymmetricDetourMinutes(h, anchors, opts.routePolyline ?? undefined, opts.speedKmph)
  if (detour == null) return null // unknown position cannot be scored as free/on-route
  const detourCost = detour * 2
  // Opening-hours fit: a hit closed when you'd arrive is degraded.
  const hours = hoursFitAdj(h, seg.etaMinutes)
  // Trip DNA bends ties only: favoured categories shave up to 3 points.
  const dna = opts.dnaVector ? dnaBoostForHit(h, opts.dnaVector) : 0
  return distPenalty + detourCost + hours + (3 - fit) * 4 - dna
}

/**
 * Town-grade anchor preference (#189). A night halt needs a town with a BED:
 * OSM's `place=city|town` carries a population, while Google's rural `locality`
 * is a hamlet with none and only reaches fit 2 against a town's 3 — a gap that
 * a handful of kilometres of distance easily erases. So when real towns are on
 * the table, the hamlet-grade entries are dropped from the anchor pool rather
 * than left to win on proximity. Where OSM has no town (dense urban corridors,
 * which is where Google's locality data is strongest) the full list is kept, so
 * the layer never empties for this reason.
 */
export function preferTownGrade(cities: PlaceHit[]): PlaceHit[] {
  const towns = cities.filter(c => (c.population ?? 0) > 0)
  return towns.length > 0 ? towns : cities
}

/**
 * Assign the single best hit to each segment (journey order). Scoring:
 * distance-to-target (heavier outside the segment's window), detour (×2),
 * purpose-fit mismatch (3 − fit) × 4. Greedy dedupe: a hit used for an earlier
 * segment leaves the later pools (roads don't repeat), then one improvement
 * sweep tries every pairwise swap and keeps swaps that lower the total score.
 * Segments with no suitable candidate keep hit = null — the caller renders
 * them as gaps.
 */
export function assignSegmentHits(
  hits: PlaceHit[],
  segments: RideSegment[],
  anchors: { lat: number; lng: number }[],
  opts: AssignOpts = {},
): SegmentHit[] {
  const usable = hits.filter(h => Number.isFinite(h.latitude) && Number.isFinite(h.longitude))
  // home-zone filter (cities/POIs added outside the search path may not have been filtered)
  const home = opts.homeCenter
  const filtered = home
    ? usable.filter(h => haversineKm(h.latitude, h.longitude, home.lat, home.lng) * 1000 >= HOME_ZONE_KM * 1000)
    : usable
  const seenNames = new Set<string>()
  const unnamed: PlaceHit[] = []
  const named: PlaceHit[] = []
  for (const h of filtered) {
    const key = (h.name ?? '').toLowerCase()
    if (!key) { unnamed.push(h); continue }
    if (seenNames.has(key)) continue
    seenNames.add(key)
    named.push(h)
  }
  const pool: PlaceHit[] = [...unnamed, ...dedupeCandidates(named)]

  const used = new Set<string>()
  const results: SegmentHit[] = []
  for (const seg of segments) {
    let best: PlaceHit | null = null
    let bestScore = Infinity
    for (const h of pool) {
      if (used.has(h.id as string)) continue
      const score = scoreHitForSegment(h, seg, anchors, opts)
      if (score == null) continue
      if (score < bestScore) { bestScore = score; best = h }
    }
    if (best) used.add(best.id as string)
    results.push({ segment: seg, hit: best, score: bestScore })
  }
  // Pass 2 — one improvement sweep: try swapping each pair's hits, keep swaps
  // that lower the combined score. Fixes greedy steals where an early segment
  // grabs a hit that fits a later segment better.
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i]
      const b = results[j]
      if (!a.hit || !b.hit || a.hit.id === b.hit.id) continue
      const cur = a.score + b.score
      const sa = scoreHitForSegment(b.hit, a.segment, anchors, opts)
      const sb = scoreHitForSegment(a.hit, b.segment, anchors, opts)
      if (sa == null || sb == null) continue
      if (sa + sb < cur) {
        const tmp = a.hit
        a.hit = b.hit
        b.hit = tmp
        a.score = sa
        b.score = sb
      }
    }
  }
  return results
}

/**
 * Categories that are genuine sights — the See & do column and sight pins
 * show ONLY these. Everything else (food, cafes, hotels, fuel, rest areas) is
 * an errand, not an attraction: a dhaba must never render as "Sightseeing".
 */
export const SIGHT_CATEGORIES = new Set([
  'sightseeing', 'nature', 'beach', 'temple', 'museum', 'adventure', 'event', 'shopping', 'travel',
])

/** true when a hit's category is a real sight (See & do worthiness). */
export function isSightCategory(cat?: string): boolean {
  return cat != null && SIGHT_CATEGORIES.has(cat)
}

/**
 * Unassigned corridor hits become See & do entries: the halt planner only
 * makes fuel/meal/rest/stretch/overnight segments, so without this the
 * sightseeing column is empty by construction. Each leftover gets a synthetic
 * 'sight' segment at its road position (callers run annotateSegmentHits over
 * the combined list for city/leg stamps). Capped — a long corridor yields
 * hundreds of candidates. SIGHT-WORTHY HITS ONLY: rejected need-based places
 * (restaurants that lost their meal segment, hotels, pumps) are dropped, not
 * re-labelled as sights.
 */
export function leftoverAsSight(
  candidates: PlaceHit[],
  assigned: SegmentHit[],
  anchors: { lat: number; lng: number }[],
  opts: AssignOpts = {},
  cap = 12,
): SegmentHit[] {
  const used = new Set<string>()
  for (const r of assigned) {
    if (r.hit) used.add(r.hit.id as string)
  }
  const out: SegmentHit[] = []
  for (const h of candidates) {
    if (out.length >= cap) break
    if (used.has(h.id as string)) continue
    if (h.isPopulatedPlace) continue // towns are not sights — cities already anchor segments
    if (!isSightCategory(h.category)) continue // dhabas/hotels/pumps are not sights
    const pos = kmFromStartForHit(h, anchors, { routePolyline: opts.routePolyline ?? undefined })
    if (pos == null) continue
    out.push({
      segment: {
        index: 1000 + out.length,
        purpose: 'sight',
        label: 'Sightseeing',
        targetKm: pos,
        minKm: Math.max(0, pos - 25),
        maxKm: pos + 25,
        kmFromPrev: 0,
        minutesFromPrev: 0,
        hint: 'Worth-a-visit along the way',
      },
      hit: h,
      score: 0,
    })
  }
  return out
}

/**
 * Nearest populated place to a hit within `radiusKm` (from the city-candidate
 * pool) — the "nearest big city" label shown on suggestion cards.
 */
export function nearestCityName(h: PlaceHit, pool: PlaceHit[], radiusKm = 120): string | undefined {
  let name: string | undefined
  let d = radiusKm
  for (const c of pool) {
    if (!c.isPopulatedPlace) continue
    if ((c.name ?? '').toLowerCase() === (h.name ?? '').toLowerCase()) continue
    const km = haversineKm(h.latitude, h.longitude, c.latitude, c.longitude)
    if (km < d) { d = km; name = c.name }
  }
  return name
}

/**
 * Stamp journey metadata onto each assigned hit: which purpose it serves, its
 * position on the route (cumKm), the leg since the previous planned stop
 * (legKm / legMinutes), and the nearest key city. Returns a SegmentHit with a
 * new hit object — the input candidates are left untouched.
 */
export function annotateSegmentHits(results: SegmentHit[], candidates: PlaceHit[], radiusKm = 120): SegmentHit[] {
  return results.map(r => {
    if (!r.hit) return r
    r.hit = {
      ...r.hit,
      haltPurpose: r.segment.purpose,
      cumKm: Math.round(r.segment.targetKm),
      legKm: Math.round(r.segment.kmFromPrev),
      legMinutes: r.segment.minutesFromPrev,
      nearestCity: r.hit.nearestCity ?? nearestCityName(r.hit, candidates, radiusKm),
    }
    return r
  })
}

/** Hit-level variant for callers that kept the annotated hit but not its segment
 *  (Timeline halt rows): reads the leg/nearestCity stamps annotateSegmentHits wrote. */
export function reasonForHit(h: PlaceHit): string | null {
  if (h.legMinutes == null) return null
  const mins = h.legMinutes
  const fatigue = mins > 0
    ? [mins >= 60 ? `Breaks a ${Math.round(mins / 60)} h drive` : `Breaks a ${mins} min drive`]
    : []
  const off = h.offRouteKm == null ? 'on route' : `${Math.round(h.offRouteKm)} km off-route`
  const city = h.nearestCity ? `near ${h.nearestCity}` : null
  return [...fatigue, off, city].filter((s): s is string => !!s).join(' · ')
}

/**
 * One-line "why this suggestion" for cards: fatigue slot (from the segment's
 * leg) + detour slot (or "on route" when unknown) + place slot (nearest city).
 * Pure — the caller supplies the detour it already computed.
 */
export function reasonForSegmentHit(r: SegmentHit, detour: number | null): string {
  const mins = r.segment.minutesFromPrev
  // Synthetic sight segments carry no leg (0 km / 0 min) — a fatigue slot
  // would read "Breaks a 0 min drive", so it is skipped, not rendered.
  const fatigue = mins > 0
    ? [mins >= 60 ? `Breaks a ${Math.round(mins / 60)} h drive` : `Breaks a ${mins} min drive`]
    : []
  const off = detour == null ? 'on route' : `${Math.round(detour)} km off-route`
  const city = r.hit?.nearestCity ? `near ${r.hit.nearestCity}` : null
  const parts = [...fatigue, off, city].filter((s): s is string => !!s)
  if (r.segment.rainy && r.hit && WEATHER_SHELTERED.has(r.hit.category ?? '')) {
    parts.push(r.segment.rainPct != null ? `indoor pick — ${Math.round(r.segment.rainPct)}% rain` : 'indoor pick for rain')
  }
  return parts.join(' · ')
}

// re-export the pure position helper so callers reach the planner's own API
export { kmFromStartForHit }
