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

Verified 2026-09-11 against the GitHub API. **Seven open issues, all with priority labels** —
this section exists because an earlier revision of this file asserted M5 was "the only open
issues" while none of these seven appeared anywhere in it.

| # | Priority | Area | Issue |
|---|---|---|---|
| #89 | **P1** | bug, a11y | Trash "Delete forever" has no confirmation or undo |
| #84 | P2 | bug, a11y | Notifications list capped at 12 with no way to reach older items |
| #85 | P2 | a11y | `warn` text on saffron/amber tints fails WCAG AA in light theme (5 surfaces) |
| #87 | P2 | a11y | ARIA tablist semantics implemented inconsistently across 3 surfaces |
| #88 | P2 | a11y | Create-trip cover image URL input is unlabelled |
| #90 | P2 | a11y | Notification badge fails WCAG contrast (white on saffron ~2:1) |
| #86 | P3 | ui | Profile page has an empty 340px right column (single child in two-col grid) |

**#89 is the one to look at first.** It is the only P1: `TripsList.tsx:129` calls
`permanentlyDeleteTrip` straight from an `onClick` with no confirm dialog and no undo, so a
single stray tap in the Trash view destroys a trip irreversibly. The label scheme
([AGENTS.md](AGENTS.md) §2) defines P1 as "real correctness or user-visible bug with a
workaround — fix this milestone"; an irreversible one-tap delete is arguably P0-grade
(data loss) and deserves a re-triage against the written definitions rather than by gut.

The five a11y issues (#84, #85, #87, #88, #90) plus #86 are all narrow, low-risk surfaces —
good candidates to sweep as one batch rather than one release each.

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

## Backlog pool (pull into any milestone with slack)

**Audited 2026-09-11.** This pool and the two idea pools below had accumulated 26 rows marked
"✅ shipped" — work that had already landed, sitting in sections whose purpose is to list work
*ahead*. Those rows moved to the shipped record at the foot of each table. What follows is
genuinely open.

*From the CTI alignment deferrals ([docs/redesign/ALIGNMENT.md](docs/redesign/ALIGNMENT.md)) —
must enter this pool in the same commit they're deferred:*

**All four CTI deferrals have shipped** (v0.47.0): in-map place search, map popup →
Board/Timeline cross-links, per-decision route/budget impact panel + grounded assistant, and
suggestions "why it fits" route-position copy. Nothing open from this source.

*From the #36 bug-hunt triage (Sep 2026):* nothing remaining — all 10 findings landed; see the
CHANGELOG for the per-issue landing. (#38–#49 all closed; the survivors were spun out as issues
and are listed under [Open issues](#open-issues).)

*Old P4 nice-to-haves:* nothing open. All five landed in v0.47.0 (Explore pagination, undo
coverage, feedback button, trash + 30-day purge, debounced store writes).

---

## Idea pool (Sep 6 brainstorm — unprioritized, pull into any milestone)

| Idea | Note |
|---|---|
| Decision comments | needs a `comments` JSON column on decisions (schema migration) |
| Premium purchase state | entitlements + unlock flow — folds into M7 payments |
| Waitlist / invites (M9) | creator invites → referral → invite-only gate — full exec plan in [`docs/PLAN-INVITES-ONBOARDING.md`](docs/PLAN-INVITES-ONBOARDING.md) |

*(Shipped from this pool, all v0.47.0: full Profile field editing — `homeCity` / `languages` /
`travelStyles` / `socialLinks`; browser push notifications — local Notification API, opt-in,
dedupe vs read flag, background-tab only; route polylines on the map — `MapRoute` + `routePath`
render OSRM geometry; trash + 30-day purge — soft-delete + Trash view + purge RPCs
(`20260910_trip_trash{,_rpc}.sql`); Explore pagination — 12-per-page grid + Load more.)*

### 🧭 Suggestion-engine ideas (Sep 6 2026 deep brainstorm → [docs/SUGGESTION_ENGINE_BRAINSTORM.md](docs/SUGGESTION_ENGINE_BRAINSTORM.md))

**Everything in this brainstorm has shipped** — all 16 items, culminating in the Corridor
Concierge engine (v0.41.0). Nothing open. The one schema-gated remainder is called out below,
because it is the only thing a future reader could mistake for unfinished:

| Idea | Note |
|---|---|
| Cross-device Trip DNA persistence | The engine itself is done (category mix, detour tolerance, stop length, cross-trip device learning). What remains is **persistence**: `user_dna` table + RLS so the profile survives a device change. Deliberately parked on M6/M7 infra — it is not a gap in the engine. |

*(Shipped from this brainstorm: road-projected hit positions, two-pass segment assignment,
geo-fuzzy candidate dedupe, reason strings on cards, journey-clock segments, crew-aware fatigue
cadence, weather-joined ranking, time-based detour cost + on-way asymmetry, ratings in Google
mode, road personality, per-day detour budget, Trip DNA learning, crew-seeded corridor
suggestions + story arcs + slack prompts, fuel-before-long-corridors advisory, opening hours in
suggestion scoring.)*

### 💰 Budget ideas (web research, Sep 6 2026 — sources: YNAB/envelope patterns, budgeting-app UX guides)

| Idea | Pattern source | Note / effort |
|---|---|---|
| Safe-to-spend per day | per-day allowance trend | `remaining ÷ days left` next to the per-day bars — v0.36's bars already attribute everything; this is one derived tile. 1–2 h |
| Category envelopes | YNAB | per-category cap (₹) with progress state on the "Where the money goes" bars; cap editor on the category row. 3–4 h |
| Overspending alerts | budget-app alert patterns | threshold notification when a day/category crosses its cap (plumbing exists in realtimeCore). 2 h |
| Recurring expense templates | expense-tracker patterns | one-click re-add of past lines ("Fuel top-up ₹3,000") from an expense history chip row. 2 h |
| Week-over-week spending insight | spending-insights dashboards | "Days 1–3 ran 18% hotter than days 4–5" — derived entirely from the existing byDay engine data. 2 h |
| Settlement reminders + mark paid | Splitwise | balances card gains "mark settled" + a nudge; needs the payer model to persist who acknowledged (M6 adjacency). 3 h |
| CSV export of expense lines | finance-app staple | client-side blob download from `trip.expenses`. 1 h |

### 🟣 Creator hub ideas (web research, Sep 6 2026 — sources: Gumroad payouts, Twitch payout history, Patreon earnings, X creator dashboard)

| Idea | Pattern source | Note / effort |
|---|---|---|
| Payout-schedule card | Gumroad/Twitch | "Next payout: Friday · clears ₹X once payments live" — the Earnings tab's `Next payout —` tile grows a date + threshold explainer with M7. 2 h (with M7) |
| Gross vs net split | Patreon | ledger rows already carry the columns; M7 adds the fee model + a gross/net toggle. — (M7) |
| Per-publication revenue attribution | Gumroad | sale rows join on `pub_id`; the Overview rows gain a "earned" figure. — (M7) |
| Price history | accounting need | `premiumPriceInr` is overwritten on publish; M7 needs a per-sale price snapshot (or price-history rows) for correct books. schema (M7) |
| Unlock conversion funnel | creator-analytics pattern | views → premium unlocks per publication; needs entitlement events from M7 first. — (post-M7) |
| Monthly statements / invoice export | Gumroad | downloadable per-month earnings summary (client-side from the payouts table). 2–3 h (post-M7) |
| Tiered platform fee | X's 90%-tier model | fee % drops above a lifetime-earnings threshold — a M7 pricing decision, surfaced in the fee column. — (M7 decision) |
| Payout method + KYC management | Gumroad payout settings | bank/UPI + legal name + PAN on profiles — M7's biggest schema lift. — (M7) |

*(Done from this pool: decision cost-impact editor + context field, v0.36.0; Explore creator bios + newest sorting, v0.35.0 + v0.37.0; creator hub Overview + Earnings pre-shape with projection view, v0.38.0.)*

## Historical plans (executed — kept for the record, not live guidance)

- [implementation plan for v0.23.0 + the CTI redesign](docs/history/implementation-plan-v0.23.0-cti.md)
  — all milestones shipped (M0–M7 + polish passes); superseded by this file.
- [docs/REPORT-2026-08-29-nearby-rework-and-google-maps.md](docs/REPORT-2026-08-29-nearby-rework-and-google-maps.md)
  — shipped in 0.17.0.
- The old phased plan (AI/Together/Premium/1.0) is preserved as the strategic
  track above; the old P0–P4 lettered sections are merged into M0–M4 and the
  pool.

---

## Working agreement (see [AGENTS.md](AGENTS.md))

- Every push ships a CHANGELOG entry; releases bump `package.json` + README.
- `npm run verify` before every push; bare commands only (no `cmd /c`).
- Milestones release on `redesign/**`; all-done → PR to `test`; `main` only
  with the user's explicit confirmation.
- Stage explicit paths — never `git add -A` in a shared working copy.
- Update this file (and the UI-audit tracker) in the same commit as the work;
  when ticking tracker rows, update progress lines in the same edit.
