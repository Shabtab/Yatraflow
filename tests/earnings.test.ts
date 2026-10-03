// ============ Earnings helpers — actual sales (M7) + projection ============
// The Earnings tab's two views run on this arithmetic — pin both.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  projectEarnings, deriveActualSales, deriveLedgerRead, payoutStatus, payoutPeriods, payoutPeriodStatus, payoutWalk, revenuePeriods, nextPayoutRun,
  feeForSliceInr, platformFeeInr, netOfFeeInr, attributeFeesInr,
  PLATFORM_FEE_TIERS, PAYOUT_MINIMUM_INR, PAYOUT_WEEKDAY,
} from '../src/lib/earnings'
import type { PublishedItinerary } from '../src/data/types'
import type { Entitlement } from '../src/lib/payments'

const pub = (over: Partial<PublishedItinerary>): PublishedItinerary => ({
  id: 'pub-x', tripId: 't1', creatorId: 'c1', title: 'Kerala', tagline: '',
  routeSummary: ['Kochi'], durationDays: 3, estimatedBudgetPerPersonInr: 5000,
  travelStyle: 'balanced', travelTips: [], warningsAndAssumptions: [],
  freeDayIndexes: [0], publishedAt: 1, views: 0, copies: 0, ...over,
})

const ent = (over: Partial<Entitlement>): Entitlement => ({
  id: 'e1', userId: 'buyer-1', pubId: 'a', orderId: 'o1', amountPaidInr: 199, grantedAt: 1000, ...over,
})

describe('projectEarnings', () => {
  it('projects price × forks per priced publication and totals them', () => {
    const r = projectEarnings([
      pub({ id: 'a', title: 'Kerala', premiumPriceInr: 199, copies: 7 }),
      pub({ id: 'b', title: 'Goa', premiumPriceInr: 149, copies: 2 }),
    ])
    expect(r.rows).toHaveLength(2)
    // 15% of ₹1,393 = ₹208.95 → ₹209 on the row; the second row's ₹298 slice
    // is still inside the first tier: ₹44.70 → ₹45.
    expect(r.rows[0]).toMatchObject({ pubId: 'a', priceInr: 199, forks: 7, grossInr: 1393, feeInr: 209, netInr: 1184 })
    expect(r.rows[1]).toMatchObject({ pubId: 'b', grossInr: 298, feeInr: 45, netInr: 253 })
    expect(r.potentialInr).toBe(1691)
    expect(r.feeInr).toBe(254)
    expect(r.netInr).toBe(1437)
    // The total is the sum of the rows, never the ladder applied to the total —
    // a ledger whose columns do not add up is worse than one a rupee out.
    expect(r.feeInr).toBe(r.rows.reduce((s, x) => s + x.feeInr, 0))
    expect(r.netInr).toBe(r.potentialInr - r.feeInr)
  })

  it('never invents money for unpriced publications — counts them instead', () => {
    const r = projectEarnings([
      pub({ id: 'free', premiumPriceInr: undefined, copies: 50 }),
      pub({ id: 'zero', premiumPriceInr: 0, copies: 9 }),
      pub({ id: 'priced', premiumPriceInr: 99, copies: 1 }),
    ])
    expect(r.rows.map(x => x.pubId)).toEqual(['priced'])
    expect(r.potentialInr).toBe(99)
    expect(r.unpricedCount).toBe(2)
  })

  it('lists a priced publication with zero forks (a visible ₹0 row), sorted by potential', () => {
    const r = projectEarnings([
      pub({ id: 'low', title: 'Low', premiumPriceInr: 99, copies: 1 }),
      pub({ id: 'high', title: 'High', premiumPriceInr: 199, copies: 3 }),
      pub({ id: 'none', title: 'NoForks', premiumPriceInr: 149, copies: 0 }),
    ])
    expect(r.rows.map(x => x.pubId)).toEqual(['high', 'low', 'none'])
    expect(r.rows.find(x => x.pubId === 'none')?.grossInr).toBe(0)
  })

  it('keeps a soft-unpublished priced plan in the projection — its forks happened on sale (#586)', () => {
    const r = projectEarnings([
      pub({ id: 'down', title: 'Down', premiumPriceInr: 199, copies: 4, unpublishedAt: 1_700_000_000_000 }),
      pub({ id: 'live', title: 'Live', premiumPriceInr: 99, copies: 2 }),
    ])
    // Deliberate: Potential is a statement about forks that already exist, not
    // about plans that still sell. Filtering the row here would erase real
    // history from the hypothetical — so the hub's strip says "published" and
    // its note names the unpublished rows instead.
    expect(r.rows.map(x => x.pubId)).toEqual(['down', 'live'])
    expect(r.potentialInr).toBe(199 * 4 + 99 * 2)
  })
})

describe('deriveActualSales (I-11)', () => {
  it('attributes each sale to its publication with the PAID amount, not the current price', () => {
    const r = deriveActualSales(
      [ent({ amountPaidInr: 199, grantedAt: 2000 }), ent({ id: 'e2', pubId: 'b', amountPaidInr: 149, grantedAt: 3000 })],
      [pub({ id: 'a', title: 'Kerala', premiumPriceInr: 499 }), pub({ id: 'b', title: 'Goa', premiumPriceInr: 499 })],
    )
    // Newest first, and the snapshot (199/149) — the publication's current
    // price (499) must not leak into the books.
    expect(r.rows.map(x => x.pubId)).toEqual(['b', 'a'])
    expect(r.rows.map(x => x.amountPaidInr)).toEqual([149, 199])
    expect(r.grossInr).toBe(348)
    // 15% of ₹199 = ₹29.85 → ₹30, then 15% of ₹149 = ₹22.35 → ₹22, charged
    // oldest first (₹199 was granted first) even though the table reads newest
    // first — re-sorting for display must not move a fee onto another sale.
    expect(r.rows.map(x => x.amountPaidInr)).toEqual([149, 199])
    expect(r.rows.map(x => x.feeInr)).toEqual([22, 30])
    expect(r.feeInr).toBe(52)
    expect(r.netInr).toBe(296)
    // Sold pubs follow row order (newest sale's publication first).
    expect(r.soldPubIds).toEqual(['b', 'a'])
  })

  it('titles sales from the creator\u2019s own publications, keeping orphans on the books', () => {
    const r = deriveActualSales(
      [ent({ pubId: 'gone' }), ent({ id: 'e2', pubId: 'a' })],
      [pub({ id: 'a', title: 'Kerala' })],
    )
    expect(r.rows.find(x => x.pubId === 'a')?.title).toBe('Kerala')
    // A publication unpublished/deleted after its sale must NOT vanish from




    // the ledger — the id stands in for the title.
    expect(r.rows.find(x => x.pubId === 'gone')?.title).toBe('gone')
  })

  it('an empty entitlement list is an honest zero ledger', () => {
    const r = deriveActualSales([], [pub({ id: 'a' })])
    expect(r.rows).toEqual([])
    expect(r.grossInr).toBe(0)
    expect(r.soldPubIds).toEqual([])
  })
})

describe('the platform fee ladder (I-13)', () => {
  it('is 15% of the first ₹25,000 of lifetime gross, then 10%', () => {
    expect(PLATFORM_FEE_TIERS).toEqual([
      { upToInr: 25_000, rate: 0.15 },
      { upToInr: null, rate: 0.10 },
    ])
    expect(platformFeeInr(10_000)).toBeCloseTo(1_500, 6)
    expect(platformFeeInr(25_000)).toBeCloseTo(3_750, 6)
    // MARGINAL, not a re-rate: crossing ₹25,000 never re-charges the first
    // ₹25,000 at the lower rate, so the fee cannot fall as a creator earns more.
    expect(platformFeeInr(35_000)).toBeCloseTo(3_750 + 1_000, 6)
    expect(netOfFeeInr(35_000)).toBeCloseTo(30_250, 6)
    expect(platformFeeInr(25_001)).toBeGreaterThan(platformFeeInr(25_000))
  })

  it('charges one slice the same wherever it sits inside a tier', () => {
    expect(feeForSliceInr(0, 1_000)).toBeCloseTo(150, 6)
    expect(feeForSliceInr(0, 20_000)).toBeCloseTo(3_000, 6)
    // A slice straddling the threshold pays each tier on its own part.
    expect(feeForSliceInr(20_000, 30_000)).toBeCloseTo(750 + 500, 6)
    expect(feeForSliceInr(30_000, 20_000)).toBe(0)
  })

  it('attributes a run of sales without ever charging a slice twice', () => {
    // Three ₹10,000 sales. The first two are wholly in the 15% tier; the third
    // STRADDLES the ₹25,000 line, so ₹5,000 of it is still charged 15% and only
    // the rest gets 10% — ₹1,250, not ₹1,000. Σ = ₹4,250 = the ladder on ₹30,000,
    // which is the property that makes the split safe to show at all.
    expect(attributeFeesInr([10_000, 10_000, 10_000])).toEqual([1_500, 1_500, 1_250])
    expect(platformFeeInr(30_000)).toBeCloseTo(4_250, 6)
    expect(attributeFeesInr([])).toEqual([])
  })

  it('totals the same whichever order sales arrived, though the split differs', () => {
    const smallFirst = attributeFeesInr([15_000, 25_000])
    const bigFirst = attributeFeesInr([25_000, 15_000])
    expect(smallFirst.reduce((s, f) => s + f, 0)).toBe(5_250)
    expect(bigFirst.reduce((s, f) => s + f, 0)).toBe(5_250)
    // Which sale gets the cheaper rate is a fact about ordering, so it differs —
    // and the UI says so rather than presenting the split as fixed.
    expect(smallFirst).not.toEqual(bigFirst)
  })

  it('walks the ladder oldest first on the real ledger', () => {
    const r = deriveActualSales(
      [
        ent({ id: 'late', amountPaidInr: 10_000, grantedAt: 5_000 }),
        ent({ id: 'early', amountPaidInr: 20_000, grantedAt: 1_000 }),
      ],
      [],
    )
    expect(r.grossInr).toBe(30_000)
    expect(r.rows.map(x => x.amountPaidInr)).toEqual([10_000, 20_000])
    expect(r.rows.map(x => x.feeInr)).toEqual([1_250, 3_000])
    expect(r.feeInr).toBe(4_250)
    expect(r.netInr).toBe(25_750)
    expect(r.feeInr).toBe(r.rows.reduce((s, x) => s + x.feeInr, 0))
    expect(r.netInr).toBe(r.rows.reduce((s, x) => s + x.netInr, 0))
  })

  it('is whole rupees on every row', () => {
    const r = deriveActualSales([ent({ amountPaidInr: 199 }), ent({ id: 'e2', amountPaidInr: 149, grantedAt: 2 } )], [])
    for (const row of r.rows) {
      expect(Number.isInteger(row.feeInr)).toBe(true)
      expect(Number.isInteger(row.netInr)).toBe(true)
    }
  })
})

describe('the hub reads the ledger as written (I-9/I-10/I-13)', () => {
  // The hub needs a creator account to render, which a node test cannot supply,
  // so the wiring is pinned at the source: these are the four ways the numbers
  // above could be computed correctly and then shown wrongly.
  const hub = readFileSync(new URL('../src/pages/CreatorHubPage.tsx', import.meta.url), 'utf8')

  it('shows the fee beside what is left, in both ledgers', () => {
    // Four headers: the actual ledger writes its <thead> twice — once for the
    // empty state and once for the rows, and the two must stay the same shape or
    // an empty ledger teaches the wrong columns — plus the projection ledger and
    // the payout runs, which are ledgers of their own.
    expect(hub.match(/<th className="num col-opt">Fee<\/th>/g)).toHaveLength(4)
    // The two Actual theads must be ONE shape. Counted directly, now that the
    // Fee head carries two classes: a drift in either thead shows up as a set of
    // two, which the count above cannot see on its own.
    const actualTheads = hub.match(/<thead><tr><th>Date<\/th>[^\n]*<\/tr><\/thead>/g) ?? []
    expect(actualTheads).toHaveLength(2)
    expect(new Set(actualTheads).size).toBe(1)
    expect(hub).toMatch(/formatInr\(r\.feeInr\)/)
    expect(hub).toMatch(/formatInr\(actual\.feeInr\)/)
    expect(hub).toMatch(/formatInr\(projection\.feeInr\)/)
  })

  it('lets the basis switch move emphasis, not hide a number', () => {
    expect(hub).toMatch(/aria-label="Show amounts as"/)
    // The tile and the pills SHOW gross until told otherwise …
    expect(hub).toMatch(/shownBasis === 'net' \? \(actual\?\.netInr \?\? 0\) : \(actual\?\.grossInr \?\? 0\)/)
    // … but the tables take the emphasis only once the basis is a CHOICE: while
    // `basis` is null the class is empty, so a fresh load shows both money columns
    // at full ink instead of greying out Net before anyone asked. A muted column
    // nobody chose reads as a disabled one, and at ≤720px Net is one of only three
    // columns the mobile policy keeps.
    expect(hub).toMatch(/const basisClass = basis === null \? '' : ` basis-\$\{basis\}`/)
    const tableLines = hub.split('\n').filter(line => line.includes('pub-ledger${basisClass}'))
    expect(tableLines).toHaveLength(4) // the sales ledger writes its thead twice, then runs and projection
    // ...and `aria-pressed` reads `basis` (null until a pill is pressed), NOT the
    // display state: parallel structure A/B'd against it would promise a pressed
    // nobody made to a screen reader, which is how the pills announced Gross
    // while the tables emphasised nothing. The visual highlight keeps the default
    // open; the pressed state reports the choice.
    expect(hub).toMatch(/aria-pressed=\{basis === k\}/)
    // The emphasis is emphasis only, never a hidden figure — and the CSS counts the
    // columns from the END, because each Total row opens with a `colSpan` label that
    // shifts every forward index by one.
    for (const table of ['ledger-sales', 'ledger-runs', 'ledger-projection']) expect(hub).toContain(table)
  })

  it('lets a failure and a kept figure share one role policy', () => {
    // A failure that leaves nothing to show is an alert; a kept figure is a status.
    // The first interrupts because nothing is on screen yet; the second announces a
    // change without stealing anything, because there are figures the reader can
    // keep using — which is also the line ui.tsx draws (assertive alerts,
    // polite field errors).
    const lines = hub.split('\n')
    const overviewAlert = lines.findIndex(line => line.includes('role="alert"'))
    expect(overviewAlert).toBeGreaterThan(-1)
    expect(hub).toContain('role="status"')
  })

  it('keeps the payout schedule on the actual ledger, never on a projection', () => {
    // #348 — the header reads the WALK's end state, not the ledger's net. Given
    // the raw net it would ask the minimum of the total while the run table asked
    // it of each period alone, which is how the two could disagree on one page.
    expect(hub).toMatch(/const walk = payoutWalk\(actual\?\.rows \?\? \[\], now\)/)
    expect(hub).toMatch(/payoutStatus\(walk\.balanceInr, now\)/)
    expect(hub).toMatch(/const payoutRuns = walk\.periods/)
    expect(hub).toMatch(/\{view === 'actual' && \(/)
    // …and it must not keep a second derivation behind it.
    expect(hub).not.toMatch(/payoutStatus\(actual\?\.netInr/)
  })

  it('states the fee rule wherever it explains a figure', () => {
    // Counted as INTERPOLATIONS, not as mentions. The bare-name form was
    // satisfied by the import line alone, so the guard could not tell one real
    // statement from two. It now means what it says: the ladder is stated beside
    // the Fee column it explains, and again where the projection's exactness is
    // claimed — and nowhere twice in one viewport.
    expect(hub.match(/\{PLATFORM_FEE_SUMMARY\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // The old placeholder's copy must not survive anywhere.
    expect(hub).not.toContain('TBD')
    expect(hub).not.toContain('mirrors gross')
  })

  it('never calls a past run paid', () => {
    // The one word that would turn an honest ledger into a false promise. Scoped
    // to the status helper: the sales ledger's own "Paid" column means what the
    // BUYER paid, which is a different word for a different thing.
    //
    // The helper MOVED to lib/earnings.ts (`payoutPeriodStatus`) because two
    // surfaces render it now — a creator's hub and the platform console — so the
    // wording is pinned where it lives, plus a check that the hub calls it
    // instead of growing a second copy of the label.
    // Normalized to LF before slicing: with core.autocrlf=true a fresh checkout
    // is CRLF, so an LF-only needle finds nothing, the slice over-captures into
    // code that mentions amountPaidInr, and the paid-guard fails on a file that
    // is innocent (the CRLF trap AGENTS section 3 records, hit 2026-09-21).
    const lib = readFileSync(new URL('../src/lib/earnings.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const status = lib.slice(
      lib.indexOf('export function payoutPeriodStatus'),
      lib.indexOf('/**\n * Group sales into the payout runs'),
    )
    expect(status.length).toBeGreaterThan(0)
    // The wording is now a template, because a run that cleared ON A CARRY must
    // name what it sent (#348) — but the sentence and the one forbidden word
    // are unchanged, and those are what this pins.
    expect(status).toContain('Owed — not disbursed')
    expect(status).not.toMatch(/paid/i)
    expect(hub).toMatch(/payoutPeriodStatus\(p\)/)
    expect(hub).toMatch(/<th>Status<\/th>/)
  })
})

describe('the price field states what is kept (I-13)', () => {
  const shareTab = readFileSync(new URL('../src/pages/trip/ShareTab.tsx', import.meta.url), 'utf8')

  it('puts the net beside the price, as a floor rather than a rate', () => {
    // A price on its own cannot know the creator's lifetime gross, so the only
    // honest figure it can promise is the least they keep — which is what the
    // first tier charges.
    expect(shareTab).toMatch(/netOfFeeInr\(priceNum\)/)
    expect(shareTab).toContain('a sale nets you at least')
    // FLOORED: `formatInr` rounds, and a net of ₹172.55 promised as "at least
    // ₹173" is a rupee more than the sale can produce.
    expect(shareTab).toMatch(/formatInr\(Math\.floor\(netOfFeeInr\(priceNum\)\)\)/)
    expect(shareTab).toMatch(/import \{[^}]*PLATFORM_FEE_SUMMARY[^}]*\} from '\.\.\/\.\.\/lib\/earnings'|PLATFORM_FEE_SUMMARY/)
  })
})

describe('the payout runs ledger (I-9)', () => {
  // Local midnights: a sale made during a week lands on the Friday after it,
  // so the arithmetic below is timezone-independent.
  const monday = new Date(2026, 8, 21, 9, 0, 0).getTime()
  const nextMonday = monday + 7 * 86_400_000

  it('puts a sale on the Friday after it was bought, at local midnight', () => {
    const run = new Date(nextPayoutRun(monday))
    expect(run.getDay()).toBe(PAYOUT_WEEKDAY)
    expect(run.getTime()).toBeGreaterThan(monday)
    expect([run.getHours(), run.getMinutes(), run.getSeconds()]).toEqual([0, 0, 0])
    expect(run.toDateString()).not.toBe(new Date(monday).toDateString())
  })

  it('groups a week of sales into one run, newest run first', () => {
    const led = deriveActualSales([
      ent({ id: 'a', amountPaidInr: 199, grantedAt: monday }),
      ent({ id: 'b', amountPaidInr: 199, grantedAt: monday + 86_400_000 }),
      ent({ id: 'c', amountPaidInr: 499, grantedAt: nextMonday }),
    ], [])
    const periods = payoutPeriods(led.rows, nextMonday + 86_400_000)
    expect(periods).toHaveLength(2)
    expect(periods[0]!.dueAt).toBeGreaterThan(periods[1]!.dueAt)
    expect(periods[0]!.salesCount).toBe(1)
    expect(periods[1]!.salesCount).toBe(2)
    expect(periods[1]!.grossInr).toBe(398)
  })

  it('adds up to the ledger above it — the same rows, the same fees', () => {
    const led = deriveActualSales([
      ent({ id: 'a', amountPaidInr: 199, grantedAt: monday }),
      ent({ id: 'b', amountPaidInr: 25_000, grantedAt: monday + 86_400_000 }),
      ent({ id: 'c', amountPaidInr: 499, grantedAt: nextMonday }),
    ], [])
    const periods = payoutPeriods(led.rows, nextMonday + 86_400_000)
    const sum = (pick: (p: ReturnType<typeof payoutPeriods>[number]) => number) =>
      periods.reduce((s, p) => s + pick(p), 0)
    expect(sum(p => p.grossInr)).toBe(led.grossInr)
    expect(sum(p => p.feeInr)).toBe(led.feeInr)
    expect(sum(p => p.netInr)).toBe(led.netInr)
    expect(sum(p => p.salesCount)).toBe(led.rows.length)
  })

  it('calls a run behind us owed, and one ahead scheduled', () => {
    const led = deriveActualSales([ent({ amountPaidInr: 499, grantedAt: monday })], [])
    expect(payoutPeriods(led.rows, monday)[0]).toMatchObject({ past: false })
    expect(payoutPeriods(led.rows, monday + 30 * 86_400_000)[0]).toMatchObject({ past: true })
  })

  it('rolls a run under the minimum over instead of clearing it', () => {
    // ₹149 → fee ₹22 → net ₹127, which is under the ₹500 minimum.
    const led = deriveActualSales([ent({ amountPaidInr: 149, grantedAt: monday })], [])
    expect(payoutPeriods(led.rows, monday)[0]).toMatchObject({
      netInr: 127, belowMinimum: true, clearsInr: 0,
    })
  })

  it('has no runs to show for a creator with no sales', () => {
    expect(payoutPeriods([], monday)).toEqual([])
  })
})

// ---- #348: the carry the copy always claimed and the code never did -------
// "Under ₹500 — rolls over" was a per-period verdict computed with no reference
// to any other period, so two ₹300 weeks read that sentence forever while the
// header above them offered a payout on their ₹600 sum. These pin the carry, and
// — the part that actually mattered — that the header and the rows are now ONE
// derivation rather than two rules that shared a constant.
describe('payout periods actually roll over (#348)', () => {
  const monday = new Date(2026, 8, 21, 9, 0, 0).getTime()
  const week = (n: number) => monday + n * 7 * 86_400_000
  const now = week(8)

  /** One run per week, holding `netInr` EXACTLY.
   *
   *  Built as `SaleRow`s rather than through `deriveActualSales` on purpose: a
   *  ₹300 sale nets ₹255 after the 15% tier, so a helper taking "nets" as gross
   *  amounts would silently test a different ladder than it reads as. The fee
   *  attribution is `buildSalesLedger`'s job and is pinned by its own tests —
   *  what is under test here is the CARRY, so the input states its own nets. */
  const runsOf = (...nets: number[]) => payoutWalk(
    nets.map((netInr, i) => ({
      pubId: 'p', title: 'P', amountPaidInr: netInr, feeInr: 0, netInr, grantedAt: week(i),
    })),
    now,
  )

  it('carries an under-minimum run into the next one instead of dropping it', () => {
    // The reported case: two ₹300 weeks. Old code cleared nothing on either row
    // and told both they rolled over; the carry makes the second clear ₹600.
    const { periods, balanceInr } = runsOf(300, 300)
    const [newest, older] = periods
    expect(older).toMatchObject({ netInr: 300, carriedInInr: 0, cumulativeInr: 300, clearsInr: 0, belowMinimum: true })
    expect(newest).toMatchObject({ netInr: 300, carriedInInr: 300, cumulativeInr: 600, clearsInr: 600, belowMinimum: false })
    // And the balance the header reads is the walk's own end state: the second
    // run SENT its ₹600, so nothing is open.
    expect(balanceInr).toBe(0)
  })

  it('accumulates across as many runs as it takes', () => {
    // [300, 100, 100] — the second and third are each under the floor alone,
    // so only a real carry can make the third reach ₹500.
    const { periods, balanceInr } = runsOf(300, 100, 100)
    const [third, second, first] = periods
    expect(first).toMatchObject({ carriedInInr: 0, cumulativeInr: 300, clearsInr: 0 })
    expect(second).toMatchObject({ carriedInInr: 300, cumulativeInr: 400, clearsInr: 0 })
    expect(third).toMatchObject({ carriedInInr: 400, cumulativeInr: 500, clearsInr: 500 })
    expect(balanceInr).toBe(0)
  })

  it('leaves a first-clear run carrying nothing, and leaves the next one open', () => {
    // [600] clears immediately (carry 0) and [600, 300] ends OPEN at ₹300 —
    // the walk's end carry, which is the header's number.
    const one = runsOf(600)
    expect(one.periods[0]).toMatchObject({ carriedInInr: 0, cumulativeInr: 600, clearsInr: 600, belowMinimum: false })
    expect(one.balanceInr).toBe(0)

    const two = runsOf(600, 300)
    expect(two.periods[0]).toMatchObject({ carriedInInr: 0, cumulativeInr: 300, clearsInr: 0, belowMinimum: true })
    expect(two.balanceInr).toBe(300)
  })

  it('gives the header and the rows ONE derivation, not two rules', () => {
    // The defect was not arithmetic, it was that the header and the table each
    // applied the minimum to a DIFFERENT aggregate — so a header could offer a
    // payout the table showed no run clearing. Asserted as a property over
    // several ledgers rather than on one fixture:
    //   * the balance the header judges IS the walk's end state, and
    //   * a header payout exists only when some run cleared, or the open
    //     balance has since reached the floor on its own.
    for (const nets of [[300, 300], [300, 100, 100], [600], [600, 300], [149, 149, 149], [300, 300, 300]]) {
      const label = `net ladder ${JSON.stringify(nets)}`
      const { periods, balanceInr } = runsOf(...nets)
      const last = periods[0]! // newest-first, so index 0 is the walk's LAST step
      expect(balanceInr, label).toBe(last.clearsInr > 0 ? 0 : last.cumulativeInr)

      const header = payoutStatus(balanceInr, now)
      // The precise claim: the header never offers money the walk does not hold.
      expect(header.clearsInr, label).toBeLessThanOrEqual(balanceInr)
      // …and the walk, not a second sum, is what says so. On the reported
      // ladder the OLD code cleared nothing and the header still offered ₹600.
      if (nets.join() === '300,300') {
        expect(periods.some(p => p.clearsInr > 0), label).toBe(true)
        expect(header.clearsInr, label).toBe(0) // it was sent, so nothing is open
      }
    }
  })

  it('keeps the run rows summing to the ledger — the carry did not re-derive a fee', () => {
    const led = deriveActualSales([
      ent({ id: 'a', amountPaidInr: 199, grantedAt: week(0) }),
      ent({ id: 'b', amountPaidInr: 25_000, grantedAt: week(1) }),
      ent({ id: 'c', amountPaidInr: 499, grantedAt: week(2) }),
    ], [])
    const { periods, balanceInr } = payoutWalk(led.rows, now)
    const sum = (pick: (p: ReturnType<typeof payoutPeriods>[number]) => number) =>
      periods.reduce((s, p) => s + pick(p), 0)
    expect(sum(p => p.grossInr)).toBe(led.grossInr)
    expect(sum(p => p.feeInr)).toBe(led.feeInr)
    expect(sum(p => p.netInr)).toBe(led.netInr)
    expect(sum(p => p.salesCount)).toBe(led.rows.length)
    // CONSERVATION, which is the property the carry could have broken: the money
    // that cleared plus the money still open is the ledger's net, exactly. A
    // carry is a restatement of the same rupees across rows, never an addition
    // to them — so summing both sides is the honest check, and the two are only
    // separable because a run that sends resets the carry to zero.
    const cleared = sum(p => p.clearsInr)
    expect(cleared + balanceInr).toBe(led.netInr)
  })

  it('walks OLDEST first, whatever order the sales arrive in', () => {
    // The carry only runs one direction, so the order is established by sorting
    // on the run date rather than inherited from the input. `buildSalesLedger`
    // hands back rows NEWEST first (it sorts for display), so this is the shape
    // the hub actually passes — the walk must not read it backwards.
    const led = deriveActualSales([
      ent({ id: 'early', amountPaidInr: 300, grantedAt: week(0) }),
      ent({ id: 'late', amountPaidInr: 300, grantedAt: week(1) }),
    ], [])
    // `buildSalesLedger` hands back rows NEWEST first (it sorts for display), so
    // this is the order the hub actually passes — the walk must not read it
    // backwards, and a `SaleRow` carries no id to sort by besides its date.
    expect(led.rows[0]!.grantedAt).toBe(week(1))
    const { periods } = payoutWalk(led.rows, now)
    // ₹255 + ₹255 crosses the ₹500 floor on the SECOND run only if the walk ran
    // oldest→newest. Read backwards, the older run would carry 0, the newer
    // would start from nothing, and NEITHER would clear — which is exactly the
    // reported bug, in the shape this fix has to rule out.
    expect(periods[1]!.carriedInInr, 'the OLDER run has nothing to carry in').toBe(0)
    expect(periods[0]!.carriedInInr, 'the NEWER run took the older one with it').toBeGreaterThan(0)
    expect(periods[0]!.clearsInr).toBeGreaterThanOrEqual(PAYOUT_MINIMUM_INR)
  })

  it('names the roll-in in the status cell, because the Net column cannot', () => {
    // A row that sends ₹600 while its own Net reads ₹300 is the fix working.
    // Without the clause it reads as an arithmetic error rather than a carry.
    const { periods } = runsOf(300, 300)
    expect(payoutPeriodStatus(periods[0]!)).toContain('rolled in')
    // A row with no carry keeps the old wording exactly — the pinned sentence.
    const plain = runsOf(600).periods[0]!
    expect(payoutPeriodStatus(plain)).toBe('Owed — not disbursed')
    expect(payoutPeriodStatus(plain)).not.toMatch(/paid/i)
  })
})

describe('revenue over time, for the console (I-20)', () => {
  const monday = new Date(2026, 8, 21, 9, 0, 0).getTime()
  const nextMonday = monday + 7 * 86_400_000

  it('groups a ledger into the weekly windows its sales fall in, newest first', () => {
    const led = deriveActualSales([
      ent({ id: 'a', amountPaidInr: 199, grantedAt: monday }),
      ent({ id: 'b', amountPaidInr: 199, grantedAt: monday + 86_400_000 }),
      ent({ id: 'c', amountPaidInr: 499, grantedAt: nextMonday }),
    ], [])
    const windows = revenuePeriods(led.rows)
    expect(windows).toHaveLength(2)
    expect(windows[0]!.runAt).toBeGreaterThan(windows[1]!.runAt)
    expect(windows[0]).toMatchObject({ salesCount: 1, grossInr: 499 })
    expect(windows[1]!.salesCount).toBe(2)
  })

  it('adds up to the ledger it came from — the same rows, the same fees', () => {
    // Re-deriving a fee per window would charge the 15% tier again every week,
    // so the windows are sums of the ledger's own rows.
    const led = deriveActualSales([
      ent({ id: 'a', amountPaidInr: 199, grantedAt: monday }),
      ent({ id: 'b', amountPaidInr: 25_000, grantedAt: monday + 86_400_000 }),
      ent({ id: 'c', amountPaidInr: 499, grantedAt: nextMonday }),
    ], [])
    const windows = revenuePeriods(led.rows)
    const sum = (pick: (p: ReturnType<typeof revenuePeriods>[number]) => number) =>
      windows.reduce((s, p) => s + pick(p), 0)
    expect(sum(p => p.grossInr)).toBe(led.grossInr)
    expect(sum(p => p.feeInr)).toBe(led.feeInr)
    expect(sum(p => p.netInr)).toBe(led.netInr)
    expect(sum(p => p.salesCount)).toBe(led.rows.length)
  })

  it('carries no rollover semantics — the platform does not pay itself out', () => {
    // The reason this is not `payoutPeriods`: a ₹500 minimum and an "owed"
    // status are facts about ONE creator's balance. Rendering them platform-wide
    // would claim the platform's own revenue rolls over under ₹500.
    const led = deriveActualSales([ent({ amountPaidInr: 199, grantedAt: monday })], [])
    const window = revenuePeriods(led.rows)[0]!
    expect(Object.keys(window).sort()).toEqual(['feeInr', 'grossInr', 'netInr', 'runAt', 'salesCount'])
    expect(revenuePeriods([])).toEqual([])
  })
})

describe('the local creator fixture\u2019s sales plan', () => {
  // scripts/seedCreatorFixture.mjs builds a creator with real sales so the
  // Earnings tab, the payout-runs ledger and the publish editor can be LOOKED
  // at — a node suite cannot render them (no DOM, no session), so the arithmetic
  // was pinned while the rendering was checked by nothing. This is the answer
  // key for that browser check: the same five sales the script writes, priced by
  // the shipped ladder. If the rendered ledger disagrees with the numbers here,
  // the ladder and the surface have drifted apart.
  const day = 86_400_000
  const base = new Date(2026, 8, 21, 9, 0, 0).getTime()
  const led = deriveActualSales([
    ent({ id: 'f1', pubId: 'pub-fixture-kerala', amountPaidInr: 199, grantedAt: base - 30 * day }),
    ent({ id: 'f2', pubId: 'pub-fixture-kerala', amountPaidInr: 499, grantedAt: base - 21 * day }),
    ent({ id: 'f3', pubId: 'pub-fixture-goa', amountPaidInr: 149, grantedAt: base - 9 * day }),
    ent({ id: 'f4', pubId: 'pub-fixture-goa', amountPaidInr: 25_000, grantedAt: base - 3 * day }),
    ent({ id: 'f5', pubId: 'pub-fixture-kerala', amountPaidInr: 199, grantedAt: base }),
  ], [pub({ id: 'pub-fixture-kerala', title: 'Kerala' }), pub({ id: 'pub-fixture-goa', title: 'Goa' })])

  it('reads as ₹26,046 gross / ₹3,855 fee / ₹22,191 net', () => {
    expect(led.grossInr).toBe(26_046)
    expect(led.feeInr).toBe(3_855)
    expect(led.netInr).toBe(22_191)
  })

  it('puts the ₹25,000 sale across the tier line, and the newest sale past it', () => {
    // ₹847 of gross precedes the big sale, so it is charged 15% up to ₹25,000
    // and 10% on the rest — ₹3,708 — while the ₹199 sale after it pays only 10%.
    const big = led.rows.find(r => r.amountPaidInr === 25_000)!
    expect(big.feeInr).toBe(3_708)
    expect(led.rows[0]!.feeInr).toBe(20)
  })

  it('leaves one run under the minimum, so the runs ledger shows a rollover', () => {
    // The ₹149 sale nets ₹127 — under the ₹500 floor — and the runs ledger must
    // be able to say so, which is the state a creator asks about first.
    const periods = payoutPeriods(led.rows, base + day)
    expect(periods.some(p => p.belowMinimum)).toBe(true)
    expect(periods.some(p => p.past)).toBe(true)
  })
})

describe('the payout schedule (I-9)', () => {
  it('lands on a Friday, strictly ahead of now, at local midnight', () => {
    const now = new Date(2026, 8, 21, 14, 30, 0).getTime()
    const due = new Date(payoutStatus(1_000, now).dueAt)
    expect(due.getDay()).toBe(PAYOUT_WEEKDAY)
    expect(due.getTime()).toBeGreaterThan(now)
    expect([due.getHours(), due.getMinutes(), due.getSeconds(), due.getMilliseconds()])
      .toEqual([0, 0, 0, 0])
    expect(due.getTime() - now).toBeLessThanOrEqual(7 * 86_400_000)
  })

  it('never schedules a run on today\u2019s own date — not even when today is the run day', () => {
    // "Today" would render as a promise every Friday, and there is no rail to
    // keep it; a balance always waits for the next one.
    for (let offset = 0; offset < 7; offset++) {
      const now = new Date(2026, 8, 21 + offset, 9, 0, 0)
      const due = new Date(payoutStatus(1_000, now.getTime()).dueAt)
      expect(due.getDay()).toBe(PAYOUT_WEEKDAY)
      expect(due.toDateString()).not.toBe(now.toDateString())
    }
  })

  it('clears a balance only once it reaches the minimum, and never invents one', () => {
    const now = Date.now()
    expect(payoutStatus(PAYOUT_MINIMUM_INR, now)).toMatchObject({
      clearsInr: PAYOUT_MINIMUM_INR, belowMinimum: false,
    })
    expect(payoutStatus(PAYOUT_MINIMUM_INR - 1, now)).toMatchObject({ clearsInr: 0, belowMinimum: true })
    // Nothing owed is not the same as too little owed.
    expect(payoutStatus(0, now)).toMatchObject({ clearsInr: 0, belowMinimum: false })
    expect(payoutStatus(-50, now).clearsInr).toBe(0)
    expect(payoutStatus(12_345.6, now).clearsInr).toBe(12_346)
  })
})

// ---- The ledger's read state, which decides whether Retry is even offered ---
// One ternary carried three separate bugs: a failed refresh that erased figures
// already on screen, a Retry that re-rendered the same alert it was pressed
// against (indistinguishable from a dead button), and a failure branch that was
// unreachable because null was tested first. The order is the fix, so pin it.
describe('deriveLedgerRead — the order of the three states', () => {
  it('keeps figures through a failed refresh instead of discarding them', () => {
    expect(deriveLedgerRead({ hasFigures: true, reading: false, error: true })).toBe('ready')
  })

  it('reports an in-flight attempt as reading, even straight after a failure', () => {
    // Without this, pressing Retry renders byte-identically to the state it was
    // pressed in, which is what made it read as a dead button.
    expect(deriveLedgerRead({ hasFigures: false, reading: true, error: true })).toBe('reading')
    expect(deriveLedgerRead({ hasFigures: false, reading: true, error: false })).toBe('reading')
  })

  it('reaches failed only with nothing to show, nothing in flight, and an error', () => {
    // 'failed' is the only state that offers Retry: it must be REACHABLE (the
    // original defect) and must not be reachable any other way.
    expect(deriveLedgerRead({ hasFigures: false, reading: false, error: true })).toBe('failed')
    expect(deriveLedgerRead({ hasFigures: false, reading: false, error: false })).toBe('reading')
  })

  it('never reports failed while figures are on screen', () => {
    for (const reading of [true, false]) {
      for (const error of [true, false]) {
        expect(deriveLedgerRead({ hasFigures: true, reading, error })).toBe('ready')
      }
    }
  })
})

describe('the projection strip names its denominator (#586)', () => {
  // The hub needs a creator account to render, which a node test cannot supply,
  // so the vocabulary is pinned at the source — the strip and the note are the
  // two places the projection could claim a live count it does not compute.
  const hub = readFileSync(new URL('../src/pages/CreatorHubPage.tsx', import.meta.url), 'utf8')

  it('the priced-plans tile says "published" over the denominator, never "live"', () => {
    // The denominator is every publication the creator owns — withdrawn ones
    // included — because the projection keeps their rows (pinned above).
    expect(hub).toMatch(/of \{myPubs\.length\} published/)
    expect(hub).not.toMatch(/of \{myPubs\.length\} live/)
  })

  it('a note names the unpublished plans exactly when the hub has any', () => {
    // Conditional: the reader of an all-live hub sees no permanent caveat.
    expect(hub).toMatch(/projectedUnpublished > 0 &&/)
    expect(hub).toMatch(/plans here are unpublished/)
  })
})
