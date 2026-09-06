# The Suggestion Engine — deep brainstorm (Sep 2026)

Status: **design thinking, not commitments.** This doc maps how trip
suggestions actually work today (Timeline halts + Map nearby ideas), names
what's wrong with it honestly, and evolves it into a target architecture we're
calling the **Corridor Concierge** — a journey-clock-aware, road-personality-
aware, trip-DNA-personalized suggestion system that no mainstream planner has.
Pull items into the roadmap with slack; the horizons in §4 are the suggested
order.

---

## 1. How it works today (the honest map)

Two suggestion surfaces share one provider-agnostic pipeline
(`src/lib/geocode.ts` → `providers/*` → `lib/ridePlan.ts` → `lib/providers/hits.ts`):

### A. Map tab — "Nearby ideas" (`searchNearbyPoisMulti` → `rankAndCap`)
1. **Corridor sampling** — the OSRM route polyline is walked into ≤12 anchors
   spaced ~radiusM apart (`corridorAnchors`); the 15 km home zone around the
   trip start is excluded.
2. **Provider search** — Google mode: one Search-Along-Route event per category
   (real road detours + opening hours on hits). Free mode: Overpass /
   Wikipedia / Mappls around each anchor.
3. **Tourist ranking** (`poiTouristScore`): category priority (−8/step),
   Wikipedia thumbnail +5, meaty description +3, sight-class categories +3,
   **gap bias** from `computeCategoryBias` (covered categories −4; hungry
   self-drive days without food +5; multi-day with no hotel +5), plus a
   distance-to-nearest-anchor penalty.
4. **Diversity caps** — ≤⅓ of results per category, ≤2 fuel, to stop a wall of
   dhabas or temples.
5. **Cache** — results persist across tab switches for 4 h
   (`useSuggestionCache`, keyed by anchor hash); only Refresh / scope slider /
   new anchors re-query.

### B. Timeline — the halt planner (`planJourneyHalts`)
1. **Fatigue-budget segments** (`planRideSegments`): cadences walked per day —
   stretch every 150 km (~2 h), meal every 300 km (~4 h), fuel every
   0.85 × tank range, overnight every 550 km (~7 h). Collisions closer than
   110 km fold (priority: overnight > meal > fuel > stretch); cadences **reset
   after each overnight**; nothing within 60 km of the destination; drives
   under 90 km get no segments.
2. **Candidate pool** — POIs for the segments' purposes + key cities
   (populated places) along the corridor.
3. **Assignment** (`assignSegmentHits`): per segment, the best-scoring hit =
   |position − target| (penalized outside the window) + 2 × straight-line
   detour + (3 − purpose-fit) × 4. Purpose-fit rewards populated places for
   meal/fuel/overnight and city size (log population) for overnights. Greedy,
   journey order, name-deduped.
4. **Annotation** — every assignment carries cumKm, leg km/minutes, nearest
   big city, and a human hint ("≈2 h wheel time — stretch & hydrate").

**What's genuinely good:** the fatigue-budget idea itself (segments before
places — spacing is planned, then real places fill them); cadence reset after
overnights; the home-zone exclusion; gap-bias closing itinerary holes; the
per-category diversity caps; provider-agnostic pure functions with a real test
file; graceful Google→free degradation.

---

## 2. Issues & gaps (numbered, roughly by pain)

| # | Issue | Why it hurts |
|---|---|---|
| 1 | **Haversine positions.** A hit's "km from start" is projected onto straight-line anchors. On Himalayan/ghat switchbacks the road is 1.5–2× the crow flies, so a "≈300 km" lunch segment can attach to a place that's really 380 road-km in — every downstream number (leg km, arrival feel) inherits the drift. | Correctness of the core coordinate. |
| 2 | **Greedy, order-dependent assignment.** Segment 1 grabs its best hit even when it steals the only great lunch spot from segment 3, where it fits better. | Subtle but real quality ceiling. |
| 3 | **The clock is blind.** Meal cadence is km-based: a 6 AM departure puts "lunch" at 10:30 AM. Overnights don't know sunset. Opening hours (which Google mode already fetches!) never enter the score. | Suggestions that don't survive contact with the day. |
| 4 | **Travellers are faceless.** Cadence constants assume one driver and no kids. The trip knows travellers count, travel style (relaxed → packed), vehicle profile — none of it bends the fatigue budget. | "Packed" and "relaxed" trips get identical stretch math. |
| 5 | **Weather-blind.** The app has per-day rain forecasts; the corridor search doesn't consume them. Monsoon Goa still gets beach suggestions ranked to the top. | Easiest big trust win being left on the table. |
| 6 | **Name-only dedupe.** "Echo Point" and "Echo Point Viewpoint" both survive; two candidates 200 m apart both survive. Also: **no cross-check against the itinerary's own stops** — nearby ideas can re-suggest what's already planned 2 km away (category bias softens this, places aren't deduped). | Duplicate-looking cards erode trust. |
| 7 | **Flat detour math.** Detour km × 2 is speed- and road-blind: 10 km off a highway ≠ 10 km off a mountain single-carriageway, and the return-to-route cost is symmetric when it rarely is (destinations on the way). | Ranking subtly wrong on exactly the drives where it matters. |
| 8 | **No popularity signal in free mode.** Wikipedia imagery is a good sight proxy; food/fuel/stay quality is invisible (no ratings used even when Google supplies them). | Meal and hotel picks are geography-only. |
| 9 | **Surfaces are siloed.** Group-input suggestions (the crew's own ideas) and the engine's corridor ideas never talk. A stop the crew already proposed doesn't inform the engine. | Missed cohesion + the "crew suggested this" moment. |
| 10 | **Explanations are thin.** Cards say the nearest city; they could say *why*: "breaks a 4 h drive · 6 min off the highway · open till 23:00". The data to generate reasons already exists in the SegmentHit. | Persuasion gap — good suggestions don't justify themselves. |

---

## 3. The target: Corridor Concierge

One idea unifies the evolution: **suggestions should know where you are on the
road, what time it will be when you get there, what the road will be like, and
what your crew likes — and say why.**

### Horizon 1 — make the current engine *true* (polish, ~1 release)
- **Road-projected positions:** project every hit onto the OSRM polyline
  (nearest-point snap) and read cumulative road-km from the polyline, not
  haversine-to-anchor. Fixes #1 at the root; leg km/minutes become road-true.
- **Two-pass assignment:** greedy first, then one improvement sweep — try
  swapping each assignment with any other segment's hit and keep swaps that
  lower total score. Kills #2 for ~30 lines.
- **Itinerary dedupe:** drop candidates within ~2 km of, or name-matching
  (fuzzy), an active stop. #6.
- **Geo-fuzzy candidate dedupe:** <500 m + normalized name overlap → same
  place. #6.
- **Reason strings:** render "Why: breaks a 4 h stretch · 8 min off-route ·
  biggest town for 90 km" from the SegmentHit data. #10 — cheap and very
  visible.

### Horizon 2 — make it *aware* (the smart release)
- **Journey clock:** convert each segment's road-km to a wall-clock estimate
  from the day's `startTime` + schedule engine; meals must land in eating
  windows (11:30–14:30 ±), overnights before ~19:00, fuel before the tank
  range runs out. Segments shift to the nearest plausible clock window and
  their windows re-derive. Fixes #3 properly.
- **Crew-aware cadence:** multipliers from trip facts — travellers ≥5 or
  style `relaxed` → stretch 120 km / meal 260; `packed` → stretch 180; kids
  flag (future) → shorter still. Vehicle range already feeds fuel cadence.
  Fixes #4.
- **Weather join:** the daily forecast already exists — rainy-day days
  downrank nature/beach/temple (weather-sensitive flag exists on stops!) and
  uprank museums/cafes/malls; the suggestion card says "indoor pick — 90%
  rain". Fixes #5.
- **Detour in time, not km:** convert detour via mode speed (engine
  assumptions exist) and treat on-way hits as ~zero-detour. #7.
- **Ratings in Google mode:** fold `rating`/`user_ratings_total` into
  `poiTouristScore` when present. #8.

### Horizon 3 — make it *unique* (the moat)
- **Road personality:** classify each leg from OSRM geometry curvature +
  spacing — highway / state road / ghat switchback / city crawl. Then:
  suggest the stretch **before** a technical ghat section ("rest before the
  climb — 40 km of switchbacks ahead"), fuel before long no-fuel corridors,
  and say it in the hint. No consumer planner does this.
- **Detour budget:** each day earns a detour budget (f(style, day density));
  accepting suggestions visibly spends it ("this uses 30% of today's detour
  budget"), and the planner stops offering beyond it. Turns endless
  suggestion lists into a finite, honest menu.
- **Trip DNA:** log accepted/declined suggestions and accepted group ideas
  per trip (and across a user's trips); build a small preference vector
  (category mix, detour tolerance, stop length, budget class). Score new
  candidates by similarity and say "you've picked 3 sunrise viewpoints this
  trip". The engine learns the crew — this is the retention moat.
- **Crew-seeded suggestions:** group-input ideas feed the engine — a proposed
  stop both (a) suppresses duplicate corridor suggestions near it and (b)
  biases the corridor toward similar places ("more like Arjun's waterfall").
  Fixes #9.
- **Story arcs:** cluster candidate sights by theme (fort, spice, backwater,
  pilgrimage — Wikipedia text gives the tags) and offer a themed *day* —
  "Fort day: Amer → Nahargarh → Jal Mahal lunch" — as a one-tap multi-add.
- **Slack prompts:** after any itinerary change, compute the day's slack and
  surface "you have ~90 min slack in Jodhpur — Jaswant Thada is 15 min away".

---

## 4. Suggested pull order

| When | Items |
|---|---|
| Quick wins (one slack batch) | H1 road projection, H2 two-pass, H3 itinerary dedupe, H4 geo-dedupe, H5 reason strings |
| "Aware" release | Journey clock, crew cadence, weather join, time-detours, ratings |
| "Concierge" release | Road personality, detour budget, trip DNA, crew seeding, story arcs, slack prompts |

Horizon 1 items are all pure-function changes with existing test files
(`tests/ridePlan.test.ts`, corridor tests) — cheap to land, immediately
visible in suggestion quality. Horizon 2 needs the schedule engine and
weather layer to talk to the corridor search (both exist, just unconnected).
Horizon 3 is where YatraFlow stops being "a planner with suggestions" and
becomes "the planner that knows the road and the crew."
