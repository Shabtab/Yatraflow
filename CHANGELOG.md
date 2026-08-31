# Changelog

All notable changes to YatraFlow. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 MVP milestones.

## [Unreleased]

### Fixed
- **Suggestions persist across tab switches — no more phantom re-searches.** Timeline halt suggestions lived in TravelPanel's local state, so switching to the Map tab (and back) discarded them and forced a fresh corridor search; they were also wiped by a `[day]` reset effect on *every* trip edit (including keeping an unrelated change in the impact sheet). They now hydrate from a per-day slot in the trip-scoped suggestion cache (`useSuggestionCache`) and only 📍 Suggest halt spots / ↻ Refresh re-runs the search. The Map tab's ↻ Refresh button was outright broken — it cleared the cache and the list without triggering a refetch, permanently blanking suggestions; it now bumps a refresh tick that actually re-runs the search. Map suggestions also no longer auto-refetch when OSRM resolves after mount (`planKm`/`wholeTrip.min` effect deps) or when the trip's route drifts — cached results always render until the user refreshes. Detour-scope changes still re-search immediately (explicit control), and the cache record now stores `scopeKm` to distinguish that case.
- **Adding a halt no longer wipes the remaining timeline suggestions** — the added row flips to a disabled "✓ Added" state (title-matched against the day's stops, same pattern as the map's `existingNames`) and the rest stay listed for further adds.

## [0.21.0] — 2026-08-31

### Added
- **Vehicle profile for accurate fuel/charging range** — `Trip` now carries an optional `vehicleProfile` (`vehicleType`, `fuelType`, `capacity`, `economy`). The engine derives fuel-stop cadence from `capacity × economy × 0.85` (15 % reserve buffer) instead of the hard-coded `FUEL_INTERVAL_KM = 450`. EVs get charging-station queries; CNG gets CNG-pump queries; petrol/diesel stay on regular fuel stations. New pure modules: `src/lib/vehicleProfile.ts` (defaults for car/motorcycle/EV, range math, capacity formatting) + `tests/vehicleProfile.test.ts` (11 tests); `src/lib/purposeQueries.ts` (maps each `HaltPurpose` to highway-biased Google/Overpass queries) + `tests/purposeQueries.test.ts` (8 tests).
- **Purpose-specific search queries** — `planJourneyHalts` now plans segments first, extracts the distinct `HaltPurpose`s needed, and searches with purpose-tuned queries (e.g. `"highway dhabas"` for meal, `"petrol pumps"` for fuel, `"EV charging stations"` for electric). Wired through `geocode.ts` → `googleNearbyAlongRoute` / `searchNearbyPoisMultiFree` with new optional `purposes` params; backward-compatible (omitting it yields the old generic tourist queries).
- **Highway-aware route geometry sampling** — new `routeGeometryToAnchors` in `src/lib/routing.ts` samples an OSRM road geometry into anchor points at ~25 km spacing for search bias.
- **Trip-scoped suggestion cache** — new `src/hooks/useSuggestionCache.ts` persists Map-tab suggestion results in `localStorage` keyed by `tripId`. Cache invalidation is automatic via `anchorHash` (stable lat/lng string): adding, removing, or reordering stops changes the anchors → cache miss → fresh fetch. The Map tab now reads from cache before fetching and renders a **↻ Refresh** button to force a re-scan.
- **Fixed-position impact confirmation sheet** — `ImpactPreviewPanel` is now a `position: fixed` bottom sheet (`z-index: 90`, max-width 720 px, safe-area padding) so it stays visible when the user edits a day deep in the Timeline. On "Keep change", it auto-scrolls the viewport to the impacted day's card if the card is off-screen.
- **Vehicle profile form in Trip settings** — the Share tab's "Trip settings" card now shows vehicle-type, fuel-type, capacity and economy fields when the transport mode is car/motorcycle/EV. Values are optional and fall back to sensible defaults (car: 45 L / 15 km/L; motorcycle: 12 L / 40 km/L; EV: 50 kWh / 6 km/kWh).

### Changed
- `src/data/types.ts` — added `FuelType`, `VehicleProfile`, and optional `trip.vehicleProfile`.
- `src/lib/providers/hits.ts` — added `anchorHash()` helper and `purposes?: HaltPurpose[]` + `vehicleProfile?: VehicleProfile` to `NearbyOpts`.
- `src/lib/ridePlan.ts` — `planRideSegments` already accepted `vehicleRangeKm`; now `planJourneyHalts` resolves it from `vehicleProfile` when present.
- `src/lib/geocode.ts` — `planJourneyHalts` now computes segments before searching, passes `purposes` and `vehicleProfile` through to the provider layer.
- `src/lib/providers/google.ts` — `googleNearbyAlongRoute` accepts optional `purposes`; builds dynamic query list from `queriesForPurpose` instead of static `ALONG_ROUTE_QUERIES` when set.
- `src/lib/providers/free.ts` — `searchNearbyOverpass` accepts optional `selectors` override; `searchNearbyPoisMultiFree` accepts optional `purposes` and merges per-purpose Overpass selectors.

### Fixed
- **#30 — Nearby-ideas "off route" distance was misleadingly always ~0 km for Google results** — Search-Along-Route POIs hug the polyline, so when the OSRM `routeTotalKm` (needed to derive the real road detour from `routingSummaries`) was missing, the display fell back to a straight-line-to-anchor estimate that read as "0 km" for *every* card. `detourKm` now returns `null` for Google along-route hits whose real detour is unknown (the UI shows **"on route"** instead of a fake number), while free-stack / point-search hits keep the honest straight-line estimate. Off-route distances are now shown to 1 decimal (`~2.3 km off route`) so small real detours are visible. New unit tests cover all three cases. (By Hermes Agent — `aql-hermes`.)

## [0.20.0] — 2026-08-31

### Docs
- **Corrected two unsound deployment checks found while verifying the preview-login fix** — (a) the `http://localhost:54321` fallback string is compiled into *every* bundle (`supabase.ts` uses `import.meta.env.X || 'http://localhost:54321'`), so testing for it proves nothing; only the real `.supabase.co` host / project ref discriminates. (b) *Deployment-specific* URLs (`yatraflow-<8char>-<scope>.vercel.app`) are behind Vercel SSO even when `vercel inspect` reports `target production`, so the bundle-grep recipe must use the canonical alias `yatraflow-blond.vercel.app` — tell the two apart by size (~1.2 KB real `index.html` vs ~340 KB login page). Added the strongest check to `docs/DEPLOYMENT.md`: the alias's bundle hash should equal the one your local `npm run build` produced. Also noted that `vercel ls` lists newest-first, so `Select-Object -Last N` shows the *oldest* deploys and can make a fresh one look absent.
- **Removed the raw `Roadmap` file (superseded by `ROADMAP.md`)** — another agent had committed a verbatim paste of the roadmap *chat reply* (conversation opener/closer included, no filename extension) directly onto `main`; the curated, tracked `ROADMAP.md` carries the same content, so the duplicate is dropped.
- **Added `ROADMAP.md`** — published the forward-looking roadmap as a tracked repo file: P0 basemap licensing (#23), P1 AI/LLM (#22 → #20), P2 UX-polish backlog (boot skeleton, profile fields, route polylines, push notifications), P3 1.0-enablers (offline/PWA, i18n, Supabase integration tests), P4 nice-to-haves, a recommended ~10h execution order, and the repo working-agreement rules. Done items continue to live in this CHANGELOG; ROADMAP.md tracks only what's ahead.
- **Documentation hygiene pass (PR #25)** — fixed stale claims that contradicted shipped code: removed the false "demo-grade hash / browser-local" auth line from README (auth is real Supabase since 0.12.0); removed non-existent `demo@yatraflow.in` login from CONTRIBUTING; moved already-shipped items (Supabase 0.12.0, Google Places 0.17.0, Open-Meteo weather, regional-language field) out of the README roadmap; de-duplicated contributor Setup to link DEPLOYMENT/README. Added `docs/README.md` index, consolidated the env-var reference into DEPLOYMENT.md, linked `DESIGN_TOKENS.md` from README/ARCHITECTURE, marked the Google-Maps report HISTORICAL, and untracked the generated `docs/diagrams/*.html` artifact (gitignored; the diagram's JSON source stays tracked so it remains regenerable). (By Hermes Agent — `aql-hermes`.)
- **README: dropped the self-contradictory "❌ Real authentication backend" bullet from the MVP-constraints list** — the bullet claimed auth was not included while its own text acknowledged auth is real Supabase with server-side password storage since 0.12.0; removing it leaves the "does not include" list consistent with the shipped auth feature (follow-up to PR #25's cleanup).
- **AGENTS.md: Supabase read-only-session pitfall** — the Dashboard SQL editor can reject DDL with `cannot execute ALTER PUBLICATION in a read-only transaction` (typical causes: the disk-full read-only flip on free tier, or a replica-routed session); realtime publications can be toggled via **Dashboard → Database → Publications** instead (the UI mutates through the management plane), and live membership is verified with a plain `SELECT` on `pg_publication_tables` (SELECTs always run). Surfaced while activating the #18 `profiles` publication. Follow-up: verified live membership with a **no-SQL channel-subscribe probe** (public anon key, SUBSCRIBED = in publication) — all 8 tables PASS, so #18 realtime is fully live.

### Added
- **Ride-plan stop suggestions: fatigue-budget & city-anchored for long/interstate drives** — the per-day "Suggest halt spots" (travel panel) and the Map tab's "Nearby ideas" now share a real journey planner (`src/lib/ridePlan.ts`) instead of an even-spaced tourist rank. A pure engine splits any drive into fatigue segments — short break ~ every 150 km (≈2 h), meal ~300 km, fuel on tank range (default 450 km, planned at 85%), overnight ~550 km end-of-day (whole-trip view only) — each with an acceptance window, then assigns the single best real stop per segment by purpose-fit + detour + distance-to-target. Long/cross-day stops anchor on key cities via a free-stack overlay (OSM `place=city|town` + Wikipedia populated places, population-weighted), so an interstate night stop lands in a big city. Every suggestion card and map tooltip now shows what it's for (Lunch / Fuel + stretch / Overnight — end of day), how far it is (~km into the trip, ≈km/min since the last stop), its detour and the nearest city; adding a stop writes the right stop type (food/rest/fuel/hotel) with the purpose in its notes, and the Map tab pre-selects the day whose distance covers it. Google mode gains real along-route km per hit from `routingSummaries` leg0 for exact positions; the free stack maps hits onto corridor anchors (no key needed). New `tests/ridePlan.test.ts` (20 tests) + a Google `alongRouteKm` assertion in the providers suite — `npm run verify` green.
- **#6 — Routing: India-tuned leg distances via Google Routes API (OSRM fallback)** — `roadLegBetween`/`routePath` now try Google Routes `computeRoutes` first when `VITE_GOOGLE_MAPS_API_KEY` is set (returns India-tuned road distance, drive time AND polyline geometry from one call), then fall back to the free OSRM demo server, then to the haversine estimate — never blocking the app. Matches the existing geocode facade: Google-first, free stack always, and the Phase-B quota guard (new `routes` SKU, 8k/month soft cap) gates every computeRoutes call before it goes out. New `src/lib/providers/routes.ts` (Google polyline decoder + `travelModeFor` mapping + `googleRoute`), `routes` added to the quota guard, and 9 new unit tests in `tests/routing-routes.test.ts`. `RoadLeg.fromOsrm` is now `RoadLeg.source` (`'google' | 'osrm' | 'estimate'`) so the UI badge reflects which provider actually answered.
- **CI gate (closes #21)** — `.github/workflows/ci.yml` runs `npm run verify` (`tsc -b --clean` → tests → production build, exactly the AGENTS.md "verify" command) on every PR to `main` and every push to `main`, so a deploy-breaking change like #14 can never reach Vercel unnoticed again. Node 22 pinned (vite 8 needs ^20.19 || ≥22.12; package.json has no `engines`).
- **Realtime collaboration (closes #18)** — the store now subscribes to Supabase `postgres_changes` on one channel covering all `supabase_realtime` tables (trips, trip_members, suggestions, decisions, activity, notifications, profiles, published_itineraries), so collaborators see each other's stops, suggestions, votes, decisions, comments, activity and notifications **live, without reloading**. RLS SELECT policies gate exactly what each user receives (owner/member/public rows). Own writes are echo-suppressed for trips (2s window) so a server echo can't clobber optimistic local state; other tables are idempotent upserts. `connectRealtime`/`disconnectRealtime` are wired to the auth lifecycle in `init()`; the event reducers live in the pure `src/lib/realtimeCore.ts` (`reduceSlice`, `applyMemberChange`, `isRecentLocalWrite` — 10 new unit tests).
- **Timeline: long stop descriptions clamp to 2 lines behind a "Show more"/"Show less" toggle (closes #3)** — new `ClampedText` in `TripWorkspace.tsx` detects overflow with a hidden always-clamped measurement twin (so the toggle stays reliable even while the text is expanded) and renders the toggle only when the text actually overflows; short descriptions render untouched.

### Changed
- **#23 — Basemap licensing swap: CARTO + Esri → OpenFreeMap (closes #23)** — the map now loads keyless [OpenFreeMap](https://openfreemap.org) vector styles (`styles/positron` for light, `styles/dark` for dark) instead of CARTO Basemaps (`dark-matter`/`positron`/`voyager` GL styles on `basemaps.cartocdn.com`, whose free tier is non-commercial-only) and Esri World Imagery (`services.arcgisonline.com`, which requires an ArcGIS Developer plan for production). OpenFreeMap serves OpenMapTiles-schema vector tiles with styles forked from the same open-source lineage as CARTO's, so **the map looks the same** — verified against the live style JSONs: dark background `rgb(12,12,12)`, light `rgb(242,243,240)`, spec v8, sprite + glyphs + 47/55 layers — while being MIT-licensed, commercial-use-allowed, registration-free and with **no request limits** (no key to manage, no bill to cap, no per-browser quota theater). Two gotchas handled: (1) OpenFreeMap's `style.json` carries **no `sources.*.attribution` field**, so MapLibre would render no credit at all — the required "© OpenFreeMap © OpenMapTiles · Data from OpenStreetMap contributors" is now injected via `customAttribution` on the attribution control (`BASEMAP_ATTRIBUTION` in `src/components/mapcn/map.tsx`); (2) the CARTO/Esri URLs in `TripMap.tsx` turned out to be **dead code** — `STYLE_VOYAGER`/`STYLE_DARK`/`STYLE_SAT`/`STYLE_SAT_JSON` were declared and never referenced (`noUnusedLocals: false` let them sit, and the "free satellite toggle" their comment described never existed in the UI), so there was nothing to remove but the constants and their stale comment. README gains a "Data sources, basemaps & attribution" section documenting every provider's terms and why Google map tiles were rejected (Google does not license its basemap rendering to third-party renderers like MapLibre, so the Google look means a Maps JavaScript API rewrite plus a mandatory billing account and per-map-load billing with no hard cap). New `tests/basemap-license.test.ts` (4 tests) is the tripwire: it scans **every** `.ts`/`.tsx` under `src/` for banned tile hosts (so a dead constant can't hide a licensed URL again), pins both theme styles to OpenFreeMap, and asserts the attribution string exists and is wired into `attributionControl` — verified to fail when a `basemaps.cartocdn.com` URL is reintroduced.

### Fixed
- **Map showed the basemap attribution twice, cluttering the map's bottom edge (follow-up to #23)** — the first OpenFreeMap pass assumed the styles "ship without a `sources.*.attribution` field" (true of `style.json`) and therefore injected the credit manually via `attributionControl.customAttribution`. But the style's `openmaptiles` source resolves the TileJSON at `tiles.openfreemap.org/planet`, **which does carry the OSM/OpenMapTiles/OpenFreeMap attribution** — MapLibre fetched it and rendered both copies side by side. Fix: drop the manual injection entirely (`BASEMAP_ATTRIBUTION` removed from `mapcn/map.tsx`); the TileJSON credit — with proper links — is now the single source. Also shrunk the attribution strip (10px, theme-aware translucent background when expanded; compact ⓘ collapse unchanged) so it stays legally required but visually light. `tests/basemap-license.test.ts` inverted into a tripwire that fails if `customAttribution` ever returns; README/ROADMAP/ARCHITECTURE/AGENTS attribution notes corrected.
- **Preview builds could not log in — a missing build-time env is now loud instead of cryptic** — Vercel's `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` were **pinned to git branch `test` inside their Preview scope**, so only previews built from `test` had a backend and every other branch was compiled with none — while the dashboard showed all three environments ticked, which is why this kept being written off as already-configured. The client therefore fell back to its deliberate placeholder origin (`http://localhost:54321`), the app rendered normally, and login died with a bare "Failed to fetch" that reads exactly like a wrong password. The pin only became visible in `vercel env ls`'s `environments (git branch)` column, which showed `Preview (test)` next to `VITE_GOOGLE_MAPS_API_KEY`'s plain `Preview`. Fixed in three layers: (1) `vite.config.ts` now **aborts the build on Vercel** when either variable is absent or still the `YOUR-PROJECT` template, naming the environment (`preview`/`production`) and the remedy — CI and fresh clones get a warning only, since they legitimately build without credentials; (2) new pure `src/lib/authErrors.ts` (`isRealSupabaseUrl` / `describeAuthFailure` / `MISSING_BACKEND_MESSAGE`) lets `store.login`/`signup` short-circuit with the actual cause, and catches Supabase's **thrown** `AuthRetryableFetchError` — previously an unhandled rejection that left the form silently re-enabling after its 10 s failsafe with no message at all; (3) the auth page now shows a persistent "no backend configured" banner before the first attempt. Also `login()` lowercases the email to match `signup()`, so an address typed with capitals at signup can't lock its owner out. 8 new tests in `tests/auth-errors.test.ts`. **Resolved in Vercel:** branch-free `Preview` records added for both variables (and `VITE_MAPPLS_KEY`, which had been Production-only), and the failed preview redeployed green in 25 s — confirmed by grepping production's bundle for the same `hqlqbfpzjmailxyd…` ref the preview now inlines. Editing variables alone would have changed nothing: Vite inlines at build time, so a **Redeploy** is always required.
- **#15 — AI router precedence made explicit** — `q.includes('cheaper') || (q.includes('alternative') && q.includes('cheap'))` now parenthesizes the implicit JS `&&`-binds-tighter-than-`||` grouping; behavior unchanged. Regression tests added in `tests/ai.test.ts`: "suggest an alternative museum" must NOT hit the budget-levers answer; "find a cheaper alternative" must.
- **#17 — optional-column probe no longer caches transient errors as "column missing"** — `tripsHaveOptionalColumns()` previously cached ANY failed `select()` as missing for the whole session, so a momentary network/auth blip silently stopped fuel-economy / pump-price / one-way settings from persisting. The probe now caches only definitive missing-column errors (`PGRST204`/`42703`) and clears itself to re-probe after a transient failure; the classification lives in the new pure `src/lib/tripRow.ts` (`isMissingColumnError`).
- **#16 — expense persistence round-trip audited + covered by tests** — confirmed `tripToRow` always emits `expenses` on both the insert (`persistTrip`) and update (`persistTripField`) paths (no dropped field; the audit's worst case was not present). Extracted `rowToTrip`/`tripToRow` into pure `src/lib/tripRow.ts` and added `tests/tripRow.test.ts` (5 tests: expenses always emitted, rehydration round-trip, optional-column gating, missing-column error classification).
- **Realtime: `profiles` added to the `supabase_realtime` publication (#18 follow-up)** — the store subscribes to profile changes but the table was missing from the publication DDL, so profile events (name/avatar updates) were silently never delivered; one additive line in `supabase/schema.sql`. Publication DDL is not applied by the app — run the added line in the Supabase SQL editor to activate on the live project.
- **`dev.log` untracked + gitignored** — a bulk `git add` in the shared working copy swept the local vite dev log (528 lines, no secrets) into pushed commit `f09aaf9`; removed from the tree and ignored. AGENTS.md updated: stage explicit paths only in this shared working copy.

## [0.19.0] — 2026-08-30

### Changed
- **AGENTS.md: new pitfall rule — section-restructure edits can silently swallow bullets** — an editor replacement whose `old_text` spans a heading, its bullets and the next heading, replaced by just the next heading, deletes the **bullets**, not only the heading; after any heading-level restructure (CHANGELOG releases especially), re-grep all headings and re-read the affected range before trusting it. (The 0.18.0 release-notes restructure briefly lost four Fixed bullets this way — caught and restored in the same session.)
- **Design system: 3-layer design tokens** — primitive → semantic → component layering with hover/active/foreground/focus-ring semantic tokens for light+dark; buttons and focus-visible wired to them; `--text-3` darkened toward WCAG AA. Legacy flat token names kept as aliases so existing references keep working; new `DESIGN_TOKENS.md` documents the button/input state matrix. No behavior change. (Part of #24, implemented by Hermes Agent.)
- **Toolchain: vite `^5.4.11` → `^8.2.2`** — rolldown-based engine, markedly faster production builds. Note: vite 8's lightningcss minifier promotes CSS syntax warnings to hard build errors, which is what surfaced #14. Initially required a `legacy-peer-deps` pin because `@vitejs/plugin-react` 4.x's peer range predates vite 8; resolved later in this release by bumping plugin-react to v6 (pin removed).
- **Toolchain: `@vitejs/plugin-react` `4.7.0` → `^6.0`** — v6 is oxc-based (babel transform dropped: 44 packages lighter, builds ~20% faster) with native vite 8 peer support, so the temporary `.npmrc` `legacy-peer-deps` pin is gone. Side effect: vite's esbuild-option deprecation warnings (`vite:react-babel` / `optimizeDeps.rollupOptions`) no longer appear in test/dev/build output.

### Fixed
- **#14 — `vite build` crashed on styles.css (deploy blocker on the test branch)**: stray `opacity: .75;` + extra `}` sat outside the `.loc-attribution.off` rule (brace balance off by 1). Invisible to tsc and the 128 tests — only the full vite build failed. Rule restored to a single well-formed declaration. Found and fixed by Hermes Agent (`cca6fdd`).
- **#14 (latent on main): the same dangling `opacity: .75;` + stray `}` had shipped on main with the 0.18.0 merge** — vite 5.4 only logged a minify *warning* while silently dropping the declaration; any vite upgrade hard-fails `vite build` on it (exactly what happened on the test branch). Merged into the rule as one well-formed declaration (`9d987a0`).

## [0.18.0] — 2026-08-30

### Added
- **Touch drag & drop for the timeline** (closes #2) — stop cards are now reorderable on phones/tablets: **press and hold a stop (~0.35s, holding still), then drag** to reorder within the day or drag it onto another day (or into a gap between stops), with haptic feedback on lift, edge auto-scroll near the viewport top/bottom, and the same highlight + impact-preview flow as desktop. New `src/lib/touchDnd.ts`: a React-free pointer-event engine (long-press activation, movement-cancel so normal scrolling still works, `elementFromPoint` drop targeting via `data-yf-drop`/`data-yf-gap` attributes, non-passive `touchmove` scroll-lock only while dragging, post-drag click suppression, context-menu suppression) integrated into the shared `useReorder` hook — desktop HTML5 drag is untouched, and presses on buttons/links/inputs are never hijacked. 11 new unit tests (151 total).
- **AGENTS.md hardening from the PR-audit session** — two new hard-won rules: never fetch with a wildcard refspec (`git fetch origin '+refs/*:…'` silently deletes `origin/main`, `origin/test` and PR-tracking refs — use plain `git fetch origin [--prune]`, `gh pr checkout <n>`, or `git fetch origin pull/<n>/head`), and never run dependent git checks as parallel shell calls (a ref rewrite raced a `merge-base --is-ancestor` check and produced contradictory results). PR-audit method recorded: confirm merges via `gh pr view <n> --json mergeCommit` + `git merge-base --is-ancestor <mergeCommit> origin/main`, not by eyeballing short `git log` windows.
- **AGENTS.md — growing agent operating manual** — project map, non-negotiable workflow rules (confirm-before-push, changelog on every push), the pre-push verification gate, and hard-won pitfalls (cmd `%ERRORLEVEL%` parse-time masking, `tsc -b` incremental cache drift, optional `string | undefined` data-model fields, MapLibre structural casts, mobile 720px conventions). Standing rule written into the file itself: every crucial learning must be recorded there in the same session it's learned, so the manual compounds across sessions instead of relying on agent memory.
- **`npm run verify` pre-push gate** — one command runs `tsc -b --clean` → full test suite → production build (the exact Vercel command). Run before proposing any push; replaces ad-hoc partial checks that masked failures.
- **12h/24h clock display preference** — the app now defaults to **12h AM/PM** everywhere times are shown (timeline arrival/departure chips, stop open–close hours, dep/arr transport times, fixed commitments on the workspace, overview and trip creation, long-ride leave/arrive clocks, nearby-idea reported hours, public itineraries) with a **"Clock format"** toggle in **Profile & settings → Display preferences** switching to 24h. New `src/lib/timefmt.ts`: tiny external store (`useTimeFormat`, SSR-safe) persisted in `localStorage` (`yatraflow_time_format`), pure `formatHM`/`formatHMRange` formatters that pass placeholders (`--:--`) through untouched. Stored data stays 24h "HH:MM" — display only. Browser-native `type="time"` inputs follow the OS setting by design. 10 new unit tests (139 total).
- **Persisted day collapse state in the Timeline** (closes #4) — collapsed/expanded days now survive reloads and navigation, stored per trip+day in `localStorage` (`yatraflow_day_collapsed`) as a view preference kept out of the trip data model (no Supabase/snapshot changes). New `src/lib/uiPrefs.ts` exposes a hardened, unit-tested parser that degrades corrupted storage entries to "expanded" instead of crashing, plus no-op-safe wrappers for environments without `localStorage`.
- **Category filter chips for nearby ideas on the map** (closes #5) — the gold 💡 idea markers can now be filtered by category straight from the map's filter bar: one chip per category actually present among the ideas (e.g. Sightseeing, Food, Nature), each showing a live count, the category's stroke icon, and toggling that category's markers on/off. Chips only appear when ideas exist, desktop and mobile styling follow the existing day-chip pills, and the legend explains the filter.
- **Return-journey layer on the map** — self-drive round trips now draw the drive **back home** as a **dashed slate line** (with direction chevrons and a 🏠 home marker at the trip start), visually distinct from the solid day-coloured outbound route. The drive home was previously budgeted but never drawn. Toggleable via a "↩ Return home" chip in the map filter bar; legend updated; real-road geometry via OSRM with straight-line fallback.
- **Category-aware map pins with clean stroke icons** — every stop marker is now a teardrop pin (not a flat circle) carrying a **monochrome Lucide-style SVG glyph** for its category (camera, utensils, bed, coffee, landmark, umbrella, leaf, mountains, bag, museum, train, calendar) instead of colourful emojis, with the day colour as the pin fill and the stop number as a corner badge. Maybe-status stops render dashed/outlined so unplanned stops read differently from confirmed ones. Pins cast grounded shadows and lift on hover.
- **Shared icon module** (`src/components/icons.tsx`) — one source of truth for the category icon set, now also used by **nearby-suggestion cards**: thumbnail-less suggestions show the matching stroke icon (muted, centred) instead of the 🏞️ emoji.
- **Map visual polish (mapcn/MapLibre max-out)** — the route now reads like a proper navigation line: a contrasting **casing halo** underneath the route (white in light theme, deep navy in dark) so the line separates cleanly from the basemap, **direction chevrons** rendered along the geometry (dependency-free triangle sprite via `addImage`) showing travel order at a glance in both all-days and single-day views, thicker main strokes (4–4.5px at 0.95 opacity). Stop pins got glossy layered shadows with a springy hover lift, start/end flag badges grew to 32px, and nearby-idea markers pulse with a soft gold halo (`prefers-reduced-motion` respected) so they read as "not part of the plan yet".
- **Project start script** (`scripts/start.ps1`, also `npm start`) — one entry point for the daily dev rituals: verifies dependencies are installed (runs `npm install` on a fresh clone), then boots the Vite dev server with output teed to `dev.log`. Flags: `-Test` for the test suite, `-Build` for the production build. Documented in the README quick-start.
- **Desktop launcher generator** (`scripts/make-dev-shortcut.ps1`) — creates a "YatraFlow Dev" desktop shortcut (VS Code + dev server in one double-click) with auto-detected install paths, so any Windows collaborator gets the same launcher by running it once.

### Changed
- **One travel system for every day** — the old three-way split (plain stop-chain vs ≥350 km "route day" overlay vs the long-ride break planner with its own ride-style options) is gone, rewritten from scratch. `engine.ts` now models every day as a single **journey** — start → halts/visits → destination with a clock arrival (`buildJourney()`), regardless of distance or mode — and the timeline, day header, travel panel, warnings, totals and impact preview all read from it. `src/lib/ridebreaks.ts`, `routeDayDrive()`/`ROUTE_DAY_MIN_KM` and the `LongRidePanel` were deleted; the travel panel now offers the same options on every day (departure → arrival, halts, "+ Add a halt", corridor halt-spot suggestions at any distance).
- **Merge integration: main's conventions re-applied on the unified system** — merging Shabtab's `contrib/dev` fork (4 commits) resolved the conflicts in `TripWorkspace.tsx`, `PublicItinerary.tsx` and `styles.css` by keeping the unified-journey architecture and restoring main's conventions on top: the **12h/24h clock preference** on every new surface (day-header start/ends, anchor arrival clocks, the travel panel's departure input with a live "= 6:30 PM" preview under the native time field, the add-halt ETA preview, and the public itinerary's travelling strips — including `formatHMRange` on stop open–close hours, which the fork leaked as raw 24h), and **touch drag & drop** on the new anchor rows (long-press reorders anchors and stops alike). Verified end-to-end with `npm run verify` (clean typecheck, 128 tests, production build).

### Removed
- **The long-ride break planner and the "route day" overlay** — `src/lib/ridebreaks.ts` (+ its test file), the `LongRidePanel` component, `routeDayDrive()`/`ROUTE_DAY_MIN_KM` and the ride-style chips are gone, superseded by the unified journey (see Changed). The interim **"Hide these long-ride hints"** preference added earlier in this release window is removed with them: stale `yatraflow_ride_hints_hidden` localStorage keys are simply ignored (`uiPrefs` itself remains for day-collapse state).

### Fixed
- **Last 24h-format leaks** — the long-ride halt slots' "expect ~18:40" clock now renders in the user's 12h/24h preference, and the Stop Editor's **Opens at / Closes at / Depart at / Arrive at** fields show a live "= 6:30 PM" preview under each input. Native `<input type="time">` controls follow the browser/OS locale and can't be forced to 12h, so the app preference is echoed as formatted text beside every one (data entry stays native and unbroken).
- **Vercel deploy failure (TS2345)** — `formatHMRange` required non-optional strings but stop `closeTime`/`closeTime` fields are optional in the data model (`string | undefined`); the signature now accepts optional sides. Also widened local verification: previous `cmd` one-liners expanded `%ERRORLEVEL%` at parse time (before commands ran), masking real `tsc` failures behind a stale exit code — the exact reason clean-build failures kept surfacing only on Vercel. Verification now runs bare commands so true exit codes surface.
- **Build fix for Vercel deploys** — a `maplibreGLTypes.GeoJSONSource` namespace reference in `TripMap.tsx` compiled under cached incremental local builds but failed a clean `tsc -b` on Vercel (TS2503). Replaced with the equivalent structural cast; verified with a fully clean `tsc -b --clean` build and the full test suite.
- **Chore: `allowScripts` allowlist for esbuild** — Vercel's npm emits `npm warn allow-scripts` for esbuild's postinstall because the package.json had no allowlist. Added `"allowScripts": { "esbuild": true }` (esbuild's postinstall is a standard, integrity-checked binary install). The warning was never the deploy failure — builds proceeded — but this silences it at the source.
- **Empty days stopped suggesting "Continue to <destination>" after you've already arrived** — the route-continuation chip on unplanned days keyed off the trip's final destination anchor, so with Digha reached on day 1, every later empty day offered "➡ Continue to Digha, West Bengal" — a drive to the place you were parked in. The chip now appears only while the destination is still ahead of you: it's suppressed when the day's wake-up point (where the previous day's journey ended) is that place. The add-stop editor's "From X → next Y" context drops the same-wrong tail, and nearby-idea chips are unaffected.
- **Intermediate days stopped showing the travelling card** — the unified-journey rewrite left every day holding the destination anchor behaving like a travel day: the return-day shape fired on *any* such day (so Days 2–3 of a Kolkata ↔ Mandarmani trip each showed a phantom "Return drive · back to Kolkata" with full bike stats), and each day woke up at the previous day's last *stored* stop (e.g. a mid-route lunch halt), replaying the outbound drive and inflating totals. `buildJourney` now treats the drive home as belonging to the trip's **last day only**, and `originOf` walks the route forward so every day starts where the previous day's *journey ended* (the synthesized destination). Intermediate days render as stay days — a plain "Based in Mandarmani" timeline marker and a "Based in …" day header with no bike/drive stats — while the travelling card keeps appearing on the departure day, the return day, and real transfer days. Days with no ride — stay days and local activity days — render **no travel card at all** (no "+ Add a halt" either: with nothing on the road there is no halt to add); the full panel returns the moment the day actually drives, via the day's own "+ Add stop" or a stop dragged in. Same treatment in the public itinerary.
- **Day 1 now ends at the destination** — a journey that starts must end: the departure day's timeline shows **Start → halts → Destination** with the arrival clock (the engine synthesizes the destination anchor when the day doesn't hold it as a stored stop), and the day header shows the real drive (`Kolkata → Mandarmani · ~167 km · drive 2h 17m · 1 halt · start 08:30 → ends ~11:07`) instead of the old `~0 km · ends ~09:05`.
- **ETA showed a duration as a clock time** — the travel panel's "Estimated arrival" formatted the ride *duration* (e.g. 2h 37m) as a clock (`02:37`); it now reads the journey's true arrival time (departure + drive + all stop time).
- **Totals now see the full route, priced exactly once** — each day's journey carries its real drive (including the departure-day drive to the destination and a planned return drive home); `computeTotals` skips its separate round-trip leg when a return day already ends at the start (no double-counted drive home), and stop counts stay stored-stops only.
- **Timeline treated the drive to your destination as a stop** — the auto trip-start/end anchors (Kolkata → Mandarmani and route-continuation waypoints) were rendered as ordinary stop-cards that showed nothing useful: 0 min visit, ₹0 entry, ₹0 transport and no times, because the actual journey lived only in the small leg line. Those pure-travel anchors now render as a dedicated **"travelling" strip** that shows what a traveller actually wants for the drive — **departure → arrival time, total duration, distance and estimated cost** (fuel-aware when an economy/price is set, mirroring the leg estimate) — and they no longer appear as add/edit/move stop cards. The redundant leg line directly before an anchor is suppressed so each drive is shown exactly once. Same treatment applied to the public itinerary day view.

## [0.17.0] — 2026-08-29

Google Places integration (data-only, Google-first with free-stack fallback) and a full mobile usability pass.

### Added
- **Google Places integration (opt-in via `VITE_GOOGLE_MAPS_API_KEY`)** — when a key is present, YatraFlow upgrades three data surfaces and silently falls back to the open stack otherwise; routing stays OSRM, weather Open-Meteo, rendering MapLibre:
  - **Autocomplete for location picking** — every location input (trip creation, stop editor, settings, suggest-a-stop) suggests real places via Google Autocomplete; picking one resolves coordinates through a single Place Details Essentials call. Free-stack fallback per keystroke on any failure.
  - **Search-Along-Route nearby ideas** — the Map tab's "Nearby ideas" now runs 3–4 Text Search Pro events along the actual road polyline (encoded from OSRM geometry), each hit carrying **reported opening hours** (via FieldMask — zero extra SKU events, no Place Details calls) and a **real road detour** derived from `routingSummaries` legs against the route's total km (`(leg0 + leg1) − routeTotal`, clamped at 0). Verified live against the Places API (`scripts/verify-google-places.mjs`); the summary paths are legs-scoped, not flat.
  - **Point search for single-anchor flows** — empty-day chips and other single-anchor suggestion calls (no route geometry) use Text Search with a circular `locationBias` instead of always dropping to the free stack — same SKU, same tourist queries, reported hours, straight-line detour fallback.
  - **Phase-B quota guard** (`src/lib/providers/quota.ts`) — a monthly soft cap per Google SKU counts events before each request goes out and trips the free-stack fallback when exhausted; events are counted only for requests that actually fire.
  - Data-only usage throughout: Google results are rendered as suggestions, never persisted; a `docs/REPORT-2026-08-29-nearby-rework-and-google-maps.md` engineering report documents the SKU audit and migration rationale.
- **Long-ride break planner** — a long self-drive day (Kolkata → Siliguri is ~580 km, ~14 h of wheel time on the blended car speed) no longer has to be planned as one sitting. The Timeline's per-day panel plans halts by how aggressive the ride is — **push through** (one go), **one halt**, **regular breaks** (a stretch every ~2.5 h, every ~2 h on a motorcycle) or **custom** (you pick the halt count) — with each recommended halt stating where along the route (~km in, % of the drive), how long (meal 40 min / tea + fuel 20 min) and the rough clock time from the day's **ride start time** (per-day `startTime`, which the schedule engine now honours). Real **stop spots** (food/fuel/rest) can be suggested along that stretch of the route corridor from open map sources and added through the normal impact preview, so the time/cost delta is shown before saving. A `fatigue` **warning** flags self-drive days pushing past ~7 h of wheel time with no meal/rest halt.
- **Outbound-day planning** — a self-drive departure day that holds only the trip-start anchor (Day 1 of a Kolkata → Siliguri trip) now plans the **drive to the next destination** instead of showing nothing, so the outbound journey gets the same ride-start time + halt UI as the return. The day's header shows "Route day — ~X km drive to <destination>".
- **Return-drive planning** — the mirror image on the way home: on a round trip, the day holding the final-destination anchor (plus any food/rest halts) plans the **drive back to the start** instead of echoing the outbound. Direction-aware throughout — "Siliguri → Kolkata" From/To in the planner, "Route day — ~X km drive **back to** Kolkata" in the day header, and the suggest-spots corridor follows the return leg (through your halts, toward home).
- **Custom ride style** — beyond the three presets, pick the exact number of halts (1–4) for a long ride; slots are spread evenly with one meal among them, and the ★ marker still shows the recommended style for the day's wheel time.
- Planner math lives in a new pure `src/lib/ridebreaks.ts`; the day start time is a JSONB day field, so no migration is needed.

### Fixed
- **App was unusable on phones** — a mobile usability pass across the shell and workspace (desktop untouched; every rule inside `@media (max-width: 720px)`):
  - **Navigation was impossible** — `.nav-links` was `display: none` under 720px with no replacement, leaving no way to reach My trips / Plan a trip / Explore. A hamburger button now opens a dropdown sheet (closes on tap-out and on navigation).
  - **Timeline stop cards squeezed content out** — the five-button action cluster (move/edit/question/trash) sat inline beside the text, wrapping titles one word per line on a 360px screen; actions now wrap to their own divider-separated row below the content, with move buttons up to 34px and icon buttons to 38px.
  - **iOS focus zoom** — form controls under 16px made Safari zoom the viewport on every focus; inputs/selects/textareas are 16px on mobile now.
  - **Map ate the screen** — the map canvas hard-coded 480px inline; it's 52vh (min 300px) on mobile with repositioned day-filter chips and legend.
  - Touch targets (chips, tabs, vote buttons, day badges) brought up to ≥40px; tighter modal and trip-header padding; long trip names wrap via `clamp()`.
- **Return day of a round trip replayed the outbound leg** — Day 2 of a Kolkata → Siliguri → Kolkata trip showed the outbound drive's wheel time/km all over again: the day chain re-simulates from the trip-start origin, so the destination-anchor day re-ran the outbound leg. A new `routeDayDrive()` in the schedule engine now detects these **route days** (self-drive days made of trip anchors + ride halts) and overlays the drive the day actually represents — outbound departure days drive on toward the next destination, round-trip return days drive home — so every route day shows its true direction, wheel time and km, and travel/fatigue **warnings** key off the true numbers. Halts added from the planner splice **after** the day's anchor (previously they landed before it, splitting the drive into an out-and-back and corrupting the wheel time), and an existing food/rest stop covers a nearby suggested slot on the way home too.
- **Store never re-rendered after mutations** (PR #9/#10) — `commit()` mutated the cache in place, so `useSyncExternalStore` kept seeing the same object reference and the UI only refreshed on an unrelated re-render. The top-level cache is now reassigned on every commit. Regression-tested by a snapshot-reference contract test.
- **Impossible fuel economies produced absurd costs** (PR #9/#10) — `getAssumptions()` read `trip.fuelEconomyKmL` without validation; values like 1 or 500 km/L drove wildly wrong transport/round-trip estimates. Now routed through the existing 2–80 guard, falling back to the blended ₹/km table.
- **AI router answered "train" questions with the rain plan** (PR #9/#10) — `q.includes('rain')` matched the substring inside "train"; now a word-boundary match.
- **Published-trip view/copy counters fired a doomed write for every visitor** (PR #10) — the `published_itineraries` RLS policy only lets the creator update a row, so non-owner views attempted an always-failing UPDATE on every page load. The write is now skipped unless the viewer owns the row (note: public view counts still only persist from the owner's own visits until a counter RPC exists).
- **`reorderStop` could insert `undefined` into the timeline** (PR #10) — out-of-range indices are now clamped and degenerate moves are no-ops instead of corrupting `day.stops`.
- **Weather forecast window was timezone-sensitive** (PR #10) — trip start and "today" are both parsed at UTC midnight so the 15-day availability check no longer shifts by a day across timezones.

### Changed
- **Google-first suggestion stack** — with a key present, nearby suggestions and location picking prefer Google data (corridor/point search, autocomplete) and degrade to OSM/Wikipedia/Mappls on any failure, quota trip, or empty result (e.g. round-trip routes returning no along-route hits). Without a key, behaviour is exactly as before.
- **Tourist-logical nearby suggestions** — the Map tab's "Nearby ideas" and the empty-day chips no longer behave like a POI directory:
  - **Whole-route corridor search** — suggestions are sampled along the entire route line (start → stops → destination) instead of three stop anchors, so every stretch of the drive is covered, not just the first/last/max-dispersion stops.
  - **Home-zone exclusion** — nothing within 15 km of the trip's own starting point is ever suggested (sightseeing at home is meaningless); ideas are strictly en-route and around the destination.
  - **Detour-scope control** — a slider on the Nearby ideas card (10/20/30/50/80/100 km, default 20, remembered per browser) sets how far off-route suggestions may sit, and each card shows its "~N km off route" detour.
  - **Worth-a-visit ranking** — results are scored by tourist value (things to see & do > meals > stays > pit stops), notability (Wikipedia imagery/description, strong OSM tags like `tourism=attraction`, `historic=fort`, `natural=waterfall`) and distance decay — replacing the old nearest-first sort, where a random café 200 m away beat a famous waterfall 8 km off-route.
  - **Tourist categories** — OSM now also surfaces nature (beaches, waterfalls, peaks), parks & gardens and places of worship; **ATMs are no longer suggested at all**, and petrol pumps appear only as capped pit stops on self-drive (car/motorcycle) trips.
  - Category-aware visit defaults when adding a suggestion (meals 45 min, museums/temples/nature 90, pit stops 20, hotels 0).
  - **Itinerary-gap awareness** — suggestions now fill what the plan lacks instead of duplicating it: a long self-drive day with no meal stop boosts food ideas, a multi-day trip with no hotel stops boosts stays, a bare itinerary is seeded with things to see & do, and any category already covered by 3+ planned stops is demoted.

## [0.16.0] — 2026-08-29

Fuel-accurate self-drive budgeting: your vehicle's own economy and pump price drive the transport numbers, and the drive home counts by default.

### Added
- **Fuel economy for self-drive trips** — car and motorcycle trips can state a fuel economy (km per litre) at creation and in trip settings. When set, every leg is priced as `distance ÷ economy × ₹105/L` (indicative petrol price, surfaced wherever the estimate is shown) instead of the blended ₹/km table, so the transport budget reflects the actual vehicle. Persisted in `trips.fuel_economy_km_per_l` — `supabase/schema.sql` includes the column for fresh installs plus an idempotent `alter table … add column if not exists` for existing ones; the store probes for the column and degrades gracefully (session-only economy, default rates) on databases that haven't migrated yet.
- **Litres-first fuel presentation** — the Budget tab shows the actual formula with computed litres (route distance ÷ economy ≈ N L × ₹105/L) rather than an abstract ₹/km rate, and the stop-editor leg preview shows the litres for that leg. A soft, non-blocking nudge warns when a stated economy is implausible for the mode (e.g. 5 km/L on a motorcycle).
- **Optional local fuel price** — car/motorcycle trips can also state the pump price they pay (₹/L, defaulting to the indicative ₹105/L national average). The fuel formula uses it verbatim, and the Budget tab labels it as "your local pump price" vs the indicative average. Persisted alongside fuel economy in `trips.fuel_price_per_l`.
- **Round-trip awareness for self-drive trips** — car and motorcycle routes now price the drive back to the start by default (a "Round trip — return to start" toggle sits with the fuel fields; turn it off for one-way drives). The final-destination → start leg adds to distance, travel time and fuel cost, is refined by OSRM like the outbound legs, and the Budget tab labels distance as "incl. return drive". Persisted in `trips.round_trip`.

## [0.15.3] — 2026-08-29

### Fixed
- **"Odd" nearby suggestions landed in the wrong towns** — Mappls' free-tier Nearby API lists great Indian POIs but returns **no coordinates**, so pins were guessed by a global name search that often matched a same-named place in a different state. Nearby ideas are now built only from **verified coordinates**:
  - **OpenStreetMap via Overpass** — restaurants, cafés, hotels, fuel pumps, ATMs, attractions and historic sites with their true positions (mirror failover included)
  - **Wikipedia geosearch** — attractions, junk-filtered (villages, stations, districts, roads…)
  - **Mappls Nearby** — India-rich listings kept **only** when a same-named place is confirmed near your route via the proximity-biased Photon geocoder; an unresolved hit is dropped rather than pinned in the wrong city

  Searches also anchor on stops **spread along the route** (first + last + max-dispersion) instead of the bare centroid — which for a long route usually landed in the middle of nowhere. Results are merged in trust order (OSM → Wikipedia → Mappls), deduped by name, sorted by distance and round-robined across categories so the list stays varied.

## [0.15.2] — 2026-08-28

### Fixed
- **Mappls search never actually worked in the browser** — the Mappls APIs send no `Access-Control-Allow-Origin` header, so every browser `fetch()` failed with a CORS error and the app silently fell back to the keyless sources (which is why petrol pumps never appeared and the key showed no usage). All Mappls calls now go through our own origin: a Vercel external rewrite (`vercel.json`: `/mappls/* → search.mappls.com/*`) in production and a matching Vite dev proxy locally, so the browser reads the responses same-origin with no CORS involved. Verified end-to-end on production: autosuggest via the proxy returns petrol pumps.

## [0.15.1] — 2026-08-28

### Added
- **Richer nearby ideas** — the Map tab's "💡 Nearby ideas" panel and empty-day suggestions now pull from Mappls Nearby across several categories at once (attractions, food, restaurants, cafés, hotels, fuel pumps, ATMs) instead of just tourist spots. Each suggestion carries a category label, and adding one creates the matching stop type (a hotel becomes a `hotel` stop, a restaurant a `food` stop with a sensible visit length, a fuel pump a `transport-hub`), so hotels, restaurants and petrol pumps are now first-class stoppage points. Keyless Wikipedia geosearch remains the fallback when no Mappls key is set.
- Explicit **"Add to timeline"** confirm in the pick-a-day modal — adding from a map marker or a nearby-ideas card now requires an explicit confirm (plus a Cancel), instead of silently adding when the day was changed.

## [0.15.0] — 2026-08-28

India-grade place data: Mappls (MapmyIndia) drives search and suggestions, and opening-hours fields now make contextual sense.

### Added
- **Mappls (MapmyIndia) place search** — location autocomplete is now powered by Mappls autosuggest (configurable with `VITE_MAPPLS_KEY`), giving far better coverage of Indian cities, towns and POIs than the previous keyless sources alone. Picked results resolve their coordinates via OSM Nominatim on selection (Mappls' free key doesn't return coordinates); if the key is absent or any lookup fails, the app falls back to keyless Open-Meteo + Wikipedia exactly as before.
- **Mappls Nearby for place suggestions** — the empty-day "nearby idea" chips and the Map tab's nearby-POI suggestions now use Mappls Nearby (real tourist attractions/POIs) when the key is configured, again falling back to Wikipedia geosearch otherwise.
- Third-party attribution is shown in the location dropdown ("Place suggestions by Mappls · coords by OpenStreetMap").

### Changed
- **Context-aware opening hours** — the step editor only shows **Opens at / Closes at** when they're meaningful: for geocoded POIs (attractions, temples, museums…), for time-sensitive categories (food, hotel, adventure, shopping, event, rest), or when values are already set. City/town picks now clear stale hours instead of suggesting them.

## [0.14.0] — 2026-08-28

The timeline becomes a real itinerary view: a time rail, cross-day drag-and-drop, and day headers that earn their space.

### Added
- **Time rail** — each day renders on a vertical schedule rail: arrival → departure pills per stop (from the schedule engine), dashed connectors for travel legs. The day's shape is scannable at a glance.
- **Cross-day drag-and-drop** — drag a stop onto another day and drop it on a card (insert before it), a travel-leg gap (insert between stops), or a day's end zone ("Drop to add here"). Moves flow through the impact preview and stay undoable. ▲▼ buttons and the ↔️ modal remain as fallbacks.
- **Day progress bar** — per-day bar showing how much of the realistic window (08:30–20:00) the plan consumes; green/saffron/red by that day's warning severity.
- **Collapsible days** — chevron collapses a day to its header for scanning long trips.
- **Inline day rename** — click a day title to rename it in place (Enter saves, Esc cancels).
- **Route sparkline** — tiny inline SVG of the day's route shape (start dot in saffron), no map mount; hidden on mobile.
- **Copy day (⧉)** — duplicate a day's stops onto the next day through the impact-preview flow.
- **Empty-day suggestions** — unplanned days offer one-click chips: "➡ Continue to {next destination}" (auto waypoint) and nearby-POI ideas from where you'd arrive from.

### Changed
- Stop-card action buttons (▲▼, edit, confirm, move, delete) now sit in a single horizontal row — cards hug their content instead of stretching to a tall action column.

## [0.13.0] — 2026-08-28

Geography-aware planning: real road data flows into estimates, and adding a stop now understands the journey you're inserting it into.

### Added
- **Leg-aware "Add stop"** — when you pick a geocoded place in the stop editor, a new **"🚗 Travel to this stop"** panel auto-detects where you're coming from (the day's last stop → the previous day's last stop → the trip's start anchor) and where you're headed next, then auto-fills the road **distance, travel time and fuel/fare cost** (OSRM real-road routing, haversine fallback when offline). A **Depart at** time defaults to the engine's 08:30 day start and **Arrive at** is computed as depart + travel — both editable, both persisted on the stop and shown in the timeline (`🕰 dep 09:00 · arr 10:12 · 23 km`).
- Engine helpers `predecessorOf` / `nextAfter` / `estimateLeg` (unit-tested) for leg detection and ₹/km cost estimation.
- **🎯 Recentre button** on the map — one-click manual fallback to fit the trip route.

### Changed
- **Real road distances in estimates** (Phases 1–3): trip routes are refined with OSRM driving distances/durations per leg, applied for ground transport modes; the deterministic haversine engine stays as the fallback and still powers warnings and impact previews.

### Fixed
- **Map stuck on its default view (e.g. Kerala)**: the auto-fit previously polled for the map instance and raced the `load` event — if the map loaded between poll ticks, `fitBounds` never ran. The map's readiness now comes from its real `load` event, single-point trips get padded bounds instead of zero-size ones, a refit runs after a resize pass, and the Recentre button covers any residual case.
- **"Please enter a valid value… 65 and 70"** in the travel-time field: it used 5-minute steps while OSRM fills exact values (67 min etc.); it now accepts 1-minute steps.

## [0.12.0] — 2026-08-27

Real accounts and shared persistence: YatraFlow moves from a single-browser localStorage app to a Supabase-backed one — accounts work across devices, and collaboration data finally lives in one place.

### Added
- **Supabase persistence** — trips, members, suggestions, decisions, activity, notifications and published itineraries now live in Postgres (`supabase/schema.sql`), with the app's JSONB internals mapped 1:1 into table columns. The store hydrates from Supabase on login and writes through on every mutation (optimistic cache + fire-and-forget persistence).
- **Real authentication** — email/password signup & login via Supabase Auth with persisted sessions across reloads; profile rows are created by a DB trigger (`handle_new_user`).
- **Row Level Security** on every table — users see only their own/member/public trips; editors can write, owners can delete. Membership checks run through `SECURITY DEFINER` helpers (`is_member`, `is_editor`) to stay recursion-free.
- **Auto demo seeding** — new accounts get the Kerala demo trip on first login when they have no trips.
- **"🚀 Load demo trips" button** on My Trips (header + empty state) — any account can pull in the demo trip on demand.
- `scripts/apply-schema.mjs` — one-off helper to apply `supabase/schema.sql` and dump live policies/triggers (`PG_DUMP=1`).
- Auth form busy state ("Signing in…") with a 10s failsafe so a failed hydration never leaves a permanently disabled button.

### Changed
- `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are now required env vars (`.env.example` documents them); the anon key is public by design — RLS is the authorization boundary.
- The login-page "Try demo mode" button was removed; demo content now arrives via first-login seeding or the new Load-demo-trips button.
- Demo accounts with fixed passwords are gone; sign up with any real email.

### Fixed
- **Login bounced back to the homepage**: `init()` was imported but never called, so the store never learned about the session and every route fell through to the landing page. Now booted once on app mount.
- **"Could not save trip"**: Postgres `uuid` columns rejected the app's prefixed string ids (`trip_k7x2p9q`). Top-level ids (trips, suggestions, decisions, activity, notifications) are now real UUIDs (`crypto.randomUUID`); JSONB-internal ids (stops, days, expenses, comments) keep readable prefixed ids.
- **Silent demo-seeding failure**: same UUID cause — seed inserts failed with only a console trace.
- **RLS infinite recursion (42P17)**: the `trip_members` read policy queried its own table; every API call 500'd until fixed with the security-definer helper.
- **Suggestion/decision id divergence**: inserts omitted the id, so Postgres generated a different one than the UI cache — votes and status changes silently stopped working after reload. Client-generated ids are now sent with the insert.
- Profile saves now surface failures via toast instead of destructuring an unexecuted query.
- `addExpense` accepts the `optional` flag the expense form sends.

## [0.11.5] — 2026-08-26

### Fixed
- **My Trips card footer alignment**: added `.itin-body` wrapper inside each card so the content (emoji, title, route, chips) is padded to 17px side inset, matching `.itin-body` on Explore. Footer now aligns properly with the body width.

## [0.11.5] — 2026-08-26

### Fixed
- **My Trips card footer alignment**: same edge-flush issue as Explore — the member-avatars/delete row now reuses `.itin-meta` (full-width divider reaching the card edges, content inset to body padding).

## [0.11.3] — 2026-08-26

### Fixed
- **Explore card footer alignment**: the author/copy-trip row sat flush to the card edges. The row is now inset to match `.itin-body`'s side padding, with a full-width divider reaching the card edges.
- **"Start planning free" did nothing**: the home/nav signup buttons navigate to `/auth?mode=signup`, but the hash router compared the whole segment (including `?mode=signup`) against the route switch, so it never matched `auth` and fell through to the landing page. The router now strips the query string from the first segment; Auth reads the mode from the hash as before.

## [0.11.2] — 2026-08-26

### Fixed
- **Map container hardening against height collapse**: added an explicit `min-height` to `.map-frame` and explicit fill rules for the MapLibre canvas/container (`.maplibregl-map` / `.maplibregl-canvas` pinned to `100%` inside the absolute-positioned `.yf-maplibre` wrapper). Guards against a regression where the map could shrink to the height of the control strip above it if the canvas failed to inherit the wrapper height.

## [0.11.1] — 2026-08-26

### Fixed
- **Map rendering cropped / mostly blank**: the map view showed only a thin strip of tiles with white void around it. MapLibre captures its canvas size once at construction, but the map is lazily mounted inside a `Suspense` boundary and the layout above it settles after init — so the canvas kept a stale pixel size and never re-measured. The mapcn wrapper now attaches a `ResizeObserver` to the container (plus a window-resize listener and one extra resize pass on map load) calling `map.resize()` on every size change, and the auto-fit effect calls `resize()` before `fitBounds` so the viewport is computed against the canvas's real size.

## [0.11.0] — 2026-08-26

### Added
- **Confirm before destructive actions**: deleting a trip and removing a collaborator now open a styled confirmation dialog (`ConfirmDialog` replaces the browser's raw `confirm()`). Timeline stop deletions were already confirmed via the impact-preview Keep/Remove flow.
- **Undo toasts**: trip deletion, member removal and expense deletion now show a toast with an **Undo** button (~7 s window). Undo restores the exact previous state (trip back at its list position, member with their role, expense at its old line) via new store helpers `restoreTrip`, `restoreMember`, `restoreExpense`.

### Changed
- **Modal accessibility**: dialogs now trap Tab focus inside, remember `aria-labelledby` on the title, and restore focus to the trigger element on close.
- **Location autocomplete ARIA**: the combobox input now wires `aria-controls`, `aria-activedescendant` and per-option ids so screen readers announce the highlighted suggestion; options are removed from tab order (`tabindex={-1}`) since arrow keys drive selection.
- Toasts live in an `aria-live="polite"` region.

## [0.10.0] — 2026-08-26

### Added
- **Real road routing on the map**: route lines between stops now follow actual roads via the free OSRM demo server (© OSRM/OpenStreetMap contributors), instead of straight dashed lines. Simplified geometry per day, consecutive-duplicate points deduped, requests sequential to respect the demo server.
- **Transparent fallback**: when OSRM is unreachable the map silently falls back to the previous straight-line rendering — planning never blocks on a network service. New `src/lib/routing.ts` (`roadLegBetween`, `routePath`) keeps the engine's haversine estimates as the fallback path, so schedule numbers stay deterministic and offline-safe (road-shape upgrade for time/cost estimates in the engine itself is deliberately deferred until there's caching).

### Changed
- Map legend updated to credit OSRM/OSM and restate that plan timings remain fixed-assumption estimates.

## [0.9.1] — 2026-08-26

### Added
- **Engine test suite** (`tests/engine.test.ts`, run via `npm test` with Vitest): 23 tests covering clock helpers, per-mode assumptions (including unknown-mode fallback), road-factor leg estimation, day-schedule internal consistency across every seed-trip day, totals coherence (per-person, per-day, category splits), health-score bounds/banding/clamping and the "removing stops never worsens the score" invariant.

## [0.9.0] — 2026-08-26

### Changed
- **Code-split the map bundle**: MapLibre (~1 MB) is now lazily loaded via `React.lazy` only when the Map tab is opened, with a spinner fallback. Initial JS payload drops from ~1.27 MB to ~311 KB (96 KB gzipped) — the app boots roughly 4× lighter; first visit to the Map tab fetches the map chunk on demand.

## [0.8.0] — 2026-08-26

### Added
- **Export / import**: download any trip as a formatted JSON file from the Share tab, and import one back into your workspace as a fresh editable copy (invalid files are rejected with a toast, never crash).
- **Snapshot link sharing**: "Create snapshot link" embeds the entire trip (deflate-compressed + base64url) into the URL hash at `#/share/<payload>` — zero server storage; the link works logged-out. Opening it shows a preview (name, duration, route) with **Import into my trips** which creates your own copy via the existing duplicate flow.
- New `src/lib/snapshot.ts` codec, round-trip verified (~37% size reduction on seed trips).

## [0.7.0] — 2026-08-26

### Added
- **Weather layer**: per-day forecasts from Open-Meteo (free, keyless). The Overview tab gets a "Weather along the route" card — icon, min/max °C and rain chance per trip day, with wet days highlighted and a nudge to swap weather-sensitive stops when rain probability ≥60%. Timeline day headers show a compact forecast chip (icon · max temp · 💧%).
- New `src/lib/weather.ts`: WMO code → icon/label mapping, `fetchDailyWeather()` and a `forecastAvailable()` guard so trips beyond the ~15-day reliable window show nothing rather than invented numbers.

## [0.6.0] — 2026-08-26

### Added
- **Nearby POI ideas on the Map tab**: the map now shows gold 💡 "idea" markers for real points of interest within 10 km of your route, sourced from Wikipedia geosearch (free, keyless). A "Nearby ideas" panel below the map lists them with thumbnails and descriptions.
- **Add POIs straight from the map**: each idea marker and list card gets a **+ Add** button with a pick-a-day modal; the stop is created through the normal impact-preview flow (suggested status, editable in Timeline). Already-added ideas show a ✓ badge.

## [0.5.0] — 2026-08-26

### Added
- **Logo click now always navigates to the homepage** (previously went to My Trips when logged in).
- **Auto-fed opening hours**: picking a POI in the stop editor looks up its real open/close times from OpenStreetMap's free Overpass API (mail.ru mirror, with overpass-api.de fallback) and pre-fills the Opens at / Closes at fields — still fully editable. Shows "looking up…" / "auto-filled" hints; manual entry stays for places OSM doesn't cover.
- New `src/lib/geocode.ts` additions: `fetchOpeningHours()` (around-search + client-side name matching, since server-side name regex queries time out on public Overpass mirrors) and a tolerant `parseOpeningHours()` handling `"Mo-Sa 10:00-16:00"`, `"24/7"` and split-day formats.

## [0.4.0] — 2026-08-26

### Added
- **Real location autocomplete** on every location input via the free Open-Meteo geocoding API (no API key), with debounced search, loading spinner, "no results" fallback and full keyboard navigation (↑/↓/Enter/Esc). Picking a suggestion writes verified lat/lng into stops, suggestions and trip settings.
- Destination management in Create Trip & Trip Settings: ordered searchable chips with reorder (↑/↓) and remove controls, replacing raw comma-separated text.
- Stop editor shows a "✓ pinned to a real place" confirmation when a geocode result was selected; editing text clears it.
- Modal UX: autofocus first field on open, background scroll lock.
- Mobile polish: 44px minimum touch targets, 16px inputs (prevents iOS focus zoom), visible keyboard-focus outlines.

## [0.3.1] — 2026-08-25

### Fixed
- Blank white screen on startup: temporal dead zone crash in `store.ts` (`saveTimer` used by `load()` before its declaration). Also added DB shape validation (`isValidDb`) so corrupt/incompatible localStorage payloads reseed instead of crashing, plus a global `ErrorBoundary` with a "reset app data" escape hatch.

## [0.3.0] — 2026-08-25

### Changed
- Replaced the demo SVG map with [mapcn](https://github.com/AnmolSaini16/mapcn) (MapLibre GL) vendored under `src/components/mapcn/`: real basemaps that follow light/dark theme, colour-coded route polylines per day, numbered clickable stop pins, fullscreen control, auto-fit bounds.
- UI/layout overhaul: nav shell structure, footer, card covers, spacing system consolidated in `styles.css`; day-section rhythm; mobile nav collapse.

### Added
- GitHub repo + Vercel deployment pipeline (auto-deploy from `main`).

## [0.2.0] — 2026-08-24

### Added
- Collaborative layer: invite-by-link membership with roles, stop suggestions with votes/comments/accept-into-timeline, structured Decisions polls, activity feed, notifications.
- Impact Preview panel (time/distance/cost delta + warning diff before applying changes).
- AI companion drawer — deterministic, engine-grounded answers with cited assumptions.
- Publish-to-Explore flow with public itinerary pages, copy-trip, view/copy counters.

## [0.1.0] — 2026-08-23

### Added
- Initial MVP: hash-routed React 18 + TypeScript app, localStorage store with seed data, trip creation, day-by-day timeline editor, schedule/budget estimation engine with transparent assumptions, decisions, budget tracking, light/dark theme, India-first seed content (Kerala / Goa / Rajasthan).
