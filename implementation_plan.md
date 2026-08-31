# Implementation Plan — Fatigue-aware, city-anchored ride-stop suggestions

**Status: implemented** (this file is the plan-of-record; see CHANGELOG `[Unreleased] → Added` for the shipped summary).

## Overview

Replace the previous even-spaced tourist-rank suggestion logic with a journey-budget planner that spaces stops by fatigue thresholds, anchors long-drive and cross-day stoppages on key cities, and shows every suggestion's position ("X km from start", "≈Y h since last stop"), stop purpose and nearest city on both surfaces — the per-day "Suggest halt spots" (Travel panel) and the whole-trip "Nearby ideas" (Map tab).

Approach: one pure, provider-agnostic engine (`src/lib/ridePlan.ts`) that (1) splits any drive into fatigue segments (stretch ~150 km/2 h, meal ~300 km, fuel ~450 km on tank range at 85%, overnight ~550 km/7 h end-of-day), each with an acceptance window; (2) anchors long/cross-day stops on key cities via a free-stack city overlay (Overpass `place=city|town` + Wikipedia populated places, population-weighted); (3) assigns the single best candidate per segment by purpose-fit + detour + distance-to-target; (4) annotates every hit with `haltPurpose`, `legKm`, `legMinutes`, `cumKm`, `nearestCity`. Google Search-Along-Route (when a key exists) supplies a real along-route km per hit from `routingSummaries` leg0; without it, a coarse anchor-derived position is used — the free stack works with zero keys.

## Types (`src/lib/providers/hits.ts`, additive)

- `export type HaltPurpose = 'stretch' | 'meal' | 'fuel' | 'rest' | 'overnight' | 'sight'`
- `PlaceHit` gains optional: `alongRouteKm?`, `haltPurpose?`, `legKm?`, `legMinutes?`, `cumKm?`, `nearestCity?`, `isPopulatedPlace?`, `population?`
- `NearbyOpts` gains optional: `vehicleRangeKm?`, `multiDay?`
- `src/lib/ridePlan.ts`: `RideSegment { index, purpose, label, targetKm, minKm, maxKm, kmFromPrev, minutesFromPrev, dayEnd?, hint }`, `SegmentHit { segment, hit, score }`

## Fatigue constants (testable)

`STRETCH_INTERVAL_KM = 150` · `MEAL_INTERVAL_KM = 300` · `FUEL_INTERVAL_KM = 450` · `OVERNIGHT_INTERVAL_KM = 550` · `MIN_BREAK_GAP_KM = 110` · `END_KM = 60` · `PURPOSE_FIT` affinity table (food→meal, transport-hub→fuel, hotel→overnight, cafe→stretch, sightseeing→sight…).

## Functions

New `src/lib/ridePlan.ts`: `planRideSegments(input)` (walks cumulative km, merges co-located targets, enforces gaps and end-zone, overnight only when `multiDay`), `kmFromStartForHit`, `fitScoreForPurpose`, `assignSegmentHits` (greedy one-hit-per-segment + dedupe), `annotateHits`.

New providers: `free.ts` `searchCitiesAlong(anchors, radiusM, count)` (best-effort → `[]`); `geocode.ts` `planJourneyHalts(...)` facade (Google/quota → free fallback preserved).

Modified: `google.ts` `hitsFromResponses` derives `alongRouteKm = leg0/1000`; `TripWorkspace.tsx` `suggestSpots` renders segment cards + "Add" writes the right halt type (stretch 15 / rest 20 / meal 45 / fuel 10 min; overnight → end-of-day hotel stop); MapTab groups whole-trip plan by segment and pre-selects the covering day; `TripMap.tsx` tooltips enriched; `styles.css` `ride-seg-*` cards (≤720px block).

## Files

New: `src/lib/ridePlan.ts`, `tests/ridePlan.test.ts`. Modified: `hits.ts`, `google.ts`, `free.ts`, `geocode.ts`, `TripWorkspace.tsx`, `TripMap.tsx`, `styles.css`, `CHANGELOG.md`, `README.md`, `docs/ARCHITECTURE.md`, `ROADMAP.md`. No new dependencies.

## Testing

`tests/ridePlan.test.ts` (pure, node): cadence for a 1 400 km multi-day route; fuel respects `vehicleRangeKm`; `END_KM` / `MIN_BREAK_GAP_KM` / overnight-only-when-multiDay; purpose-fit wins; dedupe. `tests/providers.test.ts`: `alongRouteKm` assertion. Gate: `npm run verify` green.

## Implementation order (executed)

1. `hits.ts` types → 2. `google.ts` `alongRouteKm` + test → 3. `free.ts` `searchCitiesAlong` → 4. `ridePlan.ts` → 5. `tests/ridePlan.test.ts` → 6. `geocode.ts` facade → 7. `suggestSpots` rework → 8. MapTab + TripMap tooltips → 9. styles → 10. docs/CHANGELOG → 11. `npm run verify` + local commit (push only with user approval per AGENTS.md §2).
