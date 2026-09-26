# AGENTS.md — YatraFlow

Operating manual for AI coding agents (Cline and friends) working in this repo.
Read it fully before starting work. Follow the rules. **Keep this file growing.**

## 0. The learning rule (this file must grow)

Any crucial learning made while working here — a pitfall that cost debugging
time, a project quirk, a convention the user cares about, a "local lied, CI was
right" moment — **must be recorded in this file in the same session it was
learned**, as a short actionable rule in the most relevant section below.
Before committing, ask: *"did this session teach something a fresh session
would need?"* If yes, add it here and include the update in the same commit.
Prune entries that stop being true.

## 1. What this project is

YatraFlow — collaborative India trip-planning app. React 18 + Vite 8 +
TypeScript, Supabase (auth + data), MapLibre GL maps, hash-based routing,
deployed on Vercel from `main`. No bookings/payments — planning only.

Key locations:
- `src/App.tsx` — app shell: hash routes, nav (hamburger ≤720px), theme, notifications
- `src/store/store.ts` — data layer (`useSyncExternalStore`) over Supabase
- `src/lib/engine.ts` — pure planning engine (schedule, budget, breaks, warnings)
- `src/lib/geocode.ts` — provider facade: Google-only suggestions when a key is configured, free stack as the keyless mode (see §5 directive)
- `src/lib/providers/` — `google.ts`, `free.ts` (OSM/Wikipedia/Mappls), shared hits logic
- `src/lib/timefmt.ts` — 12h/24h clock preference + formatters (default 12h)
- `src/lib/uiPrefs.ts` — per-day collapse persistence (localStorage)
- `src/components/TripMap.tsx` — MapLibre map (lazy chunk); `src/components/mapcn/` wrapper
- `src/pages/TripWorkspace.tsx` — the big one: tabs (timeline, map, budget, share…)
- `tests/` — vitest in **node env (no DOM)** — test pure logic, not DOM
- CHANGELOG.md — Keep-a-Changelog-style; versions are pre-1.0 milestones

## 1.1 Current project status (as of Sep 25, 2026)

> **Read this section as a paraphrase, not as a source (added 2026-09-20).** The
> release bullets below are append-only history and can be trusted; the *live*
> lines — **Current branch**, **In-flight**, the open-issue count — are
> hand-maintained and rot fast. When this section was re-derived from git it was
> wrong in four ways at once: it named a branch whose PR had already merged, put
> `test` two releases behind where it actually was, counted 14 open issues when
> 13 were open, and reported a `.freebuff/` directory that does not exist. Run
> `git status -sb` + `git log --oneline -5` + `git rev-list --left-right --count
> test...origin/test` + `gh issue list --state open` and fix this section in the
> same session you notice the drift (§2.6).

**Version:** **v0.67.0** — the audit's first two waves (2026-09-25, cut on `test` and **promoted to `main` the same day — PR #446, `main` at `af373cc`**, tagged annotated `v0.67.0` on the merge commit, the Android APK workflow running on the tag push): sixteen findings from the P0–P3 audit sweep across the map, the create flow, decisions, the creator's surfaces and the public wire — the invite code off the public wire, the budget breakdown withheld from non-buyers, unpublishing that no longer takes a bought plan away from its buyer, and the retention pruner made an operator action — plus the creator hub's own recovery path, the creator fixture, the README refresh and stale-line sweep, and unpinnable map picks asking for their position instead of being dropped. Five migrations, every one applied live before the promotion. Under it: **v0.66.0** — the hub as an operating picture, and the high-end visual pass (2026-09-24, **PR #319, `main` at `244e74e`**): the creator hub as an operating picture (a KPI strip, a recorded-traffic trend drawn from the same derivation its rows read, one row per publication with its funnel, the profile into a disclosure, every honesty state kept), route-aware map-tab search, and the high-end visual pass (Plus Jakarta Sans, one 1.5 icon stroke, the pill nav's glider, the landing's display scale and Double-Bezel buttons). Production is at **v0.67.0** — the PR #446 merge (2026-09-25) is the last promotion, and `test` is level with `main` again (`main` at `af373cc`, `test` at `73c7e0e`) — the release is tagged (annotated `v0.67.0` on the merge commit, the Android APK workflow running on the tag push), and the migration-status run read **29 migrations · 14 applied · 0 missing · 15 no probe surface (1 optional) · 0 unchecked** (the function-only ones are declared rather than probed — §3.2). It follows **v0.61.0** — the money release (2026-09-18): a priced publication can actually be bought, with the paywall enforced at the wire rather than in the browser (the price read from the publication row server-side, the unlock granted only through a buyer-scoped RPC or the idempotent webhook, and a confirmed-but-unsaved purchase recovered rather than charged twice); a versioned itinerary format whose importer migrates and repairs an older export instead of refusing it; the crew-facing access rules pinned by an opt-in suite that runs against the live database (M6, #237); and the two public surfaces' own pass. **Promoted to `main` on 2026-09-18 (PR #259, `main` at `647faf1`)**; production then stayed there until **v0.62.0 and v0.63.0 were promoted together on 2026-09-20 (PR #267, `main` at `55efd21`)** — the paywall-RPC fix, the crawl surface, live presence and the travel-clock map layer are all on `main` now. The database half is applied as well — both of this release's migrations were run by the user in the Supabase SQL editor on 2026-09-20 — so production's code and production's schema are both at v0.63.0. It follows **v0.60.0**, the whole-app refinement pass (every route reviewed against its own design language and fixed in place; merged to `test` in PR #257), which took the design-system ratchet to `7 / 0 / 28 / 29 / 1` — no known dark-theme contrast violation left.

**Previous version:** **v0.65.0** — the funnel, the companion and the installable app (2026-09-22, cut on `test` and **promoted to `main` the same day — PR #304, `main` at `3893ccc`**). Before it: v0.64.0 — decision comments, creator covers and onboarding a11y (2026-09-21, PR #270); **v0.59.1** — the span-indexing fix (2026-09-17), promoted to `main` on 2026-09-17 (**PR #248**, `main` at `1d1b85f`); v0.59.0 was the corridor-measurement release (promoted 2026-09-17, **PR #247**, `main` at `b4f0a18`). Its scope: the corridor span measurement no longer hands a leg its neighbour's result, so a cached leg inside the span cannot truncate the drawn route or poison a later measurement's cache entry. The v0.59.0 content stands: corridor-wide road measurement replaces per-leg requests, the day filter measures only the day on screen, and copied public itinerary addresses keep their trip-specific previews with navigation that works in any tab. The v0.58.0 content stands: a publication without a cover now previews with a branded 1200×630 card (`public/og-default.png`, emitted by `api/i.js` as a fallback and advertised by the shell too), and auto-picked Wikipedia covers are sized through Wikimedia's own resize endpoint instead of shipping the unscaled upload — measured at 144–406 KB where the originals were 1300–3300 KB, which is what the 600 KB WhatsApp documents for `og:image` requires. The v0.57.0 content stands: a published itinerary link previews as a card (`/i/<id>` answered by `api/i.js` with that itinerary's own Open Graph tags, then the hash route), trip JSON imports in one step from My Trips in both formats the repo ships, permanent user deletion in the masteradmin console, the offline companion's routing collisions fixed, and per-route browser-tab titles. The v0.56.0 content stands: the six-phase settings-wiring audit (issue #213) is fully landed (PRs #219/#220/#221) — Trip settings as the eighth workspace tab, the four party/vehicle fields persisted through `20260915_trip_party_prefs.sql`, `CACHE_VERSION` 3→4, `MapTab`'s verdicts re-deriving on `trip`/`dayWeatherCode`, `roadChainSig`, and honest numeric defaults for non-car vehicles. The `npm run verify` gate at the v0.67.0 cut (2026-09-25): tsc clean + **2270 tests (169 files)** + production build — CI's `Verify` job is green on the `af373cc` merge.

**State:** Stabilization complete; the v0.40-era 32-finding UI audit AND the deeper #107 tracker are fixed to the floor (**117/117 boxes closed** — every finding carries a verdict; the owner-decision rows are the budget palette kept as authored, the board touch-tooltips product call, and two documented conventions). Device-check flags open on hardware only: 3D map-mode frame rate on a mid-range Android, Liberty label density at phone width, Landing scroll after the attachment change. The Corridor Concierge suggestion-engine brainstorm is FULLY shipped (Horizons 1–3, 16/16) — see ROADMAP's 🧭 table. v0.47.0's soft-delete backend is applied live (probe-verified: `trips.deleted_at` exists on the production project; the `get_trashed_trips` RPC is present with authenticated-only EXECUTE — the anon call returns `42501 permission denied`, not PGRST202). Branch model stays two-branch: `main` (production, Vercel) and `test` (integration) — **level again at `af373cc`**: the v0.67.0 promotion (PR #446) landed on 2026-09-25, 58 commits after the previous release, and `test` carries no unique work. The `npm run verify` gate at the v0.67.0 cut (2026-09-25): tsc clean + **2270 tests (169 files)** + production build — CI's `Verify` job is green on the `af373cc` merge.

> **A partial patch vs a full-Trip patch through `updateTrip` needs different handling (learned 2026-09-11).** The settings form passes a partial patch while the impact-preview flow passes a whole `Trip` (whose dates are always truthy). Any gate shaped like `if (patch.startDate || …)` fires on every Keep; reconciliation must compare resolved dates against the cache and reconcile the *incoming* days. The two `reconcile-days.test.ts` full-Trip regression tests pin this — they fail on the old code.

> **`test` had drifted 49 commits behind `main`** (found 2026-09-11: `test` was a plain ancestor with zero unique commits, missing the whole Android shell and v0.45–v0.48). Both branches were resynced to `dfdd2d0`. Because the promotion pattern is `feature → test → main`, a fix pushed to a stale `test` lands on a tree that cannot be built. **Check before pushing to `test`:**
> ```bash
> git merge-base --is-ancestor origin/test origin/main && echo "test is BEHIND main - resync first"
> git rev-list --count origin/main..origin/test   # non-zero = test has unique work
> ```


**Recent major releases:**
- **v0.65.0** — the funnel, the companion and the installable app (2026-09-22, cut on `test`, promoted to `main` by PR #304): the Create Trip funnel and ticket, the M5 AI companion, the PWA pair (installability, offline reading, durable sync), the map's honesty pass (the fit frames the drawing; slot search; the P3 sweep), the security hardening batch, one icon vocabulary across every surface, the light-theme AA/palette/ladder cleanup, and `npm run check:migrations` as a release step (its first run found `trips.stay_style` unapplied).
- **v0.64.0** — decision comments, creator covers and onboarding a11y (2026-09-21, PR #270).
- **v0.63.0** — the travel clock and living plan on the map, the crawl surface, and the paywall-RPC fix (2026-09-20, PR #267; promoted with v0.62.0).
- **v0.62.0** — M6 · Together's co-editing half: presence, the stale-update ledger, the remote-edit banner, mark-settled (2026-09-20, PR #265).
- **v0.61.0** — the money release: a paid unlock behind a server-side paywall, versioned itinerary import (2026-09-18, PR #259).
- **v0.60.0** — Whole-app refinement: a route-by-route review of every surface, fixed in place — mobile layouts that scrolled sideways, the Timeline's up/down arrows that never moved a stop, the Create-Trip calendar painted under the dock, forced-dark cards whose gradient flipped near-white and stranded white text, decorative loops that never stopped offscreen, controls below the 40px touch floor, scroll regions no keyboard could enter, the AI drawer's focus and modality, and three product claims (free-forever pricing, local-only storage, "Verified creator") corrected to match the product
- **v0.59.1** — Span measurement gives every leg its own result: a cached leg inside the corridor span can no longer hand its geometry to the leg after it or poison that leg's cache entry
- **v0.59.0** — One measurement per corridor: road measurement batches the waypoint chain, the day filter measures only the day on screen, and copied public itinerary addresses keep their trip-specific previews with navigation that works in any tab
- **v0.58.0** — Share card: a publication with no cover previews with a branded 1200×630 card that the shell advertises too, and auto-picked Wikipedia covers are resized through Wikimedia's own endpoint, so a shared link stops carrying a multi-megabyte image
- **v0.57.0** — Sharing and honesty: a published itinerary link previews as a card (`/i/<id>` answered by a Vercel function carrying that itinerary's own Open Graph tags), trip JSON imports in one step from My Trips and reads both formats the repo ships, permanent user deletion lands in the masteradmin console, the offline companion stops routing overloaded days / cost questions / mentions of children to the wrong handler, and every route gets its own browser-tab title
- **v0.56.0** — Settings integrity: the six-phase #213 audit landed — Trip settings as its own workspace tab, party/vehicle preference persistence (new `trips` columns + optional-column probe), propagation fixes so a settings change re-derives suggestions/budget/plans, style-vs-budget separation, Create↔Settings parity, and honest numeric defaults for non-car vehicles (#219/#220/#221)
- **v0.55.0** — Gallery pipeline: the import spec + validator (Gate 1), the engine-truth golden test (Gate 2), the demand-ranked 20-trip backlog, the research playbook + geocoder, and six shelf itineraries (Coorg reference + Goa/Kerala/Mewar/Kashmir/Meghalaya); Vercel Web Analytics wired web-only (#216)
- **v0.54.0** — Suggestion-pipeline honesty: engine-agnostic spur detours (#187), one road measurement per trip with honest unresolved-failure (#188), night halts anchored on OSM towns with the Google-only directive amended in §5 (#189), the Day Planner's meal/fuel cadences revived, Create Trip parity + route-integrity guardrail (#150), and the dayPlanner realism batch (#151 — severity rain, mode-aware caps, Null Island guard, real-coords search)
- **v0.53.0** — Design-system audit release: #107 worked to the floor in five batches (per-theme contrast/ink tier, motion-token unification, kicker recipe + hit areas + layout tail, custom ARIA listbox Select on 14 surfaces + SYS-2 scale deletion, scenic 292° hue split + Explore stagger); plus the #106 single-day map-filter fix; `docs/UI-PAGE-AUDIT.md` committed
- **v0.52.0** — Map relief: Liberty default basemap (light theme, every surface) + three map view modes (2D · Terrain hillshade · pitched 3D hero) behind a segmented switcher on the Map tab; keyless AWS terrarium DEM with water/waterway `beforeId` ordering, style-reload terrain re-apply, on-demand DEM credit, global mode persistence, hard-2D Board. Spec + live prototype shipped with the code (`docs/FEATURE-REQUEST-MAP-VIEWS.md`)
- **v0.51.0** — Timeline restructure (Phases 1+3) + motion system + bencho-grade drag: 1,500-line TimelineTab split into modules, one-open-day accordion, motion tokens (`docs/MOTION-TOKENS.md`) governing every animated surface, pointer-event drag with centre-based stable-layout drop zones + FLIP settle, Optimise-day (2-opt + road polylines + Directions), frosted-glass unification of dropdowns/calendar/location, CreateTrip smart budget prefill
- **v0.47.0** — Cleanup-and-polish: trip trash (soft-delete tombstone + restrictive RLS + Trash view with Restore/Delete-forever RPCs, probe-gated on `deleted_at`), debounced trip writes (600 ms coalescing, flush on page hide), browser push notifications (Notification API opt-in, focus/read dedupe), in-map place search, map popup → Timeline/Board cross-links, grounded per-decision offline recommendation (`lib/decisionGuide.ts`), feedback mailto link, Explore pagination; plus `docs/PLAN-INVITES-ONBOARDING.md` (M9 playbook)
- **v0.46.0** — Masteradmin console (`#/admin`): JWT-`app_metadata`-gated god-view over users/trips/invites/content/analytics/audit, audited `SECURITY DEFINER` RPCs, append-only `admin_audit` log, RESTRICTIVE deny-on-disabled RLS, six audited RPCs (`admin_set_disabled`/`_creator`/`_trip_visibility`/`_remove_member`/`_unpublish`/`_delete_trip`); migration applied live
- **v0.45.0** — Create flow gets its ticket: Trip Ticket bento starter (bill print, outline seeding), invite short trip codes + fixed join flow, car rental mode + local-train fares, range calendar, Plan Bench trip settings + editable dates, My Trips search/filter/sort restore, auth-refresh logout fix
- **v0.44.0** — Budget pacing tile ("Safe to spend / day", via new pure `daysRemaining` / `safeToSpendPerDay` helpers), per-day cost + dwell chips on timeline day headers, stale-chunk auto-reload so already-open tabs survive a deploy, and `fetchSharedTrip` + the `get_invite_trip` RPC restoring public itinerary pages and invite links for non-members

- **v0.43.0** — Suggestion-engine fixes: sights in the corridor scan (See & do fed), panel↔map cross-highlighting, route-ordered additions (A→B→C), engine-tips roll-out, realtime style/mode re-tune, AI companion locked for premium; plus the encoding-corruption repair of the bad calendar-export merge (styles.css/ShareTab.tsx restored, tabbed Share page re-applied) and the AI drawer close-fix + CTI redesign
- **v0.42.0** — C1–C5 Hy4 audit P0 fixes: 'Add all' batch write-through, routeHash cache invalidation, degenerate-route guard, detour budget from actual stops
- **v0.41.0** — Corridor Concierge: H3 suggestion engine (road personality, enforced detour budget, trip DNA, crew seeds, story arcs, slack prompts), asymmetric detours + hours scoring + fuel advisories, Google-only provider directive, store + AI-drawer sweep (issues 15/15 closed)
- **v0.40.1** — Sliding glider on all pill navigation, accessibility fixes (ARIA roles, focus rings, contrast), dead code removal
- **v0.40.0** — Hard-surface pass: full UI audit (32 findings), lucide icon consistency, numeric typography (tabular digits), a11y structure, one grammar across the workspace
- **v0.38.0** — Creator hub: Overview + Earnings tabs (payouts ledger), projection view, M7 contract documentation
- **v0.37.0** — Creator bios + newest sorting, select dropdown theming
- **v0.36.0** — Impact Preview improvements (time delta includes dwell), expense categories with `--cat-*` tokens, per-vote decision pings
- **v0.35.0** — Publish editor (preview/price/CTA), fork premium gate, creator mode, sourcemaps
- **v0.31.0** — M0–M7 Calm Travel Intelligence redesign shipped (user-driven halt planner, 3-layer tokens, OpenFreeMap basemap, touch drag-and-drop)

**Current branch:** `test` — the integration branch, **level with `main` at `af373cc` (the v0.67.0 promotion merge, PR #446): the release was cut on `test` on 2026-09-25, promoted the same day, and `test` carries no unique work** — it carried no unique work then, and the next release started from there: on 2026-09-24 `test` took four PRs — **#315** (`feat/creator-hub-dashboard`, merge `8830648`), **#316** (`fix/map-search-route-bias`, merge `9138ff2`), **#317** (`fix/og-card-font`, merge `3c97d8e`) and **#318** (`docs/promote-v0.66.0`, the release cut, merge `a2d92d9`) — leaving **no PRs open**, with `npm run verify` green at the cut (**2,135 tests / 154 files + 1 skipped**; tsc clean, production build clean). How it got there before that: on 2026-09-22 `test` took the **12-PR queue integration** (the Create funnel, the M5 companion, the PWA pair, the map cluster, security hardening, the icon vocabulary and the design AA pass — `npm run verify` green at each of the 12 merges), the **`feat/migration-status-check`** probe (`npm run check:migrations`: 24 migrations · 0 missing against live — 2 artifact-probed, 3 RPC-probed), and the **`origin/main` reconciliation** folding the v0.64.0 release squash against test's originals (12 files, 26 hunks; the CHANGELOG dedupe removed 5 byte-identical twins and lifted the queue's bullets above the released section). v0.65.0 was promoted the same day: **PR #304** (`test` → `main`) merged 2026-09-22 16:01 UTC, the annotated tag `v0.65.0` points at its merge commit, and the Android APK workflow ran green on the tag push. **99 issues are open and no PRs (re-derived 2026-09-25)** — PR #294 was closed by hand at 16:09 UTC, minutes after the promotion, its content having landed through the queue integration's direct merge of `origin/feat/offline-read`. **#261's two migrations are applied** — `20260919_covers_bucket.sql` (the `covers` bucket + its folder-scoped policies) and `20260919_trip_cover_image.sql` (`trips.cover_image_url`), both run by the user in the Supabase SQL editor on 2026-09-20. That mattered more than usual here: the release makes a *saved* cover mandatory to publish, so without the column no cover could be saved and publishing would have been blocked for every creator the moment the code reached a deployed environment. The tree's own gate: the suite stood at **2104 tests (152 files)** at the cut, and CI's `Verify` job is green on the `3893ccc` merge for both the `main` and `test` pushes. `main` had sat at `647faf1` since v0.61.0 (PR #259) — it was 71 commits and two releases behind at the merge. After a promotion the count that matters is `git rev-list --count origin/main..origin/test` (it was 3 on 2026-09-18, the paywall fix, 12 at the v0.62.0 cut, and **0 now** — the v0.65.0 promotion has landed); a non-zero exit from `git merge-base --is-ancestor` alone does not tell you which side is ahead. What the promotion carried — **52 files, +3833/−272** (`git diff --stat origin/main..HEAD`): **v0.62.0** (M6 · Together's co-editing half — presence, the stale-update ledger, the remote-edit banner, mark-settled, PR #265), the **travel clock and living plan** drawn on the map (`lib/clockOverlay.ts` + 457 fixtures in `tests/clockOverlay.test.ts`, PR #262), the crawl surface (`public/robots.txt` + `api/sitemap.js` + its `vercel.json` rewrite, PR #258), the public-page fix (`get_public_trip`'s `::text` cast and the creator-sales RPC revoked from anon, PR #256), the CI gate for PRs into `test` (PR #266), a calmer map rail (`bcf1398`, PR #260), and two migrations (`20260918_payments_security.sql` corrected, `20260919_trip_touch_updated_at.sql` new). `package.json` reads **0.63.0** on both lines (the promotion is `55efd21`). **The commit count overstates the content:** the travel-clock branch carried a Sept-13/14 Day Planner batch whose code was already in `main` via other commits, so `git log main..test` lists commits that change nothing — `git diff --stat` is the truth, and `git log --oneline <base>..HEAD -- CHANGELOG.md` is the coverage audit. **v0.59.0** was the corridor-measurement release, promoted 2026-09-17 (**PR #247**, `main` at `b4f0a18`); **v0.58.0** was the share-card release, promoted 2026-09-17 (**PR #245**, `main` at `cf1c289`). The v0.59.0 work is corridor-wide road measurement, day-scoped measurement, and public addresses that preserve trip-specific previews with navigation that works in any tab. **v0.57.0** was promoted on 2026-09-17 (**PR #244**, `main` at `43c839f`); **v0.56.0** was the settings-integrity release (promoted 2026-09-16, **PR #223**, `main` at `f314b25`). The v0.58.0 work is the share card (`public/og-default.png` plus the `api/i.js` fallback and the shell's own `og:image`) and the Wikimedia cover sizing in `lib/tripThumb.ts`. The v0.57.0 work is the itinerary preview endpoint (`api/i.js` plus the `/i/:id` rewrite that makes a shared link preview as a card), the one-step trip-JSON import, per-route browser-tab titles, the offline companion's routing fixes, and permanent user deletion (**PR #225** — its `admin_delete_user` RPC stays migration-gated on `20260916_admin_delete_user.sql`). The v0.56.0 cycle's own PRs: **#219** (the Settings tab split + propagation fixes, #213 Phases 1–4), **#220** (Create↔Settings parity + numeric defaults, Phases 5+6) and **#221** (the audit docs + ROADMAP queue refresh).

> **Resolved (2026-09-17): the polyline/routing batch and the commercial docs have both landed.** The 2026-09-16 correction this note replaces is obsolete — **PR #224** merged into `test` on 2026-09-17 (`dbd557a`), so `5a8cfd5`, `1125227`, `f4ed706`, `4b2286b`, `146de3d` and `e72810f` are now ancestors of `origin/test` (re-verify with `git merge-base --is-ancestor <sha> origin/test`), and **#214** landed the same day (`d897d53`), putting the commercial docs under `docs/commercial/`. **PR #235** remains **CLOSED as superseded** (2026-09-17): both of its halves — the link-preview endpoint and the trip-JSON import — landed on `test` in a simpler form (`d5a3842`, `f625387`, `7079688`), and its own `api/i.js`/`shareUrl.ts` must not be merged over them; the branch is kept as archaeology. Re-check drift before each push (see the branch note in the State paragraph above).

> **`admin_delete_user` (Sep 2026) is migration-gated.** The RPC ships in `supabase/migrations/20260916_admin_delete_user.sql` and must be applied in the Supabase SQL editor before the console's Delete button works — the store call fails with `PGRST202` (function not found) until then, toasting the error. Its guards (published-force, self, last-admin) and audit-before-delete order are pinned in `tests/admin-delete-user.test.ts` so future edits can't silently drop them.

**In-flight:**
- **v0.67.0 is promoted (PR #446, `main` at `af373cc`, tagged) and `test` is level with `main`, with `[Unreleased]` live again and no PRs open.** The release carried the audit plan's first two waves and the four PRs that were still open when it was cut — the creator hub's recovery path, the creator fixture, the README refresh and stale-line sweep, and unpinnable picks asking for their position. Two of those had never run CI at all and were gated locally before merging (§3). The release is tagged (annotated `v0.66.0` on the merge commit; the Android APK workflow ran green on the tag push, which is the only path that publishes the APK). The release's one open follow-up is DB-side: its three function-only migrations (`20260921_admin_revenue.sql`, `20260921_purchase_share_card.sql`, `20260922_pub_events_retention.sql`) are declared rather than probed by `check:migrations` (§3.2). `owns_publication` was verified live 2026-09-22 (§3), but `admin_revenue` was still recorded as unapplied when its note was written — run `npm run check:migrations` and open the console's Analytics tab on a credentialed machine to settle it (a missing RPC fails loudly with `PGRST202`).
- **Rebrand (issue #96) — ARCHIVED 2026-09-15: no need or plan to rename.** The seam exists on `refactor/brand-seam` (one source of truth for the product name across 21 files incl. `vite.config.ts`) and is kept as archaeology, not as pending work. If it is ever revived: the Android shell has brand-adjacent fields (`appId` `app.yatraflow.mobile`, `versionName`, APK artifact naming) and an `appId` change **breaks updates over existing installs**, so that cut must be planned deliberately. The landing-page experiment on `explore/landing-hero-local` is unrelated to this decision
- **v0.63.0 is promoted: `main` and `test` are the same tree (`55efd21`, PR #267, 2026-09-20) — the only part of this release still outstanding is the database.** `[Unreleased]` was consolidated into `## [0.63.0] - 2026-09-20` (the §2.6b coverage audit ran: every commit in `main..test` either has an entry in `[0.62.0]`/`[0.63.0]` or is user-invisible — a merge, a doc, a test, or a CI change), `package.json` + lockfile bumped to 0.63.0, and ROADMAP's Snapshot date, `Current version` line and ledger row updated to match (`tests/roadmap-status.test.ts` pins those three to each other, so a cut that misses one fails the gate). Both pushes happened with the user's explicit confirmation under §2.1/§2.8. PR #267's Codacy run flagged two real inherited defects, both now fixed on `test`: the presence key drew from `Math.random()` (now `getRandomValues`, with a comment-aware tripwire in `tests/presence.test.ts`) and ROADMAP's strategic-track table linked four anchors that no heading produced (M5/M6/M7/M8 — all repaired). **Both of this release's migrations are applied** (2026-09-20, run by the user in the Supabase SQL editor) — `20260918_payments_security.sql` (the server-side paywall — `get_public_trip`, the tightened `trips read` policy, the gated `get_invite_trip`, refund revocation, the nullable entitlements FK and `get_creator_sales`) and `20260919_trip_touch_updated_at.sql` (M6's `updated_at` trigger, byte-equivalent to `schema.sql`'s canonical function) — and `v0.63.0` is tagged on `main` (`55efd21`). **The rule this release earned: a promotion's DB half is a separate, user-run step, so a release is not finished until someone has run its migrations** — CI, the merge and the deploy all pass without them, and the only symptom is a live surface failing at runtime. Two scoped items from v0.60.0 remain deliberately unexecuted in ROADMAP's Idea bank: `overdrive` on its four authored surfaces (**I-18**, filed as issue **#255** — its contract requires 2–3 directions to be presented and one picked before any code) and theming `::selection`/`caret-color` (**I-17**, unblocked and a one-file change — since executed and shipped; see the bank's shipped record)
- Working-tree noise is now *ignored*, not merely noticed: `.verdent/` agent-tool scratch was untracked and added to `.gitignore` (PR #263) — see §4. `.freebuff/` does not exist in this clone (checked 2026-09-20) and the tree is clean
- **v0.64.0 — promoted 2026-09-21 (PR #270, `main` at `ee4b2ee`), then folded into the v0.65.0 queue by the `origin/main` reconciliation.** 37 commits on `test`: decision comments + settle-up reminder (#268), creator-owned share covers with automatic backfill of third-party images (#261), onboarding A11y fixes at phone width (#269), Explore filters URL-sync, orphaned store ref cleanup, remote-edit banner Board reach, Timeline collapse motion gliding, Plan Bench tablet labels, toast/dock clearance, cited creator-market research. Its migration `20260920_decision_comments.sql` (`decisions.comments`) is verified applied — the v0.65.0 cut's `check:migrations` run read 24 migrations · 0 missing against live. Changelog coverage audit complete (§2.6b). |
- Release tags: **`v0.66.0` is the newest** — annotated on the promotion merge commit `244e74e` and pushed 2026-09-24 (`git push origin vX.Y.Z` is the only path that builds the Android APK, §3.1 — the workflow ran green on it). Before it `v0.65.0` sat on its promotion merge `3893ccc` (2026-09-22) and `v0.63.0` on `55efd21` (2026-09-20); before those they stopped at **`v0.54.0`**: `v0.55.0` and `v0.56.0` both shipped untagged, joining v0.42.0 and v0.45–v0.48, and `v0.49.0` is the one carrying its APK on the GitHub release. Backfilling those is optional.
- **Merged branches are pruned at merge now — the branch name was only ever a pointer, and the PR *is* the archaeology** (changed 2026-09-20). The repo had accumulated 26 remote heads, 21 of them describing work already contained in `main` or `test`; the 17 whose commits were already **ancestors of `origin/main`** were deleted in one batched sweep, taking the remote to 9 heads. Recovery never depended on the branch: GitHub keeps `refs/pull/<n>/head` for merged *and* closed PRs (verified on #235, #254, #261, #265 — including the closed-unmerged one) and every deleted SHA is still reachable from `main`. **Gate any prune on a fresh pre-flight pass, in one scripted sequence that aborts wholesale:** per branch a `git merge-base --is-ancestor origin/<b> origin/main` (or `origin/test` for test-only work) *and* an open-PR check — a branch that advanced or gained a PR since the audit must fail the gate rather than be deleted blind. This is not an age-based cleanup: the oldest head pruned was nine days old, so prune on merged-ness alone and never on staleness. The record of what was deleted, with each head SHA, lives in `docs/history/branch-prunes.md`. **Keep these on purpose:** `refactor/brand-seam` and `explore/landing-hero-local` (no PR has ever existed for either, so the branch is the *only* remote copy of its commits), `feat/share-preview-og` (closed as superseded — it is the counter-example warning the next session off merging its `api/i.js`/`shareUrl.ts`), and any branch whose PR is **open**. Note that **merged-ness in the branch's own target is what matters, not `main`** — `feat/settle-nudge-decision-comments` was pruned at its merge into `test` (#268 → `9bac779`) while that work was still absent from `main`, because the durable recovery path is the PR and not the branch. Holding a `test`-merged branch until promotion is therefore a convenience, not a rule: it is why the sweep's `docs/creator-market-research` (#254) and `fix/explore-clipping` (#261) were held until promotion — both were pruned once PR #304 made their work ancestors of `main`, alongside `fix/onboarding-design-audit` (#269). The **2026-09-22** post-promotion sweep pruned **36** refs the same gated way (the three hold-outs included) and left the remote at **5** — and taught two mechanics: **enumerate with `git ls-remote --heads origin`, never `for-each-ref refs/remotes/origin`** (the namespace's own `origin/HEAD` prints as a phantom `origin` "branch", passes the ancestry check, cannot be deleted, and one un-deletable name aborts a batched `push --delete` wholesale), and **record every head SHA before deleting** (a successful `push --delete` also prunes the local remote-tracking refs — after the sweep the SHAs survive only via `refs/pull/<n>/head`). The record is in `docs/history/branch-prunes.md`, and the remote stood at **5 heads** right after that sweep: `main`, `test`, and the three kept-on-purpose branches (`refactor/brand-seam`, `explore/landing-hero-local`, `feat/share-preview-og`) — **it had refilled to 14 by 2026-09-25**, so treat any head count written here as a timestamp and re-derive it with `git ls-remote --heads origin`.
- The `shabtab` fork remote is **present again** (checked 2026-09-16: `git remote -v` lists it beside `origin`, and a plain `git fetch --all` reaches it) — re-adding it is no longer needed. It carries its own day-route line, latest `ae581f3` (2026-09-12)
- **`docs/history/` now holds archived records** (pre-0.42.0 changelog, the v0.23.0 CTI plan, and `branch-prunes.md` — the 2026-09-20 branch-prune roster). Do not bulk-rewrite `CHANGELOG.md` (rule 9 below)

**What's next (ROADMAP.md):**
- **The queue is 99 open issues (re-derived 2026-09-25, `gh issue list --state open`)** — the audit plan's P0–P3 sweep across Overview, Settings, Purchases, Share, Timeline, Map and routing, of which **the remaining P0 is #427**: the v0.65.0 create funnel is deployed but dark in production because `VITE_CREATE_FUNNEL` was never set in Vercel — an environment switch, not a code change; v0.67.0 shipped the fixes that depended on it being documented (§6n). This count has been wrong twice before, so re-derive it rather than quoting it. Two sets: the **launch-readiness criteria** (#227 F3 · #228 F7 · #230 E3 · #231 F4 · #232 E2 · #233 F2 · #234 F6) and the **milestone tracks** (#236 M5 · #237 M6 · #239 M8 · #240 M9 — **#238 M7 closed 2026-09-19**, the money rail having shipped in v0.61.0), which exist as issues and not only as roadmap prose. `#226` (E1 · make links preview) and `#229` (F1 · thresholds written down) are **closed**; `#252` (F7 · who may publish, filed unlabelled) and `#255` (Overdrive, P3) were filed later and are now listed in ROADMAP's table too — that table was corrected against `gh` on 2026-09-20, having disagreed with it in both directions
- **M5 — AI companion** (tracked as **#236**; its original pair #22 → #20 both closed as audit findings, so the fix went unqueued until M5 shipped it — the LLM endpoint, Jev fast path and offline fallback **shipped in v0.65.0 (PR #304)**; the drawer stays flag-gated off in prod (`VITE_AI_COMPANION`) until M8 unmounts it as the premium perk, which is why #236 remains open): user-configurable OpenAI-compatible LLM endpoint (`src/lib/aiProvider.ts`), real answers with the deterministic `lib/ai.ts` router kept as offline fallback + an "(LLM)/(offline)" badge
- **M9 — Invites & onboarding** (**#240**): executor playbook shipped at `docs/PLAN-INVITES-ONBOARDING.md` — unified `platform_invites` entity phased R1 creator invites → R2 referral → R3 invite-only gate, `lib/accessCode.ts`, the `#/access/<code>` gate, masteradmin Invites-tab rebuild, creator onboarding flush
- **M6 — Together** (**#237**): Supabase integration/RLS test suite (opt-in `VITE_RUN_INTEGRATION`), live co-editing depth, split-expense refinement
- **M7 — Premium — CLOSED** (**#238**, closed 2026-09-19): gateway, entitlements and the unlock flow all shipped with v0.61.0's money rail; the open remainder is F6 (#234), the CA's merchant-of-record call — a row no commit can close
- **M8 → 1.0** (**#239**): the PWA pair shipped in v0.65.0 (installability, offline reading, durable sync); what remains is i18n (EN + HI) and the 1.0 cut — this is also where the built-but-flagged `AI_COMPANION_ENABLED` (`VITE_AI_COMPANION=on`) gets unmounted for the premium perk
- Idea bank worth pulling (ROADMAP `## Idea bank` → Tier 1/Tier 2): budget envelopes + overspend alerts + recurring templates, creator-hub post-M7 items, premium/billing shapes, and the M9 track above; the `#36` bug-hunt triage rows and the profile-fields/route-polylines items have all landed (see the bank's "Shipped from these sources" record)

**Key conventions:**
- `npm run verify` gate before every push
- Releases ship on a feature branch → PR to `test`; promoting a release to `main` is its own PR (`test` → `main`) — full `npm run verify` gate green locally on `test`, status docs refreshed, and only with the user's explicit confirmation (AGENTS §2.1/§2.8)
- Every push ships CHANGELOG.md entry + version bump
- Release tags are **annotated** and point at the **promotion merge commit on `main`** (`v0.54.0` is the merge of the `promote/v0.54.0` PR), with the subject `vX.Y.Z — <the release's name from its CHANGELOG heading>`; `git push origin vX.Y.Z` then triggers `yatraflow-apk.yml`, which builds and publishes the Android APK (see §3.1 — tags are the only path that does)
- `tsc -b --clean` first in verify to catch incremental cache issues

## 2. Workflow rules (non-negotiable, user-mandated)

1. **Never push to `main` without the user's explicit confirmation** — commit
   locally, then ask.
2. **Every push ships documentation**: CHANGELOG.md entry in the same commit
   (under `[Unreleased]`, or a versioned section for releases). Feature-worthy
   releases also bump `package.json` + lockfile version and update README.
   **The changelog records final state, not session history.** No "round 2",
   "PR #N follow-up", "bug-hunt batch", branch names or finding-the-bug
   stories in the entry text — say what the product does now, once, under the
   right Added/Changed/Fixed heading. When a fix supersedes an earlier
   `[Unreleased]` entry, **edit that entry** instead of adding a second one;
   issue numbers may trail an entry as traceability (`(#123)`), never as its
   framing. Release notes consolidate; the reader gets the shipped truth.
3. Fixes and features get changelog entries with enough context to understand
   them six months later.
4. **Another agent may commit into this same working copy** — Hermes has
   dropped doc commits directly onto local `test` (an uncorrected duplicate
   of its own PR branch). Before trusting or pushing a local branch, run
   `git status -sb` and `git log origin/<branch>..<branch>`; reconcile
   foreign unpushed commits (reset/supersede **with user approval**) rather
   than shipping them.
5. **UI-audit remediation is tracked in `ROADMAP.md`** (🟣 section): tick a
   finding in the same commit that fixes it — batch status table only, prose
   goes to CHANGELOG. `docs/UI_AUDIT.md` is the per-finding reference
   (file:line + example fix); don't duplicate its content in the tracker.
6. **Verify "done" claims against git before acting on them.** A session cut
   off mid-batch can leave completion summaries that were never true — this
   cost a full re-do when batches 5–6 were reported as committed while
   `git log` showed only batch 3 and half of batch 4 sat uncommitted in the
   working tree. On resume: `git status -sb` + `git log --oneline -5` +
   re-grep the tracker table, and treat any prior "committed ✅" summary as a
   hypothesis until the commit hash exists. Never re-report status from
   memory; re-derive it from the repo.
 6a. **Async operations need input guards.** The AI drawer's `ask()` function had no protection against rapid re-submission during its 650ms processing delay — users could trigger duplicate questions. Fix: `disabled={thinking}` on input and button. When adding async paths (API calls, simulated latency, data processing), always disable user inputs to prevent race conditions, duplicate requests, or state inconsistency. The guard should match the visual feedback state (spinner, disabled button, etc.).
 6b. **A release cut is not done until every change in it has a CHANGELOG entry — check coverage, not just the heading.** The v0.60.0 refinement pass ran 20 commits and only 10 of them touched `CHANGELOG.md`, so the release was about to go out describing the first half of its own work — while the plan document recording that work also stopped mid-way and read as finished. Both artifacts agreed with each other and neither agreed with `git log`. Before cutting a release, diff the two lists — `git log --oneline <base>..HEAD -- CHANGELOG.md` against `git log --oneline <base>..HEAD` — and account for every commit: it has a bullet, or it is genuinely invisible to a user (a doc reconciliation, a de-duplication, a test-only change). The entries are also where a superseded claim gets *edited* rather than appended, so that diff is the audit.
 6c. **A "missing guard" claim needs the same git check as a "done" claim.** A comment or summary saying something was *absent* ("the one animation with no reduced-motion guard") is also a hypothesis — grep `origin/test` for the guard before "adding" it, or you ship a duplicate rule plus a changelog sentence that isn't true. The map-tab review round did exactly this; found 2026-09-22 while polishing its motion. The mirror case: an absence claim expires at the *next* merge, not at the date on the block — the slots decision record (2026-09-22, 17:27) logged three plan items as still outstanding, and PR #303 landed them 70 minutes later, leaving the sentence false from the moment it merged (fixed 2026-09-23). Check an absence claim against merged-PR timestamps, not the block's date.
 6d. **Wired is not "looks like the approved mockup" — and a RESTYLE folds into the
   original rule, it never appends a twin (learned 2026-09-23).** The create funnel
   shipped with every phase wired, honesty-guarded and tested while rendering the v0.45
   navy boarding-pass ticket instead of the mockup's light card. The mockup is a VISUAL
   contract: check the surface RENDERED against it, not only the plan's wiring checklist.
   Two mechanical traps from the fix: (1) an appended rule that re-declares an existing
   top-level selector trips `duplicate top-level selectors`, and a new font-size under
   11px trips the type floor — grandfathered names keep their sub-floor sizes, so
   restyles fold INTO the original rules with line counts preserved, and only genuinely
   new names go in an appended block (media-nested refinements are exempt); (2) filled
   teal carries `color: var(--card)`, never `#fff` — dark theme flips `--teal-deep` to a
   LIGHT teal where white text measures 2.05:1 (measured on the CTA pill 2026-09-23;
   the flipped pair reads 5.84 light / 7.66 dark). (3) A shared-recipe GROUP rule can
   re-assert itself over the fold-in and win by source order — the kicker unification
   list still named `.tk-brand`/`.tk-kind` and fed them `--kicker-size` long after their
   own rule, so the rendered size never changed. After a fold, confirm the RENDERED
   computed style, and when a class changes role (kicker → boarding-pass head bar),
   REMOVE it from the shared-recipe list — that is the delete-cheaper-than-add fix.
 6e. **Two silent killers from the crew-channels pass (learned 2026-09-23).**
   (1) `window.open(url, '_blank', 'noopener')` **always returns null** — the
   `noopener` feature implies no window handle — so `if (!win) throw` or
   `return !!win` misreads every SUCCESS as a popup-blocked failure (the
   moment-after screen's "Send invite" therefore never once opened WhatsApp
   and always fell through to the share sheet). Read nothing from the return:
   open without the feature flag and detach the opener yourself
   (`win.opener = null`), or just fire-and-forget. `src/lib/native.ts`'s use
   is statement-only and unaffected. (2) A hook placed **below** an early
   return crashes with "Rendered more hooks than during the previous render"
   the moment data hydrates after mount (store async) — the component renders
   the not-loaded branch first, then the loaded branch, and the hook counts
   differ. It only reproduces on a FULL reload, never on hash navigation
   into an already-hydrated app, so "it worked when I clicked around" proves
   nothing: test the fresh-load path for any component with an early return.
 6f. **Two wiring traps the fuel-halts line caught (2026-09-23).** (1) An async
   result that feeds a `useMemo` MUST be in the memo's deps — the halt fetch
   landed in state while the memo kept its empty closure and the line never
   rendered; every pure-layer test was green because the drop happened in the
   page, so only a rendered check catches this family. (2) A planner halt whose
   fuel tick folded into a meal/overnight (#144A) keeps the combined service in
   its `label` ("Overnight + fuel"), not its singular `purpose` — a consumer
   filtering `purpose === 'fuel'` drops nearly every planned refuel on a
   multi-day corridor (measured: 3 planned, 0 surfaced). Match the label too.
 6g. **A deps-object field rename is type-checked only where the object literal
   is FRESH — and one project decision can land on two unrelated deps objects
   (learned 2026-09-25).** Renaming `travellers` → `memberCount` for #335 was
   applied by grep to three `travellers: trip.travellers` lines in MapTab, but
   only two of them were `DaySlotsDeps` (the vote quorum). The third fed
   `NearbyOpts` (the corridor's fatigue cadence) and a fourth — in the
   suggestion-cache hash — surfaced as `error TS2353` while the `NearbyOpts` one
   built GREEN: `const opts: NearbyOpts = useMemo(() => ({ … }))` is not a fresh
   literal to TS (the initializer is a call, and excess-property checking does
   not reach through it), so the wrong key is accepted and `opts.travellers`
   reads `undefined` at runtime — cadence silently reverts to the default. The
   generic form `useMemo<NearbyOpts>(() => ({ … }))` DOES reject it. So: after
   any deps-field rename, enumerate call sites by the TYPE each object feeds
   (not by grep), and treat a green build as no evidence for the inferred-generic
   sites. Same family as 6f(1) — the drop happens in a page, and pure-layer
   tests stay green.
 6h. **An insert-if-absent cache merge is a staleness bug waiting for a state
   change — and a new tripwire must be run against the PRE-FIX source (learned
   2026-09-25).** `fetchPublicTrip` merged its row with `if (!some(…))`, which is
   fine while a row never changes and wrong the moment one does: after a paid
   unlock the same RPC answered with real days while `tripById` kept serving the
   pre-purchase stub, so the page body and the fork both stayed on placeholders
   until a reload (#349). **When a reader is server-authoritative, the merge is a
   REPLACE** — and if it writes `cache.trips` it must honor the two guards the
   realtime handler already uses (`isStaleServerRow` against
   `serverTripTimestamps`, `isRecentLocalWrite` against the echo window) or the
   echo of a local write starts fighting the fetch. Companion trap: a "trust
   flag" parameter that is accepted and ignored is worse than none — wire it to a
   POSITIVE only and never trust its negative, because a page's flag is `false`
   while its own entitlement read is still in flight, which is exactly when a
   buyer who just paid clicks the button.
   **Proving the test is not vacuous:** a tripwire written after the fix tends to
   pass for the fix's own reasons, so stash the implementation and watch it fail —
   `git stash push -q -- src/store/store.ts src/lib/forkPub.ts` → run the new
   suite → `git stash pop -q`. Eight of #349's eleven tests fail that way; the
   other three are the fail-closed controls, which SHOULD pass before the fix
   too. Do this before every fix-verifying commit, not just this one.
 6i. **A create that is awaited must roll back like the copy path, retry on the
   SAME object, and tolerate its own duplicate key — and its UI guard must span
   the await (learned 2026-09-25).** #374/#373: `createTrip` admitted the trip,
   fired `void persistTrip(...)` and returned, so the page routed into a
   workspace over a row that might not exist; there was no submitting state, so
   both CTAs stayed live and every submit minted a fresh uuid. Two mechanics
   worth keeping: (1) **a retry must reuse the built trip object** — its id is
   the idempotency key, so a first attempt that reached the server is not
   followed by a twin; (2) **an upsert CANNOT express that retry.** `trips
   update`'s policy is `is_editor(trips.id)`, which reads the `trip_members` row
   the same failed attempt may not have written, so a conflict-update is refused
   by RLS — tolerate the `23505` on a retry instead (`opts.retry`), on BOTH the
   trips and the members insert, and never on the first attempt. (3) A "trust the
   await" flag on the create half must be a ref checked before `setState`
   resolves, or a same-tick double-click reads `false` twice; and the create
   wrapper must `try/catch` the persist, because a dropped fetch rejects where
   supabase-js usually answers `{error}` — an uncaught throw leaves the
   optimistic row in the cache forever, which is the zombie the fix removes.
   Test-mock trap from the same session: a mocked thenable must pass BOTH `then`
   handlers (`Promise.resolve(x).then(res, rej)`) — a `then` that ignores the
   rejection handler makes the awaiting caller hang to the 5s timeout while the
   rejection surfaces separately as an unhandled error.
 6j. **Deleting a row that money hangs off is a revocation, not a cleanup — and a
   guard keyed on that row's EXISTENCE breaks in the direction you are not
   looking (learned 2026-09-25).** `unpublishItinerary` deleted the
   `published_itineraries` row, and `entitlements`, `purchase_orders` and
   `pub_events` all carry `on delete cascade` on `pub_id` — so "remove it from
   Explore" silently confiscated what buyers had paid for and erased the
   creator's own sales ledger and funnel, with no status change, no refund and no
   record anywhere. Unpublishing is now a marker (`unpublished_at`, bigint ms
   like its siblings `published_at`/`refreshed_at`) and the ROW SURVIVES: that is
   what keeps buyers whole. Three things worth keeping: (1) before deleting a
   row, grep every FK that cascades FROM it — the blast radius is the schema, not
   the call site; (2) `get_invite_trip`'s paywall guard keys on a priced
   publication row EXISTING for the trip, so deleting that row would have opened
   the very leak the guard was written to close — an existence-keyed guard is
   satisfied by presence, and silently satisfied again by absence in the other
   direction; (3) a reader that must work before its migration is applied has to
   fail CLOSED here — with the column missing, unpublish refuses and names the
   migration, because the old fallback (delete) IS the bug. Companions: the trip
   must NOT be flipped `private` on the way out (`get_public_trip` requires
   `visibility = 'public'` to serve an entitled buyer, so that flip revokes the
   very buyers the row was kept for — and the tightened `trips read` policy
   already restricts direct reads to owner/member/admin, so keeping it public
   leaks nothing); and a KPI that counted those rows stops being true the moment
   they stop being deleted — a "Live" cell and a "Behind" count had to learn the
   marker in the same commit, or the strip contradicts the list printed under it.
 6k. **A capability one endpoint leaks is a key for every other endpoint — and a
   `select *` in an anon-facing function is how it gets leaked (learned 2026-09-25,
   #351).** `get_public_trip` stubbed the paid days correctly and then returned the
   whole trip row anyway, `invite_code` included; `get_trip_by_invite_code` had no
   premium gate at all, so the same anonymous caller traded that code back for the
   complete plan — 4 days, ZERO stubbed stops, no account, no payment. Five rules:
   (1) a function granted to `anon` must name its columns — `select *` makes every
   column a future migration adds public by default, and the default has to be the
   other way round; (2) `returns setof public.<table>` does not let you omit a
   column, so a secret stays on the wire until the columns are enumerated and it is
   replaced by a typed NULL (`null::text as invite_code`) — the return type is not a
   licence to select the row; (3) a gate only guards the paths that have it — the
   uuid invite link was gated in v0.63.0 while the short code was deliberately
   "left untouched", which read as caution and was in fact the hole, so when two
   endpoints serve one capability, guard BOTH and test the pair; (4) a leaked
   capability is a CHAIN, not a bug: ask "can this field be traded for anything?"
   before rating the leak, because the field alone is harmless and the second
   endpoint is what turns it into a bypass; (5) prove it live — three
   unauthenticated curl calls settled in minutes what reading four migrations only
   suggested, which is why the issue's own "confirm the bypass first" step is the
   one that decides hygiene vs incident. Companion trap, specific to this repo's
   migration style: TWO files redefining one function means NAME ORDER decides
   which body a fresh database ends up running, so a later fix must carry every
   earlier guard forward verbatim (#350's soft-unpublish gate had to survive #351's
   rewrite of the same function, and the rewrite is exactly where it would have
   been dropped) — pin that ordering with a test, because the failure is invisible
   until someone rebuilds the database from scratch.
 6l. **A grant is API surface, and `service_role` is the right default for a
   caller-independent delete (learned 2026-09-25, #356).** `prune_pub_events`
   deletes on `at < horizon` — no pub, no creator, no caller — and shipped
   `grant execute … to authenticated`, so any signup could erase every
   publication's funnel history. The symptom is a trend that reads "nothing
   recorded", which looks like a bug in the reader rather than an attack, and
   there is no audit trail to say otherwise. Four rules: (1) choose the grant
   from WHO ACTUALLY CALLS IT — grep first; nothing called this one, which is
   what makes `service_role` correct and an `is_admin()` gate wrong (it would
   invent a caller the function does not have and still leave the delete
   reachable from an anon key plus a user token carrying an admin claim);
   (2) `revoke … from public` does not revoke from `anon`, and does not revoke
   from `authenticated` either — name all three, and note that a check covering
   one role is not a check covering the others (the contract suite asserted anon
   for months while `authenticated` stayed wide open); (3) a grants-only fix
   belongs in its OWN migration that creates no function and deletes nothing, so
   it cannot silently disturb what the function pins (here the 730-day clamp
   paired with the funnel reader) — and it must sort AFTER the file that granted
   the door, which is load-bearing rather than cosmetic; (4) `schema.sql` is a
   second and independent way to build the database, so a grant fixed only in
   the migration series leaves a fresh `schema.sql` instance wide open. Fix both
   and let a test compare them.
 6m. **A redefinition inherits the holes of the body it copies — and a comment
   claiming a field is unused is a hypothesis, not evidence (learned
   2026-09-25, #352/#353).** `get_public_trip` was rewritten three times in one
   week (#350, then #351, then #352/#353), and the third rewrite is where two
   long-standing holes finally got fixed: `free_day_indexes` was read with no
   shape guard, so a scalar in that column makes the RPC raise and the public
   page shows "didn't load" for **every** visitor (an availability bug, not a
   disclosure one — failing closed still takes the page down), and the trip's
   `expenses` and `fixed_commitments` were served in full while the days were
   stripped. Both had been carried forward **verbatim** by the two rewrites
   that were busy fixing something else, which is the trap: when you
   `create or replace` a body you own every unguarded input in it, so read the
   whole body looking for the input its neighbour loops guard and it does not
   (this one guarded days, day indexes, stops and corrupt arrays, and missed
   the free-day list). The second half is worse than a bug: the note this fix
   deleted asserted the public page "renders neither" money field — written
   from reading the component's imports instead of grepping for the field. The
   page calls `computeTotals(trip)`, which reads `trip.expenses`, and its own
   locked copy promises "the budget breakdown [is] in the full plan". A
   withheld field with no day key to filter on gets the honest rule — an
   unentitled viewer of a priced plan receives no money at all — because a
   partial strip leaves exactly the breakdown the copy says is withheld.
 6n. **"Deployed" is not "launched": a build-time flag's switch is part of its
   release, and its dark default is deliberately asymmetric (learned
   2026-09-25, #427).** The v0.65.0 create funnel was fully deployed to
   production and fully invisible there — `/new` loaded, the app rendered, and
   all seven phases were missing — because `VITE_CREATE_FUNNEL` was never set in
   Vercel and **no test, check or deploy step can see that**: Vite inlines
   `VITE_*` at build time and "unset" is a valid state. The asymmetry is the
   trap: unset means *all on* in a dev build and *dark* in a production one (so
   `test` can dark-run a phase before `main` sees it), so a dark production
   build reads as a broken feature rather than a missing switch — never "fix" it
   by changing the default. Prove a deployed flag without trusting the dashboard
   by **content-addressed chunk hash equality**: a local build with the variable
   unset emitted `featureFlags-Exwc-GsR.js` containing `t(void 0,!1)`, the same
   chunk name production served, so production's baked value was provably
   `undefined` — the same trick `docs/DEPLOYMENT.md` already documents for
   `index-<hash>.js`. What ships with the flag: a row in the deploy table (not
   just a line in the release notes), a source-text test keeping the documented
   phase list identical to the `createFunnelOn()` call sites (a typo in the
   deployed value darkens exactly one phase while the rest light up), and a
   **production-only warning** in `vite.config.ts` — warn, never abort, because
   a preview branch dark-running a phase is what the flag is for.
 6o. **The issue auto-close parser cannot read negation — "this does not close
   #N" closes #N (learned 2026-09-25, PR #443).** The workflow that mirrors the
   tracker for `test` matches GitHub's own grammar — a closing keyword
   (`close[sd]?`, `fix(?:e[sd])?`, `resolve[sd]?`) followed by a reference — and
   that grammar has no negation. A PR body written to be *careful* — "It does
   not close the P0, because production is still dark…" — closed that P0 the
   instant it merged; `github-actions[bot]` did it, and it was reopened by hand
   twelve seconds later. The reopen is the cheap part: a P0 that stays closed
   while everyone believes it shipped is not. `refs` is **not** a keyword, so a
   bare "Refs #N" line is inert — which makes the lesson narrower and nastier
   than "do not mention issues": a keyword within reach of a number closes it,
   whatever the surrounding sentence says. To reference an issue you do not mean
   to close, keep the number out of a keyword's reach ("see the dark-funnel
   issue"), and if a PR must explain why it is *not* closing something, say so
   without putting the number behind the word. Pinned in
   tests/pr-auto-close.test.ts so nobody "improves" the parser into guessing
   intent.
 6p. **A display string is not a key — and a derived value is not free to
   move (learned 2026-09-26, the Timeline/Board wave).** Two sides of one
   lesson from the same day's fixes. (1) Warnings were filed per day by
   PARSING their rendered title (`/^Day (\d+):/`), which silently lost every
   warning whose title leads with a stop name instead of a day (opening hours)
   and every trip-level one (accommodation churn — no day to find). The fix is
   the general rule: when a surface needs to know which entity a record
   belongs to, the PRODUCER must attach it as data (`dayIndex` on
   `ScheduleWarning`, `null` for trip-wide) and the surface must group on that
   field; a regex over prose is only a fallback for legacy shapes, and an
   unmatched record must land in a "trip-wide" bucket rather than vanish. Say
   the count out loud too: a chip that promises "+N more — see Timeline"
   forces the Timeline to render exactly those N, trip-wide block included.
   (2) `optimizeDayOrder` pinned a day's tail only when the tail stop was a
   hotel or a rest, but `originOf(next day)` derives tomorrow's wake-up point
   from whatever the day's LAST stored stop is — so a tail stop that was only a
   dinner move relocated the next morning (~16 km in the reported case).
   Before letting any writer touch a stored value, ask which OTHER derived
   values read it (the repo's own dayEndPosition/originOf pair), pin the
   source, and write the property test that asserts the derived value is
   unchanged rather than trusting the shape — that property test is what
   caught this. Companion trap from the same family: the optimize preview was
   a SNAPSHOT taken when the dialog opened, so a drag that landed while it was
   up was discarded on Apply; re-derive from current state at commit time and
   refuse-with-a-toast on divergence rather than last-write-winning silently.
   And when a number is an estimate, label it as one at every point it is
   shown (the optimize dialog presented chord km as road km whenever the road
   had not been measured yet — `measuredLegCount(...) === 0` is the honest
   signal; a scale ratio of 1 is ambiguous and must never imply measurement).
 6q. **An id the UI stages is a claim about the PLAN — reconcile it against
   the plan, never against time (learned 2026-09-26).** Five inline
   “already added?” checks in one file disagreed: a rejected stop blocked its
   name forever, `" Hotel Taj "` never matched `"Hotel Taj"`, a provider
   `placeId`/`eLoc` was ignored, arcs advertised owned places, and one path
   marked a hit added BEFORE Keep while another marked it after — so a
   discarded preview left a ghost id that hid the place until reload, and
   during an open preview the same hit could be staged twice. One predicate
   (`lib/placeIdentity.ts`) now owns the rule for every caller, and the staged
   set is released by a preview-close effect that asks the PLAN whether the
   place arrived (`discardedStagedIds(staged, identity.names)`) instead of
   asking how much time has passed. When several call sites each answer the
   same membership question, that is one predicate with one normalization
   contract (trim/lowercase/collapse + provider key join) — and the exit path
   (discard) needs the inverse of the entry path (stage) in the SAME change.
 7. **When asking the user to review/test locally, always hand them the exact
   URL — never make them find or start the server.** Check if the dev server
   is up (probe `http://localhost:5173`); if not, start `npm run dev`
   detached (`Start-Process npm.cmd -ArgumentList 'run','dev'` in PowerShell,
   or from Git Bash `nohup npm run dev -- --port 5173 --strictPort > /tmp/dev.log
   2>&1 &` — the durable form, since a harness `BACKGROUND` mode may not exist
   and a plain `&` alone can leave the tool waiting on the pipe). Confirm it
   serves *this* working tree before linking (fetch
   `http://localhost:5173/src/styles.css` and grep for a token/marker that
   only exists in the current branch's changes — a stale server from another
   branch will otherwise silently show old UI). "Up" is not "current": a
   long-running dev server's file-watcher can die during branch churn and
   keep serving a dead module graph with HTTP 200 (happened on the 5176
   server, Sep 14 2026 — hot reload silently stopped mid-session). If the
   marker greps come back empty on a *responding* port, kill the PID
   (`netstat -ano | grep :PORT` → `Stop-Process -Id <pid> -Force`) and start
   fresh, then re-grep the markers before handing over the URL. Then give
   deep links per screen (e.g. `http://localhost:5173/#/` for Landing,
   `http://localhost:5173/#/trips` for My Trips) and say what to check
   (themes, mobile width, specific interactions). **"Serving this tree" is not
   "serving it with a backend":** a dev server started before `.env.local`
   existed (or from another clone of the repo) serves the current source and
   still renders blind — the console reports *"No Supabase project compiled
   into this build"* and every data surface sits on `Loading…` with
   `hydrate … failed`, which reads exactly like a broken product. Before
   handing over a URL, prove the backend is compiled in by grepping the served
   client for the project ref
   (`curl -s http://localhost:PORT/src/lib/supabase.ts | grep -o <ref>`) and
   start a fresh server if it comes back empty; the `localhost:54321` fallback
   string is in every bundle, so it discriminates nothing. (Found 2026-09-17:
   the long-running 5173 server had no Supabase project compiled in at all.)
8. **Build locally first; confirm the target branch before every push.** A feature
   or fix is always implemented and verified (`npm run verify`) on the current
   local branch before any push is even discussed. When the work is ready, tell
   the user which branch you propose to push to and wait for explicit
   confirmation — never push to `main`, `test`, or any other branch as part of
   the implementation step. This prevents unauthorized code from reaching a
   shared branch and keeps the user in control of what ships.
9. **Never bulk-rewrite `CHANGELOG.md` with a script, heredoc or shell
   interpolation — edit it with editor primitives only.** This failure mode has
   already hit twice — three, counting the scripting-language variant (2026-09-21):
   a python splice meant as `lines[i:i] = [entry]` was written as `lines[i:i] =
   entry` over a *string*, which slice-assigns CHARACTER-wise and shredded 4
   lines into 6,000 (the file blew up 4×; `git restore` recovered it, and was
   only safe because every other change in the file was already committed).
   Splice lists of LINES, and re-check the diff stat before moving on: a doc
   edit whose insertions outnumber the lines you meant to add is a shredding
   in progress. In `adf5f66` (*"chore: v0.42.0 — changelog cleanup"*) a
   bulk rewrite truncated the file from **830 lines to 21**, discarding the
   entire pre-`0.42.0` record, and while rewriting ate the leading byte out of
   code spans — `` `applyChange` `` committed as `` `pplyChange` ``,
   `` `routeHash` `` as `` `outeHash` ``. The `[0.43.0]` entry records an
   earlier instance of the same class (*"a BEL character where an 'a' should
   be"*). A byte-eating rewrite in the one file that records the project's
   history destroys the evidence you would need to notice it happened.
   The truncated record was recovered on 2026-09-11 as
   `docs/history/CHANGELOG-through-0.41.1.md`; the rule and the archive's
   rationale are documented in `docs/history/README.md`.
   Corollary: **destructive edits to documentation get their own commit**, so
   the diff is reviewable in isolation and a revert is surgical.
10. **Every interactive surface ships motion from the motion tokens** —
   `docs/MOTION-TOKENS.md` (durations `--motion-fast/med/slow`, easings
   `--ease-out`/`--ease-glide`, and the pattern catalog: dropdown entrance,
   toggle glider, day collapse, drag follow/settle). Pick a pattern from the
   catalog, don't invent a feel; a raw `ms` value in a new CSS rule is a
   review flag; `prefers-reduced-motion` opt-outs are mandatory on animated
   rules. This exists because the long-refined surfaces (Timeline, Board) feel
   smooth while newer additions shipped motion-less — the gap only stays
   closed if motion is part of "done" for every update.

11. **Work stays locally committed until it is complete and the localhost check
   is satisfactory.** Commit as work lands on the working branch; a push is the
   last step of a finished batch, never the end of each fix or review pass. The
   author decides when a batch is finished and testable, and says so before any
   push (user-mandated 2026-09-17).

12. **A PR merged into `test` does NOT auto-close its issues — close them by
   hand (learned 2026-09-25).** GitHub's `Closes #N` keywords fire only when a
   PR merges into the DEFAULT branch (`main`), so every fix that lands on
   `test` leaves its issues OPEN: the Wave-0 map merges (#380/#399) carried
   seven closing keywords and closed nothing until each issue was closed
   manually with a landing comment (merge SHA + PR number). After merging a
   PR into `test`, verify with `gh issue view` and close the referenced issues
   yourself — the tracker must mirror reality, not the keyword's promise.
   **Automation (same day):** `.github/workflows/issue-autoclose.yml` mirrors
   the tracker on every PR merged into `test` (keyword grammar in
   `scripts/pr-auto-close.mjs`, pinned by `tests/pr-auto-close.test.ts`) and
   leaves a landing comment on each issue it closes. Still verify after a
   merge, and close by hand when that job is red — the rule is the mirror, not
   the mechanism.


   **A migration the USER must run is handed over as complete SQL, in the chat,
   with its full local path — never as a filename to go and find (user-mandated
   2026-09-25).** These are applied by hand in the Supabase SQL editor, so the
   handover is the whole file, verbatim, pasted as one runnable block, with the
   absolute path beside it
   (`C:\Users\hasna\yatraflow-freebuff\supabase\migrations\<file>.sql`). Say
   whether re-running is safe and what the status check should read afterwards.
   Then PROVE it landed instead of assuming: `npm run check:migrations` must fall
   to `0 missing`, and an independent live probe is the stronger evidence — a
   PostgREST `select` of the new column answers `200`, while the same request
   naming a control column the schema never had answers `400 42703`. A file
   sitting in the repo says nothing about the database (#432's
   `resolved_option_id` type change is the case that proves it:
   `check:migrations` can never see it, and only the probe did).

## 3. Verification before every push

Use `npm run verify` — it runs the full gate:
`tsc -b --clean` → fresh typecheck → full test suite → production build.

Hard rules (each learned the hard way — do not relearn them):
- **After syncing a large remote update, run `npm install` before `npm run verify`.**
  The Capacitor Android shell added `@capacitor/*` dependencies that a pre-shell
  `node_modules` lacks; the first verify then fails with ~15 confusing
  `Cannot find package '@capacitor/core'` test errors that look like code
  breakage but are only stale dependencies (Sep 2026).
- **Bare commands only.** NEVER verify with `cmd /c "... & echo %ERRORLEVEL%"`.
  `cmd` expands `%ERRORLEVEL%` **at parse time, before the commands run**, so it
  echoes a stale exit code and masks real failures. This caused repeated
  "local passes / Vercel fails" drift (Aug 2026, twice).
- **PowerShell: a bare `echo;` (no argument) prompts for `InputObject` and hangs
  captured output** — always pass an argument (`echo '---'` / `Write-Host "…"`).
  The terminal looks stuck and shell-integration reports the command as still
  running (cost debugging time fetching `gh issue view` bodies, Aug 2026).
- **A source-scanning guard greps the whole file, so a COMMENT about the thing it
  guards will trip it (learned 2026-09-26, #333 A4).** The rail's "no control may
  opt out of the tab order" assertion (`not.toMatch(/tabIndex=\{-1\}/)`) went red on
  its own fix, because the comment explaining the removal quoted the literal it had
  just deleted. Fix it by spelling the literal out of the prose ("a -1 tabIndex",
  "buttons with onClick") — never by weakening the guard: a blanket check that no
  control opts out of the tab order is worth more than the sentence it costs. Same
  family as the literal-grep rules above, from the other side: a guard must be
  taught to resolve a new constant, and prose must not impersonate the code it
  describes. It is also a good sign — a guard that fires on its own documentation
  is a guard that is genuinely reading the file.
- **`tsc -b --clean` first** in any session before trusting a typecheck —
  incremental build caches pass code that clean builds reject.
- **But `--clean` DIRTIES, it does not typecheck — and in `verify` the real
  typecheck runs LAST (learned 2026-09-20).** `tsc -b --clean` deletes build
  info and **exits without compiling**, and `verify` is
  `tsc -b --clean && npm test && npm run build` with `build` = `tsc -b && vite
  build`. So an undefined identifier reaches the test run *before* any
  typecheck happens and surfaces as a runtime `ReferenceError` in whichever
  suite exercises that path — the rebase of #261 left one use of a variable
  the other side had deleted and 18 hydration tests failed with
  `ReferenceError: catalogTrips is not defined` while the log contained no
  `error TS` line at all. A red run whose failures all sit in one code path
  and all report the same ReferenceError is a compile error wearing a test
  failure's clothes: read the failure's own text and grep the log for
  `[yatraflow]` before blaming the tests. And a green `verify` is only
  complete when the `built in …` line is present — that line is the proof the
  typecheck and bundle actually ran.
- **A conflict-free rebase is not a correct rebase — git's auto-merge can
  produce code neither side ever had (learned 2026-09-20).** Rebasing #261 onto
  `test` merged `src/store/store.ts` cleanly, but one side had deleted a
  `catalogTrips` query and the other had *added* a loop over it: the result
  referenced a variable that no longer existed, in a file git reported as
  merged. Auto-merge resolves **text**, never meaning. After any rebase that
  touched a file both sides edited, run the full `npm run verify` on the
  rebased tree before pushing — and when a suite fails wholesale after a
  rebase, suspect the merge of the file the suite covers before suspecting the
  branch's own change. The replay also means **the branch's CHANGELOG entries
  re-filed themselves into the released section** if the branch was cut before
  the release:  check `git diff origin/test..HEAD -- CHANGELOG.md` lands under `[Unreleased]`.
- **A custom `merge=<driver>` attribute can delete a file's change from a rebased
  commit while the rebase reports success (learned 2026-09-26).** Resolving a
  four-branch stack's recurring `CHANGELOG.md` conflicts with a `--union` driver
  (`git config merge.X.driver "git merge-file --union %O %A %B; true"` plus
  `CHANGELOG.md merge=X` in `$GIT_DIR/info/attributes`) rebased all three cleanly
  and reported "Successfully rebased" for each. Every one of the three commits had
  silently **lost its `CHANGELOG.md` change** — `git show --numstat <sha>` no longer
  listed the file at all, and the driver's `; true` was the tell: it exists to hide a
  non-zero exit, and that exit means `git merge-file` never wrote `%A`, so git
  recorded the path as merged with the upstream side alone. **Verify a driver-based
  rebase by content, not by exit status**: after it, `git show --numstat` each
  replayed commit and confirm the files you expected are still listed, and grep the
  file for each entry's own issue number. Prefer resolving doc conflicts by hand with
  editor primitives (§9); if a driver is used, drop the `; true`, treat a non-zero
  exit as a conflict, and check the file before continuing. The union driver also
  lives in the **shared** git dir of a linked worktree (`git rev-parse --git-path
  info/attributes` resolves to the main clone, not the worktree), so it silently
  changes merge behaviour for every other worktree — remove it when the job is done.
- **Probing a submit handler in the preview: `requestSubmit()` runs native
  constraint validation first** (measured 2026-09-23: a `min={0}` input holding
  `-5` fires `invalid`, never `submit` — the handler silently never runs and the
  browser's own bubble is the only symptom), so set `form.noValidate = true`
  before forcing a validation-error path; and never read the DOM in the same
  evaluate that triggered a React state update — the render lands next tick, and
  a same-tick read returns the stale tree, which looks exactly like a broken
  fix (three phantom "missing error" probes in a row came from these two).
- **`npm run verify` outlives a 30 s shell window — run it DETACHED and poll
  the log.** `Start-Process cmd.exe -ArgumentList '/d','/c','npm run verify >
  %TEMP%\v.log 2>&1' -WorkingDirectory <repo> -WindowStyle Hidden`, then
  `Select-String` the log in a follow-up call. Two traps this replaces
  (Sep 2026, clock-overlay phases): a foreground verify in a captured shell
  times out mid-gate and the result is unknowable; and PowerShell turns npm's
  stderr progress lines into a fake `NativeCommandError` exit 1 even when the
  gate is green — judge the run by the LOG's own summary lines
  (`Test Files`, `built in`), never by $LASTEXITCODE or the tool's error flag.
- **A merge's own output lists its conflicts by omission — `tail` hides them, and the `git status` U-list is the checklist (learned 2026-09-22, queue integration).** Two merges in one run printed three conflicted files each while a fourth (`AGENTS.md` both times) conflicted *above* the `tail -8/-10` window; `git commit --no-edit` then failed with `U <file>`, and a gate started over that half-merged tree is untrustworthy. After ANY merge or rebase step: `git status --short | grep -E '^(U|.U|AA|DD)'` FIRST, resolve every row, only then commit and gate. Companion: a `grep -c` that prints 0 exits 1 and silently short-circuits the `&&` chain after it — zero matches is a fact to report, not a command failure.
- **ANY `src/styles.css` edit moves line numbers, and the design-system
  ratchet reads line numbers — expect `contrastLight/contrastDark/rawDurations`
  to "fail" after every CSS change.** Before re-baselining, prove the failure
  is ONLY a shift: re-run with `UPDATE_DESIGN_SYSTEM_BASELINE=1`, then diff the
  baseline and confirm the finding names are identical before/after (e.g. 29
  in → 29 out). A name that appears on only one side is a REAL new violation —
  fix it, don't ratchet it in (Sep 2026, three label phases in a row).
  **A comments-only CSS edit is the exception, so run the ratchet before re-baselining
  (learned 2026-09-26).** Fixing stale prose in two `styles.css` comments — one of them
  adding lines — left `design-system.test.ts` green: the baseline records selectors and
  their measured ratios, not source line numbers, so a shift that moves no declaration
  moves no finding. The reflex the rule above invites ("CSS changed, expect red, re-baseline")
  would have rewritten the baseline to hide nothing and churned the diff for free. Order of
  operations: change the CSS, run the ratchet, and only reach for
  `UPDATE_DESIGN_SYSTEM_BASELINE=1` when it is actually red — then still prove the finding
  names are identical in and out.
- **The ratchet parses each selector's OWN declaration pair — it never walks
  the cascade (learned 2026-09-22).** A `:root` override can fix a contrast
  finding on screen while the baseline keeps it forever: `.day-warn-pill`
  rendered at its override's `--ink-amber` 5.38:1 while the baseline still
  recorded `.day-warn-pill — 3.69:1` from the base rule, so an audit reading
  the baseline reported a defect the screen did not have — and a browser check
  would have "disproved" it. Fix the **base rule** (the later override then
  becomes redundant), re-baseline, and expect exactly that name to LEAVE the
  diff; a name that stays means the fix never reached the declaration the
  checker parses. Same root, other direction: `offLadderSpacing` flags a
  `margin-right: 3px` written in CSS even when the component beside it renders
  the same gap from JS — pick the ladder value (4) in the CSS too.
- If Vercel's deploy fails, reproduce locally with `npm run build` (the exact
  Vercel command: `tsc -b && vite build`), not `tsc` alone.
- `npm warn allow-scripts` about esbuild is a **warning, not a failure**; it's
  allowlisted via `allowScripts` in package.json.
- **Never fetch with a wildcard refspec** (`git fetch origin
  '+refs/*:refs/remotes/origin/*'`) — it remaps `refs/heads/*` to
  `refs/remotes/origin/heads/*` and **deletes** `origin/main`, `origin/test`
  and PR-tracking refs, so `origin/main` becomes "not a valid object name".
  Use plain `git fetch origin [--prune]`; to grab a PR, use
  `gh pr checkout <n>` or `git fetch origin pull/<n>/head`.
- **On this Windows box a plain `git fetch origin --prune` can die with `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030E)`, exit 128 — it is not a credential problem and a retry does not fix it.** Force the OpenSSL backend for that one invocation instead: `git -c http.sslBackend=openssl fetch origin --prune` → exit 0, refs advance normally (2026-09-20, advanced `origin/test` `468fb18..6081f32`). **Companion sandbox fact: outbound HTTP works, but not to every host — do not assume a probe must be handed to the user (corrected 2026-09-21).** This entry used to claim the clone had *no* outbound HTTP, on the evidence of `curl.exe` returning `000` for every URL. That is not what happens now: `POST <project>/rest/v1/rpc/<fn>` answers for real, and the `admin_revenue` probe returned a genuine `404 PGRST202` naming the parameters PostgREST searched for — which is how the unapplied migration was confirmed *and* how the RPC's contract was cross-checked against the handler. So try the probe first and fall back to the user only if it returns `000`; a `000` means *that* host is unreachable, not that scripting is impossible. Two recipes worth keeping: a bare
```bash
curl -s -m 12 -w '\nHTTP %{http_code}\n' -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$URL/rest/v1/<table>?select=*&limit=1"
```
discriminates a migration-gated table in one call — **`200 []` means the table EXISTS and RLS withholds the rows from an anon caller, `404 PGRST205` means it does not exist** — and control-running it against a nonsense table name is what anchors the reading, since `PGRST205` is also the exact code the client's degradation path keys on. `https://example.com` is the cheap "is the network up at all" check. Pull `$URL`/`$KEY` from `.env.local` (`grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d '\r"'`) rather than pasting them into a transcript. **For an RPC, send its real argument names** — a bare `{}` answers `404 PGRST202` for a function whose parameters have no defaults, which reads as absent when the function is there and merely mis-called (measured 2026-09-22: `owns_publication` and `bump_published_stats` both looked absent that way and both exist); the same code, with the real arguments, is the honest missing-check. The root `/rest/v1/` schema endpoint is not an option for this — it answers `401 Invalid API key`, since only a `service_role` key may read it.
- **A fresh harness sandbox starts as a shallow, blob-filtered partial clone with only `test` fetched — no `origin/main` ref, no `node_modules`, no `.env.local` (learned 2026-09-22).** `git rev-list origin/main…` therefore dies with *unknown revision* until you fetch the ref you need; run `npm install` before any `npm run verify`; and the live-DB checks (`npm run check:migrations`, PostgREST probes) must run from the user's credentialed box, since the keys never reach this clone. The local `git log` is depth-1 — answer history questions with `gh api` / `git ls-remote`, not the local log.
- **A pull request can carry no `Verify` run at all, and its page will not say so (learned 2026-09-25).** Two PRs were pushed with **zero** workflow runs on their branches: `gh pr checks` listed only Codacy and Vercel, which reads as "the gate is fine" because nothing is red. `gh run list --branch <branch>` is what tells the difference — if it returns nothing for the head SHA, the gate never ran and a local `npm run verify` on that branch is the only evidence there is. Companion: a **stacked PR** (a branch cut from another PR's branch) shows only its own delta in `git diff <base>...<head>` while its PR diff against the base still carries the parent's work, so merge the parent first and then `git merge origin/test` into the child — the child's `CHANGELOG.md` conflict disappeared entirely once its parent landed.
- **When a release cut has already moved `[Unreleased]` into a version heading, an incoming `[Unreleased]` entry must be folded INTO that heading (learned 2026-09-25).** Merging `test` into a promote branch conflicts on `CHANGELOG.md` exactly this way; resolving it by keeping your own side silently drops the incoming entries from the release. Take the incoming file (`git checkout --theirs CHANGELOG.md`), re-apply the cut heading above its sections with `edit`, and check the entry count on both sides of the conflict before committing — twenty entries in, twenty entries under the heading.
- **Never run dependent git checks as parallel shell calls** — during the PR
  audit, a ref-rewriting fetch raced a `merge-base --is-ancestor` check and
  returned contradictory results. Sequence dependent git commands in one call,
  and confirm merges via `gh pr view <n> --json mergeCommit` +
  `git merge-base --is-ancestor <mergeCommit> origin/main` (exit 0 = merged),
  not by eyeballing short `git log` windows.
- **`git rebase --continue` wants an editor in this clone, and the default one will hang you (learned 2026-09-20).** `git var GIT_EDITOR` answers `C:\WINDOWS\notepad.exe`, so a captured, non-interactive rebase stops dead on the commit message. Pass a no-op for that one invocation: `git -c core.editor=true rebase --continue` — `true` resolves because git runs the editor through its own `sh`, where it is a builtin. **Do not point `core.editor` at a Windows path**: git hands that string to the same `sh`, which eats the backslashes and fails with `C:Usershasna…: command not found`. That failure is harmless — the rebase is still in progress and the resolution is still staged — so just re-run with `true` rather than redoing the resolution. Same family as the `schannel` entry above: the friction is the shell git uses, not the git command.
- **A rebasing branch can find its change already landed — resolve by the item's identity, never by which hunk is bigger (learned 2026-09-20).** Rebasing #268 onto `test`, `ROADMAP.md` conflicted not over wording but over a **number**: both sides had written an `I-20`, for two unrelated ideas, and `test` already tracked the branch's idea as `I-19` in a *better* row — more accurate effort estimate, plus the reasoning the branch's row lacked. The correct resolution was to **drop** the branch's row (a deliberately redundant insertion, not a lost one), which is only visible if you read what each side's row *means* before resolving it. Expect this shape wherever a shared counter, ledger or issue number is allocated on both sides; a hunk-count or "keep both" instinct gets it wrong. Confirm the outcome arithmetically afterwards: the rebased commit's diffstat should differ from the original by exactly the lines you meant to drop.
- **CSS breakage is invisible to `tsc` + tests — only the full `vite build`
  sees it** (issue #14): a dangling declaration + stray `}` passed the
  typecheck and all 128 tests while vite 5 logged it as a mere minify
  *warning* for an entire release; a vite upgrade turned that warning into a
  hard error. Treat ANY minify warning in build output as a latent build
  blocker and fix it in the same pass. Related: junk dependencies can sneak
  into package.json from accidental installs (the `"24": "^0.0.0"` of
  issue #19) — review dependency diffs before committing. Since the vite 8
  upgrade, `@vitejs/plugin-react` must be v6+ (native vite 8 peers);
  plugin-react 4.x triggers ERESOLVE — the temporary `.npmrc`
  `legacy-peer-deps` pin was removed once v6 landed (0.19.0).
- **Vercel env vars are per-environment *and per-git-branch*, and Vite bakes
  them at build time.** The real cause of the recurring "login breaks on
  preview" was **not** Production-only scoping: `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` *were* ticked for Preview, but pinned to
  `gitBranch: "test"` — so only previews built from branch `test` got a
  backend and every other branch compiled blind. The app renders normally,
  then login fails with a bare `Failed to fetch` that reads exactly like a
  wrong password. `vite.config.ts` now **aborts a Vercel build** when
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are missing or still the
  `YOUR-PROJECT` template; CI and local builds only warn, since they
  legitimately have no credentials. Editing a var never fixes an existing
  deployment — **Redeploy** it.
- **A Vercel check failing on an already-verified tree is usually infra, not
  code — but prove it from the deployment payload, not the check name.** During
  the v0.55.0 promotion, every Vercel check on `test` failed (PR #218 blocked)
  while local verify ×3 and CI were green and identical content had deployed
  fine minutes earlier. The check-run/commit-status descriptions only say "run
  `npx vercel inspect <dpl> --logs`", which returns nothing useful; the real
  error lives in the deployment object —
  `MSYS_NO_PATHCONV=1 npx vercel api '/v13/deployments/<dpl>'` (the leading `/`
  gets MSYS-path-mangled without the env var) → `errorMessage:
  "Resource provisioning timed out", errorCode: BUILD_FAILED`. The unblock:
  `MSYS_NO_PATHCONV=1 npx vercel redeploy <dpl>` (Ready in 36s) — the commit
  status flipped to success on its own and the merge proceeded. Scope it first
  by committing-statusing a few recent SHAs (`gh api .../commits/<sha>/statuses`):
  all-recent-failures on green-local trees = infra; one-sharp-onset = diff.
  Also: `npx vercel` works while `vercel` alone does not on this machine —
  don't relearn which invocation is authenticated.
- **Trust `vercel env ls`, not the dashboard's checkboxes.** Its
  `environments (git branch)` column is the only place a branch pin shows up;
  the UI reads as "all enabled" (this misread cost a full wrong-diagnosis
  cycle). `vercel env add NAME preview --value … --type config --force`
  **adds** a branch-free record rather than editing the pinned one — both then
  coexist. Inspect/delete precisely via the API:
  `vercel api '/v10/projects/<prj>/env?teamId=<team>'` lists every record with
  its `id` + `gitBranch` (payload key is `.envs`, not `.env`),
  `vercel api '/v1/projects/<prj>/env/<id>?teamId=<team>'` returns the
  **decrypted** value (the only way to prove what is really stored), and
  duplicates go via the *batch* endpoint —
  `-X DELETE --field 'ids=["<id>","<id>"]'` on `/v1/projects/<prj>/env`
  (a per-id DELETE path 404s). Caveat: captured CLI output can swallow an id's
  **first character** into a preceding ANSI escape — print `.Length` (16) to
  catch it before a 404.
- **To reproduce a no-env build, move `.env.local` aside — blanking
  `$env:VITE_*` does nothing.** `vite build` reads `.env.local` regardless of
  the process environment, so a "stripped" build silently still had the real
  values and appeared to disprove the diagnosis. Check what a live deployment
  actually contains by fetching its `index-*.js` and grepping for `supabase.co`
  (recipe in `docs/DEPLOYMENT.md`) — with three traps, all of which produced
  wrong readings here:
  - **SSO walls more than previews.** The *deployment-specific* URL
    (`yatraflow-<8char>-<scope>.vercel.app`) is behind Vercel SSO **even when
    `vercel inspect` reports `target production`**, so an anonymous fetch
    returns Vercel's own Next.js login page (~340 KB, `X-Matched-Path: /login`)
    and the grep reports a misleading `False`. Grep the **canonical alias**
    (`yatraflow-blond.vercel.app`). Tell them apart by size: the real
    `index.html` is ~1.2 KB, the login page ~340 KB.
  - **The `localhost:54321` fallback is in *every* bundle.** `supabase.ts`
    compiles `import.meta.env.X || 'http://localhost:54321'`, so the placeholder
    string is present whether or not the env var was set — its presence proves
    nothing. Only the real `.supabase.co` host / project ref discriminates.
  - **`vercel ls` is newest-first** — `Select-Object -Last N` returns the
    *oldest* rows and can make a deploy that finished two minutes ago look
    entirely absent. Use `-First N`, or filter on `vercel\.app`.
  A green Vercel check is the proof for previews. Strongest proof for
  production: the alias's bundle hash equals a local `npm run build`'s, i.e.
  the artifact you tested is the artifact that shipped.
- **A browser probe that imports an app module can silently get a SECOND copy of it (learned 2026-09-19).** After any HMR update Vite serves the app's modules under timestamped URLs (`/src/store/store.ts?t=1789806911002`), so a probe doing `await import('/src/store/store.ts')` resolves the *clean* URL and instantiates a fresh module with empty state — no user, no trips, `ready: false`. It reads exactly like "the app is signed out and hydrate is broken", and it produced a wrong diagnosis until the DOM contradicted it: the page rendered "3 trips match …" while the probe's own snapshot reported zero users and zero trips. Before believing a probe about app state, restart the dev server (a fresh module graph carries no timestamps) or reload and probe **without editing a file in between**; and cross-check the rendered DOM, which always reflects the app's real instance. Related: `import.meta.url` in an `agent-browser eval` payload is a SyntaxError — it is not a module context.
- **A test that spawns `node` children is unreliable inside the full parallel
  vitest run on this box — the child dies before executing anything, while the
  same test passes in isolation (learned 2026-09-21).**
  `tests/migration-status.test.ts` failed twice in `npm run verify`, each time a
  *different* one of its stub-server tests, and each time as an assertion that
  read like a broken check: once an empty `stdout`, once
  `expected 3221226505 to be 0` (Windows `0xC0000409`, V8's fastfail).
  `npx vitest run tests/migration-status.test.ts` was green every time, and the
  script itself ran fine from the shell against the live project. The file now
  retries once when a child exits non-zero **with no output on either stream** —
  every real outcome of that check prints something, including exit 2, which
  writes to stderr, so that signature can only mean the process never ran — and
  otherwise throws naming it as an environment failure. Generalize the reading:
  when a spawned-child test fails only under the full suite, ask whether it
  produced *any* output before suspecting the code, and make "the process died" a
  distinct, named failure so an environment problem can never masquerade as a
  wrong verdict about the thing being tested.

- **Supabase auth fails two different ways** — rejected credentials come back as
  `{ error }`, but a network failure *throws* `AuthRetryableFetchError`. Wrap
  both (see `store.login`/`signup`) and map through `lib/authErrors.ts`; an
  unwrapped throw leaves the sign-in form silently re-enabling after its 10 s
  failsafe timer with no message shown.
- **A source-level test regex that spans a line boundary must tolerate CRLF — `core.autocrlf=true` means a pre-existing file is checked out CRLF while a file you created is LF, so the same pattern matches one and silently never matches the other (learned 2026-09-21).** Pinning I-21, `expect(handler).toMatch(/} catch {\n    return false\n  }/)` failed against `api/i.js` while single-line patterns over the same file passed — the file's lines end `\r\n`, so `\n` never follows `catch {`. Write `/\r?\n/` in any multi-line source assertion, and be aware the *opposite* trap is live too: a test file or migration authored this session is LF in the working tree until the next checkout converts it, so an assertion that passes today can be reading a different line ending than the file it pins. (Companion: when a source assertion fails, print what the regex was actually run against before suspecting the code — `codeOf()` in `tests/purchase-share-card.test.ts` exists because the failing match was a COMMENT saying "I bought", not the code claiming it.)
- **A doc line in the future tense about shipped work is a defect class no gate can see, and the source comment is usually what it quotes (found 2026-09-21).** A sweep for "not yet / does not exist / blocked on / still to come" against the code found the monetisation plan still reading `Payment rail — Does not exist`, `Entitlements — Does not exist` and `**The lock does not exist yet.**` weeks after v0.61.0 shipped them, and `docs/ARCHITECTURE.md` still promising "What M7 must add for real rows (none of it exists yet, by design)". The tell: those lines agreed with each other and disagreed with the repo — and the *seed* of the drift was the code comment `premiumPriceInr // placeholder for future payments`, which the plan quoted as its evidence. So: when reconciling docs, grep the CODE for a stale claim and fix it there too, or the next doc will quote it straight back. Method: grep, then classify each hit by **what the code does now** (not by how the sentence reads), and for a doc whose header carries a date + baseline (PLAN-COMMERCIAL-EXECUTION, REPORT-2026-09-15) add a status block naming what has since shipped rather than rewriting the dated body — the plan is the record of a decision, the status block is the truth about today. Dated snapshots keep their date; live tables (`PLAN-MONETISATION` §1, which already tracked the fee model as shipped) get corrected in place. **This is a gate now, not a method (2026-09-21):** `tests/doc-drift.test.ts` scans every live doc for absence cues and fails unless each hit is registered with a reason it is still true and — where the subject can be detected in the repo — a **marker** that turns the claim red the day the thing ships (a `payouts` table is what three payout claims watch). A registered sentence that gets reworded fails too, so the registry cannot rot into quotes nobody wrote. Working on a live doc: never silence a hit by widening the cue list, and when the subject ships, delete the entry *and* fix the sentence in the same commit.
- **A surface that needs a session can only be *asserted*, never *rendered* — so give it a fixture whose numbers a test pins (learned 2026-09-21).** The earnings ledger, the payout-runs ledger and the publish editor all need a creator with real sales behind them: the node suite has no DOM and no session, so their arithmetic was pinned by `tests/earnings.test.ts` while their rendering was verified by nothing at all — the gap where `.reveal` (I-20) hid a whole-page layout bug behind a green `npm run verify`. `scripts/seedCreatorFixture.mjs` closes it: a creator + buyers (signed up via the anon key, the harness's idiom), trips, priced publications and backdated sales, printing credentials and deep links. Two rules it follows that the next fixture should too: **(1) the seeded rows are the same rows a test prices** (the fixture's five sales are pinned in `tests/earnings.test.ts`, so a browser check has an answer key instead of an opinion), and **(2) a fixture that writes money rows must elevate and say so** — `entitlements` is SELECT-only for authenticated clients by design (the only write path is the buyer-scoped claim RPC), so it uses `SUPABASE_SERVICE_ROLE_KEY` or `PGCONN` (the `scripts/apply-schema.mjs` precedent) and otherwise prints the SQL to paste. Dry run by default; `--apply` writes; only ever touches the rows it names. **(3) A fixture CLI cannot be imported by a test — put its numbers in a PURE module instead (learned 2026-09-21).** `scripts/seedCreatorFixture.mjs` runs its whole seed on import, so importing it to check its arithmetic would create accounts; the traffic plan it seeds therefore lives in `scripts/fixtureFunnelPlan.mjs` (no I/O, no env, no side effects), which both the script and `tests/pub-funnel.test.ts` import — and the test runs the SHIPPED derivation over the fixture's own rows, so a browser check has the app's arithmetic as its answer key rather than a second opinion. Its window helper is duplicated on purpose: the two must agree, and a one-day drift in either is a red build. **(4) A fixture that seeds an event LOG must REPLACE it, not append (same date).** Trips and publications are guarded by slug, but rows keyed only by a parent id — funnels, counters, any date-series — double on a second `--apply`, and a doubled trend reads as a product whose traffic is exploding. Delete the fixture's own publications' rows first, in BOTH the elevated path and the SQL it prints for a keyless machine.
- **Each `run_commands` array entry is a separate shell process** — a `$var`
  assigned in one entry is empty in the next, so multi-step probes silently
  return nothing and look like failures. Put a dependent pipeline in a single
  command string, with `try/finally` whenever it touches real files.
- **A screenshot pass runs one browser command per tool call, and never
  wrapped in a shell `timeout`.** An `agent-browser` call that chains `open` +
  `wait` + `screenshot` + `eval` exhausted the call budget and the harness
  returned **no output at all** (not partial stdout), which reads exactly like
  a hung CLI; the same commands, one per call, all returned in seconds. A
  `timeout` wrapper makes it worse, not safer: killing the CLI leaves its
  browser child holding the pipe, so the call hangs to the tool's own limit
  anyway. And a *brand-new* session's first command really is slow — a cold
  browser launch outlived a 280 s call — so start that one detached
  (`nohup agent-browser open <url> > /tmp/ab.log 2>&1 &`), poll the log, then
  reuse the warm session. Three companions: relative screenshot paths are
  ignored — they land in `~/.agent-browser/tmp/screenshots/` whatever you pass,
  so hand it an absolute path; a cold Vite transform is what makes the *page*
  slow, so warm the route *and its modules* with `curl` first; and
  `transferSize` reads 0 on cross-origin images (Wikimedia exposes no resource
  timing), so prove a cover's weight from the origin
  (`curl -w '%{size_download}'` on the `src` the DOM actually rendered)rather than from `performance.getEntriesByType('resource')`.
- **A hidden preview webview freezes `requestAnimationFrame` and can stall the MapLibre style forever (learned 2026-09-22).** With `document.visibilityState === "hidden"` rAF callbacks never run (screenshots report "produced no frames" for the same reason) and the map style can sit `isStyleLoaded() === false` indefinitely. A map fit that "never runs" in that state is the environment, not the product: verify geometry through an un-gated path (`fitBounds({duration: 0})` jumps synchronously), or patch `requestAnimationFrame`→`setTimeout` and `matchMedia('(prefers-reduced-motion: reduce)')`→`{ matches: true }` in-page BEFORE driving the UI (the app reads both at call time), then measure the camera through the map instance found via the host node's React fiber — importing app modules to probe state gets a SECOND instance under HMR's timestamped URLs.
- **That freeze reaches React itself — and the module graph will render a component for you (learned 2026-09-25).** In the same hidden state, passive effects never flush and a state update can run its updater (side effects fire — a resolved promise) yet never commit, so a dialog "stays open" after its close resolved: that reads as a state-code bug and is not one. The tell is `preview_screenshot` failing with "produced no frames"; `preview_navigate "reload"` restores compositing mid-session, and probes should put their side effects in the render body, not `useEffect`. For a rendered check with no test infra: `import('/@id/react')` + `import('/@id/react-dom/client')` (its `createRoot` is on `.default`) + the component's module URL renders the REAL module graph into a detached root, and real clicks drive it end-to-end (empty-submit errors, manual entry, skip-resolves-null). Poll for state instead of fixed sleeps — a hidden webview throttles timers into the evaluate timeout.
- **`str_replace` can report a real, existing file as missing** (`package-lock.json`,
  ~160 KB, during the v0.55.0 cut) — fall back to a targeted `sed -i` and verify
  with grep before moving on. Related: Vercel Agent opens its PRs as **drafts**;
  `gh pr merge` fails with "still a draft" until `gh pr ready <n>` runs.

### 3.1 What CI actually runs, per destination

Neither workflow has a `paths` filter, so **docs-only changes still run the full
gate**. What runs depends on *where* you push, and the two destinations are not
the same job:

| Destination | `ci.yml` (tsc + vitest + build) | `yatraflow-apk.yml` (Android APK) |
| --- | --- | --- |
| push to `test` | yes | **no** |
| push to `main` | yes | **yes** |
| push to `redesign/**` | yes | **no** |
| PR into `main` | yes | **no** |
| PR into `test` | yes | **no** |
| `v*` tag | — | yes (publishes the artifact) |

The APK workflow triggers on `push` to `main`, `feat/capacitor-android` and `v*`
tags — **not on pull requests**. So a PR into `main` costs one `ci.yml` run plus
Vercel, while the merge itself is what burns an Android build. Verify with
`gh pr checks <n>` rather than reasoning from the YAML; the check list names the
workflow that actually fired.

**A PR that conflicts with its base runs NO gate at all — and its check list
still looks nearly complete (learned 2026-09-20).** #268 and #269 both sat with
Codacy and Vercel green and **no `Verify` job of any kind**: GitHub cannot build
the merge commit for a conflicted PR, so a `pull_request`-triggered workflow is
never started — while Codacy and Vercel report regardless, being GitHub Apps
rather than Actions, which is precisely what hides the absence. Proven by the
fix and not only the theory: #268's `Verify` run appeared within seconds of the
push that cleared its conflict. So the row below describes a PR that *can*
merge; on a `CONFLICTING` PR `gh pr checks` is not weak evidence but **no**
evidence, and rebasing is a prerequisite for the gate rather than merely a way
to unblock the merge — which makes the stalest branches exactly the ones CI has
never tested. (Related: `gh pr checks` renders Codacy's `action_required`
conclusion as `fail`, so read the check-run's own `conclusion` and its
annotations, per the Codacy note below.)

**A PR into `test` now runs the same job as one into `main`** — `ci.yml`'s
`pull_request` trigger lists `[main, test]` as of 2026-09-20. The gap it closes
was found 2026-09-14, when PR #105 (a 23-file feature PR into `test`) showed only
Codacy/Vercel checks and no "Verify" job. `test` is where feature work
integrates, so it was the one destination where a green check list proved
nothing: the gate waited for the merge and fired as a `push to test`, after the
point where a red tree can still be refused. This section described the fix for
six days and nothing enforced it — which is why `tests/ci-workflow.test.ts` now
pins the trigger, so the gap fails a build instead of outliving another entry
about it. The PR run checks out the merge ref, so it duplicates the push run
rather than replacing it; that duplication is deliberate. Verify with
`gh pr checks <n>` rather than reasoning from the YAML; the check list names the
workflow that actually fired.

**Codacy's `action_required` state hides REAL findings too — read the
annotations, not just the conclusion.** The "auth-gated bot quirk" framing was
right for merges (nothing blocks), but on PR #224 the same `action_required`
conclusion carried the summary line "1 new issue (0 max.)" and a real finding
in its annotations. Fetch them every time:
`gh api repos/<org>/<repo>/commits/<head-sha>/check-runs` → the Codacy run's
`output.annotations_url` → `gh api <annotations_url>`. An `annotations_count`
of 0 is the true quirk signature; a non-zero count is a finding to triage.

**SAST taint on URLs is contained with a strict validator at ONE boundary —
and the boundary is wherever the value is FIRST stringified, not just the
fetch. (Validation is the right ENGINEERING, but see the next entry: it does
not silence the Codacy rule — only a dashboard code-pattern ignore resolves
the finding.)**
Codacy flagged `routing.ts` for user-controlled coordinates flowing into the
OSRM URL. Two half-lessons from fixing it: (1) `Number()` coercion is NOT
validation — it accepts `'12.9'` and turns `null` into `0`, the Null-Island
sentinel; use `typeof x === 'number'` + `Number.isFinite` + range checks.
(2) The first `.toFixed()`/template use can sit in the *cache key*, so guarding
only the URL builder still crashes on a poisoned row — one `coordValid()`
helper must feed both consumers. Fail safe: refuse the measurement and degrade
to the engine estimate, exactly like a network failure.

**The "user-controlled URLs to HTTP client" rule is UNRESOLVABLE in code — do
not chase it past one hardening pass.** PR #224 burned four rounds on
`routing.ts` (strict `coordValid` boundary → `encodeURIComponent` → full-URL
regex allowlist → WHATWG `URL` parse + origin assertion, the OWASP SSRF
pattern) and the SAME rule re-fired on the same `fetch` every time: the engine
flags `fetch()` with ANY data-derived URL string regardless of sanitizer.
(Hardening still worth keeping: the crash-on-poisoned-row fix, the regex
allowlist, the origin gate.) The practical loop: read the annotation, triage
real-vs-baseline on its merits, fix the substance once, then mark the finding
as managed in the Codacy dashboard (code-pattern ignore on that file with the
four-layer justification) — and say so in the PR so the review trail shows the
decision was made, not missed.

**The verify gate must GATE the push — no `;`-chained command strings.** On
PR #224 a `npm run verify …; git commit … && git push …` one-liner pushed a
RED tree (5 failing test files) because `;` runs every statement regardless of
the previous exit code — and the failing log was then deleted, destroying the
evidence. Sequence: run verify alone, read its exit code, and only on success
chain the commit/push (or run them as separate tool calls). Keep every failing
log until the failure is diagnosed in writing.

**A red verify that passes on rerun is usually cross-file test interference,
not flakiness to shrug at** — vitest workers share module state across files
(stubbed env, global fetch, the routing leg cache), so file-set/ordering
changes flip suites that pass in isolation. The routing tests pin their env
and clear caches per file for exactly this reason; when a rerun goes green,
name the mechanism or keep reproducing — never just re-run until green.

**Integration-harness probes are clients too — a delivery assertion needs a state snapshot, not an accumulator, and free-tier realtime can eat the first 10 s.** (Found live 2026-09-19, harness run 1/2: 35/37.) (1) The presence probe's `sync` handler merged each payload into a persistent object (`Object.assign(seenByA, ...)`), so once a session key entered, no later sync could remove it — the `untrack` assertion failed on both runs while the room itself was behaving. A delivery probe must REPLACE its snapshot each event (`seenByA = ch.presenceState()`); an accumulator can only ever prove arrival, never departure. Same shape as "a verification probe can lie about the thing it probes": before calling a probe failure a product bug, check whether the probe's own data structure can even express the transition it asserts. (2) The realtime UPDATE probe missed its 10 s window once (run 1) and passed on rerun — first-connect latency on the free tier; probe windows are now 15 s and the re-run rule below applies before diagnosing. Credentials: the harness signs in OR signs up from `.env.local`'s `TEST_USER*` block (documented in `.env.example`); create them with the anon key via `POST /auth/v1/signup` (email confirmation off → session in the response), and `example.com` addresses work fine.

**A verify that fails with `Errors 1` while every test passes is the worker-teardown race, not a failure — read the summary line before the conclusion.** On `test`
(2026-09-18, the v0.60.0 merge) the gate printed **1353 passed, 1 error** and exited 1:
one unhandled rejection, `EnvironmentTeardownError: [vitest-worker]: Closing rpc while
"onUserConsoleLog" was pending`, attributed to `tests/store-robustness.test.ts` and
preceded by that file's own console logging. Nothing asserted false — the worker's RPC
channel closed with a log message still in flight, and the re-run of the same commit was
green. `N passed` + `Errors 1` is this race (a real failure shows `N failed`); re-run the
job, and name this mechanism rather than reaching for "flaky".

- **A PR's `changedFiles` is measured against ITS OWN base branch, not the
  integration branch — stacked PRs therefore report inherited work as their
  own.** Reviewing PR #262 (based on the stacked `feat/clock-map-zones`), the
  44-file diff carried a DB migration, admin-console and settings changes that
  the branch's own commits never touched (`git log <merge-base>..head -- <file>`
  is empty) — they arrived via test-sync merges into the long-lived stack.
  Before judging scope or "unrelated changes" in a PR, diff against the merge
  base with the TARGET branch (`git diff $(git merge-base origin/test HEAD)..HEAD
  --stat`) — and prefer retargeting a stacked PR's base to the integration
  branch once its parent lands, so review sees the real diff. **The same
  overstatement applies to the promotion's own size:** after a long-lived stack
  merges, `git log --oneline origin/main..test` lists its old commits even when
  their content is already in `main` via other commits — the v0.63.0 promotion
  read as 67 commits, but `git diff --stat origin/main..HEAD` was **52 files,
  +3766/−268**, and the Sept-13/14 Day Planner batch in that list contributed
  none of them. Quote the diffstat, not the commit count, when saying what
  production is about to receive; and audit coverage with
  `git log --oneline <base>..HEAD [-- CHANGELOG.md]` (§2.6b).

### 3.2 The migration status check (the one part `verify` cannot see)

```bash
npm run check:migrations              # applied / MISSING per migration; exit 1 if anything is
npm run check:migrations -- --list    # what it would probe, no network
```

`verify` typechecks, tests and builds; it says nothing about SQL that has never
run — so a release can merge, deploy, pass CI and Vercel while its migration was
never applied. `scripts/checkMigrations.mjs` closes that hole: it derives each
migration's artifacts from its own SQL (`create table`, `add column`, the
`storage.buckets` insert) and asks the live project whether each one is really
there. It uses the app's own anon key and **GET only**, so pointing it at
production is safe.

Read it by exit code: **0** everything probed is present · **1** something is
missing, undeclared, or could not be checked (unchecked is NOT present — a probe
that could not answer has proved nothing) · **2** no credentials. Run it before
promoting a release and after applying a migration; `--allow-missing` makes it a
report instead of a gate, `--json` makes it machine-readable.

Two things it deliberately does NOT probe — do not "fix" these:

- **Functions.** PostgREST answers the *same* `404 PGRST202` for a function
  called without its parameters whether or not it exists (verified live against
  `admin_delete_user`), so the only way to probe one is to execute it. Their
  absence is loud instead: the app fails at call time.
- **Policies and triggers.** Covered by `supabase/tests/rls_contract.test.sql`
  through `npm run test:integration`, and by behavior rather than by catalog.

Such a migration is declared in the script's `NO_PROBE_SURFACE` with its reason.
A new migration that is neither probed nor declared fails the check as
**undeclared** — that ratchet, plus `tests/migration-status.test.ts` (coverage,
the parser against real SQL shapes plus fixtures, a stub server replaying the
bodies the live project returns, and a tripwire keeping the check GET-only), is
what keeps the check honest as the directory grows.

It earned its place on the first run: `20260914_trip_stay_budget.sql` had never
been applied to production, so `trips.stay_style` was absent, the store's
optional-column probe reported `stayStyle: false`, and the stay-budget dial
silently reverted on every reload — the same class as the `cover_image_url`
migration-gap rule in §4, and the first thing in this repo that could see it.
Applying that file's own one-line `alter table` closed it the same day. Expect
that shape: the check names a file, a human runs it, the next run flips to `ok`
— and nothing else in the pipeline would have noticed either way.

- **A source-scanning guard that greps for a literal breaks the moment you introduce a constant — teach the guard to resolve it, do not revert the constant (learned 2026-09-26).** Moving the create route into `lib/routes.ts` (#398) turned two green guards red without touching their subject: `tests/route-integrity.test.ts` scanned `case '([a-z-]+)'` to learn the router's route list, and `tests/mobile-shell.test.ts` asserted App.tsx *contains* `'#/new'`. Both are the right tests — a source check is the only way to pin markup and call sites in a node-env suite — but they had learned the literal. Each now substitutes the imported constant into the source before scanning (a shared `expandRouteConstants` / `appResolved`), so they keep checking the real invariant (every in-app link resolves; every shell destination stays reachable) while the rename-proof form stays. The reflex to distrust is "the test is in my way": a guard that fails after a refactor is information about the refactor's reach, and the fix belongs in the guard's parser. Corollary: when a route, class name or storage key is read by a scanner, that scanner is part of the rename surface — grep `tests/` for the literal before concluding a rename is complete. Mechanics that made it cheap: run the gate before pushing and read the *failing file's name* from the log; the two guards were the only reds, which is what told us the fix was right and the guards were stale.
- **Editing a watched source file while a Vite dev server runs can fail with `ReplaceFileW EIO (Win32 1175)` — that is a file lock, not a bad edit (learned 2026-09-26).** A write to `src/pages/CreateTrip.tsx` was refused mid-session while `vite --port 5180` served that worktree; the file was left byte-intact (confirm with a targeted grep before retrying) and the identical edit succeeded immediately after the server was killed. So an `EIO` during a dev-server session means: stop the server or its watcher, verify the file still parses, then retry — not "the tooling is broken". Cheap prevention: that lock window belongs to the same pid you started for the localhost check (§7), so stop that server when the check is finished instead of leaving it running through the rest of the batch.

## 4. Code conventions & pitfalls

- **Anything that leaves the device must read STORED state, never what a component happens to render (learned 2026-09-19).** `CoverThumb` resolves a trip's cover from three sources in order — the owner's explicit `coverImageUrl`, then a Wikipedia photo fetched at runtime and cached in localStorage — so a trip with no stored cover still *looks* illustrated. The share preview has no such fallback chain: `api/i.js` reads `published_itineraries.cover_image_url` and nothing else, so a publication published without an explicit cover stamped `NULL` and previewed as the brand card while the app showed a photo of the destination. Both halves were correct in isolation and the reporter's symptom ("it shows the brand image on all links") read like a handler bug; the data answered it in one query (`select id, cover_image_url from published_itineraries`). Rule: when a rendered value has a runtime fallback, ask what the *stored* value is before debugging the consumer — and if a downstream surface (a crawler, an API, an export) can only read the stored one, make the fallback explicit and persisted at the moment the user commits (here: the publish form requires a saved cover), or the two will disagree silently forever.

- **A user-facing rule that exists to satisfy a server-side consumer must be pinned to that consumer's own rule, not restated.** The publish form's cover validation is the preview handler's `^https://\S+$` — and if it drifts (say the form starts accepting http), a creator satisfies the form and still ships a link that silently falls back to the brand card. The cheapest guard is a test that the *same literal* appears in both files, next to the assertions that already pin the production origin across `api/i.js`, `src/lib/shareUrl.ts` and `index.html`; the duplication is unavoidable (the handler is plain JS outside `src` and must not import client code), so pin it rather than trust it.

- **A value that looks applied and reverts on reload is a missing optional column, not a UI bug — and the probe is what hides it (learned 2026-09-19).** `trips.cover_image_url` was probed by the store (`tripsHaveOptionalColumns`) from the day the cover picker shipped, but no migration ever created it, so `tripToRow`'s `if (cols?.cover)` omitted the field on every save: the picker showed the new cover, it survived until the next reload, and then silently reverted to the runtime Wikipedia suggestion. `probeOptionalColumn` is *deliberately* graceful (a false negative must not block unrelated settings writes), so the failure is invisible in the UI, in `tsc`, and in the test suite — the only artifact that answers it is the column list itself, or a reload. Two reflexes close the class: when a stored-looking value reverts, `select *` the row and check the column exists before touching the component; and `tests/tripRow.test.ts` now pins every `probeOptionalColumn('…')` literal in `src/store/store.ts` against the migration set, which is the check that would have caught this one. Adding a probed field therefore means adding its migration in the same change.

- **Uploaded images are the only bytes in this repo on a meter we pay for, and the downscale is what keeps them free (learned 2026-09-19).** A cover is fetched by every crawler that unfurls a shared link, so both storage and egress scale with *bytes*, and Supabase charges for both past the plan allowance (Storage **$0.0213/GB-month**, egress **$0.09/GB uncached / $0.03/GB cached** — Free allows 1 GB and 5 GB, Pro 100 GB and 250 GB). Measured through the real pipeline: a phone-class 1,335,523-byte photo becomes **77,818 bytes** at 1200px, 17× smaller and invisible at the sizes we render — so 1,000 covers cost ~$0.002/month to hold and ~$0.002 to serve a thousand preview fetches, while the free tier holds ~13,000 sized covers against ~780 originals. Resize on the client before the upload; never raise `COVER_MAX_EDGE` without redoing that arithmetic.

- **An uploaded object's URL is copied onto forks and publications, so its original uploader must never delete it (learned 2026-09-19).** `duplicateTrip`/`importTrip` copy `coverImageUrl` onto every forked trip (`store.ts`), and publishing stamps it onto `published_itineraries.cover_image_url`, which `api/i.js` serves as `og:image`. A fork belongs to a *different* user, so when the creator replaces their cover the app cannot know what still points at the old object — and the failure is silent in the worst direction: the replacing creator's own screen keeps showing the new photo while every fork and every live share card 404s. The delete-on-replace that looks like housekeeping is therefore a correctness bug, and the same hazard applies to any future "remove my upload" control. Keep orphans (~100 KB each, $0.0213/GB-month); a janitor may only collect an object it can prove unreferenced, which no single client can. `tests/cover-upload.test.ts` pins the absence of the delete so it cannot be re-added as an "optimization".

- **The `covers` bucket must stay public-read, and writing is folder-scoped to the uploader.** A preview crawler never presents a session and never will, so a private bucket makes every uploaded cover fall back to the brand card *while looking perfect in the app* — the same silent disagreement as the stored-vs-rendered cover bug, one layer down. Writes are confined to `<auth.uid()>/<random>.jpg` (`storage.foldername(name)[1] = auth.uid()::text`), which is also why the client always uploads a fresh random name and deletes the previous object *after* the new one lands: a failed upload can never destroy the live cover, and the delete keeps storage proportional to publications rather than to uploads ever made.

- **A client-side visibility filter is a second policy, and it will disagree with the server's — never gate a public catalog on a different table's readability (learned 2026-09-19).** Hydration kept a published itinerary only if the trip behind it was in the client's trip cache (`dedupePublished(pubRows, visibleTripIds)`), which was fine until the paywall hardening made another creator's trip row unreadable to a non-member **on purpose** (`20260918_payments_security.sql`). The two features were each correct and together they emptied Explore for every signed-in visitor: the rows were read, then thrown away by the client, and `#/pub/<id>` said "This itinerary didn't load" because the public page finds its publication in that same cache — while the identical page worked logged out. Ask what the row *is* before filtering it: a publication is the public artifact (the preview handler, the public page and Explore serve it), and `published_itineraries.trip_id ... on delete cascade` already guarantees it cannot outlive its trip, so no client-side visibility test is needed or correct. The follow-on worth knowing: the workaround that fed that filter (`catalogTrips` — fetching foreign trips so the valid set would be non-empty) put other people's raw trip rows in the client cache, which is exactly what the paywall's wire-level stubbing exists to prevent; the fork path preferred that cache hit. When a hardening lands, grep the client for places that treat "a row I can see" as "a row exists" — `tests/gallery-visibility.test.ts` pins this one, and the same shape applies to any list derived from a table you are about to make less readable.

- **A write-path fix is not a backfill, and only the row's own creator can perform one (learned 2026-09-19).** Taking ownership of an auto-suggested cover shipped *inside* `publishItinerary`, so every publication created before it — and every publish whose copy fell back, which is the copy's deliberate failure mode — kept its `og:image` on a third-party host. Existing rows need their own pass, and that pass must be **derived from the data** rather than guarded by a flag: a row still pointing at Wikimedia *is* the work list, which makes a second run free and makes a swallowed failure retry on the next load instead of being forgotten. Know the boundary before designing one: the `covers` bucket confines every write to `<auth.uid()>/…`, so **only the creator of each row can collect it** — no cron, no job and no admin-console action can take another user's cover (the console holds no service key), and a creator who never opens the app again leaves their row as it was. Say that limitation where the feature is described instead of implying the sweep is complete. `store.collectUnclaimedCovers()` is that pass for covers; the same shape applies to any future "own it instead of linking to it" copy.

- **`20260919_covers_bucket.sql` is migration-gated — probe the bucket before doubting the client.** Until it is applied, every upload fails with `Upload failed: Bucket not found`, which the picker shows verbatim; the client path, the resize and the request are all fine. One anonymous call answers it: `curl $SUPA/storage/v1/object/public/covers/x.jpg` returns `NoSuchBucket` when the bucket is absent. The bucket also enforces `allowed_mime_types` and a 5 MB `file_size_limit` of its own — a client allowlist is not a boundary, so the two lists are pinned to each other by a test.

- **A drawn layer and a marker layer must share their source, or the line will touch points nothing marks.** The Map tab draws a selected day's engine journey (`buildJourney` — which can open at the previous night's stop and close at a synthesized destination or the ride home) while its pins come only from that day's *stored* stops. A route end could therefore sit on a bare spot and read as "the route stops" — a real report on 2026-09-17, where the line proved complete (3,481 road points ending exactly at the engine's endpoints) and only the marker was missing. Synthesized journey endpoints now get their own pin, deduplicated through `coLocates` (< 1 km); `lib/journeyMarkers.ts` is that seam. When two layers derive from different data, walk the drawn geometry's endpoints and assert every one is marked.

- **A span request's results are indexed by span offset, not by missing-leg position.** `routePath` measures ONE span covering the `first..last` *uncached* leg — which necessarily includes any cached legs inside it — so `missing[k]` and `chainLegs[k]` are different legs the moment there is a hole. Indexing by `k` handed the tail leg its neighbour's geometry **and** cached it under the neighbour's key, so the corruption outlived the draw (the symptom was a route that visibly stopped early, #polylines). Cached holes are this design's normal state, not an edge case — the leg cache is deliberately shared between the whole-trip chain and each day's ride — so every span-assignment change needs a test with a hole *between* two misses, not a cold cache or a single missing leg.

- **Route anchors reachable from a public pathname need `appLink` on the real `<a>`.** Root-absolute web hrefs let new tabs escape `/i/<id>`; unmodified left clicks must still set only the hash to avoid reloading. Leave modified/already-handled clicks to the browser, and keep native/file hrefs fragment-only. The metadata handler cannot recover a fragment. Address promotion must use `routeParts`, then the handler's id allowlist — trailing slashes, per-segment queries and extra segments can still render the publication.

- **A browser-copied public URL must carry the publication id before the hash.** Fragments never reach preview crawlers. `syncPublicAddress` aligns the web pathname with `#/pub/<id>` on mount and hash changes, using `replaceState` without adding history entries. Clear `/i/<id>` when leaving the public route, keep native/file routing untouched, and never build creator/invite/snapshot links from the current publication pathname. Test Back/Forward, switching publications and the handler's root-shell redirect separately; correct metadata in an HTTP probe does not prove WhatsApp rendered it.

- **Share-preview tests must execute the handler, not merely find tag strings.** A preview fetching the production shell can combine production bundle hashes with preview-host assets. The `/i/<id>` endpoint instead returns metadata and an explicit redirect to the hash route, with a bounded public-metadata fetch and no app-shell request. Native share URLs must use the public website, never the WebView origin. Keep deployment/crawler acceptance separate from local test success.

- **A verification probe can lie about the thing it probes — and a preview URL lies about its own content.** Two traps hit while closing #226. (1) `process.env.X = undefined` does **not** unset a variable: Node coerces it to the string `"undefined"`, which is truthy, so a probe that "cleared" `PUBLIC_ORIGIN` made the handler's `PUBLIC_ORIGIN || …` fallback resolve to a literal origin of `undefined` and `og:url` read `undefined/i/<id>`. It looked exactly like a product bug for a step; the unit test for the same branch was green the whole time, because `vi.stubEnv(k, undefined)` genuinely deletes. Use `delete` in a probe, and never diagnose a handler from a value the probe itself set. (2) A preview deployment answers **200 with a full Open Graph block** — Vercel's SSO login page carries its own tags (`og:title: "Protected Deployment – Vercel"`), so a "does it contain `og:title`" check passes on the wall itself. Match on the origin/description or check the byte size (~1.2 KB app shell vs ~340 KB login page), never the mere presence of a tag. Keep such probes in the scratch directory, not the repo. (3) **A source-scanning test can match its own subject's prose:** the tripwire asserting that `presence.ts` calls no weak generator failed on the doc comment *explaining* that it no longer does. Strip comment lines before asserting on source text, and match the call (`/Math\s*\.\s*random\s*\(/`) rather than the bare name — a test that forbids a string has to decide whether it forbids mentioning it.

- **Jev audits are development-only review aids, not correctness oracles.** Keep `JEV_AUDIT` opt-in and credentials outside `VITE_*`. Repository seed/copy strings are not user transcripts or an independent holdout after tuning. Report code/model/expected-label results separately, disclose label corrections, and pin confirmed keyword collisions in offline regression tests before changing the router.

- **Data model**: times are always stored as 24h `"HH:MM"` strings. Format at
  render with `formatHM`/`formatHMRange` + `useTimeFormat()` from
  `lib/timefmt.ts`. 12h is the default; 24h is a user setting (Profile page).
- **Optional fields are `string | undefined`** (`closeTime`, `openTime`,
  `departTime`, …). Helpers must type their params for the data model's real
  shape, not the happy-path call site — a helper requiring bare `string` turned
  into a Vercel-only build failure.
- Browser-native `<input type="time">` follows the OS format **by design** and
  cannot be forced to 12h — don't replace it. The convention: keep the native
  input and echo the app preference as a live `.time-preview` ("= 6:30 PM")
  under it (see StopEditor / timefmt).
- **Mobile**: breakpoint is **720px**; mobile CSS lives in the single
  `@media (max-width: 720px)` block at the end of `src/styles.css`; keep touch
  targets ≥40px; inputs 16px on mobile (iOS Safari zooms smaller ones).
- **MapLibre/mapcn**: don't import `maplibre-gl` types directly in components —
  use the structural-cast pattern (`GeoJSONSourceLike` in TripMap.tsx).
- **Overlay z-index ladder** — use the `--z-*` token rungs in `styles.css` (`:root`, M4):
  impact sheet 210 > toast 200 > modal 100 > ai-drawer 90 > notif 80 > expanded map
  shell 70 / ai-fab 70 (tie — DOM order decides) > nav glass 60 > mobile dock 55.
  Any full-page overlay (e.g. the map's `⤢ Expand` mode, `.map-shell--expanded`) must sit BELOW the dialogs it can spawn, so modals/impact sheets opened from it still layer on top — no
  collapse-on-open coordination needed. The impact sheet is DELIBERATELY above toasts
  (210 > 200): a transient toast must never cover the Keep/Remove controls. Corollary: container-size changes need
  no manual `map.resize()` — mapcn's wrapper already runs a ResizeObserver
  that re-fits the canvas (map.tsx).
- **A popup's stacking rung is decided by its HOST, not by the popup.** A `position: relative`
  block that carries a `z-index` becomes a stacking context, so every descendant — including an
  absolutely-positioned calendar or dropdown sitting at a high rung of its own — paints at the
  BLOCK's rung. The Create-Trip calendar declared `z-index: 60` inside a host pinned at `2`, so
  the whole popup painted under the fixed bottom dock (55) and its lower rows were unclickable
  on a phone. Raise the host, not the popup. Verify by **hit-testing**, never by reading
  z-indexes: `document.elementFromPoint()` at the overlap must return the popup's own child.
- **`scrollWidth` is not evidence of a horizontal-scroll defect.** `html { overflow-x: clip }`
  (this file's chosen answer for decorative bleed) lets the document report a scrollWidth far
  wider than the viewport while `scrollLeft` stays `0` — the landing page measures ~600px at a
  390px viewport purely from the destination marquee's offscreen track. Test what the user
  actually experiences: `canScrollRight` (set `scrollLeft = 9999`, read it back) plus, per
  element, whether its right edge passes the viewport **without a clipping ancestor**. The same
  clip cuts both ways: overflowing content is unreachable rather than scrollable, so a
  clipped-but-wide layout HIDES controls instead of exposing them. (Both faces of this were
  live: the marquee was a false positive, the `.two-col` blowout a real one.)
- **An absolutely-positioned child needs a positioned ancestor in EVERY class variant.** One
  shared child (`CoverThumb`'s `.itin-cover-fallback`) is `position: absolute; inset: 0`, but
  only the wide `.itin-cover` variant declared `position: relative` — so the short `.itin-emoji`
  variant let the fallback escape its box and paint over the card's title. When a child is
  positioned, grep every parent variant for the containing block.
- **Basemaps are OpenFreeMap (keyless, commercial-OK) — never reintroduce CARTO
  or Esri tiles.** `mapcn/map.tsx` `defaultStyles` =
  `https://tiles.openfreemap.org/styles/{positron,dark}`. Their `style.json`
  ships without `sources.*.attribution`, **but** the `openmaptiles` source
  points at the TileJSON `https://tiles.openfreemap.org/planet`, which carries
  the required OSM/OpenMapTiles credit — MapLibre resolves it and renders it
  itself. Do **not** also pass `attributionControl.customAttribution`: that
  duplicates the credit across the map (the bug the first #23 pass shipped;
  `tests/basemap-license.test.ts` is the tripwire). Do **not** "switch to OSM
  raster tiles": `tile.openstreetmap.org` is a different look, has no dark
  variant, and its usage policy discourages production apps.
- **`noUnusedLocals: false` lets dead provider URLs rot in the tree** — four
  unused CARTO/Esri style constants sat in `TripMap.tsx` (with a comment
  describing a satellite toggle that never existed in the UI) and were a live
  licensing exposure in a file nobody was reading. When auditing third-party
  usage, grep for the **URL strings**, not just call sites.
- **HTML5 drag-and-drop does not work on touch devices** (no `dragstart`).
  The convention: keep HTML5 DnD for desktop, and route touch through the
  long-press pointer engine in `lib/touchDnd.ts` (integrated via `useReorder`).
  Any new drag surface must add both paths or explicitly opt out.
- **View prefs pattern**: per-object UI preferences (day collapse
  `yatraflow_day_collapsed`, hidden ride hints `yatraflow_ride_hints_hidden`,
  clock format `yatraflow_time_format`) live in localStorage via
  `lib/uiPrefs.ts`/`lib/timefmt.ts` — failure-tolerant maps of booleans keyed
  `"<tripId>:<dayIndex>"`, never trip data.
- `dev.log` is untracked local clutter — ignore it, never commit it. (It **did** get committed in `f09aaf9` when a bulk `git add` in this shared working copy swept it up — and the commit was pushed, so removing it needed a follow-up untrack commit. Stage explicit paths only; never `git add -A` / `git add .` here.)
- **An agent tool's scratch file must never be *tracked* — and a commit about something else must never sweep one in.** `.verdent/pr-body.md` was tracked on `test`, so every branch that used that tool rewrote it: no two of them could stay open together without conflicting on the file, and a three-file feature PR carried **115 lines of another PR's prose** in its diff (found 2026-09-19 while rebasing #254/#258, where it read as unexplained noise until the file was checked). It is now untracked and ignored alongside the other agent-tool output; **`.verdentc.json` deliberately stays tracked** — that one is real deploy config (install/build commands, output dir), not tool output. Before blaming a diff on your own work, run `git diff --name-only <base>...HEAD` and check what is actually in it.
- Test style: pure logic only, node env; mock `fetch` with route tables
  (`tests/providers.test.ts` has the pattern); `vi.stubEnv` for API keys.
- **`tests/design-system.test.ts` pins every declared `font-weight:` to a face the font link actually loads — the canonical ramp is 400/500/600/700/800 only.** The consistency pass ships Inter/Sora as static faces, so a variable-font interpolation weight (650/750 appeared in the Optimize-day preview) fails verify with `declared but not loaded`. When styling new UI, reach for the canonical weights; rebase replays of older branches are where off-ramp weights sneak back in (Sep 2026).
- **View Transitions + theme radiate (Sep 2026): VT is usable on glass-heavy pages ONLY with `backdrop-filter` suppressed during the transition** — Chromium renders glass inside VT snapshots without its backdrop, so any glass layer (`--yf-glass: rgba(255,255,255,.58)`) turns the captured page into a flat gray veil (page-dependent: "perfect" on Landing, broken on #/trips). Shipped pattern in `toggleTheme` (App.tsx): set `--vt-x/--vt-y/--vt-r` on `<html>`, add a direction class (`vt-radiate-out` = dark→light, new view expands; `vt-radiate-in` = light→dark, old view collapses — and it needs old z-index 2 / new 1, since UA stacks new on top) plus `vt-active` (`html.vt-active :where(*) { backdrop-filter: none !important }`) BEFORE `startViewTransition`; the clip-path animation lives in CSS keyframes with `fill: both` (first-frame-correct, end-state held), classes removed on `vt.finished`. A DOM-overlay radiate was tried and rejected (flat color, not the real UI). Don't re-learn these the hard way.
- **A full-page View-Transition FREEZES every CSS animation for its duration — skip it on animation-heavy pages.** The landing route runs continuous motion (atmosphere blobs, route draw, ticker, odometer); toggling theme there made the whole scenery visibly pause ~700 ms while the DOM snapshot played, and on mobile the eruption point read as off-target. Fix (Sep 2026): `toggleTheme` early-returns to an **instant swap on `route === '/'`** (radiate kept for calmer in-app pages). When adding any VT elsewhere, gate it off routes dominated by looping animation or the "pause" reads as a frozen tab.

- **Diagnostic logging should be guard-claused.** Haptics logging (`haptics.ts`) showed `[HAPTIC]` entries even on iOS where `navigator.vibrate` doesn't exist — misleading noise. Guard `import.meta.env.DEV` logging behind `typeof navigator !== 'undefined'` so logs only appear when the API actually exists. Corollary: test environments that mock `window`/`navigator` must include `vibrate` (even as a no-op) to avoid console spam.

- **AI assistant input must disable while thinking.** `AiDrawer.tsx` had the input enabled during `thinking` state, allowing duplicate questions while the bot was already processing — the simulated 650ms latency made this easy to trigger. The fix: `disabled={thinking}` on the input and submit button. When adding async operations that take >200ms, always disable user inputs to prevent race conditions or duplicate requests.

- **A replay-tolerant webhook must filter its grant read to the state that justifies the grant (learned 2026-09-22, security audit).** `payments-webhook.js` marked orders paid idempotently but read the row UNFILTERED, so a replayed `payment.captured` after a refund would have re-granted a revoked entitlement (the revoke RPC flips paid → failed). Idempotency of the write is not safety of the read: a recovery/replay path must ask "which states may proceed" and filter to exactly those. Pinned in `tests/payments-functions.test.ts`. Sibling rules from the same audit: invite/access codes come from the platform CSPRNG (the presence-key class — `inviteCode.ts` has a tripwire); any WebView app holding session tokens sets `allowBackup="false"`; and a CSP starts as **report-only** (`vercel.json` headers) — an enforced-but-untested CSP on a map app with six third-party origins is a self-DoS.
- **Gate a control and its surface with the same predicate (learned 2026-09-22, APK audit).** The signed-out Android shell kept the topnav's hamburger button while its tray was `!isNative`-only — a visible control whose tap toggled state that rendered nothing. When a surface is platform- or flag-gated, grep for its trigger and gate that too; the shared gate is pinned in `tests/mobile-shell.test.ts`.
- **Combining a caller's AbortSignal with a timeout must feature-detect `AbortSignal.any` (learned 2026-09-21, PR #289 review).** `AbortSignal.any` is Baseline-2024 — Safari < 17.4 throws on it, and if the throw sits *outside* a try it escapes whatever fallback the call site promised (a configured companion would have shown the canned error instead of the offline router's answer). The guarded pattern lives in `routing.ts`'s `requestSignal` and `aiProvider.ts`'s `mergeSignal`: detect `Any.any`, fall back to the bare timeout, and hand an already-aborted caller an already-aborted signal — never a fresh timeout, which would send post-abort fallback fetches out live.
- **A service worker here is web-only, production-only, and never touches identity-bearing paths (learned 2026-09-22, PWA phase 1).** Three hard rules, each with a silent failure mode: (1) register only when `!isNative && import.meta.env.PROD` — inside the Capacitor shell every asset already ships in the APK (a worker fights the WebView cache), and in dev Vite's HMR rewrites modules that a cache-first worker would then serve stale; (2) the cache NEVER holds `/api/*`, `/i/*` (the crawler preview is server-rendered), `/sitemap.xml`, `/mappls/*` or any cross-origin response — Supabase auth/rest cached is a correctness bug, not a performance win; (3) navigations are network-first with the cached shell only as the offline fallback, and the shell copy is re-put on every successful navigation, so a deploy rolls the offline copy forward without a version bump. Deliberately NO `skipWaiting`: a running session must not have its shell swapped under it — the stale-chunk auto-reload is the app's existing answer to a mid-session deploy. Icons are generated from the brand mark by a repo script (no image dependency) and their declared sizes are pinned by a test, because a wrong-sized icon is an installability failure nothing else reports.

- **The offline snapshot cache has three rules, and each one fails SILENTLY (learned 2026-09-22, PWA phase 2).** (1) It is keyed by account and **cleared on sign-out** — issue #45 was the in-memory version of this bug (the previous user's rows re-patched into the cache after a logout); the on-disk version would outlive a reload, so the sign-out path clears it. (2) Only a **clean** hydrate is persisted (`partial.length === 0`) — the store's partial-failure model is the signal, and writing a partial snapshot presents half an account as the truth on the next cold boot. (3) A cache boot must never trigger the demo seed, which the existing `tripCountUnknown` guard already covers: the failed reads that made the cache necessary are exactly what sets it. `lib/offlineCache.ts` degrades to "no cache" on every path (no IndexedDB, quota, blocked upgrade) and validates the version plus EVERY slice on read, so a half-written record reads as absence rather than as a partial account.

- **The offline write queue is durable BEFORE the send, one snapshot per trip, bounded, and cleared with its account (learned 2026-09-22, PWA phase 3).** (1) `persistTripFieldNow` queues the edit to IndexedDB BEFORE attempting the network write — durability-after-failure loses the edit to a crashed tab or a closed laptop, which are the common cases. The drop happens only on a CONFIRMED write. (2) The queue is keyed by trip id, mirroring the in-memory coalescer: a second edit replaces the first, so replay can never resurrect stops the user deleted. (3) Replays are bounded (three attempts, then a loud drop) and deliberately NOT routed through `persistTripFieldNow` — that path always re-queues with `attempts: 0`, which would unbound the retries. (4) Sign-out clears the departing account's entries (`clearWritesFor`): the next person on the device must never be the one whose session "syncs" the last one's unsynced edits. (5) A conflict (server row newer than the edit's capture) is last-writer-wins with BOTH sides told — the app's whole-trip write model makes rebasing a non-goal, and the peer's existing remote-edit banner covers their side. The replay carries no `markLocalWrite` on purpose: the echo of our own replay refreshes the cache from server truth instead of being suppressed.

- **Drawer animations need a class-based toggle.** `AiDrawer.tsx` originally animated via inline style transitions; switching to a `.open` class on the container (`<div className={`ai-drawer ${open ? 'open' : ''}`}>) fixed the animation state reset on re-render. Rule: always use CSS classes for enter/exit animations, never inline styles — React re-renders can reset inline styles mid-animation. The `.ai-drawer:not(.open) { display: none }` pattern is also cleaner than `style={{ display: open ? 'flex' : 'none' }}`.

- **FAB should hide while assistant is open.** `AiDrawer.tsx` kept the `ai-fab` visible behind the drawer, cluttering the UI. Fix: `{!open && !thinking && <button className="ai-fab" ... />}` — only show when drawer is closed AND not processing. Rule: when a panel overlays a floating action button, hide the FAB while the panel is open OR while the panel is in an intermediate state (thinking, loading, saving).

- **Every trip-data mutation must write through — but know the real signatures before you "enforce" an order.** The store fixes (Sep 2026) revealed three bugs, and a later correction (M6 B0, Sep 19 2026) fixed the write-through paragraph itself:
  1. `setStopStatus` performed redundant lookups before committing, risking stale data.
  2. `moveStopBetweenDays` committed twice — once in `updateStop`, once explicitly — which bypassed the single-patch guarantee. Its no-stop-found early-return path still skipped the persist entirely; it now calls `persistTripField` like every sibling.
  3. `updateTrip` committed before persisting, so UI showed success but DB failed silently.

  The facts (verified against `src/store/store.ts`, don't restate from memory): **`persistTripField(tripId, snapshotTrip)` is SYNCHRONOUS and returns void** — it coalesces the row UPDATE through `pendingTripWrites` (600 ms trailing debounce). There is no promise to await and no ordering rule between it and `commit()`; what matters is that the mutation path CALLS it with the post-mutation snapshot, because a path that only edits the cache vanishes on refresh (the verify gate stays green — nothing exercises write-through). The debounce holds the **snapshot captured at call time** (`{ timer, trip }`), and both the timer and `_flushTripWrites()` persist THAT snapshot — never a re-read of `tripById(id)`, which would let a remote update landing inside the debounce window be persisted over (or silently discard) the local pending edit. If you change the coalescer's shape, keep the snapshot semantics and their tests (`tests/m6-together.test.ts`).

- **"Resolved on pick" placeholder coordinates must be resolved AT the ingestion boundary — a raw write into trip data pins the journey to Null Island.** Both providers emit `latitude: 0, longitude: 0` placeholders on some hits, and the Map tab's Add-to-timeline paths copied them raw: a real user's route ran to the Gulf of Guinea, the split banner demanded 116 travel days, impact previews read ±45,616 km, and halt suggestions landed "around ~2400 km" in the Atlantic — every downstream number honest math over an ocean round-trip, and the whole verify gate stayed green (nothing exercises live pick flows). Fix: `requireHitCoords()` at every write-into-a-trip path (single add, Add-all, `LocationInput.choose`), refuse with a visible error/toast when unresolvable. Corollary: coordinate sentinels need BOTH coordinates checked — the live incident was a MIXED placeholder (lat 0, real lng) that `a !== 0 || b !== 0` happily accepted. When debugging "impossible" route geometry, screenshot-locate the offending pin first; every impossible number downstream of it is a red herring. (Found live 2026-09-14.)
- **A surface that RANKS or ANNOTATES by coordinates before any pick cannot consume "resolve-on-pick" placeholders — it needs a real-coords search.** The Map tab's search-to-add box used `searchPlaces` (Google autocomplete), whose hits are deliberately `(0,0)` placeholders — the quota economy is one Place Details call per *picked* row. But that box projects every hit onto the route to label/rank it, so all five results measured Null Island and rendered the identical "~1675 km into the trip · 8448 km off-route" — the tell that a ranking surface ignores hit coords entirely is *equal annotations on different hits*. Fix: `searchPlacesText` (one free-form Text Search Pro event, real locations in the same single call the corridor scan already pays; coord-less stragglers resolved-or-dropped; `QuotaExhaustedError` rethrown to an honest toast). Rule of thumb: **autocomplete for pick-one inputs, Text Search for rank-everything surfaces** — don't "reuse" the cheaper SKU on a surface whose math needs coordinates it doesn't have. (Found live 2026-09-14.)
- **A directive that reverses behavior must sweep its own strings in the same commit.** When the Google-only directive landed, `QuotaExhaustedError` still said *"falling back to the free stack"* and the quota-guard header still described the old fallback — the code had changed, its self-description lied. When reversing any behavior, grep for the OLD behavior's phrasing in error messages, comments, README, and ARCHITECTURE (this bit us once per surface: message, quota.ts header, geocode docstring).

- **A mechanical CSS gate only sees pairs declared in ONE rule.** The design-system contrast gate skips color-only overrides (`.x--warn { color: … }` on a separate background rule) — a 3.65:1 warn-on-white shipped straight past it (#152). When styling new UI, add explicit AA pins for any warn/tone pair your surface paints (#154's `map-rail warn ink` test is the pattern), and remember the baseline keys entries on **line numbers** — inserting CSS shifts them and fails the gate with phantom "new violations"; re-map  the numbers (or `UPDATE_DESIGN_SYSTEM_BASELINE=1`) and diff to confirm nothing but line numbers moved.
- **The overlay measures an element's DECLARED background, not the composite — flatten before believing a
  contrast finding on a layered surface.** Its report of `PublicItinerary`'s hero at 2.6–3.1:1 was against
  `.pub-hero`'s own gradient end stop (`#b97a3f` at 118%), not the pixels behind the kicker/title/byline:
  the numbers were **bit-identical** after adding a scrim to the child `.pub-hero-bg` layer, and vanished
  only when `.pub-hero`'s own background was replaced. Discriminate with that test (flatten the element,
  re-inject, compare) before acting — a child/sibling layer is invisible to the rule. The *risk* it pointed
  at was real and now bounded: `.pub-hero-photo` is a creator upload at `opacity: .42` with nothing
  guaranteeing a floor, so a bright cover could pull the hero text toward ~3:1; the flat scrim added over
  the text zone plus `tests/hero-contrast.test.ts` (which composites the scrim over a **white** photo — the
  conservative worst case) close it. Triage the output generally: that page's 61 findings held 21
  `nested-cards` for **4** real ones (measured, depth 1), 4 `line-length` that prose measurements did not
  reproduce, `all-caps-body` on `.pub-hero-byline` (a deliberate uppercase byline), and ~18 that are this
  repo's deliberate system — now listed in `.impeccable/critique/ignore.md`. Setup: mutation preflight,
  `impeccable live-server --background`, inject `http://localhost:PORT/detect.js`, `live-server stop`
  (its `config_missing` warning is expected when you injected by hand) — `index.html` stays byte-clean.
- **A contrast probe that resolves backgrounds from `backgroundColor` mis-measures gradient- and photo-backed cards.** The 2026-09-23 entry-path review's browser harness walked the computed chain and read white-on-navy as white-on-cream wherever the navy arrived from a `linear-gradient` (which lives in `backgroundImage`, never `backgroundColor`) — it flagged three deliberate forced-dark surfaces as failures, twice, before the declared scrims were grepped and the pairs disproven. When measuring contrast on any card that might be gradient- or image-backed, resolve the *declared* scrim from CSS (grep the class) or composite the rendered pixels — and treat a probe finding only `gradient` surfaces as unverified until cross-checked. The review also confirmed the cheaper discipline: when the CSS documents a token's own failing figure (styles.css:129 documents `--yf-teal-600` = 3.80:1 as a *ring* value), grep that ledger before asserting small text may borrow it — the kicker was sitting at exactly the documented 3.80:1.

- **A derived input that algebraically cancels is a constant in disguise.** Road personality's "per-window speed" was `windowKm / (driveMinutes × windowKm / totalKm / 60)` — the `windowKm` cancels, leaving the day's average painted on every window, and the tests then codified the wrong semantics. When a derived value cancels to something coarser than its name implies, stop and either compute the real signal (per-leg durations from OSRM) or move the verdict to the level it actually measures (day-average → explicit day-level check, as now done for the city-crawl kind).

- **Never subtract one engine's route total from another engine's internal legs.** Google's Search-Along-Route `routingSummaries` route start→place→end independently of the polyline, so `(leg0 + leg1) − <route total measured by anything else>` inflates by the two engines' route-variant difference: **+47 km on a 1,400 km corridor** (a highway petrol pump read "50 km off", torching the detour budget and holding back See & do) but only ~1–3 km — plausible-looking — on the short corridors used in earlier testing, which is how it hid for weeks. `routesEnabled()` only checks that a key string exists, so an un-enabled Routes API (HTTP 404) silently fell back to OSRM totals while the summaries stayed Google-baselined. SAR detours are now the geometric spur against the same polyline the search ran on (`spurKm`, google.ts); leg0 remains the road position. The invariant to pin in any future detour source: **a place on the drawn road must read ≈0**, and it must hold on a 1,000+ km corridor, not a 50 km fixture. (#187)

- **Cadence bugs only show on load-balanced multi-day plans — fixture the 350-km day.** planRideSegments' per-day-reset cadences were designed when days were the 550-km tick; load balancing (P1-A) shrank days to ~350 km and two cadences silently produced ZERO segments on every such plan (a 1,400 km trip grew no meal and no fuel suggestions): the fuel push (382.5 km step from each day start never landed inside a 350-km day — fuel runs on a corridor-wide cadence; the tank doesn't reset overnight) and the #131a overnight absorb (a slid lunch sits at the 14:30 window edge, ~98 km = 2 h 20 m before the halt, inside the 110-km km-only bound — the absorb is now time-bounded to ~1 h: a stop that close is "dinner at the halt anyway", an earlier one is a real meal). When touching halt cadences, test with 1,400 km / 4-day load-balanced shapes, not just single-day or 550-tick shapes. (#189)

- **Google Text Search cannot discover place TYPES — it matches text against POI names.** `textQuery: 'towns and cities'` returns 200 with zero places (or ice-cream shops named "Top N Town") — the city anchor layer had quietly returned zero localities, starving every night-halt suggestion. Type-based discovery is `places:searchNearby` + `includedTypes: ['locality', …]` with the Essentials-only field mask (hours/rating fields upgrade the SKU), counted under its own `nearbySearch` quota SKU. Rural corridors can still return zero localities in a 35–50 km circle while the start-city circle returns many — guard the assignment: a city nowhere near its segment's km is dropped (an honest GAP beats a "night halt" 700 km from its halt). (#189)

- **`searchNearby` accepts a NARROW type list, and ONE bad member 400s the whole request.** Asking for `['locality', 'administrative_area_level_3']` (both fine in Text Search) failed every call with `Unsupported types: administrative_area_level_3` — and because the caller `.catch()`es, the layer returned `[]` and the surface read as "no towns anywhere" instead of as a broken request. Every night halt starved on every trip while tsc, tests and build stayed green (the fixtures mock fetch, so no test could see it). **Validate provider enum values against the LIVE API before shipping the list** — `scripts/verify-google-places.mjs` is the place for it — and prefer one type per call over a speculative union. (#189)

- **Google's `locality` bottoms out at VILLAGE level in rural India.** At halt points on a 1,400 km corridor it returns hamlets (Gauriyapur, Muhammadpur, Kuit Mandir) with no population to rank by, while OSM's `place=city|town` at the same points returns real towns WITH population (Chunar 37k, Mirzapur 234k, Hazaribagh). A night halt needs a town with a bed, so "the locality layer returned something" is not the same as "the halt is anchorable" — check what KIND of place came back, not just the count.

- **A provider that degrades internally must be checked for QUALITY, not just for throwing.** `routePath` never rejects: on an OSRM failure it returns haversine `estimate` legs (by design — "planning never blocks"), so the `.catch()` handlers around it could not see a rate-limited day at all. The code drew straight chords and treated them as a measured road, and the symptoms ("no retry", starved suggestions) read as provider flakiness rather than a swallowed failure. The road measurement now grades the RESULT (`legs.some(l => l.source !== 'estimate')`) and retries once on an all-estimate chain. When wrapping a facade that swallows its own failures, assert on the degraded output (a `source` field, a flag, a sentinel) — a rejection you never receive is not a failure signal. (#188)

- **A duplicated measurement needs a WIRING test, not just a unit test.** #184 unified MapTab → TripMap and its acceptance asked for a fetch counter "per map open"; the workspace kept its own `routePath` chain anyway, because nothing asserted WHERE the measurement happens — tsc, tests and build all stayed green with two callers, and the duplicate doubled the load that caused the failures it was fixing. The pin is a source invariant (`tests/trip-road.test.ts`): the map surface must not call `routePath`, the workspace must measure through `tripRoad`, and that module owns exactly one call. Same shape as route-integrity / mobile-shell — cheap, and it fails the moment a second caller appears.

- **A gate that validates VALUES cannot see a defect in the RELATIONSHIP between them — and a wrong map is how it shows up.** Six shelf itineraries passed the validator and the golden engine test while 27 coordinates were shared between different places (a four-stop Gulmarg day sat on one point), because every individual coordinate was valid India-range data. The map then drew one marker where the timeline listed four and the route appeared to end at an unmarked spot, which reads as "the importer lost a stop" rather than "two rows share a number". When two layers are derived from different data, check the *relationships* too — uniqueness, distinctness, cross-references — and give the rule a mechanical form so it can be checked: a coordinate may carry at most two stops and one of them must be `food`/`hotel`/`rest` (a meal at the place you sleep is one place; anything else is a geocode shortcut). The gate must print the offending cluster with its titles — that list IS the fix list. (Found live 2026-09-18, on the first import of a shelf file into the app.)

- **A prose contract and the code can disagree for months without a single failure — grep the convention, don't trust the doc.** `ITINERARY-IMPORT-SPEC.md` stated `orderInDay` was 0-based while `createTrip`, `addStop`, the Board and the Timeline all write `i + 1`. Sorting hides it completely (both orders sort identically), so nothing broke and nobody noticed. Before writing a rule into a spec — or believing one already there — confirm it against the implementation that would have to satisfy it; a falsy `0` in an ordering field is also a latent presence-check trap. The importer now renumbers from any base and the validator requires the app's own.

- **A format that evolves needs a declared version, a pure migration chain and a repair report — and the runtime reader and the offline gate are deliberately different policies.** Import must never reject what it can fix: it reads `formatVersion`, walks `MIGRATIONS` to the current shape, then normalizes (1-based renumbering, day `index` to position, honest numeric defaults, duplicate ids re-issued, dates reconciled to the day count) and reports every intervention as a one-line digest rather than a stack trace. A file claiming a *newer* version is refused with the reason, never half-read. The offline validator stays strict — a file *you* author should fail before it ships, a file a *user* hands the app should import as cleanly as possible. Corollary: the wire version is file metadata, so strip it before the trip's unknown-key allowlist sees it (`formatVersion` on a bare trip warned about "a field nothing reads" until 2026-09-18), and pin the convergence property — exporting what was just imported must produce the same shape, ignoring the session-local `imp_*` ids.

- **Never rewrite JSON with a text regex you cannot count.** A pass that added 1 to every `orderInDay` via a pattern requiring a trailing comma silently skipped the last key of each object, and a bulk rewrite of a data file has no type to catch it — the file still parses, it is just partly un-migrated. Prefer repairing through the parser (`JSON.parse`/`stringify`) or, when the raw text must be preserved for a minimal diff, assert the replacement count against the parsed count and re-validate afterwards. Same family as rule 9's changelog rewrites.

- **A day's END is not a free variable — a reorder that moves a night's base rewrites the next morning.** `dayEndPosition` returns a day's last *stored* stop and `originOf(next day)` walks forward through it, so anything that moves the tail moves where tomorrow starts. Optimise-day pinned only `auto` stops (engine-synthesized waypoints) and never a stored hotel, so on the six shelf itineraries **21 of 32 optimisable days had their tail replaced, 18 of them the night's base, and 14 day-pairs shifted the next wake-up point — worst 16.3 km** (sleep in Candolim, plan the morning from the Basilica). A `hotel`/`rest` stop at the tail is now an implicit anchor. Two rules for any future reorder surface: **(1) before treating a stored value as movable, ask which other days are DERIVED from it** — endpoints, origins, roll-ups; **(2) a warning count is not a safety net** — optimising every shelf day moved Coorg 2→4 warnings but Goa **1→0**, silently dropping the only flag while the endpoint had moved 16 km. Test the property, not the symptom: assert `originOf(next day)` is unchanged after the reorder, which is what caught it. (Found 2026-09-18.)

- **A11y contrast claims get computed, not eyeballed.** Issue #64 claimed sub-AA tab contrast; the WCAG luminance math showed 7.53:1 dark / 4.86:1 light — not reproducible. Before accepting or "fixing" a contrast report, run the numbers on the actual token pair and surface (the issue's premise named the wrong variable). Close such issues WITH the measurement.

- **`gh` batch loops in this shell exit 1 while partially succeeding.** A PowerShell `foreach` over `gh issue close` reported command failure with no visible output, yet had closed every item — the next retry only surfaced "! already closed". After any compound `gh` batch, re-derive state (`gh issue list`) before retrying; idempotent retries are safe, blind assumptions are not.
- **`overflow-x: clip` silently clips BOTH axes — the pair rule.** Setting `overflow-x: clip; overflow-y: visible` makes `overflow-y` compute to `clip`, so absolutely-positioned blobs that bleed past an element's top/bottom (`top:-90px`/`bottom:-70px` atmosphere blurs) get hard-sliced into visible "seam" lines at the container edges, and right-side bleed (`right:-150px`) shows as a crop bar. To clip horizontal blowout you can't rely on section-level `overflow-x: clip`. Prefer `html { overflow-x: clip }` (a true clip that isn't a scroll container, so `position: sticky` nav keeps working) and leave the section overflow-free so soft blurs can bleed across section bounds onto a shared fixed canvas.
- **`env(safe-area-inset-*)` is inert without `viewport-fit=cover`** — `.impact-sheet` shipped an `env(safe-area-inset-bottom)` padding that silently did nothing because `index.html`'s viewport meta lacked `viewport-fit=cover` (found while fixing UI-audit F-26, Sep 2026). Activating `cover` turns EVERY inset on at once, so audit all fixed/sticky layers (topnav, toast zone, fabs, drawers, `top:`/`scroll-padding` offsets derived from `--nav-h`) in the same change — adding them one at a time leaves half the UI under the home indicator.
- **Section-restructure edits can silently swallow bullets** — an edit whose
  `old_text` spans `<heading>` + its bullets + the next `<heading>`, replaced
  by just the next heading, **deletes the bullets**, not only the heading.
  After any heading-level restructure (CHANGELOG releases especially),
  re-grep all headings and re-read the affected range before trusting it.
  (The 0.18.0 restructure briefly lost four Fixed bullets this way.) A
  variant: replacing a long bullet's **lead sentence as a prefix substring**
  splits the bullet — the orphaned tail stays glued to whatever the
  replacement ends with (a duplicated `### Fixed` + a Frankenstein bullet,
  Sep 2026). Never match a bullet by its lead alone; include the full line or
  re-read the section after the edit.
- **In-page anchors on hash-routed pages must be `button` + `scrollIntoView`,
  never `href="#id"`** — the router owns `location.hash`, so a plain anchor link
  rewrites the hash to `#plan-bench` and the router treats it as an unknown
  route (the Plan Bench hero anchor, Sep 2026). Pair the target section with
  `scroll-margin-top` so the sticky nav doesn't cover it.
- **A `role="switch"` with only an on/off state reads poorly when both states
  are first-class** — the bench's return toggle became a segmented control
  (two `aria-pressed` buttons in a `role="group"`); prefer that pattern when
  neither state is "off".
- **Supabase failures come back as `{ error }`, not rejections — a `void supabase…write()` with no `.then(({ error }))` is a silent data-loss hole.** `publishItinerary` fire-and-forget its upsert while the optimistic in-memory write made the UI look successful; the next refresh hydrated the (empty) table and the data "vanished" (Sep 2026). Rule: every write-through checks its error and either toasts or rolls back the optimistic cache (see `updateProfile`, `publishItinerary`); every hydration table result is error-logged, because a failed `select` also returns `{ data: null, error }` rather than throwing — a denied/missing table silently hydrates as `[]`.
- **Gallery-import quality is mechanical, and the engine's realism rule shapes the route.** `docs/examples/itineraries/*.golden.json` are the Explore shelf's source files, and `tests/golden-itineraries.test.ts` gates every one of them in CI: `scripts/validate-itinerary.mjs` for structure (required numerics so `NaN` can't poison a day, both coordinates checked so a Null-Island pin can't bend the route, unknown keys rejected so a typo'd field isn't silently dropped, `days.length` = inclusive date span) and the real `computeHealth`/`computeTotals` for truth. The arithmetic decides whether a plan can ship: high = −11, medium = −7, low = −3, so **health ≥ 85 allows at most two mediums**, and a day over **5 h / 300 min of engine travel is a HIGH that fails outright**. That rule rejected the obvious 3-day Bangalore→Coorg weekend (day 1 = 423 min / 268 km) and produced the 5-day loop that breaks the drive at Mysore both ways — so when a gallery itinerary "looks fine" but fails, **fix the route shape, not the threshold**. Two research rules ship with it (spec + playbook in `docs/`): **geocode coordinates, never recall them** (`scripts/gallery-geocode.mjs`, Nominatim — the app's own OSM stack; hand-typed coords for the Bylakuppe/Dubare cluster were ~15 km off), and **resolve fee conflicts in the open** (Mysore Palace: ₹50 official vs ₹70 guidebooks → publish the official figure, cite it in `sourceUrl`, and state the conflict in `warningsAndAssumptions`). Budgets are never hand-picked: run the golden test, then set `budgetPerPersonInr` from its printed engine estimate. The first five shelf trips (Goa, Kerala, Mewar, Kashmir, Meghalaya — the ranked twenty are in `docs/GALLERY-BACKLOG.md`) added three more mechanical lessons: **(a) the engine measures straight-line × 1.25 at the mode speed plus a 10-min pad per leg** (`legBetween`), so ~120 km is the medium line and ~182 km the HIGH line — a real 175 km Ranakpur→Jodhpur drive read 283 min and had to move off its day, while winding hill roads read *shorter* than the road sign; **(b) two consecutive stops on identical coordinates trip the backtracking warning** when the day's long leg follows (a zero-length inbound hop), and its "reorder stops" fix is impossible when the day must return home — give every stop its own real coordinate; **(c) lodging prices per distinct base, not per night**, and `stayStyle` swings the total hardest (budget ₹1,200 vs comfort ₹3,200 per room-night) — Meghalaya's declared budget was 97 % above the engine's until it was set from the printed estimate.

**When diagnosing "works in the session, gone after refresh"**, probe the live table with the anon key via PostgREST (`GET /rest/v1/<table>?select=…` — RLS SELECT policies decide what's readable; `published_itineraries` is public) before touching code: it immediately separates "never persisted" from "persisted but not rendered". Column-existence probes work on empty tables (`select=<cols>&limit=1` errors naming a missing column); the OpenAPI root (`/rest/v1/`) needs the service-role key, so it's useless with the anon key. To test an *authenticated* write, sign up a throwaway QA account via `POST /auth/v1/signup` (email confirmation off → session token in the response) and replay the insert — but record the generated email immediately (it's randomized and unrecoverable from auth without the service key; the profiles table's public read policy can restore it).
- **An UPDATE is checked against the SELECT policy too — a "hide the row" policy can silently break "write the row".** The trash tombstone (`UPDATE … SET deleted_at`) failed with `42501 new row violates row-level policy "trips read hide trashed"` because that SELECT policy had no owner clause — Postgres evaluates SELECT policies against the UPDATE's added row, so hiding tombstoned rows from *everyone* made them unwritable by anyone. Symptom was a silent optimistic-rollback: trip vanishes, then reappears on refresh. Fix shape: the hide policy must keep owner/editor visibility for tombstoned rows, hydration filters them client-side (the Trash RPC is their surface), and the repair SQL lives in `supabase/fix-trashed-read-policy.sql`. Proven live with a QA signup (Sep 14 2026). Probe RLS write failures with `Prefer: return=representation` OFF first (that header adds RETURNING and fires a *different* 42501), then verify with a follow-up SELECT.
- **`git diff --check` before committing any merge** — conflict markers in
  *non-code* files (CHANGELOG.md) are invisible to the whole verify gate
  (`tsc` + tests + `vite build` all passed with a leftover `<<<<<<< HEAD` in
  the CHANGELOG during the PR #30 merge, Aug 2026). `git diff --check` exits
  non-zero on leftover markers; run it before `git commit` on every merge.
  **Markers can arrive already committed from someone else's merge** (found
  Sep 2026: merge `f83fee4` shipped `<<<<<<< HEAD` + an orphaned `=======`
  into CHANGELOG.md on `test`, where everything downstream — including the
  next release cut — inherits them). After syncing or merging remote work
  that touched CHANGELOG, grep for `<<<<<<<`/`=======`/`>>>>>>>` before
  writing prose near the affected section.
- **When merging an agent PR that's based on pre-rewrite code, keep the local
  structure and re-apply the PR's *intent*** — PR #30 was based on the
  pre-`ridePlan.ts` tree, so its TripWorkspace hunks showed obsolete ranking
  code; taking "their" side wholesale would have reverted the ride-plan
  engine. Also: a signature change arriving via merge (`detourKm` →
  `number | null`) must be null-guarded at *every* caller, including files
  the PR never touched (`ridePlan.ts:256` — tsc catches it, but only because
  strict null checks were on; auto-merged hunks in other files won't be
  flagged by the PR author's green CI).
- **GitHub markdown links resolve from the file's own directory** — a
  root-level file links `docs/X.md` (never `../docs/`), files in `docs/`
  need `../` to reach root files like `DESIGN_TOKENS.md`, and emoji
  headings anchor with a leading dash (`## 🚀 Getting started` →
  `#-getting-started`). PR #25 shipped four broken links this way — check
  every link target against the tree before merging doc changes.
- **Suggestion searches are expensive — persistence is the contract.** Corridor
  searches (Map-tab nearby, timeline halt spots) must hydrate from
  `useSuggestionCache` and never auto-refetch from derived-state churn: the map
  effect's deps on `planKm`/`wholeTrip.min` re-fire when OSRM resolves *after*
  mount, and a `[day]`-reset effect wiped timeline spots on every trip edit.
  Only explicit user controls (↻ Refresh, detour-scope slider, 📍 Suggest) may
  re-run a search. Corollary: a "clear the cache" button does nothing unless
  some state it affects is in the fetch effect's dep array (the broken ↻
  Refresh) — pair cache-clearing with a `refreshTick` bump.

- **Every trip-data store mutation must write through (`persistTripField`), not just `commit()`.** `addStop()` — the Suggestions "Add to timeline" path — updated the cache and logged activity but skipped the DB write, so the stop vanished on the next reload. The whole verify gate (`tsc` + tests + `vite build`) stays green with this class of bug because nothing exercises write-through. When a mutation adds an "add" path that mirrors `updateStop`/`deleteStop`, verify it calls `persistTripField` too, and cover it with a mocked-`supabase` write-through test (`tests/store-persistence.test.ts` has the pattern: `vi.mock` the client, `await` a microtask flush, assert the `.from('trips').update` captured the change).
- **Undo/restore helpers must honour their own documented contract — and deletion renumbers, so "old order" needs `>=`, not `>`.** `restoreStop` claimed "back at its old order" but pushed + renumbered, dumping the restored stop at the day's end. The first fix attempt (`> stop.orderInDay`) still failed the test because `deleteStop` renumbers the survivors — the stop that *inherited* the deleted slot then compared equal, not greater. When a restore targets a position in a collection that mutates on delete, derive the insertion point from the POST-delete numbering (`>=` the captured order), and pin the contract with a test asserting the restored `orderInDay`, not just membership. (Found while wiring map-pin delete undo, Sep 2026.)
- **A cross-surface mutation needs a follow-the-surface check: what does each consumer derive, and does it re-render?** Wiring "resolve vote → stop lands on timeline" required walking every surface that shows the place: Board/Timeline read the trip (free), but the Map rail's see-&-do rows and its count badges derived visibility from `existingNames` only in *some* paths — rows kept offering an already-added place. When adding a mutation that makes a thing "already added", grep every consumer for its added-test and route them all through one predicate (here name-based dedupe), including derived counts (`seeAndDoLive`), not just row render.
- **An effect that depends on asynchronously-hydrated store data must list those values in its dep array.** `InviteGate` used a mount-only `[]` effect, which fired before `init()` resolved — `me`/`trip` were both null, so the invite never auto-joined and the user sat on the spinner. `react-hooks/exhaustive-deps` (now wired via `npm run lint`) flags exactly this; don't suppress it with `eslint-disable` when the fix is to depend on the resolved object.
- **Scoping a query invalidates every cache-shape assumption downstream of it.** When hydration was scoped to the user's memberships, `tripById` — consumed by the public itinerary page and the invite gate — silently started returning undefined for every non-member (and every anonymous visitor): "Itinerary not found" on Explore cards, "This invite link is broken" on invites. Before changing what a fetch returns, grep for consumers that derive invariants from that data; flows that legitimately need OTHER people's rows (public pages, invites) get an on-demand fetch (`fetchSharedTrip`) plus an RLS/RPC path, never a cache-shape accident.
- **The clock walk numbers DRIVE days, not calendar days — anything mapping
  `TravelClockDay.dayIndex` onto `trip.days` or a date must anchor
  deliberately.** The walk splits the road by caps (`planDriveDays`) and the
  return pass (`#145`) indexes its days continuing the outbound count, so its
  indices are neither itinerary positions nor dates: joining corridor `cumKm`
  against a return label's turnaround-relative km needs the origin-scale
  mirror (`outboundKm − km`, measured off the drawn polyline), dating return
  drives needs the trip's tail (`tripDaysCount − returnDays.length + local`),
  and a tap target needs the resolved itinerary day (`ClockMilestone.itineraryDay`)
  with the consumer validating it against `trip.days` — a value no DaySection
  matches collapses the whole accordion. One-shot cross-component signals must
  also be consumed-and-cleared at the consumer (the workspace outlives trips;
  `TripWorkspace` is not keyed by trip id), or they re-fire on every later
  mount and leak across trips.
- **The halt planner's plan + resolved spots must be written together** (`setHaltCache(day, segments, plan)`), because hydration rebuilds the editable plan from `cache.plan` and the pinnable real spots from `cache.segments[i]`. And the corridor search behind "🔎 Find real spots" runs **only on that button** — never on plan edits — per the §4 persistence rule; a `[day, sugCache]` hydrate effect that clobbers an in-progress edit is guarded with an "only rehydrate while the plan is empty" check.
- **`kmFromStartForHit` takes `Pick<PlaceHit, 'latitude' | 'longitude' | 'alongRouteKm'>`** — an ItineraryStop's `lat`/`lng` must be remapped (`{ latitude: s.lat, longitude: s.lng }`), it will not type-accept the stop directly. Same asymmetry to watch on any `PlaceHit`-shaped helper.

- **The impact dialog's time delta must include dwell, not just driving.** `computeImpact` summed `totalTravelMinutes` (wheel time only), so adding a 20-minute halt showed a ~0 time extension and the preview looked broken. `DaySchedule` now exposes `dwellMinutes` (visit minutes + per-stop buffers) and the delta sums both — relabelled "Time on the road (driving + stops)" so the semantics are visible. Note `computeTotals.totalTravelMinutes` is still driving-only for budget/warning math; don't "fix" one and silently change the other.
- **Planned halts are on-route by default; real spots are opt-in.** The halt planner's `pin` flag must default to `false` — the planner auto-attaches the best place found near a km point, and a `true` default silently redirected every halt to that place. The row shows an explicit "detour to <place> instead of the route point" checkbox.
- **Coerce persisted numeric fields before math, never trust them as numbers.** Rows hydrated from Supabase (or hand-edited JSON) can carry `undefined`/`null` for numeric columns — a stop's `visitMinutes` arriving as `undefined` once made `undefined + bufferMinutesPerStop = NaN` poison the whole day's dwell and the impact dialog rendered `NaNh NaNm`. `simulateDay` coerces `visitMinutes` to a finite number (0 fallback) before use, and `minutesToHM` renders `—` for non-finite input as a last-resort display guard. When adding new numeric trip/stop math, apply the same finite-check at the point of use.

- **A `backdrop-filter` ancestor is a blur root — nested glass silently can't frost.** The nav
  popovers used the navbar's exact glass recipe yet stayed sharp-edged: their blur sampled the
  topnav's own interior; the page behind never entered their backdrop. Floating panels must
  render outside the filtered ancestor — portal to `document.body` + `position: fixed`, with the
  rect captured from the trigger at open time (see `App.tsx` notif/user-menu). Corollaries:
  click-outside guards must cover BOTH the trigger wrapper and the portaled node
  (`useClickOutside` returns `[ref, portalRef]`), and focus must be moved into the open panel
  explicitly (`tabIndex={-1}` + `focus({ preventScroll: true })`) — portaled nodes leave the
  trigger's tab neighbourhood.

- **An Edit whose `old_string` ends mid-line silently drops the line's tail.**
  Editing JSX whose expression closes as `</>}` with an `old_string` ending at
  `</>` matched the prefix and deleted the trailing `}`, leaving a parser error
  (TS1005) one line below the edit — and a second edit anchored on a nearby
  comment duplicated a `const` instead of moving it. After any multi-part
  restructuring edit in this repo, run `npx tsc -b` immediately and diff-review
  before continuing (M3.3, Sep 2026). Variant (halt-planner fix, Sep 2026):
  replacing "line + trailing newline" with the same line *without* the newline
  merges the NEXT line into it — and since two statements on one line is valid
  TS, **tsc stays green on the merge**; only re-reading the edited region
  catches it. Anchor `old_string`/`new_string` pairs so line endings can't
  shift: include the following line in both, or end neither with a newline.

- **`src/styles.css` is CRLF on disk — Node one-off scripts must handle `\r`.**
  Bulk CSS edits via `node` scripts split on `\n`, so every line carries a
  trailing `\r` and exact-string anchors silently fail (or, worse, writing
  LF-only sections leaves the file mixed-ending). Strip `\r` before matching,
  and re-normalize to CRLF after writing (`git show HEAD:file` is LF-normalized,
  so byte-diffs against it need `\r` stripped too). Also: this shell mangles
  backslashes inside heredocs/`node -e` — write the script to a file (Write
  tool), run it, delete it.
- **Never round-trip file bytes through a PowerShell pipeline** (`git show X:file
  | Out-File` or `>`). The decode-then-re-encode step mojibakes every non-ASCII
  character (em-dash → `ΓÇö`, § → `┬º`) and the damage ships green: tsc, vitest
  and vite all pass on valid-but-corrupted CSS/TSX — only a byte-level check
  (python counting `\xe2\x80\x94` vs the mojibake sequence) catches it. Materialize
  git blobs with `git checkout <ref> -- <path>` / `git restore --source`, or read
  them byte-exact via python `subprocess`. Unquoted backticks in shell command
  strings suffer the same fate: a BEL (`\x07`) landed in committed CHANGELOG
  prose where the letter "a" should be (Sep 2026) — that is how `\u0007pplyChange`
  happened.
- **Porting a feature from a stale branch by copying its whole file silently
  reverts everything the base gained since the fork.** The calendar-export merge
  overwrote the tabbed ShareTab (PR #74's refactor) and deleted the
  `.ai-drawer:not(.open)` close rule that way — and nobody noticed because the
  verify gate has no UI assertions. Before taking a branch's version of a file,
  diff it against the merge base (`git diff <merge-base> <branch> -- <file>`)
  and port only the intended hunks.

- **Heavy DOM-snapshot/image libraries stay out of the main chunk.** `html-to-image`
  is lazy-imported inside `billCapture.ts`'s share handler: static import measured the
  landing main chunk at 695.7 kB vs 682.4 kB lazy (+13 kB). Any new canvas/rendering
  dependency goes through `await import()` at the click site, and the choice is
  measured with `npm run build` before committing. Related: to snapshot themed UI
  (the bench receipt), pin the component's scoped custom properties to the wanted
  theme via an override class for the capture frame (`.bench-receipt.capture-dark`)
  instead of flipping `data-theme` on `<html>` — no theme flash, no restore race.
- **"Landing + core stays in the main chunk" decisions rot — audit static page imports against the build, not the comment.** An old code-splitting note in `App.tsx` said the workspace "stays in the main chunk (it is the app's core)", and three `import { X } from './pages/...'` statements quietly kept TripsList + TripWorkspace (138 kB) + Explore eagerly in the landing bundle for months (main chunk 683 kB; landing LCP paid for tabs and editors it never renders). `lazy()` + `Suspense` is already the established pattern for secondary routes — default every non-landing route to it and re-measure the main chunk whenever a page grows. Corollary for Lighthouse a11y: `label-content-name-mismatch` requires the accessible name to contain the FULL visible text — a state suffix like "Return leg ×2" must appear inside the `aria-label`, and a decorative glyph separator (`.ticker-sep`'s ◇) can never pass text contrast; render it as an SVG shape instead of chasing a passing text colour.
- **Buttons without an explicit colour inherit UA `buttontext` (black)** — fine on light
  surfaces, invisible on dark ones (Profile travel-style chips rendered black-on-navy in dark
  mode). The global `button { color: inherit }` reset in `styles.css` makes every button take
  theme text; set a colour explicitly only when a button deliberately differs.

- **lucide-react 1.x removed all brand icons** (`Instagram`, `Youtube`, `Twitter`, … were
  dropped upstream) — importing them is a tsc error, not a lint nit. Substitute a generic
  glyph and carry the network in the `aria-label` (Explore creator links use
  `TvMinimalPlay` for YouTube and `Camera` for Instagram). Check availability with
  `node -e "console.log(Object.keys(require('lucide-react')).filter(n => /x/i.test(n)))"`
  before writing the import.

- **A squash-merge can silently DROP files, and nothing in the gate catches it.**
  PR #75's squash carried the calendar/print/ShareTab files but silently omitted
  `src/pages/TripsList.tsx` — My Trips reverted to a bare list for a release, the
  contributor had to file a restore PR (#80), and the earlier session summary even
  claimed the feature "was already merged" without file-level proof. The gate stays
  green (nothing exercises an absent feature). Rules: after merging external work,
  diff the PR's `--name-only` list against what actually landed (`git show <merge> --stat`
  / grep for a marker from each claimed feature) before writing any summary; and when
  a contributor's PR says "this was dropped", believe them enough to verify — grep for
  the feature's symbols (`useMemo`, a state key) in the current tree, not in memory.

- **A casing audit needs `-CaseSensitive` and must grep the enum definitions, not the
  literals.** Two traps cost a false alarm and a near-miss in the same session: (1)
  PowerShell's `Select-String` is case-insensitive by default, so `label="[a-z]` happily
  matched `label="Menu"` and reported ~85 phantom offenders; (2) raw-enum renders
  (`{TRANSPORT_MODES.map(m => <option>{m}</option>)}`) are invisible to string-literal
  greps — the lowercase lives in `types.ts`, not the JSX. Audit the enum arrays and find
  their render sites. Related: an `<option>` without `value=` derives its value from its
  *text*, so capitalising the label alone writes "Car" into the data model — always add
  the explicit `value=` when prettifying option labels. And prefer consolidating the
  per-file copies of a formatter (`cap` had 7, `labelCat` 4 with drifting behaviour) into
  one `lib/labels.ts` over fixing sites one by one.
- **A light-mode-passing colour can fail dark mode, because the teal scale INVERTS.**
  `--yf-teal-600`/`-700` are ordered dark→light in light theme (#0D8D82 → #0C716D) but
  bright→dim in dark theme (#2BB8AC → #1E9D92). So `#fff` on teal-600 measured 4.08:1 light /
  **2.46:1 dark**, and teal-700-on-teal-100 measured 5.14:1 light / **4.08:1 dark** — the
  bench's four selected states all failed at least one theme while looking intentional.
  Always compute BOTH themes from the token values (AGENTS: contrast is computed, not
  eyeballed), and fix the shared class rather than the surface: the same `.bench-*` classes now
  render on the landing hero and in Trip settings. The dark fix reuses the project's own answer
  for saturated fills — near-black ink `#06251f` on bright teal (6.62:1), exactly what
  `[data-theme='dark'] .pill-nav … .on-teal` already does.

- **Merging external work that also edits CHANGELOG can produce TWO `## [Unreleased]`
  sections — invisible to the entire gate.** PR #80's squash carried its own `[Unreleased]`
  while the working tree already had one, leaving a duplicate header (and a duplicate
  `### Fixed`) that tsc/tests/build all pass on. The release-cut keys off the **first**
  `[Unreleased]`, so the next version bump would have silently dropped half the entries.
  After any merge touching CHANGELOG: `Select-String -Pattern '^## |^### '` and confirm the
  counts are 1/1/1 before committing.

- **Changing approach mid-task orphans both the code AND the changelog text you already
  wrote.** Trip settings went from "extract compact primitives" to "reuse the bench's own
  classes"; that left `SettingsGroup`/`CountStepper`/`OptionTiles` as dead exports
  (`noUnusedLocals: false` never flags them) and a committed CHANGELOG bullet naming
  primitives that no longer exist. On any approach change: re-grep for every symbol you
  introduced in this session and re-read your own changelog prose against the final code.


- **Vendored ripgrep can be missing in the desktop environment — `code_search` fails with ENOENT (`rg.exe` not found).** Don't retry it; fall back to `grep -n` / `awk` in the shell, which answer the same question.
- **Release tags are not automatic — they were skipped after v0.44.0.** `git tag` stopped at v0.44.0 while `package.json` climbed to 0.47.0 and nothing in the gate reads tags, so nobody noticed. Verify tag state with `git tag --sort=-creatordate | head` when a release claims to be tagged; backfilling needs an explicit tag push to the remote.

- **`.card + .card { margin-top: 14px }` also matches GRID items — every new grid of `.card`s shoes it the same way.**
  A grid already spaces its items with `gap`, so the stacked-card beat double-applied: in a row of peers every card
  after the first rendered 14px lower *and* 14px shorter (live measure: tops 839/853, heights 477/463, and 26px of
  space where the grid declared 12). It is invisible to tsc, to every test and to the build because nothing renders
  these pages in CI, and it reads as "the cards look oddly placed" rather than as a spacing bug. `.explore-grid > .card
  + .card` and `.two-col > .card + .card` zero it; **when you add a grid whose children are `.card`s, add it to that
  selector list** (Explore, CreatorPage, TripsList and the public page's Travel-tips/Warnings row are covered).
  Related: a two-column grid nested inside a content column keeps the `1fr 340px` sidebar width it doesn't have —
  peer content in a row wants `.two-col--even` (1fr/1fr), not the sidebar shape. This pair is pinned by
  `tests/public-surface-guardrails.test.ts`.

- **`animation-fill-mode: both` outranks a `:hover` declaration, so an entrance animation silently kills hover motion.**
  `.trip-enter` animated `transform: none` as its last keyframe with `both`, which retained that value forever and beat
  `.itin-card:hover { translateY(-2px) }` — a shelf card answered the pointer with a shadow change and no movement while
  the *same component* on a creator page (no `enterIndex`, so never animated) lifted. Use `backwards` when the
  animation's end state equals the element's own resting state; it applies the `from` state during the stagger delay
  exactly as `both` did, then releases the property. Debugging tell: compare the same component on a surface that
  animates it against one that doesn't.

- **A grid or flex item's automatic minimum size is its MIN-CONTENT, so one unbreakable run sets the width of the
  whole document.** The published page's sticky sidebar held a nowrap share URL in a flex row: that gave the column a
  **451px floor inside a 362px column**, scrolling the document 75px sideways at a 390px viewport — and the
  `overflow: hidden` + `text-overflow: ellipsis` the rule already declared could never fire, because the item refused
  to shrink below its min-content. `min-width: 0` on the grid children (`.two-col > *`) and on the flex item fixes it.
  Two corollaries: the fix belongs at the *container* level (setting it on the inner `<code>` alone changed nothing —
  the column's floor is what overflows), and **diagnose it with `document.documentElement.scrollWidth - clientWidth`
  plus a `getBoundingClientRect().right > viewport` sweep**, not by eye — the widest offender here was an 8px-wide
  visible element sitting inside an invisible 451px floor.

- **A container's `overflow: hidden` deletes absolutely-positioned children that "hang" past its edge — and the
  geometry reads as fine until you hit-test.** `.pub-hero-stats` was positioned at `bottom: -66px` over a hero with
  `overflow: hidden`: its box measured 507→720 against a clip at 654, so the bottom two of its four evidence rows
  were never painted and `elementFromPoint` at their centres returned the Save/Fork buttons *underneath*. Two tells:
  a `getBoundingClientRect()` box that exceeds its nearest clipping ancestor, and rows whose hit-test result is a
  sibling surface. Check for a negative offset over a clipping ancestor whenever a floating card sits on a fold —
  and if the design intends the straddle, the reserve/clearance must move with it (here the card was brought inside
  instead: `bottom: 16px` with the hero's bottom padding grown to match, so nothing moves on screen except the clip).

- **A responsive rung placed BEFORE a wider one loses to it — media-query order is the cascade, not specificity.**
  A `@media (max-width: 360px)` block written above the `<=480` and `<=720` blocks applied only the one declaration
  those blocks don't themselves set; everything they touch won. Rungs go in **descending-width order** (or the narrow
  one last), and a comment saying "placed after X on purpose" is cheaper than rediscovering it. The related trap: a
  shared selector *list* (`A, B, C { … }`) and a later per-class rule have equal specificity, so the later one wins and
  silently overrides the recipe — when routing an existing class through a shared recipe, **delete its own
  declarations in the same edit**, don't just add it to the list.

- **A guardrail regex anchored on `\.class \{` also matches the TAIL of a shared selector list.** `.poi-grp-k, .poi-reason-k {` contains `.poi-reason-k {`, so a rule-extraction pattern written for "this class's own rule" read the shared recipe's declarations back as the class's own and reported a phantom violation — and the inverse: a teeth-test can pass for the wrong reason. Anchor to the start of a line (`^` with the `m` flag) in a one-rule-per-line stylesheet, and confirm each class has exactly one rule before trusting the pattern.

- **A gate's baseline key must never carry a line number — key it by what the rule declares.** The contrast and duration keys were line-numbered (`styles.css:1285 .day-rail-chip.warn:hover — 3.48:1`), so *every* CSS insertion anywhere above them failed the gate with phantom "new violations" and forced a deliberate re-baseline — hit twice while building the gates, and a third time as a rebase conflict, which is the worst form: two branches had both moved `styles.css`, so each side read the other's entries as new (the same selectors, different numbers, neither side mergeable). All six arrays now key on the offender's own text: `selector — ratio`, `selector — prop: value`, `property: value`, or the bare name for `duplicateSelectors`/`hueCollisions`. The migration was proven exact — every array identical once the prefix is stripped (36 entries, none collapsed, nothing added or lost). The trade-off is explicit, narrow, and now uniform: a *second* rule repeating an already-tolerated pair is **not** flagged, because the pair is what the key names; `duplicateSelectors` catches that selector twice at the top level, which is where it surfaces first. Every set still only shrinks — an entry that stops reproducing fails the gate until it is deleted — and zero stays exempt (`margin: 0px` is not rhythm). Re-baseline deliberately with `UPDATE_DESIGN_SYSTEM_BASELINE=1`.

- **To verify a cascade on a surface you cannot sign into, inject a probe element and read `getComputedStyle`.** The map rail's labels need a signed-in trip, so the computed style was read by appending a detached `<span class="poi-grp-k">` to the live page and reading back `fontSize`/`fontWeight`/`letterSpacing`/`textTransform` — which is how the routing was proven to *take effect* (10.5px / 700 / 0.63px) rather than merely to be declared, and how the one-class list-override trap above would have shown up. `agent-browser eval` takes the JS as its argument (there is no `--file`), and the DOM injection leaves the repo untouched (`index.html` stays byte-clean).

- **A Wikimedia cover cannot be fetched from a browser even though curl reads it fine (learned 2026-09-19).** Copying an auto-suggested cover into our own bucket needs the bytes, and `Special:Redirect/file/<File>?width=N` — the shape `sizedCoverUrl` writes and the picker stores — answers a **301** to `upload.wikimedia.org`. Only the final 200 carries `access-control-allow-origin: *`; the 301 hop carries none, and a cross-origin fetch must clear **every** hop, so `fetch()` rejects with a bare `TypeError: Failed to fetch` while the identical curl request downloads 586 KB happily. Resolve the direct address first through the file's own wiki API — `https://<host>/w/api.php?action=query&prop=imageinfo&iiprop=url&titles=File:<name>&origin=*` — whose `imageinfo[0].url` is an `upload.` file, and `upload.wikimedia.org` file URLs are the only Wikimedia addresses a browser may read directly. Three corollaries: the API appends its own `?utm_*` query, which must be stripped before the URL is stored; the name in the URL is percent-encoded while the API wants it decoded, so decode **once** or `Telkupi%252C_Purulia.jpg` is born; and `wikimediaFile` in `tripThumb.ts` parses only the direct `/wikipedia/…` shape, so the `Special:Redirect` form needs `wikimediaFileName` — assuming the one function covers both is how the first version failed.

- **Wikimedia serves only the thumbnail widths it has generated — a composed width answers 400.** Auto covers read the REST summary's `originalimage`/`thumbnail`, which is either the *unscaled* upload or a 3840px thumb (1.3–3.3 MB measured across real destinations), so the obvious fix — build `…/thumb/<h>/<hh>/<File>/1200px-<File>` — 400s on **both** `upload.` and `thumb.wikimedia.org`, and so does substituting the width into a URL the API itself returned. The supported route is `Special:Redirect/file/<File>?width=N`, which 301s to the nearest size that exists (1200 → 1280) and measured 144 KB where the original was 1304 KB. Two corollaries when matching these paths: strip the `?utm_*` query the API appends (it is captured as part of the file name otherwise and produces a nonsense URL), and take the file name **exactly as it arrives** — it is already percent-encoded, so decoding then re-encoding double-escapes `Telkupi%2C_Purulia.jpg`. `lib/tripThumb.ts` `COVER_WIDTH` is the single lever if a future cover exceeds the 600 KB preview ceiling.

- **The only server-rendered URL is `/i/<id>`; a hash fragment never reaches the server, so every in-app screen is `/` to a crawler (learned 2026-09-19).** `/#/explore`, `/#/trips` and `/#/pub/<id>` are all served by the shell, which makes a `Disallow: /#/…` rule in `robots.txt` inert — it looks correct and does nothing, and a test now forbids adding one. Public discovery runs through `public/robots.txt` plus `api/sitemap.js`, which lists the shell and every `published_itineraries` row and answers **503** rather than a one-URL sitemap when the catalogue is unreachable (a valid-looking document naming only `/` tells a crawler every publication was deleted). A new `api/*` handler needs its `vercel.json` rewrite in the same change, and `/api/` stays disallowed so the rewritten target never becomes a second URL for the same page.

- **A crowded flex row squeezes whichever child CAN shrink — find which one gives, then key the fix to the space the row actually gets, never to the viewport (learned 2026-09-19).** The Plan Bench's mode buttons pack an icon, a name and a speed pill into one row; in the 721–1000px band each button is a *quarter* of the controls card, so the row's only flexible child — the name — ellipsized to a single letter ("T…" at 78.7px) while the inline SVG beside it squashed 15px → 3px (`flex: none` on the icon is the one-line half of the fix). Two traps. (1) A viewport media band is a *proxy* for a row's width: it must be re-derived by hand whenever the container's max-width, the grid ratio or a gap moves, and the cheap fix it suggests is not even correct — hiding the speed pill was measured to still clip the longest name from 721px to ~755px, because the icon grows back to its true 15px and takes 12 of the ~33px the pill was holding. (2) The same row can be hosted under a different parent (the Trip Settings tab's 8-mode grid, longest label "Motorcycle"), where one viewport is not the same width at all — so the rule has to be about the row's own box. What holds: `container-type: inline-size` on the block that owns the row plus `@container (max-width: …)` switching the grid to one column — it follows the real constraint, covers the sibling surface for free, and survives minification (`max-width` ships as the range form `(width<=230px)`, so grep the built CSS, not only the source). Verify by measuring `scrollWidth − width` per label and the icon's own width across the whole band, never by reading the CSS — and check the height cost against the surface's own budget (here the stack costs 80px in a band that already overflowed its one-screen promise).

- **A decelerate curve is right for a dropdown and a pop on a 1000px surface — measure the motion's SHAPE, not the transition rule (learned 2026-09-19).** `--ease-out` and `--ease-glide` agree within .015 at every sampled point and both put 86% of a surface's distance inside the first 44% of the duration, so the Timeline's day collapse spent 24% of a 967px body in the first 6ms and dribbled the last 10% over 150ms — a defect no amount of CSS reading shows, and one that looked like "the collapse is not smooth". Two instruments worth reusing: (1) sample `getBoundingClientRect().height` per rAF across a toggle and plot fraction-moved against ms — that curve tells you whether you are looking at the easing, the interpolation or a dead beat (the open path here had a ~35ms beat before anything moved, the two rAFs that let the `0fr` row paint first); (2) forcing `transition-timing-function: linear` in the live page isolates the easing from the technique — with linear the `grid-template-rows 0fr↔1fr` interpolation was a straight line, which pinned the entire defect on the curve. `--ease-resize` (`cubic-bezier(.42, 0, .58, 1)`, both ends at rest AND symmetric) is now the token for a surface that resizes in place and moves a long way — symmetric because peak slope is what a long move is felt through: on the day collapse's ~920px the asymmetric Material standard curve peaks at 2.73× its average speed (96px in one 60Hz frame) against 1.72× (60px) for the symmetric one, for the same total time and the same 3px first frame, so the asymmetric family belongs on short moves only. Corollaries: the affordance must run on the SAME duration and easing as the thing it announces (a chevron at `--t-fast`/180ms finished ~90ms before the body, so one click read as two movements), and any JS timeout that outlives the animation (unmounting a collapsed body) must take its duration from the token via `motionTiming()` — a literal 280ms quietly leaves a half-collapsed body mounted the moment the token is retimed. **Duration is the other half of the same defect, and the only lever that reaches peak frame speed.** With the curve fixed, the rows below a folding day still peaked at **10.5px/ms** (942px of travel on `--motion-slow`/240ms) — reported by the user as the cards "colliding". Peak speed ≈ `distance × the curve's peak slope ÷ duration`, so once the easing is right the options are a longer duration or less travel; a ~950px accordion body has only the first. `--motion-slower` is the fourth duration token, reserved for travel measured in hundreds of px, and its value was set by measurement rather than taste: 240ms peaked at 10.5px/ms, 440ms at 3.6, 560ms at **2.8px/ms (47px inside a 60Hz frame) with a first-frame delta of 0** (nothing moves on the click itself), and the measured per-frame peak fell in both directions (79→25 and 115→25px on a ~145fps renderer). One tension worth naming: 560ms is above Material's 375–500ms guidance for a large expansion, and it is only defensible because the distance is ~950px — set this token by the px/ms you need, not by the duration table's habit. Two measurement traps this caught, both of which would have made the wrong call: **quote px/ms, never px per frame** — a 145fps renderer hands you ~7ms frames and makes the same motion look half as fast as a 60Hz phone will show it — and a **single long frame inflates one delta**, so read p90 beside the max and report the frame intervals next to them (a 69px 'peak' at 86% of the animation was one dropped frame, not the curve). Also: an element that unmounts mid-sample reports a zero rect, which reads as a jump to the top of the page — skip anything detached. When a move still reads as a collision after the easing is fixed, check the DISTANCE before adding more curve.

- **A focused element is blurred the moment it stops being visible — so a focus handoff must run when the close STARTS, not when the node unmounts (learned 2026-09-19).** The day collapse's clip unmounts 600ms after the close (the token's duration + 40ms slack), and the obvious place to hand focus back — inside that unmount timer — is already too late: the clip's inner wrapper carries `visibility: hidden` on a transition *delay* of the same token, so it flips at 560ms and Chromium blurs the focused control right then, leaving `document.activeElement === document.body` by the time the timer fires. The measured symptom was a keyboard user losing their place: activating the day's route line with Enter (the control that opens the day) removed that line one animation later, and the next Tab restarted at the top of the document. The handoff belongs in the effect body beside `setExpanded(false)`, where the clip is still on screen. Generalise it: **whenever a rule hides or removes whatever has focus, ask which comes first — the blur or your cleanup — and hang the handoff on the earlier one.** Every clip that can unmount the focused element needs its own handoff (here: the route line on open, the body on collapse), and the same fix is the reason a disclosure control should own the fallback focus rather than the clip guessing.

- **A programmatic `.click()` does not move focus; a real mouse click does — so a focus-loss finding from `.click()` is a probe artifact (learned 2026-09-19).** Collapsing a day while focus sat inside its body reported `document.activeElement === document.body` when the click came from `el.click()` in an eval, and I nearly shipped a fix for it; the same interaction through a real CDP click (`agent-browser click`) lands focus on the chevron, because a pointer click focuses the button it hits. **Probe focus behaviour through the input path the user has** — real clicks for pointer, real `Tab`/`Enter` (`agent-browser press`) for keyboard — and expect the two to disagree: only the keyboard path had a genuine defect here, and only the keyboard path could have revealed it. Re-run any focus or state anomaly through the real input before writing a line of code for it.

- **A centred flex item is re-positioned by every sibling's height change — top-align a row's items when its content toggles (learned 2026-09-19).** The Timeline day header is `flex-wrap: wrap` + `align-items: center`, and collapsing a day makes the middle block taller (the collapsed-only route chain appears, and the stats line re-wraps as the chips come and go). Every centred sibling then re-centres on the new line height: the collapse chevron and the Day badge moved **up to 32px within the frame the click landed**, while the body animation took 240ms — the "jerky displacement" the user reported, and invisible in any CSS read. `align-items: flex-start` makes each item's position its own; re-measured, the displacement of every header item across a toggle is 0px. Three companions from the same fix: (1) **a wrapped line's position follows the animating line above it**, so once the height change is eased the second line glides too (the day's action row moves 43.8px *smoothly* during an open — correct, and it used to be a jump); (2) the one element that changes a container's height should ride the collapse (here the route chain reuses `SmoothCollapse` in reverse) rather than appearing at full height in one frame; (3) the elements that exist in only ONE state and change *width* (chips) can't be eased by a height animation at all — give them the catalog's entrance pattern (fade + 4px rise) so they arrive as a fade instead of a pop, and accept that their layout slot appears at once. Instrument: sample each child's `getBoundingClientRect()` per rAF across the toggle and report per-child max |Δx|/|Δy| + the container's height curve — that separates "something jumped" from "something glided 40px".

- **A day is addressed by `day.index` and never by array position — and one report names only one of the places that got it wrong (learned 2026-09-26).** Issue #338 read as a per-day money bug in `computeTotals` (`byDay` was built positionally but read with `byDay[day.index]`, the round-trip drive home went to `byDay[len - 1]`, and an expense's `dayIndex` was clamped to the last day — so on a sparse trip, indexes 0,2,3 after a deleted middle day, a day could show a stranger's total). Fixing exactly that was not enough for the issue's own acceptance test *"an unsorted `trip.days` array follows `day.index`"*: the same index-vs-position mistake lived in `originOf`'s `dayEndPosition` (`trip.days[dayIndex]`, so a sparse trip's later days woke up at their own start and measured zero legs), in `firstFixedPoint`/`lastActiveStopPoint` ("home" and the return turnaround read from the array's first/last slot, so shuffling the array moved the whole route), and in two `day.index === trip.days.length - 1` return-shape checks (a count is not the last index). When a day-keyed bug lands, grep `trip.days[` **and** `days.length - 1` across `src/lib` before calling it fixed. The readers clamp too: the Timeline's chip, `printModel` and the engine's own lookups each had their own positional `Math.min(index, len - 1)` — a lookup that finds no bucket must render NOTHING, never another day's number. Two smaller lessons from the same wave: the page handlers that carry this class of bug can still be regression-tested in the node suite — `react-dom/server` renders a pure component (`tests/timefmt.test.ts`, `tests/form-error-summary.test.ts` are the precedent, used here for `DaySpark`'s NaN coordinates) and a narrow source assertion binds a handler to the helper it must call (`tests/decision-resolve.test.ts` is the precedent); and a guard keyed on a row's `status` must treat a MISSING status as open (`if (sg.status && sg.status !== 'open')`), because a hydrated row that predates the field would otherwise become un-actionable — the `fire-and-forget` fixture has no status and caught exactly that.

- **A new CSS block may not claim an existing bare class name — later in the file wins on equal specificity, and the whole gate stays green while it does it (learned 2026-09-21).** I-20's unlock sheet shipped as `.reveal`, which is the Landing page's scroll-reveal utility (`body.reveal-armed .reveal` — nine elements: the section `h2`, three feature cards, four steps, all armed by one IntersectionObserver). The new block sits further down the stylesheet, so it won: those elements were re-laid-out as a flex column wearing the sheet's padding, and `.reveal > *` handed each of their children the sheet's stagger animation. **Nothing in the gate can see this** — `tsc` does not read CSS, the node tests have no DOM, and the contrast/spacing ratchets key on declarations rather than ownership — so it survived a fully green `npm run verify` (1613 passed, build clean). What caught it was rendering a page and asking the DOM a question: `document.querySelector('.reveal')` came back **truthy on a Landing render**. The recipe, cheap enough to run for every class a new block defines: `git show origin/test:src/styles.css | grep -c "\.<name>[ ,{:]"` — 15 of that block's 16 names cleared at zero and the sixteenth was the collision. Prefer a prefix you cannot collide with over a good short name (`.unlock-reveal*`, not `.reveal*`). It is now pinned by `tests/design-system.test.ts` → *"a class name has one owner"*, which fails on a bare `.reveal` selector naming the reason, and the pin was teeth-tested by appending `.reveal { outline: 0; }` and watching it fail before reverting. Same collision class as the two idea-banks' `I-19` and `I-20` (AGENTS §6): when a name is shared across the project, check the *namespace*, not just the name.

## 5. External services

Supabase (auth/data) · Vercel (auto-deploy from `main`) · Google Places
(opt-in key, quota-guarded) · OSRM ·
Open-Meteo · Mappls · **OpenFreeMap** (basemap tiles — keyless, no request
limits, commercial-OK; its TileJSON carries the required attribution, see §4). Live probe for
Google: `scripts/verify-google-places.mjs`.
**Provider directive (Sep 2026, PR #73; amended 2026-09-15 for #189): with a
Google key configured, the POI pipeline is Google-ONLY** — food, fuel,
lodging, sights and the along-route scan all come from Google; Google failure,
quota exhaustion or empty scans render an honest "no match"/quota note, they do
NOT silently fall back. The free stack (Overpass/Wikipedia/Mappls) serves
keyless mode, with ONE narrow exception: the **night-halt town anchor** also
asks OSM `place=city|town` even in Google mode, because Google's `locality`
type bottoms out at village level in rural India while OSM carries real towns
with populations — a halt needs a bed, and `preferTownGrade` drops the
hamlet-grade entries when towns are available (live-verified: hamlets like
"Gauriyapur" vs Chunar 37k / Mirzapur 234k / Hazaribagh). That exception is
scoped to the town anchor alone; never extend it to POIs or the corridor scan.
Round-trip routes (origin ≈ destination) get a Google point-search supplement
instead of the along-route scan. Geocoding (search box) still degrades
Google → free; don't reintroduce a silent fallback into the suggestion path,
and update surfaces that claim it never degrades (this section, README,
ARCHITECTURE).

Applying `supabase/schema.sql` DDL: the Dashboard SQL editor can run inside a
**read-only transaction** — DDL like `ALTER PUBLICATION` then fails with
`cannot execute … in a read-only transaction` (typical causes: the disk-full
read-only flip on the free tier, or a replica-routed session). Manage realtime
publications via **Dashboard → Database → Publications** instead (the UI
mutates through the management plane, not your SQL session), and verify live
membership with a plain SELECT (always allowed):
`select * from pg_publication_tables where pubname = 'supabase_realtime';`
No-SQL alternative: subscribe a `postgres_changes` channel per table with the
public anon key — Realtime rejects non-published tables at SUBSCRIBE time, so
a `SUBSCRIBED` status is functional proof of membership (verified all 8 tables
PASS this way after the #18 `profiles` toggle).

**Pruning junk Supabase data — probe before you prune, and prune by owner, not
by orphan check** (Sep 2026): the reported "802 orphan rows" turned out to be
~2,100 *valid* cross-account rows from demo-seed replays, not orphans.
- An orphan probe (`child.trip_id NOT IN (SELECT id FROM trips)`) validates ONE
  link only. If the cascade broke higher up (auth user → profile → trip), child
  rows look "valid" while the whole subtree is junk. Probe each level: profiles
  without auth users, trips without owner profiles, then children without trips.
- **Membership counts ≠ trip-owner counts.** `trip_members` grouped by user
  showed only 3 accounts (~412 rows) while `trips` held 2,113 — seed replays
  wrote trips whose member inserts silently failed. The authoritative junk map
  is `SELECT owner_id, COUNT(*) … FROM trips` joined to `profiles.email`, not
  the membership table.
- **The prune is one statement.** All six child tables carry `ON DELETE CASCADE`
  on `trip_id → trips(id)` (schema.sql), so `DELETE FROM public.trips WHERE
  owner_id <> '<keep-uuid>'` in the SQL editor (management plane, bypasses RLS)
  sweeps everything. Capture per-table counts before/after in the same session
  and paste them into the CHANGELOG entry.
- **Accumulation signature:** trips-owned far exceeding memberships + a fresh
  trip UUID per replay = the demo seed re-ran on every load because silent
  write-through failures kept the hydrated trip count at zero. The
  scoped-hydration + write-through fixes close the loop; if bloat reappears,
  look for a new path that re-seeds non-idempotently.

## 6. Documentation protocol

- **`ROADMAP.md` is the single plan of record** (milestone/release structure:
  stabilization + strategic tracks, and the `## Idea bank` — every unbuilt idea,
  tiered by readiness). New plans/phases merge into
  it — don't open competing plan files. Executed plans get archived to
  `docs/history/` with a `⚠️ HISTORICAL` banner and their status line flipped
  (a plan saying "in execution" while every milestone is ✅ cost a re-read to
  distrust, Sep 2026).
- **Update progress lines in the same edit as tracker ticks.** The UI-audit
  table read 32/32 ✅ while the "Progress" line said 16/32 for two releases —
  any counter derived from ticked rows must be recomputed in the commit that
  ticks them.
- **Deferrals must land in the ROADMAP's `## Idea bank` the same commit
  they're deferred** — Tier 1 if small and unblocked, Tier 2 if it names a
  dependency, Tier 3 as a track row if it's milestone-shaped.
  (ALIGNMENT/plan docs saying "deliberately deferred" is not enough — the item
  disappears otherwise.)
- **A roadmap/idea row is a claim about code, not a fact — verify it against
  `src/` before acting on it.** Consolidating rows (moving text between
  sections) preserves whatever is wrong with them. Sep 2026: the idea bank
  inherited a Sep-6 brainstorm table in which "Safe-to-spend per day" was
  still listed as unbuilt, though `engine.ts` had shipped it — and the README
  had described it correctly the whole time. The two files disagreed and the
  roadmap was the one that was wrong. Budget for a source check whenever you
  touch, quote, or pick up a row.
- **Keep-a-Changelog with a lead sentence.** CHANGELOG entries: first bold
  sentence = user-visible outcome; detail after; deep technical dives belong
  in `docs/` or the commit body, not a 300-word bullet. Categories stay
  Added/Changed/Fixed/Removed per release.
- **Version headings use a hyphen separator: `## [X.Y.Z] - YYYY-MM-DD`.** Not an
  em-dash. Keep a Changelog specifies `-`, and the em-dash variant had drifted
  into all nine headings before being normalised (Sep 2026). The one
  deliberate exception is `[0.7.0-native]`, whose trailing parenthetical is the
  author's own annotation for the native release (`a2fc4fa`) — leave it alone.
  A release banner states its scope **once**: if the entry has a `### Fixed`
  list, the banner summarises and does not restate every bullet (the `[0.42.0]`
  banner shipped stating its content three times and claiming a C5 that never
  existed — see `docs/history/README.md`).
- **README release highlights are newest-first, and its evergreen lines rot
  faster than any other doc's (learned 2026-09-24).** A release's "in plain
  words" section inserts at the TOP of the highlights block (under the pointer
  line) — v0.66's once sat between v0.60–61 and v0.55 while v0.62–v0.65 had no
  section at all, and the tail below ran in no discernible order. The evergreen
  claims rot just as fast: "six everyday modes" survived the move to eight, the
  AI-companion bullet outlived its production flag, and "❌ Payments — no
  gateway integration" outlived the Razorpay rail by four releases. When
  touching evergreen lines (mode counts, flag-gated features, the MVP
  constraint list, the structure block), re-derive them from the code — and
  remember README is in `tests/doc-drift.test.ts`'s LIVE list with zero
  registered claims, so new prose must avoid the gate's absence-cue phrasings.
  Screenshots in `docs/screenshots/` need the same freshness check after any
  visual pass — the v0.66 pass landed ten days after the last capture.
- **`docs/README.md` is the doc index** — every new doc gets a row there
  (Diátaxis flavor: tutorials / how-to / reference / explanation — tag the
  row with which it is). Root stays lean: README, AGENTS, CONTRIBUTING,
  CHANGELOG, ROADMAP, DESIGN_TOKENS; everything else lives in `docs/`.

- **iOS Safari never vibrates — only Capacitor native does.** `navigator.vibrate` is unsupported on all iOS browsers (WebKit). Haptics that must work on iPhone require `@capacitor/haptics` inside a Capacitor iOS shell (`Capacitor.isNativePlatform()`). Keep the web vibrate fallback for Android Chrome; never assume a pure-web PWA will taptic on iOS.

- **Every open issue carries exactly one `priority: P0`–`P3` label** (scheme added Sep 2026; the definitions live in the label descriptions, read them with `gh label list` rather than guessing). P0 = data loss/corruption, security, or a broken core flow — fix before shipping. P1 = real correctness or user-visible bug with a workaround — fix this milestone. P2 = low-risk, narrow surface — slot when convenient. P3 = hygiene, cosmetics, or blocked on a product decision. Assign one at creation; re-triage only by re-reading the definitions, never by gut severity. The label is a *routing* signal only — the justification belongs in the issue body. Queue via `gh issue list --state open --label 'priority: P0'`, and re-derive counts from `gh` rather than recalling them (same rule as §2.6).
- **A recovery path that reports success must verify the thing it recovered — and a surface that can fail must not render failure as emptiness.** Two payment-rail bugs from one live incident (Sep 2026): (1) checkout's self-heal toasted "already unlocked" without checking its `claim_paid_order` result — a failed grant would strand the buyer AND let the next click mint a fresh order for money already taken (double charge). Recovery branches must treat "I ran the write" as nothing; only the write's observable result counts, and a failed recovery is a 503 that says what will NOT happen ("no second payment will be taken"). Corollary: the orphan-order guard must read the buyer's NEWEST order of ANY status, not `status=eq.pending` — a row stranded 'paid' by a failed grant otherwise vanishes from the guard's view. (2) `fetchCreatorSales` degraded a failed read to `[]`, so the Earnings tab rendered "No sales yet" over a broken read — an empty-state UI and a broken-state UI must be different renderings (error + retry), or every future read failure hides behind friendly copy. The empty-vs-error distinction cost a whole debugging session to discover.
- **Diagnose a payment/money mismatch from the DATABASE first, not the code.** The ₹500-vs-empty-ledger incident resolved in one probe once the tables were read: the "missing" sale belonged to a DIFFERENT creator than the account being checked, and the stranded order was visible as `status=pending` + no entitlement row. `select * from purchase_orders; select * from entitlements;` answers "did the money land, did the grant land, whose ledger should show it" before any code reading. Multiple test accounts amplify this: buyer ≠ creator ≠ the account you're logged in as.

- **Postgres has no `create policy if not exists`, so a policy-creating migration is not re-runnable without a `drop policy if exists` guard — and a half-applied SQL-editor run is exactly the case that matters (learned 2026-09-21).** `20260921_user_dna.sql` created six policies bare, and its own PR described the file as "safe to re-run" before that was true: a second run, or the remainder of a run that failed midway, dies on the first policy it reaches and leaves a table half-secured. The pattern was already one migration over — `20260919_covers_bucket.sql` wraps every `create policy` in `drop policy if exists "x" on t` — so match the NEWEST policy migration rather than writing the statement from memory. `create table if not exists` and `alter table … enable row level security` are idempotent; the policies are the part that is not. Then verify the claim against the statements and write it after, not before: nothing in the gate can see it, because green tsc/vitest/build says nothing about SQL that has never run.
- **A migrate-time constraint change must match how the constraint was CREATED.** The rail migration's `unique (user_id, pub_id)` is a CONSTRAINT; `drop index if exists entitlements_user_pub_unique` on it fails live ("other objects depend on it") — dropping a constraint-backed index via `drop index` errors, it does not fall through to `if exists`. Check the creating migration's exact DDL form (constraint vs index, named vs auto-named) before writing the swap. Also: a partial unique index breaks `on conflict (user_id, pub_id)` inference (conflict_target must carry the predicate) — and the swap is usually unnecessary anyway, because NULLs are distinct in a full unique constraint, which is exactly what the nullable-column migration wanted.
- **Vitest 4's default include sweeps EVERY untracked tool worktree** — its glob is `**/*.{test,spec}.*` minus node_modules/.git, so a stale full repo copy inside `.cache/`, `.agents/` etc. (git-ignored, invisible to git status) ran months-old tests and failed the verify gate while the repo tree was green (2549 tests instead of ~1290 was the tell). Pin `test.include` to the repo's real test trees (`tests/**`, `scripts/**`) in vite.config.ts — structurally immune to ANY future debris dir, not just the one that bit.
- **A SQL RPC iterating JSONB must fail closed on every shape it doesn't expect.** The paywall RPC stubs locked days with `jsonb_array_length` loops; a corrupt row (days not an array, day.index missing, stops not an array) would either 500 the whole public page or — worse — skip stubbing and leak the content. Each iteration guards its type; unknown shape ⇒ treated as LOCKED (empty array), never skipped. Paywall code is adversarial-input code: fail closed, never fail open.
- **A policy's RESTRICTIVE flag is load-bearing — drop it and a "hide" becomes a widen.** PostgreSQL permissive policies OR-combine, so the trip-trash policy's bare `deleted_at is null` OR-clause on a *permissive* `trips read hide trashed` let EVERY authenticated user read EVERY live trip (Sep 14–18 2026, live) — the Sep-14 repair that caused it had dropped the policy's `as restrictive` flag. Catalog-level checks stayed green the whole time: the escape-hatch tokens (`owner_id`/`auth.uid()`/`is_editor`) all lived in the same qual, and token presence is not semantics. A restrictive policy is also evaluated against an UPDATE's added row, so it must carry an accepter for the new row (owner/editor/admin) — without one the tombstone UPDATE fails 42501 and "Delete" silently no-ops, which is why those clauses exist. The shape is pinned mechanically in `supabase/tests/rls_contract.test.sql` (a `deleted_at is null` branch may only sit on a RESTRICTIVE trips SELECT; hide-trashed must be RESTRICTIVE with a live-row branch *and* an added-row accepter). When touching RLS, assert the policy KIND (`pg_policies.permissive`) and run the opt-in harness — never read token presence as behavior.
- **A SQL function that ships in an unapplied migration is unexercised code — its first live call will find the type errors.** `get_public_trip` went live with a bare string literal passed to polymorphic `to_jsonb` (`42804: could not determine polymorphic type because input has type unknown` — a `::text` cast fixes it) and an early return that answered an empty set where the trip should come back, so every public itinerary page failed for anonymous visitors while tsc, vitest and the catalog contract suite stayed green — none of them execute SQL. Cast literals fed to polymorphic functions, exercise every new RPC through its real client path before calling a migration done (an anon curl is the cheapest test), and keep a paywall probe in the integration harness: a priced publication must come back with locked days stubbed, an unpriced one whole. (First live call of that RPC, Sep 18 2026.)
- **`revoke … from public` does not revoke from `anon` on Supabase — name the roles.** `get_creator_sales` was intended for signed-in callers but stayed callable by anonymous requests (which got an empty list), because Supabase's default privileges grant EXECUTE to `anon`/`authenticated` directly; only `revoke all … from public, anon` removes it (proved by the control: `revoke_refunded_entitlement`, revoked from `public, anon, authenticated`, answers 42501). When a definer function is meant for one role, revoke the others by name.
- **A popup inside a host that paints its own stacking context cannot be raised from the popup side — and the trap is invisible in a screenshot.** The Explore filter bar is `.glass-soft` (`backdrop-filter` creates a stacking context), so the `Select` menu opened inside it was bounded by the BAR's rung: the featured card and the grid cards below are positioned, so they painted over the menu's last two rows and clicks landed on the card. Reading the popup's own `z-index` said 5 — fine — while `document.elementFromPoint()` at each option's centre resolved to `.featured-body`; the hit test is the only honest oracle (the Create-Trip calendar's lesson, now with its mechanism). A screenshot cannot reveal it: the covered rows are simply painted over, so the menu merely looks shorter. Fix on the HOST (`.explore-filterbar { position: relative; z-index: var(--z-frost) }`) — raising the popup's rung changes nothing, it is scoped inside its ancestor's context.
- **The design-system baseline is keyed by `styles.css` LINE NUMBER, so any insertion above an entry silently invalidates it.** Twelve added lines failed `contrastLight` and `rawDurations` with "new violation(s)" and "no longer reproduce" at the same time — the same rules, remapped. Re-baseline deliberately (`UPDATE_DESIGN_SYSTEM_BASELINE=1 npx vitest run tests/design-system.test.ts`), then prove the diff is line numbers only (strip `styles.css:\d+` from both sides and compare the entry sets) before committing it: re-baselining to clear a ratchet failure is how a real new violation gets laundered.
- **Appending new CSS to the END of `styles.css` keeps the line-keyed design-system baseline valid — inserting above an existing rule does not (learned 2026-09-21).** The entry above is the reason: each finding is keyed by line number, so a rule added at the bottom moves nothing, while one added mid-file remaps every entry beneath it and reports unchanged violations as if they were new. Prefer appending under a new section comment (the file already groups by feature, so this matches its shape), and when a mid-file insertion is genuinely needed, run the re-baseline procedure above instead of reading the failure as noise. Verified the good direction: the funnel's eight new rules went in at the bottom and `tests/design-system.test.ts` passed 52/52 with no re-baseline.
- **Before drawing a funnel from counters, check that the counters count the same KIND of thing — and that no stage is forbidden from exceeding the one before it (learned 2026-09-21).** `published_itineraries.views` and `.copies` looked like two stages of one funnel and were not: a view is deduped to one per browser session and skips the creator's own visits (`registerPubView`), while a fork was a raw event count with neither exclusion — so any rate derived from the pair was a ratio of unlike things, and one of the two stages also counted the creator converting themself. Two further facts decide whether a funnel is drawable at all: a counter has **no time dimension**, so no window can be computed from it or recovered later (the events have to be recorded); and the stages can legitimately **invert** — forks outnumbered visits here, because Explore's card carries its own Fork CTA while a visit is counted once per session on the plan's own page. So **clamping a conversion at 100% to keep the funnel monotone hides a real product fact**: compute the rate straight and name the case in the UI. And **record only the stages that do not already exist as dated rows** — `entitlements` already dates every sale, so an "unlock" event would have been a second source of truth for the same money (the log added holds views and forks only, written by the same function that moves the counter so the two cannot drift).
- **`register_preview(…, replace: true)` stops the dev server that is currently registered — start the replacement first.** Swapping this thread's preview mid-session killed the 5173 Vite server (http 000, no listener). Start the new server on a free port, then call replace with the NEW pid. Companion: a preview page left holding a hidden, full-size `iframe` that never finishes loading reports "the page main thread is busy" for every later evaluate while the pane renders blank — re-register to recover; waiting does not.
- **A "nothing is broken" UI sweep is only worth its silence if the probe fires on known-bad input — and each rule must measure the right box.** Three traps cost a full re-run each during the whole-app crop/padding sweep (Sep 2026): (1) `Range.getClientRects()` returns LINE boxes, so a centred hint line flags a corner it never touches — measure the first and last WORD (set the range to those text offsets) instead; (2) `scrollWidth` is inflated by pseudo-elements and transformed decorations (`.trip-head-card::after` is a blob at `right:-60px`, `.btn`'s sheen, the trip ticket's SVG ellipse), so a hit must name its overflowing descendant before it is called a crop; (3) the corner test needs a corner-SQUARE precondition — a box that merely starts far from the corner is outside the disc but nowhere near the cut region — and must skip children that bleed to both side edges (a card-wide hit area, a cover), whose corners are the box's by design. With those fixed, 41 route×width measurements across the public and signed-in surfaces returned zero real crops and zero unpadded rows; the probe (in the scratch dir, never committed) was first proved to fire on three synthetic fixtures — one unpadded footer, one corner-cut control, one correctly padded control.
