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

### Scope — only the two things Google does best for us
We use Google **only for data**: (1) place autocomplete with coordinates for location picking, and (2) nearby POI data fed into our tourist engine. Routing stays on OSRM, weather on Open-Meteo, hours on Overpass, rendering on MapLibre. No Directions API, no Place Details for hours, no Google map rewrite.

### The compliance caveat (decide consciously)
Google Places ToS expects Places results to be displayed on a Google map and not blended with other providers' data. Plotting Google POIs on MapLibre and merging them into our ranked list is a gray zone — realistically unenforced for small apps, but it's a terms question, not a cost question. Mitigation if we ever want strict compliance: render the Map tab on a Google map, or keep nearby on the free stack and use Google only for autocomplete (explicitly allowed mapless).

### Verified India SKUs (pricing-india, updated 2026-08-25 — India billing account)
| SKU | Free cap/month | Beyond cap |
|---|---|---|
| Autocomplete Requests (India) | **70,000** | $0.85/1k |
| Autocomplete Session Usage (India) | **Unlimited** | — |
| **Text Search Pro (India)** — incl. **Search Along Route** | **35,000** | $9.60/1k |
| Nearby Search Pro (India) | **35,000** | $9.60/1k |
| Place Details Essentials/Pro (India) | 70,000 / 35,000 | $1.50 / $5.10 per 1k |
| Geocoding (India) | 70,000 | $1.50/1k |

**Killer feature:** Places **Search Along Route** takes our existing OSRM route polyline and returns places biased along the entire route with real detour summaries (`routingSummaries`) in **1 request** — a native version of our whole corridor-sampling + "~N km off route" concept. 1–3 events per scan instead of 6 Nearby calls.

### Implementation shape (~1.5 days)
- **Phase A — provider facade (~1 d):** `src/lib/providers/free.ts` (today's engines, untouched) + `src/lib/providers/google.ts` (Places Autocomplete for location picking; Text Search with `searchAlongRouteParameters` for nearby ideas). `geocode.ts` becomes a facade: Google first → free stack on key-absence, error, or quota exhaustion. All Phase 1–4 logic untouched. `resolveHitCoords`/Nominatim fallback deleted (Google returns coordinates).
- **Phase B — quota guard (~0.5 d):** monthly per-SKU counters in localStorage, soft-cap at ~28,000 (80% of the 35k free allowance) → silently falls back to the free stack for the rest of the month. Key restricted by HTTP-referrer to the Vercel domain.

**What we'd gain:** India-best autocomplete with coordinates for free; richer en-route POI data with native detour ranking; no CORS proxy for the Google path.
**What we'd keep:** everything — the free stack remains the automatic fallback; the app behaves exactly as today when the key is absent.

---

## 4. Quota simulation — 100 users × 2–3 trips / month

Per-trip events (Google mode, with the Phase-B optimizations):

| Action | SKU events |
|---|---|
| Trip setup (start + 2–3 destinations, debounced picks) | ~6 Autocomplete Requests |
| First map view (Search Along Route: 1 request × 2–3 category queries) | ~3 Text Search Pro |
| Scope tweaks / later views (per anchor+scope cache) | ~2 Text Search Pro |
| Route legs / hours / weather | 0 (OSRM, Overpass, Open-Meteo — all free) |
| **Per trip** | **~11** |

Monthly totals at 100 users × 2.5 trips, against the **India per-SKU free allowances**:

| SKU | Monthly | Allowance | Headroom |
|---|---|---|---|
| Text Search Pro (Search Along Route) | ~1,250 | 35,000 | **96%** |
| Autocomplete Requests | ~1,500 | 70,000 | **98%** |

**Verdict:** with India billing, the binding SKU (Text Search Pro) sits at **~4% of its 35k free allowance**. Stress cases: heavy users (3 trips, scope tweaks ×2) ≈ 2,000 (6%); worst case with zero caching ≈ 3,600 (10%); **10× growth (1,000 users) ≈ 12,500 — still 64% headroom**. The quota guard (28k soft-cap) becomes near-unreachable insurance. **Projected bill at current scale and well beyond: ₹0.**

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Key leakage → runaway usage | HTTP-referrer restriction to the Vercel domain; quota guard as second net |
| Billing surprise | 28k soft-cap per SKU → free stack, never a paid event (overage would be $9.60/1k if the guard were ever off) |
| Places ToS (display on non-Google map + blending) | Documented gray zone — decide consciously; strict-compliance option: Google-only autocomplete (mapless-allowed), nearby stays on free stack |

---

## 6. Open questions for discussion

1. **Adopt Google now, or stay on the free stack?** The simulation says ₹0 with huge headroom (India SKUs verified); the main argument *for* is India-best autocomplete + native Search-Along-Route detour ranking. The main argument *against* is the Places ToS gray zone on MapLibre display/blending.
2. **Who builds it?** Phases A–B (~1.5 days) are self-contained and testable without touching the map; a good contributor task with a clear spec.
3. **Issue #5 (nearby filter chips):** please build the chips from the **new** category set — `sightseeing / nature / beach / temple / museum / food / hotel / pit stop` — not the old All/Food/Hotels/Fuel/ATMs list. Categories arrive on each hit as `hit.category`; detour distance via `detourKm(hit, anchors)` in `src/lib/geocode.ts`.
4. **Public view counters (follow-up from PR #10):** the RLS-safe fix stops the doomed writes, but counters only persist from the owner's visits. Proper fix: a `security definer` RPC or an insert-only events table — good candidate for a contributor issue.

