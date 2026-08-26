// ============ Application store ============
// localStorage persistence (a proper DB can slot behind this same interface later).
import { useSyncExternalStore } from 'react'
import type {
  User, Trip, StopSuggestion, TripDecision, ActivityEntry, Notification,
  PublishedItinerary, ID, ItineraryStop, ItineraryDay, TripMember, Expense, FixedCommitment,
} from '../data/types'
import { seedData, uid, simpleHash } from '../data/seed'

const STORAGE_KEY = 'yatraflow_db_v1'

interface DB {
  users: User[]
  trips: Trip[]
  suggestions: StopSuggestion[]
  decisions: TripDecision[]
  activity: ActivityEntry[]
  notifications: Notification[]
  published: PublishedItinerary[]
  sessionUserId: ID | null
}

function freshDb(): DB {
  return {
    users: structuredClone(seedData.users),
    trips: structuredClone(seedData.trips),
    suggestions: structuredClone(seedData.suggestions),
    decisions: structuredClone(seedData.decisions),
    activity: structuredClone(seedData.activity),
    notifications: structuredClone(seedData.notifications),
    published: structuredClone(seedData.published),
    sessionUserId: null,
  }
}

// NOTE: saveTimer must be declared before `load()` runs below — persist() touches it.
let saveTimer: ReturnType<typeof setTimeout> | null = null
let db: DB = load()
const listeners = new Set<() => void>()

function isValidDb(d: unknown): d is DB {
  if (!d || typeof d !== 'object') return false
  const o = d as Record<string, unknown>
  return (
    Array.isArray(o.users) && Array.isArray(o.trips) &&
    Array.isArray(o.suggestions) && Array.isArray(o.decisions) &&
    Array.isArray(o.activity) && Array.isArray(o.notifications) &&
    Array.isArray(o.published)
  )
}

function load(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      // reject stores saved by older/incompatible versions — reseed instead of crashing
      if (isValidDb(parsed)) return parsed
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch { /* corrupted store — reseed */ }
  const d = freshDb()
  persist(d)
  return d
}

function persist(next: DB) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)) } catch { /* quota */ }
  }, 120)
}

function commit() {
  persist(db)
  listeners.forEach(l => l())
}
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function getSnapshot(): DB { return db }

export function useDb(): DB {
  return useSyncExternalStore(subscribe, getSnapshot)
}

// ---------------- Session ----------------

export function currentUser(db: DB = getSnapshot()): User | null {
  return db.users.find(u => u.id === db.sessionUserId) ?? null
}

export function login(email: string, password: string): { ok: boolean; error?: string } {
  const u = db.users.find(x => x.email.toLowerCase() === email.trim().toLowerCase())
  if (!u) return { ok: false, error: 'No account found with this email.' }
  if (u.passwordHash !== simpleHash(password)) return { ok: false, error: 'Incorrect password.' }
  db.sessionUserId = u.id
  commit()
  return { ok: true }
}

export function signup(name: string, email: string, password: string): { ok: boolean; error?: string } {
  const cleanEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, error: 'Enter a valid email address.' }
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' }
  if (db.users.some(u => u.email.toLowerCase() === cleanEmail)) return { ok: false, error: 'An account with this email already exists.' }
  const user: User = {
    id: uid('u'), email: cleanEmail,
    passwordHash: simpleHash(password),
    profile: { name: name.trim(), languages: ['en'], travelStyles: ['balanced'], isCreator: false },
    createdAt: Date.now(),
  }
  db.users.push(user)
  db.sessionUserId = user.id
  commit()
  return { ok: true }
}

export function loginDemo(): void {
  let demo = db.users.find(u => u.id === 'u_demo')
  if (!demo) { demo = structuredClone(seedData.users[0]); db.users.push(demo) }
  db.sessionUserId = demo.id
  commit()
}

export function logout(): void {
  db.sessionUserId = null
  commit()
}

export function updateProfile(patch: Partial<User['profile']>): void {
  const u = currentUser()
  if (!u) return
  Object.assign(u.profile, patch)
  commit()
}

// ---------------- Trips ----------------

export function tripsForUser(userId: ID | null): Trip[] {
  if (!userId) return []
  return db.trips.filter(t => t.members?.some?.(m => m.userId === userId))
}

export function tripById(id: ID): Trip | undefined {
  return db.trips.find(t => t.id === id)
}

export interface NewTripInput {
  name: string; startLocation: string; destinations: string[];
  startDate: string; endDate: string; travellers: number;
  transportMode: Trip['transportMode']; budgetPerPersonInr: number;
  travelStyle: Trip['travelStyle'];
  fixedCommitments: Omit<FixedCommitment, 'id'>[];
  coverEmoji?: string;
}

export function createTrip(ownerId: ID, input: NewTripInput, seedStops?: ItineraryStop[][]): Trip {
  const dayCount = Math.max(1, diffDays(input.startDate, input.endDate))
  const days: ItineraryDay[] = Array.from({ length: dayCount }, (_, i) => ({
    id: uid('day'), index: i, stops: [],
  }))
  if (seedStops) days.forEach((d, i) => { if (seedStops[i]) d.stops = seedStops[i] })

  const trip: Trip = {
    id: uid('trip'),
    ...input,
    fixedCommitments: input.fixedCommitments.map(fc => ({ ...fc, id: uid('fc') })),
    days, expenses: [], coverEmoji: input.coverEmoji ?? '🧭',
    visibility: 'private', createdAt: Date.now(), updatedAt: Date.now(),
    members: [{ userId: ownerId, role: 'owner' as const, joinedAt: Date.now() }],
  } as Trip
  db.trips.push(trip)
  commit()
  return trip
}

/** Duplicate any trip into the user's workspace (Copy This Trip / demo seeding). */
export function duplicateTrip(source: Trip, ownerId: ID, makePublic?: boolean): Trip {
  const copy: Trip = structuredClone(source)
  copy.id = uid('trip')
  copy.name = source.name.includes('(copy)') ? source.name : `${source.name} (copy)`
  copy.visibility = makePublic ? 'public' : 'private'
  copy.createdAt = Date.now(); copy.updatedAt = Date.now()
  copy.days = copy.days.map(d => ({ ...d, id: uid('day'), stops: d.stops.map(s => ({ ...s, id: uid('st') })) }))
  copy.expenses = copy.expenses.map(e => ({ ...e, id: uid('ex') }))
  copy.fixedCommitments = copy.fixedCommitments.map(f => ({ ...f, id: uid('fc') }))
  copy.members = [{ userId: ownerId, role: 'owner' as const, joinedAt: Date.now() }]
  db.trips.push(copy)
  commit()
  return copy
}

export function ensureDemoTripsFor(userId: ID): void {
  const hasAny = db.trips.some(t => t.members?.some(m => m.userId === userId))
  if (hasAny) return
  // give brand-new accounts a starter trip so the workspace is never empty
  const kerala = tripById('trip_kerala_demo')
  if (kerala) duplicateTrip(kerala, userId)
}

export function deleteTrip(id: ID): void {
  db.trips = db.trips.filter(t => t.id !== id)
  commit()
}

/** Re-insert a trip at its old position — powers Undo on trip deletion. */
export function restoreTrip(trip: Trip, index: number): void {
  if (db.trips.some(t => t.id === trip.id)) return
  db.trips.splice(Math.min(index, db.trips.length), 0, trip)
  commit()
}

/** Put a removed member back — powers Undo on member removal. */
export function restoreMember(tripId: ID, member: TripMember): void {
  const t = tripById(tripId)
  if (!t || t.members?.some(m => m.userId === member.userId)) return
  t.members = [...(t.members ?? []), member]
  commit()
}

/** Re-insert a deleted expense line — powers Undo on expense deletion. */
export function restoreExpense(tripId: ID, expense: Expense, index: number): void {
  const t = tripById(tripId)
  if (!t || t.expenses.some(x => x.id === expense.id)) return
  t.expenses.splice(Math.min(index, t.expenses.length), 0, expense)
  commit()
}

export function updateTrip(id: ID, patch: Partial<Trip>): void {
  const t = tripById(id)
  if (!t) return
  Object.assign(t, patch, { updatedAt: Date.now() })
  commit()
}

// ---------------- Members & collaboration ----------------

export function membersOf(trip: Trip): TripMember[] {
  return trip.members ?? []
}

export function userById(id: ID | undefined): User | undefined {
  if (!id) return undefined
  return db.users.find(u => u.id === id)
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
  if (t && m) { m.role = role; commit() }
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
  }
  return true
}

export function removeMember(tripId: ID, userId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  t.members = (t.members ?? []).filter(m => m.userId !== userId)
  commit()
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

export function updateStop(tripId: ID, stopId: ID, patch: Partial<ItineraryStop>): void {
  for (const day of tripById(tripId)!.days) {
    const s = day.stops.find(x => x.id === stopId)
    if (s) { Object.assign(s, patch); touchAndLog(tripById(tripId)!, `updated “${patch.title ?? s.title}”`, `Day ${day.index + 1}`); break }
  }
  commit()
}

export function deleteStop(tripId: ID, stopId: ID): void {
  const trip = tripById(tripId)!
  for (const day of trip.days) {
    const before = day.stops.length
    day.stops = day.stops.filter(x => x.id !== stopId)
    if (day.stops.length !== before) { renumber(day); touchAndLog(trip, `removed a stop`, `Day ${day.index + 1}`); break }
  }
  commit()
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
  } else {
    commit()
  }
}

export function setStopStatus(tripId: ID, status: ItineraryStop['status'], stopId: ID): void {
  for (const day of tripById(tripId)!.days) {
    const s = day.stops.find(x => x.id === stopId)
    if (s) { s.status = status; touchAndLog(tripById(tripId)!, `marked “${s.title}” as ${status}`, `Day ${day.index + 1}`); break }
  }
  commit()
}

function renumber(day: ItineraryDay): void {
  ;[...day.stops].sort((a, b) => a.orderInDay - b.orderInDay).forEach((s, i) => { s.orderInDay = i + 1 })
}

function touchAndLog(trip: Trip, verb: string, target?: string): void {
  trip.updatedAt = Date.now()
  if (db.sessionUserId) addActivity(trip.id, db.sessionUserId, verb, target)
  commit()
}

// ---------------- Expenses ----------------

export function addExpense(tripId: ID, e: Omit<Expense, 'id'>): void {
  tripById(tripId)?.expenses.push({ ...e, id: uid('ex') })
  commit()
}

export function deleteExpense(tripId: ID, expenseId: ID): void {
  const t = tripById(tripId)
  if (!t) return
  t.expenses = t.expenses.filter(x => x.id !== expenseId)
  commit()
}

// ---------------- Suggestions / votes / comments ----------------

export function addSuggestion(tripId: ID, s: Omit<StopSuggestion, 'id' | 'votes' | 'comments' | 'status' | 'createdAt' | 'tripId'>): void {
  db.suggestions.push({
    ...s, id: uid('sg'), tripId, votes: [], comments: [], status: 'open', createdAt: Date.now(),
  })
  const trip = tripById(tripId)
  if (trip && db.sessionUserId) {
    addActivity(tripId, db.sessionUserId, `suggested “${s.title}”`, `Day ${(s.dayIndex ?? 0) + 1}`)
    // notify other members
    for (const m of trip.members ?? []) {
      if (m.userId !== db.sessionUserId) {
        pushNotification(m.userId, tripId, `${userName(db.sessionUserId)} suggested “${s.title}” for Day ${(s.dayIndex ?? 0) + 1}.`)
      }
    }
  }
  commit()
}

export function voteSuggestion(tripId: ID, suggestionId: ID, userId: ID, value: 1 | -1): void {
  const sg = db.suggestions.find(x => x.id === suggestionId)
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
}

export function addCommentToSuggestion(tripId: ID, suggestionId: ID, authorId: ID, text: string): void {
  const sg = db.suggestions.find(x => x.id === suggestionId)
  if (!sg || !text.trim()) return
  sg.comments.push({ id: uid('cm'), authorId, text: text.trim(), createdAt: Date.now() })
  addActivity(tripId, authorId, 'commented on a suggestion', sg.title)
  for (const v of new Set([...sg.votes.map(v => v.userId), sg.proposedBy])) {
    if (v !== authorId) pushNotification(v, tripId, `${userName(authorId)} commented on “${sg.title}”.`)
  }
  commit()
}

/** Accept a suggestion: adds it to the timeline and closes the suggestion. */
export function acceptSuggestionIntoTimeline(tripId: ID, suggestionId: ID): void {
  const sg = db.suggestions.find(x => x.id === suggestionId)
  const trip = tripById(tripId)
  if (!sg || !trip) return
  addStop(tripId, sg.dayIndex, {
    title: sg.title, category: sg.category, locationName: sg.locationName, lat: sg.lat, lng: sg.lng,
    description: sg.description, visitMinutes: sg.visitMinutes,
    entryFeeInrPerPerson: sg.estimatedEntryFeeInr, transportCostInrTotal: sg.estimatedTransportInr,
    priority: 'nice-to-have', status: 'confirmed',
  })
  sg.status = 'accepted'
  addActivity(tripId, db.sessionUserId!, 'accepted suggestion into timeline', sg.title)
  commit()
}

export function declineSuggestion(tripId: ID, suggestionId: ID): void {
  const sg = db.suggestions.find(x => x.id === suggestionId)
  if (sg) { sg.status = 'declined'; addActivity(tripId, db.sessionUserId!, 'declined a suggestion', sg.title); commit() }
}

// ---------------- Decisions ----------------

export function addDecision(tripId: ID, d: Pick<TripDecision, 'question' | 'context' | 'options'>): void {
  if (!db.sessionUserId) return
  db.decisions.push({
    ...d, id: uid('dc'), tripId, votesByUserId: {}, status: 'open', raisedBy: db.sessionUserId, createdAt: Date.now(),
    options: d.options.map(o => ({ ...o, id: uid('o') })),
  })
  addActivity(tripId, db.sessionUserId, `raised decision “${d.question}”`, 'Decisions')
  commit()
}

export function voteOnDecision(decisionId: ID, optionId: ID): void {
  const d = db.decisions.find(x => x.id === decisionId)
  if (!d || !db.sessionUserId || d.status !== 'open') return
  d.votesByUserId[db.sessionUserId] = optionId
  addActivity(d.tripId, db.sessionUserId, 'voted on a decision', d.question)
  commit()
}

export function resolveDecision(decisionId: ID, optionId: ID): void {
  const d = db.decisions.find(x => x.id === decisionId)
  if (!d) return
  d.status = 'resolved'; d.resolvedOptionId = optionId; d.resolvedAt = Date.now()
  addActivity(d.tripId, db.sessionUserId!, 'resolved a decision', d.question)
  commit()
}

// ---------------- Publishing ----------------

export function publishItinerary(pub: Omit<PublishedItinerary, 'id' | 'publishedAt' | 'views' | 'copies'>): PublishedItinerary {
  const p: PublishedItinerary = { ...pub, id: uid('pub'), publishedAt: Date.now(), views: 0, copies: 0 }
  const existingIdx = db.published.findIndex(x => x.tripId === p.tripId)
  if (existingIdx >= 0) db.published[existingIdx] = p
  else db.published.push(p)
  commit()
  return p
}

export function unpublishedTripIds(userId: ID): ID[] {
  const mine = db.trips.filter(t => t.members?.some(m => m.userId === userId && m.role === 'owner'))
  return mine.filter(t => !db.published.some(p => p.tripId === t.id)).map(t => t.id)
}

export function registerPubView(id: ID): void {
  const p = db.published.find(x => x.id === id)
  if (p) { p.views += 1; commit() }
}

export function registerPubCopy(id: ID): void {
  const p = db.published.find(x => x.id === id)
  if (p) { p.copies += 1; commit() }
}

// ---------------- Feed & notifications ----------------

export function activityFor(tripId: ID): ActivityEntry[] {
  return db.activity.filter(a => a.tripId === tripId).sort((a, b) => b.at - a.at)
}

export function addActivity(tripId: ID, actorId: ID, verb: string, target?: string): void {
  db.activity.push({ id: uid('af'), tripId, actorId, verb, target, at: Date.now() })
}

export function notificationsFor(userId: ID): Notification[] {
  return db.notifications.filter(n => n.userId === userId).sort((a, b) => b.at - a.at)
}

export function pushNotification(userId: ID, tripId: ID | undefined, text: string): void {
  db.notifications.unshift({ id: uid('nt'), userId, tripId, text, read: false, at: Date.now() })
  commit()
}

function notifyOwnerOf(tripId: ID, text: string): void {
  const t = tripById(tripId)
  const owner = t?.members?.find(m => m.role === 'owner')
  if (owner) pushNotification(owner.userId, tripId, text)
}

export function markAllNotificationsRead(userId: ID): void {
  db.notifications.forEach(n => { if (n.userId === userId) n.read = true })
  commit()
}

// ---------------- utils ----------------

function diffDays(a: string, b: string): number {
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1)
}
