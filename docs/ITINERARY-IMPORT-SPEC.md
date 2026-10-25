# YatraFlow — Itinerary Import Specification

**Version:** 3.0 (2026-10-25) · **Runtime twin:** `src/lib/itinerarySpec.ts` · **Offline contract:** `scripts/validate-itinerary.mjs` · **Engine-true pin:** `tests/golden-itineraries.test.ts`

This is the canonical contract for a JSON itinerary that imports into YatraFlow and
**breaks absolutely nothing** — engine math, map, budget, timeline, lodging identity,
publishing, fork. It exists so gallery-grade trips (see `PLAYBOOK-GALLERY-RESEARCH.md`)
can be authored offline and imported with zero repair.

Three artifacts implement this contract, and a rule change lands in all of them in one
commit:

| Artifact | Runs | Job |
|---|---|---|
| `src/lib/itinerarySpec.ts` | in the app, on import | **Read, migrate, repair, normalize.** Never rejects what it can fix |
| `scripts/validate-itinerary.mjs` | offline, in the authoring loop | **Reject** — the strict authoring gate, fails the build-time check |
| `tests/golden-itineraries.test.ts` | CI | **Price** — engine truth (health, budget, warnings) over the shelf |

The importer and the validator are **not** the same policy, and that asymmetry is
deliberate: a file *you* authored should be fixed before it ships (validator, hard error),
while a file a *user* hands the app must import as cleanly as possible (importer, repair +
explain what changed). What the validator **cannot** see is pinned by the golden test.

---

## 1. Shape at a glance

```jsonc
{
  "formatVersion": 3,                       // §8 — the compatibility contract
  "exportedAt": "2026-09-18T…Z",           // written on export; informational
  "app": "yatraflow/0.60.0",               // written on export; diagnosis only
  "trip":   { …Trip… },                    // §3 — the full data model object
  "publication": { …PublishedItinerary… }  // §5 — the Explore surface (gallery trips only)
}
```

Everything is nested under `trip` + `publication` so one file carries both halves of a
gallery import. A `trip`-only file is valid for non-gallery imports, and a **bare trip
object or a bare publication row** (no envelope) is still accepted — see §8.3.

---

## 2. The failure classes this spec prevents

1. **NaN poisoning.** A missing numeric (`visitMinutes`, `entryFeeInrPerPerson`,
   `transportCostInrTotal`) flows into `simulateDay`/budget sums and renders `NaNh NaNm`
   and poisons the day's dwell. **Every numeric field is required**, even when "zero".
2. **Null Island.** `(0, 0)` — or a mixed placeholder (`lat: 0`, real `lng`) — pins the
   journey to the Gulf of Guinea; every downstream number is honest math over an ocean
   round-trip. **Both coordinates are checked, every stop.**
3. **Broken references.** `expense.stopId` pointing nowhere, day indexes out of range,
   non-contiguous `orderInDay`, `days.length` ≠ the inclusive date span — each breaks one
   surface silently. All are hard errors here.
4. **Silently dropped fields.** An unknown or misspelled key (`transportCostInrPerPersonTotal`
   for `transportCostInrTotal`) is *ignored* by every consumer, so the author believes a value
   is set and the engine never sees it. Unknown keys are rejected outright — a dropped field
   is a lie in the data.
5. **Stacked pins (the map-marker bug).** Two stops in one day carrying the **same
   coordinate** render as one marker on top of another: the map shows fewer pins than the
   timeline has stops, the drawn route appears to arrive at an unmarked spot, and clicking the
   visible pin is ambiguous. The first six shelf files carried **27 duplicate-coordinate
   clusters**, **8** of them same-day groups of genuinely different places (the worst: a
   four-stop Gulmarg day on a single point) — and neither gate caught one of them, because
   every coordinate was *valid*. The rule is in §4.2. *(Found live 2026-09-18 by importing a
   shelf file; see §7.2.)*
6. **Version drift.** A format that grows without a version marker leaves an older file
   importable-but-wrong — the failure is silent, which is the worst kind. Every export now
   carries `formatVersion`; every import migrates what it can and reports what it changed
   (§8).

---

## 3. `trip` — field contract

### 3.1 Required always

| Field | Type | Contract |
|---|---|---|
| `name` | string | non-empty; ≤ 80 chars (card display) |
| `startLocation` | string | place name; must match the caption of `startLocationCoords` |
| `startLocationCoords` | `{lat, lng}` | valid ranges (§4); **not** `(0,0)`; never mixed-zero |
| `destinations` | string[] | ≥ 1; last entry is the trip's end anchor |
| `destinationCoords` | `(LatLng\|null)[]` | **parallel array** to `destinations`; gallery trips: every entry non-null + valid |
| `startDate` / `endDate` | `yyyy-mm-dd` | real calendar dates; `endDate ≥ startDate` |
| `travellers` | int | ≥ 1 |
| `transportMode` | enum | `car · rental · motorcycle · train · bus · flight · taxi · mixed` |
| `budgetPerPersonInr` | number | > 0; must match the engine's own estimate within **±15 %** (golden test) — never hand-invented |
| `travelStyle` | enum | `relaxed · balanced · packed · adventure · luxury · budget · family · spiritual · food-focused · creator` |
| `coverEmoji` | string | 1–2 graphemes (the card fallback) |
| `visibility` | enum | `"public"` for gallery imports |
| `days` | Day[] | §3.3 |
| `expenses` | Expense[] | may be `[]`; entries per §3.4 |
| `fixedCommitments` | Fixed[] | may be `[]`; entries per §3.4 |

### 3.2 Required-for-gallery (strongly recommended everywhere)

| Field | Contract |
|---|---|
| `stayStyle` | set it explicitly: `budget · comfort · luxury` — unset derives from legacy `travelStyle`, and you should not be guessing derivations |
| `roundTrip` | boolean; self-drive modes: `true` means the plan *returns to start* — the last day's content must tell that story |
| `fuelEconomyKmL` | plausible for the mode (car 10–25, motorcycle 25–45); implausible values are flagged by the engine |
| `fuelPricePerL` | ₹94–110 band (state pump reality); outside the band is a validator warning |
| `driverCount` | ≥ 1; `2` buys real wheel rotation — set it honestly |
| `hasVulnerable` | infants/seniors aboard → shorter days, earlier dinner |
| `coverImageUrl` | HTTPS; a real image is the single biggest card-CTR lever (broken URLs are hidden by the UI guard, falling back to `coverEmoji`) |

### 3.3 `days[]`

| Field | Contract |
|---|---|
| `id` | string, unique |
| `index` | **must equal the array position**, 0-based, contiguous |
| `title` | recommended ("Munnar hills") — shows on the day header |
| `startTime` | `"HH:MM"` 24h; omit to use the 08:30 planning default |
| `stops` | Stop[]; **3–6 per day** for gallery quality (see §6) |

**`days.length` must equal the inclusive span** `endDate − startDate + 1`. Hard error.

### 3.4 `stops[]` — where imports break

| Field | Contract |
|---|---|
| `id` | string, unique across the trip |
| `title` | non-empty; ≤ 60 chars |
| `category` | enum, exact: `sightseeing · food · nature · beach · temple · adventure · shopping · museum · travel · hotel · rest · event · transport-hub` — **stays are `hotel`** (drives the lodging line; there is no `accommodation`) |
| `locationName` | string |
| `placeId` | provider place-id **when the place was picked from a provider**; hand-authored stops omit it — but then lat/lng must be accurate (lodging identity falls back to coordinate-cluster, then normalized name) |
| `lat` / `lng` | numbers, valid ranges, not (0,0), not mixed-zero; see §4 |
| `visitMinutes` | **finite number ≥ 0** (NaN rule); gallery sweet spot 30–180 |
| `openTime` / `closeTime` | `"HH:MM"`, **both or neither**; `open ≤ close` (a venue past midnight is out of spec — split it) |
| `entryFeeInrPerPerson` | number ≥ 0, required — look it up, don't guess (§ playbook) |
| `transportCostInrTotal` | number ≥ 0, required (cost of getting *to* this stop from the previous point) |
| `priority` | `must-do · nice-to-have · optional` |
| `status` | `"confirmed"` for every stop in a gallery import — a published trip full of `suggested` rows reads unfinished |
| `orderInDay` | **1-based** (the app's own convention: `store.ts`, `TimelineTab`, `BoardView` all write `i + 1`), contiguous per day, no gaps/duplicates — the drag-reorder contract. The importer renumbers from *any* base, so a 0-based legacy file still imports; the validator warns so authored files converge on one convention |
| `weatherSensitive` | `true` for beach / viewpoint / trek / outdoor — feeds the honest warnings |
| `departTime` / `arrivalTime` / `legDistanceKm` / `legTravelMinutes` | **omit.** The engine measures legs itself; stale hand measurements contradict the road math |
| `notes` / `sourceUrl` | optional; HTTPS only. `sourceUrl` on every fee/time-bearing stop is the playbook's citation rule |
| `auto` | omit — tool-managed |

### 3.5 `expenses[]` and `fixedCommitments[]`

- `expenses`: `label`, `category` (`transport · accommodation · food · activities · entry-fees · tolls-parking · local-travel · emergency-buffer`), `amountInr` > 0 finite, optional `perPerson`, `optional`; `stopId` **must reference an existing stop id**; `dayIndex` in range.
- `fixedCommitments`: `title`, `type` (`hotel-checkin · train-departure · flight-departure · event · other`), `dayIndex` in range, `time` `"HH:MM"`.
- IDs: any unique string is accepted; the import tool regenerates them on write — author with readable slugs (`"d1-lunch"`).

---

## 4. Coordinate rules (the hard wall)

```
lat:  −90 … 90      lng: −180 … 180
India corridor (soft warning outside):  lat 6–37.5, lng 68–97.5
```

- `(0, 0)` → error. Exactly one of lat/lng zero → error (the mixed-placeholder case).
- **Geocode, never type from memory.** Hand-recalled coordinates for the Bylakuppe / Dubare /
  Nisargadhama cluster came out ~15 km off in the first draft of the reference itinerary — far
  enough to bend every downstream distance. One Nominatim lookup per place fixes it:
  `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=<place, district, state>`
  (send a User-Agent, stay under 1 req/s).
- Rounding: 4 decimals (~11 m) is plenty; more is noise.
- Coords must sit within ~**40 km** of the place they claim to be (the app's own
  `coLocates` bar). A "Marine Drive" pin in Pune breaks the map's trust, not just the pin.

### 4.1 Rounding and precision

Four decimals (~11 m) is the useful precision; more is noise and less invites drift. A pin
is a *place*, never a *stop*: two stops at the same place (a hotel you return to, lunch and
dinner at one restaurant) **may** share coordinates — that is §4.2's one exception.

### 4.2 Distinct pins (the map-legibility rule)

> **Two stops that are different places must not carry the same coordinate.**

This is a hard rule for authored files, because the map cannot render what the data does not
distinguish. The failure is *silent and partial*: the trip opens, the engine scores it, the
timeline lists every stop — only the map is a lie, and the lie reads as "the importer lost a
stop" rather than "two rows share a number".

**The one exception, stated mechanically so it can be checked:** a coordinate may carry **at
most two stops, and at least one of them must be `food`, `hotel` or `rest`.** A meal at the
place you sleep or break *is* one place — a fact, not a shortcut — which is exactly what makes
"night in Colva" and "lunch in Colva" legal on one pin, and what makes three Gulmarg stops on
one pin illegal however convenient the geocode was.

**Not legitimate:** three different Gulmarg viewpoints pasted onto one geocode hit, or five
Kolkata breakfast spots on one coordinate because the district centroid was easier to look
up than four venues. If a place is hard to geocode, geocode the *venue*, don't collapse two
venues onto one point.

- **Validator:** error, unless the cluster is same-venue (normalized title/location match).
  The clustered-coordinate report it prints is the fix list.
- **Engine/UI:** the map fans out markers that sit within ~300 m so coincident pins stay
  individually readable and clickable (`src/lib/pinOffsets.ts`) — a render-time courtesy for
  user-created trips that legitimately have two stops at one venue. Fanning out is not a
  licence to author stacked pins: the pins are still separate, so the *route* through them is
  still authored order, and a fanned cluster at the trip level cannot tell a real duplicate
  from two venues you merged by mistake.
- **Importer:** warns, naming the day and the stops — it does not reject, because user trips
  legitimately contain the legitimate case and the importer cannot always tell them apart.

---

## 5. `publication` — the Explore surface

The published row **is** the public URL (`id` is the slug) and the card everything sees.

| Field | Contract |
|---|---|
| `id` | slug, `^[a-z0-9-]+$`, ≤ 48 chars, stable forever (it *is* the link) |
| `title` | ≤ 70 chars, name-style ("Spiti Valley Circuit — Shimla in, Manali out") |
| `tagline` | one honest sentence; no superlatives the trip can't cash |
| `coverImageUrl` | **required for gallery-grade**; the first impression lives here |
| `routeSummary` | ordered place names, start → end (renders as the route chips) |
| `durationDays` | must equal `trip.days.length` |
| `estimatedBudgetPerPersonInr` | must equal `trip.budgetPerPersonInr` (the fork must not re-price) |
| `travelStyle` | must equal `trip.travelStyle` (drives the Explore filter) |
| `bestSeason` | recommended ("Jun–Sep") |
| `travelTips` | 3–6 concrete, trip-specific tips |
| `warningsAndAssumptions` | honest array — the app's ethos (e.g. fuel price basis, season caveats) |
| `freeDayIndexes` | ≥ 1 day, and ≥ ~40 % of days — the generosity lever that proves quality |
| `premiumPriceInr` | omit or pick from the seed ladder `149 / 199 / 249 / 499` |
| `subscriberCta` | optional |
| `views` / `copies` / `publishedAt` | omit — tool-managed (start at 0/0/now) |

**Provenance rule (hard):** never import a publication derived from someone else's
forked/copied trip. Publish only trips authored for the gallery. The gallery already
wears one `(copy)` duplicate; this rule is why there will not be a second.

---

## 6. The quality bar — "scores high by default"

Explore ranks by `views + copies×5`; the featured card shows the engine's **health
score**. But before anyone clicks, the card is judged on completeness. Gallery imports
must clear all of:

1. **Health ≥ 85 with no HIGH-severity warning** — asserted in CI by the golden test via
   `computeHealth` (never re-implemented in the validator). The arithmetic matters when
   shaping a route: high = −11, medium = −7, low = −3, so **at most two mediums** fit under
   the bar. A transfer day of 3.5–5 h of driving is a medium — expected, and exactly why the
   reference itinerary breaks its two driving days at Mysore rather than absorbing one
   seven-hour slog (a >5 h day is a HIGH, and fails outright).
2. **Budget honesty** — declared vs engine within ±15 % (golden test). Understating to
   look cheap betrays the app's "estimates, not facts" ethos on its most public page.
3. **Rhythm** — 3–6 stops/day; no day whose wheel+visit time exceeds ~12 h; `hotel`
   stops where nights actually fall.
4. **Card completeness** — cover image, tagline, best season, 3+ tips, warnings present.
5. **Filterable bands** — duration and budget land where real people filter
   (2–10 days; ₹4k–60k/person).
6. **Pin distinctness** — no two different places share a coordinate (§4.2); the validator
   prints the cluster list with titles so the fix is mechanical.

---

## 7. How to validate (the loop)

```bash
# scaffold a new file (copies the reference, renames, geocodes, then validates):
node scripts/new-itinerary.mjs --slug my-new-trip --title "My New Trip" --days 5

# coordinates — looked up, never recalled (exits 1 on a miss):
node scripts/gallery-geocode.mjs "Abbey Falls, Madikeri, Karnataka" "Dubare Elephant Camp, Karnataka"

# structural contract — instant, offline, no deps:
node scripts/validate-itinerary.mjs docs/examples/itineraries/coorg-loop-from-bangalore.golden.json

# engine truth — health, budget ±15 %, schedule warnings (also runs in CI):
npx vitest run tests/golden-itineraries.test.ts
```

Authoring loop: write JSON → validator until clean → drop it into
`docs/examples/itineraries/` → golden test prices it → set `budgetPerPersonInr` and
`estimatedBudgetPerPersonInr` from the engine's own printed estimate → validator again →
PR. Never hand-pick the budget number.

### 7.1 Worked example — the reference itinerary, and what the gate rejected

`docs/examples/itineraries/coorg-loop-from-bangalore.golden.json` is the first shelf entry.
Its **first draft was a 3-day Bangalore→Coorg weekend, and Gate 2 rejected it**: day 1 came
out at **423 min / 268 km** — a HIGH "heavy travel time" warning, because Bangalore→Madikeri
is a 6–7 hour drive at the engine's blended speed, whatever the brochure says. The 5-day
replacement then scored **69** on its own first run — a day with no meal break (Day 3), a
backtracking final day, and one travel day 2 minutes over the medium band. Three fixes
(a Kushalnagar lunch, Srirangapatna moved beside Ranganathittu instead of onto the last
day, Channapatna added on the road home) brought it to a passing **≥ 85**: a **5-day loop
that breaks the drive at Mysore in both directions** (max day: 262 min), every ticketed fee
cited, at **₹12,100/person** against an engine estimate of ₹12,102 — 0.02 % drift.

The lesson is the point of the gate: **a gallery itinerary is shaped by the engine's realism,
not by the route's marketing.** The 3-day Coorg weekend is a popular plan and a bad plan; it
now appears in the gallery as the 5-day loop instead.

### 7.2 Worked example — the stacked pins the gate could not see

On 2026-09-18 a shelf file was imported into the app and **the Map tab came up wrong: fewer
markers than the timeline had stops, and the drawn route appeared to arrive at an unmarked
spot.** The coordinates were all valid — every one inside India, none on Null Island — so
the validator was clean and the golden test was green. What the map was actually showing:
**27 duplicate-coordinate clusters across the six files** (8 of them same-day groups of
different places; a four-stop Gulmarg day shared one point), because the original research
pass had geocoded a handful of places per district and reused the hit for every nearby stop.
Nothing in the trip data is *invalid*, so only a rule about **distinctness** could catch it.

Three fixes, in the order they belong:

1. **The gate** — `validate-itinerary.mjs` now errors on same-coordinate clusters unless the
   cluster is same-venue, and prints the cluster with its titles.
2. **The data** — **32 stops** were moved to their real, individually-geocoded coordinates;
   the 10 same-day pairs that remain are legitimate same-base meals (a highway lunch in the
   town whose lake viewpoint is next, dinner back at the homestay) and pass under the
   same-venue rule.
3. **The renderer** — `src/lib/pinOffsets.ts` fans coincident markers out in a small ring so
   user trips with two stops at one venue stay legible.

The general lesson, which now applies to every rule in this document: **a gate that checks
values cannot see a defect that lives in the *relationship* between values.** Uniqueness,
ordering and cross-reference rules need their own pass, and "all coordinates are valid" is
not the same claim as "all pins are distinct".

---

## 8. Versions, migrations and the repair path

The format will change. The rule that keeps old files importable is that a **format change
bumps `ITINERARY_FORMAT_VERSION` and ships a migration in the same commit** — never a silent
shape change, and never a shape change that only the newest file satisfies.

### 8.1 What a version means

`formatVersion` describes the **shape of the file**, not the app release. The app's own
version rides along as `app` (`"yatraflow/0.60.0"`) for diagnosis only; it plays no part in
the decision, so a file written by any build reads by its `formatVersion` alone.
A file with no `formatVersion` is treated as **version 1** (the original hand-authored
shape) rather than as an error.

### 8.2 The migration chain

`MIGRATIONS` in `src/lib/itinerarySpec.ts` is a map from *source version* to a pure
function that lifts the trip one step: `1 → 2 → …`. Import reads the declared version,
walks the chain to the current one, then runs the normalizing pass. Two properties are
non-negotiable:

- **Migrations are pure and total** — same input, same output, no network, no clock. They
  are unit-tested one row per version.
- **A missing step is an error, not a guess.** A file claiming a *newer* version than this
  build understands is refused with an honest message ("this file was written by a newer
  version of YatraFlow") instead of being half-read into a broken trip. Forward
  compatibility is expressed by the same rule: the importer tolerates unknown *extra* keys
  inside the envelope, so a next-version file authored with extra metadata still imports its
  known half.

### 8.3 What the importer repairs silently, and what it reports

Repair is the importer's job; a user should never be handed a stack trace for a file from a
previous version. The pass normalizes: missing optional numerics to their honest defaults,
`orderInDay` to 1-based contiguity, day `index` to array position, a stop with unusable
coordinates **dropped** (never pinned to Null Island), `days.length` reconciled against the
date span, ids regenerated uniquely, and unknown enum values to a safe member — recording
every intervention. The result is surfaced to the user as a **digest** (`digestImportReport`)
rather than a wall of text: "Imported with 6 changes — 3 stops renumbered, 2 dropped for
missing location, 1 version upgrade".

Two shapes beyond the envelope are accepted, because real files in the wild have them:

| Input | Handling |
|---|---|
| A bare `Trip` object (`{ name, days: […] }`) | Treated as the trip itself; a `formatVersion` alongside it is read as file metadata and stripped, not reported as a stray field |
| A gallery file that nests a trip (`{ trip: …, publication: … }`) | Read as an envelope: the nested `trip` imports, the row becomes the `publication` half |
| A publication row with **no** days (`{ id, title, tagline, … }`) | Refused **by name** — "a published-itinerary row, not a trip export" — because there is genuinely nothing to import. Naming it is the point: the commonest wrong file a user can pick is the one they exported from the dashboard |
| A file with publish details but no `trip` block | Refused as incomplete |
| Publish details *outside* a `publication` block, or a `visibility: "public"` on the trip | Ignored — **a file never decides visibility**; publishing stays a deliberate act in the Share tab |

Anything else — a Supabase export dump, an array, a truncated file — fails **loudly** with a
message naming what was found, because "could not read this file" is recoverable and a
half-imported trip is not.

### 8.4 The check that must not rot

`tests/trip-import.test.ts` pins, per version: the migration, the unknown-newer-version
refusal, the bare-trip and bare-publication shapes, the repair digest, the coordinate
refusal, the stacked-pin warning, and the 1-based renumbering. When the format next changes,
the new migration is added *beside* those tests with its own fixture — the old fixtures stay,
because their whole purpose is to prove the older file still imports.
