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

import type { Comment, PersistedPlaceIdentity, StopCategory, StopSuggestion, TripDecision, Vote } from '../data/types'
import { persistedPlaceFromJson } from '../lib/placeDraft'
import { supabase } from '../lib/supabase'

/** What the caller hands the RPC. Field names follow the contract exactly. */
export type CollabCommand =
  | {
      type: 'suggestion.create'
      suggestionId: string
      suggestion: {
        dayIndex: number
        dayId?: string
        place?: PersistedPlaceIdentity
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

/** Server-owned workflow transitions. These commands share the Stage A
 *  idempotency ledger, but return placement facts separately from winner state. */
export type CollabTransitionCommand =
  | { type: 'suggestion.accept'; suggestionId: string; expectedRevision: number; dayId?: string; dayIndex?: number; allowDuplicate?: boolean }
  | { type: 'suggestion.decline'; suggestionId: string }
  | { type: 'decision.resolve'; decisionId: string; optionId: string; expectedRevision: number; dayId?: string; dayIndex?: number }

export type AcceptanceOutcome =
  | { status: 'applied'; tripRevision: number; stopId: string; suggestion?: StopSuggestion }
  | { status: 'alreadyApplied'; tripRevision: number; stopId?: string; suggestion?: StopSuggestion }
  | { status: 'needsDay'; availableDays: Array<{ id: string; index: number; title?: string }> }
  | { status: 'needsDuplicate'; tripRevision: number; dayId: string; dayIndex: number }
  | { status: 'needsPlace' }
  | { status: 'conflict'; tripRevision: number }
  | { status: 'forbidden' | 'unavailable'; reason?: string }

export type DecisionResolutionOutcome =
  | { status: 'applied' | 'alreadyApplied'; tripRevision: number; winnerId: string; decision?: TripDecision; placement: { status: 'applied' | 'alreadyApplied'; stopId: string } | { status: 'needsDay'; availableDays: Array<{ id: string; index: number; title?: string }> } | { status: 'needsPlace' | 'notRequired' } }
  | { status: 'conflict'; tripRevision: number }
  | { status: 'forbidden' | 'unavailable'; reason?: string }

export type CollabTransitionOutcome = AcceptanceOutcome | DecisionResolutionOutcome | CollabOutcome

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
  id: string; trip_id: string; day_index: number; day_id?: string | null; place?: unknown; proposed_by: string
  accepted_stop_id?: string | null
  title: string; category: StopCategory; location_name: string; lat: number; lng: number
  description?: string | null; visit_minutes?: number
  estimated_entry_fee_inr?: number; estimated_transport_inr?: number
  votes?: Vote[]; comments?: Comment[]; status: StopSuggestion['status']; created_at?: number
}

export function suggestionRowToEntry(row: unknown): StopSuggestion {
  const r = row as DbSuggestionRow
  const place = persistedPlaceFromJson(r.place)
  return {
    id: r.id, tripId: r.trip_id, dayIndex: r.day_index,
    ...(typeof r.day_id === 'string' && r.day_id ? { dayId: r.day_id } : {}),
    ...(typeof r.accepted_stop_id === 'string' && r.accepted_stop_id ? { acceptedStopId: r.accepted_stop_id } : {}),
    ...(place ? { place } : {}),
    proposedBy: r.proposed_by,
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
  resolved_option_id?: string | null; resolved_stop_id?: string | null; raised_by: string; created_at?: number; resolved_at?: number | null
}

export function decisionRowToEntry(row: unknown): TripDecision {
  const r = row as DbDecisionRow
  return {
    id: r.id, tripId: r.trip_id, question: r.question, context: r.context ?? undefined,
    options: r.options ?? [], votesByUserId: r.votes_by_user_id ?? {}, status: r.status,
    comments: r.comments ?? [],
    resolvedOptionId: r.resolved_option_id ?? undefined, raisedBy: r.raised_by,
    ...(typeof r.resolved_stop_id === 'string' && r.resolved_stop_id ? { resolvedStopId: r.resolved_stop_id } : {}),
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
  dayId?: unknown
  dayIndex?: unknown
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

/** Does this receipt keep what the command promised?
 *
 *  A `suggestion.create` that carried stable-day or place identity is only
 *  APPLIED when the stored row comes back carrying it. An older
 *  `submit_collab_command` refuses unfamiliar keys outright (`invalid`), so a
 *  receipt that answers `applied` while the promised fields are absent is a
 *  server that dropped them — accepting it would report a save the user did not
 *  get, with the picked place gone and nothing said. Anything other than a
 *  success status has nothing to prove. */
function receiptKeepsPromisedMetadata(command: CollabCommand, outcome: CollabOutcome): boolean {
  if (command.type !== 'suggestion.create') return true
  if (outcome.status !== 'applied' && outcome.status !== 'alreadyApplied') return true
  const promised = command.suggestion
  const wantedDayId = typeof promised.dayId === 'string' ? promised.dayId.trim() : ''
  const wantedPlace = promised.place
  if (!wantedDayId && !wantedPlace) return true
  const row = outcome.suggestion
  if (!row) return false
  if (wantedDayId && (typeof row.dayId !== 'string' || row.dayId.trim() !== wantedDayId)) return false
  if (wantedPlace) {
    const stored = row.place
    // The row must carry a readable identity that still names the same provider
    // keys. A different (or absent) key is a different entity, not this pick.
    if (!stored) return false
    if (wantedPlace.placeId && stored.placeId !== wantedPlace.placeId) return false
    if (wantedPlace.eLoc && stored.eLoc !== wantedPlace.eLoc) return false
    if (wantedPlace.source && stored.source !== wantedPlace.source) return false
  }
  return true
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
    const outcome = receiptToOutcome(data)
    if (!receiptKeepsPromisedMetadata(command, outcome)) {
      // A recoverable refusal, NOT a success: the row may exist, but without the
      // identity the user gave, so nothing is confirmed. `unavailable` keeps the
      // caller's envelope pending, so its next call retries the SAME command id
      // and payload — the metadata is never stripped to make the retry look like
      // it worked.
      return { status: 'unavailable' }
    }
    return outcome
  } catch {
    return { status: 'unavailable' }
  }
}

/** Submit a server-owned workflow command. A malformed success response is an
 *  unavailable outcome; callers must never infer success from an HTTP 200. */
export function submitCollabTransition(commandId: string, tripId: string,
  command: Extract<CollabTransitionCommand, { type: 'suggestion.accept' }>): Promise<AcceptanceOutcome>
export function submitCollabTransition(commandId: string, tripId: string,
  command: Extract<CollabTransitionCommand, { type: 'suggestion.decline' }>): Promise<CollabOutcome>
export function submitCollabTransition(commandId: string, tripId: string,
  command: Extract<CollabTransitionCommand, { type: 'decision.resolve' }>): Promise<DecisionResolutionOutcome>
export async function submitCollabTransition(
  commandId: string,
  tripId: string,
  command: CollabTransitionCommand,
): Promise<CollabTransitionOutcome> {
  if (typeof (supabase as { rpc?: unknown }).rpc !== 'function') return { status: 'unavailable' }
  try {
    const { data, error } = await supabase.rpc('submit_collab_command', {
      p_command_id: commandId,
      p_trip_id: tripId,
      p_command: command,
    })
    if (error) return rpcErrorToOutcome(error as { code?: unknown })
    if (!data || typeof data !== 'object') return { status: 'unavailable' }
    const receipt = data as RawReceipt & {
      stopId?: unknown
      winnerId?: unknown
      placementStatus?: unknown
      availableDays?: unknown
    }
    const tripRevision = revisionOf(receipt)
    switch (receipt.status) {
      case 'applied':
      case 'alreadyApplied': {
        if (command.type === 'suggestion.accept') {
          if (receipt.status === 'applied') {
            return typeof receipt.stopId === 'string' && receipt.stopId.length > 0
              ? { status: 'applied', tripRevision, stopId: receipt.stopId,
                ...(receipt.suggestion != null ? { suggestion: suggestionRowToEntry(receipt.suggestion) } : {}) }
              : { status: 'unavailable' }
          }
          // A retry of an already-accepted suggestion whose stop was later
          // removed from the timeline is a legitimate alreadyApplied with no
          // placement to point at — not a server failure.
          return typeof receipt.stopId === 'string' && receipt.stopId.length > 0
            ? { status: 'alreadyApplied', tripRevision, stopId: receipt.stopId,
              ...(receipt.suggestion != null ? { suggestion: suggestionRowToEntry(receipt.suggestion) } : {}) }
            : { status: 'alreadyApplied', tripRevision,
              ...(receipt.suggestion != null ? { suggestion: suggestionRowToEntry(receipt.suggestion) } : {}) }
        }
        if (command.type === 'decision.resolve') {
          if (typeof receipt.winnerId !== 'string' || !receipt.winnerId) return { status: 'unavailable' }
          const stopId = typeof receipt.stopId === 'string' ? receipt.stopId : ''
          const placementStatus = receipt.placementStatus
          const placement = placementStatus === 'applied' || placementStatus === 'alreadyApplied'
            ? stopId ? { status: placementStatus, stopId } : null
            : placementStatus === 'needsDay' && Array.isArray(receipt.availableDays)
              ? { status: 'needsDay' as const, availableDays: receipt.availableDays.flatMap((entry): Array<{ id: string; index: number; title?: string }> => {
                if (!entry || typeof entry !== 'object') return []
                const day = entry as { id?: unknown; index?: unknown; title?: unknown }
                return typeof day.id === 'string' && typeof day.index === 'number' && Number.isInteger(day.index)
                  ? [{ id: day.id, index: day.index, ...(typeof day.title === 'string' ? { title: day.title } : {}) }]
                  : []
              }) }
              : placementStatus === 'needsPlace' || placementStatus === 'notRequired'
                ? { status: placementStatus }
              : null
          if (placement) {
            const body = {
              tripRevision, winnerId: receipt.winnerId,
              ...(receipt.decision != null ? { decision: decisionRowToEntry(receipt.decision) } : {}), placement,
            }
            return receipt.status === 'applied'
              ? { status: 'applied' as const, ...body }
              : { status: 'alreadyApplied' as const, ...body }
          }
          return { status: 'unavailable' }
        }
        const base = {
          tripRevision,
          ...(receipt.suggestion != null ? { suggestion: suggestionRowToEntry(receipt.suggestion) } : {}),
          ...(receipt.decision != null ? { decision: decisionRowToEntry(receipt.decision) } : {}),
          ...(typeof receipt.activityId === 'string' ? { activityId: receipt.activityId } : {}),
          ...(idListOf(receipt.notificationIds) ? { notificationIds: idListOf(receipt.notificationIds) } : {}),
        }
        return receipt.status === 'applied'
          ? { status: 'applied' as const, ...base }
          : { status: 'alreadyApplied' as const, ...base }
      }
      case 'needsDay': {
        if (!Array.isArray(receipt.availableDays)) return { status: 'unavailable' }
        const availableDays = receipt.availableDays.flatMap((entry): Array<{ id: string; index: number; title?: string }> => {
          if (!entry || typeof entry !== 'object') return []
          const day = entry as { id?: unknown; index?: unknown; title?: unknown }
          if (typeof day.id !== 'string' || typeof day.index !== 'number' || !Number.isInteger(day.index)) return []
          return [{ id: day.id, index: day.index, ...(typeof day.title === 'string' ? { title: day.title } : {}) }]
        })
        return { status: 'needsDay', availableDays }
      }
      case 'needsPlace': return { status: 'needsPlace' }
      case 'needsDuplicate': {
        if (typeof receipt.dayId !== 'string' || receipt.dayId.length === 0) return { status: 'unavailable' }
        if (typeof receipt.dayIndex !== 'number' || !Number.isInteger(receipt.dayIndex)) return { status: 'unavailable' }
        return { status: 'needsDuplicate', tripRevision, dayId: receipt.dayId, dayIndex: receipt.dayIndex }
      }
      case 'conflict': return { status: 'conflict', tripRevision }
      case 'forbidden': return { status: 'forbidden' }
      case 'unavailable': return { status: 'unavailable' }
      case 'invalid': return { status: 'unavailable' }
      default: return { status: 'unavailable' }
    }
  } catch {
    return { status: 'unavailable' }
  }
}
