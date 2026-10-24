// ============ Collaboration command submission (stage A of #832) ============
//
// One door between the client's contribution writers and the server. Every
// suggestion, decision and activity write travels as a narrow command through
// the `submit_collab_command` RPC (docs/agents/collab-command-contract.md),
// and the server answers with a RECEIPT — an explicit outcome the caller must
// handle. The old shape — a whole-JSON column update whose failure only
// reached a console log — is the defect #801/#802 record: optimistic writes
// hid failures and concurrent writers erased each other's contributions.
//
// The server derives the actor from auth.uid(). A command carries NO actor or
// author field, and a command ID reused with a different actor, trip or
// payload answers `conflict` — so a command ID is minted once per logical
// action and kept for the retry.

import type { Comment, StopCategory, StopSuggestion, TripDecision, Vote } from '../data/types'
import { supabase } from '../lib/supabase'

/** What the caller hands the RPC. Field names follow the contract exactly. */
export type CollabCommand =
  | {
      type: 'suggestion.create'
      suggestionId: string
      suggestion: {
        dayIndex: number
        title: string
        category: string
        locationName: string
        lat?: number
        lng?: number
        description?: string
        visitMinutes?: number
        estimatedEntryFeeInr?: number
        estimatedTransportInr?: number
      }
    }
  | { type: 'suggestion.comment'; suggestionId: string; commentId: string; text: string }
  | { type: 'suggestion.ballot'; suggestionId: string; value: 1 | -1 | null }
  | {
      type: 'decision.create'
      decisionId: string
      decision: {
        question: string
        context?: string
        options: Array<Record<string, unknown> & { id: string; label: string }>
      }
    }
  | { type: 'decision.comment'; decisionId: string; commentId: string; text: string }
  | { type: 'decision.ballot'; decisionId: string; optionId: string | null }
  | { type: 'activity.append'; activityId: string; verb: string; target?: string }

/** The outcome union every contribution writer returns. The statuses and the
 *  field names are the receipt's, verbatim. `tripRevision` on the first three
 *  statuses is the server's acknowledgment of the revision it observed — it is
 *  NOT a trip snapshot and never advances the client's own trip CAS revision
 *  (contribution commands do not update `trips`). */
export type CollabOutcome =
  | {
      status: 'applied'
      tripRevision: number
      suggestion?: StopSuggestion
      decision?: TripDecision
      activityId?: string
      notificationIds?: string[]
    }
  | {
      status: 'alreadyApplied'
      tripRevision: number
      suggestion?: StopSuggestion
      decision?: TripDecision
      activityId?: string
      notificationIds?: string[]
    }
  | { status: 'conflict'; tripRevision: number }
  | { status: 'invalid'; reason?: string }
  | { status: 'forbidden' }
  | { status: 'unavailable' }

/** The canonical suggestion row a receipt carries, in the database read shape
 *  (snake_case columns — the same shape hydration maps). Moved here from
 *  store.ts so the receipt and the hydrate/realtime paths share one mapping. */
type DbSuggestionRow = {
  id: string; trip_id: string; day_index: number; proposed_by: string
  title: string; category: StopCategory; location_name: string; lat: number; lng: number
  description?: string | null; visit_minutes?: number
  estimated_entry_fee_inr?: number; estimated_transport_inr?: number
  votes?: Vote[]; comments?: Comment[]; status: StopSuggestion['status']; created_at?: number
}

export function suggestionRowToEntry(row: unknown): StopSuggestion {
  const r = row as DbSuggestionRow
  return {
    id: r.id, tripId: r.trip_id, dayIndex: r.day_index, proposedBy: r.proposed_by,
    title: r.title, category: r.category, locationName: r.location_name, lat: r.lat, lng: r.lng,
    description: r.description ?? undefined, visitMinutes: r.visit_minutes ?? 0,
    estimatedEntryFeeInr: r.estimated_entry_fee_inr ?? 0, estimatedTransportInr: r.estimated_transport_inr ?? 0,
    votes: r.votes ?? [], comments: r.comments ?? [], status: r.status, createdAt: r.created_at ?? 0,
  }
}

type DbDecisionRow = {
  id: string; trip_id: string; question: string; context?: string | null
  options?: TripDecision['options']; votes_by_user_id?: Record<string, string>
  comments?: Comment[]; status: TripDecision['status']
  resolved_option_id?: string | null; raised_by: string; created_at?: number; resolved_at?: number | null
}

export function decisionRowToEntry(row: unknown): TripDecision {
  const r = row as DbDecisionRow
  return {
    id: r.id, tripId: r.trip_id, question: r.question, context: r.context ?? undefined,
    options: r.options ?? [], votesByUserId: r.votes_by_user_id ?? {}, status: r.status,
    comments: r.comments ?? [],
    resolvedOptionId: r.resolved_option_id ?? undefined, raisedBy: r.raised_by,
    createdAt: r.created_at ?? 0, resolvedAt: r.resolved_at ?? undefined,
  }
}

type RawReceipt = {
  status?: unknown
  tripRevision?: unknown
  trip_revision?: unknown
  suggestion?: unknown
  decision?: unknown
  activityId?: unknown
  activity_id?: unknown
  notificationIds?: unknown
  notification_ids?: unknown
  reason?: unknown
}

function revisionOf(r: RawReceipt): number {
  const n = r.tripRevision ?? r.trip_revision
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function idListOf(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const ids = v.filter((x): x is string => typeof x === 'string')
  return ids.length === v.length ? ids : undefined
}

function receiptToOutcome(data: unknown): CollabOutcome {
  if (!data || typeof data !== 'object' || typeof (data as RawReceipt).status !== 'string') {
    // A 200 without a parseable receipt is a database answer this client
    // cannot trust — the caller must see a failure, not an assumed success.
    return { status: 'unavailable' }
  }
  const r = data as RawReceipt
  switch (r.status) {
    case 'applied':
      return {
        status: 'applied',
        tripRevision: revisionOf(r),
        ...(r.suggestion != null ? { suggestion: suggestionRowToEntry(r.suggestion) } : {}),
        ...(r.decision != null ? { decision: decisionRowToEntry(r.decision) } : {}),
        ...(typeof r.activityId === 'string' ? { activityId: r.activityId } : {}),
        ...(idListOf(r.notificationIds) ? { notificationIds: idListOf(r.notificationIds) } : {}),
      }
    case 'alreadyApplied':
      // The stored server receipt keeps its artifact ids on replay (contract
      // answer, gate round 2): the retry re-keys its optimistic artifacts to
      // the FIRST try's canonical ids instead of dropping them blind.
      return {
        status: 'alreadyApplied',
        tripRevision: revisionOf(r),
        ...(r.suggestion != null ? { suggestion: suggestionRowToEntry(r.suggestion) } : {}),
        ...(r.decision != null ? { decision: decisionRowToEntry(r.decision) } : {}),
        ...(typeof r.activityId === 'string' ? { activityId: r.activityId } : {}),
        ...(idListOf(r.notificationIds) ? { notificationIds: idListOf(r.notificationIds) } : {}),
      }
    case 'conflict':
      return { status: 'conflict', tripRevision: revisionOf(r) }
    case 'invalid':
      return { status: 'invalid', ...(typeof r.reason === 'string' ? { reason: r.reason } : {}) }
    case 'forbidden':
      return { status: 'forbidden' }
    case 'unavailable':
      return { status: 'unavailable' }
    default:
      return { status: 'unavailable' }
  }
}

/** Map a PostgREST-level failure onto the outcome union. A permission denial
 *  is `forbidden`; everything else (missing function on a pre-migration
 *  database, network, timeout) is `unavailable` — the database could not
 *  commit the command. */
function rpcErrorToOutcome(error: { code?: unknown; message?: unknown } | null | undefined): CollabOutcome {
  if (error && error.code === '42501') return { status: 'forbidden' }
  return { status: 'unavailable' }
}

/** Submit one command and return the receipt as a `CollabOutcome`.
 *
 *  NEVER throws — a rejection anywhere on the path is an `unavailable`
 *  outcome, because the caller has to decide what the user sees and a thrown
 *  promise is exactly the silent hole this module replaces.
 *
 *  Retry rule: the CALLER owns the command ID. The same ID with the same
 *  payload is the idempotent retry (`alreadyApplied`); the same ID with a
 *  different actor, trip or payload is a `conflict`. */
export async function submitCollabCommand(
  commandId: string,
  tripId: string,
  command: CollabCommand,
): Promise<CollabOutcome> {
  // Older test mocks (and a client built before the module existed) have no
  // rpc at all. That is the pre-migration database's shape: the command
  // cannot be committed, so the outcome is unavailable — never an assumed
  // success and never a throw.
  if (typeof (supabase as { rpc?: unknown }).rpc !== 'function') return { status: 'unavailable' }
  try {
    const { data, error } = await supabase.rpc('submit_collab_command', {
      p_command_id: commandId,
      p_trip_id: tripId,
      p_command: command,
    })
    if (error) return rpcErrorToOutcome(error as { code?: unknown })
    return receiptToOutcome(data)
  } catch {
    return { status: 'unavailable' }
  }
}
