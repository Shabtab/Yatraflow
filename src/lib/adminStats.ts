// ============ Masteradmin console stats ============
// Pure derivations over the hydrated cache — no React, no I/O, so they run in
// the node test env like engine.ts. Every funnel denominator is guarded:
// a fresh app with zero users/trips renders 0s, never NaN.

import type {
  ActivityEntry, PublishedItinerary, Trip, TripDecision, TripMember, User,
} from '../data/types'
import {
  buildSalesLedger, revenueByPublication, revenuePeriods,
  type ActualSales, type PublicationRevenue, type RevenuePeriod,
} from './earnings'

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
  const tripsWithCollab = trips.filter(t => new Set((t.members ?? []).map(m => m.userId)).size > 1).length
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

// ============ Platform revenue (the console's Analytics tab) ============

/** A sale as `admin_revenue` returns it — facts only, no buyer. */
export interface PlatformSale {
  grantedAt: number
  amountPaidInr: number
  pubId: string
  /** The payee. Not a leak: the ladder is charged PER CREATOR, so without this
   *  the platform's cut cannot be computed at all (see `platformRevenue`). */
  creatorId: string
}

/** One publication's slice of the platform's books, with its payee. The console
 *  is a god-view: "which plan sold" is more actionable beside whose plan it is,
 *  and a fee only means anything as that creator's own slice of the ladder. */
export interface PlatformPublicationRevenue extends PublicationRevenue {
  creatorId: string
}

export interface PlatformRevenue {
  /** Every sale on the platform, in one ledger. The fee on it is the sum of
   *  what each creator was charged, not one ladder over the platform's total. */
  sales: ActualSales
  /** The same rows grouped into the weekly windows they fall in. */
  periods: RevenuePeriod[]
  /** The same rows grouped by publication instead — "which plan sold", which a
   *  weekly window cannot answer. Sorted by gross, biggest earner first. */
  publications: PlatformPublicationRevenue[]
  /** How many distinct creators the fee was charged to — the reason the
   *  per-creator grouping above exists at all. */
  creators: number
}

/**
 * Platform-wide revenue from the admin RPC's rows.
 *
 * Deliberately the SAME ledger function a creator's own earnings tab uses
 * (`buildSalesLedger`), so the platform's cut cannot disagree with the sum of
 * the creators' own charges — there is one implementation of the ladder and one
 * attribution order behind both figures.
 *
 * It runs the ladder ONCE PER CREATOR and sums, because that is what actually
 * happens: the tier is walked over each creator's own lifetime gross. See the
 * comment in the body for why a single ladder over the platform's total would
 * understate the cut.
 *
 * Titles come from the CALLER (the console resolves them from its own hydrated
 * gallery, where `published read` is open to everyone). A publication it cannot
 * resolve falls back to its id rather than being dropped from the books: a sale
 * whose plan is unknown is still money that was collected.
 *
 * Rows group two ways, because "when" and "which plan" are different questions:
 * weekly windows (`periods`) and per publication (`publications`).
 */
export function platformRevenue(
  rows: PlatformSale[],
  titleOf: (pubId: string) => string = pubId => pubId,
): PlatformRevenue {
  // ONE LEDGER PER CREATOR, then sum. The ladder runs over each creator's own
  // lifetime gross — that is what each of them is charged — so a single ladder
  // over the platform's total would UNDERSTATE the cut: the platform's total
  // crosses ₹25,000 long before most creators' do, and most of it would then be
  // charged the lower rate. The test that pins this uses two creators with
  // ₹20,000 each: ₹6,000 of cut (₹3,000 apiece), where one shared ladder over
  // ₹40,000 would claim ₹5,250.
  const byCreator = new Map<string, PlatformSale[]>()
  for (const row of rows) {
    const list = byCreator.get(row.creatorId)
    if (list) list.push(row)
    else byCreator.set(row.creatorId, [row])
  }
  const ledgerByCreator = new Map<string, ActualSales>()
  for (const [creatorId, creatorRows] of byCreator) {
    ledgerByCreator.set(creatorId, buildSalesLedger(creatorRows, titleOf))
  }
  const ledgers = [...ledgerByCreator.values()]
  const allRows = ledgers.flatMap(ledger => ledger.rows).sort((a, b) => b.grantedAt - a.grantedAt)
  const grossInr = ledgers.reduce((sum, ledger) => sum + ledger.grossInr, 0)
  const feeInr = ledgers.reduce((sum, ledger) => sum + ledger.feeInr, 0)
  return {
    sales: {
      rows: allRows,
      grossInr,
      feeInr,
      netInr: grossInr - feeInr,
      soldPubIds: [...new Set(allRows.map(r => r.pubId))],
    },
    periods: revenuePeriods(allRows),
    // Grouped per creator FIRST and only then keyed by publication: a fee is that
    // creator's own slice of the ladder, so one platform-wide fee per publication
    // would be a ladder nobody walked.
    publications: [...ledgerByCreator.entries()]
      .flatMap(([creatorId, ledger]) => revenueByPublication(ledger.rows).map(p => ({ ...p, creatorId })))
      .sort((a, b) => b.grossInr - a.grossInr || a.pubId.localeCompare(b.pubId)),
    creators: byCreator.size,
  }
}
