// ============ #1019 — what a code lookup's answer means ============
//
// The get_trip_by_invite_code RPC answers with an array of trip rows. This file
// decides whether that answer is a trip, a dead link, or a failed read. The
// store and the join gate both use it, so the rules live in one place.
import { validWriteVersion, type TripRow } from './tripRow'

export type InviteRowVerdict =
  | { kind: 'found'; row: TripRow }
  | { kind: 'dead' }
  | { kind: 'failed' }

export function classifyInviteRows(data: unknown): InviteRowVerdict {
  // A refused shape is a server fault, not a dead code, so it is a failed read.
  if (!Array.isArray(data)) return { kind: 'failed' }
  // The RPC answered, and no trip has this code: a dead link.
  if (data.length === 0) return { kind: 'dead' }
  const row = data[0] as Partial<TripRow> | null
  // B3 (round 10) — provenance: no shape, no trip. A preview that names no trip
  // id, or carries no usable revision, is not an answer this client can act on.
  if (typeof row?.id !== 'string' || row.id.length === 0 || !validWriteVersion(row.write_version)) {
    return { kind: 'failed' }
  }
  return { kind: 'found', row: row as TripRow }
}
