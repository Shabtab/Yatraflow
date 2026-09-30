// ============ Fork a published itinerary (shared by Explore, the public page
// and the creator page — one login gate, one premium rule, one toast) ============
import type { PublishedItinerary, Trip } from '../data/types'
import { tripById, duplicateTripPersisted, duplicateTripPublicPersisted, registerPubCopy, fetchPublicTrip } from '../store/store'
import type { ShareSource } from './shareUrl'
import { fetchMyEntitlements } from './unlock'
import { hasUnlock } from './payments'
import { toast } from '../components/ui'

const LOCKED_STOP_DESCRIPTION = 'Locked — the full plan is on the original itinerary.'

/** Defense-in-depth stub: re-applies the locked-day stub to days NOT in the
 *  publication's free list, EVEN IF the session's copy somehow carries real
 *  content. The server (get_public_trip) already stubs at the wire; this
 *  mirrors it so a stale cached row or a missed RLS update can never turn
 *  into a fork of paid content. Same field shape as buildTripCopy.
 *
 *  #352 — `stripMoney` empties the trip's expenses and fixed commitments for
 *  the same reason the RPC does: the page's own locked copy promises the
 *  BUDGET BREAKDOWN is in the full plan, so a viewer who has not bought it
 *  must not receive it through a fork either. The flag is passed in from the
 *  publication's price rather than derived here, because the rule is "priced
 *  and not entitled" and not "has locked days": a trip-level expense carries
 *  no `dayIndex` for a filter to key on, and a row whose days came back empty
 *  would otherwise read as having nothing locked at all. */
function restubLockedDays(src: Trip, freeDayIndexes: number[], stripMoney: boolean): Trip {
  const free = new Set(freeDayIndexes)
  return {
    ...src,
    ...(stripMoney ? { expenses: [], fixedCommitments: [] } : {}),
    days: src.days.map(d => free.has(d.index) ? d : {
      ...d,
      stops: d.stops.map(s => ({
        ...s,
        description: LOCKED_STOP_DESCRIPTION,
        notes: '',
        openTime: undefined,
        closeTime: undefined,
        departTime: undefined,
        arrivalTime: undefined,
        sourceUrl: undefined,
        placeId: undefined,
        entryFeeInrPerPerson: 0,
        transportCostInrTotal: 0,
        status: 'confirmed' as const,
      })),
    }),
  }
}

/** Whether the SERVER withheld content for a day this publication locks.
 *  get_public_trip leaves its notice on every stop of a day it stubs, so one
 *  notice is proof the row came back locked. 
 *
 *  A locked day with NO stops reads as not-stubbed here, and that direction is
 *  deliberate: this only ever widens days for a viewer whose entitlement the
 *  server itself confirmed (see forkPublication), where the alternative is
 *  handing a paying buyer an empty day. An unentitled viewer never reaches it. */
export function wireWithheld(src: Trip, freeDayIndexes: number[]): boolean {
  const free = new Set(freeDayIndexes)
  return src.days.some(d => !free.has(d.index)
    && d.stops.some(s => s.description === LOCKED_STOP_DESCRIPTION))
}

/** Fork `pub` into the viewer's trips. Login-gated. The days forked are
 *  EXACTLY what the server served this viewer's session: fetchPublicTrip
 *  reads through get_public_trip, which already returned real days for the
 *  creator / an entitled buyer and wire-stubbed locked days for everyone
 *  else. Returns false when the underlying trip vanished, the viewer must log
 *  in first (navigation already handled), or the rows failed to persist — in
 *  which case no half-saved fork is left behind to vanish on the next reload.
 *
 *  #349 — the entitlement is asked for, never assumed from a cache hit. Two
 *  things used to strand a paying buyer on placeholders: `tripById(pub.tripId)`
 *  was preferred over the RPC, so a pre-purchase stub in the cache won the read,
 *  and the re-stub below ran unconditionally, so even a correctly-served real
 *  trip was re-locked on the way into the copy. Now the wire is read first (a
 *  cache hit is not evidence of anything about entitlement), and the re-stub is
 *  skipped only when the server confirms the entitlement AND the row it served
 *  contradicts the stub — one decision, both inputs from the server.
 *
 *  `unlockedPresentationOnly` is the page's already-read presentation flag: a
 *  TRUE short-circuits the entitlement read, and anything else (false, or a
 *  caller that passes nothing) triggers a fresh read of this session's own rows.
 *  A negative is never trusted, because the page's flag is `false` while that
 *  read is still in flight — which is exactly when a buyer who has just paid
 *  clicks Fork. */
export async function forkPublication(pub: PublishedItinerary, meId: string | null, onNavigate: (r: string) => void, unlockedPresentationOnly?: boolean, source?: ShareSource | null): Promise<boolean> {
  if (!meId) { toast('Log in to fork this trip into your plans.'); onNavigate('/auth'); return false }
  // Read through the paywall RPC, not the raw table. A creator/buyer session
  // gets the real trip back from the same call a visitor makes — the server
  // compared auth.uid() against the entitlement rows, not this client.
  const wireRow = await fetchPublicTrip(pub.id)
  // The cache is only a fallback for a FAILED read (the RPC returns null for a
  // deleted row and for a dropped connection alike), and whatever comes from it
  // is re-stubbed below: a row that did not come off the wire is not evidence
  // about anything.
  const src = wireRow ?? tripById(pub.tripId)
  if (!src) { toast('Couldn’t load that itinerary — it may be unpublished now, or the connection dropped.', 'err'); return false }
  // #359 — the entitlement read REJECTS on a failed read, so a rejection is
  // caught HERE and answered as the CONSERVATIVE answer: not entitled. The fork
  // then takes the re-stubbed locked path, which is the direction that withholds
  // rather than leaks — the wire already decided what content exists, and this
  // second gate can only narrow. Letting the rejection escape would abort the
  // whole fork (a buyer who could not be checked could not fork their own plan);
  // treating it as "entitled" would hand paid content to a stranger.
  let entitled = unlockedPresentationOnly === true
  if (!entitled && meId) {
    try {
      entitled = hasUnlock(await fetchMyEntitlements(meId), meId, pub.id, pub.creatorId)
    } catch {
      entitled = false
    }
  }
  // Fail closed: any doubt (no wire row, a wire row the server stubbed, no
  // entitlement) forks the locked shape. Nothing a client can say widens this —
  // the wire already decided what content exists.
  const unlockedFork = entitled && wireRow !== null && !wireWithheld(src, pub.freeDayIndexes)
  // #352 — the money rides the same decision the wire makes: a priced
  // publication withholds its budget breakdown from a viewer who has not
  // bought it, so the re-stub empties it here too. `premiumPriceInr` is the
  // publication's own row — the field the RPC keys on.
  const safe = unlockedFork ? src : restubLockedDays(src, pub.freeDayIndexes, (pub.premiumPriceInr ?? 0) > 0)
  // #352 — and the persist branch keys on the SERVER's decision, not on the
  // shape of the row in hand. `src.days.some(...)` used to decide it, which
  // read a wire-stubbed row whose days came back empty (the RPC's own
  // fail-closed corrupt-days branch) as "nothing is locked" and took the
  // UNFILTERED full-copy path with the money still attached. Everything the
  // server did not hand over in full now goes through the public persist path,
  // which is also correct for an all-free publication: it keeps trip-level
  // expenses and every free day, so nothing the viewer may have is lost
  // (buildTripCopy's filter keeps `e.dayIndex === undefined`).
  // #230 — the same `source` stamps two places: the funnel event (through the
  // counter RPC's p_source) and the forked trip's own `ref`, so a later
  // conversion on that trip can still name the surface that brought its owner.
  const { persisted } = unlockedFork
    ? await duplicateTripPersisted(safe, meId, undefined, source)
    : await duplicateTripPublicPersisted(safe, meId, pub.freeDayIndexes, source)
  if (!persisted) {
    toast('Could not save the forked trip — check your connection and try again.', 'err')
    return false
  }
  registerPubCopy(pub.id, source)
  toast(`“${pub.title}” forked to My trips ✈️`)
  onNavigate('/trips')
  return true
}
