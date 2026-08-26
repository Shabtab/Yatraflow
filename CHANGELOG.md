# Changelog

All notable changes to YatraFlow. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 MVP milestones.

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
