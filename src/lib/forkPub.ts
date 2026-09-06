// ============ Fork a published itinerary (shared by Explore, the public page
// and the creator page — one login gate, one premium rule, one toast) ============
import type { PublishedItinerary } from '../data/types'
import { tripById, duplicateTrip, duplicateTripPublic, registerPubCopy } from '../store/store'
import { toast } from '../components/ui'

/** Fork `pub` into the viewer's trips. Login-gated; publications with days
 *  outside the free preview fork premium-respectfully (locked days arrive as
 *  stubs). Returns false when the underlying trip vanished or the viewer must
 *  log in first (navigation already handled). */
export function forkPublication(pub: PublishedItinerary, meId: string | null, onNavigate: (r: string) => void): boolean {
  const src = tripById(pub.tripId)
  if (!src) { toast('That itinerary is no longer available.', 'err'); return false }
  if (!meId) { toast('Log in to fork this trip into your plans.'); onNavigate('/auth'); return false }
  const hasLockedDays = src.days.some(d => !pub.freeDayIndexes.includes(d.index))
  if (hasLockedDays) duplicateTripPublic(src, meId, pub.freeDayIndexes)
  else duplicateTrip(src, meId)
  registerPubCopy(pub.id)
  toast(`“${pub.title}” forked to My trips ✈️`)
  onNavigate('/trips')
  return true
}
