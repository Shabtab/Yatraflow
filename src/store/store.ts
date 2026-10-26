// ============ Application store (Supabase-backed) ============
// The app DB now lives in Supabase (Postgres + Auth). This module keeps the
// SAME public interface the UI already uses (useDb(), currentUser(), createTrip(),
// addStop(), …) but backs it with an in-memory cache that is hydrated from
// Supabase on auth and write-through on every mutation.
//
// Mutations update the cache synchronously and notify subscribers (so the UI is
// instant), then fire-and-forget the Supabase write. A failed write surfaces a
// toast; the cache is re-hydrated from the server on next load.
import { useSyncExternalStore } from 'react'
import type {
  CachedUser, PublicUser, PrivateUser, PrivateUserProfile, Trip, StopSuggestion, TripDecision, ActivityEntry, Notification,
  PublishedItinerary, ID, ItineraryStop, ItineraryDay, TripMember, Expense, FixedCommitment,
  NewDecisionOption, VehicleProfile, Comment, Vote, DecisionOption,
} from '../data/types'
import { STOP_CATEGORIES, STOP_STATUSES } from '../data/types'
import { seedData, uid } from '../data/seed'
import type { LatLngPoint } from '../data/types'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { toast } from '../components/ui'
import { DRIVES_PART_MISSING_REASON, drivesPartWriteVerdict, isMissingColumnError, rowToTrip, tripToRow, tripUpdateRow, type OptionalColumnsProbe, type TripRow } from '../lib/tripRow'
import type { ShareSource } from '../lib/shareUrl'
import { dayCountForRange } from '../lib/dayCount'
import { validHM } from '../lib/timefmt'
import { amountRefusal, amountVerdict } from '../lib/expenseAmount'
import { attachDnaAccount, detachDnaAccount } from '../lib/tripDna'
import { clearSnapshot, loadSnapshot, saveSnapshot } from '../lib/offlineCache'
import { randomToken } from '../lib/randomId'
import { campaignId, type CampaignId, type ForkOrigin } from '../lib/growthAttribution'
import {
  clearWritesFor, dropQueuedWrite, pendingWrites, queueWrite, requeueIfCurrent, shouldRetry, type QueuedWrite,
} from '../lib/writeQueue'
import { ownSuggestedCover, unclaimedCovers, coverCandidates, coverlessPublications } from '../lib/coverUpload'
import { fetchFirstAvailableThumb } from '../lib/tripThumb'
import { publishValidation, PUBLISH_FIELD_ORDER, PublishRejected } from '../lib/publishRules'
import { makeInviteCode, normalizeInviteCode } from '../lib/inviteCode'
import { publishedToRow } from '../lib/restoreRows'
import { reduceSlice, applyMemberChange, isRecentLocalWrite, isStaleServerRow } from '../lib/realtimeCore'
import { MISSING_BACKEND_MESSAGE, describeAuthFailure } from '../lib/authErrors'
import { nextOrderInDay, renumberDay } from '../lib/stopOrder'
import {
  submitCollabCommand, submitCollabTransition, suggestionRowToEntry, decisionRowToEntry,
  type AcceptanceOutcome, type DecisionResolutionOutcome, type CollabOutcome, type CollabCommand,
} from './collabCommand'
export type { AcceptanceOutcome, DecisionResolutionOutcome } from './collabCommand'
import { adminFromSession, clearAdminCache, isAdminCached, setAdminForTest } from '../lib/adminSession'
import {
  buildCatalog, type AccessScope, type CatalogReads, type CatalogResult, type PreviousCatalog, type SliceRead,
} from './profileCatalog'
import { toPublicUser, reviewedSocialLinks } from '../lib/publicProfile'
import {
  correlateSession, nextIncarnation, nextOperationId, sameSession,
  type Credentials, type ObservedSession, type Owner, type ReadTicket,
} from './sessionOwner'
import {
  beginLedger, settleLedger, applyLedger, ledgerHasPending, type FieldLedger,
} from './fieldIntents'

export { reviewedSocialLinks } from '../lib/publicProfile'
import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js'

// In-memory cache — the synchronous snapshot the UI reads. No localStorage.
interface DB {
  users: CachedUser[]       // public identity cards, plus the private row for self/admin (#800)
  trips: Trip[]
  /** Soft-deleted trips, fetched on demand from the get_trashed_trips RPC. */
  trashedTrips: Trip[]
  suggestions: StopSuggestion[]
  decisions: TripDecision[]
  activity: ActivityEntry[]
  notifications: Notification[]
  published: PublishedItinerary[]
  adminAudit: AdminAuditEntry[]
  sessionUserId: ID | null
  /** True once the first hydrate of this session has settled (success OR
   *  failure). Until then, "empty" is a lie — pages must show loading. */
  ready: boolean
  /** Which slices the last hydrate read SUCCESSFULLY, and which it failed
   *  (#364). `ready` above answers "has the hydrate settled", which is not the
   *  same question: a hydrate can settle with these two slices broken, and a
   *  page reading only `ready` would then render a failed read as a genuine
   *  empty gallery. The names are the ones the hydrate already collects in its
   *  local `partial` array — this is that array, published. */
  sliceReads: Record<string, 'ok' | 'failed'>
  /** Trash-bin read status (#387). The bin is fetched on demand from
   *  `get_trashed_trips`, never via hydrate, so it cannot ride `sliceReads`:
   *  a failed bin read and an empty bin rendered identically until these two
   *  bits existed. `loaded` flips on the first successful fetch; `failed`
   *  flips on any failed one (replace-on-success keeps the last good rows). */
  trashLoaded: boolean
  trashFailed: boolean
  /** When the rows on screen came from the offline snapshot (PWA phase 2),
   *  the moment that snapshot was taken; null when they came from the network.
   *  Drives the offline banner's "showing your saved plan from HH:MM" and is
   *  set by the cache boot below, cleared by every network hydrate. */
  cachedAt: number | null
  /** The audit tab's own read status (#367). A failed refresh used to be
   *  console-only, which made staleness invisible — an admin watching the tab
   *  could not tell "no actions" from "the read broke". Flips on any failed
   *  `refreshAdminAudit`; cleared on the next success (the tab renders a
   *  retry, mirroring the trash bin's honest-failure shape). */
  adminAuditFailed: boolean
  /** #800: the provenance of the installed catalogue — WHICH authority the
   *  private rows in `users` were collected under. One stamp beside the data it
   *  describes, never a second permission map: a public consumer reads `users`
   *  and never this. `selfAuthorized` records whether the owner's own row was
   *  private-and-authorised when it was installed, which is what lets a later
   *  run tell a stale self row from a current one. Null when the catalogue
   *  carries no private authority at all. */
  catalogAuthority: CatalogStamp | null
}

/** The authority an installed catalogue was built under. See `DB.catalogAuthority`. */
interface CatalogStamp {
  userId: ID | null
  identityEpoch: number
  authorityEpoch: number
  selfAuthorized: boolean
}

let cache: DB = {
  users: [], trips: [], trashedTrips: [], suggestions: [], decisions: [],
  activity: [], notifications: [], published: [], adminAudit: [], sessionUserId: null,
  ready: false, sliceReads: {}, trashLoaded: false, trashFailed: false, cachedAt: null, adminAuditFailed: false,
  catalogAuthority: null,
}

const listeners = new Set<() => void>()
let initialized = false

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function getSnapshot(): DB { return cache }

export function useDb(): DB {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** True once the first post-mount hydrate has settled. Gates every
 *  "empty state" in the app: before this, empty just means "still loading". */
export function useStoreReady(): boolean {
  return useSyncExternalStore(subscribe, () => cache.ready)
}

// ---------------- Slice-level selectors ----------------
// Since M3.1 every store mutation REPLACES its slice (cache.trips = [...]),
// so these per-slice snapshots are reference-stable between commits that
// touch them. A component subscribed to one slice therefore no longer
// re-renders when an unrelated slice commits (e.g. App no longer re-renders
// the whole page tree because a trip edit changed cache.trips).

export function useTrips(): Trip[] {
  return useSyncExternalStore(subscribe, () => cache.trips)
}

export function useTrashedTrips(): Trip[] {
  return useSyncExternalStore(subscribe, () => cache.trashedTrips)
}

/** Trash-bin read verdict (#387): `loaded` flips on the first successful
 *  `get_trashed_trips`, `failed` on any failed one. The page derives its three
 *  states from the pair (failed outranks; unloaded-unfailed is reading), so a
 *  failed bin read can never render the genuine-empty copy. */
export function useTrashLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => cache.trashLoaded)
}

export function useTrashFailed(): boolean {
  return useSyncExternalStore(subscribe, () => cache.trashFailed)
}

/** Per-slice hydrate verdicts (#364, #383). Narrow so My Trips re-renders only
 *  when the verdicts move, not on every unrelated store commit. */
export function useSliceReads(): Record<string, 'ok' | 'failed'> {
  return useSyncExternalStore(subscribe, () => cache.sliceReads)
}

export function usePublished(): PublishedItinerary[] {
  return useSyncExternalStore(subscribe, () => cache.published)
}

export function useUsers(): CachedUser[] {
  return useSyncExternalStore(subscribe, () => cache.users)
}

export function useNotifications(): Notification[] {
  return useSyncExternalStore(subscribe, () => cache.notifications)
}

export function useSessionUserId(): ID | null {
  return useSyncExternalStore(subscribe, () => cache.sessionUserId)
}

/**
 * #804 (B3) — the identity generation, observable from React.
 *
 * `identityEpoch` advances on every auth change: a sign-in, a sign-out, or a
 * profile gap. A component that holds state keyed to "who is signed in" must
 * reset when this changes, because the same user id can sign out and back in and
 * is then a NEW session with its own queues and its own access.
 *
 * The value itself is meaningless; only a change matters.
 */
export function useIdentityGeneration(): number {
  return useSyncExternalStore(subscribe, () => identityEpoch)
}

/** Synchronous read of the session's admin flag (true only after the first
 *  successful hydrate fetched the JWT role). Gates the #/admin route. */
export function useIsAdmin(): boolean {
  return useSyncExternalStore(subscribe, isAdminCached)
}

/** Admin audit entries (the audit-log tab's rows). Hydrated for admins only. */
export interface AdminAuditEntry {
  id: string
  actorId: string
  action: string
  targetType: string | null
  targetId: string | null
  detail: Record<string, unknown>
  at: number
}

export function useAdminAudit(): AdminAuditEntry[] {
  return useSyncExternalStore(subscribe, () => cache.adminAudit)
}

/** The audit read's own status (#367) — the tab renders a retry on true. */
export function useAdminAuditFailed(): boolean {
  return useSyncExternalStore(subscribe, () => cache.adminAuditFailed)
}

interface AuditRowShape {
  id: string; actor_id: string; action: string;
  target_type: string | null; target_id: string | null;
  detail: Record<string, unknown> | null; at: number
}

/** Minimal shape of the Supabase PostgREST query builder for admin_audit —
 *  kept narrow so the hydrate-race mock (which lacks order/limit) still fits. */
type AuditBuilder = {
  order: (col: string, opts: { ascending: boolean }) => AuditBuilder
  limit: (n: number) => Promise<{ data: unknown; error: unknown }>
}

/** Newest-first admin_audit rows. Degrades gracefully when the query builder
 *  lacks order()/limit() (the hydrate-race mock) — production PostgREST gets
 *  order+limit, anything else falls back to a plain select. */
async function fetchAdminAuditRows(): Promise<{ data: unknown; error: unknown }> {
  try {
    const base = supabase.from('admin_audit').select('*') as unknown as Partial<AuditBuilder> & PromiseLike<{ data: unknown; error: unknown }>
    const ordered = typeof base.order === 'function' ? base.order('at', { ascending: false }) : base
    const limited = typeof ordered.limit === 'function'
      ? await ordered.limit(200)
      : await (ordered as PromiseLike<{ data: unknown; error: unknown }>)
    return (limited ?? { data: [], error: null }) as { data: unknown; error: unknown }
  } catch (e) {
    return { data: [], error: e }
  }
}

function auditRowsToEntries(data: unknown): AdminAuditEntry[] {
  return mapOrSkip((data ?? []) as Record<string, unknown>[], r =>
    adminAuditRowToEntry(r as unknown as AuditRowShape))
}

export function adminAuditRowToEntry(r: {
  id: string; actor_id: string; action: string;
  target_type: string | null; target_id: string | null;
  detail: Record<string, unknown> | null; at: number
}): AdminAuditEntry {
  return {
    id: r.id, actorId: r.actor_id, action: r.action,
    targetType: r.target_type, targetId: r.target_id,
    detail: r.detail ?? {}, at: r.at,
  }
}

/** Immutable trip update: the mutator edits a CLONE that replaces the cached
 *  trip (and bumps updatedAt unless opted out). In-place edits kept the trip
 *  reference stable, so every `useMemo([trip])` downstream was stale-prone and
 *  worked only by accident. Returns the new trip (null when unknown). */
function mutateTrip(tripId: ID, fn: (draft: Trip) => void, opts: { touch?: boolean; log?: string; target?: string } = {}): Trip | null {
  const idx = cache.trips.findIndex(t => t.id === tripId)
  if (idx < 0) return null
  const draft = structuredClone(cache.trips[idx])
  fn(draft)
  if (opts.touch !== false) draft.updatedAt = Date.now()
  if (opts.log) void addActivity(tripId, opts.log, opts.target)
  cache.trips = [...cache.trips.slice(0, idx), draft, ...cache.trips.slice(idx + 1)]
  commit()
  return draft
}

function commit() {
  // Reassign the top-level cache so useSyncExternalStore sees a NEW reference
  // and re-renders subscribers. In-place mutations keep the same object
  // reference, which makes React bail out — the UI would not refresh after
  // add/edit/delete/reorder until some unrelated re-render happened.
  cache = { ...cache }
  listeners.forEach(l => l())
}

function patch(next: Partial<DB>) {
  cache = { ...cache, ...next }
}

/** The slices a page can ask about by name, and what the last hydrate made of
 *  each. Creator and gallery read `profiles` + `suggested itineraries` (#364);
 *  My Trips reads `trips` (#383) — the same `partial` list the hydrate already
 *  collects, published. Both are wide reads a dropped connection takes out
 *  while the session reads fine.
 *
 *  The VALUES are the exact strings the hydrate pushes into `partial`, read off
 *  it rather than renamed here: the published slice is pushed as
 *  'suggested itineraries', not 'published'. A mapping that invented its own
 *  names would report a real failure as a success, which is the one mistake
 *  this whole change exists to prevent.
 *
 *  This list is what a caller that names no set of its own is assumed to have
 *  read: the logged-out re-read's two public slices, plus `trips`, which only a
 *  signed-in hydrate touches. `rereadPublicSlices` patches exactly two keys
 *  (`sliceReadReport(failed)` then an explicit two-key merge), so it can never
 *  invent a trips verdict; the signed-in hydrate passes ITS OWN asked set,
 *  because a report that marked a slice 'ok' without having read it would be
 *  inventing a success — the mirror of the mistake above.
 *
 *  Trash is deliberately NOT here: the bin is fetched on demand from
 *  `get_trashed_trips`, never via hydrate, so it rides `trashLoaded` /
 *  `trashFailed` instead (adding it here would make `rereadPublicSlices`
 *  invent a verdict for a read it never issued). */
export const READ_SLICES = ['trips', 'profiles', 'suggested itineraries'] as const
export type ReadSlice = typeof READ_SLICES[number]

/** The two slices a logged-out page reads. The anonymous hydrate and
 *  `rereadPublicSlices` both report exactly this set, never `trips`. */
const PUBLIC_READ_SLICES = ['profiles', 'suggested itineraries'] as const

/** The trip-scoped reads a member's stage 2 issues, named as the verdict names them (#704). */
const TRIP_SCOPED_READS = ['members', 'suggestions', 'decisions', 'activity', 'notifications'] as const

/** Turn the hydrate's `partial` list into a per-slice verdict.
 *
 *  Everything the run asked for and did not name in `partial` succeeded. That
 *  inference is why this is built here rather than at each call site: a page
 *  reporting "unknown" for a slice the hydrate never asked about would be
 *  inventing a failure, and one reporting "ok" for a slice the hydrate skipped
 *  would be inventing a success.
 *
 *  `asked` is the set of slices THIS run actually read — the hydrate's full
 *  signed-in set, the public re-read's two, never a global constant — so a
 *  slice nobody read stays unreported (an unreported read is an unread one,
 *  which `sliceState` renders as 'reading') rather than silently 'ok'. */
export function sliceReadReport(partial: readonly string[], asked: readonly string[] = READ_SLICES): Record<string, 'ok' | 'failed'> {
  const failed = new Set(partial)
  const report: Record<string, 'ok' | 'failed'> = {}
  for (const slice of asked) report[slice] = failed.has(slice) ? 'failed' : 'ok'
  return report
}

/**
 * Re-read just the PUBLIC slices, for a page whose Retry must actually re-issue
 * the request rather than re-render the same empty array (#364).
 *
 * A full `hydrate` is the wrong tool here for two reasons: it needs a session
 * (these pages work logged-out), and it would refetch the signed-in user's whole
 * account to fix a gallery. This re-reads the same two tables the hydrate reads,
 * writes the same `sliceReads` verdict so the page's state machine moves on its
 * own, and — importantly — replaces the rows ONLY on success, so a second failed
 * retry cannot wipe good rows a previous hydrate managed to load.
 *
 * Never throws: the verdict is the report, and a caller renders from it.
 */
export async function rereadPublicSlices(): Promise<void> {
  // A throw is as much a failure as an error response, and must report as one
  // rather than leaving the page's previous verdict standing.
  // NOTE (#383): this re-read never touches the trips tables, so it must never
  // invent a trips verdict either — `sliceReadReport` covers every READ_SLICE,
  // and overwriting with it would mark trips ok/failed on evidence this read
  // never collected. Only the two public slices move; `trips` is preserved.
  //
  const failed: string[] = []
  try {
    const [publicUsers, pubRes] = await Promise.all([
      readPublicUsers(),
      supabase.from('published_itineraries').select('*'),
    ])
    if (publicUsers.failed) { console.error('[yatraflow] re-read profile cards failed'); failed.push('profiles') }
    if (pubRes.error) { console.error('[yatraflow] re-read published failed', pubRes.error); failed.push('suggested itineraries') }
    // Replace-on-success only, per slice. A retry that fails must not also wipe
    // the rows a previous hydrate managed to load — "still broken" and "now
    // empty as well" are different states, and only one of them is a regression.
    //
    // #800: the install goes through the same gate as a hydrate. This read is
    // PUBLIC-ONLY, so the constructor keeps every private row the current
    // authority still covers — the signed-in account's own, and an admin's bulk
    // — and takes the fresh public cards underneath them. It also emits no
    // verdict for the private slices, so a public retry can neither certify nor
    // revoke a read it never issued.
    if (!publicUsers.failed) {
      installCatalog(currentTicket(), {
        public: { users: publicUsers.users, failed: false, complete: true, requested: true },
        self: { status: 'not-requested' },
        admin: { status: 'not-requested' },
      })
    }
    if (!pubRes.error) patch({ published: dedupePublished(mapOrSkip((pubRes.data ?? []), rowToPublished)) })
  } catch (e) {
    // One throw fails the slices it was serving. Both reads run in one
    // Promise.all, so neither answered and both are reported — but a throw here
    // must not leave a stale verdict standing over the rows that are still on
    // screen.
    console.error('[yatraflow] public slice re-read failed', e)
    failed.push('profiles', 'suggested itineraries')
  }
  const report = sliceReadReport(failed)
  patch({ sliceReads: { ...cache.sliceReads, profiles: report.profiles, 'suggested itineraries': report['suggested itineraries'] } })
  commit()
}

/**
 * Re-issue the trips read for My Trips' Retry (#383). A full hydrate is the
 * right tool here (unlike #364's public re-read): the page is signed-in-only,
 * and the trips verdict depends on memberships + trips + members together —
 * re-reading one table cannot answer "is this empty list trustworthy".
 *
 * `seedIfEmpty: false` is load-bearing: a retry must never seed (same gate as
 * auto-seed — a broken read must show the error branch, not demo rows).
 * Never throws: the verdict is the report, and the page renders from it.
 */
export async function rereadTrips(): Promise<void> {
  const userId = cache.sessionUserId
  if (!userId) return
  try {
    await hydrateFromSupabase(userId, hydrateGen, false)
  } catch (e) {
    console.error('[yatraflow] trips re-read failed', e)
  }
}

// ---------------- Supabase row <-> domain mapping ----------------
// rowToTrip / tripToRow live in src/lib/tripRow.ts (pure, unit-tested).

interface ProfileRow {
  id: string; email: string; name: string; avatar_url?: string; home_city?: string;
  languages: string[]; travel_styles: string[]; is_creator: boolean; creator_bio?: string;
  social_links?: { youtube?: string; instagram?: string }; created_at: number;
  /** present only after the masteradmin migration (see 20260909_masteradmin.sql) */
  is_disabled?: boolean;
}

/** A row of `public.profile_cards` — what the public RPC returns. Snake_case,
 *  because it comes straight from PostgREST. */
interface ProfileCardRow {
  id: string; name: string; avatar_url?: string; is_creator: boolean; creator_bio?: string;
  social_links?: { youtube?: string; instagram?: string }; creator_available: boolean;
}

/** Shape of a trip_members row as stored in Postgres (snake_case). */
interface MemberRow {
  trip_id: string; user_id: string; role: TripMember['role']; joined_at: number;
}

/**
 * Map one public card. Carries NO account field: there is no email, no home
 * city, no languages, no travel styles, no account date and no administrative
 * flag in the input, so there is none in the output (#800). The old
 * `rowToUser` manufactured those fields from a whole private row; nothing here
 * can, because the row it is handed does not have them.
 */
export function rowToPublicUser(row: unknown): PublicUser {
  const r = row as ProfileCardRow
  return {
    id: r.id,
    kind: 'public',
    profile: {
      name: r.name,
      avatarUrl: r.avatar_url,
      isCreator: r.is_creator === true,
      creatorBio: r.creator_bio ?? undefined,
      socialLinks: r.social_links ?? undefined,
      creatorAvailable: r.creator_available !== false,
    },
  }
}

/** The outcome of a private `public.profiles` read (#800 R8). Three states, kept
 *  apart because their consumers act differently:
 *   * `ok`      — a row came back (or the account is legitimately absent);
 *   * `absent`  — the read succeeded and there is no row: a disabled account,
 *                 whose RESTRICTIVE policy withholds it from its own owner;
 *   * `failed`  — the read itself failed: network, RLS refusal, missing table.
 *  A collapse of `failed` into `absent` used to let a public RPC success report
 *  the signed-in account as ready while it was simply unreadable. */
type PrivateReadOutcome = SliceRead<PrivateUser>

/** The credentials a private request is bound to.
 *
 *  Captured with the owner that asked, so a request issued under one session
 *  keeps that session's bearer even while the shared SDK client's own auth state
 *  moves on. RLS remains the server boundary; this binds the client side to the
 *  account that asked. Never persisted into a snapshot, a user row, a report or
 *  a toast. */

/** The owner this module last published, and the credentials captured with it.
 *  `incarnation` advances only on a real session replacement, so a duplicate
 *  confirmation or a token refresh keeps every older ticket's key valid. */
let sessionOwner: Owner | null = null
let sessionCredentials: Credentials | null = null


function currentOwner(): Owner | null {
  return sessionOwner
}

function credentialsFor(owner: Owner | null): Credentials | null {
  if (!owner || !sessionCredentials) return null
  if (!sameSession(owner, sessionCredentials.owner)) return null
  return sessionCredentials
}

async function readSelfProfile(ticket: ReadTicket): Promise<PrivateReadOutcome> {
  const credentials = ticket.credentials
  if (credentials.bearer === '') return { status: 'failed', reason: 'credentials unavailable' }
  if (!sameSession(ticket.owner, credentials.owner) || !sameSession(ticket.owner, currentOwner())) return { status: 'failed', reason: 'session changed' }
  if (!isCurrentIdentity({ userId: ticket.owner.userId, epoch: identityEpoch })) {
    return { status: 'failed', reason: 'identity changed' }
  }
  try {
    const { data, error } = await pinBearer(
      supabase.from('profiles').select('*').eq('id', ticket.owner.userId).maybeSingle(),
      credentials.bearer,
    )
    if (!sameSession(ticket.owner, sessionOwner)) return { status: 'failed', reason: 'session changed' }
    if (error) return { status: 'failed', reason: error.message ?? 'read failed' }
    if (!data) return { status: 'absent' }
    return { status: 'ok', value: rowToPrivateUser(data) }
  } catch (e) {
    return { status: 'failed', reason: e instanceof Error ? e.message : 'read failed' }
  }
}

async function readAdminProfiles(scope: AccessScope, ticket: ReadTicket): Promise<SliceRead<readonly PrivateUser[]>> {
  if (!scope.admin || scope.authorityEpoch !== authorityEpoch || !isAdminCached() || !isCurrentIdentity({ userId: scope.userId ?? '', epoch: scope.identityEpoch })) {
    return { status: 'failed', reason: 'not authorised' }
  }
  const credentials = ticket.credentials
  if (credentials.bearer === '') return { status: 'failed', reason: 'credentials unavailable' }
  if (!sameSession(ticket.owner, credentials.owner) || !sameSession(ticket.owner, currentOwner())) return { status: 'failed', reason: 'session changed' }
  try {
    const { data, error } = await pinBearer(supabase.from('profiles').select('*'), credentials.bearer)
    if (!sameSession(ticket.owner, sessionOwner)) return { status: 'failed', reason: 'session changed' }
    if (!isCurrentIdentity({ userId: scope.userId ?? '', epoch: scope.identityEpoch })) {
      return { status: 'failed', reason: 'identity changed' }
    }
    if (scope.authorityEpoch !== authorityEpoch) return { status: 'failed', reason: 'authority revision changed' }
    if (!isAdminCached()) return { status: 'failed', reason: 'authority changed' }
    if (error) return { status: 'failed', reason: error.message ?? 'read failed' }
    return { status: 'ok', value: (Array.isArray(data) ? data : []).map(rowToPrivateUser) }
  } catch (e) {
    return { status: 'failed', reason: e instanceof Error ? e.message : 'read failed' }
  }
}

/**
 * The public half of every profile read (#800): the cards the RPC returns. The
 * private half is `readSelfProfile` (or, for an admin, a direct table read).
 * They are separate on purpose — one query cannot serve both, because RLS now
 * restricts the private table to self and admin.
 *
 * A failure is a failure and an empty catalogue is an empty catalogue: the two
 * must never collapse into one, or a broken read renders as "no users" (#383's
 * rule, applied to this slice). There is deliberately NO fallback to the private
 * table — a missing function must fail visibly, not quietly widen the boundary.
 */
async function readPublicUsers(): Promise<{ users: PublicUser[]; failed: boolean }> {
  try {
    const { data, error } = await supabase.rpc('get_public_profile_cards', {})
    if (error) return { users: [], failed: true }
    const rows = Array.isArray(data) ? data : []
    return { users: rows.map(rowToPublicUser), failed: false }
  } catch {
    return { users: [], failed: true }
  }
}

/** Map one private `public.profiles` row: the signed-in user's own, or one an
 *  authorised admin may read. This is the only mapper that touches an account
 *  field. */
export function rowToPrivateUser(row: unknown): PrivateUser {
  const r = row as ProfileRow
  const pub = rowToPublicUser({
    id: r.id, name: r.name, avatar_url: r.avatar_url, is_creator: r.is_creator,
    creator_bio: r.creator_bio, social_links: r.social_links,
    creator_available: r.is_disabled !== true,
  })
  return {
    id: r.id,
    kind: 'private',
    email: r.email,
    createdAt: r.created_at,
    profile: {
      ...pub.profile,
      homeCity: r.home_city ?? undefined,
      languages: r.languages ?? ['en'],
      travelStyles: (r.travel_styles ?? ['balanced']) as PrivateUserProfile['travelStyles'],
      isDisabled: r.is_disabled ?? false,
    },
  }
}

/**
 * The merge rule, in one place, because it is the whole boundary on the client
 * side (#800). A public entry's reviewed fields land on the entry it meets; the
 * private fields of a private entry are never written from the public channel,
 * because a public card does not carry them. An id that arrives twice resolves to
 * the private entry, which is what the natural hydrate shape produces: the public
 * catalogue holds a card for the signed-in user, and the self read adds their
 * private row beside it.
 */
export function mergeUsers(current: CachedUser[], incoming: CachedUser[]): CachedUser[] {
  const byId = new Map<string, CachedUser>()
  for (const u of [...current, ...incoming]) {
    const held = byId.get(u.id)
    if (held?.kind === 'private' && u.kind === 'public') {
      // Keep the private row, take the public row's reviewed fields.
      byId.set(u.id, { ...held, profile: { ...held.profile, ...u.profile } })
      continue
    }
    byId.set(u.id, u)
  }
  return [...byId.values()]
}

/**
 * Project the reviewed public identity of every cached entry (#800). A private
 * entry is NOT dropped: it still has a public identity — a name, an avatar, a
 * creator marker — and the offline directory needs it. What is dropped is the
 * private DATA, by taking only the public shape.
 *
 * The nested object is REBUILT, not copied. An authorized private row may hold
 * arbitrary nested keys, and the client cannot see what the database allowed in,
 * so a direct copy would put them in the public snapshot.
 */
export function publicOnlyUsers(users: CachedUser[]): PublicUser[] {
  return users.map(toPublicUser)
}

/**
 * Narrow a cached identity to its private row (#800). The admin console and the
 * admin stats are the only two surfaces that legitimately hold private rows for
 * OTHER accounts, and both go through this one guard — so the day a third surface
 * wants an email, it has to narrow too, and the compiler says where.
 */
export function privateUser(u: CachedUser | null | undefined): u is PrivateUser {
  return u?.kind === 'private'
}

/**
 * Read a `users` slice back from an offline snapshot and keep ONLY what a public
 * card may hold (#800). A snapshot written before this boundary shipped whole
 * private rows — email, home city, languages, travel styles and the disabled flag
 * included — and a cold boot must not put them back into the cache. A thing that
 * is not a public card is dropped rather than coerced, because coercing is how a
 * private field would sneak back in.
 */
export function sanitizeSnapshotUsers(rows: unknown[]): PublicUser[] {
  const out: PublicUser[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (typeof r.id !== 'string') continue
    // A pre-#800 snapshot row carried the name inside `profile` and nothing at the
    // top level; a current card carries it in `profile` too. Read it from wherever
    // it legitimately is, and drop the row when neither has a usable name.
    const profile = (r.profile && typeof r.profile === 'object' ? r.profile : {}) as Record<string, unknown>
    const name = typeof profile.name === 'string' ? profile.name : typeof r.name === 'string' ? r.name : null
    if (name === null) continue
    // Availability is DERIVED, never trusted from the snapshot. An old snapshot
    // carries `isDisabled: true` and no `creatorAvailable`, and reading the absent
    // flag as `!== false` restored a disabled creator as publicly available — the
    // exact suppression this change exists to enforce. So: an explicit false, or a
    // true administrative flag, both mean unavailable; anything else means
    // available. The administrative flag itself is NOT carried forward.
    const disabled = profile.isDisabled === true
    const available = profile.creatorAvailable === false ? false : !disabled
    out.push({
      id: r.id,
      kind: 'public',
      profile: {
        name,
        avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : undefined,
        isCreator: profile.isCreator === true,
        creatorBio: typeof profile.creatorBio === 'string' ? profile.creatorBio : undefined,
        socialLinks: reviewedSocialLinks(profile.socialLinks),
        creatorAvailable: available,
      },
    })
  }
  return out
}

// ---------------- Auth ----------------

export function currentUser(db: DB = getSnapshot()): PrivateUser | null {
  const found = db.users.find(u => u.id === db.sessionUserId)
  // Only a PRIVATE entry is the signed-in account. A public card for the same id
  // is a name and an avatar, not an account: handing it back would let
  // `updateProfile` and the profile page read `undefined` as an email.
  return found?.kind === 'private' ? found : null
}

/** Email/password sign in via Supabase Auth. */
export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  // Fail with the *cause* instead of letting the placeholder client produce a
  // confusing "Failed to fetch" that reads like a wrong password.
  if (!isSupabaseConfigured) return { ok: false, error: MISSING_BACKEND_MESSAGE }
  try {
    // Lowercased to match signup(): Supabase stores the address it was given,
    // so "Me@X.com" at signup and "me@x.com" at login are different users.
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) return { ok: false, error: describeAuthFailure(error, { configured: true }) }
    return { ok: true }
  } catch (e) {
    // Network failures *throw* (AuthRetryableFetchError) rather than returning
    // { error } — without this the promise rejects and the form just re-enables
    // after its failsafe timeout with no message at all.
    return { ok: false, error: describeAuthFailure(e, { configured: true }) }
  }
}

/** Email/password sign up via Supabase Auth. Profile row is created by the DB trigger.
 *  `needsConfirmation` is true when the account exists but has no session yet,
 *  because Supabase waits for the email link. That is a success, not an error. */
export async function signup(name: string, email: string, password: string): Promise<{ ok: boolean; error?: string; needsConfirmation?: boolean }> {
  const cleanEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, error: 'Enter a valid email address.' }
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' }
  if (!isSupabaseConfigured) return { ok: false, error: MISSING_BACKEND_MESSAGE }
  try {
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail, password,
      options: { data: { name: name.trim() } },
    })
    if (error) return { ok: false, error: describeAuthFailure(error, { configured: true }) }
    // Supabase may need email confirmation. The account exists, but there is no session yet.
    if (data.session === null) return { ok: true, needsConfirmation: true }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: describeAuthFailure(e, { configured: true }) }
  }
}

export async function logout(): Promise<void> {
  // #393: the sign-out INSTANT used to render the departing account's rows
  // until the async auth event's hydrate(null) landed — Account A's trips (and
  // their Trash) still on screen while signed out, for a frame or a round
  // trip. A synchronous minimal clear makes the app render logged-out
  // immediately; the auth event then loads the anonymous catalogs, and the
  // generation guard keeps a late hydrate from re-patching the old user back
  // in (issue #45).
  ++hydrateGen
  // The identity epoch also ends the Trash and audit reads this account started.
  ++identityEpoch
  lastAuthUserId = null
  activeHydrate = null
  disconnectRealtime()
  detachDnaAccount()
  recentLocalWrites.clear()
  serverTripTimestamps.clear()
  queuedLocalTrips.clear()
  editableTripGrants.clear()
  tripAccessEpochs.clear()
  clearAdminCache()
  const departing = cache.sessionUserId
  // The rows go with the authority they were read under: an empty catalogue
  // carries no private authority, so the stamp is nulled beside it.
  patch({ trips: [], trashedTrips: [], trashLoaded: false, trashFailed: false, users: [], catalogAuthority: null, suggestions: [], decisions: [], activity: [], notifications: [], published: [], adminAudit: [], adminAuditFailed: false, sessionUserId: null, ready: true, cachedAt: null })
  commit()
  // #578 — the in-memory debounce timers are a module Map that knows nothing
  // of auth, and they outlive this wipe unless told not to. A timer firing
  // after this point would RE-QUEUE an entry the wipe deliberately discarded,
  // stamped with the trip owner's id (sessionUserId is already null) and sent
  // under whatever JWT is live at fire time — the next account's on an A→B
  // switch. Cancel and drop: losing the last ≤600ms of edits is the intended
  // trade, exactly parallel to the durable wipe below. Do NOT "fix" this by
  // flushing instead — that re-introduces the leak the wipe exists to close.
  _cancelTripWrites()
  // hydrate(null) skips the snapshot/write cleanup when sessionUserId is
  // already null — which it now always is by this point — so the departing
  // account's snapshot and unsynced writes are cleared HERE. Their edits are
  // theirs alone: the next person on this device must never be the one whose
  // session "syncs" them.
  if (departing) { void clearSnapshot(departing); void clearWritesFor(departing) }
  await supabase.auth.signOut()
  // onAuthStateChange handler loads the anonymous catalogs.
}

/** A disabled account can still complete Auth (Supabase has no soft-delete),
 *  but the RESTRICTIVE "deny disabled" policies make every table read as
 *  denied. Signing in successfully and then staring at empty catalogs would
 *  read as "my data got deleted", so hydrate checks the flag right after the
 *  session resolves and signs the account straight back out with a message. */
export async function enforceDisabledCheck(): Promise<boolean> {
  return withDisabledCheck(runRecheckDisabledStatus)
}

interface StatusRequest {
  owner: Owner
  authorityEpoch: number
  promise: Promise<boolean>
}

let statusRequest: StatusRequest | null = null

function withDisabledCheck(run: (owner: Owner) => Promise<boolean>): Promise<boolean> {
  const owner = currentOwner()
  if (!owner) return Promise.resolve(false)
  const inFlight = statusRequest
  if (inFlight && sameSession(inFlight.owner, owner) && inFlight.authorityEpoch === owner.authorityEpoch) {
    return inFlight.promise
  }
  const promise = run(owner)
  const request: StatusRequest = { owner, authorityEpoch: owner.authorityEpoch, promise }
  statusRequest = request
  promise.then(() => { if (statusRequest === request) statusRequest = null },
    () => { if (statusRequest === request) statusRequest = null })
  return promise
}

/** Ask the server whether the CALLER is disabled, when the cache cannot say — or
 *  when the cache's answer is too old to be worth trusting.
 *
 *  A reconnect, a resume and a failed self read all land here. The socket was
 *  down or the process was frozen, so a disablement that arrived in that gap is
 *  invisible to every read that came back, and the cached row still says enabled.
 *  Asking is the only honest answer.
 *
 *  `is_disabled()` is the existing security-definer helper: it reads
 *  `where p.id = auth.uid()`, so it answers about the caller and nobody else, and
 *  it already holds its execute grant. A disabled account then answers `true`
 *  even though the RESTRICTIVE policy withholds its own row. A missing helper
 *  answers `false` — unproven, never a lockout. */
export async function recheckDisabledStatus(): Promise<boolean> {
  return withDisabledCheck(runRecheckDisabledStatus)
}

async function runRecheckDisabledStatus(owner: Owner): Promise<boolean> {
  try {
    const credentials = credentialsFor(owner)
    if (!credentials || credentials.bearer === '') return false
    const disabled = await disabledOnServer(credentials)
    const now = currentOwner()
    if (!now || !sameSession(now, owner)) return false
    if (owner.authorityEpoch !== authorityEpoch) return false
    if (cache.sessionUserId !== owner.userId) return false
    return disabled ? signOutDisabled(owner) : false
  } catch {
    return false
  }
}

async function disabledOnServer(credentials: Credentials): Promise<boolean> {
  const { data, error } = await pinBearer(supabase.rpc('is_disabled'), credentials.bearer)
  if (error || typeof data !== 'boolean') return false
  return data
}

interface OwnedSignOut {
  id: number
  owner: Owner
  successorEpoch: number | null
}

let ownedSignOut: OwnedSignOut | null = null

/** Retire the owned sign-out because another session took over. */
function retireOwnedSignOut(): void {
  ownedSignOut = null
}

function signOutCompletedFor(record: OwnedSignOut): boolean {
  if (!ownedSignOut || ownedSignOut.id !== record.id) return false
  const now = currentOwner()
  if (now && sameSession(now, record.owner) && now.authorityEpoch === record.owner.authorityEpoch) return true
  return !now && record.successorEpoch === identityEpoch && cache.sessionUserId === null
}

async function signOutDisabled(owner: Owner): Promise<boolean> {
  const record: OwnedSignOut = { id: nextOperationId(), owner, successorEpoch: null }
  ownedSignOut = record
  let completed = false
  try {
    await supabase.auth.signOut()
    completed = signOutCompletedFor(record)
  } finally {
    if (ownedSignOut?.id === record.id) ownedSignOut = null
  }
  if (!completed) return false
  clearAdminCache()
  toast('This account has been disabled. Contact support if you think this is a mistake.', 'err')
  return true
}

// ---------------- Init / hydration ----------------

/** Guard against duplicate concurrent hydrations. On app load BOTH
 *  `getSession()` and the `onAuthStateChange()` "SIGNED_IN" event fire, which
 *  started two `hydrateFromSupabase` calls racing. The second one's full
 *  `patch({ trips })` overwrote the first's cache mid-seed — the seed appends
 *  the 10 trips AFTER that patch — so the trips loaded and then vanished. A
 *  redundant hydrate for the same user now just awaits the in-flight one. */
let activeHydrate: { userId: string | null; owner: Owner | null; authorityEpoch: number; promise: Promise<void | boolean> } | null = null
let hydrateObservedSession: ((userId: string | null, owner: Owner | null) => Promise<void>) | null = null

/** Monotonic id of the newest auth intent. Every auth event (sign-in, account
 *  switch, sign-out) bumps it, and a hydrate commits its `patch()` only while its
 *  own generation is still current. Without this, `hydrate(null)` on logout
 *  cleared the cache and nulled `activeHydrate` while a hydrate was still in
 *  flight, and that hydrate then re-patched the PREVIOUS user's trips — and their
 *  `sessionUserId` — into the emptied cache, so the next person on that browser
 *  could see, and be treated as, the account that had just signed out. Issue #45. */
let hydrateGen = 0

/** Changes only on a real account change: a sign-out, or a sign-in as another user.
 *  A same-user event leaves it alone. Trash and admin audit reads capture it before
 *  their await, and drop their result only when it has changed. hydrateGen cannot
 *  do this job, because every same-user sign-in event bumps it. */
let identityEpoch = 0

/** The user id of the newest auth event. hydrate() compares against it, not against
 *  cache.sessionUserId, which lags behind during an account switch. */
let lastAuthUserId: string | null = null

type IdentityScope = { userId: string; epoch: number }
function identityScope(): IdentityScope | null {
  return cache.sessionUserId ? { userId: cache.sessionUserId, epoch: identityEpoch } : null
}
function isCurrentIdentity(scope: IdentityScope): boolean {
  return scope.epoch === identityEpoch && cache.sessionUserId === scope.userId
    && (lastAuthUserId === null || lastAuthUserId === scope.userId)
}

// ---------------- #800: the authority revision and the one installer ----------------

/** Moves on every OBSERVED admin loss or regain, including a same-ID transition.
 *
 *  `identityEpoch` cannot do this job: an admin true → false → true cycle keeps
 *  the same user, so the identity check reads the old session as current and the
 *  private rows that authority unlocked stay installed. */
let authorityEpoch = 0

/** The admin flag this module last observed, so a change is detectable at all. */
let observedAdmin = false

function observeAdminAuthority(): void {
  const admin = isAdminCached()
  if (admin === observedAdmin) return
  observedAdmin = admin
  ++authorityEpoch
  if (ownedSignOut?.successorEpoch === null) retireOwnedSignOut()
  ledgers.clear()
  retireOperations()
  retireRefreshWorker()
  if (sessionOwner) {
    sessionOwner = { ...sessionOwner, authorityEpoch }
    if (sessionCredentials) sessionCredentials = { ...sessionCredentials, owner: sessionOwner }
  }
  reprojectCatalog()
}

function scopeForInstall(): AccessScope {
  observeAdminAuthority()
  const userId = cache.sessionUserId
  return userId
    ? { userId, identityEpoch, authorityEpoch, admin: isAdminCached() }
    : { userId: null, identityEpoch, authorityEpoch, admin: false }
}

function previousCatalog(): PreviousCatalog {
  const stamp = cache.catalogAuthority
  if (!stamp) return { ownerUserId: null, identityEpoch: null, authorityEpoch: null, selfAuthorized: false, users: [] }
  return {
    ownerUserId: stamp.userId,
    identityEpoch: stamp.identityEpoch,
    authorityEpoch: stamp.authorityEpoch,
    selfAuthorized: stamp.selfAuthorized,
    users: cache.users,
  }
}

/** A read's ticket: the authority it was taken under, and the hydrate generation
 *  that issued it. An install is judged against BOTH, and a ticket is never
 *  refreshed to fit an answer that arrived late. */
interface InstallTicket {
  scope: AccessScope
  generation: number
}


interface OperationRecord {
  id: number
  kind: string
  ticket: InstallTicket
  retired: boolean
}

let operationSeq = 0

/** Every operation that has not yet completed. Retired in place by a session
 *  replacement, so a late completion can see that it no longer owns anything. */
const liveOperations = new Set<OperationRecord>()

function startOperation(kind: string, ticket: InstallTicket): OperationRecord {
  const record: OperationRecord = { id: ++operationSeq, kind, ticket, retired: false }
  liveOperations.add(record)
  return record
}

function retireOperations(): void {
  for (const record of liveOperations) record.retired = true
  liveOperations.clear()
}

function operationIsLive(record: OperationRecord): boolean {
  const scope = record.ticket.scope
  return !record.retired && scope.userId === cache.sessionUserId
    && scope.identityEpoch === identityEpoch && scope.authorityEpoch === authorityEpoch
    && scope.admin === isAdminCached()
}

function finishOperation(record: OperationRecord): void {
  record.retired = true
  liveOperations.delete(record)
}

function installCatalog(ticket: InstallTicket, reads: CatalogReads, previous?: PreviousCatalog): InstallOutcome {
  const retired = retiredReason(ticket)
  if (retired) return { status: 'retired', reason: retired }
  const scope = ticket.scope
  const observedIds = new Set<ID>()
  if (reads.public.requested && !reads.public.failed) {
    for (const user of reads.public.users) observedIds.add(user.id)
    if (reads.public.complete) for (const user of cache.users) observedIds.add(user.id)
  }
  if (reads.self.status === 'ok') observedIds.add(reads.self.value.id)
  if (reads.self.status === 'absent' && scope.userId) observedIds.add(scope.userId)
  if (reads.admin.status === 'ok') {
    for (const user of [...cache.users, ...reads.admin.value]) observedIds.add(user.id)
  }
  for (const id of observedIds) profileReadRevisions.set(id, (profileReadRevisions.get(id) ?? 0) + 1)
  const built = buildCatalog(scope, reads, previous ?? previousCatalog())
  const result = { ...built, users: built.users.map(user => {
    const ledger = ledgers.get(user.id)
    return user.kind === 'private' && ledger ? { ...user, profile: applyLedger(ledger, user.profile) } : user
  }) }
  patch({
    users: result.users,
    catalogAuthority: {
      userId: scope.userId,
      identityEpoch: scope.identityEpoch,
      authorityEpoch: scope.authorityEpoch,
      selfAuthorized: result.selfAuthorized,
    },
    sliceReads: { ...cache.sliceReads, ...result.verdicts },
  })
  commit()
  return { status: 'installed', result }
}

type InstallOutcome =
  | { status: 'installed'; result: CatalogResult }
  | { status: 'retired'; reason: string }

function retiredReason(ticket: InstallTicket): string | null {
  if (ticket.scope.userId !== cache.sessionUserId) return 'identity changed'
  if (ticket.scope.identityEpoch !== identityEpoch) return 'identity generation changed'
  if (ticket.scope.authorityEpoch !== authorityEpoch) return 'authority revision changed'
  if (ticket.scope.admin !== isAdminCached()) return 'authority changed'
  if (ticket.generation !== hydrateGen) return 'a newer hydrate superseded this run'
  return null
}

function currentTicket(): InstallTicket {
  return { scope: scopeForInstall(), generation: hydrateGen }
}


interface RefreshWorker {
  ownerKey: string
  requestedSequence: number
  completedSequence: number
  waiters: Array<{ target: number; resolve: (outcome: RefreshOutcome) => void }>
}
type RefreshOutcome = 'applied' | 'failed' | 'retired'

/** One worker per owner. A different session or authority never joins another
 *  owner's worker: it starts its own and does not wait for the other's transport. */
let refreshWorker: RefreshWorker | null = null

/** The ownership key of a private refresh worker. */
function refreshOwnerKey(ticket: InstallTicket): string {
  const s = ticket.scope
  return `${s.userId ?? ''}:${s.identityEpoch}:${s.authorityEpoch}:${s.admin ? 1 : 0}:${ticket.generation}`
}

/** Settle every waiter whose target sequence a completed read covered. */
function settleRefreshWaiters(worker: RefreshWorker, outcome: RefreshOutcome): void {
  const covered = worker.waiters.filter(w => w.target <= worker.completedSequence)
  worker.waiters = worker.waiters.filter(w => w.target > worker.completedSequence)
  for (const waiter of covered) waiter.resolve(outcome)
}

/** Resolve a retired owner's waiters explicitly, so they never hang. */
function retireRefreshWaiters(worker: RefreshWorker): void {
  const waiters = worker.waiters
  worker.waiters = []
  for (const waiter of waiters) waiter.resolve('retired')
}

/** Retire the refresh worker itself. Called from the observation seam when a
 *  different session id supersedes the owner that started it. */
function retireRefreshWorker(): void {
  const worker = refreshWorker
  refreshWorker = null
  if (worker) retireRefreshWaiters(worker)
}

/** Re-read the private rows the CURRENT authority still covers, and install them
 *  through the one gate. Safe events and the reconnect replay both carry only
 *  public fields, so a private change — an admin's disabled flag, a preference —
 *  stays stale until something asks the private table again.
 *
 *  A caller who is not an admin and whose own row is the only private row reads
 *  just that one; a non-admin caller with no private authority reads nothing.
 *  Fenced to the captured ticket, so a refresh issued before an authority loss is
 *  discarded rather than stamped with the new grant. */
function coalescedPrivateRefresh(ticket: InstallTicket): Promise<RefreshOutcome> {
  if (retiredReason(ticket)) return Promise.resolve('retired')
  const key = refreshOwnerKey(ticket)
  const existing = refreshWorker?.ownerKey === key ? refreshWorker : null
  const worker: RefreshWorker = existing ?? { ownerKey: key, requestedSequence: 0, completedSequence: 0, waiters: [] }
  const target = ++worker.requestedSequence
  const promise = new Promise<RefreshOutcome>(resolve => { worker.waiters.push({ target, resolve }) })
  if (!existing) {
    retireRefreshWorker()
    refreshWorker = worker
    void runRefreshWorker(worker, ticket)
  }
  return promise
}

/** Bound on passes per task turn, so a continuous burst cannot hold the turn. */
const REFRESH_PASSES_PER_TURN = 4

async function runRefreshWorker(worker: RefreshWorker, ticket: InstallTicket): Promise<void> {
  for (let pass = 0; pass < REFRESH_PASSES_PER_TURN && refreshWorker === worker; pass++) {
    const target = worker.requestedSequence
    const outcome = await runPrivateRefresh(ticket)
    if (refreshWorker !== worker) return
    worker.completedSequence = target
    settleRefreshWaiters(worker, outcome)
    if (outcome === 'retired') { retireRefreshWorker(); return }
    if (worker.completedSequence === worker.requestedSequence) { refreshWorker = null; return }
  }
  if (refreshWorker === worker) setTimeout(() => { void runRefreshWorker(worker, ticket) }, 0)
}

async function runPrivateRefresh(ticket: InstallTicket): Promise<RefreshOutcome> {
  if (retiredReason(ticket) || ticket.scope.userId === null) return 'retired'
  const owner = currentOwner()
  const credentials = credentialsFor(owner)
  let self: SliceRead<PrivateUser> = { status: 'not-requested' }
  let admin: SliceRead<readonly PrivateUser[]> = { status: 'not-requested' }
  if (!owner || !credentials) {
    if (ticket.scope.admin) admin = { status: 'failed', reason: 'credentials unavailable' }
    else self = { status: 'failed', reason: 'credentials unavailable' }
  } else {
    const readTicket = { owner, credentials }
    if (ticket.scope.admin) admin = await readAdminProfiles(ticket.scope, readTicket)
    else self = await readSelfProfile(readTicket)
  }
  if (retiredReason(ticket)) return 'retired'
  // The public catalogue was NOT read here, so this run says nothing about it:
  // an existing public failure must survive a successful private read.
  const outcome = installCatalog(ticket, {
    public: { users: previousCatalog().users.map(toPublicUser), failed: false, complete: false, requested: false },
    self,
    admin,
  })
  if (outcome.status === 'retired') return 'retired'
  return self.status === 'failed' || admin.status === 'failed' ? 'failed' : 'applied'
}

/** Whether a `profile_cards` event for `id` is one this caller may follow with a
 *  private read. The caller's own row always is. Another account's row is only an
 *  admin's, so a non-admin other-user event stays public-only. */
function privateRefreshRelevant(ticket: InstallTicket, id: ID): boolean {
  if (ticket.scope.userId === null) return false
  if (ticket.scope.admin) return true
  return id === ticket.scope.userId
}

interface OwnedFields {
  id: ID
  patch: Partial<PrivateUserProfile>
}

/** One ledger per edited account row, holding that row's confirmed bases and the
 *  ordered intents issued against them. */
const ledgers = new Map<ID, FieldLedger>()
const profileMutationCursors = new Map<ID, number>()
const profileReadRevisions = new Map<ID, number>()

/** Install an optimistic edit to a private row, through the one gate.
 *
 *  The edit's intents are recorded in the row's ledger BEFORE the install, so the
 *  visible value is the newest accepted-or-pending intent in issue order rather
 *  than whatever the array happens to hold.
 *
 *  Returns the ownership record the completion needs, or null when the caller
 *  holds no authority to edit that row at all. */
function installCatalogEdit(owned: OwnedFields, apply: (u: PrivateUser) => PrivateUser): OperationRecord | null {
  const ticket = currentTicket()
  const before = previousCatalog()
  const stamp = cache.catalogAuthority
  // Only an identity this module still considers current, holding the authority
  // the installed catalogue was built under, may transform it.
  if (ticket.scope.userId === null || !stamp || stamp.authorityEpoch !== ticket.scope.authorityEpoch) return null
  const operation = startOperation('profile-edit', ticket)
  const held = before.users.find(u => u.id === owned.id && u.kind === 'private')
  if (!held || held.kind !== 'private') { finishOperation(operation); return null }
  ledgers.set(owned.id, beginLedger(ledgers.get(owned.id), held.profile, operation.id, owned.patch))
  profileMutationCursors.set(owned.id, operation.id)
  const mutated: CachedUser[] = before.users.map(u => (u.id === owned.id && u.kind === 'private' ? apply(u) : u))
  const outcome = installCatalog(ticket, {
    public: { users: mutated.map(toPublicUser), failed: false, complete: false, requested: false },
    self: { status: 'not-requested' },
    admin: { status: 'not-requested' },
  }, { ...before, users: mutated })
  if (outcome.status !== 'installed') {
    ledgers.delete(owned.id)
    finishOperation(operation)
    return null
  }
  return operation
}

/** Settle one operation's intents and reinstall the row from the reducer.
 *
 *  A refusal contributes nothing: the visible value is the last non-failed intent
 *  in issue order, otherwise the confirmed base. So an older refusal cannot undo
 *  a newer accepted edit even when the two wrote the same value, and two refusals
 *  in either completion order converge on the base. */
function settleOwnedFields(owned: OwnedFields, record: OperationRecord, outcome: 'accepted' | 'failed'): void {
  if (!operationIsLive(record)) return
  finishOperation(record)
  const ticket = currentTicket()
  const before = previousCatalog()
  const held = before.users.find(u => u.id === owned.id && u.kind === 'private')
  if (!held || held.kind !== 'private') return
  const previousLedger = ledgers.get(owned.id)
  if (!previousLedger) return
  const ledger = settleLedger(previousLedger, record.id, outcome)
  ledgers.set(owned.id, ledger)
  // Only the fields this ledger covers are rewritten. A field the ledger never
  // mentioned keeps the row's value, so an unrelated live rename
  // or another account's edit is not disturbed.
  const profile = applyLedger(ledger, held.profile)
  const mutated: CachedUser[] = before.users.map(u => (u.id === owned.id && u.kind === 'private'
    ? { ...u, profile }
    : u))
  installCatalog(ticket, {
    public: { users: mutated.map(toPublicUser), failed: false, complete: false, requested: false },
    self: { status: 'not-requested' },
    admin: { status: 'not-requested' },
  }, { ...before, users: mutated })
  if (!ledgerHasPending(ledger)) {
    ledgers.delete(owned.id)
    void reconcileProfileEdits(owned.id, record.ticket.scope)
  }
}

/** Drop one entry from the installed catalogue, through the one gate. Returns the
 *  ownership record the refusal needs, or null when there was nothing to drop or
 *  the caller holds no authority. */
function removeCatalogEntry(id: ID): OperationRecord | null {
  const ticket = currentTicket()
  if (retiredReason(ticket)) return null
  const before = previousCatalog()
  // Nothing to drop is a successful no-op, not a refusal.
  if (!before.users.some(u => u.id === id)) return startOperation('profile-delete', ticket)
  const stamp = cache.catalogAuthority
  if (ticket.scope.userId === null || !stamp || stamp.authorityEpoch !== ticket.scope.authorityEpoch) return null
  const mutated = before.users.filter(u => u.id !== id)
  const outcome = installCatalog(ticket, {
    public: { users: mutated.map(toPublicUser), failed: false, complete: false, requested: false },
    self: { status: 'not-requested' },
    admin: { status: 'not-requested' },
  }, { ...before, users: mutated })
  return outcome.status === 'installed' ? startOperation('profile-delete', ticket) : null
}

/** Restore the one entry a refused delete removed, and only that entry.
 *
 *  The current catalogue is the starting point, so an unrelated rename that
 *  landed while the request was in flight survives. A whole-array restore would
 *  overwrite it. */
function restoreCatalogEntry(record: OperationRecord, row: CachedUser): void {
  if (!operationIsLive(record)) return
  finishOperation(record)
  const ticket = record.ticket
  const before = previousCatalog()
  if (before.users.some(u => u.id === row.id)) return
  const mutated = [...before.users, row]
  installCatalog(ticket, {
    public: { users: mutated.map(toPublicUser), failed: false, complete: false, requested: false },
    self: { status: 'not-requested' },
    admin: { status: 'not-requested' },
  }, { ...before, users: mutated })
}

/** Replace the installed catalogue with nothing, through the same gate. The
 *  throw path and the identity reset use it, so a catalogue that dies mid-read
 *  still leaves its rows and its stamp agreeing. */
function clearInstalledCatalog(): void {
  installCatalog(currentTicket(), {
    public: { users: [], failed: false, complete: true, requested: false },
    self: { status: 'not-requested' },
    admin: { status: 'not-requested' },
  })
}

/** Project the installed catalogue under the authority that is current NOW, with
 *  no read at all. Runs before any network call, so an admin loss is visible on
 *  the next render instead of after a round-trip that may never come. */
function reprojectCatalog(): void {
  const ticket = currentTicket()
  if (ticket.scope.userId === null) return
  installCatalog(ticket, {
    public: { users: [], failed: true, complete: false, requested: false },
    self: { status: 'not-requested' },
    admin: { status: 'not-requested' },
  })
}

/** Pending snapshots stay separate from server revisions and account identities. */
const queuedLocalTrips = new Map<string, QueuedWrite>()

/**
 * A copy with a reason cannot sync. It must never show as the visible plan
 * and it must never be held as the local copy, because a later edit would
 * capture that stale proposal as a fresh whole-plan write.
 */
function isHeldCopy(write: QueuedWrite): boolean {
  return !write.reason
}

function overlayQueuedTrips(trips: Trip[], writes: QueuedWrite[], userId: string): Trip[] {
  return trips.map(trip => {
    const write = writes.find(w => w.tripId === trip.id && w.ownerId === userId)
    if (!write) return trip
    if (!isHeldCopy(write)) {
      // A reasoned copy is held for its owner, never as the visible plan. Any
      // earlier held entry for the same trip goes with it, so a later edit
      // cannot inherit the stale proposal's baseline.
      queuedLocalTrips.delete(trip.id)
      return trip
    }
    if (!trip.members?.some(m => m.userId === userId && canEdit(m.role))) return trip
    const local = write.trip as Partial<Trip>
    if (local.id !== trip.id || !Array.isArray(local.days)) return trip
    queuedLocalTrips.set(trip.id, write)
    return { ...trip, ...local, members: trip.members }
  })
}

/** Call once on app mount. Subscribes to auth and hydrates the cache. */
/** The one auth-observation seam.
 *
 *  Every session observation — initial getSession, INITIAL_SESSION, SIGNED_IN,
 *  TOKEN_REFRESHED, USER_UPDATED/recovery, SIGNED_OUT and resume getSession —
 *  goes through here. `reserved` lets an async getSession response claim its place
 *  in the observation order before it is applied, so a callback that lands while
 *  that response is in flight supersedes it rather than the response reviving an
 *  older session's credentials. The same key updates the bearer in place rather
 *  than issuing a new incarnation.
 *
 *  A different session id, or a transition to signed out, advances the
 *  incarnation and synchronously retires every older owner's reads, fallback
 *  provenance, mutations, status work and refresh workers. Session retirement is
 *  deliberately separate from account-storage deletion: an account's queued
 *  drafts and pending writes belong to that account and survive. */
let observationSeq = 0

function observeSession(session: ObservedSession | null | undefined, reserved?: number): Owner | null {
  if (reserved !== undefined && reserved !== observationSeq) return null
  if (reserved === undefined) ++observationSeq
  const previous = sessionOwner
  const state = correlateSession(session, previous, nextIncarnation())
  const next = state.kind === 'active' ? { ...state.owner, authorityEpoch } : null
  const changed = previous !== null ? !sameSession(previous, next) : next !== null
  if (changed) {
    ++identityEpoch
    ++hydrateGen
    activeHydrate = null
    ledgers.clear()
    retireOperations()
    retireRefreshWorker()
    const expected = state.kind === 'anonymous' && ownedSignOut && sameSession(previous, ownedSignOut.owner)
    if (expected && ownedSignOut) ownedSignOut.successorEpoch = identityEpoch
    else retireOwnedSignOut()
  }
  sessionOwner = next
  sessionCredentials = state.kind === 'active' && next ? { owner: next, bearer: state.credentials.bearer } : null
  if (changed || state.kind === 'unavailable') reprojectCatalog()
  return next
}

export function init(): void {
  if (initialized) return
  initialized = true
  // P4: debounced trip writes must not eat the last edit when the page goes
  // away — flush every pending write the moment the tab hides or starts to
  // unload (pagehide covers tab close / navigation; visibilitychange covers
  // app-switch on mobile, where the trailing timer may never fire again).
  // Guarded: the test suite runs under node (no DOM), where `document` and the
  // `addEventListener` global do not exist — init() must not throw there.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') _flushTripWrites()
    })
  }
  if (typeof addEventListener !== 'undefined') addEventListener('pagehide', _flushTripWrites)
  // PWA phase 3: the moment the network returns, push everything this device
  // held. (Node tests have no addEventListener - init() must not throw there.)
  if (typeof addEventListener !== 'undefined') addEventListener('online', () => { void replayQueuedWrites() })

  const hydrate = async (userId: string | null, owner: Owner | null = null) => {
    const changed = lastAuthUserId !== userId
    if (changed) {
      const departing = lastAuthUserId ?? cache.sessionUserId
      ++hydrateGen
      lastAuthUserId = userId
      activeHydrate = null
      _cancelTripWrites()
      disconnectRealtime()
      detachDnaAccount()
      recentLocalWrites.clear()
      serverTripTimestamps.clear()
      queuedLocalTrips.clear()
      editableTripGrants.clear()
      tripAccessEpochs.clear()
      // Pending contribution envelopes are scoped to the identity that
      // created them; the next identity starts with no uncertain actions.
      pendingCollabActions.clear()
      commentDrafts.clear()
      suggestionBallotOwners.clear()
      decisionBallotOwners.clear()
      // Publish the new identity before any storage or network await. The
      // catalogue's authority stamp goes with the rows it described: the next
      // account starts with no private authority of its own.
      patch({ trips: [], trashedTrips: [], trashLoaded: false, trashFailed: false,
        users: [], suggestions: [], decisions: [], activity: [], notifications: [],
        adminAudit: [], adminAuditFailed: false, sessionUserId: userId,
        ready: false, cachedAt: null, sliceReads: {}, catalogAuthority: null })
      commit()
      if (departing) {
        void clearSnapshot(departing)
        void clearWritesFor(departing)
      }
    }
    // #800: the dedupe keys on the SESSION as well as the user id. A same-id
    // re-login advances the owner's incarnation, and joining the run that is
    // already in flight would scope this event to the session that run captured.
    if (activeHydrate && activeHydrate.userId === userId
      && activeHydrate.authorityEpoch === authorityEpoch
      && (owner === null ? activeHydrate.owner === null : sameSession(owner, activeHydrate.owner))) {
      await activeHydrate.promise
      return
    }
    const gen = ++hydrateGen
    const promise = (async () => {
      if (!userId) {
        clearAdminCache()
        disconnectRealtime()
        detachDnaAccount()
        try {
          // #800: the anonymous path reads ONLY the public projection. It has no
          // session, so there is no private row to read and no self merge to do —
          // and the private table is not readable by `anon` at all any more.
          const [publicUsers, pubRes] = await Promise.all([
            readPublicUsers(),
            supabase.from('published_itineraries').select('*'),
          ])
          if (gen !== hydrateGen || lastAuthUserId !== null) return
          const failed: string[] = []
          if (publicUsers.failed) failed.push('profiles')
          if (pubRes.error) failed.push('suggested itineraries')
          // The anonymous catalogue goes through the same gate as every other
          // one: no session means no self row and no private authority, so the
          // gate's own rules produce exactly the public cards.
          installCatalog({ scope: { userId: null, identityEpoch, authorityEpoch, admin: false }, generation: gen }, {
            public: { users: publicUsers.users, failed: publicUsers.failed, complete: true, requested: true },
            self: { status: 'not-requested' },
            admin: { status: 'not-requested' },
          })
          patch({ trips: [], trashedTrips: [], trashLoaded: false, trashFailed: false, suggestions: [], decisions: [], activity: [],
            notifications: [], published: dedupePublished(mapOrSkip(pubRes.data ?? [], rowToPublished)),
            adminAudit: [], adminAuditFailed: false, sessionUserId: null, ready: true, cachedAt: null,
            sliceReads: sliceReadReport(failed, PUBLIC_READ_SLICES) })
          commit()
        } catch (error) {
          if (gen !== hydrateGen || lastAuthUserId !== null) return
          console.error('[yatraflow] anonymous hydration failed', error)
          patch({ users: [], catalogAuthority: null, trips: [], trashedTrips: [], suggestions: [], decisions: [], activity: [],
            notifications: [], published: [], sessionUserId: null, ready: true, cachedAt: null,
            sliceReads: sliceReadReport(PUBLIC_READ_SLICES, PUBLIC_READ_SLICES) })
          commit()
        }
        return
      }
      if (!cache.ready) {
        const [snapshot, writes] = await Promise.all([loadSnapshot(userId), pendingWrites()])
        if (gen !== hydrateGen || lastAuthUserId !== userId) return
        if (snapshot) {
          // #800: a snapshot written before the boundary shipped whole private
          // rows. Sanitise on the way IN, so an old cached email cannot come
          // back on a cold boot. Only public cards survive — and they carry no
          // private authority, which is what the resulting stamp records.
          //
          // The ticket is the session this run captured, not an anonymous one:
          // the snapshot carries public-only outcomes, so no self or admin read
          // is requested and no private authority is manufactured. Readiness is
          // published only when the install was accepted.
          const snapshotTicket: InstallTicket = {
            scope: { userId, identityEpoch, authorityEpoch, admin: isAdminCached() },
            generation: gen,
          }
          const installed = installCatalog(snapshotTicket, {
            public: { users: sanitizeSnapshotUsers(snapshot.users as unknown[]), failed: false, complete: true, requested: true },
            self: { status: 'not-requested' },
            admin: { status: 'not-requested' },
          })
          if (installed.status === 'retired') return
          patch({ trips: overlayQueuedTrips(snapshot.trips as Trip[], writes, userId),
            trashedTrips: snapshot.trashedTrips as Trip[],
            published: snapshot.published as PublishedItinerary[], suggestions: snapshot.suggestions as StopSuggestion[],
            decisions: snapshot.decisions as TripDecision[], activity: snapshot.activity as ActivityEntry[],
            sessionUserId: userId, cachedAt: snapshot.savedAt, ready: true })
          commit()
        }
      }
      if (gen !== hydrateGen || lastAuthUserId !== userId) return
      const hydrationSucceeded = await hydrateFromSupabase(userId, gen)
      if (gen !== hydrateGen || cache.sessionUserId !== userId) return
      if (hydrationSucceeded && gen === hydrateGen && cache.sessionUserId === userId) await enforceDisabledCheck()
      if (gen !== hydrateGen || cache.sessionUserId !== userId) return
      if (!cache.ready) { patch({ ready: true }); commit() }
      if (hydrationSucceeded && gen === hydrateGen && cache.sessionUserId === userId) connectRealtime(userId)
      if (hydrationSucceeded && gen === hydrateGen && cache.sessionUserId === userId) void attachDnaAccount(supabase, userId)
      if (hydrationSucceeded && gen === hydrateGen && cache.sessionUserId === userId) void replayQueuedWrites()
    })()
    // Register the whole operation, including its first storage await.
    activeHydrate = { userId, owner, authorityEpoch, promise }
    try { await promise } finally { if (activeHydrate?.promise === promise) activeHydrate = null }
  }

  let authEvents = 0
  hydrateObservedSession = hydrate
  const initialObservation = ++observationSeq
  supabase.auth.getSession().then(({ data }) => {
    if (authEvents > 0 || initialObservation !== observationSeq) return
    // Reserve this response's place in the observation order BEFORE the await's
    // result is applied, so a callback that lands while it is in flight can
    // supersede it rather than the response reviving an older session.
    const owner = observeSession(data.session, initialObservation)
    adminFromSession(data.session ?? null)
    observeAdminAuthority()
    void hydrate(data.session?.user?.id ?? null, owner)
  })
  supabase.auth.onAuthStateChange((event, session) => {
    ++authEvents
    // The observation seam decides lifetime from the session key, not the event
    // name: a duplicate SIGNED_IN or a TOKEN_REFRESHED for the same session keeps
    // valid work, and a different session id retires it.
    const owner = observeSession(session)
    adminFromSession(session ?? null)
    observeAdminAuthority()
    // A same-session admin loss or regain moves the authority revision with no
    // identity change at all, so `hydrate`'s account-change branch never runs.
    // Project the catalogue NOW, before any read: the private rows the old
    // authority unlocked must not wait for a round-trip to disappear.
    void hydrate(session?.user?.id ?? null, owner)
  })
}

/** App-resume rehydration for the native shell. Android backgrounds the
 *  whole WebView (process kept, timers frozen, sockets dead); Supabase's
 *  realtime websocket silently drops without an event, so notifications and
 *  collaborator edits that happened while backgrounded never arrive — the
 *  appShell calls this on Capacitor's appStateChange → active. A full
 *  hydrate refetches everything, which also re-subscribes realtime. */
export async function resumeSync(): Promise<void> {
  // Reserve this response's place in the observation order BEFORE getSession, so a
  // callback that arrives while it is in flight supersedes it rather than the
  // response reviving an older session's credentials.
  const observed = ++observationSeq
  const { data } = await supabase.auth.getSession()
  if (observed !== observationSeq) return
  const owner = observeSession(data.session, observed)
  adminFromSession(data.session ?? null)
  observeAdminAuthority()
  const userId = data.session?.user?.id ?? null
  if (!userId || !owner || cache.sessionUserId !== userId) {
    await hydrateObservedSession?.(userId, owner)
    return
  }
  if (!sameSession(owner, currentOwner())) return
  if (!isCurrentIdentity({ userId, epoch: identityEpoch })) return
  // Full refetch (notifications, trips, the lot). hydrate's same-user
  // dedupe would SKIP a plain hydrate() call — so go around it with a
  // fresh generation, exactly what a resume wants.
  const gen = ++hydrateGen
  activeHydrate = null
  const hydrationSucceeded = await hydrateFromSupabase(userId, gen, false)
  // A resume is a reconnect by another name: the socket was frozen or the app
  // was backgrounded, and a disablement that landed in that gap is invisible to
  // every read above. Ask the server directly, fenced to the account that asked.
  if (hydrationSucceeded && gen === hydrateGen && cache.sessionUserId === userId && sameSession(currentOwner(), owner)) await enforceDisabledCheck()
  if (hydrationSucceeded && gen === hydrateGen && cache.sessionUserId === userId) connectRealtime(userId)
  // PWA phase 3: a resumed app is by definition back on the network - push any
  // edits the backgrounded device is still holding.
  if (hydrationSucceeded && gen === hydrateGen && cache.sessionUserId === userId) void replayQueuedWrites()
}

async function hydrateFromSupabase(userId: string, gen: number, seedIfEmpty = true): Promise<boolean> {
  const accessAtStart = new Map(tripAccessEpochs)
  // #800: observe the admin flag BEFORE anything is captured, so a change a test
  // seam or a late auth event made is reflected in the authority revision this
  // run is scoped to — and so in the stamp its install writes.
  observeAdminAuthority()
  // #704: the slices this run answers for, named as its verdict names them. Stage 1
  // fixes the first four. Stage 2 adds the trip-scoped ones once the scope is known.
  // A throw ends the run before its verdict. The catch fails every name here that has
  // no verdict yet, so no page waits on a read that will never settle.
  const askedSlices: string[] = ['profiles', 'memberships', 'suggested itineraries', 'trips']
  let scopeKnown = false
  let verdictPublished = false
  try {
    // Stage 1 - global catalogs + the user's memberships. Explore reads the curated
    // published_itineraries table and profiles are small rows for user avatars,so
    // those stay global. Every per-trip table is SCOPED to the user's membership.
    // Before, `trips.select('*')` pulled EVERY public row the token could select
    // (the whole catalog, ~1000 trips) into "My Trips",drowning the user's own
    // trips and letting a malformed foreign row crash a workspace render (which
    // looked like the trip "disappeared").
    // #800: the profile read is now TWO reads, because the private table is
    // self-plus-admin only. Everyone gets the public projection; an admin also
    // reads the private table directly (the `admin read` policy permits every
    // row), and a non-admin reads exactly their OWN row through
    // `readSelfProfile`. One query can no longer serve both halves.
    //
    // #800 F2/F3/F4: the scope both private reads are fenced to. Captured once,
    // before any await, and re-checked after each one: a remote disablement, an
    // admin-authority loss or an account switch during a read must produce a
    // recoverable refusal, never another account's private rows.
    const hydrateScope = identityScope() ?? { userId, epoch: identityEpoch }
    // The ticket this run is judged against, captured with the identity above and
    // read AFTER `observeAdminAuthority()` ran, so both epochs describe one
    // moment. It is never refreshed: an install whose ticket no longer matches the
    // live state is rejected rather than re-authorised.
    const ticket: InstallTicket = {
      scope: {
        userId,
        identityEpoch: hydrateScope.epoch,
        authorityEpoch,
        admin: isAdminCached(),
      },
      generation: gen,
    }
    // The read ticket carries the owner and the credentials captured with it, so
    // a private request never receives a later owner's bearer.
    const owner = currentOwner()
    const credentials = credentialsFor(owner)
    const readTicket = owner && credentials ? { owner, credentials } : null
    const [publicUsers, selfProfile, pubRes, myMembershipsRes] = await Promise.all([
      readPublicUsers(),
      readTicket ? readSelfProfile(readTicket) : Promise.resolve<PrivateReadOutcome>({ status: 'failed', reason: 'credentials unavailable' }),
      supabase.from('published_itineraries').select('*'),
      supabase.from('trip_members').select('*').eq('user_id', userId),
    ])
    if (gen !== hydrateGen) return false
    // The admin flag rode in on the session object (adminFromSession in
    // init(), before hydrate runs): admins hydrate the whole app (all trips,
    // all collab slices, the audit log); everyone else keeps the membership
    // scope that keeps "My Trips" theirs. A new commit wakes useIsAdmin() so
    // the #/admin gate flips without a reload.
    const admin = isAdminCached()
    commit()
    // Tables whose select failed. Hydration continues with whatever did load —
    // aborting would throw away good rows over one bad table — but the user gets
    // told at the end. Before this, a denied table rendered as an empty app with
    // nothing on screen saying why, which read as "my trips got deleted". #36-18.
    const partial: string[] = []
    // #94: `partial.length === 0` is the ONLY thing that makes a zero-trip
    // list trustworthy as "this user has no trips". When the queries that
    // count trips error, a real account can read as empty — and the demo
    // seed below then writes the 3 demo trips into it. Set whenever any query
    // that determines the user's trip count failed.
    let tripCountUnknown = false
    // Set when the trips/memberships reads failed: the patch below must then
    // keep the previous cache instead of overwriting good rows with a partial
    // result (a wipe that made every later open say "Trip not found").
    let tripsReadFailed = false
    let suggestionsReadFailed = false
    let decisionsReadFailed = false
    let activityReadFailed = false
    let notificationsReadFailed = false
    if (publicUsers.failed) { console.error('[yatraflow] hydrate profile cards failed'); partial.push('profiles') }
    // The self row is the private half, and its own failure is its OWN verdict
    // (#800 R8). A public RPC success must never certify the signed-in account as
    // ready: a failed self read keeps the previous private row (so the account is
    // not silently downgraded to a public card) and names its own slice, so the
    // settings page can show a failure with a retry that reissues THIS read.
    //
    // What that failure does to the REST of the catalogue is decided by the
    // constructor, from the read outcomes and the stamp on the catalogue it
    // replaces.
    let selfRead: PrivateReadOutcome = { status: 'absent' }
    if (selfProfile.status === 'failed') {
      console.error('[yatraflow] hydrate self profile failed', selfProfile.reason)
      partial.push('self profile')
      selfRead = { status: 'failed', reason: selfProfile.reason }
    } else if (selfProfile.status === 'ok') {
      selfRead = selfProfile
    }
    const myRows = (myMembershipsRes.data ?? []) as MemberRow[]
    const memberTripIds = myRows.map(m => m.trip_id)
    const myTripIds = [...new Set(memberTripIds)]
    if (myMembershipsRes.error) { console.error('[yatraflow] hydrate memberships failed', myMembershipsRes.error); partial.push('memberships'); tripCountUnknown = true; tripsReadFailed = true }
    // #704: a failed memberships read leaves the trip scope unknown, so stage 2 read
    // nothing for a member. The admin reads are not scoped by membership, so they stand.
    const scopeUnread = !!myMembershipsRes.error && !admin
    // #704: the scope is known now, so name the slices this run answers for before
    // stage 2 issues any read. A throw from here on finds them in `askedSlices` (see the catch).
    scopeKnown = true
    if (admin || myTripIds.length > 0) askedSlices.push(...TRIP_SCOPED_READS)
    if (scopeUnread) askedSlices.push('suggestions', 'decisions', 'activity', 'notifications')
    if (admin) askedSlices.push('audit', 'admin profiles')
    // #800 R8: this run read the signed-in account's own private row, so it
    // answers for that slice. A page that renders the account can then tell a
    // failed read from a genuinely absent one, instead of the two collapsing.
    askedSlices.push('self profile')

    // Stage 2 - the user's own trips + their collaboration data (PostgREST
    // rejects `id=in.<empty>`, so with no trips yet we record empty slices
    // and the demo seed below still runs). Admins skip the membership scope
    // entirely: the "admin read" RLS bypass lets these unfiltered selects see
    // every row, and the extra slices (all members, audit log) feed the
    // console. Notifications stay recipient-scoped even for admins — there is
    // deliberately no "admin read" policy on that table's intent; the bypass
    // policy exists but the console never renders other people's inboxes.
    let trips: TripRow[] = []
    const members: MemberRow[] = []
    let suggestions: StopSuggestion[] = []
    let decisions: TripDecision[] = []
    let activity: ActivityEntry[] = []
    let notifications: Notification[] = []
    let adminAudit: AdminAuditEntry[] = []
    // The one install this run performs. Set by whichever branch read the private
    // slices, and `null` until then — which is how the non-admin path knows it
    // still has to install.
    let installed: CatalogResult | null = null
    if (admin) {
      // The mock builder in tests/hydrate-race.test.ts has no order()/limit()
      // chainables, and production PostgREST needs limit() AFTER order() —
      // so audit reads go through a tiny helper that degrades gracefully.
      const [tripsRes, memRes, sugRes, decRes, actRes, notRes, auditRes, adminProfiles] = await Promise.all([
        supabase.from('trips').select('*'),
        supabase.from('trip_members').select('*'),
        supabase.from('suggestions').select('*'),
        supabase.from('decisions').select('*'),
        supabase.from('activity').select('*'),
        supabase.from('notifications').select('*').eq('user_id', userId),
        fetchAdminAuditRows(),
        // #800: the admin console lists every account's email, so an admin reads
        // the PRIVATE table directly — the `admin read` policy permits every row
        // for a masteradmin. This is the one place a bulk private read is
        // legitimate. The admin flag is checked at call time and again after the
        // await, so an authority loss in between downgrades the read rather than
        // installing another account's private rows (#800 F2, F4).
        readTicket ? readAdminProfiles(ticket.scope, readTicket) : Promise.resolve<SliceRead<readonly PrivateUser[]>>({ status: 'failed', reason: 'credentials unavailable' }),
      ])
      for (const [name, res] of [
        ['trips', tripsRes], ['members', memRes], ['suggestions', sugRes],
        ['decisions', decRes], ['activity', actRes], ['notifications', notRes],
        ['audit', auditRes],
      ] as const) {
        if (res.error) {
          console.error(`[yatraflow] hydrate ${name} failed`, res.error)
          partial.push(name)
        }
      }
      decisionsReadFailed = !!decRes.error
      activityReadFailed = !!actRes.error
      suggestionsReadFailed = !!sugRes.error
      notificationsReadFailed = !!notRes.error
      // The admin's bulk private read is the authoritative list of private rows.
      // A failure names its own slice, so the console's user state follows a read
      // that actually happened instead of a public RPC success certifying data it
      // never saw (#800 R8).
      //
      // What it INSTALLS is not decided here. `installCatalog` below takes the
      // read outcomes as outcomes and lets the constructor apply the authority
      // gate once, at the end — which is the only place a same-ID loss, a failed
      // self read and a successful batch can be weighed against each other.
      let adminRead: SliceRead<readonly PrivateUser[]> = { status: 'absent' }
      if (adminProfiles.status === 'ok' && isCurrentIdentity(hydrateScope) && isAdminCached()) {
        adminRead = adminProfiles
      } else {
        if (adminProfiles.status !== 'ok') console.error('[yatraflow] hydrate admin profiles failed', adminProfiles.status === 'failed' ? adminProfiles.reason : 'not authorised')
        partial.push('admin profiles')
        adminRead = { status: 'failed', reason: 'authority changed' }
      }
      // The one install, on the ticket this run captured. The ticket is never
      // refreshed to fit a late answer: if the identity, the authority revision
      // or the generation moved while the request was in flight, the install is
      // rejected and the newer run's own install is what the screen shows. The
      // immediate loss itself is applied by the auth callback's reprojection,
      // which needs no read at all.
      const outcome = installCatalog(ticket, {
        public: { users: publicUsers.users, failed: publicUsers.failed, complete: true, requested: true },
        self: selfRead,
        admin: adminRead,
      })
      if (outcome.status === 'retired') {
        console.warn('[yatraflow] hydrate profile install retired:', outcome.reason)
        return false
      }
      installed = outcome.result
      if (tripsRes.error || memRes.error) { tripCountUnknown = true; tripsReadFailed = true }
      trips = (tripsRes.data ?? []) as TripRow[]
      members.push(...((memRes.data ?? []) as MemberRow[]))
      suggestions = mapOrSkip((sugRes.data ?? []), rowToSuggestion)
      decisions = mapOrSkip((decRes.data ?? []), rowToDecision)
      activity = mapOrSkip((actRes.data ?? []), rowToActivity)
      notifications = mapOrSkip((notRes.data ?? []), rowToNotification)
      adminAudit = auditRowsToEntries(auditRes.data)
    } else if (myTripIds.length > 0) {
      const [tripsRes, memRes, sugRes, decRes, actRes, notRes] = await Promise.all([
        supabase.from('trips').select('*').in('id', myTripIds),
        supabase.from('trip_members').select('*').in('trip_id', myTripIds),
        supabase.from('suggestions').select('*').in('trip_id', myTripIds),
        supabase.from('decisions').select('*').in('trip_id', myTripIds),
        supabase.from('activity').select('*').in('trip_id', myTripIds),
        supabase.from('notifications').select('*').in('trip_id', myTripIds),
      ])
      // Supabase surfaces query failures as { error } rather than rejecting, so a
      // denied/missing table silently hydrated as an empty list - data that exists
      // server-side "vanishes" after refresh with no trace in the logs.
      for (const [name, res] of [
        ['trips', tripsRes], ['members', memRes], ['suggestions', sugRes],
        ['decisions', decRes], ['activity', actRes], ['notifications', notRes],
      ] as const) {
        if (res.error) {
          console.error(`[yatraflow] hydrate ${name} failed`, res.error)
          partial.push(name)
        }
      }
      decisionsReadFailed = !!decRes.error
      activityReadFailed = !!actRes.error
      suggestionsReadFailed = !!sugRes.error
      notificationsReadFailed = !!notRes.error
      if (tripsRes.error || memRes.error) { tripCountUnknown = true; tripsReadFailed = true }
      trips = (tripsRes.data ?? []) as TripRow[]
      members.push(...((memRes.data ?? []) as MemberRow[]))
      suggestions = mapOrSkip((sugRes.data ?? []), rowToSuggestion)
      decisions = mapOrSkip((decRes.data ?? []), rowToDecision)
      activity = mapOrSkip((actRes.data ?? []), rowToActivity)
      notifications = mapOrSkip((notRes.data ?? []), rowToNotification)
    }

    // A non-admin installs through the SAME gate, on the same ticket. The scope
    // carries `admin: false`, so the gate's own rules keep the caller's private
    // self row and downgrade every other-account entry to its public card.
    if (!installed) {
      const outcome = installCatalog(ticket, {
        public: { users: publicUsers.users, failed: publicUsers.failed, complete: true, requested: true },
        self: selfRead,
        admin: { status: 'not-requested' },
      })
      if (outcome.status === 'retired') {
        console.warn('[yatraflow] hydrate profile install retired:', outcome.reason)
        return false
      }
      installed = outcome.result
    }

    // The catalogue's own verdicts are the authority for the slices this run
    // asked for, because the constructor saw the whole picture: a successful admin
    // batch that carried the caller's own row makes the self result successful
    // even when the narrower self read failed, and a batch that omitted self
    // cannot. Reconcile `partial` with them rather than trusting the booleans
    // above, which were collected before that weighing happened. A slice this run
    // did not ask for is left alone — its verdict is published, but it is not
    // this run's failure to report.
    for (const [name, verdict] of Object.entries(installed.verdicts)) {
      if (!askedSlices.includes(name)) continue
      const at = partial.indexOf(name)
      if (verdict === 'failed' && at < 0) partial.push(name)
      if (verdict === 'ok' && at >= 0) partial.splice(at, 1)
    }

    // `users` already carries the public cards plus the private self row (see
    // stage 1), merged by `mergeUsers` so the private entry wins for that id.
    // With the corrected "trips read hide trashed" policy (Sep 14 2026 fix),
    // tombstoned rows are visible to their owner/editor so the trash UPDATE's
    // added-row check can pass — hydration must therefore keep them out of the
    // live list itself. The Trash view reads them via get_trashed_trips.
    // Un-migrated rows simply carry undefined → the filter no-ops there.
    // The tombstoned ids are kept before the filter, because a deleted trip
    // and a removed membership are different reasons for the same outcome.
    const tombstonedTripIds = new Set(
      trips.filter(r => (r as TripRow).deleted_at).map(r => (r as TripRow).id),
    )
    trips = trips.filter(r => !(r as TripRow).deleted_at)
    const tripList = mapOrSkip(trips, row =>
      rowToTrip(row as TripRow, members.filter(m => m.trip_id === (row as TripRow).id).map(m => ({ userId: m.user_id, role: m.role, joinedAt: m.joined_at })))
    )

    const pubRows = mapOrSkip((pubRes.data ?? []), rowToPublished)
    if (pubRes.error) { console.error('[yatraflow] hydrate published failed', pubRes.error); partial.push('suggested itineraries') }

    // #383: the trips slice is only trustworthy when the trip count is. A
    // memberships failure (stage 1) or a members failure without a trips
    // failure (stage 2) leaves `partial` naming everything EXCEPT 'trips', so
    // `sliceState(sliceReads, 'trips')` would report ok over an untrustworthy
    // empty list — the exact lie #383 owns. Name it, so the page's failed
    // branch (not its empty copy) renders and the demo seed stays blocked.
    if ((tripCountUnknown || tripsReadFailed) && !partial.includes('trips')) partial.push('trips')
    // #704: the trip-scoped slices are unread too, so they report failed the way trips does.
    if (scopeUnread) partial.push('suggestions', 'decisions', 'activity', 'notifications')

    // Stale run — a sign-out or account switch bumped hydrateGen while these
    // queries were in flight. Writing now would leak the previous account's rows
    // (and its sessionUserId) into the new session, so drop the whole patch.
    if (gen !== hydrateGen) return false

    // A failed trips/memberships read overwrote the cache with a partial (often
    // empty) result — the account kept rendering, but every trip was gone from
    // the cache, so opening any of them said "Trip not found" until a lucky
    // reload. When this user already holds trips, keep the stale-but-good rows
    // and let the partial-load toast explain what happened instead.
    const tripsRead = tripsReadFailed && cache.sessionUserId === userId && cache.trips.some(t => t.members?.some?.(m => m.userId === userId))
      ? undefined
      : tripList
    const sameSessionUser = cache.sessionUserId === userId
    // Failed reads keep rows only when the cache belongs to this account.
    // A new account must not inherit another account's rows through a failed query.
    const suggestionsRead = (scopeUnread || suggestionsReadFailed) && sameSessionUser
      ? undefined
      : (scopeUnread || suggestionsReadFailed) ? [] : suggestions
    const notificationsRead = (scopeUnread || notificationsReadFailed) && sameSessionUser
      ? undefined
      : (scopeUnread || notificationsReadFailed) ? [] : notifications

    // B2: seed the server-clock ledger with every server-applied trip row —
    // hydration is the definition of "server-applied" (see
    // serverTripTimestamps above for why the guard must read this and not
    // Trip.updatedAt).
    for (const t of tripList) recordServerTripTimestamp(t.id, t.updatedAt)
    const pending = await pendingWrites()
    if (gen !== hydrateGen) return false
    // A completed local write or access change can supersede these fetched rows.
    const currentTrips = tripsRead?.flatMap(trip => {
      const cached = tripById(trip.id)
      if ((accessAtStart.get(trip.id) ?? 0) !== (tripAccessEpochs.get(trip.id) ?? 0)) {
        return cached ? [cached] : []
      }
      if (cached && validWriteVersion(cached.writeVersion)
        && validWriteVersion(trip.writeVersion) && cached.writeVersion > trip.writeVersion) {
        return [{ ...cached, members: trip.members }]
      }
      return [trip]
    })
    const displayedTrips = currentTrips === undefined ? undefined : overlayQueuedTrips(currentTrips, pending, userId)
    if (!tripsReadFailed) {
      const visible = new Set((currentTrips ?? []).filter(t => t.members?.some(m => m.userId === userId && canEdit(m.role))).map(t => t.id))
      // The reason comes from the authoritative reads, not from one label for
      // every case. A trip the account may no longer read at all was removed
      // or deleted. A trip the account may still read was demoted. A trip the
      // read saw as tombstoned was deleted, and that is its own reason.
      const readable = new Set((currentTrips ?? []).map(t => t.id))
      for (const write of pending) {
        if (write.ownerId !== userId || visible.has(write.tripId)) continue
        // The account can no longer edit the trip. The server read above still
        // lists it when the account can read it, so a demoted reader keeps the
        // trip. The queued copy stays with the reason attached.
        const reason = tombstonedTripIds.has(write.tripId)
          ? 'trip-unavailable'
          : readable.has(write.tripId) ? 'access-revoked' : 'access-removed'
        invalidateTripWork(write.tripId, userId, reason)
      }
    }
    const allowedTrips = new Set((displayedTrips ?? cache.trips).map(t => t.id))
    if (!tripsReadFailed && !admin) {
      suggestions = suggestions.filter(s => allowedTrips.has(s.tripId))
      decisions = decisions.filter(d => allowedTrips.has(d.tripId))
      activity = activity.filter(a => allowedTrips.has(a.tripId))
      notifications = notifications.filter(n => !n.tripId || allowedTrips.has(n.tripId))
    }

    patch({
      ...(displayedTrips !== undefined ? { trips: displayedTrips } : {}),
      // #704: a failed slice keeps same-account rows; another account cannot keep them.
      ...(suggestionsRead !== undefined ? { suggestions: suggestionsRead } : {}),
      ...((scopeUnread || decisionsReadFailed) && sameSessionUser ? {} : { decisions }),
      ...((scopeUnread || activityReadFailed) && sameSessionUser ? {} : { activity }),
      ...(notificationsRead !== undefined ? { notifications: notificationsRead } : {}),
      adminAudit,
      // De-dupe published rows left by earlier buggy seeds (the publishItinerary
      // path used to mint a fresh trip id on every call — many rows per
      // itinerary).
      //
      // Deliberately NOT gated on trip visibility. Explore is a catalog of OTHER
      // creators' itineraries, and the paywall hardening makes their trip rows
      // unreadable to a non-member on purpose — gating on that emptied the
      // gallery for every signed-in visitor while the same person logged out saw
      // all of it. The trip behind a publication is read through
      // `get_public_trip` (the public page and the fork path both do), and the
      // row cascades away with its trip, so a publication stands on its own.
      // #704: a failed published read keeps the rows already loaded. The empty
      // result of a failed read is not an empty catalog. The verdict in
      // `sliceReads` still reports the failure.
      published: pubRes.error ? cache.published : dedupePublished(pubRows),
      sessionUserId: userId,
      cachedAt: null,
    })
    commit()

    // Keep this account's snapshot for the next offline boot — but only a CLEAN
    // hydrate. A partial read is the store's own "half an account" signal, and
    // writing it would present half an account as the truth on the next cold
    // start, which is exactly what the cache must never do.
    if (partial.length === 0) {
      void saveSnapshot(userId, {
        trips: cache.trips,
        trashedTrips: cache.trashedTrips,
        // #800: only the PUBLIC cards are persisted. The signed-in user's own
        // private row is deliberately left out — IndexedDB is unencrypted and
        // outlives the session, and an email in it is a read path the database
        // repair does not close. The self row is re-read on every hydrate, so
        // nothing is lost by not storing it.
        users: publicOnlyUsers(cache.users),
        published: cache.published,
        suggestions: cache.suggestions,
        decisions: cache.decisions,
        activity: cache.activity,
      })
    }

    // #36-18: name what is missing instead of letting a half-loaded account render
    // as an empty one. Deliberately after the staleness check above, so a run that
    // has been superseded cannot toast about an account the user already left.
    if (partial.length > 0) toast(`Some data didn't load (${partial.join(', ')}) - refresh to try again.`, 'err')

    // #364: the SAME list, published rather than toasted. A toast is a claim about
    // one moment; a page that renders later has no way to tell an empty gallery
    // from a broken read, and that is how a valid creator came to read "Creator
    // not found" over a dropped connection. Anything named in `partial` failed;
    // everything else this run asked for was read. The names are the ones the
    // hydrate already uses, so a page can ask about the slice it renders.
    //
    // #383: `asked` mirrors what THIS run actually read, so a slice the run
    // never touched (the five trip-scoped slices on an account with no trips yet, the
    // audit log for a non-admin) stays unreported — an unreported read is an
    // unread one — instead of being reported 'ok' without ever being read.
    // The trips verdict comes from the memberships read. A zero-row read is a read,
    // so trips reports ready. A failed read reports failed, because partial names trips.
    // The catalogue's own verdicts ride the final report. A slice this run did not
    // ask for keeps whatever the previous run — or an immediate reprojection on an
    // authority change — published for it, so a public-only run cannot certify or
    // revoke a private read it never issued.
    patch({ sliceReads: { ...cache.sliceReads, ...sliceReadReport(partial, askedSlices), ...installed.verdicts } })
    verdictPublished = true
    // Publish the verdict now. patch() wakes no subscriber by itself.
    // A retry or a resume reaches this line with no commit after it.
    commit()

    // First-time users get the demo trips seeded into their account. Admins
    // skip the seed: their "empty" is a real empty app, and seeding the 3 demo
    // trips into an admin account would pollute the console's totals.
    // #94: a failed memberships/trips query also reads as "zero trips" — for a
    // real account on a flaky connection that meant writing 3 fake trips next
    // to the user's actual ones. Only seed when the trip count is trustworthy.
    if (tripList.length === 0 && seedIfEmpty && !admin && !tripCountUnknown) {
      // The empty state offers "Load demo trips" while this seed runs. The flag that
      // addDemoTrips checks keeps that button from seeding a second set.
      demoSeedInFlight = true
      try { await seedDemoFor(userId, gen) } finally { demoSeedInFlight = false }
    }
    return true
  } catch (e) {
    console.error('[yatraflow] hydration failed', e)
    // #704: a throw ends the run before its verdict. Each name the run answers for that
    // has no verdict yet fails, so no page waits on a read that will never settle. A
    // verdict already published stands. Cached rows stay in the cache: a failed slice
    // with rows reads as kept, not empty. A run that threw before its scope was known
    // could not read the trip-scoped slices either, so they fail too. A newer run owns the verdicts.
    if (gen === hydrateGen && !verdictPublished) {
      const unread = scopeKnown ? askedSlices : [...askedSlices, ...TRIP_SCOPED_READS]
      // sliceReadReport marks a name failed when the list it gets lists that name. Here every name is listed.
      const sameSessionUser = cache.sessionUserId === userId
      const sessionWasUnknown = cache.sessionUserId === null
      // A run that died under a DIFFERENT account must not leave the previous
      // account's catalogue installed, and the clear goes through the same gate
      // so the stamp goes with it.
      if (!sameSessionUser) clearInstalledCatalog()
      patch({
        ...(cache.sessionUserId === userId ? {} : { decisions: [], activity: [] }),
        ...(!sameSessionUser ? { suggestions: [], notifications: [] } : {}),
        ...(sessionWasUnknown ? { sessionUserId: userId } : {}),
        sliceReads: { ...cache.sliceReads, ...sliceReadReport(unread, unread) },
      })
      commit()
    }
    toast('Could not load your data - check your connection.')
    return verdictPublished
  }
}

/** Map rows safely - skip + log a single malformed row instead of letting its
 *  thrown mapper crash the whole hydration / realtime apply (which looked
 *  like trips "disappeared" (a white-screen) when a public catalog row had an
 *  unexpected shape). */
function mapOrSkip<T>(rows: unknown[], to: (row: unknown) => T): T[] {
  const out: T[] = []
  for (const r of rows ?? []) {
    try { out.push(to(r)) } catch (e) { console.error('[yatraflow] skipped malformed row', e) }
  }
  return out
}

// ---------------- Seeding demo trips ----------------

async function seedDemoFor(userId: string, gen: number = hydrateGen): Promise<void> {
  const seedTrips = structuredClone(seedData.trips)
  for (const t of seedTrips) {
    const owner: TripMember = { userId, role: 'owner', joinedAt: Date.now() }
    // Regenerate the trip id: seed data carries stable display ids that are
    // not valid UUIDs, but trips.id is a Postgres uuid column.
    const trip: Trip = { ...structuredClone(t), id: uuid(), members: [owner], creationKind: 'demo', sourcePubId: undefined, campaignId: undefined }
    const cols = await tripsHaveOptionalColumns()
    const { error } = await supabase.from('trips').insert(tripToRow(trip, userId, cols))
    if (error) { console.error('seed trip failed', error); continue }
    // The membership row is what makes the trip visible after a reload — a
    // failure here silently produced trips that "persisted" as invisible rows.
    const { error: memErr } = await supabase.from('trip_members').insert({ trip_id: trip.id, user_id: userId, role: 'owner', joined_at: Date.now() })
    if (memErr) console.error('seed trip member insert failed', memErr)
    markLocalWrite('trips', trip.id)
  }
  // re-hydrate so the freshly seeded trips show up.
  // `seedIfEmpty: false` is load-bearing. Without it this re-hydrate re-entered the
  // seed branch whenever the seeded trips still did not come back — a trip_members
  // insert blocked by RLS, or a read that lags the write — and hydrate ↔ seed
  // recursed forever, firing 10 trip inserts per cycle without ever settling. A test
  // with a mock that never returns the seeded rows hung the worker and proved it.
  await hydrateFromSupabase(userId, gen, false)
}

// ---------------- Seeding demo trips ----------------

/** The shipped demo set's names — the re-seed signature (#386). Seeded rows
 *  persist under regenerated uuids with no marker column, so the names the
 *  seed ships are the dedupe key: they survive reloads and later sessions. */
const DEMO_SEED_NAMES = new Set(seedData.trips.map(t => t.name))

/** Re-entrancy guard: impatient clicks while a seed is in flight must not mint
 *  a second library before the first one's rows come back. */
let demoSeedInFlight = false

/** Manually load the demo trips into the current account (My Trips button).
 *  Both wirings (header + empty state) call this one guarded function, so no
 *  per-site logic can drift. */
export function addDemoTrips(): void {
  const userId = cache.sessionUserId
  if (!userId) return
  // Same gate as auto-seed: a broken trips read must show the error branch
  // (with its Retry), never demo rows seeded on top of it. `trips` is marked
  // failed exactly when the trip count is untrustworthy, so this is the same
  // condition under a different name.
  if (cache.sliceReads['trips'] === 'failed') {
    toast('Your trips could not be loaded — try again once they are back.', 'err')
    return
  }
  // Dedupe: a library already holding the seed's names was seeded before.
  if (tripsForUser(userId).some(t => DEMO_SEED_NAMES.has(t.name))) {
    toast('Demo trips are already in your library')
    return
  }
  if (demoSeedInFlight) {
    toast('Demo trips are on their way…')
    return
  }
  demoSeedInFlight = true
  toast('Adding demo trips…')
  void seedDemoFor(userId).then(
    () => toast('Demo trips added'),
    (e) => console.error('[yatraflow] demo seed failed', e),
  ).finally(() => { demoSeedInFlight = false })
}

// ---------------- Row mappers for collaboration tables ----------------

// The suggestion and decision row mappings live in ./collabCommand, shared with
// the receipt-adoption path (the same server read shape). Local aliases keep
// the hydrate and realtime call sites unchanged.
const rowToSuggestion = suggestionRowToEntry
const rowToDecision = decisionRowToEntry
function rowToActivity(row: unknown): ActivityEntry {
  const r = row as any
  return { id: r.id, tripId: r.trip_id, actorId: r.actor_id, verb: r.verb, target: r.target, at: r.at }
}
function rowToNotification(row: unknown): Notification {
  const r = row as any
  return { id: r.id, userId: r.user_id, tripId: r.trip_id, text: r.text, read: r.read, at: r.at }
}
function rowToPublished(row: unknown): PublishedItinerary {
  const r = row as any
  return {
    id: r.id, tripId: r.trip_id, creatorId: r.creator_id, title: r.title, tagline: r.tagline,
    coverImageUrl: r.cover_image_url, routeSummary: r.route_summary ?? [], durationDays: r.duration_days,
    estimatedBudgetPerPersonInr: r.estimated_budget_per_person_inr, travelStyle: r.travel_style,
    bestSeason: r.best_season, travelTips: r.travel_tips ?? [], warningsAndAssumptions: r.warnings_and_assumptions ?? [],
    freeDayIndexes: r.free_day_indexes ?? [], premiumPriceInr: r.premium_price_inr, subscriberCta: r.subscriber_cta,
    publishedAt: r.published_at, refreshedAt: r.refreshed_at ?? undefined,
    unpublishedAt: r.unpublished_at ?? undefined, views: r.views ?? 0, copies: r.copies ?? 0,
  }
}

/** De-duplicate published itineraries read from Supabase. Earlier buggy seeds
 *  minted a fresh trip UUID on EVERY run, so each run's published rows carried
 *  a DIFFERENT tripId — a tripId-only dedup couldn't merge them, which flooded
 *  Explore with duplicates. Key by the stable itinerary identity (creator,
 *  title and start location) instead, so exactly one card per itinerary
 *  survives — the creator being part of the key is what keeps two people's
 *  same-named route from collapsing into one card.
 *
 *  There is deliberately no "is the underlying trip visible to me?" test. A
 *  publication is not a view of a trip row — it is the public artifact the
 *  preview handler, the public page and Explore all serve — and the database
 *  already ties it to its trip for life (`published_itineraries.trip_id ... on
 *  delete cascade`), so a deleted trip cannot leave a stray card behind.
 *  Filtering on the viewer's readable trip ids instead hid the whole shelf from
 *  every signed-in non-member, because the paywall hardening
 *  (20260918_payments_security.sql) makes those trips unreadable on purpose,
 *  while the same person logged out saw every card. */
function dedupePublished(rows: PublishedItinerary[]): PublishedItinerary[] {
  const byKey = new Map<string, PublishedItinerary>()
  for (const r of rows) {
    const key = `${r.creatorId}::${r.title}::${Array.isArray(r.routeSummary) ? (r.routeSummary[0] ?? '') : ''}`
    const prev = byKey.get(key)
    if (!prev || (r.publishedAt ?? 0) >= (prev.publishedAt ?? 0)) byKey.set(key, r)
  }
  return [...byKey.values()]
}

// ---------------- Profile ----------------

/** The line the Profile page shows when a profile save is refused or never answered. */
export const PROFILE_NOT_SAVED = 'Profile not saved. Check your connection and try again.'

/**
 * Save profile fields and answer only after the server has ruled on the write.
 * The cache takes the edit at once, so the page reads the new values. A refused
 * or failed write puts the saved profile back, the same rollback that
 * setMemberRole and removeMember use, so the app never shows a name the server
 * did not keep. The caller's form keeps its draft either way.
 */
export async function updateProfile(patchFields: Partial<PrivateUserProfile>): Promise<{ ok: boolean; error?: string }> {
  const u = currentUser()
  if (!u) return { ok: false, error: PROFILE_NOT_SAVED }
  // The optimistic edit goes through the same install gate as a hydrate, so the
  // authority revision is re-checked and the stamp is rewritten.
  // `currentUser()` already returned a PRIVATE row for this account, which is why
  // the shape is a narrowing of something established rather than a widening.
  //
  // Every requested field becomes an ordered intent, including one whose prior
  // value was absent. A refusal contributes nothing to the reducer, so an
  // unrelated change that landed while the request was in flight — a live rename,
  // another edit, even an equal-valued acceptance — survives.
  const after = { ...u.profile, ...patchFields }
  const owned: OwnedFields = { id: u.id, patch: patchFields }
  // The ledger is built from the row's ORIGINAL values BEFORE the optimistic
  // install, so each field's base is what the row held before this edit and each
  // intent is what this edit wrote. A refusal then drops back to the base; an
  // acceptance promotes the intent to base.
  const applied = installCatalogEdit(owned, x => ({ ...x, profile: after }))
  if (!applied) return { ok: false, error: PROFILE_NOT_SAVED }
  try {
    const { error } = await supabase.from('profiles').update({
      name: patchFields.name, home_city: patchFields.homeCity, languages: patchFields.languages,
      travel_styles: patchFields.travelStyles, is_creator: patchFields.isCreator,
      creator_bio: patchFields.creatorBio, social_links: patchFields.socialLinks,
    }).eq('id', u.id)
    if (!error) { settleOwnedFields(owned, applied, 'accepted'); return { ok: true } }
    console.error('[yatraflow] profiles write failed', error)
    settleOwnedFields(owned, applied, 'failed')
    return { ok: false, error: PROFILE_NOT_SAVED }
  } catch (err) {
    console.error('[yatraflow] profiles write rejected', err)
    settleOwnedFields(owned, applied, 'failed')
    return { ok: false, error: PROFILE_NOT_SAVED }
  }
}

async function reconcileProfileEdits(id: ID, scope: AccessScope): Promise<void> {
  const owner = currentOwner()
  const credentials = credentialsFor(owner)
  const cursor = profileMutationCursors.get(id)
  const readRevision = profileReadRevisions.get(id)
  const ticket = currentTicket()
  if (!owner || !credentials || !cursor || (id !== owner.userId && !scope.admin)) return
  const live = () => scope.identityEpoch === identityEpoch && scope.authorityEpoch === authorityEpoch
    && sameSession(owner, currentOwner()) && profileMutationCursors.get(id) === cursor && !ledgers.has(id)
    && profileReadRevisions.get(id) === readRevision && retiredReason(ticket) === null
  try {
    const { data, error } = await pinBearer(supabase.from('profiles').select('*').eq('id', id).maybeSingle(), credentials.bearer)
    if (!live()) return
    if (error) throw error
    const before = previousCatalog()
    const row = data ? rowToPrivateUser(data) : null
    const users = before.users.map(user => user.id !== id ? user : row ?? toPublicUser(user))
    installCatalog(ticket, {
      public: { users: users.map(toPublicUser), complete: false, failed: false, requested: false },
      self: id === owner.userId ? row ? { status: 'ok', value: row } : { status: 'absent' } : { status: 'not-requested' },
      admin: { status: 'not-requested' },
    }, { ...before, users })
  } catch {
    if (!live()) return
    const failed: SliceRead<PrivateUser> = { status: 'failed', reason: 'profile reconciliation failed' }
    installCatalog(ticket, {
      public: { users: [], complete: false, failed: false, requested: false },
      self: id === owner.userId ? failed : { status: 'not-requested' },
      admin: id !== owner.userId ? { status: 'failed', reason: 'profile reconciliation failed' } : { status: 'not-requested' },
    })
  }
}

// ---------------- Trips ----------------

export function tripsForUser(userId: ID | null): Trip[] {
  if (!userId) return []
  return cache.trips.filter(t => t.members?.some?.(m => m.userId === userId))
}

export function tripById(id: ID): Trip | undefined {
  return cache.trips.find(t => t.id === id)
}

/**
 * On-demand fetch of a trip the viewer may not be a member of — the public
 * itinerary page and the invite gate both need OTHER people's trips, which the
 * membership-scoped hydration deliberately keeps out of the cache. Reads the
 * row directly (owner / member / `visibility='public'` — published trips are
 * public); when `allowInvitePreview` is set, falls back to the
 * `get_invite_trip` security-definer RPC so a private trip can still be
 * previewed by whoever holds its invite link (the UUID is the capability).
 * A fetched trip is merged into the cache so `tripById` finds it on the next
 * render; it disappears again on the next hydration, which is fine — callers
 * re-fetch. Returns null when nothing readable exists (RLS or a bad id).
 *
 * #804 (N1) — THIS PATH IS NOT LIKE THE CODE PATH. `get_invite_trip` returns the
 * FULL 34-column row and ITS OWN `get_invite_trip` nulls `invite_code` in SQL, so
 * the preview it produces IS cached here, and the cache stays safe because the
 * server strips the capability. That is the opposite of
 * `fetchTripByInviteCode`, which never caches at all.
 * The consequence is a DEPLOYMENT PREREQUISITE: this client relies on the
 * server SQL to withhold `invite_code`, and it does not strip anything itself.
 * An unpatched server (the separate Branch A migration) would let a UUID holder
 * read the invite code off a cached preview. Nothing in this change makes that
 * true or false — only the installed SQL decides it.
 */
export async function fetchSharedTrip(tripId: ID, allowInvitePreview = false): Promise<Trip | null> {
  const epoch = identityEpoch
  const userId = cache.sessionUserId
  const live = () => epoch === identityEpoch && cache.sessionUserId === userId
  const local = tripById(tripId)
  if (local) return local
  let row: TripRow | null = null
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (!live()) return null
  if (error) console.error('[yatraflow] shared trip fetch failed', error)
  if (data) row = data as TripRow
  if (!row && allowInvitePreview) {
    const rpc = await supabase.rpc('get_invite_trip', { p_trip_id: tripId })
    if (!live()) return null
    if (rpc.error) console.error('[yatraflow] invite preview fetch failed', rpc.error)
    const rows = rpc.data as TripRow[] | null
    if (Array.isArray(rows) && rows.length > 0) row = rows[0]
  }
  if (!row) return null
  // B3 (round 10) — provenance. A preview for another trip is not this link's
  // answer, so the gate says the link is dead instead of previewing a stranger.
  if (typeof row.id !== 'string' || row.id.toLowerCase() !== tripId.toLowerCase()) return null
  const trip = rowToTrip(row, [])
  recordServerTripTimestamp(trip.id, trip.updatedAt)
  if (!cache.trips.some(t => t.id === trip.id)) {
    cache.trips = [...cache.trips, trip]
    commit()
  }
  return trip
}

/**
 * The PUBLIC-READER path for a published itinerary's trip (public page and
 * fork). Reads through the security-definer `get_public_trip` RPC, which
 * decides SERVER-SIDE who sees real days: the publication's creator and
 * buyers with a paid entitlement row (matched on auth.uid()) get the real
 * trip; everyone else gets locked days stubbed at the wire — the paywall
 * lives in the database now, not in React. The client never picks its own
 * path; there is no parameter to forge. After an unlock, re-calling this
 * same RPC serves real days because the server's entitlement check flips.
 * The direct `select('*')` read requires owner/member/admin (the tightened
 * "trips read" policy), so an anonymous curl can no longer pull premium day
 * content off the table.
 *
 * Merged into the cache by REPLACING any row for the same id (#349) rather
 * than inserting only when absent; returns null for an unknown publication or
 * a deleted/unpublished trip.
 */
export async function fetchPublicTrip(pubId: string): Promise<Trip | null> {
  const epoch = identityEpoch
  const userId = cache.sessionUserId
  const rpc = await supabase.rpc('get_public_trip', { p_pub_id: pubId })
  if (epoch !== identityEpoch || cache.sessionUserId !== userId) return null
  if (rpc.error) {
    console.error('[yatraflow] public trip fetch failed', rpc.error)
    return null
  }
  const rows = rpc.data as TripRow[] | null
  if (!Array.isArray(rows) || rows.length === 0) return null
  // #351 — the paid public path must never carry the invite code into the cache.
  // The RPC no longer selects it (20260926_paywall_invite_code_leak.sql, which
  // replaced `select *` with an explicit column list), and this is the belt to
  // that migration's suspenders: an un-migrated database still returns the code,
  // and this function is what put it in the cache, where `fetchTripByInviteCode`
  // and `ensureInviteCode` would then happily read it back out. Dropped rather
  // than merely unused — `inviteCode` is a capability for a second endpoint, and
  // a capability sitting in a cache is one refactor away from being used again.
  // Nothing on the public path reads it: the public page, the fork and Explore
  // never touch `trip.inviteCode`, and the owner's own surfaces read the trips
  // table under RLS.
  const fetched = rowToTrip({ ...rows[0], invite_code: null }, [])
  // #349 — the RPC is the server truth FOR THIS VIEWER on every call, so a
  // re-fetch has to REPLACE the cached row. Insert-if-absent is what kept the
  // public page locked after a paid unlock: the re-read answered with real
  // days while `tripById` went on serving the pre-purchase stub, so the page
  // body (`cachedTrip ?? fetched`) and the fork both stayed on placeholders
  // until a reload. The same convergence runs the other way when a publication
  // changes what it withholds. One mechanism, not two: the page keeps reading
  // the store, and the store keeps up with the wire.
  //
  // The one thing the RPC cannot carry is `members` — rowToTrip is handed an
  // empty list — so a cached membership is carried over into the replacement
  // instead of being dropped. It is the vote quorum's denominator and has
  // nothing to do with the paywall.
  const existing = cache.trips.find(t => t.id === fetched.id)
  // Same two guards the realtime handler uses, for the same reasons: a strictly
  // older row is a replay of something we already applied (the ledger holds the
  // newest server clock this session has seen), and a write this session just
  // made still outranks the wire — its echo is on the way with this same row.
  if (existing && isStaleServerRow(serverTripTimestamps.get(fetched.id), fetched.updatedAt)) {
    return existing
  }
  if (existing && isRecentLocalWrite(recentLocalWrites, 'trips', fetched.id, Date.now())) {
    return existing
  }
  recordServerTripTimestamp(fetched.id, fetched.updatedAt)
  const trip = existing ? { ...fetched, members: existing.members ?? [] } : fetched
  cache.trips = existing
    ? cache.trips.map(t => (t.id === trip.id ? trip : t))
    : [...cache.trips, trip]
  commit()
  return trip
}

/**
 * Resolve a short invite code ("GOA-K7QF") to its trip via the
 * security-definer `get_trip_by_invite_code` RPC — the code is the
 * capability, so this works for private trips and logged-out visitors
 * alike (the join gate previews before login). Merges the trip into the
 * cache so the workspace can open it without another round-trip. Returns
 * null for an unknown code.
 */
export async function fetchTripByInviteCode(code: string): Promise<Trip | null> {
  const epoch = identityEpoch
  const userId = cache.sessionUserId
  const normalized = normalizeInviteCode(code)
  if (!normalized) return null
  // A member who re-clicks the link already has the FULL row cached, and that
  // row is safe to reuse: it came from a full read, not from the preview RPC.
  // The preview RPC's own answer is never cached, so this can only hit a
  // complete row.
  const cached = cache.trips.find(t => t.inviteCode === normalized)
  if (cached) return cached
  const rpc = await supabase.rpc('get_trip_by_invite_code', { p_code: normalized })
  if (epoch !== identityEpoch || cache.sessionUserId !== userId) return null
  if (rpc.error) console.error('[yatraflow] invite-code lookup failed', rpc.error)
  const rows = rpc.data as TripRow[] | null
  if (!Array.isArray(rows) || rows.length === 0) return null
  // #804 — get_trip_by_invite_code names 31 of the 34 trips columns, so this row
  // is INCOMPLETE: flights, tank_l, rent_per_day_inr, local_train and ref are
  // absent. It is returned to the caller, which keeps it in local state for the
  // gate to render, and it is deliberately NOT put into cache.trips, the offline
  // queues or any snapshot.
  //
  // That is the whole fix. A partial row that never enters the writable cache
  // cannot be built into a whole-row UPDATE, so no write can erase the five
  // columns it never read. An earlier design marked such a row and taught every
  // writer to skip the five; two Gates showed that guard leaking through each
  // consumer of the cache in turn (stale revisions, account switches, explicit
  // edits, Replace). A row kept out of the cache removes the cause instead of
  // guarding it.
  //
  // The caller cannot write this trip anyway: it is not a member yet, so RLS
  // refuses. After joinViaInvite the full row is fetched into the cache.
  const preview = rows[0]
  // B3 (round 10) — provenance, in the same terms as every other admission: no
  // shape, no trip. A preview that names no trip id, or carries no usable
  // revision, is not an answer this client can act on. The gate treats a refusal
  // as a dead link instead of previewing and joining an unrelated trip.
  if (typeof preview?.id !== 'string' || preview.id.length === 0 || !validWriteVersion(preview.write_version)) return null
  return rowToTrip(preview, [])
}

/** The invite code the server holds for a trip. `undefined` means the read
 *  failed, so the caller must not guess. `null` means the server holds none. */
async function readServerInviteCode(tripId: ID, token: string): Promise<string | null | undefined> {
  const { data, error } = await supabase.from('trips').select('invite_code').eq('id', tripId).maybeSingle()
    .setHeader('Authorization', `Bearer ${token}`)
  if (error) {
    console.error('[yatraflow] invite-code read failed', error)
    return undefined
  }
  const row = data as { invite_code: string | null } | null
  return row?.invite_code || null
}

/**
 * Mint the invite code for one of the viewer's trips, when the server holds none, and
 * persist it. Codes are shown on the Share tab; minting happens lazily on
 * first share rather than at trip creation, so the DB column can be absent
 * (probe false) without breaking trip creation. A unique clash regenerates
 * the tail; the caller surfaces a final failure honestly.
 */
export async function ensureInviteCode(tripId: ID): Promise<string | null> {
  const scope = identityScope()
  const t = tripById(tripId)
  if (!scope || !t) return null
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  const live = () => canSendTripWrite(scope, tripId, accessEpoch)
  if (!live()) return null
  if (t.inviteCode) return t.inviteCode
  const cols = await tripsHaveOptionalColumns()
  if (!cols.inviteCode || !live()) return null
  const token = await tripWriteToken(scope)
  if (!token || !live()) return null
  // A cached trip without a code does not prove the server has none. Read the
  // server first, so a code that already exists is never replaced.
  const held = await readServerInviteCode(tripId, token)
  if (held === undefined || !live()) return null
  if (held) {
    mutateTrip(tripId, draft => { draft.inviteCode = held }, { touch: false })
    return held
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeInviteCode(t)
    // The write lands only while the server still holds no code.
    let uniqueClash = false
    const saved = await persistTripMetadata(tripId, { invite_code: code }, { inviteCode: code }, 'invite_code', error => {
      uniqueClash = error.code === '23505' || /duplicate key|unique/i.test(error.message ?? '')
      if (!uniqueClash) console.error('[yatraflow] invite-code mint failed')
    })
    if (!live()) return null
    if (saved) return code
    const again = await readServerInviteCode(tripId, token)
    if (!live() || again === undefined) return null
    if (again) {
      mutateTrip(tripId, draft => { draft.inviteCode = again }, { touch: false })
      return again
    }
    if (!uniqueClash) return null
  }
  return null
}

export interface NewTripInput {
  name: string; startLocation: string; destinations: string[];
  startLocationCoords?: LatLngPoint;
  destinationCoords?: (LatLngPoint | null)[];
  startDate: string; endDate: string; travellers: number;
  /** licensed drivers rotating the wheel (#142) — default 1 when unset */
  driverCount?: number;
  /** infants/seniors aboard (#142) — shorter honest days, earlier dinner */
  hasVulnerable?: boolean;
  /** minutes of driving allowed after the dinner halt (#122, default 0) */
  driveAfterDinnerMin?: number;
  transportMode: Trip['transportMode']; budgetPerPersonInr: number;
  /** Mixed only (2026-10-19): the traveller's driving answer. Undefined = a new
   *  Mixed trip, which the form refuses to create without one. */
  drivesPart?: boolean;
  /** optional km/L for car/motorcycle trips — fuels an accurate transport estimate */
  fuelEconomyKmL?: number;
  /** optional local pump price (₹/L) — defaults to the indicative national average */
  fuelPricePerL?: number;
  /** true when the self-drive route also drives back to its start (default for car/motorcycle) */
  roundTrip?: boolean;
  /** #377 — the create form's stated vehicle inputs. Persisted so Settings
   *  opens showing what the user typed instead of the mode defaults. */
  vehicleProfile?: VehicleProfile;
  tankL?: number;
  rentPerDayInr?: number;
  localTrain?: boolean;
  travelStyle: Trip['travelStyle'];
  /** Stay budget tier — the separate pricing dial. Set at create time from the
   *  Budget preference bar, so a new trip never depends on the legacy style. */
  stayStyle?: Trip['stayStyle'];
  fixedCommitments: (Omit<FixedCommitment, 'id'> & { destName?: string })[];
  coverEmoji?: string;
  /** optional owner-chosen cover image URL; when set it is the trip's canonical cover */
  coverImageUrl?: string;
  /** The create form's one departure answer, stamped onto EVERY day's
   *  `startTime`. Absent means the user never answered, so the days stay unset
   *  and the engine's 08:30 default governs — an untouched field must not
   *  invent a clock the traveller never chose. Junk is dropped, not clamped. */
  dayStartTime?: string;
}

// ---------------- Trip dates & day-count reconciliation ----------------

/** Reconcile a trip's `days` array to a new date range: lengthening appends
 *  empty days at the end; shortening drops trailing EMPTY days only. Days
 *  holding stops — or referenced by a fixed commitment — are never silently
 *  deleted; the returned error names the first blocked day so the UI can
 *  tell the user to clear it first, and `blocked` carries EVERY load-bearing
 *  day index that stands in the way (#408: the settings form links each one
 *  straight to its timeline day instead of naming just the first). Indexes
 *  are re-sequenced after any change. Pure: no store access, node-testable. */
export function reconcileDays(
  days: ItineraryDay[],
  newStartDate: string,
  newEndDate: string,
  protectedDayIndexes: Set<number> = new Set(),
): { days: ItineraryDay[]; error?: string; blocked?: number[] } {
  const start = new Date(`${newStartDate}T00:00:00`)
  const end = new Date(`${newEndDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { days, error: 'Dates are not valid.' }
  }
  if (end < start) {
    return { days, error: 'The end date must be on or after the start date.' }
  }
  const target = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  let next = structuredClone(days)

  if (target < next.length) {
    // Only trailing FREE days may be dropped — a day with stops or a fixed
    // commitment is load-bearing and the user must move those first.
    const loadBearing = (d: ItineraryDay) => d.stops.length > 0 || protectedDayIndexes.has(d.index)
    let last = next.length
    while (last > target && !loadBearing(next[last - 1])) last--
    if (last > target) {
      const blocked = next.slice(target).filter(loadBearing)
      return {
        days,
        error: `Day ${(blocked[0]?.index ?? target) + 1} still has stops or a fixed commitment or a flight — move or delete them before shortening the trip.`,
        blocked: blocked.map(d => d.index),
      }
    }
    next = next.slice(0, last)
  } else if (target > next.length) {
    while (next.length < target) {
      next.push({ id: uid('day'), index: next.length, stops: [] })
    }
  }

  next.forEach((d, i) => { d.index = i })
  return { days: next }
}

/** Link a created commitment to its stop (#609, stored link). The create form
 *  names a destination; the seeded day holds that destination as a stop, so
 *  the name resolves to a stop id here, once, at creation. Exact name match
 *  only — anything else stays unlinked and says so. */
export function linkCommitmentStop(stops: ItineraryStop[], destName: string): ID | undefined {
  const want = destName.toLowerCase().trim()
  if (!want) return undefined
  return stops.find(s =>
    s.title.toLowerCase().trim() === want || s.locationName.toLowerCase().trim() === want,
  )?.id
}

/** Build the trip a create form describes. Pure: adds nothing to the cache and
 *  writes nothing, so the two creators below cannot drift apart (#374). */
function buildNewTrip(ownerId: ID, input: NewTripInput, seedStops?: ItineraryStop[][]): Trip {
  const dayCount = Math.max(1, diffDays(input.startDate, input.endDate))
  // The create form asks for ONE departure time, not one per day. It lands on
  // each day's own `startTime` — the field the timeline and the clock walk
  // already read — so the workspace opens showing the time the user chose
  // instead of the 08:30 default. Absent/invalid leaves every day unset.
  const { dayStartTime, ...tripInput } = input
  const dayStart = validHM(dayStartTime)
  const days: ItineraryDay[] = Array.from({ length: dayCount }, (_, i) => ({
    id: uid('day'), index: i, stops: [],
    ...(dayStart ? { startTime: dayStart } : {}),
  }))

  // Anchor stops for point A (trip start) and point B (final destination), so
  // the route and estimates are grounded even before the user adds places in
  // between. Only created when a real geocoded place was picked.
  const startAnchor = input.startLocationCoords
    ? autoAnchor(input.startLocationCoords, input.startLocation)
    : null
  const dests = input.destinations
  const lastIdx = dests.length - 1
  const endAnchor = lastIdx >= 0 && input.destinationCoords?.[lastIdx]
    ? autoAnchor(input.destinationCoords[lastIdx]!, dests[lastIdx])
    : null

  // User-seeded per-day stops land between the anchors.
  days.forEach((d, i) => {
    const base = seedStops?.[i] ?? []
    const isFirst = i === 0
    const isLast = i === dayCount - 1
    const list = [
      ...(isFirst && startAnchor ? [startAnchor] : []),
      ...base,
      ...(isLast && endAnchor ? [endAnchor] : []),
    ]
    d.stops = list.map((s, n) => ({ ...s, orderInDay: n + 1 }))
  })

  const trip: Trip = {
    id: uuid(),
    ...tripInput,
    startLocationCoords: input.startLocationCoords,
    destinationCoords: input.destinationCoords,
    fixedCommitments: input.fixedCommitments.map(fc => {
      const { destName, ...rest } = fc
      const day = days.find(d => d.index === fc.dayIndex)
      const stopId = destName && day ? linkCommitmentStop(day.stops, destName) : undefined
      return { ...rest, ...(stopId ? { stopId } : {}), id: uid('fc') }
    }),
    days, expenses: [], coverEmoji: input.coverEmoji ?? '🧭',
    coverImageUrl: input.coverImageUrl ?? undefined,
    visibility: 'private', createdAt: Date.now(), updatedAt: Date.now(),
    creationKind: 'created',
    members: [{ userId: ownerId, role: 'owner' as const, joinedAt: Date.now() }],
  } as Trip
  return trip
}

/** Create a trip optimistically: it is in the cache the moment this returns and
 *  the row write is fire-and-forget. Callers that must not navigate into a
 *  workspace a failed write will empty use `createTripPersisted` (#374). */
export function createTrip(ownerId: ID, input: NewTripInput, seedStops?: ItineraryStop[][]): Trip {
  const trip = buildNewTrip(ownerId, input, seedStops)
  admitTripCopy(trip)
  void persistTrip(trip, ownerId)
  return trip
}

/** Create a trip and WAIT for its rows (#374). The page must not route into the
 *  workspace before this answers: a failed save used to leave the user in a
 *  trip that vanished on the next reload, with only a toast saying so.
 *
 *  `persisted: false` means the trip was rolled back out of the cache and the
 *  caller has to stay on the form and offer a retry — so the BUILT trip comes
 *  back either way, and the retry re-uses it instead of minting a twin. */
export async function createTripPersisted(ownerId: ID, input: NewTripInput, seedStops?: ItineraryStop[][]): Promise<{ trip: Trip; persisted: boolean }> {
  const trip = buildNewTrip(ownerId, input, seedStops)
  admitTripCopy(trip)
  // A THROW is a failed save too: supabase-js answers with an error object for
  // a refused write, but a dropped fetch can reject instead, and without this
  // the optimistic row would stay in the cache as the zombie #374 is about.
  let persisted = false
  try { persisted = await persistTrip(trip, ownerId) }
  catch (e) { console.error('[yatraflow] create failed', e) }
  if (!persisted) retractTripCopy(trip)
  return { trip, persisted }
}

/** Retry a create whose write failed, with the SAME trip object — never a new
 *  id, so a first attempt that reached the server after the client gave up is
 *  not followed by a twin. Re-admits the trip for the retry and retracts it
 *  again if this attempt fails too; the `retry` flag lets this one meet its own
 *  earlier rows without calling them a failure (see persistTrip). */
export async function retryCreateTrip(trip: Trip, ownerId: ID): Promise<boolean> {
  return retryTripSave(trip, ownerId, 'create retry failed')
}

/** Retry an import whose save failed (#551) — the SAME contract as
 *  `retryCreateTrip`: same trip object, `retry: true`, retract on failure. */
export async function retryImportTrip(trip: Trip, ownerId: ID): Promise<boolean> {
  return retryTripSave(trip, ownerId, 'import retry failed')
}

async function retryTripSave(trip: Trip, ownerId: ID, label: string): Promise<boolean> {
  if (!cache.trips.some(t => t.id === trip.id)) admitTripCopy(trip)
  let persisted = false
  try { persisted = await persistTrip(trip, ownerId, { retry: true }) }
  catch (e) { console.error(`[yatraflow] ${label}`, e) }
  if (!persisted) retractTripCopy(trip)
  return persisted
}

/** A zero-dwell, auto anchor stop for a trip start/end point. */
function autoAnchor(coords: LatLngPoint, name: string): ItineraryStop {
  return {
    id: uid('st'), title: name, category: 'travel', locationName: name,
    lat: coords.lat, lng: coords.lng, visitMinutes: 0,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'must-do', status: 'confirmed', orderInDay: 1, auto: true,
  }
}

// ---------------- Optional-column capability probe ----------------
// The optional trip columns ship with supabase/schema.sql, but databases
// created before them (e.g. a shared demo project) reject writes that mention
// an unknown column. Probe lazily with harmless reads. Only a DEFINITIVE
// "column missing" result (PGRST204/42703) is cached — a transient network or
// auth error must not pin the columns to false for the whole session (#17), or
// fuel economy / pump price / one-way settings silently stop persisting.
let optionalColumnsProbe: Promise<OptionalColumnsProbe> | null = null
let optionalColumnsWarned = false
/** The last resolved probe, readable SYNCHRONOUSLY. The write path has to
 *  decide in one turn whether it may store a Mixed answer, so it cannot await
 *  a promise here. Null before the first probe resolves means "not known yet",
 *  which is not a refusal: an unknown column is assumed present, the same
 *  optimistic rule `probeOptionalColumn` already uses for a transient error. */
let lastResolvedOptionalColumns: OptionalColumnsProbe | null = null

function tripsHaveOptionalColumns(): Promise<OptionalColumnsProbe> {
  if (!isSupabaseConfigured) return Promise.resolve({ economy: false, price: false, roundTrip: false, cover: false, inviteCode: false, deleted: false, stayStyle: false, driverCount: false, hasVulnerable: false, driveAfterDinner: false, vehicleProfile: false, tankL: false, rentPerDayInr: false, localTrain: false, ref: false, flights: false, drivesPart: false })
  // Route the resolved probe through the synchronous cache the write path reads.
  if (!optionalColumnsProbe) optionalColumnsProbe = probeOptionalColumns().then(rememberOptionalColumns)
  return optionalColumnsProbe
}

/** #804 (round 10 B3) — the optional columns, SYNCHRONOUSLY, for the admission
 *  check that cannot await. Before the probe settles, every known column is
 *  assumed present: a full row read by `select('*')` carries them all, and the
 *  check only asks which columns the writer would send. */
function knownOptionalColumns(): OptionalColumnsProbe {
  // A `select('*')` row carries every known column, or omits it entirely. The
  // check above already refuses an omitted column, so a null here means the
  // database stores null in a column the writer knows. Assuming "known" for
  // every column is so the fail-closed answer, and it keeps a
  // placeholder build and the tests from refusing every legitimate row.
  return { economy: true, price: true, roundTrip: true, cover: true, inviteCode: true, deleted: true, stayStyle: true, driverCount: true, hasVulnerable: true, driveAfterDinner: true, vehicleProfile: true, tankL: true, rentPerDayInr: true, localTrain: true, drivesPart: true, ref: true, flights: true }
}

async function probeOptionalColumns(): Promise<OptionalColumnsProbe> {
  const [economy, price, roundTrip, cover, inviteCode, deleted, stayStyle, driverCount, hasVulnerable, driveAfterDinner, vehicleProfile, tankL, rentPerDayInr, localTrain, ref, flights, growth, drivesPart] = await Promise.all([
    probeOptionalColumn('fuel_economy_km_per_l'),
    probeOptionalColumn('fuel_price_per_l'),
    probeOptionalColumn('round_trip'),
    probeOptionalColumn('cover_image_url'),
    probeOptionalColumn('invite_code'),
    probeOptionalColumn('deleted_at'),
    probeOptionalColumn('stay_style'),
    // 20260915_trip_party_prefs.sql — party + vehicle preferences
    probeOptionalColumn('driver_count'),
    probeOptionalColumn('has_vulnerable'),
    probeOptionalColumn('drive_after_dinner_min'),
    probeOptionalColumn('vehicle_profile'),
    // 20260928_trip_vehicle_estimates.sql — the create form's vehicle inputs
    probeOptionalColumn('tank_l'),
    probeOptionalColumn('rent_per_day_inr'),
    probeOptionalColumn('local_train'),
    // 20260929_pub_events_share_source.sql — share attribution
    probeOptionalColumn('ref'),
    // 20261012c_trip_flights.sql — the flights a flight-mode trip takes
    probeOptionalColumn('flights'),
    probeOptionalColumn('creation_kind'),
    // 20261019_trip_drives_part.sql — the Mixed driving answer
    probeOptionalColumn('drives_part'),
  ])
  if (!economy || !price || !roundTrip) {
    if (!optionalColumnsWarned) {
      console.warn('[yatraflow] trips optional columns missing — run supabase/schema.sql; fuel/round-trip inputs stay session-only until then.')
      optionalColumnsWarned = true
    }
  }
  return { economy, price, roundTrip, cover, inviteCode, deleted, stayStyle, driverCount, hasVulnerable, driveAfterDinner, vehicleProfile, tankL, rentPerDayInr, localTrain, ref, flights, growth, drivesPart }
}

/** Cache the probe where the synchronous write path can read it. */
function rememberOptionalColumns(cols: OptionalColumnsProbe): OptionalColumnsProbe {
  lastResolvedOptionalColumns = cols
  return cols
}

/** Probe one optional column. True = present (or transient error, treated optimistically). */
async function probeOptionalColumn(column: string): Promise<boolean> {
  const { error } = await supabase.from('trips').select(column).limit(1)
  if (!error) return true
  if (isMissingColumnError(error)) return false
  // Transient error (network / auth / RLS hiccup): never cache a false negative.
  // Assume the column exists so the next write attempts it — a genuinely missing
  // column then fails loudly via the save toast instead of silently dropping the
  // settings — and clear the cached probe so the next call re-checks.
  optionalColumnsProbe = null
  return true
}

// Same capability-probe idea for published_itineraries.refreshed_at (v0.37):
// databases created before that migration reject upserts that mention it, and
// publication is too important to break on an un-migrated project.
let refreshedAtProbe: Promise<boolean> | null = null
function publishedHaveRefreshedAt(): Promise<boolean> {
  if (!isSupabaseConfigured) return Promise.resolve(false)
  if (!refreshedAtProbe) {
    refreshedAtProbe = (async () => {
      try {
        const { error } = await supabase.from('published_itineraries').select('refreshed_at').limit(1)
        if (!error) return true
        if (isMissingColumnError(error)) return false
      } catch { /* thrown transport error — treat like any transient failure */ }
      refreshedAtProbe = null // transient — re-check on the next call
      return true
    })()
  }
  return refreshedAtProbe
}

// Third use of the same capability probe, for
// published_itineraries.unpublished_at (#350, 20260925_publication_soft_unpublish.sql).
// Mirrored exactly rather than generalised: publication is too important to
// break on an un-migrated project, and the fail-closed direction differs here
// — the publish path OMITS the column, the unpublish path REFUSES (see
// unpublishItinerary, where falling back to the old delete would take every
// buyer's entitlement with it).
let unpublishedAtProbe: Promise<boolean> | null = null
function publishedHaveUnpublishedAt(): Promise<boolean> {
  if (!isSupabaseConfigured) return Promise.resolve(false)
  if (!unpublishedAtProbe) {
    unpublishedAtProbe = (async () => {
      try {
        const { error } = await supabase.from('published_itineraries').select('unpublished_at').limit(1)
        if (!error) return true
        if (isMissingColumnError(error)) return false
      } catch { /* thrown transport error — treat like any transient failure */ }
      unpublishedAtProbe = null // transient — re-check on the next call
      return true
    })()
  }
  return unpublishedAtProbe
}

// Capability probes cache their answer for the session, which is right for a
// synchronous write path and wrong for a retry: a database repaired between the
// first try and the second (a migration installed, a column added) would keep
// answering "missing" from the cache and refuse forever. An explicit retry is
// the user saying "try again now", so the negative answers are dropped and the
// next probe re-asks the server.
function refreshNegativeCapabilityProbes(): void {
  refreshedAtProbe = null
}

const tripCreates = new Map<string, Promise<boolean>>()

/** Everything a recovery must carry into primary persistence, in ONE object so a
 *  caller cannot supply half of it: a guard without a token would let a retired
 *  try keep writing, and a token without a guard would pin the wrong account. */
export interface RecoveryWriteGuard {
  /** True while this recovery still owns the trip. Checked before and after every
   *  awaited phase, so a retired try performs no later write or cache mutation. */
  live: AttemptGuard
  /** The bearer captured for the recovery's account. */
  token: string
}

/** Pin a request to the captured account. Ordinary callers pass no token and get
 *  the client's own session, exactly as before. */
function pinBearer<T extends { setHeader(name: string, value: string): T }>(query: T, token?: string): T {
  return token ? query.setHeader('Authorization', `Bearer ${token}`) : query
}

async function persistTrip(trip: Trip, ownerId: ID, opts: { retry?: boolean; recovery?: RecoveryWriteGuard } = {}): Promise<boolean> {
  const operation = persistTripRows(trip, ownerId, opts)
  tripCreates.set(trip.id, operation)
  try { return await operation } finally { if (tripCreates.get(trip.id) === operation) tripCreates.delete(trip.id) }
}

async function persistTripRows(trip: Trip, ownerId: ID, opts: { retry?: boolean; recovery?: RecoveryWriteGuard }): Promise<boolean> {
  const recovery = opts.recovery
  const epoch = identityEpoch
  const sessionId = cache.sessionUserId
  // A retired recovery must perform no later write or cache mutation, so this
  // gate runs before and after every awaited phase below. Ordinary callers pass
  // no guard and keep their existing behaviour unchanged.
  const guard = (): boolean => !recovery || recovery.live()
  // A recovery reports its own failure through the guarded toast that carries the
  // retry action, so the generic create message must not fire underneath it. The
  // severity is the caller's and must not change with it: the drives-part refusal
  // was always an error, the create failures were plain, and both stay as they
  // were for ordinary callers.
  const refuse = (reason: string, kind: 'ok' | 'err' = 'ok'): false => {
    if (!recovery) toast(reason, kind)
    return false
  }
  if (!guard()) return false
  // Claim the echo window before the await — see persistTripFieldNow.
  markLocalWrite('trips', trip.id)
  const cols = await tripsHaveOptionalColumns()
  if (!guard()) return false
  // Guard AFTER the awaited probe, at the writer, not at the caller (2026-10-19).
  // Every `tripToRow` below silently omits a column the probe says is missing,
  // so an explicit Mixed answer would be dropped here and the save would still
  // report success. This is the seam where that has to stop.
  const drivesPartVerdict = drivesPartWriteVerdict(trip, cols)
  if (!drivesPartVerdict.ok) return refuse(drivesPartVerdict.reason, 'err')
  const { data: inserted, error } = await pinBearer(
    supabase.from('trips').insert(tripToRow(trip, ownerId, cols)).select('id, write_version'),
    recovery?.token,
  )
  if (!guard()) return false
  const row = Array.isArray(inserted) && inserted.length === 1 ? inserted[0] : null
  if (!error && row?.id === trip.id && validWriteVersion(row.write_version)
    && epoch === identityEpoch && cache.sessionUserId === sessionId) {
    trip.writeVersion = row.write_version
    const cached = tripById(trip.id)
    if (cached) cached.writeVersion = row.write_version
    const held = queuedLocalTrips.get(trip.id)
    if (held?.ownerId === ownerId && held.baseVersion === undefined) {
      const rebased = { ...held, baseVersion: row.write_version,
        trip: { ...held.trip as Trip, writeVersion: row.write_version } }
      queuedLocalTrips.set(trip.id, rebased)
      await requeueIfCurrent(rebased)
      // Re-basing the queued copy awaits, so the guard runs again here: a
      // recovery retired while this awaited must not reach the membership writes
      // below. This closes the last unguarded await in the stated contract.
      if (!guard()) return false
    }
  }
  // A RETRY can meet the row its own first attempt wrote (#374): the insert
  // then fails on the primary key while the trip exists and the create has in
  // fact landed. Tolerating that case is the whole point of retrying with the
  // same id — the alternative is telling the user a trip failed to save while
  // it sits in their list. (An upsert cannot express this: the `trips update`
  // policy is `is_editor`, which reads the member row that the same first
  // attempt may not have written yet, so it is refused.)
  const duplicateMyOwnRow = (e: unknown) => (e as { code?: string } | null)?.code === '23505'
  if (error && !(opts.retry && duplicateMyOwnRow(error))) return refuse('Could not save trip.')
  if (error) {
    if (!guard()) return false
    // A conflict proves only that some row exists. Verify this owner's row before accepting a retry.
    const { data: saved, error: readError } = await pinBearer(
      supabase.from('trips').select('*').eq('id', trip.id).eq('owner_id', ownerId).maybeSingle(),
      recovery?.token,
    )
    if (!guard()) return false
    if (readError || !saved) return false
    if (trip.creationKind === 'forked' && saved.creation_kind != null
      && (saved.creation_kind !== 'forked' || saved.source_pub_id !== trip.sourcePubId)) return false
    Object.assign(trip, rowToTrip(saved as TripRow, trip.members ?? []))
    commit()
  }
  const { error: mErr } = await pinBearer(
    supabase.from('trip_members').insert(
      (trip.members ?? []).map(m => ({ trip_id: trip.id, user_id: m.userId, role: m.role, joined_at: m.joinedAt }))
    ),
    recovery?.token,
  )
  if (!guard()) return false
  // A member row is what makes the trip visible to its owner after a reload —
  // without it the trips row is an invisible orphan, so a failure here counts
  // as "not persisted" even though the trips row landed. Same tolerance on a
  // retry: the membership we are inserting may already be there.
  if (mErr && !(opts.retry && duplicateMyOwnRow(mErr))) {
    console.error('member insert failed', mErr)
    return refuse('Could not save trip.')
  }
  if (mErr) {
    if (!guard()) return false
    const { data: owner, error: readError } = await pinBearer(
      supabase.from('trip_members').select('user_id, role, joined_at')
        .eq('trip_id', trip.id).eq('user_id', ownerId).maybeSingle(),
      recovery?.token,
    )
    if (!guard()) return false
    if (readError || !owner || owner.role !== 'owner') return false
    trip.members = [{ userId: owner.user_id, role: 'owner', joinedAt: owner.joined_at }]
    commit()
  }
  return true
}

/** Copy text stamped onto every stop of a premium (non-free) day when a
 *  published itinerary is forked. Titles stay so the fork keeps the trip's
 *  shape; every other detail is stripped. */
const LOCKED_STOP_DESCRIPTION = 'Locked — the full plan is on the original itinerary.'

/** Shared body for every trip copy (fork / copy-this-trip / share import).
 *  Strips the fields a copy must NEVER inherit: `inviteCode` would collide with
 *  the source's row on the unique `idx_trips_invite_code` index and fail the
 *  whole insert — every fork of a trip that had ever been invite-shared
 *  silently vanished on the next reload — and a `deletedAt` tombstone would
 *  land the copy straight in the trash.
 *
 *  `freeDayIndexes` (the published-itinerary fork) keeps those days fully
 *  intact and reduces every other day's stops to stubs: title and priority
 *  are kept, the description becomes the locked notice, notes are cleared,
 *  entry/transport costs and open/close times are zeroed, and the stop is
 *  marked confirmed. Expenses tagged with a locked `dayIndex` and fixed
 *  commitments on locked days are dropped (trip-level expenses stay). */
function buildTripCopy(source: Trip, ownerId: ID, opts: { makePublic?: boolean; freeDayIndexes?: number[]; keepName?: boolean; ref?: ShareSource | null; origin?: ForkOrigin }): Trip {
  const free = opts.freeDayIndexes ? new Set(opts.freeDayIndexes) : null
  const copy: Trip = structuredClone(source)
  copy.id = opts.origin?.requestId ?? uuid()
  copy.writeVersion = undefined
  // A copy is labelled as one. An *import* is not — the plan is the user's own
  // arrival, not a duplicate of something they already have, and a name that
  // reads "X (copy)" is how the public gallery grew a `(copy)` row.
  copy.name = opts.keepName || source.name.includes('(copy)')
    ? source.name
    : `${source.name} (copy)`
  copy.visibility = opts.makePublic ? 'public' : 'private'
  copy.createdAt = Date.now(); copy.updatedAt = Date.now()
  copy.inviteCode = undefined
  copy.deletedAt = undefined
  // #230 — the fork's own acquisition stamp, never the source trip's. A copy
  // of a copy starts a NEW attribution chain at whatever surface forked it.
  copy.ref = opts.ref ?? undefined
  copy.creationKind = opts.origin ? 'forked' : opts.keepName ? 'imported' : 'copied'
  copy.sourcePubId = opts.origin?.publicationId
  copy.campaignId = opts.origin ? campaignId(opts.origin.campaign) ?? undefined : undefined
  // Fresh stop ids would dangle every commitment link, so each copy carries
  // its stops' old-to-new map and rewrites the links through it (#609).
  const stopIdMap = new Map<string, ID>()
  const freshStopId = (s: ItineraryStop): ItineraryStop => {
    const id = uid('st')
    stopIdMap.set(String(s.id), id)
    return { ...s, id }
  }
  const remapCommitment = (f: FixedCommitment): FixedCommitment => ({
    ...f,
    id: uid('fc'),
    stopId: f.stopId != null ? stopIdMap.get(String(f.stopId)) : undefined,
  })
  if (free) {
    copy.days = copy.days.map(d => ({
      ...d,
      id: uid('day'),
      stops: d.stops.map(s => free.has(d.index)
        ? freshStopId(s)
        : {
            ...freshStopId(s),
            description: LOCKED_STOP_DESCRIPTION,
            notes: '',
            entryFeeInrPerPerson: 0,
            transportCostInrTotal: 0,
            openTime: undefined,
            closeTime: undefined,
            status: 'confirmed' as const,
          }),
    }))
    copy.expenses = copy.expenses
      .filter(e => e.dayIndex === undefined || free.has(e.dayIndex))
      .map(e => ({ ...e, id: uid('ex') }))
    copy.fixedCommitments = copy.fixedCommitments
      .filter(f => free.has(f.dayIndex))
      .map(remapCommitment)
  } else {
    copy.days = copy.days.map(d => ({ ...d, id: uid('day'), stops: d.stops.map(freshStopId) }))
    copy.expenses = copy.expenses.map(e => ({ ...e, id: uid('ex') }))
    copy.fixedCommitments = copy.fixedCommitments.map(remapCommitment)
  }
  copy.flights = copy.flights?.filter(f => !free || free.has(f.dayIndex)).map(f => ({ ...f, id: uid('fl') }))
  copy.members = [{ userId: ownerId, role: 'owner' as const, joinedAt: Date.now() }]
  copy.coverImageUrl = source.coverImageUrl
  return copy
}

/** The cache entry a re-admission replaced, and the debounced write that was
 *  already queued for its id. A failed retry puts the entry back and keeps the
 *  write, so neither a saved trip nor the edit pending against it is lost. */
type DisplacedTrip = {
  trip: Trip
  index: number
  pending: { timer: ReturnType<typeof setTimeout> } | undefined
}

/** Add a built copy to the live cache (optimistic UI; the caller persists).
 *
 *  A re-admission replaces the entry with the same id: a fork retry keeps its
 *  pending action id, so the retry can build the trip again. The replaced entry
 *  is returned. It may be a trip that is already saved on the server, so only a
 *  failed retry may remove this operation's own object (see retractTripCopy). */
function admitTripCopy(copy: Trip): DisplacedTrip | undefined {
  const index = cache.trips.findIndex(t => t.id === copy.id)
  const displaced = index >= 0
    ? { trip: cache.trips[index], index, pending: pendingTripWrites.get(copy.id) }
    : undefined
  cache.trips = [...cache.trips.filter(t => t.id !== copy.id), copy]
  commit()
  return displaced
}

/** Roll a failed-persist copy back out of the cache so the user is never left
 *  with a zombie trip that vanishes on the next reload.
 *
 *  Only the object this operation admitted is removed. The cache entry with the
 *  id can be a newer server row, and a retry can displace a trip that is already
 *  saved; neither belongs to this failure. The displaced entry is restored in
 *  its old place, so a failed fork retry leaves the saved trip in My Trips.
 *
 *  A pending debounced write for the same id is cancelled only when it belongs
 *  to this optimistic object (#374): a retracted trip whose row write is still
 *  in the coalescer would land on the server seconds later with no cache row in
 *  front of it, and the trip would reappear on the next hydrate — the "it
 *  vanished, then it was there" the create path used to produce. A write that
 *  was already queued when the retry displaced a saved trip is that trip's own
 *  edit, so it stays queued. */
function retractTripCopy(copy: Trip, displaced?: DisplacedTrip): void {
  // Compare identity, never the id: a newer entry with this id is not ours.
  if (!cache.trips.includes(copy)) return
  const pending = pendingTripWrites.get(copy.id)
  if (pending && pending !== displaced?.pending) {
    clearTimeout(pending.timer)
    pendingTripWrites.delete(copy.id)
  }
  const next = cache.trips.filter(t => t !== copy)
  if (displaced) next.splice(Math.min(displaced.index, next.length), 0, displaced.trip)
  cache.trips = next
  commit()
}

/** Duplicate any trip into the user's workspace (Copy This Trip / share
 *  import). Fire-and-forget persist: the copy stays in the cache either way,
 *  so callers that must know the outcome use `duplicateTripPersisted`. */
export function duplicateTrip(source: Trip, ownerId: ID, makePublic?: boolean): Trip {
  const copy = buildTripCopy(source, ownerId, { makePublic })
  admitTripCopy(copy)
  void persistTrip(copy, ownerId)
  return copy
}

/** Import a trip the user brought with them — a file export or a gallery
 *  itinerary (`lib/tripImport.ts`). Identical to `duplicateTrip` except that it
 *  keeps the plan's own name: nothing is being copied, so " (copy)" would be a
 *  lie, and a published import would carry that lie into the gallery title.
 *  Fire-and-forget: callers that must know the outcome use
 *  `importTripPersisted` (#551). */
export function importTrip(source: Trip, ownerId: ID): Trip {
  const copy = buildTripCopy(source, ownerId, { keepName: true })
  admitTripCopy(copy)
  void persistTrip(copy, ownerId)
  return copy
}

/** Shared tail of every persisted copy: persist, then roll the cache copy back
 *  out on ANY failure — including a THROW. supabase-js answers a refused write
 *  with an error object, but a dropped fetch rejects, and an uncaught rejection
 *  would leave the optimistic row in the cache as the zombie §6i is about
 *  (#551): the same treatment createTripPersisted gives the create path. */
async function persistCopyOrRetract(copy: Trip, ownerId: ID, retry = false): Promise<boolean> {
  const displaced = admitTripCopy(copy)
  let persisted = false
  try { persisted = await persistTrip(copy, ownerId, { retry }) }
  catch (e) { console.error('[yatraflow] trip copy save failed', e) }
  if (!persisted) retractTripCopy(copy, displaced)
  return persisted
}

/** Duplicate that reports whether the rows actually landed, so the caller can
 *  toast the truth instead of a success the next reload will disprove. On
 *  failure the cache copy is retracted. */
export async function duplicateTripPersisted(source: Trip, ownerId: ID, makePublic?: boolean, ref?: ShareSource | null, origin?: ForkOrigin): Promise<{ trip: Trip; persisted: boolean }> {
  const copy = buildTripCopy(source, ownerId, { makePublic, ref, origin })
  const persisted = await persistCopyOrRetract(copy, ownerId, Boolean(origin))
  return { trip: copy, persisted }
}

/** Fork a PUBLISHED itinerary while respecting its premium gate — the
 *  `freeDayIndexes` variant of `duplicateTripPersisted`. */
export async function duplicateTripPublicPersisted(source: Trip, ownerId: ID, freeDayIndexes: number[], ref?: ShareSource | null, origin?: ForkOrigin): Promise<{ trip: Trip; persisted: boolean }> {
  const copy = buildTripCopy(source, ownerId, { freeDayIndexes, ref, origin })
  const persisted = await persistCopyOrRetract(copy, ownerId, Boolean(origin))
  return { trip: copy, persisted }
}

/** Import that reports whether the rows actually landed (#551) — the awaited
 *  sibling `ImportTripButton` and the snapshot page were missing: the caller
 *  toasts success only when `persisted` is true, and on failure retries the
 *  SAME trip object through `retryImportTrip` (its id is the idempotency key). */
export async function importTripPersisted(source: Trip, ownerId: ID): Promise<{ trip: Trip; persisted: boolean }> {
  const copy = buildTripCopy(source, ownerId, { keepName: true })
  const persisted = await persistCopyOrRetract(copy, ownerId)
  return { trip: copy, persisted }
}

// ============ Masteradmin console actions ============
// Every destructive console button funnels through an audited SECURITY DEFINER
// RPC (see supabase/migrations/20260909_masteradmin.sql §5). The pattern
// matches the rest of the store: optimistic cache update + commit() for an
// instant UI, then the RPC; on failure, roll the cache back and toast. The
// audit tab refreshes from the server after each action (the audit write
// happened server-side in the same transaction as the effect).

function requireAdmin(): boolean {
  if (!isAdminCached()) {
    toast('Admin only — this action needs a masteradmin session.', 'err')
    return false
  }
  return true
}

/** Re-read the audit log on demand (#367) — the Audit tab's Retry affordance
 *  and the tab-focus poll both land here, so a stale or failed read has one
 *  recovery path. Admin-scoped: a non-admin call is a no-op. */
export async function refreshAdminAuditNow(): Promise<void> {
  if (!isAdminCached()) return
  await refreshAdminAudit()
}

async function refreshAdminAudit(): Promise<void> {
  const userId = cache.sessionUserId
  if (!userId) return
  const epoch = identityEpoch
  try {
    const { data, error } = await fetchAdminAuditRows()
    if (epoch !== identityEpoch || cache.sessionUserId !== userId || !isAdminCached()) return
    if (error) throw error
    patch({ adminAudit: auditRowsToEntries(data), adminAuditFailed: false })
    commit()
  } catch (e) {
    if (epoch !== identityEpoch || cache.sessionUserId !== userId || !isAdminCached()) return
    // #367: surfaced, not swallowed — the tab shows a retry, because a failed
    // read rendered as "No admin actions yet" is a lie about the log, not an
    // empty log.
    console.error('[yatraflow] audit refresh failed', e)
    patch({ adminAuditFailed: true })
    commit()
  }
}

function rpcErrorMessage(e: unknown): string {
  const msg = (e as { message?: unknown })?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  return 'Admin action failed.'
}

/** Disable (or re-enable) any account. The RPC refuses self-disable. */
export async function adminSetDisabled(userId: ID, disabled: boolean): Promise<boolean> {
  if (!requireAdmin()) return false
  // The disabled flag is private metadata, so the optimistic edit applies only to
  // a PRIVATE row. An admin hydrates private rows for every account, so the row is
  // there; a public card is left alone rather than having a flag manufactured
  // onto it.
  const held = cache.users.find(u => u.id === userId)
  if (!held || !privateUser(held)) return false
  const owned: OwnedFields = { id: userId, patch: { isDisabled: disabled } }
  const applied = installCatalogEdit(owned, u => ({ ...u, profile: { ...u.profile, isDisabled: disabled } }))
  if (!applied) return false
  // The ledger's base is the flag the row held before this edit, and the intent is
  // the flag this edit wrote, so a refusal drops back to the base.
  const { error } = await supabase.rpc('admin_set_disabled', { p_user_id: userId, p_disabled: disabled })
  if (error) {
    console.error('[yatraflow] admin_set_disabled failed', error)
    settleOwnedFields(owned, applied, 'failed')
    toast(rpcErrorMessage(error), 'err')
    return false
  }
  settleOwnedFields(owned, applied, 'accepted')
  toast(disabled ? 'Account disabled.' : 'Account re-enabled.')
  void refreshAdminAudit()
  return true
}

/** Toggle the creator badge on any profile. */
export async function adminSetCreator(userId: ID, isCreator: boolean): Promise<boolean> {
  if (!requireAdmin()) return false
  // `is_creator` IS a public field, but the optimistic edit is still applied only
  // to a private row — the console's list is private rows, and a public card is
  // refreshed by its own live event rather than edited here.
  const held = cache.users.find(u => u.id === userId)
  if (!held || !privateUser(held)) return false
  const owned: OwnedFields = { id: userId, patch: { isCreator } }
  const applied = installCatalogEdit(owned, u => ({ ...u, profile: { ...u.profile, isCreator } }))
  if (!applied) return false
  // The ledger's base is the badge the row held before this edit, and the intent
  // is the badge this edit wrote, so a refusal drops back to the base.
  const { error } = await supabase.rpc('admin_set_creator', { p_user_id: userId, p_is_creator: isCreator })
  if (error) {
    console.error('[yatraflow] admin_set_creator failed', error)
    settleOwnedFields(owned, applied, 'failed')
    toast(rpcErrorMessage(error), 'err')
    return false
  }
  settleOwnedFields(owned, applied, 'accepted')
  toast(isCreator ? 'Creator badge granted.' : 'Creator badge removed.')
  void refreshAdminAudit()
  return true
}

/** Flip any trip's visibility. */
export async function adminSetTripVisibility(tripId: ID, visibility: 'private' | 'public'): Promise<boolean> {
  if (!requireAdmin()) return false
  const prev = cache.trips
  patch({
    trips: prev.map(t => t.id === tripId ? { ...t, visibility, updatedAt: Date.now() } : t),
  })
  commit()
  const { error } = await supabase.rpc('admin_set_trip_visibility', { p_trip_id: tripId, p_visibility: visibility })
  if (error) {
    console.error('[yatraflow] admin_set_trip_visibility failed', error)
    patch({ trips: prev })
    commit()
    toast(rpcErrorMessage(error), 'err')
    return false
  }
  toast(`Trip is now ${visibility}.`)
  void refreshAdminAudit()
  return true
}

/** Remove any member from any trip (revokes invites, kicks collaborators). */
export async function adminRemoveMember(tripId: ID, userId: ID): Promise<boolean> {
  if (!requireAdmin()) return false
  const trip = cache.trips.find(t => t.id === tripId)
  if (!trip) { toast('Trip not in cache.', 'err'); return false }
  const prevMembers = trip.members ?? []
  patch({
    trips: cache.trips.map(t => t.id === tripId
      ? { ...t, members: prevMembers.filter(m => m.userId !== userId), updatedAt: Date.now() }
      : t),
  })
  commit()
  const { error } = await supabase.rpc('admin_remove_member', { p_trip_id: tripId, p_user_id: userId })
  if (error) {
    console.error('[yatraflow] admin_remove_member failed', error)
    patch({ trips: cache.trips.map(t => t.id === tripId ? { ...t, members: prevMembers } : t) })
    commit()
    toast(rpcErrorMessage(error), 'err')
    return false
  }
  toast('Member removed.')
  void refreshAdminAudit()
  return true
}

/** Unpublish any itinerary (admin variant — the owner path is creator-scoped).
 *  Same SOFT policy as the owner path (#350): the row stays, stamped with
 *  `unpublishedAt`, so buyers keep their entitlements and the creator's sales
 *  ledger and funnel survive an admin action. The RPC behind it
 *  (`admin_unpublish`, redefined by 20260925_publication_soft_unpublish.sql)
 *  stops sales and hides the publication; it no longer deletes the row and no
 *  longer flips the trip to private — a private trip would make
 *  `get_public_trip` refuse the very buyers the soft policy protects. */
export async function adminUnpublish(tripId: ID): Promise<boolean> {
  if (!requireAdmin()) return false
  const prevPubs = cache.published
  const stamp = Date.now()
  patch({
    published: prevPubs.map(p => (p.tripId === tripId ? { ...p, unpublishedAt: stamp } : p)),
  })
  commit()
  const { error } = await supabase.rpc('admin_unpublish', { p_trip_id: tripId })
  if (error) {
    console.error('[yatraflow] admin_unpublish failed', error)
    patch({ published: prevPubs })
    commit()
    toast(rpcErrorMessage(error), 'err')
    return false
  }
  toast('Publication unpublished.')
  void refreshAdminAudit()
  return true
}

/** Delete any trip. No undo — the console confirms by typing the trip name. */
export async function adminDeleteTrip(tripId: ID): Promise<boolean> {
  if (!requireAdmin()) return false
  const prevTrips = cache.trips
  const prevPubs = cache.published
  const prevSug = cache.suggestions
  const prevDec = cache.decisions
  const prevAct = cache.activity
  patch({
    trips: prevTrips.filter(t => t.id !== tripId),
    published: prevPubs.filter(p => p.tripId !== tripId),
    suggestions: prevSug.filter(s => s.tripId !== tripId),
    decisions: prevDec.filter(d => d.tripId !== tripId),
    activity: prevAct.filter(a => a.tripId !== tripId),
  })
  commit()
  const { error } = await supabase.rpc('admin_delete_trip', { p_trip_id: tripId })
  if (error) {
    console.error('[yatraflow] admin_delete_trip failed', error)
    patch({ trips: prevTrips, published: prevPubs, suggestions: prevSug, decisions: prevDec, activity: prevAct })
    commit()
    toast(rpcErrorMessage(error), 'err')
    return false
  }
  toast('Trip deleted.')
  void refreshAdminAudit()
  return true
}

/** Delete a user outright (audited `admin_delete_user` RPC, Sep 2026).
 *
 *  What the database takes with it (FK cascades off auth.users → profiles):
 *  every trip the user OWNS — plan, expenses, and the whole collab layer —
 *  their memberships in other people's trips (those trips survive for the
 *  remaining crew), their suggestions/decisions/activity rows, their
 *  notifications, and — only when `force` is true, the RPC refuses otherwise —
 *  their published Explore listings. The RPC is guarded (admin-only, refuses
 *  self-deletion and last-admin deletion) and audit-logged BEFORE the delete.
 *
 *  The optimistic patch mirrors exactly that blast radius: the user row, the
 *  owned trips with their children, the collab rows they authored ANYWHERE,
 *  their notifications, and the publications (force only). A trip the target
 *  was only a member of loses just the membership row — the trip itself stays
 *  for the remaining crew (#367). Restored wholesale on RPC error, same as
 *  adminDeleteTrip. */
export async function adminDeleteUser(userId: ID, force = false): Promise<boolean> {
  if (!requireAdmin()) return false
  const prevUsers = cache.users
  const prevTrips = cache.trips
  const prevPubs = cache.published
  const prevSug = cache.suggestions
  const prevDec = cache.decisions
  const prevAct = cache.activity
  const prevNotif = cache.notifications
  const ownedTripIds = new Set(prevTrips
    .filter(t => (t.members ?? []).some(m => m.userId === userId && m.role === 'owner'))
    .map(t => t.id))
  const isOwnedTrip = (tripId: ID) => ownedTripIds.has(tripId)
  // The user row leaves through the SAME install gate as every other catalogue
  // write, under the ownership this operation captured. A refusal restores ONLY
  // that row into the current catalogue, so an unrelated rename that landed while
  // the request was in flight survives.
  const deleted = prevUsers.find(u => u.id === userId)
  const removed = removeCatalogEntry(userId)
  if (!removed) return false
  patch({
    // #367: the DB cascade deletes OWNED trips and takes their children; a
    // trip the target was only a MEMBER of survives for the remaining crew —
    // so the optimistic patch evicts only the membership row there, not the
    // whole trip. Evicting it alarmed the admin mid-session with a trip the
    // crew still owns (it healed on the next hydrate; the patch was the lie).
    trips: prevTrips.map(t => {
      if (isOwnedTrip(t.id)) return null
      if (!(t.members ?? []).some(m => m.userId === userId)) return t
      return { ...t, members: (t.members ?? []).filter(m => m.userId !== userId) }
    }).filter((t): t is Trip => t !== null),
    published: prevPubs.filter(p => p.creatorId !== userId && !isOwnedTrip(p.tripId)),
    suggestions: prevSug.filter(s => s.proposedBy !== userId && !isOwnedTrip(s.tripId)),
    decisions: prevDec.filter(d => d.raisedBy !== userId && !isOwnedTrip(d.tripId)),
    activity: prevAct.filter(a => a.actorId !== userId && !isOwnedTrip(a.tripId)),
    notifications: prevNotif.filter(n => n.userId !== userId && !(n.tripId && isOwnedTrip(n.tripId))),
  })
  commit()
  const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId, p_force: force })
  if (error) {
    console.error('[yatraflow] admin_delete_user failed', error)
    if (deleted) restoreCatalogEntry(removed, deleted)
    patch({
      trips: prevTrips, published: prevPubs,
      suggestions: prevSug, decisions: prevDec, activity: prevAct, notifications: prevNotif,
    })
    commit()
    toast(rpcErrorMessage(error), 'err')
    return false
  }
  finishOperation(removed)
  toast('User deleted — their data is gone (see the audit log).')
  void refreshAdminAudit()
  return true
}

// ---------------- Trip deletion + undo ----------------



/** What `delete from public.trips` takes with it. Six tables cascade off a trip
 *  (supabase/schema.sql), and the itinerary is NOT one of them — `days` and
 *  `expenses` are JSONB columns on the trips row, so undo always brought the
 *  plan back intact. What vanished for good was the collaboration layer: every
 *  vote, every decision, the activity feed, everyone's notifications, and the
 *  public Explore link along with its view/copy counts. Captured before the
 *  delete so undo can put it back. Issue #43. */
interface TripSnapshot {
  trip: Trip
  index: number
  ownerId: ID | null
  suggestions: StopSuggestion[]
  decisions: TripDecision[]
  activity: ActivityEntry[]
  notifications: Notification[]
  published: PublishedItinerary[]
  /** The account that asked for the delete, captured ONCE. A retry re-reads this
   *  instead of asking who is signed in now, so a later account can never
   *  inherit someone else's recovery (#839). */
  scope: IdentityScope
  /** The trip's access generation at delete time. Every later invalidation — a
   *  second delete, a lost grant, a sign-out — moves it, and a recovery still
   *  holding the old value refuses rather than writing children for a trip the
   *  user has since deleted again. */
  accessEpoch: number
}

/** The last undoable deletion. The undo toast is the only consumer, so one slot
 *  is exactly as much history as the UI is able to offer. */
let lastDeletedTrip: TripSnapshot | null = null

/** A trip's owner. There is no `ownerId` on the Trip type — ownership lives only
 *  in the members array — so this is the one place to ask. Reading `members[0]`
 *  instead hands the trip to whoever happens to be first in that array. */
export function tripOwner(trip: Trip): ID | null {
  return trip.members?.find(m => m.role === 'owner')?.userId
    ?? trip.members?.[0]?.userId
    ?? null
}

function snapshotTrip(trip: Trip, index: number, scope: IdentityScope, accessEpoch: number): TripSnapshot {
  return {
    trip,
    index,
    ownerId: tripOwner(trip),
    suggestions: cache.suggestions.filter(s => s.tripId === trip.id),
    decisions: cache.decisions.filter(d => d.tripId === trip.id),
    activity: cache.activity.filter(a => a.tripId === trip.id),
    notifications: cache.notifications.filter(n => n.tripId === trip.id),
    published: cache.published.filter(p => p.tripId === trip.id),
    scope,
    accessEpoch,
  }
}

export function deleteTrip(id: ID): void {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope)) return
  const idx = cache.trips.findIndex(t => t.id === id)
  if (idx < 0) return
  // #566 — a direct hard DELETE cascades `published_itineraries` (trip_id) and
  // with it `entitlements`, `purchase_orders` and `pub_events` (pub_id): buyers
  // lose what they paid for and the creator's sales ledger is erased. A marker
  // stamp cannot help here — the row it would stamp dies with the trip. The
  // purge RPC refuses the same trip for the same reason, so this legacy path
  // (nothing calls it since the trash landed; kept for the undo suite) refuses
  // too rather than being the one back door around the guard.
  if (cache.published.some(p => p.tripId === id)) {
    toast('A published trip cannot be deleted — its publication and its buyers’ records stay with it. Move it to trash instead.', 'err')
    return
  }
  const removed = cache.trips[idx]
  // Returns the NEW generation, and that is the value the snapshot records: the
  // delete above is itself an invalidation, so the recovery it enables is bound
  // to the generation this delete created. A second delete moves it again and
  // the first recovery refuses.
  const accessEpoch = invalidateTripWork(id, scope.userId)
  lastDeletedTrip = snapshotTrip(removed, idx, scope, accessEpoch)
  cache.trips = cache.trips.filter(t => t.id !== id)
  commit()
  markLocalWrite('trips', id)
  void supabase.from('trips').delete().eq('id', id).then(({ error }) => {
    if (!isCurrentIdentity(scope)) return
    if (error) {
      cache.trips = [...cache.trips.slice(0, idx), removed, ...cache.trips.slice(idx)]
      commit()
      lastDeletedTrip = null
    }
  })
}

/** Is this snapshot still the one the user may recover? Three independent
 *  refusals, because each alone is enough to make a write wrong: the account
 *  changed, the trip's access generation moved, or a NEWER deletion took the
 *  payload slot. Every recovery path runs through this one gate. */
function recoveryIsCurrent(snap: TripSnapshot): boolean {
  return isCurrentIdentity(snap.scope)
    && (tripAccessEpochs.get(snap.trip.id) ?? 0) === snap.accessEpoch
    && lastDeletedTrip === snap
}

/** Re-insert a trip at its old position — powers Undo on trip deletion, and the
 *  retry action its failure toast offers. */
export function restoreTrip(trip: Trip, index: number): void {
  const snap = lastDeletedTrip?.trip.id === trip.id ? lastDeletedTrip : null
  if (!snap) return
  // The stale check lives here, not inside the writes, because the toast's retry
  // action lands on this function — one gate covers the first try and every
  // repeat. A click that arrives after an account switch, a second delete, or a
  // newer snapshot does nothing at all.
  if (!recoveryIsCurrent(snap)) return
  // A failed recovery leaves the trip in the cache (its own row insert is what
  // succeeded), so the trip is already back while the children are not. That is
  // the retry case: re-run the writes instead of returning here, which is what
  // used to make "Run Undo again" a no-op with the payload stranded.
  const retry = cache.trips.some(t => t.id === trip.id)
  // A repeat is the user saying "try again now", so the session's negative
  // capability answers are dropped before the writes run: a server repaired
  // since the first try must be able to recover without a page reload.
  if (retry) refreshNegativeCapabilityProbes()
  if (!retry) {
    const at = Math.min(index, cache.trips.length)
    cache.trips = [...cache.trips.slice(0, at), trip, ...cache.trips.slice(at)]
    commit()
  }
  void restoreTripData(snap, retry)
}

/** The archive function's own answer set (supabase/migrations/
 *  20261024_suggestion_place_identity.sql). Narrowed from the SDK's untyped
 *  `data` by membership, the same way `isPlaceProvider` narrows a provider: the
 *  value is verified before the type is asserted, so a server that answers with
 *  something else reads as null and lands in the recoverable branch. */
const ARCHIVE_STATUSES = ['applied', 'alreadyApplied', 'forbidden', 'unavailable', 'invalid'] as const
type ArchiveStatus = typeof ARCHIVE_STATUSES[number]
function archiveRestoreStatus(data: unknown): ArchiveStatus | null {
  if (!data || typeof data !== 'object') return null
  const status = (data as { status?: unknown }).status
  return typeof status === 'string' && (ARCHIVE_STATUSES as readonly string[]).includes(status)
    ? (status as ArchiveStatus)
    : null
}

/** The failure toast's action. It re-enters the same guarded function the first
 *  try used, so the account switch, the access generation and the newer-snapshot
 *  refusals all apply to the button as well. */
function retryRecovery(snap: TripSnapshot): void {
  if (recoveryIsCurrent(snap)) {
    restoreTrip(snap.trip, snap.index)
    return
  }
  // The account is still signed in but a newer deletion took the payload, so
  // this recovery is genuinely spent. Say so once; an account switch stays
  // silent, because the outcome belongs to whoever asked, not to whoever is
  // looking at the screen now.
  if (isCurrentIdentity(snap.scope)) toast('That recovery is no longer available.')
}

async function restoreTripData(snap: TripSnapshot, retry: boolean): Promise<void> {
  const { trip, scope, accessEpoch } = snap
  /** The one gate every phase runs through, checked before and after every
   *  await: the account, the trip's access generation and the payload must all
   *  still be the ones this try started with. */
  const live = (): boolean => isCurrentIdentity(scope)
    && (tripAccessEpochs.get(trip.id) ?? 0) === accessEpoch
    && lastDeletedTrip === snap
  if (!live()) return
  markLocalWrite('trips', trip.id)
  // persistTrip writes this value straight into trips.owner_id. Passing
  // members[0].userId here used to transfer ownership to an arbitrary
  // collaborator every time a shared trip was deleted and undone.
  const ownerId = snap.ownerId ?? tripOwner(trip)
  // Pin the bearer to the captured account. Token acquisition itself awaits, and
  // an account switch during that await used to let the next account's token
  // ride along on this recovery.
  const token = await tripWriteToken(scope, live)
  if (!token || !live()) return
  // Primary persistence: the trip row and its members. The recovery's own guard
  // and bearer travel into every awaited phase inside it, because a second
  // deletion or a lost grant during those awaits used to let a retired try keep
  // writing. A failure here — an error OR a throw — keeps the snapshot and is
  // reported through the same guarded feedback as a child failure, so the user
  // always has the button rather than a stranded optimistic trip.
  let primaryFailed = false
  if (ownerId) {
    try {
      primaryFailed = !(await persistTrip(trip, ownerId, { retry, recovery: { live, token } }))
    } catch (e) {
      console.error('[yatraflow] undo could not restore the trip row', e)
      primaryFailed = true
    }
    // A retired recovery is not a failure to report: its writes either landed or
    // not, and neither outcome belongs to whoever is signed in now. Stay silent
    // and keep the payload for that account's own retry.
    if (primaryFailed && !live()) return
  }
  if (primaryFailed) {
    toast('The trip could not be put back.', 'err', { label: 'Try again', run: () => retryRecovery(snap) })
    return
  }
  if (!live()) return

  // Stage A removed the direct insert policies on the contribution tables, so a
  // client-side re-insert is refused by the database and proves nothing. The
  // guarded archive function is the one seam that can put those rows back: it
  // runs as the definer, checks the caller against the owner the delete
  // archived, and is idempotent by row id.
  //
  // It is consulted on EVERY recovery, never skipped for an empty local cache.
  // The local arrays can be empty while the server holds rows this device never
  // saw — a contribution made after the snapshot was taken, or one that arrived
  // while the device was away — and local emptiness is not proof of an empty
  // archive. An archive with nothing in it answers `applied` with zero rows,
  // which is success, so there is nothing to skip. `alreadyApplied` is success
  // too: the rows are back and re-running would add nothing.
  let sharedFailed: string | null = null
  {
    const { data, error } = await supabase.rpc('restore_trip_contributions', { p_trip_id: trip.id })
      .setHeader('Authorization', `Bearer ${token}`)
    if (!live()) return
    const status = archiveRestoreStatus(data)
    if (error) sharedFailed = 'the trip’s shared data could not be restored'
    else if (status === 'applied' || status === 'alreadyApplied') sharedFailed = null
    // `forbidden` covers no archive, an expired one, and a caller who is not the
    // archived owner — none of which a retry can change, and all of which are
    // the honest answer.
    else if (status === 'forbidden') sharedFailed = 'the trip’s shared data is no longer available to restore'
    else sharedFailed = 'the trip’s shared data could not be restored'
  }

  // The publication is not part of the archive and its own write policy survived
  // Stage A, so it is restored directly — gated on creator_id, which is why a
  // collaborator undoing their own delete genuinely cannot re-publish the
  // owner's itinerary, and why that loss is the one worth naming.
  let linkFailed: string | null = null
  if (snap.published.length) {
    // An undo that drops refreshed_at strips the revived publication's sitemap
    // <lastmod> and sinks it in Explore's freshness sort.
    const withRefreshedAt = await publishedHaveRefreshedAt()
    if (!live()) return
    const { error } = await supabase.from('published_itineraries')
      .upsert(snap.published.map(p => publishedToRow(p, withRefreshedAt)), { onConflict: 'id' })
      .setHeader('Authorization', `Bearer ${token}`)
    if (!live()) return
    if (error) linkFailed = 'the public link could not be restored'
  }

  if (!sharedFailed && !linkFailed) {
    // Every row landed, so THIS recovery is spent — release the payload only
    // while it is still the one this try was handed. A deletion made after this
    // recovery started has its own snapshot, and clearing that one would drop a
    // recoverable payload the user has not finished with.
    if (lastDeletedTrip === snap) lastDeletedTrip = null
    return
  }
  // The account that asked for the recovery signed out or switched mid-flight:
  // the writes above either landed or not, and neither outcome belongs to
  // whoever is signed in now. The payload is NOT spent, so it stays for that
  // account's own retry, and nothing is toasted — a message here would attribute
  // this account's failure to the next one.
  if (!live()) return
  console.error('[yatraflow] undo could not restore:', [sharedFailed, linkFailed].filter(Boolean).join(', '))
  // Plain product copy: what happened, and one button that does the thing. No
  // issue numbers and no migration instructions — the user cannot act on either.
  const message = sharedFailed && linkFailed
    ? 'The trip is back, but its shared data and its public link could not be restored.'
    : sharedFailed
      ? 'The trip is back, but its shared data could not be restored.'
      : 'The trip is back, but its public link could not be restored. Republish it from the trip.'
  toast(message, 'err', { label: 'Try again', run: () => retryRecovery(snap) })
}

// ---------------- Trash + 30-day purge (soft-delete) ----------------
// "Delete" is a soft-delete: the trip leaves the live cache immediately and its
// `deleted_at` tombstone is stamped, so the `trips read hide trashed` RLS policy
// hides it from every future read while the row survives 30 days for restore.
// Hard delete (with its collab cascade) remains as "delete forever" from the
// Trash view. Every path is probe-gated on the `deleted` column so an
// un-migrated/test database keeps the old hard-delete behaviour.

/** Move a trip to trash. Optimistic: removes from the live list, then stamps the
 *  tombstone; a failed write puts the trip back. */
export function trashTrip(trip: Trip): void {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope)) return
  if (!cache.trips.some(t => t.id === trip.id)) return
  // #566 — trash is a WITHDRAW, never a revoke. A trip whose publication is
  // still on sale must stop selling WITH it: Explore, the sitemap, the share
  // card and checkout all read `unpublished_at is null`, so a tombstone alone
  // leaves the removed trip's plan selling from a page its owner just took
  // down. The stamp is OWNER-written — `published write` RLS is
  // `auth.uid() = creator_id` while `trips update` is `is_editor`, so an editor
  // cannot write it (deliberately no trigger: withdrawing the sale is the
  // creator's action, not a side effect of a tombstone). An editor asked to
  // trash a still-selling trip is REFUSED outright rather than half-served.
  const pubs = cache.published.filter(p => p.tripId === trip.id)
  const onSale = pubs.filter(p => !p.unpublishedAt)
  if (onSale.length) {
    const me = cache.sessionUserId
    if (!me || onSale.some(p => p.creatorId !== me)) {
      toast('Only the trip owner can trash a published trip — its public page has to stop selling with it.', 'err')
      return
    }
  }
  revokeTripWork(trip.id)
  const accessEpoch = tripAccessEpochs.get(trip.id)
  const live = () => isCurrentIdentity(scope) && tripAccessEpochs.get(trip.id) === accessEpoch
  // A refusal before any server write puts the trip back. Its saved edit was never removed.
  const refuseTrash = () => {
    if (!live() || tripById(trip.id)) return
    cache.trips = [...cache.trips, trip]
    commit()
    toast('Could not move to trash.', 'err')
  }
  cache.trips = cache.trips.filter(t => t.id !== trip.id)
  commit()
  void serializeTripWrite(`${scope.epoch}:${scope.userId}:${trip.id}`, async () => {
    const token = await tripWriteToken(scope)
    if (!token || !live()) return refuseTrash()
    const cols = await tripsHaveOptionalColumns()
    if (!live()) return
    if (!cols.deleted) {
      // Legacy hard delete (a database without the trash column):
      // `published_itineraries` cascades off the trip and the money rows
      // cascade off the publication — a published trip here would be a
      // confiscation, so it is refused like the purge RPC refuses it.
      if (pubs.length) {
        cache.trips = [...cache.trips, trip]
        commit()
        toast('This database has no trash column — a published trip cannot be deleted here without destroying its buyers’ records.', 'err')
        return
      }
      await supabase.from('trips').delete().eq('id', trip.id)
        .setHeader('Authorization', `Bearer ${token}`).then(async ({ error }) => {
        if (!live()) return
        if (error) { cache.trips = [...cache.trips, trip]; commit() }
        else await discardTripEdits(scope, trip.id)
        // #387: the bin never refreshed in place — re-issue the RPC after every
        // resolution so a resident Trash view moves on its own. Failure surfaces
        // through the bin's own error branch, not stale data.
        void fetchTrashedTrips()
      })
      return
    }
    // #566 — withdraw FIRST, tombstone second: if the plan cannot stop
    // selling, the trip stays where it is rather than half-moving. The marker
    // is stamped optimistically and rolled back together with the trip if the
    // tombstone write fails. Probe-gated: without the column (a pre-#350
    // database) there is no marker vocabulary to speak, and the readers that
    // would need it cannot run there either.
    const prevPubs = cache.published
    let stamp: number | null = null
    const canWithdraw = onSale.length && (await publishedHaveUnpublishedAt())
    if (!live()) return
    if (canWithdraw) {
      const s = Date.now()
      stamp = s
      cache.published = cache.published.map(p => (onSale.some(o => o.id === p.id) ? { ...p, unpublishedAt: s } : p))
      commit()
      const { error: stampError } = await supabase.from('published_itineraries')
        .update({ unpublished_at: s }).in('id', onSale.map(p => p.id))
        .setHeader('Authorization', `Bearer ${token}`)
      if (!live()) return
      if (stampError) {
        cache.published = prevPubs
        cache.trips = [...cache.trips, trip]
        commit()
        toast('Could not stop the plan from selling — the trip was not moved to trash.', 'err')
        return
      }
      for (const p of onSale) markLocalWrite('published_itineraries', p.id)
    }
    markLocalWrite('trips', trip.id)
    await supabase.from('trips').update({ deleted_at: new Date().toISOString() }).eq('id', trip.id)
      .setHeader('Authorization', `Bearer ${token}`).then(async ({ error }) => {
      if (!live()) return
      if (error) {
        cache.trips = [...cache.trips, trip]
        if (stamp !== null) cache.published = prevPubs
        commit()
        toast('Could not move to trash.')
      } else {
        // The server confirmed the tombstone, so the saved edit can go.
        await discardTripEdits(scope, trip.id)
      }
      void fetchTrashedTrips()
    })
  }).catch(() => {
    if (!live()) return
    if (!tripById(trip.id)) cache.trips = [...cache.trips, trip]
    commit()
    toast('Could not move to trash.', 'err')
  })
}

/** Undo a trash *within the session* (the delete toast): put the trip back and
 *  clear the tombstone. The Trash view's restore after a reload goes through
 *  restoreTrashedTripById. */
export function restoreTrashedTrip(trip: Trip): void {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope)) return
  const accessEpoch = (tripAccessEpochs.get(trip.id) ?? 0) + 1
  tripAccessEpochs.set(trip.id, accessEpoch)
  const live = () => isCurrentIdentity(scope) && (tripAccessEpochs.get(trip.id) ?? 0) === accessEpoch
  if (!cache.trips.some(t => t.id === trip.id)) {
    cache.trips = [...cache.trips, { ...trip, deletedAt: undefined }]
    commit()
  }
  void serializeTripWrite(`${scope.epoch}:${scope.userId}:${trip.id}`, async () => {
    const token = await tripWriteToken(scope)
    if (!token || !live()) return
    const cols = await tripsHaveOptionalColumns()
    if (!cols.deleted || !live()) return
    markLocalWrite('trips', trip.id)
    const { data, error } = await supabase.from('trips').update({ deleted_at: null }).eq('id', trip.id)
      .select('*').setHeader('Authorization', `Bearer ${token}`)
    if (!live()) return
    {
      if (error) toast('Could not restore that trip.')
      else if (Array.isArray(data) && data.length === 1) {
        const shared = rowToTrip(data[0] as TripRow, tripById(trip.id)?.members ?? trip.members ?? [])
        const pending = await pendingWrites()
        if (!live()) return
        const displayed = overlayQueuedTrips([shared], pending, scope.userId)[0]
        cache.trips = cache.trips.map(t => t.id === trip.id ? displayed : t)
        commit()
      }
      // #387: session-undo resolves while a Trash view may be resident — same
      // refetch contract as the RPC restore, success and failure both.
      void fetchTrashedTrips()
    }
  }).catch(() => { if (live()) toast('Could not restore that trip.', 'err') })
}

/** Fetch the current user's trashed trips (owner-scoped SECURITY DEFINER RPC).
 *
 *  #387: the failure used to stop at a `console.error`, so the view rendered
 *  its genuine-empty copy over a broken read. The verdict is now published
 *  (`trashLoaded` / `trashFailed`, replace-on-success only) so the page can
 *  offer its error branch with a Retry that re-issues this same RPC. A throw
 *  reports the same way an error response does — the page's previous verdict
 *  must not stand through either. The unconfigured/unsigned early return is a
 *  gate, not dead code: a focus-refetch that ignored it would spam an anon RPC
 *  on every tab focus. */
export async function fetchTrashedTrips(): Promise<void> {
  if (!isSupabaseConfigured || !cache.sessionUserId) return
  const userId = cache.sessionUserId
  const epoch = identityEpoch
  try {
    const { data, error } = await supabase.rpc('get_trashed_trips')
    if (epoch !== identityEpoch || cache.sessionUserId !== userId) return
    if (error) {
      console.error('[yatraflow] trashed trips fetch failed', error)
      patch({ trashFailed: true })
      commit()
      return
    }
    cache.trashedTrips = mapOrSkip((data ?? []) as unknown[], r => rowToTrip(r as TripRow, []))
    // Trashed rows are server-applied too — a restored trip's guard must not
    // compare a fresh remote UPDATE against a nonexistent ledger entry.
    for (const t of cache.trashedTrips) recordServerTripTimestamp(t.id, t.updatedAt)
    patch({ trashLoaded: true, trashFailed: false })
    commit()
  } catch (e) {
    if (epoch !== identityEpoch || cache.sessionUserId !== userId) return
    console.error('[yatraflow] trashed trips fetch failed', e)
    patch({ trashFailed: true })
    commit()
  }
}

/** Restore a trashed trip from the Trash view (after reload): SECURITY DEFINER
 *  RPC, then pull the now-live row back into the cache so it appears at once. */
export async function restoreTrashedTripById(id: ID): Promise<boolean> {
  const { error } = await supabase.rpc('restore_trashed_trip', { p_trip_id: id })
  if (error) {
    toast('Could not restore that trip.')
    // #387: a failed restore must leave the error branch, not stale bin data.
    void fetchTrashedTrips()
    return false
  }
  cache.trashedTrips = cache.trashedTrips.filter(t => t.id !== id)
  commit()
  await fetchTripIntoCache(id)
  // #387: success refetches too — concurrent-device trashes appear, and the bin
  // confirms the restore instead of trusting the optimistic filter above.
  void fetchTrashedTrips()
  return true
}

/** Delete a trashed trip forever. Hard delete; the cascade sweeps the collab layer.
 *
 *  #566 — the purge REFUSES a trip whose publication row exists: entitlements,
 *  purchase_orders and pub_events all cascade off that row, so the delete would
 *  confiscate what buyers paid for and erase the creator's own sales ledger.
 *  The refusal is a SENTENCE from the RPC, not a code — it is surfaced verbatim
 *  so the owner learns why the trip stays in the trash instead of a shrug. */
export async function permanentlyDeleteTrip(id: ID): Promise<boolean> {
  const { error } = await supabase.rpc('purge_trashed_trip', { p_trip_id: id })
  if (error) {
    const msg = typeof error.message === 'string' && error.message.trim() ? error.message.trim() : ''
    toast(msg || 'Could not delete that trip.')
    void fetchTrashedTrips()
    return false
  }
  cache.trashedTrips = cache.trashedTrips.filter(t => t.id !== id)
  commit()
  void fetchTrashedTrips()
  return true
}

/** Put a removed member back — powers Undo on member removal. */
export function restoreMember(tripId: ID, member: TripMember): void {
  const t = tripById(tripId)
  if (!t || t.members?.some(m => m.userId === member.userId)) return
  mutateTrip(tripId, draft => { draft.members = [...(draft.members ?? []), member] }, { touch: false })
  fire('trip_members', supabase.from('trip_members').insert({ trip_id: tripId, user_id: member.userId, role: member.role, joined_at: member.joinedAt }))
}

/** Re-insert a deleted expense line — powers Undo on expense deletion. */
export function restoreExpense(tripId: ID, expense: Expense, index: number): void {
  const t = tripById(tripId)
  if (!t || t.expenses.some(x => x.id === expense.id)) return
  // #382: Undo replays a captured line, and a line the writers would refuse
  // today must not come back through the back door. One rule, everywhere.
  const v = amountVerdict(expense.amountInr)
  if (!v.ok) { toast(amountRefusal(expense.amountInr)!, 'err'); return }
  mutateTrip(tripId, draft => { draft.expenses.splice(Math.min(index, draft.expenses.length), 0, expense) }, { touch: false })
  void persistTripField(tripId, tripById(tripId)!)
}

export function updateTrip(id: ID, patchFields: Partial<Trip>): boolean {
  const t = tripById(id)
  if (!t) return false
  // The Mixed driving answer must never be dropped in silence, and a refused
  // save must not have touched the cache yet: the refusal says "nothing else
  // changed", so that has to be true here, not merely true in the row (2026-10-19).
  // An UNKNOWN probe refuses too. Waiting for it would mean mutating first and
  // un-mutating after an await, which is the lie in its other form; instead the
  // probe is started so the retry is immediate, and nothing is written.
  if (typeof patchFields.drivesPart === 'boolean') {
    const cols = lastResolvedOptionalColumns
    if (!cols) { void tripsHaveOptionalColumns() }
    if (!cols || !cols.drivesPart) { toast(DRIVES_PART_MISSING_REASON, 'err'); return false }
  }
  // Date changes resize the day grid — reconcile BEFORE assigning so the
  // persisted row and the cache carry the same days. Shrinks that would drop
  // a day holding stops are rejected with the reason surfaced as a toast.
  // NOTE: callers pass either a partial patch (settings form) OR a full Trip
  // (TripWorkspace keepPending/moveToAnotherDay via pending.proposed). Only
  // reconcile when the dates ACTUALLY changed, and reconcile the incoming
  // days (patchFields.days ?? t.days) — reconciling t.days unconditionally
  // used to silently discard every reorder/delete/move, because a full Trip
  // always carries truthy startDate/endDate and rec.days (built from the OLD
  // days) overwrote the proposed days. That was the "Change saved but nothing
  // sticks" bug: cache + DB both received the pre-edit days.
  const newStart = patchFields.startDate ?? t.startDate
  const newEnd = patchFields.endDate ?? t.endDate
  const datesChanged = newStart !== t.startDate || newEnd !== t.endDate
  if (datesChanged) {
    const protectedIdx = new Set([...t.fixedCommitments, ...(t.flights ?? [])].map(c => c.dayIndex))
    const baseDays = patchFields.days ?? t.days
    const rec = reconcileDays(baseDays, newStart, newEnd, protectedIdx)
    if (rec.error) { toast(rec.error, 'err'); return false }
    patchFields = { ...patchFields, days: rec.days }
  }
  // Mutate the cache FIRST, then persist the draft that already contains the
  // patch. The previous order persisted the pre-patch snapshot and only
  // applied the edit in memory — settings edits (cover, title, budget…)
  // silently vanished on reload unless a later unrelated write happened to
  // persist the trip.
  const draft = mutateTrip(id, d => Object.assign(d, patchFields, { updatedAt: Date.now() }), { touch: false })
  if (draft) void persistTripField(id, draft)
  return true
}

// ---- Debounced trip writes (P4) ----
// Bursty mutations — a drag-reorder firing reorderStop per move, settings
// keystrokes, undo/redo chains — each used to issue its own row UPDATE. A
// trailing-edge coalescer per trip id turns a burst into ONE write whose
// snapshot is captured AT CALL TIME and never re-read. Snapshot-at-call matters:
// if the timer re-read the cache at fire time, a REMOTE update landing inside
// the debounce window would make the flush persist the REMOTE row and silently
// discard the local edit that scheduled it (the exact failure B0 exists to
// prevent).
let TRIP_WRITE_DEBOUNCE_MS = 600
// #578 — each entry also carries the session the edit was CAPTURED under: the
// fire-time identity check in persistTripFieldNow compares against this, never
// against whatever account happens to be signed in when the timer runs.
type CapturedTripWrite = { trip: Trip; sessionId: string; epoch: number; accessEpoch: number; entry: QueuedWrite; durable: Promise<boolean> }
const pendingTripWrites = new Map<ID, CapturedTripWrite & { timer: ReturnType<typeof setTimeout> }>()
const tripAccessEpochs = new Map<string, number>()
/** Why the trip was invalidated, and under which identity and generation, so
 *  an in-flight removal can restore the copy and a later account cannot
 *  inherit it. */
const tripInvalidationReasons = new Map<string, {
  reason: QueuedWrite['reason']
  userId: string
  generation: number
}>()

/**
 * #804 B1 — the most recent NON-editable role observed for one membership is
 * recorded as `role-floor:<trip>:<user>` in this same map. An access epoch stops
 * work already in flight; it cannot stop a NEW replacement read that starts
 * after a downgrade, because that read carries the new epoch and would restore a
 * stale editor row. The floor blocks such a grant until a realtime GRANT clears it.
 */
function roleFloorKey(tripId: string, userId: string): string {
  return `role-floor:${tripId}:${userId}`
}

/**
 * #804 (round 10 B1) — apply one observed membership role for THIS user to the
 * access map. It runs on BOTH realtime branches (a cached trip and an uncached
 * one), because a cached trip is exactly where a stale editor row can be
 * restored by the next full read.
 *
 *  - a downgrade to a non-editable role, or a removal, records the floor, so no
 *    full read can grant edit rights until an authoritative GRANT clears it;
 *  - an authoritative grant clears the floor, so a stale floor cannot outlive
 *    the right it denies;
 *  - an UPDATE that names no role is UNKNOWN, and unknown is treated as a
 *    downgrade (fail closed): it records the floor but does not clear one.
 *
 * A row for another user changes nothing here.
 */
function observeOwnMembershipRole(tripId: string, userId: string, event: string, role: unknown): void {
  if (userId !== cache.sessionUserId) return
  const key = roleFloorKey(tripId, userId)
  if (event === 'DELETE') {
    tripAccessEpochs.set(key, 1)
    return
  }
  if (role === undefined || role === null) {
    if (event === 'UPDATE') tripAccessEpochs.set(key, 1)
    return
  }
  if (canEdit(role as TripMember['role'])) tripAccessEpochs.delete(key)
  else tripAccessEpochs.set(key, 1)
}

/**
 * #804 (round 10 B2) — the guard that binds the own-echo path.
 *
 * An own INSERT echo may only be exempt from the permission invalidation while
 * ONE live join expects it. The expectation records all four things that must
 * still match when the echo arrives: the trip, the joining user, the identity
 * generation the join started under, and the try owner the App handed in. A
 * retired try, a different account, or a later access generation so
 * cannot keep the window open, and the echo is treated as an ordinary event.
 */
export interface JoinExpectation {
  tripId: string
  userId: string
  identityEpoch: number
  accessEpoch: number
  /** True only while the App's try is live and still owns this link target. */
  guard: AttemptGuard
}

/** The App's live-try check, passed into the store so a retired try cannot admit. */
export type AttemptGuard = () => boolean

const expectedJoins = new Map<string, JoinExpectation>()

/**
 * The live expected-join window for this trip, or undefined.
 *
 * `probe` is for a caller that CHECKS the window (an echo arriving): a window it
 * finds stale is closed at once, so nothing later in the frame reads it as open.
 * A caller that only compares records (the echo's own guard) passes nothing and
 * gets the record back unchanged.
 */
function expectedJoin(tripId: string, probe = false): JoinExpectation | undefined {
  const expectation = expectedJoins.get(tripId)
  if (!expectation) return undefined
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  if (probe && (expectation.identityEpoch !== identityEpoch || expectation.accessEpoch !== accessEpoch || !expectation.guard())) {
    expectedJoins.delete(tripId)
    return undefined
  }
  // The guard is the App's live-try check. It is read only when the caller can
  // honour it (the guard the store chose for the recording try is the caller's
  // own guard); an older recording cannot be judged by a newer closure.
  if (expectation.identityEpoch !== identityEpoch || expectation.accessEpoch !== accessEpoch || !expectation.guard()) {
    // A retirement or an account change closes the window at once, so nothing
    // that runs later in this frame can still read it as open.
    expectedJoins.delete(tripId)
    return undefined
  }
  return expectation
}

const editableTripGrants = new Set<string>()
let lastWriteCapture = 0

// #704 — the server's verdict on a trip write. updateTrip answers at once from
// the cache. A caller that must show the server's answer reads tripWriteVerdict
// right after updateTrip: that edit rides the write the verdict belongs to.
type TripVerdict = { promise: Promise<boolean>; settle: (saved: boolean) => void }
/** The verdict of each trip's pending debounced write. Edits in one window share it. */
const pendingTripVerdicts = new Map<ID, TripVerdict>()
/** The verdict of the newest write for each trip, until that write settles. */
const newestTripVerdicts = new Map<ID, TripVerdict>()

function openTripVerdict(): TripVerdict {
  let settle: (saved: boolean) => void = () => {}
  const promise = new Promise<boolean>(resolve => { settle = resolve })
  return { promise, settle }
}

/** Send one row write under its verdict. The verdict takes the write's result, then stops being the newest. */
function sendUnderVerdict(id: ID, v: TripVerdict, write: Promise<boolean>): void {
  const finish = (saved: boolean) => {
    v.settle(saved)
    if (newestTripVerdicts.get(id) === v) newestTripVerdicts.delete(id)
  }
  void write.then(finish, err => { console.error('[yatraflow] trip write rejected', err); finish(false) })
}

/** The server's verdict on the row write that carries the newest edit to this trip, or null. Read it right after updateTrip. It resolves true once the server has the row. */
export function tripWriteVerdict(id: ID): Promise<boolean> | null {
  return newestTripVerdicts.get(id)?.promise ?? null
}

// #549 — ONE in-flight whole-trip write per trip, across BOTH senders: the
// debounced path and replayQueuedWrites chain onto the same tail, so two
// UPDATEs for one trip are never in flight together. Nothing here ordered them
// before: a second edit during an in-flight write issued a second UPDATE, the
// network landed them in arrival order, and the OLDER snapshot could win —
// last-writer-wins with the wrong writer last. Entries are deleted once their
// tail settles and is still the map's tail, so the map never grows per trip.
const tripWriteTails = new Map<ID, Promise<void>>()

/** Chain `run` onto the trip's write tail. The returned promise settles with
 *  `run`'s own outcome; the stored tail never rejects (it only orders). */
function serializeTripWrite<T>(id: ID, run: () => Promise<T>): Promise<T> {
  const prev = tripWriteTails.get(id) ?? Promise.resolve()
  const next = prev.then(run, run)
  const tail = next.then(() => undefined, () => undefined)
  tripWriteTails.set(id, tail)
  void tail.then(() => {
    if (tripWriteTails.get(id) === tail) tripWriteTails.delete(id)
  })
  return next
}

/** Test hook — 0 disables the debounce: writes issue immediately, as before. */
export function _setTripWriteDebounceMs(ms: number): void {
  TRIP_WRITE_DEBOUNCE_MS = ms
}

/** Cancel every pending debounced trip write — timers cleared, entries
 *  dropped, nothing fired and nothing queued. Called on every session
 *  TRANSITION (logout, and hydrate onto a different account): the write a
 *  departing account captured is theirs alone, exactly like the durable queue
 *  entry the sign-out wipe discards. Test hook mirror of _flushTripWrites. */
export function _cancelTripWrites(): void {
  for (const id of [...pendingTripWrites.keys()]) {
    const pending = pendingTripWrites.get(id)
    if (pending) clearTimeout(pending.timer)
    pendingTripWrites.delete(id)
    // A cancelled write never reached the server, so its verdict is "not saved".
    const v = pendingTripVerdicts.get(id)
    pendingTripVerdicts.delete(id)
    if (v) {
      v.settle(false)
      if (newestTripVerdicts.get(id) === v) newestTripVerdicts.delete(id)
    }
  }
}

/** Fire every pending debounced trip write right now. Best-effort — errors
 *  surface through persistTripFieldNow's toast, never through the event. */
export function _flushTripWrites(): void {
  if (pendingTripWrites.size === 0) return
  for (const id of [...pendingTripWrites.keys()]) {
    const pending = pendingTripWrites.get(id)
    if (!pending) continue
    clearTimeout(pending.timer)
    pendingTripWrites.delete(id)
    // Persist the CAPTURED snapshot, not tripById(id) — see the coalescer note
    // above: a remote update that landed while the write was pending must not
    // be re-persisted over the local edit, and the local edit must not be
    // lost by persisting the remote row.
    const v = pendingTripVerdicts.get(id) ?? openTripVerdict()
    pendingTripVerdicts.delete(id)
    sendUnderVerdict(id, v, persistTripFieldNow(id, pending))
  }
}

/** Match the exact local edit, including edits captured in the same millisecond. */
function sameQueuedWrite(a: QueuedWrite, b: QueuedWrite): boolean {
  return a.ownerId === b.ownerId && a.tripId === b.tripId
    && (a.revision ?? a.capturedAt) === (b.revision ?? b.capturedAt)
}

function validWriteVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** A string that is present and not empty. */
function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

/** A finite number. */
function finiteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * #804 (round 10 B3) — is this a COHERENT full trip row?
 *
 * `admitFullRow` used to test five columns for presence alone. An explicit
 * `undefined`, a wrong type, or a row that dropped `days`, `expenses`,
 * `destinations` and the required scalars all passed, and `rowToTrip` then
 * filled the gaps with empty arrays and empty strings. The gate then opened a
 * trip whose whole-row save would write those defaults back over the owner's
 * data.
 *
 * This check runs BEFORE any default applies. It names every field the
 * serializer in `src/lib/tripRow.ts` writes back, and every field that keeps
 * its own value through the read. A missing writable field is refused, not
 * defaulted. A wrong type is refused. A nullable COLUMN may be null (the
 * database stores null there); a missing column is refused, because the
 * deployed row set is known and an absent one means a partial projection.
 *
 * `cols` says which optional columns this deploy's writes include, so a
 * nullable column is accepted only when the writer knows it.
 */
function coherentFullRow(row: unknown, cols?: OptionalColumnsProbe): row is TripRow {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  const r = row as Record<string, unknown>
  // The text fields.
  for (const field of ['id', 'owner_id', 'name', 'start_location', 'start_date', 'end_date', 'transport_mode', 'travel_style', 'cover_emoji', 'visibility']) {
    if (!nonEmptyString(r[field])) return false
  }
  if (r.visibility !== 'private' && r.visibility !== 'public') return false
  // The number fields.
  for (const field of ['travellers', 'budget_per_person_inr']) {
    if (!finiteNumber(r[field])) return false
  }
  if (!validWriteVersion(r.write_version)) return false
  if (!finiteNumber(r.updated_at) || !finiteNumber(r.created_at)) return false
  if (r.deleted_at != null && !(typeof r.deleted_at === 'string' || finiteNumber(r.deleted_at))) return false
  // Writable JSONB lists: check the shapes consumed by trip readers before
  // rowToTrip can coerce malformed contents into empty collections.
  if (!coherentDestinations(r.destinations) || !coherentDays(r.days)) return false
  for (const field of ['expenses', 'fixed_commitments']) {
    if (!(Array.isArray(r[field]) || r[field] === null)) return false
  }
  if (!(Array.isArray(r.destination_coords) || r.destination_coords === null)) return false
  if (Array.isArray(r.destination_coords) && !r.destination_coords.every(point => point === null || (
    !!point && typeof point === 'object' && !Array.isArray(point) && finiteNumber((point as Record<string, unknown>).lat)
      && finiteNumber((point as Record<string, unknown>).lng)
  ))) return false
  // A coordinate pair is null or an object with two finite numbers.
  if (r.start_location_coords !== null && r.start_location_coords !== undefined) {
    const c = r.start_location_coords as Record<string, unknown>
    if (typeof c !== 'object' || Array.isArray(c) || !finiteNumber(c.lat) || !finiteNumber(c.lng)) return false
  } else if (r.start_location_coords === undefined) return false
  // Optional columns: a column the writer does not know is refused, and a
  // known column may be null.
  const optional: Array<[keyof OptionalColumnsProbe, (v: unknown) => boolean]> = [
    ['economy', finiteNumber], ['price', finiteNumber], ['roundTrip', v => typeof v === 'boolean'],
    ['cover', v => typeof v === 'string'], ['inviteCode', v => typeof v === 'string'],
    ['stayStyle', v => typeof v === 'string'], ['driverCount', finiteNumber],
    ['hasVulnerable', v => typeof v === 'boolean'], ['driveAfterDinner', finiteNumber],
    ['tankL', finiteNumber], ['rentPerDayInr', finiteNumber], ['localTrain', v => typeof v === 'boolean'],
    ['flights', Array.isArray], ['ref', v => typeof v === 'string'],
  ]
  const columnOf: Record<string, string> = {
    economy: 'fuel_economy_km_per_l', price: 'fuel_price_per_l', roundTrip: 'round_trip',
    cover: 'cover_image_url', inviteCode: 'invite_code', stayStyle: 'stay_style',
    driverCount: 'driver_count', hasVulnerable: 'has_vulnerable', driveAfterDinner: 'drive_after_dinner_min',
    tankL: 'tank_l', rentPerDayInr: 'rent_per_day_inr', localTrain: 'local_train',
    flights: 'flights', ref: 'ref',
  }
  for (const [probe, isValid] of optional) {
    const column = columnOf[probe as string]
    const value = r[column]
    if (value === undefined) {
      // `deleted_at` is read by the tombstone rule and stays allowed either way.
      return false
    }
    if (value === null) {
      if (!cols || !cols[probe]) return false
      continue
    }
    if (!isValid(value)) return false
  }
  // A JSONB object column: check it when this writer includes the column.
  if (r.vehicle_profile === undefined && cols?.vehicleProfile) return false
  if (r.vehicle_profile !== undefined && r.vehicle_profile !== null
    && (typeof r.vehicle_profile !== 'object' || Array.isArray(r.vehicle_profile))) return false
  return true
}

function coherentStop(value: unknown): value is ItineraryStop {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const stop = value as Record<string, unknown>
  if (!nonEmptyString(stop.id) || !nonEmptyString(stop.title) || !nonEmptyString(stop.locationName)) return false
  if (!(STOP_CATEGORIES as readonly unknown[]).includes(stop.category)
    || !(STOP_STATUSES as readonly unknown[]).includes(stop.status)
    || !(['must-do', 'nice-to-have', 'optional'] as unknown[]).includes(stop.priority)) return false
  for (const field of ['lat', 'lng', 'visitMinutes', 'entryFeeInrPerPerson', 'transportCostInrTotal', 'orderInDay']) {
    if (!finiteNumber(stop[field])) return false
  }
  for (const field of ['placeId', 'description', 'openTime', 'closeTime', 'notes', 'slotKey', 'sourceUrl', 'departTime', 'arrivalTime']) {
    if (stop[field] !== undefined && typeof stop[field] !== 'string') return false
  }
  for (const field of ['auto', 'weatherSensitive']) {
    if (stop[field] !== undefined && typeof stop[field] !== 'boolean') return false
  }
  for (const field of ['legDistanceKm', 'legTravelMinutes']) {
    if (stop[field] !== undefined && !finiteNumber(stop[field])) return false
  }
  return true
}

function coherentDay(value: unknown): value is ItineraryDay {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const day = value as Record<string, unknown>
  if (!nonEmptyString(day.id) || !finiteNumber(day.index)) return false
  if (day.title !== undefined && typeof day.title !== 'string') return false
  if (day.startTime !== undefined && typeof day.startTime !== 'string') return false
  return Array.isArray(day.stops) && day.stops.every(coherentStop)
}

function coherentDays(days: unknown): days is ItineraryDay[] | null {
  return days === null || (Array.isArray(days) && days.every(coherentDay))
}

function coherentDestinations(destinations: unknown): destinations is string[] | null {
  return destinations === null || (Array.isArray(destinations) && destinations.every(value => typeof value === 'string'))
}

/**
 * A membership row is coherent when every field has the stored type. A row
 * naming another trip is not coherent for this read.
 */
function coherentMemberRow(row: unknown): row is MemberRow {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  const m = row as Record<string, unknown>
  return nonEmptyString(m.trip_id) && nonEmptyString(m.user_id)
    && (m.role === 'owner' || m.role === 'editor' || m.role === 'commenter' || m.role === 'viewer')
    && finiteNumber(m.joined_at)
}

/**
 * #804 (round 10 B3) — the cached fallback row must be a USABLE trip, not just
 * a revision and a membership. It answers the same checks the live row answers,
 * in the Trip shape this client holds: an identity, a name, a day list, and a
 * usable revision.
 */
function usableCachedTrip(trip: Trip | undefined, tripId: string): boolean {
  if (!trip) return false
  if (typeof trip.id !== 'string' || trip.id.toLowerCase() !== tripId.toLowerCase()) return false
  if (typeof trip.name !== 'string' || trip.name.length === 0) return false
  if (typeof trip.startLocation !== 'string' || typeof trip.transportMode !== 'string'
    || typeof trip.travelStyle !== 'string' || typeof trip.coverEmoji !== 'string') return false
  if (!Number.isFinite(trip.travellers) || !Number.isFinite(trip.budgetPerPersonInr)
    || !Number.isFinite(trip.createdAt) || !Number.isFinite(trip.updatedAt)) return false
  if (trip.visibility !== 'private' && trip.visibility !== 'public') return false
  if (!Array.isArray(trip.days) || !trip.days.every(coherentDay) || !Array.isArray(trip.expenses)
    || !Array.isArray(trip.destinations) || !trip.destinations.every(value => typeof value === 'string')
    || !Array.isArray(trip.fixedCommitments)) return false
  if (typeof trip.startDate !== 'string' || typeof trip.endDate !== 'string') return false
  if (!validWriteVersion(trip.writeVersion)) return false
  return Array.isArray(trip.members) && trip.members.every(member =>
    !!member && typeof member === 'object' && typeof member.userId === 'string' && Number.isFinite(member.joinedAt)
      && (member.role === 'owner' || member.role === 'editor' || member.role === 'commenter' || member.role === 'viewer'))
}

function canSendTripWrite(scope: IdentityScope, tripId: string, accessEpoch: number): boolean {
  const trip = tripById(tripId)
  return isCurrentIdentity(scope) && (tripAccessEpochs.get(tripId) ?? 0) === accessEpoch
    && !tripAccessEpochs.has(roleFloorKey(tripId, scope.userId))
    && !!trip && !trip.deletedAt && (canEdit(roleOf(trip, scope.userId)) || isAdminCached())
}

/**
 * Is this work still allowed to touch the cache?
 *
 * ONE owner for the access decision. Every path that awaits, and then writes
 * to the cache or reports success, asks this question first. It is the weaker
 * of the two checks on purpose: `canSendTripWrite` also needs the edit
 * right, so it is false in the very branch that handles a lost edit right.
 *
 * The three things it reads:
 * - the identity is still the one that started the work,
 * - the scope epoch has not moved, so the account has not changed,
 * - the trip's access generation has not moved, so the access has not changed.
 *
 * The identity epoch and the access generation only ever increase, so a scope
 * that fails this check never passes it again. That is what makes one check
 * enough, and it is why an old action can never publish after a new grant.
 */
function stillLive(scope: IdentityScope, tripId: string, accessEpoch: number): boolean {
  return isCurrentIdentity(scope) && (tripAccessEpochs.get(tripId) ?? 0) === accessEpoch
}

async function retainQueuedState(entry: QueuedWrite, scope: IdentityScope, changes: Partial<QueuedWrite>): Promise<void> {
  if (!isCurrentIdentity(scope)) return
  const accessEpoch = tripAccessEpochs.get(entry.tripId) ?? 0
  const next = { ...entry, ...changes }
  await requeueIfCurrent(next)
  const current = (await pendingWrites()).find(w => sameQueuedWrite(w, entry))
  if (!current || !canSendTripWrite(scope, entry.tripId, accessEpoch)) return
  const held = queuedLocalTrips.get(entry.tripId)
  if (!held || sameQueuedWrite(held, entry)) queuedLocalTrips.set(entry.tripId, current)
}

/**
 * Keep a queued copy after the account lost the right to write it.
 *
 * The copy is the account's own work. It stays on the device with a stated
 * reason, so the owner can still download it. A copy with a reason never
 * retries by itself and never replaces a shared plan.
 */
async function retainRevokedCopy(entry: QueuedWrite, scope: IdentityScope, reason: QueuedWrite['reason']): Promise<void> {
  if (!isCurrentIdentity(scope) || entry.ownerId !== scope.userId) return
  // Only the queue changes. The trip overlay is not touched, because a copy
  // the account cannot write must not show as the visible plan.
  await requeueIfCurrent({ ...entry, state: 'failed', reason })
}

/** Stop pending callbacks for one trip. The saved edit stays queued until the server confirms a deletion. */
function revokeTripWork(tripId: string): void {
  editableTripGrants.delete(tripId)
  tripAccessEpochs.set(tripId, (tripAccessEpochs.get(tripId) ?? 0) + 1)
  const pending = pendingTripWrites.get(tripId)
  if (pending) clearTimeout(pending.timer)
  pendingTripWrites.delete(tripId)
  const verdict = pendingTripVerdicts.get(tripId)
  pendingTripVerdicts.delete(tripId)
  verdict?.settle(false)
  if (newestTripVerdicts.get(tripId) === verdict) newestTripVerdicts.delete(tripId)
}

/** Drop the saved edit for one trip once the server has confirmed its deletion. */
async function discardTripEdits(scope: IdentityScope, tripId: string): Promise<void> {
  const held = queuedLocalTrips.get(tripId)
  if (held?.ownerId === scope.userId) queuedLocalTrips.delete(tripId)
  for (const write of await pendingWrites()) {
    if (write.tripId === tripId && write.ownerId === scope.userId) await dropQueuedWrite(write)
  }
  // The offline snapshot still lists the trip until the next hydrate, so clear it now.
  void clearSnapshot(scope.userId)
}

/**
 * Revoke pending callbacks before clearing the local data they could otherwise
 * restore.
 *
 * A reason means the account LOST the right to write the trip, not that it
 * asked to forget the work. The queued copy then stays for its owner with the
 * reason attached. Without a reason the copy is dropped, which is what an
 * explicit discard, a trash and a sign-out mean.
 *
 * It returns the NEW access generation. The generation is bumped here, so a
 * caller that reads work after this call must compare against the returned
 * value. A caller that compares against its own captured generation would
 * always see a mismatch.
 */
function invalidateTripWork(tripId: string, userId: string, reason?: QueuedWrite['reason']): number {
  // The revoke step stops the pending callbacks and moves the generation.
  // The reason is kept beside the generation and the identity that recorded
  // it, so a removal that was in flight when the generation moved can put the
  // copy back, and a later account cannot inherit the reason.
  revokeTripWork(tripId)
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  if (reason) tripInvalidationReasons.set(tripId, { reason, userId, generation: accessEpoch })
  else tripInvalidationReasons.delete(tripId)
  const held = queuedLocalTrips.get(tripId)
  queuedLocalTrips.delete(tripId)
  const scope = identityScope()
  if (reason) {
    // The account lost the right to write, so the copy is kept for its owner
    // with the reason attached. The copy never syncs on its own, and it never
    // leaves this account.
    if (held?.ownerId === userId && scope) void retainRevokedCopy(held, scope, reason)
    void pendingWrites().then(writes => {
      if (!scope || !isCurrentIdentity(scope) || tripAccessEpochs.get(tripId) !== accessEpoch) return
      for (const write of writes) {
        if (write.tripId === tripId && write.ownerId === userId) void retainRevokedCopy(write, scope, reason)
      }
    })
    // The snapshot still holds the trip's rows. A demoted reader can read
    // them, so the snapshot stays. A removed account must not keep them.
    if (reason === 'access-removed') void clearSnapshot(userId)
    return accessEpoch
  }
  if (held?.ownerId === userId) void dropQueuedWrite(held)
  void pendingWrites().then(writes => {
    if (!scope || !isCurrentIdentity(scope) || tripAccessEpochs.get(tripId) !== accessEpoch) return
    for (const write of writes) {
      if (write.tripId === tripId && write.ownerId === userId) void dropQueuedWrite(write)
    }
  })
  void clearSnapshot(userId)
  return accessEpoch
}

/**
 * Bind requests to the captured account, even if SDK token acquisition awaits a
 * switch.
 *
 * #804 (round 10 B2) — `live` is checked BEFORE the token is requested and after
 * it returns. Retirement during the initial session read used to reach the next
 * caller's await, so a retired join still issued one membership request. With
 * the pre-check, a retired try dispatches nothing at all.
 */
async function tripWriteToken(scope: IdentityScope, live?: AttemptGuard): Promise<string | null> {
  if (live && !live()) return null
  const { data, error } = await supabase.auth.getSession()
  if (live && !live()) return null
  const session = data?.session
  if (error || !isCurrentIdentity(scope) || session?.user.id !== scope.userId || !session.access_token) return null
  return session.access_token
}

/**
 * Read the shared plan AND the authoritative membership.
 *
 * The trip row carries no members, so the members come from a second read.
 * The CACHED members cannot be reused here: a demotion is exactly the case
 * where the cache still says owner or editor while the server says viewer.
 * A shared plan published with the cached membership leaves the edit controls
 * on screen for an account that may no longer edit.
 */
async function readSharedTripWithMembership(
  tripId: string,
  token: string | null,
): Promise<{ trip: Trip; members: TripMember[] } | null> {
  // No session token, so the shared plan cannot be read.
  if (!token) return null
  const [tripRead, memberRead] = await Promise.all([
    supabase.from('trips').select('*').eq('id', tripId)
      .setHeader('Authorization', `Bearer ${token}`).maybeSingle(),
    supabase.from('trip_members').select('*').eq('trip_id', tripId)
      .setHeader('Authorization', `Bearer ${token}`),
  ])
  if (tripRead.error || !tripRead.data || (tripRead.data as TripRow).deleted_at) return null
  // A failed membership read is not an empty membership. An empty list would
  // hide every role on screen, so a failed member read fails the whole read.
  if (memberRead.error || !Array.isArray(memberRead.data)) return null
  const members = (memberRead.data as MemberRow[]).map(m => ({
    userId: m.user_id, role: m.role as TripMember['role'], joinedAt: m.joined_at,
  }))
  return { trip: rowToTrip(tripRead.data as TripRow, members), members }
}

/** What a discard needs from the server before it removes the local copy. */
type DiscardRefresh = { kind: 'gone' } | { kind: 'shared'; trip: Trip }

/**
 * Read the shared plan for a discard, before the local copy is removed.
 *
 * `gone` means the server holds no live trip. `shared` means the trip and its
 * membership were both read, and the trip is not older than the server ledger.
 * `null` means the read cannot finish. The caller then decides what the copy
 * does, and a failed read is never published as an empty plan.
 */
async function readForDiscard(tripId: string, token: string | null): Promise<DiscardRefresh | null> {
  if (!token) return null
  const first = await supabase.from('trips').select('*').eq('id', tripId)
    .setHeader('Authorization', `Bearer ${token}`).maybeSingle()
  if (first.error) return null
  let row = (first.data as TripRow | null) ?? null
  if (!row || row.deleted_at) return { kind: 'gone' }
  if (isStaleServerRow(serverTripTimestamps.get(tripId), row.updated_at)) {
    // The first read may be older than the server ledger. Read the trip again.
    const again = await supabase.from('trips').select('*').eq('id', tripId)
      .setHeader('Authorization', `Bearer ${token}`).maybeSingle()
    if (again.error) return null
    row = (again.data as TripRow | null) ?? null
    if (!row || row.deleted_at) return { kind: 'gone' }
    if (isStaleServerRow(serverTripTimestamps.get(tripId), row.updated_at)) return null
  }
  const shared = await readSharedTripWithMembership(tripId, token)
  return shared ? { kind: 'shared', trip: shared.trip } : null
}

/**
 * Read the shared plan under the CURRENT identity and access generation.
 *
 * The realtime path has no captured scope, so it takes one now. The read and
 * the cache write are both re-checked, so an account switch or a newer access
 * grant during the read cannot put another account's plan in the cache.
 */
async function readSharedTripForCurrentIdentity(
  tripId: string,
): Promise<{ trip: Trip; members: TripMember[] } | null> {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope)) return null
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  const token = await tripWriteToken(scope)
  if (!token || !stillLive(scope, tripId, accessEpoch)) return null
  const shared = await readSharedTripWithMembership(tripId, token)
  if (!shared || !stillLive(scope, tripId, accessEpoch)) return null
  return shared
}

/**
 * Show a demoted reader the shared plan.
 *
 * The demotion already dropped the local overlay from the cache and from the
 * held copy. This reads the shared plan under the current identity and the
 * access generation that the demotion created, and writes it only if that
 * scope is still the live one.
 */
async function refreshSharedPlanAfterDemotion(tripId: string): Promise<void> {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope)) return
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  const shared = await readSharedTripForCurrentIdentity(tripId)
  if (!stillLive(scope, tripId, accessEpoch)) return
  if (!shared) {
    // The shared plan could not be read. The cache holds the LOCAL PROPOSAL
    // for this trip, and the account may no longer edit it, so the proposal
    // must not stay on screen. The trip leaves the list until a read
    // succeeds. A later read restores it.
    //
    // The trip only leaves the list while the account still cannot edit it.
    // A grant that landed during the read gave the edit right back, and then
    // the local proposal is the account's own work again.
    const trip = tripById(tripId)
    if (trip && canEdit(roleOf(trip, scope.userId))) return
    cache.trips = cache.trips.filter(t => t.id !== tripId)
    commit()
    return
  }
  // A trip that was deleted or removed while the read ran must not come back.
  if (shared.trip.deletedAt) return
  cache.trips = cache.trips.map(t => t.id === tripId ? shared.trip : t)
  commit()
}

/** Keep narrow metadata writes ordered with plan writes and their acknowledged revisions. */
async function persistTripMetadata(tripId: ID, payload: Record<string, unknown>, patchFields: Partial<Trip>, nullColumn?: string,
  onError?: (error: { code?: string; message?: string }) => void): Promise<boolean> {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope)) return false
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  const live = () => canSendTripWrite(scope, tripId, accessEpoch)
  return serializeTripWrite(`${scope.epoch}:${scope.userId}:${tripId}`, async () => {
    if (!live()) return false
    const token = await tripWriteToken(scope)
    if (!token || !live()) return false
    const base = tripById(tripId)?.writeVersion
    let query = supabase.from('trips').update(payload).eq('id', tripId)
    if (validWriteVersion(base)) query = query.eq('write_version', base)
    if (nullColumn) query = query.is(nullColumn, null)
    const { data, error } = await query.select('id, updated_at, write_version')
      .setHeader('Authorization', `Bearer ${token}`)
    if (!live()) return false
    if (error) { onError?.(error); return false }
    if (!Array.isArray(data) || data.length !== 1 || data[0].id !== tripId) return false
    const version = data[0].write_version
    const advance = validWriteVersion(base) && validWriteVersion(version) && version > base
    cache.trips = cache.trips.map(t => t.id === tripId
      ? { ...t, ...patchFields, ...(advance && t.writeVersion === base ? { writeVersion: version } : {}) } : t)
    const held = queuedLocalTrips.get(tripId)
    if (held?.ownerId === scope.userId) {
      const next = { ...held, ...(advance && held.baseVersion === base ? { baseVersion: version } : {}),
        trip: { ...held.trip as Trip, ...patchFields,
          ...(advance && held.baseVersion === base ? { writeVersion: version } : {}) } }
      queuedLocalTrips.set(tripId, next)
      await requeueIfCurrent(next)
      if (!live()) return false
    }
    recordServerTripTimestamp(tripId, data[0].updated_at)
    markLocalWrite('trips', tripId)
    commit()
    return true
  })
}

/** One guarded write. RLS checks permission; the server revision prevents lost updates. */
async function sendQueuedTripWrite(entry: QueuedWrite, scope: IdentityScope, accessEpoch: number): Promise<boolean> {
  const live = () => canSendTripWrite(scope, entry.tripId, accessEpoch)
  // A copy with a reason lost the right to write. It never sends again, so a
  // later grant must not silently replay it.
  if (!live() || entry.ownerId !== scope.userId || entry.state || entry.reason) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  const failed = async () => {
    if (!live()) return false
    const attempts = entry.attempts + 1
    const retryState: Partial<QueuedWrite> = { attempts, state: shouldRetry({ attempts }) ? undefined : 'failed' }
    await retainQueuedState(entry, scope, retryState)
    if (live()) toast(shouldRetry({ attempts })
      ? 'Changes are still on this device. Retry from Saved edits.'
      : 'Changes could not sync. Retry or download your copy from Saved edits.', 'err')
    return false
  }
  try {
    const token = await tripWriteToken(scope)
    if (!token || !live()) return false
    const { data: member, error: memberError } = await supabase.from('trip_members')
      .select('user_id, role, joined_at').eq('trip_id', entry.tripId).eq('user_id', scope.userId)
      .setHeader('Authorization', `Bearer ${token}`).maybeSingle()
    if (!live()) return false
    if (memberError) return failed()
    if ((!member || !canEdit(member.role)) && !isAdminCached()) {
      // The account may still READ the trip after a demotion, so the trip
      // leaves the list only when the account has no membership at all. The
      // queued copy stays for its owner with the reason attached.
      //
      // The identity and the access generation are checked again here. The
      // awaited read above can outlive the account that started it, and a
      // delayed invalidation must never touch another account's trip.
      if (!stillLive(scope, entry.tripId, accessEpoch)) return false
      const stillMember = !!member
      const reason = stillMember ? 'access-revoked' : 'access-removed'
      await retainRevokedCopy(entry, scope, reason)
      // The retention awaited storage, so the scope is checked once more. A
      // copy that changed hands in the meantime is not this scope's work.
      if (!stillLive(scope, entry.tripId, accessEpoch)) return false
      // The invalidation bumps the access generation, so the refresh below
      // must compare against the NEW generation. The captured one is stale
      // from here on.
      const nextEpoch = invalidateTripWork(entry.tripId, scope.userId, reason)
      if (!stillMember) {
        if (!stillLive(scope, entry.tripId, nextEpoch)) return false
        cache.trips = cache.trips.filter(t => t.id !== entry.tripId)
        commit()
      } else {
        // A demoted reader sees the shared plan, not the local copy. The local
        // copy is the account's own work and stays in the recovery list.
        //
        // The membership is read from the server, not from the cache. The
        // cache still says owner or editor, and publishing the shared plan
        // with those members would leave the edit controls on screen for an
        // account that may no longer edit.
        const shared = await readSharedTripWithMembership(entry.tripId, token)
        // BOTH outcomes of the read are guarded. The read awaited, so an
        // account switch or a newer grant may have landed, and the trip must
        // not be published or removed under a scope that no longer owns it.
        if (!stillLive(scope, entry.tripId, nextEpoch)) return false
        if (shared) {
          cache.trips = cache.trips.map(t => t.id === entry.tripId ? shared.trip : t)
          commit()
        } else {
          // The shared plan could not be read. The local proposal must not
          // stay on screen, because the account may no longer edit it. The
          // trip leaves the list until a read succeeds.
          //
          // The trip only leaves the list while the account still cannot
          // edit it. A grant that landed during the read gave the edit right
          // back, and then the local proposal is the account's own work.
          const trip = tripById(entry.tripId)
          if (trip && canEdit(roleOf(trip, scope.userId))) return false
          cache.trips = cache.trips.filter(t => t.id !== entry.tripId)
          commit()
        }
      }
      if (isCurrentIdentity(scope)) {
        toast(stillMember
          ? 'You can no longer edit this trip. Your saved copy stays on this device.'
          : 'You are no longer on this trip. Your saved copy stays on this device.', 'err')
      }
      return false
    }
    const { data: current, error: readError } = await supabase.from('trips')
      .select('id, owner_id, write_version, deleted_at').eq('id', entry.tripId)
      .setHeader('Authorization', `Bearer ${token}`).maybeSingle()
    if (!live()) return false
    if (readError) return failed()
    if (!current || current.deleted_at) {
      // The trip is gone from the server. The copy stays for its owner with the
      // reason attached, so it can still be downloaded.
      //
      // The scope is checked again before the invalidation, because the
      // retention awaited storage. Another account's trip must not be removed.
      if (!stillLive(scope, entry.tripId, accessEpoch)) return false
      await retainRevokedCopy(entry, scope, 'trip-unavailable')
      if (!stillLive(scope, entry.tripId, accessEpoch)) return false
      invalidateTripWork(entry.tripId, scope.userId, 'trip-unavailable')
      cache.trips = cache.trips.filter(t => t.id !== entry.tripId)
      commit()
      if (isCurrentIdentity(scope)) toast('This trip is no longer on the server. Your saved copy stays on this device.', 'err')
      return false
    }
    // Old queue entries and an old backend need review instead of an unsafe overwrite.
    if (!validWriteVersion(entry.baseVersion) || !validWriteVersion(current.write_version)
      || current.write_version !== entry.baseVersion) {
      await retainQueuedState(entry, scope, { state: 'conflict' })
      return false
    }
    const cols = await tripsHaveOptionalColumns()
    if (!live()) return false
    const trip = entry.trip as Trip
    // Same writer guard as the insert path: the debounced UPDATE would
    // otherwise drop an explicit Mixed answer and still report success.
    const drivesPartVerdict = drivesPartWriteVerdict(trip, cols)
    if (!drivesPartVerdict.ok) {
      toast(drivesPartVerdict.reason, 'err')
      return false
    }
    // #799 — tripUpdateRow drops owner_id. A queued entry may have captured a
    // stale owner id, and the trips_owner_id_immutable trigger refuses an
    // ownership change with 42501. The column is absent from this row, so the
    // revision check below stays intact and the server keeps its own owner.
    const { data, error } = await supabase.from('trips')
      .update(tripUpdateRow(trip, current.owner_id, cols), { count: 'exact' })
      .eq('id', entry.tripId).eq('write_version', entry.baseVersion)
      .select('id, updated_at, write_version')
      .setHeader('Authorization', `Bearer ${token}`)
    if (!live()) return false
    if (error) return failed()
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null
    if (!row || row.id !== entry.tripId || !validWriteVersion(row.write_version)
      || row.write_version <= entry.baseVersion) {
      await retainQueuedState(entry, scope, { state: 'conflict' })
      return false
    }
    recordServerTripTimestamp(entry.tripId, row.updated_at)
    const newer = queuedLocalTrips.get(entry.tripId)
    if (newer && !sameQueuedWrite(newer, entry) && newer.baseVersion === entry.baseVersion) {
      // A later local edit includes this acknowledged snapshot. Keep its new baseline.
      const rebased = { ...newer, baseVersion: row.write_version,
        trip: { ...newer.trip as Trip, writeVersion: row.write_version } }
      queuedLocalTrips.set(entry.tripId, rebased)
      await requeueIfCurrent(rebased)
    }
    if (!live()) return false
    await dropQueuedWrite(entry)
    if (!live()) return false
    const held = queuedLocalTrips.get(entry.tripId)
    if (held && sameQueuedWrite(held, entry)) queuedLocalTrips.delete(entry.tripId)
    const cached = tripById(entry.tripId)
    if (cached) cached.writeVersion = row.write_version
    commit()
    return true
  } catch {
    return failed()
  }
}

async function persistTripFieldNow(id: ID, captured: CapturedTripWrite): Promise<boolean> {
  const scope = { userId: captured.sessionId, epoch: captured.epoch }
  if (!canSendTripWrite(scope, id, captured.accessEpoch)) return false
  const durable = await captured.durable
  if (!canSendTripWrite(scope, id, captured.accessEpoch)) return false
  const creation = tripCreates.get(id)
  if (creation && !await creation) return false
  if (!canSendTripWrite(scope, id, captured.accessEpoch)) return false
  if (!durable) toast('Device storage is unavailable. Keep this tab open until your changes sync.', 'err')
  return serializeTripWrite(`${scope.epoch}:${scope.userId}:${id}`, async () => {
    if (!canSendTripWrite(scope, id, captured.accessEpoch)) return false
    const held = queuedLocalTrips.get(id)
    const entry = held && sameQueuedWrite(held, captured.entry) ? held : captured.entry
    markLocalWrite('trips', id)
    return sendQueuedTripWrite(entry, scope, captured.accessEpoch)
  })
}

const activeReplays = new Map<string, Promise<number>>()

/** Replay only the current account. Paused records need an explicit recovery choice. */
export async function replayQueuedWrites(): Promise<number> {
  const scope = identityScope()
  if (!scope || !isSupabaseConfigured || !isCurrentIdentity(scope)) return 0
  const key = `${scope.epoch}:${scope.userId}`
  const existing = activeReplays.get(key)
  if (existing) return existing
  const operation = (async () => {
    let synced = 0
    const writes = await pendingWrites()
    if (!isCurrentIdentity(scope)) return 0
    for (const write of writes) {
      if (!isCurrentIdentity(scope)) break
      if (write.ownerId !== scope.userId || write.state || write.reason || !shouldRetry(write)) continue
      const accessEpoch = tripAccessEpochs.get(write.tripId) ?? 0
      const saved = await serializeTripWrite(`${key}:${write.tripId}`, async () => {
        if (!isCurrentIdentity(scope)) return false
        const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
        if (!current || !isCurrentIdentity(scope)) return false
        return sendQueuedTripWrite(current, scope, accessEpoch)
      })
      if (!isCurrentIdentity(scope)) break
      if (saved) synced += 1
    }
    return synced
  })()
  activeReplays.set(key, operation)
  try { return await operation } finally { if (activeReplays.get(key) === operation) activeReplays.delete(key) }
}

/** Retry a saved edit, or explicitly choose which complete plan to keep. */
export async function resolveQueuedTripWrite(tripId: ID, choice: 'retry' | 'replace' | 'discard'): Promise<boolean> {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope)) return false
  // The access generation is captured BEFORE the first await. A tombstone
  // that lands during the queue read bumps the generation, and this action
  // must then see the NEW generation as the current one. A generation read
  // after the await would take the bumped value and treat the stale action as
  // current.
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  const write = (await pendingWrites()).find(w => w.ownerId === scope.userId && w.tripId === tripId)
  if (!write || !isCurrentIdentity(scope)) return false
  // The generation moved while the queue was read, so this action is stale.
  if ((tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch) return false
  const live = () => canSendTripWrite(scope, tripId, accessEpoch)
  if (choice === 'discard') {
    // A discard removes the local copy. It writes nothing to the server, so it
    // does not need the edit right, and it does not need a connection.
    //
    // Every await below is followed by a scope check. An account switch or a
    // realtime deletion during the work must not let this path publish a trip
    // under a later identity, and it must not restore a deleted trip.
    if (!stillLive(scope, tripId, accessEpoch)) return false
    return serializeTripWrite(`${scope.epoch}:${scope.userId}:${tripId}`, async () => {
      if (!stillLive(scope, tripId, accessEpoch)) return false
      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current || !stillLive(scope, tripId, accessEpoch)) return false
      // The shared plan is read BEFORE the copy is removed. The read runs in the
      // write tail, so an earlier write lands first.
      const token = await tripWriteToken(scope)
      if (!stillLive(scope, tripId, accessEpoch)) return false
      const refresh = await readForDiscard(tripId, token)
      if (!stillLive(scope, tripId, accessEpoch)) return false
      // An unfinished read refuses the removal when the copy is the HELD overlay
      // and the cache shows it. A drop would leave that content on screen, and
      // the user could edit it and queue it again.
      //
      // A REASONED copy is never the overlay. The cache holds the shared plan
      // instead. Refusing it would leave a copy the account can neither sync nor
      // remove. So a reasoned copy is removed either way.
      if (!refresh && isHeldCopy(current) && cache.trips.some(t => t.id === tripId)) return false
      const durable = await dropQueuedWrite(current)
      // A scope change means the removal did not complete under this scope.
      // It reports false, so the caller does not claim a clean removal.
      if (!stillLive(scope, tripId, accessEpoch)) {
        // The generation moved while the removal was in flight, so something
        // else decided the copy's fate. A tombstone during the removal asked
        // for the copy to be KEPT, and the removal has just deleted it. The
        // copy is put back with the reason that was recorded, so the two
        // writers cannot disagree.
        //
        // The reason is bound to the identity and the generation that
        // recorded it, so a later account cannot inherit it. And the
        // captured identity must still be the live one, so a sign-out during
        // the removal does not put the copy back.
        const recorded = tripInvalidationReasons.get(tripId)
        if (recorded && durable && recorded.userId === scope.userId
          && recorded.generation === tripAccessEpochs.get(tripId)
          && isCurrentIdentity(scope)) {
          // The copy was deleted, so it is queued again rather than replaced.
          // `requeueIfCurrent` only replaces an entry that is still there.
          await queueWrite({ ...current, state: 'failed', reason: recorded.reason })
        }
        return false
      }
      const latest = (await pendingWrites()).find(w => w.ownerId === scope.userId && w.tripId === tripId)
      if (!stillLive(scope, tripId, accessEpoch)) return false
      if (latest) {
        // Storage failure or a newer edit keeps its own recovery state and visible contents.
        // A reasoned copy is never held as the local copy, so a later edit
        // cannot capture its stale baseline.
        if (isHeldCopy(latest)) queuedLocalTrips.set(tripId, latest)
        else queuedLocalTrips.delete(tripId)
        return false
      }
      const held = queuedLocalTrips.get(tripId)
      if (held && !sameQueuedWrite(held, current)) return false
      queuedLocalTrips.delete(tripId)
      if (!refresh) {
        // The shared plan could not be read. The copy was not the overlay on
        // screen, so nothing visible needs a correction.
        commit()
        void clearSnapshot(scope.userId)
        return durable
      }
      if (refresh.kind === 'shared') {
        // The read finished before the removal. No await separates the newer-edit
        // check above from this publication, so a newer edit keeps its contents.
        cache.trips = [...cache.trips.filter(t => t.id !== tripId), refresh.trip]
        recordServerTripTimestamp(tripId, refresh.trip.updatedAt)
      } else {
        // The trip is gone from the server. The invalidation bumps the
        // generation, so the check after it compares against the value it
        // returns, not against the captured one.
        if (!stillLive(scope, tripId, accessEpoch)) return false
        const nextEpoch = invalidateTripWork(tripId, scope.userId)
        if (!stillLive(scope, tripId, nextEpoch)) return false
        cache.trips = cache.trips.filter(t => t.id !== tripId)
      }
      commit()
      void clearSnapshot(scope.userId)
      return durable
    })
  }
  return serializeTripWrite(`${scope.epoch}:${scope.userId}:${tripId}`, async () => {
    if (!live()) return false
    let current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
    if (!current || !live()) return false
    // A copy with a reason lost the right to write. Retrying or replacing it
    // must not bypass that, so the copy can only be downloaded or discarded.
    if (current.reason) return false
    const token = await tripWriteToken(scope)
    if (!token || !live()) return false
    let next = { ...current, attempts: 0, state: undefined }
    if (choice === 'replace') {
      // #804 — no queued snapshot can carry a partial row any more (the invite
      // preview never enters the cache or the queue), so a Replace only needs
      // the authoritative baseline. The five columns are whatever the snapshot
      // holds, which came from a full row.
      const { data: row, error } = await supabase.from('trips').select('id, write_version').eq('id', tripId)
        .setHeader('Authorization', `Bearer ${token}`).maybeSingle()
      if (!live() || error || !row || !validWriteVersion(row.write_version)) return false
      next = { ...next, baseVersion: row.write_version }
    } else if (current.state === 'conflict') {
      return false
    }
    await requeueIfCurrent(next)
    current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
    if (!current || !live()) return false
    const held = queuedLocalTrips.get(tripId)
    if (held && !sameQueuedWrite(held, current)) return false
    queuedLocalTrips.set(tripId, current)
    return sendQueuedTripWrite(current, scope, accessEpoch)
  })
}

function persistTripField(id: ID, t: Trip): void {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope)) return
  markLocalWrite('trips', id)
  const snapshot = structuredClone(t)
  const previous = queuedLocalTrips.get(id)
  lastWriteCapture = Math.max(Date.now(), lastWriteCapture + 1)
  const entry: QueuedWrite = { tripId: id, ownerId: scope.userId, capturedAt: lastWriteCapture,
    revision: randomToken(16), baseVersion: previous?.baseVersion ?? t.writeVersion,
    attempts: 0, state: previous?.state === 'conflict' ? 'conflict' : undefined, trip: snapshot }
  queuedLocalTrips.set(id, entry)
  const captured: CapturedTripWrite = { trip: snapshot, sessionId: scope.userId, epoch: scope.epoch,
    accessEpoch: tripAccessEpochs.get(id) ?? 0, entry, durable: queueWrite(entry) }
  if (TRIP_WRITE_DEBOUNCE_MS <= 0) {
    const v = openTripVerdict()
    newestTripVerdicts.set(id, v)
    sendUnderVerdict(id, v, persistTripFieldNow(id, captured))
    return
  }
  const prev = pendingTripWrites.get(id)
  if (prev) clearTimeout(prev.timer)
  const v = pendingTripVerdicts.get(id) ?? openTripVerdict()
  pendingTripVerdicts.set(id, v)
  newestTripVerdicts.set(id, v)
  const timer = setTimeout(() => {
    pendingTripVerdicts.delete(id)
    pendingTripWrites.delete(id)
    sendUnderVerdict(id, v, persistTripFieldNow(id, captured))
  }, TRIP_WRITE_DEBOUNCE_MS)
  pendingTripWrites.set(id, { ...captured, timer })
}

// ---------------- Members & collaboration ----------------

export function membersOf(trip: Trip): TripMember[] { return trip.members ?? [] }

/** Any cached identity for an id: a public card, or a private row the caller is
 *  allowed to hold. The name and avatar are the same shape on both, which is why
 *  the ~20 call sites that only want those need no change (#800). */
export function userById(id: ID | undefined): CachedUser | undefined {
  if (!id) return undefined
  return cache.users.find(u => u.id === id)
}

export function roleOf(trip: Trip, userId: ID | null): TripMember['role'] | null {
  if (!userId) return null
  return trip.members?.find(m => m.userId === userId)?.role ?? null
}

export function canEdit(role: TripMember['role'] | null): boolean {
  return role === 'owner' || role === 'editor'
}

/** Masteradmins can open any workspace (the RLS bypass) — but the per-trip
 *  permission UI still needs a "yes". Admin-as-editor lets an admin act as an
 *  escape hatch on broken trips without rewriting every canEdit call site. */
export function canEditAdmin(role: TripMember['role'] | null): boolean {
  return canEdit(role) || isAdminCached()
}

/**
 * Change a member's role, and roll the cache back if the write is refused.
 *
 * #391 — this was a `mutateTrip` + `fire(...)` with neither a rollback nor a
 * toast, so a role change the server refused looked exactly like one that
 * landed and then reverted on the next hydrate. The undo window that
 * `removeMember` gets does not apply here (there is nothing to undo), so the
 * rollback is the only safety net this path has and it was missing.
 *
 * The directions matter: the cache is restored on failure (the UI must not
 * claim a role the server refused) and the failure is LOUD, because a quiet
 * one is indistinguishable from success. A quiet SUCCESS is fine here.
 *
 * `mutateTrip` with `touch: false` is kept, so the role change does not bump
 * the trip's `updatedAt` and re-arm the "page behind itinerary" nudge for a
 * change no itinerary content saw.
 */
export function setMemberRole(tripId: ID, userId: ID, role: TripMember['role']): void {
  const t = tripById(tripId)
  const m = t?.members?.find(x => x.userId === userId)
  if (!t || !m || m.role === role) return
  const previousRole = m.role
  mutateTrip(tripId, draft => {
    const dm = draft.members?.find(x => x.userId === userId)
    if (dm) dm.role = role
  }, { touch: false })
  void Promise.resolve(
    supabase.from('trip_members').update({ role }).eq('trip_id', tripId).eq('user_id', userId),
  ).then(
    res => {
      if (!res?.error) return
      console.error('[yatraflow] trip_members write failed', res.error)
      mutateTrip(tripId, draft => {
        const dm = draft.members?.find(x => x.userId === userId)
        if (dm) dm.role = previousRole
      }, { touch: false })
      commit()
      toast(`Couldn't change that role — it has been put back. (${res.error.message ?? 'write refused'})`, 'err')
    },
    err => {
      console.error('[yatraflow] trip_members write rejected', err)
      mutateTrip(tripId, draft => {
        const dm = draft.members?.find(x => x.userId === userId)
        if (dm) dm.role = previousRole
      }, { touch: false })
      commit()
      toast('Couldn’t change that role — check your connection.', 'err')
    },
  )
}

/**
 * Join a trip from its invite. ORDER IS LOAD-BEARING: the trip_members row
 * goes to the database FIRST — the activity log insert and the owner
 * notification are RLS-gated on is_editor(), which is false until the
 * membership row exists, so writing them first meant every join logged
 * "activity write failed / notifications write failed" to the console while
 * the side effects silently never landed. Only the cache mutates
 * optimistically (joiners need the trip in My Trips immediately).
 * Returns whether the user is a member of the trip afterwards.
 */
/**
 * The result of a join, as the gate must render it. Three states, never shown as
 * one another (R23):
 *   'joined'           the membership exists AND the full row is in the cache,
 *                      so the caller may open the trip.
 *   'joined-unloaded'  the membership exists but the row could not be read. The
 *                      user IS on the trip; only the page failed. A retry must
 *                      re-read the row, never join again.
 *   'failed'           no membership was created. A retry must join again.
 */
export type JoinResult = 'joined' | 'joined-unloaded' | 'joined-unloaded-incomplete' | 'joined-unloaded-failed'
  | 'not-member' | 'missing' | 'deleted' | 'incomplete' | 'failed' | 'abandoned'

/**
 * Join a trip through its invite code, then fetch the full row into the cache.
 *
 * #804 — the preview row is no longer cached, so this cannot read the trip from
 * tripById. The caller passes the name it already holds for the toast.
 *
 * Returns 'joined' only when the join AND the full-row load both succeed. A join
 * that succeeded but whose row could not be read returns 'joined-unloaded': the
 * membership exists, so plain failure would suggest they are not a member, and
 * plain success would send them to a page with nothing in it.
 */
export async function joinViaInvite(
  tripId: ID,
  userId: ID,
  inviteCode: string,
  guard?: AttemptGuard,
): Promise<JoinResult> {
  // C1/B7 — capture and CHECK the identity and access generation before the
  // cached-member shortcut, and keep that same scope for every continuation. A
  // shortcut that trusts the cache first would act for whoever is signed in now.
  const scope = identityScope()
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  if (!scope || scope.userId !== userId || (guard ? !guard() : false)) return 'abandoned'
  const cached = tripById(tripId)
  if (cached?.members?.some(m => m.userId === userId)) {
    // Already a member: the cached row already carries the membership, so this
    // call writes no row and claims nothing.
    return finishJoin(tripId, userId, scope, accessEpoch, guard)
  }
  // B1/B-3 (round 10 B2) — record the grant we EXPECT before any await. The join
  // writes a membership row either way: through join_trip when it runs, or
  // already held when the pre-query says member. The record is bound to the
  // trip, the joining user, the identity generation, and the App's live try,
  // so an own echo is exempt only while all four still match. The window clears
  // on every exit.
  const expectation: JoinExpectation = { tripId, userId, identityEpoch, accessEpoch, guard: () => !guard || guard() }
  expectedJoins.set(tripId, expectation)
  try {
    const token = await tripWriteToken(scope, guard)
    if (!token || !isCurrentIdentity(scope) || (tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch || (guard ? !guard() : false)) {
      console.error('[yatraflow] join abandoned before dispatch: the account, trip access or try changed', { tripId })
      return 'abandoned'
    }
    return await joinAfterScope(tripId, userId, inviteCode, scope, accessEpoch, token, guard)
  } finally {
    // Only the try that RECORDED the window may close it. An older, retired try
    // that unwinds after a newer try opened its own window must not close that
    // newer one.
    if (expectedJoins.get(tripId) === expectation) expectedJoins.delete(tripId)
  }
}

/**
 * The rest of joinViaInvite, called with the scope and access epoch captured
 * BEFORE the first await. The caller owns the expected-join window, so this only
 * re-checks identity and reaches the join.
 */
async function joinAfterScope(
  tripId: ID,
  userId: ID,
  inviteCode: string,
  scope: { userId: string; epoch: number },
  accessEpoch: number,
  token: string,
  guard?: AttemptGuard,
): Promise<JoinResult> {
  // S3 — the cache cannot answer "is this caller already a member?" when the trip
  // came from the uncached preview, and join_trip's `on conflict do nothing`
  // cannot report whether it inserted. So ask the membership table.
  //
  // B1 — the re-check goes AFTER this await, not before it. This query is the
  // round trip the switch lands in: checking before it answers "the account that
  // started", which is always true, and the join then runs under whoever is
  // signed in now. A pre-check before a later await proves nothing.
  const membership = await membershipCertain(tripId, userId, token)
  if (!isCurrentIdentity(scope) || (tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch || (guard ? !guard() : false)) {
    console.error('[yatraflow] join abandoned after the membership read: the account, access or try changed', { tripId })
    return 'abandoned'
  }
  // S3/pre-query error — a read that failed says "not a member" exactly as
  // loudly as a table that answered "no such row". The join must still run when
  // the read failed, so the certainty is what decides, not the boolean.
  if (membership.certain && membership.member) {
    // The caller is a known member: no write, and this client claims nothing.
    return finishJoin(tripId, userId, scope, accessEpoch, guard)
  }
  // join_trip() takes the invite code, never a trip id. It adds the signed-in
  // user as an editor. It returns the trip id, or null for a dead code. It is
  // `on conflict do nothing`, so it CANNOT say whether it inserted a row.
  const { data: joinedTripId, error } = await supabase.rpc('join_trip', { p_code: inviteCode })
    .setHeader('Authorization', `Bearer ${token}`)
  // B2a — every await above can span an account switch. Check before ANY effect.
  if (!isCurrentIdentity(scope) || (tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch || (guard ? !guard() : false)) {
    console.error('[yatraflow] join continuation abandoned: the account, access or try changed', { tripId })
    return 'abandoned'
  }
  if (error) {
    console.error('[yatraflow] join write failed', error)
    return 'failed'
  }
  // Fail closed: a null answer, or an answer naming another trip, joins nothing.
  if (!joinedTripId || String(joinedTripId).toLowerCase() !== tripId.toLowerCase()) return 'failed'
  markLocalWrite('trip_members', tripId)
  // B6 — no optimistic membership is published here. The admitted full row owns
  // the membership, so a refusal leaves the cache and its subscribers unchanged.
  // R5 — no activity claim either. The RPC is idempotent and cannot report an
  // insertion, so this client does not pretend to know one happened.
  // R5 — the owner is not notified, whatever the pre-query said. An idempotent
  // RPC cannot report an insertion, so this client claims none.
  return finishJoin(tripId, userId, scope, accessEpoch, guard)
}

/**
 * #804 — the half of a join that runs after the membership exists: load the full
 * row, then report the outcome. It sends no owner notice and writes no activity
 * claim (R5), because an idempotent RPC cannot say whether it inserted anything.
 *
 * B2 — an ABANDONED load is carried through unchanged. It means the caller's
 * account changed mid-flight, so this client does not know whether a membership
 * exists; reporting 'joined-unloaded' would claim a membership the caller may not
 * have. Only a genuine read failure is 'joined-unloaded'.
 *
 * S3/pre-query — `freshJoin` is true only when THIS call ran the join RPC. A
 * known member passes false, so re-clicking an invite never tells the owner that
 * an existing member "joined as editor", and a reload passes false for the same
 * reason. The notice follows what this call did, not what the loaded row shows.
 */
async function finishJoin(
  tripId: ID,
  userId: ID,
  scope: { userId: string; epoch: number },
  accessEpoch: number,
  guard?: AttemptGuard,
): Promise<JoinResult> {
  const loaded = await loadFullTripIntoCache(tripId, guard)
  // B7 — the load awaited. Re-check the ORIGINAL scope, access generation and try
  // owner before any claim, so a switch during the load cannot become 'joined'.
  if (!isCurrentIdentity(scope) || (tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch || (guard ? !guard() : false)) {
    return 'abandoned'
  }
  // B8 — the refusal kinds stay distinct. Collapsing them into 'joined-unloaded'
  // told a non-member, a missing row and a tombstone that the plan merely failed.
  if (loaded === 'abandoned') return 'abandoned'
  if (loaded === 'not-member') {
    console.error('[yatraflow] the full trip read shows the caller is not a member', { tripId, userId })
    return 'not-member'
  }
  if (loaded === 'missing') return 'missing'
  if (loaded === 'deleted') return 'deleted'
  // The membership exists; only the row could not be accepted. That is the
  // "joined but not loaded" case, not a failed join and not a membership loss.
  if (loaded === 'incomplete') return 'joined-unloaded-incomplete'
  // A READ failure after the membership exists is the same kind of answer: the
  // caller is on the trip, and only the row failed to arrive.
  if (loaded === 'failed') return 'joined-unloaded-failed'
  if (loaded === 'stale') {
    // B3 (round 10) — the cached row is the truth ONLY when it is a USABLE trip
    // the caller can open, not merely a row with a revision and a membership.
    const cached = tripById(tripId)
    if (cached && usableCachedTrip(cached, tripId) && (cached.members ?? []).some(m => m.userId === userId)) return 'joined'
    return 'joined-unloaded-incomplete'
  }
  // R5 — no owner notice and no activity claim for an idempotent RPC. Two
  // certainly-absent pre-queries still cannot say which client inserted the row,
  // so this client claims nothing about the insertion.
  return 'joined'
}

/**
 * Re-read a trip the caller already joined, without joining again. The gate's
 * retry for 'joined-unloaded' uses this, so a retry can never write a second
 * membership row or send a second owner notification. `owed` is false: this call
 * did not create the membership.
 */
export async function reloadJoinedTrip(tripId: ID, guard?: AttemptGuard): Promise<JoinResult> {
  const scope = identityScope()
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  if (!scope || (guard ? !guard() : false)) return 'abandoned'
  // The same continuation the initial join uses, so a retry can never write a
  // second membership row, and it carries the SAME captured scope.
  return finishJoin(tripId, scope.userId, scope, accessEpoch, guard)
}

/** Why a full-row load did or did not replace the cached trip. */
export type LoadOutcome = 'loaded' | 'failed' | 'stale' | 'incomplete' | 'missing' | 'deleted' | 'not-member' | 'abandoned'

/**
 * #804 — read the full trip row and its members into the cache.
 *
 * Replaces the earlier version, which overwrote whatever was cached. A delayed
 * read could land after a newer revision, after a local edit, or after another
 * account took over, and the overwrite would silently undo all three. The rules
 * below are the ones hydrate and the realtime path already apply:
 *
 *   - identity and access are captured before the await and re-checked after it
 *     (the #798 queue-key pattern);
 *   - a row older than the server-timestamp ledger is refused, so the ledger
 *     never moves backwards (isStaleServerRow, the B2 realtime guard);
 *   - a row whose write_version is older than the cached one, or that carries no
 *     usable version at all, is refused rather than trusted;
 *   - a trip with a pending queued write keeps its local row: the queue owns
 *     that trip's next state and the server row is already behind it;
 *   - the caller must be a member (or an admin), so an empty or someone else's
 *     membership read cannot cache a trip the caller cannot read.
 *
 * A refusal returns a distinct outcome and leaves the cached row untouched.
 */
async function loadFullTripIntoCache(tripId: ID, guard?: AttemptGuard): Promise<LoadOutcome> {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope) || (guard ? !guard() : false)) return 'abandoned'
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  // C1 — capture the bearer before the reads and pin every request. The token
  // is checked against the captured identity and access generation, never a
  // global default header.
  const token = await tripWriteToken(scope, guard)
  if (!token || !isCurrentIdentity(scope) || (tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch || (guard ? !guard() : false)) {
    return 'abandoned'
  }
  const [tripRes, memRes] = await Promise.all([
    supabase.from('trips').select('*').eq('id', tripId).setHeader('Authorization', `Bearer ${token}`).maybeSingle(),
    supabase.from('trip_members').select('*').eq('trip_id', tripId).setHeader('Authorization', `Bearer ${token}`),
  ])
  if (!isCurrentIdentity(scope) || (tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch || (guard ? !guard() : false)) {
    return 'abandoned'
  }
  if (tripRes.error || memRes.error) {
    if (tripRes.error) console.error('[yatraflow] full trip read after join failed', tripRes.error)
    if (memRes.error) console.error('[yatraflow] member read after join failed', memRes.error)
    return 'failed'
  }
  if (!tripRes.data) return 'missing'
  return admitFullRow({
    requestedTripId: tripId,
    row: tripRes.data as TripRow,
    members: (memRes.data ?? []) as MemberRow[],
    scope,
    accessEpoch,
    guard,
  })
}

/**
 * #804 R2 — the ONE admission step for a full-row load.
 *
 * Both loaders use it: the join/hydrate path (`loadFullTripIntoCache`) and the
 * realtime own-echo path (`fetchTripIntoCache`). One implementation means the
 * checks cannot drift apart, which is what left the echo path caching invalid
 * revisions (round-8 B5).
 *
 * The decision is synchronous on purpose. Every guard is re-validated here, and
 * the cache swap plus the accepted-read ledger entry happen in one step with no
 * await and no notification between them. A refusal changes neither the cache
 * nor the ledger.
 *
 * `incomplete` is distinct from `stale`: the row itself carries no usable
 * revision, so nothing can be accepted even though the read succeeded.
 */
function admitFullRow(input: {
  /** The trip this read ASKED for. A response for another trip is never admissible. */
  requestedTripId: ID
  row: TripRow
  members: MemberRow[]
  scope: IdentityScope
  accessEpoch: number
  guard?: AttemptGuard
}): LoadOutcome {
  const { requestedTripId, row, scope, accessEpoch, guard } = input
  const members = input.members as unknown[]
  // B3 — provenance first, and against the REQUEST. A response whose rows agree
  // with each other but name another trip is not this read's answer.
  if (!row || typeof row !== 'object' || typeof row.id !== 'string'
    || row.id.toLowerCase() !== requestedTripId.toLowerCase()) return 'incomplete'
  const tripId = requestedTripId
  if (!isCurrentIdentity(scope) || (tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch || (guard ? !guard() : false)) return 'abandoned'
  if (row.deleted_at) return 'deleted'
  // B3 — a coherent full row, checked BEFORE any default applies. Presence alone
  // let an explicit undefined, a wrong type or a row missing its writable fields
  // through, and the serializer then filled them with empty values.
  if (!coherentFullRow(row, knownOptionalColumns())) return 'incomplete'
  // B3 — a membership answer is coherent for THIS trip, or the read is refused.
  if (!Array.isArray(members) || !members.every(m => coherentMemberRow(m) && String(m.trip_id) === String(tripId))) return 'incomplete'
  const mapped = (members as MemberRow[]).map(m => ({
    userId: m.user_id,
    role: m.role as TripMember['role'],
    joinedAt: m.joined_at,
  }))
  const mine = mapped.find(m => m.userId === scope.userId)
  // S1 — a validated owner_id grants authority without a redundant member row.
  if (!mine && !isAdminCached() && row.owner_id !== scope.userId) return 'not-member'
  // An observed downgrade blocks every ordinary read. Only a coherent row
  // inside this live join's expected window can confirm a replacement grant.
  const expectedGrant = mine && canEdit(mine.role) ? expectedJoin(tripId) : undefined
  if (mine && canEdit(mine.role) && tripAccessEpochs.has(roleFloorKey(tripId, scope.userId)) && !expectedGrant) return 'stale'
  if (isStaleServerRow(serverTripTimestamps.get(tripId), row.updated_at)) return 'stale'
  if (queuedLocalTrips.has(tripId)) return 'stale'
  const existing = tripById(tripId)
  if (existing) {
    const incoming = Number(row.write_version)
    const cached = existing.writeVersion
    if (validWriteVersion(cached) && incoming < cached) return 'stale'
    if (validWriteVersion(cached) && incoming === cached && existing.updatedAt > Number(row.updated_at)) return 'stale'
  }
  // The floor is cleared only after every row, membership, identity and
  // revision check succeeds for the expected join grant.
  if (expectedGrant) tripAccessEpochs.delete(roleFloorKey(tripId, scope.userId))
  const trip = rowToTrip(row, mapped)
  recordServerTripTimestamp(trip.id, trip.updatedAt)
  const idx = cache.trips.findIndex(t => t.id === trip.id)
  cache.trips = idx < 0
    ? [...cache.trips, trip]
    : [...cache.trips.slice(0, idx), trip, ...cache.trips.slice(idx + 1)]
  commit()
  return 'loaded'
}

/**
 * Whether this user already holds a membership row on the trip, and whether the
 * answer is CERTAIN.
 *
 * `false` with `certain: true` means the table answered "no such row". `false`
 * with `certain: false` means the read itself failed, so nothing is known. The
 * join path needs the difference: a failed read must not stop a user joining,
 * and answering "not a member" for a failed read is what produced a notice for a
 * member who was already on the trip.
 *
 * It reads only that user's own row, which the members read policy always
 * allows. It never reads the invite code.
 */
export async function membershipCertain(tripId: ID, userId: ID, token?: string): Promise<{ member: boolean; certain: boolean }> {
  if (tripById(tripId)?.members?.some(m => m.userId === userId)) return { member: true, certain: true }
  const query = supabase
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
  // C1 — a caller that captured a bearer pins it here too, so the membership
  // answer belongs to the account that asked rather than to whoever the SDK's
  // token lookup happens to return.
  const { data, error } = token
    ? await query.setHeader('Authorization', `Bearer ${token}`).maybeSingle()
    : await query.maybeSingle()
  if (error) {
    console.error('[yatraflow] membership check failed', error)
    return { member: false, certain: false }
  }
  return { member: !!data, certain: true }
}

/** True when this user already holds a membership row on the trip. */
export async function viewerIsMemberOf(tripId: ID, userId: ID): Promise<boolean> {
  return (await membershipCertain(tripId, userId)).member
}

/**
 * Remove a member, and put them back if the write is refused.
 *
 * #391 — the row was filtered out of the cache and the delete fired with no
 * error handling, so a refused delete looked like a successful one and the
 * member came back on the next hydrate with no message. The 7s `undoToast`
 * covers INTENT-regret ("I did not mean to"); this covers WRITE-FAILURE. They
 * are different failures and both paths are wanted — the undo restores through
 * `restoreMember`, and this restores the exact row the cache held, including
 * its `joinedAt`, so a failed delete does not quietly re-order the crew.
 */
export function removeMember(tripId: ID, userId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  const before = t.members ?? []
  const removed = before.find(m => m.userId === userId)
  if (!removed) return
  t.members = before.filter(m => m.userId !== userId)
  commit()
  // The rollback is the cache's OWN list, captured before the filter — not a
  // re-read of the server, which is exactly the thing that just refused us.
  const restore = () => {
    const current = cache.trips.find(x => x.id === tripId)
    if (!current) return
    if (current.members?.some(m => m.userId === userId)) return // already back
    current.members = [...(current.members ?? []), removed]
    commit()
  }
  void Promise.resolve(
    supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId),
  ).then(
    res => {
      if (!res?.error) return
      console.error('[yatraflow] trip_members write failed', res.error)
      restore()
      toast(`Couldn't remove that traveller — they're still on the trip. (${res.error.message ?? 'write refused'})`, 'err')
    },
    err => {
      console.error('[yatraflow] trip_members write rejected', err)
      restore()
      toast('Couldn’t remove that traveller — check your connection.', 'err')
    },
  )
}

export function userName(id: ID): string {
  return userById(id)?.profile.name ?? 'Traveller'
}

// ---------------- Stops ----------------

export function addStop(tripId: ID, dayIndex: number, stop: Omit<ItineraryStop, 'id' | 'orderInDay'>): ItineraryStop {
  const draft = mutateTrip(tripId, d => {
    const day = d.days.find(x => x.index === dayIndex)!
    const s: ItineraryStop = { ...stop, id: uid('st'), orderInDay: nextOrderInDay(day) }
    day.stops.push(s)
    renumberDay(day)
  }, { log: `added “${stop.title}”`, target: `Day ${dayIndex + 1}` })
  if (!draft) throw new Error(`addStop: trip ${tripId} not found`)
  // Persist the trip so the new stop survives a reload — the manual add flow
  // goes through updateTrip() → persistTripField(), but acceptSuggestionInto-
  // Timeline calls addStop() directly and used to drop the stop on refresh.
  void persistTripField(tripId, draft)
  const day = draft.days.find(x => x.index === dayIndex)!
  return day.stops[day.stops.length - 1]
}

export function updateStop(tripId: ID, stopId: ID, patchFields: Partial<ItineraryStop>): void {
  const t = tripById(tripId)
  if (!t) return
  const dayIdx = t.days.find(d => d.stops.some(x => x.id === stopId))?.index
  if (dayIdx === undefined) { commit(); return }
  const before = t.days.find(d => d.index === dayIdx)!.stops.find(x => x.id === stopId)!
  mutateTrip(tripId, draft => {
    const day = draft.days.find(d => d.index === dayIdx)!
    Object.assign(day.stops.find(x => x.id === stopId)!, patchFields)
  }, { log: `updated “${patchFields.title ?? before.title}”`, target: `Day ${dayIdx + 1}` })
  void persistTripField(tripId, tripById(tripId)!)
}

export function deleteStop(tripId: ID, stopId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  const dayIdx = t.days.find(d => d.stops.some(x => x.id === stopId))?.index
  if (dayIdx === undefined) { commit(); return }
  mutateTrip(tripId, draft => {
    const day = draft.days.find(d => d.index === dayIdx)!
    day.stops = day.stops.filter(x => x.id !== stopId)
    renumberDay(day)
  }, { log: `removed a stop`, target: `Day ${dayIdx + 1}` })
  void persistTripField(tripId, tripById(tripId)!)
}

/** Put a deleted stop back on its day at its old order — powers Undo. */
export function restoreStop(tripId: ID, stop: ItineraryStop, dayIndex: number): void {
  const trip = tripById(tripId)
  if (!trip) return
  const day = trip.days.find(d => d.index === dayIndex)
  if (!day || day.stops.some(s => s.id === stop.id)) return
  mutateTrip(tripId, draft => {
    const dDay = draft.days.find(d => d.index === dayIndex)!
    // Honour the documented "at its old order": insert BEFORE the first stop
    // whose order is >= the deleted stop's — deleteStop renumbered the
    // survivors, so the stop that inherited the deleted order must not claim
    // the slot (push+renumber would dump it at the day's end instead).
    const at = dDay.stops.findIndex(s => s.orderInDay >= stop.orderInDay)
    if (at === -1) dDay.stops.push(stop)
    else dDay.stops.splice(at, 0, stop)
    renumberDay(dDay)
  }, { log: `restored “${stop.title}”`, target: `Day ${dayIndex + 1}` })
  void persistTripField(tripId, tripById(tripId)!)
}

export function reorderStop(tripId: ID, dayIndex: number, fromIdx: number, toIdx: number): void {
  const trip = tripById(tripId)!
  const day = trip.days.find(d => d.index === dayIndex)
  if (!day) return
  const arr = [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
  // Guard out-of-range indices: an OOB splice would insert `undefined` into
  // day.stops, which later crashes simulateDay()/renders (bug #5).
  const len = arr.length
  if (len === 0) return
  const from = Math.max(0, Math.min(fromIdx, len - 1))
  const to = Math.max(0, Math.min(toIdx, len))
  if (from === to) return
  mutateTrip(tripId, draft => {
    const dDay = draft.days.find(d => d.index === dayIndex)!
    const dArr = [...dDay.stops].sort((a, b) => a.orderInDay - b.orderInDay)
    const [moved] = dArr.splice(from, 1)
    if (!moved) return
    dArr.splice(to, 0, moved)
    dArr.forEach((s, i) => { s.orderInDay = i + 1 })
    dDay.stops = dArr
  }, { log: `reordered Day ${dayIndex + 1}`, target: 'Timeline' })
  void persistTripField(tripId, tripById(tripId)!)
}

export function moveStopBetweenDays(tripId: ID, stopId: ID, toDayIndex: number, position?: number): void {
  const trip = tripById(tripId)!
  const fromDay = trip.days.find(d => d.stops.some(s => s.id === stopId))
  if (!fromDay) { commit(); void persistTripField(tripId, trip); return }
  const moved = fromDay.stops.find(s => s.id === stopId)!
  const target = trip.days.find(d => d.index === toDayIndex)
  // Unknown target day — the stop goes back where it came from, untouched and
  // unlogged (matching the old early-return semantics).
  const opts = target
    ? { log: `moved “${moved.title}” to Day ${toDayIndex + 1}`, target: 'Timeline' }
    : { touch: false }
  mutateTrip(tripId, draft => {
    let movedDraft: ItineraryStop | undefined
    let fromDraft: ItineraryDay | undefined
    for (const day of draft.days) {
      const idx = day.stops.findIndex(s => s.id === stopId)
      if (idx >= 0) { [movedDraft] = day.stops.splice(idx, 1); renumberDay(day); fromDraft = day; break }
    }
    const dTarget = draft.days.find(d => d.index === toDayIndex)
    if (movedDraft && dTarget) {
      // Same-day or cross-day: insert at the requested position (clamped), defaulting
      // to the end of the target day so no stop is ever dropped or silently reordered.
      const at = Math.max(0, Math.min(position ?? dTarget.stops.length, dTarget.stops.length))
      movedDraft.orderInDay = at + 1
      dTarget.stops.splice(at, 0, movedDraft)
      renumberDay(dTarget)
    } else if (movedDraft && fromDraft) {
      fromDraft.stops.push(movedDraft)
      renumberDay(fromDraft)
    }
  }, opts)
  // Write through like every sibling mutator (reorderStop, setStopStatus) —
  // the mutateTrip cache edit alone vanished on the next reload (B0).
  void persistTripField(tripId, tripById(tripId)!)
}

export function setStopStatus(tripId: ID, status: ItineraryStop['status'], stopId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  const dayIdx = t.days.find(d => d.stops.some(x => x.id === stopId))?.index
  if (dayIdx === undefined) { commit(); return }
  const before = t.days.find(d => d.index === dayIdx)!.stops.find(x => x.id === stopId)!
  mutateTrip(tripId, draft => {
    const day = draft.days.find(d => d.index === dayIdx)!
    const s = day.stops.find(x => x.id === stopId)!
    s.status = status
  }, { log: `marked “${before.title}” as ${status}`, target: `Day ${dayIdx + 1}` })
  // Persist the POST-mutation cache reference. The old pre-mutation snapshot
  // was only ever safe while the flush re-read the cache at fire time; since
  // B0 the coalescer persists the call-time snapshot verbatim, so a stale
  // reference here wrote the trip WITHOUT the new status (the flip reverted
  // on the next hydration or collaborator sync).
  void persistTripField(tripId, tripById(tripId)!)
}

// The per-day 1..n invariant lives in lib/stopOrder (renumberDay) so every
// writer — the store's stop mutators, the Timeline's handlers, the Map's fill —
// shares one implementation of the numbering the spec pins (#337).

// ---------------- Expenses ----------------

export function addExpense(tripId: ID, e: Omit<Expense, 'id'>): void {
  const t = tripById(tripId)
  if (!t) return
  // #382: the writer refuses what the form refuses. An amount that is not a
  // finite number of rupees above zero poisons every figure the Budget tab
  // shows, and the row is durable — one bad line survives reloads and syncs.
  const v = amountVerdict(e.amountInr)
  if (!v.ok) { toast(amountRefusal(e.amountInr)!, 'err'); return }
  mutateTrip(tripId, draft => { draft.expenses.push({ optional: false, ...e, id: uid('ex') }) }, { touch: false })
  void persistTripField(tripId, tripById(tripId)!)
}

export function deleteExpense(tripId: ID, expenseId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  mutateTrip(tripId, draft => { draft.expenses = draft.expenses.filter(x => x.id !== expenseId) }, { touch: false })
  void persistTripField(tripId, tripById(tripId)!)
}

/** What `updateExpense` did, so a caller can speak the truth instead of
 *  announcing a save it never made (#829).
 *
 *  It used to return `void`, and the Budget tab's editor announced "Expense
 *  updated" and closed no matter what — including on the two paths below that
 *  write nothing. The row then re-rendered from the store with the OLD figure,
 *  which is what "the amount got permanent but the tab shows old data" was. */
export type ExpenseWriteOutcome = 'applied' | 'refused' | 'no-such-line'

/** Edit an expense line in place — the Budget tab's pencil affordance — instead
 *  of the old delete-and-retype dance. */
export function updateExpense(tripId: ID, expenseId: ID, patch: Partial<Omit<Expense, 'id'>>): ExpenseWriteOutcome {
  const t = tripById(tripId)
  if (!t || !t.expenses.some(x => x.id === expenseId)) return 'no-such-line'
  // #382: an edit is a write too — the pencil affordance used to put any
  // number on the row it was handed. A patch that does not carry an amount
  // changes nothing about the line's money and passes through untouched.
  if (patch.amountInr !== undefined) {
    const v = amountVerdict(patch.amountInr)
    if (!v.ok) { toast(amountRefusal(patch.amountInr)!, 'err'); return 'refused' }
  }
  mutateTrip(tripId, draft => {
    draft.expenses = draft.expenses.map(x => x.id === expenseId ? { ...x, ...patch } : x)
  }, { touch: false })
  void persistTripField(tripId, tripById(tripId)!)
  return 'applied'
}

/** M6 B4 — mark an expense line settled ("this one's sorted, stop counting
 *  it"). Records who + when for the activity entry and the balances card.
 *  Crew members with an editor role; viewer/commenter roles get a silent
 *  no-op here, mirroring the rest of the mutation surface's gating.
 *
 *  #384: the no-op above was a comment with no code behind it for months —
 *  the check now exists, and it is the house rule the rest of the mutation
 *  surface speaks: `canEdit(roleOf(trip, by))` — owner/editor only, the same
 *  verdict the trips UPDATE RLS policy (`is_editor`) enforces server-side, so
 *  the client never promises what the DB refuses. A null `by` is a null role,
 *  so a session-less caller is refused by the same gate. */
export function markExpenseSettled(tripId: ID, expenseId: ID, by: ID): void {
  const t = tripById(tripId)
  if (!t || !t.expenses.some(x => x.id === expenseId)) return
  if (!canEdit(roleOf(t, by))) return
  const expense = t.expenses.find(x => x.id === expenseId)
  if (!expense || expense.settled) return
  const label = expense.label
  mutateTrip(tripId, draft => {
    draft.expenses = draft.expenses.map(x => x.id === expenseId ? { ...x, settled: { by, at: Date.now() } } : x)
  }, { log: `marked “${label}” settled`, target: 'Budget' })
  void persistTripField(tripId, tripById(tripId)!)
}

/** M6 B4 — the undo: reopen a settled line. #384: the same owner/editor gate
 *  as the settle it undoes — a reopen is a write, and `by` is required so a
 *  session-less caller is refused rather than silently reopening the ledger. */
export function markExpenseUnsettled(tripId: ID, expenseId: ID, by: ID | null): void {
  const t = tripById(tripId)
  if (!t) return
  if (!canEdit(roleOf(t, by))) return
  const expense = t.expenses.find(x => x.id === expenseId)
  if (!expense?.settled) return
  const label = expense.label
  mutateTrip(tripId, draft => {
    draft.expenses = draft.expenses.map(x => {
      if (x.id !== expenseId) return x
      const { settled: _drop, ...rest } = x
      return rest
    })
  }, { log: `reopened “${label}”`, target: 'Budget' })
  void persistTripField(tripId, tripById(tripId)!)
}

// ---------------- Contribution command helpers (stage A of #832) ----------------
//
// Shared machinery for the writers that submit through the collab-command RPC
// (docs/agents/collab-command-contract.md). The contract rules live here so
// no writer can forget them:
//
//   1. A receipt is applied only under the identity that submitted the
//      command. Every continuation captures identityScope() before its first
//      await and checks isCurrentIdentity before it touches the cache, so a
//      late receipt after sign-out or A→B→A never enters the next identity's
//      cache.
//   2. Freshness is PER ROW, for receipts AND for recovery reads. A writer
//      captures the cached row object after its optimistic update; on the
//      receipt it adopts the canonical row only if that object is still the
//      current one, and a recovery SELECT captures the row object again
//      before it starts and applies only if it is unchanged on arrival
//      (gate round 2, F3).
//   3. A refused command retracts ONLY what that operation added, from
//      whatever state the cache holds now (gate round 2, F1): a whole-slice
//      restore erased comments, activity and notifications that landed after
//      the failed operation started.
//   4. One logical action keeps ONE identity across uncertain failures
//      (gate round 2, F2): the command id, stable comment id and payload sit
//      in a pending envelope and the writer's next call for the same slot
//      retries it, so a committed command whose response was lost cannot
//      duplicate itself.

type ContributionKind = 'suggestion' | 'decision'

/** Acknowledge a receipt's tripRevision. It is NOT a trip snapshot and MUST
 *  NOT advance the client's CAS revision while an older snapshot is held
 *  (contract rule 1). It only schedules a background refetch when the server
 *  observed a revision NEWER than the cached row; pending trip edits stay
 *  queued and are rebased by the normal admission path. */
function noteTripRevision(tripId: ID, revision: number): void {
  const t = tripById(tripId)
  if (!t || !validWriteVersion(revision)) return
  // Reconcile only against a KNOWN cached revision: without one there is no
  // honest comparison, and a background refetch per receipt would be noise.
  // A known-but-older revision means the server has moved on — the refetch
  // brings the authoritative trip home through the normal admission path.
  if (!validWriteVersion(t.writeVersion) || t.writeVersion >= revision) return
  fetchTripIntoCache(tripId).catch(e => console.error('[yatraflow] trip refetch after receipt failed', e))
}

// ---- The pending-action envelope (gate round 2, F2) ----
//
// One uncertain command per logical slot keeps its identity. The envelope is
// IMMUTABLE once created: command id, stable comment id and payload never
// change, so a retry replays the same bytes. The writer's next call for the
// same slot (same identity epoch, user, command kind, trip, row and logical
// fingerprint) is the retry; a DIFFERENT fingerprint is a new intentional
// action with new ids — the client never deduplicates against server text.

type PendingCollabAction = {
  commandId: string
  command: CollabCommand
}

const pendingCollabActions = new Map<string, PendingCollabAction>()

function collabKey(
  scope: IdentityScope,
  tripId: ID,
  type: CollabCommand['type'],
  rowKey: string,
  fingerprint: string | null,
): string | null {
  if (fingerprint === null) return null
  // creates keep '' — the entity id lives IN the envelope; the slot is the
  // trip. activity.append never reaches here (no fingerprint).
  return `${scope.epoch}:${scope.userId}:${type}:${tripId}:${rowKey}:${fingerprint}`
}

/** Claim the envelope for this logical slot. `key` names the slot (null = no
 *  retry gesture); `mint` builds the real command when a fresh envelope is
 *  needed. On a retry the STORED command comes back untouched — ids and
 *  payload from the first try. */
function claimEnvelope(
  scope: IdentityScope,
  tripId: ID,
  key: string | null,
  mint: () => CollabCommand,
): { command: CollabCommand; commandId: string; pendingKey: string | null; isRetry: boolean } {
  if (key === null) {
    return { command: mint(), commandId: uuid(), pendingKey: null, isRetry: false }
  }
  const existing = pendingCollabActions.get(key)
  if (existing) return { command: existing.command, commandId: existing.commandId, pendingKey: key, isRetry: true }
  const command = mint()
  const commandId = uuid()
  pendingCollabActions.set(key, { commandId, command })
  return { command, commandId, pendingKey: key, isRetry: false }
}

function settlePendingCollab(pendingKey: string | null): void {
  if (pendingKey) pendingCollabActions.delete(pendingKey)
}

// ---- In-flight comment drafts (gate round 2 F4, rounds 3-5 C1) ----
//
// The cache copy of a comment that has no receipt yet. Every comment action
// registers its draft at DISPATCH — in flight or refused by a conflict — and
// retires it when the action settles. The pending envelope and the form text
// own the ACTION; this overlay owns the CACHE COPY: a canonical replacement
// (receipt adoption, recovery read, realtime UPDATE) re-attaches the draft,
// because the server has not committed it yet. The owner is the ACTION (its
// command id), so another action settling on the same row retires only its
// own overlay.

const commentDrafts = new Map<string, Comment>() // `${kind}:${rowId}:${commandId}`

function draftKey(kind: ContributionKind, rowId: ID, commandId: string): string {
  return `${kind}:${rowId}:${commandId}`
}

/** Every draft an unsettled comment action owns on this row, oldest first. */
function commentDraftsFor(kind: ContributionKind, rowId: ID): Array<{ key: string; draft: Comment }> {
  const prefix = `${kind}:${rowId}:`
  const found: Array<{ key: string; draft: Comment }> = []
  for (const entry of commentDrafts) {
    if (entry[0].startsWith(prefix)) found.push({ key: entry[0], draft: entry[1] })
  }
  return found
}

/** Re-attach every in-flight draft after a canonical row replacement. When
 *  the canonical row already carries a draft's comment, the server has
 *  committed that action — its overlay retires; the others stay owned. */
function reattachCommentDrafts(kind: ContributionKind, rowId: ID): void {
  for (const { key, draft } of commentDraftsFor(kind, rowId)) {
    if (kind === 'suggestion') {
      const cur = cache.suggestions.find(x => x.id === rowId)
      if (!cur) return
      if (cur.comments.some(c => c.id === draft.id)) { commentDrafts.delete(key); continue }
      cache.suggestions = cache.suggestions.map(x => x.id === rowId ? { ...x, comments: [...x.comments, draft] } : x)
    } else {
      const cur = cache.decisions.find(x => x.id === rowId)
      if (!cur) return
      if (cur.comments.some(c => c.id === draft.id)) { commentDrafts.delete(key); continue }
      cache.decisions = cache.decisions.map(x => x.id === rowId ? { ...x, comments: [...x.comments, draft] } : x)
    }
  }
}

// ---- Actor-ballot operation ownership (gate rounds 3-5, R2) ----
//
// The LAST ballot operation an actor performs on a row owns that actor's
// optimistic entry, independently of row object identity: a concurrent
// comment's optimistic clone inherits the entry (so object identity cannot
// see it), and a canonical replacement must never be clobbered.
//
// The record also carries the actor's CONFIRMED ballot — the last value a
// server row showed. A claim chains it from the previous in-flight owner, so
// an optimistic vote another operation left behind is never mistaken for a
// confirmed one (gate round 5, P1): when a chain of ballots all fails, the
// rollback restores the confirmed baseline, not an uncommitted prior. A
// refused operation retracts its entry only while it still owns it; a later
// intentional ballot supersedes by claiming a new token.

type SuggestionBallotOwnership = {
  key: string
  rowId: ID
  userId: ID
  token: string
  applied: { value: 1 | -1 | null; createdAt: number }
  confirmed: Vote | undefined
}

type DecisionBallotOwnership = {
  key: string
  rowId: ID
  userId: ID
  token: string
  applied: { optionId: string | null }
  confirmed: string | undefined
}

const suggestionBallotOwners = new Map<string, SuggestionBallotOwnership>()
const decisionBallotOwners = new Map<string, DecisionBallotOwnership>()

function claimSuggestionBallot(
  suggestionId: ID,
  userId: ID,
  applied: { value: 1 | -1 | null; createdAt: number },
  confirmed: Vote | undefined,
): { key: string; token: string; userId: ID } {
  const key = `${suggestionId}:${userId}`
  const token = uuid()
  suggestionBallotOwners.set(key, { key, rowId: suggestionId, userId, token, applied, confirmed })
  return { key, token, userId }
}

function claimDecisionBallot(
  decisionId: ID,
  userId: ID,
  applied: { optionId: string | null },
  confirmed: string | undefined,
): { key: string; token: string; userId: ID } {
  const key = `${decisionId}:${userId}`
  const token = uuid()
  decisionBallotOwners.set(key, { key, rowId: decisionId, userId, token, applied, confirmed })
  return { key, token, userId }
}

/** A canonical row replaced the cached one: the actor's ballot it shows is
 *  the new confirmed baseline for every in-flight ballot operation on that
 *  row, so an echo landing mid-flight keeps the rollback target honest. */
function noteConfirmedBallots(kind: ContributionKind, row: StopSuggestion | TripDecision): void {
  const owners = kind === 'suggestion' ? suggestionBallotOwners : decisionBallotOwners
  for (const rec of owners.values()) {
    if (rec.rowId !== row.id) continue
    if (kind === 'suggestion') {
      const entry = (row as StopSuggestion).votes.find(v => v.userId === rec.userId)
      rec.confirmed = entry ? { ...entry } : undefined
    } else {
      const entry = (row as TripDecision).votesByUserId[rec.userId]
      rec.confirmed = typeof entry === 'string' ? entry : undefined
    }
  }
}

/** Release the ownership record when the action settles (any receipt except
 *  conflict — a conflict's unresolved ballot stays owned until a later
 *  ballot supersedes it). */
function releaseBallotOwnership(ownership: { key: string; token: string } | undefined): void {
  if (!ownership) return
  const rec = suggestionBallotOwners.get(ownership.key)
  if (rec && rec.token === ownership.token) { suggestionBallotOwners.delete(ownership.key); return }
  const dec = decisionBallotOwners.get(ownership.key)
  if (dec && dec.token === ownership.token) decisionBallotOwners.delete(ownership.key)
}

/** Retract the owned ghost ballot from the CURRENT row and restore the
 *  actor's CONFIRMED baseline. Answers the next row state, or undefined when
 *  this operation does not own the entry any more. With `force` (the row is
 *  this operation's own optimistic base) the ghost check is skipped: the
 *  actor's entry there is this op's ghost, a superseded op's ghost, or the
 *  baseline itself — the baseline is correct for all three. Without `force`
 *  (the row moved on) a canonical or later value is left alone. */
function retractSuggestionBallotFromRow(
  ownership: { key: string; token: string; userId: ID },
  row: StopSuggestion,
  opts?: { force?: boolean },
): StopSuggestion | undefined {
  const rec = suggestionBallotOwners.get(ownership.key)
  if (!rec || rec.token !== ownership.token) return undefined
  suggestionBallotOwners.delete(ownership.key)
  const entry = row.votes.find(v => v.userId === ownership.userId)
  if (!opts?.force) {
    const ghost = rec.applied.value === null
      ? !entry // the removal itself was the optimistic change
      : !!entry && entry.value === rec.applied.value && entry.createdAt === rec.applied.createdAt
    if (!ghost) return undefined
  }
  // The baseline may be REPLACED in the current row (a value change) or
  // ABSENT from it (a removal whose absence the clone chain carried): the
  // restore handles both, or a refused removal would leave nothing to
  // restore and the actor's real vote would stay lost (gate round 4, R2).
  if (!rec.confirmed) return { ...row, votes: row.votes.filter(v => v.userId !== ownership.userId) }
  return row.votes.some(v => v.userId === ownership.userId)
    ? { ...row, votes: row.votes.map(v => v.userId === ownership.userId ? { ...v, value: rec.confirmed!.value, createdAt: rec.confirmed!.createdAt } : v) }
    : { ...row, votes: [...row.votes, { ...rec.confirmed }] }
}

function retractDecisionBallotFromRow(
  ownership: { key: string; token: string; userId: ID },
  row: TripDecision,
  opts?: { force?: boolean },
): TripDecision | undefined {
  const rec = decisionBallotOwners.get(ownership.key)
  if (!rec || rec.token !== ownership.token) return undefined
  decisionBallotOwners.delete(ownership.key)
  const entry = row.votesByUserId[ownership.userId]
  if (!opts?.force) {
    const ghost = rec.applied.optionId === null
      ? entry === undefined
      : entry === rec.applied.optionId
    if (!ghost) return undefined
  }
  const votes = { ...row.votesByUserId }
  if (rec.confirmed === undefined) delete votes[ownership.userId]
  else votes[ownership.userId] = rec.confirmed
  return { ...row, votesByUserId: votes }
}

/** Swap the optimistic activity entry for the canonical one the receipt
 *  names, so the realtime echo upserts the SAME row instead of duplicating
 *  it. A twin (a retry's earlier copy already re-keyed) is dropped first.
 *
 *  Notifications arrive as ids with NO recipient-order guarantee (the
 *  server's member SELECT has no ORDER BY), so a positional mapping is never
 *  inferred. A single-notification receipt is unambiguous and re-keys its
 *  optimistic entry; any other count drops the optimistic copies and lets
 *  the realtime echo or the next hydrate bring the server's rows. */
function reconcileArtifacts(
  activityId: string | undefined,
  notificationIds: string[] | undefined,
  localActivityId: string,
  localNotificationIds: string[],
): void {
  let activity = cache.activity
  let notifications = cache.notifications
  let changed = false
  if (localActivityId) {
    if (activityId) {
      const twinExists = activity.some(a => a.id === activityId && a.id !== localActivityId)
      activity = twinExists
        ? activity.filter(a => a.id !== localActivityId)
        : activity.map(a => a.id === localActivityId ? { ...a, id: activityId } : a)
    } else {
      activity = activity.filter(a => a.id !== localActivityId)
    }
    changed = true
  }
  if (localNotificationIds.length) {
    const canRename = notificationIds?.length === 1 && localNotificationIds.length === 1
    if (canRename) {
      const canonicalId = notificationIds[0]
      const twinExists = notifications.some(n => n.id === canonicalId && n.id !== localNotificationIds[0])
      notifications = twinExists
        ? notifications.filter(n => n.id !== localNotificationIds[0])
        : notifications.map(n => n.id === localNotificationIds[0] ? { ...n, id: canonicalId } : n)
    } else {
      const drop = new Set(localNotificationIds)
      notifications = notifications.filter(n => !drop.has(n.id))
    }
    changed = true
  }
  if (changed) { cache.activity = activity; cache.notifications = notifications; commit() }
}

/** Remove the optimistic activity/notification entries a refused command
 *  created (the server created none). Id-scoped by design: entries that other
 *  operations added after this one started are never touched. */
function dropArtifacts(localActivityId: string, localNotificationIds: string[]): void {
  if (!localActivityId && localNotificationIds.length === 0) return
  const drop = new Set(localNotificationIds)
  cache.activity = cache.activity.filter(a => a.id !== localActivityId)
  cache.notifications = cache.notifications.filter(n => !drop.has(n.id))
  commit()
}

/** Surgical rollback of ONE refused contribution (gate round 2, F1). Retracts
 *  only what this operation added, from the CURRENT cache state:
 *
 *  - the row: put the exact pre-command row back while nobody replaced it
 *    (object identity); once the row moved on — a peer command cloned it, a
 *    receipt adopted it, realtime landed — retract by id instead (comments),
 *    or leave the newer state alone (ballots: one entry per actor makes a
 *    ghost self-correct on the actor's next ballot; creates: the optimistic
 *    row is only removed while it is still ours).
 *  - artifacts: always id-scoped.
 *
 *  A whole-slice restore here is what erased later successful comments,
 *  activity and notifications in the round-2 probes. */
function rollbackContribution(args: {
  rowKind?: ContributionKind
  rowId?: ID
  rowBefore?: unknown
  rowRef?: unknown
  commentId?: string
  ballotOwnership?: { key: string; token: string; userId: ID }
  localActivityId?: string
  localNotificationIds?: string[]
}): void {
  const localNotificationIds = args.localNotificationIds ?? []
  let changed = false
  if (args.rowKind && args.rowId) {
    if (args.rowKind === 'suggestion') {
      const cur = cache.suggestions.find(x => x.id === args.rowId)
      if (cur && cur === args.rowRef) {
        cache.suggestions = args.rowBefore !== undefined
          ? cache.suggestions.map(x => x.id === args.rowId ? args.rowBefore as StopSuggestion : x)
          : cache.suggestions.filter(x => x.id !== args.rowId)
        // The restored base can carry an UNCOMMITTED ballot an earlier
        // in-flight operation left behind (gate round 5, P1): force the
        // actor's vote to the confirmed baseline while this op owns it.
        if (args.ballotOwnership && args.rowBefore !== undefined) {
          const repaired = retractSuggestionBallotFromRow(args.ballotOwnership, args.rowBefore as StopSuggestion, { force: true })
          if (repaired) cache.suggestions = cache.suggestions.map(x => x.id === args.rowId ? repaired : x)
        }
        changed = true
        releaseBallotOwnership(args.ballotOwnership)
      } else if (cur) {
        // The row moved on (a peer command cloned it, a receipt adopted it,
        // realtime landed): retract by id, preserving everything that is not
        // ours — including later comments and later intentional ballots.
        let next = cur
        if (args.commentId && next.comments.some(c => c.id === args.commentId)) {
          next = { ...next, comments: next.comments.filter(c => c.id !== args.commentId) }
        }
        if (args.ballotOwnership) {
          const retracted = retractSuggestionBallotFromRow(args.ballotOwnership, next)
          if (retracted) next = retracted
        }
        if (next !== cur) {
          cache.suggestions = cache.suggestions.map(x => x.id === args.rowId ? next : x)
          changed = true
        }
      }
    } else {
      const cur = cache.decisions.find(x => x.id === args.rowId)
      if (cur && cur === args.rowRef) {
        cache.decisions = args.rowBefore !== undefined
          ? cache.decisions.map(x => x.id === args.rowId ? args.rowBefore as TripDecision : x)
          : cache.decisions.filter(x => x.id !== args.rowId)
        if (args.ballotOwnership && args.rowBefore !== undefined) {
          const repaired = retractDecisionBallotFromRow(args.ballotOwnership, args.rowBefore as TripDecision, { force: true })
          if (repaired) cache.decisions = cache.decisions.map(x => x.id === args.rowId ? repaired : x)
        }
        changed = true
        releaseBallotOwnership(args.ballotOwnership)
      } else if (cur) {
        let next = cur
        if (args.commentId && next.comments.some(c => c.id === args.commentId)) {
          next = { ...next, comments: next.comments.filter(c => c.id !== args.commentId) }
        }
        if (args.ballotOwnership) {
          const retracted = retractDecisionBallotFromRow(args.ballotOwnership, next)
          if (retracted) next = retracted
        }
        if (next !== cur) {
          cache.decisions = cache.decisions.map(x => x.id === args.rowId ? next : x)
          changed = true
        }
      }
    }
  } else {
    releaseBallotOwnership(args.ballotOwnership)
  }
  const hadArtifacts = !!args.localActivityId || localNotificationIds.length > 0
  const activityCount = cache.activity.length
  const notificationCount = cache.notifications.length
  dropArtifacts(args.localActivityId ?? '', localNotificationIds)
  if (changed || cache.activity.length !== activityCount || cache.notifications.length !== notificationCount || hadArtifacts) {
    commit()
  }
}

/** Re-read ONE suggestion/decision row into the cache — the freshness
 *  recovery when a receipt's row is stale, or the authoritative read a
 *  conflict starts. Bound to the identity that asked, and FENCED by the row's
 *  own generation (gate round 2, F3): the row object is captured BEFORE the
 *  read and the result applies only if it is still current on arrival, so a
 *  delayed snapshot cannot overwrite a newer canonical row. Unresolved draft
 *  comments (a conflict's preserved input, one per owning action) are
 *  re-attached to the authoritative row, because the server has not committed
 *  them yet. */
async function refetchContributionRow(
  kind: ContributionKind,
  rowId: ID,
  scope: IdentityScope,
): Promise<void> {
  try {
    const table = kind === 'suggestion' ? 'suggestions' : 'decisions'
    const before = kind === 'suggestion'
      ? cache.suggestions.find(x => x.id === rowId)
      : cache.decisions.find(x => x.id === rowId)
    const { data, error } = await supabase.from(table).select('*').eq('id', rowId).maybeSingle()
    if (error || !data || !isCurrentIdentity(scope)) return
    const current = kind === 'suggestion'
      ? cache.suggestions.find(x => x.id === rowId)
      : cache.decisions.find(x => x.id === rowId)
    // The row moved on between dispatch and arrival: the snapshot is stale —
    // discard it (a later event or receipt brings the truth) rather than
    // regress the cache.
    if (current !== before) return
    if (kind === 'suggestion') {
      const mapped = suggestionRowToEntry(data)
      cache.suggestions = cache.suggestions.some(x => x.id === rowId)
        ? cache.suggestions.map(x => x.id === rowId ? mapped : x)
        : [...cache.suggestions, mapped]
      noteConfirmedBallots('suggestion', mapped)
    } else {
      const mapped = decisionRowToEntry(data)
      cache.decisions = cache.decisions.some(x => x.id === rowId)
        ? cache.decisions.map(x => x.id === rowId ? mapped : x)
        : [...cache.decisions, mapped]
      noteConfirmedBallots('decision', mapped)
    }
    reattachCommentDrafts(kind, rowId)
    commit()
  } catch (e) {
    console.error(`[yatraflow] ${kind} row refetch failed`, e)
  }
}

/** Submit one contribution command and settle its receipt against the cache.
 *  Every RPC-backed writer funnels through this, so the identity, freshness,
 *  envelope, rollback and conflict rules cannot drift apart between them. */
async function runContributionCommand(args: {
  scope: IdentityScope
  tripId: ID
  commandId: string
  command: CollabCommand
  pendingKey: string | null
  rowKind: ContributionKind
  rowId: ID
  rowBefore?: unknown
  rowRef?: unknown
  commentId?: string
  ballotOwnership?: { key: string; token: string; userId: ID }
  localActivityId: string
  localNotificationIds: string[]
}): Promise<CollabOutcome> {
  const receipt = await submitCollabCommand(args.commandId, args.tripId, args.command)
  // Identity binding first: a receipt that lands after sign-out or an
  // account switch writes — and rolls back — NOTHING. A restore here would
  // put the previous identity's slices into the next identity's cache, the
  // #45 leak all over again. (The envelope map is cleared on the identity
  // change itself.)
  if (!isCurrentIdentity(args.scope)) return receipt
  if (receipt.status === 'applied' || receipt.status === 'alreadyApplied') {
    const stillCurrent = args.rowKind === 'suggestion'
      ? cache.suggestions.find(x => x.id === args.rowId)
      : cache.decisions.find(x => x.id === args.rowId)
    if (stillCurrent !== args.rowRef) {
      // Per-row freshness: the row moved on (realtime, a peer command, or one
      // of our own later commands). Discard the receipt row and refetch that
      // row; it already carries every contribution.
      void refetchContributionRow(args.rowKind, args.rowId, args.scope)
    } else if (args.rowKind === 'suggestion') {
      if (receipt.suggestion) {
        cache.suggestions = cache.suggestions.map(x => x.id === args.rowId ? receipt.suggestion! : x)
        noteConfirmedBallots(args.rowKind, receipt.suggestion)
        reattachCommentDrafts(args.rowKind, args.rowId)
        commit()
      }
    } else if (receipt.decision) {
      cache.decisions = cache.decisions.map(x => x.id === args.rowId ? receipt.decision! : x)
      noteConfirmedBallots(args.rowKind, receipt.decision)
      reattachCommentDrafts(args.rowKind, args.rowId)
      commit()
    }
    // applied and alreadyApplied both carry the stored receipt's artifact ids
    // (contract answer): re-key this try's optimistic copies onto them.
    reconcileArtifacts(receipt.activityId, receipt.notificationIds, args.localActivityId, args.localNotificationIds)
    noteTripRevision(args.tripId, receipt.tripRevision)
    // The action settled: the next call for this slot is a NEW intentional
    // action with fresh ids, and the optimistic ballot is server-backed now.
    settlePendingCollab(args.pendingKey)
    releaseBallotOwnership(args.ballotOwnership)
    // Only THIS action's overlay retires (gate round 4, C1): a comment still
    // in flight or unresolved keeps its owner until ITS action settles.
    commentDrafts.delete(draftKey(args.rowKind, args.rowId, args.commandId))
    return receipt
  }
  if (receipt.status === 'conflict') {
    // Keep the optimistic local work — the planner's comment or ballot stays
    // on screen; dropping it silently is the exact defect this stage repairs.
    // The side artifacts go (the server created none for a command it
    // refused). The envelope STAYS pending: the action is unresolved, and the
    // caller's retry path reuses it. The comment's dispatch-time draft keeps
    // owning the cache copy (gate round 5, P2).
    dropArtifacts(args.localActivityId, args.localNotificationIds)
    // Start the authoritative reconciliation the feedback promises: a fenced
    // read of the contribution row (re-attaching every in-flight draft) and
    // the acknowledged trip revision — which never advances the client CAS.
    void refetchContributionRow(args.rowKind, args.rowId, args.scope)
    noteTripRevision(args.tripId, receipt.tripRevision)
    return receipt
  }
  if (receipt.status === 'forbidden' || receipt.status === 'invalid') {
    // A final refusal settles the action: retract only this operation's
    // entries, and let the next call be a new action.
    rollbackContribution({
      rowKind: args.rowKind, rowId: args.rowId, rowBefore: args.rowBefore, rowRef: args.rowRef,
      commentId: args.commentId, ballotOwnership: args.ballotOwnership,
      localActivityId: args.localActivityId, localNotificationIds: args.localNotificationIds,
    })
    settlePendingCollab(args.pendingKey)
    releaseBallotOwnership(args.ballotOwnership)
    commentDrafts.delete(draftKey(args.rowKind, args.rowId, args.commandId))
    return receipt
  }
  // unavailable: the command MAY have committed (a lost response). Retract
  // the optimistic entries — nothing was confirmed — and KEEP the envelope:
  // the writer's next call for this slot retries the same identity, which is
  // what makes the retry idempotent. The ballot retraction reclaims the
  // actor's ghost entry, so a retried vote is derived as a SET again and
  // cannot become a removal (gate round 3, R2). The draft overlay retires
  // with the rollback: nothing visible owns a cache copy any more, and a
  // retried comment re-records it.
  rollbackContribution({
    rowKind: args.rowKind, rowId: args.rowId, rowBefore: args.rowBefore, rowRef: args.rowRef,
    commentId: args.commentId, ballotOwnership: args.ballotOwnership,
    localActivityId: args.localActivityId, localNotificationIds: args.localNotificationIds,
  })
  releaseBallotOwnership(args.ballotOwnership)
  commentDrafts.delete(draftKey(args.rowKind, args.rowId, args.commandId))
  return receipt
}

// ---------------- Suggestions / votes / comments ----------------

export function addSuggestion(
  tripId: ID,
  s: Omit<StopSuggestion, 'id' | 'proposedBy' | 'votes' | 'comments' | 'status' | 'createdAt' | 'tripId'>,
): Promise<CollabOutcome> {
  const scope = identityScope()
  // The server derives the actor from auth.uid(); a signed-out caller has no
  // actor, so there is nothing to submit. The caller's proposedBy parameter
  // is GONE — the actor never travels in the payload (#801).
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  if (!s.title.trim()) return Promise.resolve({ status: 'invalid', reason: 'empty title' })
  // The envelope (F2) owns the entity id: a retry of an uncertain create
  // reuses the FIRST try's id, so the server row id is stable. The
  // fingerprint is the id-free payload — the suggestion carries no
  // client-minted ids.
  const suggestion = {
    dayIndex: s.dayIndex,
    ...(s.dayId ? { dayId: s.dayId } : {}),
    ...(s.place ? { place: s.place } : {}),
    title: s.title, category: s.category, locationName: s.locationName,
    lat: s.lat, lng: s.lng, description: s.description, visitMinutes: s.visitMinutes,
    estimatedEntryFeeInr: s.estimatedEntryFeeInr, estimatedTransportInr: s.estimatedTransportInr,
  }
  const claimed = claimEnvelope(scope, tripId,
    collabKey(scope, tripId, 'suggestion.create', '', `c:${JSON.stringify(suggestion)}`),
    () => ({ type: 'suggestion.create', suggestionId: uuid(), suggestion }))
  const command = claimed.command
  if (command.type !== 'suggestion.create') return Promise.resolve({ status: 'unavailable' })
  const id = command.suggestionId
  // Client generates the UUID so the cache and the DB row agree on the id
  // (a server-generated default would diverge after the next hydration).
  cache.suggestions = [...cache.suggestions, {
    ...s, id, tripId, proposedBy: scope.userId, votes: [], comments: [], status: 'open' as const, createdAt: Date.now(),
  }]
  const localActivityId = uuid()
  cache.activity = [...cache.activity, {
    id: localActivityId, tripId, actorId: scope.userId,
    verb: `suggested “${s.title}”`, target: `Day ${(s.dayIndex ?? 0) + 1}`, at: Date.now(),
  }]
  const localNotificationIds: string[] = []
  const trip = tripById(tripId)
  if (trip) {
    for (const m of trip.members ?? []) {
      if (m.userId !== scope.userId) {
        const nid = uuid()
        localNotificationIds.push(nid)
        cache.notifications = [{
          id: nid, userId: m.userId, tripId, read: false, at: Date.now(),
          text: `${userName(scope.userId)} suggested “${s.title}” for Day ${(s.dayIndex ?? 0) + 1}.`,
        }, ...cache.notifications]
      }
    }
  }
  commit()
  const rowRef = cache.suggestions.find(x => x.id === id)
  return runContributionCommand({
    scope, tripId, commandId: claimed.commandId, command, pendingKey: claimed.pendingKey,
    rowKind: 'suggestion', rowId: id, rowRef, localActivityId, localNotificationIds,
  })
}

export function voteSuggestion(tripId: ID, suggestionId: ID, value: 1 | -1): Promise<CollabOutcome> {
  const scope = identityScope()
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  const sgIdx = cache.suggestions.findIndex(x => x.id === suggestionId)
  if (sgIdx < 0) return Promise.resolve({ status: 'invalid', reason: 'unknown suggestion' })
  if (cache.suggestions[sgIdx].status && cache.suggestions[sgIdx].status !== 'open') {
    // F13: a closed suggestion takes no more ballots — the accept/decline
    // record IS the decision, and the vote buttons go quiet with it.
    return Promise.resolve({ status: 'invalid', reason: 'suggestion is not open' })
  }
  const rowBefore = cache.suggestions[sgIdx]
  const sg = structuredClone(rowBefore)
  const existing = sg.votes.find(v => v.userId === scope.userId)
  // The prior snapshot is captured BEFORE the clone is mutated below
  // (gate round 4, R2): spreading the entry after `existing.value = value`
  // would record the failed ballot as its own prior, and a refused change
  // could then never restore the vote the actor actually had.
  const priorVote = existing ? { ...existing } : undefined
  // The rollback baseline is the last CONFIRMED ballot, never the optimistic
  // entry (gate round 5, P1): when an earlier ballot is still in flight, its
  // uncommitted value chains forward, so a chain of refusals restores the
  // server-backed vote instead of a ghost.
  const previousOwner = suggestionBallotOwners.get(`${suggestionId}:${scope.userId}`)
  const confirmedVote = previousOwner ? previousOwner.confirmed : priorVote
  // Toggling the same value again is a *removal* — the CLIENT says so with
  // `value: null`, and the activity feed has to say so too: logging the
  // value's verb made "I take back my upvote" read as "upvoted", which is the
  // opposite of what happened. #36-11. The ballot command itself never
  // toggles (contract): a retried ballot with the same value is a no-op on
  // the server, so a retry cannot flip the vote.
  let removed = false
  let ballot: 1 | -1 | null = value
  let appliedCreatedAt = Date.now()
  if (existing) {
    if (existing.value === value) { sg.votes = sg.votes.filter(v => v.userId !== scope.userId); removed = true; ballot = null }
    else { existing.value = value; appliedCreatedAt = existing.createdAt = Date.now() }
  } else {
    sg.votes.push({ userId: scope.userId, value, createdAt: appliedCreatedAt })
  }
  const claimed = claimEnvelope(scope, tripId,
    collabKey(scope, tripId, 'suggestion.ballot', suggestionId, `v:${ballot}`),
    () => ({ type: 'suggestion.ballot', suggestionId, value: ballot }))
  const command = claimed.command
  if (command.type !== 'suggestion.ballot') return Promise.resolve({ status: 'unavailable' })
  // Operation ownership (gate round 3, R2): THIS op owns the actor's
  // optimistic entry until it settles, so a rollback can reclaim it even when
  // a concurrent comment's clone moved the row object.
  const ballotOwnership = claimSuggestionBallot(suggestionId, scope.userId,
    { value: ballot, createdAt: appliedCreatedAt }, confirmedVote)
  cache.suggestions = [...cache.suggestions.slice(0, sgIdx), sg, ...cache.suggestions.slice(sgIdx + 1)]
  const localActivityId = uuid()
  cache.activity = [...cache.activity, {
    id: localActivityId, tripId, actorId: scope.userId,
    verb: removed ? 'removed their vote on a suggestion' : value > 0 ? 'upvoted a suggestion' : 'downvoted a suggestion',
    target: sg.title, at: Date.now(),
  }]
  commit()
  const rowRef = cache.suggestions.find(x => x.id === suggestionId)
  return runContributionCommand({
    scope, tripId, commandId: claimed.commandId, command, pendingKey: claimed.pendingKey,
    rowKind: 'suggestion', rowId: suggestionId, rowBefore, rowRef, ballotOwnership,
    localActivityId, localNotificationIds: [],
  })
}

export function addCommentToSuggestion(tripId: ID, suggestionId: ID, text: string): Promise<CollabOutcome> {
  const scope = identityScope()
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  const trimmed = text.trim()
  if (!trimmed) return Promise.resolve({ status: 'invalid', reason: 'empty comment' })
  const sgIdx = cache.suggestions.findIndex(x => x.id === suggestionId)
  if (sgIdx < 0) return Promise.resolve({ status: 'invalid', reason: 'unknown suggestion' })
  const rowBefore = cache.suggestions[sgIdx]
  const sg = structuredClone(rowBefore)
  // The envelope (F2) owns the stable comment id and the whole command: a
  // retry of an uncertain comment replays the FIRST try's ids and text,
  // so a command that committed behind a lost response cannot duplicate
  // itself. A different text is a NEW intentional action with a new id.
  const claimed = claimEnvelope(scope, tripId,
    collabKey(scope, tripId, 'suggestion.comment', suggestionId, `t:${trimmed}`),
    () => ({ type: 'suggestion.comment', suggestionId, commentId: uid('cm'), text: trimmed }))
  const command = claimed.command
  if (command.type !== 'suggestion.comment') return Promise.resolve({ status: 'unavailable' })
  const comment: Comment = { id: command.commentId, authorId: scope.userId, text: trimmed, createdAt: Date.now() }
  sg.comments.push(comment)
  // The draft overlay starts at DISPATCH (gate round 5, P2): while this
  // comment has no receipt, a canonical replacement of the row — a peer
  // receipt adoption or a recovery read — re-attaches it, so pending input
  // stays on screen until its own action settles.
  commentDrafts.set(draftKey('suggestion', suggestionId, claimed.commandId), comment)
  cache.suggestions = [...cache.suggestions.slice(0, sgIdx), sg, ...cache.suggestions.slice(sgIdx + 1)]
  const localActivityId = uuid()
  cache.activity = [...cache.activity, {
    id: localActivityId, tripId, actorId: scope.userId, verb: 'commented on a suggestion', target: sg.title, at: Date.now(),
  }]
  const localNotificationIds: string[] = []
  for (const v of new Set([...sg.votes.map(v => v.userId), sg.proposedBy])) {
    if (v !== scope.userId) {
      const nid = uuid()
      localNotificationIds.push(nid)
      cache.notifications = [{
        id: nid, userId: v, tripId, read: false, at: Date.now(),
        text: `${userName(scope.userId)} commented on “${sg.title}”.`,
      }, ...cache.notifications]
    }
  }
  commit()
  const rowRef = cache.suggestions.find(x => x.id === suggestionId)
  return runContributionCommand({
    scope, tripId, commandId: claimed.commandId, command, pendingKey: claimed.pendingKey,
    rowKind: 'suggestion', rowId: suggestionId, rowBefore, rowRef,
    commentId: comment.id, localActivityId, localNotificationIds,
  })
}

export function addCommentToDecision(tripId: ID, decisionId: ID, text: string): Promise<CollabOutcome> {
  const scope = identityScope()
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  const trimmed = text.trim()
  if (!trimmed) return Promise.resolve({ status: 'invalid', reason: 'empty comment' })
  const dIdx = cache.decisions.findIndex(x => x.id === decisionId)
  if (dIdx < 0) return Promise.resolve({ status: 'invalid', reason: 'unknown decision' })
  const d = structuredClone(cache.decisions[dIdx])
  // The envelope (F2) owns the stable comment id and the whole command, same
  // as the suggestion comment path.
  const claimed = claimEnvelope(scope, tripId,
    collabKey(scope, tripId, 'decision.comment', decisionId, `t:${trimmed}`),
    () => ({ type: 'decision.comment', decisionId, commentId: uid('cm'), text: trimmed }))
  const command = claimed.command
  if (command.type !== 'decision.comment') return Promise.resolve({ status: 'unavailable' })
  const comment: Comment = { id: command.commentId, authorId: scope.userId, text: trimmed, createdAt: Date.now() }
  d.comments.push(comment)
  // Same dispatch-time draft ownership as the suggestion comment path (gate
  // round 5, P2): pending input survives any canonical row replacement.
  commentDrafts.set(draftKey('decision', decisionId, claimed.commandId), comment)
  const rowBefore = cache.decisions[dIdx]
  cache.decisions = [...cache.decisions.slice(0, dIdx), d, ...cache.decisions.slice(dIdx + 1)]
  const localActivityId = uuid()
  cache.activity = [...cache.activity, {
    id: localActivityId, tripId, actorId: scope.userId, verb: 'commented on a decision', target: d.question, at: Date.now(),
  }]
  // Voters hear about it the same way suggestion voters do; the raiser is
  // included so a comment on their own question still pings the other side.
  const localNotificationIds: string[] = []
  for (const v of new Set([...Object.keys(d.votesByUserId), d.raisedBy])) {
    if (v !== scope.userId) {
      const nid = uuid()
      localNotificationIds.push(nid)
      cache.notifications = [{
        id: nid, userId: v, tripId, read: false, at: Date.now(),
        text: `${userName(scope.userId)} commented on “${d.question}”.`,
      }, ...cache.notifications]
    }
  }
  commit()
  const rowRef = cache.decisions.find(x => x.id === decisionId)
  return runContributionCommand({
    scope, tripId, commandId: claimed.commandId, command, pendingKey: claimed.pendingKey,
    rowKind: 'decision', rowId: decisionId, rowBefore, rowRef,
    commentId: comment.id, localActivityId, localNotificationIds,
  })
}

/** Land one idea through the shared command ledger. The trip JSON, transition,
 *  event, and receipt are one server transaction. */
export function acceptSuggestionIntoTimeline(
  tripId: ID,
  suggestionId: ID,
  opts: { dayId?: ID; dayIndex?: number; allowDuplicate?: boolean } = {},
): Promise<AcceptanceOutcome> {
  const scope = identityScope()
  const sg = cache.suggestions.find(x => x.id === suggestionId)
  const trip = tripById(tripId)
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  if (!sg || !trip || sg.tripId !== tripId) return Promise.resolve({ status: 'unavailable' })
  if (!validWriteVersion(trip.writeVersion)) return Promise.resolve({ status: 'unavailable' })
  const rowBefore = sg
  const command = {
    type: 'suggestion.accept' as const,
    suggestionId,
    expectedRevision: trip.writeVersion,
    ...(opts.dayId !== undefined ? { dayId: opts.dayId } : {}),
    ...(opts.dayIndex !== undefined ? { dayIndex: opts.dayIndex } : {}),
    ...(opts.allowDuplicate !== undefined ? { allowDuplicate: opts.allowDuplicate } : {}),
  }
  return submitCollabTransition(uuid(), tripId, command).then(outcome => {
    if (!isCurrentIdentity(scope)) return outcome
    if (outcome.status === 'applied' || outcome.status === 'alreadyApplied') {
      const current = cache.suggestions.find(x => x.id === suggestionId)
      if (current === rowBefore && outcome.suggestion) {
        cache.suggestions = cache.suggestions.map(x => x.id === suggestionId ? outcome.suggestion! : x)
        commit()
      } else {
        void refetchContributionRow('suggestion', suggestionId, scope)
      }
      noteTripRevision(tripId, outcome.tripRevision)
    } else if (outcome.status === 'conflict') {
      void refetchContributionRow('suggestion', suggestionId, scope)
      noteTripRevision(tripId, outcome.tripRevision)
    }
    return outcome
  })
}
export function declineSuggestion(tripId: ID, suggestionId: ID): Promise<CollabOutcome> {
  const scope = identityScope()
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  const sg = cache.suggestions.find(x => x.id === suggestionId)
  if (!sg) return Promise.resolve({ status: 'invalid', reason: 'unknown suggestion' })
  const rowBefore = sg
  return submitCollabTransition(uuid(), tripId, { type: 'suggestion.decline', suggestionId }).then(outcome => {
    if (isCurrentIdentity(scope) && (outcome.status === 'applied' || outcome.status === 'alreadyApplied')) {
      const current = cache.suggestions.find(x => x.id === suggestionId)
      if (current === rowBefore && outcome.suggestion) {
        cache.suggestions = cache.suggestions.map(x => x.id === suggestionId ? outcome.suggestion! : x)
        commit()
      } else void refetchContributionRow('suggestion', suggestionId, scope)
      noteTripRevision(tripId, outcome.tripRevision)
    } else if (isCurrentIdentity(scope) && outcome.status === 'conflict') {
      void refetchContributionRow('suggestion', suggestionId, scope)
      noteTripRevision(tripId, outcome.tripRevision)
    }
    return outcome
  })
}

// ---------------- Decisions ----------------

export function addDecision(tripId: ID, d: Pick<TripDecision, 'question' | 'context'> & { options: NewDecisionOption[] }): Promise<CollabOutcome> {
  const scope = identityScope()
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  if (!d.question.trim()) return Promise.resolve({ status: 'invalid', reason: 'empty question' })
  // The envelope (gate round 3, R1): the LOGICAL FORM is fingerprinted BEFORE
  // any id is minted, and the retained action owns the whole normalized
  // payload — question, context, the decision id and every option id. A retry
  // of an uncertain poll reuses that payload verbatim; a caller-supplied
  // option id is preserved inside it; and a settled intentional repeat (the
  // envelope freed) mints everything fresh.
  const formFingerprint = `f:${JSON.stringify({
    question: d.question,
    context: d.context ?? null,
    options: d.options.map(o => ({ ...o, id: o.id ?? null })),
  })}`
  const claimed = claimEnvelope(scope, tripId,
    collabKey(scope, tripId, 'decision.create', '', formFingerprint),
    () => {
      // #335: the caller's option id IS the contract, so keep it. The Map rail
      // mints `slot:<key>:<hit>` for the join that puts a poll on its part and
      // stamps `slotKey` on the stop it resolves to; the shortlist mints the place
      // id so a re-add collapses into the poll already open; and votes recorded in
      // other rows point at these ids. Mint only when there is nothing to keep, or
      // when two options in THIS poll collide — a shared id would make one vote
      // count for both.
      const seen = new Set<string>()
      const options = d.options.map(o => {
        const optionId = o.id && !seen.has(o.id) ? o.id : uid('o')
        seen.add(optionId)
        return { ...o, id: optionId }
      })
      return {
        type: 'decision.create',
        decisionId: uuid(),
        decision: { question: d.question, ...(d.context !== undefined ? { context: d.context } : {}), options: options.map(o => ({ ...o })) },
      }
    })
  const command = claimed.command
  if (command.type !== 'decision.create') return Promise.resolve({ status: 'unavailable' })
  const id = command.decisionId
  const options = command.decision.options as DecisionOption[]
  cache.decisions = [...cache.decisions, {
    ...d, id, tripId, options, votesByUserId: {}, comments: [], status: 'open' as const,
    raisedBy: scope.userId, createdAt: Date.now(),
  }]
  const localActivityId = uuid()
  cache.activity = [...cache.activity, {
    id: localActivityId, tripId, actorId: scope.userId, verb: `raised decision “${d.question}”`, target: 'Decisions', at: Date.now(),
  }]
  // Notification parity with addSuggestion: the other members hear about new
  // group input too, not just suggestions.
  const localNotificationIds: string[] = []
  const trip = tripById(tripId)
  if (trip) {
    for (const m of trip.members ?? []) {
      if (m.userId !== scope.userId) {
        const nid = uuid()
        localNotificationIds.push(nid)
        cache.notifications = [{
          id: nid, userId: m.userId, tripId, read: false, at: Date.now(),
          text: `${userName(scope.userId)} raised a decision: “${d.question}”.`,
        }, ...cache.notifications]
      }
    }
  }
  commit()
  const rowRef = cache.decisions.find(x => x.id === id)
  return runContributionCommand({
    scope, tripId, commandId: claimed.commandId, command, pendingKey: claimed.pendingKey,
    rowKind: 'decision', rowId: id, rowRef, localActivityId, localNotificationIds,
  })
}

export function voteOnDecision(decisionId: ID, optionId: ID): Promise<CollabOutcome> {
  const scope = identityScope()
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  const dIdx = cache.decisions.findIndex(x => x.id === decisionId)
  if (dIdx < 0) return Promise.resolve({ status: 'invalid', reason: 'unknown decision' })
  if (cache.decisions[dIdx].status !== 'open') return Promise.resolve({ status: 'invalid', reason: 'decision is not open' })
  // The chosen option must exist — the contract validates it server-side too,
  // and a ballot pointing nowhere would count a vote for nothing.
  if (!cache.decisions[dIdx].options.some(o => o.id === optionId)) {
    return Promise.resolve({ status: 'invalid', reason: 'unknown option' })
  }
  const rowBefore = cache.decisions[dIdx]
  const d = structuredClone(rowBefore)
  // One ballot per actor, keyed by auth.uid() on the server. A ballot change
  // is a SET to the new option; a retried ballot with the same option
  // is a no-op, never a toggle.
  const priorOptionId = d.votesByUserId[scope.userId]
  // The rollback baseline is the last CONFIRMED option, chained from an
  // in-flight owner when one exists (gate round 5, P1 — the suggestion
  // counterpart explains the ghost-vote chain this prevents).
  const previousOwner = decisionBallotOwners.get(`${decisionId}:${scope.userId}`)
  const confirmedOption = previousOwner ? previousOwner.confirmed : priorOptionId
  d.votesByUserId[scope.userId] = optionId
  const claimed = claimEnvelope(scope, d.tripId,
    collabKey(scope, d.tripId, 'decision.ballot', decisionId, `o:${optionId}`),
    () => ({ type: 'decision.ballot', decisionId, optionId }))
  const command = claimed.command
  if (command.type !== 'decision.ballot') return Promise.resolve({ status: 'unavailable' })
  const ballotOwnership = claimDecisionBallot(decisionId, scope.userId, { optionId }, confirmedOption)
  cache.decisions = [...cache.decisions.slice(0, dIdx), d, ...cache.decisions.slice(dIdx + 1)]
  const localActivityId = uuid()
  cache.activity = [...cache.activity, {
    id: localActivityId, tripId: d.tripId, actorId: scope.userId, verb: 'voted on a decision', target: d.question, at: Date.now(),
  }]
  // No per-vote member pings — on a 6-person trip every ballot pinged five
  // people and the bell became noise. The activity feed carries the vote;
  // members hear about the raise and the resolution only.
  commit()
  const rowRef = cache.decisions.find(x => x.id === decisionId)
  return runContributionCommand({
    scope, tripId: d.tripId, commandId: claimed.commandId, command, pendingKey: claimed.pendingKey,
    rowKind: 'decision', rowId: decisionId, rowBefore, rowRef, ballotOwnership,
    localActivityId, localNotificationIds: [],
  })
}

export function resolveDecision(decisionId: ID, optionId: ID,
  target: { dayId?: ID; dayIndex?: number } = {}): Promise<DecisionResolutionOutcome> {
  const scope = identityScope()
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  const dIdx = cache.decisions.findIndex(x => x.id === decisionId)
  if (dIdx < 0) return Promise.resolve({ status: 'unavailable' })
  const rowBefore = cache.decisions[dIdx]
  const trip = tripById(rowBefore.tripId)
  if (!trip || !validWriteVersion(trip.writeVersion)) return Promise.resolve({ status: 'unavailable' })
  const command = {
    type: 'decision.resolve' as const,
    decisionId,
    optionId,
    expectedRevision: trip.writeVersion,
    ...(target.dayId !== undefined ? { dayId: target.dayId } : {}),
    ...(target.dayIndex !== undefined ? { dayIndex: target.dayIndex } : {}),
  }
  return submitCollabTransition(uuid(), rowBefore.tripId, command).then(outcome => {
    if (!isCurrentIdentity(scope)) return outcome
    if (outcome.status === 'applied' || outcome.status === 'alreadyApplied') {
      const current = cache.decisions.find(x => x.id === decisionId)
      if (current === rowBefore && outcome.decision) {
        cache.decisions = cache.decisions.map(x => x.id === decisionId ? outcome.decision! : x)
        commit()
      } else {
        void refetchContributionRow('decision', decisionId, scope)
      }
      noteTripRevision(rowBefore.tripId, outcome.tripRevision)
    } else if (outcome.status === 'conflict') {
      void refetchContributionRow('decision', decisionId, scope)
      noteTripRevision(rowBefore.tripId, outcome.tripRevision)
    }
    return outcome
  })
}

// ---------------- Publishing ----------------

// The outcome is `{ ok: true }` only after the server accepts the row and its
// public page opens. A refusal is still thrown, as PublishRejected, because the
// form maps it onto fields. A failed write rolls the cache back and returns
// `{ ok: false, error }`. The caller shows that error, so nothing toasts here.
export async function publishItinerary(pub: Omit<PublishedItinerary, 'id' | 'publishedAt' | 'views' | 'copies'>): Promise<{ ok: boolean; error?: string }> {
  // #354 — THE WRITER ENFORCES THE RULES, not just the form that calls it.
  // Every publish rule used to live only in `PublicationForm`, so this function
  // enforced none of them and the database had no backstop either. Any direct
  // caller — a future surface, a console, a test, the admin path — could write a
  // row the paywall would price but the preview shows fully (price > 0 with
  // every day free: a paid unlock that reveals what the reader can already see),
  // a ₹999999 row that 503s at checkout with no visible cause, or a coverless
  // one whose link silently previews as the brand card.
  //
  // The check is the FORM's own `publishValidation` from `lib/publishRules` —
  // the SAME module the form reads, so the refusal and the form's message are
  // LITERALLY the same string and cannot drift. That is the whole reason the
  // rules are a module rather than a function in the page: two copies of six
  // rules is how this class of bug starts. A pure function of six scalars and a
  // string map, so the store depends on the RULES and not on the page.
  const entirelyFree = pub.premiumPriceInr == null
  const violations = publishValidation({
    coverImageUrl: pub.coverImageUrl?.trim(),
    priceNum: pub.premiumPriceInr ?? 0,
    entirelyFree,
    freeDayCount: pub.freeDayIndexes.length,
    totalDays: pub.durationDays,
    cta: (pub.subscriberCta ?? '').trim(),
    hasPremiumDay: !entirelyFree && pub.freeDayIndexes.length < pub.durationDays,
  })
  if (Object.keys(violations).length) {
    // A REFUSAL, not a partial write: nothing is committed, nothing is rolled
    // back, because nothing was touched. The form catches this and shows the
    // message on the field it belongs to (which is why the map is keyed by
    // field rather than concatenated here).
    const first = PUBLISH_FIELD_ORDER.find(k => k in violations)!
    throw new PublishRejected(violations[first] ?? 'This publication is not ready to publish.', first, violations)
  }
  // Reuse the existing published row's id for the same trip so re-publishing
  // UPDATES it instead of minting a brand-new row. Previously every call used
  // a fresh uid('pub'), so the upsert created a duplicate row each time and
  // Explore accumulated copies of the same itinerary. Views/copies/publishedAt
  // are preserved on update.
  const existing = cache.published.find(x => x.tripId === pub.tripId)
  const id = existing?.id ?? uid('pub')
  const p: PublishedItinerary = {
    ...pub, id,
    publishedAt: existing?.publishedAt ?? Date.now(),
    // Freshness marker for the dashboard's "page behind itinerary" nudge —
    // publishedAt stays the original date for Explore's newest sort.
    refreshedAt: Date.now(),
    // Re-publishing puts the plan back on Explore and back on sale, so the
    // soft-unpublish marker (#350) is cleared here — otherwise a plan
    // unpublished once could never be made live again. The cache object is
    // built fresh rather than spread from `pub`, so an explicit undefined is
    // what clears a marker the caller happened to carry in.
    unpublishedAt: undefined,
    views: existing?.views ?? 0,
    copies: existing?.copies ?? 0,
  }
  const existingIdx = cache.published.findIndex(x => x.tripId === p.tripId)
  const previous = existingIdx >= 0 ? cache.published[existingIdx] : undefined
  // #361 — OWN THE COVER BEFORE THE FIRST COMMIT, not after. The old order
  // committed the optimistic publication carrying the THIRD-PARTY
  // (Wikimedia) URL, then awaited `ownSuggestedCover`, then committed the owned
  // one — so anything reading the cache in that window (a share link copied
  // mid-publish, a preview fetched in the gap) served Wikimedia at exactly the
  // moment the feature exists to stop that. Resolving first makes the
  // third-party URL durably unpublishable on the success path.
  //
  // It cannot block a publish: `ownSuggestedCover` never throws and never
  // rejects, and its worst case is the original URL plus a `pending` flag the
  // post-hydrate sweep retries. So the bounded fallback the old comment claimed
  // is preserved, and it is now VISIBLE rather than silent.
  const owned = await ownSuggestedCover(p.creatorId, p.coverImageUrl)
  const ownedUrl = owned.owned && owned.url ? owned.url : undefined
  if (ownedUrl) p.coverImageUrl = ownedUrl
  // The trip's cover is what the publication copies, so a trip whose cover is
  // still the suggestion is the reason this keeps happening: capture it BEFORE
  // any write so a failure can put it back (#361's atomic rollback). Its
  // VISIBILITY is captured for the same reason (#354's refused flip) — both
  // rollbacks must restore the same "before" picture, or the trip is left in a
  // state nobody chose.
  const tripBefore = cache.trips.find(t => t.id === p.tripId)
  const tripCoverBefore = tripBefore?.coverImageUrl
  const tripVisibilityBefore = tripBefore?.visibility ?? 'private'
  cache.published = existingIdx >= 0
    ? [...cache.published.slice(0, existingIdx), p, ...cache.published.slice(existingIdx + 1)]
    : [...cache.published, p]
  commit()
  if (ownedUrl) {
    // Put the owned URL on the TRIP too. Publishing copies the trip's cover, so
    // without this every re-publish would re-copy the same suggestion and mint
    // another object — and the trip's own card would keep loading from
    // Wikimedia, leaving the dependency in place on the app side.
    updateTrip(p.tripId, { coverImageUrl: ownedUrl })
  }
  // The Supabase row is the ONLY persistence for a publication — if this
  // upsert is rejected, the optimistic cache write makes it look published
  // until the next refresh silently wipes it. Surface the failure and roll
  // the cache back so the UI never disagrees with the server. (Found live:
  // the gallery table was empty while the UI showed a published card.)
  const hasRefreshedCol = await publishedHaveRefreshedAt()
  // A re-publish CLEARS the soft-unpublish marker (#350): without it the row
  // would keep hiding from Explore and from the public page forever. Naming the
  // column only when the probe says it exists — a write mentioning a missing
  // column fails the whole statement (PostgREST), which would break publishing
  // for every creator on an un-migrated project.
  const hasUnpublishedCol = await publishedHaveUnpublishedAt()
  const { error } = await supabase.from('published_itineraries').upsert({
    id: p.id, trip_id: p.tripId, creator_id: p.creatorId, title: p.title, tagline: p.tagline,
    cover_image_url: p.coverImageUrl, route_summary: p.routeSummary, duration_days: p.durationDays,
    estimated_budget_per_person_inr: p.estimatedBudgetPerPersonInr, travel_style: p.travelStyle,
    best_season: p.bestSeason, travel_tips: p.travelTips, warnings_and_assumptions: p.warningsAndAssumptions,
    free_day_indexes: p.freeDayIndexes, premium_price_inr: p.premiumPriceInr, subscriber_cta: p.subscriberCta,
    ...(hasRefreshedCol ? { refreshed_at: p.refreshedAt } : {}),
    ...(hasUnpublishedCol ? { unpublished_at: null } : {}),
  })
  if (error) {
    console.error('[yatraflow] publish persist failed', error)
    const idx = cache.published.findIndex(x => x.id === p.id)
    if (idx >= 0) {
      cache.published = previous
        ? [...cache.published.slice(0, idx), previous, ...cache.published.slice(idx + 1)]
        : cache.published.filter((_, i) => i !== idx)
      commit()
    }
    // #361 — ATOMIC ROLLBACK: the trip's cover was written too, so the
    // publication going back is not enough. Restoring only the publication left
    // the trip card on the owned cover and the publication on the old one, and
    // after a fix-and-republish cycle the two showed different pictures. Both
    // writes go back together, or the publish is half-undone.
    //
    // `updateTrip` is the same debounced coalescing path the forward write used
    // (600ms trailing, snapshot semantics) — going around it would put the
    // restore in a different queue and let the coalesced snapshot win.
    if (ownedUrl && tripCoverBefore !== ownedUrl) {
      updateTrip(p.tripId, { coverImageUrl: tripCoverBefore })
    }
    return { ok: false, error: 'Could not save the publication — nothing was published. Try again.' }
  } else {
    markLocalWrite('published_itineraries', p.id)
    // A published itinerary is a public page: flip the trip to visibility
    // 'public' so RLS lets anonymous visitors and logged-in non-members read
    // the trip body the public page renders (see fetchSharedTrip).
    //
    // #354 — AWAITED, and rolled back on refusal. This used to be
    // `fire(...)`, so a rejected flip left the CACHE saying public while
    // `get_public_trip` (which requires `visibility = 'public'`) served nothing:
    // a live Explore card pointing at a dead public page, with nothing said.
    // Awaiting is the fix; the rollback is what stops a refused flip from
    // becoming that split state, and the toast is what stops it being silent.
    const visible = tripById(p.tripId)?.visibility === 'public'
      || await persistTripMetadata(p.tripId, { visibility: 'public' }, { visibility: 'public' })
    if (!visible) {
      console.error('[yatraflow] publish visibility flip failed')
      // Put the trip's own visibility back — the value captured BEFORE this
      // publish, not a hardcoded 'private': it may have been 'link', and a guess
      // would either narrow a shared trip or widen a private one. Captured at
      // the top of the function, beside the cover, so the two rollbacks restore
      // the same "before" picture.
      cache.trips = cache.trips.map(t => t.id === p.tripId ? { ...t, visibility: tripVisibilityBefore } : t)
      commit()
      return { ok: false, error: 'The publication saved, but its public page could not be opened. Publish again to retry.' }
    } else {
      markLocalWrite('trips', p.tripId)
      cache.trips = cache.trips.map(t => t.id === p.tripId ? { ...t, visibility: 'public' } : t)
      commit()
    }
  }
  return { ok: true }
}

/** In-flight cover collection, so two callers (the app shell's post-hydrate
 *  sweep and anything added later) share one pass instead of racing to copy and
 *  upload the same image twice. */
let coverSweep: Promise<number> | null = null

/** Take ownership of any of MY publications that still preview with a
 *  third-party image, and converge the ones that have no stored cover at all.
 *
 *  Publishing already copies an auto-suggested cover into our bucket, but that
 *  is a write-path fix, not a migration: rows published before it shipped still
 *  point at Wikimedia, and any publish whose copy failed — offline, a file the
 *  wiki could not resolve, the 8-second timeout — deliberately kept the
 *  third-party URL rather than fail the publish. A second, older population is
 *  worse in a quieter way: rows from before the cover requirement store NO
 *  cover, and the public hero then renders a live Wikipedia suggestion while
 *  `api/i.js` serves the brand card to every crawler — the two disagree for as
 *  long as the row lives (#360). Neither is visible in the app (the page
 *  renders the photo either way), and both leave a share card at the mercy of
 *  another host's uptime, terms and size.
 *
 *  This is the re-run for both. Idempotent by construction: the work lists come
 *  from the data (`unclaimedCovers`, `coverlessPublications`), so a second pass
 *  over collected rows finds nothing to do and costs nothing. Called after
 *  hydration for a signed-in user; safe to call at any time, from anywhere.
 *
 *  The null-cover list resolves the SAME suggestion the hero resolves — the
 *  publication's own routeSummary, then its title, through the shared
 *  `fetchFirstAvailableThumb` — so the stored cover is the photo the page
 *  already shows rather than a different one. The handler is untouched: it
 *  keeps reading the stored column, and a row that has not been converged
 *  behaves exactly as it does today.
 *
 *  Only the creator can collect a publication's cover — the bucket confines
 *  writes to `<auth.uid()>/`, so another creator cannot take it and neither can
 *  an admin, whose console holds no service key.
 *
 *  Deliberately silent and never throwing: this is housekeeping behind the
 *  scenes, and nothing about it should interrupt browsing. Returns how many
 *  covers were collected. */
export async function collectUnclaimedCovers(): Promise<number> {
  if (!isSupabaseConfigured) return 0
  const userId = cache.sessionUserId
  if (!userId) return 0
  if (coverSweep) return coverSweep
  coverSweep = (async () => {
    let collected = 0
    // Sequential on purpose: one image at a time keeps a backfill from
    // competing with the page the user is actually looking at.
    for (const pub of unclaimedCovers(cache.published, userId)) {
      const suggestion = pub.coverImageUrl
      const owned = await ownSuggestedCover(userId, suggestion)
      if (!owned.owned || !owned.url) continue
      // The ROW is persisted first. A cover that only ever reached the cache
      // would be back on Wikimedia after a reload — which is exactly the bug the
      // cover column itself shipped with, and the reason a collected cover is
      // not a local optimization.
      const { error } = await supabase.from('published_itineraries')
        .update({ cover_image_url: owned.url }).eq('id', pub.id)
      if (error) {
        console.error('[yatraflow] cover collection failed', error)
        continue
      }
      markLocalWrite('published_itineraries', pub.id)
      cache.published = cache.published.map(x => (x.id === pub.id ? { ...x, coverImageUrl: owned.url } : x))
      commit()
      // Follow the publication onto its trip, but only while that trip still
      // carries this same suggestion: publishing copies the trip's cover, so
      // rewriting it here is what stops a later re-publish from re-copying the
      // suggestion — while a trip whose creator has since chosen a different
      // cover keeps that newer choice.
      if (tripById(pub.tripId)?.coverImageUrl === suggestion) {
        updateTrip(pub.tripId, { coverImageUrl: owned.url })
      }
      collected++
    }
    // #360: the null-cover population. The suggestion is not stored anywhere —
    // the hero computes it from the publication's own route summary, so this
    // resolves the same candidates, once, and stores the owned copy. A row
    // whose suggestion no longer resolves is left exactly as it is: the sweep
    // never writes a cover it could not actually own.
    //
    // The candidate order comes from `coverCandidates`, shared with the hero
    // itself. It used to be written out here as well, which meant the page and
    // the sweep could answer "which photo is this publication's" differently —
    // the same drift, one level up, that this sweep exists to remove.
    for (const pub of coverlessPublications(cache.published, userId)) {
      const suggestion = await fetchFirstAvailableThumb(coverCandidates(pub))
      if (!suggestion) continue
      const owned = await ownSuggestedCover(userId, suggestion)
      if (!owned.owned || !owned.url) continue
      const { error } = await supabase.from('published_itineraries')
        .update({ cover_image_url: owned.url }).eq('id', pub.id)
      if (error) {
        console.error('[yatraflow] cover backfill failed', error)
        continue
      }
      markLocalWrite('published_itineraries', pub.id)
      cache.published = cache.published.map(x => (x.id === pub.id ? { ...x, coverImageUrl: owned.url } : x))
      commit()
      collected++
    }
    return collected
  })()
  try { return await coverSweep } finally { coverSweep = null }
}

/** Take a trip's public itinerary off Explore — SOFTLY (#350).
 *
 *  The row SURVIVES: it is stamped with `unpublishedAt` and that is what hides
 *  it (Explore, the hub's public surfaces, the `/pub/:id` page for anyone who
 *  is not the creator or a buyer). It used to be a hard DELETE, and
 *  `entitlements`, `purchase_orders` and `pub_events` all cascade off `pub_id`
 *  — so a single click silently took away what buyers had paid for, destroyed
 *  the creator's sales history and wiped the funnel that explains the plan's
 *  reach. The hard DELETE is reserved for a separate refund-aware permanent
 *  delete flow, which is not reachable from here.
 *
 *  The marker is written optimistically (the UI reflects it at once) and rolled
 *  back only if the update comes back failed. Owner-gated: only the trip owner
 *  (whose id matches creator_id server-side via RLS) may unpublish. The trip
 *  itself stays in My Trips — unpublish ≠ delete trip. */
export function unpublishItinerary(tripId: ID): void {
  const idx = cache.published.findIndex(p => p.tripId === tripId)
  if (idx < 0) return
  if (!cache.sessionUserId || cache.published[idx].creatorId !== cache.sessionUserId) {
    toast('Only the trip owner can unpublish this itinerary.', 'err')
    return
  }
  const pub = cache.published[idx]
  const previous = pub
  void (async () => {
    // Fail CLOSED on an un-migrated database. Deleting is the bug this fixes,
    // so the old fallback is deliberately gone: without the column there is no
    // way to unpublish that keeps buyers whole, and the honest answer is to
    // refuse and say why. (Checked BEFORE the optimistic stamp, so a refusal
    // changes nothing at all — not even for one frame.)
    if (!(await publishedHaveUnpublishedAt())) {
      console.warn('[yatraflow] published_itineraries.unpublished_at missing — run supabase/migrations/20260925_publication_soft_unpublish.sql; unpublish is unavailable until then (the row must survive for its buyers).')
      toast('Unpublish needs the soft-unpublish migration (20260925_publication_soft_unpublish.sql) — it is not applied yet.', 'err')
      return
    }
    const stamp = Date.now()
    // Optimistic: the ROW STAYS, only the marker is added. Removing it from
    // `cache.published` here is what the old hard-delete path did, and it is
    // the same mistake one layer up — the creator's own ledger reads this list.
    cache.published = cache.published.map(p => (p.id === pub.id ? { ...p, unpublishedAt: stamp } : p))
    commit()
    let failed: { message?: string } | null = null
    try {
      const { error } = await supabase.from('published_itineraries')
        .update({ unpublished_at: stamp }).eq('id', pub.id)
      failed = error
    } catch (e) {
      // A thrown transport error (offline, a rejected fetch) is the same
      // failure as an error response: the marker did not stick.
      failed = { message: e instanceof Error ? e.message : String(e) }
    }
    if (failed) {
      console.error('[yatraflow] unpublish persist failed', failed)
      toast('Could not unpublish — the plan is still live on Explore. (' + (failed.message ?? 'unknown error') + ')')
      // Roll the marker back off; the next refresh would drop it anyway, and
      // until then the UI must not disagree with the server.
      cache.published = cache.published.map(p => (p.id === pub.id ? previous : p))
      commit()
      return
    }
    markLocalWrite('published_itineraries', pub.id)
    // Deliberately NO `trips.visibility = 'private'` here (the old path did
    // that). The public page's RLS policy already restricts a direct trip read
    // to the owner, a member or an admin, and `get_public_trip` requires
    // `visibility = 'public'` to serve an entitled buyer — so flipping the trip
    // private would silently revoke every existing buyer's access, which is the
    // exact failure this change exists to fix. The trip stays public; only the
    // publication stops being offered.
  })()
}

/** Trips this user owns that are not currently published on Explore.
 *
 *  #350 — membership of `cache.published` no longer answers this question: a
 *  soft-unpublished publication KEEPS its row (that is what preserves its
 *  buyers' access and the creator's sales history), so a trip whose plan has
 *  been taken down would otherwise be reported as published. A trip counts as
 *  unpublished when it has no row at all, or a row carrying the marker. */
export function unpublishedTripIds(userId: ID): ID[] {
  const mine = cache.trips.filter(t => t.members?.some(m => m.userId === userId && m.role === 'owner'))
  return mine.filter(t => !cache.published.some(p => p.tripId === t.id && !p.unpublishedAt)).map(t => t.id)
}

/** The `sessionStorage` key that dedupes one counter for one publication for one
 *  session.
 *
 *  Views and forks get their OWN key, and that is the #363 fix: opening a plan
 *  and taking a copy of it are two things a reader may legitimately do in one
 *  visit, so sharing a key would make the second invisible. Forks used to have
 *  no key at all — every fork click was a raw event — while views were deduped,
 *  which is why a fork rate computed from the two could exceed 100% with no
 *  explanation. */
function pubCounterKey(kind: 'views' | 'copies', id: ID): string {
  return kind === 'views' ? `yf-viewed-${id}` : `yf-forked-${id}`
}

/** Has this step already been counted this session? Marks it if not.
 *
 *  Storage being unavailable (private mode, a hardened browser) is NOT a reason
 *  to record nothing — it falls through and counts, which is the behaviour the
 *  view counter already had. */
function claimPubCounter(key: string): boolean {
  try {
    if (sessionStorage.getItem(key)) return false
    sessionStorage.setItem(key, '1')
  } catch { /* storage unavailable — count it */ }
  return true
}

/** Release the session mark so a LATER attempt can count.
 *
 *  Called only when the write failed: the claim above is what makes a bump
 *  once-per-session, and a bump that never reached the server did not happen,
 *  so holding its mark would silently drop the reader's one chance to be
 *  counted. */
function releasePubCounter(key: string): void {
  try { sessionStorage.removeItem(key) } catch { /* nothing to do */ }
}

/**
 * Bump one of a publication's lifetime counters, and take the bump back if the
 * server refuses it.
 *
 *  #363 — both counters used to be cache `+1` + `commit()` followed by a
 *  fire-and-forget RPC whose failure was merely logged. So a failed bump left a
 *  PERMANENT phantom on the client: `views`/`copies` drive Explore's sort
 *  (`views + copies * 5`) and its featured pick, so an offline reader silently
 *  re-ordered the catalog and could keep a card featured — and the dated
 *  `pub_events` row is written only on SERVER success, so the counter and the
 *  log drifted apart in exactly the case the migration's "one write path" was
 *  written to prevent.
 *
 *  The optimistic bump STAYS (the UI should feel immediate, and this is a
 *  counter, not money). What is new is the failure arm: decrement, commit, and
 *  release the session claim. `commit()` only notifies subscribers — it persists
 *  nothing — so rolling the cache back cannot itself write.
 *
 *  The issue offered "await where the UX allows, OR reconcile on the next read —
 *  implement ONE". This is the third, explicitly-permitted minimum: never let a
 *  FAILED bump keep its +1. It is the smallest change that removes the permanent
 *  skew, and it needs no reconciliation pass because the value it leaves behind
 *  is the server's own.
 */
function bumpPubCounter(id: ID, kind: 'views' | 'copies', source?: ShareSource | null, campaign?: CampaignId | null): void {
  const p = cache.published.find(x => x.id === id)
  if (!p) return
  // The creator's own visit/fork does not count: they are checking their own
  // work, not being converted by it. Both stages use the same exclusion, or the
  // funnel's two halves disagree about who a reader is.
  if (cache.sessionUserId && p.creatorId === cache.sessionUserId) return
  const key = pubCounterKey(kind, id)
  if (!claimPubCounter(key)) return
  cache.published = cache.published.map(x => x.id === id ? { ...x, [kind]: x[kind] + 1 } : x)
  commit()
  // Use RPC function that bypasses RLS - anyone can increment counters now.
  // The same call records the dated funnel event server-side, which is why the
  // failure arm below matters: the counter and the log must not drift.
  const undo = () => {
    // Decrement rather than restoring a captured snapshot: a snapshot would
    // discard any OTHER legitimate movement of the same field that happened
    // while this write was in flight, and the floor keeps a double-failure from
    // driving the counter negative.
    cache.published = cache.published.map(x => x.id === id ? { ...x, [kind]: Math.max(0, x[kind] - 1) } : x)
    commit()
    releasePubCounter(key)
  }
  // `p_source` is the link's ref (or the in-app surface) that produced this
  // step — #230's attribution. `null` means unattributed; the RPC
  // stores it on the event row, never on the counter.
  try {
    void Promise.resolve(supabase.rpc('bump_published_stats', { p_id: id, p_kind: kind, p_source: source ?? null, p_campaign: campaignId(campaign) })).then(
      res => {
        if (!res?.error) return
        console.error(`[yatraflow] ${kind} bump failed`, res.error)
        undo()
      },
      err => {
        console.error(`[yatraflow] ${kind} bump rejected`, err)
        undo()
      },
    )
  } catch {
    undo()
    console.warn('[yatraflow] publication analytics unavailable')
  }
}

/** One view per itinerary per browser session, and the creator's own visits
 *  don't count — before this, every refresh and every self-check inflated the
 *  Explore counter. (sessionStorage survives route changes within the tab but
 *  resets on a genuinely new visit, which is the granularity views want.) */
export function registerPubView(id: ID, source?: ShareSource | null, campaign?: CampaignId | null): void {
  bumpPubCounter(id, 'views', source, campaign)
}

/** One FORK per itinerary per browser session, and the creator's own forks
 *  don't count.
 *
 *  #363 — the view counter had a session guard and this one did not, so the
 *  funnel divided session-deduped visits by raw fork clicks: unlike units
 *  presented as a conversion rate. Explore's card can fork a plan repeatedly in
 *  one visit, and each click was a fresh event. The guard makes the two stages
 *  count the same kind of thing. */
export function registerPubCopy(id: ID, source?: ShareSource | null, campaign?: CampaignId | null): void {
  bumpPubCounter(id, 'copies', source, campaign)
}

// ---------------- Feed & notifications ----------------

export function activityFor(tripId: ID): ActivityEntry[] {
  return cache.activity.filter(a => a.tripId === tripId).sort((a, b) => b.at - a.at)
}

/** Append one activity entry through the collab-command RPC. The actor NEVER
 *  travels in the payload — the server derives it from auth.uid() (#801). The
 *  client mints the activityId (the contract's client-supplied UUID for
 *  activity.append), so the local entry and the server row share one id and
 *  the realtime echo upserts instead of duplicating. Returns the outcome;
 *  a refused command rolls the optimistic entry back and the caller decides
 *  what the user sees. */
export function addActivity(tripId: ID, verb: string, target?: string): Promise<CollabOutcome> {
  const scope = identityScope()
  if (!scope) return Promise.resolve({ status: 'forbidden' })
  if (!verb.trim()) return Promise.resolve({ status: 'invalid', reason: 'empty verb' })
  const entry: ActivityEntry = { id: uuid(), tripId, actorId: scope.userId, verb, target, at: Date.now() }
  cache.activity = [...cache.activity, entry]
  commit()
  // activity.append has no user retry gesture (it is fire-and-forget
  // logging), so each call is its own logical action: no envelope, and the
  // rollback retracts only THIS entry (gate round 2 F1 — a whole-slice
  // restore here erased later successful appends).
  return submitCollabCommand(uuid(), tripId, {
    type: 'activity.append',
    activityId: entry.id,
    verb,
    ...(target !== undefined ? { target } : {}),
  }).then(receipt => {
    if (!isCurrentIdentity(scope)) return receipt
    if (receipt.status === 'applied' || receipt.status === 'alreadyApplied') {
      noteTripRevision(tripId, receipt.tripRevision)
      return receipt
    }
    if (receipt.status === 'conflict') return receipt
    dropArtifacts(entry.id, [])
    return receipt
  })
}

export function notificationsFor(userId: ID): Notification[] {
  return cache.notifications.filter(n => n.userId === userId).sort((a, b) => b.at - a.at)
}

export function pushNotification(userId: ID, tripId: ID | undefined, text: string): void {
  const n: Notification = { id: uuid(), userId, tripId, text, read: false, at: Date.now() }
  cache.notifications = [n, ...cache.notifications]
  fire('notifications', supabase.from('notifications').insert({ id: n.id, user_id: userId, trip_id: tripId, text, read: false, at: n.at }))
}

export function markAllNotificationsRead(userId: ID): void {
  cache.notifications = cache.notifications.map(n => n.userId === userId ? { ...n, read: true } : n)
  commit()
  fire('notifications', supabase.from('notifications').update({ read: true }).eq('user_id', userId))
}

// ---------------- Realtime collaboration (issue #18) ----------------
// One supabase channel subscribes to all the tables in the `supabase_realtime`
// publication. RLS SELECT policies gate what each user actually receives
// (owner/member/public rows only), so a single channel is safe app-wide. Each
// event updates the relevant cache slice and commits — collaborators see
// changes without reloading. Own writes are echo-suppressed for trips (the only
// slice replaced wholesale) so a fresh server row never clobbers optimistic
// local state; the rest of the tables are idempotent upserts.
let realtimeChannel: RealtimeChannel | null = null
const recentLocalWrites = new Map<string, number>()
const MAX_RECENT_WRITES = 500

/** Record a recent local write so its realtime echo can be suppressed. */
function markLocalWrite(table: string, id: string): void {
  const key = `${table}:${id}`
  // #579 — LRU promotion: `Map.set` on an existing key never refreshes the
  // key's position in iteration order, so evicting `keys().next().value` was
  // oldest-INSERTED, not least-recently-used — the trip being edited kept its
  // original slot and was evicted FIRST while entries nobody had touched since
  // boot lingered at the front. Delete-then-set moves a re-recorded key to the
  // end, so the eviction below now drops the true least-recently-written.
  recentLocalWrites.delete(key)
  recentLocalWrites.set(key, Date.now())
  // Sweep old entries to prevent unbounded growth. #36-2.
  if (recentLocalWrites.size > MAX_RECENT_WRITES) {
    const oldestKey = recentLocalWrites.keys().next().value
    if (oldestKey) recentLocalWrites.delete(oldestKey)
  }
}

function echoWindowEh(table: string, id: string): boolean {
  return isRecentLocalWrite(recentLocalWrites, table, id, Date.now())
}

/** Test hook — clear the echo-window ledger so a test can isolate the window
 *  armed by the write it is actually exercising. The ledger is a module
 *  singleton, so without this every earlier write in the same test file keeps
 *  its window open (2s is longer than a test) and masks the behaviour under
 *  test — which is exactly how the reorder bug first hid. */
export function _clearRecentLocalWrites(): void {
  recentLocalWrites.clear()
}

/** B2 server-clock ledger: the last SERVER-APPLIED `trips.updated_at` per trip
 *  id. Written ONLY from hydration, the shared/public/invite/trash fetchers and
 *  applyRealtimeEvent — NEVER from optimistic mutations. This is the only
 *  honest clock for the stale-update guard: `Trip.updatedAt` on the cache is
 *  the optimistic client clock (`mutateTrip` bumps it to `Date.now()` on every
 *  local edit), so after any local edit it outranks the server's `updated_at`
 *  forever and a guard comparing against it would suppress every real remote
 *  edit. DB clock vs DB clock, mirrored on recentLocalWrites above (bounded
 *  map; per-id entries are re-seeded by every hydrate, so an account switch
 *  self-corrects for any trip the new session can see). */
const serverTripTimestamps = new Map<string, number>()
const MAX_SERVER_TRIP_TS = 500

function recordServerTripTimestamp(id: string, raw: unknown): void {
  const n = Number(raw)
  if (!Number.isFinite(n)) return
  // #579 — LRU promotion, the same delete-then-set as markLocalWrite: a
  // re-seeded id (every hydrate re-records the trips the user can see, and
  // those are exactly the actively-edited ones) must move to the end of the
  // iteration order, or the eviction below drops the live entry first.
  serverTripTimestamps.delete(id)
  serverTripTimestamps.set(id, n)
  if (serverTripTimestamps.size > MAX_SERVER_TRIP_TS) {
    const oldestKey = serverTripTimestamps.keys().next().value
    if (oldestKey) serverTripTimestamps.delete(oldestKey)
  }
}

/** Test hook — clear the server-timestamp ledger (see _clearRecentLocalWrites). */
export function _clearServerTripTimestamps(): void {
  serverTripTimestamps.clear()
}

/** Test hooks — read one entry from each bounded ledger, so the #579 eviction
 *  policy can be asserted without exporting the maps. */
export function _serverTripTimestampEntry(id: string): number | undefined {
  return serverTripTimestamps.get(id)
}

export function _recentLocalWriteEntry(table: string, id: string): number | undefined {
  return recentLocalWrites.get(`${table}:${id}`)
}

/** Realtime payloads come off the wire, so they are not ours to trust. An
 *  unexpected shape throws, and a throw from inside a `postgres_changes` callback
 *  escapes into the realtime client's own event dispatch instead of stopping
 *  here: the worst case is the subscription going down with nothing said out
 *  loud, and the user carries on editing a trip that is no longer live, with no
 *  error on screen and no hint that collaborators have moved on. One bad event
 *  must cost one event, not the session.
 *
 *  Note the try/catch in connectRealtime below only covers setting the
 *  subscription up - it cannot catch anything a callback throws minutes later.
 *  Issue #44. */
function dispatchRealtimeEvent(table: string, payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
  try {
    applyRealtimeEvent(table, payload)
  } catch (e) {
    console.error(`[yatraflow] realtime ${table} event dropped`, e)
  }
}

/** Test hook — feed a postgres_changes payload into the dispatch without a
 *  live channel (dispatchRealtimeEvent is module-private). Containment try/
 *  catch included, matching the real path exactly. */
export function _applyRealtimeEventForTest(table: string, payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
  dispatchRealtimeEvent(table, payload)
}

/** Test hook — move the identity generation, as a real auth event does. A test
 *  that switches the cached user id without this would leave `resumeSync`'s
 *  `isCurrentIdentity` guard reading the OLD epoch, which is not the state a
 *  sign-in produces. */
export function _bumpIdentityEpochForTest(): void {
  ++identityEpoch
}

/** Test hooks over the existing adminSession seams, so a lifecycle test can
 *  prove that a mid-run authority change is visible to the private reads (they
 *  check the flag at call time, not once per hydrate). */
export function _setAdminForTest(admin: boolean): void {
  setAdminForTest(admin)
}

export function _isAdminForTest(): boolean {
  return isAdminCached()
}

/** Test hook — install a catalogue the way a hydrate does, under the authority
 *  that is current now.
 *
 *  A fixture that assigns `cache.users` directly is a SECOND WRITER: the
 *  authority gate cannot see it, so the stamp stays null and every private row
 *  the fixture planted is treated as unauthorised on the next install. That is
 *  the correct reading of a state the real store cannot reach, and it is exactly
 *  why a fixture must come through here instead. */
export function _installUsersForTest(users: CachedUser[]): void {
  const ticket = currentTicket()
  installCatalog(ticket, {
    public: { users: users.map(toPublicUser), failed: false, complete: false, requested: false },
    self: { status: 'not-requested' },
    admin: { status: 'not-requested' },
  }, {
    ownerUserId: ticket.scope.userId,
    identityEpoch: ticket.scope.identityEpoch,
    authorityEpoch: ticket.scope.authorityEpoch,
    selfAuthorized: users.some(u => u.id === ticket.scope.userId && u.kind === 'private'),
    users,
  })
}

/** Test hook — run the real full-row loader the join and gate paths use, so a
 *  test can prove what a read does to the cache without a live session. */
export function loadTripForTest(tripId: ID): Promise<LoadOutcome> {
  return loadFullTripIntoCache(tripId)
}

/** Test hook for the same access-floor check used by live write paths. */
export function canSendTripWriteForTest(tripId: ID): boolean {
  const scope = identityScope()
  if (!scope) return false
  return canSendTripWrite(scope, tripId, tripAccessEpochs.get(tripId) ?? 0)
}

/** Start listening for row changes. Call after a successful hydration. */
let realtimeIdentity: IdentityScope | null = null

export function connectRealtime(userId: string): void {
  const scope = { userId, epoch: identityEpoch }
  if (!isSupabaseConfigured || !isCurrentIdentity(scope)) return
  if (realtimeChannel && realtimeIdentity?.userId === userId && realtimeIdentity.epoch === scope.epoch) return
  disconnectRealtime()
  try {
    let everSubscribed = false
    const channel = supabase.channel('yatraflow-live')
    const live = () => realtimeChannel === channel && isCurrentIdentity(scope)
    for (const t of RESYNC_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, p => {
        if (live()) dispatchRealtimeEvent(t, p)
      })
    }
    realtimeChannel = channel
    realtimeIdentity = scope
    channel.subscribe(status => {
      if (!live() || status !== 'SUBSCRIBED') return
      if (!everSubscribed) { everSubscribed = true; return }
      void resyncTripsAfterReconnect(scope)
    })
  } catch (error) {
    console.error('[yatraflow] realtime subscribe failed', error)
    realtimeChannel = null
    realtimeIdentity = null
  }
}

/** Replay every cached trip as a synthetic UPDATE dispatch (same handler as a
 *  live event) so anything that changed while the socket was down re-lands.
 *  Each trip refetches ITS OWN row — a select of the cached ids keeps the
 *  payload bounded and lets RLS/the tombstone filter apply per row normally.
 *  Failures are logged, not thrown: a failed resync leaves the cache as-is
 *  (stale but consistent), and the next successful event or reload repairs it. */
/** #568 — the tables the reconnect resync reconciles, in ONE place: every
 *  subscription in connectRealtime has a companion here, and the source pin
 *  keeps the two lists in step — the next table added to the channel has a
 *  single companion to update, which is the artifact whose absence let the
 *  first seven slices go stale on every laptop sleep. */
const RESYNC_TABLES = [
  'trips', 'trip_members', 'suggestions', 'decisions', 'activity',
  'notifications', 'profile_cards', 'published_itineraries', 'admin_audit',
] as const

/** Feed a synthetic postgres_changes payload through the SAME dispatch a live
 *  event takes — no bypass, no second code path: the echo window, the B2
 *  ledger and the stale-guard semantics apply to a resynced row exactly as to
 *  a live one. */
function feedSynthetic(table: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE', newRow: unknown, oldRow: unknown = {}): void {
  applyRealtimeEvent(table, {
    eventType,
    schema: 'public',
    table,
    commit_timestamp: new Date().toISOString(),
    old: oldRow,
    new: newRow,
  } as unknown as Parameters<typeof applyRealtimeEvent>[1])
}

/** A row DELETED during the socket gap leaves a phantom if the resync only
 *  adds: the refetch cannot see it, so only a sweep can. Every cached row the
 *  refetch no longer returns feeds a synthetic DELETE through the dispatch.
 *  Scoped to what the refetch actually covers — a row outside that scope was
 *  never evidence of anything. */
function sweepPhantoms(
  table: 'suggestions' | 'decisions' | 'activity',
  tripIds: string[],
  fetchedIds: Set<string>,
): void {
  const slice = table === 'suggestions' ? cache.suggestions : table === 'decisions' ? cache.decisions : cache.activity
  for (const cached of slice) {
    if (!tripIds.includes(cached.tripId) || fetchedIds.has(cached.id)) continue
    feedSynthetic(table, 'DELETE', {}, { id: cached.id })
  }
}

async function resyncTripsAfterReconnect(scope: IdentityScope): Promise<void> {
  const live = () => isCurrentIdentity(scope)
  if (!live()) return
  // Each slice reconciles independently: one flaky read must not strand the
  // slices after it — the next resync only happens at the NEXT reconnect.
  const step = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try { if (live()) await fn() } catch (e) { console.error(`[yatraflow] reconnect resync (${label}) failed`, e) }
  }
  // The lifecycle status is checked BEFORE the row reads, and always against the
  // server. A socket gap can hide a disablement that landed while it was down,
  // and every read below would then answer as an enabled account. This is the
  // authoritative check, not the cache's opinion of itself.
  //
  // It runs OUTSIDE the trip-count gate below: a new account, or an admin with no
  // trips, still has to learn that it was disabled.
  await step('caller status', async () => { await recheckDisabledStatus() })
  // The private rows this authority covers are re-read too. The reconnect's
  // profile step reads only the public projection, so a private change that
  // landed during the gap would otherwise stay stale for as long as the socket
  // stayed down. Coalesced, so a reconnect that replays one event per row issues
  // a single private read.
  await step('private profiles', async () => { await coalescedPrivateRefresh(currentTicket()) })
  const ids = cache.trips.map(t => t.id)
  if (!ids.length) return
  await step('trips', async () => {
    const { data, error } = await supabase.from('trips').select('*').in('id', ids)
    if (!live()) return
    if (error) throw error
    for (const row of (data ?? []) as Record<string, unknown>[]) feedSynthetic('trips', 'UPDATE', row)
  })
  // The collaborative slices, scoped per trip like hydration scopes them.
  await step('collab', async () => {
    for (const table of ['suggestions', 'decisions', 'activity'] as const) {
      const { data, error } = await supabase.from(table).select('*').in('trip_id', ids)
      if (!live()) return
      if (error) throw error
      const rows = (data ?? []) as Record<string, unknown>[]
      sweepPhantoms(table, ids, new Set(rows.map(r => String(r.id))))
      for (const row of rows) feedSynthetic(table, 'INSERT', row)
    }
  })
  // Per-USER scope, never per-trip — the RLS policy shapes the query.
  await step('notifications', async () => {
    const me = cache.sessionUserId
    if (!me) return
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', me)
    if (!live()) return
    if (error) throw error
    const rows = (data ?? []) as Record<string, unknown>[]
    const fetchedIds = new Set(rows.map(r => String(r.id)))
    for (const cached of cache.notifications) {
      if (cached.userId !== me || fetchedIds.has(cached.id)) continue
      feedSynthetic('notifications', 'DELETE', {}, { id: cached.id })
    }
    for (const row of rows) feedSynthetic('notifications', 'INSERT', row)
  })
  // Known-trip membership changes (unknown trips take the INSERT path into
  // fetchTripIntoCache inside the case). A missing OWN row evicts through
  // the same branch a live DELETE uses.
  await step('trip_members', async () => {
    const { data, error } = await supabase.from('trip_members').select('*').in('trip_id', ids)
    if (!live()) return
    if (error) throw error
    const rows = (data ?? []) as Record<string, unknown>[]
    const fetchedKeys = new Set(rows.map(r => `${String(r.trip_id)}:${String(r.user_id)}`))
    for (const tripId of ids) {
      for (const m of tripById(tripId)?.members ?? []) {
        if (!fetchedKeys.has(`${tripId}:${m.userId}`)) feedSynthetic('trip_members', 'DELETE', {}, { trip_id: tripId, user_id: m.userId })
      }
    }
    for (const row of rows) feedSynthetic('trip_members', 'INSERT', row)
  })
  await step('profile_cards', async () => {
    // #800: the reconnect resync reads the PUBLIC projection, never the private
    // table. A throw here is a failed read, which is the honest outcome — the
    // alternative (falling back to the private table) is exactly the boundary
    // this change closes.
    const { data, error } = await supabase.rpc('get_public_profile_cards', {})
    if (!live()) return
    if (error) throw error
    // Upsert-only, no phantom sweep: there is no scoping that makes a missing
    // card evidence of deletion, and the cost of a stale name for a deleted
    // account is nil.
    for (const row of (Array.isArray(data) ? data : []) as Record<string, unknown>[]) {
      feedSynthetic('profile_cards', 'INSERT', row)
    }
  })
  await step('published_itineraries', async () => {
    const { data, error } = await supabase.from('published_itineraries').select('*')
    if (!live()) return
    if (error) throw error
    const rows = (data ?? []) as Record<string, unknown>[]
    const fetchedIds = new Set(rows.map(r => String(r.id)))
    // A publication unpublished mid-gap must LEAVE the cache — the stale-pub
    // face is half this issue.
    for (const cached of cache.published) {
      if (fetchedIds.has(cached.id)) continue
      feedSynthetic('published_itineraries', 'DELETE', {}, { id: cached.id })
    }
    for (const row of rows) feedSynthetic('published_itineraries', 'INSERT', row)
  })
  await step('admin_audit', async () => {
    const { data } = await fetchAdminAuditRows()
    if (!live()) return
    // Append-only log, INSERT-only case, always PREPENDED — feed oldest-first
    // so the newest ends up first, exactly as the live events would have.
    const rows = ((data ?? []) as Record<string, unknown>[]).slice().reverse()
    for (const row of rows) feedSynthetic('admin_audit', 'INSERT', row)
  })
}

/** Tear down the channel. Call on sign-out. */
export function disconnectRealtime(): void {
  const channel = realtimeChannel
  realtimeChannel = null
  realtimeIdentity = null
  if (channel) {
    try { void Promise.resolve(supabase.removeChannel(channel)).catch(() => {}) } catch { /* The identity guard already closed it. */ }
  }
}

function applyRealtimeEvent(table: string, payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
  const event = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'
  const row = payload.new as Record<string, any> | undefined
  const oldRow = payload.old as Record<string, any> | undefined
  // #567 — the row key is PER-TABLE. `trip_members` has no `id` column (its
  // primary key is the composite (trip_id, user_id)), and its case below never
  // reads `id` — but the generic guard used to demand one, so every real
  // membership payload was dropped before its case ever ran: remote evictions
  // did not evict, remote joins never appeared, role changes never landed.
  // The composite string keys the dispatch; the case itself keeps reading
  // trip_id/user_id. Every other table keys on `id`, which stays guarded.
  let id: string
  if (table === 'trip_members') {
    const tripId: string | undefined = row?.trip_id ?? oldRow?.trip_id
    const userId: string | undefined = row?.user_id ?? oldRow?.user_id
    if (!tripId || !userId) return
    id = `${tripId}:${userId}`
  } else {
    const key: string | undefined = row?.id ?? oldRow?.id
    if (key === undefined) return
    id = key
  }

  switch (table) {
    case 'trips': {
      // Removal outranks local echo suppression and saved overlays.
      if (event === 'DELETE' || row?.deleted_at) {
        // The trip is gone from the server. The trip leaves the list, but the
        // owner's queued copy stays on the device with the reason attached, so
        // it can still be downloaded. A deleted trip is never resurrected.
        if (cache.sessionUserId) invalidateTripWork(id, cache.sessionUserId, 'trip-unavailable')
        cache.trips = cache.trips.filter(t => t.id !== id)
        cache.suggestions = cache.suggestions.filter(s => s.tripId !== id)
        cache.decisions = cache.decisions.filter(d => d.tripId !== id)
        cache.activity = cache.activity.filter(a => a.tripId !== id)
        cache.notifications = cache.notifications.filter(n => n.tripId !== id)
        break
      }
      const held = queuedLocalTrips.get(id)
      if (held?.ownerId === cache.sessionUserId) {
        recordServerTripTimestamp(id, row?.updated_at)
        break
      }
      if (echoWindowEh('trips', id)) {
        // Our own write's echo: suppress the row swap, but record the server's
        // updated_at in the B2 ledger so the NEXT remote row for this trip is
        // compared against the clock the DB actually wrote (M6 B2). The
        // cache's Trip.updatedAt stays the optimistic client clock — nothing
        // derives the guard from it.
        if (event === 'UPDATE') recordServerTripTimestamp(id, row?.updated_at)
        break
      }
      {
        const existing = tripById(id)
        const incoming = rowToTrip(row as TripRow, existing?.members ?? [])
        if (event === 'UPDATE') {
          // B2 stale-update guard — TRIPS ONLY (the generic reduceSlice stays
          // plain: no other table carries a comparable timestamp pair;
          // profiles has no updated_at at all), and against the SERVER ledger
          // above, never Trip.updatedAt. STRICTLY older rows are replays and
          // are dropped; EQUAL timestamps APPLY — before
          // 20260919_trip_touch_updated_at.sql is applied, updated_at never
          // advances, so equal is every remote update's normal case (see
          // isStaleServerRow). The echo window above already handled our own
          // writes, so this only ever drops genuinely remote stale rows.
          if (isStaleServerRow(serverTripTimestamps.get(id), row?.updated_at)) break
          recordServerTripTimestamp(id, row?.updated_at)
        }
        cache.trips = reduceSlice(cache.trips, event, incoming, oldRow?.id)
      }
      break
    }
    case 'trip_members': {
      const tripId: string = row?.trip_id ?? oldRow?.trip_id
      if (!tripId) return
      const userId: string = row?.user_id ?? oldRow?.user_id
      if (!userId) return
      const trip = tripById(tripId)
      // B-3 — do NOT bump the access epoch for this client's OWN join.
      //
      // The echo of the membership row this client just wrote arrives before the
      // join's full-row load finishes. On an uncached trip (which is exactly the
      // invite case) `!trip` is true, so the branch below treated the user's own
      // new grant as a permission CHANGE and bumped the epoch, and the join's own
      // post-await checks then rejected a join that had actually succeeded.
      //
      // B4 — the exemption is only for the GRANT WE EXPECT: a new editable row
      // for this user on a trip we are joining. An INSERT has no old role, so it
      // is exempt (that is our own row arriving). An UPDATE that REMOVES the
      // edit right is a downgrade, not our echo, and must still invalidate.
      // R3 — the exemption is the EXPECTED INSERT of our own live join. An
      // UPDATE is never exempt, so a downgrade arriving as an UPDATE always
      // invalidates, and a retired try cannot keep the window open.
      // B2 (round 10) — the exemption is the EXPECTED INSERT of our own LIVE
      // join, bound to the user, the identity generation and the App's try. A
      // retired try, another account or a later generation cannot keep it open.
      // A probe CLOSES the window first, so the check below can tell "no
      // window" from "a window that just stopped counting".
      const hadWindow = event === 'INSERT' && expectedJoins.has(tripId)
      const expectation = event === 'INSERT' ? expectedJoin(tripId, true) : undefined
      // Our own window existed a moment ago but the try is retired or the
      // account changed. That INSERT can only be our own stale echo, so it does
      // nothing at all: no cache row, no ledger entry, no fetch.
      if (hadWindow && !expectation) return
      const ownJoinEcho = !!expectation && userId === expectation.userId && canEdit(row?.role)
      if (userId === cache.sessionUserId && event !== 'DELETE' && canEdit(row?.role)
        && !ownJoinEcho
        && (!trip ? !editableTripGrants.has(tripId) : !canEdit(roleOf(trip, userId)))) {
        // A new grant invalidates cleanup and fetch work from the previous permission.
        tripAccessEpochs.set(tripId, (tripAccessEpochs.get(tripId) ?? 0) + 1)
        editableTripGrants.add(tripId)
      }
      if (!trip && userId === cache.sessionUserId && event === 'DELETE') invalidateTripWork(tripId, userId, 'access-removed')
      // B1 (round 10) — the observed role is applied on BOTH branches. A cached
      // trip is exactly where the next full read could restore a stale editor
      // row, and the cached branch used to skip the floor entirely.
      observeOwnMembershipRole(tripId, userId, event, row?.role)
      if (!trip) {
        // B4 — a role change for this viewer with no cached trip must still
        // invalidate. The only invalidation on this branch ran inside the
        // `!trip ? ... : ...` test above, which needs an EDITABLE new role, so
        // an uncached DOWNGRADE (editor -> viewer) left the epoch unmoved. A full
        // load already in flight then restored stale editor rights. The role
        // changed either way, so the epoch moves for any role change.
        // R3 — invalidate from the NEW role. A downgrade or a deletion cannot
        // depend on `old.role`: an uncached row, a missing old value, or an
        // unknown UPDATE all take the conservative path, which is what round 8
        // missed when it needed both roles to be present and equal-ish.
        if (userId === cache.sessionUserId && event !== 'DELETE' && !ownJoinEcho) {
          const knownRoles = !!row?.role || !!oldRow?.role
          const downgraded = !!row?.role && !canEdit(row.role)
          const unknownUpdate = event === 'UPDATE' && !knownRoles
          const roleChanged = !!row?.role && !!oldRow?.role && String(row.role) !== String(oldRow.role)
          if (downgraded || unknownUpdate || roleChanged) {
            tripAccessEpochs.set(tripId, (tripAccessEpochs.get(tripId) ?? 0) + 1)
          }
        }
        // A membership row for a trip we don't have yet (we were just added to
        // / joined a trip elsewhere): fetch the whole trip + members. An own
        // echo's load is bound to the try that expects it (see fetchEchoIntoCache).
        if (event !== 'DELETE') void fetchEchoIntoCache(tripId, expectation)
        return
      }
      // If we were removed, the trip disappears from our view. The owner's
      // queued copy stays on the device with the reason attached.
      if (event === 'DELETE' && userId === cache.sessionUserId) {
        invalidateTripWork(tripId, userId, 'access-removed')
        cache.trips = cache.trips.filter(t => t.id !== tripId)
        // #567 — mirror the trips DELETE case: the sibling slices cascade too,
        // or the evicted trip's rows sit orphaned in the cache and resurface
        // stale if the user is re-invited.
        cache.suggestions = cache.suggestions.filter(s => s.tripId !== tripId)
        cache.decisions = cache.decisions.filter(d => d.tripId !== tripId)
        cache.activity = cache.activity.filter(a => a.tripId !== tripId)
        cache.notifications = cache.notifications.filter(n => n.tripId !== tripId)
      } else {
        // A demotion keeps the trip readable, so only the edit right goes.
        if (userId === cache.sessionUserId && !canEdit(row?.role)) {
          invalidateTripWork(tripId, userId, 'access-revoked')
          // The demoted reader must see the shared plan, not the local
          // proposal. The local overlay is dropped from the held copy here,
          // and the shared plan is read under the current identity and the
          // new access generation. The read is a background step, so the
          // dispatch never blocks on the network.
          queuedLocalTrips.delete(tripId)
          void refreshSharedPlanAfterDemotion(tripId)
        }
        mutateTrip(tripId, draft => {
          const role: TripMember['role'] = row?.role === 'owner' || row?.role === 'editor'
            || row?.role === 'commenter' || row?.role === 'viewer' ? row.role : 'viewer'
          draft.members = applyMemberChange(draft.members ?? [], {
            event,
            userId,
            role,
            joinedAt: Number(row?.joined_at ?? oldRow?.joined_at ?? Date.now()),
          })
        }, { touch: false })
      }
      break
    }
    case 'suggestions': {
      const mapped = row ? rowToSuggestion(row) : undefined
      cache.suggestions = reduceSlice(cache.suggestions, event, mapped, oldRow?.id)
      // A canonical row is server truth: refresh the confirmed-ballot
      // baselines, and re-attach every in-flight comment draft a replacement
      // would otherwise hide (gate rounds 3-5).
      if (mapped) noteConfirmedBallots('suggestion', mapped)
      if (id !== undefined) reattachCommentDrafts('suggestion', id)
      break
    }
    case 'decisions': {
      const mapped = row ? rowToDecision(row) : undefined
      cache.decisions = reduceSlice(cache.decisions, event, mapped, oldRow?.id)
      if (mapped) noteConfirmedBallots('decision', mapped)
      if (id !== undefined) reattachCommentDrafts('decision', id)
      break
    }
    case 'activity': {
      if (event === 'DELETE') {
        cache.activity = cache.activity.filter(a => a.id !== id)
        break
      }
      const entry = rowToActivity(row)
      if (!cache.activity.some(a => a.id === entry.id)) cache.activity = [...cache.activity, entry]
      break
    }
    case 'notifications':
      cache.notifications = reduceSlice(cache.notifications, event, row ? rowToNotification(row) : undefined, oldRow?.id)
      break
    case 'profile_cards': {
      // The live channel publishes the PUBLIC projection, so the payload carries
      // the safe columns and never a private one. The mapper is the public one,
      // and the install keeps a private entry for the same id — a live name
      // change must not erase the signed-in user's own account fields.
      //
      // The event is a DELTA, so it is installed as one: the gate takes the fresh
      // card, keeps the entries the delta did not mention, and re-applies the
      // authority revision to whatever survives.
      //
      // The card carries only public fields, so a PRIVATE change that produced it
      // — an admin's disabled flag, a preference — is still stale afterwards.
      // Where the caller is authorised for that row's private half, the event also
      // asks for it, coalesced so a burst shares one read.
      const ticket = currentTicket()
      if (id !== undefined) profileReadRevisions.set(id, (profileReadRevisions.get(id) ?? 0) + 1)
      const merged = event === 'DELETE'
        ? cache.users.filter(u => u.id !== id)
        : mergeUsers(cache.users, [rowToPublicUser(row)])
      installCatalog(ticket, {
        public: { users: merged.map(toPublicUser), failed: false, complete: false, requested: false },
        self: { status: 'not-requested' },
        admin: { status: 'not-requested' },
      }, {
        ownerUserId: ticket.scope.userId,
        identityEpoch: ticket.scope.identityEpoch,
        authorityEpoch: ticket.scope.authorityEpoch,
        selfAuthorized: cache.catalogAuthority?.selfAuthorized ?? false,
        users: merged,
      })
      if (privateRefreshRelevant(ticket, id)) void coalescedPrivateRefresh(ticket)
      break
    }
    case 'published_itineraries':
      cache.published = reduceSlice(cache.published, event, row ? rowToPublished(row) : undefined, oldRow?.id)
      break
    case 'admin_audit': {
      // #367: a new audit row lands live. INSERT-only by contract (append-only
      // log, no UPDATE/DELETE policy), and always prepended — the tab renders
      // newest-first. Only meaningful for admins: the read policy withholds
      // the rows from everyone else, so a non-admin never gets here with data.
      if (event === 'INSERT' && row && isAdminCached()) {
        cache.adminAudit = [adminAuditRowToEntry(row as unknown as AuditRowShape), ...cache.adminAudit]
      }
      break
    }
    default:
      return
  }
  commit()
}

/**
 * #804 (round 10 B2) — the load an own membership echo starts.
 *
 * The echo of this client's own new membership row is loaded under the try that
 * expected it. Two checks bind that load to the try:
 *  - `expectedJoin` again at the ARRIVAL, so an echo that lands after the try
 *    retired (or after the account changed) starts no read at all;
 *  - the same check again at ADMISSION, so a retirement during the read
 *    publishes nothing.
 */
function fetchEchoIntoCache(tripId: string, expectation: JoinExpectation | undefined): void {
  if (!expectation) {
    void fetchTripIntoCache(tripId)
    return
  }
  if (expectedJoin(tripId) !== expectation) return
  void fetchTripIntoCache(tripId, () => expectedJoin(tripId) === expectation)
}

/** Fetch a trip row + its members into the cache (used on join/share events). */
async function fetchTripIntoCache(tripId: string, guard?: AttemptGuard): Promise<void> {
  const scope = identityScope()
  if (!scope || !isCurrentIdentity(scope) || (guard ? !guard() : false)) return
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  const key = `${scope.epoch}:${scope.userId}:${tripId}:${accessEpoch}`
  const inflight = tripFetches.get(key)
  if (inflight) return inflight
  const fetch = (async () => {
    // C1 — the echo path captures its own bearer and pins both reads, exactly as
    // the join loader does.
    const token = await tripWriteToken(scope, guard)
    if (!token || !isCurrentIdentity(scope) || (tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch || (guard ? !guard() : false)) return
    const [tripRes, memRes] = await Promise.all([
      supabase.from('trips').select('*').eq('id', tripId).setHeader('Authorization', `Bearer ${token}`).maybeSingle(),
      supabase.from('trip_members').select('*').eq('trip_id', tripId).setHeader('Authorization', `Bearer ${token}`),
    ])
    if (tripRes.error || memRes.error || !tripRes.data) return
    // R2 — the echo path uses the SAME admission as the join loader, so a row
    // with an unusable revision cannot be cached here either (B5).
    admitFullRow({
      requestedTripId: tripId,
      row: tripRes.data as TripRow,
      members: (memRes.data ?? []) as MemberRow[],
      scope,
      accessEpoch,
      guard,
    })
  })()
  tripFetches.set(key, fetch)
  try { await fetch } finally { if (tripFetches.get(key) === fetch) tripFetches.delete(key) }
}

/** Trips with a select currently in flight, so a burst of events for one trip
 *  costs one round-trip. #36-15. */
const tripFetches = new Map<string, Promise<void>>()

// ---------------- Presence (M6 · B1) ----------------

/** The realtime client presence sessions run on — null when no backend is
 *  compiled in, so the UI hook degrades to a no-op instead of throwing on the
 *  placeholder project. Components never import the client directly; this is
 *  the one door (matches every other surface's store-only rule). */
export function presenceClient(): SupabaseClient | null {
  return isSupabaseConfigured ? supabase : null
}

// ---------------- utils ----------------

/**
 * supabase-js builders are LAZY. The constructor only copies config; the request is
 * issued from inside `then()`. So `void supabase.from(…).update(…)` builds a request,
 * discards it, and never sends a byte — and since nothing awaited it, there is no
 * rejection to notice either. Anything fire-and-forget must be thened explicitly.
 *
 * `table` is only for the log line: a write rejected by RLS or a drifted column used
 * to be invisible forever. The UI has already moved on optimistically, so this must
 * never throw. Issue #52.
 */
function fire(table: string, query: PromiseLike<{ error: { message?: string } | null }>): void {
  void Promise.resolve(query).then(
    res => { if (res?.error) console.error(`[yatraflow] ${table} write failed`, res.error) },
    err => console.error(`[yatraflow] ${table} write rejected`, err),
  )
}

/**
 * Real UUID for top-level table ids (trips, suggestions, decisions, activity,
 * notifications). Postgres PK/FK columns are `uuid` — the prefixed ids from
 * seed.ts's uid() are only valid *inside* JSONB (stops, days, expenses, …).
 */
const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16).padStart(12, '0')}-${Math.random().toString(16).slice(2, 6)}-4${Math.random().toString(16).slice(2, 5)}-a${Math.random().toString(16).slice(2, 5)}-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`

function diffDays(a: string, b: string): number {
  // The creation guarantee, applied visibly at the store's boundary (#376):
  // a trip always has at least one day, even when the dates are missing,
  // garbage or inverted. The shared helper itself answers 0 honestly.
  return Math.max(1, dayCountForRange(a, b))
}

export const supabaseReady = isSupabaseConfigured
