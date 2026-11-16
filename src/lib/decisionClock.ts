// Decision closing time: pure helpers.
//
// A decision can carry a closing time (`closesAt`, epoch milliseconds). After
// that moment the SERVER refuses every ballot, ballot change and new option
// (supabase/migrations/20261117_group_input_phase2.sql). These helpers only
// describe that state for the screen. They never decide for the server, and
// nothing here resolves a decision: an editor applies the winner through the
// resolve path, and a tie stays open for the editor to choose.

import type { DecisionOption, TripDecision } from '../data/types'

type ClockDecision = Pick<TripDecision, 'closesAt'>
type TallyDecision = Pick<TripDecision, 'options' | 'votesByUserId'>

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A closing time the server would honour: a finite, positive number. */
export function hasClosingTime(d: ClockDecision): boolean {
  return typeof d.closesAt === 'number' && Number.isFinite(d.closesAt) && d.closesAt > 0
}

/** True once the closing time has passed. The server uses the same boundary:
 *  a vote at exactly `closesAt` is already late. A decision with no closing
 *  time is never closed by the clock. */
export function isVoteClosed(d: ClockDecision, now: number): boolean {
  return hasClosingTime(d) && now >= (d.closesAt as number)
}

/** The decision still takes ballots and new options: it is open and its closing
 *  time, if any, has not passed. */
export function isVoteOpen(d: Pick<TripDecision, 'status' | 'closesAt'>, now: number): boolean {
  return d.status === 'open' && !isVoteClosed(d, now)
}

/** A short span, for example "less than 1 min", "42 min", "2 h 5 min", "3 d 4 h". */
export function formatSpan(ms: number): string {
  const span = Math.max(0, ms)
  if (span < MINUTE) return 'less than 1 min'
  if (span < HOUR) return `${Math.floor(span / MINUTE)} min`
  if (span < DAY) {
    const hours = Math.floor(span / HOUR)
    const minutes = Math.floor((span % HOUR) / MINUTE)
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  }
  const days = Math.floor(span / DAY)
  const hours = Math.floor((span % DAY) / HOUR)
  return hours > 0 ? `${days} d ${hours} h` : `${days} d`
}

/** The line that tells the crew where the clock stands. Null when there is
 *  nothing to say: no closing time, or the decision is already resolved. */
export function closingLabel(d: Pick<TripDecision, 'status' | 'closesAt'>, now: number): string | null {
  if (d.status === 'resolved' || !hasClosingTime(d)) return null
  const closesAt = d.closesAt as number
  if (now < closesAt) return `Voting closes in ${formatSpan(closesAt - now)}`
  const late = now - closesAt
  return late < MINUTE ? 'Voting closed just now' : `Voting closed ${formatSpan(late)} ago`
}

/** Votes per option id. A ballot for an option that is not on the decision
 *  counts for nothing, so a stale id cannot add to the total. */
export function tallyVotes(d: TallyDecision): { counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {}
  for (const option of d.options) counts[option.id] = 0
  let total = 0
  for (const optionId of Object.values(d.votesByUserId)) {
    if (!Object.prototype.hasOwnProperty.call(counts, optionId)) continue
    counts[optionId] += 1
    total += 1
  }
  return { counts, total }
}

/** The options with the most votes, in the decision's own order. Empty when
 *  nobody has voted. More than one entry means a tie. */
export function leadingOptions(d: TallyDecision): DecisionOption[] {
  const { counts, total } = tallyVotes(d)
  if (total === 0) return []
  const top = Math.max(...d.options.map(o => counts[o.id]))
  return d.options.filter(o => counts[o.id] === top)
}

/** Two or more options share the top count. */
export function isTie(d: TallyDecision): boolean {
  return leadingOptions(d).length > 1
}

export type VoteOutcome =
  | { kind: 'noVotes' }
  | { kind: 'winner'; option: DecisionOption; votes: number }
  | { kind: 'tie'; options: DecisionOption[]; votes: number }

/** What the tally says right now. A tie names every tied option, because the
 *  editor chooses among them. */
export function voteOutcome(d: TallyDecision): VoteOutcome {
  const leaders = leadingOptions(d)
  if (leaders.length === 0) return { kind: 'noVotes' }
  const { counts } = tallyVotes(d)
  const votes = counts[leaders[0].id]
  return leaders.length === 1
    ? { kind: 'winner', option: leaders[0], votes }
    : { kind: 'tie', options: leaders, votes }
}
