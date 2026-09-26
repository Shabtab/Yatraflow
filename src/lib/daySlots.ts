// ============ The day's slots (the slots-rail engine, plan P1) ============
// A slot view over the halt segmentation: what the day is MISSING (lunch,
// fuel, dinner, stay), filled by search, comparison, or vote. Slots are
// DERIVED, never stored - they are a pure projection of engine output, so
// they can never drift from the engine.
//
// Three slot states (the mockup's grammar):
//   filled - one quiet line; the stop that fills it
//   empty  - candidates inside; tap to compare, source, or vote
//   auto   - engine-managed (stretch halts); a dim line, no work demanded
//
// Data rules this module keeps:
//   - Slots derive from `SegmentHit`s (planRideSegments via planJourneyHalts),
//     the day's itinerary stops, and the already-computed candidate pool.
//   - Every number shown (detour minutes, budget share, arrival) is already
//     computed by the engine - nothing is re-estimated here.
//   - Windows are the engine's own constants (LUNCH_WINDOW, DINNER_WINDOW,
//     BREAKFAST_WINDOW) - never re-declared.
//   - Day slicing walks the journey-ordered segments' `dayEnd` flags: each
//     overnight segment closes its day, so no geometry or day-index plumbing
//     is needed and a segment can never land in the wrong day.
//   - A generic stop only fills a meal/stay slot through its own category,
//     its reported opening hours overlapping the slot's window, or the
//     nearest-window fallback - two slots never claim one stop.
import {
  BREAKFAST_WINDOW,
  HALT_MIN,
  DINNER_WINDOW,
  LUNCH_WINDOW,
  fitScoreForPurpose,
  reasonForSegmentHit,
  scoreHitForSegment,
  type RideSegment,
  type SegmentHit,
} from './ridePlan'
import { budgetSharePct, dayDetourBudgetMin } from './detourBudget'
import { asymmetricDetourMinutes, detourKm, type HaltPurpose, type PlaceHit } from './providers/hits'
import { clockHM } from './clockOverlay'
import { haversineKm } from './geo'
import { buildJourney, MODE_SPEED } from './engine'
import type { SlotKind } from './haltFit'
import type { ItineraryStop, TransportMode, Trip, TripDecision } from '../data/types'
import { isAlreadyAdded, normalizePlaceName, type PlaceIdentity } from './placeIdentity'

/** How close to its window end an empty slot reads as urgent ("closes 14:30"). */
export const SLOT_URGENCY_MIN = 20

export type SlotKey = 'breakfast' | 'lunch' | 'dinner' | 'fuel' | 'stretch' | 'stay'
/** The four kinds of part a day can hold. Aliased to `SlotKind` (haltFit) so
 *  there is exactly ONE definition of "what a part of the day can be" — the
 *  hint's kind vocabulary and this module's are the same thing. */
export type DaySlotKind = SlotKind
export type MealSlotName = 'lunch' | 'dinner'
export type SlotState = 'filled' | 'empty' | 'auto'

/** One fillable candidate for an empty slot, pre-scored and window-annotated. */
export interface SlotCandidate {
  hit: PlaceHit
  /** door-to-door detour minutes at the trip's speed; null = position/detour unknown */
  detourMin: number | null
  /** road detour km (null = on route / unknown) */
  detourKm: number | null
  /** whole-percent share of that day's detour budget this candidate spends */
  budgetSharePct: number
  /** along-route km of the candidate (null = unpositionable) */
  posKm: number | null
  /** estimated arrival in minutes-since-midnight (null when the segment has no ETA) */
  arriveMin: number | null
  /** "HH:MM" arrival for the card, when known */
  arriveLabel: string | null
  /** true when the candidate's arrival lands inside the slot's window */
  inWindow: boolean
  /** engine score (lower = better) - the same number the corridor scan computed */
  score: number
  /** the engine's own why-line ("Breaks a 2 h drive · 5 km off-route · near Kochi") */
  reason: string
}

/** The part's live crew vote (plan P4): raised from the day plan, resolved in
 *  Group input, and its winner lands as the part's stop. */
export interface SlotVote {
  decisionId: string
  question: string
  optionCount: number
  votesCast: number
  voters: number
  /** The option holding the most votes so far (null before any vote). */
  leadingLabel: string | null
}

/** One slot of the day: a required halt as the rail renders it. */
export interface DaySlot {
  key: SlotKey
  kind: DaySlotKind
  /** which meal a meal segment became ("lunch" | "dinner"); breakfast keeps its own key */
  mealSlot?: MealSlotName
  /** user-facing name ("Lunch", "Stay") - the UI never shows the word "slot" */
  label: string
  state: SlotState
  /** the slot's clock window in minutes-since-midnight (null = none: fuel/stretch/stay) */
  windowMin: [number, number] | null
  /** "HH:MM - HH:MM" when a window exists; "auto" on the auto state */
  windowLabel: string | null
  /** the engine halt behind the slot (null = the prologue stay of a no-drive day) */
  segment: RideSegment | null
  /** the itinerary stop that fills the slot, when one does */
  filledStop: ItineraryStop | null
  /** stretch halts: engine-managed, quiet */
  auto: boolean
  /** #143 drift proposal on a pinned stretch halt: the Move here / Stay choice */
  drift: { fromKm: number; toKm: number } | null
  /** window end minus ETA; <= SLOT_URGENCY_MIN means "closing", negative = missed (null = no window or no ETA) */
  urgencyMin: number | null
  candidates: SlotCandidate[]
  /** an open crew decision raised for this part (plan P4) */
  vote?: SlotVote
  /** why-line for the auto state ("Engine-managed stretch") */
  reason: string | null
}

/** Per-day fill counts, for day chips and the rail's meter. */
export interface DayReadiness {
  dayIndex: number
  filled: number
  total: number
  auto: number
  /** total minus auto - the work the crew actually owns */
  required: number
}

export interface DaySlotsDeps {
  /** the whole journey's halt segmentation (journey-ordered, dayEnd flags intact) */
  haltSegments: SegmentHit[]
  /** THIS day's itinerary stops (all statuses; rejected never fill) */
  dayStops: ItineraryStop[]
  /** trip anchors (the corridor scan's own anchor list) */
  anchors: { lat: number; lng: number }[]
  /** OSRM route geometry when measured - makes detours asymmetric */
  routePolyline?: { lat: number; lng: number }[] | null
  transportMode?: TransportMode | null
  travelStyle?: string | null
  /** planned-stop count feeding that day's detour budget (MapTab's own input) */
  plannedStops?: number
  /** lowercase titles of stops already on the trip - such hits never re-candidate */
  existingNames?: ReadonlySet<string>
  /** #345: the one identity predicate's facts. When supplied it REPLACES the
   *  name-only check below, so a slot can no longer offer a place that was
   *  just dismissed, staged or (with `placeId`) already on the plan under a
   *  slightly different spelling. */
  identity?: PlaceIdentity
  /** the corridor scan's leftover pool (MapTab's altPool.all) */
  altPool?: PlaceHit[]
  /** max candidates rendered inside one slot (default 3) */
  limit?: number
  /** The trip's decisions: an open one whose options name this part shows as
   *  the part's live vote instead of its candidates. */
  decisions?: TripDecision[]
  /** Crew size for the vote's "N of M" reading — the trip's MEMBERS, the
   *  same denominator Group Input divides by, so one poll reads ONE quorum on
   *  both surfaces (#335's product call). `travellers` was a different count
   *  (it can name people who are not crew) and is gone rather than kept as a
   *  second reading. */
  memberCount?: number
  /** Day attribution override (the caller's own dayForKm over road-true
   *  per-day km): receives a journey segment, returns the trip day index it
   *  belongs to. When given, day slicing follows IT, not the dayEnd flags -
   *  corridor plans without overnight splits still attribute honestly. */
  dayOfSegment?: (sh: SegmentHit) => number | null
  /** When true, a day with any activity always renders the full day grammar
   *  (breakfast, lunch, dinner, stay) - engine halts fill what they can and
   *  the skeleton supplies the rest, so the rail reads the same on every day.
   */
  fillSkeleton?: boolean
  /** The day's road-km span (start inclusive, end inclusive) for positioning
   *  synthesized slots on the corridor. Absent = the day's own stops only. */
  daySpanKm?: (dayIndex: number) => { fromKm: number; toKm: number } | null
}

const SLOT_LABELS: Record<SlotKey, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  fuel: 'Fuel',
  stretch: 'Stretch',
  stay: 'Stay',
}

const LUNCH_END_MIN = LUNCH_WINDOW[1] // 14:30 - the meal split boundary
const BREAKFAST_END_MIN = BREAKFAST_WINDOW[1] // 9:30

/** Day slicing: the caller's attribution (dayOfSegment) wins when given;
 *  otherwise each `dayEnd` segment closes its day. */
function segmentsForDay(segs: SegmentHit[], dayIndex: number, dayOfSegment?: (sh: SegmentHit) => number | null): SegmentHit[] {
  if (dayOfSegment) return segs.filter(sh => dayOfSegment(sh) === dayIndex)
  const out: SegmentHit[] = []
  let day = 0
  for (const sh of segs) {
    if (day === dayIndex) out.push(sh)
    if (sh.segment.dayEnd) day += 1
    if (day > dayIndex) break
  }
  return out
}

const minute = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** "HH:MM - HH:MM" for a window; null when no window. */
function windowLabelOf(win: [number, number] | null): string | null {
  return win ? `${clockHM(win[0])} - ${clockHM(win[1])}` : null
}

/** The stop's clock span from its reported opening hours, when both ends exist. */
function stopSpanMin(s: ItineraryStop): [number, number] | null {
  const parse = (t?: string): number | null => {
    if (!t) return null
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2])
    if (!Number.isFinite(h) || !Number.isFinite(min)) return null
    return h * 60 + min
  }
  const open = parse(s.openTime)
  const close = parse(s.closeTime)
  if (open == null || close == null) return null
  return [open, close]
}

interface SlotDraft {
  key: SlotKey
  kind: DaySlotKind
  mealSlot?: MealSlotName
  segments: RideSegment[]
}

/**
 * Route one engine segment to its slot. Meals split by their arrival against
 * the engine's own windows: inside/before the breakfast window's end ->
 * breakfast, inside/before the lunch window's end -> lunch, past it ->
 * dinner. The plan's P0.3 rule holds - the purpose stays `meal`; only the
 * slot view splits it.
 */
function draftForSegment(seg: RideSegment): SlotDraft | null {
  switch (seg.purpose) {
    case 'meal': {
      const eta = minute(seg.etaMinutes) ? seg.etaMinutes : null
      if (eta != null && eta <= BREAKFAST_END_MIN) {
        return { key: 'breakfast', kind: 'meal', segments: [seg] }
      }
      const mealSlot: MealSlotName = eta != null && eta > LUNCH_END_MIN ? 'dinner' : 'lunch'
      return { key: mealSlot, kind: 'meal', mealSlot, segments: [seg] }
    }
    case 'fuel':
      return { key: 'fuel', kind: 'fuel', segments: [seg] }
    case 'stretch':
    case 'rest':
      return { key: 'stretch', kind: 'stretch', segments: [seg] }
    case 'overnight':
      return { key: 'stay', kind: 'overnight', segments: [seg] }
    default:
      return null // sight segments never become slots
  }
}

/** The engine's window for a slot - the constants ridePlan owns, never re-declared. */
function windowFor(draft: SlotDraft): [number, number] | null {
  if (draft.key === 'breakfast') return BREAKFAST_WINDOW
  if (draft.key === 'lunch') return LUNCH_WINDOW
  if (draft.key === 'dinner') return DINNER_WINDOW
  return null // fuel (its hint carries the tank window), stretch, stay
}

/**
 * Which stop fills a slot, if any. Rejected stops never fill. Category
 * claims first (food -> meal slots, hotel -> stay), then a stop's reported
 * hours overlapping an empty slot's window, then the nearest-window
 * fallback for food stops whose hours name no window. One stop fills at
 * most one slot, and a generic stop without a matching time fills nothing.
 */
function fillStopFor(
  drafts: SlotDraft[],
  stops: ItineraryStop[],
): Map<SlotKey, ItineraryStop> {
  const claims = new Map<SlotKey, ItineraryStop>()
  const claimed = new Set<string>()
  const active = stops.filter(s => s.status !== 'rejected')
  const takeLatest = (list: ItineraryStop[]): ItineraryStop | null =>
    list.length > 0 ? list[list.length - 1] : null

  const foodStops = active.filter(s => s.category === 'food' || (s.category as string) === 'cafe')
  const hotelStops = active.filter(s => s.category === 'hotel')
  /** A stop that NAMES the part it fills belongs to that part ONLY. Without
   *  this the category and hours passes could re-claim a place the crew filed
   *  as dinner for the LUNCH slot, so the rail showed a dinner pick sitting in
   *  lunch. An unnamed stop stays claimable by anything, as before. */
  const belongsTo = (key: SlotKey) => (s: ItineraryStop) => s.slotKey == null || s.slotKey === key

  // Pass 0 - provenance: a stop the day plan itself filled carries the part it
  // filled as DATA (`ItineraryStop.slotKey`), so the rail's Fill always reads
  // back as filled - whatever the place's category happens to be. The `notes`
  // substring is kept as a fallback for stops filled before that field
  // existed: notes are user-editable prose (the Stop editor exposes them and
  // the print export renders them), so they must never be the only source of
  // truth for a derived state.
  for (const d of drafts) {
    const pick = takeLatest(active.filter(s =>
      !claimed.has(String(s.id)) &&
      (s.slotKey === d.key || String(s.notes ?? '').includes(`day plan: ${d.key}`)),
    ))
    if (pick) {
      claims.set(d.key, pick)
      claimed.add(String(pick.id))
    }
  }

  // Pass 1 - meals: a food stop whose hours overlap the slot's window.
  for (const d of drafts) {
    if (d.kind !== 'meal') continue
    const win = windowFor(d)
    if (!win) continue
    const matching = foodStops.filter(s => {
      if (claimed.has(String(s.id)) || !belongsTo(d.key)(s)) return false
      const span = stopSpanMin(s)
      return span != null && span[0] < win[1] && span[1] > win[0]
    })
    const pick = takeLatest(matching)
    if (pick) {
      claims.set(d.key, pick)
      claimed.add(String(pick.id))
    }
  }

  // Pass 1b - fuel: a transport-hub stop claims it. Fuel has no clock
  // window, so category is the only honest claim.
  const fuelDraft = drafts.find(d => d.kind === 'fuel')
  if (fuelDraft) {
    const pick = takeLatest(active.filter(s => !claimed.has(String(s.id)) && belongsTo(fuelDraft.key)(s) && s.category === 'transport-hub'))
    if (pick) {
      claims.set(fuelDraft.key, pick)
      claimed.add(String(pick.id))
    }
  }

  // Pass 2 - stay: the hotel-category stop claims it.
  const stayDraft = drafts.find(d => d.kind === 'overnight')
  if (stayDraft) {
    const pick = takeLatest(hotelStops.filter(s => !claimed.has(String(s.id)) && belongsTo(stayDraft.key)(s)))
    if (pick) {
      claims.set(stayDraft.key, pick)
      claimed.add(String(pick.id))
    }
  }

  // Pass 3 - meals still empty: remaining food stops. Each STOP chooses its
  // slot (a 12:00 stop is a lunch, not an earliest-slot grab), so the
  // assignment follows the hours, not the slot order; a stop without hours
  // falls to the day's natural order (lunch, then dinner, then breakfast).
  const emptyMeals = drafts.filter(d => d.kind === 'meal' && !claims.has(d.key))
  if (emptyMeals.length > 0) {
    const slotsWithWin = emptyMeals
      .map(d => ({ key: d.key, win: windowFor(d) }))
      .filter((x): x is { key: SlotKey; win: [number, number] } => x.win != null)
    for (const stop of foodStops) {
      if (claimed.has(String(stop.id))) continue
      const span = stopSpanMin(stop)
      if (span == null) continue
      let best: { key: SlotKey; dist: number } | null = null
      for (const slot of slotsWithWin) {
        if (claims.has(slot.key) || !belongsTo(slot.key)(stop)) continue
        const dist = Math.abs(span[0] - slot.win[0])
        if (best == null || dist < best.dist) best = { key: slot.key, dist }
      }
      if (best) {
        claims.set(best.key, stop)
        claimed.add(String(stop.id))
      }
    }
    // Untimed food stops fill what is left in the day's own order.
    const untimed = foodStops.filter(s => !claimed.has(String(s.id)) && stopSpanMin(s) == null)
    const order: SlotKey[] = ['lunch', 'dinner', 'breakfast']
    for (const key of order) {
      const d = emptyMeals.find(x => x.key === key)
      if (!d || claims.has(key)) continue
      const pick = takeLatest(untimed.filter(s => !claimed.has(String(s.id)) && belongsTo(key)(s)))
      if (pick) {
        claims.set(key, pick)
        claimed.add(String(pick.id))
      }
    }
  }

  // Pass 4 - a non-food, non-hotel stop whose hours overlap an empty slot's
  // window fills that window (a 12:30 'travel' stop reads as lunch). Without
  // matching hours it fills nothing - two slots never claim one stop.
  for (const d of drafts) {
    if (claims.has(d.key)) continue
    const win = windowFor(d)
    if (!win) continue
    const matching = active.filter(s => {
      if (claimed.has(String(s.id)) || !belongsTo(d.key)(s)) return false
      if (s.category === 'food' || s.category === 'hotel') return false
      const span = stopSpanMin(s)
      return span != null && span[0] < win[1] && span[1] > win[0]
    })
    const pick = takeLatest(matching)
    if (pick) {
      claims.set(d.key, pick)
      claimed.add(String(pick.id))
    }
  }

  return claims
}

/** Slot engine speed: the trip mode's own door-to-door figure, 40 as fallback. */
function speedFor(mode: TransportMode | null | undefined): number {
  const v = mode != null ? MODE_SPEED[mode] : undefined
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 40
}

/** The engine purpose a slot scores its pool against. */
function purposeFor(kind: DaySlotKind): HaltPurpose {
  switch (kind) {
    case 'overnight': return 'overnight'
    case 'fuel': return 'fuel'
    case 'stretch': return 'stretch'
    default: return 'meal'
  }
}

/** A synthetic segment scores pool candidates when the slot has no engine halt. */
function synthSegment(draft: SlotDraft, seg: RideSegment | null): RideSegment {
  if (seg) return seg
  return {
    index: 0,
    purpose: purposeFor(draft.kind),
    label: SLOT_LABELS[draft.key],
    targetKm: 0,
    minKm: 0,
    maxKm: Number.MAX_SAFE_INTEGER,
    kmFromPrev: 0,
    minutesFromPrev: 0,
    hint: '',
  }
}

/**
 * Candidates for an empty slot. The segment's own engine-scored hit leads;
 * the corridor pool (altPool) is scored with the engine's own scorer. Pool
 * gating stays honest: meals accept food-grade places or real towns, fuel
 * wants fuel-grade places, stretch wants break-grade ones (fit >= 2), and a
 * stay needs hotel-grade or town-grade. The day's detour budget culls the
 * tail exactly as the see-&-do rail spends its budget.
 */
function candidatesFor(
  draft: SlotDraft,
  seg: RideSegment | null,
  segHits: SegmentHit[],
  deps: DaySlotsDeps,
): SlotCandidate[] {
  const limit = deps.limit ?? 3
  const win = windowFor(draft)
  const speed = speedFor(deps.transportMode)
  const purpose = purposeFor(draft.kind)
  const seen = new Set<string>()
  const rows: Array<{ hit: PlaceHit; score: number }> = []

  for (const sh of segHits) {
    if (!sh.hit) continue
    const id = String(sh.hit.id)
    if (seen.has(id)) continue
    if (deps.identity ? isAlreadyAdded(sh.hit, deps.identity)
      : deps.existingNames?.has(normalizePlaceName(sh.hit.name))) continue
    seen.add(id)
    rows.push({ hit: sh.hit, score: sh.score })
  }

  for (const h of deps.altPool ?? []) {
    const id = String(h.id)
    if (seen.has(id)) continue
    if (deps.existingNames?.has(h.name.toLowerCase())) continue
    // Pool gating: meals take food-grade places or real towns, fuel wants
    // fuel-grade, stretch break-grade, stays hotel/town-grade (fit >= 2).
    if (fitScoreForPurpose(h, purpose) < 2) continue
    const score = scoreHitForSegment(h, synthSegment(draft, seg), deps.anchors, {
      routePolyline: deps.routePolyline ?? undefined,
      speedKmph: speed,
    })
    if (score == null) continue
    seen.add(id)
    rows.push({ hit: h, score })
  }

  // Coupled re-ranking (plan P3.4): once the day has a stay, its meals rank
  // by proximity to that stay - the engine score separates the ties.
  const stay = deps.dayStops.find(s => s.status !== 'rejected' && s.category === 'hotel'
    && Number.isFinite(s.lat) && Number.isFinite(s.lng))
  const nearStay = draft.kind === 'meal' && stay ? stay : null
  const stayKmOf = (h: PlaceHit): number | null =>
    nearStay ? haversineKm(h.latitude, h.longitude, nearStay.lat, nearStay.lng) : null
  rows.sort((a, b) => {
    if (nearStay) {
      const da = stayKmOf(a.hit)
      const db = stayKmOf(b.hit)
      if (da != null && db != null && da !== db) return da - db
    }
    return a.score - b.score
  })

  const budget = dayDetourBudgetMin({
    travelStyle: deps.travelStyle ?? undefined,
    plannedStops: deps.plannedStops,
  })
  const out: SlotCandidate[] = []
  let spent = 0
  for (const row of rows) {
    if (out.length >= limit) break
    const dKm = detourKm(row.hit, deps.anchors)
    const dMin = asymmetricDetourMinutes(row.hit, deps.anchors, deps.routePolyline ?? null, speed)
    // Unknown position is never free or auto-kept: the candidate needs a
    // measured road position before it can consume the day's finite budget.
    if (dMin == null) continue
    if (spent + dMin > budget) continue
    spent += dMin
    const eta = seg && minute(seg.etaMinutes) ? (seg.etaMinutes as number) : null
    const arriveMin = eta != null && dMin != null ? Math.round(eta + dMin) : null
    const inWindow = arriveMin != null && win != null && arriveMin >= win[0] && arriveMin <= win[1]
    out.push({
      hit: row.hit,
      detourMin: dMin,
      detourKm: dKm,
      budgetSharePct: budgetSharePct(dMin, budget),
      posKm: row.hit.alongRouteKm ?? null,
      arriveMin,
      arriveLabel: arriveMin != null ? clockHM(arriveMin) : null,
      inWindow,
      score: row.score,
      reason: [
        reasonForSegmentHit({ segment: synthSegment(draft, seg), hit: row.hit, score: row.score }, dKm),
        (() => {
          const km = stayKmOf(row.hit)
          return km != null && km <= 2 ? `${km.toFixed(1)} km from your stay` : null
        })(),
      ].filter((x): x is string => !!x).join(' \u00b7 '),
    })
  }
  return out
}

/** Canonical rail order (the mockup's grammar): breakfast, lunch, fuel,
 *  stretch, dinner, stay. Stable for equal ranks. */
const KIND_RANK: Record<SlotKey, number> = { breakfast: 0, lunch: 1, fuel: 2, stretch: 3, dinner: 4, stay: 5 }

/**
 * Supply the missing parts of the day's grammar. Every day with any activity
 * gets lunch; a day that ends at a stay gets dinner; a day that begins after
 * a night (or holds its own stay) gets breakfast. Fuel and stretch stay
 * engine-only: a need the engine has not derived is not invented.
 */
function addSkeleton(drafts: SlotDraft[], deps: DaySlotsDeps, dayIndex: number): void {
  const hasStay = drafts.some(d => d.key === 'stay')
  const hasActivity = drafts.length > 0 || deps.dayStops.some(s => s.status !== 'rejected')
  if (!hasActivity) return
  const span = deps.daySpanKm?.(dayIndex) ?? null
  const midKm = span ? span.fromKm + (span.toKm - span.fromKm) * 0.45 : 0
  const synth = (key: SlotKey, purpose: RideSegment['purpose'], targetKm: number, mealSlot?: MealSlotName): SlotDraft => ({
    key,
    kind: key === 'stay' ? 'overnight' : 'meal',
    ...(mealSlot ? { mealSlot } : {}),
    segments: [{
      index: -1,
      purpose,
      label: SLOT_LABELS[key],
      targetKm,
      minKm: Math.max(0, targetKm - 60),
      maxKm: targetKm + 60,
      kmFromPrev: 0,
      minutesFromPrev: 0,
      hint: '',
      // A hint of arrival so candidates get honest times: breakfast reads as
      // eaten at the day's start, lunch in its window, dinner at its window.
      ...(key === 'breakfast' ? { etaMinutes: BREAKFAST_WINDOW[0] + 30 }
        : key === 'lunch' ? { etaMinutes: LUNCH_WINDOW[0] + 30 }
        : key === 'dinner' ? { etaMinutes: DINNER_WINDOW[0] + 30 }
        : {}),
    }],
  })
  if (!drafts.some(d => d.key === 'breakfast') && (hasStay || dayIndex > 0)) {
    drafts.push(synth('breakfast', 'meal', span ? span.fromKm : 0))
  }
  if (!drafts.some(d => d.key === 'lunch')) {
    drafts.push(synth('lunch', 'meal', midKm, 'lunch'))
  }
  if (hasStay && !drafts.some(d => d.key === 'dinner')) {
    drafts.push(synth('dinner', 'meal', span ? span.toKm : 0, 'dinner'))
  }
}

/** The part's live vote, if the crew has one open for it. The option ids a
 *  slot poll raises carry `slot:<key>:` - the join that makes this exact. */
function voteFor(draft: SlotDraft, deps: DaySlotsDeps): SlotVote | undefined {
  const prefix = `slot:${draft.key}:`
  const dec = (deps.decisions ?? []).find(d => d.status === 'open'
    && d.options.some(o => String(o.id).startsWith(prefix)))
  if (!dec) return undefined
  const cast = Object.values(dec.votesByUserId ?? {}).filter(Boolean)
  const tally = new Map<string, number>()
  for (const optionId of cast) tally.set(optionId, (tally.get(optionId) ?? 0) + 1)
  let leading: string | null = null
  let best = 0
  for (const o of dec.options) {
    const n = tally.get(o.id) ?? 0
    if (n > best) {
      best = n
      leading = o.label
    }
  }
  return {
    decisionId: dec.id,
    question: dec.question,
    optionCount: dec.options.length,
    votesCast: cast.length,
    voters: deps.memberCount ?? 0,
    leadingLabel: leading,
  }
}

/**
 * The day's slots, derived from engine output alone. Order follows the
 * journey; with fillSkeleton the missing parts of the day's grammar are
 * supplied so every day reads the same; the canonical kind order keeps the
 * rail identical to the design on every day.
 */
export function daySlots(dayIndex: number, deps: DaySlotsDeps): DaySlot[] {
  const daySegs = segmentsForDay(deps.haltSegments, dayIndex, deps.dayOfSegment)

  const drafts: SlotDraft[] = []
  const pushDraft = (d: SlotDraft) => {
    const existing = drafts.find(x => x.key === d.key)
    if (existing) existing.segments.push(...d.segments)
    else drafts.push(d)
  }
  for (const sh of daySegs) {
    const d = draftForSegment(sh.segment)
    if (d) pushDraft(d)
  }

  // Prologue: a no-drive day whose hotel stop exists still owns its stay.
  if (!drafts.some(d => d.key === 'stay')) {
    const hotelStop = deps.dayStops.find(s => s.category === 'hotel' && s.status !== 'rejected')
    if (hotelStop) drafts.unshift({ key: 'stay', kind: 'overnight', segments: [] })
  }

  if (deps.fillSkeleton) addSkeleton(drafts, deps, dayIndex)

  // Canonical rail order (the mockup's grammar) - stable for equal ranks.
  drafts.sort((a, b) => (KIND_RANK[a.key] - KIND_RANK[b.key]))

  if (drafts.length === 0) return []

  const claims = fillStopFor(drafts, deps.dayStops)

  return drafts.map(draft => {
    const seg = draft.segments[0] ?? null
    const win = windowFor(draft)
    const filledStop = claims.get(draft.key) ?? null
    const isStretch = draft.kind === 'stretch'
    const drift =
      isStretch && seg?.haltPinned && minute(seg.haltDriftToKm)
        ? { fromKm: seg.targetKm, toKm: seg.haltDriftToKm as number }
        : null
    // A filled slot is never also engine-managed. `auto` means "the engine
    // handles this, no work is demanded of you"; a claimed stop is work already
    // done. Without the `!filledStop` guard a stretch slot claimed by a stop
    // counted in BOTH `filled` and `auto`, so readiness could sum past its own
    // total and the meter drew a part as filled and dashed at once.
    const auto = isStretch && drift == null && !filledStop
    const eta = seg && minute(seg.etaMinutes) ? (seg.etaMinutes as number) : null
    const urgencyMin = win && eta != null ? win[1] - eta : null
    // Candidate hits are the draft's OWN segments, never every same-purpose
    // segment in the day. Lunch and dinner are both purpose `meal`, so a
    // purpose filter handed the two meals an identical pool - and a synthesized
    // slot borrowed another meal's engine halt as its lead candidate. A draft
    // with no engine segment (a skeleton part) honestly draws from the corridor
    // pool alone.
    const segHits = draft.segments.length > 0
      ? daySegs.filter(sh => draft.segments.includes(sh.segment))
      : []
    return {
      key: draft.key,
      kind: draft.kind,
      ...(draft.mealSlot ? { mealSlot: draft.mealSlot } : {}),
      label: SLOT_LABELS[draft.key],
      state: filledStop ? 'filled' : auto ? 'auto' : 'empty',
      windowMin: win,
      windowLabel: auto ? 'auto' : windowLabelOf(win),
      segment: seg,
      filledStop,
      auto,
      drift,
      urgencyMin,
      candidates: filledStop || auto ? [] : candidatesFor(draft, seg, segHits, deps),
      ...(filledStop ? {} : { vote: voteFor(draft, deps) }),
      reason: auto ? 'Engine-managed stretch' : null,
    }
  })
}

/** One block of the day's shape: a drive or one of its parts. Minutes are the
 *  only unit - the view scales them, the tests compare them. */
export interface ShapeBlock {
  kind: 'drive' | DaySlotKind
  label: string
  minutes: number
  state: SlotState | 'drive'
  /** wall-clock start (minutes since midnight) when the segment carries one */
  startMin: number | null
}

/** How long a part of the day is assumed to take when the engine has no
 *  figure of its own (nights are the one long block). */
const SHAPE_MINUTES: Record<string, number> = {
  stretch: HALT_MIN.stretch,
  meal: HALT_MIN.meal,
  fuel: HALT_MIN.fuel,
  dinner: HALT_MIN.dinner,
  overnight: 480,
}

/** The day's shape in journey order: each drive followed by the part it
 *  serves. Pure over the same deps the rail uses - no new estimates.
 *
 *  Sights are deliberately absent. `draftForSegment` routes only the day's
 *  grammar (meal / fuel / stretch / rest / overnight) to a slot, and the right
 *  rail's own copy calls sights "never required" - so a sight is an extra the
 *  crew opts into, not a part of the day that is outstanding. Rendering one
 *  here would show a dashed "unplanned" block demanding work the product
 *  elsewhere says is optional. */
export function dayShape(dayIndex: number, deps: DaySlotsDeps, precomputed?: DaySlot[]): ShapeBlock[] {
  const segs = segmentsForDay(deps.haltSegments, dayIndex, deps.dayOfSegment)
  // The caller's own slots when it already has them: re-deriving the day here
  // made the shape a third full derivation of the same day on every render.
  const slots = precomputed ?? daySlots(dayIndex, deps)
  const out: ShapeBlock[] = []
  for (const sh of segs) {
    // The segment's OWN draft key, not an identity match on `slot.segment`:
    // a draft that merged two same-key segments only carries the first, so
    // identity lookup left the second block with no slot at all.
    const draft = draftForSegment(sh.segment)
    if (!draft) continue
    const slot = slots.find(s => s.key === draft.key)
    const drive = Math.round(sh.segment.minutesFromPrev)
    if (drive > 0) {
      out.push({ kind: 'drive', label: 'Drive', minutes: drive, state: 'drive', startMin: null })
    }
    const minutes = SHAPE_MINUTES[sh.segment.purpose] ?? 30
    out.push({
      kind: slot?.kind ?? draft.kind,
      label: sh.segment.label,
      minutes,
      state: slot?.state ?? 'empty',
      startMin: sh.segment.etaMinutes ?? null,
    })
  }
  return out
}

/** The rail's meter for one day. */
export function dayReadiness(dayIndex: number, deps: DaySlotsDeps): DayReadiness {
  const slots = daySlots(dayIndex, deps)
  const filled = slots.filter(s => s.state === 'filled').length
  const auto = slots.filter(s => s.auto).length
  return {
    dayIndex,
    filled,
    total: slots.length,
    auto,
    required: slots.length - auto,
  }
}

/** Trip-wide readiness, one entry per day that has any slot (chip row / Overview matrix).
 *
 *  The day bound is the UNION of the days the engine attributed halts to and
 *  the trip's own days: a rest day with stops but no halts still owns a row,
 *  and bounding by halts alone silently dropped it from the chip row. */
export function tripReadiness(
  haltSegments: SegmentHit[],
  days: Array<{ index: number; stops: ItineraryStop[] }>,
  base: Omit<DaySlotsDeps, 'haltSegments' | 'dayStops'>,
): DayReadiness[] {
  const out: DayReadiness[] = []
  let maxDay = days.reduce((m, d) => Math.max(m, d.index), 0)
  if (base.dayOfSegment) {
    for (const sh of haltSegments) {
      const d = base.dayOfSegment(sh)
      if (d != null && d > maxDay) maxDay = d
    }
  } else {
    let day = 0
    for (const sh of haltSegments) {
      maxDay = Math.max(maxDay, day)
      if (sh.segment.dayEnd) day += 1
    }
  }
  for (let d = 0; d <= maxDay; d++) {
    const dayEntry = days.find(x => x.index === d)
    out.push(
      dayReadiness(d, {
        ...base,
        haltSegments,
        dayStops: dayEntry?.stops ?? [],
      }),
    )
  }
  return out
}

/**
 * The trip's own day attribution, over the road-true per-day km the Map tab
 * already trusts. **One definition, shared** - the Map rail, the day chips and
 * the Overview matrix all read this. Two surfaces deriving the same day from
 * two different attributions is exactly how a "day plan" ends up disagreeing
 * with itself on screen.
 *
 * `dayRoadKm` is the routing legs' per-day km, aligned with `trip.days`
 * POSITIONALLY - indexes can skip (a deleted day), so every result is keyed by
 * the day's own index, never its position. Absent, the journey-summed estimate
 * stands in.
 */
export function tripDayAttribution(
  trip: Trip,
  dayRoadKm?: number[] | null,
): {
  /** Which trip day a road km belongs to (null = unpositionable). */
  dayForKm: (km: number | null | undefined) => number | null
  /** `DaySlotsDeps.dayOfSegment` for this trip. */
  dayOfSegment: (sh: SegmentHit) => number | null
  /** `DaySlotsDeps.daySpanKm` for this trip. */
  daySpanKm: (dayIndex: number) => { fromKm: number; toKm: number } | null
} {
  const perDay = dayRoadKm ?? trip.days.map(d => buildJourney(trip, d).distanceKm)
  // #161: unknown km used to silently attribute to Day 1 - an off-polyline
  // hit's budget, day lookup and pick-day default all lied. Return null and let
  // each consumer decide honestly.
  const dayForKm = (km: number | null | undefined): number | null => {
    if (km == null || !Number.isFinite(km)) return null
    let covered = 0
    for (let i = 0; i < trip.days.length; i++) {
      covered += perDay[i] ?? 0
      if (km <= covered) return trip.days[i].index
    }
    return trip.days[trip.days.length - 1]?.index ?? null
  }
  return {
    dayForKm,
    dayOfSegment: sh => dayForKm(sh.hit?.cumKm ?? sh.segment.targetKm),
    daySpanKm: dayIndex => {
      const pos = trip.days.findIndex(d => d.index === dayIndex)
      if (pos < 0) return null
      let from = 0
      for (let i = 0; i < pos; i++) from += perDay[i] ?? 0
      const span = perDay[pos] ?? 0
      return { fromKm: from, toKm: from + Math.max(span, 1) }
    },
  }
}
