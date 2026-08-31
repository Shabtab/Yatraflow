// ============ UI preference persistence (localStorage) ============
// Small, failure-tolerant helpers for UI state that should survive reloads but
// is NOT part of the trip data model (so it stays out of Supabase/snapshots).
// Pure parsing lives in parseDayCollapseMap so it can be unit-tested in node
// (no DOM/localStorage), while the load/save wrappers guard for environments
// where localStorage is missing or throws (private mode, quota, corrupted JSON).

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
