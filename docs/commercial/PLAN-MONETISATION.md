# YatraFlow — Monetisation Plan

> **2026-10-12:** [`STRATEGY.md`](STRATEGY.md) sets the current position and order of work. Where the two disagree, `STRATEGY.md` wins.

**Date:** 2026-09-15 · **Product:** `v0.54.0` · **Revenue to date:** ₹0

A dedicated commercial design document. `REPORT-2026-09-15-strategy-and-position.md` (same folder) covers the business and the
staged roadmap; this one goes deep on the money — pricing, fee mechanics, tax incidence, the
data model, conversion mechanics, and failure modes.

Every figure is tagged: **[MEASURED]** read from the repo or a public source ·
**[DERIVED]** arithmetic on measured values · **[ASSUMPTION]** a stated guess ·
**[UNKNOWN]** not known · **[DECISION]** a choice to make.

---

## 0. Two corrections to the record

Both matter before any pricing discussion.

**0.1 The "seed guard" is not a blocker.** Earlier versions of this analysis called the
`store.ts:600` demo-seed defect an open blocker on charging. The code disproves it:
`tripCountUnknown` is set when the memberships read fails and the seed is skipped unless the
trip count is trustworthy (`store.ts:630`, issue `#94`) **[MEASURED]**. The roadmap's prose was
stale; the code was right. Nothing about account integrity stands in the way of taking money.

**0.2 The AI companion is not an LLM.** `src/lib/ai.ts` describes it as *"Deterministic,
trip-data-grounded assistant. No live data claims — every answer cites the assumptions it
used."* `answerQuestion(trip, question)` is a pure function over trip data with no network call
**[MEASURED]**. `docs/ARCHITECTURE.md` lists *"Rule-based AI → LLM with engine grounding"* as a
future swap-in **[MEASURED]**.

This is the single most important fact for pricing the companion, and section 2 explains why: a
deterministic function has **zero marginal cost**, and an LLM has **real per-query cost**. They
are not the same product and cannot be priced the same way.

---

## 1. Starting position: the monetisation surface is built

An inventory of what already exists, because it determines how cheap Stage 2 is.

| Component | State | Evidence |
|---|---|---|
| Unlock price points | **Chosen** — ₹149 / ₹199 / ₹249 / ₹499 | `src/data/seed.ts` **[MEASURED]** |
| `premiumPriceInr` on the publication | Ships, and is **the price the paywall charges** — read server-side from the row, `0`/unset meaning entirely free | `src/data/types.ts`, `api/checkout.js` **[MEASURED]** |
| Free/paid split per publication | **`freeDayIndexes: number[]`** — which days are free | `src/data/types.ts` **[MEASURED]** |
| Locked-day UX | Blurred preview of the **first 3 stops** + *"N more stops on this day"* + *"Unlock the full day-by-day plan with stay contacts, timings and budget breakdown"* | `PublicItinerary.tsx` **[MEASURED]** |
| Unlock CTAs | **Two** — inline on the locked day, and a sticky sidebar button | `PublicItinerary.tsx` **[MEASURED]** |
| Per-publication custom CTA | `subscriberCta?: string` | `src/data/types.ts` **[MEASURED]** |
| Fork behaviour | Copies **only the free preview**; locked days arrive as fill-in placeholders | `PublicItinerary.tsx` **[MEASURED]** |
| Anonymous save | localStorage, **no account required**, device-local | `src/lib/savedPubs.ts` **[MEASURED]** |
| Creator hub | Publications manager, stats, unpublish, stale-page nudge | `CreatorHubPage.tsx`, v0.37/v0.38 **[MEASURED]** |
| Earnings ledger | Ships with its **final** column shape: Payout period · Sales · Platform fee · Net payout | `ARCHITECTURE.md` **[MEASURED]** |
| Projection view | `projectEarnings()`, labelled *"never money"* | `src/lib/earnings.ts` **[MEASURED]** |
| Fee model | **Decided and shipped 2026-09-21 (I-13)** — a marginal ladder over lifetime gross: 15% to ₹25,000, then 10%. `PLATFORM_FEE_TIERS` is the one seam | `src/lib/earnings.ts` **[MEASURED]** |
| AI companion | **Fully implemented, flag-gated off** for *"the premium packaging milestone"* | `featureFlags.ts`, `TripWorkspace.tsx:289` **[MEASURED]** |
| M7 schema contract | `sale_events`, `payouts`, entitlements table, KYC fields, Razorpay ids, webhook log with idempotency keys | `docs/ARCHITECTURE.md` §"Creator earnings contract (M7)" **[MEASURED]** |
| Payment rail | **Shipped v0.61.0** — order created server-side at the row's own price, signature-verified confirm, idempotent webhook | `api/checkout.js`, `api/payments-verify.js`, `api/payments-webhook.js` **[MEASURED]** |
| Entitlements | **Shipped** — `entitlements` + `purchase_orders`, owner-scoped RLS, granted only through the buyer-scoped RPC or the webhook, revoked on refund | `supabase/migrations/20260918_payments_*.sql` **[MEASURED]** |
| Analytics backend | **No vendor, by design.** Fork/view counts ride the publication row, `computeFunnel()` derives the rates in the admin console, and platform revenue reads through the admin-gated `admin_revenue` RPC. `sale_events` — per-visit events — is still absent, which is what blocks a per-publication funnel (E3/E8) | `src/lib/adminStats.ts`, `20260921_admin_revenue.sql` **[MEASURED]** |

**The paywall is designed, and the rail underneath it shipped in v0.61.0.** The
blurred-teaser-then-unlock pattern, the free-day index, the dual CTA, and the explicit
degradation path for forkers are all live — and the locked days are now redacted at the wire
(`get_public_trip`), so the blur is presentation rather than the protection. What is still
missing is the money *out*: no `payouts` table and no KYC fields, so the ledger's runs are
derived and nothing disburses.

One detail worth calling out as genuinely good design: **forking a paid itinerary copies only the
free days.** The paid content is not handed over at fork time — it arrives as placeholders the
forker fills in themselves. That is a deliberate anti-leak decision, and it is already in the
code.

---

## 2. The two products, and why their economics differ completely

This distinction drives the entire plan and is easy to get wrong.

| | **A — Premium itinerary unlock** | **B — AI companion** |
|---|---|---|
| What the buyer gets | Locked days: stay contacts, timings, budget breakdown | Grounded answers about their own trip |
| Marginal cost today | **₹0** | **₹0** (deterministic) |
| Marginal cost once upgraded | **₹0** | **Real** — per-query tokens |
| Recurrence | One-off per itinerary | Subscription |
| Ceiling | Audience × content supply | Audience |
| Refund risk | High (digital content, seen-then-refunded) | Low |
| Cannibalisation | Moderate — a free good itinerary substitutes | Low |
| Supply dependency | **Creator-dependent** | None |
| Build cost | Rail + entitlements | Rail + entitlements (same rail) |

**The consequence is a design rule, not an opinion:**

- **Unlocks are near-100% gross margin but supply- and audience-capped.** They cannot carry a
  business alone (section 7 proves this arithmetically) but they cost nothing to offer.
- **A subscription is uncapped and recurring, but carries variable cost** — and today's
  deterministic companion may not be worth paying for at all, because a rule-based analysis of
  your own trip data is something users may read as "the app told me what it already shows me".

**So the honest sequencing is:** ship the unlock first, because it needs no new product — the
surface is built. Ship the companion as a paid tier **only after it becomes an LLM**, because
that is the version with a defensible reason to pay, and only with a measured token budget.

---

## 3. Pricing design

### 3.1 The price points that already exist

₹149 / ₹199 / ₹249 / ₹499 **[MEASURED]**. They are not arbitrary — they track itinerary length
and depth. ₹199 is the modal value and the working assumption throughout this document.

### 3.2 Pricing the unlock

**What the buyer actually receives** (from the shipped locked-day copy): stay contacts, timings,
and a budget breakdown for the locked days. That is the deliverable, and it is specific — which
is good, because vague value cannot hold a price.

**Anchors for a ₹199 price point** — all **[ASSUMPTION]**, listed so they can be challenged:

| Comparable | Typical price | Why it anchors |
|---|---|---|
| A regional road-trip guidebook | ₹300–600 | The direct substitute for a good itinerary |
| A travel agent's consultation | ₹500–2,000 | What people pay for human route planning |
| A one-off paid newsletter / Notion template | ₹99–499 | The creator-economy convention |
| A single restaurant meal on the trip | ₹300–600 | The in-trip reference point |

**Recommendation: hold ₹199 for a full multi-day itinerary, and use the existing tiering.**
Rationale: it sits below the guidebook and well below an agent consult, it is the already-chosen
modal price, and it is an impulse-scale amount that does not require deliberation. Do **not**
raise it before measuring copy→pay — a price rise on an unmeasured funnel is unfalsifiable.

> **Cited context (2026-09-18).** The comparable bands above now have external references:
> $9/destination guides, $19–39 premium guides, $16.99–24.99 colour guidebooks — with source
> strengths tagged — in `RESEARCH-2026-09-18-creator-market-and-paywall-value.md` §3, which
> also adds two presentation anchors (per-day: "6 days · ₹83/day"; trip-cost: "~0.4% of what
> the trip costs") that shift willingness-to-pay without changing the price.

### 3.3 Pricing the AI companion

**The problem with the current version.** It is deterministic and grounded. Its answers cite
assumptions and are derived from trip data the user already entered. That is *honest* — and it
is hard to charge for, because the user cannot easily see what they are buying that they did not
already have. Selling it as-is risks refund requests and reputational cost.

**What makes it sellable is the upgrade path already documented in `ARCHITECTURE.md`:** an LLM
with engine grounding. Natural-language questions, arbitrary scope, reasoning over the whole
trip. That is a different product and it has a real reason to exist.

**Packaging options:**

| Option | Price | Pros | Cons |
|---|---|---|---|
| Monthly subscription | ₹99–149 | Recurring; matches consumer habit | Needs continuous value; token COGS |
| Per-trip unlock | ₹49–99 | Matches how people plan (episodically) | Low LTV per user |
| Bundled with unlocks | Free above ₹X spend | Drives unlock conversion | Gives away the recurring SKU |

**Recommendation: subscription at ₹99/month, with a per-trip option at ₹49 tested in parallel.**
The reason to lead with ₹99 rather than ₹149: the trip-planning use case is episodic, so a
subscription is already fighting user behaviour. A lower price reduces the "why am I paying in a
month I'm not travelling" objection, and the token COGS at ₹99 is comfortable if the cost is
managed (see below). Test both; do not assume.

**The token budget rule.** Once the companion is an LLM, price must satisfy:

```
monthly price  ≥  10 × (expected monthly token cost of the MEDIAN subscriber)
```

The 10× multiple absorbs heavy users and the long tail without a per-query cap. Token cost per
query is **[UNKNOWN]** and must be measured in Stage 1 before the companion is priced. Do not
launch a paid LLM tier without that number — it is the only variable cost in the business.

### 3.4 What not to price yet

The marketplace take rate (Stage 4) and B2B licences (Stage 5). Pricing a partner commission
before there is a single partner is guesswork dressed as planning.

---

## 4. The fee model — the actual arithmetic

This is the part every previous version of the report skipped, and it is where a marketplace
quietly loses money.

### 4.1 The floor: costs incurred before the platform earns anything

| Cost | Rate | Basis |
|---|---|---|
| Razorpay TDR | 2.00% | Domestic transactions, zero setup fee **[MEASURED — Razorpay public pricing]** |
| GST on the TDR | 0.36% | 18% of the 2% TDR **[MEASURED]** |
| **Effective payment cost** | **2.36%** | On a ₹100 transaction: ₹2 TDR + ₹0.36 GST **[MEASURED]** |
| TDS u/s 194-O | ~1.00% | On gross payments to sellers by an e-commerce operator **[MEASURED — needs CA confirmation; rates are amended by Finance Acts]** |
| GST TCS u/s 52 | ~0.50% | Separate from 194-O **[MEASURED — needs CA confirmation]** |
| **Total floor** | **≈3.86%** | **[DERIVED]** |

**A platform fee below ~4% is net-negative.** That is the floor, and it is why "just take 2%"
is not an option.

### 4.2 The structural decision: who is the supplier?

This decides GST incidence, and the arithmetic is not cosmetic.

**Branch 1 — the creator is the supplier, YatraFlow is an intermediary.** YatraFlow's taxable
supply is its own fee; the creator is responsible for GST on the content.

**Branch 2 — YatraFlow is merchant of record.** YatraFlow's taxable supply is the full ₹199.

| | Branch 1 (intermediary) | Branch 2 (merchant of record) |
|---|---|---|
| GST base | YatraFlow's fee only | The full ₹199 |
| GST at 18% on ₹199 | — | **₹30.36** |
| Creator receives (at a 15% fee) | **₹161.47** | **₹134.10** |
| Creator take as % of gross | **81.1%** | **67.4%** |

**[DERIVED]** — GST computed as `199 × 18/118 = ₹30.36` (prices in India are displayed
GST-inclusive).

**Branch 2 costs the creator about ₹27 per sale** — more than the platform fee itself earns at
15%. Choosing merchant-of-record without noticing this would make the creator programme
uneconomic for exactly the creators it needs.

**Recommendation: structure as Branch 1.** YatraFlow is a platform, not a publisher; the fee is
its supply. **This is a legal and tax structuring decision and must be confirmed with a
chartered accountant before the first sale.** I am not a tax adviser and the rates above are
amended by Finance Acts.

### 4.3 Recommended fee structure

| Benchmark | Rate |
|---|---|
| Topmate (India) | **10% platform fee + ~2.9% processing ≈ 12.9% total** **[MEASURED]** |
| Gumroad | Gumroad-shaped ledger anatomy, per `ARCHITECTURE.md` **[MEASURED]** |

**Recommendation: 15% flat platform fee, tiered down to 10% above a lifetime-GMV threshold.**

- 15% clears the ~3.86% floor with real margin, and sits close to the ~12.9% Indian market norm
  so it will not repel creators.
- The tiered discount is the retention mechanic: it rewards creators who stay, and it costs
  nothing until they are already earning.
- Set the tier threshold once real GMV exists — not now.

**Why not higher:** creator supply is the binding constraint on Product A. At 25% the platform
would clear more per sale and attract far fewer creators, which is the wrong trade when the
scarcest resource is content.

### 4.4 Worked example: one ₹199 unlock, rupee by rupee

Branch 1, 15% fee, prices GST-inclusive **[DERIVED]**:

| Line | Amount | Notes |
|---|---|---|
| Buyer pays | **₹199.00** | |
| Razorpay TDR (2%) | −₹3.98 | |
| GST on TDR (18%) | −₹0.72 | |
| **Available** | **₹194.30** | |
| Platform fee (15% of ₹199) | ₹29.85 | |
| Creator gross | ₹164.45 | |
| Less 194-O TDS (1%) | −₹1.99 | Withheld, deposited against the creator's PAN |
| Less GST TCS (0.5%) | −₹1.00 | |
| **Creator net payout** | **₹161.47** | 81.1% of gross |
| Platform fee | ₹29.85 | |
| Less GST on the fee (18/118) | −₹4.55 | |
| **Platform net revenue** | **₹25.30** | **12.7% of gross** |

**So the real number to model is ₹25.30 per ₹199 unlock — not ₹199 and not ₹29.85.** Every
revenue figure in section 7 uses ₹25.30.

---

## 5. The stage-wise plan

Five stages. Each has an entry gate, a build, revenue mechanics, unit economics, an exit gate,
kill criteria, **and failure modes** — because the failure modes are what the previous report
never listed.

---

### Stage 0 — Instrument · now · ₹0 revenue

**Purpose.** You cannot price what you cannot measure, and three of the four numbers that
determine revenue are measurable today for free.

**Steps**

1. **Clean the public gallery.** One itinerary exists and it is a duplicate named `(copy)` with a
   mangled author name **[MEASURED]**. Unpublish the duplicates — `dedupePublished()` and the
   unpublish owner gate ship already.
2. **Record the funnel weekly.** `computeFunnel()` already returns `activationPct`, `collabPct`,
   `publishPct`, `viewToCopyPct`, plus raw `views` and `copies` **[MEASURED]**. Put it in the
   admin console and write it down. No new instrumentation required.
3. ~~**Set the fee model constant.**~~ **Done 2026-09-21 (I-13):** 15% to ₹25,000 of lifetime gross, 10% after, as a marginal ladder in `PLATFORM_FEE_TIERS` **[MEASURED]**.
4. **Decide the merchant-of-record question with a CA** (§4.2). It changes the creator payout by
   ~₹27 per sale and cannot be deferred past the first sale.
5. **Record infrastructure invoices.** Currently **[UNKNOWN]** — the actual Supabase/Vercel bills
   are not in the repo and the free-tier assumption is unverified.

**Exit gate:** four consecutive weeks of funnel data, a curated gallery, a CA-confirmed tax
structure.
**Kill criterion:** none. This stage is always worth doing.
**Failure mode:** measuring for four weeks and changing nothing. The point is to have a baseline
before spending a rupee on distribution.

---

### Stage 1 — Prove demand · M5 · ₹0 revenue

**Purpose.** Prove people return, and that the engine produces trips worth paying for — before
building a payment rail.

**Steps**

1. **Ship the AI companion to the free tier.** It is built and flag-gated **[MEASURED]**. Release
   it free and measure whether it moves retention. A paywall on a feature nobody misses earns
   nothing.
2. **Instrument the companion's usage** — queries per user per month. This is the input to the
   token budget in §3.3, and it must exist before the LLM upgrade is priced.
3. **Write the Stage 2 thresholds down now.** Deciding the pass mark after seeing the result is
   how a metric becomes a story.
4. **Publish 20 reference itineraries** through the shipped creator flow. This is Stage 2's
   inventory, and it costs only the founder's time.
5. **Qualitative pricing research** with the existing cohort, reachable via the invite system.
   Directional only.

**Exit gate:** view→copy above the pre-set mark; creator supply ≥ the pre-set count; week-4
retention ≥ the pre-set rate.
**Kill criterion:** if retention is flat and view→copy is near zero, **do not build M7**. The
problem is the product, and the correct move is back to M6.
**Failure mode:** shipping the companion free, seeing usage rise, and concluding the *paid*
version will sell. Free usage proves interest, not willingness to pay.

---

### Stage 2 — The first rupee · M7 · unlocks

**Purpose.** Convert proven demand into revenue with the smallest build available, because the
surface already exists.

**Steps — the build, from the shipped M7 contract [MEASURED]**

1. ~~**Migration** (schema in §6): `sale_events`, `payouts`, `entitlements`, KYC fields on
   `profiles`.~~ **Partly done (v0.61.0)** — `entitlements` and `purchase_orders` shipped with the
   rail. `sale_events`, `payouts` and the KYC fields are still to build, which is why nothing
   disburses and no per-visit funnel can be read.
2. ~~**Razorpay**: order creation, webhooks with **idempotency keys**, refund path, dispute handling.~~
   **Done (v0.61.0)** — order created server-side, signature-verified confirm, idempotent webhook,
   refund revocation via `revoke_refunded_entitlement`. Dispute handling remains.
3. ~~**Redacting read path + narrowed RLS — this is the first thing to build, not the third.**~~
   **Done (v0.61.0)**, and it was built first. The audit below is kept as the finding it closed:
   an audit of the publish path on 2026-09-15 proved against production that the
   lock was a CSS overlay: `publishItinerary` sets `trips.visibility = 'public'`, the `trips read`
   RLS policy had no `to` clause so it applied to `anon`, and the entire itinerary lived in that
   row's `days` column. **Both live premium publications (₹199 and ₹500) returned all 7 locked
   days and 20 stops to an unauthenticated client.** `get_public_trip` now redacts those days to
   stubs and `trips read` is narrowed to `authenticated` — shipped together, so the public page
   keeps working.
4. ~~**Set the fee model** — replace `PROJECTED_PLATFORM_FEE_INR = 0`.~~ **Done** — see §11 row 2.
5. ~~**Switch on the existing unlock buttons** (two per page, already placed).~~ **Done** — the
   buttons run the real checkout (`src/lib/unlock.ts`), and the free preview degrades rather than
   failing if the rail is unconfigured.
6. **GST/TDS registration and invoicing** — see §4.2.
7. ~~**Post-unlock value presentation** — the unlock ceremony, owned library and
   purchase share card (research §4; buildable as I-20/I-21).~~ **Done** — I-20 (the reveal plus the
   **My purchases** shelf) and I-21 (the buyer's share card) both shipped. The reasoning held: the
   plan now lands as a visible owned product, and the buyer is the distribution channel.

**Revenue mechanics.** Revenue = `views × view→copy × copy→pay × ₹199 × 15%`, netting ₹25.30 per
unlock **[DERIVED]**.

**Exit gate:** at least one creator has received a **real payout**, and there is evidence of
repeat purchase.
**Kill criterion:** fewer than a pre-set number of paid unlocks in 60 days at the seeded prices →
the content marketplace is not the wedge. Revert to subscription-only and stop investing in the
unlock flow.
**Failure modes:**

- **Piracy by re-publication.** Forking copies only free days, so the fork itself does not leak.
  But `publishItinerary` performs **no provenance check** — fork a *free* publication, and you own
  a complete copy you can re-publish as your own. This has already occurred: the live gallery
  contains a duplicate. **Resolved by the publish-path audit**, which also
  found the larger problem that the locked content is readable without forking at all. Record
  provenance at publish time, and block or strip derived content.
- **The lock is not an access control.** See step 3. Until the redacting read path ships, the
  unlock is a UI convention and **no sale should be taken**.
- **Refund abuse.** Digital content seen-then-refunded. Mitigate with a clear pre-purchase
  description of exactly what unlocks, and a no-refund-after-view policy stated at checkout.
- **Creator supply collapse.** Unlocks need creators. If the first creators earn near nothing,
  the programme dies before it starts. Consider seeding the first 20 itineraries as
  platform-authored so the shelf is not empty on day one.
- **Cannibalisation.** A good free itinerary removes the reason to buy a different one. The free
  day count (`freeDayIndexes`) is the lever — it must be generous enough to prove quality and
  stingy enough to leave a reason to pay.

---

### Stage 3 — Subscription becomes the primary SKU · M8/M9

**Purpose.** Product A is audience-capped (section 7). The subscription is not.

**Steps**

1. **Upgrade the companion to an LLM with engine grounding** — the documented path
   **[MEASURED]**. This is the version worth paying for.
2. **Measure token cost per query** before setting a price. Enforce the 10× rule (§3.3).
3. **Price at ₹99/month**, with a ₹49 per-trip option tested in parallel.
4. **Bundle decision:** do subscribers get unlocks included? Recommend a monthly unlock
   allowance rather than unlimited — unlimited converts a near-zero-marginal-cost product into a
   creator-payout liability.
5. **Invite gate (M9 R3)** — only if quality needs protecting. The repo's own plan says it *"may
   be deferred indefinitely — that is a valid end state"* **[MEASURED]**.

**Exit gate:** a **measured** CAC, and a repeatable monthly subscriber count.
**Kill criterion:** if median subscriber token cost exceeds 20% of price, the packaging is wrong.
Fix the packaging before spending on acquisition.
**Failure mode:** **episodic use versus recurring billing.** Trip planning is a few times a year.
Expect high month-2 churn, and design for it — a per-trip option, or a pause rather than a
cancel. Do not model subscription revenue as flat monthly retention until it is measured.

---

### Stage 4 — Marketplace · post-1.0 · commissions

**Purpose.** The marketplace every previous version led with. It belongs here because it is a
**supply-operations business**, not a feature.

**Steps**

1. **Manual pilot** — 5–10 drivers or homestays, onboarded by hand, no code.
2. Measure whether manual onboarding produces **repeat bookings**.
3. Only then build verification, onboarding, payouts, disputes, insurance.

**The mistake not to repeat.** The previous report budgeted ₹1,500 CAC per driver and **no
headcount** for a stage requiring field operations and payouts. Marketplace revenue is earned by
people talking to drivers, and that cost appeared nowhere.
**Kill criterion:** if the hand-onboarded pilot does not produce repeat bookings, the marketplace
thesis is wrong. Run that experiment before building anything.

---

### Stage 5 — B2B licences · post-1.0

White-label itinerary building for travel agents. Needs a stable 1.0, an API, and support
capacity. Listed for completeness; not a twelve-month plan.

---

## 6. The data model M7 needs

From the shipped contract in `docs/ARCHITECTURE.md` **[MEASURED]**, expanded with the reasoning
each column needs — plus one item the audit added, which comes first.

### 6.0 The redacting read path — build this before the rest

**Added by the publish-path audit of 2026-09-15.** The schema below is worthless without it,
because entitlements gate a read and the read is currently ungated.

> The full audit write-up — including the reproduction detail — is **held outside this repository
> until the fix ships**, so this document carries the finding, the evidence and the fix without
> the how-to.

Proven against production: `publishItinerary` sets `trips.visibility = 'public'`; the
`trips read` policy (`schema.sql:342`) has **no `to` clause**, so it applies to `anon`; and the
entire itinerary is the `days` column on that row. Both live premium publications returned all
locked days to an unauthenticated client.

```
1. get_public_trip(p_trip_id uuid)   SECURITY DEFINER
   - reads the publication's free_day_indexes
   - returns locked days as stubs, UNLESS an entitlement exists for auth.uid()
   - grant execute to anon, authenticated
2. drop policy "trips read" on public.trips;
   create policy "trips read" on public.trips
     for select to authenticated using (
       auth.uid() = owner_id or public.is_member(trips.id)
     );
3. point fetchSharedTrip() at the RPC instead of `select *`
```

Two traps: a `SECURITY DEFINER` function returning the raw row would be **worse** than today
(it bypasses RLS); and the entitlement check must live **inside the function**, not in the client.

### `sale_events`

| Column | Why |
|---|---|
| `id` | Primary key |
| `pub_id` | Which itinerary was unlocked |
| `buyer_id` / guest ref | Nullable — anonymous buyers must be supported, since anonymous viewing and saving already work **[MEASURED]** |
| `amount_inr` | What was actually charged |
| `price_snapshot_inr` | **The price at the time of sale.** Prices will change; a payout must not be recomputed from today's price |
| `status` | `created` / `paid` / `refunded` — refunds must be first-class, not deletions |
| `created_at` | For payout periods and the ledger |

Plus Razorpay `order_id` and `payment_id`, and a **webhook log with idempotency keys** — Razorpay
retries webhooks, and a double-credited sale is a real payout error.

### `entitlements`

The table that makes the lock real. Minimum: `user_id`, `pub_id`, `granted_at`, `source`
(purchase / grant / bundle). Without it, premium gating is client-side only and the paid content
is one API call away — which is the difference between a paywall and a decoration.

### `payouts`

`creator_id`, `period_start`, `period_end`, `gross_inr`, `fees_inr`, `tds_inr`, `tcs_inr`,
`net_inr`, `status`, **`utr_reference`** (the bank reference — the only proof a creator has that
money moved).

### `profiles` additions

Payout-account and KYC fields. **This is a hard dependency on creator onboarding** and it is the
step most likely to be underestimated: a creator cannot be paid without verified bank details,
and the collection of those details is a product surface that does not exist.

### The refund path

Every refund reverses a `sale_event`, revokes the entitlement, and creates a **negative line in
the creator's next payout**. If this is not designed up front, the first refund silently pays the
creator for a sale that was reversed.

---

## 7. Financial model — the range the unknowns span

### 7.1 The parameters

| # | Parameter | Value | Tag |
|---|---|---|---|
| 1 | Unlock price | ₹199 | **[MEASURED]** (seed) |
| 2 | Platform fee | 15% | **[DECISION]** |
| 3 | **Net platform revenue per unlock** | **₹25.30** | **[DERIVED]** §4.4 |
| 4 | Monthly itinerary views | — | **[UNKNOWN]** |
| 5 | view→copy | — | **[UNKNOWN — measurable in Stage 0]** |
| 6 | copy→pay | — | **[UNKNOWN]** |
| 7 | Subscription price | ₹99/month | **[DECISION]** |
| 8 | Token cost per query | — | **[UNKNOWN — measurable in Stage 1]** |
| 9 | Infrastructure cost | free tiers assumed, invoices unread | **[UNKNOWN]** |

### 7.2 Unlocks: the binding constraint is audience, not conversion

Monthly platform revenue from unlocks at ₹25.30 each:

| view→copy ↓ / copy→pay → | 3% | 6% | 10% |
|---|---|---|---|
| **2%** | ₹76 | ₹152 | ₹253 |
| **4%** | ₹152 | ₹304 | ₹506 |
| **6%** | ₹228 | ₹455 | ₹759 |

**[DERIVED]** — at 5,000 monthly views. Multiply by 10 for 50,000 views, by 50 for 250,000.

Now invert it. **What does it take to reach ₹5,00,000/month from unlocks alone?**

```
₹5,00,000 ÷ ₹25.30 = 19,763 unlocks/month
At 4% view→copy and 6% copy→pay  →  ~8,234,000 views/month
At 6% view→copy and 10% copy→pay →  ~3,294,000 views/month
```

**[DERIVED]** — **you need 3.3–8.2 million itinerary views per month.** For scale, the current
gallery has **3 views total** **[MEASURED]**.

**This is the finding that should govern the plan.** Optimising view→copy from 4% to 6% moves
₹304 to ₹455. The constraint is not conversion — it is that nobody is looking. Unlocks are a
supplement, permanently.

### 7.3 Subscriptions: the same money, a plausible path

| Price | Subscribers for ₹5,00,000/month | Gross margin after a ₹10/month token cost |
|---|---|---|
| ₹99 | **5,051** | 89.9% |
| ₹149 | **3,356** | 93.3% |

**[DERIVED]**

**~5,000 subscribers is a reachable number for a niche Indian travel tool. 3.3 million monthly
views is not.** That comparison is the entire argument for subscription-first.

### 7.4 Three scenarios

All **[ASSUMPTION]** except the per-unit economics, which are **[DERIVED]**.

| | Bear | Base | Bull |
|---|---|---|---|
| Monthly views | 5,000 | 50,000 | 250,000 |
| view→copy | 2% | 4% | 6% |
| copy→pay | 3% | 6% | 10% |
| Unlocks/month | 3 | 120 | 1,500 |
| Unlock revenue | ₹76 | ₹3,036 | ₹37,950 |
| Subscribers | 0 | 250 | 2,000 |
| Subscription revenue | ₹0 | ₹24,750 | ₹1,98,000 |
| **Total / month** | **₹76** | **₹27,786** | **₹2,35,950** |
| **Total / year** | **₹912** | **₹3.33 L** | **₹28.3 L** |

**A 3,000× spread between the bear and bull cases.** That is not a forecast — it is an honest
statement that the model is dominated by unknowns. **Which is the argument for Stage 0: three of
those unknowns can be measured this week, for free.**

For comparison, the previous report claimed **₹2.05 Crores in Year 1** — roughly **7× the bull
case here**, with no measurement behind it.

### 7.5 Break-even

The business is not capital-intensive until Stage 4. Fixed cost today is the founder's time plus
infrastructure **[UNKNOWN]**. If infrastructure is ₹10,000/month, break-even is:

```
₹10,000 ÷ ₹25.30 = 395 unlocks/month     (unlocks alone)
₹10,000 ÷ ₹99    = 101 subscribers/month (subscriptions alone)
```

**[DERIVED]** — **101 subscribers covers infrastructure.** That is the first real milestone, and
it is far more motivating than a TAM.

---

## 8. Conversion mechanics — what actually moves each number

### 8.1 view→copy

The fork button competes with a free alternative: close the tab. Levers, in order:

1. **The preview image.** With no OG tags and hash routing **[MEASURED]**, a shared link is a bare
   URL. Fixing this is the highest-leverage conversion work available and it is not a product
   change at all.
2. **Free-day generosity.** `freeDayIndexes` decides how much is proven before the ask. One free
   day of a 10-day trip proves nothing.
3. **The route summary and ₹/person.** Already on the page. The cost number is the hook.

### 8.2 copy→pay

1. **Specificity of the locked promise.** *"Stay contacts, timings and budget breakdown"* is
   already specific **[MEASURED]**. Do not weaken it into "full access".
2. **The blurred teaser.** Showing the first 3 stops blurred is the right instinct; the number of
   teaser stops is a testable variable.
3. **Trust at the moment of payment.** The app's whole positioning is honesty. The checkout must
   carry the same voice: what you get, what you do not, and when a refund is possible.
4. **Price.** Test ₹149 against ₹199 **only after** a baseline exists.

### 8.3 Experiments worth running, in order

| # | Test | Metric |
|---|---|---|
| 1 | OG preview on / off | view→copy |
| 2 | 1 vs 2 free days | copy→pay |
| 3 | 3 vs 5 teaser stops | copy→pay |
| 4 | ₹149 vs ₹199 | revenue per view |
| 5 | Subscription vs per-trip | month-2 retention |

---

## 9. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Locked content is publicly readable** — proven live: 7 locked days / 20 stops returned to an unauthenticated client | **Critical** | Redacting RPC + narrowed RLS, before the first sale |
| 2 | **Audience is zero** — the model's dominant variable | **High** | Stage 0 measurement, then distribution before monetisation |
| 3 | **Merchant-of-record chosen by accident** | **High** | CA decision in Stage 0; costs ~₹27/sale |
| 4 | **Creator supply never starts** | High | Seed the first 20 itineraries as platform-authored |
| 5 | **Subscription churn** — episodic use vs monthly billing | Medium | Per-trip option; pause instead of cancel |
| 6 | **Refund abuse** | Medium | Pre-purchase description + stated policy |
| 7 | **Token cost blowout** once the companion is an LLM | Medium | The 10× rule; measure before pricing |
| 8 | **GST/TDS misregistration** | Medium | CA before the first sale |
| 9 | **Payout KYC is a product surface nobody built** | Medium | Scope it in Stage 2, not after the first sale |
| 10 | **Refund handling absent from the payout model** | Medium | Negative lines in the next payout |

---

## 10. What would prove this plan wrong

Stated in advance, so it cannot be rationalised later.

| If this is true | Then |
|---|---|
| view→copy stays under 2% after the preview fix | The itinerary is not the shareable unit. Change the artifact. |
| copy→pay under 2% at ₹199 | Content is not worth paying for at this price. Test ₹49 or drop Product A. |
| Median subscriber token cost > 20% of price | The subscription packaging is wrong. Fix it before acquiring. |
| Month-2 subscriber retention under 40% | The use case is too episodic for a subscription. Go per-trip. |
| Manual partner pilot produces no repeat bookings | The marketplace thesis is wrong. Stage 4 is cancelled, not delayed. |

---

## 11. Decisions required now

| # | Decision | Why it blocks | Needed by |
|---|---|---|---|
| 1 | Merchant of record: Branch 1 or 2 (§4.2) | Changes creator payout ~₹27/sale | Stage 0, with a CA |
| 2 | ~~Platform fee: confirm 15%~~ — **DECIDED 2026-09-21**: 15% marginal to ₹25,000 of lifetime gross, then 10% (I-13) | Sets `PLATFORM_FEE_TIERS` | Stage 0 |
| 3 | Subscription price: ₹99 vs ₹149 | Sets the primary SKU | Stage 3 |
| 4 | Free-day policy default | Drives copy→pay | Stage 2 |
| 5 | Re-publication policy for unlocked content | The leak | **Before Stage 2 launch** |
| 5b | Redacting read path + narrowed RLS | Without it the unlock sells nothing | **Before the first sale — blocks Stage 2** |
| 6 | Refund policy wording | Legal + abuse | Before the first sale |
| 7 | Do subscribers get unlock allowances? | Liability design | Stage 3 |

---

## 12. The one-page summary

1. **The paywall is already built** — prices chosen, free-day index, blurred teaser, two CTAs,
   fork degradation, ledger, fee seam. Only the rail is missing. Stage 2 is cheap.
2. **Net platform revenue per ₹199 unlock is ₹25.30, not ₹199.** The floor is ~3.86% before the
   platform earns anything.
3. **Structure as an intermediary, not merchant of record** — the difference is ~₹27 per sale to
   the creator, more than the platform fee itself. Confirm with a CA.
4. **Unlocks cannot carry the business.** ₹5 Lakhs/month needs 3.3–8.2 million views. The gallery
   currently has 3.
5. **Subscriptions can.** ₹5 Lakhs/month needs ~5,000 subscribers; infrastructure break-even
   needs **101**.
6. **The companion is deterministic today and worth little as a paid tier.** Its value arrives
   with the documented LLM upgrade — and so does its cost. Apply the 10× rule.
7. **The dominant unknown is audience, and it is measurable this week for free.**
8. **The lock exists now** (v0.61.0). The audit this item was written from proved the opposite
   against production: the locked days *were* readable by an unauthenticated client — 7 locked
   days and 20 stops across both live premium publications. The redacting read path it demanded
   became **item zero of M7** and shipped, and the fee model followed (I-13). What is still not
   there is the money out: no `payouts` table, no KYC.
