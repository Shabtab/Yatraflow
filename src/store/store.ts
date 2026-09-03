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
import { reduceSlice, applyMemberChange, isRecentLocalWrite } from '../lib/realtimeCore'
import { MISSING_BACKEND_MESSAGE, describeAuthFailure } from '../lib/authErrors'
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
  sessionUserId: ID | null
}

let cache: DB = {
  users: [], trips: [], suggestions: [], decisions: [],
  activity: [], notifications: [], published: [], sessionUserId: null,
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
}

/** Shape of a trip_members row as stored in Postgres (snake_case). */
interface MemberRow {
  trip_id: string; user_id: string; role: TripMember['role']; joined_at: number;
}

function rowToUser(row: ProfileRow): User {
  return {
    id: row.id, email: row.email, createdAt: row.created_at,
    profile: {
      name: row.name, avatarUrl: row.avatar_url, homeCity: row.home_city,
      languages: row.languages ?? ['en'], travelStyles: (row.travel_styles ?? ['balanced']) as User['profile']['travelStyles'],
      isCreator: row.is_creator, creatorBio: row.creator_bio, socialLinks: row.social_links,
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
  // onAuthStateChange handler clears the cache.
}

// ---------------- Init / hydration ----------------

/** Guard against duplicate concurrent hydrations. On app load BOTH
 *  `getSession()` and the `onAuthStateChange()` "SIGNED_IN" event fire, which
 *  started two `hydrateFromSupabase` calls racing. The second one's full
 *  `patch({ trips })` overwrote the first's cache mid-seed — the seed appends
 *  the 10 trips AFTER that patch — so the trips loaded and then vanished. A
 *  redundant hydrate for the same user now just awaits the in-flight one. */
let activeHydrate: { userId: string | null; promise: Promise<void> } | null = null

/** Call once on app mount. Subscribes to auth and hydrates the cache. */
export function init(): void {
  if (initialized) return
  initialized = true

  const hydrate = async (userId: string | null) => {
    if (!userId) {
      disconnectRealtime()
      patch({ users: [], trips: [], suggestions: [], decisions: [], activity: [], notifications: [], published: [], sessionUserId: null })
      commit()
      activeHydrate = null
      return
    }
    // Serialize: a redundant hydrate for the same user (the load-time getSession
    // + onAuthStateChange double-fire) waits for the in-flight one instead of
    // clobbering its seed writes with a fresh `patch({ trips })`.
    if (activeHydrate && activeHydrate.userId === userId) {
      await activeHydrate.promise
      return
    }
    const promise = hydrateFromSupabase(userId)
    activeHydrate = { userId, promise }
    try { await promise } finally {
      if (activeHydrate?.userId === userId) activeHydrate = null
    }
    connectRealtime(userId)
  }

  supabase.auth.getSession().then(({ data }) => { void hydrate(data.session?.user?.id ?? null) })
  supabase.auth.onAuthStateChange((_event, session) => {
    void hydrate(session?.user?.id ?? null)
  })
}

async function hydrateFromSupabase(userId: string): Promise<void> {
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
    const profiles = (profRes.data ?? []) as ProfileRow[]
    const myRows = (myMembershipsRes.data ?? []) as MemberRow[]
    const memberTripIds = myRows.map(m => m.trip_id)
    const myTripIds = [...new Set(memberTripIds)]

    // Stage 2 - only the user's own trips + their collaboration data. PostgREST
    // rejects `id=in.<empty>` so when the user has no trips yet, we record empty
    // slices and the demo seed below still runs.
    let trips: TripRow[] = []
    const members: MemberRow[] = []
    let suggestions: StopSuggestion[] = []
    let decisions: TripDecision[] = []
    let activity: ActivityEntry[] = []
    let notifications: Notification[] = []
    if (myTripIds.length > 0) {
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
        if (res.error) console.error(`[yatraflow] hydrate ${name} failed`, res.error)
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
      rowToTrip(row, members.filter(m => m.trip_id === row.id).map(m => ({ userId: m.user_id, role: m.role, joinedAt: m.joined_at })))
    )
    console.info('[yatraflow] hydrate:', tripList.length, 'trips,', members.length,' members - ids:', tripList.map(t => t.id).join(','))

    const pubRows = mapOrSkip((pubRes.data ?? []), rowToPublished)
    pubRes.error && console.error('[yatraflow] hydrate published failed', pubRes.error)

    patch({
      users,
      trips: tripList,
      suggestions,
      decisions,
      activity,
      notifications,
      // De-dupe / drop orphan published rows left by earlier buggy seeds (the
      // publishItinerary path mints a fresh id each call - many rows per tripId).
      published: dedupePublished(pubRows, new Set(tripList.map(t => t.id))),
      sessionUserId: userId,
    })
    commit()

    // First-time users get the demo trips seeded into their account.
    if (tripList.length === 0) await seedDemoFor(userId)
  } catch (e) {
    console.error('[yatraflow] hydration failed', e)
    toast('Could not load your data - check your connection.')
  }
}

/** Map rows safely - skip + log a single malformed row instead of letting its
 *  thrown mapper crash the whole hydration / realtime apply (which looked
 *  like trips "disappeared" (a white-screen) when a public catalog row had an
 *  unexpected shape). */
function mapOrSkip<T>(rows: unknown[], to: (row: any) => T): T[] {
  const out: T[] = []
  for (const r of rows ?? []) {
    try { out.push(to(r)) } catch (e) { console.error('[yatraflow] skipped malformed row', e) }
  }
  return out}

// ---------------- Seeding demo trips ----------------

async function seedDemoFor(userId: string): Promise<void> {
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
  // re-hydrate so the freshly seeded trips show up
  await hydrateFromSupabase(userId)
}

// ---------------- Seeding demo trips ----------------

/** Manually load the demo trips into the current account (My Trips button). */
/** Manually load the demo trips into the current account (My Trips button). */
export function addDemoTrips(): void {
  if (!cache.sessionUserId) return
  toast('Adding demo trips…')
  void seedDemoFor(cache.sessionUserId).then(() => toast('Demo trips added ✨'))
}

// ---------------- Row mappers for collaboration tables ----------------

function rowToSuggestion(row: any): StopSuggestion {
  return {
    id: row.id, tripId: row.trip_id, dayIndex: row.day_index, proposedBy: row.proposed_by,
    title: row.title, category: row.category, locationName: row.location_name, lat: row.lat, lng: row.lng,
    description: row.description, visitMinutes: row.visit_minutes,
    estimatedEntryFeeInr: row.estimated_entry_fee_inr, estimatedTransportInr: row.estimated_transport_inr,
    votes: row.votes ?? [], comments: row.comments ?? [], status: row.status, createdAt: row.created_at,
  }
}
function rowToDecision(row: any): TripDecision {
  return {
    id: row.id, tripId: row.trip_id, question: row.question, context: row.context,
    options: row.options ?? [], votesByUserId: row.votes_by_user_id ?? {}, status: row.status,
    resolvedOptionId: row.resolved_option_id, raisedBy: row.raised_by, createdAt: row.created_at, resolvedAt: row.resolved_at,
  }
}
function rowToActivity(row: any): ActivityEntry {
  return { id: row.id, tripId: row.trip_id, actorId: row.actor_id, verb: row.verb, target: row.target, at: row.at }
}
function rowToNotification(row: any): Notification {
  return { id: row.id, userId: row.user_id, tripId: row.trip_id, text: row.text, read: row.read, at: row.at }
}
function rowToPublished(row: any): PublishedItinerary {
  return {
    id: row.id, tripId: row.trip_id, creatorId: row.creator_id, title: row.title, tagline: row.tagline,
    coverImageUrl: row.cover_image_url, routeSummary: row.route_summary ?? [], durationDays: row.duration_days,
    estimatedBudgetPerPersonInr: row.estimated_budget_per_person_inr, travelStyle: row.travel_style,
    bestSeason: row.best_season, travelTips: row.travel_tips ?? [], warningsAndAssumptions: row.warnings_and_assumptions ?? [],
    freeDayIndexes: row.free_day_indexes ?? [], premiumPriceInr: row.premium_price_inr, subscriberCta: row.subscriber_cta,
    publishedAt: row.published_at, views: row.views ?? 0, copies: row.copies ?? 0,
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
  void supabase.from('profiles').update({
    name: patchFields.name, home_city: patchFields.homeCity, languages: patchFields.languages,
    travel_styles: patchFields.travelStyles, is_creator: patchFields.isCreator,
    creator_bio: patchFields.creatorBio, social_links: patchFields.socialLinks,
  }).eq('id', u.id).then(({ error }) => { if (error) toast('Could not save profile changes.') })
}

// ---------------- Trips ----------------

export function tripsForUser(userId: ID | null): Trip[] {
  if (!userId) return []
  return cache.trips.filter(t => t.members?.some?.(m => m.userId === userId))
}

export function tripById(id: ID): Trip | undefined {
  return cache.trips.find(t => t.id === id)
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
  cache.trips.push(trip)
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

function tripsHaveOptionalColumns(): Promise<OptionalColumnsProbe> {
  if (!isSupabaseConfigured) return Promise.resolve({ economy: false, price: false, roundTrip: false, cover: false })
  if (!optionalColumnsProbe) optionalColumnsProbe = probeOptionalColumns()
  return optionalColumnsProbe
}

async function probeOptionalColumns(): Promise<OptionalColumnsProbe> {
  const [economy, price, roundTrip, cover] = await Promise.all([
    probeOptionalColumn('fuel_economy_km_per_l'),
    probeOptionalColumn('fuel_price_per_l'),
    probeOptionalColumn('round_trip'),
    probeOptionalColumn('cover_image_url'),
  ])
  if (!economy || !price || !roundTrip) {
    console.warn('[yatraflow] trips optional columns missing — run supabase/schema.sql; fuel/round-trip inputs stay session-only until then.')
  }
  return { economy, price, roundTrip, cover }
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
  cache.trips.push(copy)
  commit()
  void persistTrip(copy, ownerId)
  return copy
}

export function deleteTrip(id: ID): void {
  const idx = cache.trips.findIndex(t => t.id === id)
  if (idx < 0) return
  const removed = cache.trips[idx]
  cache.trips = cache.trips.filter(t => t.id !== id)
  commit()
  markLocalWrite('trips', id)
  void supabase.from('trips').delete().eq('id', id).then(({ error }) => { if (error) { cache.trips.splice(idx, 0, removed); commit() } })
}

/** Re-insert a trip at its old position — powers Undo on trip deletion. */
export function restoreTrip(trip: Trip, index: number): void {
  if (cache.trips.some(t => t.id === trip.id)) return
  cache.trips.splice(Math.min(index, cache.trips.length), 0, trip)
  commit()
  markLocalWrite('trips', trip.id)
  if (trip.members?.[0]) void persistTrip(trip, trip.members[0].userId)
}

/** Put a removed member back — powers Undo on member removal. */
export function restoreMember(tripId: ID, member: TripMember): void {
  const t = tripById(tripId)
  if (!t || t.members?.some(m => m.userId === member.userId)) return
  t.members = [...(t.members ?? []), member]
  commit()
  void supabase.from('trip_members').insert({ trip_id: tripId, user_id: member.userId, role: member.role, joined_at: member.joinedAt })
}

/** Re-insert a deleted expense line — powers Undo on expense deletion. */
export function restoreExpense(tripId: ID, expense: Expense, index: number): void {
  const t = tripById(tripId)
  if (!t || t.expenses.some(x => x.id === expense.id)) return
  t.expenses.splice(Math.min(index, t.expenses.length), 0, expense)
  commit()
  void persistTripField(tripId, t)
}

export function updateTrip(id: ID, patchFields: Partial<Trip>): void {
  const t = tripById(id)
  if (!t) return
  Object.assign(t, patchFields, { updatedAt: Date.now() })
  commit()
  void persistTripField(id, t)
}

async function persistTripField(id: ID, t: Trip) {
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

export function setMemberRole(tripId: ID, userId: ID, role: TripMember['role']): void {
  const t = tripById(tripId)
  const m = t?.members?.find(x => x.userId === userId)
  if (t && m) { m.role = role; commit(); void supabase.from('trip_members').update({ role }).eq('trip_id', tripId).eq('user_id', userId) }
}

export function joinViaInvite(tripId: ID, userId: ID, role: TripMember['role'] = 'editor'): boolean {
  const t = tripById(tripId)
  if (!t) return false
  t.members = t.members ?? []
  if (!t.members.some(m => m.userId === userId)) {
    t.members.push({ userId, role, joinedAt: Date.now() })
    addActivity(tripId, userId, 'joined via invite link', 'Members')
    notifyOwnerOf(tripId, `${userName(userId)} joined “${t.name}” as ${role}.`)
    commit()
    void supabase.from('trip_members').insert({ trip_id: tripId, user_id: userId, role, joined_at: Date.now() })
  }
  return true
}

export function removeMember(tripId: ID, userId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  const before = t.members ?? []
  t.members = before.filter(m => m.userId !== userId)
  commit()
  void supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId)
}

export function userName(id: ID): string {
  return userById(id)?.profile.name ?? 'Traveller'
}

// ---------------- Stops ----------------

export function addStop(tripId: ID, dayIndex: number, stop: Omit<ItineraryStop, 'id' | 'orderInDay'>): ItineraryStop {
  const trip = tripById(tripId)!
  const day = trip.days.find(d => d.index === dayIndex)!
  const s: ItineraryStop = { ...stop, id: uid('st'), orderInDay: day.stops.length + 1 }
  day.stops.push(s)
  renumber(day)
  touchAndLog(trip, `added “${stop.title}”`, `Day ${dayIndex + 1}`)
  // Persist the trip so the new stop survives a reload — the manual add flow
  // goes through updateTrip() → persistTripField(), but acceptSuggestionInto-
  // Timeline calls addStop() directly and used to drop the stop on refresh.
  void persistTripField(tripId, trip)
  return s
}

export function updateStop(tripId: ID, stopId: ID, patchFields: Partial<ItineraryStop>): void {
  for (const day of tripById(tripId)!.days) {
    const s = day.stops.find(x => x.id === stopId)
    if (s) { Object.assign(s, patchFields); touchAndLog(tripById(tripId)!, `updated “${patchFields.title ?? s.title}”`, `Day ${day.index + 1}`); break }
  }
  commit()
  void persistTripField(tripId, tripById(tripId)!)
}

export function deleteStop(tripId: ID, stopId: ID): void {
  const trip = tripById(tripId)!
  for (const day of trip.days) {
    const before = day.stops.length
    day.stops = day.stops.filter(x => x.id !== stopId)
    if (day.stops.length !== before) { renumber(day); touchAndLog(trip, `removed a stop`, `Day ${day.index + 1}`); break }
  }
  commit()
  void persistTripField(tripId, trip!)
}

/** Put a deleted stop back on its day at its old order — powers Undo. */
export function restoreStop(tripId: ID, stop: ItineraryStop, dayIndex: number): void {
  const trip = tripById(tripId)
  if (!trip) return
  const day = trip.days.find(d => d.index === dayIndex)
  if (!day || day.stops.some(s => s.id === stop.id)) return
  day.stops.push(stop)
  renumber(day)
  touchAndLog(trip, `restored “${stop.title}”`, `Day ${dayIndex + 1}`)
  commit()
  void persistTripField(tripId, trip)
}

export function reorderStop(tripId: ID, dayIndex: number, fromIdx: number, toIdx: number): void {
  const trip = tripById(tripId)!
  const day = trip.days.find(d => d.index === dayIndex)!
  const arr = [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
  // Guard out-of-range indices: an OOB splice would insert `undefined` into
  // day.stops, which later crashes simulateDay()/renders (bug #5).
  const len = arr.length
  if (len === 0) return
  const from = Math.max(0, Math.min(fromIdx, len - 1))
  const to = Math.max(0, Math.min(toIdx, len))
  if (from === to) return
  const [moved] = arr.splice(from, 1)
  if (!moved) return
  arr.splice(to, 0, moved)
  arr.forEach((s, i) => { s.orderInDay = i + 1 })
  day.stops = arr
  touchAndLog(trip, `reordered Day ${dayIndex + 1}`, 'Timeline')
  void persistTripField(tripId, trip)
}

export function moveStopBetweenDays(tripId: ID, stopId: ID, toDayIndex: number, position?: number): void {
  const trip = tripById(tripId)!
  let moved: ItineraryStop | undefined
  let fromDay: ItineraryDay | undefined
  for (const day of trip.days) {
    const idx = day.stops.findIndex(s => s.id === stopId)
    if (idx >= 0) { [moved] = day.stops.splice(idx, 1); renumber(day); fromDay = day; break }
  }
  const target = trip.days.find(d => d.index === toDayIndex)
  if (!moved) { commit(); void persistTripField(tripId, trip); return }
  if (target) {
    // Same-day or cross-day: insert at the requested position (clamped), defaulting
    // to the end of the target day so no stop is ever dropped or silently reordered.
    const at = Math.max(0, Math.min(position ?? target.stops.length, target.stops.length))
    moved.orderInDay = at + 1
    target.stops.splice(at, 0, moved)
    renumber(target)
    touchAndLog(trip, `moved “${moved.title}” to Day ${toDayIndex + 1}`, 'Timeline')
  } else if (fromDay) {
    // Unknown target day — restore the stop to where it came from rather than losing it.
    fromDay.stops.push(moved)
    renumber(fromDay)
  }
  commit()
  void persistTripField(tripId, trip)
}

export function setStopStatus(tripId: ID, status: ItineraryStop['status'], stopId: ID): void {
  for (const day of tripById(tripId)!.days) {
    const s = day.stops.find(x => x.id === stopId)
    if (s) { s.status = status; touchAndLog(tripById(tripId)!, `marked “${s.title}” as ${status}`, `Day ${day.index + 1}`); break }
  }
  commit()
  void persistTripField(tripId, tripById(tripId)!)
}

function renumber(day: ItineraryDay): void {
  ;[...day.stops].sort((a, b) => a.orderInDay - b.orderInDay).forEach((s, i) => { s.orderInDay = i + 1 })
}

function touchAndLog(trip: Trip, verb: string, target?: string): void {
  trip.updatedAt = Date.now()
  if (cache.sessionUserId) addActivity(trip.id, cache.sessionUserId, verb, target)
  commit()
}

// ---------------- Expenses ----------------

export function addExpense(tripId: ID, e: Omit<Expense, 'id'>): void {
  const t = tripById(tripId)
  if (!t) return
  t.expenses.push({ optional: false, ...e, id: uid('ex') })
  commit()
  void persistTripField(tripId, t)
}

export function deleteExpense(tripId: ID, expenseId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  t.expenses = t.expenses.filter(x => x.id !== expenseId)
  commit()
  void persistTripField(tripId, t)
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
  cache.suggestions.push({ ...s, id, tripId, votes: [], comments: [], status: 'open', createdAt: Date.now() })
  const trip = tripById(tripId)
  if (trip && cache.sessionUserId) {
    addActivity(tripId, cache.sessionUserId, `suggested “${s.title}”`, `Day ${(s.dayIndex ?? 0) + 1}`)
    for (const m of trip.members ?? []) {
      if (m.userId !== cache.sessionUserId) pushNotification(m.userId, tripId, `${userName(cache.sessionUserId)} suggested “${s.title}” for Day ${(s.dayIndex ?? 0) + 1}.`)
    }
  }
  commit()
  void supabase.from('suggestions').insert(row)
}

export function voteSuggestion(tripId: ID, suggestionId: ID, userId: ID, value: 1 | -1): void {
  const sg = cache.suggestions.find(x => x.id === suggestionId)
  if (!sg) return
  const existing = sg.votes.find(v => v.userId === userId)
  if (existing) {
    if (existing.value === value) sg.votes = sg.votes.filter(v => v.userId !== userId)
    else existing.value = value
  } else {
    sg.votes.push({ userId, value, createdAt: Date.now() })
  }
  addActivity(tripId, userId, value > 0 ? 'upvoted a suggestion' : 'downvoted a suggestion', sg.title)
  commit()
  void supabase.from('suggestions').update({ votes: sg.votes }).eq('id', suggestionId)
}

export function addCommentToSuggestion(tripId: ID, suggestionId: ID, authorId: ID, text: string): void {
  const sg = cache.suggestions.find(x => x.id === suggestionId)
  if (!sg || !text.trim()) return
  sg.comments.push({ id: uid('cm'), authorId, text: text.trim(), createdAt: Date.now() })
  addActivity(tripId, authorId, 'commented on a suggestion', sg.title)
  for (const v of new Set([...sg.votes.map(v => v.userId), sg.proposedBy])) {
    if (v !== authorId) pushNotification(v, tripId, `${userName(authorId)} commented on “${sg.title}”.`)
  }
  commit()
  void supabase.from('suggestions').update({ comments: sg.comments }).eq('id', suggestionId)
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
  sg.status = 'accepted'
  const actor = cache.sessionUserId
  if (actor) addActivity(tripId, actor, 'accepted suggestion into timeline', sg.title)
  commit()
  void supabase.from('suggestions').update({ status: 'accepted' }).eq('id', suggestionId)
}

export function declineSuggestion(tripId: ID, suggestionId: ID): void {
  const sg = cache.suggestions.find(x => x.id === suggestionId)
  if (sg) { sg.status = 'declined'; addActivity(tripId, cache.sessionUserId!, 'declined a suggestion', sg.title); commit(); void supabase.from('suggestions').update({ status: 'declined' }).eq('id', suggestionId) }
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
  cache.decisions.push({ ...d, id, tripId, votesByUserId: {}, status: 'open', raisedBy: cache.sessionUserId, createdAt: Date.now(), options: row.options })
  addActivity(tripId, cache.sessionUserId, `raised decision “${d.question}”`, 'Decisions')
  commit()
  void supabase.from('decisions').insert(row)
}

export function voteOnDecision(decisionId: ID, optionId: ID): void {
  const d = cache.decisions.find(x => x.id === decisionId)
  if (!d || !cache.sessionUserId || d.status !== 'open') return
  d.votesByUserId[cache.sessionUserId] = optionId
  addActivity(d.tripId, cache.sessionUserId, 'voted on a decision', d.question)
  commit()
  void supabase.from('decisions').update({ votes_by_user_id: d.votesByUserId }).eq('id', decisionId)
}

export function resolveDecision(decisionId: ID, optionId: ID): void {
  const d = cache.decisions.find(x => x.id === decisionId)
  if (!d) return
  d.status = 'resolved'; d.resolvedOptionId = optionId; d.resolvedAt = Date.now()
  addActivity(d.tripId, cache.sessionUserId!, 'resolved a decision', d.question)
  commit()
  void supabase.from('decisions').update({ status: 'resolved', resolved_option_id: optionId, resolved_at: d.resolvedAt }).eq('id', decisionId)
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
    views: existing?.views ?? 0,
    copies: existing?.copies ?? 0,
  }
  const existingIdx = cache.published.findIndex(x => x.tripId === p.tripId)
  const previous = existingIdx >= 0 ? cache.published[existingIdx] : undefined
  if (existingIdx >= 0) cache.published[existingIdx] = p
  else cache.published.push(p)
  commit()
  // The Supabase row is the ONLY persistence for a publication — if this
  // upsert is rejected, the optimistic cache write makes it look published
  // until the next refresh silently wipes it. Surface the failure and roll
  // the cache back so the UI never disagrees with the server. (Found live:
  // the gallery table was empty while the UI showed a published card.)
  const { error } = await supabase.from('published_itineraries').upsert({
    id: p.id, trip_id: p.tripId, creator_id: p.creatorId, title: p.title, tagline: p.tagline,
    cover_image_url: p.coverImageUrl, route_summary: p.routeSummary, duration_days: p.durationDays,
    estimated_budget_per_person_inr: p.estimatedBudgetPerPersonInr, travel_style: p.travelStyle,
    best_season: p.bestSeason, travel_tips: p.travelTips, warnings_and_assumptions: p.warningsAndAssumptions,
    free_day_indexes: p.freeDayIndexes, premium_price_inr: p.premiumPriceInr, subscriber_cta: p.subscriberCta,
  })
  if (error) {
    console.error('[yatraflow] publish persist failed', error)
    toast('Could not save the publication — it will not survive a refresh. (' + error.message + ')')
    const idx = cache.published.findIndex(x => x.id === p.id)
    if (idx >= 0) {
      if (previous) cache.published[idx] = previous
      else cache.published.splice(idx, 1)
      commit()
    }
  }
  return p
}

/** Remove a trip's public itinerary from Explore. The cache row is removed
 *  synchronously (the UI reflects it at once) and the Supabase row is deleted
 *  fire-and-forget. Only the creator (creator_id = auth.uid()) can delete
 *  server-side via RLS; the trip itself stays in My Trips — unpublish ≠
 *  delete trip. On a failed delete the cache row is restored. */
export function unpublishItinerary(tripId: ID): void {
  const idx = cache.published.findIndex(p => p.tripId === tripId)
  if (idx < 0) return
  const pub = cache.published[idx]
  cache.published = cache.published.filter((_, i) => i !== idx)
  commit()
  void supabase.from('published_itineraries').delete().eq('id', pub.id)
    .then(({ error }) => { if (error) { cache.published.push(pub); commit(); toast('Could not unpublish.') } })
}

export function unpublishedTripIds(userId: ID): ID[] {
  const mine = cache.trips.filter(t => t.members?.some(m => m.userId === userId && m.role === 'owner'))
  return mine.filter(t => !cache.published.some(p => p.tripId === t.id)).map(t => t.id)
}

export function registerPubView(id: ID): void {
  const p = cache.published.find(x => x.id === id)
  if (p) {
    p.views += 1
    commit()
    // The published_itineraries RLS policy only allows the creator to update a
    // row (auth.uid() = creator_id). A non-owner viewing a public trip would
    // otherwise fire a doomed write on every page load (bug #4). Only attempt
    // the increment when the current user actually owns the published row.
    if (cache.sessionUserId && p.creatorId === cache.sessionUserId) {
      void supabase.from('published_itineraries').update({ views: p.views }).eq('id', id)
    }
  }
}

export function registerPubCopy(id: ID): void {
  const p = cache.published.find(x => x.id === id)
  if (p) {
    p.copies += 1
    commit()
    if (cache.sessionUserId && p.creatorId === cache.sessionUserId) {
      void supabase.from('published_itineraries').update({ copies: p.copies }).eq('id', id)
    }
  }
}

// ---------------- Feed & notifications ----------------

export function activityFor(tripId: ID): ActivityEntry[] {
  return cache.activity.filter(a => a.tripId === tripId).sort((a, b) => b.at - a.at)
}

export function addActivity(tripId: ID, actorId: ID, verb: string, target?: string): void {
  const entry: ActivityEntry = { id: uuid(), tripId, actorId, verb, target, at: Date.now() }
  cache.activity.push(entry)
  void supabase.from('activity').insert({ id: entry.id, trip_id: tripId, actor_id: actorId, verb, target, at: entry.at })
}

export function notificationsFor(userId: ID): Notification[] {
  return cache.notifications.filter(n => n.userId === userId).sort((a, b) => b.at - a.at)
}

export function pushNotification(userId: ID, tripId: ID | undefined, text: string): void {
  const n: Notification = { id: uuid(), userId, tripId, text, read: false, at: Date.now() }
  cache.notifications.unshift(n)
  void supabase.from('notifications').insert({ id: n.id, user_id: userId, trip_id: tripId, text, read: false, at: n.at })
}

function notifyOwnerOf(tripId: ID, text: string): void {
  const t = tripById(tripId)
  const owner = t?.members?.find(m => m.role === 'owner')
  if (owner) pushNotification(owner.userId, tripId, text)
}

export function markAllNotificationsRead(userId: ID): void {
  cache.notifications.forEach(n => { if (n.userId === userId) n.read = true })
  commit()
  void supabase.from('notifications').update({ read: true }).eq('user_id', userId)
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

/** Record a recent local write so its realtime echo can be suppressed. */
function markLocalWrite(table: string, id: string): void {
  recentLocalWrites.set(`${table}:${id}`, Date.now())
}

function echoWindowEh(table: string, id: string): boolean {
  return isRecentLocalWrite(recentLocalWrites, table, id, Date.now())
}

/** Start listening for row changes. Call after a successful hydration. */
export function connectRealtime(_userId: string): void {
  if (!isSupabaseConfigured || realtimeChannel) return
  try {
    realtimeChannel = supabase
      .channel('yatraflow-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, p => applyRealtimeEvent('trips', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members' }, p => applyRealtimeEvent('trip_members', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suggestions' }, p => applyRealtimeEvent('suggestions', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'decisions' }, p => applyRealtimeEvent('decisions', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity' }, p => applyRealtimeEvent('activity', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, p => applyRealtimeEvent('notifications', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, p => applyRealtimeEvent('profiles', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'published_itineraries' }, p => applyRealtimeEvent('published_itineraries', p))
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
      trip.members = applyMemberChange(trip.members ?? [], {
        event,
        userId,
        role: (row?.role as TripMember['role']) ?? 'editor',
        joinedAt: Number(row?.joined_at ?? oldRow?.joined_at ?? Date.now()),
      })
      // If we were removed, the trip disappears from our view.
      if (event === 'DELETE' && userId === cache.sessionUserId) {
        cache.trips = cache.trips.filter(t => t.id !== tripId)
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
      if (!cache.activity.some(a => a.id === entry.id)) cache.activity.push(entry)
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
  const [tripRes, memRes] = await Promise.all([
    supabase.from('trips').select('*').eq('id', tripId).maybeSingle(),
    supabase.from('trip_members').select('*').eq('trip_id', tripId),
  ])
  if (tripRes.error || !tripRes.data) return
  const members = ((memRes.data ?? []) as MemberRow[]).map(m => ({ userId: m.user_id, role: m.role as TripMember['role'], joinedAt: m.joined_at }))
  const trip = rowToTrip(tripRes.data as TripRow, members)
  if (!cache.trips.some(t => t.id === trip.id)) cache.trips.push(trip)
  commit()
}

// ---------------- utils ----------------

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
