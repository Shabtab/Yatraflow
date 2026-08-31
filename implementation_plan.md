# Implementation Plan — Ride Suggestions v2: Persistence, Highways, Vehicle Profile & Confirmation UZ

**Status:** Ready for implementation
**Scope:** 4 workstreams ∔ suggestion caching, highway-aware route planning, vehicle-profile fuel range, and fixed-position impact confirmation.
**Estimated effort:** ~12–14 hours.
**Target release:** 0.21.0 (or fold into 0.20.1 if docs-only).

---

## Overview

Four interconnected improvements to the ride-stop suggestion system:

1. **Suggestion persistence + refresh** – Currently both the Map tab's whole-trip plan (MapTab) and the Timeline's empty-day chips (DayCard) store suggestion results in local `useState`. Because `TripWorkspace` renders tabs conditionally (`{tab === 'map' && <MapTab />}`), switching tabs unmounts the component and the state evaporates. When the user returns, everything refetches from Google/OSM. Fix: lift a trip-scoped suggestion cache into `TripWorkspace`, pass it down, and add an explicit ✓ refresh button on both surfaces.

2. **Highway-aware, purpose-specific search** – The current `ALONG_ROUTE_QUERIES` searches generically for "tourist attractions", "restaurants and cafes", "hotels" regardless of what fatigue segment needs filling. A lunch segment should query highway dhabas and food courts; a fuel segment should query petrol pumps; an overnight segment should query hotels in key cities. The route anchors should also follow the actual road geometry (`routeGeometry` from OSRM/Google) rather than straight-line `corridorAnchors`.

3. **Vehicle profile + accurate fuel/charging range** ∓ `FUEL_INTERVAL_KM = 450` is a hard-coded guess. Add vehicle-type questions (car/motorcycle/EV, petrol/diesel/electric, tank capacity or battery kWh) to the trip data model. Derive the fuel-stop cadence from real range = capacity ø economy, with a 15 % reserve buffer (refuel at 85 % depletion). For EVs, search charging stations instead of petrol pumps.

4. **Fixed-position impact confirmation + auto-scroll** – The `ImpactPreviewPanel` currently renders inline at the top of the page (line 157 of `TripWorkspace.tsx`). When a user adds a stop to Day 4 deep in the Timeline, the panel appears above the fold and the user must scroll up to click "Keep change", then scroll back down. Fix: convert the panel to a fixed-position bottom sheet that docks to the viewport bottom (`position: fixed; bottom: 0`) so it is always visible. On "Keep", auto-scroll the viewport to the impacted day's card; on "Remove", stay in place.

---

## [Types]

### New / extended in `src/data/types.ts`

```ts
export type FuelType = 'petrol' | 'diesel' | 'electric' | 'cng'

export interface VehicleProfile {
  vehicleType: 'car' | 'motorcycle' | 'ev'
  fuelType: FuelType
  capacity: number
  economy: number
}

// Add to Trip interface (optional, backward-compatible):
nearbyProfile?: VehicleProfile
```

### New in `src/lib/vehicleProfile.ts` (pure module)

```ts
export interface ResolvedRange {
  rangeKm: number
  reserveKm: number
  planCadenceKm: number
}

export function resolveVehicleRange(profile?: VehicleProfile, transportMode?: string): ResolvedRange
export function defaultVehicleProfile(mode: string): VehicleProfile
export function formatCapacity(profile: VehicleProfile): string
```

### New in `src/lib/purposeQueries.ts` (pure module)

```ts
export interface PurposeQuerySet {
  googleQueries: string[]
  overpassSelectors: string[]
  categoryBias: string[]
}

export function queriesForPurpose(
  purpose: HaltPurpose,
  fuelType?: FuelType,
  includeHighway?: boolean,
): PurposeQuerySet
```

### New in `src/hooks/useSuggestionCache.ts`

```ts
export interface SuggestionCache {
  map: { pois: SegmentHit[]; anchorsHash: string; ts: number } | null
  days: Record<number, { nearby: PlaceHit[]; anchorHash: string; ts: number }>
}

export function useSuggestionCache(tripId: string): {
  cache: SuggestionCache
  setMapCache(pois: SegmentHit[], anchorsHash: string): void
  setDayCache(dayIndex: number, nearby: PlaceHit[], anchorHash: string): void
  clearMap(): void
  clearDay(dayIndex: number): void
  clearAll(): void
}
```

---

## [Files]

### New files

| File | Purpose |
|--------|--------|
| `src/lib/vehicleProfile.ts` | Pure functions: default profiles, range calculation, capacity formatting. |
| `src/lib/purposeQueries.ts` | Maps each `HaltPurpose` to Google text queries and Overpass selectors. |
| `src/hooks/useSuggestionCache.ts` | Trip-scoped suggestion cache with hash-based invalidation. |
| `tests/vehicleProfile.test.ts` | Tests for range math, defaults, EV vs. liquid fuel. |
| tests/purposeQueries.test.ts` | Tests that each purpose returns the expected query shapes. |

### Modified files

| File | Specific changes |
|---------|--------------|
| `src/data/types.ts` | Add `FuelType`, `VehicleProfile`, optional `trip.vehicleProfile`. |
| `src/lib/ridePlan.ts` | `planRideSegments` accepts `vehicleRangeKm?: number` (replaces hard `FUEL_INTERVAL_KM`). When provided, fuel cadence = `vehicleRangeKm`. |
| `src/lib/geocode.ts` | `planJourneyHalts` accepts `vehicleProfile` ; passes `vehicleRangeKm` to `planRideSegments`; calls `queriesForPurpose` per segment to search with purpose-specific queries. |
| src/lib/providers/hits.ts` | Add `anchorHash(anchors)` helper (stable string hash for cache keys). |
| `src/lib/providers/google.ts` | `googleNearbyAlongRoute` gains optional `purposes?: HaltPurpose[]`; when passed, builds queries from `queriesForPurpose` instead of the static `ALONG_ROUTE_QUERIES`. Still appends fuel query only when `includeFuel`. |
| `src/lib/providers/free.ts` | `searchNearbyOverpass` gains optional `selectors?: string[]` override; `searchNearbyPoisMultiFree` accepts `purposes` and merges per-purpose selectors. `searchCitiesAlong` kept as-is (already does the city overlay). |
| `src/lib/routing.ts` | Export `routeGeometryToAnchors(Geometry, maxAnchors)` — samples the actual road geometry ([lng,lat][]) into lat/lng anchor points at ~25 km spacing for search bias. |
| `src/pages/TripWorkspace.tsx` | **Major rework:** (a) instantiate `useSuggestionCache` at top level, pass cache + clear callbacks into MapTab and DayCard; (b) replace inline `ImpactPreviewPanel` with a fixed bottom-sheet wrapper; (c) add `scrollToDay(dayIndex)` helper; (d) add vehicle-profile fields to trip-edit form. |
| `src/components/ImpactPreview.tsx` | Convert from inline block to fixed bottom-sheet: wrap root in `<div className="impact-sheet">` with `position: fixed; bottom: 0; left: 0; right: 0; z-index: 90`. Keep all internal markup. Add `onScrollToDay?: (dayIndex: number) => void` prop. |
| src/styles.css` | Add `.impact-sheet`, `.suggestion-refresh-btnn `, .vehicle-profile-form`, mobile adjustments for fixed sheet (\u226720px full-width, safe-area padding). |
| `CHANGELOG.md` | Add v0.21.0 (or [Unreleased]) entries for all four workstreams. |
| `README.md` | Update "Fuel-accurate transport costing" bullet to mention vehicle-profile range. |
| �docs/ARCHITECTURE.md`( Document the suggestion-cache layer and purpose-query pipeline. |
| tests/ridePlan.test.ts` | Add tests: fuel cadence respects custom`vehicleRangeKm`; EV range > 0; meal segment doesn't pick a petrol pump. |
| tests/providers.test.ts` | Assert that `googleNearbyAlongRoute` with `purposes:['fuel']` only sends fuel-relevant queries. |

---

## [Functions]

### New functions

| Name | Signature | File | Purpose |
|---------|------------|--------|--------|
| `resolveVehicleRange` | `(profile?: VehicleProfile, mode?: string) => ResolvedRange` | `vehicleProfile.ts` | Computes range, reserve, and plan cadence from profile or mode defaults. |
| `defaultVehicleProfile` | `(mode: string) => VehicleProfile` | `vehicleProfile.ts` | Defaults: car-petrol-45L-15kmpl, bike-petrol-12L-40kmpl, ev-50kWh-6km/kWh. |
| queriesForPurpose` | `(purpose, fuelType?, includeHighway?) => PurposeQuerySet` | `purposeQueries.ts` | Returns highway-biased queries for functional stops; wider tourist queries for sight. |
| `useSuggestionCache` | `(tripId: string) => { cache, setMapCache, setDayCache, clearMap, clearDay, clearAll }` | `useSuggestionCache.ts` | Trip-scoped cache backed by `useRef` (survives re-renders, not localStorage – suggestions are cheap to re-fetch, we just want to avoid refetching on tab switch). |
| srouteGeometryToAnchors` | `(geometry: [number,number][], maxAnchors?: number) => {lat,$ng}[]` | `routing.ts` | Samples actual road geometry into anchor points at ~25 km spacing. |
| srollToDay` | `(dayIndex: number) => void` | `TripWorkspace.tsx` (local) | Finds the DOM element for the day card and calls `scrollIntoView({ behavior:'smooth', block:'center' })`. |

### Modified functions


| Name | File | Changes |
|-------|-------|---------|
| planRideSegments | `ridePlan.ts` | Accept optional `vehicleRangeKm`; when set, fuel segment target = `vehicleRangeKm * 0.85` instead of `FUEL_INTERVAL_KM`. |
| planJourneyHalts | `geocode.ts` | Accept `vehicleProfile` ; compute `vehicleRangeKm` via `resolveVehicleRange` ; for each segment, call purpose-specific search (Google: `googleNearbyAlongRoute` with `purposes`; free: `searchNearbyPoisMultiFree` with per-purpose selectors). |
| `googleNearbyAlongRoute` | `google.ts` | New optional arg `purposes?: HaltPurpose[]`. When absent, behaves exactly as today (backward compat). When present, builds dynamic query list from `queriesForPurpose` instead of static `ALONG_ROUTE_QUERIES`. |
| `searchNearbyPoisMultiFree` | `free.ts` | New optional arg `purposes?: HaltPurpose[]`. Merges per-purpose Overpass selectors. |
| searchNearbyOverpass | `free.ts` | New optional arg `selectors?: string[]` . When passed, uses those instead of `OVERPASS_NEARBY_SELECTORSc. |
| MapTab (component) | `TripWorkspace.tsx` | Receives `cachedPois`, `onCachePois`, `onClearPois`. Reads from cache before fetching. Renders ✓ refresh button next to the "Nearby ideas" heading. |

| DayCard (component) | `TripWorkspace.tsx` | Receives `nearbyCache`, `onCacheNearby`, `onClearNearby` . Reads from cache before fetching. Renders ’ refresh button next to empty-day chips. |
| ImpactPreviewPanel | `ImpactPreview.tsx` | Wraps in fixed-position sheet. Adds `onScrollToDay` prop; "Keep change" button calls it after `onKeep`. |
| �applyChange` | `TripWorkspace.tsx` | After setting `pending`, call `scrollToDay(dayIndex)` only if the day card is outside the viewport (use `IntersectionObserver` or simple `getBoundingClientRect` check). |

### Removed functions

None – all changes are additive or parametric.

---

## [Classes]

No new classes. The codebase is typed-function modules + React function components. The `Modal` component in `ui.tsx` already exists and can be reused for any modal confirmations if needed, but the primary UX change is the fixed `ImpactPreviewPanel` sheet, not a new modal.

---

## [Dependencies]

No new npm dependencies. All work is within the existing stack (React, MapLibre, Supabase, vitest). The Overpass queries, Google Places API, and OSRM are already wired.

---

## [Testing]


| Test file | What it validates |
|----------|-----------------|
| tests/vehicleProfile.test.ts | Default profiles for car/motorcycle/EV; range = capacity ø economy; reserve = 15 %; planCadence = 85 % of range. |
| tests/purposeQueries.test.ts | Each `HaltPurpose` returns at least one Google query and one Overpass selector; fuel queries include "petrol pump" / `amenity=fuel`; meal queries include "restaurant" / `amenity=restaurant`; EV fuel queries include "charging station" / `amenity=charging_station`. |
| tests/ridePlan.test.ts (extend) | Custom`vehicleRangeKm=600` produces fuel segment at ~510 km (600 ø 0.85); default (no range) still uses 450 km. |
| tests/providers.test.ts (extend) | Mocked `googleNearbyAlongRoute` with `purposes:['fuel']` sends only fuel-relevant queries. |
| tests/nearby.test.ts | No changes needed xmd existing tests still pass (all new params are optional). |
| Gate | `npm run verify` – clean `tsc -b --clean`, all tests green, `vite build` clean. |

---

## [Implementation Order]

3. **Foundation – types & pure modules** (no UI changes, safe to test early)
   1. `src/data/types.ts` – add `FuelType`, `VehicleProfile`, optional `trip.vehicleProfile`.
   2. `src/lib/vehicleProfile.ts` + `tests/vehicleProfile.test.ts` – defaults, range math.
   3. `src/lib/purposeQueries.ts` + `tests/purposeQueries.test.ts` �3 query mappings.
   4. `src/lib/providers/hits.ts` �3 add `anchorHash` helper.

2. **Engine layer �3 route planning** (still no UI)
   5. `src/lib/routing.ts` – add `routeGeometryToAnchors`.
   6. `src/lib/ridePlan.ts` - accept `vehicleRangeKm`; update tests.
   7. `src/lib/providers/google.ts` �3 add `purposes` param to `googleNearbyAlongRoute` .
   8. `src/lib/providers/free.ts` – add `purposes` / `selectors` params.
   9. `src/lib/geocode.ts` - wire `vehicleProfile` + per-purpose search into `planJourneyHalts`.
   10. Run `npx vitest run` �3 all green before touching UI.

3. **Caching layer** (React hook, no visible UI yet)
   11. `src/hooks/useSuggestionCache.ts` �3 implement cache with hash invalidation.
   12. `TripWorkspace.tsx` – instantiate hook at top level, pass callbacks down.

4. **UI rework – Tab 1: Map + Timeline suggestions** (visible changes)
   13. MapTab (in `TripWorkspace.tsx`) �3 read from cache, render ’ refresh, skip fetch on cache hit.
   14. DayCard (in `TripWorkspace.tsx`) - same for empty-day nearby chips.
   15. `src/styles.css` �3 refresh button styles.

5. **UI rework – Tab 2: Impact confirmation sheet** (the biggest UX win)
   16. `src/components/ImpactPreview.tsx` - wrap in fixed-position sheet, add `onScrollToDay` prop.
   17. `src/pages/TripWorkspace.tsx` �3 replace inline `<ImpactPreviewPanel />` with the fixed wrapper; implement `scrollToDay` ; wire `onScrollToDay` to scroll to `pending.result.dayIndex`.
   18. `src/styles.css` – sheet styles (desktop: max-width 720px centered; mobile: full-width with safe-area inset).

6. **UI rework – Tab 3: Vehicle profile** (trip creation / edit)
   19. Trip creation form – add vehicle-type dropdown, fuel-type dropdown, capacity input, economy input (all optional, pre-filled from defaults).
   20. Trip edit modal – same fields, allow changing mid-plan.
   21. `src/styles.css` - compact form row styles.

7. **Docs & gate**
   22. `CHANGELOG.md` - entries under `[Unreleased]`.
   23. `README.md` + `docs/ARCHITECTURE.md` – update descriptions.
   24. `npm run verify` �3 full gate, fix any minify warnings.
   25. Commit, push to `test`, open PR, merge only with user confirmation.

---

## Edge cases & decisions already made

- **Cache invalidation:** The cache key is an `anchorHash` (ordered lat/lng strings). Adding, removing, or reordering stops changes the trip's stop coordinates, which changes the anchors, which changes the hash – automatic cache miss -› fresh fetch. The user can also explicitly click ✓ refresh.
- **Highway vs. city for overnight:** The existing `searchCitiesAlong` city overlay still runs for all segments. For overnight segments, the `fitScoreForPurpose`, already gives +2 for `isPopulatedPlace` and a population bonus, so the city overlay naturally wins. No change needed.
- **EV charging on highways:** In India, highway charging infrastructure is sparse compared to petrol pumps. The EV plan cadence (e.g., 300 km for a 50 kWh car) will place charging segments more frequently than petrol. The purpose query for EV fuel will search `"EV charging stations"` + Overpass `amenity=charging_station`. If none are found, the segment remains empty – the user sees "No charging station found near ~255 km" and can add one manually.
- **Backwards compatibility:** All new fields on `Trip` are optional. Existing trips without `vehicleProfile`, fall back to the current hard-coded `FUEL_INTERVAL_KM = 450` (which maps roughly to a mid-size petrol car: 45 L ø 15 km/L &#8553; 0.85 â 574 km . close enough for a default). All new provider params are optional; omitting them yields today's behaviour.
- **Fixed sheet z-index:** The toast zone is at `z-index: 200`, the modal overlay at `z-index: 100`. The impact sheet will sit at z-index: 90` – below modals and toasts, above page content.
- **Auto-scroll only when needed:** After "Keep change", the scroll fires only if the impacted day's card is outside the viewport (checked via `element.getBoundingClientRect().top < 0 || element.getBoundingClientRect().bottom > window.innerHeight`). If the day is already visible, no scroll occurs.
