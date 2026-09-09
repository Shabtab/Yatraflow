# YatraFlow — Master Roadmap

The single plan of record. Every roadmap, phase and tracked backlog now lives
here — merged from the phased plan (Sep 2026), the executed v0.23.0/CTI
implementation plan, the CTI alignment deferrals, the completed UI-audit
tracker, and the Sep 2026 comprehensive review (CSS / React / UX audits).

Living document — reviewed each session, updated as items land. Done items
move to [CHANGELOG.md](CHANGELOG.md); this file only tracks what's ahead.

**Release protocol:** every milestone below ships as a **release on
`redesign/calm-travel-intelligence`** — version bump (`package.json` +
lockfile), CHANGELOG entry, README update when feature-worthy, `npm run verify`
green, both themes QA'd, user confirmation before any push. When **all
milestones** are done, the branch progresses to `test` **via pull request**
(never a direct push). `main` merges stay explicitly user-gated (AGENTS rule 1).

**Snapshot (2026-09-05):** v0.31.0 on `main`. The M0–M5 version labels below
decoupled from reality when v0.26–v0.31 shipped different content (Plan Bench
redesign, v0.27 interface pass, the #43–#52 store sweep) — the ledger tracks
**content**, not those labels. Current version: **0.31.0** → in flight:
**v0.32.0 (stabilization completion)** on local `redesign/stabilization-v032`.

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
- [x] **v0.32.0** — Stabilization completion: M0 leftovers (broken `pub:` route, router ready-gate for deep links / invite flash / loading-vs-empty) + M2 remainders (Profile save validation, demo-copy honesty, heading outline) + M1 leftovers (focus-ring gaps, touch targets, stagger freeze)
- [x] **v0.36.0** — Budget + Group-input deep redesign: metric strip, per-day cost bars, payer balances + settlement, quick-add + in-place expense editing, who-voted tallies + needs-you digest, real composer pickers; `bump_published_stats` uuid→text fix, view dedupe, unpublish owner gate (branch `redesign/budget-group`)
- [x] **v0.37.0** — Creator release: public creator page `#/creator/:id`, publications manager with stats/edit/unpublish + stale-page nudge (`refreshed_at` migration), Explore newest sort, shared PubCard/forkPublication paths (local branch `redesign/creator-page` until pushed)
- [x] **v0.38.0** — Creator hub: My publications splits into Overview (lifetime KPIs + manager rows) | Earnings (Gumroad-shaped payouts ledger, honestly empty + labeled projection view via `projectEarnings`); M7 earnings contract documented in ARCHITECTURE (local branch `redesign/creator-hub`)
- [x] **v0.39.0** — Hard-surface pass (full skills-based review, ~70 findings): 5 HIGH fixes (Landing dark-mode bands, AA hero CTA, StopEditor phantom token, CreateTrip `--accent`, ₹₹ double-symbol), one lucide icon language workspace-wide, global tabular-nums utility, tabpanel/aria-pressed/focus-ring/hit-target a11y, one card-header + chip + fork-CTA grammar, dead code purge (local branch `redesign/hard-surface`)
- [x] **M3** — Performance architecture: store immutability → slice selectors → DaySection memo → workspace split into pages/trip/* + weather dedup + lazy routes (in [Unreleased], local branch redesign/perf-architecture)
- [x] **M4** — Design-system hygiene: dead CSS purge, mobile-block consolidation, glass/z-index tokens (in [Unreleased], local branch redesign/perf-architecture; raw-rgba glass stragglers intentionally NOT migrated — see commit `f646b45`)
- [ ] **M5** — AI companion: user-configurable LLM endpoint (#22 → #20) — the only open issues
- [ ] **M6** — Together: integration test suite, live co-editing depth, split expenses
- [ ] **M7** — Premium: payment gateway, entitlements, unlock flow
- [ ] **1.0 (M8)** — offline-first/PWA, i18n (EN+HI), the 1.0 cut → then PR to `test`

---

## Stabilization track (from the Sep 2026 review — before new features)

### M0 — v0.26.0 "Trust & navigation" (P0 bugs, ~half a day)
Small diffs, outsized trust impact. Cut the pending `[Unreleased]`
(demo-seed revert) together with these:
- **"View public page" is a broken route** — `TripWorkspace.tsx` emits
  `pub:<id>`, the router splits on `/` → lands on Landing. Publishers can
  never reach their own published page.
- **Failed hydration fakes an empty state and re-seeds demo data** —
  `store.ts` logs query errors then seeds on `tripList.length === 0`: a
  network failure injects duplicate demo trips (the exact accumulation trap
  from the Sep DB prune — AGENTS §5). Skip seeding when any query errored;
  surface a retry banner.
- **Invite links flash "broken" on cold load** — `InviteGate` shows the error
  whenever `trip` is undefined, which it is until hydration finishes.
- **Deep-link reload lands on Landing first** — mid-hydration `me === null`
  funnels `#/trip/...` to Landing; on failure the user is stranded.
- **Silent delete failure** — `deleteTrip`'s Supabase error restores the row
  with no toast (the undo has expired), so the delete "doesn't work".
- Housekeeping: fix the stale UI-audit progress line (done in this rewrite).

### M1 — v0.27.0 "Theme integrity & mobile" (dark mode + touch, ~1 day)
- **White-on-light-teal in dark mode** — `.vote-btn.on`, `.btn-teal`,
  `.step-num` keep `#fff` text while `--teal` flips light (~2.3:1). Sibling
  rules already use `#06251f`; these were missed. Also `.ha-sync` is
  dark-on-dark.
- **iOS zoom-on-focus** — the 16px mobile bump loses specificity to
  `.role-select` (12.5px) and two 13px time/number inputs.
- **Touch targets <40px** — `.theme-toggle` 36px, `.avatar-btn` 26px,
  `.dest-chip` delete ~18px, `.toast-action`, `.board-fit`, filter chips, etc.
- **Focus-ring gaps** — ~10 interactive controls missing from the shared
  `:focus-visible` list (`.clamp-toggle`, `.board-fit`, `.save-heart`,
  `.dest-chip button`, `.role-select`, bare inputs…).
- Reduced-motion gap: `transition-delay` stagger survives the global freeze.

### M2 — v0.28.0 "State honesty & UX" (~1 day)
Error / loading / empty must never impersonate each other (folds in the old
"loading skeleton on first boot" item):
- Loading vs empty distinction on My Trips + Explore ("No trips yet" /
  "Nothing matches" render before or without data).
- Profile save: inline validation + disabled-while-saving (match CreateTrip).
- AI drawer: Escape + focus trap + focus restore (reuse Modal logic); nav
  popovers restore trigger focus on close.
- Keyboard: day-rename clickable `<h3>` → real button; heading hierarchy
  (h1→h3 skips in 5 tabs; SharedTrip/Invite pages lack h1).
- Landing "demo mode" copy over-promises (no anonymous demo; seed inserts
  trips only) — rewrite copy to match reality.
- Dead "Book a planning consultation" button; "places" vs "stops" terminology.

### M3 — v0.29.0 "Performance architecture" (~2 days, sequence inside matters)
1. **Store immutability first** — `Object.assign`/`push` in-place mutations
   make every `useMemo([trip])` stale-prone; it works today by accident.
2. **Slice-level selectors** — `useDb()` returns the whole cache and every
   `commit()` re-renders every subscriber (realtime activity pings re-render
   the whole workspace, re-running `simulateDay` per day).
3. **Memoize the hot path** — `React.memo(DaySection)` + handler `useCallback`s.
4. **Split `TripWorkspace.tsx`** (2,932 lines, 8 tabs) into `pages/trip/*` —
   natural boundary: each tab shares only `applyChange`/`pending`.
5. Fetch dedup: `DayWeatherChip` N-per-day weather calls vs Overview forecast;
   `ClampedText` doubles the DOM per stop; route-level `React.lazy` for
   Auth/Profile/CreateTrip/PublicItinerary.

### M4 — v0.30.0 "Design-system hygiene" (~1 day, CSS-only batch) — DONE (in [Unreleased], local branch redesign/perf-architecture)
- [x] Purge ~100+ lines dead CSS (hero-preview block, `.route-flow`, `.filter-bar`,
  duplicates, contradictory `.locked-overlay` pair) — template-literal-safe
  recheck first. (Net −80 lines; 30+ zero-usage rules + dead selector
  fragments in compound rules, per-selector usage grep in commit body.)
- [x] Consolidate the 9 scattered mobile blocks (real conflicts: `.map-day-chip`,
  `.vote-btn` sized differently in two blocks) back toward the single-block
  convention. (All max-width blocks grouped at EOF, one 720px block; cascade
  preserved via per-selector audit + declaration-multiset diff.)
- [x] Glass tokens: add `--yf-blur-*` (sm/md/lg = 4/6/8px, value-identical);
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

### M5 — v0.31.0 "AI companion" (old Phase 1 — issues #22 → #20, ~5h)
User-configurable OpenAI-compatible endpoint (Profile settings,
`src/lib/aiProvider.ts`), real LLM answers with the deterministic router kept
as offline fallback + "(LLM)/(offline)" badge. #22 (~2h) blocks #20 (~3h).

### M6 — v0.32.0 "Together" (old Phase 2 — collaboration depth)
Supabase integration/RLS test suite first (opt-in `VITE_RUN_INTEGRATION`,
~3h — old item #10), then live multi-user editing sync. Split-expense
settlement groundwork (payer tagging + balances card) shipped in v0.36.0;
M6 adds the multi-currency-free refinement and co-editing depth on top.

### M7 — v0.33.0 "Premium" (old Phase 3 — monetization)
Gateway integration (Razorpay fits INR), order/entitlement tables + webhook,
purchase state, unlock flow replacing placeholder toasts. Needs an external
gateway account. Deliberately after M6's test-suite groundwork.

### M8 — 1.0 enablers (old Phase 4) → the 1.0 cut
Offline-first (IndexedDB + service worker/PWA, ~4–6h), i18n (EN + HI, ~6–8h),
then the 1.0 release.

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

*From the old P2 polish list:*
| Item | Note | Effort |
|---|---|---|
| Profile: surface all UserProfile fields | `homeCity`, `travelStyles`, `languages`, `socialLinks`, `creatorBio`, `isCreator` exist but aren't editable | 1.5 h |
| Route polylines on the map | `routing.ts` already returns geometry; `TripMap` renders markers only | 1 h |
| Browser push notifications | plumbing exists in `realtimeCore.ts`; permission on login, dedupe vs read flag | 1 h |

*From the CTI alignment deferrals ([docs/redesign/ALIGNMENT.md](docs/redesign/ALIGNMENT.md)) — must enter this pool in the same commit they're deferred:*
| Item | Note |
|---|---|
| In-map place search | design doc §6.5 remainder |
| Map popup → Board/Timeline cross-links | §6.5 remainder |
| Per-decision route/budget impact panel + grounded assistant | §6.8 — needs engine data |
| Suggestions "why it fits" route-position copy | §6.6 remainder |

*From the #36 bug-hunt triage (Sep 2026 — findings re-verified against code; see the audit comment on #36):*
| Issue | Item | Effort |
|---|---|---|
| #45 | Logout doesn't await in-flight hydrate → post-logout cache patch | 30 min |
| #44 | `applyRealtimeEvent` unwrapped — one bad payload kills the subscription | 30 min |
| #43 | Undo after delete restores a skeleton (cascade wipes children) | 1.5 h |
| #39 | `console.info` in hydration leaks trip UUIDs to every console | 5 min |
| #40 | Repeated `console.warn` for missing optional columns | 5 min |
| #46 | Minor sweep: moveStop persist-on-early-return, vote activity text, hydration guards | 1.5 h |
| #47 | Notification dedupe gap + `markAllNotificationsRead` race | 1 h |
| #48 | Pub view/copy counts need a `SECURITY DEFINER` RPC (RLS blocks anon writes) | 2 h |
| #49 | Housekeeping: `recentLocalWrites` cap, ownerId UUID guard | 30 min |
| #38 | `mapOrSkip` typing (mappers → `unknown` + guards) | 1 h |

*Old P4 nice-to-haves:* Explore pagination (2h) · undo for more operations
(2h) · feedback button (1h) · trash + 30-day purge (1.5h) · debounced store
writes (1h — pairs naturally with M3).

---

## Idea pool (Sep 6 brainstorm — unprioritized, pull into any milestone)

| Idea | Note |
|---|---|
| Decision comments | needs a `comments` JSON column on decisions (schema migration) |
| Premium purchase state | entitlements + unlock flow — folds into M7 payments |
| Full Profile field editing | homeCity/languages/socialLinks UI exists partially |
| Browser push notifications | plumbing exists in realtimeCore; permission on login |
| Route polylines on the map | routing.ts returns geometry; map renders markers only |
| Trash + 30-day purge | soft-delete layer before hard deletes |
| Explore pagination | grows with the catalog |

### 🧭 Suggestion-engine ideas (Sep 6 2026 deep brainstorm → [docs/SUGGESTION_ENGINE_BRAINSTORM.md](docs/SUGGESTION_ENGINE_BRAINSTORM.md))

| Idea | Horizon | Note / effort |
|---|---|---|
| Road-projected hit positions (snap to OSRM polyline) | 1 | ✅ shipped (v0.40.x) |
| Two-pass segment assignment (swap-improvement) | 1 | ✅ shipped |
| Itinerary + geo-fuzzy dedupe of candidates | 1 | ✅ shipped |
| Reason strings on suggestion cards ("why this") | 1 | ✅ shipped |
| Journey-clock segments (meals land at meal times) | 2 | ✅ shipped |
| Crew-aware fatigue cadence (style/travellers multipliers) | 2 | ✅ shipped |
| Weather-joined ranking (rain → indoor picks) | 2 | ✅ shipped |
| Time-based detour cost + on-way asymmetry | 2 | ✅ shipped — asymmetric detour: on-the-way hits ≈ 0, off-road pays the spur (doubled by scorers) |
| Ratings in Google mode | 2 | ✅ shipped |
| Road personality (rest before the ghats) | 3 | ✅ shipped (city-crawl verdict fixed to a day-level check; ghat wins) |
| Detour budget per day | 3 | ✅ shipped — see-&-do list enforced; need halts stay uncounted by design |
| Trip DNA (learns the crew's picks) | 3 | ✅ shipped — category mix, detour tolerance + **stop length** dims, **cross-trip device learning** (they keep picking waterfall→waterfalls nudged on later trips). Remaining (schema-gated): cross-device persistence via Supabase needs a `user_dna` table + RLS — ride M6/M7 infra, not the pure engine. |
| Crew-seeded corridor suggestions + story arcs + slack prompts | 3 | ✅ shipped |
| Fuel before long no-fuel corridors (road-personality trigger) | 3 | ✅ shipped — a fuel stop crossing a long gap to the next scheduled refuel warns "fill the tank" (cadence-gap advisory); a live POI-density scan remains a future nicety |
| Opening hours enter suggestion scoring | 2 | ✅ shipped — hits closed at the segment's arrival clock are degraded (via `etaMinutes`); open-at-arrival untouched |
| On-way detour asymmetry (destination on the way costs ~0 return) | 2 | ✅ shipped — see "Time-based detour cost" |

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
