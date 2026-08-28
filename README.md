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
- **Location autocomplete** on every location input, powered by the free [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api) — no API key needed. Picking a suggestion pins the stop to real coordinates so maps and distance estimates stay accurate
- **Interactive map** (MapLibre via [mapcn](https://github.com/AnmolSaini16/mapcn)) — numbered stop pins per day, colour-coded route lines, auto-fit bounds, day filter chips, light/dark basemaps

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
- **Nearby POI ideas**: real points of interest within 10 km of your route from Wikipedia geosearch, with a "+ Add" button that drops them into the timeline through the normal impact-preview flow

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

Other scripts:

| Command | What it does |
|---|---|
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
| Build | [Vite 5](https://vitejs.dev) | Instant dev server, zero-config prod builds |
| UI | React 18 + TypeScript (strict) | No router lib, no UI kit — hash routing + hand-rolled components keep the MVP dependency-light |
| State | `useSyncExternalStore` over a module-level store | Tiny reactive cache hydrated from Supabase; every mutation writes through to Postgres (optimistic UI, fire-and-forget persistence) |
| Maps | [mapcn](https://github.com/AnmolSaini16/mapcn) (MapLibre GL) vendored into `src/components/mapcn/` | shadcn-style registry component; CARTO basemaps switch light/dark automatically |
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

For how the pieces fit together — data model, engine math, store design — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## ☁️ Deployment

Static hosting is enough. The repo deploys automatically to **Vercel** on every push to `main`:

- Framework preset: Vite (auto-detected)
- Build command: `npm run build`
- Output directory: `dist`

Any static host works the same way (Netlify, GitHub Pages behind a base path, etc.) because routing is hash-based.

---

## 📌 MVP constraints (intentional)

YatraFlow's MVP deliberately does **not** include:

- ❌ Hotel/flight **booking** — placeholder buttons only; they toast "no payments in this MVP"
- ❌ **Payments** — no gateway integration anywhere
- ❌ **Live traffic/prices** — all estimates are transparent formulas with stated assumptions
- ❌ Real authentication backend — passwords use a demo-grade hash and storage is browser-local
- ❌ INR is the default and only currency

These are extension points, not oversights — see the architecture doc's "Swapping things out" section.

## 🗺 Roadmap ideas

- Backend (Supabase/Firebase) behind the existing store interface for real multi-device sync
- Google Places / Mapbox geocoding option for deeper POI coverage
- Weather outlook per day (Open-Meteo forecast API pairs naturally with the geocoder already in use)
- Regional-language UI (the profile model already stores language preferences)
- Split-expense settlement between group members

## 🤝 Contributing

PRs welcome! Ground rules:

1. TypeScript strict must stay clean: `npx tsc --noEmit`
2. Match the existing style — plain CSS in `styles.css`, no new UI/router/state libraries without discussion
3. Keep the transparency promise: any new estimate must surface its assumptions to the user
4. Respect the MVP constraints above unless a change explicitly replaces them

---

*Built as an India-first MVP. Yatra (यात्रा) means journey.* 🧭
