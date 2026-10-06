# Shared planning model — one truth for Map, Overview, Timeline

**Status:** accepted. It covers the A1–A3 repairs (#607, #608, #609).
**Scope:** meals, arrivals, warnings, commitments, day focus.

## Problem

Each tab computed its own facts. Map clocks used estimates. Timeline rows
used measured road times. Meal slots read opening hours as meal plans.
Commitment checks read the wrong stop. Four truths cannot agree.

## Rule

One schedule feeds every surface. `simulateDay` with the workspace road
corrections is that schedule. `buildDayCards` caches it per day. Every row,
warning, dial, and preview must read it — never a second estimate beside it.

## Meals

`fillStopFor` in `src/lib/daySlots.ts` owns every meal claim. Map and
Overview call the same function, so both tabs always agree.

- An explicit `slotKey` wins. A filed stop keeps its filed slot.
- A food stop claims the meal window its hours overlap most.
- Parks, waterfalls, safaris, museums, and sights never claim from hours.
- A slot with no honest claim stays empty. Empty asks for work.

## Arrivals and warnings

`collectWarnings` and `computeHealth` take the same corrections the rows
show. Pass the workspace `legCorrections` wherever measured clocks appear.
Keep the estimate fallback where no measurement exists (Board, Print, Explore).

One exception stays: the backtrack check reads road shape, not clocks. It
skips measured legs, but it never moves an arrival. Name it when you extend
the warnings — it is suspicion, not a clock.

## Commitments

`commitmentStopIndex` links a deadline to its stored stop id. The create
form offers the destination, creation resolves it once, and the Timeline
re-links it later. Each deadline checks arrival at its own stop. A deadline
with no stop raises `commitment-unlinked` and claims no conflict. A later
dinner cannot break an earlier boarding any more.

No guessing remains. A stale or missing link reads as no link.

## Day focus

One shared day focus drives Map, Overview, and Timeline. A tab that opens
must read the shared focus first. The rail reads the axis through
`resolveRailDay` and falls back to day one. All-days publishes scope
without moving the rail. A missing or removed day must fall back to day one.

## Consumers

| Surface | Schedule source | Warnings source |
|---|---|---|
| Timeline rows | `buildDayCards` sim | `collectWarnings(trip, legCorrections)` |
| Overview health | same sim | `computeHealth(trip, legCorrections)` |
| Impact preview | sim with corrections | same, both plans |
| Map and Overview slots | same journey | `fillStopFor` claims |
| Map pin clocks | `buildStopClock` (same journey) | measured, else `(est.)` |
| Board, Print, Explore | estimate fallback | estimate fallback |

## Change rules

- You must read the shared sim for a new timing fact.
- You must thread corrections into a new warning consumer.
- You must put a new meal rule in `fillStopFor`, not in a tab.
- You must keep estimate mode honest where no measurement exists.
- You must not parse a title for a day, a clock, or an identity.

## Follow-ups

- Repair the phone popup bounds (A6), the stopless-day map (A7), and the snapshot day labels (A8).
- Show one measurement state per tab (I-35) with exact fix links (I-28).
