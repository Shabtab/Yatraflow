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

/** Why a join or a full-row read ended without a usable trip. The kinds stay
 *  distinct so the screen can name the actual problem:
 *  - `not-member`: the server says this account is not on the trip.
 *  - `missing`: the trip row does not exist.
 *  - `deleted`: the trip is in the trash.
 *  - `incomplete`: the row arrived in a shape this client cannot trust.
 *  - `failed`: the read itself failed. */
export type JoinRefusal = 'not-member' | 'missing' | 'deleted' | 'incomplete' | 'failed'

export interface JoinState {
  phase: JoinPhase
  /** The account this state belongs to; null before anyone is known. */
  userId: string | null
  /** The identity generation this state belongs to. */
  gen: number
  /** Monotonic id of the current try. Continuations must quote it back. */
  tryId: number
  /** The typed refusal behind a failed or unloaded result; null otherwise. */
  reason: JoinRefusal | null
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

export const initialJoinState: JoinState = { phase: 'idle', userId: null, gen: -1, tryId: 0, reason: null }

/**
 * A monotonic try id. Module-level on purpose: React state and refs are reset
 * by a remount, so two mounts could hand out the same id and a retired
 * completion would settle the new mount (round-8 B3). This counter never resets.
 */
let attemptSequence = 0
export function nextAttemptId(): number {
  attemptSequence += 1
  return attemptSequence
}

/**
 * The gate's narrow lifetime owner. It lives outside React reset and is retired
 * explicitly, BEFORE the component clears visible state, so a continuation that
 * outlives its mount can do nothing at all rather than acting on a retired
 * try. It does not read auth state and it does not touch `identityEpoch`.
 */
export interface AttemptOwner {
  readonly id: number
  retired: boolean
  /** The normalized link target this try belongs to. A try from one target
   *  must not settle, load or navigate another. */
  readonly target?: string
}
export function createAttemptOwner(target?: string): AttemptOwner {
  return { id: nextAttemptId(), retired: false, target }
}
/** Retire first, clear state second. Never the other order. */
export function retireAttemptOwner(owner: AttemptOwner): void {
  owner.retired = true
}
export function attemptOwnerLive(owner: AttemptOwner): boolean {
  return !owner.retired
}
/** True while this try is live AND still owns the target it started under. */
export function ownedBy(owner: AttemptOwner | null, target: string): boolean {
  return !!owner && attemptOwnerLive(owner) && owner.target === target
}

interface GateMachineStore {
  machine: JoinState
  owner: AttemptOwner | null
  readonly mountId: number
  readonly target: string
  /** bumped on every change, so a subscriber can tell the states apart */
  version: number
}
const gateMachineStores = new Map<string, GateMachineStore>()
/** The newest store for one target, whichever mount it belongs to. */
const latestGateStores = new Map<string, GateMachineStore>()
const gateMountTargets = new Map<number, string>()
const gateMachineListeners = new Set<() => void>()

/** The gate's machine for a target, for a test reader. Undefined if no mount
 *  has asked for that target yet. */
export function gateMachineState(target: string): GateMachineStore | undefined {
  return latestGateStores.get(target)
}

/** Subscribe to the gate's machine changes (the component's external store). */
export function subscribeGateState(fn: () => void): () => void {
  gateMachineListeners.add(fn)
  return () => { gateMachineListeners.delete(fn) }
}

/**
 * The version of this target's machine, read by `useSyncExternalStore`.
 *
 * It must NOT create the store: React can read the previous target's snapshot
 * once more after a change, and creating a store retires the other target's
 * try. A read is so a pure lookup of the version map.
 */
export function gateMachineVersion(target: string, mountId = 0): number {
  return gateMachineVersions.get(mountId + "|" + target) ?? 0
}
const gateMachineVersions = new Map<string, number>()

function notifyGateState(): void {
  for (const fn of gateMachineListeners) fn()
}

/**
 * #804 (round 10 B4) — the gate's join state for ONE link target.
 *
 * A target change must retire the old try and reset the machine BEFORE any event
 * reaches the new target: the next 'begin' reads this state first, and an effect
 * runs too late to clear it. So each target keeps its own machine in a module
 * store, and a render asks for its own target. A new target retires every other
 * target's live try in the same call.
 *
 * This function is pure state access, not a hook: the component keeps the
 * returned values and re-renders with them. It is exported here so the reset
 * lives next to the machine it resets.
 */
export function gateMachine(target: string, mountId = 0): GateMachineStore {
  const key = mountId + "|" + target
  const held = gateMachineStores.get(key)
  if (held) return held
  // The new link cancels whatever join the SAME mount had in flight. Another
  // mount keeps its own try: a remount is not a target change.
  for (const [other, store] of gateMachineStores) {
    if (!other.startsWith(mountId + '|')) continue
    if (store.owner) retireAttemptOwner(store.owner)
    gateMachineStores.delete(other)
    gateMachineVersions.delete(other)
    if (latestGateStores.get(store.target) === store) {
      const replacement = [...gateMachineStores.values()].find(candidate => candidate.target === store.target)
      if (replacement) latestGateStores.set(store.target, replacement)
      else latestGateStores.delete(store.target)
    }
  }
  const next: GateMachineStore = { machine: initialJoinState, owner: null, mountId, target, version: 0 }
  gateMachineStores.set(key, next)
  gateMachineVersions.set(key, 0)
  latestGateStores.set(target, next)
  gateMountTargets.set(mountId, target)
  return next
}

/** Retire and forget every gate state owned by one mounted InviteGate. */
export function disposeGateMount(mountId: number): void {
  for (const [key, store] of gateMachineStores) {
    if (store.mountId !== mountId) continue
    if (store.owner) retireAttemptOwner(store.owner)
    gateMachineStores.delete(key)
    gateMachineVersions.delete(key)
    if (latestGateStores.get(store.target) === store) {
      const replacement = [...gateMachineStores.values()].find(candidate => candidate.target === store.target)
      if (replacement) latestGateStores.set(store.target, replacement)
      else latestGateStores.delete(store.target)
    }
  }
  gateMountTargets.delete(mountId)
  notifyGateState()
}

/** Record a machine event's outcome for this target. */
export function dispatchGateEvent(target: string, event: JoinEvent, mountId = 0): JoinPlan {
  const activeTarget = gateMountTargets.get(mountId)
  if (activeTarget !== undefined && activeTarget !== target) {
    const current = gateMachineStores.get(mountId + "|" + activeTarget)
    return { state: current?.machine ?? initialJoinState, action: { type: 'none' } }
  }
  const store = gateMachine(target, mountId)
  const plan = joinMachine(store.machine, event)
  store.machine = plan.state
  store.version += 1
  gateMachineVersions.set(mountId + "|" + target, store.version)
  notifyGateState()
  return plan
}

/** Record (or clear) the try that owns this target. */
export function setGateOwner(target: string, owner: AttemptOwner | null, mountId = 0): void {
  const activeTarget = gateMountTargets.get(mountId)
  if (activeTarget !== undefined && activeTarget !== target) {
    if (owner) retireAttemptOwner(owner)
    return
  }
  const store = gateMachine(target, mountId)
  if (store.owner === owner) return
  store.owner = owner
  store.version += 1
  gateMachineVersions.set(mountId + "|" + target, store.version)
  notifyGateState()
}

export type JoinEvent =
  /** The gate is ready for this account: start a join if nothing is in flight. */
  | { type: 'begin'; userId: string; gen: number; member: boolean; tryId?: number }
  /** The user pressed Try again. Rejoins after 'failed', re-reads after 'joined-unloaded'. */
  | { type: 'retry'; userId: string; gen: number; member: boolean; tryId?: number }
  /** A join RPC answered. Ignored unless it quotes the live try. */
  | { type: 'join-settled'; userId: string; gen: number; tryId: number; result: JoinResult }
  /** A full-row read answered. Ignored unless it quotes the live try. */
  | { type: 'reload-settled'; userId: string; gen: number; tryId: number; result: JoinResult }
  /** The account, the link target or the mount changed. Every try is retired. */
  | { type: 'reset' }

/** The result of a join or a reload, as the store reports it. The refusal kinds
 *  stay distinct so the gate can say "you are not on this trip" instead of
 *  claiming a membership the server denied. */
export type JoinResult = 'joined' | 'joined-unloaded' | 'joined-unloaded-incomplete' | 'joined-unloaded-failed' | 'not-member' | 'missing' | 'deleted' | 'incomplete' | 'failed' | 'abandoned'

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
    case 'reset':
      // The caller retires the try before it dispatches this, so a continuation
      // that still holds the old try can never settle.
      return none(initialJoinState)

    case 'begin': {
      // B-1 — `begin` decides the ACTION itself, because it is the only place
      // that knows whether this caller is already a member. The earlier shape
      // moved the machine to 'joining' and left App to dispatch a second event
      // to correct it; that event answered 'none' and a member who re-clicked a
      // link sat on "Joining…" forever. One event, one decision.
      if (!isCurrent(state, event)) {
        const phase: JoinPhase = event.member ? 'loading' : 'joining'
        const fresh: JoinState = { phase, userId: event.userId, gen: event.gen, tryId: (event.tryId ?? state.tryId + 1), reason: null }
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
      const fresh: JoinState = { ...state, phase, tryId: (event.tryId ?? state.tryId + 1), reason: null }
      return { state: fresh, action: event.member
        ? { type: 'reload', tryId: fresh.tryId }
        : { type: 'join', tryId: fresh.tryId } }
    }

    case 'retry': {
      // The retry is bound to the account that is signed in NOW.
      if (!isCurrent(state, event)) {
        const phase: JoinPhase = event.member ? 'loading' : 'joining'
        const fresh: JoinState = { phase, userId: event.userId, gen: event.gen, tryId: (event.tryId ?? state.tryId + 1), reason: null }
        return { state: fresh, action: event.member
          ? { type: 'reload', tryId: fresh.tryId }
          : { type: 'join', tryId: fresh.tryId } }
      }
      // A member (or a trip whose membership is known) re-reads; it never joins
      // again, so a retry cannot write a second membership row.
      if (event.member || state.phase === 'joined-unloaded') {
        const next: JoinState = { ...state, phase: 'loading', tryId: (event.tryId ?? state.tryId + 1), reason: null }
        return { state: next, action: { type: 'reload', tryId: next.tryId } }
      }
      if (state.phase === 'joining' || state.phase === 'loading') return none(state)
      // 'failed', 'abandoned', 'idle' and 'joined' all rejoin. 'joined' cannot
      // normally be retried (it navigates), and rejoining it is harmless.
      const next: JoinState = { ...state, phase: 'joining', tryId: (event.tryId ?? state.tryId + 1), reason: null }
      return { state: next, action: { type: 'join', tryId: next.tryId } }
    }

    case 'join-settled': {
      // A late answer from a previous account, or for a superseded tryId,
      // must not touch this state.
      if (!isCurrentTry(state, event)) return none(state)
      return { state: { ...state, phase: phaseFor(event.result), reason: refusalFor(event.result) }, action: { type: 'none' } }
    }

    case 'reload-settled': {
      if (!isCurrentTry(state, event)) return none(state)
      // B8 — keep the store's distinct outcome. A membership loss, a missing row
      // and a tombstone are failures, never "You joined". A read failure for a
      // caller who IS a member stays 'joined-unloaded', because the membership
      // exists and only the row could not be read.
      const phase: JoinPhase = event.result === 'joined' ? 'joined'
        : event.result === 'abandoned' ? 'abandoned'
        : event.result === 'not-member' || event.result === 'missing' || event.result === 'deleted' ? 'failed'
        : 'joined-unloaded'
      return { state: { ...state, phase, reason: refusalFor(event.result) }, action: { type: 'none' } }
    }
  }
}

/** The typed reason behind a result. `joined` and `joined-unloaded` carry none:
 *  the membership exists, and the unloaded case is a read problem, not a
 *  membership claim. Every other result names its own refusal. */
function refusalFor(result: JoinResult): JoinRefusal | null {
  if (result === 'joined-unloaded-incomplete') return 'incomplete'
  if (result === 'joined-unloaded-failed') return 'failed'
  if (result === 'not-member' || result === 'missing' || result === 'deleted'
    || result === 'incomplete' || result === 'failed') return result
  return null
}

function phaseFor(result: JoinResult): JoinPhase {
  if (result === 'joined') return 'joined'
  if (result === 'joined-unloaded' || result === 'joined-unloaded-incomplete' || result === 'joined-unloaded-failed') return 'joined-unloaded'
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
