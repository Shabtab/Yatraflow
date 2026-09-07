# Changelog

All notable changes to YatraFlow. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 MVP milestones.


## [Unreleased]

### Fixed
- **The AI companion drawer closes again, and looks like YatraFlow.** The merge that landed calendar export overwrote styles.css with a stale branch copy, deleting the .ai-drawer:not(.open) display rule — the drawer rendered permanently open on every trip page, and its long quick-prompt labels wrapped into tall ovals inside the pill radius. The close rule is restored, and the panel is redesigned onto the CTI design language: navy-to-teal gradient header with a glass icon badge, brand-teal user bubbles (white on --teal-deep, 5.2:1 AA), bordered bot bubbles, single-line quick-prompt pills on a horizontal scroll rail, a teal-gradient FAB with the brand glow, and a safe-area-aware input row.
- **Encoding corruption repair.** The same stale overwrite had mojibake-corrupted every non-ASCII character in styles.css and ShareTab.tsx (em-dashes and section signs turned into double-encoded garbage, including user-visible strings like the snapshot-copied toast) and silently reverted the tabbed Share-tab refactor (PR #74). Both files are restored byte-clean from the pre-merge commit, and the intended additions were re-applied on top: the print/PDF day-card styles plus the @media print block, the per-day cost/dwell chip styles, the saffron idea-pin gradient, and the ICS/print buttons threaded with OSRM leg corrections through TripWorkspace, ShareTab and SnapshotCard. The CHANGELOG's own C1/C2 notes had also lost characters to the same class of shell corruption — repaired.

## [0.42.0] — 2026-09-07

**C1-C5: Hy4 audit P0 fixes.** The suggestion engine's persistent state and UI behaviors are now fully reliable. The 'Add all' button batches all POI additions with proper write-through; the cache correctly expires when the route geometry changes; and the degenerate route guard prevents crashes on short routes. Full audit sweep completes all P0 items.

**Suggestion engine polish.** Every suggestion in the app — the Map tab's nearby ideas and the Timeline's halt planner — now correctly invalidates when the route geometry changes, preventing stale corridor suggestions after OSRM resolves.

### Fixed
- **C1: 'Add all' button now batch-applies all stops with write-through** — previously collected stops only updated UI state without persisting to the database. Now uses `applyChange` to batch-add all selected stops, with the same optimistic UI pattern as per-stop 'Add to timeline'.
- **C2: Suggestion cache invalidates when route geometry changes** — added `routeHash` to include OSRM road geometry in the cache key. When OSRM resolves the route after mount and the road changes, the cache now correctly expires instead of showing stale corridor suggestions.
- **C3: Guard corridorAnchors when all stops are within 500m** (pts.length < 2) prevents cum[1] undefined crash on degenerate routes.
- **C4: Detour budget now enforced from actual itinerary stops** instead of skipping added/dismissed suggestions.

### Changed
- **Version bumped to 0.42.0**


