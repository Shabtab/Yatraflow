## Maps & providers

Basemaps, provider quotas, coordinates, route measurement. Extracted from
`CODING_STANDARDS.md` §2 on 2026-10-05; entries are verbatim. The root
file's index says when to read here; pitfall rules `6a`–`6ag` stay there.

- **A drawn layer and a marker layer must share their source, or the line will touch points nothing marks.** The Map tab draws a selected day's engine journey (`buildJourney` — which can open at the previous night's stop and close at a synthesized destination or the ride home) while its pins come only from that day's *stored* stops. A route end could therefore sit on a bare spot and read as "the route stops" — a real report on 2026-09-17, where the line proved complete (3,481 road points ending exactly at the engine's endpoints) and only the marker was missing. Synthesized journey endpoints now get their own pin, deduplicated through `coLocates` (< 1 km); `lib/journeyMarkers.ts` is that seam. When two layers derive from different data, walk the drawn geometry's endpoints and assert every one is marked.

- **A span request's results are indexed by span offset, not by missing-leg position.** `routePath` measures ONE span covering the `first..last` *uncached* leg — which necessarily includes any cached legs inside it — so `missing[k]` and `chainLegs[k]` are different legs the moment there is a hole. Indexing by `k` handed the tail leg its neighbour's geometry **and** cached it under the neighbour's key, so the corruption outlived the draw (the symptom was a route that visibly stopped early, #polylines). Cached holes are this design's normal state, not an edge case — the leg cache is deliberately shared between the whole-trip chain and each day's ride — so every span-assignment change needs a test with a hole *between* two misses, not a cold cache or a single missing leg.

- **MapLibre/mapcn**: don't import `maplibre-gl` types directly in components —
  use the structural-cast pattern (`GeoJSONSourceLike` in TripMap.tsx).

- **Basemaps are OpenFreeMap (keyless, commercial-OK) — never reintroduce CARTO
  or Esri tiles.** `mapcn/map.tsx` `defaultStyles` =
  `https://tiles.openfreemap.org/styles/{positron,dark}`. Their `style.json`
  ships without `sources.*.attribution`, **but** the `openmaptiles` source
  points at the TileJSON `https://tiles.openfreemap.org/planet`, which carries
  the OSM/OpenMapTiles credit it needs — MapLibre resolves it and renders it
  itself. Do **not** also pass `attributionControl.customAttribution`: that
  duplicates the credit across the map (the bug the first #23 pass shipped;
  `tests/basemap-license.test.ts` is the tripwire). Do **not** "switch to OSM
  raster tiles": `tile.openstreetmap.org` is a different look, has no dark
  variant, and its usage policy discourages production apps.

- **MapLibre draws NO text for a fontstack the style's glyph host does not serve — and OpenFreeMap serves Noto Sans, not Open Sans (measured 2026-09-27).** The vendored `MapClusterLayer` shipped `"text-font": ["Open Sans Semibold"]`, which `tiles.openfreemap.org/fonts/Open%20Sans%20Semibold/0-255.pbf` answers **404** for, while `Noto Sans Bold` and `Noto Sans Regular` answer **200** — so #417's count badge would have drawn as a bare circle, silently and with nothing in the console. Any symbol layer added to this basemap takes its fontstack from that endpoint (a `HEAD` request is enough to check); `tests/map-cluster.test.ts` pins the badge's.

- **`noUnusedLocals: false` lets dead provider URLs rot in the tree** — four
  unused CARTO/Esri style constants sat in `TripMap.tsx` (with a comment
  describing a satellite toggle that never existed in the UI) and were a live
  licensing exposure in a file nobody was reading. When auditing third-party
  usage, grep for the **URL strings**, not just call sites.

- **"Resolved on pick" placeholder coordinates must be resolved AT the ingestion boundary — a raw write into trip data pins the journey to Null Island.** Both providers emit `latitude: 0, longitude: 0` placeholders on some hits, and the Map tab's Add-to-timeline paths copied them raw: a real user's route ran to the Gulf of Guinea, the split banner demanded 116 travel days, impact previews read ±45,616 km, and halt suggestions landed "around ~2400 km" in the Atlantic — every downstream number honest math over an ocean round-trip, and the whole verify gate stayed green (nothing exercises live pick flows). Fix: `requireHitCoords()` at every write-into-a-trip path (single add, Add-all, `LocationInput.choose`), refuse with a visible error/toast when unresolvable. Corollary: coordinate sentinels need BOTH coordinates checked — the live incident was a MIXED placeholder (lat 0, real lng) that `a !== 0 || b !== 0` happily accepted. When debugging "impossible" route geometry, screenshot-locate the offending pin first; every impossible number downstream of it is a red herring. (Found live 2026-09-14.)

- **A surface that RANKS or ANNOTATES by coordinates before any pick cannot consume "resolve-on-pick" placeholders — it needs a real-coords search.** The Map tab's search-to-add box used `searchPlaces` (Google autocomplete), whose hits are deliberately `(0,0)` placeholders — the quota economy is one Place Details call per *picked* row. But that box projects every hit onto the route to label/rank it, so all five results measured Null Island and rendered the identical "~1675 km into the trip · 8448 km off-route" — the tell that a ranking surface ignores hit coords entirely is *equal annotations on different hits*. Fix: `searchPlacesText` (one free-form Text Search Pro event, real locations in the same single call the corridor scan already pays; coord-less stragglers resolved-or-dropped; `QuotaExhaustedError` rethrown to an honest toast). Rule of thumb: **autocomplete for pick-one inputs, Text Search for rank-everything surfaces** — don't "reuse" the cheaper SKU on a surface whose math needs coordinates it doesn't have. (Found live 2026-09-14.)

- **A directive that reverses behavior must sweep its own strings in the same commit.** When the Google-only directive landed, `QuotaExhaustedError` still said *"falling back to the free stack"* and the quota-guard header still described the old fallback — the code had changed, its self-description lied. When reversing any behavior, grep for the OLD behavior's phrasing in error messages, comments, README, and ARCHITECTURE (this bit us once per surface: message, quota.ts header, geocode docstring).

- **A derived input that algebraically cancels is a constant in disguise.** Road personality's "per-window speed" was `windowKm / (driveMinutes × windowKm / totalKm / 60)` — the `windowKm` cancels, leaving the day's average painted on every window, and the tests then codified the wrong semantics. When a derived value cancels to something coarser than its name implies, stop and either compute the real signal (per-leg durations from OSRM) or move the verdict to the level it actually measures (day-average → explicit day-level check, as now done for the city-crawl kind).

- **Never subtract one engine's route total from another engine's internal legs.** Google's Search-Along-Route `routingSummaries` route start→place→end independently of the polyline, so `(leg0 + leg1) − <route total measured by anything else>` inflates by the two engines' route-variant difference: **+47 km on a 1,400 km corridor** (a highway petrol pump read "50 km off", torching the detour budget and holding back See & do) but only ~1–3 km — plausible-looking — on the short corridors used in earlier testing, which is how it hid for weeks. `routesEnabled()` only checks that a key string exists, so an un-enabled Routes API (HTTP 404) silently fell back to OSRM totals while the summaries stayed Google-baselined. SAR detours are now the geometric spur against the same polyline the search ran on (`spurKm`, google.ts); leg0 remains the road position. The invariant to pin in any future detour source: **a place on the drawn road must read ≈0**, and it must hold on a 1,000+ km corridor, not a 50 km fixture. (#187)

- **Cadence bugs only show on load-balanced multi-day plans — fixture the 350-km day.** planRideSegments' per-day-reset cadences were designed when days were the 550-km tick; load balancing (P1-A) shrank days to ~350 km and two cadences silently produced ZERO segments on every such plan (a 1,400 km trip grew no meal and no fuel suggestions): the fuel push (382.5 km step from each day start never landed inside a 350-km day — fuel runs on a corridor-wide cadence; the tank doesn't reset overnight) and the #131a overnight absorb (a slid lunch sits at the 14:30 window edge, ~98 km = 2 h 20 m before the halt, inside the 110-km km-only bound — the absorb is now time-bounded to ~1 h: a stop that close is "dinner at the halt anyway", an earlier one is a real meal). When touching halt cadences, test with 1,400 km / 4-day load-balanced shapes, not just single-day or 550-tick shapes. (#189)

- **Google Text Search cannot discover place TYPES — it matches text against POI names.** `textQuery: 'towns and cities'` returns 200 with zero places (or ice-cream shops named "Top N Town") — the city anchor layer had quietly returned zero localities, starving every night-halt suggestion. Type-based discovery is `places:searchNearby` + `includedTypes: ['locality', …]` with the Essentials-only field mask (hours/rating fields upgrade the SKU), counted under its own `nearbySearch` quota SKU. Rural corridors can still return zero localities in a 35–50 km circle while the start-city circle returns many — guard the assignment: a city nowhere near its segment's km is dropped (an honest GAP beats a "night halt" 700 km from its halt). (#189)

- **`searchNearby` accepts a NARROW type list, and ONE bad member 400s the whole request.** Asking for `['locality', 'administrative_area_level_3']` (both fine in Text Search) failed every call with `Unsupported types: administrative_area_level_3` — and because the caller `.catch()`es, the layer returned `[]` and the surface read as "no towns anywhere" instead of as a broken request. Every night halt starved on every trip while tsc, tests and build stayed green (the fixtures mock fetch, so no test could see it). **Validate provider enum values against the LIVE API before shipping the list** — `scripts/verify-google-places.mjs` is the place for it — and prefer one type per call over a speculative union. (#189)

- **Google's `locality` bottoms out at VILLAGE level in rural India.** At halt points on a 1,400 km corridor it returns hamlets (Gauriyapur, Muhammadpur, Kuit Mandir) with no population to rank by, while OSM's `place=city|town` at the same points returns real towns WITH population (Chunar 37k, Mirzapur 234k, Hazaribagh). A night halt needs a town with a bed, so "the locality layer returned something" is not the same as "the halt is anchorable" — check what KIND of place came back, not just the count.

- **A provider that degrades internally must be checked for QUALITY, not just for throwing.** `routePath` never rejects: on an OSRM failure it returns haversine `estimate` legs (by design — "planning never blocks"), so the `.catch()` handlers around it could not see a rate-limited day at all. The code drew straight chords and treated them as a measured road, and the symptoms ("no retry", starved suggestions) read as provider flakiness rather than a swallowed failure. The road measurement now grades the RESULT (`legs.some(l => l.source !== 'estimate')`) and retries once on an all-estimate chain. When wrapping a facade that swallows its own failures, assert on the degraded output (a `source` field, a flag, a sentinel) — a rejection you never receive is not a failure signal. (#188)

- **A duplicated measurement needs a WIRING test, not just a unit test.** #184 unified MapTab → TripMap and its acceptance asked for a fetch counter "per map open"; the workspace kept its own `routePath` chain anyway, because nothing asserted WHERE the measurement happens — tsc, tests and build all stayed green with two callers, and the duplicate doubled the load that caused the failures it was fixing. The pin is a source invariant (`tests/trip-road.test.ts`): the map surface must not call `routePath`, the workspace must measure through `tripRoad`, and that module owns exactly one call. Same shape as route-integrity / mobile-shell — cheap, and it fails the moment a second caller appears.

- **Suggestion searches are expensive — persistence is the contract.** Corridor
  searches (Map-tab nearby, timeline halt spots) must hydrate from
  `useSuggestionCache` and never auto-refetch from derived-state churn: the map
  effect's deps on `planKm`/`wholeTrip.min` re-fire when OSRM resolves *after*
  mount, and a `[day]`-reset effect wiped timeline spots on every trip edit.
  Only explicit user controls (↻ Refresh, detour-scope slider, 📍 Suggest) may
  re-run a search. Corollary: a "clear the cache" button does nothing unless
  some state it affects is in the fetch effect's dep array (the broken ↻
  Refresh) — pair cache-clearing with a `refreshTick` bump.

- **The clock walk numbers DRIVE days, not calendar days — anything mapping
  `TravelClockDay.dayIndex` onto `trip.days` or a date must anchor
  deliberately.** The walk splits the road by caps (`planDriveDays`) and the
  return pass (`#145`) indexes its days continuing the outbound count, so its
  indices are neither itinerary positions nor dates: joining corridor `cumKm`
  against a return label's turnaround-relative km needs the origin-scale
  mirror (`outboundKm − km`, measured off the drawn polyline), dating return
  drives needs the trip's tail (`tripDaysCount − returnDays.length + local`),
  and a tap target needs the resolved itinerary day (`ClockMilestone.itineraryDay`)
  with the consumer validating it against `trip.days` — a value no DaySection
  matches collapses the whole accordion. One-shot cross-component signals must
  also be consumed-and-cleared at the consumer (the workspace outlives trips;
  `TripWorkspace` is not keyed by trip id), or they re-fire on every later
  mount and leak across trips.

- **The halt planner's plan + resolved spots must be written together** (`setHaltCache(day, segments, plan)`), because hydration rebuilds the editable plan from `cache.plan` and the pinnable real spots from `cache.segments[i]`. And the corridor search behind "🔎 Find real spots" runs **only on that button** — never on plan edits — per the §4 persistence rule; a `[day, sugCache]` hydrate effect that clobbers an in-progress edit is guarded with an "only rehydrate while the plan is empty" check.

- **`kmFromStartForHit` takes `Pick<PlaceHit, 'latitude' | 'longitude' | 'alongRouteKm'>`** — an ItineraryStop's `lat`/`lng` must be remapped (`{ latitude: s.lat, longitude: s.lng }`), it will not type-accept the stop directly. Same asymmetry to watch on any `PlaceHit`-shaped helper.

- **Planned halts are on-route by default; real spots are opt-in.** The halt planner's `pin` flag must default to `false` — the planner auto-attaches the best place found near a km point, and a `true` default silently redirected every halt to that place. The row shows an explicit "detour to <place> instead of the route point" checkbox.

- **A Wikimedia cover cannot be fetched from a browser even though curl reads it fine (learned 2026-09-19).** Copying an auto-suggested cover into our own bucket needs the bytes, and `Special:Redirect/file/<File>?width=N` — the shape `sizedCoverUrl` writes and the picker stores — answers a **301** to `upload.wikimedia.org`. Only the final 200 carries `access-control-allow-origin: *`; the 301 hop carries none, and a cross-origin fetch must clear **every** hop, so `fetch()` rejects with a bare `TypeError: Failed to fetch` while the identical curl request downloads 586 KB happily. Resolve the direct address first through the file's own wiki API — `https://<host>/w/api.php?action=query&prop=imageinfo&iiprop=url&titles=File:<name>&origin=*` — whose `imageinfo[0].url` is an `upload.` file, and `upload.wikimedia.org` file URLs are the only Wikimedia addresses a browser may read directly. Three corollaries: the API appends its own `?utm_*` query, which must be stripped before the URL is stored; the name in the URL is percent-encoded while the API wants it decoded, so decode **once** or `Telkupi%252C_Purulia.jpg` is born; and `wikimediaFile` in `tripThumb.ts` parses only the direct `/wikipedia/…` shape, so the `Special:Redirect` form needs `wikimediaFileName` — assuming the one function covers both is how the first version failed.

- **Wikimedia serves only the thumbnail widths it has generated — a composed width answers 400.** Auto covers read the REST summary's `originalimage`/`thumbnail`, which is either the *unscaled* upload or a 3840px thumb (1.3–3.3 MB measured across real destinations), so the obvious fix — build `…/thumb/<h>/<hh>/<File>/1200px-<File>` — 400s on **both** `upload.` and `thumb.wikimedia.org`, and so does substituting the width into a URL the API itself returned. The supported route is `Special:Redirect/file/<File>?width=N`, which 301s to the nearest size that exists (1200 → 1280) and measured 144 KB where the original was 1304 KB. Two corollaries when matching these paths: strip the `?utm_*` query the API appends (it is captured as part of the file name otherwise and produces a nonsense URL), and take the file name **exactly as it arrives** — it is already percent-encoded, so decoding then re-encoding double-escapes `Telkupi%2C_Purulia.jpg`. `lib/tripThumb.ts` `COVER_WIDTH` is the single lever if a future cover exceeds the 600 KB preview ceiling.
