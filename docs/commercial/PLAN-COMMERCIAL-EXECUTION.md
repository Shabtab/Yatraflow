# YatraFlow — Commercial Execution Plan

**Date:** 2026-09-16 · **Baseline:** `v0.54.0` (`test` = `main` = `d370aef`) · **Revenue:** ₹0

> **Status, re-derived 2026-09-21 (`test` = `v0.63.0`).** This is a dated plan, so the queue
> below is left as written — read it with the following beside it rather than as open work.
>
> **Shipped since:** **E1** (v0.57.0 — per-route browser titles, the `/i/<id>` preview function
> and its OG tags), **E4** (v0.61.0 — `get_public_trip` redacts locked days and `trips read` is
> narrowed, so the lock is enforced at the wire, not by a CSS overlay), **E7** (the I-20 unlock
> reveal and **My purchases** shelf, plus the I-21 buyer's share card), and **the rail E4 sat on**
> — order → signature-verified confirm → entitlement, with the fee ladder following as I-13.
>
> **Still open, unchanged:** **E3** (nothing records per-visit events, so a funnel has nothing to
> read), **E5** (the companion is still flag-off), **E8** (blocked on E3). Scope note: §4's
> anti-list item 1 — "no payment-rail code until Stage 1's gate passes" — was overtaken by the
> rail shipping ahead of that gate, which is a business decision this file recorded rather than
> made; the i18n, acquisition and marketplace bans in that list still stand.
>
> **E3 decision (2026-09-29) — how the readings are kept.** Share attribution ships: shared
> links carry a `ref`, the funnel log records it on every view and fork (and a fork stamps its
> trip with it), and the admin console's Analytics tab reads the four rates, the raw counts and
> a route-in breakdown. The readings themselves are **derived live at read and transcribed by
> hand into the weekly release-log comment** — a manual weekly reading, deliberately kept out
> of a snapshot table: the durable record is the event log (`pub_events`,
> `create_funnel_events`), and a reading is a statement about that log, so it belongs beside
> the decisions it informs. Stage 0 needs four weeks of accrual, not four tables. Revisit at
> Stage 1's gate if the weekly transcription ever costs more than a table would.

This is the **execution** plan — the when/what-done layer. The why/what lives in the
source docs and is not repeated here:

| Source doc | What it owns |
|---|---|
| `REPORT-2026-09-15-strategy-and-position.md` (same folder) | Position, staged ladder, unit economics, the honest unknowns |
| `PLAN-MONETISATION.md` (same folder) | Fee arithmetic, M7 schema, item-zero finding, kill criteria |
| `PLAN-LAUNCH-AND-DISTRIBUTION.md` (same folder) | The four blockers, the share loop, week-one list |

Rule inherited from all three: **stages advance on evidence, not on the calendar.** No item
below starts before its gate's evidence exists.

---

## 0. The one-line shape

> Fix the share → measure the funnel → prove demand → then (and only then) the payment rail.
> Everything else is explicitly deferred.

---

## 1. Engineering queue (E) — leverage order, each ~small

Every E item ships the standard way: feature branch → PR → `test` → `npm run verify` green →
CHANGELOG entry in the same push.

### E1 · Make links preview (Phase 1 core) · ~half day · Week 1

1. Default OG tags in `index.html` (`og:title/description/image`, `twitter:card`).
2. `document.title` per route (one effect in `App.tsx` on hash change).
3. `/i/:id` preview route: a small Vercel serverless function that reads the publication and
   returns minimal per-itinerary OG HTML under the SPA boot (the only way to beat hash
   routing — the fragment never reaches a server).
4. Test pin in the existing style (a test reading `index.html` for the tag set — the
   `route-integrity.test.ts` pattern).

**Accept:** OG tags present in the served document; `curl /i/<pub-id>` returns that
itinerary's title/description; WhatsApp/Meta Sharing Debugger shows a real card.
**Serves:** the single highest-leverage defect (strategy §2.6, launch blocker 1).

### E2 · Gallery cleanup (curation, minimal code) · ~1 h · Week 1

Unpublish the `(copy)` duplicate rows and fix the mangled author display name — via the
shipped unpublish owner gate / `dedupePublished()` path in the admin console. If a name
repair needs SQL, ship it as `supabase/*.sql` with the usual probe-verify.

**Accept:** `#/explore` shows zero duplicates; author names render correctly.
**Serves:** launch blocker 2 (the empty-looking shelf) — pre-work for Phase 2.

### E3 · Turn the funnel on (Stage 0 instrumentation) · ~half day · Week 1–2

1. Surface `computeFunnel()` (already implemented in `src/lib/adminStats.ts`) as an
   admin-console panel: activation / collab / publish / view→copy + raw views, copies.
2. Share attribution: shared links carry a reference param; forks record it (the
   invite-code machinery already exists — reuse its shape).
3. Nothing else. No analytics vendor yet.

**Accept:** the admin console shows the four rates; a fork made via a shared link is
attributable. **Serves:** Stage 0's exit gate (four weeks of data cannot start accruing
until recording exists).

### E4 · M7 item-zero — make the lock real · ~1 day · Week 1–2 (pulled early)

The monetisation plan schedules this "before the first sale"; this plan pulls it before real
traffic. From §6.0 of `PLAN-MONETISATION.md` verbatim:

1. `get_public_trip(p_trip_id)` — `SECURITY DEFINER`, reads the publication's
   `free_day_indexes`, returns locked days as stubs unless an entitlement exists for
   `auth.uid()`; grant to `anon, authenticated`. The entitlement check lives **inside** the
   function, never client-side.
2. Narrow `trips read` to `to authenticated` (owner/member clauses) — **shipped together
   with (1) or the public page breaks.**
3. Point `fetchSharedTrip()` at the RPC instead of `select *`.
4. Regression tests: anon read of a premium publication returns only free days (stubs);
   `get_invite_trip` path still works; Explore's `published_itineraries` reads unaffected.

**Accept:** an unauthenticated `curl` of a premium publication's data returns no locked
content; full verify gate green; SQL applied to production with the probe-verify ritual.
**Serves:** risk 1 (Critical) in the monetisation plan; converts the paywall from a CSS
overlay into an access control.

### E5 · M5 companion to the free tier · ~2 h · Week 2

Flip `VITE_AI_COMPANION=on` on the test/preview environment (env vars are per-branch —
set it for preview + production when promoting), add the usage counter (queries per user
per month) feeding the same admin panel as E3.

**Accept:** the companion answers on the preview build; per-user query counts visible.
**Serves:** Stage 1's retention experiment and the token-budget unknown.

### E6 · Docs/plan pins · ~1 h · with whichever PR lands first

- The funnel thresholds (§3 below) recorded in the tracking issue **before** E3's first
  data point lands.
- `docs/README.md` gains this file's index row (add at push time, off the current `test`
  tip, not this branch's stale copy).

### E7 · Post-unlock value presentation · ~1–2 days · unblocked — #251 merged, M7 is live

The unlock ceremony (full-screen "you now own X" with real computed stats), the owned
library (persistent "My purchases" shelf with cover/creator/version), and the purchase
share card. Research and rationale:
`commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md` §4; buildable items
I-20 + I-21.

**Accept:** a fresh buyer sees the ceremony on unlock, finds the purchase on a permanent
shelf from My Trips, and can share an og-image card of the purchase.
**Serves:** Stage 2's conversion and the distribution loop's second share unit.

### E8 · Publication funnel UI · ~2–3 days · blocked on E3

Per-publication views→forks→sales funnel with preview→sale conversion on the creator hub
(I-22; presentation shape in the research doc §5). **Do not start before E3's events exist**
— there is nothing to read. Pair with I-23 (publish-quality checklist), which converts the
funnel's first insight into a creator action.

**Accept:** a creator sees each publication's funnel and at least one actionable
counter ("add a cover photo") on the hub.
**Serves:** Stage 2→3 creator retention — funnels make growth feel steerable.

---

## 2. Founder queue (F) — not code, and the actual critical path

| # | Item | When | Gate it feeds |
|---|---|---|---|
| F1 | Pre-set every threshold **in writing before measuring** (the four launch signals + Stage 1→2 pass marks). Deciding pass-marks after seeing data is how a metric becomes a story. | Week 1, before E3's first recording | all gates |
| F2 | Build 3 real trips with 4+ real people, in the app; publish them | Week 1–2 | creator supply; also the best bug-hunt available |
| F3 | Send one published link to a WhatsApp group you're in | after E1 | the honest test of the whole loop |
| F4 | Record the funnel weekly (15 min, from the E3 panel) | every week from E3's landing | Stage 0 exit (4 consecutive weeks) |
| F5 | Scale the shelf toward **20 published itineraries** (Leh–Ladakh, Spiti, Goa, Kerala, Rajasthan, Meghalaya, Coorg, Rann, Hampi, Andamans) — real routes, engine costs, covers | Weeks 2–5 | launch blocker 2; Stage 2 inventory |
| F6 | CA conversation: merchant-of-record Branch 1 vs 2; confirm fee ≥ floor | Stage 0, any time before Stage 2 | Stage 0 exit; ~₹27/sale depends on it |
| F7 | First distribution loop: one route per post, spaced — Reddit `r/IndiaTravel` etc., itinerary-not-app framing; stop when one channel works | after E1 + F5 ≥ ~10 | shares→views |
| F8 | GST/TDS registration scoping | Stage 2 entry | legal floor |

**Sequencing rule:** F3 is the milestone. If the preview shows and someone forks, the loop
works; everything after is volume. If not, that is the most valuable learning available
this week.

---

## 3. Gates dashboard (thresholds: F1 fills them in; never after measuring)

| Gate | Pass mark (TBD by F1) | Fail → |
|---|---|---|
| Launch: shares→views | — | the share unit / the preview (E1) |
| Launch: views→forks | — | itinerary content / anonymous CTA |
| Launch: forks→signups | — | the signup step |
| Launch: signups→2nd session | — | **the product — back to M6, not marketing** |
| Stage 0 exit | 4 consecutive weeks of funnel data + curated gallery + CA-confirmed structure | keep measuring (this stage never kills) |
| Stage 1 exit | view→copy ≥ __ · creator supply ≥ __ · week-4 retention ≥ __ | **do not build M7** |
| Stage 2 (60-day) | ≥ __ paid unlocks at seeded prices | revert to subscription-only |
| Stage 3 | measured CAC + repeatable subscribers | fix packaging before acquisition |

Launch signals are tracked weekly in the tracking issue; Stage gates in this file.

---

## 4. The anti-list (review policy, not suggestions)

These are **blocked by the gates above**, and stay blocked regardless of how attractive
they look mid-quarter:

1. **No payment-rail code** (Razorpay, `sale_events`, entitlements writes) until Stage 1's
   gate passes. E4 is the *only* M7-adjacent item that ships early, because it is security.
2. **No i18n / Hindi** until one distribution channel measurably works.
3. **No Product Hunt / Hacker News** until the gallery holds ≥ 20 real itineraries.
4. **No paid acquisition** — there is no CAC or conversion baseline to buy data against.
5. **No marketplace work** (partner pilots count) — Stage 4, and it needs field ops.
6. **No new analytics vendor** in Stage 0 — the funnel panel is the instrument.

---

## 5. Source ↔ plan map

| Strategy call | Where it executes |
|---|---|
| "Fix the share preview before driving a visitor" | E1, F3 |
| "Clean the public gallery" (Stage 0 step 1) | E2 |
| "Turn the funnel on" (Stage 0 step 2) | E3, F4 |
| "Record the three unknowns" (Stage 0 step 3) | E3 panel + F4 ritual |
| "Redacting read path is item zero of M7" | E4 (pulled early) |
| "Ship the companion free; measure retention" (Stage 1) | E5 |
| "Publish 10–20 reference itineraries" (Stage 1) | F2, F5 |
| "Set thresholds now, before measuring" | F1, §3 |
| "Structure as intermediary; confirm with CA" | F6 |
| Everything the docs list as "what NOT to do" | §4 |
