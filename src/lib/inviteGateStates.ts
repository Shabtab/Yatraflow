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
