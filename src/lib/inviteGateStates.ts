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
 * #804 — the join flow as ONE state machine.
 *
 * Five Gate rounds each found another place where the flow kept its own copy of
 * "have we joined yet": a bare ref, then a settled flag, then a reducer whose
 * retry action was dropped on the floor. The fix is to give the flow a single
 * owner of its state, and to make every continuation carry the identity it
 * started under so a late answer cannot land on someone else's screen.
 *
 *   idle             nothing has been tried for this account.
 *   joining          the join RPC is in flight.
 *   loading          the membership exists; the full row is being read.
 *   joined           joined AND the row is cached. The only state that opens
 *                    the trip.
 *   joined-unloaded  the membership exists but the row did not load. A retry
 *                    must re-read, never join again.
 *   failed           no membership was created. A retry must join again.
 *   abandoned        the try outlived its account. It does nothing.
 *
 * Every event carries `userId` and `gen` (the store's identity generation).
 * A continuation also carries the try id it was started with. An event
 * is applied only when all three still match, so:
 *   - a sign-out, a sign-in, or a profile gap bumps `gen` and resets the machine;
 *   - a late join answer from account A cannot settle account B's state;
 *   - a retry issues exactly one new join, because it moves the phase itself
 *     instead of asking a later effect to notice.
 */
export type JoinPhase = 'idle' | 'joining' | 'loading' | 'joined' | 'joined-unloaded' | 'failed' | 'abandoned'

export interface JoinState {
  phase: JoinPhase
  /** The account this state belongs to; null before anyone is known. */
  userId: string | null
  /** The identity generation this state belongs to. */
  gen: number
  /** Monotonic id of the current try. Continuations must quote it back. */
  tryId: number
}

/** What the caller must do in response to an event. */
export type JoinAction =
  | { type: 'none' }
  | { type: 'join'; tryId: number }
  | { type: 'reload'; tryId: number }

export interface JoinPlan {
  state: JoinState
  action: JoinAction
}

export const initialJoinState: JoinState = { phase: 'idle', userId: null, gen: -1, tryId: 0 }

export type JoinEvent =
  /** The gate is ready for this account: start a join if nothing is in flight. */
  | { type: 'begin'; userId: string; gen: number; member: boolean }
  /** The user pressed Try again. Rejoins after 'failed', re-reads after 'joined-unloaded'. */
  | { type: 'retry'; userId: string; gen: number; member: boolean }
  /** A join RPC answered. Ignored unless it quotes the live try. */
  | { type: 'join-settled'; userId: string; gen: number; tryId: number; result: JoinResult }
  /** A full-row read answered. Ignored unless it quotes the live try. */
  | { type: 'reload-settled'; userId: string; gen: number; tryId: number; result: JoinResult }

/** The result of a join or a reload, as the store reports it. */
export type JoinResult = 'joined' | 'joined-unloaded' | 'failed' | 'abandoned'

/** True when the event belongs to the live try. */
function isCurrent(state: JoinState, e: { userId: string; gen: number }): boolean {
  return state.userId === e.userId && state.gen === e.gen
}

/** A continuation is live only when it also quotes the try id. */
function isCurrentTry(state: JoinState, e: { userId: string; gen: number; tryId: number }): boolean {
  return isCurrent(state, e) && state.tryId === e.tryId
}

/**
 * The reducer. Pure and total: every event yields a state and an action, so the
 * tests execute the same transitions the app runs.
 */
export function joinMachine(state: JoinState, event: JoinEvent): JoinPlan {
  const none = (s: JoinState): JoinPlan => ({ state: s, action: { type: 'none' } })

  switch (event.type) {
    case 'begin': {
      // B-1 — `begin` decides the ACTION itself, because it is the only place
      // that knows whether this caller is already a member. The earlier shape
      // moved the machine to 'joining' and left App to dispatch a second event
      // to correct it; that event answered 'none' and a member who re-clicked a
      // link sat on "Joining…" forever. One event, one decision.
      if (!isCurrent(state, event)) {
        const phase: JoinPhase = event.member ? 'loading' : 'joining'
        const fresh: JoinState = { phase, userId: event.userId, gen: event.gen, tryId: state.tryId + 1 }
        return { state: fresh, action: event.member
          ? { type: 'reload', tryId: fresh.tryId }
          : { type: 'join', tryId: fresh.tryId } }
      }
      // Same account: a join in flight, a load in flight, or an already-joined
      // trip does nothing. This is what makes StrictMode's double fire one join.
      if (state.phase === 'joining' || state.phase === 'loading' || state.phase === 'joined') return none(state)
      // Item 5 — 'failed' and 'abandoned' are TERMINAL until the user retries.
      // A later effect re-run (me/trip identity changing on a hydrate) must not
      // silently rejoin after a failure the user has already seen.
      if (state.phase === 'failed' || state.phase === 'abandoned') return none(state)
      // 'joined-unloaded' is also waiting for the user.
      if (state.phase === 'joined-unloaded') return none(state)
      const phase: JoinPhase = event.member ? 'loading' : 'joining'
      const fresh: JoinState = { ...state, phase, tryId: state.tryId + 1 }
      return { state: fresh, action: event.member
        ? { type: 'reload', tryId: fresh.tryId }
        : { type: 'join', tryId: fresh.tryId } }
    }

    case 'retry': {
      // The retry is bound to the account that is signed in NOW.
      if (!isCurrent(state, event)) {
        const phase: JoinPhase = event.member ? 'loading' : 'joining'
        const fresh: JoinState = { phase, userId: event.userId, gen: event.gen, tryId: state.tryId + 1 }
        return { state: fresh, action: event.member
          ? { type: 'reload', tryId: fresh.tryId }
          : { type: 'join', tryId: fresh.tryId } }
      }
      // A member (or a trip whose membership is known) re-reads; it never joins
      // again, so a retry cannot write a second membership row.
      if (event.member || state.phase === 'joined-unloaded') {
        const next: JoinState = { ...state, phase: 'loading', tryId: state.tryId + 1 }
        return { state: next, action: { type: 'reload', tryId: next.tryId } }
      }
      if (state.phase === 'joining' || state.phase === 'loading') return none(state)
      // 'failed', 'abandoned', 'idle' and 'joined' all rejoin. 'joined' cannot
      // normally be retried (it navigates), and rejoining it is harmless.
      const next: JoinState = { ...state, phase: 'joining', tryId: state.tryId + 1 }
      return { state: next, action: { type: 'join', tryId: next.tryId } }
    }

    case 'join-settled': {
      // A late answer from a previous account, or for a superseded tryId,
      // must not touch this state.
      if (!isCurrentTry(state, event)) return none(state)
      return { state: { ...state, phase: phaseFor(event.result) }, action: { type: 'none' } }
    }

    case 'reload-settled': {
      if (!isCurrentTry(state, event)) return none(state)
      // A reload can never claim a join it did not make: 'abandoned' stays
      // abandoned, and a 'failed' reload means the row could not be read, which
      // for a caller who is already a member is 'joined-unloaded'.
      const phase: JoinPhase = event.result === 'joined' ? 'joined'
        : event.result === 'abandoned' ? 'abandoned'
        : 'joined-unloaded'
      return { state: { ...state, phase }, action: { type: 'none' } }
    }
  }
}

function phaseFor(result: JoinResult): JoinPhase {
  if (result === 'joined') return 'joined'
  if (result === 'joined-unloaded') return 'joined-unloaded'
  if (result === 'abandoned') return 'abandoned'
  return 'failed'
}

/** True when the machine says the trip may be opened. */
export function joinAllowsNavigation(state: JoinState): boolean {
  return state.phase === 'joined'
}

/** True when the screen must offer a Try again. */
export function joinOffersRetry(state: JoinState): boolean {
  return state.phase === 'joined-unloaded' || state.phase === 'failed' || state.phase === 'abandoned'
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