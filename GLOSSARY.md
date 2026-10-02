# Glossary

The domain vocabulary of YatraFlow. Every term here is grounded in a specific
export — follow the link before using a term in code or in a brief.

**These entries describe what the code does today.** If behaviour changes,
update the entry in the same change: a stale glossary is worse than none.
Prose that already plays this role — and should be linked, not duplicated — is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/MOTION-TOKENS.md`](docs/MOTION-TOKENS.md) and
[`DESIGN_TOKENS.md`](DESIGN_TOKENS.md).

## The plan

**Trip** — one journey. The root entity: dates, crew, transport mode, days.
[`src/data/types.ts`](src/data/types.ts) `Trip`.

**Itinerary day** — one day of a trip, addressed by `day.index` (0-based) and
**never** by array position. [`ItineraryDay`](src/data/types.ts).
> The index-vs-position distinction is load-bearing: `computeTotals`,
> `originOf`, `firstFixedPoint` and `lastActiveStopPoint` each got it wrong
> separately. See AGENTS.md §6 (day-keyed bug lesson).

**Stop** — one place within a day. [`ItineraryStop`](src/data/types.ts).
**`orderInDay` is 1-based** (the importer renumbers from any base to match).

**Stop category** — what kind of place a stop is:
`sightseeing · food · nature · beach · temple · adventure · shopping · museum ·
travel · hotel · rest · event · transport-hub`
([`STOP_CATEGORIES`](src/data/types.ts)).

**Stop status** — whether the stop is in the plan:
`suggested · confirmed · rejected · maybe · needs-booking`
([`STOP_STATUSES`](src/data/types.ts)). A **rejected** stop stays stored and
keeps its `orderInDay` — surfaces that filter it must renumber the whole day,
never leave hidden rows holding old positions (AGENTS.md §6r).

**Slot key** — the part of the day a stop was filed as
(`breakfast · lunch · dinner · fuel · stretch · stay`). Provenance stored as
**data** on `slotKey`, never parsed back out of the user-editable `notes`.

**Auto stop** — an engine-generated anchor (`stop.auto`), safe to move or
delete.

## The crew and the wallet

**Travellers** — party size. **Driver count** — licensed drivers rotating the
wheel. **Vulnerable aboard** — infants or seniors; shortens the honest day and
moves dinner earlier.

**Expense** — a money line. Group total unless `perPerson`. `paidBy` absent
means the shared kitty, so nobody is individually owed. `settled` records who
marked it settled and when.

**Stay style** — `budget · comfort · luxury`. The ONE list every surface shares
(Create Trip, Trip settings, Plan Bench, `STAY_RATE_PER_NIGHT`). It used to be
declared three times inline, which is how the bench's tier silently stopped
reaching a created trip.

**Travel style** — the trip's personality: `relaxed · balanced · packed ·
adventure · luxury · budget · family · spiritual · food-focused · creator`.

## Road measurement

**Leg** — one drive, from one point to the next. `sim.legs[0]` is the day's
**opening** drive; `legs[k]` is the drive that brought you **to**
`activeStops[k]`.

**Measured vs estimate** — a leg is either a real road measurement or a
fallback estimate. Never present an estimate wearing the same treatment as a
measurement: surfaces that draw a leg must grade the drawing by the geometry
it came from (`routeDrawGrade`, AGENTS.md §6t).

**Road status** — `pending · ok · failed`. An affordance on a `failed` state
must keep that state's honest rendering up through its own in-flight
(`failed OR pending`), or the retry hides the warning it exists to show (§6v).

**Corridor** — the whole trip's road as one chain, measured in a single span
request rather than per-leg.

**Detour budget** — how far off-route the suggestion engine may send you.

## Publishing and money

**Publication** (`published_itineraries`) — the public artifact: what Explore
lists, what `/i/<id>` previews, what a buyer unlocks.

**Unpublish** — sets `unpublished_at`. It is a **marker, not a delete**:
`entitlements`, `purchase_orders` and `pub_events` all cascade from `pub_id`,
so deleting the row would confiscate what buyers paid for (§6j).

**Publication price / entitlement / purchase order** — the three money records
that answer three different questions. The **order** is the money; the
**entitlement** is the grant. They do not survive or fail together.

**Fork** — a copy of a publication into the forker's own trips.

**Cover** — a publication's stored image. Prefer an **uploaded** cover over a
linked third-party one: the original uploader must never be able to delete an
object that forks and publications point at.

## Session

**Session** — the live collaboration context for one trip (presence, the
stale-update ledger, mark-settled).

**Stale update** — a remote change that arrived while you were editing.

**Way back** — the recovery vocabulary for a destructive action: Undo,
confirmation, soft-delete (trash), or `regenerated` where the old value would
now be false. `docs/history` and `lib/mutationLifecycle.ts` (§6z).