// Crew preferences: pure helpers for the crew quiz.
//
// Each trip member answers once per trip: which interests they want on this
// trip. The interest set is STOP_CATEGORIES. A member with no row has not
// answered. That is not a "no", so the summary reports how many answered and
// divides by that number only.

import { STOP_CATEGORIES, type CrewInterest, type CrewPreference, type ID } from '../data/types'

/** The interests a member can pick, in display order. */
export const CREW_INTERESTS: readonly CrewInterest[] = STOP_CATEGORIES

export function isCrewInterest(value: unknown): value is CrewInterest {
  return typeof value === 'string' && (CREW_INTERESTS as readonly string[]).includes(value)
}

/** Turn a picked list into the stored list: no duplicates, in the canonical
 *  order. Returns null when any entry is not a known interest, so a bad value
 *  is refused and never dropped without a word. */
export function normalizeInterests(input: readonly unknown[]): CrewInterest[] | null {
  if (!Array.isArray(input)) return null
  const picked = new Set<string>()
  for (const entry of input) {
    if (!isCrewInterest(entry)) return null
    picked.add(entry)
  }
  return CREW_INTERESTS.filter(interest => picked.has(interest))
}

export interface CrewInterestSummary {
  /** Members who answered. Each has one row, even when it is an empty list. */
  answered: number
  /** Current members of the trip, when the caller passed `memberIds`; else null. */
  members: number | null
  /** How many answered members picked each interest. */
  picks: Record<CrewInterest, number>
  /** Share of ANSWERED members who picked each interest, from 0 to 1. Every
   *  share is 0 when nobody answered. */
  shares: Record<CrewInterest, number>
}

function zeroed(): Record<CrewInterest, number> {
  const out = {} as Record<CrewInterest, number>
  for (const interest of CREW_INTERESTS) out[interest] = 0
  return out
}

/** Turn the rows into the figures behind the bars.
 *
 *  - `tripId` keeps rows of one trip. Pass it whenever the list may hold more.
 *  - `memberIds` keeps rows of current members. A member who left the trip
 *    does not count, and `members` reports the size of this list.
 *  - One row per member counts. If a list holds two rows for the same member,
 *    the newer `updatedAt` wins.
 *  - A row can hold an interest this app does not know (a later version wrote
 *    it). That row still counts as answered. The unknown entry is not counted. */
export function summarizeCrewPreferences(
  rows: readonly CrewPreference[],
  opts: { tripId?: ID; memberIds?: readonly ID[] } = {},
): CrewInterestSummary {
  const allowed = opts.memberIds ? new Set(opts.memberIds) : null
  const latest = new Map<string, CrewPreference>()
  for (const row of rows) {
    if (opts.tripId !== undefined && row.tripId !== opts.tripId) continue
    if (allowed && !allowed.has(row.userId)) continue
    const key = `${row.tripId}:${row.userId}`
    const seen = latest.get(key)
    if (!seen || row.updatedAt >= seen.updatedAt) latest.set(key, row)
  }
  const picks = zeroed()
  for (const row of latest.values()) {
    const own = new Set<string>(row.interests)
    for (const interest of CREW_INTERESTS) if (own.has(interest)) picks[interest] += 1
  }
  const answered = latest.size
  const shares = zeroed()
  if (answered > 0) for (const interest of CREW_INTERESTS) shares[interest] = picks[interest] / answered
  return { answered, members: allowed ? allowed.size : null, picks, shares }
}

/** The signed-in member's own row for one trip. */
export function myCrewPreference(rows: readonly CrewPreference[], tripId: ID, userId: ID): CrewPreference | undefined {
  return rows.find(r => r.tripId === tripId && r.userId === userId)
}

/** Insert or replace one row. The list order stays stable. */
export function upsertCrewPreference(rows: readonly CrewPreference[], next: CrewPreference): CrewPreference[] {
  const index = rows.findIndex(r => r.tripId === next.tripId && r.userId === next.userId)
  if (index < 0) return [...rows, next]
  const copy = [...rows]
  copy[index] = next
  return copy
}

export function removeCrewPreference(rows: readonly CrewPreference[], tripId: ID, userId: ID): CrewPreference[] {
  return rows.filter(r => !(r.tripId === tripId && r.userId === userId))
}

/** Replace every row of one trip with a fresh read, and leave other trips alone. */
export function replaceTripPreferences(rows: readonly CrewPreference[], tripId: ID, fresh: readonly CrewPreference[]): CrewPreference[] {
  return [...rows.filter(r => r.tripId !== tripId), ...fresh.filter(r => r.tripId === tripId)]
}
