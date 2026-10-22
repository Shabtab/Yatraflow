// ============ Clock display preference (12h/24h) + formatting ============
// Global, persisted UI preference for how clock times are displayed. Times are
// always STORED in data as 24h "HH:MM" strings — this only changes rendering.
// Default is 12h (AM/PM), matching the audience; Profile & settings can switch
// to 24h. The store is a tiny external store (same pattern as the data store)
// so every component using useTimeFormat() re-renders on change.
import { useSyncExternalStore } from 'react'

export type TimeFormat = '12h' | '24h'

const TIME_FORMAT_KEY = 'yatraflow_time_format'
let currentFormat: TimeFormat = readStoredFormat()
const listeners = new Set<() => void>()

function readStoredFormat(): TimeFormat {
  if (typeof localStorage === 'undefined') return '12h'
  try {
    return localStorage.getItem(TIME_FORMAT_KEY) === '24h' ? '24h' : '12h'
  } catch {
    return '12h'
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Current preference without subscribing (for non-React code). */
export function getTimeFormat(): TimeFormat {
  return currentFormat
}

/** Set the preference globally, persist it, and re-render all consumers. */
export function setTimeFormat(fmt: TimeFormat): void {
  if (fmt === currentFormat) return
  currentFormat = fmt
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TIME_FORMAT_KEY, fmt)
  } catch { /* best-effort persistence */ }
  for (const fn of listeners) fn()
}

/** React hook — the current time format, re-rendering on change. */
export function useTimeFormat(): TimeFormat {
  // same snapshot for server render — the module value is deterministic
  return useSyncExternalStore(subscribe, getTimeFormat, getTimeFormat)
}

/**
 * Format one "HH:MM" clock string for display. Invalid/empty input comes back
 * unchanged, so '--:--' placeholders and '' pass through untouched.
 *  12h: "18:30" → "6:30 PM", "00:15" → "12:15 AM", "12:00" → "12:00 PM"
 *  24h: normalized zero-padded "18:30"
 */
export function formatHM(hm: string, fmt: TimeFormat): string {
  if (!hm || !hm.includes(':')) return hm
  const [hStr, mStr] = hm.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 47 || m < 0 || m > 59) return hm
  if (fmt === '24h') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const h12 = h % 24
  const suffix = h12 < 12 ? 'AM' : 'PM'
  let hour = h12 % 12
  if (hour === 0) hour = 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/**
 * Gate a stored clock string. Returns the value when it is a real wall-clock
 * "HH:MM" (00:00–23:59, zero-padded), else undefined.
 *
 * This is stricter than `formatHM`, which tolerates 24h+ hours so an overnight
 * span can render. A departure time is a time of day, not a span: a "25:99"
 * written into `days[].startTime` would be clamped by `hmToMinutes` into a
 * schedule nobody chose, so it never reaches the data.
 */
export function validHM(hm: string | undefined): string | undefined {
  if (typeof hm !== 'string') return undefined
  const trimmed = hm.trim()
  const m = /^(\d{2}):(\d{2})$/.exec(trimmed)
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return undefined
  return trimmed
}

/** Format an "open–close" pair (either side may be empty/undefined — skipped). */
export function formatHMRange(a: string | undefined, b: string | undefined, fmt: TimeFormat): string {
  const aS = a ?? ''
  const bS = b ?? ''
  if (!aS && !bS) return ''
  if (!aS || !bS) return formatHM(aS || bS, fmt)
  return `${formatHM(aS, fmt)}–${formatHM(bS, fmt)}`
}
