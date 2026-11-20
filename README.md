<div align="center">

# YatraFlow 🇮🇳

**Plan Indian trips together — not in a chaotic group chat.**

A collaborative travel-planning web app, built India-first. Real multi-day itineraries, transparent cost & time estimates in ₹, group voting on stops, decisions that settle debates, and interactive maps of your whole route.

**Plan trips with your group.** Planning is free. Some published itineraries need a paid unlock. Supabase powers accounts and shared trip data. Optional map provider keys enable Google Places and Routes or Mappls autocomplete.

<br />

<a href="https://www.yatraflow.in"><img src="https://img.shields.io/badge/Live--demo-try-0F9E90?style=for-the-badge" alt="Live demo" /></a>
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

<img src="docs/screenshots/landing-hero.png" alt="YatraFlow landing page - plan trips that actually flow together" width="100%" />

<img src="docs/screenshots/plan-bench.png" alt="The Plan Bench - price a road trip and see every rupee explained" width="100%" />

---

## What you get
<table width="100%">
<tr>
<td width="50%" valign="top">

#### 📍 Plan

- **Create trips** — start + ordered destinations (real place autocomplete), dates, crew size, transport mode (eight everyday modes incl. car rental and local trains), budget and travel style. The "Trip Ticket" starter prices your rough bill on demand and seeds the timeline with a starting outline
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

- **Interactive MapLibre maps** — numbered stop pins per day, colour-coded routes, day filters, light and dark basemaps
- **Road routing** uses OSRM and can fall back to a distance estimate when routing is unavailable
- **Nearby POIs** along your route (verified coordinates) plus fatigue-aware stop suggestions for long drives
- **Weather along the route** — per-day forecast from Open-Meteo with icon, minimum and maximum temperature, and rain chance
- **Expandable map** — filter pills, marker-key chip, full-screen Expand mode

</td>
<td width="50%" valign="top">

#### 👥 Collaborate & share

- **Invite by link or short code** — friends join as owner / editor / commenter / viewer (enforced by Postgres RLS). The invite link is `/join/<code>`, where the code is short and trip-shaped (`GOABEACHWE-K7QFH3WT`). A code box on the home screen takes the code alone.
- **One group-input stream** — stop ideas and group decisions share one tab; whatever needs *your* vote floats to the top with a sidebar digest, and decision cards show exactly who voted for what and where the tally leans
- **Decisions** — structured polls with per-option cost/time impact and context, votes, resolve
- **Publish itineraries** to the public Explore gallery; readers copy any trip in one click
- **Creators get a public page** — a creator's bio, links, track record and published itineraries live at `/creator/<id>`. The share link `/c/<id>` opens a preview card and redirects the reader to the page.
- **Export / import** JSON, or a self-contained snapshot link (`/share/<payload>`, zero server storage)

</td>
</tr>
</table>

<p align="center"><img src="public/brand/mascot/chakra-expressions.svg" alt="Chakra the koel in twelve expressions" width="480" /></p>

Chakra the koel is the mascot, shown here in twelve expressions. The Y logo stays the brand mark.

---

_Recent release highlights, newest first. See [CHANGELOG.md](CHANGELOG.md) for the full release record._

Pending notes live in [change fragments](changelog.d/README.md). The release owner assembles them into the public record.

## The v0.88.1 release

The repository is at v0.88.1. See the [release record](CHANGELOG.md) for its full scope.

- **Removed trip members stay out.** A removed member cannot rejoin with a new invite link. A member who leaves keeps their assigned role when they rejoin. Existing invite links expire once.

## The v0.88.0 release

The previous release. Its highlights stay here until the next release.

- **Group input is one Decide together page.** Decisions, stop ideas and activity share one layout. A decision can close at a set time, and each member can answer a short interest quiz.
- **Creators can copy a route as a weekend trip.** Pick a start date and a party size, and the copy keeps both. Storefronts also show the Indian states their routes cover.
- **Map Expand has its own control.** A tablet or desktop keeps it beside the view switch, not in the More menu.
- **Google route requests share one monthly limit across all users.** Past the limit, routes come from OpenStreetMap. The compiler moves to TypeScript 6 and the test runner to Vitest 5.

## The v0.87.1 release

The previous release. Its highlights stay here until the next release.

- **Map route lines follow the roads again.** Each leg of a trip follows its own section of the road route.

## The v0.87.0 release

The previous release. Its highlights stay here until the next release.

- **Creators get a storefront, an owner hub and a rankings page.** The pages show route facts, saved picks, follows and private owner activity. A failed read never shows as zero.
- **Creators can link public posts to their routes.** The hub counts the visits that each post brings. The app stores links only and keeps no visitor identity.
- **The trip cover keeps one height on every content tab.** Map and Board show a slim bar, so the tab pill stays in one place. The Plan lens now lives in the Gap panel.
- **Board drags and Google routing are steadier.** A dragged stop stays on the pointer, and one trip load sends one Google Routes request.

## The v0.86.0 release

The previous release. Its highlights stay here until the next release.

- <img src="public/brand/mascot/chakra-hero.svg" alt="" width="96" align="right" /> **Chakra the koel meets you at the quiet moments.** The loading, failed, empty and not-found screens carry the mascot, which takes the night art in the dark theme. The trip-created column and the unlock reveal celebrate with it. The AI companion wears its face and shows it thinking. The Y logo stays the brand mark.
- **The Board tab shows each stop's place, time and cost in full.** Each fact has one home, and the stop cards wrap instead of cutting their details.
- **Explore and the published itinerary move in one calm sequence.** Explore has one search field and one shared publication card. The Look inside day cards and the road height charts match the reference design.
- **Phone map fits keep the trip large and the pins apart.** Side insets use measured covers, and a user pan is never undone.

## 🚀 Getting started

```bash
git clone https://github.com/hasnaina955/Yatraflow.git
cd Yatraflow
unset NODE_ENV
npm install

cp .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.
# Apply supabase/schema.sql in the Supabase SQL editor, then apply new migrations.

npm run dev        # → http://localhost:5173
```

**Windows:** Run `./scripts/start.ps1` to start the development server. Use `-Test` to run the test suite or `-Build` to build the app.

You need a [Supabase](https://supabase.com) project for accounts and shared data. See [Deployment & Operations](docs/DEPLOYMENT.md) for setup details and provider configuration.

## 👤 Accounts & demo content

- **Sign up** with any email + password (min 8 chars) — new accounts get a seeded Kerala demo trip on first login
- Already have trips? Use the **🚀 Load demo trips** button on My Trips anytime
- Your data lives in Supabase and follows you across devices; invited collaborators act per their role, enforced by Postgres RLS

---
## 🛠 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Build | [Vite 8](https://vitejs.dev) | Instant dev server, zero-config builds |
| UI | React 18 + TypeScript (strict) | No router lib or UI kit — real paths on the web, hash in the native shell, hand-rolled components |
| State | `useSyncExternalStore` over a module store | Tiny reactive cache hydrated from Supabase; every mutation writes through |
| Maps | [mapcn](https://github.com/AnmolSaini16/mapcn) (MapLibre GL) | OpenFreeMap basemaps |
| Backend | [Supabase](https://supabase.com) (Postgres + Auth + RLS) | Accounts and shared trip data |
| Routing / geo | OSRM, Open-Meteo, Wikipedia, Overpass | Optional Google and Mappls keys enable provider-specific features |

The web app routes on real paths (`/trip/<id>`, `/pub/<slug>`, `/creator/<id>`, `/join/<code>`). The creator share link `/c/<id>` redirects to `/creator/<id>`. The native shell and the file build keep the hash form. Hosts must serve `index.html` for app paths and provide equivalent serverless functions.

## 📁 Project structure

```
src/
├── main.tsx           # Entry — mounts <App/> inside <ErrorBoundary/>
├── App.tsx            # Path router, nav shell, footer, notifications
├── styles.css         # Entry: the ordered imports of the section modules
├── styles/legacy/     # The pre-split sections, one contiguous range per file
├── data/              # types.ts domain model · seed.ts demo content
├── store/store.ts     # Supabase-backed reactive cache + all mutations
├── lib/               # engine.ts · impact.ts · ai.ts · ridePlan.ts · geocode.ts
│                      # routing.ts · snapshot.ts · weather.ts
├── components/        # ui.tsx · StopEditor.tsx · TripMap.tsx · ImpactPreview.tsx · PubCard.tsx · mapcn/
│                      # page/ — the shared page parts (PageHero, PageHeader, Surface, StateBlock, SegmentedTabs)
└── pages/             # Landing · Auth · TripsList · CreateTrip · TripCreated · TripWorkspace · Explore
                       # PublicItinerary · Purchases · CreatorPage · CreatorHubPage · Profile · AdminPage
                       # NativeHome + trip/ (one file per workspace tab)
```

Deep dives: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (data model, engine math, store), [DESIGN_TOKENS.md](DESIGN_TOKENS.md) (design tokens), [docs/README.md](docs/README.md) (full index).

---

## 🗺 Data sources, basemaps & attribution

OSRM, Open-Meteo, Wikipedia, and Overpass run without app keys. Provider terms and availability apply.

| Concern | Provider | Licensing / terms |
|---|---|---|
| **Basemap tiles** | [OpenFreeMap](https://openfreemap.org) (OpenMapTiles schema) | Map data © [OSM](https://www.openstreetmap.org/copyright) contributors (ODbL) |
| Road routing | [OSRM](https://project-osrm.org/) | The app can use a haversine estimate when road routing is unavailable |
| Weather | [Open-Meteo](https://open-meteo.com) | Attribution: CC BY 4.0 |
| Geocoding and POIs | Open-Meteo, Wikipedia geosearch, [Overpass (OSM)](https://overpass-api.de) | Provider terms apply |
| Place autocomplete | [Mappls](https://about.mappls.com/api/) when `VITE_MAPPLS_KEY` is set | Key required |
| Places and Routes | [Google Maps Platform](https://mapsplatform.google.com) when `VITE_GOOGLE_MAPS_API_KEY` is set | Billing and provider terms apply. With a key, suggestions use Google only, except night-halt town anchors. |

MapLibre renders the required OSM/OpenMapTiles credit in every map corner.

---

## ☁️ Deployment

The app deploys to **Vercel** with `npm run build` and output `dist/`. Vercel also runs serverless functions for itinerary previews, creator links, Android updates, checkout, payment verification, and webhooks. A static host needs equivalent function routes and a fallback to `index.html` for app paths.

**Preview builds need the Supabase vars too.** Vite inlines `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at build time and Vercel scopes them per environment — tick **Production, Preview and Development**, then **Redeploy**; the build guard in `vite.config.ts` fails a Vercel deploy if either is missing. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#if-login-fails-on-a-preview-but-works-on-production).

---

## 📌 MVP constraints (intentional)

- ❌ Hotel/flight **booking** — out of scope. Stops can be flagged *needs booking*, and you add your own confirmations as timed events, but the app never books or links to a booking flow
- 💳 **Paid itinerary unlocks** — Razorpay checkout and payment webhooks process purchases. Creator payouts remain manual.
- ❌ **Live traffic/prices** — all estimates are transparent formulas with stated assumptions
- ❌ INR is the default and only currency

See [Architecture](docs/ARCHITECTURE.md) for extension points.

## Testing the crew shape (opt-in integration gate)

The node suite runs offline. To assert crew behavior against the real database,
create two throwaway accounts and run the integration harness -- opt-in only, so
it never gates offline verify:

```powershell
# in .env.local (or environment):
#   TEST_USER1_EMAIL=crew-a@example.com   TEST_USER1_PASS=<password>
#   TEST_USER2_EMAIL=crew-b@example.com   TEST_USER2_PASS=<password>
$env:VITE_RUN_INTEGRATION = '1'
npm run test:integration
```

The harness asserts the cross-user row-level behavior two crews actually rely on
(private-trip privacy, self-serve join, the editor gate, recipient-only
notifications, public gallery reads, realtime round-trips) with a unique run-id
prefix per run and a printed teardown ledger -- only rows the run created are
ever touched. The catalog-level shape is additionally locked by
`supabase/tests/rls_contract.test.sql` (run in the dashboard SQL editor).

## Rendering the money surfaces (local creator fixture)

The earnings ledger, the payout-runs ledger and the publish editor need a creator
with real sales behind them, and a node test cannot supply one -- the suite has no
DOM and no session. The fixture builds that account:

```bash
node scripts/seedCreatorFixture.mjs            # dry run: prints the plan
node scripts/seedCreatorFixture.mjs --apply    # create the accounts + rows
node scripts/seedCreatorFixture.mjs --clean    # remove the fixture's rows
```

It works on the project `VITE_SUPABASE_URL` points at, creating a creator, an
admin, three buyers, three priced publications, seven backdated sales and 100
days of backdated visits and forks — the last so the hub's funnel renders a trend
rather than an empty one — then prints the credentials, the deep links
(`#/creator-hub`, the publish editor, the creator page, `#/admin` → Analytics)
and any SQL it could not run. The sales are
the same ones `tests/earnings.test.ts` (per creator) and `tests/admin.test.ts`
(platform-wide) pin, so the numbers on screen have an answer key — including the
console's, where two payees are what make "charged once per creator" a different
figure from one ladder over the platform total. The traffic plan lives in
`scripts/fixtureFunnelPlan.mjs`, a pure module rather than the CLI script itself
(that runs its whole seed on import, so a test cannot import it to check its
numbers), and `tests/pub-funnel.test.ts` runs the shipped derivation over the very
events the fixture writes — so the windows the script prints before writing
anything are checked against the arithmetic the app uses. Two things need
elevation, and
the script says so rather than half-seeding: the sales rows, because
`entitlements` is SELECT-only for authenticated clients by design, and the
admin's role, because it lives in the JWT's `app_metadata` and there is
deliberately no `is_admin` column to flip. Set `SUPABASE_SERVICE_ROLE_KEY` (or
`PGCONN`) to have both applied, and without either the script prints the SQL to
paste into the dashboard instead. It only ever touches the rows it names.

The write plumbing is `scripts/fixtureKit.mjs` -- sessions, ownership inserts,
the elevated writer, chunked bulk inserts, the admin promotion -- so the next
session-gated surface (an analytics screen, a money path) seeds its own browser
check from the same harness instead of copying this script's internals. A new
fixture is a pure plan module (see `fixtureFunnelPlan.mjs`) plus a thin CLI over
the kit; `tests/fixture-kit.test.ts` keeps the kit the only write path.
## Migration status (is the database actually updated?)

The database half of a release is the one part the offline gate cannot see:
`npm run verify` typechecks, tests and builds, and says nothing about SQL that
has never run. This asks the live project directly -- read-only, with the app's
own anon key:

```bash
npm run check:migrations              # applied / MISSING per migration
npm run check:migrations -- --list    # what it would probe, with no network
```

For every file in `supabase/migrations/` it derives the artifacts that migration
creates -- a table, a column, a Storage bucket -- from its own SQL, and reports
which are live. Exit **0** means everything it can probe is present; **1** means
something is missing, or could not be checked (which is not the same as present);
**2** means no credentials. Function-, policy- and trigger-only migrations are
listed as having no probe surface, with the reason.

The check found its first real one the day it was written: `trips.stay_style`
was absent from the live database, so the stay-budget tier reverted on every
reload without a word from the app. Applying that migration's own one-line
`alter table` closed it the same day, and the sweep went from 1 missing to 0.

## 🤝 Contributing

Keep TypeScript strict clean. Follow the CSS ownership rules in `docs/css-ownership.json`. Discuss new UI, router, or state libraries before you add them. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

*Built India-first. Yatra (यात्रा) means journey.* 🧭

</div>
