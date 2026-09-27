// ============ What a buyer owns (ROADMAP I-20) ============
// Two surfaces read the same facts: the shelf ("My purchases") and the moment
// right after a purchase. Both are derived here rather than inline in the page
// so the rules that are easy to get quietly wrong — ordering, the update
// marker, a publication the buyer owns but cannot see any more, a doubled row
// — are pinned by the node suite.
//
// The pairing is deliberate: `entitlements` says what was PAID (the price
// snapshot, the date), `published_itineraries` says what the plan IS now
// (cover, length, places, when the creator last refreshed it). A shelf that
// reads only the first cannot show a cover; one that reads only the second
// cannot tell you what you paid or when.

import { computeTotals } from './engine'
import type { Entitlement } from './payments'
import type { PublishedItinerary, Trip, User } from '../data/types'

/** One owned publication, as the shelf needs it. */
export interface PurchaseRow {
  pubId: string
  /** The entitlement itself — the buyer's title deed, and the capability that
   *  unlocks the buyer-framed share card. Owner-only RLS keeps it readable to
   *  this buyer alone, so the shelf is the right place to hold it. */
  entitlementId: string
  title: string
  coverImageUrl?: string
  creatorId: string
  /** Absent when the creator's profile is not in the cache (or is deleted). */
  creatorName?: string
  amountPaidInr: number
  /** Epoch ms — when the entitlement was granted, i.e. when money moved. */
  grantedAt: number
  durationDays: number
  /** Ordered place names on the publication — "places", the label the rest of
   *  the app uses for `routeSummary` (stops are a different, per-day thing). */
  places: number
  /** The creator has re-published since this purchase. */
  updatedSince: boolean
  refreshedAt?: number
  /** False when the publication row is not in the cache. The entitlement is
   *  still the buyer's (the database ties the two together for life), so the
   *  row is kept and rendered as "no longer listed" rather than dropped. */
  listed: boolean
  /** The row's own facts could not be read as money: the amount is absent or
   *  not a finite number. The plan is STILL listed and still the buyer's — only
   *  the money is unreadable, so the row is flagged instead of dropped (silently
   *  dropping a purchase is worse than admitting its price is unknown) and it is
   *  EXCLUDED from `totalPaidInr`, because `0` would be a claim that nothing was
   *  paid for a plan this buyer demonstrably bought. */
  amountReadable: boolean
  /** The grant date could not be read as a date. `grantedAt` is then NaN and
   *  the row renders "date unknown" — "Invalid Date" is a developer string
   *  leaking into a receipt. Orthogonal to `amountReadable`. */
  dateReadable: boolean
}

export interface PurchaseShelf {
  rows: PurchaseRow[]
  /** Sum of what was actually paid — the buyer-side mirror of the creator's
   *  earnings ledger, and never the publications' current prices.
   *
   *  Sums ONLY the rows whose amount could be read (see `amountReadable`), and
   *  a `null`/non-finite amount never reaches the accumulator as `0` — that
   *  would be a claim about what was paid, and it would understate the total
   *  without a word. When any row is unreadable, `totalReadable` is false and
   *  the header says so instead of printing a smaller, confident-looking sum. */
  totalPaidInr: number
  /** True when every row's amount was readable, so `totalPaidInr` is the whole
   *  truth. False when at least one row was flagged — the number is then a
   *  floor, and the UI must not present it as the total. */
  totalReadable: boolean
  updatedCount: number
}

/** The buyer's shelf, newest purchase first. */
export function buildPurchaseShelf(
  entitlements: Entitlement[],
  pubs: PublishedItinerary[],
  users: User[],
): PurchaseShelf {
  const pubById = new Map(pubs.map(p => [p.id, p]))
  const nameById = new Map(users.map(u => [u.id, u.profile?.name || undefined]))
  const seen = new Set<string>()
  const rows: PurchaseRow[] = []

  // Oldest first, so the de-duplication below keeps the purchase that actually
  // started the ownership. One entitlement per (user, publication) is a
  // database constraint, so this is defence rather than policy — but a doubled
  // row would show a plan twice AND double what the buyer appears to have
  // spent, and both would read as real.
  for (const e of [...entitlements].sort((a, b) => a.grantedAt - b.grantedAt)) {
    if (seen.has(e.pubId)) continue
    seen.add(e.pubId)
    const pub = pubById.get(e.pubId)
    // A stored amount is a CLAIM about money, so it is checked rather than
    // cast: `null`, a string, NaN and Infinity are all "could not be read",
    // and none of them may become 0 (a claim) or NaN (a poison). The value is
    // kept as-is for a readable row and coerced to 0 for a flagged one — where
    // it is excluded from the sum below, so 0 never reaches the total.
    const amountReadable = typeof e.amountPaidInr === 'number' && Number.isFinite(e.amountPaidInr)
    const dateReadable = typeof e.grantedAt === 'number' && Number.isFinite(e.grantedAt)
    rows.push({
      pubId: e.pubId,
      entitlementId: e.id,
      title: pub?.title || 'A plan you own',
      coverImageUrl: pub?.coverImageUrl,
      creatorId: pub?.creatorId ?? '',
      creatorName: pub ? nameById.get(pub.creatorId) : undefined,
      amountPaidInr: amountReadable ? e.amountPaidInr : 0,
      grantedAt: e.grantedAt,
      durationDays: pub?.durationDays ?? 0,
      places: pub?.routeSummary.length ?? 0,
      // `refreshed_at` is when the creator last synced the page with its
      // itinerary. Rows published before v0.37 have none and fall back to
      // `published_at`, which is always at or before the purchase — so an
      // absent value must read as "not updated", never as "updated".
      updatedSince: Boolean(pub?.refreshedAt && pub.refreshedAt > e.grantedAt),
      refreshedAt: pub?.refreshedAt,
      listed: Boolean(pub),
      amountReadable,
      dateReadable,
    })
  }

  rows.sort((a, b) => b.grantedAt - a.grantedAt || a.title.localeCompare(b.title))
  const totalPaidInr = rows.reduce((sum, r) => sum + (r.amountReadable ? r.amountPaidInr : 0), 0)
  return {
    rows,
    totalPaidInr,
    totalReadable: rows.every(r => r.amountReadable),
    updatedCount: rows.filter(r => r.updatedSince).length,
  }
}

/** Whether this purchase can be offered for sharing at all (ROADMAP I-21).
 *
 *  A buyer's card resolves through `/i/<pubId>`, and unpublishing DELETES the
 *  publication row — so the link for a withdrawn plan previews as nothing, and
 *  offering it would hand somebody a dead link to post. The buyer's own access
 *  and their copy are untouched by this: only the public card needs the row to
 *  exist. */
export function purchaseShareable(row: PurchaseRow): boolean {
  return row.listed
}

export interface RevealStats {
  days: number
  stops: number
  /** Planned road distance for the whole itinerary, in km. */
  km: number
  /** The engine's rebuilt cost per head — the number the plan itself shows. */
  perPersonInr: number
}

/** The numbers behind "here's what you just got", computed from the itinerary
 *  the buyer now has access to.
 *
 *  Feed it the trip the server served AFTER the entitlement existed. The
 *  pre-purchase copy is wire-stubbed, and the stub is deliberately surgical: it
 *  keeps stop TITLES and coordinates while replacing descriptions, notes,
 *  timings and every cost with placeholders. So a reveal computed from the
 *  stubbed copy would print days, stops and km that all look right over a plan
 *  that is still empty — the exact failure this moment exists to avoid. */
export function unlockRevealStats(trip: Trip): RevealStats {
  const totals = computeTotals(trip)
  const stops = trip.days.reduce(
    (count, day) => count + day.stops.filter(s => s.status !== 'rejected').length,
    0,
  )
  return {
    days: trip.days.length,
    stops,
    km: Math.round(totals.totalDistanceKm),
    perPersonInr: Math.round(totals.costPerPersonInr),
  }
}
