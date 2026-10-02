# YatraFlow — Master Roadmap

The single plan of record. Every roadmap, phase and tracked backlog now lives
here — merged from the phased plan (Sep 2026), the executed v0.23.0/CTI
implementation plan, the CTI alignment deferrals, the completed UI-audit
tracker, and the Sep 2026 comprehensive review (CSS / React / UX audits).

Living document — reviewed each session, updated as items land. Done items
move to [CHANGELOG.md](CHANGELOG.md); this file only tracks what's ahead.

**Release protocol:** every milestone below ships as a **release on a feature
branch off `test`** — version bump (`package.json` + lockfile), CHANGELOG entry,
README update when feature-worthy, `npm run verify` green, both themes QA'd,
user confirmation before any push. Feature work reaches `test` **via pull
request** (never a direct push); `main` merges stay explicitly user-gated
(AGENTS rule 1).

**Snapshot (2026-10-01, verified against the repo):** **v0.72.0 is cut on `test` this day: 63 commits since the v0.71.0 promotion (26 of them code), four migrations (all applied live as their PRs merged), carrying the address migration’s first three slices — every screen on a real path the router itself reads, history navigation, a pinned bridge for every legacy hash, and the crawler’s hand-offs, robots and sitemap written for the path scheme (#426) — the money rail made honest: an opaque claim refusal, a verifiable mark, refunds that survive late callbacks, no orphan pile, and a reconciliation map (#355) — share attribution with a channel vocabulary and the WhatsApp one-tap send (#230, #228, #227), refunded purchases as receipts (#407), the covers convergence (#360), the creator cards and sitemap redo (#362), the create funnel’s event log with a PII-safe vocabulary (#428), the shared focus contract’s two slices (#425), the Overview’s freshness gate (#404), and the rental/train pricing fix (#521). `check:migrations` at the cut: 37 migrations · 17 applied · 0 missing · 20 no probe surface.**
Current version: **0.72.0** — cut on `test` on 2026-10-01 (real paths + crawler redo, #426 slices 1–3; the honest money rail #355; measured sharing #227/#228/#230; refunded receipts #407; covers #360; crawl redo #362; funnel events #428; focus contract #425; freshness gate #404; rental/train pricing #521; four migrations, all applied live) — **promoted to `main` the same day (PR #543, `main` at `f8f25a3`, tagged annotated `v0.72.0` on the merge commit, the Android APK workflow green on the tag push)**. Under it: v0.71.0 — cut on `test` on 2026-09-29 (publish rules + backstop, counters/read-states honesty, session/budget/settings waves, health band + overview truth, settings V2, map freshness publisher; two migrations, both applied live) — **promoted to `main` the same day (PR #516, `main` at `6b58b80`, tagged annotated `v0.71.0` on the merge commit)**. Under it: v0.70.0 — cut on `test` on 2026-09-28 (the honesty-and-recovery wave: every failed read says so instead of looking empty, the creator's payout runs and access check, the create flow's one day count and persisted vehicle inputs, the footer copy, and one staged/kept/undone mutation contract) — **promoted to `main` the same day (PR #500, `main` at `7c82bfe`), tagged annotated `v0.70.0` on the merge commit, the Android APK workflow green on the tag push**. Under it: v0.69.0 — cut on `test` on 2026-09-27 (the P1 wave, and the map's own search), **promoted to `main` the same day (PR #489, `main` at `d20f195`, tagged annotated `v0.69.0` on the merge commit)**. The release that closes every P1 the day's audit sweep filed — an amount rule that refuses negative, infinite and NaN rupees on every path, a session lifecycle that keeps what the store already promised, crew signals that claim their row before they write, a start rename that stops measuring the old city, a publish button that waits for its save, a shelf total that survives one unreadable purchase, creator and Explore pages that admit a failed read, and a withdrawn plan whose button leads somewhere — and that takes the map and the Timeline forward: the map's own search with explicit placement, suggestion pins that cluster into count badges instead of piling up, an all-days Timeline review mode, and inline insertion between two stops. No migrations. Under it: v0.68.0 — cut on `test` on 2026-09-26 (the audit's third wave: the workspace surfaces' honesty-and-cost pass), **promoted to `main` the same day (PR #464, `main` at `bed7ef3`, tagged annotated `v0.68.0` on the merge commit)**. The release where one edit costs one render — a renamed day re-derives that day alone, a Board interaction re-renders no columns it does not own, the Map tab's suggestion stack loads on demand (the workspace bundle drops 264 KB to 206 KB, measured), and a trip switch aborts the road measurement it left behind — and where the surfaces stop disagreeing with each other: the Board's mini-map draws the workspace's one road measurement and names a dashed amber estimate when there is none, its health dial takes its colour from the band word it prints, its pulse reads the engine's warning identity rather than parsing rendered titles, per-day money follows the day's own index so a skipped day number can no longer show a neighbour's total, and a day's stops stay numbered 1..n through delete, undo, drag and day-moves. The optimiser can neither move tomorrow's wake-up point nor apply over an edit that landed meanwhile, an unmeasured distance says "(est.)", the map rail's results are a keyboard-operable self-announcing listbox, the map's pins meet the 40px touch floor, and the create flow keeps the stop text you typed — with the Plan Bench's hand-off pinned to the one create-route definition. No migrations. Under it: v0.67.0 — cut on `test` on 2026-09-25 (the audit plan's first two waves) and **promoted to `main` the same day (PR #446, `main` at `af373cc`, tagged annotated `v0.67.0` on the merge commit)**; the release where the public wire stops telling a reassuring story: the invite code no longer rides along with an anonymous read of a published itinerary, a viewer who has not bought a priced plan receives no budget breakdown (only the publication's own per-person estimate, which the page always showed), and unpublishing keeps the row, so a buyer keeps the access they paid for while the ledger and funnel freeze. It is also where the pruner that deletes traffic history became an operator action, resolving a decision persists, the create flow can neither mint twin trips nor leave a zombie row behind, an unlock is live without a reload, a staged timeline edit survives the next one, the map measures the road once, and a map pick that cannot be pinned asks for its position instead of being dropped. It also makes the creator hub's own recovery path reachable — a failed ledger read had shown a spinner that never resolved, a retry looked like a dead button, and a failed refresh erased figures already on screen. Five migrations, all applied before the promotion. Under it: v0.66.0 — the creator hub as an operating picture and the app's high-end visual pass: the hub opens on a KPI strip and a recorded-traffic trend (visits/forks/unlocks over 7/30/90 days) drawn from the same derivation the rows beneath read, one row per publication with its funnel and actions, the creator profile moved into a disclosure at the foot of the page — every honesty state kept (an unread ledger never reads as an empty one; an un-recorded window says so rather than printing zeroes) — nested funnel figures in the trend's own hues with a monotone-cubic trend that cannot overshoot and invent traffic, a hover/keyboard readout and a chart-navy KPI band, a second critique pass (no zero that was never read, the stage bar a real drop-off, each row stating its window and each rate its denominator), and the hub's 23 Codacy findings cleared (the gate's type-aware ESLint ruleset is invisible to the repo's own `npm run lint`); map-tab search is route-aware (both surfaces run Search-Along-Route over the trip's polyline, the keyless stack ranks merged hits by distance to the corridor, and hits draw as selectable teal markers that clear with the box); and the high-end visual pass lands (Plus Jakarta Sans replaces Inter, one 1.5 icon stroke via `--icon-stroke`, the pill nav's glider animating its own box instead of a distorting `scaleX`, the landing's display scale/macro-whitespace/Double-Bezel buttons, the public itinerary's soft trays, TripCreated's entry choreography, and the OG share card rendering the app's real font again). Also in it: the create funnel's interface review, one assertive form-error beat app-wide with polite field errors, the moment-after's watch-list planning real fuel halts, crew invites on every channel, and theme-aware `::selection`/caret. Four PRs merged to `test` on 2026-09-24: **#315** (`feat/creator-hub-dashboard`, merge `8830648`), **#316** (`fix/map-search-route-bias`, merge `9138ff2`), **#317** (`fix/og-card-font`, merge `3c97d8e`), and **#318** (`docs/promote-v0.66.0`, the release cut, merge `a2d92d9`). Under it: v0.65.0 — cut on `test` and promoted to `main` on 2026-09-22 (PR #304, `main` at `3893ccc`): the Create funnel and its ticket (templates, readiness, radar, route IQ, seasonality, crew invites), the M5 AI companion (a configurable LLM endpoint with Jev routing and an honest offline fallback), the PWA pair (installability, offline reading, durable sync), the map's honesty pass (the fit frames the drawn route, slot search lands a real stop, the P3 sweep), the security hardening batch (rate limiting, headers, the CSPRNG), one icon vocabulary across every surface, and the design AA/palette/spacing-ladder cleanup. Under that: v0.64.0 (decision comments + settle-up, creator-owned share covers, onboarding a11y — PR #270); the 2026-09-22 queue landed on `test` as 12 reviewable integrations with `npm run verify` green at each merge.

**Live open work is tracked in two places, and this file must agree with both:**

1. **The issue queue** — see [Open issues](#open-issues) below for the current list, which is
   derived from the GitHub API rather than recalled. **47 issues are open** (2026-09-28,
   `gh issue list --state open` — 14 P1, 48 P2, 13 P3, and an empty P0 shelf): the audit plan's
   P1–P3 remainder, the #226–#234 launch-readiness criteria filed from
   [`docs/PLAN-LAUNCH-AND-DISTRIBUTION.md`](docs/PLAN-LAUNCH-AND-DISTRIBUTION.md), and the
   #236–#240 milestone tracks (M5 → M9) — **#238 (M7) closed 2026-09-19**, the money rail
   having shipped in v0.61.0, so the live track issues are #236, #237, #239 and #240. All
   were filed as issues, not only prose in this file.
   The queue was empty for a day on 2026-09-16: #213 was filed and closed inside it (its six
   phases shipped in #219/#220), the rebrand (#96) is archived — no need or plan to rename —
   and #122's season half is closed as not planned, the late dinner window being deliberate.
   Re-derive with `gh issue list` before quoting counts.
2. **The milestone tracks** — M5 → M9, plus the 1.0 cut. These are *planning* tracks: they are
   directions of travel, not release numbers.

**Read the version labels with care.** The `M` tracks were authored before v0.26–v0.48 existed
and shipped entirely different content (Plan Bench redesign, the v0.27 interface pass, the
#43–#52 store sweep, the Corridor Concierge engine, the masteradmin console). Those version
numbers are now **consumed** — `v0.32.0` in particular shipped "Stabilization completion", not
M6. The `vX.Y.Z` in each M-heading is therefore **historical intent only and is not a booking**;
the ledger tracks content, and only the ledger's version numbers are real. Where a heading's
number collides with a shipped release, the ledger wins.

---

## Open issues

Re-derived from the GitHub API 2026-09-28 (`gh issue list --state open`) — **47 issues are open**
(14 P1, 48 P2, 13 P3; P0 empty). The table below tracks the two named sets: the
**launch-readiness criteria** (#227–#234), filed from
[`docs/PLAN-LAUNCH-AND-DISTRIBUTION.md`](docs/PLAN-LAUNCH-AND-DISTRIBUTION.md) and its
`STEP-0-DECISIONS.md` companion; the **milestone tracks** (#236–#240) are the M5 → M9 paragraphs
below, now tracked as issues so the queue and this file cannot drift apart again. Corrected
against `gh` on 2026-09-20, because it had drifted both ways: **#226 and #229 were closed** on
2026-09-19 and still read as live here, while **#252 and #255** had been filed and never added.
Corrected again on 2026-09-22: **#238 (M7) is closed** — the money rail shipped in v0.61.0 — so
the live milestone tracks are #236, #237, #239 and #240. Re-derive the count before quoting it:

| # | Priority | Issue | State |
|---|---|---|---|
| #226 | P1 | E1 · Make links preview | **Closed 2026-09-19.** Shipped in v0.57.0: `/i/<id>` serves public metadata and redirects browsers to the hash route, with no cross-deployment shell fetch; the trip-JSON import that PR #235 also carried landed alongside it. v0.58.0 gave that preview a picture — a branded 1200×630 card for any publication with no cover of its own, and auto-picked covers resized through Wikimedia's own endpoint so none exceeds the 600 KB `og:image` ceiling. The acceptance it could not close by itself — a card rendered in a real messaging client — is what #227 (F3) exercises by hand. See `docs/DEPLOYMENT.md`. |
| #232 | P1 | E2 · The gallery is curated | `#/explore` holds one itinerary; the shelf has to read as chosen, not as everything that passed the gate |
| #230 | P1 | E3 · Attribute shares, and settle how the readings are kept | Decides what a share is attributed to, and where the readings live, before any of it is measured |
| #229 | P1 | F1 · Write the thresholds down, before measuring | **Closed 2026-09-19.** The four launch signals (shares→views, views→forks, forks→signups, signups→2nd session) and the Stage 1→2 marks, committed in-repo **before** E3's first reading. D5 of [`docs/commercial/STEP-0-DECISIONS.md`](docs/commercial/STEP-0-DECISIONS.md) holds the numbers, which merged into the repo with PR #214 — no longer an unmerged branch; thresholds are immutable once set, so doing this after E3 starts is the failure mode the rule exists to prevent |
| #233 | P1 | F2 · Three real trips, four real people each | Real crews on real trips — the evidence that the planning holds outside a fixture |
| #227 | P1 | F3 · Send one published link to a WhatsApp group | The smallest honest distribution test, in the channel the product is positioned against |
| #231 | P2 | F4 · Four consecutive weekly readings | Four weeks is the shortest window that shows a trend rather than a day |
| #234 | P1 | F6 · CA confirms the merchant-of-record branch | Branch 1 (intermediary) vs Branch 2 (merchant of record) moves the creator's net ~₹27 a sale — ₹161.47 vs ₹134.10 on a ₹199 sale — and the 15% fee must clear the ~3.86% cost floor. Also scopes GST/TDS registration |
| #228 | P2 | F7 · First distribution loop | The repeatable loop, and only after F3 has answered |
| #252 | — | F7 · Decide who becomes a creator, and who may publish | Filed 2026-09-19, **unlabelled** — no priority, no type — with 3.3 KB of body. The decision: creator mode is self-enabled by any signed-in user (`CreatorHubPage.tsx` → `updateProfile`), `adminSetCreator()` can badge anyone but is not a gate, and publishing is gated on trip ownership rather than on creator status, so the two switches have never been reconciled. Needs a priority and an owner before it can be scheduled |
| #255 | P3 | Overdrive: the receipt learns to print — morph the itinerary's numbers into a real bill | Filed 2026-09-18 — this is **I-18** from the Tier 1 bank below, now tracked. Parked, not started: ~~blocked on a product decision~~ **decision made 2026-09-25** (recorded on the issue): the bill shows **the creator's stated estimate** (`estimatedBudgetPerPersonInr`), never a viewer-side recalculation — the §4 D3 morph is then honest by construction. Still parked; remaining gate is the design-token approval rule, and its own contract (2–3 directions presented and one picked before any code) still applies |
| #236 | P2 | M5 · AI companion — user-configurable LLM endpoint | **Shipped in v0.65.0 (PR #304)** — endpoint, Jev fast path, offline fallback; flag-off in prod until M8's premium unmount, which is why the issue stays open |
| #237 | P2 | M6 · Together — collaboration depth | The track below |
| #238 | P2 | M7 · Premium — the payment rail | **Closed 2026-09-19.** The rail shipped in v0.61.0 (order/entitlement tables, webhook, server-side paywall, unlock flow) and the fee model + `admin_revenue` analytics followed on 2026-09-21; the open remainder, F6 (#234 · the CA's merchant-of-record call), is tracked on its own issue — a row no commit can close |
| #239 | P2 | M8 · 1.0 enablers → the 1.0 cut | The track below |
| #240 | P2 | M9 · Invites & onboarding | The track below; exec plan already written |

The queue was empty for exactly one day, and this section said so — the launch set above is what
replaced it. **#213** was filed and closed inside that day: a read-only audit of how the trip
workspace is wired (what reads what, and which surfaces can disagree) found the whole class of
defect behind this file's own "the queue is one issue" note — settings read by the engine but
never persisted, memos whose dependency arrays omitted what they read, and duplicated
vocabularies across Create Trip and Trip settings. Six phases shipped as PRs #219/#220: the
Settings tab split out of Share, party/vehicle persistence (new columns, applied live), the
propagation fixes, style-vs-budget separation, the parity pass, and the numeric defaults.

**#96 — rebrand: ARCHIVED, not planned.** There is currently no need or plan to rename the product.
`refactor/brand-seam` builds the seam (one source of truth for the name across 21 files, `vite.config.ts`
included) and is kept as archaeology — nothing depends on it and it is far behind `test`, so reviving it
is a rebase, not a resume. The caveat to read before ever reviving it: the Android shell's `appId`
(`app.yatraflow.mobile`) breaks updates over existing installs if it changes.

**#122 — the dinner window's season half: closed as not planned.** The late window (dinner 20:00–21:00,
night end 23:00) is correct for this market; deriving it from sunset was attempted and reverted in #210
because it landed dinner at 17:00–18:00. If the underlying problem is ever worth solving, the recording
shapes are an **advisory** ("this day finishes after dark") or an **opt-in** early dinner — never a silent
shift of the meal.

**Correction (2026-09-15) — the M0 seed guard was fixed, and this file said otherwise.** Five
places below claimed the demo-seed guard was "never implemented". It is implemented: `store.ts`
tracks `tripCountUnknown` (set whenever the memberships or trips read errors) and the seed line
reads `if (tripList.length === 0 && seedIfEmpty && !admin && !tripCountUnknown) await seedDemoFor(…)`
— the `#94` comment above it spells out exactly the accumulation trap M0 warned about. Closed by
#94 (the v0.49.0 issue sweep), so the ledger box below is ticked and the warnings removed. The
lesson is the one §6 already states in reverse: **a roadmap row is a claim about code, not a
fact** — this one stayed wrong for weeks because nobody re-read it against `src/`, and it was
found only while auditing the file for a release.

**Recorded (2026-09-22) — the slots plan's open questions, decided as shipped (late P0 acceptance).**
The day-slots implementation plan required "decisions recorded in ROADMAP.md" and they were never
written down; the plan-vs-code audit (2026-09-22) caught it. Recorded now, exactly as the tree
behaves — no rationale is invented where none was written:

- **P0.1 / #260 — keep, not close.** The plan recommended *closing* the calm-pass PR; it was
  **merged** instead on 2026-09-19 (merge `468fb18`) and its calm-pass CSS remains in
  `src/styles.css`. The merge supersedes the recommendation; no rationale was recorded at the
  time, so this entry records the fact and leaves the "why" open.
- **P0.2 → P0.4 shipped as written:** the extras rail became the corridor ledger; `meal` kept its
  purpose with a `mealSlot` split; and the word "slot" never reaches the UI — the rail says
  "part" (`daySlots.ts` label rule, CHANGELOG).
- **Breakfast (plan §8.2's open question): always for stay-days**, drawn from the engine's own
  `BREAKFAST_WINDOW` (ends 09:30, not the plan's proposed 10:30) — the plan's rule was "verify
  against existing constants"; the skeleton lives in `daySlots.ts:550–580` and is covered by
  `tests/daySlots.test.ts`.
- **Dinner likewise ships on the engine's `DINNER_WINDOW` (20:00–21:00)**, not the proposed
  19:30–22:00, for the same reason.
- **Readiness counts `filled / required`** (total minus engine-managed), not the plan's plain
  "N of M" — the engine's own work can't count against the user; disclosed in `MapTab.tsx` and
  in the CHANGELOG entry that shipped it.

Superseded items that DID have a disclosure live in their CHANGELOG entries (popup-Fill became
tap-opens-the-rail; day switching hides rather than dims, per the #1119 regression; the km ruler
was removed; result filing keys on category rather than window/km, with the rationale in
`MapTab.tsx`). The plan's mobile slots summary, its cost micro-bars and the per-slot glyphs were
open audit findings when this block was written (2026-09-22) — findings, not decisions — and all
three shipped that evening in #303 (the deferred P3 sweep), earning their disclosure in 0.65.0's
CHANGELOG entry.

---

## Progress ledger

One checkbox per major update, from the first commit to the 1.0 cut. Shipped
items stay checked (never deleted — this is the at-a-glance history);
remaining items tick in the **same commit as their release** (with the version
and date), per the AGENTS §6 same-edit rule. Detail lives in
[CHANGELOG.md](CHANGELOG.md); this is only the map.

### Shipped — foundation (Aug 23–28, 2026)
- [x] **v0.1.0** — Initial MVP: React 18 + TS app, localStorage store, day-by-day timeline, schedule/budget engine, light/dark theme, India-first seed content
- [x] **v0.2.0** — Collaboration layer: invite-by-link, suggestions with votes/comments, decision polls, activity feed, notifications
- [x] **v0.3.0 → v0.11.x** — early polish wave: onboarding/UX fixes, confirm dialogs, export/import trip JSON, decision & notification hardening, cross-device URL state
- [x] **v0.12.0** — Supabase backend: real accounts, shared persistence, RLS — the app leaves single-browser localStorage
- [x] **v0.13.0 → v0.16.0** — timeline becomes a real itinerary view (time rail, cross-day drag-and-drop), Mappls India-grade place data, opening-hours model

### Shipped — data & platform (Aug 29 – Sep 3, 2026)
- [x] **v0.17.0** — Google Places integration (opt-in key, quota-guarded, free-stack fallback) + full mobile usability pass
- [x] **v0.18.0** — unified journey engine (one travel system for every day), touch drag-and-drop, 12h/24h clock pref, `npm run verify` gate, AGENTS.md founded
- [x] **v0.19.0** — 3-layer design tokens, vite 8 + plugin-react 6, CSS build-blocker fix (#14)
- [x] **v0.20.0** — CI gate (#21), live realtime collaboration (#18), OpenFreeMap basemap swap (#23), fatigue-aware ride-plan suggestions, Google routing (#6)
- [x] **v0.21.0** — vehicle profiles (fuel/EV/CNG range), purpose-tuned halt queries, trip-scoped suggestion cache, fixed impact sheet
- [x] **v0.22.0** — expandable map view, suggestion persistence across tab switches
- [x] **v0.23.0** — publish write-through fix, hydration error logging, **UI audit 32/32 complete** (6 batches)
- [x] **v0.25.0** — Calm Travel Intelligence redesign (M0–M7), user-driven halt planner, contrib integration
- [x] **[Unreleased]** — demo-seed revert + one-off DB prune, master-roadmap consolidation, Sep 2026 comprehensive review
- [x] **v0.41.0** — Corridor Concierge (H1–H3 complete): road personality, enforced detour budget, trip DNA + crew seeds, story arcs, slack prompts, asymmetric detours, hours scoring, fuel advisories; Google-only provider directive; store + AI-drawer sweep (issues 15/15)


### Shipped — the v0.42 → v0.54 line (2026-09-06 → 09-15)
- [x] **v0.42.0** — Hy4 audit P0 fixes: the suggestion engine's persistent state and UI behaviour become reliable ("Add all" write-through, cache invalidation on route change, the degenerate-route guard, the detour budget enforced from the actual itinerary)
- [x] **v0.43.0** — The suggestion engine comes alive — See & do finally fills, the map and the suggestion panels cross-highlight, every add lands in road order, and a bad merge's encoding corruption is repaired
- [x] **v0.44.0** — The mid-trip questions, answered where the planning happens: safe-to-spend pacing, per-day cost/dwell chips, and calendar export
- [x] **v0.45.0** — Create-flow + invites + settings: the Trip Ticket create board, car-rental and local-train fares, range calendar, invite short codes, Plan Bench trip settings and the My Trips search/filter/sort restore
- [x] **v0.46.0** — The masteradmin console — a typed, never-linked `#/admin` god view with audited RPCs and an append-only audit log
- [x] **v0.47.0** — Cleanup and polish: deletes become reversible, the app writes faster, and the small-wins backlog lands together
- [x] **v0.48.0** — Consistency and shell: one green, one kicker recipe, four blur tiers, and a real Android shell
- [x] **v0.49.0** — Board-first editing, trustworthy drag-reorder, and the open-issue backlog closed in one pass
- [x] **v0.50.0** — Every trip edit finally sticks — the "Change saved but nothing changed" defect is dead
- [x] **v0.50.1–v0.50.2** — The installed app stops flashing the marketing site on launch and drops the website's top bar entirely
- [x] **v0.51.0** — The timeline learns to move: the 1,500-line view splits into `components/timeline/*`, the motion vocabulary lands, and drag gets its own geometry
- [x] **v0.52.0** — The map learns relief — Liberty becomes the light basemap, with 2D/Terrain/3D view modes
- [x] **v0.53.0** — The design-system audit gets fixed, not just filed: issue #107 worked to 117/117 across five batches (contrast/ink tier, motion tokens, kicker + hit areas, the ARIA listbox Select, the scenic hue split), with the guardrail gates kept
- [x] **v0.54.0** — The suggestion pipeline tells the truth — honest detours, one road measurement, night halts anchored on real towns, the Day Planner's meal and fuel cadences revived, and Create Trip parity with its route-integrity guardrail
- [x] **v0.55.0** — The gallery gets its pipeline — the import contract and validator, the engine-truth gate in CI, the demand-ranked 20-trip backlog, and six researched, engine-priced shelf itineraries (Goa, Kerala, Mewar, Kashmir, Meghalaya + the Coorg reference); Vercel Web Analytics rides along
- [x] **v0.56.0** — Settings integrity: the six-phase #213 audit lands as one release — Trip settings becomes its own workspace tab, party/vehicle preferences persist to the trips table, a settings change re-derives every downstream surface, style and budget separate into independent dials, Create Trip and Trip settings share one vocabulary, and blank tank/economy fields stop writing car numbers onto bikes and EVs; promoted to `main` on 2026-09-16 (PR #223)
- [x] **v0.57.0** — Sharing and honesty: a published itinerary link previews as a card (`/i/<id>` answered by a Vercel function with that itinerary's own Open Graph tags, then the hash route), trip JSON imports in one step from My Trips and reads both formats the repo ships, permanent user deletion lands in the masteradmin console, the offline companion stops routing overloaded days / cost questions / mentions of children to the wrong handler, and every route gets its own browser-tab title
- [x] **v0.58.0** — The share card gets a picture: a 1200×630 branded card backs any publication with no cover of its own and the shell advertises it too, while auto-picked Wikipedia covers are resized through Wikimedia's own endpoint — the 1.3–3.3 MB originals become 144–406 KB
- [x] **v0.59.0** — One measurement per corridor: the road draws as one chain measurement instead of one request per leg, the day filter measures only the day on screen, Google-keyed routing spends one quota event per corridor, the Return-home toggle steers the suggestion corridor, and copied public itinerary addresses keep their trip-specific previews with navigation that works in any tab; promoted to `main` on 2026-09-17 (PR #247)
- [x] **v0.59.1** — Span measurement gives every leg its own result: a cached leg inside the corridor span can no longer hand its geometry to the leg after it or poison that leg's cache entry, so a drawn route stops stopping early; promoted to `main` on 2026-09-17 (PR #248)
- [x] **v0.60.0** — Whole-app refinement, every route reviewed against its own design language and fixed in place: the phone layouts that pushed their controls off-screen, the Timeline's inert reorder arrows, the calendar painted under the bottom dock, the forced-dark surfaces that stranded white text, the motion that never stopped offscreen, the controls under the 40px touch floor, the keyboard-unreachable scroll regions, and three product claims corrected. No token value changed. The design-system ratchet falls `9 / 11 / 32 / 30 / 1` → `7 / 0 / 28 / 29 / 1`, so the dark theme has no known contrast violation left. Merged to `test` on 2026-09-18 (**PR #257**).
- [x] **v0.61.0** — The money release: a priced publication can be bought — the price is read server-side so a tampered request cannot change it, the unlock is granted only through a buyer-scoped RPC or the idempotent payment webhook, and a purchase confirmed but never saved is recovered instead of charged twice; the paywall moves to the wire, so locked days no longer travel to every visitor in full; the itinerary format declares its version and its importer migrates and repairs an older export rather than refusing it; the crew-facing RLS shape is pinned by an opt-in suite that runs against the live database (M6); and the two public surfaces get a pass of their own. Promoted to `main` on 2026-09-18 (**PR #259**, `main` at `647faf1`).
- [x] **v0.65.0** — the funnel, the companion and the installable app: the 2026-09-22 queue integration (Create funnel, M5 companion, PWA pair, map cluster, security, one icon vocabulary, design AA) plus the v0.64.0-squash reconciliation. Cut on `test` 2026-09-22 and **promoted to `main` the same day (PR #304, `main` at `3893ccc`)** — tagged `v0.65.0` at the merge commit, the Android APK workflow green on the tag push.
- [x] **v0.66.0** — the creator hub becomes an operating picture and the app gets its high-end visual pass: **#315** (`feat/creator-hub-dashboard`, merge `8830648`) turns the hub into a dashboard — a KPI strip, a recorded-traffic trend (visits/forks/unlocks over 7/30/90 days) drawn from the same derivation its rows read, one row per publication with its funnel, the profile into a disclosure — with every honesty state kept (an unread ledger never reads as an empty one; an un-recorded window says so rather than printing zeroes), nested funnel figures in the trend's own hues with a monotone-cubic trend that cannot overshoot and invent traffic, a hover/keyboard readout and a chart-navy KPI band, a second critique pass (no zero that was never read, the stage bar a real drop-off, each row stating its window and each rate its denominator), and the hub's 23 Codacy findings cleared (the gate's type-aware ESLint ruleset is invisible to the repo's own `npm run lint`); **#316** (`fix/map-search-route-bias`, merge `9138ff2`) makes map-tab search route-aware (both surfaces run Search-Along-Route over the trip's polyline, the keyless stack ranks merged hits by distance to the corridor, and hits draw as selectable teal markers that clear with the box); **#317** (`fix/og-card-font`, merge `3c97d8e`) makes the OG share card render the app's real font. The same line carries Plus Jakarta Sans, one 1.5 icon stroke, the pill nav's glider animating its own box, the landing's display scale + Double-Bezel buttons, the public itinerary's soft trays, TripCreated's entry choreography, the create funnel's interface review, one assertive form-error beat app-wide, the moment-after's real fuel halts, crew invites on every channel, and theme-aware `::selection`/caret. Cut on `test` 2026-09-24 at `3c97d8e` with `npm run verify` green (2,135 tests / 154 files, 1 skipped) — **promoted to `main` the same day (PR #319, `main` at `244e74e`)**, tagged annotated `v0.66.0` on the merge commit (the Android APK workflow ran green on the tag push).
- [x] **v0.62.0** — M6 · Together's co-editing half: the crew is visible while you plan (live presence avatars in the workspace header, one per user across tabs, quiet no-op without a backend), concurrent edits stop destroying each other (a server-clock ledger orders realtime trip updates behind the `trips_touch_updated_at` trigger, and the debounced write persists the snapshot captured at call time), a remote edit of the stop you have open surfaces a keep-mine/take-theirs banner, and expense lines can be marked settled — a record that stays in the balances math, with the arithmetic extracted into a pure, unit-tested module. Merged to `test` on 2026-09-20 (**PR #265**).
- [x] **v0.63.0** — The map learns what day it is: the Day Planner's travel clock is drawn on the route as clean road labels (meal/overnight/destination anchors, planned-stop arrival chips, a return leg gated on the Return home toggle, overnight halts named from the corridor scan and tappable into their day), the living plan dims the days behind you and pulses today from the trip's own dates, the site gains a crawl surface (`robots.txt` and a generated sitemap where both answered 404), a public itinerary page renders for every publication shape (the locked-day stub's `::text` cast into polymorphic `to_jsonb`, and the creator-sales RPC revoked from anon), the map rail loses its heaviest furniture, and a pull request into `test` is verified before it merges rather than after (`tests/ci-workflow.test.ts`). Cut on 2026-09-20 and promoted to `main` the same day (**PR #267**).
- [x] **v0.67.0** — The audit's first two waves: the public wire stops telling a reassuring story (the invite code leaves the anonymous read, a priced plan's budget breakdown stays behind the paywall, unpublishing keeps the row so a buyer keeps the access they paid for, and the traffic-history pruner becomes an operator action), the creator hub gains its own recovery path, the create flow can neither mint twin trips nor strand a zombie row, an unlock is live without a reload, and an unpinnable map pick asks for its position instead of being dropped. Five migrations, all applied before the promotion; cut and promoted on 2026-09-25 (PR #446, `main` at `af373cc`, tagged annotated `v0.67.0` on the merge commit).
- [x] **v0.68.0** — The audit's third wave, a code-only release: the workspace surfaces' honesty-and-cost pass — one edit re-renders one day (and a Board interaction no columns it does not own), the Map tab's suggestion stack loads on demand, the Board's mini-map, pulse and health dial read the same engine facts the Map tab and the figures do, per-day money follows the day's own index, stops stay numbered 1..n through every mutation, the optimiser can neither move tomorrow's wake-up point nor apply over a landed edit, the map rail is keyboard-operable and self-announcing, and the create flow keeps the stop text you typed. Cut on `test` 2026-09-26 and promoted to `main` the same day (**PR #464**, `main` at `bed7ef3`, tagged annotated `v0.68.0` on the merge commit).
- [x] **v0.69.0** — the P1 wave and the map's own search: every P1 the day's audit sweep filed (one amount rule that refuses negative, infinite and NaN rupees, a session lifecycle that keeps what the store promised, crew signals that claim their row before they write, a start rename that stops measuring the old city, a publish button that waits for its save, a shelf total that survives one unreadable purchase, creator and Explore pages that admit a failed read, a withdrawn plan whose button leads somewhere), plus the map's own search with explicit placement, suggestion pins that cluster instead of piling up, an all-days Timeline review mode and inline insertion between two stops. Promoted to `main` the same day (PR #489, `main` at `d20f195`, tagged annotated).
- [x] **v0.70.0** — the honesty-and-recovery wave: a failed read is spoken on the Budget tab, My Trips and Trash instead of rendering the friendly empty copy; the pacing tile names the estimate it measures and settling is owner/editor-only in the store; the creator's payout runs roll over and a buyer's access check stops failing into a sales pitch; the create flow counts its days one way and keeps the vehicle inputs you typed; the footer stops denying the payments the product has; the AI companion guards its inputs while it thinks; the map's search-to-slot filing rules became a tested module; and every destructive write the store exports is declared with its way back — one staged/kept/undone contract. Two migrations, both applied live. Promoted to `main` the same day (PR #500, `main` at `7c82bfe`, tagged annotated).

### Remaining — in release order (details in the tracks below)
- [x] **v0.45.0** — Create-flow + invites + settings release (PR #81 + merged test work): Trip Ticket bento starter (bill print, outline seeding), car rental mode + local-train fares, range calendar, invite short codes + join-flow fixes, auth-refresh fix, Plan Bench trip settings + editable dates, My Trips search/filter/sort restore (branch `feat/create-trip-ticket`)
- [x] **v0.46.0** — Masteradmin console (PR #82): JWT-`app_metadata`-gated `#/admin` god-view (users/trips/invites/content/analytics/audit), audited SECURITY DEFINER RPCs, append-only `admin_audit` log, RESTRICTIVE deny policies for disabled accounts (branch `redesign/masteradmin-v045`, migration applied live)
- [x] **v0.32.0** — Stabilization completion: M0 leftovers (broken `pub:` route, router ready-gate for deep links / invite flash / loading-vs-empty) + M2 remainders (Profile save validation, demo-copy honesty, heading outline) + M1 leftovers (focus-ring gaps, touch targets, stagger freeze). **Note:** this is the row that consumed the `v0.32.0` number also claimed by M6's heading; the M0 **seed guard** was *not* part of it — it landed later, in v0.49.0 (#94).
- [x] **v0.36.0** — Budget + Group-input deep redesign: metric strip, per-day cost bars, payer balances + settlement, quick-add + in-place expense editing, who-voted tallies + needs-you digest, real composer pickers; `bump_published_stats` uuid→text fix, view dedupe, unpublish owner gate (branch `redesign/budget-group`)
- [x] **v0.37.0** — Creator release: public creator page `#/creator/:id`, publications manager with stats/edit/unpublish + stale-page nudge (`refreshed_at` migration), Explore newest sort, shared PubCard/forkPublication paths (local branch `redesign/creator-page` until pushed)
- [x] **v0.38.0** — Creator hub: My publications splits into Overview (lifetime KPIs + manager rows) | Earnings (Gumroad-shaped payouts ledger, honestly empty + labeled projection view via `projectEarnings`); M7 earnings contract documented in ARCHITECTURE (local branch `redesign/creator-hub`)
- [x] **v0.39.0** — Hard-surface pass (full skills-based review, ~70 findings): 5 HIGH fixes (Landing dark-mode bands, AA hero CTA, StopEditor phantom token, CreateTrip `--accent`, ₹₹ double-symbol), one lucide icon language workspace-wide, global tabular-nums utility, tabpanel/aria-pressed/focus-ring/hit-target a11y, one card-header + chip + fork-CTA grammar, dead code purge (local branch `redesign/hard-surface`)
- [x] **M3** — Performance architecture: store immutability → slice selectors → DaySection memo → workspace split into pages/trip/* + weather dedup + lazy routes (in [Unreleased], local branch redesign/perf-architecture)
- [x] **M4** — Design-system hygiene: dead CSS purge, mobile-block consolidation, glass/z-index tokens (in [Unreleased], local branch redesign/perf-architecture; raw-rgba glass stragglers intentionally NOT migrated — see commit `f646b45`)
- [x] **M0 defect** — seed guard: skip demo seeding when hydration had query errors (#94, v0.49.0 — `store.ts` gates the seed on `!tripCountUnknown`)
- [x] **M5** — AI companion: user-configurable LLM endpoint (#22 → #20 — both closed as audit findings; **shipped in v0.65.0, PR #304** — the drawer stays flag-gated off in prod until M8's premium unmount, which is why issue #236 remains open)
- [ ] **M6** — Together: every named item shipped — integration/RLS suite (v0.61.0); co-editing depth (v0.62.0, PR #265 — presence, stale-update guard, remote-edit banner, mark-settled, plus the Board/socket-gap follow-up `e5bba2a`); I-6/I-7 (v0.64.0); I-19 (open-lines balances) and I-16 (cross-device Trip DNA) in v0.65.0. What is left is a human step, not code: the two-account presence confirmation pass, after which issue #237 closes
- [x] **M10** — Day Planner / travel clock: the engine line shipped through P1-G (plan doc implemented, Sep 13) and the map half — clock anchors, planned-stop arrival chips, return-leg labels, living-plan day states, named overnight halts and tap-to-day — is on `test` (released as **v0.63.0** on 2026-09-20, **PR #262**); no open phases remain named in the plan doc
- [x] **M7** — Premium: payment gateway, entitlements, unlock flow — the rail shipped in v0.61.0 (PR #251 to `test`, promoted as PR #259) and **issue #238 closed 2026-09-19**; the fee model and the `admin_revenue` analytics followed on 2026-09-21. The one row no commit can close — F6 (#234), the CA's merchant-of-record call — is tracked on its own open issue
- [ ] **M9** — Invites & onboarding: creator invites (R1) → referral (R2) → invite-only gate (R3); three releases on `platform_invites`, exec plan in [`docs/PLAN-INVITES-ONBOARDING.md`](docs/PLAN-INVITES-ONBOARDING.md). *Added to the ledger 2026-09-11 — it previously existed only as a track section, so it was invisible to any pending list derived from these checkboxes.*
- [ ] **1.0 (M8)** — offline-first/PWA, i18n (EN+HI), the 1.0 cut → then PR to `test`

---

## Stabilization track — COMPLETE (M0–M4 landed; see the ledger)

**Status note (2026-09-11 audit; corrected 2026-09-15).** This track shipped across v0.26.0–v0.39.0
and the `redesign/*` branches; the ledger above carries the release rows. The bullets below are kept
as the **record of what was fixed** — they were written as a live to-do list and are now the
historical description, so read them in past tense. All six M0 items are closed: the seed guard,
previously called out here as never implemented, was fixed by #94 (see the correction at the top of
this file and `store.ts`'s `tripCountUnknown` gate).

### M0 — "Trust & navigation" (P0 bugs)
Small diffs, outsized trust impact. All six items landed — five in the v0.26.0/v0.32.0 stabilization
releases, the seed guard in v0.49.0 (#94):
- ✅ **"View public page" was a broken route** — `TripWorkspace.tsx` emitted `pub:<id>`, the
  router splits on `/` → landed on Landing, so publishers could never reach their own published
  page. Fixed.
- ✅ **Failed hydration fakes an empty state and re-seeds demo data** — `store.ts` logs query
  errors; the **retry banner** half shipped early (`partial` → toast), and the **"skip seeding
  when any query errored"** half landed with #94: `tripCountUnknown` is set whenever the
  memberships or trips read fails, and the seed runs only when the trip count is trustworthy
  (`tripList.length === 0 && seedIfEmpty && !admin && !tripCountUnknown`). A flaky-connection
  sign-in can no longer inject demo trips beside the user's own — the accumulation trap M0
  warned about (AGENTS §5).
- ✅ **Invite links flashed "broken" on cold load** — `InviteGate` showed the error whenever
  `trip` was undefined, which it is until hydration finishes. Fixed via the router ready-gate.
- ✅ **Deep-link reload landed on Landing first** — mid-hydration `me === null` funnelled
  `#/trip/...` to Landing; on failure the user was stranded. Fixed (router ready-gate).
- ✅ **Silent delete failure** — `deleteTrip`'s Supabase error restored the row with no toast
  (the undo had expired), so the delete "didn't work". Fixed.
- ✅ Housekeeping: stale UI-audit progress line.

### M1 — "Theme integrity & mobile" (dark mode + touch)
All verified fixed in the v0.27.0 interface pass (spot-checked 2026-09-11: `.theme-toggle` is
now 40×40, `.avatar-btn` carries `min-width/min-height: 40px`):
- ✅ **White-on-light-teal in dark mode** — `.vote-btn.on`, `.btn-teal`, `.step-num` kept `#fff`
  text while `--teal` flips light (~2.3:1). Sibling rules already used `#06251f`; these were
  missed. Also `.ha-sync` was dark-on-dark.
- ✅ **iOS zoom-on-focus** — the 16px mobile bump lost specificity to `.role-select` (12.5px)
  and two 13px time/number inputs.
- ✅ **Touch targets <40px** — `.theme-toggle` was 36px, `.avatar-btn` 26px, `.dest-chip` delete
  ~18px, plus `.toast-action`, `.board-fit`, filter chips.
- ✅ **Focus-ring gaps** — ~10 interactive controls were missing from the shared
  `:focus-visible` list (`.clamp-toggle`, `.board-fit`, `.save-heart`, `.dest-chip button`,
  `.role-select`, bare inputs…).
- ✅ Reduced-motion gap: `transition-delay` stagger survived the global freeze.

### M2 — "State honesty & UX"
All verified fixed (spot-checked 2026-09-11: the AI drawer has the Escape + focus-trap
contract, and the day title renders as a real `<button className="day-title-btn">` with an
`aria-label` when editable, `<h3>` only when read-only):
- ✅ Loading vs empty distinction on My Trips + Explore ("No trips yet" / "Nothing matches"
  rendered before or without data).
- ✅ Profile save: inline validation + disabled-while-saving (matches CreateTrip).
- ✅ AI drawer: Escape + focus trap + focus restore; nav popovers restore trigger focus on close.
- ✅ Keyboard: day-rename clickable `<h3>` → real button; heading hierarchy (h1→h3 skips in
  5 tabs; SharedTrip/Invite pages lacked h1).
- ✅ Landing "demo mode" copy over-promised (no anonymous demo; seed inserts trips only) —
  rewritten to match reality.
- ✅ Dead "Book a planning consultation" button; "places" vs "stops" terminology.

### M3 — "Performance architecture"
All five landed; the split is confirmed by `DaySection` now living in `pages/trip/TimelineTab.tsx`
alongside its siblings rather than in a 2,932-line `TripWorkspace.tsx`:
1. ✅ **Store immutability** — `Object.assign`/`push` in-place mutations made every
   `useMemo([trip])` stale-prone; it worked by accident.
2. ✅ **Slice-level selectors** — `useDb()` returned the whole cache and every `commit()`
   re-rendered every subscriber (realtime activity pings re-rendered the whole workspace,
   re-running `simulateDay` per day).
3. ✅ **Memoized hot path** — `React.memo(DaySection)` + handler `useCallback`s.
4. ✅ **Split `TripWorkspace.tsx`** (2,932 lines, 8 tabs) into `pages/trip/*`.
5. ✅ Fetch dedup: `DayWeatherChip` per-day weather calls vs Overview forecast; `ClampedText`
   DOM doubling; route-level `React.lazy` for Auth/Profile/CreateTrip/PublicItinerary.

### M4 — "Design-system hygiene" (CSS-only batch) — DONE (in [Unreleased], branch redesign/perf-architecture)
- [x] Purge ~100+ lines dead CSS (hero-preview block, `.route-flow`, `.filter-bar`,
  duplicates, contradictory `.locked-overlay` pair) — template-literal-safe
  recheck first. (Net −80 lines; 30+ zero-usage rules + dead selector
  fragments in compound rules, per-selector usage grep in commit body.)
- [x] Consolidate the 9 scattered mobile blocks (real conflicts: `.map-day-chip`,
  `.vote-btn` sized differently in two blocks) back toward the single-block
  convention. (All max-width blocks grouped at EOF, one 720px block; cascade
  preserved via per-selector audit + declaration-multiset diff.)
- [x] Glass tokens: four blur tiers (`--yf-blur-nav` 18 / `-panel` 14 / `-chip` 8 / `-scrim` 3px, every surface mapped; locked-CTA 1.5px scrim excepted);
  raw-rgba glass stragglers: none migratable — every literal matching a
  `--yf-glass*` value is deliberately theme-invariant (dark flips to .08),
  documented in `f646b45`; saturate normalized to 1.2. z-index: full 15-rung
  `--z-*` ladder, ties documented, ordering preserved (`eea4ebd`).
- [x] Tokenize hardcoded hero-gradient hexes (→ `--gray-900`) + the 26× shadow
  navy (→ `--shadow-navy-rgb`); adopt-or-delete: 18 never-referenced custom
  properties deleted (light+dark mirrors together), DESIGN_TOKENS.md updated.
  (One-off radii left as-is — no value-identical rung exists for them.)

---

## Strategic track (user-directed phases, renumbered after stabilization)

**On the `vX.Y.Z` in these headings (2026-09-11 audit).** These numbers were assigned when the
track was planned and have since been **consumed by other releases** — e.g. `v0.32.0` is
recorded in the ledger as "Stabilization completion", not M6. They are retained only to show
intended grouping, and are **not** bookings. Do not infer "next release" from them; the next
version is whatever the ledger says is unshipped — read the **Snapshot** line at the top of this
file for the current number rather than trusting a sentence that can rot.

### M5 — "AI companion" — **issue #236**
**State (2026-09-22): shipped — the LLM leg is in v0.65.0 (promoted to `main`, PR #304).** Profile
settings takes any OpenAI-compatible endpoint (`src/lib/aiProvider.ts`); the
companion answers with that model, grounded in the trip data, and falls back to
the deterministic router on ANY failure (no config, network, timeout, bad key,
malformed response), with an (LLM)/(offline) badge on every reply so the user
always knows which brain spoke. The key is device-local (localStorage), never
sent to YatraFlow servers. The drawer stays behind `VITE_AI_COMPANION=on` until
M8 unmounts it as the premium perk.

### M6 — "Together" (collaboration depth) — **issue #237**
Supabase integration/RLS test suite first (opt-in `VITE_RUN_INTEGRATION`,
~3h — old item #10), then live multi-user editing sync. Split-expense
settlement groundwork (payer tagging + balances card) shipped in v0.36.0;
M6 adds settlement refinement and co-editing depth on top. *(An earlier heading
promised a "multi-currency-free refinement"; no such work was ever scoped or built —
the budget and settlement maths are INR-only end to end, and `currency` appears nowhere
in them in `src/`.)*

**State (2026-09-21): every named item in the track has shipped.** The integration/RLS
suite landed in v0.61.0 (37/37 against the live database, presence probe included), and
the co-editing depth in v0.62.0 (**PR #265**) — B0 write integrity (the debounced flush
persists the snapshot captured at call time), B2 stale-update guard (server-derived
timestamp ledger + the `trips_touch_updated_at` trigger, applied live), B1 presence
(avatar row via Supabase presence channels), B3 remote-edit banner (keep-mine /
take-theirs), B4 mark-settled. A follow-up commit (`e5bba2a`, 2026-09-20) carried the
banner to the Board — until then `BoardView` opened the same stop editor with no conflict
surface — and made a socket-gap re-join replay the rows changed while away. The two
adjacent idea-bank rows followed: **I-6** (settlement acknowledgement + reminder) and
**I-7** (decision comments) in v0.64.0, then **I-19** (settled lines genuinely leave the
balances) and **I-16** (Trip DNA across devices) in v0.65.0 — so all four have left
the idea bank.

**The one thing M6 still owes is a two-account confirmation pass, not code.** The
manual-pass follow-up on presence needs two *distinct* accounts on one trip — presence
excludes your own session by design, so a second tab of the same account can never show
an avatar — and that check cannot run from the dev shell (no outbound HTTP), so it stays a
human step. Issue #237 closes when it is called done. Full build record and both
follow-up verdicts: [`docs/PLAN-TOGETHER-M6.md`](docs/PLAN-TOGETHER-M6.md).

### M7 — "Premium" (monetization) — **issue #238**

> Post-unlock value presentation (why the buy feels worth it) and the creator-growth-loop shape are researched with citations in `docs/commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md`; the buildable items were I-20…I-27, of which **I-20**, **I-21**, **I-22**, **I-15**, **I-9**, **I-10**, **I-11** and **I-13** have shipped (see the shipped record below) — I-23…I-27 remain in the bank.
Gateway integration (Razorpay fits INR), order/entitlement tables + webhook,
purchase state, unlock flow replacing placeholder toasts: **all shipped** — the
rail landed in v0.61.0 (PR #251) and its paywall is enforced server-side, and
the fee model landed 2026-09-21 (I-13), and the console's Analytics tab now reads the platform's
own books — gross, fee and net by week, charged per creator — through the admin-gated
`admin_revenue` RPC, closing the revenue row it had promised since v0.46.0. These surfaces also
have a local fixture at last (`scripts/seedCreatorFixture.mjs`: a creator, two priced
publications and five backdated sales, whose ledger figures `tests/earnings.test.ts` pins), so
the hub, the runs ledger and the publish editor can be rendered rather than only asserted.
What is genuinely still open here is not engineering: **F6 (#234)** — the CA call on the merchant of record — which is the
one row of this milestone no commit can close.

### M8 — 1.0 enablers → the 1.0 cut — **issue #239**
Offline-first (IndexedDB + service worker/PWA, ~4–6h), i18n (EN + HI, ~6–8h),
then the 1.0 release.

**Phase 1 — the installable shell — shipped in v0.65.0 (PR #304):** `public/manifest.webmanifest`
plus launcher icons (192 / 512 / a maskable tile / an opaque apple-touch-icon, generated
from the brand mark by a script kept in the repo), and a hand-rolled `public/sw.js` that
precaches the shell, serves navigations network-first with a cached-shell fallback, and is
registered only when `!isNative && import.meta.env.PROD`. **Phase 2 — offline read — shipped with it in v0.65.0:** an IndexedDB snapshot per
account (cleared on sign-out, written only from a clean hydrate), a cache-first boot that the
network rehydrate replaces when it lands, and an offline strip that names what is on screen
and when it was saved.

**Phase 3 — offline write (trip edits) — shipped with them in v0.65.0:**
`src/lib/writeQueue.ts` durably queues each trip edit BEFORE the network attempt (one
whole-trip snapshot per trip, newest wins), replays oldest-first on network return / boot /
native resume, drops each entry on a confirmed write, bounds retries at three with a loud
drop, clears the departing account's entries on sign-out, and treats a conflict
(collaborator change after the offline capture) as last-writer-wins with BOTH sides told.
Collaboration actions (votes, comments) still require the network; map tiles and fonts
stay uncached.

### M9 — Invites & onboarding — **issue #240** (exec plan: docs/PLAN-INVITES-ONBOARDING.md)
Creator invites (admins mint YF-… member/creator codes with audit + gate) →
referral (R2) → invite-only gate (R3, flagged). R1 ships creator invites and a
clean-slate creator onboarding (no demo seed + badge granted). Three releases on
one `platform_invites` entity — detailed execution guide in
[`docs/PLAN-INVITES-ONBOARDING.md`](docs/PLAN-INVITES-ONBOARDING.md).

---

## 🟣 UI-audit remediation — COMPLETE (32/32)

Full report: [`docs/UI_AUDIT.md`](docs/UI_AUDIT.md). All six batches shipped in
v0.23.0 (both P0s closed: F-28, F-01); narrative in the CHANGELOG. This
section remains the tracker of record per AGENTS rule 5 — reopened findings
get a row here again.

| Batch | Scope | Status |
|---|---|---|
| 1 | Theming & touch CSS (F-18–F-20, F-23–F-30) | ✅ `6a96914` |
| 2 | Shared primitives — `Field` label fix (~30 call sites) (F-01, F-03, F-11) | ✅ |
| 3 | Focus ring (17 selectors) + reduced-motion guard (F-12, F-17) | ✅ |
| 4 | A11y attributes & nav semantics (F-02, F-04–F-10) | ✅ |
| 5 | Form hygiene (F-13–F-16) | ✅ |
| 6 | URL state (tabs, Explore filters) + copy (F-21, F-22, F-31, F-32) | ✅ |
| 7 | Impeccable whole-app refinement pass (2026-09-18) — mobile topnav, timeline reorder, `.two-col` overflow, create-trip calendar occlusion, light-theme contrast, board peek transition, reduced-motion delays, keyboard focus for the ledgers, viewer affordances, role/casing leaks, profile save feedback. Snapshot `.impeccable/critique/2026-09-17T17-42-23Z__src-app-tsx.md` closed; narrative in the CHANGELOG | ✅ |
| 8 | Independent whole-app accessibility re-audit (2026-10-02) — `LocationInput` gains an `ariaLabel` so the create-trip stop and return-stop boxes announce a name instead of a bare combobox; the cover URL and Print's confirmed badge stop depending on a placeholder or a lone glyph. Contrast, reduced-motion, touch targets, icon set and form labelling were all re-measured; no contrast or motion defect survived verification | ✅ |

---
## Idea bank

**Everything not yet built, in one place.** Consolidates the former Backlog pool, Idea pool,
Suggestion-engine / Budget / Creator-hub idea tables (2026-09-11). If an idea is open, it is
here and nowhere else; if it shipped, it is a one-line entry in the record at the foot — never
a row in a table above.

**How to use it.** Pick from **Tier 1** when a milestone has slack. **Tier 2** items are real
but gated on a named dependency — do not start them early. When an item ships, delete its row
here and add it to the shipped record, in the same commit that lands it.

**A row is a claim, not a fact.** These rows arrived from brainstorm tables written on
2026-09-06 and were carried forward during the 2026-09-11 consolidation without being
re-checked against source — by which point v0.47.0 had quietly shipped at least one of them
(Safe-to-spend, which the README described accurately while this file still listed it as
unbuilt). **Before picking up a row, and before quoting one in a plan, confirm it against
`src/` first.** Pruning on ship is not enough; the drift happens *before* anyone notices.

### Tier 1 — ready to pick up (small, unblocked)

> **Resolved (2026-09-21):** "mark settled" shipped first as a RECORD on an expense line, because the card's fair share was the engine estimate split per head — dropping a settled line's credit while it still sat inside that estimate broke the zero-sum who-owes-whom maths. I-19 re-based the card onto the open lines, so a settled line now genuinely leaves both sides (shipped record below).

| # | Idea | Area | Effort | Note |
|---|---|---|---|---|
| I-1 | CSV export of expense lines | budget | 1 h | Client-side blob download from `trip.expenses`. |
| I-2 | Week-over-week spending insight | budget | 2 h | "Days 1–3 ran 18% hotter than days 4–5" — derived entirely from the existing `byDay` engine data. |
| I-3 | Recurring expense templates | budget | 2 h | One-click re-add of past lines ("Fuel top-up ₹3,000") from an expense-history chip row. |
| I-4 | Overspending alerts | budget | 2 h | Threshold notification when a day/category crosses its cap — plumbing already exists in `realtimeCore`. |
| I-5 | Category envelopes | budget | 3–4 h | Per-category cap (₹) with progress state on the "Where the money goes" bars + a cap editor on the category row. Pattern: YNAB. |
| I-8 | Monthly statements / invoice export | creator | 2–3 h | Downloadable per-month earnings summary, client-side from the payouts table. **Post-M7.** |
| I-23 | Publish-quality score | creator | 1 d | Checklist with nudges (cover photo, budget filled, notes density, preview-day choice) on the hub + Share tab. Ship, measure via I-22, then claim any lift (research §5). |
| I-25 | Buyer reviews | creator | 2 d | Post-purchase ratings on itineraries: schema (reviews table + RLS), policy question (purchase-gated?) first. Feeds conversion, creator feedback, and I-26. |
| I-27 | Hub presentation pass | creator | 1 d | KPI sparklines, activity feed ("Admin unlocked Spiti · 2h ago"), motion per `docs/MOTION-TOKENS.md`. The studio-dashboard pass over the existing Overview + Earnings. Research §5. |

### Tier 2 — blocked on a named dependency

| # | Idea | Blocked on | Note |
|---|---|---|---|
| I-12 | Price history | M7 (schema) | The BOOKS are already right — `purchase_orders.price_snapshot_inr` is written at checkout and copied to `entitlements.amount_paid_inr`, so no sale is re-priced by a later edit. What remains is the creator-facing trail of their own price changes; I-24 still reads from it. |
| I-14 | Payout method + KYC management | M7 (schema) | Bank/UPI + legal name + PAN on profiles — M7's biggest schema lift. |
| I-18 | `overdrive` on the four authored surfaces | the owner's direction pick | The v0.60.0 pass scoped `overdrive` for Landing/PlanBench, the Trip Ticket (Create Trip), the Overview hero and the public-itinerary editorial, and deliberately ran without it: the command's contract forbids writing code before 2–3 directions are presented and one is picked, and requires browser iteration plus a banner. Nothing overdrive-shaped has been built anywhere. |
| I-22 | Publication funnel UI | the benchmark (research §5) | Per-pub views→forks→sales funnel with preview→sale conversion, against a benchmark once measured. The instrumentation behind it has shipped — the `pub_events` log with `get_creator_funnel` and its retention prune — so what is left is the per-publication view itself and the benchmark to judge it against. |
| I-24 | Pricing assistant | I-12 price history | Per-day anchor ("6 days · ₹83/day"), the ₹99–499 band, and a price-change trail. |
| I-26 | Creator levels | I-25 reviews | Progress strip (portfolio, sales, ratings) with tier perks (Explore placement). |

### Tier 3 — milestone-shaped, tracked as tracks (not ideas)

These are not loose ideas but full tracks with their own sections above — listed here only so
the bank is a complete index of unbuilt work:

| Track | Where | State |
|---|---|---|
| Public route at `/i/<id>` with no hash hop (option B) | [#226](#open-issues) | **Deferred.** The address-bar patch already keeps `/i/<id>#/pub/<id>` crawler-readable, so previews no longer need it. It would still drop the function round-trip on every refresh — and the interim "Opening this itinerary…" page that goes with it — by serving the app at the path the crawler already reads. Needs coordinated app routing, Vercel shell delivery, legacy hash-link handling and refresh/Back/Forward coverage; must not redirect `/i/<id>` to itself or fetch a different deployment's shell |
| M6 — Together | [Strategic track](#m6--together-collaboration-depth--issue-237) | Every named item shipped — RLS suite (v0.61.0); co-editing depth (v0.62.0); I-6/I-7 (v0.64.0); I-19/I-16 (v0.65.0). Open: the two-account presence confirmation pass |
| M5 — AI companion | [Strategic track](#m5--ai-companion--issue-236) | Shipped in v0.65.0 (PR #304): LLM endpoint + offline fallback + badge; flag-off in prod until M8 |

| M7 — Premium | [Strategic track](#m7--premium-monetization--issue-238) | Shipped: the rail, entitlements and unlock flow landed in v0.61.0 (PRs #251/#259); issue #238 closed 2026-09-19. Open: F6 (#234) only |
| M9 — Invites & onboarding | [`docs/PLAN-INVITES-ONBOARDING.md`](docs/PLAN-INVITES-ONBOARDING.md) | R1 → R2 → R3; exec plan written |
| M10 — Day Planner (travel-clock engine) | [`docs/PLAN-DAY-PLANNER.md`](docs/PLAN-DAY-PLANNER.md) | Engine implemented through P1-G (Sep 13, 2026, per the plan doc’s §17 deltas); the map half — the travel clock drawn as living road labels (`lib/clockOverlay.ts`, 27 fixtures) — landed on `test` 2026-09-20 (**PR #262**, released in v0.63.0). Origin: fixes the short-trip suggestion silence (user feedback) and the 700-km-in-Day-1 gap — meals as fixed clock anchors, duration fatigue cap, derived drive days / night halts / defer proposals |
| M8 → 1.0 | [Strategic track](#m8--10-enablers--the-10-cut--issue-239) | Offline-first PWA, i18n EN+HI |

### Shipped from these sources — record, not backlog

Kept as one line each so the origin is traceable without re-listing the work as open.

- **Suggestion-engine brainstorm (16/16)** — all shipped, culminating in the Corridor Concierge
  engine (v0.41.0). Source: [`docs/SUGGESTION_ENGINE_BRAINSTORM.md`](docs/SUGGESTION_ENGINE_BRAINSTORM.md).
  Road-projected hit positions · two-pass segment assignment · geo-fuzzy candidate dedupe ·
  reason strings on cards · journey-clock segments · crew-aware fatigue cadence ·
  weather-joined ranking · time-based detour cost + on-way asymmetry · ratings in Google mode ·
  road personality · per-day detour budget · Trip DNA learning · crew-seeded corridor
  suggestions + story arcs + slack prompts · fuel-before-long-corridors advisory · opening hours
  in scoring.
- **CTI alignment deferrals (4/4)** — v0.47.0. Source:
  [`docs/redesign/ALIGNMENT.md`](docs/redesign/ALIGNMENT.md). In-map place search · map popup →
  Board/Timeline cross-links · per-decision route/budget impact panel + grounded assistant
  (`decisionGuide.ts`) · suggestions "why it fits" route-position copy (`reasonForSegmentHit`).
- **Old P4 nice-to-haves (5/5)** — v0.47.0. Explore pagination (12/page + Load more) · undo
  coverage (trip/member/expense/stop deletes) · feedback button (`mailto:` with version+route) ·
  trash + 30-day purge · debounced store writes (600 ms trailing coalescer + pagehide flush).
- **Profile & explore pool (5/5)** — v0.47.0. Source: the former "Idea pool" table. Full Profile field editing (`homeCity` / `languages` /
  `travelStyles` / `socialLinks`) · browser push notifications · route polylines on the map ·
  trash + 30-day purge · Explore pagination.
- **Creator hub (3)** — decision cost-impact editor + context field (v0.36.0) · Explore creator
  bios + newest sorting (v0.35.0 + v0.37.0) · creator hub Overview + Earnings pre-shape with
  projection view (v0.38.0).
- **Budget pool (2/2)** — v0.47.0, verified against source 2026-09-11. **Safe-to-spend per
  day** (`engine.ts:715` `safeToSpendPerDay` + `daysRemaining`, rendered as a `StatTile` at
  `BudgetTab.tsx:180`; counts today, clamps a finished trip to zero, returns null rather than a
  fake number when no target is set) · **greedy fewest-transfers settlement**
  (`BudgetTab.tsx:395`, surfaced at `:363`). Both were still listed as unbuilt in the Sep-6
  brainstorm table; the README had described the first correctly all along.
- **#36 bug-hunt triage (10/10)** — all landed; the survivors were spun out as issues and have
  since closed (see [Open issues](#open-issues) for what is actually live).
- **Map view modes (3/3, I-17/I-18/I-19)** — shipped together with the request that spawned them
  ([`docs/FEATURE-REQUEST-MAP-VIEWS.md`](docs/FEATURE-REQUEST-MAP-VIEWS.md)): default basemap →
  Liberty (I-17) · Terrain hillshade over the keyless AWS terrarium DEM (I-18) · 3D hero pitched
  terrain with `maxPitch` 60 → 75 (I-19), behind a segmented switcher on the Map tab; the Board
  stays hard-2D and the choice persists globally. I-19's mid-range-Android GPU check remains a
  post-merge device step.
- **Idea bank I-6 + I-7** — v0.64.0 (PR #270). **Settlement acknowledgement + reminder** (I-6): the
  per-line "mark settled" flag and settled history landed with M6 PR-B (v0.62.0), and the
  outstanding-total nudge over the open tagged lines completes the row · **Decision comments**
  (I-7): `decisions.comments` (`supabase/migrations/20260920_decision_comments.sql`, capability-probe
  gated like the party-prefs columns) with the same card language as suggestion comments.
- **Idea bank I-20 — the unlock moment and the owned library** — v0.65.0 (PR #304). Source:
  [`docs/commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md`](docs/commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md)
  §4. A purchase now lands on a full-screen reveal — the cover, the creator, and days / stops /
  planned km / the engine's rebuilt per-person budget computed from the itinerary the buyer just
  gained, plus the creator's tip count and a receipt of what was paid — with the fork CTA inside
  it; and **My purchases** (`#/purchases`, linked from My Trips): cover, creator, length, the
  entitlement's own price snapshot, purchase date, newest first, an update chip on any plan its
  creator has refreshed since (`refreshed_at`), a withdrawn publication kept as a "no longer
  listed" row instead of dropped, and a failed read shown as an error rather than "nothing bought
  yet". Both surfaces derive from one pure module (`src/lib/purchases.ts`). The build found and
  fixed a defect on the money path, unrelated to the shelf: the public page never re-read the
  itinerary after an unlock, so a buyer kept rendering the wire-stubbed pre-purchase copy —
  titles and coordinates over emptied days — until a manual reload.
- **Idea bank I-21 — the buyer's card** — v0.65.0 (PR #304). Source:
  [`docs/commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md`](docs/commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md)
  §4.5 ("buyers are the distribution channel"). `/i/<id>?buyer=<entitlement>` serves a
  buyer's variant of the share card — "I bought <plan>" over the plan's own days, budget and
  route, on the plan's own stored cover (or the brand card), reusing the shipped `api/i.js`
  pipeline rather than compositing a per-buyer image (no renderer sits behind the function, and
  an image making the purchase claim is the part that must be verifiable). The claim is verified
  rather than trusted: the new `owns_publication()` answers one boolean and the handler renders
  the framing only on a literal `true`, falling back to the creator's card for every other
  answer — the function absent (migration `20260921_purchase_share_card.sql` — its
  `owns_publication` RPC was probe-verified live on 2026-09-22, AGENTS §3), a timeout, a non-boolean
  body, or an id that is not a UUID. Offered on **My purchases** as a row action and, last and
  quietest, in the unlock reveal; withheld for a withdrawn plan, because unpublishing deletes the
  row and the link would preview as nothing.
- **Idea bank I-22 + I-15 — the funnel has something to read** — v0.65.0 (PR #304). Source:
  [`docs/commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md`](docs/commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md)
  §5. The bank named its own blocker ("the events do not exist to read yet") and was precise
  about which: `entitlements` rows are already dated, per-buyer and per-publication, so the SALE
  stage needed no new recording at all — a second copy would have been a second source of truth
  for the same sale. What could not be read was views and forks: `published_itineraries.views` /
  `.copies` are LIFETIME counters with no time dimension, they count different things (a view is
  deduped to one per browser session and skips the creator's own visits; a fork was a raw event
  count with neither), and they live on the row unpublishing deletes. So the recording landed:  `pub_events` (migration `20260921_pub_funnel_events.sql`, applied 2026-09-21), one dated row per step,
  written by the
  SAME function that moves the counter so the two cannot drift, holding `pub_id`, kind and time
  and nothing about a person. The Overview tab reads it per day through the creator-scoped
  `get_creator_funnel` and shows **Visits → Forks → Unlocks** over a 7/30/90-day window, each
  step with its conversion and each publication's own all-time totals beside it — the counters
  predate the log, so a window figure without its lifetime context is not a reading a creator
  can act on. Two things it refuses to pretend: the stages are not monotone, because a fork rate
  can honestly exceed 100% (Explore's card carries its own Fork CTA while a visit is counted once
  per session on the plan's own page), and a publication the log has never reported says exactly
  that instead of printing three zeroes that read as a measurement. The fork counter also stopped
  counting a creator forking their own plan — the view counter had always refused it, so the two
  stages had disagreed about who a reader is.
  Shipped since, as follow-ups: the plan's OWN public page shows its creator the same funnel over the last 7 days
  (one derivation and one window rule shared with the hub, so the two cannot disagree, and a visitor's session runs
  none of the reads); the counters-versus-log gap is a stated number with a one-sentence explanation on both surfaces,
  never negative, silent when aligned and silent on a failed read; and `pub_events` prunes itself past the reader's own
  730-day horizon (`20260922_pub_events_retention.sql` — apply, then run `select public.prune_pub_events();` once; the
  pg_cron schedule is the optional commented block), with the horizon pairing pinned in the RLS contract test. The
  fixture's plumbing moved to `scripts/fixtureKit.mjs` so the next session-gated surface seeds from the same harness.
- **The console can read the platform's own books** — v0.65.0 (PR #304). Source: the Analytics tab's
  own promise since v0.46.0 ("the revenue row … is still to come here"), now deleted. Entitlements
  are owner-scoped by RLS and deliberately absent from the hydrated cache, so the platform's cut
  had no client-side source and needed a read of its own: the admin-gated `admin_revenue` RPC
  (migration `20260921_admin_revenue.sql` — function-only, so `check:migrations` declares rather
  than probes it, AGENTS §3.2; confirm it is applied on a credentialed machine, since the code
  has now reached production) returns facts only — when, how much, which publication,
  which creator — and never a buyer, because revenue reporting needs amounts, dates and payees
  rather than identities. The client applies the fee ladder **once per creator** through the same
  `buildSalesLedger` a creator's own earnings tab uses, so the platform's cut IS the sum of the
  creators' charges and the two figures cannot drift; one ladder over the platform's total would
  understate the cut, since that total crosses ₹25,000 long before most creators' do. The tab
  shows gross / platform fee / creator net / sales over one row per weekly run, and it reports a
  failed read rather than a ₹0 it cannot vouch for.
- **Idea bank I-9 + I-10 + I-11 + I-13 — the fee stopped being a placeholder** — v0.65.0 (PR #304). Source:
  [`docs/commercial/PLAN-MONETISATION.md`](docs/commercial/PLAN-MONETISATION.md) §11 (decision-table row 2,
  "confirm 15%") and §4.2. The platform fee is real: a MARGINAL ladder over a creator's lifetime gross —
  15% to ₹25,000, then 10% — as `PLATFORM_FEE_TIERS` in `src/lib/earnings.ts`, chosen because 15% is the
  number the plan asked to confirm and it has to clear the 2–3% processing floor to be worth charging.
  Per-sale fees are attributed oldest-first, so the sale that carried the gross over the line is the one
  that gets the cheaper rate, and every total is the sum of its rows rather than the ladder applied to the
  total — a ledger has to add up the way a reader checks it. The hub gained the fee column I-13 promised, a
  **Gross/Net** switch for the headline figures (I-10) and a payout card (I-9) naming the next Friday run,
  the ₹500 minimum, and what would clear — including the part that is not built: payout RUNS are not
  automated (no payouts table, no gateway payout API), so the card names the balance a run would disburse
  rather than implying money is in transit. The final ledger anatomy ships with it as **Payout runs**
  (`payoutPeriods()`): one derived row per Friday run (Date/period · Sales · Gross · Fee · Net · Status)
  that reuses the per-sale fee attribution and adds up to the ledger exactly, with a status that never
  claims money was sent — `Scheduled`, `Owed — not disbursed`, or `rolls over` under the minimum. And the
  publish editor's price field now states the split where the decision is made (`netOfFeeInr`), as a floor
  because a price alone cannot know a lifetime gross. I-11's per-publication attribution had shipped already.
- **Idea bank I-19 + I-16** — v0.65.0 (PR #304). **Settled lines genuinely leave the
  balances** (I-19): the card's fair share is now the open *tagged* lines over the
  travellers, credited to whoever fronted those same lines, so the rows net to zero and
  settling every line leaves every row at zero — the re-base the 2026-09-19 heads-up above
  called for, taken as a product call (the estimate keeps its place in the metric strip).
  *Watch the number:* this is the idea bank's I-19, **not** the map-view request's I-19
  (`docs/FEATURE-REQUEST-MAP-VIEWS.md` has its own I-17–I-19 numbering) · **Trip DNA
  across devices** (I-16): `public.user_dna` — one row per user, the PK *is* the owner,
  owner-only RLS on all four verbs (`supabase/migrations/20260921_user_dna.sql`, **applied
  live 2026-09-21 and probe-verified**), read once per hydrate and written back debounced, with the merge a
  de-duplicated union so a sync cannot double a count.
- **Idea bank I-17 — the selection and the caret join the theme** — `v0.66.0`. Source: the
  Tier 1 row itself ("the last unthemed browser surfaces", found while scoping v0.60.0's
  craft-floor pass). `::selection` paints theme ink on the soft teal tint (`--teal-soft` +
  `--text` — #E5F4EE/#0B2545 light, #12332F/#ECF1F8 dark: 13.56:1 / 12.01:1, computed), and
  `caret-color: var(--teal-deep)` rides `:root` so every editable surface inherits the brand
  teal — one appended block in `styles.css`, both declarations resolving per theme. The row's
  own caveat about the baseline's line-keyed entries predates the text-key migration and no
  longer applies.

## Historical plans (executed — kept for the record, not live guidance)

- [implementation plan for v0.23.0 + the CTI redesign](docs/history/implementation-plan-v0.23.0-cti.md)
  — all milestones shipped (M0–M7 + polish passes); superseded by this file.
- [docs/REPORT-2026-08-29-nearby-rework-and-google-maps.md](docs/REPORT-2026-08-29-nearby-rework-and-google-maps.md)
  — shipped in 0.17.0.
- The old phased plan (AI/Together/Premium/1.0) is preserved as the strategic
  track above; the old P0–P4 lettered sections are merged into M0–M4 and the
  idea bank.

---

## Working agreement (see [AGENTS.md](AGENTS.md))

- Every push ships a CHANGELOG entry; releases bump `package.json` + README.
- `npm run verify` before every push; bare commands only (no `cmd /c`).
- Milestones release on `redesign/**`; all-done → PR to `test`; `main` only
  with the user's explicit confirmation.
- Stage explicit paths — never `git add -A` in a shared working copy.
- Update this file (and the UI-audit tracker) in the same commit as the work;
  when ticking tracker rows, update progress lines in the same edit.