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
import { HOME_ZONE_KM, kmFromStartForHit, detourKm, type HaltPurpose, type PlaceHit } from './providers/hits'

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
  /** true when this segment closes a day boundary (overnight stay) */
  dayEnd?: boolean
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
    push('stretch', STRETCH_INTERVAL_KM)
    if (includeFuel) push('fuel', fuelEvery)
    push('meal', MEAL_INTERVAL_KM)
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
      dayEnd: purpose === 'overnight' ? true : undefined,
      hint: PURPOSE_HINT[purpose](minutesFromPrev),
    }
  })
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
}

/**
 * Assign the single best hit to each segment (journey order). Scoring:
 * distance-to-target (heavier outside the segment's window), detour (×2),
 * purpose-fit mismatch (3 − fit) × 4. Greedy dedupe: a hit used for an earlier
 * segment leaves the later pools (roads don't repeat). Segments with no
 * suitable candidate keep hit = null — the caller renders them as gaps.
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
  const pool: PlaceHit[] = []
  for (const h of filtered) {
    const key = (h.name ?? '').toLowerCase()
    if (!key || seenNames.has(key)) continue
    seenNames.add(key)
    pool.push(h)
  }

  const used = new Set<string>()
  const results: SegmentHit[] = []
  for (const seg of segments) {
    let best: PlaceHit | null = null
    let bestScore = Infinity
    for (const h of pool) {
      if (used.has(h.id as string)) continue
      const pos = kmFromStartForHit(h, anchors)
      if (pos == null) continue // unpositionable hit can't serve a timed segment
      const dist = Math.abs(pos - seg.targetKm)
      const window = Math.max(1, seg.maxKm - seg.minKm)
      const distPenalty = dist > window / 2 ? dist + window : dist
      const fit = fitScoreForPurpose(h, seg.purpose)
      const score = distPenalty + (detourKm(h, anchors) ?? 0) * 2 + (3 - fit) * 4
      if (score < bestScore) { bestScore = score; best = h }
    }
    if (best) used.add(best.id as string)
    results.push({ segment: seg, hit: best, score: bestScore })
  }
  return results
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

// re-export the pure position helper so callers reach the planner's own API
export { kmFromStartForHit }