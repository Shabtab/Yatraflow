// ============ Masteradmin console stats ============
// Pure derivations over the hydrated cache — no React, no I/O, so they run in
// the node test env like engine.ts. Every funnel denominator is guarded:
// a fresh app with zero users/trips renders 0s, never NaN.

import type {
  ActivityEntry, PublishedItinerary, Trip, TripDecision, TripMember, User,
} from '../data/types'

/** Week-bucket key (Monday 00:00 UTC) for growth series. */
export function weekBucket(at: number): number {
  const d = new Date(at)
  const day = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime() - day * 86400000
}

export interface AdminOverview {
  totalUsers: number
  disabledUsers: number
  creators: number
  totalTrips: number
  privateTrips: number
  publicTrips: number
  totalMembers: number
  avgMembersPerTrip: number
  openSuggestions: number
  resolvedSuggestions: number
  openDecisions: number
  resolvedDecisions: number
  publishedCount: number
  totalViews: number
  totalCopies: number
  activityLast7d: number
  activityPrev7d: number
}

export function computeAdminOverview(
  users: User[], trips: Trip[], suggestions: { status: string }[],
  decisions: TripDecision[], published: PublishedItinerary[], activity: ActivityEntry[],
  now = Date.now(),
): AdminOverview {
  const totalUsers = users.length
  const disabledUsers = users.filter(u => u.profile.isDisabled).length
  const creators = users.filter(u => u.profile.isCreator).length
  const totalTrips = trips.length
  const publicTrips = trips.filter(t => t.visibility === 'public').length
  const totalMembers = trips.reduce((s, t) => s + (t.members?.length ?? 0), 0)
  const openSuggestions = suggestions.filter(s => s.status === 'open').length
  const openDecisions = decisions.filter(d => d.status === 'open').length
  const week = 7 * 86400000
  return {
    totalUsers, disabledUsers, creators,
    totalTrips, privateTrips: totalTrips - publicTrips, publicTrips,
    totalMembers,
    avgMembersPerTrip: totalTrips === 0 ? 0 : totalMembers / totalTrips,
    openSuggestions, resolvedSuggestions: suggestions.length - openSuggestions,
    openDecisions, resolvedDecisions: decisions.length - openDecisions,
    publishedCount: published.length,
    totalViews: published.reduce((s, p) => s + p.views, 0),
    totalCopies: published.reduce((s, p) => s + p.copies, 0),
    activityLast7d: activity.filter(a => a.at >= now - week).length,
    activityPrev7d: activity.filter(a => a.at >= now - 2 * week && a.at < now - week).length,
  }
}

export interface GrowthPoint { week: number; signups: number; trips: number }

export function computeGrowthSeries(users: User[], trips: Trip[], weeks = 12, now = Date.now()): GrowthPoint[] {
  const start = weekBucket(now) - (weeks - 1) * 7 * 86400000
  const points: GrowthPoint[] = Array.from({ length: weeks }, (_, i) => ({ week: start + i * 7 * 86400000, signups: 0, trips: 0 }))
  for (const u of users) {
    const i = Math.floor((weekBucket(u.createdAt) - start) / (7 * 86400000))
    if (i >= 0 && i < weeks) points[i].signups += 1
  }
  for (const t of trips) {
    const i = Math.floor((weekBucket(t.createdAt) - start) / (7 * 86400000))
    if (i >= 0 && i < weeks) points[i].trips += 1
  }
  return points
}

export interface FunnelStats {
  usersWithTrips: number
  activationPct: number
  tripsWithCollab: number
  collabPct: number
  tripsPublished: number
  publishPct: number
  viewToCopyPct: number
}

export function computeFunnel(
  users: User[], trips: Trip[], published: PublishedItinerary[],
): FunnelStats {
  const ownerIds = new Set<string>()
  for (const t of trips) {
    const owner = (t.members ?? []).find(m => m.role === 'owner')
    if (owner) ownerIds.add(owner.userId)
  }
  const usersWithTrips = ownerIds.size
  const tripsWithCollab = trips.filter(t => (t.members?.length ?? 0) > 1).length
  const pubTripIds = new Set(published.map(p => p.tripId))
  const tripsPublished = trips.filter(t => pubTripIds.has(t.id)).length
  const views = published.reduce((s, p) => s + p.views, 0)
  const copies = published.reduce((s, p) => s + p.copies, 0)
  return {
    usersWithTrips,
    activationPct: users.length === 0 ? 0 : (usersWithTrips / users.length) * 100,
    tripsWithCollab,
    collabPct: trips.length === 0 ? 0 : (tripsWithCollab / trips.length) * 100,
    tripsPublished,
    publishPct: trips.length === 0 ? 0 : (tripsPublished / trips.length) * 100,
    viewToCopyPct: views === 0 ? 0 : (copies / views) * 100,
  }
}

/** Per-trip member velocity: joins in the last 30d, for the invites tab. */
export function recentJoins(members: TripMember[], now = Date.now()): number {
  const cutoff = now - 30 * 86400000
  return members.filter(m => m.joinedAt >= cutoff).length
}
