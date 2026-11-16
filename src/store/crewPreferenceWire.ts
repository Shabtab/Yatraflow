// Crew preferences: the wire between the store and the database.
//
// Reads go through the table (RLS lets a trip member read every row of the
// trip). Writes go through the `set_my_crew_preferences` RPC only: it checks
// the shape, the membership and the signed-in account, and it writes the
// caller's own row. This module never throws. A failure is an outcome.

import { STOP_CATEGORIES, type CrewInterest, type CrewPreference } from '../data/types'
import { supabase } from '../lib/supabase'
import type { CollabOutcome } from './collabCommand'

type DbCrewPreferenceRow = {
  trip_id?: unknown
  user_id?: unknown
  interests?: unknown
  updated_at?: unknown
}

/** Map one database row. A row without a trip or a member is malformed and
 *  throws, so the caller's `mapOrSkip` drops it. An interest this app does not
 *  know is left out of the list, and the row still counts as an answer. */
export function crewPreferenceRowToEntry(row: unknown): CrewPreference {
  const r = row as DbCrewPreferenceRow
  if (!r || typeof r !== 'object') throw new Error('crew preference row is not an object')
  if (typeof r.trip_id !== 'string' || !r.trip_id || typeof r.user_id !== 'string' || !r.user_id) {
    throw new Error('crew preference row has no trip or member')
  }
  const known = new Set<string>(STOP_CATEGORIES)
  const interests = Array.isArray(r.interests)
    ? r.interests.filter((x): x is CrewInterest => typeof x === 'string' && known.has(x))
    : []
  const updatedAt = typeof r.updated_at === 'number' && Number.isFinite(r.updated_at) ? r.updated_at : 0
  return { tripId: r.trip_id, userId: r.user_id, interests, updatedAt }
}

/** Save the signed-in member's answers for one trip.
 *
 *  `applied` carries the stored row. The write is a SET, so a repeat of the
 *  same call is harmless and has no command id. The caller must show every
 *  outcome that is not a clear success. A 200 without a readable receipt is
 *  `unavailable`, never an assumed save. */
export async function submitCrewPreferences(tripId: string, interests: readonly CrewInterest[]): Promise<CollabOutcome> {
  if (typeof (supabase as { rpc?: unknown }).rpc !== 'function') return { status: 'unavailable' }
  try {
    const { data, error } = await supabase.rpc('set_my_crew_preferences', {
      p_trip_id: tripId,
      p_interests: [...interests],
    })
    if (error) return (error as { code?: unknown }).code === '42501' ? { status: 'forbidden' } : { status: 'unavailable' }
    if (!data || typeof data !== 'object') return { status: 'unavailable' }
    const receipt = data as { status?: unknown; preference?: unknown }
    switch (receipt.status) {
      case 'applied': {
        let crewPreference: CrewPreference
        try { crewPreference = crewPreferenceRowToEntry(receipt.preference) } catch { return { status: 'unavailable' } }
        // The receipt must describe the row that was asked for.
        if (crewPreference.tripId !== tripId) return { status: 'unavailable' }
        return { status: 'applied', tripRevision: 0, crewPreference }
      }
      case 'invalid': return { status: 'invalid' }
      case 'forbidden': return { status: 'forbidden' }
      default: return { status: 'unavailable' }
    }
  } catch {
    return { status: 'unavailable' }
  }
}
