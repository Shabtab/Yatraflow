// ============ Overview warning presentation rules (#401) ============
// One ordering, one identity, one tone for the Overview's warning rows.
//
// Both "top 3" lists on the page used to disagree — priority-actions sorted by
// severity while health-reasons printed raw emission order — so the fix is a
// single rank both lists read. Keys are data (`code` + `dayIndex` + `title`),
// never the rendered title: two same-named commitments on different days must
// mount as two rows. Tone follows the severest warning present, so an all-low
// trip does not wear the alarm chip.
import type { ScheduleWarning, Severity } from './engine'

export const warningSeverityRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

/**
 * Both Overview lists read this ordering, so "what needs attention" cannot
 * disagree with itself. Stable: warnings inside one band keep emission order.
 */
export function rankWarnings(warnings: readonly ScheduleWarning[]): ScheduleWarning[] {
  return [...warnings].sort((a, b) => warningSeverityRank[a.severity] - warningSeverityRank[b.severity])
}

/**
 * Stable row identity. `dayIndex` is attached by the producer because `title`
 * is a display string (#402) — parsing "Day N:" out of it lost warnings once
 * already. Trip-wide rows share the `trip` bucket with legacy rows that predate
 * the field; code + title keep those distinct.
 */
export function warningKey(w: ScheduleWarning): string {
  return `${w.code}:${w.dayIndex ?? 'trip'}:${w.title}`
}

/** The severest band present, or null when there is nothing to tone. */
export function maxWarningSeverity(warnings: readonly ScheduleWarning[]): Severity | null {
  let best: Severity | null = null
  for (const w of warnings) {
    if (best === null || warningSeverityRank[w.severity] < warningSeverityRank[best]) best = w.severity
  }
  return best
}

/** Screen-reader lead-in: severity is icon-only on screen, so it is said aloud. */
export function severityLead(severity: Severity): string {
  return severity === 'high' ? 'High severity:' : severity === 'medium' ? 'Medium severity:' : 'Low severity:'
}
