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
import { buildPurchaseShelf, purchaseShareable, unlockRevealStats, findBuyerCopy, normalizeCopyTitle } from '../src/lib/purchases'
import { computeTotals } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Entitlement, PurchaseOrder } from '../src/lib/payments'
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
    //
    // #407 added `refundedCount`, so this whole-object pin grew a key. That is
    // the AGENTS §4 trap ("adding a field to a returned object breaks every
    // `toEqual` on it") — the pin was never pinning a defect here, it was
    // pinning the SHAPE, so the key is added rather than the assertion loosened.
    expect(buildPurchaseShelf([], [pub()], [])).toEqual({
      rows: [], totalPaidInr: 0, totalReadable: true, updatedCount: 0, refundedCount: 0,
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

// ============ #409 — the shelf stops overclaiming ============
// Five small papercuts, one theme: money-adjacent rendering that states more
// than it can support. Source guards for the page; the date invariant is proved
// directly, because the formatter is page-private and the PROPERTY is what
// matters (the same instant must not be two dates).
describe('#409 — the shelf stops overclaiming', () => {
  const pageSrc = readFileSync(new URL('../src/pages/Purchases.tsx', import.meta.url), 'utf8')

  it('formats the receipt date in UTC, so it cannot move with the reader', () => {
    // The pin is on the option that decides it. `toLocaleDateString` alone reads
    // the BROWSER's zone, which is the bug: a grant at 23:30 UTC was "yesterday"
    // in IST and "today" in the US — the same receipt, two dates.
    expect(pageSrc).toMatch(/timeZone: 'UTC'/)
    // Both formatters, not just the visible one: a month label that flips
    // between readers is the same defect one unit up.
    const bought = pageSrc.slice(pageSrc.indexOf('function boughtOn'), pageSrc.indexOf('function updatedIn'))
    const updated = pageSrc.slice(pageSrc.indexOf('function updatedIn'), pageSrc.indexOf('export function PurchasesPage'))
    expect(bought).toContain("timeZone: 'UTC'")
    expect(updated).toContain("timeZone: 'UTC'")
  })

  it('proves why that pin is needed: without it, one instant is two dates', () => {
    // 12 Sep 2026, 23:30 UTC — the case the issue names. Asserted as an
    // INEQUALITY rather than against literal strings, so this does not depend on
    // ICU's month spelling: what matters is that the two zones disagree.
    const lateUtc = Date.UTC(2026, 8, 12, 23, 30)
    const fmt = (timeZone: string) =>
      new Date(lateUtc).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone })
    expect(fmt('UTC')).not.toBe(fmt('Asia/Kolkata'))
    // …and the pinned reading is stable no matter which zone the test box is in.
    expect(fmt('UTC')).toBe(fmt('UTC'))
  })

  it('gives a withdrawn row NO auto cover, only the neutral fallback', () => {
    // `CoverThumb` resolves a missing cover through the trip's query candidates,
    // which for this caller degrades to the purchase TITLE — and a title is not
    // a destination, so it yields a plausible photo the creator never chose.
    expect(pageSrc).toContain('trip={row.listed ? { name: row.title } : null}')
  })

  it('holds the share button busy while its sheet is open', () => {
    // `sharePurchase` awaits the native sheet, so a double-tap opened two.
    // The same in-flight rule the unlock buttons follow.
    expect(pageSrc).toContain('const [sharingId, setSharingId] = useState<string | null>(null)')
    expect(pageSrc).toContain('if (sharingId) return')
    expect(pageSrc).toContain('disabled={sharingId !== null}')
    expect(pageSrc).toContain("sharingId === row.pubId ? 'Opening…' : 'Share what you bought'")
  })

  it('qualifies its lede only when the shelf actually holds a withdrawn plan', () => {
    // The lede promised "what is inside" while a withdrawn row's shape chips are
    // absent (its publication row is gone, so durationDays/places read 0). The
    // caveat is conditional: a permanent sentence about a case most shelves never
    // have would be its own small dishonesty.
    expect(pageSrc).toContain('shelf.rows.some(r => !r.listed)')
    expect(pageSrc).toContain('keeps its receipt and your access')
    // …and the promise that IS always true stays true.
    expect(pageSrc).toContain('the shape of the plan')
  })

  it('says the fork fallback is race-only rather than pretending it cannot happen', () => {
    // The branch is unreachable except by a render→click race, and a comment that
    // says so is the difference between a deliberate guard and dead code.
    const forkFn = pageSrc.slice(pageSrc.indexOf('function fork('), pageSrc.indexOf('/** Share one row'))
    expect(forkFn).toContain('render→click race')
    expect(forkFn).toContain('no longer listed')
  })
})

// ============ #405 — a withdrawn plan must not lead to a dead page ============
// Unpublishing DELETES the publication row, so `/pub/<id>` can never load again.
// The shelf's "Open the plan" button rendered unconditionally, which made the
// ONLY action on an unlisted row a link to nothing — on precisely the row whose
// copy promises the buyer their access is unaffected. The buyer's real copy is
// the trip they forked, and this is what finds it.
describe('#405 — the copy resolver finds the buyer\'s own trip, or admits it cannot', () => {
  const trip = (overrides: Partial<Trip> = {}): Trip =>
    ({ ...structuredClone(seedData.trips[0]!), ...overrides }) as Trip

  function withdrawnRow(overrides: Partial<ReturnType<typeof buildPurchaseShelf>['rows'][0]> = {}) {
    // No publication in the cache — that is what "withdrawn" means here.
    const shelf = buildPurchaseShelf([entitlement()], [], [])
    return { ...shelf.rows[0]!, ...overrides }
  }

  it('finds the copy exactly when the publication still names its itinerary', () => {
    const listed = buildPurchaseShelf([entitlement()], [pub()], []).rows[0]!
    const mine = trip({ id: listed.tripId, name: 'Spiti Valley Circuit' })
    const found = findBuyerCopy(listed, [mine, trip({ id: 'other', name: 'Something else' })])
    expect(found).toEqual({ tripId: listed.tripId, title: 'Spiti Valley Circuit', exact: true })
  })

  it('falls back to the title for a withdrawn row, and says the match is a guess', () => {
    // A withdrawn row has no tripId at all, so the title is the only evidence —
    // and the UI must not present a heuristic as a fact.
    const row = withdrawnRow({ title: 'Spiti Valley Circuit' })
    expect(row.tripId).toBe('')
    const found = findBuyerCopy(row, [trip({ id: 'copy_1', name: 'Spiti Valley Circuit (copy)' })])
    expect(found).toEqual({ tripId: 'copy_1', title: 'Spiti Valley Circuit (copy)', exact: false })
  })

  it('ignores case, punctuation and a trailing copy marker', () => {
    expect(normalizeCopyTitle('Spiti Valley Circuit (copy)')).toBe('spiti valley circuit')
    expect(normalizeCopyTitle('  Kerala  Hills & Backwaters ')).toBe('kerala hills backwaters')
    expect(normalizeCopyTitle('Goa — Coast')).toBe(normalizeCopyTitle('goa coast'))
  })

  it('refuses to choose between two copies of the same plan', () => {
    // Ambiguity is the same as absence: a link to one of two is a coin flip, and
    // a wrong link navigates a buyer into somebody else's trip.
    const row = withdrawnRow({ title: 'Spiti Valley Circuit' })
    const trips = [
      trip({ id: 'copy_a', name: 'Spiti Valley Circuit (copy)' }),
      trip({ id: 'copy_b', name: 'Spiti Valley Circuit' }),
    ]
    expect(findBuyerCopy(row, trips)).toBeNull()
  })

  it('returns nothing when the buyer has no matching trip at all', () => {
    const row = withdrawnRow({ title: 'Spiti Valley Circuit' })
    expect(findBuyerCopy(row, [trip({ id: 'x', name: 'Ladakh' })])).toBeNull()
    expect(findBuyerCopy(row, [])).toBeNull()
  })

  it('never matches an unrelated plan on a shared word', () => {
    // Substring matching is how a resolver starts sending buyers to the wrong
    // trip; only the whole normalised title counts.
    const row = withdrawnRow({ title: 'Spiti Valley Circuit' })
    expect(findBuyerCopy(row, [trip({ id: 'y', name: 'Spiti Valley Circuit Extra Days' })])).toBeNull()
  })

  it('prefers the exact itinerary over a same-titled fork', () => {
    const listed = buildPurchaseShelf([entitlement()], [pub({ tripId: 'trip_real' })], []).rows[0]!
    const found = findBuyerCopy(listed, [
      trip({ id: 'trip_old', name: 'Spiti Valley Circuit' }),
      trip({ id: 'trip_real', name: 'Spiti Valley Circuit' }),
    ])
    expect(found!.tripId).toBe('trip_real')
    expect(found!.exact).toBe(true)
  })
})

// The page is node-env untestable, so the render half is pinned by source: the
// dead `/pub/` link must be gone from the unlisted path, and a guess labelled.
describe('#405 — the shelf never offers a link that cannot load', () => {
  const pageSrc = readFileSync(new URL('../src/pages/Purchases.tsx', import.meta.url), 'utf8')

  it('offers the public page only while the publication is listed', () => {
    // Matched on the GUARD and the destination separately rather than one span
    // across them: the two sit on different lines, and a regex that has to
    // cross the braces in between is a regex that will break on a reformat.
    //
    // #407 — the guard gained a second condition (`!row.refunded`), because a
    // listed-but-refunded plan is one the paywall will refuse: the button would
    // open a locked page, which is the confusion #407 was filed about. The
    // invariant this pin exists for is unchanged and now covers both reasons a
    // row cannot be opened.
    const guarded = pageSrc.match(/\{row\.listed && !row\.refunded && \(([\s\S]{0,400}?)\)\}/)
    expect(guarded, 'the /pub/ button is no longer behind a listed-and-not-refunded guard').not.toBeNull()
    expect(guarded![1]).toContain('`/pub/${row.pubId}`')
    // And the share/fork buttons are guarded the same way (asserted below), so
    // the guard here is a real gate rather than a stray token.
  })

  it('labels a title-matched copy as a guess', () => {
    expect(pageSrc).toContain('we think this is it')
  })

  it('says so when no copy can be found, rather than implying one exists', () => {
    expect(pageSrc).toContain('could not find your copy')
  })

  it('keeps sharing gated on the publication, and forking with it', () => {
    // Both were already correct (#405's step 2) — pinned so a fix here cannot
    // quietly re-open either.
    // #407 — the fork guard gained `!row.refunded` alongside the others, for the
    // same reason the /pub/ button did: forking is an access affordance, and a
    // refunded row has no access to fork into.
    expect(pageSrc).toMatch(/\{purchaseShareable\(row\) && \(/)
    expect(pageSrc).toMatch(/\{row\.listed && !row\.refunded && <button className="btn btn-ghost" onClick=\{\(\) => fork\(row\.pubId\)\}/)
  })
})

// ============ #407 — a refunded purchase is a receipt, not a claim ============
// The defect this file's fixtures now cover: a refund DELETES the entitlement
// row (`revoke_refunded_entitlement`) and flips the ORDER to `failed`. A shelf
// built from entitlements alone therefore loses the purchase completely — the
// receipt vanishes and a plan the buyer demonstrably paid for disappears with no
// explanation. The money state lives on the ORDER, which survives.
describe('#407 — a refunded purchase renders as a receipt', () => {
  const paid = 1_700_000_000_000
  const order = (overrides: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
    id: 'ord_1',
    userId: 'buyer_1',
    pubId: 'pub_a',
    amountInr: 500,
    status: 'paid',
    createdAt: paid,
    paidAt: paid,
    ...overrides,
  })

  it('shows a purchase whose grant is gone as a Refunded row, receipt intact', () => {
    // The entitlement is deleted by the refund, so this row exists ONLY because
    // the order was read. Its amount and date are the order's own figures.
    const shelf = buildPurchaseShelf([], [pub()], [], [order({ status: 'failed' })])
    expect(shelf.rows).toHaveLength(1)
    expect(shelf.rows[0]).toMatchObject({
      pubId: 'pub_a', refunded: true, amountPaidInr: 500, grantedAt: paid, amountReadable: true, dateReadable: true,
    })
    // The receipt's date is when the MONEY moved, not when the order was opened.
    expect(shelf.rows[0]!.grantedAt).toBe(paid)
  })

  it('counts and totals only what the buyer still holds', () => {
    // A refund means the money came back, so folding it into "₹X paid" would
    // claim the buyer holds what they no longer do — while dropping the row
    // entirely would erase the receipt. Both are wrong; the two figures are the
    // honest split, and `refundedCount` is what keeps the exclusion visible.
    const shelf = buildPurchaseShelf(
      [entitlement({ pubId: 'pub_a', amountPaidInr: 199 })],
      [pub({ id: 'pub_b', title: 'Goa Loop' })],
      [],
      [order({ pubId: 'pub_b', amountInr: 500, status: 'failed' })],
    )
    expect(shelf.rows).toHaveLength(2)
    expect(shelf.totalPaidInr).toBe(199)   // the live grant only
    expect(shelf.refundedCount).toBe(1)
  })

  it('keeps refunded and unlisted ORTHOGONAL — a row can be both', () => {
    // Two different stories with different next steps: "the creator took it
    // down" versus "your money was returned". Conflating them would tell a
    // refunded buyer their access ended because of the creator.
    const refundedListed = buildPurchaseShelf([], [pub()], [], [order({ status: 'failed' })])
    expect(refundedListed.rows[0]).toMatchObject({ refunded: true, listed: true })

    // No publication in the cache: withdrawn AND refunded.
    const refundedWithdrawn = buildPurchaseShelf([], [], [], [order({ status: 'failed' })])
    expect(refundedWithdrawn.rows[0]).toMatchObject({ refunded: true, listed: false })
  })

  it('offers no share and no access for a refunded row', () => {
    const shelf = buildPurchaseShelf([], [pub()], [], [order({ status: 'failed' })])
    // `purchaseShareable` is a PUBLIC claim about what you bought, so a refunded
    // row must not offer it even while the publication is still listed.
    expect(purchaseShareable(shelf.rows[0]!)).toBe(false)
    // …while a listed, un-refunded row still may.
    const live = buildPurchaseShelf([entitlement()], [pub()], [], [order({ status: 'paid' })])
    expect(purchaseShareable(live.rows[0]!)).toBe(true)
  })

  it('recognises a refund even when the grant row survived', () => {
    // Defence in depth for the same truth: if the entitlement delete ever raced
    // or failed, the surviving grant is still recognised as refunded through the
    // entitlement's own `orderId`.
    const shelf = buildPurchaseShelf(
      [entitlement({ orderId: 'ord_1', pubId: 'pub_a' })],
      [pub()],
      [],
      [order({ id: 'ord_1', status: 'failed' })],
    )
    expect(shelf.rows).toHaveLength(1)
    expect(shelf.rows[0]!.refunded).toBe(true)
    expect(shelf.totalPaidInr).toBe(0)
  })

  it('does NOT turn a pending or declined order into a row', () => {
    // `failed` is written by exactly one function and only `where status =
    // 'paid'`, so a declined card stays `pending`. Neither may appear as a
    // purchase — only a refund is a receipt for money that actually moved.
    const shelf = buildPurchaseShelf([], [pub()], [], [
      order({ id: 'ord_pending', status: 'pending', paidAt: null }),
      order({ id: 'ord_paid', status: 'paid' }),
    ])
    expect(shelf.rows).toEqual([])
    expect(shelf.refundedCount).toBe(0)
  })

  it('still flags an unreadable refund amount instead of printing zero', () => {
    // The order's amount is a CLAIM about money like any other: a row whose
    // amount cannot be read is flagged rather than rendered as ₹0 paid.
    const shelf = buildPurchaseShelf([], [pub()], [], [order({ status: 'failed', amountInr: Number.NaN })])
    expect(shelf.rows[0]).toMatchObject({ refunded: true, amountReadable: false, amountPaidInr: 0 })
    expect(shelf.totalPaidInr).toBe(0)
  })
})

describe('#407 — the shelf page renders the refund, and reads both sources', () => {
  const pageSrc = readFileSync(new URL('../src/pages/Purchases.tsx', import.meta.url), 'utf8')

  it('reads the orders alongside the entitlements, in ONE attempt', () => {
    // A shelf built from one source is not a partial shelf, it is a wrong one:
    // entitlements alone lose every refund, orders alone lose every grant. So
    // both are read together and a failure of either is a failure of the shelf.
    expect(pageSrc).toContain('fetchMyOrders(meId)')
    expect(pageSrc).toMatch(/Promise\.all\(\[/)
    expect(pageSrc).toContain('buildPurchaseShelf(entitlements ?? [], pubs, users, orders ?? [])')
    // The loading gate needs BOTH, or a settled entitlement read renders an
    // empty shelf while the orders are still in flight.
    expect(pageSrc).toContain('entitlements === null || orders === null')
  })

  it('shows the Refunded chip and removes every access affordance', () => {
    expect(pageSrc).toContain('<Chip tone="info">Refunded</Chip>')
    expect(pageSrc).toContain('the access it came with has ended')
    // Both access buttons carry the refund gate, and the share gate is derived
    // from the row (`purchaseShareable`), which is pinned false above.
    expect(pageSrc).toMatch(/\{row\.listed && !row\.refunded && \(/)
    expect(pageSrc).toContain('{row.listed && !row.refunded && <button')
    // The copy resolver is skipped for a refunded row rather than offering a
    // link to access the buyer no longer has.
    expect(pageSrc).toContain('const copy = row.listed || row.refunded ? null : findBuyerCopy(row, trips)')
  })

  it('names the refunded count, because the total excludes it', () => {
    // A silently smaller total is the same class of lie as a silently larger
    // one, so the exclusion is printed.
    expect(pageSrc).toContain('shelf.refundedCount > 0')
    expect(pageSrc).toContain('refunded</>')
  })

  it('keeps the withdrawn note for un-refunded rows only', () => {
    // The two notes are mutually exclusive by construction: a refunded row says
    // its money came back, an unlisted one says access is unaffected — and
    // telling a refunded buyer the second would be false.
    expect(pageSrc).toContain('!row.refunded && !row.listed && (')
  })
})

