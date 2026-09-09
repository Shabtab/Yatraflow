<div align="center">

# YatraFlow 🇮🇳

**Plan Indian trips together — not in a chaotic group chat.**

A collaborative travel-planning web app, built India-first. Real multi-day itineraries, transparent cost & time estimates in ₹, group voting on stops, decisions that settle debates, and interactive maps of your whole route.

**Free to use. No API key needed for maps, weather or routing.**

<br />

<a href="https://yatraflow-blond.vercel.app"><img src="https://img.shields.io/badge/Live--demo-try-0F9E90?style=for-the-badge" alt="Live demo" /></a>
&nbsp;
<a href="https://github.com/hasnaina955/Yatraflow/releases"><img src="https://img.shields.io/github/v/release/hasnaina955/yatraflow?style=for-the-badge&color=F8B14E" alt="Latest release" /></a>
&nbsp;
<a href="https://github.com/hasnaina955/Yatraflow"><img src="https://img.shields.io/github/stars/hasnaina955/yatraflow?style=for-the-badge&color=0B2545" alt="Stars" /></a>
&nbsp;
<a href="https://github.com/hasnaina955/Yatraflow/network/members"><img src="https://img.shields.io/github/forks/hasnaina955/yatraflow?style=for-the-badge&color=0B2545" alt="Forks" /></a>

<br />

<a href="https://github.com/hasnaina955/Yatraflow"><img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square" alt="React" /></a>
<a href="https://vitejs.dev"><img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square" alt="Vite" /></a>
<a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square" alt="TypeScript" /></a>
<a href="https://supabase.com"><img src="https://img.shields.io/badge/Supabase-Postgres%2BAuth-3ECF8E?style=flat-square" alt="Supabase" /></a>
<a href="https://maplibre.org"><img src="https://img.shields.io/badge/MapLibre-OpenFreeMap-64C6A3?style=flat-square" alt="MapLibre" /></a>

</div>

<br />

<img src="docs/redesign/yatraflow-enhanced-homepage-mockup.svg" alt="YatraFlow — plan a trip together" width="100%" />

---

## What you get
<table width="100%">
<tr>
<td width="50%" valign="top">

#### 📍 Plan

- **Create trips** — start + ordered destinations (real place autocomplete), dates, crew size, transport mode (six everyday modes incl. car rental and local trains), budget and travel style. The "Trip Ticket" starter prices your rough bill on demand and seeds the timeline with a starting outline
- **Day-by-day timeline** — reorder / move stops between days, opening hours, priorities, route sparklines, collapsible headers
- **One journey per day, however far you drive** — a real arrival clock, travelling strips for pure-travel legs, halts on any driving day, suggested real stop spots along the route
- **Leg-aware insertion** — picking a place auto-fills road distance, travel time and fuel cost

</td>
<td width="50%" valign="top">

#### 💰 Budget & time (transparently)

- **Schedule engine** — simulates each day leg-by-leg (OSRM road distances, per-mode speeds and ₹/km costs); flags tight days, missed check-ins, late arrivals
- **Budget engine** — totals split per-person vs group, essential vs optional, category breakdown, hotel nights
- **Every rupee attributed** — per-day cost bars show what each day really costs (expenses + that day's drive) against a daily-average line; hot days light up amber with a trim suggestion
- **Split expenses fairly** — tag who paid on any expense and a balances card shows who owes whom, with the simplest set of settlements spelled out
- **Impact Preview** — before you accept a suggestion, see ±time, ±distance, ±cost, new or cleared warnings
- Every estimate states its assumptions on-screen. **No fake live traffic or prices — ever.**

</td>
</tr>
<tr>
<td width="50%" valign="top">

#### 🗺 Maps & routing

- **Interactive MapLibre maps** — numbered stop pins per day, colour-coded routes, day filters, light/dark basemaps (OpenFreeMap — keyless, no request caps)
- **Real road routing** (OSRM) with silent offline fallback — planning never blocks
- **Nearby POIs** along your route (verified coordinates) plus fatigue-aware stop suggestions for long drives
- **Weather along the route** — per-day forecast from Open-Meteo (free, keyless) with icon, min/max °C, rain chance
- **Expandable map** — filter pills, marker-key chip, full-screen Expand mode

</td>
<td width="50%" valign="top">

#### 👥 Collaborate & share

- **Invite by link or short code** — friends join as owner / editor / commenter / viewer (enforced by Postgres RLS). The invite link is `#/join/<code>` where the code is short and trip-shaped (`GOABEACHWE-K7QF`), with a code box on the home screen for friends who only got the code
- **One group-input stream** — stop ideas and group decisions share one tab; whatever needs *your* vote floats to the top with a sidebar digest, and decision cards show exactly who voted for what and where the tally leans
- **Decisions** — structured polls with per-option cost/time impact and context, votes, resolve
- **Publish itineraries** to the public Explore gallery; readers copy any trip in one click
- **Creators get a public page** — `#/creator/:id` gathers a creator's bio, links, track record and every itinerary they've published, shareable in one link
- **Export / import** JSON, or a self-contained snapshot link (`#/share/<payload>`, zero server storage)
- **AI companion drawer** — deterministic, trip-grounded answers that always cite assumptions

</td>
</tr>
</table>

---

## ✨ The v0.38–v0.44 run, in plain words

The last stretch of releases gave the Map tab a brain, taught the plan to learn from you, and turned sharing into a superpower:

- **The Map tab now thinks like a road-trip co-pilot.** Long drives are split into fatigue-spaced segments — stretch ~every 150 km, lunch ~every 300 (auto-slid into the 11:30–14:30 window), fuel on your tank's rhythm for self-drive trips, and a real city to sleep in every ~550 km — each matched to the best actual place on your route, with sightseeing suggestions flowing alongside (that column was quietly broken until v0.43 fixed the pipe that fed it). Hover a suggestion to see it glow on the map; hover a pin to find its card. New stops insert in road order — add something between two confirmed stops and the plan reads A → B → C.
- **The engine learns you.** Accepting or declining an idea teaches Trip DNA, which biases future suggestions across all your trips. Big crews and relaxed styles get earlier breaks; packed itineraries push further. Rainy days hand the spotlight to museums and cafes; ghat sections and city crawls earn their own warnings.
- **Leave with the plan, any way you like.** The Share tab (a clean tabbed page now) exports a calendar file — one event per day plus timed events for hotels, trains and fixed commitments — prints the whole plan as A4 day cards straight from the browser's print dialog (a real offline PDF, zero dependencies), and keeps the snapshot links and JSON exports.
- **Creators got a hub.** Publications live in an Overview + Earnings surface: lifetime views, forks, live pages, a payouts-ledger shape waiting for the premium launch, and a clearly-labelled projection of what priced pages could earn.
- **The money and the clock, where you're editing.** The Budget tab answers "what can we still spend today?" with a Safe-to-spend-per-day tile that counts the remaining days honestly (today included, a finished trip at zero) and goes red on overspend — or asks you to set a target instead of inventing a number. Timeline day headers carry two quiet chips: what the day costs (travel vs entries in the tooltip) and how long you'll be at its stops.
- **Quiet reliability work throughout** — every trip edit now writes through to the database before the UI celebrates, failed saves say so instead of silently vanishing on refresh, an already-open tab reloads itself into a fresh deploy instead of crashing on a stale chunk, public itinerary pages and invite links work for people who aren't members yet, and a corrupted-merge incident (v0.43) was repaired byte-for-byte.

<details>
<summary><b>See the full tour of features</b></summary>

<br />

The depth below ships in the app today — it is condensed here to keep the front door scannable.

- **Fuel-accurate costs** — car/bike trips state fuel economy (km/L)and optionally local pump price (default ₹105/L national average); legs are priced as `distance ÷ economy × price`, and the return to start is included by default (toggleable).
- **Travel stops act as real halts** — pure-travel legs render as travelling strips; stay days show "Based in …"; the drive home appears only on the return day, never double-counted.
- **Fatigue-aware stop planner** — splits long drives into stretch / meal / fuel / overnight segments and matches each to the best real place by purpose (night halts anchored on key cities; vehicle-profile aware for fuel range, EV/CNG queries).
- **Opening hours auto-fill** from OSM Overpass where relevant (POIs, temples, food, hotels), context-aware.
- **Location autocomplete** — Mappls when a key is set, else Open-Meteo + Wikipedia fallback.

</details>

---

## 🚀 Getting started

```bash
git clone https://github.com/hasnaina955/Yatraflow.git
cd Yatraflow
npm install

# Configure Supabase (free project at supabase.com, then:)
cp .env.example .env.local   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
# Apply the schema (SQL editor in the dashboard, or with PGCONN set):
#   node scripts/apply-schema.mjs

npm run dev        # → http://localhost:5173
```

**One-command start (Windows):** `./scripts/start.ps1` boots install-if-needed dev server (`-Test` runs the suite, `-Build` runs the build; `make-dev-shortcut.ps1` adds a desktop shortcut)

You'll need a free [Supabase](https://supabase.com) project for accounts + data; the maps / weather / geocoding services the app calls are all free and keyless

## 👤 Accounts & demo content

- **Sign up** with any email + password (min 8 chars — new accounts get a seeded Kerala demo trip on first login
- Already have trips? Use the **🚀 Load demo trips** button on My Trips anytime
- Your data lives in Supabase and follows you across devices; invited collaborators act per their role, enforced by Postgres RLS

---
## 🛠 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Build | [Vite 8](https://vitejs.dev) | Instant dev server, zero-config builds |
| UI | React 18 + TypeScript (strict) | No router lib or UI kit — hash routing + hand-rolled components stay lightweight |
| State | `useSyncExternalStore` over a module store | Tiny reactive cache hydrated from Supabase; every mutation writes through |
| Maps | [mapcn](https://github.com/AnmolSaini16/mapcn) (MapLibre GL) | [OpenFreeMap](https://openfreemap.org) basemaps tick light/dark — no key, no signup, no caps |
| Backend | [Supabase](https://supabase.com) (Postgres + Auth + RLS) | Free tier covers the MVP; JSONB keeps trip internals denormalized |
| Routing / geo | OSRM, Open-Meteo, Wikipedia, Overpass | Free + keyless, India-biasable; optional Google / Mappls keys behind a failing-open facade |

Routing is hash-based (`#/trip/:id`, `#/pub/:slug`, `#/creator/:id`, `#/join/:code`) so the static build runs on any host with no rewrites.

## 📁 Project structure

```
src/
├── main.tsx           # Entry — mounts <App/> inside <ErrorBoundary/>
├── App.tsx            # Hash router, nav shell, footer, notifications
├── styles.css         # Single hand-written stylesheet (light+dark via data-theme)
├── data/              # types.ts domain model · seed.ts demo content
├── store/store.ts     # Supabase-backed reactive cache + all mutations
├── lib/               # engine.ts · impact.ts · ai.ts · ridePlan.ts · geocode.ts
│                      # routing.ts · snapshot.ts · weather.ts
├── components/        # ui.tsx · StopEditor.tsx · TripMap.tsx · ImpactPreview.tsx · PubCard.tsx · mapcn/
└── pages/             # Landing · Auth · TripsList · CreateTrip · TripWorkspace · Explore
                       # PublicItinerary · CreatorPage · Profile + trip/ (one file per workspace tab)
```

Deep dives: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (data model, engine math, store), [DESIGN_TOKENS.md](DESIGN_TOKENS.md) (design tokens), [docs/README.md](docs/README.md) (full index).

---

## 🗺 Data sources, basemaps & attribution

Every map/data service is **free and keyless** unless the row says otherwise — the app never requires an API key to render a map.

| Concern | Provider | Licensing / terms |
|---|---|---|
| **Basemap tiles** | [OpenFreeMap](https://openfreemap.org) (OpenMapTiles-schema) | MIT — no request limits; map data © [OSM](https://www.openstreetmap.org/copyright) contributors (ODbL) |
| Road routing | [OSRM](https://project-osrm.org/) demo server | Free, keyless; haversine fallback works offline |
| Weather | [Open-Meteo](https://open-meteo.com) | Free, keyless, CC-BY 4.0 |
| Geocoding / POIs | Open-Meteo, Wikipedia geosearch, [Overpass (OSM)](https://overpass-api.de) | Free / ODbL |
| Place autocomplete (opt-in) | [Mappls](https://about.mappls.com/api/) when `VITE_MAPPLS_KEY` is set | Free India dev tier, key required |
| Places & Routes (opt-in) | [Google Maps Platform](https://mapsplatform.google.com) when `VITE_GOOGLE_MAPS_API_KEY` is set | Needs billing; client-side quota guard caps each SKU at 80% of free allowance. With a key, suggestions are Google-only (no free-stack fallback); without one, the free stack serves. |

MapLibre renders the required OSM/OpenMapTiles credit in every map corner.

---

## ☁️ Deployment

Static hosting is enough. The repo auto-deploys to **Vercel** on every push to `main` (`npm run build`, output `dist/`). Any static host works — Netlify, GitHub Pages behind a base path — because routing is hash-based.

**Preview builds need the Supabase vars too.** Vite inlines `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at build time and Vercel scopes them per environment — tick **Production, Preview and Development**, then **Redeploy**; the build guard in `vite.config.ts` fails a Vercel deploy if either is missing. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#if-login-fails-on-a-preview-but-works-on-production).

---

## 📌 MVP constraints (intentional)

- ❌ Hotel/flight **booking** — placeholder buttons only ("no payments in this MVP")
- ❌ **Payments** — no gateway integration
- ❌ **Live traffic/prices** — all estimates are transparent formulas with stated assumptions
- ❌ INR is the default and only currency

These are extension points, not oversights — see ARCHITECTURE.md's "Swapping things out".

## 🤝 Contributing

PRs welcome! Keep TypeScript strict clean, match the existing style (plain CSS in `styles.css`, no new UI/router/state libs without discussion), preserve the transparency promise, and respect the MVP constraints. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

*Built India-first. Yatra (यात्रा) means journey.* 🧭

</div>
