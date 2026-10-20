// P6 Invite gate and shared snapshot: the honesty of their branches (R23).
//
// The gate resolves one link to one trip, and every way that resolution can end
// is a different answer. A read that failed is not a link that is dead, and a
// link that is dead is not a read that failed. `App.tsx` imports these, so the
// rules below are the ones it follows.

/** The state of the invite gate's link resolution.
 *  - `loading` while the read is in flight.
 *  - `failed` when the read itself failed: a dropped connection, or a decode
 *    that threw. The link may be fine, so the only honest remedy is to retry.
 *  - `expired` when the read succeeded and answered "no such code". The link is
 *    dead, and a retry changes nothing.
 *  - `ready` when the read succeeded and returned a trip.
 *  - `joining` while a confirmed member's join is written.
 *  `failed` and `expired` are separate states on purpose: showing one as the
 *  other tells the user something the page does not know. */
export type InviteGateState = 'loading' | 'failed' | 'expired' | 'ready' | 'joining'

/** The gate's state from what the read returned.
 *  - A thrown or rejected read is `failed`, whatever else is true.
 *  - A read that answered with no trip is `expired`: the server said no, which
 *    is an answer, not a failure.
 *  - A read that returned a trip is `ready`. */
export function inviteGateState(read: { loading: boolean; failed: boolean; trip: unknown }): InviteGateState {
  if (read.failed) return 'failed'
  if (read.loading) return 'loading'
  if (read.trip == null) return 'expired'
  return 'ready'
}

/**
 * #804 (B1) — what the gate does after it tries to join.
 *
 * Three outcomes, three different screens, never shown as one another (R23):
 *   'navigate'  joined AND the full row is loaded. Open the trip.
 *   'unloaded'  the membership EXISTS but the row did not load. Stay on the gate
 *               and offer a retry that re-reads the row ONLY; joining again would
 *               write a second membership row and notify the owner twice.
 *   'failed'    no membership was created. Stay on the gate and offer a try
 *               that runs the join again.
 *
 * `reload` is the retry action for 'unloaded' and `rejoin` for 'failed', so the
 * caller cannot accidentally offer the wrong remedy.
 */
export type InviteJoinOutcome = 'navigate' | 'unloaded' | 'failed' | 'abandoned'

export function inviteJoinOutcome(result: 'joined' | 'joined-unloaded' | 'failed' | 'abandoned'): {
  outcome: InviteJoinOutcome
  retry: 'reload' | 'rejoin' | 'none'
} {
  if (result === 'joined') return { outcome: 'navigate', retry: 'none' }
  if (result === 'joined-unloaded') return { outcome: 'unloaded', retry: 'reload' }
  // An abandoned continuation belongs to a previous account. The new account's
  // own try starts fresh, so this one does nothing at all.
  if (result === 'abandoned') return { outcome: 'abandoned', retry: 'none' }
  return { outcome: 'failed', retry: 'rejoin' }
}

/**
 * #804 (B1/B2b) — the join try, bound to ONE account.
 *
 * `joinedRef` was a bare boolean, which caused two bugs: a retry after a failed
 * join could never issue a second join (the guard was still set), and the guard
 * survived an account switch, so a new user inherited the previous user's
 * "already joined" claim.
 *
 * This state replaces it. Every field is per-account: `userId` names the owner,
 * and an event carrying a different id resets the whole thing. `settled` is null
 * while a join is in flight, which is what keeps StrictMode's double effect fire
 * to a single join.
 */
export interface InviteAttempt {
  userId: string
  /** How many joins have been started for this account. */
  issued: number
  /** The last settled result, or null while in flight. */
  settled: 'joined' | 'joined-unloaded' | 'failed' | 'abandoned' | null
}

export type InviteAttemptEvent =
  | { type: 'begin'; userId: string }
  | { type: 'settle'; userId: string; result: 'joined' | 'joined-unloaded' | 'failed' | 'abandoned' }
  | { type: 'retry-failed'; userId: string }
  | { type: 'retry-unloaded'; userId: string }

export interface InviteAttemptPlan {
  state: InviteAttempt
  /** What the caller must do now: start a join, re-read the row, or nothing. */
  action: 'join' | 'reload' | 'none'
}

/**
 * The join reducer. Pure, so every transition is executable in a test.
 *
 *   begin           issue a join once per account; a second begin while one is
 *                   in flight does nothing (StrictMode), and a settled try
 *                   does nothing until a retry.
 *   settle          records the result, but ONLY for the account that owns the
 *                   try: a late answer from a previous account is dropped.
 *   retry-failed    clears the settled result and issues another join.
 *   retry-unloaded  clears the settled result and re-reads the row. It never
 *                   joins again, so a retry cannot write a second membership
 *                   row or notify the owner twice.
 */
export function inviteAttempt(
  previous: InviteAttempt | null,
  event: InviteAttemptEvent,
): InviteAttemptPlan {
  const owns = previous !== null && previous.userId === event.userId
  switch (event.type) {
    case 'begin': {
      if (!owns) return { state: { userId: event.userId, issued: 1, settled: null }, action: 'join' }
      // Already in flight, or already settled: nothing to do.
      return { state: previous!, action: 'none' }
    }
    case 'settle': {
      // A stale continuation from another account must not touch this one.
      if (!owns) return { state: previous!, action: 'none' }
      return { state: { ...previous!, settled: event.result }, action: 'none' }
    }
    case 'retry-failed': {
      if (!owns) return { state: { userId: event.userId, issued: 1, settled: null }, action: 'join' }
      return { state: { ...previous!, issued: previous!.issued + 1, settled: null }, action: 'join' }
    }
    case 'retry-unloaded': {
      if (!owns) return { state: { userId: event.userId, issued: 1, settled: null }, action: 'reload' }
      return { state: { ...previous!, settled: null }, action: 'reload' }
    }
  }
}

/** The state of the shared snapshot's decode.
 *  - `loading` while the payload is unpacked.
 *  - `failed` when the decode threw. A snapshot travels inside the link, so a
 *    truncated link and a browser without DecompressionStream both land here.
 *  - `ready` when the payload decoded to a trip. */
export function sharedSnapshotState(read: { loading: boolean; failed: boolean; trip: unknown }): 'loading' | 'failed' | 'ready' {
  if (read.failed) return 'failed'
  if (read.loading) return 'loading'
  if (read.trip == null) return 'failed'
  return 'ready'
}

/** The route an auth round-trip must return to. A trip-id link and a short-code
 *  link park differently, and the `next` parameter carries the parked route
 *  back through login. This is the load-bearing round-trip: change it and a
 *  user who logs in lands on My Trips instead of the invite they opened. */
export function inviteAuthRoute(codeOrTripId: string, isTripIdLink: boolean): string {
  return isTripIdLink ? `/invite/${codeOrTripId}` : `/join/${codeOrTripId}`
}

/** The `next` parameter for the log in button. */
export function inviteLoginNext(codeOrTripId: string, isTripIdLink: boolean): string {
  return `/auth?next=${encodeURIComponent(inviteAuthRoute(codeOrTripId, isTripIdLink))}`
}

/** The `next` parameter for the create account button. It keeps the signup mode
 *  and the same parked route. */
export function inviteSignupNext(codeOrTripId: string, isTripIdLink: boolean): string {
  return `/auth?mode=signup&next=${encodeURIComponent(inviteAuthRoute(codeOrTripId, isTripIdLink))}`
}

/** The small trip preview a signed-out invite shows, from data the gate already
 *  holds. No field is read a second time to fill this in. */
export function invitePreview(trip: {
  name: string
  startDate?: string | null
  days?: unknown[] | null
  destinations?: string[] | null
  members?: unknown[] | null
}): { name: string; route: string; dates: string; memberCount: number } {
  const dayCount = trip.days?.length ?? 0
  const route = (trip.destinations ?? []).filter(Boolean).join(' \u00b7 ')
  const dates = trip.startDate && dayCount > 0 ? `${trip.startDate} \u00b7 ${dayCount} ${dayCount === 1 ? 'day' : 'days'}` : ''
  return {
    name: trip.name,
    route,
    dates,
    memberCount: trip.members?.length ?? 0,
  }
}
