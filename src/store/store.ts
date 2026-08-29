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

interface TripRow {
  id: string; owner_id: string; name: string; start_location: string;
  start_location_coords: LatLngPoint | null; destinations: string[];
  destination_coords: (LatLngPoint | null)[] | null;
  start_date: string; end_date: string; travellers: number; transport_mode: string;
  /** present only after the fuel migrations (see supabase/schema.sql) */
  fuel_economy_km_per_l?: number | null;
  fuel_price_per_l?: number | null;
  /** absent/null = default (round trip on for self-drive) */
  round_trip?: boolean | null;
  budget_per_person_inr: number; travel_style: string; fixed_commitments: FixedCommitment[];
  days: ItineraryDay[]; expenses: Expense[]; cover_emoji: string; visibility: 'private' | 'public';
  created_at: number; updated_at: number;
}

function rowToTrip(row: TripRow, members: TripMember[]): Trip {
  return {
    id: row.id, name: row.name, startLocation: row.start_location, startLocationCoords: row.start_location_coords ?? undefined,
    destinations: row.destinations ?? [],
    destinationCoords: row.destination_coords ?? undefined,
    startDate: row.start_date, endDate: row.end_date, travellers: row.travellers,
    transportMode: row.transport_mode as Trip['transportMode'], budgetPerPersonInr: row.budget_per_person_inr,
    fuelEconomyKmL: row.fuel_economy_km_per_l ?? undefined,
    fuelPricePerL: row.fuel_price_per_l ?? undefined,
    roundTrip: row.round_trip ?? undefined,
    travelStyle: row.travel_style as Trip['travelStyle'], fixedCommitments: row.fixed_commitments ?? [],
    days: row.days ?? [], expenses: row.expenses ?? [], coverEmoji: row.cover_emoji, visibility: row.visibility,
    createdAt: row.created_at, updatedAt: row.updated_at, members,
  }
}

/**
 * Map a trip to its Postgres row. `cols` says which optional columns the
 * database actually has (see tripsHaveOptionalColumns) — writing a column the
 * database doesn't know yet would fail the whole insert/update.
 */
function tripToRow(trip: Trip, ownerId: string, cols?: { economy: boolean; price: boolean; roundTrip: boolean }): Omit<TripRow, 'created_at' | 'updated_at'> {
  const row: Omit<TripRow, 'created_at' | 'updated_at'> = {
    id: trip.id, owner_id: ownerId, name: trip.name, start_location: trip.startLocation,
    start_location_coords: trip.startLocationCoords ?? null,
    destinations: trip.destinations,
    destination_coords: trip.destinationCoords ?? null,
    start_date: trip.startDate, end_date: trip.endDate,
    travellers: trip.travellers, transport_mode: trip.transportMode, budget_per_person_inr: trip.budgetPerPersonInr,
    travel_style: trip.travelStyle, fixed_commitments: trip.fixedCommitments, days: trip.days,
    expenses: trip.expenses, cover_emoji: trip.coverEmoji, visibility: trip.visibility,
  }
  if (cols?.economy) row.fuel_economy_km_per_l = trip.fuelEconomyKmL ?? null
  if (cols?.price) row.fuel_price_per_l = trip.fuelPricePerL ?? null
  if (cols?.roundTrip) row.round_trip = trip.roundTrip ?? null
  return row
}

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
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Email/password sign up via Supabase Auth. Profile row is created by the DB trigger. */
export async function signup(name: string, email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, error: 'Enter a valid email address.' }
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' }
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail, password,
    options: { data: { name: name.trim() } },
  })
  if (error) return { ok: false, error: error.message }
  // Supabase may require email confirmation; surface that gently.
  if (data.session === null) {
    return { ok: false, error: 'Check your email to confirm your account, then log in.' }
  }
  return { ok: true }
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut()
  // onAuthStateChange handler clears the cache.
}

// ---------------- Init / hydration ----------------

/** Call once on app mount. Subscribes to auth and hydrates the cache. */
export function init(): void {
  if (initialized) return
  initialized = true

  const hydrate = async (userId: string | null) => {
    if (!userId) {
      patch({ users: [], trips: [], suggestions: [], decisions: [], activity: [], notifications: [], published: [], sessionUserId: null })
      commit()
      return
    }
    await hydrateFromSupabase(userId)
  }

  supabase.auth.getSession().then(({ data }) => { void hydrate(data.session?.user?.id ?? null) })
  supabase.auth.onAuthStateChange((_event, session) => {
    void hydrate(session?.user?.id ?? null)
  })
}

async function hydrateFromSupabase(userId: string): Promise<void> {
  try {
    const [
      profRes, tripsRes, memRes, sugRes, decRes, actRes, notRes, pubRes,
    ] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('trips').select('*'),
      supabase.from('trip_members').select('*'),
      supabase.from('suggestions').select('*'),
      supabase.from('decisions').select('*'),
      supabase.from('activity').select('*'),
      supabase.from('notifications').select('*'),
      supabase.from('published_itineraries').select('*'),
    ])

    const profiles = (profRes.data ?? []) as ProfileRow[]
    const trips = (tripsRes.data ?? []) as TripRow[]
    const members = (memRes.data ?? []) as MemberRow[]

    const users = profiles.map(rowToUser)
    const tripList = trips.map(row =>
      rowToTrip(row, members.filter(m => m.trip_id === row.id).map(m => ({ userId: m.user_id, role: m.role, joinedAt: m.joined_at })))
    )

    patch({
      users,
      trips: tripList,
      suggestions: (sugRes.data ?? []).map(rowToSuggestion),
      decisions: (decRes.data ?? []).map(rowToDecision),
      activity: (actRes.data ?? []).map(rowToActivity),
      notifications: (notRes.data ?? []).map(rowToNotification),
      published: (pubRes.data ?? []).map(rowToPublished),
      sessionUserId: userId,
    })
    commit()

    // First-time users get the demo trips seeded into their account.
    if (tripList.length === 0) await seedDemoFor(userId)
  } catch (e) {
    console.error('[yatraflow] hydration failed', e)
    toast('Could not load your data — check your connection.')
  }
}

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
  }
  // re-hydrate so the freshly seeded trips show up
  await hydrateFromSupabase(userId)
}

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
// an unknown column. Probe once per session with harmless reads — never
// assume. The promise is cached so concurrent callers share one probe.
let optionalColumnsProbe: Promise<{ economy: boolean; price: boolean; roundTrip: boolean }> | null = null

function tripsHaveOptionalColumns(): Promise<{ economy: boolean; price: boolean; roundTrip: boolean }> {
  if (!isSupabaseConfigured) return Promise.resolve({ economy: false, price: false, roundTrip: false })
  if (!optionalColumnsProbe) {
    optionalColumnsProbe = (async () => {
      const economy = !(await supabase.from('trips').select('fuel_economy_km_per_l').limit(1)).error
      const price = !(await supabase.from('trips').select('fuel_price_per_l').limit(1)).error
      const roundTrip = !(await supabase.from('trips').select('round_trip').limit(1)).error
      if (!economy || !price || !roundTrip) {
        console.warn('[yatraflow] trips optional columns missing — run supabase/schema.sql; fuel/round-trip inputs stay session-only until then.')
      }
      return { economy, price, roundTrip }
    })()
  }
  return optionalColumnsProbe
}

async function persistTrip(trip: Trip, ownerId: ID) {
  const cols = await tripsHaveOptionalColumns()
  const { error } = await supabase.from('trips').insert(tripToRow(trip, ownerId, cols))
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
  void supabase.from('trips').delete().eq('id', id).then(({ error }) => { if (error) { cache.trips.splice(idx, 0, removed); commit() } })
}

/** Re-insert a trip at its old position — powers Undo on trip deletion. */
export function restoreTrip(trip: Trip, index: number): void {
  if (cache.trips.some(t => t.id === trip.id)) return
  cache.trips.splice(Math.min(index, cache.trips.length), 0, trip)
  commit()
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
  const [moved] = arr.splice(fromIdx, 1)
  arr.splice(toIdx, 0, moved)
  arr.forEach((s, i) => { s.orderInDay = i + 1 })
  day.stops = arr
  touchAndLog(trip, `reordered Day ${dayIndex + 1}`, 'Timeline')
  void persistTripField(tripId, trip)
}

export function moveStopBetweenDays(tripId: ID, stopId: ID, toDayIndex: number, position?: number): void {
  const trip = tripById(tripId)!
  let moved: ItineraryStop | undefined
  for (const day of trip.days) {
    const idx = day.stops.findIndex(s => s.id === stopId)
    if (idx >= 0) { [moved] = day.stops.splice(idx, 1); renumber(day) }
  }
  const target = trip.days.find(d => d.index === toDayIndex)
  if (target && moved) {
    moved.orderInDay = position ?? target.stops.length + 1
    target.stops.push(moved)
    renumber(target)
    touchAndLog(trip, `moved “${moved.title}” to Day ${toDayIndex + 1}`, 'Timeline')
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
  addActivity(tripId, cache.sessionUserId!, 'accepted suggestion into timeline', sg.title)
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

export function publishItinerary(pub: Omit<PublishedItinerary, 'id' | 'publishedAt' | 'views' | 'copies'>): PublishedItinerary {
  const id = uid('pub')
  const p: PublishedItinerary = { ...pub, id, publishedAt: Date.now(), views: 0, copies: 0 }
  const existingIdx = cache.published.findIndex(x => x.tripId === p.tripId)
  if (existingIdx >= 0) cache.published[existingIdx] = p
  else cache.published.push(p)
  commit()
  void supabase.from('published_itineraries').upsert({
    id: p.id, trip_id: p.tripId, creator_id: p.creatorId, title: p.title, tagline: p.tagline,
    cover_image_url: p.coverImageUrl, route_summary: p.routeSummary, duration_days: p.durationDays,
    estimated_budget_per_person_inr: p.estimatedBudgetPerPersonInr, travel_style: p.travelStyle,
    best_season: p.bestSeason, travel_tips: p.travelTips, warnings_and_assumptions: p.warningsAndAssumptions,
    free_day_indexes: p.freeDayIndexes, premium_price_inr: p.premiumPriceInr, subscriber_cta: p.subscriberCta,
  })
  return p
}

export function unpublishedTripIds(userId: ID): ID[] {
  const mine = cache.trips.filter(t => t.members?.some(m => m.userId === userId && m.role === 'owner'))
  return mine.filter(t => !cache.published.some(p => p.tripId === t.id)).map(t => t.id)
}

export function registerPubView(id: ID): void {
  const p = cache.published.find(x => x.id === id)
  if (p) { p.views += 1; commit(); void supabase.from('published_itineraries').update({ views: p.views }).eq('id', id) }
}

export function registerPubCopy(id: ID): void {
  const p = cache.published.find(x => x.id === id)
  if (p) { p.copies += 1; commit(); void supabase.from('published_itineraries').update({ copies: p.copies }).eq('id', id) }
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
