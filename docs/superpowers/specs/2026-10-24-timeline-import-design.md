# Timeline import for creator travel stats: design

**Date:** 2026-10-24
**Status:** Draft for review. No code exists. This spec sets no release date.
**Roadmap:** I-58 (travel-proof creator stats), with I-56 (private report) as the private side.
**Parent brainstorm:** `docs/commercial/BRAINSTORM-2026-10-12-creator-portfolio.md`

## 1. Purpose

A creator can load a Google Maps Timeline export in the browser. The app turns it into a few private travel stats. The creator then chooses which stats to publish on the public creator page. Each published stat carries an evidence label.

Success looks like this:

- A creator with a real export sees correct stats within one minute.
- The raw file and all unpublished data stay on the creator's device.
- A visitor can tell a typed claim from an imported one.
- No stat claims more than the data supports.

## 2. Decisions agreed with the owner

| # | Question | Decision |
| --- | --- | --- |
| 1 | Who sees the stats? | Private first. The creator publishes each stat by choice. |
| 2 | Which stats in v1? | Places and cities visited, distance travelled, nights away from home. |
| 3 | Where do unpublished stats live? | On the device only (IndexedDB). Only published aggregates reach the server. |
| 4 | Which file formats? | The new on-device export only, in both root shapes. |
| 5 | How much may a creator publish? | Totals, plus city names dated by month. Home is removed. |
| 6 | How to build it? | Approach A: a thin own engine, with MIT code as reference. |

## 3. Scope

**In v1:**

- A file reader and a stats engine.
- An offline city lookup and a Web Worker.
- A device store and a Creator Hub tab.
- A publish function and one table.
- A public "Travel" block on the creator page.

**Out of v1:**

- Indian states and countries.
- Trip detection and altitude.
- The legacy `Records.json` format, GPX and KML.
- Itinerary drafts from Timeline.
- Instagram data.

Each of these is a later slice.

## 4. Prior art (AGENTS rule 18)

Licences and push dates were checked with `gh api` and `npm view` on 2026-10-24.

| Project | Licence | Use |
| --- | --- | --- |
| `mahlernim/google-timeline-visualizer` | MIT | Adapt. Format handling and streaming in the browser. Keep attribution. |
| `shawntabrizi/google-timeline-country-parser` | MIT | Adapt. Presence rules and the sampling of long visits. Keep attribution. |
| `DanMat/waypoints-kit` (`@danmat/waypoints-core`) | MIT | Adapt ideas. Stays, cities, home scrub. Not a dependency: version 0.1.1, 0 stars. |
| `@streamparser/json` | MIT | Dependency. Streaming JSON parser. |
| Dawarich, Timelinize | AGPL-3.0 | Ideas only. Copy no code. |

The repo has no declared licence. Check each source file's licence again before you copy code from it.

## 5. Architecture

| Unit | Job | Depends on |
| --- | --- | --- |
| `src/lib/timeline/readTimeline.ts` | Streams the file. Emits normalised events: visit, activity, path point. | `@streamparser/json` |
| `src/lib/timeline/stats.ts` | Pure functions: home, nights away, distance, places, cities. | Events only |
| `src/lib/timeline/gazetteer.ts` and a lazy city file | Offline nearest-city lookup. | Bundled data |
| `src/workers/timelineWorker.ts` | Runs the three units off the main thread. Posts progress and the result. | The three units |
| `src/lib/timeline/localStore.ts` | Keeps the result in IndexedDB. Has a "forget" action. | Browser only |
| Creator Hub tab "Travel stats" | Pick a file, review, publish. | Worker, store |
| `publish_creator_stat` function and `creator_travel_stats` table | Accept only published aggregates. | Supabase |

**Data flow:** file, worker (streamed), events, stats, home removed, aggregate result, IndexedDB, review screen, ticked stats, function, public read.

**Two boundaries:**

1. Raw events never leave the worker. Only the finished aggregates cross to the page.
2. The server accepts only published aggregates. It rejects every unknown shape.

## 6. File reading

The reader accepts two root shapes: a bare array of segments, and an object with `semanticSegments`. It reads these coordinate forms: a `geo:lat,lng` string, a degree string, a `latLng` object, and integer E7 values.

Timestamps carry a local offset. The reader keeps the local date and the minutes since local midnight. A timestamp with no offset gets the flag `zoneAssumed`, and the stats report how many such records exist.

The reader maps activity types to modes. The parser sources show `IN_PASSENGER_VEHICLE` and `FLYING`. The full list is not verified, so an unknown type maps to `other`.

The reader returns one of three results:

- `ok`.
- `notTimeline`: the file has no known root shape.
- `endedEarly`: the JSON stops before it closes.

An `endedEarly` result keeps its events for private viewing. It blocks publishing.

## 7. Stats rules

Thresholds are constants in one file, each pinned by a test. We tune them against a real export.

| Item | Rule |
| --- | --- |
| Home | The file's HOME label if it exists. Otherwise the 1 km cell with the most distinct nights. The creator confirms or changes it. "No fixed home" turns off the nights stat. |
| Away night | At 03:00 local time, the position is in another city than home and more than 50 km away. |
| Unknown night | No position within 6 hours of 03:00. It is not counted. The result shows "nights known: N of M". |
| Distance | The sum of each activity's own distance, by mode: road, rail, air, water, walk, cycle, other. A missing distance comes from the path points, with a speed cap. If that fails, the activity is left out and counted. |
| Place | A stay of 20 minutes or more. A place is a distinct place ID, or a 100 m cell when no ID exists. Home and work are excluded. |
| City | The nearest gazetteer city within 30 km of a stay. Home city is excluded. A city is dated by its first month, as `YYYY-MM`. |
| Period | Each stat is computed per calendar year and for all time. |

Distance is never merged with planned distance. The label says the phone recorded it.

## 8. Evidence labels

| Label | Text shown to visitors | In v1 |
| --- | --- | --- |
| `declared` | Declared by the creator. | Yes |
| `imported` | From the creator's Timeline file. We cannot check the file. | Yes |
| `verified` | A platform source confirmed it. | No. Reserved. The server rejects it. |

Every imported stat also shows its coverage dates and its known-of-total counts. A file hash does not prove that a file is genuine, so the app never calls imported data verified.

## 9. Server

**Table `creator_travel_stats`** holds published stats only.

- Columns: `creator_id` (references `profiles`), `stat_key`, `period`, `value` (jsonb), `evidence`, `coverage` (jsonb), `published_at`.
- Unique on `creator_id`, `stat_key`, `period`.
- `stat_key` is one of `places_count`, `distance_km`, `nights_away`, `cities`.
- `evidence` is `declared` or `imported`.

**Function `publish_creator_stat`** is the only write path.

- It checks that the caller owns the row and has `is_creator`. Issue #252 may change this gate.
- It checks the value shape for each key and rejects unknown keys.
- Caps: 500 cities, 80 characters per city name, and a maximum for every number.
- Every city month must match `YYYY-MM`. A day is never accepted.
- It rejects `verified`.
- Unpublish deletes the row.

**Rules from the repo pitfalls:**

- Guard each policy with `drop policy if exists`.
- Revoke direct writes from `public`, `anon` and `authenticated`. Name `anon`.
- Grant execute on the function to `authenticated` only.
- Drop an old overload before `create or replace`.
- Add the contract assertions to `supabase/tests/rls_contract.test.sql`. Assert `pg_policies` for each policy.
- Call the function through its real client path before you call the work done.
- Give the owner each migration as complete SQL in chat, with its absolute path.

## 10. Screens

The Creator Hub gets a third tab, "Travel stats".

1. **Pick a file.** A plain line says the file stays on the device.
2. **Progress.** A progress bar with a cancel button.
3. **Review.** The creator confirms home. Each stat shows its value, label, coverage and known-of-total counts.
4. **Publish.** One tick per stat, then one confirm.

The public creator page gets a "Travel" block. Each stat shows its label chip.

Loading, empty and failed states stay separate. The page never invents data. Motion uses tokens from `docs/MOTION-TOKENS.md`. The file field has a label, and the progress bar has `role="progressbar"`.

## 11. Privacy and consent

- The file is read in the worker and never uploaded.
- The import screen tells the creator this before the file is picked.
- The publish step lists exactly what becomes public and asks for one confirm.
- Home and work are removed from every output.
- A "forget" action deletes the device copy.
- A tripwire test fails if any file under `src/lib/timeline/` or the worker uses `fetch`, `XMLHttpRequest`, `sendBeacon` or the Supabase client.

The repo has no privacy-policy page and no consent record. Publishing real city data needs at least a short notice page. This spec makes that page a dependency of the publish step.

## 12. Testing

- Hand-built synthetic files in both root shapes and every coordinate form. No real location data enters the repo.
- Unit tests for the reader, the stats and the gazetteer, in the node environment. The worker stays a thin wrapper.
- Tests for the failure results: `notTimeline`, `endedEarly`, `zoneAssumed`.
- The tripwire test from section 11. It strips comment lines and converts CRLF to LF first.
- SQL contract tests for the table and the function.

## 13. Rollout

A build-time flag in `src/lib/featureFlags.ts`, off by default. The city file loads only on import. Add the city source credit next to the map credits. Add a CHANGELOG entry and a ROADMAP tick in the same commit as the work.

## 14. Risks and open items

| Item | State |
| --- | --- |
| Licence of the city source (GeoNames, CC BY 4.0 as recalled) | Not checked. Check before you bundle data. |
| Who may be a creator (issue #252) | Open. The gate in section 9 may change. |
| Privacy notice page | Missing. A dependency of the publish step. |
| File picking and streaming in the Android shell | Not tested. |
| Whether current exports carry altitude or raw signals | Not verified. Out of v1. |
| Thresholds (50 km, 20 minutes, 30 km, 6 hours) | Proposals. Tune with a real export. |
| `profiles` reads use `select('*')` and the schema holds email | Older problem. Fix it separately. |
| Web Timeline removal and the fate of non-migrated users | No official statement found. |
