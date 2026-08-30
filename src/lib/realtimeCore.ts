// ============ Realtime collaboration core (pure helpers) ============
// Pure, framework-free helpers for the supabase postgres_changes handlers in
// src/store/store.ts (issue #18). Kept side-effect free so the node test
// environment can exercise every branch.
import type { TripMember } from '../data/types'

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE'

/** Generic reduce a cache slice by one realtime change. */
export function reduceSlice<T extends { id: string }>(list: T[], event: RealtimeEventType, row?: T, oldId?: string): T[] {
  if (event === 'DELETE') return list.filter(x => x.id !== (oldId ?? row?.id))
  if (!row) return list
  if (event === 'INSERT') {
    return list.some(x => x.id === row.id) ? list : [...list, row]
  }
  // UPDATE: replace in place, preserving array order (avoids card re-ordering).
  const idx = list.findIndex(x => x.id === row.id)
  if (idx < 0) return [...list, row]
  const next = [...list]
  next[idx] = row
  return next
}

/**
 * Apply one trip_members change to a members array. INSERT/UPDATE upsert the
 * membership (role/joinedAt could have changed); DELETE removes the member.
 */
export function applyMemberChange(
  members: TripMember[],
  change: { event: RealtimeEventType; userId: string; role: TripMember['role']; joinedAt: number },
): TripMember[] {
  if (change.event === 'DELETE') return members.filter(m => m.userId !== change.userId)
  const idx = members.findIndex(m => m.userId === change.userId)
  if (idx < 0) return [...members, { userId: change.userId, role: change.role, joinedAt: change.joinedAt }]
  const next = [...members]
  next[idx] = { userId: change.userId, role: change.role, joinedAt: change.joinedAt }
  return next
}

/**
 * Echo-loop guard: whether a realtime event for (table, id) is our OWN write
 * landing back on us. Mutations optimistically update the cache first; a
 * broadcast of that exact write should be ignored so the fresh server row
 * doesn't clobber concurrent optimistic state. `recent` is a Map of
 * "table:id" -> Date.now() maintained by markLocalWrite().
 */
export function isRecentLocalWrite(recent: Map<string, number>, table: string, id: string, now: number, windowMs = 2000): boolean {
  const t = recent.get(`${table}:${id}`)
  return t !== undefined && now - t < windowMs
}