# YatraFlow Architecture

A guided tour of how the app works internally — the data model, the estimation engines, the store, and the reasoning behind each choice. Read [the README](../README.md) first for the feature overview.

---

## Table of contents

1. [Big picture](#1-big-picture)
2. [Data model](#2-data-model)
3. [The store](#3-the-store)
4. [The engine (scheduling & budget)](#4-the-engine-scheduling--budget)
5. [Impact Preview](#5-impact-preview)
6. [AI companion](#6-ai-companion)
7. [Location autocomplete](#7-location-autocomplete)
8. [Maps](#8-maps)
9. [Routing & pages](#9-routing--pages)
10. [Theming](#10-theming)
11. [Swapping things out](#11-swapping-things-out)
12. [Gotchas & hard-won lessons](#12-gotchas--hard-won-lessons)

---

## 1. Big picture

```
┌───────────────────────────── Browser ─────────────────────────────┐
│                                                                    │
│  Pages (React)          Lib (pure functions)       Store           │
│  ┌──────────────┐      ┌──────────────────┐     ┌─────────────┐   │
│  │ TripWorkspace│─────▶│ engine.ts        │◀────│ store.ts    │   │
│  │ CreateTrip   │      │ impact.ts        │     │ (reactive   │   │
│  │ Explore …    │      │ ai.ts            │     │  cache)     │   │
│  └──────────────┘      └──────────────────┘     └──────┬──────┘   │
│         │                       ▲                      │          │
│         ▼                       │                      ▼          │
│  components (map, modals)   geo.ts          Supabase JS client    │
└────────────────────────────────────────────────────────────────────┘
                │                                   │
                │                                   ▼
                │                        Supabase (Postgres + Auth):
                │                          profiles, trips, trip_members,
                │                          suggestions, decisions, activity,
                │                          notifications, published_itineraries
                │                          — Row Level Security everywhere
                │
        External (all free, keyless, network-failure-safe):
          Open-Meteo geocoding  — location autocomplete + per-day weather
          OSRM demo server      — real road geometry on the map (haversine fallback)
          Wikipedia geosearch   — nearby POI ideas on the Map tab
          OSM Overpass          — auto-fed opening hours for picked POIs
          MapLibre / OpenFreeMap tiles — basemap display only (keyless)
```

Key properties:

- **Supabase-backed, cache-first.** The store hydrates an in-memory cache from Postgres on login; every mutation updates the cache synchronously (instant UI) and fires the Supabase write in the background. Authorization is enforced by Row Level Security, not UI checks.
- **Pure-function core.** `src/lib/` (except `supabase.ts`) contains no React and no I/O — every estimate is a deterministic function of `(trip data, assumptions)`. That's what makes estimates *transparent* and testable.
- **Coordinates are plain numbers** (`lat`/`lng` on stops), so any maps provider can consume them later.

## 2. Data model

All entities live in [`src/data/types.ts`](../src/data/types.ts). The important ones:

| Entity | Purpose | Notable fields |
|---|---|---|
| `User` | Account + profile | id comes from Supabase Auth; `UserProfile.languages` ready for i18n |
| `Trip` | A plan | `startLocation`, ordered `destinations[]`, `transportMode`, `budgetPerPersonInr`, `fixedCommitments[]`, `days[]`, `expenses[]`, optional `members[]` |
| `ItineraryDay` | One day of the plan | `index` (0-based), ordered `stops[]` |
| `ItineraryStop` | One visit | `visitMinutes`, `openTime/closeTime`, `entryFeeInrPerPerson`, `transportCostInrTotal`, `priority`, `status`, `orderInDay`, geocoded `lat/lng` |
| `FixedCommitment` | Untouchable anchor | hotel check-ins / train & flight departures with day + time — the scheduler protects these |
| `Expense` | Cost line | `perPerson?`, `optional?`, attachable to a stop or day |
| `StopSuggestion` | Group idea | votes (+1/−1), comments, `open → accepted/declined` lifecycle |
| `TripDecision` | Structured poll | options carry `costImpactInr`/`timeImpactMin`; `votesByUserId`; resolvable |
| `PublishedItinerary` | Public share | slug id, `freeDayIndexes` for gated preview, view/copy counters |
| `ActivityEntry` / `Notification` | Social plumbing | per-trip feed / per-user inbox |

Design notes:

- **Enums are `as const` tuples** (`TRANSPORT_MODES`, `TRAVEL_STYLES`, `STOP_CATEGORIES`…) so UI dropdowns and types stay in sync from one source.
- Adding an Indian destination, transport mode or language requires **no schema change** — they're data, not structure.

## 3. The store

[`src/store/store.ts`](../src/store/store.ts) is a hand-rolled reactive store backed by Supabase:

```ts
let cache: DB = { users: [], trips: [], suggestions: [], … , sessionUserId: null }
const listeners = new Set<() => void>()
let initialized = false
```

- **Read:** components call `useDb()` which wraps React's `useSyncExternalStore(subscribe, getSnapshot)` — no context provider needed anywhere.
- **Init:** `App` calls `init()` once on mount. It subscribes to `supabase.auth.onAuthStateChange` and hydrates the cache for the signed-in user (profiles, trips + members, suggestions, decisions, activity, notifications, published itineraries — all in one `Promise.all`). Forgetting to call `init()` means `me` is never set and every route falls through to the landing page — a real bug that shipped once.
- **Write:** exported mutation functions (`createTrip`, `addStop`, `voteSuggestion`, …) update the cache synchronously and notify listeners (instant UI), then fire-and-forget the Supabase write. Trip internals (days/stops/expenses/fixed commitments) persist as JSONB on the trip row via `persistTripField`; failed writes surface a toast and the cache self-corrects on the next hydration.
- **Ids:** top-level table ids (trips, suggestions, decisions, activity, notifications) are real UUIDs (`crypto.randomUUID`) because Postgres PK/FK columns are `uuid`. Ids inside JSONB blobs (stops, days, expenses, comments) keep readable prefixed ids from `seed.ts`'s `uid()`. Client-generated ids are sent with inserts so the cache and DB rows always agree.
- **Session:** Supabase Auth persists the session (`persistSession` + `autoRefreshToken`); the store derives `sessionUserId` from the auth event and re-hydrates on every sign-in/sign-out.
- **Seeding:** a new account with zero trips gets the Kerala demo trip on first login (`seedDemoFor`); My Trips also exposes a manual "🚀 Load demo trips" button (`addDemoTrips`).
- **Roles:** trip membership is owner > editor > commenter > viewer; `canEdit()` gates mutations in the UI, and Postgres RLS enforces the same boundary server-side.

Seed content ([`src/data/seed.ts`](../src/data/seed.ts)): realistic Indian demo trips (Kerala road trip with houseboat commitment, Goa long weekend, Rajasthan heritage circuit) — used to seed new accounts and power the manual demo button.

## 4. The engine

[`src/lib/engine.ts`](../src/lib/engine.ts) answers "is this plan realistic and affordable?" using **declared assumptions only**:

```ts
// per transport mode
car: speed 42 kmph, ₹9/km · motorcycle: 44, ₹4.5 · taxi: 38, ₹16 · bus: 34, ₹2.2
train: 55, ₹1.6 · flight: 320, ₹6.5 · mixed: 45, ₹8
// plus universal: +15 min buffer per stop, 60 min meal break,
// planning day window 08:30–20:00, roads are ~1.25× straight-line distance
```

Pipeline per day:

1. `originOf(trip, i)` picks where the day starts (previous day's last stop, else trip start).
2. Consecutive stops are joined by `legBetween()` = haversine × 1.25 road factor ÷ mode speed × 60 min + 10 min city-traffic pad.
3. `simulateDay()` walks the clock forward: travel + visit duration + buffers, producing arrival/departure times per stop, total distance, total travel minutes and end-of-day time.
4. `collectWarnings()` flags: arrivals after `closeTime`, days ending past `dayEnd`, fixed-commitment conflicts, excessive backtracking, over-stuffed days.
5. Budget side: `computeTotals()` aggregates expenses (respecting `perPerson` and `optional` flags); `countHotelNights()` infers accommodation nights from the timeline.

Every UI surface that shows an estimate also shows `getAssumptions()` output — speeds, ₹/km, buffers — so users can judge the numbers instead of trusting them blindly. This is a hard product rule: **no estimate without its assumptions on screen.**

## 5. Impact Preview

[`src/lib/impact.ts`](../src/lib/impact.ts) implements "what happens if…?" — it deep-clones the current trip, applies the hypothetical change (add/remove/reorder/edit/move-day), re-runs the engine on both versions and diffs:

```ts
interface ImpactResult {
  kind; dayIndex;
  timeDeltaMin; distanceDeltaKm; costDeltaInr;
  arrivalChanges: { stopTitle; from; to }[];
  newWarnings; clearedWarnings;   // ScheduleWarning diff keyed code+title
  tooBusy; backtracking;
  commitmentConflicts; openingHoursIssues;
}
```

The UI shows this panel *before* a suggestion is accepted or a risky edit lands — you see "+48 min travel, +₹340, misses the 12:00 houseboat" before committing, not after.

## 6. AI companion

[`src/lib/ai.ts`](../src/lib/ai.ts) is deliberately **not** an LLM call. It's a deterministic rule-based responder that:

- parses intent from a question ("less tiring", "cheaper", "rain", "airport by 5 PM"),
- computes real answers from engine simulations (busiest day, cheapest removable non-must-do stop, whether the schedule still meets a deadline),
- returns `{ text, assumptions }` and always cites the assumptions used, prefixed with the disclaimer that estimates are not live data.

This keeps the MVP honest (nothing hallucinated), offline-capable, and free. Swapping in a real LLM later means replacing `answerQuestion()` while feeding it the same engine outputs as grounding.

## 7. Location autocomplete

[`src/components/LocationInput.tsx`](../src/components/LocationInput.tsx) wraps a plain input with:

- **Open-Meteo geocoding** (`geocoding-api.open-meteo.com/v1/search?name=…&countryCode=IN`) — free, no key, results biased to India via the `indiaOnly` prop.
- **280 ms debounce**, minimum 2 characters, abort-safe loading spinner.
- **Keyboard support:** ↑/↓ move highlight, Enter selects, Esc closes; mouse hover syncs highlight.
- **Coordinate capture:** selecting fires `onPick(PlaceHit)` with verified `latitude/longitude`. Callers use this to write real coordinates into stops/suggestions — which is why map routes and distance math improve when users pick from the list. Typing free-text is allowed but marks the field un-geocoded.

Used by: CreateTrip (start location + destination chips), StopEditor (stop location), suggestion form (Area), and Trip Settings (start + destinations).

The same geocoder powers a second capability in [`src/lib/geocode.ts`](../src/lib/geocode.ts): **auto-fed opening hours**. When a POI name is picked in the stop editor, `fetchOpeningHours()` runs an Overpass around-search (overpass-api.de mirror with a mail.ru fallback) and matches the result client-side by name (server-side name regex times out on public mirrors), then `parseOpeningHours()` tolerantly reads `"Mo-Sa 10:00-16:00"`, `"24/7"` and split-day formats into the editor's Opens-at / Closes-at fields. Manual entry still works for places OSM doesn't cover, and the fields remain editable after auto-fill.

## 8. Maps

[`src/components/mapcn/map.tsx`](../src/components/mapcn/map.tsx) is the [mapcn](https://github.com/AnmolSaini16/mapcn) registry component vendored with local adjustments (its single `@/lib/utils` import replaced by a local [`cn()`](../src/components/mapcn/cn.ts), and its default basemap styles pointed at [OpenFreeMap](https://openfreemap.org) instead of CARTO — issue #23). It renders MapLibre GL with OpenFreeMap vector basemaps (`styles/positron` light / `styles/dark`) that follow the light/dark theme automatically, and injects `BASEMAP_ATTRIBUTION` as `attributionControl.customAttribution` because those styles ship without a `sources.*.attribution` field.

[`src/components/TripMap.tsx`](../src/components/TripMap.tsx) builds the trip view on top:

- rejected stops filtered out; remaining stops grouped per day
- one colour-coded `MapRoute` polyline per day (palette of 7 day colours)
- numbered circular pin buttons open the stop editor on click
- auto `fitBounds` (padding 70, maxZoom 12) whenever the plotted set changes
- theme tracked via `MutationObserver` on `document.documentElement.dataset.theme`
- day filter chips + a legend

### Road geometry & nearby ideas

By default route lines follow **real roads**: [`src/lib/routing.ts`](../src/lib/routing.ts) requests geometry from the free OSRM demo server (`roadLegBetween`, `routePath`), simplifying and de-duplicating per day and calling the server sequentially to respect the demo rate limit. When OSRM is unreachable it silently falls back to straight-line segments — but schedule numbers in the engine stay on the haversine assumptions regardless, so estimates remain deterministic and offline-safe. The map legend credits OSRM/OSM and restates that plan timings are fixed-assumption estimates.

The Map tab also surfaces **nearby POI ideas**: gold 💡 markers for real Wikipedia-geosearch points of interest within 10 km of your route, with a "Nearby ideas" panel and a **+ Add** button (pick-a-day modal) that creates the stop through the normal impact-preview flow; already-added ideas show a ✓ badge.

## 9. Routing & pages

No router library. [`App.tsx`](../src/App.tsx) parses `location.hash` into a route string and switches pages:

| Route | Page |
|---|---|
| `/` | Landing |
| `/auth` | Login/signup |
| `/trips` | My trips |
| `/create` | Create trip wizard |
| `/trip/:id` | Trip workspace (tabbed) |
| `/pub/:slug` | Published itinerary |
| `/explore` | Public gallery |
| `/profile` | Profile |
| `/invite/:id` | Join-trip flow |

Navigation is a plain `onNavigate(route)` callback that sets `location.hash`. Hash routing means zero server config on any static host.

## 10. Theming

Single stylesheet [`src/styles.css`](../src/styles.css). The token system (primitive → semantic → component layers, plus the button/input state matrix) is documented in [DESIGN_TOKENS.md](../DESIGN_TOKENS.md). The architecture diagram is generated from [`diagrams/yatraflow-architecture.json`](diagrams/yatraflow-architecture.json) — the `.html` output is generated, not tracked; regenerate it, don't hand-edit. Dark mode flips CSS custom properties via `data-theme="dark"` on `<html>`; a toggle persists the choice and map basemaps follow via the observer described above. Mobile-first breakpoints at 720 px enforce ≥44 px touch targets and 16 px inputs (prevents iOS focus zoom).

## 11. Swapping things out

The architecture isolates its shortcuts behind small interfaces:

| Today | Swap to | Touch points |
|---|---|---|
| Supabase | Firebase / self-hosted REST | Only `store.ts` internals + `lib/supabase.ts` — mutation signatures can stay identical |
| Open-Meteo autocomplete | Google Places / Mapbox | `LocationInput.tsx` only |
| Haversine × 1.25 legs | OSRM/Google Directions real routing | Engine stays haversine by design (deterministic, offline-safe); map road shape already comes from `src/lib/routing.ts` (OSRM + `routePath`), whose geometry can later feed `MapRoute` |
| OSRM map geometry | Google Directions / Mapbox Directions | `src/lib/routing.ts` only (callers like `TripMap.tsx` are unaffected) |
| Open-Meteo weather | Any forecast provider | `src/lib/weather.ts` (`fetchDailyWeather`) |
| Wikipedia geosearch POIs | Google Places nearby | `TripMap.tsx` Nearby-ideas panel + `src/lib/geocode.ts` |
| OSM Overpass opening hours | Google Places details | `src/lib/geocode.ts` (`fetchOpeningHours`) |
| Supabase email/password auth | OAuth (Google, phone OTP) | `store.ts` `login/signup` + Auth page UI — RLS and data model unchanged |
| Rule-based AI | LLM with engine grounding | `answerQuestion()` in `ai.ts` |
| Placeholder payment buttons | Razorpay/etc. | Share tab CTAs + `premiumPriceInr` on `PublishedItinerary` |

## 12. Gotchas & hard-won lessons

- **TDZ ordering in `store.ts`:** module-level initialisers run top-to-bottom — `load()` calls `persist()` which reads `saveTimer`, so `saveTimer` must be declared *above* `let db = load()`. TypeScript strict does not catch all such patterns, and the crash happens before React mounts (so ErrorBoundary can't catch it either). Symptom was a blank white screen.
- **ErrorBoundary limits:** class-component error boundaries catch render errors, never import-time/module-evaluation crashes.
- **Debugging import-time crashes headlessly:** `vite`'s `ssrLoadModule('/src/App.tsx')` from a Node script surfaces module-graph errors without a browser.
- **Vendoring mapcn without Tailwind/shadcn:** extract `files[0].content` from the registry JSON, rewrite `@/lib/utils` imports to a local shim — done once, committed, no Tailwind pipeline needed.
- **Git Bash on Windows:** `/tmp` resolves outside the project so Node scripts can't resolve modules there — keep scratch files project-relative.
