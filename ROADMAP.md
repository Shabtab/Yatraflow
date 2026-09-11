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

**Snapshot (2026-09-11, verified against the repo):** `origin/main` and `test` are both at
v0.48.0 — `test` no longer trails. Several docs commits sit ahead of `main` on `test`, pending
PR #93. Current version: **0.48.0**.

**Live open work is tracked in two places, and this file must agree with both:**

1. **The issue queue** — see [Open issues](#open-issues) below for the current list, which is
   derived from the GitHub API rather than recalled. Seven issues are open (#84–#90); M5 is
   **not** the only outstanding work, as earlier revisions of this file claimed.
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

Verified 2026-09-11 against the GitHub API, then **each issue checked against current source**
(see the "Relevance" column — a title is not evidence that a problem still exists).

| # | Priority | Area | Issue | Relevance |
|---|---|---|---|---|
| #89 | **P1** | bug, a11y | Trash "Delete forever" has no confirmation or undo | **Confirmed** — `TripsList.tsx:129` |
| #84 | P2 | bug, a11y | Notifications list capped at 12 with no way to reach older items | **Confirmed** — `App.tsx:414` |
| #85 | P2 | a11y | `warn` text on saffron/amber tints fails WCAG AA in light theme (5 surfaces) | **Confirmed — 3.48:1** |
| #87 | P2 | a11y | ARIA tablist semantics inconsistent across 3 surfaces | **Confirmed** — 4 patterns |
| #88 | P2 | a11y | Create-trip cover image URL input is unlabelled | **Confirmed** — `CreateTrip.tsx:719` |
| #90 | P2 | a11y | Notification badge fails WCAG contrast (white on saffron ~2:1) | **Confirmed — 2.14:1** |
| #86 | P3 | ui | Profile page has an empty 340px right column (single child in two-col grid) | **⚠️ Stale — verify and close** |

**Relevance evidence (2026-09-11).** Each was opened against the code, not accepted on its title:

- **#89** — `TripsList.tsx:129` renders `Delete forever` and `Restore` **side by side in the same
  row**, both `btn-sm`, with no confirm on the destructive one. A reversible and an irreversible
  action at identical size and adjacency. The only P1; the label scheme defines P1 as "with a
  workaround", while an irreversible one-tap delete of user data matches the **P0** definition
  ("data loss/corruption") — worth a re-triage read against the written definitions.
- **#85** — `.chip-saffron` is `color: var(--warn)` on `var(--saffron-soft)`. Computed: light
  `#B47207` on `#FCF0DC` = **3.48:1** (AA needs 4.5) → fails. Dark = 5.81:1 → passes, so the
  issue's light-theme-only scoping is exactly right.
- **#90** — white on saffron = **2.14:1** light, 1.97:1 dark. The issue's "~2:1" is accurate.
- **#84** — `App.tsx:414` `notifs.slice(0, 12)` inside a `maxHeight:320, overflowY:auto` box with
  **no view-all or pagination**. The scroll affordance implies completeness while silently
  truncating — arguably worse than a visible cap.
- **#87** — four surfaces set `role="tablist"`, but three (`AdminPage`, `Auth`, `TripWorkspace`)
  pair it with `aria-pressed` and set no `aria-selected`; only `TripWorkspace` also sets
  `aria-selected` + `id`. `aria-pressed` on `role="tab"` is the wrong pairing.
- **#88** — `CreateTrip.tsx:719` has a `placeholder` but no `aria-label`, `<label>`, or
  `htmlFor`. Sitting inside a `<Field>` wrapper does not give the control an accessible name.
- **#86 ⚠️** — the premise no longer holds. `Profile.tsx`'s second column now contains **four**
  cards (Creator hub, Save details, Notifications, About your data). `.two-col` is still
  `1fr 340px` (`styles.css:1807`), but the column is not empty. Most likely fixed by `a8f53ff`
  (notifications opt-in card, v0.47.0). **Verify and close** — left open here because closing an
  issue needs authentication, which was unavailable.

The five a11y issues (#84, #85, #87, #88, #90) are all narrow, low-risk surfaces — good
candidates to sweep as one batch rather than one release each. **#85 and #90 are both
saffron-contrast failures and should be fixed together**, since a change to the warn/saffron
pairing affects both.

**Defect found while auditing this file — not yet filed:** the M0 seed guard below was never
implemented (see the M0 entry). `store.ts:600` seeds demo trips whenever `tripList` is empty,
with no check on whether the trips query *failed*; `partial` is built up but consulted only for
a toast at line 595. A flaky-connection sign-in therefore injects demo trips into a real
account — the accumulation trap M0 warned about. This is a code fix on an auth path and is
**deliberately not bundled into a docs pass**; it belongs in its own issue and commit.

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

### Remaining — in release order (details in the tracks below)
- [x] **v0.45.0** — Create-flow + invites + settings release (PR #81 + merged test work): Trip Ticket bento starter (bill print, outline seeding), car rental mode + local-train fares, range calendar, invite short codes + join-flow fixes, auth-refresh fix, Plan Bench trip settings + editable dates, My Trips search/filter/sort restore (branch `feat/create-trip-ticket`)
- [x] **v0.46.0** — Masteradmin console (PR #82): JWT-`app_metadata`-gated `#/admin` god-view (users/trips/invites/content/analytics/audit), audited SECURITY DEFINER RPCs, append-only `admin_audit` log, RESTRICTIVE deny policies for disabled accounts (branch `redesign/masteradmin-v045`, migration applied live)
- [x] **v0.32.0** — Stabilization completion: M0 leftovers (broken `pub:` route, router ready-gate for deep links / invite flash / loading-vs-empty) + M2 remainders (Profile save validation, demo-copy honesty, heading outline) + M1 leftovers (focus-ring gaps, touch targets, stagger freeze). **Note:** this is the row that consumed the `v0.32.0` number also claimed by M6's heading; the M0 **seed guard** was *not* part of it (see M0).
- [x] **v0.36.0** — Budget + Group-input deep redesign: metric strip, per-day cost bars, payer balances + settlement, quick-add + in-place expense editing, who-voted tallies + needs-you digest, real composer pickers; `bump_published_stats` uuid→text fix, view dedupe, unpublish owner gate (branch `redesign/budget-group`)
- [x] **v0.37.0** — Creator release: public creator page `#/creator/:id`, publications manager with stats/edit/unpublish + stale-page nudge (`refreshed_at` migration), Explore newest sort, shared PubCard/forkPublication paths (local branch `redesign/creator-page` until pushed)
- [x] **v0.38.0** — Creator hub: My publications splits into Overview (lifetime KPIs + manager rows) | Earnings (Gumroad-shaped payouts ledger, honestly empty + labeled projection view via `projectEarnings`); M7 earnings contract documented in ARCHITECTURE (local branch `redesign/creator-hub`)
- [x] **v0.39.0** — Hard-surface pass (full skills-based review, ~70 findings): 5 HIGH fixes (Landing dark-mode bands, AA hero CTA, StopEditor phantom token, CreateTrip `--accent`, ₹₹ double-symbol), one lucide icon language workspace-wide, global tabular-nums utility, tabpanel/aria-pressed/focus-ring/hit-target a11y, one card-header + chip + fork-CTA grammar, dead code purge (local branch `redesign/hard-surface`)
- [x] **M3** — Performance architecture: store immutability → slice selectors → DaySection memo → workspace split into pages/trip/* + weather dedup + lazy routes (in [Unreleased], local branch redesign/perf-architecture)
- [x] **M4** — Design-system hygiene: dead CSS purge, mobile-block consolidation, glass/z-index tokens (in [Unreleased], local branch redesign/perf-architecture; raw-rgba glass stragglers intentionally NOT migrated — see commit `f646b45`)
- [ ] **M0 defect** — seed guard: skip demo seeding when hydration had query errors (`store.ts:600`, detail in [Open issues](#open-issues))
- [ ] **M5** — AI companion: user-configurable LLM endpoint (#22 → #20) — the only milestone that **has** open issues behind it (not the only open work; see [Open issues](#open-issues))
- [ ] **M6** — Together: integration test suite, live co-editing depth, split expenses
- [ ] **M7** — Premium: payment gateway, entitlements, unlock flow
- [ ] **M9** — Invites & onboarding: creator invites (R1) → referral (R2) → invite-only gate (R3); three releases on `platform_invites`, exec plan in [`docs/PLAN-INVITES-ONBOARDING.md`](docs/PLAN-INVITES-ONBOARDING.md). *Added to the ledger 2026-09-11 — it previously existed only as a track section, so it was invisible to any pending list derived from these checkboxes.*
- [ ] **1.0 (M8)** — offline-first/PWA, i18n (EN+HI), the 1.0 cut → then PR to `test`

---

## Stabilization track — COMPLETE (M0–M4 landed; see the ledger)

**Status note (2026-09-11 audit).** This track shipped across v0.26.0–v0.39.0 and the
`redesign/*` branches; the ledger above carries the release rows. The bullets below are kept as
the **record of what was fixed** — they were written as a live to-do list and are now the
historical description, so read them in past tense. **One item was never implemented** and is
called out inline.

### M0 — "Trust & navigation" (P0 bugs)
Small diffs, outsized trust impact. Five of six items landed in the v0.26.0/v0.32.0
stabilization releases; **the seed guard did not** (see the ⚠️ below):
- ✅ **"View public page" was a broken route** — `TripWorkspace.tsx` emitted `pub:<id>`, the
  router splits on `/` → landed on Landing, so publishers could never reach their own published
  page. Fixed.
- ⚠️ **Failed hydration fakes an empty state and re-seeds demo data — NOT DONE.** `store.ts`
  logs query errors, then seeds on `tripList.length === 0`, so a network failure injects
  duplicate demo trips (the accumulation trap from the Sep DB prune — AGENTS §5). The **retry
  banner** half shipped (`partial` → toast at `store.ts:595`), but the **"skip seeding when any
  query errored"** half never did: `store.ts:600` still seeds without consulting `partial`.
  This is the audit's headline defect — tracked as a live item, not a closed one. See
  "Defect found while auditing this file" above.
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
version is whatever the ledger says is unshipped, and today that is `0.48.0` + 1.

### M5 — "AI companion" (issues #22 → #20; the next feature to build)
User-configurable OpenAI-compatible endpoint (Profile settings,
`src/lib/aiProvider.ts`), real LLM answers with the deterministic router kept
as offline fallback + "(LLM)/(offline)" badge. #22 (~2h) blocks #20 (~3h).
This is the **only milestone with open issues behind it** — which is not the same as being
"the only open work": see [Open issues](#open-issues) for the seven a11y/bug items.

### M6 — "Together" (collaboration depth)
Supabase integration/RLS test suite first (opt-in `VITE_RUN_INTEGRATION`,
~3h — old item #10), then live multi-user editing sync. Split-expense
settlement groundwork (payer tagging + balances card) shipped in v0.36.0;
M6 adds the multi-currency-free refinement and co-editing depth on top.

### M7 — "Premium" (monetization)
Gateway integration (Razorpay fits INR), order/entitlement tables + webhook,
purchase state, unlock flow replacing placeholder toasts. Needs an external
gateway account. Deliberately after M6's test-suite groundwork.

### M8 — 1.0 enablers → the 1.0 cut
Offline-first (IndexedDB + service worker/PWA, ~4–6h), i18n (EN + HI, ~6–8h),
then the 1.0 release.

### M9 — Invites & onboarding (exec plan: docs/PLAN-INVITES-ONBOARDING.md)
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

| # | Idea | Area | Effort | Note |
|---|---|---|---|---|
| I-1 | CSV export of expense lines | budget | 1 h | Client-side blob download from `trip.expenses`. |
| I-2 | Week-over-week spending insight | budget | 2 h | "Days 1–3 ran 18% hotter than days 4–5" — derived entirely from the existing `byDay` engine data. |
| I-3 | Recurring expense templates | budget | 2 h | One-click re-add of past lines ("Fuel top-up ₹3,000") from an expense-history chip row. |
| I-4 | Overspending alerts | budget | 2 h | Threshold notification when a day/category crosses its cap — plumbing already exists in `realtimeCore`. |
| I-5 | Category envelopes | budget | 3–4 h | Per-category cap (₹) with progress state on the "Where the money goes" bars + a cap editor on the category row. Pattern: YNAB. |
| I-6 | Settlement acknowledgement + reminder | budget | 2 h | Balances card gains a "mark settled" flag and a nudge. The settlement *engine* already runs (`BudgetTab.tsx:363`) and `Expense.paidBy` already drives balances — only the acknowledgement state and its reminder are missing. **Adjacent to M6.** |
| I-7 | Decision comments | collaboration | schema | Needs a `comments` JSON column on decisions (migration) — `StopSuggestion` has one, `TripDecision` does not (`types.ts:226` vs `:244`). |
| I-8 | Monthly statements / invoice export | creator | 2–3 h | Downloadable per-month earnings summary, client-side from the payouts table. **Post-M7.** |

### Tier 2 — blocked on a named dependency

| # | Idea | Blocked on | Note |
|---|---|---|---|
| I-9 | Payout-schedule card | M7 | "Next payout: Friday · clears ₹X once payments live" — the Earnings tab's `Next payout —` tile grows a date + threshold explainer. |
| I-10 | Gross vs net split | M7 | Ledger rows already carry the columns; M7 adds the fee model + a gross/net toggle. |
| I-11 | Per-publication revenue attribution | M7 | Sale rows join on `pub_id`; Overview rows gain an "earned" figure. |
| I-12 | Price history | M7 (schema) | `premiumPriceInr` is overwritten on publish; correct books need a per-sale price snapshot or price-history rows. |
| I-13 | Tiered platform fee | M7 (decision) | Fee % drops above a lifetime-earnings threshold — a pricing decision, surfaced in the fee column. Pattern: X's 90%-tier model. |
| I-14 | Payout method + KYC management | M7 (schema) | Bank/UPI + legal name + PAN on profiles — M7's biggest schema lift. |
| I-15 | Unlock conversion funnel | M7, then events | Views → premium unlocks per publication; needs entitlement events from M7 first. |
| I-16 | Cross-device Trip DNA persistence | M6/M7 infra | The engine is **done** (category mix, detour tolerance, stop-length dims, cross-trip device learning). What remains is persistence: a `user_dna` table + RLS so the profile survives a device change. Deliberately parked on infrastructure, not an engine gap. |

### Tier 3 — milestone-shaped, tracked as tracks (not ideas)

These are not loose ideas but full tracks with their own sections above — listed here only so
the bank is a complete index of unbuilt work:

| Track | Where | State |
|---|---|---|
| M5 — AI companion | [Strategic track](#m5--ai-companion-issues-22--20-the-next-feature-to-build) | Next up; issues #22 → #20 |
| M6 — Together | [Strategic track](#m6--together-collaboration-depth) | RLS test suite, co-editing |
| M7 — Premium | [Strategic track](#m7--premium-monetization) | Blocked: needs a gateway account |
| M9 — Invites & onboarding | [`docs/PLAN-INVITES-ONBOARDING.md`](docs/PLAN-INVITES-ONBOARDING.md) | R1 → R2 → R3; exec plan written |
| M8 → 1.0 | [Strategic track](#m8--10-enablers--the-10-cut) | Offline-first PWA, i18n EN+HI |

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
- **#36 bug-hunt triage (10/10)** — all landed; the survivors were spun out as issues, now in
  [Open issues](#open-issues).

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
