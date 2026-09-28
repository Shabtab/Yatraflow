// ============ dayCount — the ONE day-count computation ============
// Three copies of `round((end - start) / 86400000) + 1` (the create form, the
// starter bill, the store) could disagree about the same bad date range: the
// store guaranteed a trip ≥ 1 day while the bill printed 0, and the dock and
// the ticket could answer differently on one screen. Every copy also parsed
// `yyyy-mm-dd` with a bare `new Date(str)` — which is UTC midnight, 05:30 in
// IST — so any local-midnight writer (DateRangeCalendar.isoDay) drifts a day
// against it on an IST evening. This module is the single parse-and-count.
// (#376)
//
// Contract: LOCAL midnight (the inverse of isoDay), and 0 for missing,
// unparseable, impossible or inverted ranges — the bill semantics. The
// store's creation guarantee (a trip always has ≥ 1 day) is applied at the
// store's own boundary, visibly (`Math.max(1, …)` beside buildNewTrip), not
// hidden in here — a helper that silently coerces is how the three sites
// disagreed in the first place.

const DAY_MS = 86_400_000

/** `yyyy-mm-dd` as LOCAL midnight in ms, or null when the string is missing,
 *  malformed, or a date that does not exist (2026-02-30, month 13). A trailing
 *  time is ignored — these fields are date-only and the calendar day wins. */
export function localMidnightMs(iso: string | undefined | null): number | null {
  if (typeof iso !== 'string') return null
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(iso.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const t = new Date(y, mo - 1, d)
  // Round-trip check: `new Date(2026, 12, 1)` silently rolls into 2027, so a
  // month 13 or a Feb 30 must be refused rather than counted.
  if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return null
  return t.getTime()
}

/** Inclusive days spanned by [startIso, endIso]: 1 for a single day, 0 for a
 *  missing/invalid/inverted range. Round, not floor — a local-midnight pair
 *  can straddle a DST edge (23 h / 25 h days). */
export function dayCountForRange(startIso: string | undefined | null, endIso: string | undefined | null): number {
  const start = localMidnightMs(startIso)
  const end = localMidnightMs(endIso)
  if (start === null || end === null || end < start) return 0
  return Math.round((end - start) / DAY_MS) + 1
}
