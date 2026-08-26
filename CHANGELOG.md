# Changelog

All notable changes to YatraFlow. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 MVP milestones.

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
