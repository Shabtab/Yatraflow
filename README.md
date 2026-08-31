# YatraFlow 🇮🇳

**Plan Indian trips together — not in a chaotic group chat.**

YatraFlow is a collaborative travel-planning web app built India-first: real multi-day itineraries, transparent cost & time estimates in ₹, group voting on stops, decisions that settle debates, and interactive maps of your route.

🌐 **Live:** https://yatraflow-blond.vercel.app
📦 **Repo:** https://github.com/hasnaina955/Yatraflow

---

## ✨ Features

### Plan
- **Create trips** with start location, ordered destinations (real place autocomplete), dates, crew size, transport mode, budget and travel style
- **Day-by-day timeline** — add/edit/reorder/move stops between days, each with visit duration, opening hours, entry fees, priority (`must-do` / `nice-to-have` / `optional`) and status (`suggested` → `confirmed` / `rejected`); rendered on a time rail with arrival/departure pills, per-day progress, collapsible headers, route sparklines and cross-day drag-and-drop
- **Leg-aware stop insertion** — picking a place auto-detects your current location and next destination, fills real road distance/travel time/fuel cost, and computes arrival from a departure time you can adjust
- **Fuel-accurate costs** — car/bike trips can state a fuel economy (km/L, at creation or in trip settings) and optionally their local pump price (₹/L, defaulting to the indicative ₹105/L national average); legs are then priced as `distance ÷ economy × price` (litres × price, surfaced on screen) instead of a blended ₹/km rate, and the return drive to the start is included by default (toggleable for one-way trips)
- **One journey per day — however far you drive** — every day is modelled as a single journey (start → halts/visits → destination with a real arrival clock), so there are no special-cased "long ride" modes. The day header shows the true drive (`Kolkata → Mandarmani · ~167 km · drive 2h 17m · start 08:30 → ends ~11:07`), pure-travel anchors render as **travelling strips** (departure → arrival, duration, distance, fuel-aware cost), and the travel panel lets you set the departure time, **add halts on any driving day** (with a live ETA preview) and **suggest real stop spots** along the corridor (food/fuel/rest from open map sources). Stay days show a plain "Based in …" marker with no phantom drive stats, the drive home appears only on the return day, and totals never double-count it. A fatigue warning still flags 7h+ wheel-time days with no halt.
- **Location autocomplete** on every location input — [Mappls](https://about.mappls.com/api/) (MapmyIndia) suggestions when `VITE_MAPPLS_KEY` is configured, with keyless fallbacks to the free [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api) + Wikipedia. Mappls calls are proxied same-origin (Vercel rewrite in production, Vite dev proxy locally) because their APIs send no CORS headers. Picking a suggestion pins the stop to real coordinates so maps and distance estimates stay accurate.
- **Context-aware opening hours** — the stop editor only shows open/close times where they make sense (POIs, temples, food, hotels…), never for a whole city/town.
- **Fatigue-aware stoppage suggestions** — a real journey planner (`src/lib/ridePlan.ts`) splits any drive into fatigue segments (stretch ~every 150 km/2 h, meal ~300 km, fuel on tank range, overnight ~550 km end-of-day on long routes) and assigns the best real stop per segment by purpose-fit, detour and distance-to-target — with long/interstate stops anchored on **key cities** (OSM populated places + Wikipedia, population-weighted) so an interstate night halt lands in a big city, not a hamlet. Every card shows what the stop is for, how far it is into the trip, drive time since the last halt, detour and the nearest city; adding one writes the matching stop type (food/rest/fuel/hotel) automatically. The Map tab's nearby ideas and empty-day suggestions cover attractions, restaurants, hotels, fuel pumps and ATMs from live OpenStreetMap, Wikipedia and Mappls data — every pin at a **verified coordinate** (never a guessed same-name match in the wrong state), anchored on stops spread along your route.
- **Interactive map** (MapLibre via [mapcn](https://github.com/AnmolSaini16/mapcn)) — numbered stop pins per day, colour-coded route lines, auto-fit bounds, day filter chips, light/dark basemaps from [OpenFreeMap](https://openfreemap.org) (keyless, no request caps, commercial use allowed)

### Estimate (transparently)
- **Schedule engine** — simulates each day leg-by-leg using real road distances and durations from OSRM (haversine × road factor as the offline fallback), per-mode average speeds and ₹/km costs. Shows arrival times, flags tight schedules, missed fixed commitments (hotel check-ins, train departures) and stops that arrive after closing time
- **Budget engine** — running totals split per-person vs group, essential vs optional, category breakdown, hotel-night counting
- **Impact Preview** — before you accept a suggestion or edit a stop, see the delta: ±time, ±distance, ±cost, new/cleared warnings, backtracking detection
- Every estimate states its assumptions on-screen. **No fake live traffic or prices — ever.**

### Collaborate
- **Invite by link** — friends join as owner / editor / commenter / viewer
- **Suggestions** — anyone can propose a stop; the group upvotes/downvotes and comments; owners accept straight into the timeline
- **Decisions** — structured polls ("Beach day at Varkala or backwaters cruise?") with per-option cost/time impact, votes, resolve button
- **Activity feed & notifications** — who did what, when
- **AI companion drawer** — deterministic, trip-data-grounded answers ("Make Day 2 less tiring", "Can we reach the airport by 5 PM?") that always cite the assumptions used

### Share
- **Publish itineraries** to the public **Explore** gallery with tagline, best season, travel tips and warnings
- Readers can **copy any published trip** into their own plans in one click and make it theirs
- Free-preview days with locked later days (payments are *not* part of this MVP)
- **Export / import** any trip as a JSON file, or share a self-contained **snapshot link** (`#/share/<payload>`) — the whole itinerary is compressed into the URL so the link works logged-out with zero server storage
- **Auto-fed opening hours**: picking a POI in the stop editor looks up its real open/close times from OpenStreetMap's free Overpass API and pre-fills them (still fully editable)

### Enrich on the map
- **Real road routing**: route lines between stops follow actual roads via the free OSRM demo server, with a silent straight-line fallback when it's unreachable — planning never blocks on the network
- **Weather along the route**: per-day forecasts from Open-Meteo (free, keyless) — icon, min/max °C and rain chance, with wet days flagged and a nudge to reshuffle weather-sensitive stops
- **Nearby POI ideas**: real points of interest within 10 km of your route from OpenStreetMap (Overpass), Wikipedia geosearch and Mappls — verified coordinates only, with a "+ Add" button that drops them into the timeline through the normal impact-preview flow

---

## 🚀 Getting started

```bash
git clone https://github.com/hasnaina955/Yatraflow.git
cd Yatraflow
npm install

# Configure Supabase (create a free project at supabase.com, then:)
cp .env.example .env.local   # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
# Apply the database schema (SQL editor in the Supabase dashboard, or:)
#   node scripts/apply-schema.mjs   (with PGCONN set to your Postgres URL)

npm run dev        # → http://localhost:5173
```

**One-command start (Windows):** `./scripts/start.ps1` installs dependencies if they're missing and boots the dev server in a single step — handy right after a clone or a pull. Flags: `-Test` runs the test suite, `-Build` runs the production build. On Windows you can also run `powershell -File scripts\make-dev-shortcut.ps1` once to add a **"YatraFlow Dev" desktop shortcut** that opens VS Code and starts the dev server together.

Other scripts:

| Command | What it does |
|---|---|
| `./scripts/start.ps1` (or `npm start`) | Install-if-needed + Vite dev server (output teed to `dev.log`) |
| `./scripts/start.ps1 -Test` | Full test suite |
| `./scripts/start.ps1 -Build` | TypeScript check then production bundle |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | TypeScript check (`tsc -b`) then production bundle into `dist/` |
| `npm run preview` | Serve the production build locally |

You'll need a free [Supabase](https://supabase.com) project for accounts and data storage. The map/weather/geocoding services the app calls are all free and keyless — no API keys for those, ever.

## 👤 Accounts & demo content

- **Sign up** with any email + password (min 8 chars) — new accounts get the Kerala demo trip seeded automatically on first login.
- Already have trips? Use the **🚀 Load demo trips** button on My Trips to pull in the sample itinerary anytime.
- Your data lives in Supabase and follows your account across devices. Invited collaborators see shared trips per their role (owner / editor / commenter / viewer), enforced by Postgres Row Level Security.

---

## 🛠 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Build | [Vite 8](https://vitejs.dev) | Instant dev server, zero-config prod builds |
| UI | React 18 + TypeScript (strict) | No router lib, no UI kit — hash routing + hand-rolled components keep the MVP dependency-light |
| State | `useSyncExternalStore` over a module-level store | Tiny reactive cache hydrated from Supabase; every mutation writes through to Postgres (optimistic UI, fire-and-forget persistence) |
| Maps | [mapcn](https://github.com/AnmolSaini16/mapcn) (MapLibre GL) vendored into `src/components/mapcn/` | shadcn-style registry component; [OpenFreeMap](https://openfreemap.org) basemaps switch light/dark automatically — no key, no signup, no request limits |
| Backend | [Supabase](https://supabase.com) (Postgres + Auth + RLS) | Free tier covers the MVP; JSONB keeps trip internals denormalized so the TS model maps 1:1 |
| Geocoding | Open-Meteo geocoding API | Free, keyless, India-biasable |
| Icons | lucide-react | Used inside the vendored map component |

Routing is hash-based (`#/trip/:id`, `#/pub/:slug`, `#/invite/:id`) so the static build works on any host with no rewrite rules.

## 📁 Project structure

```
src/
├── main.tsx               # Entry — mounts <App/> inside <ErrorBoundary/>
├── App.tsx                # Hash router, nav shell, footer, notifications
├── styles.css             # Single hand-written stylesheet (light+dark via data-theme)
├── data/
│   ├── types.ts           # Core domain model — every entity lives here
│   └── seed.ts            # Demo users/trips/suggestions/decisions/published
├── store/
│   └── store.ts           # Supabase-backed reactive cache + all mutations
├── lib/
│   ├── engine.ts          # Scheduling & budget simulation (transparent estimates)
│   ├── impact.ts          # Current-vs-proposed plan comparison
│   ├── ai.ts              # Deterministic rule-based AI companion
│   ├── geo.ts             # Haversine helpers
│   ├── weather.ts         # Open-Meteo daily forecast (WMO → icon/label)
│   ├── routing.ts         # OSRM road geometry for the map (+ haversine fallback)
│   ├── snapshot.ts        # Compress/encode whole trips into shareable URLs
│   ├── geocode.ts         # Open-Meteo geocoding + OSM Overpass opening hours
│   └── supabase.ts        # Shared Supabase client (reads VITE_ env vars)
├── components/
│   ├── ui.tsx             # Modal, Field, Chip, Avatar, StatTile, HealthRing, toast…
│   ├── LocationInput.tsx  # Debounced geocoding autocomplete (keyboard-navigable)
│   ├── StopEditor.tsx     # Add/edit stop modal
│   ├── TripMap.tsx        # MapLibre route map wrapper
│   ├── ImpactPreview.tsx  # Delta panel shown before applying changes
│   ├── AiDrawer.tsx       # Companion chat drawer
│   ├── ErrorBoundary.tsx  # Crash screen with reset-app-data escape hatch
│   └── mapcn/             # Vendored mapcn map components (Map, MapRoute, …)
└── pages/
    ├── Landing.tsx        # Marketing home
    ├── Auth.tsx           # Login / signup (+ one-click demo login)
    ├── TripsList.tsx      # My trips dashboard
    ├── CreateTrip.tsx     # Trip creation wizard
    ├── TripWorkspace.tsx  # The main app: Overview/Timeline/Map/Suggestions/Budget/Decisions/Share tabs
    ├── Explore.tsx        # Public itinerary gallery
    ├── PublicItinerary.tsx# Published trip detail page
    └── Profile.tsx        # User profile & creator settings
```

For how the pieces fit together — data model, engine math, store design — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For the design-token system (color/state tokens) see [DESIGN_TOKENS.md](DESIGN_TOKENS.md). For the full docs index see [docs/README.md](docs/README.md).

---

## 🗺️ Data sources, basemaps & attribution

Every map/data service below is **free and keyless** unless the row says
otherwise — the app never requires an API key to render a map.

| Concern | Provider | Licensing / terms |
|---|---|---|
| **Basemap tiles** | [OpenFreeMap](https://openfreemap.org) — OpenMapTiles-schema vector tiles + open-source styles | Service is MIT with **no request limits, no registration, commercial use allowed**; map data is © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL) |
| Road routing | [OSRM](https://project-osrm.org/) demo server | Free, keyless; haversine fallback keeps planning working offline |
| Weather | [Open-Meteo](https://open-meteo.com) | Free, keyless, CC-BY 4.0 |
| Geocoding / nearby POIs | Open-Meteo geocoding, Wikipedia geosearch, [Overpass (OSM)](https://overpass-api.de) | Free / ODbL |
| Place autocomplete (optional) | [Mappls](https://about.mappls.com/api/) when `VITE_MAPPLS_KEY` is set | Free India dev tier, key required |
| Places & Routes (optional) | [Google Maps Platform](https://mapsplatform.google.com) when `VITE_GOOGLE_MAPS_API_KEY` is set | Google Maps Platform Terms; needs a billing account; client-side quota guard soft-caps every SKU at 80% of the free allowance (`src/lib/providers/quota.ts`) |

**Basemap attribution** is rendered by MapLibre's attribution control in the
corner of every map. OpenFreeMap's `style.json` ships *without* a
`sources.*.attribution` field, but its `openmaptiles` source resolves the
TileJSON at `tiles.openfreemap.org/planet`, which carries the required
OSM/OpenMapTiles credit — MapLibre renders it automatically. Don't also inject
it via `customAttribution`: that shows the credit twice.

**Why not Google map tiles?** Google does not license its basemap rendering to
third-party renderers such as MapLibre, so the Google *look* would mean replacing
the entire map component with the Maps JavaScript API — plus a mandatory billing
account, per-map-load billing with no hard spending cap, and a per-browser quota
guard that cannot aggregate across visitors. Google stays where it earns its
keep: optional Places/Routes *data* behind the `src/lib/geocode.ts` /
`src/lib/routing.ts` facade, always falling back to the free stack.

> History: the map previously loaded CARTO Basemaps and an Esri World Imagery
> satellite layer. CARTO's free basemaps are non-commercial-only and Esri's
> public tile endpoints require an ArcGIS Developer plan for production — both a
> mismatch for a publicly deployed app with a public itinerary gallery, so they
> were swapped out (issue #23).

---

## ☁️ Deployment

Static hosting is enough. The repo deploys automatically to **Vercel** on every push to `main`:

- Framework preset: Vite (auto-detected)
- Build command: `npm run build`
- Output directory: `dist`

Any static host works the same way (Netlify, GitHub Pages behind a base path, etc.) because routing is hash-based.

**Preview builds need the Supabase variables too.** Vite inlines `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at *build* time and Vercel scopes them per environment, so a variable ticked for Production only leaves every branch preview rendering fine but failing login with `Failed to fetch`. Tick **Production, Preview and Development**, then **Redeploy** — the build guard in `vite.config.ts` fails a Vercel deploy outright if either is missing. See [If login fails on a preview](docs/DEPLOYMENT.md#if-login-fails-on-a-preview-but-works-on-production).

---

## 📌 MVP constraints (intentional)

YatraFlow's MVP deliberately does **not** include:

- ❌ Hotel/flight **booking** — placeholder buttons only; they toast "no payments in this MVP"
- ❌ **Payments** — no gateway integration anywhere
- ❌ **Live traffic/prices** — all estimates are transparent formulas with stated assumptions
- ❌ INR is the default and only currency

These are extension points, not oversights — see the architecture doc's "Swapping things out" section.

## 🗺 Roadmap ideas

Shipped since these notes were first written: Supabase backend (0.12.0), Google Maps data-only Places layer (0.17.0), Open-Meteo weather outlook per day (0.7.0), regional-language preference field in the profile model.

Still open:
- Google Maps layers beyond data-only Places (JS API rendering, Street View embeds)
- Split-expense settlement between group members
- Real-time collaboration sync (live multi-user editing of a trip)

## 🤝 Contributing

PRs welcome! Ground rules:

1. TypeScript strict must stay clean: `npx tsc --noEmit`
2. Match the existing style — plain CSS in `styles.css`, no new UI/router/state libraries without discussion
3. Keep the transparency promise: any new estimate must surface its assumptions to the user
4. Respect the MVP constraints above unless a change explicitly replaces them

---

*Built as an India-first MVP. Yatra (यात्रा) means journey.* 🧭
