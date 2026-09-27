// ============ The buyer's shelf and the unlock moment (I-20) ============
// Pure derivations from src/lib/purchases.ts — node env, no DOM, no Supabase.
//
// The cases here are the ones that read as "correct" while being wrong: an
// update marker that fires on every publication (because an absent
// `refreshed_at` was treated as "newer"), a total that quietly sums the
// publication's CURRENT price rather than what was paid, and a plan that
// disappears from the shelf the moment a creator unpublishes it — the buyer
// still owns it.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildPurchaseShelf, purchaseShareable, unlockRevealStats } from '../src/lib/purchases'
import { computeTotals } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Entitlement } from '../src/lib/payments'
import type { PublishedItinerary, Trip, User } from '../src/data/types'

const DAY = 86_400_000

function pub(overrides: Partial<PublishedItinerary> = {}): PublishedItinerary {
  return {
    id: 'pub_a',
    tripId: 'trip_a',
    creatorId: 'creator_1',
    title: 'Spiti Valley Circuit',
    tagline: 'Cold desert, high passes',
    routeSummary: ['Shimla', 'Kaza', 'Manali'],
    durationDays: 6,
    estimatedBudgetPerPersonInr: 24000,
    travelStyle: 'roadtrip',
    travelTips: ['Carry cash'],
    warningsAndAssumptions: [],
    freeDayIndexes: [0],
    premiumPriceInr: 500,
    publishedAt: 1_700_000_000_000,
    views: 120,
    copies: 9,
    ...overrides,
  }
}

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    id: 'ent_1',
    userId: 'buyer_1',
    pubId: 'pub_a',
    orderId: 'order_1',
    amountPaidInr: 500,
    grantedAt: 1_750_000_000_000,
    ...overrides,
  }
}

function user(id: string, name: string): User {
  return {
    id,
    email: `${id}@example.com`,
    createdAt: 0,
    profile: { name, languages: ['en'], travelStyles: [], isCreator: true },
  }
}

describe('the purchase shelf', () => {
  it('resolves the publication and the creator behind each entitlement', () => {
    const shelf = buildPurchaseShelf([entitlement()], [pub()], [user('creator_1', 'Dheeraj')])
    expect(shelf.rows).toHaveLength(1)
    expect(shelf.rows[0]).toMatchObject({
      pubId: 'pub_a',
      title: 'Spiti Valley Circuit',
      creatorId: 'creator_1',
      creatorName: 'Dheeraj',
      durationDays: 6,
      places: 3,
      listed: true,
    })
  })

  it('totals what was PAID, never the price the publication carries today', () => {
    // The price snapshot is the whole point of the entitlement row: a creator
    // raising the price from ₹500 to ₹5,000 must not retroactively change what
    // a buyer appears to have spent.
    const shelf = buildPurchaseShelf(
      [entitlement({ amountPaidInr: 500 }), entitlement({ id: 'ent_2', pubId: 'pub_b', amountPaidInr: 199, grantedAt: 1_749_000_000_000 })],
      [pub(), pub({ id: 'pub_b', title: 'Kerala', premiumPriceInr: 5000 })],
      [],
    )
    expect(shelf.totalPaidInr).toBe(699)
  })

  it('is newest purchase first, with a deterministic tie-break', () => {
    const shelf = buildPurchaseShelf(
      [
        entitlement({ id: 'e1', pubId: 'pub_a', grantedAt: 3 * DAY }),
        entitlement({ id: 'e2', pubId: 'pub_b', grantedAt: 5 * DAY, amountPaidInr: 199 }),
        entitlement({ id: 'e3', pubId: 'pub_c', grantedAt: 3 * DAY, amountPaidInr: 300 }),
      ],
      [pub(), pub({ id: 'pub_b', title: 'Kerala' }), pub({ id: 'pub_c', title: 'Mewar' })],
      [],
    )
    // Two bought in the same instant: alphabetical by title, so the shelf
    // cannot reshuffle itself between two reads of the same rows.
    expect(shelf.rows.map(r => r.pubId)).toEqual(['pub_b', 'pub_c', 'pub_a'])
  })

  it('marks a plan the creator touched after the purchase, and only then', () => {
    const bought = 10 * DAY
    const shelf = buildPurchaseShelf(
      [
        entitlement({ id: 'e1', pubId: 'pub_newer', grantedAt: bought }),
        entitlement({ id: 'e2', pubId: 'pub_older', grantedAt: bought }),
        entitlement({ id: 'e3', pubId: 'pub_never', grantedAt: bought, amountPaidInr: 100 }),
      ],
      [
        pub({ id: 'pub_newer', refreshedAt: bought + DAY }),
        pub({ id: 'pub_older', refreshedAt: bought - DAY }),
        // Published before v0.37: no refreshed_at at all. The staleness
        // fallback makes it "not updated" — reading an absent value as newer
        // would put an "updated" badge on every legacy publication.
        pub({ id: 'pub_never' }),
      ],
      [],
    )
    const byId = new Map(shelf.rows.map(r => [r.pubId, r]))
    expect(byId.get('pub_newer')?.updatedSince).toBe(true)
    expect(byId.get('pub_older')?.updatedSince).toBe(false)
    expect(byId.get('pub_never')?.updatedSince).toBe(false)
    expect(shelf.updatedCount).toBe(1)
  })

  it('keeps a plan whose publication is no longer visible, and says so', () => {
    // An entitlement is tied to its publication for life in the database, so a
    // row the client cannot read is a rendering gap — dropping it would tell
    // the buyer they never bought the plan.
    const shelf = buildPurchaseShelf([entitlement({ pubId: 'pub_gone' })], [pub()], [])
    expect(shelf.rows).toHaveLength(1)
    expect(shelf.rows[0]).toMatchObject({ pubId: 'pub_gone', listed: false, title: 'A plan you own' })
    expect(shelf.rows[0].creatorName).toBeUndefined()
    expect(shelf.totalPaidInr).toBe(500)
  })

  it('counts a doubled entitlement once', () => {
    // unique (user_id, pub_id) makes this unreachable in the database; a stale
    // double read must still not show the plan twice or double the total.
    const shelf = buildPurchaseShelf(
      [
        entitlement({ id: 'e1', grantedAt: 2 * DAY }),
        entitlement({ id: 'e2', grantedAt: 9 * DAY, amountPaidInr: 500 }),
      ],
      [pub()],
      [],
    )
    expect(shelf.rows).toHaveLength(1)
    expect(shelf.totalPaidInr).toBe(500)
    // The first payment is when ownership began.
    expect(shelf.rows[0].grantedAt).toBe(2 * DAY)
  })

  it('is empty, not broken, for a signed-out visitor', () => {
    // An empty shelf has nothing unreadable in it, so the total is the whole
    // truth — `totalReadable` is true, not vacuously false.
    expect(buildPurchaseShelf([], [pub()], [])).toEqual({
      rows: [], totalPaidInr: 0, totalReadable: true, updatedCount: 0,
    })
  })
})

describe('the unlock moment’s numbers', () => {
  const trip = (): Trip => structuredClone(seedData.trips[0])

  it('counts days, stops and distance from the itinerary itself', () => {
    const t = trip()
    const stats = unlockRevealStats(t)
    const expectedStops = t.days.reduce((n, d) => n + d.stops.filter(s => s.status !== 'rejected').length, 0)
    expect(stats.days).toBe(t.days.length)
    expect(stats.stops).toBe(expectedStops)
    expect(stats.km).toBe(Math.round(computeTotals(t).totalDistanceKm))
    expect(stats.perPersonInr).toBe(Math.round(computeTotals(t).costPerPersonInr))
  })

  it('does not count a rejected stop as something the buyer got', () => {
    const t = trip()
    const before = unlockRevealStats(t).stops
    t.days[0].stops.push({ ...t.days[0].stops[0], id: 'rejected-1', status: 'rejected' })
    expect(unlockRevealStats(t).stops).toBe(before)
  })

  it('reports nothing for an itinerary with no days, and never NaN', () => {
    // The per-head figure stays the engine's own (it still prices lodging and
    // food from the trip's dates), so the reveal must never print it as a
    // special case that disagrees with the workspace for the same trip. What
    // is asserted here is that counts and distance collapse to zero.
    const empty = { ...trip(), days: [] }
    const stats = unlockRevealStats(empty)
    expect(stats).toMatchObject({ days: 0, stops: 0, km: 0 })
    expect(Number.isFinite(stats.perPersonInr)).toBe(true)
  })

  it('gives whole numbers — a reveal is not a spreadsheet', () => {
    const stats = unlockRevealStats(trip())
    for (const value of [stats.days, stats.stops, stats.km, stats.perPersonInr]) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Source tripwires for the two behaviours that are invisible in a unit test
// and easy to delete by accident: the page must re-read the itinerary it just
// unlocked, and the shelf must not degrade a failed read into "you own
// nothing". Both are the kind of regression that only shows up in front of a
// paying customer.
// ---------------------------------------------------------------------------
const pageSource = readFileSync(new URL('../src/pages/PublicItinerary.tsx', import.meta.url), 'utf8')
const shelfSource = readFileSync(new URL('../src/pages/Purchases.tsx', import.meta.url), 'utf8')

describe('I-20 — the bought plan is re-read, not re-rendered', () => {
  it('re-reads through the paywall RPC after the purchase', () => {
    // The page's copy was served PRE-purchase and is wire-stubbed: the stub
    // keeps titles and coordinates while emptying descriptions, notes, timings
    // and costs, so lifting the lock over it shows a full-looking plan made of
    // placeholders. Removing this fetch is the regression this pins.
    expect(pageSource).toMatch(/const fresh = await fetchPublicTrip/)
    expect(pageSource).toMatch(/if \(fresh\) setFetched\(fresh\)/)
  })

  it('opens the reveal only with the copy that came back after the entitlement existed', () => {
    expect(pageSource).toMatch(/if \(outcome === 'unlocked' && fresh\) setRevealTrip\(fresh\)/)
    expect(pageSource).toMatch(/trip=\{revealTrip\}/)
  })

  it('never opens the moment for a plan the viewer already owned', () => {
    // A 409 has its own branch; only a completed purchase earns the ceremony.
    expect(pageSource).toMatch(/if \(outcome !== 'unlocked' && outcome !== 'already'\) return/)
  })
})

describe('I-20 — the shelf distinguishes "nothing" from "could not read"', () => {
  it('uses the strict read, so a dropped connection cannot read as an empty shelf', () => {
    expect(shelfSource).toMatch(/fetchMyPurchases/)
    expect(shelfSource).not.toMatch(/fetchMyEntitlements/)
  })
})

describe('I-21 — a purchase carries the entitlement its card is verified against', () => {
  it('puts the grant on the row, not just the publication', () => {
    // The share card is gated on the entitlement id (owner-only RLS keeps it
    // readable to its buyer alone), so the shelf is where it has to come from.
    const shelf = buildPurchaseShelf([entitlement({ id: 'ent_9' })], [pub()], [])
    expect(shelf.rows[0]!.entitlementId).toBe('ent_9')
  })

  it('offers sharing only while the publication still resolves', () => {
    // Unpublishing DELETES the row, so `/i/<id>` 404s and the shared link would
    // preview as nothing at all — the buyer's own access is unaffected.
    const listed = buildPurchaseShelf([entitlement()], [pub()], [])
    const withdrawn = buildPurchaseShelf([entitlement()], [], [])
    expect(purchaseShareable(listed.rows[0]!)).toBe(true)
    expect(purchaseShareable(withdrawn.rows[0]!)).toBe(false)
  })
})

// ============ #406 — one malformed row must not rewrite the whole shelf ============
// A stored amount is a CLAIM about money, so it is checked rather than cast. The
// three ways it used to lie all read as "correct" numbers: a NaN poisons the sum
// (the header loses its total), a `null` becomes 0 through `0 + null === 0` (a
// silent undercount with no symptom at all), and a bad date string prints the
// literal "Invalid Date" on a receipt.
describe('#406 — a row whose money cannot be read is flagged, never silently total', () => {
  it('keeps the total finite and correct when one amount is NaN', () => {
    const shelf = buildPurchaseShelf(
      [
        entitlement({ pubId: 'pub_a', id: 'ent_1', amountPaidInr: 500 }),
        entitlement({ pubId: 'pub_b', id: 'ent_2', amountPaidInr: NaN, grantedAt: 1_750_000_100_000 }),
      ],
      [pub({ id: 'pub_a' }), pub({ id: 'pub_b' })],
      [],
    )
    // The pre-fix reduce turned this into NaN, which the header printed as the
    // whole shelf's total.
    expect(Number.isFinite(shelf.totalPaidInr)).toBe(true)
    expect(shelf.totalPaidInr).toBe(500)
  })

  it('excludes an unreadable amount from the total instead of counting it as zero', () => {
    // `0 + null === 0` is the quiet failure: the total stayed a plausible
    // number and simply understated what the buyer paid.
    const shelf = buildPurchaseShelf(
      [
        entitlement({ pubId: 'pub_a', id: 'ent_1', amountPaidInr: 500 }),
        entitlement({
          pubId: 'pub_b', id: 'ent_2',
          amountPaidInr: null as unknown as number,
          grantedAt: 1_750_000_100_000,
        }),
      ],
      [pub({ id: 'pub_a' }), pub({ id: 'pub_b' })],
      [],
    )
    expect(shelf.totalPaidInr).toBe(500)
  })

  it('says the total is incomplete rather than printing a confident smaller one', () => {
    const good = buildPurchaseShelf([entitlement()], [pub()], [])
    const poisoned = buildPurchaseShelf(
      [
        entitlement({ pubId: 'pub_a', id: 'ent_1', amountPaidInr: 500 }),
        entitlement({ pubId: 'pub_b', id: 'ent_2', amountPaidInr: NaN, grantedAt: 1_750_000_100_000 }),
      ],
      [pub({ id: 'pub_a' }), pub({ id: 'pub_b' })],
      [],
    )
    expect(good.totalReadable).toBe(true)
    expect(poisoned.totalReadable).toBe(false)
  })

  it('keeps the malformed purchase on the shelf and flags it', () => {
    // Dropping the row would hide a plan the buyer demonstrably paid for —
    // worse than admitting its price is unknown.
    const shelf = buildPurchaseShelf(
      [entitlement({ pubId: 'pub_b', id: 'ent_2', amountPaidInr: NaN })],
      [pub({ id: 'pub_b' })],
      [],
    )
    expect(shelf.rows).toHaveLength(1)
    expect(shelf.rows[0]!.amountReadable).toBe(false)
    expect(shelf.rows[0]!.amountPaidInr).toBe(0)
  })

  it('flags an unreadable grant date without disturbing the amount', () => {
    const shelf = buildPurchaseShelf(
      [entitlement({ amountPaidInr: 500, grantedAt: NaN })],
      [pub()],
      [],
    )
    expect(shelf.rows[0]!.dateReadable).toBe(false)
    expect(shelf.rows[0]!.amountReadable).toBe(true)
    expect(shelf.totalPaidInr).toBe(500)
  })

  it('treats a non-numeric stored amount as unreadable, not as a number', () => {
    // PostgREST hands back whatever is in the column; a string is not a number
    // even though `as number` claims it is.
    const shelf = buildPurchaseShelf(
      [entitlement({ amountPaidInr: '500' as unknown as number })],
      [pub()],
      [],
    )
    expect(shelf.rows[0]!.amountReadable).toBe(false)
    expect(shelf.totalPaidInr).toBe(0)
  })

  it('flags a malformed UNLISTED row without resurrecting or dropping it', () => {
    // The two behaviours compose: a row can be both unreadable and withdrawn.
    const shelf = buildPurchaseShelf(
      [entitlement({ amountPaidInr: NaN, grantedAt: 1_750_000_000_000 })],
      [],
      [],
    )
    expect(shelf.rows).toHaveLength(1)
    expect(shelf.rows[0]!.listed).toBe(false)
    expect(shelf.rows[0]!.amountReadable).toBe(false)
    expect(purchaseShareable(shelf.rows[0]!)).toBe(false)
  })
})

// The pure cases above pin the arithmetic; these pin the two surfaces that
// could still tell the user a confident wrong thing. Source guards, because
// `tests/` is node-env with no DOM (AGENTS §4).
describe('#406 — the shelf surfaces the flag instead of printing the number', () => {
  const pageSrc = readFileSync(new URL('../src/pages/Purchases.tsx', import.meta.url), 'utf8')

  it('gates the header total on readability, and never drops the explanation', () => {
    expect(pageSrc).toContain('shelf.totalReadable')
    // The partial figure is a floor, so the copy has to say so.
    expect(pageSrc).toContain('at least')
  })

  it('never renders the price chip for an unreadable amount', () => {
    // A `formatInr(0)` chip would claim the plan was free.
    expect(pageSrc).toContain('price unavailable')
  })

  it('says the date is unknown rather than printing an invalid one', () => {
    expect(pageSrc).toContain('date unknown')
  })

  it('passes the row flag into the date renderer, so a bad date cannot slip past it', () => {
    // The signature alone is not enough — the call site must pass the flag.
    expect(pageSrc).toContain('boughtOn(row.grantedAt, row.dateReadable)')
  })

  it('coerces the shelf read at its mapping boundary rather than casting the sum', () => {
    // The two layers must agree: unlock.ts hands over the raw reading and
    // purchases.ts decides what is readable, so no third place re-casts it.
    const unlockSrc = readFileSync(new URL('../src/lib/unlock.ts', import.meta.url), 'utf8')
    const mapping = unlockSrc.slice(unlockSrc.indexOf('export async function fetchMyPurchases'))
    expect(mapping).toContain('amount_paid_inr')
    // A Number() coercion here would disagree with the shelf's own rule.
    expect(mapping).not.toContain('Number(row.amount_paid_inr')
  })
})
