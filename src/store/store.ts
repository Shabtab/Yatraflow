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
  User, Trip, StopSuggestion, TripDecision, ActivityEntry, Notification,
  PublishedItinerary, ID, ItineraryStop, ItineraryDay, TripMember, Expense, FixedCommitment,
} from '../data/types'
import { seedData, uid } from '../data/seed'
import type { LatLngPoint } from '../data/types'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { toast } from '../components/ui'
import { isMissingColumnError, rowToTrip, tripToRow, type OptionalColumnsProbe, type TripRow } from '../lib/tripRow'
import { makeInviteCode, normalizeInviteCode } from '../lib/inviteCode'
import { suggestionToRow, decisionToRow, activityToRow, notificationToRow, publishedToRow } from '../lib/restoreRows'
import { reduceSlice, applyMemberChange, isRecentLocalWrite } from '../lib/realtimeCore'
import { MISSING_BACKEND_MESSAGE, describeAuthFailure } from '../lib/authErrors'
import { adminFromSession, clearAdminCache, isAdminCached } from '../lib/adminSession'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

// In-memory cache — the synchronous snapshot the UI reads. No localStorage.
interface DB {
  users: User[]               // profiles mirror (for names/avatars in the UI)
  trips: Trip[]
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
}

let cache: DB = {
  users: [], trips: [], suggestions: [], decisions: [],
  activity: [], notifications: [], published: [], adminAudit: [], sessionUserId: null,
  ready: false,
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

export function usePublished(): PublishedItinerary[] {
  return useSyncExternalStore(subscribe, () => cache.published)
}

export function useUsers(): User[] {
  return useSyncExternalStore(subscribe, () => cache.users)
}

export function useNotifications(): Notification[] {
  return useSyncExternalStore(subscribe, () => cache.notifications)
}

export function useSessionUserId(): ID | null {
  return useSyncExternalStore(subscribe, () => cache.sessionUserId)
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
  if (opts.log && cache.sessionUserId) addActivity(tripId, cache.sessionUserId, opts.log, opts.target)
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

// ---------------- Supabase row <-> domain mapping ----------------
// rowToTrip / tripToRow live in src/lib/tripRow.ts (pure, unit-tested).

interface ProfileRow {
  id: string; email: string; name: string; avatar_url?: string; home_city?: string;
  languages: string[]; travel_styles: string[]; is_creator: boolean; creator_bio?: string;
  social_links?: { youtube?: string; instagram?: string }; created_at: number;
  /** present only after the masteradmin migration (see 20260909_masteradmin.sql) */
  is_disabled?: boolean;
}

/** Shape of a trip_members row as stored in Postgres (snake_case). */
interface MemberRow {
  trip_id: string; user_id: string; role: TripMember['role']; joined_at: number;
}

function rowToUser(row: unknown): User {
  const r = row as ProfileRow
  return {
    id: r.id, email: r.email, createdAt: r.created_at,
    profile: {
      name: r.name, avatarUrl: r.avatar_url, homeCity: r.home_city,
      languages: r.languages ?? ['en'], travelStyles: (r.travel_styles ?? ['balanced']) as User['profile']['travelStyles'],
      isCreator: r.is_creator, creatorBio: r.creator_bio, socialLinks: r.social_links,
      isDisabled: r.is_disabled ?? false,
    },
  }
}

// ---------------- Auth ----------------

export function currentUser(db: DB = getSnapshot()): User | null {
  return db.users.find(u => u.id === db.sessionUserId) ?? null
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

/** Email/password sign up via Supabase Auth. Profile row is created by the DB trigger. */
export async function signup(name: string, email: string, password: string): Promise<{ ok: boolean; error?: string }> {
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
    // Supabase may require email confirmation; surface that gently.
    if (data.session === null) {
      return { ok: false, error: 'Check your email to confirm your account, then log in.' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: describeAuthFailure(e, { configured: true }) }
  }
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut()
  clearAdminCache()
  // onAuthStateChange handler clears the cache.
}

/** A disabled account can still complete Auth (Supabase has no soft-delete),
 *  but the RESTRICTIVE "deny disabled" policies make every table read as
 *  denied. Signing in successfully and then staring at empty catalogs would
 *  read as "my data got deleted", so hydrate checks the flag right after the
 *  session resolves and signs the account straight back out with a message. */
export async function enforceDisabledCheck(): Promise<boolean> {
  try {
    // No extra auth round-trip here: hydrate() awaits this inside Promise.all
    // territory, and an unmocked getUser() hangs the mocked tests. The
    // in-hand cache already carries the flag (rowToUser maps is_disabled).
    const me = cache.sessionUserId ? cache.users.find(u => u.id === cache.sessionUserId) : undefined
    if (me?.profile.isDisabled === true) {
      await supabase.auth.signOut()
      clearAdminCache()
      toast('This account has been disabled. Contact support if you think this is a mistake.', 'err')
      return true
    }
    return false
  } catch {
    // A failed check must never lock a legitimate user out: the RESTRICTIVE
    // policies are the real enforcement, this is only the friendly message.
    return false
  }
}

// ---------------- Init / hydration ----------------

/** Guard against duplicate concurrent hydrations. On app load BOTH
 *  `getSession()` and the `onAuthStateChange()` "SIGNED_IN" event fire, which
 *  started two `hydrateFromSupabase` calls racing. The second one's full
 *  `patch({ trips })` overwrote the first's cache mid-seed — the seed appends
 *  the 10 trips AFTER that patch — so the trips loaded and then vanished. A
 *  redundant hydrate for the same user now just awaits the in-flight one. */
let activeHydrate: { userId: string | null; promise: Promise<void> } | null = null

/** Monotonic id of the newest auth intent. Every auth event (sign-in, account
 *  switch, sign-out) bumps it, and a hydrate commits its `patch()` only while its
 *  own generation is still current. Without this, `hydrate(null)` on logout
 *  cleared the cache and nulled `activeHydrate` while a hydrate was still in
 *  flight, and that hydrate then re-patched the PREVIOUS user's trips — and their
 *  `sessionUserId` — into the emptied cache, so the next person on that browser
 *  could see, and be treated as, the account that had just signed out. Issue #45. */
let hydrateGen = 0

/** Call once on app mount. Subscribes to auth and hydrates the cache. */
export function init(): void {
  if (initialized) return
  initialized = true

  const hydrate = async (userId: string | null) => {
    // Same-user dedupe FIRST, generation bump second. The old order bumped
    // hydrateGen for EVERY call — so the load-time double-fire (getSession +
    // onAuthStateChange INITIAL_SESSION, both with the SAME user) marked the
    // first hydrate's patch stale (`gen !== hydrateGen`) while the second call
    // merely awaited the first's promise and returned. Net effect: the data
    // was fetched (all 200s) but NOBODY patched it into the cache — the app
    // rendered logged-out on every refresh with a perfectly valid token.
    // hydrateGen still guards real account switches (sign-out / switch):
    // those change userId, so they never hit the dedupe branch.
    if (userId && activeHydrate && activeHydrate.userId === userId) {
      await activeHydrate.promise
      return
    }
    const gen = ++hydrateGen

    if (!userId) {
      clearAdminCache()
      // Anonymous user: fetch global catalogs (published itineraries + profiles) but skip user-specific data.
      // Explore needs published itineraries to work for logged-out users.
      // Serialized like the signed-in path: getSession + onAuthStateChange both
      // fire hydrate(null) on a cold load, which used to double-fetch.
      disconnectRealtime()
      if (activeHydrate && activeHydrate.userId === null) { await activeHydrate.promise; return }
      const anonPromise = (async () => {
      try {
        const [profRes, pubRes] = await Promise.all([
          supabase.from('profiles').select('*'),
          supabase.from('published_itineraries').select('*'),
        ])
        const users = mapOrSkip((profRes.data ?? []), rowToUser)
        const pubRows = mapOrSkip((pubRes.data ?? []), rowToPublished)
        if (profRes.error) { console.error('[yatraflow] hydrate profiles failed', profRes.error) }
        if (pubRes.error) { console.error('[yatraflow] hydrate published failed', pubRes.error) }
        // The catalog has no backing trips in this cache — an empty valid-set
        // made dedupePublished discard EVERY row as an "orphan". The rows' own
        // tripIds are the valid set for the public gallery.
        patch({ users, trips: [], suggestions: [], decisions: [], activity: [], notifications: [], published: dedupePublished(pubRows, new Set(pubRows.map(r => r.tripId))), adminAudit: [], sessionUserId: null, ready: true })
        commit()
      } catch (e) {
        console.error('[yatraflow] anonymous hydration failed', e)
        patch({ users: [], trips: [], suggestions: [], decisions: [], activity: [], notifications: [], published: [], adminAudit: [], sessionUserId: null, ready: true })
        commit()
      }
      })()
      activeHydrate = { userId: null, promise: anonPromise }
      try { await anonPromise } finally { if (activeHydrate?.userId === null) activeHydrate = null }
      return
    }
    // The same-user dedupe already ran at the top of hydrate(); reaching here
    // means this user has no in-flight hydrate, so start one.
    const promise = hydrateFromSupabase(userId, gen)
    activeHydrate = { userId, promise }
    try { await promise } finally {
      if (activeHydrate?.userId === userId) activeHydrate = null
    }
    // First settle of this session flips the app-wide loading gate, whatever
    // the outcome — pages stop showing "loading" and may show real empties.
    if (!cache.ready) { patch({ ready: true }); commit() }
    // Only go live for the account the cache still belongs to: a sign-out or an
    // account switch during the hydration above bumped hydrateGen.
    if (gen === hydrateGen && cache.sessionUserId === userId) connectRealtime(userId)
  }

  supabase.auth.getSession().then(({ data }) => {
    adminFromSession(data.session ?? null)
    void hydrate(data.session?.user?.id ?? null)
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    adminFromSession(session ?? null)
    void hydrate(session?.user?.id ?? null)
  })
}

async function hydrateFromSupabase(userId: string, gen: number, seedIfEmpty = true): Promise<void> {
  try {
    // Stage 1 - global catalogs + the user's memberships. Explore reads the curated
    // published_itineraries table and profiles are small rows for user avatars,so
    // those stay global. Every per-trip table is SCOPED to the user's membership.
    // Before, `trips.select('*')` pulled EVERY public row the token could select
    // (the whole catalog, ~1000 trips) into "My Trips",drowning the user's own
    // trips and letting a malformed foreign row crash a workspace render (which
    // looked like the trip "disappeared").
    const [profRes, pubRes, myMembershipsRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('published_itineraries').select('*'),
      supabase.from('trip_members').select('*').eq('user_id', userId),
    ])
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
    if (profRes.error) { console.error('[yatraflow] hydrate profiles failed', profRes.error); partial.push('profiles') }
    const profiles = (profRes.data ?? []) as ProfileRow[]
    if (myMembershipsRes.error) { console.error('[yatraflow] hydrate memberships failed', myMembershipsRes.error); partial.push('memberships') }
    const myRows = (myMembershipsRes.data ?? []) as MemberRow[]
    const memberTripIds = myRows.map(m => m.trip_id)
    const myTripIds = [...new Set(memberTripIds)]

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
    if (admin) {
      // The mock builder in tests/hydrate-race.test.ts has no order()/limit()
      // chainables, and production PostgREST needs limit() AFTER order() —
      // so audit reads go through a tiny helper that degrades gracefully.
      const [tripsRes, memRes, sugRes, decRes, actRes, notRes, auditRes] = await Promise.all([
        supabase.from('trips').select('*'),
        supabase.from('trip_members').select('*'),
        supabase.from('suggestions').select('*'),
        supabase.from('decisions').select('*'),
        supabase.from('activity').select('*'),
        supabase.from('notifications').select('*').eq('user_id', userId),
        fetchAdminAuditRows(),
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
      trips = (tripsRes.data ?? []) as TripRow[]
      members.push(...((memRes.data ?? []) as MemberRow[]))
      suggestions = mapOrSkip((sugRes.data ?? []), rowToSuggestion)
      decisions = mapOrSkip((decRes.data ?? []), rowToDecision)
      activity = mapOrSkip((actRes.data ?? []), rowToActivity)
      notifications = mapOrSkip((notRes.data ?? []), rowToNotification)
    }

    const users = mapOrSkip(profiles, rowToUser)
    const tripList = mapOrSkip(trips, row =>
      rowToTrip(row as TripRow, members.filter(m => m.trip_id === (row as TripRow).id).map(m => ({ userId: m.user_id, role: m.role, joinedAt: m.joined_at })))
    )

    const pubRows = mapOrSkip((pubRes.data ?? []), rowToPublished)
    if (pubRes.error) { console.error('[yatraflow] hydrate published failed', pubRes.error); partial.push('suggested itineraries') }

    // Explore shows OTHER creators' itineraries too, and forking needs the
    // underlying trip. The old dedupe call passed only the user's own trip ids,
    // so every foreign publication was discarded as an "orphan". Fetch the
    // catalog trips (members via the same trip_members table).
    const pubTripIds = [...new Set(pubRows.map(r => r.tripId))]
    const missingPubIds = pubTripIds.filter(id => !tripList.some(t => t.id === id))
    let catalogTrips: Trip[] = []
    if (missingPubIds.length > 0) {
      const [catTripsRes, catMemRes] = await Promise.all([
        supabase.from('trips').select('*').in('id', missingPubIds),
        supabase.from('trip_members').select('*').in('trip_id', missingPubIds),
      ])
      if (catTripsRes.error) { console.error('[yatraflow] hydrate catalog trips failed', catTripsRes.error); partial.push('catalog trips') }
      else {
        const catMemRows = (catMemRes.data ?? []) as MemberRow[]
        catalogTrips = mapOrSkip((catTripsRes.data ?? []) as TripRow[], rawRow => {
          const row = rawRow as TripRow
          return rowToTrip(row, catMemRows.filter(m => m.trip_id === row.id).map(m => ({ userId: m.user_id, role: m.role, joinedAt: m.joined_at })))
        })
      }
    }

    // Stale run — a sign-out or account switch bumped hydrateGen while these
    // queries were in flight. Writing now would leak the previous account's rows
    // (and its sessionUserId) into the new session, so drop the whole patch.
    if (gen !== hydrateGen) return

    patch({
      users,
      trips: [...tripList, ...catalogTrips],
      suggestions,
      decisions,
      activity,
      notifications,
      adminAudit,
      // De-dupe / drop orphan published rows left by earlier buggy seeds (the
      // publishItinerary path mints a fresh id each call - many rows per tripId).
      published: dedupePublished(pubRows, new Set([...tripList, ...catalogTrips].map(t => t.id))),
      sessionUserId: userId,
    })
    commit()

    // #36-18: name what is missing instead of letting a half-loaded account render
    // as an empty one. Deliberately after the staleness check above, so a run that
    // has been superseded cannot toast about an account the user already left.
    if (partial.length > 0) toast(`Some data didn't load (${partial.join(', ')}) - refresh to try again.`, 'err')

    // First-time users get the demo trips seeded into their account. Admins
    // skip the seed: their "empty" is a real empty app, and seeding 10 demo
    // trips into an admin account would pollute the console's totals.
    if (tripList.length === 0 && seedIfEmpty && !admin) await seedDemoFor(userId, gen)
  } catch (e) {
    console.error('[yatraflow] hydration failed', e)
    toast('Could not load your data - check your connection.')
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
    const trip: Trip = { ...structuredClone(t), id: uuid(), members: [owner] }
    const cols = await tripsHaveOptionalColumns()
    const { error } = await supabase.from('trips').insert(tripToRow(trip, userId, cols))
    if (error) { console.error('seed trip failed', error); continue }
    await supabase.from('trip_members').insert({ trip_id: trip.id, user_id: userId, role: 'owner', joined_at: Date.now() })
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

/** Manually load the demo trips into the current account (My Trips button). */
/** Manually load the demo trips into the current account (My Trips button). */
export function addDemoTrips(): void {
  if (!cache.sessionUserId) return
  toast('Adding demo trips…')
  void seedDemoFor(cache.sessionUserId).then(() => toast('Demo trips added'))
}

// ---------------- Row mappers for collaboration tables ----------------

function rowToSuggestion(row: unknown): StopSuggestion {
  const r = row as any
  return {
    id: r.id, tripId: r.trip_id, dayIndex: r.day_index, proposedBy: r.proposed_by,
    title: r.title, category: r.category, locationName: r.location_name, lat: r.lat, lng: r.lng,
    description: r.description, visitMinutes: r.visit_minutes,
    estimatedEntryFeeInr: r.estimated_entry_fee_inr, estimatedTransportInr: r.estimated_transport_inr,
    votes: r.votes ?? [], comments: r.comments ?? [], status: r.status, createdAt: r.created_at,
  }
}
function rowToDecision(row: unknown): TripDecision {
  const r = row as any
  return {
    id: r.id, tripId: r.trip_id, question: r.question, context: r.context,
    options: r.options ?? [], votesByUserId: r.votes_by_user_id ?? {}, status: r.status,
    resolvedOptionId: r.resolved_option_id, raisedBy: r.raised_by, createdAt: r.created_at, resolvedAt: r.resolved_at,
  }
}
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
    publishedAt: r.published_at, refreshedAt: r.refreshed_at ?? undefined, views: r.views ?? 0, copies: r.copies ?? 0,
  }
}

/** De-duplicate published itineraries read from Supabase. Earlier buggy seeds
 *  minted a fresh trip UUID on EVERY run, so each run's published rows carried
 *  a DIFFERENT tripId — a tripId-only dedup couldn't merge them, which flooded
 *  Explore with duplicates. Key by the stable itinerary identity (title +
 *  start location) instead, and drop orphans whose underlying trip no longer
 *  exists, so exactly one card per itinerary survives. */
function dedupePublished(rows: PublishedItinerary[], validTripIds: Set<string>): PublishedItinerary[] {
  const byKey = new Map<string, PublishedItinerary>()
  for (const r of rows) {
    if (!validTripIds.has(r.tripId)) continue // orphan — underlying trip was deleted
    const key = `${r.title}::${Array.isArray(r.routeSummary) ? (r.routeSummary[0] ?? '') : ''}`
    const prev = byKey.get(key)
    if (!prev || (r.publishedAt ?? 0) >= (prev.publishedAt ?? 0)) byKey.set(key, r)
  }
  return [...byKey.values()]
}

// ---------------- Profile ----------------

export function updateProfile(patchFields: Partial<User['profile']>): void {
  const u = currentUser()
  if (!u) return
  const idx = cache.users.findIndex(x => x.id === u.id)
  if (idx >= 0) { cache.users[idx] = { ...cache.users[idx], profile: { ...cache.users[idx].profile, ...patchFields } }; commit() }
  // Fire-and-forget persistence; surface failures without blocking the UI.
  fire('profiles', supabase.from('profiles').update({
    name: patchFields.name, home_city: patchFields.homeCity, languages: patchFields.languages,
    travel_styles: patchFields.travelStyles, is_creator: patchFields.isCreator,
    creator_bio: patchFields.creatorBio, social_links: patchFields.socialLinks,
  }).eq('id', u.id))
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
 */
export async function fetchSharedTrip(tripId: ID, allowInvitePreview = false): Promise<Trip | null> {
  const local = tripById(tripId)
  if (local) return local
  let row: TripRow | null = null
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (error) console.error('[yatraflow] shared trip fetch failed', error)
  if (data) row = data as TripRow
  if (!row && allowInvitePreview) {
    const rpc = await supabase.rpc('get_invite_trip', { p_trip_id: tripId })
    if (rpc.error) console.error('[yatraflow] invite preview fetch failed', rpc.error)
    const rows = rpc.data as TripRow[] | null
    if (Array.isArray(rows) && rows.length > 0) row = rows[0]
  }
  if (!row) return null
  const trip = rowToTrip(row, [])
  if (!cache.trips.some(t => t.id === trip.id)) {
    cache.trips = [...cache.trips, trip]
    commit()
  }
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
  const normalized = normalizeInviteCode(code)
  if (!normalized) return null
  // Already cached (e.g. the user is a member and re-clicks the link)?
  // trip.inviteCode rides on member + fetched rows, so a hit skips the RPC.
  const cached = cache.trips.find(t => t.inviteCode === normalized)
  if (cached) return cached
  const rpc = await supabase.rpc('get_trip_by_invite_code', { p_code: normalized })
  if (rpc.error) console.error('[yatraflow] invite-code lookup failed', rpc.error)
  const rows = rpc.data as TripRow[] | null
  if (!Array.isArray(rows) || rows.length === 0) return null
  const trip = rowToTrip(rows[0], [])
  if (!cache.trips.some(t => t.id === trip.id)) {
    cache.trips = [...cache.trips, trip]
    commit()
  }
  return trip
}

/**
 * Mint (or re-mint) the invite code for one of the viewer's trips and
 * persist it. Codes are shown on the Share tab; minting happens lazily on
 * first share rather than at trip creation, so the DB column can be absent
 * (probe false) without breaking trip creation. A unique clash regenerates
 * the tail; the caller surfaces a final failure honestly.
 */
export async function ensureInviteCode(tripId: ID): Promise<string | null> {
  const t = tripById(tripId)
  if (!t) return null
  if (t.inviteCode) return t.inviteCode
  const cols = await tripsHaveOptionalColumns()
  if (!cols.inviteCode) return null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeInviteCode(t)
    const { error } = await supabase.from('trips').update({ invite_code: code }).eq('id', tripId)
    if (!error) {
      // RLS update policy only lets the owner/editor write; the caller is by
      // construction the owner sharing the trip.
      mutateTrip(tripId, draft => { draft.inviteCode = code }, { touch: false })
      return code
    }
    // Anything but a unique clash is a real failure — report it.
    if (!/duplicate key|unique/i.test(String(error.message ?? ''))) {
      console.error('[yatraflow] invite-code mint failed', error)
      return null
    }
  }
  return null
}

export interface NewTripInput {
  name: string; startLocation: string; destinations: string[];
  startLocationCoords?: LatLngPoint;
  destinationCoords?: (LatLngPoint | null)[];
  startDate: string; endDate: string; travellers: number;
  transportMode: Trip['transportMode']; budgetPerPersonInr: number;
  /** optional km/L for car/motorcycle trips — fuels an accurate transport estimate */
  fuelEconomyKmL?: number;
  /** optional local pump price (₹/L) — defaults to the indicative national average */
  fuelPricePerL?: number;
  /** true when the self-drive route also drives back to its start (default for car/motorcycle) */
  roundTrip?: boolean;
  travelStyle: Trip['travelStyle'];
  fixedCommitments: Omit<FixedCommitment, 'id'>[];
  coverEmoji?: string;
  /** optional owner-chosen cover image URL; when set it is the trip's canonical cover */
  coverImageUrl?: string;
}

// ---------------- Trip dates & day-count reconciliation ----------------

/** Reconcile a trip's `days` array to a new date range: lengthening appends
 *  empty days at the end; shortening drops trailing EMPTY days only. Days
 *  holding stops — or referenced by a fixed commitment — are never silently
 *  deleted; the returned error names the first blocked day so the UI can
 *  tell the user to clear it first. Indexes are re-sequenced after any
 *  change. Pure: no store access, node-testable. */
export function reconcileDays(
  days: ItineraryDay[],
  newStartDate: string,
  newEndDate: string,
  protectedDayIndexes: Set<number> = new Set(),
): { days: ItineraryDay[]; error?: string } {
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
      const blocked = next.slice(target).find(loadBearing)
      return {
        days,
        error: `Day ${(blocked?.index ?? target) + 1} still has stops or a fixed commitment — move or delete them before shortening the trip.`,
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

export function createTrip(ownerId: ID, input: NewTripInput, seedStops?: ItineraryStop[][]): Trip {
  const dayCount = Math.max(1, diffDays(input.startDate, input.endDate))
  const days: ItineraryDay[] = Array.from({ length: dayCount }, (_, i) => ({
    id: uid('day'), index: i, stops: [],
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
    ...input,
    startLocationCoords: input.startLocationCoords,
    destinationCoords: input.destinationCoords,
    fixedCommitments: input.fixedCommitments.map(fc => ({ ...fc, id: uid('fc') })),
    days, expenses: [], coverEmoji: input.coverEmoji ?? '🧭',
    coverImageUrl: input.coverImageUrl ?? undefined,
    visibility: 'private', createdAt: Date.now(), updatedAt: Date.now(),
    members: [{ userId: ownerId, role: 'owner' as const, joinedAt: Date.now() }],
  } as Trip
  cache.trips = [...cache.trips, trip]
  commit()
  void persistTrip(trip, ownerId)
  return trip
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

function tripsHaveOptionalColumns(): Promise<OptionalColumnsProbe> {
  if (!isSupabaseConfigured) return Promise.resolve({ economy: false, price: false, roundTrip: false, cover: false, inviteCode: false })
  if (!optionalColumnsProbe) optionalColumnsProbe = probeOptionalColumns()
  return optionalColumnsProbe
}

async function probeOptionalColumns(): Promise<OptionalColumnsProbe> {
  const [economy, price, roundTrip, cover, inviteCode] = await Promise.all([
    probeOptionalColumn('fuel_economy_km_per_l'),
    probeOptionalColumn('fuel_price_per_l'),
    probeOptionalColumn('round_trip'),
    probeOptionalColumn('cover_image_url'),
    probeOptionalColumn('invite_code'),
  ])
  if (!economy || !price || !roundTrip) {
    if (!optionalColumnsWarned) {
      console.warn('[yatraflow] trips optional columns missing — run supabase/schema.sql; fuel/round-trip inputs stay session-only until then.')
      optionalColumnsWarned = true
    }
  }
  return { economy, price, roundTrip, cover, inviteCode }
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

async function persistTrip(trip: Trip, ownerId: ID) {
  const cols = await tripsHaveOptionalColumns()
  const { error } = await supabase.from('trips').insert(tripToRow(trip, ownerId, cols))
  markLocalWrite('trips', trip.id)
  if (error) { toast('Could not save trip.'); return }
  const { error: mErr } = await supabase.from('trip_members').insert(
    (trip.members ?? []).map(m => ({ trip_id: trip.id, user_id: m.userId, role: m.role, joined_at: m.joinedAt }))
  )
  if (mErr) console.error('member insert failed', mErr)
}

/** Duplicate any trip into the user's workspace (Copy This Trip / demo seeding). */
export function duplicateTrip(source: Trip, ownerId: ID, makePublic?: boolean): Trip {
  const copy: Trip = structuredClone(source)
  copy.id = uuid()
  copy.name = source.name.includes('(copy)') ? source.name : `${source.name} (copy)`
  copy.visibility = makePublic ? 'public' : 'private'
  copy.createdAt = Date.now(); copy.updatedAt = Date.now()
  copy.days = copy.days.map(d => ({ ...d, id: uid('day'), stops: d.stops.map(s => ({ ...s, id: uid('st') })) }))
  copy.expenses = copy.expenses.map(e => ({ ...e, id: uid('ex') }))
  copy.fixedCommitments = copy.fixedCommitments.map(f => ({ ...f, id: uid('fc') }))
  copy.members = [{ userId: ownerId, role: 'owner' as const, joinedAt: Date.now() }]
  copy.coverImageUrl = source.coverImageUrl
  cache.trips = [...cache.trips, copy]
  commit()
  void persistTrip(copy, ownerId)
  return copy
}

/** Copy text stamped onto every stop of a premium (non-free) day when a
 *  published itinerary is forked. Titles stay so the fork keeps the trip's
 *  shape; every other detail is stripped. */
const LOCKED_STOP_DESCRIPTION = 'Locked — the full plan is on the original itinerary.'

/** Fork a PUBLISHED itinerary while respecting its premium gate.
 *
 *  `duplicateTrip` copies the entire trip — premium days included — so forking
 *  from the public page was a total bypass of the free/premium split. This
 *  variant keeps days listed in `freeDayIndexes` fully intact and, for every
 *  other day, reduces each stop to a stub: title and priority are kept, the
 *  description becomes the locked notice, notes are cleared, entry/transport
 *  costs and open/close times are zeroed, and the stop is marked confirmed.
 *  Budget data for locked days does not ride along either: expenses tagged
 *  with a locked `dayIndex` and fixed commitments on locked days are dropped
 *  (trip-level expenses — no `dayIndex` — stay). Structurally identical to
 *  `duplicateTrip` otherwise (fresh ids, new owner member, private copy,
 *  persisted once — the stripped version is what gets written through, never
 *  the full plan). */
export function duplicateTripPublic(source: Trip, ownerId: ID, freeDayIndexes: number[]): Trip {
  const free = new Set(freeDayIndexes)
  const copy: Trip = structuredClone(source)
  copy.id = uuid()
  copy.name = source.name.includes('(copy)') ? source.name : `${source.name} (copy)`
  copy.visibility = 'private'
  copy.createdAt = Date.now(); copy.updatedAt = Date.now()
  copy.days = copy.days.map(d => ({
    ...d,
    id: uid('day'),
    stops: d.stops.map(s => free.has(d.index)
      ? { ...s, id: uid('st') }
      : {
          ...s,
          id: uid('st'),
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
    .map(f => ({ ...f, id: uid('fc') }))
  copy.members = [{ userId: ownerId, role: 'owner' as const, joinedAt: Date.now() }]
  copy.coverImageUrl = source.coverImageUrl
  cache.trips = [...cache.trips, copy]
  commit()
  void persistTrip(copy, ownerId)
  return copy
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

async function refreshAdminAudit(): Promise<void> {
  try {
    const { data, error } = await fetchAdminAuditRows()
    if (error) throw error
    patch({ adminAudit: auditRowsToEntries(data) })
    commit()
  } catch (e) {
    console.error('[yatraflow] audit refresh failed', e)
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
  const prev = cache.users
  patch({
    users: prev.map(u => u.id === userId
      ? { ...u, profile: { ...u.profile, isDisabled: disabled } }
      : u),
  })
  commit()
  const { error } = await supabase.rpc('admin_set_disabled', { p_user_id: userId, p_disabled: disabled })
  if (error) {
    console.error('[yatraflow] admin_set_disabled failed', error)
    patch({ users: prev })
    commit()
    toast(rpcErrorMessage(error), 'err')
    return false
  }
  toast(disabled ? 'Account disabled.' : 'Account re-enabled.')
  void refreshAdminAudit()
  return true
}

/** Toggle the creator badge on any profile. */
export async function adminSetCreator(userId: ID, isCreator: boolean): Promise<boolean> {
  if (!requireAdmin()) return false
  const prev = cache.users
  patch({
    users: prev.map(u => u.id === userId
      ? { ...u, profile: { ...u.profile, isCreator } }
      : u),
  })
  commit()
  const { error } = await supabase.rpc('admin_set_creator', { p_user_id: userId, p_is_creator: isCreator })
  if (error) {
    console.error('[yatraflow] admin_set_creator failed', error)
    patch({ users: prev })
    commit()
    toast(rpcErrorMessage(error), 'err')
    return false
  }
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

/** Unpublish any itinerary (admin variant — the owner path is creator-scoped). */
export async function adminUnpublish(tripId: ID): Promise<boolean> {
  if (!requireAdmin()) return false
  const prevPubs = cache.published
  const prevTrips = cache.trips
  patch({
    published: prevPubs.filter(p => p.tripId !== tripId),
    trips: prevTrips.map(t => t.id === tripId ? { ...t, visibility: 'private' as const, updatedAt: Date.now() } : t),
  })
  commit()
  const { error } = await supabase.rpc('admin_unpublish', { p_trip_id: tripId })
  if (error) {
    console.error('[yatraflow] admin_unpublish failed', error)
    patch({ published: prevPubs, trips: prevTrips })
    commit()
    toast(rpcErrorMessage(error), 'err')
    return false
  }
  toast('Publication removed.')
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

function snapshotTrip(trip: Trip, index: number): TripSnapshot {
  return {
    trip,
    index,
    ownerId: tripOwner(trip),
    suggestions: cache.suggestions.filter(s => s.tripId === trip.id),
    decisions: cache.decisions.filter(d => d.tripId === trip.id),
    activity: cache.activity.filter(a => a.tripId === trip.id),
    notifications: cache.notifications.filter(n => n.tripId === trip.id),
    published: cache.published.filter(p => p.tripId === trip.id),
  }
}

export function deleteTrip(id: ID): void {
  const idx = cache.trips.findIndex(t => t.id === id)
  if (idx < 0) return
  const removed = cache.trips[idx]
  lastDeletedTrip = snapshotTrip(removed, idx)
  cache.trips = cache.trips.filter(t => t.id !== id)
  commit()
  markLocalWrite('trips', id)
  void supabase.from('trips').delete().eq('id', id).then(({ error }) => {
    if (error) {
      cache.trips = [...cache.trips.slice(0, idx), removed, ...cache.trips.slice(idx)]
      commit()
      lastDeletedTrip = null
    }
  })
}

/** Re-insert a trip at its old position — powers Undo on trip deletion. */
export function restoreTrip(trip: Trip, index: number): void {
  if (cache.trips.some(t => t.id === trip.id)) return
  const snap = lastDeletedTrip?.trip.id === trip.id ? lastDeletedTrip : null
  lastDeletedTrip = null
  const at = Math.min(index, cache.trips.length)
  cache.trips = [...cache.trips.slice(0, at), trip, ...cache.trips.slice(at)]
  commit()
  void restoreTripData(trip, snap)
}

async function restoreRows(table: string, rows: unknown[], upsert = false): Promise<string | null> {
  if (!rows.length) return null
  const { error } = await (upsert ? supabase.from(table).upsert(rows) : supabase.from(table).insert(rows))
  return error ? (error.message ?? 'write failed') : null
}

async function restoreTripData(trip: Trip, snap: TripSnapshot | null): Promise<void> {
  markLocalWrite('trips', trip.id)
  // persistTrip writes this value straight into trips.owner_id. Passing
  // members[0].userId here used to transfer ownership to an arbitrary
  // collaborator every time a shared trip was deleted and undone.
  const ownerId = snap?.ownerId ?? tripOwner(trip)
  if (ownerId) await persistTrip(trip, ownerId)
  if (!snap) return

  // Order matters: every child policy gates on is_editor(trip_id), a membership
  // subquery, so these writes are rejected unless the trip row and its member
  // rows are already in place — which the await above is what guarantees.
  // Per-table on purpose: losing the activity feed must not also cost the user
  // their public link. Rows keep their original ids, and every child realtime
  // handler is an idempotent upsert keyed on id, so the echo cannot double-add.
  const results = await Promise.all([
    restoreRows('suggestions', snap.suggestions.map(suggestionToRow)),
    restoreRows('decisions', snap.decisions.map(decisionToRow)),
    restoreRows('activity', snap.activity.map(activityToRow)),
    restoreRows('notifications', snap.notifications.map(notificationToRow)),
    restoreRows('published_itineraries', snap.published.map(publishedToRow), true),
  ])

  const failed = [
    ['suggestions', results[0]],
    ['decisions', results[1]],
    ['activity', results[2]],
    ['notifications', results[3]],
    ['published link', results[4]],
  ].filter(([, msg]) => msg) as [string, string][]

  if (!failed.length) return
  console.error('[yatraflow] undo could not restore:', failed.map(([t, m]) => `${t} (${m})`).join(', '))
  // The public link is the one loss the user would notice and could not explain,
  // so it is the one worth saying out loud. published_itineraries RLS is gated
  // on creator_id, meaning a collaborator undoing their own delete genuinely
  // cannot re-publish the owner's itinerary.
  if (failed.some(([t]) => t === 'published link')) {
    toast('Trip restored, but its public link could not be restored - republish it from the trip.')
  }
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
  mutateTrip(tripId, draft => { draft.expenses.splice(Math.min(index, draft.expenses.length), 0, expense) }, { touch: false })
  void persistTripField(tripId, tripById(tripId)!)
}

export function updateTrip(id: ID, patchFields: Partial<Trip>): void {
  const t = tripById(id)
  if (!t) return
  // Date changes resize the day grid — reconcile BEFORE assigning so the
  // persisted row and the cache carry the same days. Shrinks that would drop
  // a day holding stops are rejected with the reason surfaced as a toast.
  if (patchFields.startDate || patchFields.endDate) {
    const newStart = patchFields.startDate ?? t.startDate
    const newEnd = patchFields.endDate ?? t.endDate
    const protectedIdx = new Set(t.fixedCommitments.map(c => c.dayIndex))
    const rec = reconcileDays(t.days, newStart, newEnd, protectedIdx)
    if (rec.error) { toast(rec.error, 'err'); return }
    patchFields = { ...patchFields, days: rec.days }
  }
  // Mutate the cache FIRST, then persist the draft that already contains the
  // patch. The previous order persisted the pre-patch snapshot and only
  // applied the edit in memory — settings edits (cover, title, budget…)
  // silently vanished on reload unless a later unrelated write happened to
  // persist the trip.
  const draft = mutateTrip(id, d => Object.assign(d, patchFields, { updatedAt: Date.now() }), { touch: false })
  if (draft) void persistTripField(id, draft)
}

async function persistTripField(id: ID, t: Trip): Promise<void> {
  const owner = t.members?.find(m => m.role === 'owner')
  const cols = await tripsHaveOptionalColumns()
  const { error } = await supabase.from('trips').update(tripToRow(t, owner?.userId ?? id, cols)).eq('id', id)
  markLocalWrite('trips', id)
  if (error) toast('Could not save changes.')
}

// ---------------- Members & collaboration ----------------

export function membersOf(trip: Trip): TripMember[] { return trip.members ?? [] }

export function userById(id: ID | undefined): User | undefined {
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

export function setMemberRole(tripId: ID, userId: ID, role: TripMember['role']): void {
  const t = tripById(tripId)
  const m = t?.members?.find(x => x.userId === userId)
  if (t && m) {
    mutateTrip(tripId, draft => {
      const dm = draft.members?.find(x => x.userId === userId)
      if (dm) dm.role = role
    }, { touch: false })
    fire('trip_members', supabase.from('trip_members').update({ role }).eq('trip_id', tripId).eq('user_id', userId))
  }
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
export async function joinViaInvite(tripId: ID, userId: ID, role: TripMember['role'] = 'editor'): Promise<boolean> {
  const t = tripById(tripId)
  if (!t) return false
  if (t.members?.some(m => m.userId === userId)) return true
  const joinedAt = Date.now()
  const { error } = await supabase.from('trip_members').insert({ trip_id: tripId, user_id: userId, role, joined_at: joinedAt })
  if (error) {
    console.error('[yatraflow] join write failed', error)
    return false
  }
  markLocalWrite('trip_members', tripId)
  mutateTrip(tripId, draft => { draft.members = [...(draft.members ?? []), { userId, role, joinedAt }] }, { touch: false })
  addActivity(tripId, userId, 'joined via invite link', 'Members')
  notifyOwnerOf(tripId, `${userName(userId)} joined “${t.name}” as ${role}.`)
  return true
}

export function removeMember(tripId: ID, userId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  const before = t.members ?? []
  t.members = before.filter(m => m.userId !== userId)
  commit()
  fire('trip_members', supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId))
}

export function userName(id: ID): string {
  return userById(id)?.profile.name ?? 'Traveller'
}

// ---------------- Stops ----------------

export function addStop(tripId: ID, dayIndex: number, stop: Omit<ItineraryStop, 'id' | 'orderInDay'>): ItineraryStop {
  const draft = mutateTrip(tripId, d => {
    const day = d.days.find(x => x.index === dayIndex)!
    const s: ItineraryStop = { ...stop, id: uid('st'), orderInDay: day.stops.length + 1 }
    day.stops.push(s)
    renumber(day)
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
    renumber(day)
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
    dDay.stops.push(stop)
    renumber(dDay)
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
      if (idx >= 0) { [movedDraft] = day.stops.splice(idx, 1); renumber(day); fromDraft = day; break }
    }
    const dTarget = draft.days.find(d => d.index === toDayIndex)
    if (movedDraft && dTarget) {
      // Same-day or cross-day: insert at the requested position (clamped), defaulting
      // to the end of the target day so no stop is ever dropped or silently reordered.
      const at = Math.max(0, Math.min(position ?? dTarget.stops.length, dTarget.stops.length))
      movedDraft.orderInDay = at + 1
      dTarget.stops.splice(at, 0, movedDraft)
      renumber(dTarget)
    } else if (movedDraft && fromDraft) {
      fromDraft.stops.push(movedDraft)
      renumber(fromDraft)
    }
  }, opts)
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
  void persistTripField(tripId, t)
}

function renumber(day: ItineraryDay): void {
  ;[...day.stops].sort((a, b) => a.orderInDay - b.orderInDay).forEach((s, i) => { s.orderInDay = i + 1 })
}

// ---------------- Expenses ----------------

export function addExpense(tripId: ID, e: Omit<Expense, 'id'>): void {
  const t = tripById(tripId)
  if (!t) return
  mutateTrip(tripId, draft => { draft.expenses.push({ optional: false, ...e, id: uid('ex') }) }, { touch: false })
  void persistTripField(tripId, tripById(tripId)!)
}

export function deleteExpense(tripId: ID, expenseId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  mutateTrip(tripId, draft => { draft.expenses = draft.expenses.filter(x => x.id !== expenseId) }, { touch: false })
  void persistTripField(tripId, tripById(tripId)!)
}

/** Edit an expense line in place — the Budget tab's pencil affordance — instead
 *  of the old delete-and-retype dance. */
export function updateExpense(tripId: ID, expenseId: ID, patch: Partial<Omit<Expense, 'id'>>): void {
  const t = tripById(tripId)
  if (!t || !t.expenses.some(x => x.id === expenseId)) return
  mutateTrip(tripId, draft => {
    draft.expenses = draft.expenses.map(x => x.id === expenseId ? { ...x, ...patch } : x)
  }, { touch: false })
  void persistTripField(tripId, tripById(tripId)!)
}

// ---------------- Suggestions / votes / comments ----------------

export function addSuggestion(tripId: ID, s: Omit<StopSuggestion, 'id' | 'votes' | 'comments' | 'status' | 'createdAt' | 'tripId'>): void {
  // Client generates the UUID so the cache and the DB row agree on the id
  // (a server-generated default would diverge after the next hydration).
  const id = uuid()
  const row = {
    id, trip_id: tripId, day_index: s.dayIndex, proposed_by: s.proposedBy, title: s.title, category: s.category,
    location_name: s.locationName, lat: s.lat, lng: s.lng, description: s.description, visit_minutes: s.visitMinutes,
    estimated_entry_fee_inr: s.estimatedEntryFeeInr, estimated_transport_inr: s.estimatedTransportInr,
    votes: [], comments: [], status: 'open',
  }
  cache.suggestions = [...cache.suggestions, { ...s, id, tripId, votes: [], comments: [], status: 'open', createdAt: Date.now() }]
  const trip = tripById(tripId)
  if (trip && cache.sessionUserId) {
    addActivity(tripId, cache.sessionUserId, `suggested “${s.title}”`, `Day ${(s.dayIndex ?? 0) + 1}`)
    for (const m of trip.members ?? []) {
      if (m.userId !== cache.sessionUserId) pushNotification(m.userId, tripId, `${userName(cache.sessionUserId)} suggested “${s.title}” for Day ${(s.dayIndex ?? 0) + 1}.`)
    }
  }
  commit()
  fire('suggestions', supabase.from('suggestions').insert(row))
}

export function voteSuggestion(tripId: ID, suggestionId: ID, userId: ID, value: 1 | -1): void {
  const sgIdx = cache.suggestions.findIndex(x => x.id === suggestionId)
  if (sgIdx < 0) return
  const sg = structuredClone(cache.suggestions[sgIdx])
  const existing = sg.votes.find(v => v.userId === userId)
  // Toggling the same value again is a *removal*, and the activity feed has to say
  // so — logging the value's verb made "I take back my upvote" read as "upvoted",
  // which is the opposite of what happened. #36-11.
  let removed = false
  if (existing) {
    if (existing.value === value) { sg.votes = sg.votes.filter(v => v.userId !== userId); removed = true }
    else existing.value = value
  } else {
    sg.votes.push({ userId, value, createdAt: Date.now() })
  }
  cache.suggestions = [...cache.suggestions.slice(0, sgIdx), sg, ...cache.suggestions.slice(sgIdx + 1)]
  addActivity(
    tripId,
    userId,
    removed ? 'removed their vote on a suggestion' : value > 0 ? 'upvoted a suggestion' : 'downvoted a suggestion',
    sg.title,
  )
  commit()
  fire('suggestions', supabase.from('suggestions').update({ votes: sg.votes }).eq('id', suggestionId))
}

export function addCommentToSuggestion(tripId: ID, suggestionId: ID, authorId: ID, text: string): void {
  const sgIdx = cache.suggestions.findIndex(x => x.id === suggestionId)
  if (sgIdx < 0 || !text.trim()) return
  const sg = structuredClone(cache.suggestions[sgIdx])
  sg.comments.push({ id: uid('cm'), authorId, text: text.trim(), createdAt: Date.now() })
  cache.suggestions = [...cache.suggestions.slice(0, sgIdx), sg, ...cache.suggestions.slice(sgIdx + 1)]
  addActivity(tripId, authorId, 'commented on a suggestion', sg.title)
  for (const v of new Set([...sg.votes.map(v => v.userId), sg.proposedBy])) {
    if (v !== authorId) pushNotification(v, tripId, `${userName(authorId)} commented on “${sg.title}”.`)
  }
  commit()
  fire('suggestions', supabase.from('suggestions').update({ comments: sg.comments }).eq('id', suggestionId))
}

/** Accept a suggestion: adds it to the timeline and closes the suggestion. */
export function acceptSuggestionIntoTimeline(tripId: ID, suggestionId: ID): void {
  const sg = cache.suggestions.find(x => x.id === suggestionId)
  const trip = tripById(tripId)
  if (!sg || !trip) return
  addStop(tripId, sg.dayIndex, {
    title: sg.title, category: sg.category, locationName: sg.locationName, lat: sg.lat, lng: sg.lng,
    description: sg.description, visitMinutes: sg.visitMinutes,
    entryFeeInrPerPerson: sg.estimatedEntryFeeInr, transportCostInrTotal: sg.estimatedTransportInr,
    priority: 'nice-to-have', status: 'confirmed',
  })
  cache.suggestions = cache.suggestions.map(x => x.id === suggestionId ? { ...x, status: 'accepted' as const } : x)
  const actor = cache.sessionUserId
  if (actor) addActivity(tripId, actor, 'accepted suggestion into timeline', sg.title)
  commit()
  fire('suggestions', supabase.from('suggestions').update({ status: 'accepted' }).eq('id', suggestionId))
}

export function declineSuggestion(tripId: ID, suggestionId: ID): void {
  const sg = cache.suggestions.find(x => x.id === suggestionId)
  if (sg) { cache.suggestions = cache.suggestions.map(x => x.id === suggestionId ? { ...x, status: 'declined' as const } : x); addActivity(tripId, cache.sessionUserId!, 'declined a suggestion', sg.title); commit(); fire('suggestions', supabase.from('suggestions').update({ status: 'declined' }).eq('id', suggestionId)) }
}

// ---------------- Decisions ----------------

export function addDecision(tripId: ID, d: Pick<TripDecision, 'question' | 'context' | 'options'>): void {
  if (!cache.sessionUserId) return
  // Same cache/DB id agreement as addSuggestion.
  const id = uuid()
  const row = {
    id, trip_id: tripId, question: d.question, context: d.context,
    options: d.options.map(o => ({ ...o, id: uid('o') })),
    votes_by_user_id: {}, status: 'open', raised_by: cache.sessionUserId,
  }
  cache.decisions = [...cache.decisions, { ...d, id, tripId, votesByUserId: {}, status: 'open', raisedBy: cache.sessionUserId, createdAt: Date.now(), options: row.options }]
  addActivity(tripId, cache.sessionUserId, `raised decision “${d.question}”`, 'Decisions')
  // Notification parity with addSuggestion: the other members hear about new
  // group input too, not just suggestions.
  const trip = tripById(tripId)
  if (trip) {
    for (const m of trip.members ?? []) {
      if (m.userId !== cache.sessionUserId) pushNotification(m.userId, tripId, `${userName(cache.sessionUserId)} raised a decision: “${d.question}”.`)
    }
  }
  commit()
  fire('decisions', supabase.from('decisions').insert(row))
}

export function voteOnDecision(decisionId: ID, optionId: ID): void {
  const dIdx = cache.decisions.findIndex(x => x.id === decisionId)
  if (dIdx < 0 || !cache.sessionUserId || cache.decisions[dIdx].status !== 'open') return
  const d = structuredClone(cache.decisions[dIdx])
  d.votesByUserId[cache.sessionUserId] = optionId
  cache.decisions = [...cache.decisions.slice(0, dIdx), d, ...cache.decisions.slice(dIdx + 1)]
  addActivity(d.tripId, cache.sessionUserId, 'voted on a decision', d.question)
  // No per-vote member pings — on a 6-person trip every ballot pinged five
  // people and the bell became noise. The activity feed carries the vote;
  // members hear about the raise and the resolution only.
  commit()
  fire('decisions', supabase.from('decisions').update({ votes_by_user_id: d.votesByUserId }).eq('id', decisionId))
}

export function resolveDecision(decisionId: ID, optionId: ID): void {
  const dIdx = cache.decisions.findIndex(x => x.id === decisionId)
  if (dIdx < 0) return
  const d = structuredClone(cache.decisions[dIdx])
  d.status = 'resolved'; d.resolvedOptionId = optionId; d.resolvedAt = Date.now()
  cache.decisions = [...cache.decisions.slice(0, dIdx), d, ...cache.decisions.slice(dIdx + 1)]
  addActivity(d.tripId, cache.sessionUserId!, 'resolved a decision', d.question)
  const winningLabel = d.options.find(o => o.id === optionId)?.label ?? 'an option'
  const trip = tripById(d.tripId)
  if (trip && cache.sessionUserId) {
    for (const m of trip.members ?? []) {
      if (m.userId !== cache.sessionUserId) pushNotification(m.userId, d.tripId, `${userName(cache.sessionUserId)} resolved “${d.question}” — ${winningLabel}.`)
    }
  }
  commit()
  fire('decisions', supabase.from('decisions').update({ status: 'resolved', resolved_option_id: optionId, resolved_at: d.resolvedAt }).eq('id', decisionId))
}

// ---------------- Publishing ----------------

export async function publishItinerary(pub: Omit<PublishedItinerary, 'id' | 'publishedAt' | 'views' | 'copies'>): Promise<PublishedItinerary> {
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
    views: existing?.views ?? 0,
    copies: existing?.copies ?? 0,
  }
  const existingIdx = cache.published.findIndex(x => x.tripId === p.tripId)
  const previous = existingIdx >= 0 ? cache.published[existingIdx] : undefined
  cache.published = existingIdx >= 0
    ? [...cache.published.slice(0, existingIdx), p, ...cache.published.slice(existingIdx + 1)]
    : [...cache.published, p]
  commit()
  // The Supabase row is the ONLY persistence for a publication — if this
  // upsert is rejected, the optimistic cache write makes it look published
  // until the next refresh silently wipes it. Surface the failure and roll
  // the cache back so the UI never disagrees with the server. (Found live:
  // the gallery table was empty while the UI showed a published card.)
  const hasRefreshedCol = await publishedHaveRefreshedAt()
  const { error } = await supabase.from('published_itineraries').upsert({
    id: p.id, trip_id: p.tripId, creator_id: p.creatorId, title: p.title, tagline: p.tagline,
    cover_image_url: p.coverImageUrl, route_summary: p.routeSummary, duration_days: p.durationDays,
    estimated_budget_per_person_inr: p.estimatedBudgetPerPersonInr, travel_style: p.travelStyle,
    best_season: p.bestSeason, travel_tips: p.travelTips, warnings_and_assumptions: p.warningsAndAssumptions,
    free_day_indexes: p.freeDayIndexes, premium_price_inr: p.premiumPriceInr, subscriber_cta: p.subscriberCta,
    ...(hasRefreshedCol ? { refreshed_at: p.refreshedAt } : {}),
  })
  if (error) {
    console.error('[yatraflow] publish persist failed', error)
    toast('Could not save the publication — it will not survive a refresh. (' + error.message + ')')
    const idx = cache.published.findIndex(x => x.id === p.id)
    if (idx >= 0) {
      cache.published = previous
        ? [...cache.published.slice(0, idx), previous, ...cache.published.slice(idx + 1)]
        : cache.published.filter((_, i) => i !== idx)
      commit()
    }
  } else {
    markLocalWrite('published_itineraries', p.id)
    // A published itinerary is a public page: flip the trip to visibility
    // 'public' so RLS lets anonymous visitors and logged-in non-members read
    // the trip body the public page renders (see fetchSharedTrip).
    cache.trips = cache.trips.map(t => t.id === p.tripId ? { ...t, visibility: 'public' } : t)
    commit()
    fire('trips', supabase.from('trips').update({ visibility: 'public' }).eq('id', p.tripId))
  }
  return p
}

/** Remove a trip's public itinerary from Explore. The cache row is removed
 *  synchronously (the UI reflects it at once) and the Supabase row is deleted;
 *  on a failed delete the cache row is restored so the UI never claims an
 *  unpublish that didn't stick. Owner-gated: only the trip owner (whose id
 *  matches creator_id server-side via RLS) may unpublish. The trip itself
 *  stays in My Trips — unpublish ≠ delete trip. */
export function unpublishItinerary(tripId: ID): void {
  const idx = cache.published.findIndex(p => p.tripId === tripId)
  if (idx < 0) return
  if (!cache.sessionUserId || cache.published[idx].creatorId !== cache.sessionUserId) {
    toast('Only the trip owner can unpublish this itinerary.', 'err')
    return
  }
  const pub = cache.published[idx]
  cache.published = cache.published.filter((_, i) => i !== idx)
  commit()
  void (async () => {
    const { error } = await supabase.from('published_itineraries').delete().eq('id', pub.id)
    if (error) {
      console.error('[yatraflow] unpublish persist failed', error)
      toast('Could not remove the publication — it is still live on Explore. (' + error.message + ')')
      // Roll the optimistic removal back; the next refresh would resurrect it
      // anyway, and until then the UI must not disagree with the server.
      if (!cache.published.some(x => x.id === pub.id)) {
        cache.published = [...cache.published, pub]
        commit()
      }
    } else {
      markLocalWrite('published_itineraries', pub.id)
      // Unpublished → the trip is private again (matches the publish-side flip).
      cache.trips = cache.trips.map(t => t.id === tripId ? { ...t, visibility: 'private' } : t)
      commit()
      fire('trips', supabase.from('trips').update({ visibility: 'private' }).eq('id', tripId))
    }
  })()
}

export function unpublishedTripIds(userId: ID): ID[] {
  const mine = cache.trips.filter(t => t.members?.some(m => m.userId === userId && m.role === 'owner'))
  return mine.filter(t => !cache.published.some(p => p.tripId === t.id)).map(t => t.id)
}

/** One view per itinerary per browser session, and the creator's own visits
 *  don't count — before this, every refresh and every self-check inflated the
 *  Explore counter. (sessionStorage survives route changes within the tab but
 *  resets on a genuinely new visit, which is the granularity views want.) */
export function registerPubView(id: ID): void {
  const p = cache.published.find(x => x.id === id)
  if (!p) return
  if (cache.sessionUserId && p.creatorId === cache.sessionUserId) return
  try {
    const key = `yf-viewed-${id}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch { /* storage unavailable (private mode) — count the view */ }
  cache.published = cache.published.map(x => x.id === id ? { ...x, views: x.views + 1 } : x)
  commit()
  // Use RPC function that bypasses RLS - anyone can increment counters now.
  fire('published_itineraries', supabase.rpc('bump_published_stats', { p_id: id, p_kind: 'views' }))
}

export function registerPubCopy(id: ID): void {
  const p = cache.published.find(x => x.id === id)
  if (p) {
    cache.published = cache.published.map(x => x.id === id ? { ...x, copies: x.copies + 1 } : x)
    commit()
    // Use RPC function that bypasses RLS - anyone can increment counters now.
    fire('published_itineraries', supabase.rpc('bump_published_stats', { p_id: id, p_kind: 'copies' }))
  }
}

// ---------------- Feed & notifications ----------------

export function activityFor(tripId: ID): ActivityEntry[] {
  return cache.activity.filter(a => a.tripId === tripId).sort((a, b) => b.at - a.at)
}

export function addActivity(tripId: ID, actorId: ID, verb: string, target?: string): void {
  const entry: ActivityEntry = { id: uuid(), tripId, actorId, verb, target, at: Date.now() }
  cache.activity = [...cache.activity, entry]
  fire('activity', supabase.from('activity').insert({ id: entry.id, trip_id: tripId, actor_id: actorId, verb, target, at: entry.at }))
}

export function notificationsFor(userId: ID): Notification[] {
  return cache.notifications.filter(n => n.userId === userId).sort((a, b) => b.at - a.at)
}

export function pushNotification(userId: ID, tripId: ID | undefined, text: string): void {
  const n: Notification = { id: uuid(), userId, tripId, text, read: false, at: Date.now() }
  cache.notifications = [n, ...cache.notifications]
  fire('notifications', supabase.from('notifications').insert({ id: n.id, user_id: userId, trip_id: tripId, text, read: false, at: n.at }))
}

function notifyOwnerOf(tripId: ID, text: string): void {
  const t = tripById(tripId)
  const owner = t?.members?.find(m => m.role === 'owner')
  if (owner) pushNotification(owner.userId, tripId, text)
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
  recentLocalWrites.set(`${table}:${id}`, Date.now())
  // Sweep old entries to prevent unbounded growth. #36-2.
  if (recentLocalWrites.size > MAX_RECENT_WRITES) {
    const oldestKey = recentLocalWrites.keys().next().value
    if (oldestKey) recentLocalWrites.delete(oldestKey)
  }
}

function echoWindowEh(table: string, id: string): boolean {
  return isRecentLocalWrite(recentLocalWrites, table, id, Date.now())
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

/** Start listening for row changes. Call after a successful hydration. */
export function connectRealtime(_userId: string): void {
  if (!isSupabaseConfigured || realtimeChannel) return
  try {
    realtimeChannel = supabase
      .channel('yatraflow-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, p => dispatchRealtimeEvent('trips', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members' }, p => dispatchRealtimeEvent('trip_members', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suggestions' }, p => dispatchRealtimeEvent('suggestions', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'decisions' }, p => dispatchRealtimeEvent('decisions', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity' }, p => dispatchRealtimeEvent('activity', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, p => dispatchRealtimeEvent('notifications', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, p => dispatchRealtimeEvent('profiles', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'published_itineraries' }, p => dispatchRealtimeEvent('published_itineraries', p))
      .subscribe()
  } catch (e) {
    console.error('[yatraflow] realtime subscribe failed', e)
    realtimeChannel = null
  }
}

/** Tear down the channel. Call on sign-out. */
export function disconnectRealtime(): void {
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel)
    realtimeChannel = null
  }
}

function applyRealtimeEvent(table: string, payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
  const event = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'
  const row = payload.new as Record<string, any> | undefined
  const oldRow = payload.old as Record<string, any> | undefined
  const id: string = row?.id ?? oldRow?.id
  if (id === undefined) return

  switch (table) {
    case 'trips': {
      if (echoWindowEh('trips', id)) return
      if (event === 'DELETE') {
        cache.trips = cache.trips.filter(t => t.id !== id)
        cache.suggestions = cache.suggestions.filter(s => s.tripId !== id)
        cache.decisions = cache.decisions.filter(d => d.tripId !== id)
        cache.activity = cache.activity.filter(a => a.tripId !== id)
        cache.notifications = cache.notifications.filter(n => n.tripId !== id)
      } else {
        const existing = tripById(id)
        cache.trips = reduceSlice(cache.trips, event, rowToTrip(row as TripRow, existing?.members ?? []), oldRow?.id)
      }
      break
    }
    case 'trip_members': {
      const tripId: string = row?.trip_id ?? oldRow?.trip_id
      if (!tripId) return
      const trip = tripById(tripId)
      if (!trip) {
        // A membership row for a trip we don't have yet (we were just added to
        // / joined a trip elsewhere): fetch the whole trip + members.
        if (event !== 'DELETE') void fetchTripIntoCache(tripId)
        return
      }
      const userId: string = row?.user_id ?? oldRow?.user_id
      if (!userId) return
      // If we were removed, the trip disappears from our view.
      if (event === 'DELETE' && userId === cache.sessionUserId) {
        cache.trips = cache.trips.filter(t => t.id !== tripId)
      } else {
        mutateTrip(tripId, draft => {
          draft.members = applyMemberChange(draft.members ?? [], {
            event,
            userId,
            role: (row?.role as TripMember['role']) ?? 'editor',
            joinedAt: Number(row?.joined_at ?? oldRow?.joined_at ?? Date.now()),
          })
        }, { touch: false })
      }
      break
    }
    case 'suggestions':
      cache.suggestions = reduceSlice(cache.suggestions, event, row ? rowToSuggestion(row) : undefined, oldRow?.id)
      break
    case 'decisions':
      cache.decisions = reduceSlice(cache.decisions, event, row ? rowToDecision(row) : undefined, oldRow?.id)
      break
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
    case 'profiles': {
      if (event === 'DELETE') {
        cache.users = cache.users.filter(u => u.id !== id)
        break
      }
      cache.users = reduceSlice(cache.users, event, rowToUser(row as ProfileRow), oldRow?.id)
      break
    }
    case 'published_itineraries':
      cache.published = reduceSlice(cache.published, event, row ? rowToPublished(row) : undefined, oldRow?.id)
      break
    default:
      return
  }
  commit()
}

/** Fetch a trip row + its members into the cache (used on join/share events). */
async function fetchTripIntoCache(tripId: string): Promise<void> {
  // Two realtime events for the same trip (a burst of INSERT+UPDATE, or a
  // reconnect replay) used to fire two identical round-trips. Coalesce onto the
  // in-flight promise so concurrent callers share one fetch. #36-15.
  const inflight = tripFetches.get(tripId)
  if (inflight) return inflight
  const fetch = (async () => {
    const [tripRes, memRes] = await Promise.all([
      supabase.from('trips').select('*').eq('id', tripId).maybeSingle(),
      supabase.from('trip_members').select('*').eq('trip_id', tripId),
    ])
    if (tripRes.error || !tripRes.data) return
    const members = ((memRes.data ?? []) as MemberRow[]).map(m => ({ userId: m.user_id, role: m.role as TripMember['role'], joinedAt: m.joined_at }))
    const trip = rowToTrip(tripRes.data as TripRow, members)
    if (!cache.trips.some(t => t.id === trip.id)) cache.trips = [...cache.trips, trip]
    commit()
  })()
  tripFetches.set(tripId, fetch)
  try { await fetch } finally { tripFetches.delete(tripId) }
}

/** Trips with a select currently in flight, so a burst of events for one trip
 *  costs one round-trip. #36-15. */
const tripFetches = new Map<string, Promise<void>>()

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
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1)
}

export const supabaseReady = isSupabaseConfigured
