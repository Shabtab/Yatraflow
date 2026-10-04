# Module map — where things live

Read this before grepping a large file. The four biggest modules cost hours
when entered blind; this map names what each owns and who calls into it.

Sizes as of 2026-10-04 (`wc -l`): `store.ts` 4255, `MapTab.tsx` 2757,
`engine.ts` 1638, `TripMap.tsx` 1589, `daySlots.ts` 959.

## `src/store/store.ts` — the data layer

Owns the trip cache, hydration, persistence, and every mutation. Start here
for anything that WRITES.

| Question | Go to |
|---|---|
| How is a trip created? | `buildNewTrip` (pure) → `createTrip` / `createTripPersisted` |
| How is a trip copied or forked? | `buildTripCopy` → `duplicateTrip` family |
| How are the days reconciled to a date range? | `reconcileDays` |
| Where is a field mapped to a row? | `tripToRow` / `tripFromRow` in `src/lib/tripRow.ts` |
| Which writes are coalesced or debounced? | `_flushTripWrites`, `MAX_RECENT_WRITES` |
| What does a commit echo guard cover? | `connectRealtime` / `applyRealtimeEvent` |

**Trap:** most of the file's later half is realtime and persistence. The
mutation functions you usually want sit in the first third.

## `src/lib/engine.ts` — the pure planning engine

Owns journeys, schedules, warnings, health, and totals. No store access, so
it is node-testable. Start here for anything that COMPUTES a number.

| Question | Go to |
|---|---|
| How is a day's journey built? | `buildJourney` |
| How are arrivals and departures derived? | `simulateDay` |
| Where do warnings come from? | `collectWarnings` (takes `legCorrections`) |
| Where does the health band come from? | `computeHealth` → `scoreWarnings` |
| Where do money totals come from? | `computeTotals` (takes `legCorrections`) |
| How is a leg measured? | `legBetween` (estimate) vs `legCorrections` (measured) |
| How does a commitment find its stop? | `commitmentStopIndex` |

**Trap:** the parallel arrays in `DaySchedule` are aligned per ACTIVE stop.
Use `stopScheduleRow` / `scheduleRowsById`, never an index into `ordered`.

## `src/lib/daySlots.ts` — the meal and halt rail

Owns which stop fills which slot. Both Map and Overview call it, so a change
here moves both. The claim rules are in `fillStopFor`.

## `src/pages/trip/MapTab.tsx` — the Map tab

Owns the suggestion rails, the phone sheet, and the day axis. Large because
each rail is its own panel, not because the logic is deep.

| Question | Go to |
|---|---|
| What does the rail plan? | `daySlots(activeDayIndex, ...)` |
| Which day does the tab show? | `resolveRailDay(dayFocus, ...)` |
| How are hit costs computed? | `src/pages/trip/map/railLabels.ts` |
| How does a candidate get filed? | `src/pages/trip/map/slotFiling.ts` |

The rails' own helpers live under `src/pages/trip/map/` — check there before
adding a loop in this file.

## `src/components/TripMap.tsx` — the MapLibre canvas

Owns the map only: markers, polylines, popups, camera. It receives road
geometry and `legCorrections` as props and never measures anything itself.

| Question | Go to |
|---|---|
| Where do pin arrival chips come from? | `buildStopClock` in `src/lib/stopClock.ts` |
| How are day routes drawn? | `dayRoutePoints` via `buildJourney` |
| How are synthesized endpoints marked? | `src/lib/journeyMarkers.ts` |

**Trap:** `trip.days` is filtered through coordinate guards before plotting.
A `(0,0)` stored coordinate is never a real pin.

## `src/pages/trip/TimelineTab.tsx` and `timeline/`

`TimelineTab` owns the accordion, warnings, and the per-day cache.
`timeline/DaySection.tsx` is the one big card. Everything provider-backed
(weather, nearby) lives in `timeline/`.

## Before you grep

- Search the **lib** first: most duplicated logic is a helper that a page
  forgot to call.
- `docs/PLANNING-MODEL.md` names the one derivation each surface must share.