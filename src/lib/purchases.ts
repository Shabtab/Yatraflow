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
import { isRefunded, orderMoneyAt, type Entitlement, type PurchaseOrder } from './payments'
import type { PublishedItinerary, Trip, User } from '../data/types'

/** One owned publication, as the shelf needs it. */
export interface PurchaseRow {
  pubId: string
  /** The publication's own itinerary. Empty when the publication row is gone
   *  from the cache (unpublished), which is exactly when a copy has to be found
   *  by title instead — see `findBuyerCopy`. */
  tripId: string
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
  /** #570 — the publication row is in the cache. The entitlement is still the
   *  buyer's (the database ties the two together for life), so the row is kept
   *  and rendered rather than dropped. PRESENCE ONLY: since #350 a withdrawn
   *  publication's row survives, so this says nothing about whether the plan is
   *  still on sale — that is `onSale`. Gates "Open the plan" and "Fork", which
   *  work through a withdrawal for a buyer (get_public_trip serves entitled
   *  holders). */
  rowExists: boolean
  /** #570 — the two facts #350 separated. True when the row exists AND has not
   *  been soft-unpublished (`unpublished_at` is null). Gates only what needs a
   *  LIVE plan: the share card and the cover auto-lookup. Never the buyer's own
   *  access — gating that on "still on sale" would break the one working path
   *  to a plan they paid for. */
  onSale: boolean
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
  /** #407 — the money was captured and later given back, so this row is a
   *  RECEIPT and not a claim of access. Read from the ORDER's money state, the
   *  only row that survives a refund (the entitlement is deleted).
   *
   *  ORTHOGONAL to `onSale`/`rowExists`: a refunded plan can still be on sale,
   *  and a withdrawn plan can still be owned. The two chips render independently —
   *  conflating them would tell a refunded buyer their access ended because the
   *  creator unpublished, which is a different story with different next steps. */
  refunded: boolean
  /** #589 — the money was captured and the GRANT has not landed yet: a paid
   *  order with no entitlement row (the 503 "confirm-but-not-saved" answer
   *  promises the webhook may still finish it, and the checkout's self-heal
   *  grants on the next Unlock). NOT a claim of access — the paywall refuses
   *  this publication server-side until the grant exists — so the row shows
   *  money and state, never Open/Fork/Share.
   *
   *  ORTHOGONAL to `refunded`: a failed (refunded) order and a paid order are
   *  different rows of money history, and a `pending`-status order (an
   *  abandoned checkout) never becomes a row at all — only `paid` proves money
   *  moved. A later grant converts the row into a normal one: the entitlement
   *  loop claims the publication slot first. */
  pendingGrant: boolean
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
  /** #407 — how many rows are receipts for money that came back. Named
   *  separately because `totalPaidInr` EXCLUDES them: that figure is what the
   *  buyer currently holds, and a refunded purchase is not held. Without this
   *  count the header would have to be silently short, which is the shape of
   *  dishonesty the rest of this file exists to avoid. */
  refundedCount: number
  /** #589 — how many rows are captured payments whose grant has not landed.
   *  Named separately because `totalPaidInr` excludes them too: the money
   *  moved, but the plan is not held yet — the same holds-based definition
   *  that excludes refunds. The count keeps the exclusion named, and the page
   *  uses it to explain the "being finalized" state. */
  pendingGrantCount: number
}

/** The buyer's shelf, newest purchase first.
 *
 *  Two sources, and they answer different questions (#407): `entitlements` is
 *  the GRANT (what you may open), `purchase_orders` is the MONEY (what you paid,
 *  and whether it came back). A refund deletes the entitlement and leaves the
 *  order `failed`, so a shelf reading only entitlements loses the purchase
 *  entirely — which is what this parameter exists to fix. `orders` is optional
 *  so the pre-#407 call shape still type-checks, but a caller that omits it
 *  simply cannot see refunds. */
export function buildPurchaseShelf(
  entitlements: Entitlement[],
  pubs: PublishedItinerary[],
  users: User[],
  orders: PurchaseOrder[] = [],
): PurchaseShelf {
  const pubById = new Map(pubs.map(p => [p.id, p]))
  const nameById = new Map(users.map(u => [u.id, u.profile?.name || undefined]))
  // The money state, by the ORDER it belongs to. An entitlement carries its
  // `orderId`, so a surviving grant can still be recognised as refunded if the
  // delete ever raced or failed — defence in depth for the same truth.
  const orderById = new Map(orders.map(o => [o.id, o]))
  const seen = new Set<string>()
  const rows: PurchaseRow[] = []

  /** The shared shape of one row. `amountClaim` and `moneyAt` come from
   *  whichever source knows them: the entitlement for a live grant, the order
   *  for a receipt. */
  const rowFor = (input: {
    pubId: string
    entitlementId: string
    amountClaim: unknown
    moneyAt: unknown
    refunded: boolean
    pendingGrant?: boolean
  }): PurchaseRow => {
    const pub = pubById.get(input.pubId)
    // A stored amount is a CLAIM about money, so it is checked rather than cast:
    // `null`, a string, NaN and Infinity are all "could not be read", and none of
    // them may become 0 (a claim) or NaN (a poison).
    const amountReadable = typeof input.amountClaim === 'number' && Number.isFinite(input.amountClaim)
    const dateReadable = typeof input.moneyAt === 'number' && Number.isFinite(input.moneyAt)
    return {
      pubId: input.pubId,
      // Empty for a withdrawn plan: the publication row is what carried it, and
      // an unlisted row has none.
      tripId: pub?.tripId ?? '',
      entitlementId: input.entitlementId,
      title: pub?.title || 'A plan you own',
      coverImageUrl: pub?.coverImageUrl,
      creatorId: pub?.creatorId ?? '',
      creatorName: pub ? nameById.get(pub.creatorId) : undefined,
      amountPaidInr: amountReadable ? (input.amountClaim as number) : 0,
      grantedAt: dateReadable ? (input.moneyAt as number) : Number.NaN,
      durationDays: pub?.durationDays ?? 0,
      places: pub?.routeSummary.length ?? 0,
      // `refreshed_at` is when the creator last synced the page with its
      // itinerary. Rows published before v0.37 have none and fall back to
      // `published_at`, which is always at or before the purchase — so an absent
      // value must read as "not updated", never as "updated".
      updatedSince: Boolean(pub?.refreshedAt && pub.refreshedAt > (input.moneyAt as number)),
      refreshedAt: pub?.refreshedAt,
      rowExists: Boolean(pub),
      onSale: pub ? !pub.unpublishedAt : false,
      amountReadable,
      dateReadable,
      refunded: input.refunded,
      pendingGrant: input.pendingGrant ?? false,
    }
  }

  // Oldest first, so the de-duplication below keeps the purchase that actually
  // started the ownership. One entitlement per (user, publication) is a
  // database constraint, so this is defence rather than policy — but a doubled
  // row would show a plan twice AND double what the buyer appears to have
  // spent, and both would read as real.
  for (const e of [...entitlements].sort((a, b) => a.grantedAt - b.grantedAt)) {
    if (seen.has(e.pubId)) continue
    seen.add(e.pubId)
    rows.push(rowFor({
      pubId: e.pubId,
      entitlementId: e.id,
      amountClaim: e.amountPaidInr,
      moneyAt: e.grantedAt,
      refunded: isRefunded(orderById.get(e.orderId) ?? { status: 'paid' }),
    }))
  }

  // #589 — THEN the in-flight grants: a paid order with NO entitlement row is
  // money captured whose grant has not landed yet. It runs BEFORE the receipts
  // loop so a publication with both a refunded order and a fresh paid one shows
  // the money that is now the buyer's — the refund is history, the
  // captured payment is now. `pending`-status orders (abandoned checkouts) must
  // NOT become rows: only `paid` proves money moved. A later grant converts the
  // row into a normal one, because the entitlement loop claims the slot first.
  for (const o of [...orders].sort((a, b) => orderMoneyAt(a) - orderMoneyAt(b))) {
    if (o.status !== 'paid') continue
    if (seen.has(o.pubId)) continue
    seen.add(o.pubId)
    rows.push(rowFor({
      pubId: o.pubId,
      // No grant exists, so there is no entitlement to name. The ORDER id is
      // the honest identifier: it is what the payment is a receipt for.
      entitlementId: o.id,
      amountClaim: o.amountInr,
      moneyAt: orderMoneyAt(o),
      refunded: false,
      pendingGrant: true,
    }))
  }

  // #407 — THEN the receipts: a refunded order whose entitlement is gone is a
  // purchase the shelf would otherwise not show at all. Keyed by publication like
  // the loop above, so a row whose grant survived is not printed twice.
  for (const o of [...orders].sort((a, b) => orderMoneyAt(a) - orderMoneyAt(b))) {
    if (!isRefunded(o)) continue
    if (seen.has(o.pubId)) continue
    seen.add(o.pubId)
    rows.push(rowFor({
      pubId: o.pubId,
      // No grant exists, so there is no entitlement to name. The ORDER id is the
      // honest identifier: it is what the receipt is a receipt FOR.
      entitlementId: o.id,
      amountClaim: o.amountInr,
      moneyAt: orderMoneyAt(o),
      refunded: true,
    }))
  }

  rows.sort((a, b) => b.grantedAt - a.grantedAt || a.title.localeCompare(b.title))
  // The TOTAL and the update count are about what the buyer HOLDS, so refunded
  // receipts are excluded from both: their money came back, and a plan they
  // cannot open has no update to be told about. #589 — in-flight grants are
  // excluded for the same reason: the money moved, but the plan is not held
  // yet. `refundedCount` and `pendingGrantCount` keep both exclusions visible
  // instead of silent.
  const heldRows = rows.filter(r => !r.refunded && !r.pendingGrant)
  const totalPaidInr = heldRows.reduce((sum, r) => sum + (r.amountReadable ? r.amountPaidInr : 0), 0)
  return {
    rows,
    totalPaidInr,
    totalReadable: heldRows.every(r => r.amountReadable),
    updatedCount: heldRows.filter(r => r.updatedSince).length,
    refundedCount: rows.filter(r => r.refunded).length,
    pendingGrantCount: rows.filter(r => r.pendingGrant).length,
  }
}

/** Whether this purchase can be offered for sharing at all (ROADMAP I-21).
 *
 *  A buyer's card resolves through `/i/<pubId>`, and the recipient lands on the
 *  plan's PUBLIC page — which a withdrawn plan no longer serves to strangers
 *  (#350: the row survives so the buyer keeps their access, but everyone else
 *  is turned away). Offering the card would hand somebody a link that previews
 *  as a live plan and then refuses them — a card that sells what the recipient
 *  cannot see. The buyer's own access and their copy are untouched: only the
 *  public card needs the plan to still be on sale.
 *
 *  #407 adds the second reason a row cannot be shared: a REFUNDED purchase has
 *  no access left to advertise. The share card is a claim about what you bought
 *  — posting one for a plan whose money went back would be the same overclaim as
 *  the "₹500 paid" chip was, in a place other people can see. */
export function purchaseShareable(row: PurchaseRow): boolean {
  // #589 — an in-flight grant is not access yet: sharing a plan the buyer
  // cannot open is the same overclaim as sharing a refunded one.
  return row.onSale && !row.refunded && !row.pendingGrant
}

/** How sure a match is. `exact` is the publication's own itinerary, which a copy
 *  forked from it carries; `guess` came from a title comparison and MUST be
 *  labelled as such by the caller — a confident wrong link is worse than an
 *  honest one. */
export interface CopyMatch { tripId: string; title: string; exact: boolean }

/** The comparable core of a plan's name: case, punctuation, spacing and a
 *  trailing "(copy)" marker are not identity. Exported so the node suite can pin
 *  the matcher directly — `tests/` has no DOM, and this is pure. */
export function normalizeCopyTitle(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(copy\)\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The buyer's own copy of a withdrawn plan, or null when none can be identified.
 *
 *  Unpublishing DELETES the publication row, so the shelf's only button — "Open
 *  the plan" — led to a page that can never load, on exactly the rows whose copy
 *  says their access is unaffected. The copy itself is real: forking copies the
 *  plan into the buyer's trips and that trip keeps working after the original is
 *  withdrawn. This points at it, and returns null rather than guessing when the
 *  evidence is thin — a missing button is recoverable, a wrong link is a
 *  navigation to somebody else's trip. */
export function findBuyerCopy(row: PurchaseRow, trips: Trip[]): CopyMatch | null {
  // The publication's own itinerary, when the buyer kept that row. This is the
  // only exact answer available today.
  if (row.tripId) {
    const direct = trips.find(t => t.id === row.tripId)
    if (direct) return { tripId: direct.id, title: direct.name, exact: true }
  }
  // Otherwise the title. A withdrawn row has no `tripId` to compare, so this is
  // a heuristic — reported as `exact: false` so the UI can say "we think".
  const wanted = normalizeCopyTitle(row.title)
  if (!wanted) return null
  const byTitle = trips.filter(t => normalizeCopyTitle(t.name) === wanted)
  // Ambiguous is the same as absent: two candidates means no link is honest.
  if (byTitle.length !== 1) return null
  return { tripId: byTitle[0]!.id, title: byTitle[0]!.name, exact: false }
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
