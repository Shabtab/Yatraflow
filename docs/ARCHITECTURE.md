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
                │                          notifications, published_itineraries,
                │                          purchase_orders, entitlements,
                │                          pub_funnel_events, covers (Storage)
                │                          — Row Level Security everywhere
                │
        External (free + keyless by default, network-failure-safe;
        Google Places is the one opt-in paid key):
          Open-Meteo geocoding  — location autocomplete + per-day weather
          OSRM demo server      — real road geometry on the map (haversine fallback)
          Wikipedia geosearch   — nearby POI ideas on the Map tab
          OSM Overpass          — auto-fed opening hours for picked POIs
          MapLibre / OpenFreeMap tiles — basemap display only (keyless)
          Google Places (opt-in key) — autocomplete / along-route search /
            opening hours; with it the suggestion pipeline is Google-only
          Mappls (opt-in key)  — India-best autocomplete upgrade in keyless mode
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
| `Expense` | Cost line | `perPerson?`, `optional?`, `paidBy?` (member who fronted it → balances card), attachable to a stop or day (feeds the Budget tab's per-day bars) |
| `StopSuggestion` | Group idea | votes (+1/−1), comments, `open → accepted/declined` lifecycle |
| `TripDecision` | Structured poll | options carry `costImpactInr`/`timeImpactMin`; `votesByUserId`; resolvable; `comments` thread (v0.64) |
| `PublishedItinerary` | Public share | slug id, `freeDayIndexes` for gated preview, `premiumPriceInr` (absent/0 = free), `coverImageUrl`, view/copy counters, `refreshedAt` staleness marker |
| `purchase_orders` / `Entitlement` | The money rail | a **paid** Razorpay order grants exactly one entitlement keyed (buyer, publication), with the price actually paid snapshotted on it — typed in `src/lib/payments.ts`; see §11's earnings contract |
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
5. Budget side: `computeTotals()` aggregates expenses (respecting `perPerson` and `optional` flags) and attributes every rupee to a day in `byDay` — day-tagged/stop-tagged expenses land on their day, journey fuel on the driving day, the drive home on the last day, unattached lines spread evenly; `countHotelNights()` infers accommodation nights from the timeline.

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

[`src/lib/ai.ts`](../src/lib/ai.ts) is the deterministic rule-based responder — and since v0.65 the **offline brain** of a two-layer companion:

- parses intent from a question ("less tiring", "cheaper", "rain", "airport by 5 PM"),
- computes real answers from engine simulations (busiest day, cheapest removable non-must-do stop, whether the schedule still meets a deadline),
- returns `{ text, assumptions }` and always cites the assumptions used, prefixed with the disclaimer that estimates are not live data.

The online layer is [`src/lib/aiProvider.ts`](../src/lib/aiProvider.ts). It holds a user-configured OpenAI-compatible endpoint, set in Profile. It also holds an optional Jev fast path, which picks which trip analysis to run. `ai.ts` stays the fallback when no endpoint is configured or the call fails. An "(LLM)"/"(offline)" badge says which brain answered. The drawer and its Profile settings ride behind `VITE_AI_COMPANION`, which is `on` in production since #236. A build without the flag simply omits both, with no error state. This keeps the companion honest (it never invents an offline answer), offline-capable, and free by default.

## 7. Location autocomplete

[`src/components/LocationInput.tsx`](../src/components/LocationInput.tsx) wraps a plain input with:

- **Provider facade** (`src/lib/geocode.ts`) — Google Places autocomplete when `VITE_GOOGLE_MAPS_API_KEY` is configured (picked hits resolve through one Place Details call), otherwise the keyless stack (Open-Meteo geocoding + Wikipedia, Mappls when its key is set); results biased to India via the `indiaOnly` prop.
- **280 ms debounce**, minimum 2 characters, abort-safe loading spinner.
- **Keyboard support:** ↑/↓ move highlight, Enter selects, Esc closes; mouse hover syncs highlight.
- **Coordinate capture:** selecting fires `onPick(PlaceHit)` with verified `latitude/longitude`. Callers use this to write real coordinates into stops/suggestions — which is why map routes and distance math improve when users pick from the list. Typing free-text is allowed but marks the field un-geocoded.

Used by: CreateTrip (start location + destination chips), StopEditor (stop location), suggestion form (Area), and Trip Settings (start + destinations).

The same geocoder powers a second capability in [`src/lib/geocode.ts`](../src/lib/geocode.ts): **auto-fed opening hours**. When a POI name is picked in the stop editor, `fetchOpeningHours()` runs an Overpass around-search (overpass-api.de mirror with a mail.ru fallback) and matches the result client-side by name (server-side name regex times out on public mirrors), then `parseOpeningHours()` tolerantly reads `"Mo-Sa 10:00-16:00"`, `"24/7"` and split-day formats into the editor's Opens-at / Closes-at fields. Manual entry still works for places OSM doesn't cover, and the fields remain editable after auto-fill.

## 8. Maps

[`src/components/mapcn/map.tsx`](../src/components/mapcn/map.tsx) is the [mapcn](https://github.com/AnmolSaini16/mapcn) registry component vendored with local adjustments (its single `@/lib/utils` import replaced by a local [`cn()`](../src/components/mapcn/cn.ts), and its default basemap styles pointed at [OpenFreeMap](https://openfreemap.org) instead of CARTO — issue #23). It renders MapLibre GL with OpenFreeMap vector basemaps (`styles/positron` light / `styles/dark`) that follow the light/dark theme automatically. The required OSM/OpenMapTiles credit is rendered by MapLibre's own attribution control: the style's `openmaptiles` source resolves the TileJSON at `tiles.openfreemap.org/planet`, which carries the attribution — no `customAttribution` injection is needed (doing so duplicates the credit).

[`src/components/TripMap.tsx`](../src/components/TripMap.tsx) builds the trip view on top:

- rejected stops filtered out; remaining stops grouped per day
- one colour-coded `MapRoute` polyline per day (palette of 7 day colours)
- numbered circular pin buttons open the stop editor on click
- auto `fitBounds` (padding 70, maxZoom 12) whenever the plotted set changes
- theme tracked via `MutationObserver` on `document.documentElement.dataset.theme`
- day filter chips + a legend

### Road geometry & nearby ideas

By default route lines follow **real roads**: [`src/lib/routing.ts`](../src/lib/routing.ts) requests geometry from the free OSRM demo server (`roadLegBetween`, `routePath`), measured one span-batched corridor chain at a time, with per-leg caching, instead of per-leg sequential calls. When OSRM is unreachable it silently falls back to straight-line segments — but schedule numbers in the engine stay on the haversine assumptions regardless, so estimates remain deterministic and offline-safe. The map legend credits OSRM/OSM and restates that plan timings are fixed-assumption estimates.

The Map tab also surfaces **nearby POI ideas**: gold 💡 markers for real Wikipedia-geosearch points of interest within 10 km of your route, with a "Nearby ideas" panel and a **+ Add** button (pick-a-day modal) that creates the stop through the normal impact-preview flow; already-added ideas show a ✓ badge.

For **long drives** the same panel switches from even-spaced tourist ranking to the fatigue-budget ride planner in [`src/lib/ridePlan.ts`](../src/lib/ridePlan.ts): the total distance is split into fatigue segments (stretch ~150 km, meal ~300 km, fuel on tank range, overnight ~550 km end-of-day), long/cross-day segments are anchored on key cities (Overpass `place=city|town` + Wikipedia populated places, population-weighted), and one best-fit real stop is assigned per segment — cards/tooltips carry the halt purpose, cumulative trip km, leg distance/time, detour and nearest city. Google mode adds exact along-route km from `routingSummaries` leg0; the free stack maps hits onto corridor anchors so the planner works with no keys. **Provider directive (Sep 2026, PR #73; amended 2026-09-15 for #189):** with a Google key configured the POI pipeline is Google-ONLY — the free stack serves keyless mode, with one narrow exception: the **night-halt town anchor** also asks OSM `place=city|town`, because Google's `locality` type bottoms out at village level in rural India (hamlets, no population) while OSM carries real towns with populations. `preferTownGrade` drops the hamlet-grade entries whenever towns are available, so a night halt lands on a town with a bed; failures and empty scans still render an honest no-match (round trips get a point-search supplement), and quota trips surface an explicit note.

### The Day Planner travel clock (PLAN-DAY-PLANNER, P1 milestone)

The fatigue cadence is **hours, not km**: the stretch cadence never waits longer than `STRETCH_CLOCK_MIN` (120 min) of wheel time — 150 km was ≈2 h at highway speed but 3.6 h at the engine's own blended 42 km/h. [`planDriveDays`](../src/lib/ridePlan.ts) derives the drive-day split a route **demands** from the wheel-hour cap (`WHEEL_HOURS_CAP` 10 h, packed 11 / relaxed 8.5, rain ×0.7 at 60%) — `dailyKmBudget = cap × journey speed`, load-balanced (`perDay = total / count`, never 585 + 115) — and the Map tab arms the split from that verdict, **not** from the planned day count. On top sits [`planTravelClock`](../src/lib/ridePlan.ts): fixed biological meal anchors (breakfast 08:00–09:30 fires only for pre-08:00 starts, lunch 12:00–14:30, tea 16:30–17:30, dinner 20:00–21:00 **ends the day**), the night halt placed where the day's km budget, dinner, or the wheel cap arrives — whichever first. Late starts get honest outcomes, never night driving: under 2 h of wheel time before `NIGHT_END` (23:00) is a **defer** proposal ("leave tomorrow 06:00"), a waking span too short for the anchor pattern is a **short hop** to a night halt, and a shrunk first day re-balances the remainder over the following days. When the route demands more days than planned, the Map tab proposes applying the split; declining is respected with a stated red fatigue verdict. Short trips stopped being silent: the 90 km floor yields to the 120-min clock rule (80 km of ghat crawl earns its stretch), the destination exclusion zone scales with journey length, and ¼/½/¾ fraction rows keep the strip useful below the fatigue floor. Derived day attribution flows everywhere: DRIVE/STAY/MIXED labels on timeline day headers, "Day N · after your night stop" chips on suggestion rows, return-leg chips on round trips, and the bill prices the bed at last — hotel stops gain a lodging line (bases × rooms × style rate, formula stated on the Budget tab; the night halt's minutes themselves are never charged to the day's detour budget; the halt PIN itself is still clock-derived — lodging-anchored placement is P1-C, still open). The §14 fixtures in [`tests/dayPlanner.test.ts`](../tests/dayPlanner.test.ts) are the spec.

## 9. Routing & pages

No router library. [`App.tsx`](../src/App.tsx) parses `location.hash` into a route string and switches pages:

| Route | Page |
|---|---|
| `/` | Landing |
| `/auth` | Login/signup |
| `/trips` | My trips |
| `/new` | Create trip |
| `/created/:id` | The moment-after screen (crew invites, first warnings) |
| `/trip/:id` | Trip workspace (tabbed) |
| `/pub/:slug` | Published itinerary |
| `/explore` | Public gallery |
| `/purchases` | A buyer's shelf of unlocked plans |
| `/creator/:id` | Creator public page |
| `/creator-hub` | Creator dashboard |
| `/profile` | Profile |
| `/join/:code` | Join-trip flow via short invite code |
| `/invite/:id` | Join-trip flow (legacy UUID links, still honoured) |
| `/admin` | Masteradmin console (never linked) |
| `/share/<payload>` | Self-contained snapshot import |

Navigation is a plain `onNavigate(route)` callback that sets `location.hash`. Hash routing means zero server config on any static host.

## 10. Theming

Single stylesheet [`src/styles.css`](../src/styles.css). The token system (primitive → semantic → component layers, plus the button/input state matrix) is documented in [DESIGN_TOKENS.md](../DESIGN_TOKENS.md). The architecture diagram is generated from [`diagrams/yatraflow-architecture.json`](diagrams/yatraflow-architecture.json) — the `.html` output is generated, not tracked; regenerate it, don't hand-edit. Dark mode flips CSS custom properties via `data-theme="dark"` on `<html>`; a toggle persists the choice and map basemaps follow via the observer described above. Mobile-first breakpoints at 720 px enforce ≥40 px touch targets and 16 px inputs (prevents iOS focus zoom).

## 11. Swapping things out

The architecture isolates its shortcuts behind small interfaces:

| Today | Swap to | Touch points |
|---|---|---|
| Supabase | Firebase / self-hosted REST | Only `store.ts` internals + `lib/supabase.ts` — mutation signatures can stay identical |
| Open-Meteo autocomplete | Google Places (**landed**, via the `geocode.ts` provider facade) / Mapbox | a new provider goes into `src/lib/providers/`, not `LocationInput.tsx` |
| Haversine × 1.25 legs | OSRM/Google Directions real routing | Engine stays haversine by design (deterministic, offline-safe); map road shape already comes from `src/lib/routing.ts` (OSRM + `routePath`), whose geometry can later feed `MapRoute` |
| OSRM map geometry | Google Directions / Mapbox Directions | `src/lib/routing.ts` only (callers like `TripMap.tsx` are unaffected) |
| Open-Meteo weather | Any forecast provider | `src/lib/weather.ts` (`fetchDailyWeather`) |
| Wikipedia geosearch POIs | Google Places nearby (**landed** — Google-only with a key) | `TripMap.tsx` + `src/lib/providers/google.ts` |
| OSM Overpass opening hours | Google Places details (**landed** — hours ride the same Places events) | `src/lib/geocode.ts` (`fetchOpeningHours`) |
| Supabase email/password auth | OAuth (Google, phone OTP) | `store.ts` `login/signup` + Auth page UI — RLS and data model unchanged |
| Rule-based AI | LLM with engine grounding (**landed**, v0.65) | `src/lib/aiProvider.ts`; `ai.ts` stays the offline fallback |
| Razorpay checkout | Stripe / Paddle / bundled payments | `src/lib/unlock.ts` + `api/checkout.js`, `api/payments-verify.js`, `api/payments-webhook.js`; `premiumPriceInr` on `PublishedItinerary` is the price the paywall charges |
| Derived payout runs (no rail) | Scheduled payouts + KYC | Profile's Earnings tab — see "Creator earnings contract (M7)" below |

### Creator earnings contract (M7)

The Earnings tab (Profile · My publications) shipped **before** payments so the
surface never needed redesigning when Razorpay landed (v0.61). Its fixed shape:

- **KPI tiles:** Lifetime gross/net (a toggle picks the basis — I-10) · Sales · Next
  payout (the next Friday's run date once the balance clears the ₹500 minimum,
  `—` below it — I-9).
- **Ledger columns (final):** Payout period · Sales · Platform fee · Net payout.
  Shipped as **Payout runs** (`payoutPeriods()`, I-9): Rows are DERIVED by
  grouping the sales ledger into the Friday run each sale lands on — Run · Sales
  · Gross · Fee · Net · Status — rather than inserted by a payout job, because
  nothing disburses. Status therefore reads `Scheduled`, `Owed — not disbursed`
  or `Under ₹500 — rolls over`; it never says paid, and the fee column reuses
  the same per-sale attribution so the runs add up to the ledger exactly.
- **Pricing states the split:** the publish editor's price field names the floor
  a creator keeps on a sale at that price (`netOfFeeInr`, I-13) — a price on its
  own cannot know a lifetime gross, so it promises the least, which is what the
  first tier charges.
- **Projection view (v0.38):** `projectEarnings()` in `src/lib/earnings.ts` —
  price × forks per priced publication, labeled as not-money.
- **Platform fee (real as of I-13, 2026-09-21):** a MARGINAL ladder over a
  creator's lifetime gross — `PLATFORM_FEE_TIERS` in `src/lib/earnings.ts`,
  15% to ₹25,000 then 10%. Per-sale fees are attributed oldest-first (the sale
  that crossed the threshold carries the change) and every total is the sum of
  its rows, never the ladder applied to the total. Payout RUNS are still not
  automated: there is no payouts table and no gateway payout API, so
  `payoutStatus()` is a schedule the ledger is built around and the UI says so.

**What M7 shipped, and what it still does not have.** Shipped (v0.61.0, with the
fee model following as I-13): the redacting `get_public_trip` read path and the
narrowed `trips read` policy, so locked days are stubs **at the wire** rather
than blurred in the client; `purchase_orders` with Razorpay order/payment ids and
a webhook log carrying idempotency keys; an `entitlements` table so premium
gating persists across devices; the signature-verified confirm that is the only
way an entitlement is granted; a refund path that revokes it
(`revoke_refunded_entitlement`); and the platform-fee ladder
(`PLATFORM_FEE_TIERS`).

**Still absent by design:** `payouts` (creator, period, gross/fees/net, status, UTR
reference) and payout-account/KYC fields on profiles, which is why nothing
disburses and the runs ledger is derived rather than read; and GST/TCS
registration. Since 2026-09-21 a `pub_funnel_events` log
(`20260921_pub_funnel_events.sql`, retention-trimmed) records every publication
view and fork beside its counter, so the creator hub's per-publication
view→fork→unlock funnel reads real events (unlocks come from the entitlements
ledger); the admin console's own funnel still derives from the hydrated cache —
the piece E3/E8 track. The ledger's
empty state and the projection footnote say exactly this to the user.

## 12. Gotchas & hard-won lessons

- **TDZ ordering in `store.ts`:** module-level initialisers run top-to-bottom — `load()` calls `persist()` which reads `saveTimer`, so `saveTimer` must be declared *above* `let db = load()`. TypeScript strict does not catch all such patterns, and the crash happens before React mounts (so ErrorBoundary can't catch it either). Symptom was a blank white screen.
- **ErrorBoundary limits:** class-component error boundaries catch render errors, never import-time/module-evaluation crashes.
- **Debugging import-time crashes headlessly:** `vite`'s `ssrLoadModule('/src/App.tsx')` from a Node script surfaces module-graph errors without a browser.
- **Vendoring mapcn without Tailwind/shadcn:** extract `files[0].content` from the registry JSON, rewrite `@/lib/utils` imports to a local shim — done once, committed, no Tailwind pipeline needed.
- **Git Bash on Windows:** `/tmp` resolves outside the project so Node scripts can't resolve modules there — keep scratch files project-relative.
