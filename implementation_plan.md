# Implementation Plan — v0.23.0 release + "Calm Travel Intelligence" redesign

**Status:** Approved — in execution
**Scope:** Two sequential workstreams — (A) cut the pending `[Unreleased]` work as a proper **v0.23.0** release on `main` per repo protocol, then (B) a **redesign branch** implementing `docs/redesign/YATRAFLOW_DESIGN_DIRECTION.md` ("Calm Travel Intelligence") in the doc's own milestone order, with the 10 SVG mockups as visual reference.
**Branch strategy:** Release lands on `main` first; redesign happens on `redesign/calm-travel-intelligence` branched from that release; merges back only with user confirmation.

---

## Overview

**Workstream A — release v0.23.0.** Everything in `[Unreleased]` is a coherent body of work: UI-audit remediation batches 1–6 (32/32 findings, both P0s), the production QA checklist, the audit report docs entry, and the publish-persistence fix. Per AGENTS.md §2 rule 2, feature-worthy releases bump `package.json` + lockfile and update README. This is feature-worthy (skip link, real-link nav, URL-addressable tabs/filters, new Board-capable URL routing) → minor bump **0.22.0 → 0.23.0**.

**Workstream B — redesign.** The direction doc mandates an additive, incremental rollout (§8): evolve the existing token system, don't rewrite. Seven milestones on the branch: tokens → landing/nav → Overview Bento → Timeline polish → Board (new view) → Map/Suggestions/Budget/Decisions/Share → Explore/Public Itinerary. Each milestone ends with the full verify gate + a commit + changelog entry on the branch.

**Key assumption:** the design doc is light-first and doesn't mention dark mode. The app has a real `[data-theme='dark']` theme. **Dark mode is preserved** — every new token gets a dark variant, and each milestone is QA'd in both themes.

---

## [Types]

- `TabKey` in `src/pages/TripWorkspace.tsx`: extend the union with `'board'` (M5). `TABS` array gains the Board entry — `sanitizeTab()` validates against `TABS`, so Board tabs become URL-addressable (`#/trip/<id>/board`) with zero extra routing code.
- `StopKind = 'drive' | 'stay' | 'food' | 'fuel' | 'rest' | 'activity' | 'viewpoint'` (M4 marker mapping from existing `HaltPurpose`/stop category — pure display mapping, no data-model change).
- No changes to `Trip`, store, or Supabase schema — the redesign is presentation-layer only.

## [Files]

**Workstream A (release, on `main`):**

| File | Change |
|---|---|
| `CHANGELOG.md` | Rename `## [Unreleased]` → `## [0.23.0] — 2026-09-01` (repo convention: no empty Unreleased section is kept). Content already complete: 7 Fixed entries (batches 1–6 + publish fix), Verification subsection, Docs subsection. |
| `package.json` + `package-lock.json` | `"version": "0.23.0"` via `npm version 0.23.0 --no-git-tag-version`. |
| `README.md` | Features section: a11y/UX bullets (skip link + keyboard navigation, `prefers-reduced-motion` honoured globally, workspace tabs & Explore filters/sort URL-addressable, focus-visible on every control). |
| `ROADMAP.md` | Snapshot line → v0.23.0 status. |
| `docs/redesign/*` (untracked) | Committed as its own docs commit **before** branching so mockups are tracked. |

**Workstream B (redesign branch):**

| File | Milestones | Change |
|---|---|---|
| `src/styles.css` | M1–M7 | Add the doc's §4.1 `--yf-*` primitive palette into the existing token layer (evolve, don't replace); §4.2 atmospheric background gradient as a reusable class; large-radius/diffuse-shadow surface tokens; dark-theme block mirrors every new token; per-screen re-skins land here in M2–M7. Single `@media (max-width: 720px)` block stays the only mobile CSS. |
| `DESIGN_TOKENS.md` (root) | M1 | Sync with the new `--yf-*` scale and atmospheric surfaces. |
| `index.html` | M1 | `theme-color` metas updated if brand surfaces shift tone. |
| `src/App.tsx` | M2 | Translucent glass topnav (level-2 overlay); Escape/aria behaviour untouched. |
| `src/pages/Landing.tsx` | M2 | Hero rebuild per homepage mockup: outcome headline, teal + saffron CTAs, product-preview card (route, est. per-person, driving time, trip health, day strip, warning line, live group signal), outcome-framed feature cards. |
| `src/pages/TripWorkspace.tsx` | M3–M5 | Overview tab → Bento briefing (health card w/ diagnosis, cost cards, travel-effort card, priority-actions, route snapshot, group-pulse strip); Timeline polish (sticky summary strip, day-jump rail, compact expandable day headers, stop-kind markers, in-day warnings, "Open in Board" bridge); new Board tab (`TabKey 'board'`): kanban day columns over pinned map, cross-day moves through existing impact preview, focused-day rail for long trips, Trip Pulse panel. |
| `src/components/TripMap.tsx` (+ `mapcn/`) | M5–M6 | Board's pinned-map background reuses the existing map component (no second map system); overlay panels get level-2 translucent treatment; structural-cast pattern preserved; attribution untouched. |
| `src/pages/Explore.tsx`, `src/pages/PublicItinerary.tsx` | M7 | Dark-teal editorial hero + style chips + featured-itinerary treatment + "Fork this trip" CTA (fork = existing `duplicateTrip`); public page editorial hero, creator attribution, stat cluster, "Why this route works". |
| Share section (`TripWorkspace.tsx`) | M6 | Reorganize into four intents (plan together / read-only view / publish / snapshot export) with plain-language permission copy. |
| `src/components/ui.tsx`, `ImpactPreview.tsx`, etc. | M1–M6 | Token-driven component restyling; z-index ladder untouched (toast 200 > modal 100 > impact 90 > notif 80 > expanded map 70). |
| `CHANGELOG.md`, `ROADMAP.md`, `README.md` | per milestone | Entries under `[Unreleased]` on the branch; snapshot updated at merge time. |

## [Functions]

**New (representative):**
- `BoardView` component (`TripWorkspace.tsx` or extracted `src/components/BoardView.tsx`) — kanban columns, day focus, drop zones.
- `TripPulse`/`GroupPulse` card, `PriorityActions` card, `BentoCard` wrapper (Overview).
- `DayJumpRail` (Timeline) — respects `--nav-h` / `scroll-padding-top` offsets.
- `stopKindOf(stop): StopKind` — pure mapping (M4).

**Modified:** `Landing` hero (M2), `TripWorkspace` overview/day headers (M3–M4), `ExplorePage` (M7), `PublicItinerary` hero (M7), topnav (M2). Engine/store/providers untouched — no regression surface for the publish fix or route logic.

**Removed:** none.

## [Classes]

None — function modules + React function components, unchanged.

## [Dependencies]

**None added.** Current system font stack stays (no webfont cost). A specific typeface (Inter/Manrope) would be a deliberate M1 decision on request.

## [Testing]

- **Gate per milestone:** `npm run verify` (clean `tsc -b --clean` → 212 tests → `vite build`). CSS breakage is invisible to tsc/tests — full build is the tripwire; any minify warning is a blocker.
- **Unit tests:** only if pure logic lands (`stopKindOf`). All new params optional; 212 existing tests stay green.
- **Manual QA per milestone (both themes):** keyboard-only + visible focus over translucent surfaces, SR labels preserved, mobile 720px (≥40px targets, 16px inputs), reduced-motion, design-quality checklist (doc §9), z-index audit for new overlays (Board), `git diff --check` on docs.

## [Implementation Order]

**Workstream A — release (on `main`)**
1. Rename `[Unreleased]` → `[0.23.0] — 2026-09-01` in CHANGELOG.
2. `npm version 0.23.0 --no-git-tag-version`.
3. README feature bullets + ROADMAP snapshot.
4. `npm run verify` → commit `chore(release): v0.23.0 — UI audit remediation (batches 1–6) + publish persistence fix`.
5. Commit `docs/redesign/` assets.
6. Ask push confirmation → push `main` + ff `test`.

**Workstream B — redesign (branch off step 5)**
7. M0: save this plan doc; branch `redesign/calm-travel-intelligence`.
8. ✅ M1 tokens: `--yf-*` palette + atmospheric gradient + surface/shadow tokens (light+dark), `DESIGN_TOKENS.md` sync. → `d7b86d5`
9. ✅ M2: Landing hero + glass topnav. → `d9db55b`; deepened structurally per mockups (split hero + dark adventure card, navy trip header band) in `7c5cef8`; nav became a floating glass pill + cream control tray in M2.1 → `d72298d`
10. ✅ M3: Overview Bento briefing. → `aaff1b6`, structural deep-pass in `7c5cef8`
11. ✅ M4: Timeline polish. → `0960d44` (sticky trip-total strip, day-jump rail, day cards + in-day warnings, `stopKindOf` stop-type markers)
12. ✅ M5: Board view (z-index + DnD audit). New **Board** tab between Timeline and Map; reuses TripMap as pinned background via a new additive `focusDay` prop (day-level route focus on column select); floating near-opaque day columns; cross-day DnD on both HTML5 + touch paths; every drop → impact preview; Trip Pulse panel; long trips scroll horizontally; Timeline gains the "Open in Board →" bridge. (BoardView lazy chunk; map chunk shared with Map tab.)
13. ✅ M6: Map / Suggestions / Budget / Decisions / Share hierarchy pass.
13b. ✅ Post-M5 board polish + motion/glass passes (user review against the board mockup): mockup card anatomy
    (kind-tinted faces, kicker/title/meta), mist map wash, 1680px canvas + compact band, equal glass corner panels,
    content-fitted columns (no internal scrollbars), app-wide subtle motion system + deeper glass, DnD pulse, static nav.
    → `c6ca8c9`/`3d28d3b`/`4c29a95`/`9c5ffcf`/`308800a`/`98976a8`/`9ac5058`
14. ✅ M7: Explore + Public Itinerary editorial treatment (editorial heroes, style chips, featured card, paper sheet + route glance + highlights, Fork/Save).
15. Each of 8–14: verify → commit → changelog entry. Merge to `main` + `0.24.0` cut only with user confirmation.

## Risks & guardrails

- **Dark mode** is the biggest regression surface — every milestone ships both themes or it isn't done.
- Mockups are directional SVGs, not pixel specs; where they conflict with a11y contrast or the z-index ladder, **a11y wins** (doc §7.3 mandates this).
- Board adds a second drag surface: both HTML5 DnD and `touchDnd` paths mandatory (AGENTS §4).
- CSS-only milestones get the full vite build check; chunk-size warning is the only acceptable output noise.

