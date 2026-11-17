// Group input: pure view helpers for the closing-time, day and crew quiz UI.
//
// The server is the authority for every rule the screen shows. These helpers
// only turn data into the words and numbers on the page, so a node test can
// pin them without a DOM.

import { STOP_CATEGORIES, type CrewInterest, type DecisionOption, type ID, type TripDecision } from '../data/types'
import type { CrewInterestSummary } from './crewPreferences'
import { voteOutcome } from './decisionClock'
import { DAY_MS } from './dayCount'
import { formatHM, type TimeFormat } from './timefmt'

/** Categories that name a logistics need, not an interest. The crew quiz leaves
 *  them out: a hotel or a transport hub is not something a member "wants more of". */
export const QUIZ_EXCLUDED_CATEGORIES: readonly string[] = ['hotel', 'transport-hub', 'travel', 'event']

/** The interests the quiz offers, in the standard order. */
export const CREW_QUIZ_INTERESTS: readonly CrewInterest[] = STOP_CATEGORIES.filter(
  c => !QUIZ_EXCLUDED_CATEGORIES.includes(c),
)

/** "Day 2 · Munnar", or "Day 2" when the day has no title. */
export function dayOptionLabel(day: { index: number; title?: string }): string {
  return `Day ${day.index + 1}${day.title ? ` · ${day.title}` : ''}`
}

/** The label of the day a decision names, or null when it names none or the day
 *  is no longer on the trip. */
export function decisionDayLabel(days: ReadonlyArray<{ id: ID; index: number; title?: string }>, dayId: ID | undefined): string | null {
  if (!dayId) return null
  const day = days.find(d => d.id === dayId)
  return day ? dayOptionLabel(day) : null
}

export type ClosesAtCheck =
  | { ok: true; closesAt?: number }
  | { ok: false; reason: 'invalid' | 'past' }

/** Read the value of a datetime-local field. It has no zone, so it means the
 *  device's local time. Empty means no closing time. A time that is not in the
 *  future is refused. */
export function parseClosesAt(raw: string, now: number): ClosesAtCheck {
  const value = raw.trim()
  if (value === '') return { ok: true }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return { ok: false, reason: 'invalid' }
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return { ok: false, reason: 'invalid' }
  if (ms <= now) return { ok: false, reason: 'past' }
  return { ok: true, closesAt: ms }
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The line a decision shows after its closing time, from the tally. */
export function votingClosedLine(d: Pick<TripDecision, 'options' | 'votesByUserId'>): string {
  const outcome = voteOutcome(d)
  if (outcome.kind === 'noVotes') return 'Voting closed · no votes'
  if (outcome.kind === 'winner') return `Voting closed · ${outcome.option.label} leads`
  return `Voting closed · tie between ${joinNames(outcome.options.map((o: DecisionOption) => o.label))}`
}

/** Why a label is refused, in words for the field. */
export function optionLabelRefusal(reason: 'empty' | 'too long' | 'duplicate' | 'too many options'): string {
  switch (reason) {
    case 'empty': return 'Write the option first.'
    case 'too long': return 'Shorten the option to 200 characters.'
    case 'duplicate': return 'This decision already has that option.'
    case 'too many options': return 'This decision has the most options it can hold.'
  }
}

export interface CrewBar { interest: CrewInterest; picks: number; percent: number }

/** The bars of the crew card: only interests with at least one pick, high to
 *  low, ties in the standard order. The percent is the share of members who
 *  answered. */
export function crewBars(summary: CrewInterestSummary): CrewBar[] {
  return STOP_CATEGORIES
    .filter(interest => summary.picks[interest] > 0)
    .map(interest => ({ interest, picks: summary.picks[interest], percent: Math.round(summary.shares[interest] * 100) }))
    .sort((a, b) => b.picks - a.picks)
}

/** The closing time as the reader's clock shows it: weekday and time, honouring
 *  12h or 24h ("Thu 20:00"). A time six or more days away also names the date. */
export function closingStamp(ms: number, fmt: TimeFormat, now: number): string {
  const d = new Date(ms)
  const hm = formatHM(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, fmt)
  const day = d.toLocaleDateString('en-IN', ms - now >= 6 * DAY_MS
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { weekday: 'short' })
  return `${day.replace(',', '')} ${hm}`
}

/** A local "YYYY-MM-DDTHH:mm" value for a datetime-local input, for example its `min`. */
export function localInputValue(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** True when two interest lists hold the same interests, in any order. */
export function sameInterests(a: readonly CrewInterest[], b: readonly CrewInterest[]): boolean {
  return a.length === b.length && a.every(i => b.includes(i))
}
