# YatraFlow — Step 0: Ratified Commercial Decisions

> **2026-10-12:** [`STRATEGY.md`](STRATEGY.md) sets the current position and order of work. Where the two disagree, `STRATEGY.md` wins.

**Date:** 2026-09-16 · **Status:** D1 RATIFIED by founder 2026-09-16; D2/D3 open ·
**Supersedes:** the fee/subscription [DECISION]s left open in the source docs

This file records the Step 0 outcomes so every threshold and gate downstream is denominated
in settled numbers. Source docs (same folder): `REPORT-2026-09-15-strategy-and-position.md`
(the why), `PLAN-MONETISATION.md` (the money), `PLAN-LAUNCH-AND-DISTRIBUTION.md` (the
go-to-market), `PLAN-COMMERCIAL-EXECUTION.md` (the queues). Rule: thresholds are immutable
once set — changing a pass mark after measuring needs a written rationale, or
evidence-gating collapses.

---

## D1 · Platform fee: 15% flat → 10% above a lifetime-GMV threshold — RATIFIED 2026-09-16

Per-₹199-sale arithmetic, Branch 1 (intermediary), Razorpay 2% + 18% GST on fee [DERIVED]:

| Fee | Platform net | Creator net (share of ₹199) |
|---|---|---|
| 10% | ₹16.86 | ₹171.41 (86.1%) |
| 12% | ₹20.24 | ₹167.43 (84.1%) |
| **15%** | **₹25.30** | **₹161.47 (81.1%)** |
| 20% | ₹33.73 | ₹151.51 (76.1%) |
| 30% | ₹50.59 | ₹131.61 (66.1%) |

Reasoning: creator net stays above 80% up to ~16.1% fee, so 15% keeps the "you keep
four-fifths" line; 30% leaves creators ~66% against a Topmate-shaped norm. Since creator
supply is the binding constraint on unlocks (source: monetisation §9 risk 4), the fee
optimises for supply, not per-sale take. The 30% tables in the strategy report are internally
consistent but describe a different business — views needed for ₹5L/month at mid funnel
(4% view→copy × 6% pay): 15% → ~8.2M views; 30% → ~4.1M. Both are millions against 3
gallery views; the extra ₹25/sale is irrelevant if supply never starts.
Tier-down to 10% costs nothing until creators already earn — set the GMV threshold once real
GMV exists, not now.
Open: confirm Topmate's current pricing page before citing the benchmark externally (not
independently verified); confirm with CA whether Razorpay returns TDR on refunded sales
(typically no — each refund then costs ~₹4.70 on zero revenue, the teeth behind
no-refund-after-view).

## D2 · Subscription price: ₹99/month + ₹49/trip in parallel — RECOMMENDED, open

₹99 stays impulse-scale for an episodic use case in a subscription-fatigued market; ₹149
crosses a psychological line for "why am I paying in a month I'm not travelling". Rough
token costing on a cheap LLM (~₹0.09/query) gives the 10× rule ~110 median queries/month of
headroom at ₹99 — measure per-query cost in Stage 1 regardless (only variable cost in the
business). Infra break-even: 101 subs @ ₹99 (vs 67 @ ₹149) — against a ~₹10k/month infra
assumption that Stage 0 must replace with real Supabase/Vercel invoices. Keep ₹149 as dry
powder: raise only after retention is measured, never before.

## D3 · Merchant of record: Branch 1 (intermediary) — RECOMMENDED, needs CA

Branch 2 costs the creator ~₹27/sale (₹134.10 vs ₹161.47 net at 15%) — more than the
platform fee itself. Must be confirmed with a chartered accountant before the first sale,
with GST/TDS registration scoped at Stage 2 entry.

## D4 · One instrumented funnel (reconciles launch gates vs `computeFunnel()`)

Launch signals (primary, weekly): shares → views → forks → completed signups → 2nd session.
`computeFunnel()` (`src/lib/adminStats.ts:83-114`, inputs live via `bump_published_stats`,
`store.ts:2208-2220`, admin tiles at `AdminPage.tsx:377-378,424`) covers
activation/collab/publish/viewToCopy + raw views/copies as product-health secondary.
E3 scope: add the 3 missing tiles, a share-event counter on the native share path
(`src/lib/native.ts:75-78,111-114`, via the `nav` alias), and attribution refs (invite-code
shape — pre-verify reuse in Step 2). Thresholds anchor to seed-demo-pub-free Stage 0 data
only: the seed pubs show 4–9% copy rates but are placeholders, not baseline.

## D5 · Thresholds (all [ASSUMPTION] until measured — write into tracking issue pre-E3)

| Gate | Pass | Fail → |
|---|---|---|
| Shares→views | ≥20% (1 view per 5 sends) | share unit / preview |
| Views→forks (viewToCopyPct) | ≥3% | content / anonymous CTA; <2% sustained = artifact is wrong |
| Fork-CTA→completed signup | ≥40% (fork already gates login; measures gate friction) | signup step |
| Week-4 retention | ≥25% | <15% = product problem, back to M6 |
| Stage 0 exit | 4 consecutive weeks data + 0-dupe gallery with ≥3 real pubs + CA-confirmed Branch 1 | keep measuring (never kills) |
| Stage 1→2 | view→copy ≥3% + supply ≥20 real pubs + retention ≥25% | do not build M7 |
| Stage 2 (60d) | ≥50 paid unlocks + ≥1 real creator payout + repeat-purchase evidence | revert to subscription-only |
| Stage 3 | measured CAC + repeatable subs; median token ≤20% of price | fix packaging first |

50 unlocks/60d is a *signal* threshold (proves rail + payout + repeat), not a business —
the base case implies ~240.

## D6 · Added risks (from code verification 2026-09-15)

- **OSRM demo server ToS:** launch verifies routing on OSRM's public demo endpoint, whose
  policy forbids heavy/commercial use. Self-host or buy routing before commercial launch.
- **Fork→signup join:** forks→signups needs fork timestamps joined to `users.createdAt`
  (exists per `computeGrowthSeries`) — verify queryable before sprint planning.
- **Seed-guard ref** (`store.ts:630`, `#94`) cited by source docs but NOT independently
  re-verified — treat as inherited until checked.
