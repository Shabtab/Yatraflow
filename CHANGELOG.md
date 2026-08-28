# Changelog

All notable changes to YatraFlow. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 MVP milestones.

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
