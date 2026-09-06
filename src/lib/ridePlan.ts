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
import { classifyRoadWindow, type RoadKind } from './roadPersonality'
import { hmToMinutes } from './engine'
import { HOME_ZONE_KM, kmFromStartForHit, detourKm, detourMinutes, dedupeCandidates, type HaltPurpose, type PlaceHit } from './providers/hits'

// ---- Fatigue cadence (named constants — later settings can expose them) ----
/** ≈2 h at 70–80 km/h — stretch, hydrate, bio-break. */
export const STRETCH_INTERVAL_KM = 150
/** ≈4 h — the lunch cadence. */
export const MEAL_INTERVAL_KM = 300
/** Default tank range for fuel cadence (honoured per vehicleRangeKm when set). */
export const FUEL_INTERVAL_KM = 450
/** ≈7 h — the cross-day overnight cadence; max daily drive cap is 8 h. */
export const OVERNIGHT_INTERVAL_KM = 550
/** Never place two breaks closer than this. */
export const MIN_BREAK_GAP_KM = 110
/** Never propose a stop inside this distance of the journey's end. */
export const ENDNO_KM = 60
/** Drives shorter than this don't need planned breaks at all. */
export const MIN_PLANNED_DRIVE_KM = 90

export interface RidePlanInput {
  totalKm: number
  /** wheel time (driving only) for the whole journey */
  driveMinutes: number
  /** whether fuel halts should be included (self-drive trips) */
  includeFuel?: boolean
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
  /** simplified route geometry {lat,lng}[] — enables road-personality tagging */
  roadGeometry?: { lat: number; lng: number }[]
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
export const PURPOSE_FIT: Record<string, Partial<Record<HaltPurpose, number>>> = {
  food: { meal: 3, stretch: 2, rest: 2 },
  'transport-hub': { fuel: 3, stretch: 2, meal: 1, rest: 1 },
  hotel: { overnight: 3, rest: 1 },
  cafe: { stretch: 3, meal: 1 },
  rest: { stretch: 2, rest: 3, meal: 1 },
  sightseeing: { sight: 3 },
}

const DEFAULT_FIT: Partial<Record<HaltPurpose, number>> = { stretch: 1, rest: 1, sight: 2 }

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
    const w = classifyRoadWindow(slice)
    s.roadPersonality = w.kind
    s.roadWarning = w.warning
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
  if (total < MIN_PLANNED_DRIVE_KM) return []
  const drive = Number.isFinite(input.driveMinutes) ? Math.max(0, input.driveMinutes) : 0
  const includeFuel = !!input.includeFuel
  const multiDay = !!input.multiDay
  const fuelEvery = Math.max(100, (input.vehicleRangeKm && input.vehicleRangeKm > 0 ? input.vehicleRangeKm : FUEL_INTERVAL_KM) * 0.85)
  const cap = total - ENDNO_KM // nothing past here

  // Day boundaries for multi-day plans: an overnight every OVERNIGHT_INTERVAL_KM.
  const dayEnds: number[] = []
  if (multiDay) {
    for (let km = OVERNIGHT_INTERVAL_KM; km < cap; km += OVERNIGHT_INTERVAL_KM) dayEnds.push(km)
  }
  const dayStarts = [0, ...dayEnds]

  // Phase A — in-day cadence relative to each day's start, plus the overnights
  // that close each day. Cadences RESET after an overnight, so day-2's stretch
  // lands ~150 km into day 2, not 600 km from the origin.
  type Raw = { km: number; purpose: HaltPurpose }
  const raws: Raw[] = []
  dayStarts.forEach((dayStart, di) => {
    const dayCap = dayEnds[di] ?? Infinity
    const push = (purpose: HaltPurpose, step: number) => {
      for (let km = dayStart + step; km < dayCap && km < cap; km += step) raws.push({ km, purpose })
    }
    push('stretch', sanitizedStretchKm(input))
    if (includeFuel) push('fuel', fuelEvery)
    push('meal', sanitizedMealKm(input))
  })
  dayEnds.forEach(e => raws.push({ km: e, purpose: 'overnight' }))
  if (raws.length === 0) return []

  // Phase B — sort, then collapse within-day collisions closer than
  // MIN_BREAK_GAP_KM. Overnights always open a new merged entry (they close a
  // day — what follows belongs to the next day). A higher-priority incoming
  // target (meal > fuel > stretch) shifts the merged position to its own km.
  raws.sort((a, b) => a.km - b.km || PURPOSE_PRIORITY[b.purpose] - PURPOSE_PRIORITY[a.purpose])
  const merged: { km: number; purposes: HaltPurpose[] }[] = []
  for (const raw of raws) {
    const last = merged[merged.length - 1]
    if (last && last.purposes[0] !== 'overnight' && raw.purpose !== 'overnight' && raw.km - last.km < MIN_BREAK_GAP_KM) {
      const higher = PURPOSE_PRIORITY[raw.purpose] > PURPOSE_PRIORITY[last.purposes[0]]
      last.purposes = higher ? [raw.purpose, ...last.purposes] : [...last.purposes, raw.purpose]
      if (higher) last.km = raw.km
    } else {
      merged.push({ km: raw.km, purposes: [raw.purpose] })
    }
  }

/** Meal window in minutes since midnight: lunch must land 11:30–14:30. */
const MEAL_WINDOW: [number, number] = [11 * 60 + 30, 14 * 60 + 30]
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
  for (const m of merged) {
    if (!m.purposes.includes('meal')) continue
    const eta = etaAt(m.km, dayStarts, input.dayStartTimes, total, drive)
    if (eta >= MEAL_WINDOW[0] && eta <= MEAL_WINDOW[1]) continue
    const edge = Math.abs(eta - MEAL_WINDOW[0]) <= Math.abs(eta - MEAL_WINDOW[1]) ? MEAL_WINDOW[0] : MEAL_WINDOW[1]
    m.km = Math.min(cap, Math.max(0, m.km + (edge - eta) * kmPerMin))
  }
  merged.sort((a, b) => a.km - b.km)

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
    const label = hasMeal && hasFuel
      ? 'Meal + fuel'
      : m.purposes.length > 1 && purpose !== 'overnight'
        ? `${PURPOSE_LABEL[purpose]} + ${extraPurposes.map(p => PURPOSE_SHORT[p]).join(' + ')}`
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
      etaMinutes: Math.round(etaAt(m.km, dayStarts, input.dayStartTimes, total, drive)),
      ...rainFor(m.km, dayStarts, input.dayRainPct),
      dayEnd: purpose === 'overnight' ? true : undefined,
      hint: PURPOSE_HINT[purpose](minutesFromPrev),
    }
  })
  // Phase D — road personality: slice the route geometry into per-segment
  // windows by cumulative-km fraction and classify each. Geometry-free plans
  // keep segments untagged; hints stay untouched (warnings render separately).
  annotateRoadPersonality(segments, input.roadGeometry, total)
  return segments
}

/** A user-entered halt in the manual planner: stop at `km` along the route for `minutes`, serving `purpose`. */
export interface HaltPlanItem {
  km: number
  minutes: number
  purpose: HaltPurpose
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
  // Detour scores in minutes at the trip's speed, not flat km: the same
  // off-route distance costs a slow mode more. ×2 keeps the old weight at
  // the 60 km/h reference (10 km = 10 min = 20 points, as before).
  return distPenalty + detourMinutes(h, anchors, opts.speedKmph) * 2 + (3 - fit) * 4
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
 * Unassigned corridor hits become See & do entries: the halt planner only
 * makes fuel/meal/rest/stretch/overnight segments, so without this the
 * sightseeing column is empty by construction. Each leftover gets a synthetic
 * 'sight' segment at its road position (callers run annotateSegmentHits over
 * the combined list for city/leg stamps). Capped — a long corridor yields
 * hundreds of candidates.
 */
export function leftoverAsSight(
  candidates: PlaceHit[],
  assigned: SegmentHit[],
  anchors: { lat: number; lng: number }[],
  opts: AssignOpts = {},
  cap = 8,
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