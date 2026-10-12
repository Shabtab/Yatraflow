# YatraFlow — Operating Report v3.0

> ⚠️ **HISTORICAL (2026-10-12).** [`STRATEGY.md`](STRATEGY.md) replaces this doc's position, sequence and targets. Read this doc for its detail only.

**Status date:** 2026-09-15 · **Product:** `v0.54.0` (`main` = `6940e44`) · **Revenue to date:** ₹0

---

## 0. How to read this document

The previous version of this report (v2.0) stated ₹2.05 Crores of Year 1 revenue, a ₹126
Billion TAM, a ₹1,872 LTV and a 12.5:1 LTV:CAC ratio. None of those numbers could be traced
to anything. Seven of the twelve database tables it described did not exist, and one feature
it listed as shipped — a WhatsApp invite system — has never appeared anywhere in the
repository.

This version fixes that by labelling every figure with how it is known:

| Tag | Meaning |
|---|---|
| **[MEASURED]** | Read out of the repository or a public API on 2026-09-15. Reproducible. |
| **[DERIVED]** | Arithmetic on measured values. The formula is shown. |
| **[ASSUMPTION]** | A stated guess. Changing it changes the answer, so it is isolated. |
| **[UNKNOWN]** | We do not know. Named, with the way to find out. |
| **[DECISION]** | A choice the founder has to make. Not a fact to be discovered. |

There is no fifth category, and nothing in this document is presented as a fact that is not
**[MEASURED]** or **[DERIVED]**. That is not pedantry — it is the same rule the product
already holds itself to. The README says *"No fake live traffic or prices — ever"*, and
`src/lib/earnings.ts` labels the creator payout view *"never money"*. A business plan that
breaks that rule is arguing against its own product.

**What this document does not contain:** a TAM. Section 3 explains why, and what to use
instead.

---

## 1. Status at a glance

| | |
|---|---|
| Version | `v0.54.0` **[MEASURED]** — `package.json`, `git describe`, `main` = `6940e44` |
| Age | **20 days** **[MEASURED]** — repo created 2026-08-26, last push 2026-09-15 |
| Releases | **11** published GitHub Releases; **13** git tags; changelog documents **15** version sections from `v0.42.0` (Sep 7) to `v0.54.0` (Sep 15) **[MEASURED]** |
| Open issues | **0** **[MEASURED]** — GitHub API, 2026-09-15 |
| Stars / forks | **1 / 1** **[MEASURED]** — GitHub API, 2026-09-15 |
| Live | `yatraflow-blond.vercel.app` → HTTP 200 **[MEASURED]** |
| Test files | 92 **[MEASURED]** |
| Database tables in use | 9 **[MEASURED]** — every `.from('…')` call in `src/` |
| Revenue | **₹0** **[MEASURED]** — no payment integration exists |
| Users | **[UNKNOWN]** — no analytics backend, no data in the repo |

Two things follow immediately, and both should shape everything below.

**The project is 20 days old and has no distribution.** Not "behind plan" — the plan in v2.0
described a stage the project has never entered. There has been no public launch, and one
GitHub star is the whole external audience.

**The product is in far better shape than the age suggests.** The version counter reached
`v0.54.0` in 20 days, 92 test
files, a completed 117/117 accessibility audit, and ratcheted design-system gates that fail CI
on regressions. That is not normal for a 20-day-old project, and it is the actual asset.

---

## 2. What exists today

### 2.1 The product

A collaborative India-first trip planner. Not a marketplace — the app says so on screen:
*"costs are transparent estimates · No bookings, no payments — planning only"* **[MEASURED]**.

What ships at `v0.54.0` **[MEASURED]**, verified by reading `src/`:

- Multi-day itinerary builder with cross-day drag-and-drop, a time rail, and a day planner engine
- Real-time multi-user collaboration over Supabase subscriptions
- A fatigue-aware ride plan with an **enforced** detour budget and a "road personality" model
  (`detourBudget.ts`, `ridePlan.ts`, `roadPersonality.ts`)
- A transparent budget engine pricing fuel, food and stays, with a per-day safe-to-spend figure
- Keyless MapLibre maps on OpenFreeMap; weather on Open-Meteo; routing on the OSRM demo server
- Group voting, decision polls, suggestion threads, notifications, activity feed
- Publish-to-Explore gallery, a **creator hub** with a publications manager, and a fork flow
- Invite short codes and a join flow (R1/R2 of the invites plan have shipped)

### 2.2 The data model

Nine tables, read from the client: `profiles · trips · trip_members · suggestions · decisions ·
notifications · activity · published_itineraries · admin_audit` **[MEASURED]**.

The `Trip` type is worth dwelling on, because it is where the product's real knowledge lives:

| Field | Why it exists (from the source comments) |
|---|---|
| `driverCount` | Licensed drivers rotating the wheel — 2 buys the day real hours |
| `hasVulnerable` | Infants or seniors aboard — shorter honest days, earlier dinner |
| `driveAfterDinnerMin` | Minutes of legal driving after the dinner halt |
| `fuelEconomyKmL` | User-stated economy, so fuel ₹/km beats a blended table |
| `fuelPricePerL` | *"pump prices vary ~₹94–110/L across states, so this beats averages"* |

**[MEASURED]** — all five. No competitor's schema looks like this, and none of it appears in
the previous report.

### 2.3 The monetisation surface is already built, and switched off

This is the single most important commercial fact about the project, and v2.0 missed it.

| Asset | State |
|---|---|
| Premium itinerary prices | **Already chosen** — ₹149, ₹199, ₹249, ₹499 in seed data **[MEASURED]** |
| `premiumPriceInr` on the publication type | Ships **[MEASURED]** — commented *"placeholder for future payments"* |
| Creator hub: publications manager, stats, unpublish | **Shipped** `v0.37.0`/`v0.38.0` **[MEASURED]** |
| Earnings ledger with its **final** column shape | **Shipped** — Payout period · Sales · Platform fee · Net payout **[MEASURED]** |
| `projectEarnings()` projection view | Ships, labelled *"never money"* **[MEASURED]** |
| `PROJECTED_PLATFORM_FEE_INR` | `= 0` — *"the seam where the real fee model plugs in"* **[MEASURED]** |
| AI companion | **Fully implemented, flag-gated off** for *"the premium packaging milestone"* **[MEASURED]** |
| Admin funnel: activation, collab, publish, **view→copy** | **Already computes** (`computeFunnel()`) **[MEASURED]** |
| `docs/ARCHITECTURE.md` §"Creator earnings contract (M7)" | **Specifies the exact schema M7 must add** **[MEASURED]** |

So the plan is not "build a marketplace". It is **connect a payment rail to a seam that was
designed for it three releases ago.** M7's own contract already names the tables:
`sale_events`, `payouts`, an entitlements/unlocks table, payout/KYC fields on `profiles`,
Razorpay order/payment ids and a webhook log with idempotency keys.

### 2.4 What is actually differentiated

1. **The app refuses to fake a route.** When the routing facade falls back to straight-line
   estimates, an all-estimate chain is reported as *unresolved* rather than drawn as if it
   were a road **[MEASURED]** — the UI says so instead of drawing chords.
2. **Every estimate states its assumptions on screen** **[MEASURED]**.
3. **Engineering discipline.** 92 test files; four ratcheted design-system gates (contrast,
   duplicate selectors, motion vocabulary, hue separation); a completed 117/117 accessibility
   audit; a changelog that every push must update.

(1) and (2) are a positioning wedge in a category where competitors show estimates as facts.
(3) is credibility, not a moat — but it is why the numbers in this document can be trusted.

### 2.5 The honest weaknesses

- **No distribution.** 1 star, no launch, no audience. This is the binding constraint on
  everything in section 5.
- **No payments, no entitlements, no analytics backend.** All three are prerequisites for
  revenue, and none exists.
- **A roadmap note that is wrong, in the safe direction.** The roadmap records an open
  *"M0 seed guard"* defect — demo trips seeded into a real account after a flaky sign-in.
  **The code already implements the guard.** `tripCountUnknown` is set whenever the
  memberships read fails, and the seed is skipped unless the trip count is trustworthy
  (`store.ts:630`, issue `#94`, with the reasoning in the comment at `store.ts:461`)
  **[MEASURED]**. This is documentation drift, not a live defect, and it does **not** block
  charging. Corrected here after reading the code — the roadmap's prose was not a source.
- **Nothing shareable, and nothing that previews.** See §2.6.
- **The repo's own docs drift.** The roadmap says six open issues; the API returns zero, hours
  later. Minor, but it means the docs are not a reliable status source — the code and the API are.

### 2.6 The distribution blocker: nothing to share, and nothing that previews

Measured against the live deployment on 2026-09-15 by loading it in a real browser.

**The front door is good.** The landing page renders with a clean console — **0 errors, 0
warnings** — a real product screenshot, a no-signup "price a trip in 10 seconds" boarding-pass
widget, and a trip-code join box **[MEASURED]**.

**The shop behind it is empty.** `#/explore` contains **one** published itinerary:
*"Spiti Valley Circuit — Shimla in, Manali out (copy)"* — a duplicate from the publish path,
with **3 views and 2 forks**, and an author name that renders as `Has9.🎓` **[MEASURED,
screenshot]**. The page's own hero reads *"Real multi-day plans from travellers who actually
went"* — a claim one copied test trip cannot support.

**And a shared link previews as nothing at all.** There are **no Open Graph tags** in
`index.html` — no `og:title`, `og:description`, `og:image` or `twitter:card` — and
`document.title` is never set dynamically anywhere in `src/` **[MEASURED]**. The app uses
**hash routing** (`location.hash` / `hashchange` in `App.tsx`), so every route serves the same
`/` document to a crawler **[MEASURED]**.

The consequence is specific and severe for this product: **pasting a YatraFlow itinerary into
WhatsApp produces a bare URL with no title, no description and no image.** WhatsApp is the
channel the entire product is positioned against — the README's own framing is *"Plan Indian
trips together — not in a chaotic group chat."* The app can generate a share link
(`navigator.share` in `native.ts`), and the link carries nothing.

This is the highest-leverage defect in the project, and it is cheap to fix relative to what it
unlocks.

---

## 3. Market — and why this report will not give you a TAM

v2.0 cited *"$60.87 Billion in 2026, growing to $126.01 Billion by 2034 at 9.2% CAGR"* for the
India online travel market. That figure is traceable to an IMARC release. The problem is what
happens when you check it against other vendors for **the same year**:

| Source | India online travel market, 2026 |
|---|---|
| IMARC (as cited by v2.0) | **$60.87 Bn** |
| MarkWide Research | **$28.6 Bn** |
| Mordor Intelligence | **$25.38 Bn** |

A **2.6× spread** between commercial vendors for the same market and the same year. v2.0
picked the largest and treated it as fact.

This is not an argument that the market is small. It is an argument that **vendor market
sizing in this category cannot carry a business plan**, and that a plan built on it inherits
the unreliability. The previous report's ₹2.05 Cr Year 1 revenue was, in effect, a share of a
number that might be less than half what it claimed.

**What to use instead — three things, in this order:**

1. **Primary data, not vendor press releases.** The Ministry of Tourism publishes actual
   domestic visitor numbers at `data.tourism.gov.in`. Slower and less quotable than a TAM, and
   it is the only figure in this space that survives diligence.
2. **Bottom-up from your own funnel.** You already compute activation, collaboration,
   publication and view→copy rates (`computeFunnel()`). A bottom-up model built on measured
   funnel data is defensible in a way a TAM never is, because it is falsifiable and you own it.
3. **A named competitor set, sized by observation.** For positioning, not for arithmetic.

**[UNKNOWN] — and required before any market claim goes in front of an investor:** the
Ministry of Tourism domestic-visitor figure for the most recent published year, the number of
Indian households that take at least one self-drive trip a year, and the average trip spend.
Each has a named primary source. None of them is in this document, because none of them has
been fetched yet, and an invented one is worse than a gap.

---

## 4. Unit economics — the levers, and which ones we actually know

Built from constants that exist in the code, so the model can be checked.

| Lever | Value | Status |
|---|---|---|
| Premium itinerary price points | ₹149 / ₹199 / ₹249 / ₹499 | **[MEASURED]** — seed data |
| Blended unlock price used below | **₹199** | **[ASSUMPTION]** — the modal seed price |
| Platform fee | **0 today** | **[MEASURED]** — `PROJECTED_PLATFORM_FEE_INR = 0` |
| Payment processing floor | **~2–3%** | **[DERIVED]** — Razorpay card fee + GST; a fee below this is net-negative |
| Lodging rates (for the trip estimate) | ₹1,200 / ₹3,200 / ₹8,000 per room-night | **[MEASURED]** — `rates.ts` |
| Indicative fuel price | ₹94–110 / litre | **[MEASURED]** — source comment |
| Views on published itineraries | **unknown** | **[UNKNOWN]** |
| view→copy rate | **computable today, never recorded** | **[UNKNOWN → measure in Stage 0]** |
| copy→pay rate | **does not exist** | **[UNKNOWN → the key Stage 2 unknown]** |
| Paying subscribers | **0** | **[MEASURED]** |

Two levers are real numbers. The three that decide whether this business works are all
unknown — and two of them are measurable **today**, for free, before a single line of payment
code is written. That is what Stage 0 is for.

---

## 5. The monetisation plan

### The shape of it

Monetisation is **five stages, entered only through a gate**. Each stage has a purpose, a
build, a cost, a revenue mechanism, a gate to advance, and a kill criterion. No stage is
scheduled by calendar — each is scheduled by the evidence the previous one produced. This is
deliberate: the repository already works this way (its own roadmap places monetisation at M7,
*behind* M5 and M6), and a calendar plan is how v2.0 ended up claiming Year 1 revenue from
features three milestones away.

```
Stage 0  Instrument          now          ₹0 revenue   gate: 4 weeks of funnel data
Stage 1  Prove demand        M5           ₹0 revenue   gate: retention + view→copy
Stage 2  First rupee         M7           unlocks + subscription
Stage 3  Invite gate / 1.0   M9 R3 + M8   subscription-led
Stage 4  Marketplace         post-1.0     commissions
Stage 5  B2B                 post-1.0     licences
```

---

### Stage 0 — Instrument and stabilise · *now* · ₹0

**Purpose.** You cannot price what you cannot measure, and you must not charge on top of a
known account-integrity defect.

**Steps**

1. **Clean the public gallery.** Unpublish the duplicate `(copy)` rows and fix the author
   display name. The unpublish owner gate, `dedupePublished()` and the stale-page nudge all
   ship **[MEASURED]** — this is curation, not code. See §2.6 and the launch plan.
2. **Turn the funnel on.** `computeFunnel()` already returns `activationPct`, `collabPct`,
   `publishPct` and `viewToCopyPct`. Surface it in the admin console and record a weekly
   baseline. No new instrumentation is needed — the numbers exist and are not being kept.
3. **Start recording the three unknowns.** Weekly active trips, view→copy %, and creator supply
   count. Without these, every revenue figure below is fiction.
4. **Decide the fee model shape** — flat, tiered, or basis points. `PROJECTED_PLATFORM_FEE_INR`
   is the seam, and the ledger's column set already anticipates a per-sale fee. **[MEASURED]**
5. **Decide the AI companion's packaging** — subscription, one-off, or bundled into a trip.
   The feature is built and gated; only the decision is missing. **[MEASURED]**

**Cost:** founder time. Infrastructure is on free tiers today; the actual invoices are
**[UNKNOWN]** and should be recorded here once known.
**Revenue:** ₹0. Explicitly and deliberately.
**Gate to advance:** four consecutive weeks of funnel data, and a curated public gallery (§2.6).

---

### Stage 1 — Prove demand · *M5 (AI companion)* · ₹0

**Purpose.** Prove that people return and that the engine produces trips worth paying for —
*before* building a payment rail. If demand is not there, the correct outcome is to not build
M7 at all.

**Steps**

1. **Ship M5 to the free tier first.** The AI companion is fully implemented and flag-gated
   (`VITE_AI_COMPANION`). Release it free and measure whether it moves retention. Retention is
   the input to willingness to pay; a paywall on a feature nobody misses earns nothing.
2. **Instrument trip creation per user and return visits**, so week-4 retention becomes a
   tracked number rather than an opinion.
3. **Set the Stage 2 thresholds now, before measuring.** Writing the pass mark after seeing the
   result is how a metric becomes a story.
4. **Publish 10–20 reference itineraries** through the creator flow that already ships. This
   builds the supply side that Stage 2 sells — and it costs nothing but the founder's time,
   because the publishing, fork and gallery surfaces are all live.
5. **Do qualitative price research with the existing cohort** — they are reachable through the
   invite system. Treat it as directional, not as a survey.

**Cost:** founder time, plus LLM API usage for the companion (per-user token budget is the
constraint — **[UNKNOWN]**, needs a number).
**Revenue:** ₹0.
**Gate to advance:** view→copy on free publications above the pre-set threshold, creator supply
≥ the pre-set count, and week-4 trip retention ≥ the pre-set rate.
**Kill criterion:** if week-4 retention is flat and view→copy is near zero, the problem is the
product, not the pricing. **Do not build M7.** Return to M6.

---

### Stage 2 — The first rupee · *M7 "Premium"* · unlocks + subscription

**Purpose.** Convert proven demand into revenue with the smallest possible build. This is the
only stage where the plan is genuinely cheap, because the surface was designed for it.

**Steps — the build, straight from the existing M7 contract [MEASURED]**

1. **Migration.** `sale_events` (id, pub_id, buyer, amount_inr, price snapshot, status
   created/paid/refunded, created_at), `payouts` (creator, period, gross, fees, net, status,
   UTR reference), an **entitlements/unlocks table** so premium gating survives across devices,
   and payout-account/KYC fields on `profiles`.
2. **Razorpay.** Order creation, webhooks with **idempotency keys**, and a working refund path.
3. **Set the real fee model** — replace `PROJECTED_PLATFORM_FEE_INR = 0`. It must clear the
   ~2–3% processing floor before it earns anything.
4. **Switch on premium unlocks** on published itineraries. Prices already exist: ₹149–₹499.
5. **Package the AI companion.** It is built, gated, and currently unpriced.
6. **GST/TCS handling.** Required for digital sales in India, and absent from every previous
   version of this report. This is not optional and it is not a one-line change.

**Revenue mechanisms**

- **A — creator itinerary unlocks.** Price ₹149–₹499 **[MEASURED]**; platform fee *f* **[DECISION]**.
  Revenue = `views × view→copy × copy→pay × price × f`
- **B — AI companion.** Price **[DECISION]**; the feature already exists.

**Which one to lead with — this is the decision the arithmetic makes for you.**

Holding views at an illustrative 50,000/month, price at ₹199 and fee at 30%:

| view→copy ↓ / copy→pay → | 2% | 5% | 10% |
|---|---|---|---|
| **1%** | ₹597 | ₹1,492 | ₹2,985 |
| **3%** | ₹1,791 | ₹4,478 | ₹8,955 |
| **6%** | ₹3,582 | ₹8,955 | ₹17,910 |

**[DERIVED]** — monthly platform revenue in ₹, at 50k views, ₹199, 30% fee.

Even at generous conversion, unlocks alone produce **₹0.6k–₹18k per month**. Now invert it —
what does it take to reach ₹5 Lakhs/month from unlocks alone?

```
₹5,00,000 ÷ (₹199 × 30%) = 8,375 unlocks/month
At 3% view→copy and 5% copy→pay  →  ~5,580,000 views/month
At 6% view→copy and 10% copy→pay →  ~1,400,000 views/month
```

**[DERIVED]** — **You need 1.4–5.6 million itinerary views per month** to reach ₹5 Lakhs/month
on unlocks alone.

By contrast, ₹5 Lakhs/month from subscriptions at ₹149 needs **~3,350 paying subscribers**.

**Conclusion:** the binding constraint is **distribution, not conversion**. Optimising
view→copy from 3% to 6% doubles a small number; it does not change the shape of the business.
The creator-unlock model is a **supplement**, and the **subscription is the primary SKU**. The
previous report inverted this — it built 100% of Year 1 revenue on commissions and ads, the two
mechanisms that need the most infrastructure and the most audience.

**Cost:** founder time for the rail; Razorpay's processing fee is variable and taken from the
sale, not from runway.
**Gate to advance:** at least one creator has received a **real payout**, and there is evidence
of repeat purchase.
**Kill criterion:** if fewer than a pre-set number of paid unlocks occur in the first 60 days at
the seeded price points, the content marketplace is not the wedge. Revert to
subscription-only and stop investing in the unlock flow.

---

### Stage 3 — Invite gate and the 1.0 cut · *M9 R3 + M8* · subscription-led

**Purpose.** Convert the subscription into the default model, and remove the two barriers that
cap distribution.

**Steps**

1. **Turn on `VITE_INVITE_ONLY` (R3) — but only if it earns its keep.** The repo's own plan
   says R3 *"may be deferred indefinitely — that is a valid end state"* **[MEASURED]**. An
   invite gate protects quality and destroys growth. Do not turn it on because it is built.
2. **Ship 1.0: offline-first/PWA and i18n (EN + HI)** **[MEASURED — the repo's own 1.0 scope]**.
   Hindi is a distribution unlock for the road-trip segment outside the metros, not a feature.
   This is the highest-leverage item in Stage 3.
3. **Make subscription the default SKU**, with unlocks as an attach.

**Cost:** founder time; i18n is a real translation cost **[UNKNOWN]**.
**Revenue:** subscription-led.
**Gate to advance:** a **measured** — not assumed — CAC from organic channels, and a repeatable
monthly subscriber count.

---

### Stage 4 — Marketplace · *post-1.0* · commissions

**Purpose.** The marketplace the previous report led with. It belongs here, not at the front,
because it is a **supply-operations business**, not a software feature.

**Steps**

1. Run a **manual** partner pilot — 5–10 drivers or homestays, onboarded by hand, no code.
2. Measure whether manual onboarding produces repeat bookings. If it does not, stop.
3. Only then build partner verification, onboarding, payouts, dispute handling and insurance.

**The mistake not to repeat.** v2.0 budgeted ₹1,500 of CAC per driver, and **no headcount at
all**, for a stage requiring field operations, verification and payouts. Marketplace revenue is
earned by people talking to drivers, and that cost appears nowhere in the previous model.

**Gate to enter:** Stages 2–3 show repeat paid demand, **and** the manual pilot converts.
**Kill criterion:** if the hand-onboarded pilot does not produce repeat bookings, the
marketplace thesis is wrong. That is a cheap experiment and it should be run before any build.

---

### Stage 5 — B2B licences · *post-1.0*

White-label itinerary building for travel agents. Requires a stable 1.0, an API surface, and
support capacity. Not a plan for the next twelve months; listed so the ladder is complete.

---

## 6. Financial model

The model is **staged, not calendarised**. Revenue is ₹0 until Stage 2's gate is passed, and
each stage's cost is bounded by the stage before it. This is the structural change from v2.0,
which showed a ₹14.60 Lakh net profit in Year 1 for a product with no payment mechanism.

| | Stage 0 | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|---|---|---|---|---|---|
| Revenue | ₹0 | ₹0 | unlocks + subs | subscription-led | + commissions |
| Cost driver | time | time + LLM tokens | time + processing | time + i18n | **headcount** |
| Headcount | 1 | 1 | 1 | 1–2 | 3+ |
| Gate out | 4 weeks of data | retention + view→copy | real payout + repeat | measured CAC | pilot converts |

**Every financial assumption, listed so each can be attacked individually:**

| # | Assumption | Value | Tag |
|---|---|---|---|
| 1 | Blended unlock price | ₹199 | **[ASSUMPTION]** |
| 2 | Platform fee | 30% | **[ASSUMPTION]** — must clear a ~2–3% floor |
| 3 | AI companion price | not set | **[DECISION]** |
| 4 | Monthly itinerary views | 50,000 (illustrative) | **[UNKNOWN]** |
| 5 | view→copy | 1–6% | **[UNKNOWN — measurable in Stage 0]** |
| 6 | copy→pay | 2–10% | **[UNKNOWN]** |
| 7 | Subscribers at maturity | — | **[UNKNOWN]** |
| 8 | Infrastructure cost | free tiers today; invoices not recorded | **[UNKNOWN]** |
| 9 | Funding | not modelled — no raise is assumed, and none is planned in this document | **[DECISION]** |

Assumptions 4–7 are the entire business, and **five of the seven are unknown**. That is the
honest state of affairs. The value of this document is not that it predicts them — it is that
it names them, and Stage 0 is designed to replace three of them with measurements for free.

**What would make this model worth funding is not a bigger number. It is a smaller number that
is real.** Three hundred paying subscribers and a 4% view→copy rate, measured, is a fundable
position. Fifty thousand users projected from nothing is not.

---

## 7. Risks

| # | Risk | Why it matters | Mitigation |
|---|---|---|---|
| 1 | **No distribution** | The binding constraint. Every revenue figure scales with views, and there are none. | Stage 1's job is distribution, not features. Hindi + PWA in Stage 3. |
| 2 | **Shared links preview as nothing** | No OG tags, hash routing, no dynamic title. In WhatsApp — the channel the product is positioned against — a share is a bare URL. | Add OG metadata + prerender the public itinerary route. Cheapest high-impact fix available. |
| 3 | **Subscription fatigue in the Indian consumer market** | Willingness to pay for a planning tool is unproven at any price. | Qualitative research in Stage 1; price test in Stage 2; kill criterion. |
| 4 | **Marketplace economics need field ops** | The previous plan priced this at ₹1,500 CAC and zero headcount. | Manual pilot before any build; kill criterion. |
| 5 | **GST/TCS compliance** | Digital sales in India carry tax obligations the previous plan never mentioned. | Scope it in Stage 2, before the first sale. |
| 6 | **Single-founder bus factor** | 1.5 FTE, version `0.54.0` in 20 days. Impressive, and fragile. | Document as the repo already does; do not add a marketplace on top of it. |
| 7 | **Vendor market data is unreliable** | A 2.6× spread between vendors makes any TAM-based plan unfalsifiable. | Use primary data and your own funnel (section 3). |
| 8 | **Roadmap drift** | The roadmap said six open issues; the API said zero, hours later. | Treat code and the API as truth; docs as intent. |

---

## 8. What we do not know

Each of these is a real gap, not a rhetorical one, and each has a named way to close it.

| Unknown | How to close it | Cost |
|---|---|---|
| view→copy rate | `computeFunnel()` — already implemented, needs recording | free |
| Weekly active trips | Same funnel, recorded weekly | free |
| Creator supply | Count publications in `published_itineraries` | free |
| Monthly itinerary views | Same | free |
| copy→pay | Only exists once Stage 2 ships | Stage 2 |
| Infrastructure invoices | Read the actual Supabase/Vercel bills | free |
| LLM cost per user for the companion | Token accounting in Stage 1 | free |
| India domestic visitor numbers | Ministry of Tourism, `data.tourism.gov.in` | research time |
| Willingness to pay | Qualitative research in Stage 1, price test in Stage 2 | time |
| CAC by channel | Requires a channel to exist first — Stage 1–3 | time |

**Three of these are free and can be closed this week.** They are the three that matter most.

---

## 9. Milestone ↔ monetisation map

| Repo milestone | State | Monetisation stage | What it unlocks commercially |
|---|---|---|---|
| M0–M4 stabilisation | ✅ landed | — | Credibility |
| M0 defect — seed guard | ✅ **already implemented** (`#94`, `store.ts:630`) | — | Roadmap note is stale |
| M5 — AI companion | next | **Stage 1** | Retention evidence; a future paid perk |
| M6 — Together | — | Stage 1 | Collaboration depth → group willingness to pay |
| M7 — Premium | — | **Stage 2** | **The first rupee** |
| M9 R3 — invite gate | built, gated | Stage 3 | Quality control, if it earns its keep |
| M8 — 1.0 (PWA, i18n EN+HI) | — | Stage 3 | Distribution |
| — | — | Stage 4 | Marketplace, by manual pilot |
| — | — | Stage 5 | B2B licences |

---

## 10. The one-page version

1. **The product is real and unusually well built** — `v0.54.0`, 20 days old, 92 test files, a
   completed accessibility audit, and a planning engine that encodes domain knowledge no
   competitor's schema contains.
2. **It has no distribution and no revenue**, and those are the only two facts that matter
   commercially right now.
3. **The monetisation surface already exists and is switched off.** Prices are chosen
   (₹149–₹499), the creator hub and its ledger ship, the AI perk is built and flag-gated, and
   `ARCHITECTURE.md` already specifies the exact schema M7 needs. This is the cheapest
   monetisation build available to any product at this stage.
4. **Lead with subscription, not commissions.** Unlocks alone need 1.4–5.6 million views a
   month to reach ₹5 Lakhs; subscriptions need ~3,350 people. The previous plan bet entirely on
   the former.
5. **Stage the plan on evidence, not on the calendar.** Four weeks of funnel data and a
   one-file bug fix come first — and three of the numbers the whole model depends on can be
   measured this week, for free.
6. **Fix the share preview before driving a single visitor.** No OG tags plus hash routing means
   a YatraFlow link pasted into WhatsApp is a bare URL — in the one channel this product is built
   to replace.
7. **Delete the TAM.** A 2.6× spread between vendors means it cannot carry a plan. Use the
   Ministry of Tourism and your own funnel instead.
