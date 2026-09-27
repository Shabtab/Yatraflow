// ============ UI preference persistence (localStorage) ============
// Small, failure-tolerant helpers for UI state that should survive reloads but
// is NOT part of the trip data model (so it stays out of Supabase/snapshots).
// Pure parsing lives in parseDayCollapseMap so it can be unit-tested in node
// (no DOM/localStorage), while the load/save wrappers guard for environments
// where localStorage is missing or throws (private mode, quota, corrupted JSON).

// (No map-view-mode prefs here: the always-2D decision made view mode
// session-only in TripMap — the previously exported load/saveMapViewMode pair
// is deleted (#172); import from lib/mapViewModes for parse helpers.)

const DAY_COLLAPSE_KEY = 'yatraflow_day_collapsed'

/** Stable key for one day of one trip: "<tripId>:<dayIndex>". */
export function dayCollapseKey(tripId: string, dayIndex: number): string {
  return `${tripId}:${dayIndex}`
}

/**
 * Parse the stored collapse map. Accepts only a flat object of booleans —
 * anything else (null, arrays, nested junk, non-boolean values) is dropped,
 * so a corrupted entry degrades to "expanded" instead of crashing the UI.
 */
export function parseDayCollapseMap(raw: string | null | undefined): Record<string, boolean> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** Read one day's collapsed state; unknown/missing = expanded (false). */
export function loadDayCollapsed(tripId: string, dayIndex: number): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const map = parseDayCollapseMap(localStorage.getItem(DAY_COLLAPSE_KEY))
    return map[dayCollapseKey(tripId, dayIndex)] ?? false
  } catch {
    return false
  }
}

/** Write one day's collapsed state. Silent no-op when storage is unavailable. */
export function saveDayCollapsed(tripId: string, dayIndex: number, collapsed: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    const map = parseDayCollapseMap(localStorage.getItem(DAY_COLLAPSE_KEY))
    map[dayCollapseKey(tripId, dayIndex)] = collapsed
    localStorage.setItem(DAY_COLLAPSE_KEY, JSON.stringify(map))
  } catch {
    // Private mode / quota exceeded — persistence is best-effort by design.
  }
}

// ---- Accordion open-day (Timeline) ----
// The collapsed-by-default Timeline keeps ONE day open per trip (accordion):
// a day index, or NO_OPEN_DAY when every day is collapsed. Stored per trip so
// a reload restores the day you were working on. This supersedes the per-day
// `yatraflow_day_collapsed` map above — per-day booleans can't express
// "opening one day closes the others", and under accordion semantics the old
// map's history is meaningless, so it is retired from active use (its helpers
// stay exported for compatibility).
const OPEN_DAY_KEY = 'yatraflow_open_day'

/** Sentinel for "no day is open" (the collapsed-by-default state). */
export const NO_OPEN_DAY = -1

/**
 * Parse the stored open-day map. Accepts only a flat object of integers
 * ≥ NO_OPEN_DAY — anything else is dropped, so a corrupted entry degrades to
 * "all collapsed" instead of crashing the UI.
 */
export function parseOpenDayMap(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= NO_OPEN_DAY) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** Read the trip's open day; unknown/missing = NO_OPEN_DAY (all collapsed). */
export function loadOpenDay(tripId: string): number {
  if (typeof localStorage === 'undefined') return NO_OPEN_DAY
  try {
    const map = parseOpenDayMap(localStorage.getItem(OPEN_DAY_KEY))
    return map[tripId] ?? NO_OPEN_DAY
  } catch {
    return NO_OPEN_DAY
  }
}

/**
 * Write the trip's open day (`NO_OPEN_DAY` closes all). Silent no-op when
 * storage is unavailable.
 */
export function saveOpenDay(tripId: string, dayIndex: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    const map = parseOpenDayMap(localStorage.getItem(OPEN_DAY_KEY))
    if (!Number.isInteger(dayIndex) || dayIndex < NO_OPEN_DAY) return
    map[tripId] = dayIndex
    localStorage.setItem(OPEN_DAY_KEY, JSON.stringify(map))
  } catch {
    // Private mode / quota exceeded — persistence is best-effort by design.
  }
}

// ---- Review-all-days view (Timeline, #421) ----
// The Timeline's other axis: not "what may I do" (that is the global Plan/
// Inspect flag in useTimelineMode) but "which days are rendered". Stored per
// trip, exactly like the open day above, because the two are siblings — leaving
// review mode returns you to the accordion you left, and this choice never
// writes `yatraflow_open_day`. Parsed with the flat-boolean helper (same
// guards), so junk degrades to OFF — today's behaviour.
const REVIEW_ALL_KEY = 'yatraflow_review_all'

/** Is this trip being read in all-days review mode? Missing/garbage = no. */
export function loadReviewAll(tripId: string): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return parseDayCollapseMap(localStorage.getItem(REVIEW_ALL_KEY))[tripId] ?? false
  } catch {
    return false
  }
}

/** Persist the trip's view choice. Silent no-op when storage is unavailable. */
export function saveReviewAll(tripId: string, on: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    const map = parseDayCollapseMap(localStorage.getItem(REVIEW_ALL_KEY))
    map[tripId] = on
    localStorage.setItem(REVIEW_ALL_KEY, JSON.stringify(map))
  } catch {
    // Private mode / quota exceeded — persistence is best-effort by design.
  }
}

// Same map-of-booleans pattern, for long-ride hint dismissal (user chose
// "not needed" for a given day's halt suggestions; restorable).
const RIDE_HINTS_KEY = 'yatraflow_ride_hints_hidden'

/** True when the user dismissed the long-ride hints for this trip+day. */
export function loadRideHintsHidden(tripId: string, dayIndex: number): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return parseDayCollapseMap(localStorage.getItem(RIDE_HINTS_KEY))[dayCollapseKey(tripId, dayIndex)] ?? false
  } catch {
    return false
  }
}

export function saveRideHintsHidden(tripId: string, dayIndex: number, hidden: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    const map = parseDayCollapseMap(localStorage.getItem(RIDE_HINTS_KEY))
    map[dayCollapseKey(tripId, dayIndex)] = hidden
    localStorage.setItem(RIDE_HINTS_KEY, JSON.stringify(map))
  } catch {
    // best-effort
  }
}

// ---- Generic named string prefs ----
// String-valued counterpart to the flag pair: for numeric/duration-ish view
// prefs (detour-scope km, etc.) that should survive reloads. Same guards —
// missing storage or a private-mode throw degrades to the caller's fallback
// instead of crashing a useState initializer (#181).

/** Read a named string pref; missing key / unavailable storage → `fallback`. */
export function loadPref(name: string, fallback: string): string {
  if (typeof localStorage === 'undefined') return fallback
  try {
    return localStorage.getItem('yatraflow_' + name) ?? fallback
  } catch {
    return fallback
  }
}

/** Write a named string pref. Silent no-op when storage is unavailable. */
export function savePref(name: string, value: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem('yatraflow_' + name, value)
  } catch {
    // Private mode / quota exceeded — persistence is best-effort by design.
  }
}

// ---- Generic named boolean flags ----
// For one-off view prefs that don't warrant their own load/save pair. The
// storage key is `yatraflow_<name>` and the value is stored as "1"/"0" —
// a missing key (or unavailable storage) reads back as the caller's fallback.
const FLAG_KEY_PREFIX = 'yatraflow_'

/** Read a named boolean flag; missing key / unavailable storage → `fallback`. */
export function loadFlag(name: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(FLAG_KEY_PREFIX + name)
    if (raw === null) return fallback
    return raw === '1'
  } catch {
    return fallback
  }
}

/** Write a named boolean flag. Silent no-op when storage is unavailable. */
export function saveFlag(name: string, value: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(FLAG_KEY_PREFIX + name, value ? '1' : '0')
  } catch {
    // Private mode / quota exceeded — persistence is best-effort by design.
  }
}


// ---- Accepted night-halt pins (#143) — local only, never trip data ----
// An accepted night halt must not jump when an unrelated stop is added:
// "<tripId>:<nightOrdinal>" → the pinned route-km. The ordinal counts
// overnights in route order (0 = the first night halt), stable even when a
// re-split shifts derived day indices. Re-plans propose a delta when the
// derived halt drifts beyond HALT_PIN_HYSTERESIS_KM (exported by the pure
// engine, ridePlan); below that the pin wins silently. Keyed per trip +
// night so clearing a trip's pins is O(nights).
const HALT_PIN_KEY = 'yatraflow_halt_pins'

type HaltPinMap = Record<string, number>

function readHaltPins(): HaltPinMap {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(HALT_PIN_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed as HaltPinMap : {}
  } catch {
    return {} // corrupted JSON — behave as no pins, never throw
  }
}

function writeHaltPins(map: HaltPinMap): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(HALT_PIN_KEY, JSON.stringify(map)) } catch { /* best-effort */ }
}

const haltPinId = (tripId: string, dayIndex: number): string => `${tripId}:${dayIndex}`

/** The pinned route-km for one accepted night (by ordinal), null when unpinned. */
export function loadHaltPin(tripId: string, dayIndex: number): number | null {
  const v = readHaltPins()[haltPinId(tripId, dayIndex)]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** All pins for one trip, keyed by night ordinal — the bag the planner takes
 *  (#143). Returns null when the trip has none, so callers can pass it
 *  straight to planJourneyHalts as "no pins". */
export function loadHaltPinsForTrip(tripId: string): Record<number, number> | null {
  const prefix = `${tripId}:`
  const out: Record<number, number> = {}
  let any = false
  for (const [k, v] of Object.entries(readHaltPins())) {
    if (!k.startsWith(prefix) || !Number.isFinite(v)) continue
    const day = Number(k.slice(prefix.length))
    if (Number.isInteger(day) && day >= 0) { out[day] = v; any = true }
  }
  return any ? out : null
}

/** Pin an accepted night halt at its route-km (#143). dayIndex = night ordinal. */
export function saveHaltPin(tripId: string, dayIndex: number, km: number): void {
  if (!Number.isFinite(km)) return
  const map = readHaltPins()
  map[haltPinId(tripId, dayIndex)] = km
  writeHaltPins(map)
}

/** Unpin (halt removed, or the user accepts the re-derived position). */
export function clearHaltPin(tripId: string, dayIndex: number): void {
  const map = readHaltPins()
  delete map[haltPinId(tripId, dayIndex)]
  writeHaltPins(map)
}

/** Drop every pin for one trip (trip deleted, or the road re-shaped). */
export function clearHaltPinsForTrip(tripId: string): void {
  const map = readHaltPins()
  const prefix = `${tripId}:`
  let touched = false
  for (const k of Object.keys(map)) {
    if (k.startsWith(prefix)) { delete map[k]; touched = true }
  }
  if (touched) writeHaltPins(map)
}
