// ============ One warning digest (#369) ============
// The Board grouped warnings by PARSING their rendered title (`/^Day (\d+):/`),
// which silently lost every warning whose title leads with a stop name (opening
// hours) and every trip-level one (accommodation churn) — and then it COUNTED
// DAYS while the copy said “route days overloaded”, so a day carrying only a
// meal or a late-arrival warning read as overloaded and a day with a commitment
// conflict could read as nothing at all. Grouping comes from the engine's own
// `dayIndex` (`groupWarnings`); this digest turns the grouped list into the
// pulse's numbers and its one honest line. Kept pure and React-free so the
// counts, the copy and the severity rank are pinned in node tests.
import { groupWarnings } from './engine'
import type { ScheduleWarning, Severity } from './engine'

/** The codes that mean the DAY ITSELF is too full to be comfortable — density,
 *  wheel/saddle fatigue and heavy travel. Everything else (late arrivals,
 *  meals, weather, opening hours, commitments, thin buffers, short nights,
 *  hotel churn) is a warning to review, never a day “overloaded”. */
export const OVERLOAD_CODES: ReadonlySet<string> = new Set(['density', 'fatigue', 'travel'])

export interface WarningDigest {
  /** warnings by the day the ENGINE says they belong to */
  byDay: Map<number, ScheduleWarning[]>
  /** warnings that belong to no day (accommodation churn) */
  tripWide: ScheduleWarning[]
  /** every warning, day-scoped and trip-wide */
  total: number
  /** days carrying at least one warning */
  dayCount: number
  /** days carrying an overload code (density / fatigue / travel) */
  overloadDays: number
  /** the pulse's one line — “3 warnings across 2 days · 1 overloaded” */
  summary: string
}

export function warningDigest(warnings: ScheduleWarning[]): WarningDigest {
  const { byDay, tripWide } = groupWarnings(warnings)
  let overloadDays = 0
  for (const list of byDay.values()) {
    if (list.some(w => OVERLOAD_CODES.has(w.code))) overloadDays++
  }
  const total = warnings.length
  const dayCount = byDay.size
  const summary = total === 0 ? ''
    : dayCount === 0 ? `${total} trip-wide warning${total === 1 ? '' : 's'}`
      : `${total} warning${total === 1 ? '' : 's'} across ${dayCount} day${dayCount === 1 ? '' : 's'}`
        + (overloadDays > 0 ? ` · ${overloadDays} overloaded` : '')
  return { byDay, tripWide, total, dayCount, overloadDays, summary }
}

/** The worst severity present, or null when there is nothing to show — the
 *  pill's class, taken from the warnings themselves, never from score cuts. */
export function worstSeverity(warnings: ScheduleWarning[]): Severity | null {
  if (warnings.length === 0) return null
  return warnings.some(w => w.severity === 'high') ? 'high'
    : warnings.some(w => w.severity === 'medium') ? 'medium' : 'low'
}

/** Hover text: one line per warning with its detail and recommended fix. */
export function warningLines(warnings: ScheduleWarning[]): string {
  return warnings.map(w => `${w.title} — ${w.detail}${w.fix ? ` (${w.fix})` : ''}`).join('\n')
}
