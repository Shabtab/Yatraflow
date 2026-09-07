# Changelog

All notable changes to YatraFlow. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 MVP milestones.


## [0.42.0] — 2026-09-07

**C1-C5: Hy4 audit P0 fixes.** The suggestion engine's persistent state and UI behaviors are now fully reliable. The 'Add all' button batches all POI additions with proper write-through; the cache correctly expires when the route geometry changes; and the degenerate route guard prevents crashes on short routes. Full audit sweep completes all P0 items.

**Suggestion engine polish.** Every suggestion in the app — the Map tab's nearby ideas and the Timeline's halt planner — now correctly invalidates when the route geometry changes, preventing stale corridor suggestions after OSRM resolves.

### Fixed
- **C1: 'Add all' button now batch-applies all stops with write-through** — previously collected stops only updated UI state without persisting to the database. Now uses pplyChange to batch-add all selected stops, with the same optimistic UI pattern as per-stop 'Add to timeline'.
- **C2: Suggestion cache invalidates when route geometry changes** — added outeHash to include OSRM road geometry in the cache key. When OSRM resolves the route after mount and the road changes, the cache now correctly expires instead of showing stale corridor suggestions.
- **C3: Guard corridorAnchors when all stops are within 500m** (pts.length < 2) prevents cum[1] undefined crash on degenerate routes.
- **C4: Detour budget now enforced from actual itinerary stops** instead of skipping added/dismissed suggestions.

### Changed
- **Version bumped to 0.42.0**


