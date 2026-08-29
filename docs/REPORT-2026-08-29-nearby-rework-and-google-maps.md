# Engineering Report — Nearby Suggestions Rework & Google Maps Proposal

**Date:** 2026-08-29 · **Status:** shipped (sections 1–2) + proposal for discussion (sections 3–6)
**For:** discussion with contributors · **Author:** hasnaina955 (+ Cline sessions)

---

## 1. Shipped this week (all on `main`, 68/68 tests green, live on Vercel)

### v0.16.0 — fuel-accurate self-drive costing (PR #8)
- Fuel economy (km/L) + optional local pump price on car/motorcycle trips; every leg priced as `distance ÷ economy × price` instead of the blended ₹/km table.
- Round-trip awareness: the drive back to start is budgeted by default (toggle for one-way).
- Supabase columns `fuel_economy_km_per_l`, `fuel_price_per_l`, `round_trip` (idempotent migration, applied to prod).

### Tourist-logical nearby suggestions (4 phases, `1b0f8d0`, `d21fe26`)
The old logic answered *"what POIs exist near the route"* — nearest-first, ATMs and petrol pumps ranked equal to forts and waterfalls. The new engine answers *"what would a tourist add to this itinerary"*:

| Phase | What changed |
|---|---|
| **1 · Worth-a-visit scoring** | Tourist-value rank (see & do > meals > stays > pit stops) + notability (Wikipedia imagery/description, strong OSM tags) + distance decay. Replaced nearest-first sorting. New OSM selectors: `natural` (beaches, waterfalls, peaks), `leisure` (parks, gardens), `place_of_worship` → temple. **ATMs removed entirely.** |
| **2 · Route-corridor search** | Suggestions sampled along the **whole route line** (start → stops → destination), not 3 stop anchors. **Home-zone exclusion:** nothing within 15 km of the trip's own start is ever suggested — ideas are strictly en-route + around the destination. |
| **3 · Detour-scope control** | Slider on the Nearby-ideas card: 10/20/30/50/80/100 km (default 20, persisted). Each card shows "~N km off route". |
| **4 · Itinerary-gap awareness** | `computeCategoryBias(trip)`: long self-drive day with no meal stop → food boosted; multi-day trip with no hotels → stays boosted; bare itinerary → seeded with things to see & do; categories covered by 3+ planned stops → demoted. |

### Hermes bug-hunt merged (PRs #9, #10)
Seven genuine bugs fixed, each with regression tests: store re-render contract (`commit()` now replaces the top-level cache for `useSyncExternalStore`), fuel-economy validation (2–80 guard enforced), AI router train→rain mis-route, RLS-safe published view/copy counters, `reorderStop` OOB guard, timezone-stable forecast window, null-session guard.

**Test suite: 68/68 passing** (44 engine + 7 corridor + 6 gap-bias + 11 bug-hunt regressions).

---

## 2. Current architecture — 100% free, keyless stack

| Concern | Provider(s) | File |
|---|---|---|
| Map render | MapLibre GL + CARTO basemaps | `src/components/TripMap.tsx`, `mapcn/` |
| Place autocomplete | Mappls autosuggest + Open-Meteo + Wikipedia | `src/lib/geocode.ts` |
| Nearby suggestions | Overpass (OSM) + Wikipedia geosearch + Mappls Nearby | `src/lib/geocode.ts` |
| Road routing | OSRM demo server | `src/lib/routing.ts` |
| Opening hours | OSM Overpass | `src/lib/geocode.ts` |
| Weather | Open-Meteo | `src/lib/weather.ts` |
| CORS proxy | Vercel rewrite `/mappls/*` (Mappls sends no CORS headers) | `vercel.json` |

Provider-agnostic seams already exist: `PlaceHit` (search results), `RoadLeg` (routing) — everything downstream (corridor sampling, home-zone, scoring, gap-bias, budget math) never touches a provider directly.

---

## 3. Proposal — Google Maps with the free stack as automatic fallback

### The compliance constraint that shapes it
Google Places ToS requires Places data to be displayed **on a Google map** — so "Google data on MapLibre" is not allowed, and partial hybrids are gray-zone. The clean model is **two complete stacks with one runtime switch**:

```
Google mode (key present + quota OK)      Free mode (no key / quota spent / errors)
──────────────────────────────────────    ─────────────────────────────────────────
Google Maps JS render                     MapLibre + CARTO (current)
Places Autocomplete / Text Search         Mappls + Open-Meteo + Wikipedia
Places Nearby (New) — 1 call/scan         Overpass + Wikipedia + Mappls corridor
Directions API (cached per leg)           OSRM
Place Details (hours/photos/ratings)      Overpass hours
```

### Implementation shape (~3–3.5 days)
- **Phase A — provider facade (~1 d):** engines split into `src/lib/providers/free.ts` (today's code, untouched) and `src/lib/providers/google.ts`. `geocode.ts`/`routing.ts` become facades: Google first → free on key-absence, error, or quota-exhaustion. All Phase 1–4 logic survives untouched. `resolveHitCoords` + Nominatim fallback get deleted (Google returns coordinates natively).
- **Phase B — quota guard (~0.5 d):** monthly per-SKU event counters in localStorage, 8,000 soft-cap (20% margin under the 10k free allowance); hitting the cap silently drops that SKU to the free stack for the month. Corridor capped at 6 anchors in Google mode; Directions cached per leg.
- **Phase C — Google renderer (~1.5 d):** `TripMapGoogle.tsx` with the same props as `TripMap` (stop markers, idea pins, polyline, fitBounds); `TripWorkspace` picks the renderer from the resolved provider mode. Key restricted by HTTP-referrer to the Vercel domain.
- **Phase D — validation & docs (~0.5 d):** test all three states (key present / absent / quota exhausted), provider badge in the UI (🟢 Google / 🟠 free fallback, same pattern as the Mappls badge), README env docs.

**What we'd gain:** ratings, photos, phone numbers and reliable hours on suggestion cards; better POI coverage in parts of India; no CORS proxy; no Overpass saturation.
**What we'd keep:** everything — the free stack remains the automatic fallback, so the app behaves exactly as today when the key is absent.

---

## 4. Quota simulation — 100 users × 2–3 trips / month

Per-trip events (Google mode, with the Phase-B optimizations):

| Action | SKU events |
|---|---|
| Trip setup (start + 2–3 destinations, debounced picks) | ~6 Text Search |
| First map view (corridor scan, 6 anchors × 1 Nearby call) | ~6 Nearby |
| Scope tweaks / later views (per anchor+scope cache) | ~4 Nearby |
| Route legs (5–8, cached per endpoint pair) | ~8 Directions |
| Place Details on actual adds | ~3 |
| **Per trip** | **~27** |

Monthly totals at 100 users × 2.5 trips, against the **per-SKU** 10k free allowance:

| SKU | Monthly | Allowance | Headroom |
|---|---|---|---|
| Text Search | ~1,500 | 10,000 | 85% |
| Nearby Search | ~2,500 | 10,000 | 75% |
| Directions | ~2,000 | 10,000 | 80% |
| Place Details | ~750 | 10,000 | 92% |

**Verdict: the free tier is 10k events *per SKU*** — the binding SKU (Nearby) sits at ~25% usage. Stress cases: heavy users (3 trips + scope tweaks) ≈ 5k; worst case with zero caching ≈ 5.4k — still under. At ~10× traffic the quota guard degrades to the free stack mid-month: zero cost, zero breakage. **Projected bill at current scale: ₹0.**

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Key leakage → runaway usage | HTTP-referrer restriction to the Vercel domain; quota guard as second net |
| Billing surprise | 8k soft-cap per SKU → free stack, never a paid event |
| ToS drift | Places data only ever rendered on the Google map; free mode untouched |
| Regression risk in the map render | Free-mode MapLibre stays default; Google mode is opt-in via env key |

---

## 6. Open questions for discussion

1. **Adopt Google now, or stay on the free stack?** The simulation says ₹0 at current scale; the main argument *for* is data richness (ratings/photos/hours) on suggestion cards.
2. **Who builds it?** Phases A–B are self-contained and testable without the map swap; Phase C is the biggest chunk and could go to a contributor with a clear spec.
3. **Issue #5 (nearby filter chips):** please build the chips from the **new** category set — `sightseeing / nature / beach / temple / museum / food / hotel / pit stop` — not the old All/Food/Hotels/Fuel/ATMs list. Categories arrive on each hit as `hit.category`; detour distance via `detourKm(hit, anchors)` in `src/lib/geocode.ts`.
4. **Public view counters (follow-up from PR #10):** the RLS-safe fix stops the doomed writes, but counters only persist from the owner's visits. Proper fix: a `security definer` RPC or an insert-only events table — good candidate for a contributor issue.

