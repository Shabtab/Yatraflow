# Changelog

All notable changes to YatraFlow. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 MVP milestones.

> **Two version lines, cut from the same commits.** `X.Y.Z` headings are the **web app**
> (semver, mirrored in `package.json`, deployed by Vercel from `main`). The `-native` suffix
> is the **Android shell's** own numbering (`versionCode`/`versionName` in
> `android/app/build.gradle`, surfaced in Settings → Apps), which does **not** interleave
> with web semver — so `0.7.0-native` is newer than `0.48.0` despite the smaller number.
> Entries below are ordered newest-first by date, not by version number.
>
> **History note.** Entries before `0.42.0` were removed in `adf5f66` (Sep 7, 2026) — that
> record still exists in `git log`, not here. Archived release notes live in
> [`docs/history/`](docs/history/).

## [Unreleased]

### Added

- **One “already added” identity behind every suggestion surface.** Whether a place is already on the plan was answered five different ways in five places, and they disagreed: a turned-down suggestion blocked its own name forever, `" Hotel Taj "` never matched `"Hotel Taj"`, a provider place id was ignored entirely, story arcs advertised sights you already owned, and a slot could offer a place that had just been dismissed. There is now one predicate, shared by the corridor rail, the search rows, the shortlist tray, the day's slots and the arcs: names are trimmed and case-folded, a Google `placeId` or Mappls `eLoc` joins the same place across spellings, rejected stops stop blocking, and the day-slot engine reads the same facts the rail does. When a preview is discarded, the places it staged are released with it — the place comes back immediately instead of hiding until a reload.
- **A short night says so, before the alarm does.** Consecutive days were each planned in isolation, so a day ending at 23:20 followed by one starting at 05:00 looked fine twice over. The trip's own clocks are now measured against each other end-to-start (in day order, and correctly across midnight): under seven hours is a warning, under five is a serious one, both naming the two clocks.

### Changed

- **The optimise-day dialog says which number it is showing.** Its objective is straight-line distance, rescaled by the day's road-vs-chord ratio — and with no road measurement yet that ratio is 1, so chord kilometres were presented as road kilometres with nothing to qualify them. An unmeasured estimate is now labelled as one (`~12 km (est.)`) on the button, in the dialog and in its hint, and the disclosure names the anchors that will not move. Days that cannot be optimised because a manually placed waypoint sits mid-day now show the button disabled and say why, instead of hiding it.
- **The impact preview measures with the same road data the timeline renders.** Every timeline edit is guarded by a before/after sheet, and that sheet was estimating with straight-line distance while the surfaces it was predicting were using measured road data — roughly a fifth low on a detour. Both now read one measurement, so “adds ~40 min” is the number the timeline will show after Keep. Its arrival rows are matched by stop identity rather than by position, so reordering a day reports which stop moved instead of pairing each new occupant with its predecessor's clock, and its “busy” verdict now agrees with the day's own pill at six stops.

### Fixed

- **The map rail's search results are a real list you can drive from the keyboard.** The rows were
  announced as static text — `listitem` carrying `aria-selected`, which is not a selectable list — and
  only Enter did anything, only when the row itself held focus. So Space scrolled the page away from
  the place it was about to pin, and no key moved between results. The list is now a listbox of options
  with one roving tab stop: the arrow keys move the highlight and take focus with it (down from the
  search box lands on the first row, up lands on the last), Enter and Space both pin, Escape clears,
  and every other key is left alone so typing and paging still work. Hovering a row also stops moving
  the list: scrolling the active row into view now happens for keyboard and focus only, so reading
  nearby results with a mouse no longer fights your own scroll position (#333).
- **The engine tip strip no longer pretends to be a control, and an out-of-scope result no longer fades.**
  The tip dots were clickable buttons sitting inside an `aria-hidden` container at 8px wide and hidden
  below 720px: reachable by mouse, unreachable by keyboard, and below the touch floor. The strip rotates
  on its own and screen readers already get a static summary rather than the seven-second churn, so the
  dots are progress indicators now and nothing focusable hides inside `aria-hidden`. A search result
  beyond the detour budget used to be dimmed to 60% opacity, which washed out text already near the
  contrast floor and made that row's own Add buttons read as disabled while they were still pressable;
  it now carries a visible "beyond your detour scope" chip saying the same thing at full contrast (#333).
- **Reordering a day could move where the next morning started.** The optimiser pinned a night's base only when the tail stop was a hotel or a rest — but the engine derives the next day's wake-up point from whatever the day's LAST stored stop is, so a food-tailed evening (dinner where you ended up) let it slide — the reported case moved the next morning's start about 16 km. A day's stored tail is now pinned whenever a later day wakes up from it, and a property test asserts the next day's origin is unchanged rather than trusting the shape.
- **Applying an optimise over an edit that landed meanwhile is no longer silent.** The preview was a snapshot taken when the dialog opened, so a drag or an edit made while it was up was discarded without notice when Apply was pressed. Apply now re-derives from the day as it is, refuses and refreshes when the order no longer matches what was reviewed, and says when there is nothing left to improve.
- **Opening-hours conflicts could vanish on a hydrated stop.** The preview's own check read `visitMinutes` raw, so a row without one compared `NaN` against its closing time and reported nothing. A missing dwell now counts as zero minutes, the same way the engine treats it.
- **The trip-wide accommodation warning, and every warning with no “Day N:” prefix, is no longer dropped.** Warnings were filed by parsing the day number out of their display title, which silently lost the trip-level ones (accommodation churn) and every warning that leads with a stop's name instead of a day (opening hours). A warning now carries the day it belongs to — or none, for a trip-level one — and the Timeline renders trip-wide warnings in their own block whose count matches the Overview chip that promises them.
- **The trip JSON id mint and the toast list no longer draw from the weak generator.** The seed id helper and the toast key were the last two `Math.random()` sites that looked like they were not really identity (an id shape, a React key); the id helper now mints from the platform CSPRNG (also available outside a secure context), and the toast list uses a session counter, which is what it needed all along. PlanBench keeps its random demo picks and ambient offsets — that randomness has no identity role.
- **A day’s stops stay numbered 1..n, and nothing a plan requires is ever silently lost.** Deleting a
  stop on the Timeline closes the gap its neighbours inherit — so the next stop added cannot reuse a
  position a survivor still holds — and the delete now offers Undo, which puts the stop back at the
  order it had. A stop dropped onto a day that is no longer on the trip is refused with a message
  and stays where it was, instead of being removed from its day and forgotten. The move dialog
  places a stop where the day’s route says it belongs rather than at the day’s end, matching what a
  drag does, and both days it touches end contiguous. The Map’s day-plan fill numbers the stop it
  appends 1-based like every sibling. The numbering rule lives in one place now
  (`src/lib/stopOrder.ts`), called by the store’s mutators, the Timeline’s delete/reorder/move
  handlers, the Map’s fill and the Board — one implementation instead of four (#337, #339).
- **Per-day money follows the day’s own index, so a skipped day number can no longer show another
  day’s total.** The engine’s per-day buckets, the day-header chip, its tooltip and the print card
  all match a day by index rather than by array position, and a day with no bucket shows nothing
  instead of clamping to the last one. An expense tagged to a day that is no longer on the trip is
  treated as an unattached trip-level cost — spread with the others — rather than quietly moved onto
  the last day; an expense attached to a stop follows that stop’s day. The round-trip drive home is
  charged to the last day by index, and the trip’s origin and turnaround points are read from the
  lowest and highest day index, so a trip whose days array is out of order plans the same route and
  the same bill (#338).
- **A missing or malformed money value no longer prints “₹undefined” or turns the totals into NaN.**
  Entry fees, expense amounts and the traveller count are finite-coerced where they are used, so one
  hand-edited or partially hydrated field can no longer multiply through the trip total, the
  per-day chips, the pacing tiles or the printed itinerary. A stop that carries no fee or no
  transport figure shows no cost segment at all (a stored ₹0 is a real ₹0 and still shows), the day
  route spark skips stops with non-finite coordinates instead of drawing a NaN line, and a planned
  halt with a missing duration no longer poisons the arrival preview (#343).
- **Resolving a crew vote and accepting a suggestion each act exactly once.** Resolving twice — a
  double-tap, or a second click after the row already moved — adds the winner a single time, and a
  decision that is already resolved ignores a later resolve naming a different option. An accept or
  a resolve whose place is already on the plan records the decision without adding a duplicate stop,
  and the winning place lands only on the day it was actually suggested for: an unknown position or
  a day that has since been deleted says so instead of quietly dropping the place on Day 1 or on the
  last day. A suggestion whose day is gone no longer crashes the accept button (#336).
- **Text typed into the create funnel's add-stop field was thrown away on submit if it was never
  picked from the suggestions.** The field is an autocomplete: only a pick turned the typed text
  into a stop, and that text lived in the input's own state, so "I typed Munnar — why isn't it on
  the trip?" ended with a stop count that never changed and a form that said nothing. Submitting now
  stops on that field, naming the text it would have dropped and moving focus to it — and a place
  the providers cannot pin can still become a real stop on purpose: **Add without a map pin** adds it
  with no coordinates, a state every reader downstream already handles honestly (the rough bill
  reports no road distance, the outline seed skips it, anchors wait for a pin). A custom return leg's
  field follows the same rule, but only while that leg is on screen — a field that is not rendered
  cannot be holding the user's intent (#375).

- **The create form's "how many travellers" error pointed at a control nobody could see.** The
  number input carrying that message lives inside `.sr-only`, so submitting with an invalid party
  size moved focus to an invisible element while the stepper people actually touch sat untouched —
  and the message was rendered a second time for screen readers only, which heard the failure twice
  and saw it nowhere. The stepper is now the focus target and carries the range in its own label
  (`min`/`max` were properties of the hidden input); the error renders once, visibly, with both the
  group and the input pointing at it. Printing the rough bill also moves focus to the bill it just
  revealed, which used to appear below the fold and leave the keyboard behind (#379).
- **The Plan Bench's "Start planning" button navigated by a hardcoded route string** — one rename
  away from silently losing the hand-off, and it had already happened once: the CTA pointed at
  `#/create`, a route nothing handles, so the router dropped the visitor on the landing page while
  the CTA still looked alive and the crew, budget and stay tier the bench had just stashed were
  never read. The create route now lives in one place in all three forms the app needs (hash, path,
  router segment), and the bench CTA, the hero CTA, the router's case and the nav links all read it.
  The stash itself is pinned too: one key with one owner, the prefill shape (including the stay tier
  that decides ₹8,000 versus ₹3,200 a night), read-once, and a corrupt stash that clears rather than
  blocking every later visit (#398).
- **Switching trips left the previous trip's road measurement running to completion.** The workspace
  measured its whole OSRM chain — plus the parallel per-leg fallbacks — behind a flag that only
  suppressed React state, so the requests kept going: mobile data spent on a trip the user had
  already left, and, because switching trips unmounts nothing here, a late result could still land
  on the next trip's view. The workspace now passes an `AbortSignal` through `measureRoadChain`
  exactly the way the day-filter path already did, and an abort stops the work silently instead of
  reading as a transient failure that earns the two-second retry (#325).
- **The 3D hero camera could settle on a fallback angle and never correct itself.** The camera was
  eased on the 2d→3d transition only, while the angle it aims at comes from the drawn road — so
  opening 3D before the route resolved left the map looking along the prototype's fixed bearing, and
  the road arriving afterwards changed nothing. The move is now a pure decision (`heroCameraMove`)
  that reacts to the bearing VALUE: entering 3D still sets pitch and bearing, a bearing that improves
  later re-aims without pitching the view out from under the reader, and an unchanged bearing is a
  no-op rather than a camera that grinds on every unrelated re-render. The effect also waits for the
  style to load now, as the terrain effect beside it always did. Two smaller map-hygiene fixes ride
  along: the direction chevrons' triangle icon is per-map-instance and released on unmount (one
  shared image per instance lifetime was added and never freed — a slow leak across a long session of
  opening and closing the map), and its instance id comes from `getRandomValues` rather than
  `Math.random()`. The two stacking-order comments that placed the impact sheet at 90 — it is 210; 90
  is the AI drawer's rung — now name the ladder tokens instead of repeating numbers that had drifted.
  Two more from the same batch: a marker's DOM listeners are attached in an effect that removes them
  again (they sat inside a `useMemo` that runs once and detaches nothing, so every unmounted marker
  left three listeners behind on a detached element), and the Map tab is now lazily loaded as a
  whole rather than only the renderer inside it. That second one is the one with a number on it: the
  tab statically imported the entire suggestion stack, so the workspace bundle carried geocode, the
  planning engine, day slots, trip DNA and story arcs whether or not anyone ever opened the Map tab.
  Measured — the workspace chunk drops from 264 KB to 206 KB, and the tab's own 60 KB chunk loads on
  demand. The three other popup components the report named already synced their options and removed
  their listeners, so nothing there needed changing (#332).
- **The full-trip map framed the stops instead of the route it drew.** The all-days camera zoomed to
  the saved pins, so everything that is part of the line but is not a pin — the leg out of the trip's
  start, the trailing destination, and any stretch of road bowing around a ghat or a lake — could
  begin off-screen and had to be panned to. The fit set now comes from the same chain the line is
  drawn from (trip start, every stop, the drive home, the trailing destination) plus a sampled copy of
  the measured road, so the camera frames what is actually on the canvas; the sampled set keeps the
  camera key cheap, and the last road vertex is always included. The old code's reassurance that the
  measured line stayed "well inside the 70px padding" was an assertion nobody had measured and it is
  not true of a bowed road, so it is gone rather than restated. The day view is deliberately
  unchanged: there the polyline arrives after the fit, and folding a whole-trip line into a single
  day's frame would frame a previous day's road. Return-label anchoring on destination-tail trips —
  the other half of this report — is recorded on the issue and follows with the Map tab's next change
  (#330).

## [0.67.0] - 2026-09-25

The audit's first two waves, promoted the day they closed: sixteen findings across the map, the
create flow, decisions, the creator's surfaces and the public wire, ordered by what could hurt a
person rather than by what was easiest to touch — which is why the security half went first. The
public itinerary endpoint stops telling a reassuring story: it no longer carries the invite code
that rode along with every anonymous read, and a viewer who has not bought a priced plan no
longer receives the budget breakdown the page's own locked overlay says is withheld. Unpublishing
stops destroying the thing somebody paid for — the publication row survives with its buyers'
access intact, ledger and funnel frozen so a creator's lifetime numbers keep meaning what they
said — and traffic history stops being erasable by any signed-in stranger, the retention pruner
having become an operator action. Beneath those sit the fixes a person feels: resolving a decision
persists, the create flow can no longer mint twin trips or route into a workspace the save never
reached, an unlock is live the moment it is paid rather than after a reload, a staged timeline edit
survives the next one, crew slot-votes work end to end, the map measures the road once instead of
twice, a map pick that cannot be pinned asks for its position instead of being dropped, and a
single malformed cell can hide a public preview instead of taking the page down. The creator hub,
which had shipped with its own recovery path unreachable, now announces what it is doing: a failed
ledger read shows its alert and its Retry instead of a spinner that never resolves, a retry looks
like an attempt rather than a dead button, figures already read survive a refresh that fails, and
the ledger says when it was last read. Five migrations, all applied before the promotion. The
tracker also stops lying to itself: a PR merged into `test` now closes the issues it names.

### Added

- **Unknown-position picks ask for their position instead of being dropped.** Any pick the map cannot pin — a provider placeholder, a mixed (0, lng) zero, or a place with no id to resolve through — now opens a pin-it dialog before the change proceeds: try the resolver again, enter the coordinates by hand (validated: finite, in range, and no zero — the map reads a 0 as "position unknown"), or skip the place explicitly. The same guard fronts every write-into-a-trip path: the Map tab's votes, adds and fills; the location picker; the stop editor, which asks before saving a new stop whose location was never pinned (no more silently landing on the form's default coordinates — a skipped prompt refuses the save, while an existing stop keeps its stored pin through a rename); and a trip import, which offers the same prompt for each row its coordinate wall had to drop and re-parses the rescued rows in with the coordinates entered. Nothing is written as a placeholder and nothing is dropped silently — a skip is the user's own choice.

### Fixed

- **A failed sales-ledger read on the Creator hub showed "Loading sales…" forever.** The Earnings
  body tested `actual === null` *before* `salesError`, and the read's catch sets `sales = null` as
  well as the error flag — so the failure branch was unreachable. A creator whose ledger read
  failed saw a spinner that never resolved, under tiles correctly reading "Not read", with no way
  to ask again on the tab that holds the money. The body now switches on the same `ledgerRead`
  state the tiles use — `reading` → spinner, `failed` → the alert and its Retry — which is what
  makes the recovery path reachable at all. Found by the third design-critique pass, after the
  hub had shipped.
- **A retry on the Creator hub looked like a dead button, and a failed read erased a ledger that had
  already loaded.** Pressing Retry rendered byte-identically to the state it was pressed against, so
  two failures looked like a frozen app; and the read's `catch` cleared `sales`, so a refresh that
  failed discarded figures the creator could already see. The in-flight state is now derived
  (`salesRetry !== salesSettled`) so an attempt announces itself, the figures survive a failed
  refresh stamped with the moment they were read, and both reads take an `AbortSignal` bounded at
  10s — "Reading…" can no longer be an unfalsifiable claim on the tab that holds the money.
- **The Earnings ledger could not be re-read once it had loaded.** Retry existed only as a property of
  failure, so a creator looking at good figures had no way to ask for fresher ones, and the
  kept-ledger branch above was unreachable in normal use. The ledger now states when it was read and
  carries a Refresh control.
- **The creator fixture could not run.** `tripRow()` never set `owner_id`, and `trips.owner_id` is
  `not null` with no default under an `auth.uid() = owner_id` insert policy, so `--apply` died on its
  first trip and nothing behind it — publications, sales, events — was ever reachable; the printed SQL
  fallback then collided two rows on the unique `razorpay_order_id`, because both plans indexed their
  order ids from zero. Both are fixed, and the order ids are namespaced per owner.

- **The create funnel's switch is documented, and a production build that would ship it dark now says so.** The v0.65.0 arc reached production fully deployed and fully invisible: `/new` loaded, the app rendered, and all seven phases — templates, the budget band, the readiness checklist, drafts, the crew collector, the moment-after screen and input IQ — were missing, because a build-time environment variable had never been set and nothing anywhere said so. Code cannot verify an environment, but the three places that name the phases can no longer drift apart: the deploy table carries `VITE_CREATE_FUNNEL` with the exact phase list and the trap that makes it dangerous (unset means *everything off* in a production build and *everything on* in a development one, so a dark release reads as a broken feature rather than a missing switch), and a test keeps that list identical to the `createFunnelOn()` call sites and to the one the build warning uses — because a single typo in the deployed value silently darkens one phase while the other six light up. A production build whose value is empty, or names a phase the code does not gate, now prints a warning naming exactly what is dark and how to fix it. It warns rather than aborts deliberately: a preview branch dark-running a phase is what the flag is for. (#427)

- **One bad cell can no longer take a public itinerary page down.** The free-day list was the single field in the public endpoint read without asking its shape, so a hand-edited value — a number or an object where the list of free days belongs — made the function raise, and every visitor to that page saw "didn't load", permanently, for everyone. It is now type-checked before it is read, only its numeric elements are used, and anything unexpected resolves to "every day is locked" rather than to an error: a malformed row can hide a preview, never break one. (#353)

- **The paywall now withholds the budget breakdown it says it withholds.** Locked days had their stop content stripped, while the trip's entire expense list and its fixed commitments were served in full — including two commitments sitting on a locked day with their notes intact ("Boarding gate closes 12:30 sharp", "Vrinda Express") — on a page whose own locked overlay reads *"Stay contacts, timings and the budget breakdown are in the full plan."* The served expenses were live input to the totals that page computes, so they were never an unused field — but the contradiction is the point: the page told non-buyers the budget breakdown was withheld while the payload carried the whole list. Expenses carry no day to filter on, so a viewer who has not bought a priced plan now receives no money at all; the publication's own per-person estimate is untouched and still shown, and free plans and buyers are unaffected. The fork path applies the same rule and no longer decides what was withheld from the shape of the row in hand. (#352)

- **Traffic history can no longer be erased by a stranger.** The retention pruner that trims old funnel events — one row per recorded visit or fork, on every public page a visitor opens — deletes on age alone, across every publication at once, and it shipped executable by any signed-in account. One curious or malicious signup could therefore wipe the whole log back to its 730-day horizon, and the only symptom would be every creator's traffic trend quietly reading "nothing recorded", with nothing in the product to say why or who did it. The pruner is now an operator action, executable by the service role alone — the same shape as the refund-revocation RPC — because nothing in the app ever called it: the documented paths are the SQL editor, which runs as the project owner, and the optional pg_cron schedule, which runs as the function's own definer, so both keep working untouched. The retention window itself is unchanged and still pinned to the reader's own clamp, so pruning can never manufacture a "recording began" date the log never had. (#356)

- **The paywall's second door is shut.** The public itinerary endpoint is open to anyone on the internet and was returning the entire trip row, so a plan's private invite code rode along with it — and the invite-code endpoint, which had never been taught about pricing, traded that code straight back for the full plan. A signed-out visitor could therefore read a paid itinerary end to end in three requests, with no account and no purchase: the paid days came back stubbed exactly as intended, and the code that undid the stubbing came back in the same payload. The public endpoint now names every column it returns and never selects the invite code, and the invite-code endpoint applies the same rule its uuid sibling has applied since v0.63.0 — a trip backed by a priced publication resolves only for its owner, its crew, an admin, its creator or someone who bought it. Private trips and free plans are untouched, so logged-out invite links and the join preview still work exactly as before, and a taken-down paid plan stays shut rather than reopening the moment it leaves Explore. Trashed trips no longer resolve through a code either, which the uuid path already refused. (#351)

- **Unpublishing a paid plan no longer takes it away from the people who bought it.** Removing a publication used to delete its row outright, and every entitlement, order and funnel step hung off that row on a delete cascade — so a buyer's plan stopped opening the moment the creator unpublished it, with no refund, no warning and no status change anywhere, while the creator silently lost their own sales history for that plan. Unpublishing is now soft: the row survives with an `unpublished_at` stamp, the plan leaves Explore, the creator hub's public surface and its `/pub/:id` page, and sales stop — but every entitlement and order is left exactly where it was, so a buyer keeps opening what they paid for and the creator's lifetime numbers stay whole. A viewer who never bought it is told the plan is no longer published rather than shown a locked preview, and the creator's own hub lists the row as unpublished instead of dropping it. Re-publishing clears the stamp. The hard delete now belongs to a genuine permanent removal with its own refund path, which this is not — and the console's unpublish follows the same policy as the creator's. (#350)

- **A second edit no longer discards a staged change.** The impact preview is not modal — the timeline, board and map stay live while it is open — and every mutation used to clone the committed trip, so a change staged while a preview was open replaced it outright: no toast, no merge, no warning. Mutations now chain onto the open preview, so the sheet reports the combined delta (still measured against the plan as saved), a day rename, a ride-start edit or a stop's status flip made while a preview is open is refused with a clear message instead of racing it, accepting a suggestion or resolving a decision waits until the preview closes rather than being staged inside somebody's unkept proposal (a crew signal the group cannot see is worse than a wait), the map popup's stop delete and every expense write — add, edit, delete, settle, reopen — refuse the same way instead of landing under the preview and turning Keep stale; Keep refuses to overwrite a plan that changed underneath the preview, and switching trips drops a pending preview rather than writing one trip's shape into another. Move-to-another-day is staged through the same chain, so the numbers on screen describe what Save writes.
- **A paid unlock is live the moment it is paid.** The public itinerary re-reads through the paywall RPC after a purchase, and that re-read now replaces the page's cached copy of the trip instead of being skipped because a row for it already existed — so the body unlocks with no reload, rather than sitting on the pre-purchase preview (titles and coordinates, with descriptions, timings and costs stubbed out) until the buyer refreshes. The fork asks the same question in the same order: it reads the wire first, because a cache hit is not evidence about entitlement, and then asks the viewer's own entitlement rows whenever the caller has not already answered — a negative is never trusted, so a buyer who clicks Fork the instant the ceremony closes is not read as unentitled. The locked-day stub is re-applied only when the server's own row does not contradict it, which keeps every fail-closed direction: a visitor still forks placeholders, a claim the wire contradicts forks placeholders, and a failed read falls back to the cached row and re-stubs it anyway. A buyer's fork and the creator's own fork carry the real days. The replacement keeps the cached membership — the RPC cannot carry it — and refuses to walk the copy backwards for a strictly older row or over a write this session just made. (#349)
- **Start planning waits for the server, and can only be pressed once.** The create form used to admit the trip to the screen, fire the save and return, so a failed write walked the traveller into a workspace built on a row that did not exist — empty after a reload, with the inputs that made it gone behind the toast. Creating now waits for the write: a failure keeps the traveller on the form with the message beside the button that triggered it (and every input intact), and the retry re-uses the trip it already built instead of minting a second one — so a first attempt that reached the server and died on the way back counts as saved rather than colliding with its own row forever. Both Start-planning buttons — the ticket rail's and the phone dock's — wait while the create is in flight and read “Creating…”, with a re-entrancy guard that spans the network window rather than only the synchronous part, so an impatient double-click leaves one trip in My Trips instead of twins. A form that fails validation never locks its own buttons. (#374, #373)

- **Unknown places stay unknown.** A location with either coordinate at zero is resolved before it can enter a trip, road-measured modes share one source of truth, changing transport mode re-measures the road, and an unmeasurable detour is labeled “position unknown” and held for manual budget review instead of being treated as free/on-route.

- **Map planning is quieter and more truthful.** The Map tab now reuses the workspace's measured outbound and return geometry instead of launching duplicate route measurements; superseded searches are cancelled before they can spend quota; the detour scope is debounced and disabled while a scan is running; quota messaging covers all three Places SKUs and explains the 80% safety pause honestly; shortlist Add-all resolves coordinates once, writes in road order, and blocks duplicate in-flight adds; vote paths resolve coordinates before writing; suggestion-cache keys include timing, weather, halt pins, DNA and speed inputs; the light fraction pool shares the cache TTL; and dismissing a suggestion no longer triggers a full paid rescan.

- **Resolving a decision now persists.** A resolution is written into `decisions.resolved_option_id`, which was declared `uuid` while option ids have always been text — `o_…` from the composer and `slot:<key>:…` from the map rail's votes, which the resolver parses back to fill the part it was raised for. PostgREST therefore rejected every resolve (400 / `22P02`) behind a console-only error: the card read Resolved from memory, the row stayed open, and the decision was open again after a reload — on every trip, for every crew. The column is `text` now (`20260925_decision_resolved_option_text.sql`, run by hand in the SQL editor like every migration here), with the schema, the migration and the store's payload pinned to each other by a test. (#432)

- **Crew slot-votes work end to end again.** Raising a poll no longer rewrites the ids its caller gave it, so a vote raised for a time slot surfaces live on that part of the day's plan, a resolved vote lands the stop *in* that slot (`slotKey` travels as data, not as a note), and a shortlist re-add collapses into the poll already open instead of forking a second one. A hand-typed poll gets fresh ids of its own, and two options arriving with the same id are minted apart so one vote can never count for both. One quorum across both surfaces: the slot rail divides by the crew — members, what Group input already used — rather than by `travellers`, who may not all be crew. (#335)

### Changed

- **Creator hub headings were quieter than the content they governed.** The two panel titles rendered
  at 11.5px uppercase in the body face — below the 13.5px data and the 15px `h4` beneath them — so the
  outline ran `h1` 40px → `h2` 11.5px → `h3` 16px, a heading that read as a label, and the Earnings tab
  had no level-2 heading at all. They are now 16/700 in the display face, sentence case; `Payouts` is
  an `h2` and `Payout runs` an `h3`; `.card-title` declares the family it was inheriting by accident
  (one class was rendering two faces); and `.hub-subhead` gained `--text-2` so the 16/15 pair differs
  by more than a pixel.
- **The hub's honesty layer said the same thing twice on one screen.** The fee ladder appeared in the
  payout card *and* in the ledger note a scroll below it; "payouts are not automated yet" appeared in
  the card *and* the runs footer; and in the failed state the payout card restated the ledger's own
  alert. Each fact now has one owner: the card keeps what its balance means, the ledger note keeps the
  ladder beside the Fee column it explains, the runs footer keeps the past-run fact and the ₹500 rule,
  and the alert keeps the failure and its recovery.

## [0.66.0] - 2026-09-24

A hub release, with a map correction and a whole-app visual pass beneath it. The creator
hub stops being a settings page and becomes an operating picture: one ruled KPI strip, then
the recorded-traffic trend drawn from the same derivation the rows below it read, then one
row per publication with its funnel and actions — with the creator profile moved into a
disclosure at the foot of the page. Its figures get their hierarchy, and every honesty state
the hub already carried survives the rewrite: a failed read still never renders as an empty
ledger, and a number that was never read is still never printed as one. The Map tab's search
stops answering with the searcher's own city, and its hits finally stand on the map as the
selectable things they are. Under both, the app takes the high-end visual pass the design
plan had been holding — one typeface, one icon weight, and motion that moves its own box
instead of distorting a shape. The hub also clears the 23 review findings that had been
holding its PR, and the gate that raised them turns out to be one the repo's own lint cannot
see at all.

### Added

- **Search results appear on the map as selectable markers and vanish when the search bar clears.** A search's hits used to render identically to the engine's dashed gold "idea" pins; they now draw as solid teal pins with a search glyph, tapping one selects it (the pin glows, the matching result row highlights and scrolls into view), and clearing the box removes the pins along with the results list — the corridor's own ideas are untouched.
- **The moment-after's "watch for these" list plans real fuel halts** — the fuel
  line now comes from the journey halt planner over the trip's own corridor, so a
  long drive's moment after names where the refuels land (e.g. "3 fuel halts on
  the way — Overnight + fuel (~355 km), … (~1,148 km)"). Fuel ticks folded into
  a meal or overnight refuel (#144A) and unnamed pumps are counted and titled
  with the engine's own halt label; a drive shorter than one tank stride still
  says nothing (no filler), and the detail's "both" no longer miscounts a halt
  total that isn't two.

### Changed
- **Map-tab search is route-aware — the box no longer answers with your own city.** A free-text search carried no spatial constraint, so Google applied its implicit IP-based location bias and a lunch search filled the rows with wherever the user was typing from instead of the trip's corridor (found live on the slot search's lunch pill, 2026-09-24). With the trip's road passed, the Google mode of both search surfaces (the main box and each day part's slot search) runs as Search-Along-Route over the actual polyline — the same Text Search Pro event, no quota change — and the keyless free stack (which cannot bias a query spatially at all) ranks its merged hits by distance to the corridor so an on-route place outranks a same-named one in the searcher's city. Post-fetch detour ranking and the detour-scope slider then sort rows worth sorting.

- **Form errors announce once — assertively — and repeat politely, app-wide** —
  `Field`'s error text is now a polite live region bound to its control
  (`aria-describedby` + `aria-invalid`), every field-level error follows suit (the
  create form's name/destinations/budget rows, `LocationInput`'s pick error, the
  cover picker's upload error), and a new `FormErrorSummary` carries the ONE
  assertive announcement per failing submit, prefixed with the failing field's
  label. The create form's empty submit measured four simultaneous
  `role="alert"` announcements before; it is now one assertive beat plus four
  polite field rows.
- **The create funnel passes an interface review** — every invite channel chip, the
  ticket rail's print/cancel row and the small-button style now meet a 24px touch
  floor; hover-only decoration (template lift, chip tints) no longer sticks on touch
  devices (`hover: hover` gates); funnel chips give press feedback (`:active`); the
  micro-label token rises to 11px app-wide; the destinations and budget errors bind to
  their inputs (`aria-invalid` + `aria-describedby`, via a new `errorId` on
  `LocationInput`); the two buttons both named "Add" are now "Add crew member" and "Add pinned
  plan"; and the invite-channel group is labelled "Send the invite" instead of the
  dangling "Send the invite via".
- **Create Trip and the moment-after screen now render the approved funnel mockups' look**
  — the Trip Ticket is the mockup's light card (navy head bar, teal-to-sand cover, and the
  rough take printed live on an amber stub with each line's formula and an honest "Entries
  & tolls — excluded" row), the name field is the pill name box with its suggestion chip,
  the question markers go solid-to-soft as each question is answered, "Budget per head" is
  its own block carrying the anchor and the experience translation, and the moment after
  is the mockup's two-column composition (celebration beside the bill card and next steps)
  with the share row, the "every number shows its math" signature and per-kind tiles.
  Filled teal pills carry theme-flipping ink so they hold AA in both themes (5.84:1 light,
  7.66:1 dark). The ticket rail's ink system follows the theme again — the navy pass's
  white rail inks (which the light ticket turned invisible: the readiness block read only
  in dark) now resolve from the text tokens in light and re-declare their whites for dark
  (label 15.39:1 light, 19.39:1 dark). The form itself sits on one quiet card from
  "Name your trip" through the pinned plans instead of floating on the bare canvas
  (border, no shadow), the page no longer shifts sideways when a section grows the
  document (the scrollbar's gutter stays reserved), the party chip reads "Drivers &
  pace" instead of a literal `&amp;`, and the ticket's rail track is fluid so no
  window width squeezes the flow column.
- **Selected text and the typing caret follow the app's theme instead of the browser's
  defaults** — the last two browser-native surfaces join the design system: a selection is
  theme ink on the soft teal tint in both themes (`--teal-soft` + `--text`: 13.56:1 light /
  12.01:1 dark), and the text-entry caret is the brand teal (`caret-color: var(--teal-deep)`
  on `:root`, inherited by every input). One appended block in `styles.css`; the idea-bank
  row that scoped it (I-17, Tier 1) is spent and recorded in ROADMAP's shipped record.

- **The app takes the high-end visual pass the design plan had been holding.** The
  typeface is Plus Jakarta Sans, one family across the app, replacing Inter wherever a
  display or body face was named. Icons drop to a single weight — stroke 1.5, routed
  through a new `--icon-stroke` token rather than edited glyph by glyph — so a Lucide icon
  no longer reads heavier than the text beside it. The pill navigation's active indicator
  glides on its own box (`left`/`top`/`width`/`height`) instead of a `scaleX` transform:
  the old flip distorted the pill's rounded ends across a 76→146px move, and because the
  glider is absolutely positioned its box cannot reflow its siblings, so the layout cost
  that argued for `scaleX` was never real. The landing takes a display type ramp,
  macro-whitespace between its blocks and the mockup's button-in-button treatment; the
  public itinerary's cards sit in soft trays over one tokenised block rhythm instead of
  five ad-hoc gaps; Explore's and the hub's cards take the same tray, the PlanBench section
  title joins the shared section ramp it had been the sole exception to, and TripCreated
  gets its entry choreography applied to its current two-column layout. The reusable half
  is now pinned — `tests/design-system.test.ts` asserts the typefaces and the glider's box
  geometry, so those two regressions cannot return silently. One finding is recorded as a
  decision rather than a fix: a ring tray needs a canvas to sit on, and on a light surface
  it is a ~1.3% step whose navy ring reads as a grey wireframe outline, so it was reverted
  rather than tuned — the tray on light canvases is `--shadow-soft`, with no outer hairline.

### Fixed
- **The moment-after screen's "Send invite" never actually opened WhatsApp**: `window.open(url, '_blank', 'noopener')` always returns null (the `noopener` feature implies no window handle), so the code misread every success as a blocked popup and fell through to the OS share sheet instead. Links now open through a helper that detaches the opener rather than trusting the return value. The screen also crashed with "Rendered more hooks than during the previous render" when reopened for a trip whose list was still hydrating - the crew memo ran below the loading early-return, so the render's hook count changed mid-load.
- **Entry-path accessibility review landed**: at 320px the logged-out header clipped the "Start planning free" CTA mid-label (the reflow rungs were tuned for the older, shorter label) — the ≤350px block now hides the chrome "Log in" outline button (the hamburger tray carries it) so the primary CTA fits whole. The landing kicker's small teal text measured 3.80:1 on cream; it now uses the text-grade `--ink-teal` token instead of the focus-ring accent. Route changes and the loading gate announce themselves to screen readers via a polite live region fed by the page title, and decorative travel motifs are `aria-hidden`. The auth form's short-password error moved from the form-level alert onto the password field (marked invalid, focus follows) like the name check beside it, the signup tab now matches its submit button's "Create account" naming, My Trips' filter reset and empty state both say "Clear filters", the header's nested navigation landmarks are disambiguated, and the demo band's CTA got a name distinct from the chrome's.

- **The header's CTA stays whole on narrow desktop windows**: the signed-out pill's tightening
  rung now covers 481–560px (it stopped at 480px), a band where the desktop spacings overflowed
  the pill and `overflow-x: clip` cut "Start planning free" mid-label.

- **The Creator hub is a dashboard now.** It opens on performance instead of settings: one ruled
  KPI strip, then the recorded-traffic trend — visits, forks and unlocks over 7/30/90 days, drawn
  from the same derivation the rows beneath it read, so the chart and the table can never describe
  different windows — then one row per publication with its funnel and actions. The creator profile
  (bio, socials, the disable switch) moved into a disclosure at the foot of the page; it used to own
  the entire fold. Every honesty state is unchanged and verbatim: a failed read still never reads as
  an empty ledger, an un-recorded window still says so rather than printing zeroes, the stale page
  still says which page is behind, and the counters-predate-the-log sentence still sits beside the
  numbers it explains. Two things the review caught are fixed with it: the trend and the table now share one CLOSED window, so a step dated after the clock counts in neither instead of counting in the table and falling off the chart; and because unlocks come from the sales ledger, an unread ledger leaves that stage *unknown* in the row and the legend rather than printing a zero that reads as "nobody bought".

- **The hub's figures got their hierarchy, and the trend its readout.** The publication panel now
  leads with the funnel: each stage renders as a large figure in the hue the trend above already
  uses for that stage, over a bar that *nests* the stages — a fork is a visit that forked, so the
  narrower stages sit inside the widest — instead of three segments that add up past the traffic
  there was. The trend draws a monotone-smoothed curve: smooth between days, and mathematically
  unable to overshoot and invent traffic between two points, with a gradient area and a hover guide
  naming that day's visits, forks and unlocks (and saying "unlocks not read" rather than zero when
  the ledger is unread). The KPI strip wears the chart-navy anchor band the map and AI panels
  already use, inked in white - not `--yf-cream`, which is the canvas colour and would vanish in
  the dark theme.

- **The second critique pass, answered.** A re-run scored the hub 30/40 and found the earnings tab
  still contradicting itself: a failed ledger read rendered as `₹0` lifetime, `0` sales and a
  confident "nothing to pay out yet" beside reassuring prose. All three now read **Not read**
  (or **Reading…**) and the payout conclusion is withheld until the ledger answers — the
  arithmetic still falls back to zero, but a number that was never read is never shown as one.
  The publication row's stage bar was a three-colour stripe (all stages drawn at the same origin);
  it is now the drop-off it claimed to be — an empty track for the traffic you had, with the
  surviving stages as two separated marks, and no unlock mark at all while the ledger is unread.
  Each row states its window ("in 30 days") and each rate its denominator ("11% of visits"), so
  the figures no longer depend on remembering which window is selected. The trend takes keyboard
  focus and steps by day (arrows, Home/End, Escape to dismiss), a tap latches the readout instead
  of losing it on lift, the tooltip can no longer overflow the panel edge, and the unlock stage
  wears one hue everywhere — `--ink-amber` in the chart mark, the legend and the row figures —
  leaving saffron for publish and invite actions.

- **The creator hub's 23 review findings are cleared — and the gate that raised them is
  reproducible at last.** Codacy held PR #315 on three ESLint rules that the repo's own
  `npm run lint` cannot see: 12 object-injection sinks (`obj[identifier]`), 7 void-expression
  arrow shorthands, and 4 non-null assertions. `@typescript-eslint/no-confusing-void-expression`
  is type-aware and `eslint.config.js` deliberately never asks the parser for type information,
  while `eslint-plugin-security` is not installed at all — so a change validated locally was
  never a change the gate had validated, and the two attempts to satisfy it fixed a different
  axis. The trend chart's monotone-cubic maths now walks adjacent point pairs instead of
  addressing `dx[i]` / `slope[i-1]` / `pts[i + 1]` directly, and its hover readout carries the
  active *index* beside the active day, which is what retires the four `hover!` assertions
  rather than re-spelling them. The rewrite is the same function arithmetic-for-arithmetic:
  3,072 sampled inputs — every degenerate shape (one point, all-flat, repeated x, a single
  spike) plus 3,000 random series — emit byte-identical SVG paths from the old and the new
  implementation.

- **The OG share card renders in the app's own font again.** `scripts/og-default-card.html`
  — the template the share-preview handler renders to `public/og-default.png`, which is the
  image behind every publication with no cover of its own — still linked Inter, so each
  generated card was drawn in a fallback face once the app had moved to Plus Jakarta Sans.
  The template and the committed PNG now name the family the app actually ships.

- **The moment-after's invite-channel group announces itself properly.** The
  `role="group"` wrapping the "or send the invite on" row carried the aria-label "Send the
  invite on" — a fragment that ended mid-sentence for anyone hearing it read aloud. It now
  reads "Send the invite", matching the invite group above it, while the visible caption
  keeps its preposition, where it reads naturally.

## [0.65.0] - 2026-09-22

The Create Trip page was rebuilt around the questions a planner actually answers,
plus the moments around creating. Behind per-phase `VITE_CREATE_FUNNEL` flags
(unset in dev = all on; unset in prod = dark).

### Added
- **Warm start** - four curated India templates with engine-computed price bands;
  one tap loads route, dates and a derived budget. Same-as-last-trip, demo trip.
- **Three questions** - numbered flow (Where / When / Who & how) with stop chips,
  a party stepper, compact mode pills, and the tucked advanced drawer.
- **Budget honesty** - a region band and a money-to-experience line under the
  slider, both computed by the same engine that prints the bill.
- **Readiness** - a live checklist in the ticket rail and the mobile dock that
  mirrors submit()'s own rules exactly.
- **Drafts** - the form autosaves; returning offers Resume/Discard, and My trips
  carries a draft card above the grid.
- **Crew invites** - collect names/numbers; the moment-after screen sends the
  invite on WhatsApp, Telegram, SMS or Instagram (per-member chips, a
  no-recipient broadcast row, and an add-more field so crew can join the list
  after creation - Telegram works without a number, and a channel with no
  direct scheme says so instead of dead-ending), with per-member status.
- **The moment after** - /created/:id lands with anticipation items from the
  engine (warnings, weather, tank maths), the rough bill verbatim, and the CTA
  ladder (Start planning / Open my workspace / Bring the crew).
- **Input intelligence** - route IQ (longest hop, lunch window) and seasonality
  notes for seven Indian regions.
- **The Map tab's day planning gets its slot engine.** The slots-rail concept - the day rendered as the work it is still missing (breakfast, lunch, fuel, dinner, stay), filled by search, comparison or vote - starts with its pure, tested module: `src/lib/daySlots.ts` derives each day's slots from engine output alone (the halt segmentation, the day's stops, the corridor candidate pool), so the view can never drift from the engine. Meal segments split into lunch/dinner by their arrival against the engine's own windows (`LUNCH_WINDOW` / `DINNER_WINDOW`; purpose stays `meal` per P0.3), breakfast reads the `BREAKFAST_WINDOW` meal, stretch halts render as the quiet auto state unless a #143 drift proposal is open, and a no-drive day's hotel stop still owns its stay. Filled = a stop claims the slot (category first, then reported opening hours overlapping the window, one stop per slot), empty = the top engine-scored candidates with their detour minutes, budget share, arrival time and in-window honesty, auto = no work demanded. Day slicing follows the caller's own road-true per-day km when given (one shared `tripDayAttribution`, so the rail, the day chips and the Overview matrix cannot attribute a halt to two different days) and falls back to the journey-ordered `dayEnd` flags. Readiness (`dayReadiness` / `tripReadiness`) counts filled/total/auto for the day chips and the rail's meter. Tests: `tests/daySlots.test.ts` - 80 fixtures including the mockup's Day-2 structure (6 slots, 2 of 6 filled with 1 auto) derived from engine data alone, plus the review round's cases (a sight stays out of the day's shape, a filled part is never also engine-managed, a fill is remembered as data rather than as prose, lunch and dinner draw on their own halt, and a halt-less day keeps its readiness row).
- **The rail starts remembering (plan P7).** An open part now says what the log has learned about that KIND of stop - "you usually accept about +8 min for these", "you usually take these without a detour" - drawn from the accepts and declines already recorded, shown as context, and silent until the log carries at least three real accepts so a young log never pretends to a habit.
- **The day has a shape, and the trip a grid.** The plan rail gained a second reading: a Shape toggle turns the day into its blocks sized to their minutes - a two-hour drive is four times a lunch, a night is a night - each carrying its state, so the day's rhythm is legible before the detail. On Overview, "What each day holds" answers trip readiness at a glance: a day-by-day grid of the six parts (solid = planned, hollow = engine-managed, dot = still open), each day's count, and the thinnest day called out by name.
- **The day chips now answer for the whole map.** Tapping a day in the plan rail filters the map to that day's route and stops - the map, the rail and the readiness meter all read the same state - so "what does Wednesday look like" is one glance, not three. The chips carry their weather when the forecast says rain is likely, a Legend chip spells out the rail's language (planned part, unplanned part, engine-managed stretch, extras), and a paused chip appears when the suggestion quota runs out. A search result can be filed where it belongs in one tap: an eating place offers "Add as Lunch" beside the plain add, so nothing lands ambiguously.
- **A part of the day can go to a vote.** Any part with two or more candidates offers the crew a decision raised straight from the rail - "Day 2 dinner - where?" - each candidate an option carrying its place, detour and day, so resolving it in Group input lands the winner as the stop without a second step. While the vote is open the part shows the tally where its candidates were ("Voting · 2 of 4", "Halais leads") and one tap opens Group input to settle it.
- **A sparse day fills itself in one tap.** "Fill the day" in the rail's header takes the top candidate for every empty part of the day - lunch, dinner, stay, whatever is still unplanned - resolves each place's real coordinates before writing, inserts them in one batched change at their true road positions (so the timeline reads in driving order), and offers an Undo that pulls exactly those stops back out. A part whose arrival runs within 20 minutes of its window closing says so in amber ("closes 14:30") before the door shuts, and once a day has a stay its meal candidates are re-ranked by how close they sit to it, the leader saying "1.2 km from your stay".
- **The Map tab's left rail becomes the day's plan, filled one part at a time.** The rail no longer lists every suggestion the engine found - it reads as the day itself: what is already planned is one quiet line (Breakfast - Hotel buffet ✓), what is missing is an open part of the day with its candidates inside (Lunch 11:30 - 14:30, three options side by side), and what the engine handles alone (stretch breaks) shows as a dim dashed line that demands nothing. A strip of day chips carries each day's fill count, a meter shows the day at a glance (3 of 6 planned · 1 auto), and tapping an empty part compares its candidates by their real numbers - detour minutes, arrival time inside or outside the window, share of the day's detour budget - with one Fill button that lands the stop, solidifies it on the map, and offers Undo. A part of the day whose arrival runs within 20 minutes of its window closing says so before the door shuts. The right rail is one object too - every see-&-do pick, route arc and quarter-of-the-drive row hangs off the same spine as a flat two-line row carrying its detour, day and reason, expanding in place to act on (add, dismiss, reason filters, nearest alternatives); the boxed cards and the km ruler are gone, because the spine is already the geometry. Every day of the trip renders the same plan grammar - halts attribute to their day by the road-true per-day kilometres the tab already trusts, and a day with no halts of its own says so honestly instead of falling back to the old grouped list. A part whose window has already CLOSED says so ("closed 14:30") instead of the closing copy a missed window also matched. A fill is remembered as data on the stop, so tidying its note in the Stop editor no longer silently un-plans the part - and a stop that names its part can only ever fill that part. The rail's counts are over the parts the crew owns (engine-managed stretches excluded), tapping an empty part's pin on the map unfolds the rail and scrolls to it, and each empty-part pin carries its own glyph (Stay and Stretch no longer both read "S"). A search result can be filed as any category-claimable part - a meal, fuel, or the night - and once it is on the trip the row says "Added" rather than offering a duplicate. Amber ink in the rail routes through `--ink-amber`: `--warn` is a surface token and measures 3.65:1 as text, under AA. And on Overview, "What each day holds" now reads the SAME corridor halts and the SAME day attribution as this rail, so the two cannot disagree - saying plainly when the corridor has not been scanned yet, rather than showing columns that could never fill. Built on the slots engine from the same unreleased cycle; the word "slot" never appears in the interface.
- **The fixture is a harness, not a script.** The transport and session plumbing inside `scripts/seedCreatorFixture.mjs` — sign-in-or-sign-up sessions, ownership inserts through the owner's own session, the elevated service-role/pg writer for the rows no client may write, chunked bulk inserts, the masteradmin promotion — moved to `scripts/fixtureKit.mjs`, so the next session-gated surface seeds its own browser check from one write path instead of copying this script's (a copy is how two fixtures start authorizing writes differently). The CLI became the kit's first consumer; its dry run is unchanged, and `tests/fixture-kit.test.ts` pins the shape: the CLI must not grow its own Supabase client again, and the kit must keep both transports and the env precedence the harness idiom uses.
- **The event log prunes itself.** `pub_events` grows one row per recorded visit or fork, forever, on every public page a visitor opens — and nothing reads a step older than the reader's own horizon, because `get_creator_funnel` clamps its window at 730 days and the hub's widest offered control is 90. So a row past 730 days is pure storage cost, and `prune_pub_events` (migration `20260922_pub_events_retention.sql`; apply from the Dashboard SQL editor, then run `select public.prune_pub_events();` once — scheduling is the optional, plan-gated pg_cron block the migration carries, commented out by default) removes them, clamping its own argument to the reader's same clamp so pruning can never manufacture a “recording began” date the log never had. The horizon lives in one place — the reader's clamp — and the RLS contract test pins the pairing, so widening one without the other fails the suite rather than silently shrinking the funnel's memory.
- **A creator sees how a plan converts on the plan's own page.** The funnel lived only in the hub, so the surface where a link is actually shared — the public itinerary — showed its creator nothing about itself. When the viewer is the publication's creator, the page now reads their own funnel (the same `get_creator_funnel` read, the same `buildPubFunnels` derivation and the same whole-UTC-day window rule as the hub, so a number cannot differ between the two surfaces) and renders a quiet strip in the creator card: **this link, last 7 days** — visits → forks → unlocks with the rates, the pre-log explanation when the counters and the log disagree, and the link into the hub. A visitor's session never runs the reads; a failed read says it failed rather than rendering a measurement; a plan the log has never reported says that instead of three zeroes. `funnelGlance` is the one formatter both surfaces use, so the strip cannot drift from the hub's line.
- **The counters-versus-log disagreement now explains itself.** The lifetime counters were born before the event log, so “38 forks all time” beside “3 forks this month” read as a bug when it was history. The derivation exposes the gap as a number — lifetime minus everything the log holds, never negative — and `describePreLog` renders the one sentence the hub and the plan page share: “9 visits and 5 forks of the all-time counts predate the event log — recording began 21 Sept 2026.” Silence when the log accounts for the counters, and nothing at all on a failed read, because the size of the gap is not knowable from a read that did not happen.
- **A doc that claims shipped work is still coming now fails the build.** The M7 drift — the monetisation plan still inventorying its payment rail and entitlements as things that did not exist, weeks after v0.61.0 shipped them — was found by a hand sweep, and nothing in the typecheck, the node suite or the build reads prose, so the same class could return the same way. `tests/doc-drift.test.ts` closes it: every line of every live doc is scanned for an absence cue ("does not exist", "unbuilt", "not wired", "still to come"…), each hit must be registered with a reason it is still true today, and a registered claim may name a **marker** — repo evidence that the thing now exists — so the build goes red the moment it appears. Three payout claims are guarded by exactly that: a `payouts` table landing fails all three, naming the doc, the sentence and the file that made it false. It also fails when a registered sentence has been reworded away, so the registry cannot rot into quotes nobody wrote, and it proves its own machinery fires in both directions rather than trusting a green run over an empty registry. Dated snapshots stay exempt — a report carrying a status date is the record of a decision, and rewriting it to agree with today is how this repo lost its evidence once — but only while it still carries the date. The cue list is deliberately high-precision: "planned" is not on it, because this codebase says "planned road km".
- **The creator fixture seeds an admin and a second payee.** `scripts/seedCreatorFixture.mjs` built one creator with sales, which exercises a ledger but not the console — and a single payee makes the console's own correctness **invisible**, because the platform fee is charged once per creator, so with one creator that figure and one ladder over the platform total are the same number. It now seeds an admin (promoted to the `masteradmin` JWT role) with its own ₹12,000 publication and two sales, making the difference a figure: ₹46,046 gross across two payees reads as **₹6,855** of fee, where one shared ladder would claim ₹5,855. `tests/admin.test.ts` pins both, so an edit that collapses the per-creator grouping fails rather than quietly collecting less. The creator and the admin now go through one seeding path — a second copy of that loop is how the admin's trip would lose its membership row and their publish editor would render "trip not found" — the sales rows come from one builder that both the elevated writer and the printed SQL format, and `--clean` clears both owners instead of leaving the admin's sales pointing at publications that no longer exist. Promoting needs elevation for the same reason the sales do (the role lives in the JWT's `app_metadata`, and there is deliberately no `is_admin` column to flip), so without a service key the script prints the one statement to paste rather than seeding an account that silently fails the console's gate. The expected figures for both ledgers and the console are printed with the run.
- **The creator hub shows how each plan converts.** Views and forks existed as two lifetime counters on the publication row, and a funnel cannot be read from that: a counter has no time dimension ("412 views" cannot say whether that is this month or two years), the two counted different things (a view is deduped to one per browser session and skips the creator's own visits, while a fork was a raw event count with neither), and they live on the row unpublishing deletes. So the events are recorded now — `pub_events`, one dated row per funnel step, holding the publication, the kind and the time and nothing about a person — written by the *same* function that moves the counter, so the counter and the log cannot drift and an event can never describe a step whose counter did not move. The sale stage needed no recording at all: an entitlement is already a dated row, so the unlock count is read from the sales ledger rather than copied into a second source of truth for the same money. The Overview tab reads the log per day through a creator-scoped `get_creator_funnel` and shows **Visits → Forks → Unlocks** over a 7 / 30 / 90-day window, each step with its conversion to the next and each publication's own all-time totals beneath it, because the counters predate the log and "38 forks" alone cannot tell a creator whether that is most of their forks or a slice of them. Three things the view refuses to fake: the stages are not forced to be monotone — a fork rate can honestly exceed 100%, since Explore's card carries its own Fork CTA while a visit is counted once per session on the plan's own page — a publication the log has never reported says exactly that instead of printing three zeroes that read as a measurement, and a failed read reports itself rather than rendering an empty trend. The fork counter also stops counting a creator forking their own plan, which the view counter had always refused, so the two stages no longer disagree about who a reader is. Ships its own migration, `20260921_pub_funnel_events.sql` (apply to the live project from the Dashboard SQL editor); until it is applied the hub names the read failure. Tests: `tests/pub-funnel.test.ts` pins the window in whole UTC days, the zero-denominator rule, the unclamped fork rate, the unreported-versus-empty-window distinction, the SQL contract (one write path, no client write policy, an authenticated-only reader) and parity between the migration's function and `schema.sql`'s. ROADMAP idea bank I-22 and I-15. The fixture that makes this visible owns the log too: `scripts/seedCreatorFixture.mjs` seeds 100 days of backdated visits and forks from a deterministic plan — a ramp that makes the 7 / 30 / 90-day windows genuinely differ, a weekend rhythm, and a per-publication fork rate, because a flat plan makes every window show the same number and proves nothing about the window control — replacing the log rather than appending to it, so a second `--apply` cannot double the trend, and setting each publication's lifetime counters to the log's own totals so the window and the all-time line agree on screen. `tests/pub-funnel.test.ts` runs the shipped derivation over those same events and asserts it agrees with the windows the fixture prints, so a browser check compares against the app's own arithmetic rather than a second opinion.
- **The money surfaces can be rendered, not only asserted.** The earnings ledger, the payout-runs ledger and the publish editor need a creator with real sales behind them, and a node suite cannot supply one — no DOM, no session — so their arithmetic was pinned while their *rendering* was checked by nothing. `scripts/seedCreatorFixture.mjs` builds the account: a creator, three buyers, two priced publications (₹199 and ₹500 — the two price points the monetisation plan measured), two trips so the publish editor has something to edit, and five backdated sales. Those sales are deliberately awkward — one ₹25,000 sale walks the ladder's line, and a ₹149 sale leaves a net under the ₹500 floor so a run reads *rolls over* — and they are the same five `tests/earnings.test.ts` now prices, so the figures on screen have an answer key CI keeps honest (₹26,046 gross · ₹3,855 fee · ₹22,191 net). It prints the credentials and the deep links, is a dry run unless given `--apply`, only ever touches the rows it names, and `--clean` removes those. Writing the sales needs elevation, because `entitlements` is SELECT-only for authenticated clients by design — the one write path is the buyer-scoped claim RPC — so it uses `SUPABASE_SERVICE_ROLE_KEY` or `PGCONN` when either is set, and otherwise prints the SQL to paste rather than half-seeding a creator with no sales.
- **The admin console can read the platform's own books.** The Analytics tab had promised a revenue row since v0.46.0 and explained why it had none: entitlements are owner-scoped by RLS and deliberately absent from the hydrated cache, so "what has the platform taken" had no client-side source at all. It has a read now — an admin-gated `admin_revenue` RPC returning facts only (when, how much, which publication, which creator) and never a buyer, because revenue reporting needs amounts, dates and payees rather than identities — and the tab shows gross, the platform's fee, creator net and sales, over one row per weekly run using the same run dates creators are told about. The platform's cut is charged **once per creator** through the same `buildSalesLedger` a creator's earnings tab uses, so the two figures cannot drift: the tier follows each creator's own lifetime gross, and a single ladder over the platform's total would understate the cut, since that total crosses ₹25,000 long before most creators' do. The weekly rows carry no rollover semantics — a ₹500 minimum is a fact about one creator's balance, not the platform's — and the figures cover current unlocks, so a refunded sale leaves the totals. A failed read reports itself rather than rendering ₹0, and the paragraph that used to promise this row is deleted, because the row exists. Ships its own migration, `20260921_admin_revenue.sql` (apply to the live project from the Dashboard SQL editor); until it is applied the tab names the read failure instead of inventing a zero. Tests: `tests/admin.test.ts` pins the per-creator ladder (two creators at ₹20,000 each are charged ₹6,000, where one shared ladder over ₹40,000 would claim ₹5,250), the rule that the console's totals equal the creators' own ledgers, the weekly windows, the honest zero, and source tripwires that the tab renders the row, reports a failed read, and maps the payee the ladder needs. It also answers *which plan sold*: a second table groups the same rows by publication — plan, creator, sales, gross, fee, net — resolving each title from the public gallery and falling back to the publication id when a caller cannot resolve one, with every fee taken from its own sale's slice of its creator's ladder rather than a rate applied to a plan's total. Two ₹20,000 plans for one creator are charged ₹3,000 and ₹2,250, where per-plan re-derivation would claim ₹3,000 twice, and the same rule is why the fixture's ₹897 Kerala plan is charged ₹125 rather than 15% of itself. `tests/admin.test.ts` pins the split — including the fixture's own: Goa ₹25,149 → ₹3,730, Spiti ₹20,000 → ₹3,000, Kerala ₹897 → ₹125 — and that the rows add up to the tiles above them.
- **The creator hub's earnings view can be read at a glance.** Three things the Gumroad-shaped ledger was missing. A **fee column** — every sale now shows what the platform kept beside what is left, so "net" is a figure a creator can trace rather than trust. A **Gross / Net switch** for the headline numbers, so "what did this earn?" and "what do I keep?" each have a one-glance answer; the ledger keeps both columns either way, so the switch moves emphasis and never hides a number. And a **payout card** replacing the tile that had read `—` since v0.38: the next run's date (weekly, on Fridays), the ₹500 minimum a balance has to reach before a run would happen, what would clear, and the part that is not built — runs are not automated (there is no payouts table and no gateway payout API), so the card names the balance a run would disburse instead of implying money is on its way. The `Next payout` tile keeps its honest `—` until a balance actually clears the minimum, because a run date over ₹0 reads as money in transit. And a **payout-runs ledger** gives that promise a history: one row per Friday run — Date · Sales · Gross · Fee · Net · Status — derived by grouping the sales ledger into the run each sale lands on, so it reuses the same per-sale fee attribution and adds up to the ledger above it exactly. Its status never says *paid*, because nothing has been: a run behind us reads `Owed — not disbursed`, one ahead reads `Scheduled`, and one under the ₹500 minimum reads `rolls over`. Tests: `tests/earnings.test.ts` pins the ladder (marginal, monotonic, straddling slices), the attribution order, the add-up rule, and the schedule's Friday/midnight/never-today and threshold behaviour. ROADMAP idea bank I-9, I-10, I-13.
- **A buyer can post what they bought.** The growth loop the research asks for — buyers are the distribution channel — had no artifact: a buyer could link a plan, but the preview said nothing about them. `api/i.js` now serves a buyer's variant of the card at `/i/<id>?buyer=<entitlement>`, reading **“I bought <plan>”** over the plan's own days, budget and route, with the plan's own cover (or the branded card) as the image — the stored cover is reused rather than composited per buyer, because there is no renderer behind the function and a branded image asserting a purchase is the one part that has to be verifiable rather than drawn. That sentence is a claim, so it is verified rather than trusted: the handler asks the new `owns_publication()` before rendering it, and every other answer — the function not yet created, a timeout, a non-boolean body, an id that is not a UUID — serves the creator's ordinary card, so an unverified link can never assert a purchase and can never break a preview. The entitlement id is the capability (owner-only RLS keeps it readable to its buyer alone) and the function answers one boolean: no buyer's name, no amount paid, nothing about a person, so a forwarded link says no more than the poster's own words. It is offered in two places — a row action on **My purchases** and, quieter and last, in the unlock reveal — through one shared action that opens the system share sheet and falls back to the clipboard, and only for a plan that still resolves: unpublishing deletes the publication row, so offering a withdrawn plan would hand someone a dead link to post. Ships its own migration, `20260921_purchase_share_card.sql` (apply to the live project from the Dashboard SQL editor); until it is applied, a buyer's link simply previews as the creator's card, which is what it did before. Tests: the share-preview suite runs the handler for real — the gated framing, all five not-verified shapes falling back, an unusable `buyer` ignored without a request, the id appearing in exactly one tag, HEAD still body-less — and `tests/purchase-share-card.test.ts` pins the gate's own contract and that no page spells the claim itself. ROADMAP idea bank I-21.
- **Buying a plan ends in owning it, not in a toast.** Paying for a publication acknowledged itself with a toast: the days quietly became readable and nothing said what had been bought or where it went. A purchase now lands on a full-screen reveal — the cover, the creator, and what is *inside*, with every line computed from the itinerary the buyer just gained rather than written by hand (days, stops, planned road km, the engine's rebuilt cost per person, and the creator's tips when there are any) and a receipt naming what was actually paid. The fork control sits inside it, because the moment a plan appears in your own workspace is when a purchase starts to feel worth its price; dismissing costs nothing, since the plan is already theirs. And ownership has somewhere to live: **My purchases**, reachable from My trips (`#/purchases`), lists everything bought — cover, creator, number of days and places, what you paid, when — newest first, with an **Updated Sep 2026** chip on any plan its creator has refreshed since you bought it. Every price shown is the entitlement's own snapshot from checkout rather than the publication's price today, so a creator raising their price cannot retroactively change what a buyer paid, and the shelf's total is the creator's earnings ledger seen from the buyer's side. Two states that an empty screen would have lied about: a publication that has since been withdrawn keeps its row — the database ties the two together for life — marked as no longer listed rather than dropped, and an entitlements read that fails says so instead of reporting that you own nothing. Tests: `tests/purchases.test.ts` pins the shelf's rules (newest first, one row per plan even if a read doubles, an absent `refreshed_at` reading as not-updated, a withdrawn publication kept) and the reveal's arithmetic, plus source tripwires that the page re-reads after an unlock and that the reveal is never fed the pre-purchase copy. ROADMAP idea bank I-20.
- **The shortlist tray can be fed again, and the drift proposal gets its prompt back.** Every see-rail row's shelf carries a Shortlist toggle (pressed state announced; #179's membership guards intact), so the tray, Add-all and vote paths work again after the P2 card rewrite silently cut their only feeder — and a pinned rest that drifted now shows the plan's **Move here / Stay** choice in the open slot: Stay pins the session (it re-asks next open, per #143's design), Move here accepts the re-derived position via `clearHaltPin` with an undo that re-pins the old spot. Both were plan-promised interactions lost without disclosure (plan audit findings 1–2).
- **The rail's rain badge meets the round's own 11px floor, and fullscreen is offered once.** The percent badge rode 9.5px — the tab's smallest type on decision-critical weather — up to 11px, clearing its sub-pixel entry from the design-system baseline; and the map corner's duplicate fullscreen control is gone, since the toolbar's Expand chip (state-visible, `aria-pressed`) owns that job.
- **A search result can be located on the map before it is added, by mouse, keyboard, or tap.** Hovering eases the map to that place's pin and draws the same dashed detour spur the suggestion rail uses; focus (Tab), a click, or Enter now pins the highlight so it survives leaving the row, and leaving an unpinned row falls back to the pin — the cross-highlight no longer exists only for a mouse. The pins exist only while a search has results, so an unsearched map is unchanged.
- **The AI companion drawer and its settings cards meet the design system.** The "LLM" badge now uses the
  project's AA amber text ink (2.14:1 on white before — unreadable in the light theme), the drawer entrance
  and FAB feedback run on the shared motion tokens, the typing dots and drawer entrance opt out under
  prefers-reduced-motion, the FAB's hover no longer sticks after a touch tap, long unbroken strings (a
  generated YouTube hashtag) can no longer escape a message bubble, the Profile cards announce their test
  results through a stable live region, an empty API-key field now keeps the already-saved key as its hint
  always promised, and both cards call an unconfigured state "Not configured" in the same words.
- **The companion can route through Jev for faster answers.** Profile settings takes a TypeSafe System One
  endpoint independently of the LLM: Jev reads the question and picks which trip analysis to run, and the
  answer itself is computed on-device by the same deterministic handlers — one small request instead of a
  full model generation, with intent understanding keyword matching lacks. A Jev reply is badged "Jev", an
  LLM reply "LLM", a fallback "offline" — always honest about which brain spoke. The classification
  taxonomy is one shared module (`src/lib/jevTaxonomy.ts`) used by the runtime, the keyword router and the
  development audit alike, so the three can never disagree about what the assistant can do.
- **The AI companion can answer with a real LLM, on the traveller's own key.** Profile settings takes any
  OpenAI-compatible endpoint (base URL, API key, model), saved on the device only — the key never reaches
  YatraFlow's servers. Answers come from that model, grounded in a compact view of the trip's own data
  (route, days, stops, must-do flags; no coordinates, no notes bodies, no member data), and ANY failure —
  no config, network trouble, timeout, rejected key, malformed response — falls back to the deterministic
  trip-grounded router, with an (LLM)/(offline) badge on every reply so the traveller always knows which
  brain spoke. The endpoint is validated and probed with a "Save & test connection" button that reports the
  real reason a key or URL was rejected — and a saved endpoint that does not answer says so, with answers
  falling back to the offline router until it connects. The drawer and its Profile settings cards both stay
  behind `VITE_AI_COMPANION=on` until M8.
  (M5, issue #236; tests `tests/aiProvider.test.ts`.)
- **The Map tab's search box lists every match, not just the first five.** A "Show all N" control unfolds the full ranked list; the default of five is unchanged.
- **A Google search result shows its rating and opening hours.** When a place carries a trustworthy rating (10+ reviews) or reported hours, the row shows them — "4.6★ · 9:00 AM–6:00 PM" — rendered in the traveller's own 12h/24h clock preference.
- **Trip DNA now follows the account, not the device.** The engine that learns category affinity, detour tolerance and stop lengths across a user's trips kept its log in localStorage alone, so the profile someone built on their laptop was invisible on their phone — the last parked item in M6's follow-up list. A new `user_dna` table holds the same event log the device copy carries: one row per user, where the primary key *is* the owner, so no policy has an id/owner split to get wrong, owner-only on all four verbs and under the same restrictive deny-disabled policy as every other app table. The store reads the row once per hydrate and writes it back debounced — one upsert per burst of accepts, not one per tap — and the account's events land ahead of this device's own, so a new device inherits the profile instead of starting over. The merge is a de-duplicated union, deliberately: events carry no id and no clock, so two identical records cannot be told from one record synced twice, and without the collapse every sync would double every count — a systematic error — while a genuinely repeated twin costs at most one affinity point. Ships as `supabase/migrations/20260921_user_dna.sql` — **apply it to the live project from the Dashboard SQL editor**; until then a missing table is treated as a capability (warned once, then the log stays device-local), never as an error, and signing out drops the account's log from memory so the next person on the device never inherits the last one's profile. ROADMAP idea bank I-16.
- **The database half of a release is checked instead of assumed.** `npm run verify` typechecks, tests and builds — and says nothing about SQL that has never run, so a release could merge, deploy, pass CI and Vercel while its migration was never applied to the live project. Nothing in the repo could see that, and the app's own capability probes are *designed* to hide it: when an optional column is absent the store reports it missing, the field is quietly dropped from every write, and the screen keeps working. `npm run check:migrations` derives each migration's artifacts from its own SQL (`create table`, `add column`, the `storage.buckets` insert) and asks the live project whether each one is really there — one read-only GET pass with the app's own anon key, so it can be pointed at production. It prints applied / MISSING per file and exits non-zero when something is missing, undeclared, or could not be checked; `--json` and `--list` serve scripts and review, and `--allow-missing` turns it into a report. Function-, policy- and trigger-only migrations are named as having no probe surface with the reason, rather than passed over in silence: a missing RPC fails loudly at call time, and the policies are covered by the RLS contract suite. It earned its place on its first run — **`trips.stay_style` had never been applied to production**, so the stay-budget tier silently reverted to its derived value on every reload; running that migration's own one-line `alter table` in the SQL editor closed it the same day, and the sweep went from 1 missing to 0. `tests/migration-status.test.ts` pins the derivation against the real SQL shapes this repo writes (including an `add column` that wraps onto its own line), the verdicts against a stub server replaying the response bodies the live project returns — so CI needs no credentials — the coverage ratchet that fails on a migration neither probed nor declared, and a tripwire that keeps the check GET-only, since probing a function the obvious way would execute it.

### Changed
- **The Map tab's motion rides the same tokens as the rest of the app.** Folding a rail used to snap: the `grid-template-columns` change had no transition, so a 320px column became a 48px spine in one frame — it now glides on the day-collapse's own resize clock (`--motion-slow` + `--ease-resize`, both ends at rest), with the fold icon turning on the same clock so one click reads as one movement. The map's expand/collapse animations were raw literals (320ms/280ms) whose closing timer hardcoded the same number in JS — both now read `--motion-slow`, the timer through `motionTiming()`, and under `prefers-reduced-motion` the whole thing is instant instead of playing a glide nobody asked for. The toolbar day chips' press scale, the legend chips' hover and "Live on" state, the map key card's entrance (now on the shared popover pattern), the ledger shelf and rows' entrances, and the rotating engine-tip all ease at catalog speed instead of snapping or riding the pre-catalog `--t-*` ladder, and every one of them stops under reduced motion — the tab's rules are off the legacy ladder entirely, held by a new gate alongside the raw-duration ratchet.
- **The Map tab's P3 sweep: laptops finally see the design, phones get the plan's summary.** The signature three-column split starts at **1280px** instead of 1501px (320+320 rails leave a ~560px map), so every common laptop shows it; the tab opens on the decision surface now — the root flexes and the "Nearby ideas" card takes `order: 1`, landing below the rails and map instead of above them (both mockups open on the decision, per the UI review). Parts wear their kind glyphs again (meal/fuel/overnight/stretch, breakfast via its label — the four imports the plan audit found dead are live), candidate rows carry the plan's cost micro-bar (teal track, warn when over budget, background-only rules), the rail titles take the display face back (`--font-display` Sora, 700 via `<b>`), phones collapse the slot list to the plan's "N empty — open" summary, the skeleton mirrors the phone's 52vh frame (no more load-drop), and the all-days main line turns navy in light theme so the live dot's documented "blue = you" is finally true — with the legend saying "main line" instead of "blue line". The extras hue stays magenta on purpose: its 40° clearance from `DAY_COLORS` is the scenic-vs-day guarantee the hue gate enforces, which the mockup's violet would spend.
- **Search lands in its slot — the day-slots mockup's headline tag, shipped.** The open part carries its own Find field: route-aware results rank through the same `searchPlacesText` + asymmetric-detour sort the top search uses, with the same 2-character floor, seq ownership (a slow query can't land in another slot) and quota guard. A picked result becomes **a candidate for that slot** — real detour minutes and day-budget share computed from the engine's own helpers, arrival honestly absent, provenance on the row ("added from this slot's search") — and never a direct plan write: Fill stays the second explicit act under the #179 membership guards, engine candidates are untouched, and manual picks drop out if the hit is later added or dismissed. The top "Nearby ideas" card keeps corridor-wide discovery.
- **The Map tab's two day pickers say what they control, and the hint stops shouting.** The map's day filter is labelled "Show on map" and the rail's day strip "Plan this day" — one synced state, its asymmetry now on the surface instead of learned. The nearby-ideas hint keeps its three commitments (clock-anchored, budget-checked, never around your start) as one line and moves the window/wheel/fuel mechanics behind a "How suggestions work" disclosure; the element swapped from `<p>` to `<div>` because a `<details>` cannot nest in a paragraph.
- **The Map tab's toolbar is restructured into three ranked weights, and its idea filters become one popover.** The day filter now owns a glass container of its own (the primary intent); view modes, Recentre, Milestones and Return home sit in a middle cluster behind the family hairlines; and Directions (which leaves the app) plus Expand ghost down to icon-only in an end group — so a day chip can no longer be mistaken for "open Google Maps". The nine idea-category chips fold into a single `Filters (n)` popover on the catalog's entrance pattern, and Recentre drops its label for its icon. Every chip keeps its `aria-pressed`/`title`, the two groups carry `role="group"` labels, and the Expand chip gains the `aria-pressed` its siblings already had.
- **The Map tab's toolbar reads in families instead of one row of twenty equal pills.** The row above the map held the day filter, the layer toggles, the view modes and the two links out to Google Maps as one wrapping run of identical glass chips, so four different intents weighed the same and nothing on the map's own control surface was primary: for a 7-day trip that is 21 chips, and "Day 4" looked exactly like "Directions", which leaves the app. The layer toggles and the two actions now sit in their own group behind the same hairline the view modes already used, read as secondary until touched, and keep the filled state that says they are on; the day chips are the row's only primary control. The utilities also keep their own width, so a narrow phone scrolls the row instead of squeezing the group into a second row.
- **The engine-tips banner stopped borrowing the scenic hue.** It was painted in `--yf-purple`, the token this codebase documents as *scenic / creative discovery*, for something the tips are not: fatigue spacing and detour budgets. It reads on the quiet surface now, with the tab's own accent on the icon, so the one purple "assistant" banner that made the intelligence look like an AI feature is gone and the hue keeps the one meaning it has everywhere else.
- **The Map tab's visible copy uses hyphens where it used spaced em-dashes, and one separator where it used up to five.** A search result composed `Name · City · 4.6★ · 09:00–18:00 — ~120 km into the trip · 3 km off-route` on one line, and a road milestone's tooltip and a nearby-idea marker carried the same dotted run; each now keeps a single middle dot between a place and the city it is near, and reads its remaining metadata as a comma-separated run. Copy only - no data, no layout, and no other tab's voice touched.
- **Earnings stopped being gross wearing a net label.** `PROJECTED_PLATFORM_FEE_INR = 0` was a placeholder compiled into a shipped screen, so every "net" figure on the creator hub was the gross again under a different heading — a claim about money that was not true. The platform fee is now real: a **marginal ladder over a creator's lifetime gross — 15% up to ₹25,000, then 10%** (`PLATFORM_FEE_TIERS`, `src/lib/earnings.ts`). Marginal rather than re-rating the whole balance once a creator crosses the line, because the fee then depends on cumulative gross rather than on the order sales happened to arrive in, and the rule fits in the one sentence a creator reads on the ledger. 15% is the number `docs/commercial/PLAN-MONETISATION.md` §11 asked to confirm and it has to clear the 2–3% payment-processing floor to be worth charging at all; ₹25,000 is roughly 125 sales at ₹199, which makes the threshold reachable rather than decorative. Fees are attributed **oldest first**, so the sale that carried the lifetime gross over the line is the one that gets the cheaper rate — and since the ledger displays newest first, that order is settled at attribution rather than at render, or a re-sort would quietly move money between rows. Each row's fee is rounded to the rupee and every total is the sum of its rows, so the columns add up the way a reader checks them. The whole model is one exported constant: changing the business decision is a one-line edit. The price field in the publish editor states what is kept at the moment the price is set — "at ₹199 a sale nets you at least ₹169" — as a *floor* rather than a rate, because a price on its own cannot know a lifetime gross and the first tier is therefore the least a creator keeps. Payout runs are deliberately *not* implied: there is no payouts table and no gateway payout API in the repo, and the ledger says so in as many words.
- **A search result's "off-route" distance is measured against the road, not the nearest stop.** The box used the straight-line distance to the closest planned stop, which over-counts a place sitting between two of them; it now measures the perpendicular distance to the drawn route, and only falls back to the old estimate when the road has not been measured yet.
- **The landing page was rebuilt around one idea per scroll instead of one of everything.** A full design pass on the public entry: the hero now carries exactly four text elements (eyebrow, headline, subtext, two CTAs) - the boarding-pass bench ticket, the reassurance tagline and the trip-code join form moved into a dedicated handoff strip directly below the hero, where a visitor who skipped the main CTAs still finds a next step. The "three identical feature cards" row became a three-cell bento (one tall photo cell, one tinted cell, one plain cell - no empty tile), and the four equal step cards became a route timeline: the steps sit as stops along one dashed road line that turns the corner and runs vertically on narrow screens. The tall cell carries a mini echo of the real Impact Preview dialog (delta figures for road time, distance and cost, plus a warning and a suggestion with their fixes) so the feature is shown rather than described; it is a forced-light panel of literal colours on the dark photo in both themes, the same treatment the hero route card uses for its warning chips. The signup CTA now reads "Start planning free" everywhere it appears (nav, hero, closing band) instead of three different labels for one intent, and the closing band's over-long button label was shortened so it cannot wrap. Two real photographs (a high-route camp under a navy scrim, an open mountain road behind the closing band) are vendored under `public/img/` as placeholders for brand photography; the scenario captions in the hero card drop their emoji for lucide glyphs and their dotted meta line for hairline-separated fields.
- **The search box pauses itself and explains why when the Google Places monthly cap is reached.** The Search control disables with a plain reason instead of failing on click, and the "nothing within your detour scope" message now says the scope slider alone will reveal the matches — no second search needed.
- **Marking an expense line settled now genuinely takes it out of who-owes-who.** The card measured every line against the whole trip *estimate* split per head, so a settled line kept both its credit and its share of the estimate and "mark settled" was a record of a settlement rather than the settlement itself. The balances now measure the open lines only: the fair share is the open *tagged* total over the travellers, credited to whoever fronted those same lines, so the rows net to zero across the crew, the fewest-transfers settlement has nothing left over, and settling every line leaves every row at zero. That is what makes the card answer "what do we still owe", the question the settle-up strip beside it asks; the planning figure it used to print is already on screen in the metric strip above ("Per person"), and that is untouched. One predicate now feeds both the balances and the "still to square up" total, so the two figures cannot drift apart, and the settled history's summary names the total already squared up. With no tagged lines the card says there is nothing to split yet rather than printing a share of nothing. A product call, not arithmetic: ROADMAP idea bank I-19.

### Fixed
- **A stalled map style can no longer leave the map's auto-fit permanently dead.** The map's ready gate waited for the style's `load` event alone; when that event never arrived — a hidden tab holding the style mid-load, a stalled or blocked tile host — `mapLoaded` stayed false forever and the fit-on-extent-change never ran at all (reproduced in a hidden webview where the style never resolved: the camera sat on the default view through every day switch). The gate now arms a watchdog beside the event: 4 seconds after the map instance appears it opens regardless, because the fit is a camera operation (`resize` + `fitBounds`) that needs only the instance and its container, not a resolved style. A `load` landing late changes nothing — opening the gate is idempotent — and the timer is cancelled whenever the gate re-arms. Pinned in `tests/map-fit.test.ts`.
- **The map frames the day it draws, not just its pins.** The auto-fit and the Recentre button bounded only the plotted stop pins, but what a day draws also includes the journey's synthesized origin (where yesterday ended — an endpoint flag and the road line's far end) and, on a round trip, the home pin beyond the last stop. A day whose stops cluster while its road runs far therefore glued the camera onto a stop cluster at the zoom cap with the whole route off-screen: Day 2 of the sample Rajasthan trip framed two pins inside Jodhpur at zoom 12 while 280 km of drawn road back to the previous night's town sat ~16,000 px outside the canvas (measured in a browser), with the same signature on Day 3. Both fit paths now bound everything the view draws through one pure helper (`boundsOf`, `src/lib/mapFit.ts`) — nearby-suggestion pins deliberately excluded, since another day's ideas would balloon the fit. Two companion fixes from the same investigation: the trip-start and day-start badges draw an origin dot instead of a take-off plane on non-flight trips (a plane glyph on a road trip's start reads as an airport pin — the "pins in a weird spot around the airport" half of the report), and the sample trip's Mehrangarh Fort pin moves onto the fort — its stored longitude 73.0351 sat 1.6 km east in Paota, outside the fort's own OSM way bbox (a digit typo that reverse-geocodes to a suburban road); the seed fix corrects future sign-ups, while a copy already seeded keeps its stored coordinates until the stop is edited. Tests: `tests/map-fit.test.ts` pins the day-2 regression as a fixture, the helper's edge cases (empty, single-point pad, non-finite coordinates), both fit paths calling the helper with the old inline walk gone, the flight gate on every plane badge, and the seeded fort inside the real feature's bbox.
- **Collapsing a rail on the map gives a spine, not a cropped panel.** The fold was built around a 48px column, but the day rail's header has since grown a Shape toggle, a "Fill the day" button and a count pill, and only its title was hidden when folded - so a collapsed rail rendered controls two to four times its own width: clipped at the column edge, and, because a rail's `overflow-y: auto` computes `overflow-x` to `auto` as well, draggable sideways. That sideways drag is what the collapsed strip was doing instead of sitting still. A folded rail now keeps what fits and still means something collapsed - its lane icon, the day's count, and the control that reopens it - with the two actions hidden rather than squashed, and 2px of spine padding so the count pill and the 40px touch floor the fold button takes both fit inside the column. In stacked mode, where the fold buys no width but still hides a long rail, the collapsed head stays one line and keeps the label saying which rail collapsed, instead of stacking [icon, count, fold] down a full-width bar. Nothing in a folded rail can scroll sideways any more.
- **The Map tab's plan rail is reachable by keyboard, fits its own column, and reads its own numbers.** Four faults on the rail the day-planning work introduced, each one a control the rail asks the reader to use. Its focus ring was referenced but never defined: `--focus-ring` appeared in four rules and nowhere else in the stylesheet, so every one of them silently fell back to an amber at 55% opacity that measures **1.40:1** against the rail's cream and 1.51:1 against a white card, under the 3:1 WCAG 1.4.11 asks of a focus indicator — and three of the four had already set `outline: none`, so that ring was the only signal a keyboard user got on the day chips, the Fill buttons and the ledger rows. The ring is the CTI teal now, and it is the app's one focus token rather than a rail-local fix: `--ring` itself was a 35% tint measuring 1.50:1 against `--bg` on every rule that used it, so the rail's four rules ride that token at full strength (**3.80:1** on `--bg`, **4.08:1** on `--card`, 6.43:1 on the dark card) and `--focus-ring` is retired instead of being given a parallel definition that could drift from it. The rail's header packed five controls beside a title block that could not shrink (`min-width: auto` is a flex item's default), so at the 320px column the row ran past it and the rail scrolled sideways; the title block owns a floor now and the controls take their own row when one row cannot hold both, the same answer the Plan Bench's mode grid took at 230px. The numbers a reader decides on were the rail's smallest type — the day chip's fill count at 9.5px behind `.78` opacity (**4.30:1** on the chip's own white and **3.79:1** on its teal-soft "on" fill, both under AA at that size), the window label and the closing/closed states at 10px, and a candidate's cost line at 10.5px — so each is a size up, the opacity fade is gone, and the cost line reads in the rail's second ink tier. And opening the tab replaced the whole tab with a spinner while the MapLibre chunk loaded, on the surface whose frame is the heaviest download in the app: it gets a skeleton of what is arriving — the frame and the two rails, on the tab's own grid so it inherits the same breakpoints — whose pulse stops under reduced motion.
- **The map's day chips and the plan rail no longer disagree about which day is showing.** The rail drove the map's day filter through a prop, but the map's own chips only moved the map — so clicking "Day 4" above the map left the rail's day strip on Day 1 while both were visible on the same screen and looked like one control. The chips report their day back now, so the two selectors agree whichever one is touched; "All days" moves the map alone, because the rail always plans exactly one day and cannot represent it.
- **The day rail is no longer buried under the map on a laptop.** The map and its two rails sit side by side only above 1500px, so from 721px to 1500px everything stacks — and the map kept its full 480px height there, pushing the day rail (the tab's work surface, with the day strip, the meter and every empty part) below the fold. In stacked mode the frame takes 44vh with a 320px floor, which brings the rail's header and its first parts into view on a 768px-tall laptop; the expanded map still fills the screen, where the frame is the whole point.
- **Icons and warning ink follow one rule across every surface.** An app-wide icon/colour audit found four drifts, each closed at its source and pinned so it cannot reopen. (1) The warning pills' amber text on light tints read the raw `--warn` surface token — 3.48–3.69:1, under AA, and frozen as three *accepted* entries in the design-system ratchet because the `:root` override fixed the rendering while each selector's own declaration pair (which is what the ratchet reads) still failed. The base rules now ink with the SYS-3a `--ink-amber` text token itself: 5.08–5.38:1 in light, byte-identical in dark (`--ink-amber` re-declares to `--warn` there), and the three baseline entries are gone rather than re-ratcheted. (2) Board stop cards carried the kind's colour spine but no kind glyph; the kicker now leads with it (`KindIcon`, one lucide glyph per `stopKindOf` kind, Camera fallback like `CatIcon`). (3) The transport-mode glyphs lived in four private maps — PlanBench's, Trip settings', Create Trip's tile meta and a fourth inline copy — which is how Create Trip's ticket row could show a **car** while its own label read "train"; they now come from one `MODE_ICONS` map behind `modeIcon()` / `KIND_ICONS` in `components/icons`, with the three mode-bearing surfaces importing it and the public page's travel anchor following the trip's own mode. (4) 125 hand-copied `style={{ verticalAlign: …, marginRight: … }}` inline-icon styles collapsed into one `InlineIcon` helper (size/gap/vAlign/style/fill, rendering byte-identical to what it replaced) across 31 files. `tests/icon-consistency.test.ts` pins all four — the ratchet entries staying gone, both glyph maps covering their vocabularies exactly, no private mode map reappearing, and a source tripwire that fails the build on any new hand-rolled `verticalAlign`.
- **The plan you just paid for is the plan you see, without a reload.** The public itinerary's fetch effect ran once and never ran again, so immediately after an unlock the page kept rendering the copy the server had served *before* the purchase — and that copy is wire-stubbed on purpose, with the stub keeping stop titles and coordinates while replacing descriptions, notes, timings and every cost with placeholders. So the lock lifted over an emptied plan: the gate opened and the content behind it was still the preview, which reads as having paid for nothing. The page now re-reads through `get_public_trip` once the entitlement exists — that call answers with the real days precisely because the caller is the buyer — and the unlock reveal's own numbers come only from that copy.
- **The landing page no longer renders two footers.** The page carried its own footer (brand line + feedback mailto) while the app shell renders the global footer below it on every route, so the landing route showed both, stacked, each with its own top border. The page-local footer is gone; the feedback link moved into the global footer through the shared `feedbackHref()` helper, which pre-fills the app version and the live route (the hand-rolled mailto could only ever report "/"). Visible everywhere the landing shows, and a small part of the landing pass above.
- **A place added from the search box lands on the day it is actually near.** The pick-a-day dialog always pre-selected Day 1, even when the row read "~450 km into the trip", because it read a road position the search never set. It now defaults to the day whose stretch of the route the place sits on, and the picker stays adjustable.
- **A slower earlier search can no longer overwrite a newer one.** Two searches fired in quick succession could settle out of order and leave the first query's results under the second; only the most recent search updates the list now.
- **A place already in the trip can no longer be added twice from the search box or a map pin.** The duplicate check the shortlist tray had was bypassed by the direct add paths; every add path now refuses a place already in the plan.
- **A closer match from the free data sources is no longer discarded before results are ranked.** The merged result pool was capped in provider order before the route ranking ran, so a nearer free-stack place could be dropped while a farther one was kept; the search now ranks the whole pool and slices afterwards.
- **The search results read as a proper list to a screen reader.** The container announced itself as a list while its rows were not list items; the rows now carry the matching role.

- **An empty presence room now says so.** The avatar row beside the trip header rendered only when someone else was viewing, so a solo viewer saw nothing at all and could not tell an empty room from a feature that was not working — the first question the owner asked on the two-browser pass. It renders from a three-state helper now: hidden when presence is not running at all (anonymous views, no backend), "Just you viewing" when it is running and nobody else is in the room, avatars when the crew is there. The quiet no-op is unchanged, the header no longer decides on a bare peer count, and the three states are pinned by tests. `docs/PLAN-TOGETHER-M6.md` follow-up 1.
- **A replayed payment webhook can no longer re-grant a refunded purchase.** The webhook marked orders paid idempotently, but its grant read had no status filter: a late or manually re-fired `payment.captured` after a refund — the refund path flips the row paid → failed and deletes the entitlement — would have re-created it, leaving a refunded plan reading as owned. The grant read now requires the paid state, and the sequence is pinned in `tests/payments-functions.test.ts`.
- **Invite codes are drawn from the platform CSPRNG.** A trip invite's 4-character tail was generated with `Math.random()` — the weak-generator class the presence key already moved off; a join credential's predictability is a security property, not a style choice. Rejection sampling keeps the unambiguous alphabet unbiased, and a source tripwire in `tests/invite-code.test.ts` keeps `Math.random(` out of the module.
- **The web app ships baseline security headers, and the Android shell stays out of cloud backups.** Every Vercel response now carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` (geolocation self-only; no camera, microphone or payment), and a **report-only** Content-Security-Policy — the zero-risk measurement step; flip it to enforcing after a stretch of clean consoles. The APK's `allowBackup` flips to false: the WebView's localStorage holds the session's refresh tokens and any device-local AI keys, and every trip is server-side anyway. Signup also enforces the 8-character password floor its hint always promised (Supabase's own floor is 6).
- **The signed-out Android shell no longer shows a dead menu button.** The hamburger lives in the website's topnav; its tray never mounts in the native shell, but the button was not gated with it — so on the shell's signed-out pages (landing, login), which keep the topnav, a tap toggled state that rendered nothing. The button now shares the tray's platform gate, and the shared gate is pinned in `tests/mobile-shell.test.ts`.
- **The light-theme AA debt is cleared, the budget palette stops reading as alarms, and the spacing ladder has a token home.** Four contrast findings left the accepted baseline and one hue collision with them: `.btn-danger`/`.chip-danger` wore `#C93B3B` at 4.22:1 on their soft tints (now the darker `--ink-coral`, 5.16–5.69), the teal tint chips sat at 4.0–4.5:1 (`--ink-teal` exists for exactly that surface), `.icon-link:hover` (4.49:1) and `.ride-purpose-fuel` (4.45:1) were lifted (the amber trio left the baseline too — its story is the icon audit's first finding). The budget `--cat-*` palette no longer borrows the status palette (entry fees wore the critical coral, so a money bar read as an alert): it is a dedicated categorical family with every hue ≥15° from its siblings, and the `DAY_COLORS` 1.6° amber collision is gone. The spacing ladder — deleted as unconsumed with SYS-2 while the ratchet still enforced its numbers — is re-homed as `--space-1…--space-10`, matching the gate's ladder exactly in both directions (`DESIGN_TOKENS.md`).
- **YatraFlow installs as an app.** The web app ships a web manifest, real launcher icons (192, 512 and a maskable tile, drawn from the brand mark), and a service worker that keeps the app shell — so it can be added to a home screen or desktop, opens in its own window, and starts without waiting on the network. Installation is offered once and honestly: the browser's own prompt where it exists, the Share-sheet hint on iOS, and nothing at all inside the installed Android shell. The worker caches only the shell and Vite's hashed assets — `/api/*`, the `/i/<id>` preview, the sitemap and the Mappls proxy are never cached, and cross-origin traffic (Supabase, tiles, fonts) goes to the network, because a stale auth response is a correctness bug rather than a performance win. A contract test pins the manifest's sizes, the cache exclusions and the registration gates. (PWA phase 1 of the M8 path.)
- **A saved plan survives no connection.** The last cleanly-synced account is kept in IndexedDB and shown immediately on a cold start while the network is away — with an honest strip that names what is on screen and when it was saved ("No connection — showing your saved plan from 6:30 PM"), plus a Retry. The cache is deliberately narrow: keyed by account and erased on sign-out (so the next person on the device never inherits the previous one's trips), written only from a CLEAN hydrate (half an account is never presented as the truth), and it stores neither notifications nor the admin log. Writes still need the network — an offline start shows the plan, it does not pretend to edit it. (PWA phase 2 of the M8 path.)
- **Edits made without a connection are kept and synced when it returns.** A trip edit is now durably queued on this device the moment it is captured — before the network attempt, not after it fails — so a dropped connection, a crashed tab or a closed laptop can no longer lose the change. When the network returns (or the app next boots or resumes), the queue is pushed oldest-first, each confirmed write leaves the queue, and the offline strip counts what is waiting ("2 trip edits saved on this device"). The queue mirrors the write model it plugs into: one whole-trip snapshot per trip (a newer edit replaces the older one, never resurrecting deleted stops), bounded retries (an edit the server keeps rejecting after three attempts is dropped with a notice, not retried forever), and sign-out removes the departing account's entries so the next person on the device is never the one whose session "syncs" them. A conflict — a collaborator's change landing after the offline edit was captured — is applied last-writer-wins (the app's whole-trip write model) with BOTH sides told: the offline user gets "your offline changes to <trip> replaced a newer edit by a teammate", the peer's existing remote-edit banner covers theirs. (PWA phase 3 of the M8 path; `src/lib/writeQueue.ts`.)

### Docs
- **The design system is allowed to evolve, and two of its blind spots are gated.** `docs/DESIGN-SYSTEM-GUARDRAILS.md` said the frozen baseline "may only shrink", which quietly made a wrong value permanent: the focus ring was pinned *by that test* to a 35% tint measuring 1.50:1, so correcting it failed the build that should have wanted it. The doc now states three tiers — a wrong value is fixed outright, a taste upgrade records its intent in `DESIGN_TOKENS.md`, and one that moves a threshold, a pinned assertion or the baseline ships a rendered before/after, because the suite stayed green through the `.reveal` collision and through four references to a token that did not exist. Two gates follow from the review's own findings: `--ring` must be the only focus token declared and must clear 3:1 against `--bg` and `--card` in **both** themes (the contrast gate reads only rules declaring a `color` *and* an opaque `background`, so a `box-shadow` and a token's own value were both invisible to it — which is how a sub-3:1 ring survived a ratchet reporting "no known dark-theme violation left"), and a new `subPixelType` ratchet freezes the 65 declarations still below 11px so the type floor can only rise. The doc's baseline table was also stale (it listed 9/11/32/30 against an actual 7/0/27/29), and editing a token in place is now the documented move — appending around it is what produced the parallel focus token, and that habit predates the ratchet dropping line numbers from its keys.

## [0.64.0] - 2026-09-21

### Added
- **A creator can upload their own cover photo.** A cover used to have to be a photo someone else already hosts — the destination image the app finds on Wikipedia, or a pasted address — which left the one picture a shared link actually shows at the mercy of another site's uptime and terms. The cover picker now takes an image from the device: it is shrunk to 1200px on the long edge and re-encoded as JPEG in the browser before anything leaves it (a 1,335,523-byte photo becomes 77,818 bytes, measured), and stored in a public `covers` bucket whose first path segment is the uploader's own id, so no creator can overwrite another's object even by guessing its name. Replacing a cover writes a new object and leaves the one it supersedes in place, so a failed or cancelled upload can never destroy the picture that is already live — and, more importantly, so replacing a cover cannot break a link that already points at it. A cover URL does not stay inside the trip that owns it: forking a trip copies the cover onto the new trip, and publishing stamps it onto the publication that the share-preview handler serves as its `og:image` — a fork belongs to another user, so a creator replacing their own cover would otherwise have silently 404'd every forked copy and every live share card while their own screen kept working. Superseded uploads are kept instead, at roughly 100 KB each; a future cleanup that can prove an object is unreferenced may collect them. A file that is not a JPEG, PNG or WebP, or is over 8 MB, is refused by name before anything is decoded. This is the project's first Storage object, so it ships its own migration — `20260919_covers_bucket.sql`, which creates the bucket, its public-read policy and the folder-scoped write and delete policies — and the upload control reports the server's answer rather than failing silently until that migration is applied.
- **The debate behind a group decision now lives on the decision itself.** `StopSuggestion` has carried comments since the group-input surfaces shipped; `TripDecision` never got the column, so the discussion behind a vote happened in whatever chat the group used outside the app. A decision card now shows its thread and a "Post" box in the same language as suggestion cards, on open *and* resolved decisions — the record of why a call was made. Comments persist to the new `decisions.comments` column (`supabase/migrations/20260920_decision_comments.sql`; apply to the live project from the Dashboard SQL editor) and sync through the existing decisions realtime channel, so no publication change was needed. On a database where the migration has not been applied, the store's capability probe (`decisionsHaveComments`) keeps comments session-only rather than firing a write the database would reject whole — the same degradation the party-prefs columns use, and it says so once in the console. Tests: `tests/decision-comments.test.ts` (write-through, pre-migration session-only, empty/unknown no-ops) and `tests/restore-rows.test.ts` (the capability-gated row mapping). ROADMAP idea bank I-7.
- **The Balances card says what is still owed, not just who owes it.** v0.62.0 added the per-line "mark settled" flag and the settled history, but nothing named the outstanding total. The card now opens the settle-up section with one line — the sum still to square up across the open *tagged* lines (untagged shared-kitty lines owe nobody, so they do not count) — above the per-line Mark-settled buttons. ROADMAP idea bank I-6.

### Changed
- **Publishing takes ownership of an auto-suggested cover instead of linking to someone else's.** A publication whose cover was the app's own destination suggestion pointed its `og:image` at a Wikimedia file — an image that can be renamed, re-compressed or deleted without notice, and one whose served size we do not control: asking Wikimedia for 1200px returned a **586,834-byte** image for a live destination, 98% of the 600 KB ceiling WhatsApp documents for link previews, with only 13 KB of headroom against a silent fallback to the brand card. Publishing now fetches that suggestion, re-encodes it at the app's own size and stores it in the project's own `covers` bucket, so the stored cover is ours: the same photo measured **99,019 bytes** after re-encoding, 5.9× smaller than the file we were linking to. The trip's cover is rewritten to the owned URL as well, so re-publishing cannot re-copy the same suggestion and the app's own cards stop loading from Wikimedia too. Covers that are already ours, or that a creator pasted from anywhere else, are left exactly as they are. The copy is an improvement and never a new failure mode: it is attempted after the publication is already on screen, it is bounded by an 8-second timeout, and any problem — offline, a file the wiki cannot resolve, a decode or upload failure — keeps the third-party URL, which is what publishing did before.
- **Publishing a trip now requires a saved cover photo.** A publication's cover is what a shared link previews with — the preview handler serves it as `og:image` — and it is copied from the trip at publish time. But the destination photo the app shows for a trip with no cover is picked at runtime and never stored, so a publication could look illustrated in the app and preview as the brand card everywhere it was shared, with nothing on screen to explain the difference. The publish form now leads with the trip's cover picker, says plainly that the picture is what every shared link will show, refuses to publish while the cover is missing or is not an https URL the preview handler would accept, and — when the preview it displays is only a suggestion the app found — says so rather than implying it is saved. Publications that already exist (and predate the requirement) take a cover the next time their creator updates them.

### Fixed
- **The Explore gallery is the same whether you are signed in or not.** The shelf was gated on the viewer's own *readable* trips: hydration kept a published itinerary only if the trip behind it was in the client's trip cache, and the paywall hardening makes another creator's trip row unreadable to a non-member on purpose. So the gallery emptied itself the moment a visitor signed in — the catalog rows were fetched and then discarded — and, because the public itinerary page finds its publication in the same cache, `#/pub/<id>` answered "This itinerary didn't load" for anyone signed in who was not the creator or a buyer, while the identical page worked fine logged out. A publication is not a view of a trip row: it is the public artifact the preview handler, the public page and Explore all serve, and it is tied to its trip for life in the database (`published_itineraries.trip_id ... on delete cascade`), so a deleted trip cannot leave a stray card behind. The list is now de-duplicated without any visibility test — the key includes the creator, so two people publishing an identically named trip keep a card each — and the extra trip queries hydration used to run for that filter are gone. The paywall is untouched and now stronger in one respect: the trip body reaches a viewer only through `get_public_trip`, which stubs locked days at the wire, never from the client's own cache of other people's trips.
- **A publication that still linked to someone else's image is taken over automatically.** Taking ownership of an auto-suggested cover happens at publish time, so it reached only publications created after it shipped — and any publish whose copy failed (offline, a file the wiki could not resolve, the copy's own timeout) deliberately kept the third-party URL rather than fail. Neither is visible in the app, because the page renders the photo either way; what carries the cost is the share card, which keeps depending on a host whose size, terms and uptime we do not control. The app now collects them itself: once a signed-in creator's data has hydrated, any of their publications still pointing at a Wikimedia cover is fetched, re-encoded at the app's own size and stored in the project's own bucket, with the publication row, the app's cache and the trip that supplied the picture all updated together. It is idempotent and data-driven — a row still pointing at a third party *is* the work list, so a second pass finds nothing to do and a copy that failed is retried on the next load instead of being forgotten. It runs one image at a time, so a backfill never competes with the page being read, and it stays silent: housekeeping behind the scenes is not an announcement. Only a publication's own creator can collect its cover — the covers bucket confines every write to the writer's own folder, so another creator cannot take it and neither can the admin console, which holds no service key; a publication whose creator never signs in again keeps its third-party cover until they do.
- **A chosen cover photo is saved, instead of vanishing on the next reload.** The cover picker's choice — the destination photo, a pasted address, or a newly uploaded image — was never written to the database: `trips.cover_image_url` did not exist, and the store probes for that column before writing it, so the field was silently dropped from every trip save. The picker showed the new cover immediately, kept it for the rest of the session, and reverted to the app's runtime suggestion the moment the page was reloaded. The visible symptom was one layer away and looked like a different bug: publishing copies the trip's cover onto the publication, so a publication whose creator had explicitly chosen a cover still stamped `NULL` — and the share-preview handler, which reads that stored column and nothing else, correctly fell back to the branded card. That is why a shared itinerary previewed as the brand image on every link while the app showed a destination photo. `20260919_trip_cover_image.sql` adds the column (DDL only — apply it live); the existing write path starts persisting as soon as it exists, with no client release needed. A new guardrail test pins the store's probe list against the migrations, so an optional field can no longer ship without the column it needs — the test names `cover_image_url` when the migration is removed.
- **A publication that has a cover no longer previews with the megabyte original.** The preview handler advertised the stored cover URL verbatim, and a stored cover is often Wikimedia's raw upload: the one live publication carrying a cover pointed at a **1,335,523-byte** JPEG. The handler now asks Wikimedia for that same file at 1200px through its own redirect — **147,351 bytes**, measured on that cover — which is the rule the client already applies on the display path (`src/lib/tripThumb.ts` `sizedCoverUrl`) and one the serverless function cannot import, since it sits behind the bundler and the handler must stay dependency-free. Non-Wikimedia covers pass through untouched, and an already-sized redirect is left alone.
- **The Explore filter dropdowns open over the itineraries they overlap.** The filter bar's own glass blur makes it a stacking context, so the menu opened inside it was bounded by the bar's rung — and the featured card and the grid cards below it are positioned, so they painted straight over the menu's last two rows: "Under ₹35k" and "Under ₹60k" were visible only when the card's edge happened to end above them, and a click aimed at one landed on the card behind it. The bar now claims a rung above page content, so every option paints and clicks over whatever it covers.
- **A card's creator-and-channel row clears the card's own edge.** On a card whose creator has a bio or a social link, that row is the card's last one and carried no padding: it sat 1px from the bottom edge, inside the 12px corner radius, so the YouTube and Instagram icons read as cut off by the card. The row now owns the card's bottom and side padding — 14px beneath it, 16px inset to match the rest of the card's content.
- **The Plan Bench's transport modes stay readable at tablet widths.** From 721px to 1000px the calculator's two-up layout gives each mode button a quarter of the controls card, and the row's one flexible part — the name — was the first to give: at 768px all four modes ellipsized on a 78.7px button (Train rendered "T…"), while the icon beside the name was crushed from its 15px to 3px. The mode block now measures its own width instead of the viewport's and stacks the modes into one full-width column whenever a quarter-card cannot hold an icon, a name and a speed pill whole — nothing is dropped, so the speed badge and the label both survive — and an inline icon can no longer be the thing that squashes. Above 1000px the 2×2 grid is unchanged, and the Trip Settings tab's longer mode names (Motorcycle, Rental, Flight) are unaffected at every width.
- **The Timeline's day collapse moves as one gesture instead of a snap and a dribble.** Opening or folding a day ran on the app's decelerate easing, and a day body runs up to ~1000px tall: 24% of that height moved in the first 6ms (0 → 930px of 967 inside 45% of the duration) and the rest trailed off over 150ms, so the row appeared to pop and then creep. It now runs on a curve that starts and ends at rest, and a symmetric one rather than Material's asymmetric standard curve (new `--ease-resize` token — on the day's ~920px of travel the fastest frame carries 60px instead of 96px, with the same ~3px on the first frame), on the system's own large-surface duration (new `--motion-slower`, 560ms — reserved for travel measured in hundreds of px, as a day body is) rather than 240ms. Progress is felt in the middle of a long move, and both of those numbers live there: the rows below a folding day reached ~10.5px/ms at the curve's peak at 240ms, and duration is the only lever that reaches that — it is ~2.8px/ms now (47px inside a 60Hz frame), with nothing at all moving on the frame the click lands. The chevron turns on the same clock as the body instead of finishing ~90ms early. Nothing in the day header jumps while it runs: its items are top-aligned rather than centred, so the chevron and the Day badge no longer get re-positioned by a sibling's height (they moved up to 32px in the frame the click landed, before the body had moved a pixel), the collapsed-only route chain rides the same collapse as the body — growing in as the body folds away and folding away as the body opens, so the header's own height change glides with it instead of landing in one frame — and the extras that exist in only one state (per-day cost and dwell chips, the weather chip, the collapsed dwell chart) fade in on the shared entrance pattern rather than appearing at full size. The delay before a collapsed body is unmounted is read from the motion token instead of a hardcoded 280ms, so retiming the animation in CSS can no longer leave a half-collapsed day mounted.
- **The day collapse's controls hold up under a keyboard and a thumb.** Opening a day from its route line removed that line one animation later, and a browser drops focus to the document body the moment the focused element stops being visible — so a keyboard user's next Tab restarted at the top of the page instead of continuing inside the day they had just opened. Both clips now hand focus back to the day's collapse control as the close begins: that is the only moment that works, because the clip's inner wrapper goes `visibility: hidden` one animation before the unmount and a hidden element is blurred on the spot. The route line also wears the app's own focus ring — focused, it was the one control in the day header still painting Chromium's default `1px auto rgb(16,16,16)`, invisible against the dark card — and it carries the same `aria-expanded` state as the chevron, since both disclose the same body. On coarse pointers the 28px chevron joins the hit-area budget the rest of the app's compact controls already had: a 40px target, with the day badge 12px clear of it.
- **The sign-in screen's active tab is readable, and its errors land on the field they belong to.** The tab measured **1.08:1** in dark — its label kept `--text-3` because it never received the `.active` class the ink rules key on — and it now measures **7.24:1**. A validation error renders on its own field with `aria-invalid` and `aria-describedby` and takes focus, and a provider error takes focus so Tab stays inside the form. The collapsed combobox stopped pointing at a listbox id that does not exist until the popup mounts, which axe rates `aria-valid-attr-value` critical; it is gated on `open` now. The chrome's "Log in" / "Sign up free" pair is hidden on `#/auth`, where the card already offers both as tabs plus a submit — the accent had two owners on that screen, and two controls a screen apart both read "Log in".
- **Explore's filters stay in step with the URL.** Filter edits wrote the query with `replaceState`, which fires no `hashchange` and never enters React's route state, so a navigation that drops the query could not remount the page — searching and then clicking "Explore" left the box filtered while the URL claimed otherwise. One shared `filtersFromHash()` now feeds both the mount seed and a `hashchange` listener.
- **A toast no longer covers the mobile dock's call to action.** At ≤900px the dock is fixed to the same bottom edge as the toast zone and wins on z-index (200 against 55), so a toast landed on its CTA and swallowed the tap — measured on `#/new` at 320px: toast `818–882 × 14–291` over the CTA `818–864 × 171–280`, with `elementFromPoint` at the button's centre returning the toast's own span. The dock is the only way to commit on that surface, so this blocked the primary action for the toast's lifetime. A `--dock-h` token, set only where the dock actually paints, lifts the toast clear of it.
- **The onboarding surfaces hold up at phone width — contrast, measure, wrapping, motion and iOS zoom.** `--yf-text-muted` read 4.19:1 on `--yf-cream` and 4.36:1 on `--yf-surface` in light theme, both under AA at the 10.5-13.5px it paints (now 5.01:1 and 5.53:1), and the active mode-tile hint sat at 3.92:1 light and 4.41:1 dark; CreateTrip went from five failing contrast nodes to zero. The three `.unit-input` fields stayed 13px at 320px because a compact rule outranked the ≤720px 16px floor on both specificity and order, so iOS zoomed the page whenever one took focus — they are restated after the rule they override. Two blocks ran at 133ch and 145ch behind no cap (now 72ch), `h4` resolved to Sora 400, a weight the font link does not load, prose wraps with `text-wrap: pretty`, empty states and errors get staged entrances on the existing stagger and duration tokens, and `.save-heart` joins the one-press-scale / one-hover-lift rule it was the only control outside.
- **Two label-clipping fixes at phone width.** Filter selects stop crushing their labels at 320px — the mobile block zeroed the min-width that exists to keep them readable, so two shared a row at 120px each and "Any budget" clipped to "Any bu…" — and the trips search placeholder, which needed about 280px in a 240px box, no longer clips mid-word.
- **An orphaned `catalogTrips` reference from a clean auto-merge is cleaned up.** When PR #261's branch was rebased onto `test`, git merged `src/store/store.ts` cleanly because both sides edited it, but one side had deleted the `catalogTrips` query while the other added a loop iterating over it — the result referenced a variable that no longer existed. The import and its single use were dropped, restoring `npm run verify` without the need for an explicit typecheck step.
- **The remote-edit banner reaches the Board tab and survives a socket gap.** An M6 fix pushed directly to `test` so that the stale-update notification appears on the Board where decisions are edited alongside suggestions, and it persists across WebSocket reconnection gaps rather than vanishing silently when the connection drops.

### Docs
- **Creator-market research with citations** (`docs/commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md`): why travelers buy itineraries (time math, curation, error insurance), why creators strive (honest earnings base rates plus five non-income pitches), what should separate free from paid (a capability stack, not a page count), how the bought plan should be presented (unlock ceremony, owned library, endowment, share card), and the hub as a growth loop — every claim tagged by source strength with the sources listed, feeding Idea bank I-20…I-27 and the commercial plans' post-unlock items (E7/E8).

## [0.63.0] - 2026-09-20

### Added
- **The travel clock is drawn on the map as clean road labels.** No pins, no
  dots, no circles: each planned clock anchor (meal / overnight / destination)
  is a zero-size point ON the route flanked by two quiet text chips — its
  wall-clock time with the calendar date on the LEFT of the road ("4:03 PM ·
  18 Sep") and its road km on the RIGHT ("Km 500"), so a traveller reads when
  and how far at the exact point they belong to. Kind shows only as a whisper
  of colour on the time chip's leading edge, never a glyph.
- **Return-journey labels only appear with the Return home toggle.** Each label
  is tagged with its leg; the outbound half renders by default and the drive
  home's labels, its dashed line and its home anchor show only while the Return
  home chip is on — the going-home readings never clutter a map the traveller
  hasn't asked to see. The return leg is the honest #145 directed walk from the
  destination (matching the banner's day count), positioned back along the
  reversed road.
- **The suggestion engine's placed stops become distance labels.** Each placed
  place is projected onto the road at its cumulative km and labelled there with
  a "Km N" chip on the right, so the map shows the planned schedule (the
  clock's anchors) and the placed stops' distances on the same road.
- **🕐 Milestones toolbar chip** (default on) hides/shows the whole label layer;
  with it off the map is the plain route, and the choice is remembered per
  browser like the map key. Only the trip Map tab supplies it — the Board never
  shows milestones.
- **Planned-stop pins keep their itinerary arrival** — a tiny `13:40` chip
  under the pin while the milestone layer is on, with "~X km into the trip" in
  the tooltip (from the day-by-day journey simulation).
- **The map knows what day it is (the living plan).** Each label carries a
  `dayState` from the trip's own dates against the device calendar: the days
  already behind you dim to the same quiet whisper as the return leg, the day
  you're on now pulses gently on its time chip (frozen under
  `prefers-reduced-motion`), and the rest stays full plan. Return drives date
  from the trip's TAIL — the drive home occupies the last of the itinerary's
  days (drive out → stay → drive home), so the homecoming chip carries the
  trip's final date rather than the day after the outbound drive — and where
  no honest itinerary day exists (a walk split that runs past the plan, an
  undated call), the label claims no date at all. A trip fully in the
  past renders all-dimmed, a future trip all-full, and an undated trip claims
  neither — no `Date` objects cross the comparison, so a +5:30 calendar can't
  flip a day boundary at midnight.
- **Overnight halts name the town they land at.** Each halt label leads with
  the place the corridor search already found within 120 km of its km — the
  same honesty bound the halt planner itself uses — so the map answers "where
  do we sleep", not just "how far". The join is leg-aware: the corridor scan
  measured the outbound direction, so a drive-home halt is joined at its
  origin-scale position (its turnaround-relative km mirrored) — without that,
  a return halt hundreds of km along would borrow a town near the start.
  Nothing close enough means no name: a bare time and km, never a guess.
- **Tapping a halt opens that day's plan.** The overnight label is the one
  tappable mark on the route (generous hit area, focus ring, same visual as its
  decorative siblings): a tap switches to the Timeline, opens that day's
  accordion and brings its card into view. Only labels with an honest
  itinerary day behind them are tappable — the walk's return pass numbers its
  days past the itinerary's own, and a value no timeline day matches would
  collapse the whole accordion rather than open anything — and the request is
  consumed once handled, so a stale focus can neither re-fire on a later visit
  to the Timeline nor leak into the next trip's plan. Meals and the destination
  stay strictly non-interactive — only where you sleep is a decision.
- Pure module `src/lib/clockOverlay.ts` (`deriveClockMilestones`,
  `ClockMilestone`, `clockHM`) + 27 fixtures in `tests/clockOverlay.test.ts`.
- **The site has a crawl surface for the first time (SEO).** `/robots.txt` and `/sitemap.xml` both answered 404 in production, so there was no crawl guidance and no discovery path to any publication — and the only server-rendered URL (`/i/<id>`) had no inbound link at all, because the app links the hash route, which is a different URL. `public/robots.txt` now allows the app, disallows `/api/` (the target `/i/<id>` rewrites to, which would otherwise put every itinerary at a second URL) and `/mappls/` (an upstream API proxy, not content), and advertises the sitemap; the hash-routed screens are deliberately *not* disallowed, since a fragment never reaches the server and such a rule would be inert. `api/sitemap.js`, served at `/sitemap.xml` through a `vercel.json` rewrite, lists the shell plus every row in `published_itineraries` with `<lastmod>` from `refreshed_at ?? published_at`. An unreachable catalogue answers 503 rather than a valid-looking document listing only `/`, which would tell a crawler every publication had gone; `lastmod` is omitted rather than guessed when no timestamp parses. Sixteen tests in `tests/seo-discovery.test.ts` pin the robots rules, the rewrite pair, the `lastmod` preference and fallback, id validation, the empty and unreachable catalogue cases, XML escaping and the caching contract. Hash → path routing with server rendering is deliberately out of scope: it is the structural fix, it touches the router and every deep link, and it belongs in its own change.

### Changed
- **Presence session identities come from the platform's CSPRNG, not `Math.random()`.** The key is broadcast into the room, so it was never a secret — but it is the identity every peer keys a tab by, and two tabs minting the same value read as one avatar. `getRandomValues` is the source because, unlike `randomUUID`, it also resolves in an insecure context, so a plain-http LAN session keeps its own identity; a no-Web-Crypto last resort (a per-document counter plus a high-resolution clock) exists so the feature cannot throw where crypto is missing. `tests/presence.test.ts` pins 500 distinct keys, both branches, and the absence of the weak generator.
- **A pull request into `test` is verified before it merges, not after.** `ci.yml`'s `pull_request` trigger listed only `main`, which made `test` — the branch every feature integrates through — the one destination where a green check list proved nothing: a PR there ran Codacy and Vercel and no "Verify" job, while the gate waited for the merge to fire it as a `push to test`, after the point where a red tree can still be refused. `test` now sits in that trigger beside `main`, so the full gate (`tsc -b --clean` → tests → production build) runs on the pull request itself. The PR run checks out the merge ref and so duplicates the push run instead of replacing it; the duplication is deliberate, since it is what puts the verdict before the merge. `tests/ci-workflow.test.ts` pins the trigger: AGENTS.md §3.1 had described this gap for six days, and nothing failed while it was open.
- **The map's place rail loses its heaviest furniture without changing what it shows.** The whisker that sketches a candidate's detour drops to a 1.5px stroke at 35% opacity (from 2px at 55%) with its spur at 1.1px, so the notation reads as a note rather than a second route; the km label settles at 9.5px; and the card's own action buttons tighten to 12px on slimmer padding. The sticky tray at the foot of the rail stops floating — no shadow, the tighter radius, a softer border and a slightly smaller padding — and the in-card description chips and the add-a-stop gap action stop drawing boxes, becoming underlined links instead.

### Fixed
- **The map's clock labels and the Day Planner banner now come from ONE walk.**
  The label layer used to re-run the travel-clock engine from reconstructed
  inputs while the Map tab already held the identical verdict for its banner —
  two walks kept in step by discipline, where one forgotten input (a terrain
  profile, a party cap, a dinner anchor) would have let the map and the banner
  quietly disagree. The projection now consumes the banner's own verdict: a
  walk twice with identical inputs returning different labels is impossible by
  construction, not merely unlikely.
- **The drive home's distance chips no longer read the same as the outbound's.**
  A round trip showed "Km 500" twice — once 500 km from home, once 500 km from
  the destination — and only the hover tooltip said which. Return-leg chips now
  carry their own arrow (`Km 500 ↩`) against the outbound's plain `Km 500`:
  per-leg km kept (no renumbering), the ambiguity gone at a glance.
- **Audit batch on the map rails.** `map-day-chip` reaches the 40px touch floor on coarse pointers (desktop silhouette unchanged; toolbar gaps 5→8px); the scan status span announces via `aria-live`; clock glyphs carry `role="img"` labels instead of being `aria-hidden`-only; the detour-budget split is memoised instead of recomputed per render; `.board-col-day` drops the dangling `var(--text-1)` (deleted in the v0.53.0 scale sweep).
- **A public itinerary page renders for every publication shape.** The server-side read (`get_public_trip`) returns the whole trip for an unpriced publication, returns every day locked — instead of no page at all — when a priced publication lists no free days, and stubs locked days for everyone else. The stub's replacement text is typed for the database (`::text` into polymorphic `to_jsonb`) — without that cast the locked-day path failed for every visitor who had not unlocked the trip, while buyers and the creator kept working, their branch returning before the stub. The creator-sales RPC is signed-in only — an anonymous caller inherited Supabase's default EXECUTE and always received an empty list (`20260918_payments_security.sql`).
- **The Plan Bench's transport modes stay readable at tablet widths.** From 721px to 1000px the calculator's two-up layout gives each mode button a quarter of the controls card, and the row's one flexible part — the name — was the first to give: at 768px all four modes ellipsized on a 78.7px button (Train rendered "T…"), while the icon beside the name was crushed from its 15px to 3px. The mode block now measures its own width instead of the viewport's and stacks the modes into one full-width column whenever a quarter-card cannot hold an icon, a name and a speed pill whole — nothing is dropped, so the speed badge and the label both survive — and an inline icon can no longer be the thing that squashes. Above 1000px the 2×2 grid is unchanged, and the Trip Settings tab's longer mode names (Motorcycle, Rental, Flight) are unaffected at every width.
- **The Timeline's day collapse moves as one gesture instead of a snap and a dribble.** Opening or folding a day ran on the app's decelerate easing, and a day body runs up to ~1000px tall: 24% of that height moved in the first 6ms (0 → 930px of 967 inside 45% of the duration) and the rest trailed off over 150ms, so the row appeared to pop and then creep. It now runs on a curve that starts and ends at rest, and a symmetric one rather than Material's asymmetric standard curve (new `--ease-resize` token — on the day's ~920px of travel the fastest frame carries 60px instead of 96px, with the same ~3px on the first frame), on the system's own large-surface duration (new `--motion-slower`, 560ms — reserved for travel measured in hundreds of px, as a day body is) rather than 240ms. Progress is felt in the middle of a long move, and both of those numbers live there: the rows below a folding day reached ~10.5px/ms at the curve's peak at 240ms, and duration is the only lever that reaches that — it is ~2.8px/ms now (47px inside a 60Hz frame), with nothing at all moving on the frame the click lands. The chevron turns on the same clock as the body instead of finishing ~90ms early. Nothing in the day header jumps while it runs: its items are top-aligned rather than centred, so the chevron and the Day badge no longer get re-positioned by a sibling's height (they moved up to 32px in the frame the click landed, before the body had moved a pixel), the collapsed-only route chain rides the same collapse as the body — growing in as the body folds away and folding away as the body opens, so the header's own height change glides with it instead of landing in one frame — and the extras that exist in only one state (per-day cost and dwell chips, the weather chip, the collapsed dwell chart) fade in on the shared entrance pattern rather than appearing at full size. The delay before a collapsed body is unmounted is read from the motion token instead of a hardcoded 280ms, so retiming the animation in CSS can no longer leave a half-collapsed day mounted.

## [0.62.0] - 2026-09-19

**Scope.** M6 · Together's co-editing half (#237): the crew becomes visible while you plan, concurrent edits stop destroying each other, and split expenses get their first settlement affordance.

### Added
- **The crew is visible while you plan (M6 · Together, issue #237).** The trip workspace's header now shows who else is viewing the trip right now: a live avatar row beside the member list, each peer carrying a green presence dot and a tooltip with their name (hover and keyboard focus both reach it). Presence rides its own Supabase presence channel per trip — joins, refreshes, second tabs and sign-outs arrive as live state, one avatar per user even when the same person has two tabs open, and the room is left cleanly when the trip closes or the user signs out. Anonymous and public views never join; without a compiled backend the surface degrades to a quiet no-op. The integration harness now also proves presence against the live database (probe 13b): two clients join one trip's room, each must see the other and only the other, and an untrack must remove the session.
- **A stop someone else changed while you were editing it no longer overwrites silently (M6 · B3).** With the stop editor open, a remote edit to that same stop now surfaces a non-blocking banner inside the editor — "<name> edited this stop while you had it open" — with keep-mine and take-theirs actions; taking theirs re-seeds the form from the live version, keeping yours saves the draft as-is. Detection compares the stop snapshots canonically (jsonb reorders object keys in transit, so a naive string comparison would flag a phantom edit on every sync), and the banner announces politely without stealing focus mid-edit. The banner rides BOTH surfaces that open the editor — Timeline and Board — through one shared conflict hook (the Board previously edited stale data with no conflict surface at all), and the realtime channel refetches its cached trip rows on every re-join, so an edit that landed while the socket was down (laptop sleep, network switch) surfaces the same conflict instead of leaving an open editor silently stale until a reload.
- **Expense lines can be marked settled (M6 · B4).** The Budget tab's who-paid/who-owes card gains a settle-up strip: any open expense line can be marked settled with one click — the settler and timestamp are recorded, the line moves into a collapsed "settled" history where it can be reopened, and the action lands in the trip's activity feed. Settling applies to an expense LINE — it is a record of who squared that line up and when, not a change to the balances: the line stays in the running balances math (only the card's lists change), so the who-owes-whom numbers keep balancing against the trip estimate. The settled flag travels inside the trip's JSONB (no schema change), survives the itinerary export/import round-trip, and the balances/settlement arithmetic behind the card is extracted into a pure, unit-tested module.

### Fixed
- **Two tabs editing the same trip no longer bounce each other's writes back and forth (M6 · B2).** Realtime trip updates are now ordered against a server-clock ledger: a database trigger keeps `trips.updated_at` current on every update (`20260919_trip_touch_updated_at.sql` — apply in the Supabase SQL editor), and the realtime dispatch compares each incoming row against the last SERVER-applied timestamp it holds for that trip — never against the optimistic client clock a local edit bumps, which would suppress every real remote edit afterwards. A row strictly older than the ledger is ignored as a reconnect replay; equal timestamps apply, because before the trigger is applied `updated_at` never advances and equal is every remote update's normal case. The comparison is trips-only (no other table carries a comparable timestamp pair), and rows without a usable timestamp fall back to applying — the guard degrades to a no-op, never a blocker. The catalog contract test pins the trigger.
- **A pending local edit is no longer overwritten by a remote update racing the save window (M6 · B0).** Trip writes are debounced for 600 ms, and the flush used to re-read the cache at fire time: a collaborator's update landing inside that window was persisted OVER the local edit, which silently vanished. The coalescer now captures the edited snapshot at call time and persists exactly that — the local edit always reaches the database, and the remote state is never re-persisted over it.
- **Moving a stop to another day now saves.** The cross-day move edited the on-screen cache but skipped the database write on its success path, so the move vanished on the next reload; it now persists like every sibling mutation.

## [0.61.0] - 2026-09-18

**Scope.** Two tracks land together: the app's first real money — a priced publication can be
bought, with the paywall enforced at the wire rather than in the browser — and a versioned
itinerary file format that repairs an older export instead of refusing it. Behind them, the
crew-facing access rules are pinned by an opt-in suite that runs against the live database, and
the two public surfaces get a pass of their own.

### Added
- **The paid unlock is real (M7 · Premium, issue #238).** A publication priced by its creator can now actually be bought: the public itinerary page's Unlock button opens Razorpay's checkout, and on confirmation the buyer's entitlement is recorded server-side and the previously locked days render in full on the page and fork as real, editable days. The journey is signature-verified end to end — the price is read from the publication row server-side (a tampered request cannot change what is charged), the browser callback is confirmed by an HMAC check before any order is marked paid, and the unlock itself is granted only through a buyer-scoped RPC or the idempotent webhook, both of which a forged request cannot reach. A purchase confirmed but not saved (tab closed mid-verify) is recovered by Razorpay's webhook, which grants the same entitlement idempotently; reopening checkout re-serves the buyer's newest open order instead of minting a twin — and if that order was already captured at the gateway (a confirm or grant that failed silently), the next click finishes the grant, reporting success only once the entitlement has actually landed and returning an honest error that promises no second charge when recovery fails, never minting a fresh order for money already taken; and the free-preview and unlocked day views render through one shared stop renderer so a purchased day shows exactly what a free day shows. The fork honors the unlock too: a buyer (or the creator) forking the plan carries every day as a real, editable plan, while everyone else still forks the free preview with locked days as stubs. The creator hub's Earnings tab gains a real sales ledger (I-11): every unlock sold on the creator's publications lands in the Actual view with the amount the buyer actually paid at purchase time (the per-sale price snapshot, not the publication's current price), attributed per publication and dated — while the Projection view stays clearly-labeled not-money. Sales of publications since unpublished or deleted stay on the books; the ledger reads through a server-side RPC scoped to the logged-in creator's own publications, so it shows only their own revenue — and a failed ledger read renders a distinct error with a retry, never a silent "No sales yet". New tables `purchase_orders` (gateway state + per-sale price snapshot) and `entitlements` (one unlock per user per publication, unique-enforced, granted-at timestamp) — both read-only to clients through RLS, with the migration `20260918_payments_rail.sql` to apply live (buyer foreign keys reference `public.profiles`, whose id is the auth user id). The entitlement columns the client reads are pinned to the migration's columns by a contract test, so a read naming a column the table lacks (which PostgREST answers 400, silently degrading to "no entitlements") cannot ship. The backend stays dormant (503 with honest copy) until the Razorpay credentials are configured in Vercel; without them the page degrades to today's free-preview behavior.

- **The paywall holds at the wire, not in the browser.** Locked day content used to travel to every visitor in full — the trips table was publicly readable and the lock was only a CSS blur on the public page. A server-side RPC now returns the trip behind a publication with every paid day stubbed exactly as the free preview shows (titles kept for the teaser; descriptions, notes, times, costs and provider details stripped), and it decides from the caller's own session whether that caller is the creator or a buyer with a paid entitlement — the only ones who receive real days. Direct reads of trip rows now require membership, and a priced publication's trip can no longer leak in full through the invite-link capability. A refund now revokes the buyer's unlock, the creator's ledger keeps its sales when a buyer account is deleted, publishing refuses prices the checkout cannot charge (outside ₹1–₹1,00,000), and when the gateway's state of an earlier attempt cannot be verified, checkout says so and stops instead of minting a fresh order for money possibly already taken.

- **An itinerary JSON now says what format it is, and an older file is repaired instead of rejected.** An export declares the shape it was written for (`formatVersion`, currently 2) with `exportedAt` and the app build beside it for diagnosis. The importer reads that version, walks the migration chain up to the current shape, then normalizes what the format allows to vary — stop order to the app's 1-based numbering, a day's `index` to its position, missing optional numbers to their honest defaults, duplicate ids re-issued, the date range reconciled against the plan's day count — and reports every intervention as one readable line ("Imported with 6 changes — 3 stops renumbered, 2 dropped for a missing location, 1 version upgrade"). A file written by a *newer* build is refused with the reason rather than half-read; a file that carries no version is read as the original shape; a snapshot-link payload and a dashboard's published-itinerary row are each named as what they are.
- **The JSON toolchain is one rule set with a strict offline twin, and a scaffolder for new shelf files.** `lib/itinerarySpec.ts` holds the shared contract — the key allowlists, the one coordinate rule, the migration chain and the normalizer — and both the app's importer and its exporter sit on it; `scripts/validate-itinerary.mjs` is the strict gate that authored gallery files must pass; `scripts/new-itinerary.mjs` scaffolds a new shelf file from the reference skeleton, geocodes the places handed to it, confines its write target to the shelf directory and validates the result; `scripts/geocode-places.mjs` is the single geocoder the authoring tools share.

### Changed
- **A downloaded trip JSON carries the trip's publish details as well.** The file is now an envelope (`formatVersion`, `exportedAt`, `app`) around the trip, and a trip that has a publication keeps its shelf metadata in a `publication` block — filtered to the fields the contract defines, so counters and timestamps never travel into an archived file.
- **Pins that share a place fan out instead of hiding each other.** Stops legitimately sitting within a few hundred metres (a meal at the place you sleep, two venues in one complex) are drawn in a small ring rather than one pin on top of another, so each stop stays readable and clickable — user-created trips included.

### Security
- **The trip-trash policy is restrictive again: every live trip had been readable by every signed-in user, and tombstones now stop at the owner team.** The Sep-14 trash repair had dropped the `trips read hide trashed` policy's RESTRICTIVE flag and left a bare `deleted_at is null` OR-clause. Permissive policies OR-combine, so that clause let any authenticated user read any *live* trip (private ones included) — and without the flag the policy could not hide tombstones at all, since the base read admits the whole crew. Restored as `as restrictive` (it ANDs with the base read): live rows pass exactly where `trips read` admits them, tombstones reach only the owner team (owner + editors) plus the admin console, and the owner/editor clauses keep the tombstone UPDATE's added-row check green — with no accepter for the updated row the update fails 42501 and "Delete" silently no-ops, the reason those clauses were added. Found live by the new integration harness: the "non-member cannot see a private trip" probe failed against the real database while catalog-only checks stayed green, because the escape-hatch tokens all lived in the same qual. Applied by `supabase/migrations/20260917_pin_trashed_read.sql`; `supabase/tests/rls_contract.test.sql` now pins the invariant mechanically — a live-row branch may only sit on a RESTRICTIVE policy — and the harness reads a tombstone back as both the owner (sees it) and a plain member (does not).
- **The crew-facing RLS shape is now enforced by tests, not intent.** Two layers landed as part of M6 (#237): `supabase/tests/rls_contract.test.sql` — catalog-level assertions over the management plane (policies, SECURITY DEFINER functions, ACL reachability, realtime publication membership) runnable in the dashboard SQL editor — and `scripts/integration/integrationHarness.mjs` — an opt-in (`VITE_RUN_INTEGRATION=1 npm run test:integration`) behavioral suite with two throwaway test users that proves cross-user privacy, self-serve join, the editor gate, recipient-only notifications, public gallery reads, tombstone visibility and realtime round-trips against the live database, with run-id isolation and a printed teardown ledger.

### Fixed
- **An imported itinerary no longer draws fewer map markers than it has stops.** The shelf files were authored with different places sharing a single town coordinate — one Gulmarg day had four stops on one point — so the map drew one pin where the timeline listed several, and the drawn route appeared to arrive at an unmarked spot. Every coordinate in those files was *valid*, which is why neither gate had ever looked: the defect lives in the relationship between two values, not in either one. The validator now rejects a coordinate carrying more than two stops unless one of them is the meal or the night (and prints the offending cluster with its titles), the six shelf files were re-geocoded place by place (32 pins), and the importer warns when a file it is handed has the same problem.
- **`orderInDay` is 1-based everywhere, as the app itself writes it.** The import spec said 0-based while `createTrip`, `addStop`, the Board and the Timeline all number stops from 1. Sorting hides the disagreement — both orders sort the same way — so nothing broke, but a file could be authored to a rule the app does not use, and a `0` is falsy where presence is tested. The importer now renumbers any base to 1..n and the validator requires the convention.
- **A trip JSON that declares only its version no longer reports a field nothing reads.** The version tag is file metadata, not a trip field: reading it as one made a perfectly correct file warn about an unknown key.
- **Optimise day no longer moves where you sleep — so it no longer moves where tomorrow starts.** The optimiser pinned only the engine's own waypoints (`auto: true`), which meant a stored night's base was fair game on every hand-built and every imported day. Because a day ends at its last stored stop and the next day's route begins from there, re-ordering the night's base silently rewrote the following morning: measured across the six shelf itineraries, **21 of 32 optimisable days had their last stop replaced, 18 of those the night's base, and 14 day-pairs shifted the next day's wake-up point — worst 16.3 km** (goa: sleep in Candolim, plan the third morning from the Basilica). A `hotel` or `rest` stop at the day's tail is now pinned exactly like an anchor; a base that sits mid-day is left where the author put it, since that is a legitimate overnight. On the same files the wake-up error is now **0 km**, the three tail stops that still move are ordinary stops, and Optimise still tidies 16 of 32 days — the day's endpoint is simply no longer part of the trade.

**A shared itinerary stops shipping an oversized cover, stops printing its own content twice, and the gallery stops featuring an itinerary it cannot vouch for — or showing the same plan twice.** Labels stop promising what they cannot do: Fork now says it needs an account, and a page that will not load — public itinerary, invite link or snapshot — no longer names a cause it cannot know. The itinerary page also states which of its days are held back from its own data, and its hero text no longer depends on whichever photo the creator uploaded. **A row of cards is now laid out by the grid it sits in** — peers share one top and one height, the itinerary page's floating evidence card stops being half-clipped, two supporting cards stop being uneven, and the shelf's hover lift works again.

- **A cover the owner set is sized like one the app picks for itself.** The v0.58.0 cover-sizing change reached only the images the app chooses on its own, so a publication whose cover came from its owner rendered the raw upload: one live itinerary served a 1,305 KB (2496×1664) hero while the same page load requested its auto-picked covers at the supported width. Every surface that renders or writes a cover — the public hero, the shared trip card, and the owner's cover control — now routes a Wikimedia URL through `Special:Redirect/file?width=1200` (the same image measured 147 KB, a 9× reduction) and leaves a URL the owner pasted untouched. Rows written before this are corrected as they render, so no backfill is needed.
- **The public itinerary page no longer says the same thing twice.** The tagline appeared in the hero and again under "Why this route works"; the author's travel tips appeared both as a "Route philosophy" list and as the "Travel tips" card; and the day count, distance and road time were stated three times. The tagline and the tips now have one home each, and the route-at-a-glance line carries only the fact the hero does not already state.
- **The trip-highlights block uses the class its stylesheet defines again.** A rename had left that section on `.pub-highlightsN` while the stylesheet styles `.pub-highlights`, so it rendered without its spacing.
- **The invite and snapshot gates no longer diagnose a failure they cannot see.** Both resolvers log the error and hand back `null`, so a mistyped code, a rotated code, a refused lookup and a dropped connection all arrive looking identical — and both screens named the link as the culprit and prescribed one remedy ("ask for a fresh link"). They now say what they observed and name the possibilities without choosing between them, and the invite screen adds a **Try again** that re-runs the lookup, since a dropped connection is one of the real causes and the only remedy that costs nothing. The join-failure toast, which blamed a stale link for what is just as often a permission refusal, went with them.
- **The hero's text stays readable over any cover a creator uploads.** `.pub-hero-photo` renders a creator's image at 42 % opacity behind the kicker, title, story and byline with nothing bounding how bright it can be — a light cover (a tan Ladakh landscape is one live example) pulls that text toward 3:1. A flat scrim now covers the text zone above the photo, and `tests/hero-contrast.test.ts` pins the guarantee from the stylesheet itself: every hero text colour must clear 4.5:1 against the scrim composited over a **pure white** photo, which is brighter than any real one. The previous bottom-anchored scrims stay for the stats card, where they never reached the text.
- **The public page no longer diagnoses a page it could not load.** A removed itinerary and a failed fetch both arrive as `null`, and the empty state asserted the second — "This public page may have been unpublished" — so a visitor whose connection had dropped, or whose link had a typo, was told the creator had taken the trip down. It now says what it observed and names the possibilities without choosing between them. The same guess in the fork path's error toast went with it.
- **The featured itinerary no longer appears a second time in the grid below it.** Featured is chosen from every published trip while the grid renders the filtered, sorted list, so the most-forked plan led the page and then came back as an ordinary card — on a three-itinerary shelf, that was a third of the page spent repeating itself. The grid, its paging and its "Load more" count now run on the filtered list minus the featured pick, and the grid is skipped altogether when the featured card was the entire result (so no empty row, and no "nothing matches those filters" on a filter that did match). The same pass made the featured block's other claim an earned one: "outside your filters" keyed off *any* filter being active, so filtering to adventure labelled the one adventure itinerary as sitting outside the filters.
- **Card grids are laid out by the grid, not by the stacked-card rule.** `.card + .card { margin-top: 14px }` — the beat between two cards in a column — also matched grid items, so every card after the first in a row rendered 14px lower *and* 14px shorter than the card beside it: measured on the live shelf at tops 839/853 and heights 477/463, with 26px of space where the grid declared 12. The Explore grid, the creator page, My Trips, the public page's Travel-tips / Warnings row and the landing page's feature strip — every grid that holds a card, found by sweeping each reachable route — all zero that margin now, and the single-column phone layout — where the same rule produced the only visible symptom, one 26px gap among 12px ones — is corrected by the same rule.
- **Two peer cards are equal halves again.** The itinerary page's Travel-tips / Warnings row is a two-column grid nested inside the 782px content column, so its right-hand column kept the 340px sidebar width and the two cards came out 424 and 340 wide instead of matching. A `.two-col--even` variant gives peer content equal halves and still collapses with every other `two-col` below 980px.
- **The itinerary page's evidence card is no longer cut in half.** `.pub-hero` clips its children, and "The practical bit" was positioned to hang 66px past the hero's bottom edge — exactly those pixels were never painted, so the card measured 507→720 against a clip at 654, lost its bottom corners, and its last two rows ("28h 09m on the road", "10 days") hit-tested straight through to the Save and Fork buttons underneath. The card now sits fully inside the hero, 16px clear of its edge, with the reserve above it grown to match; the hero's title, story and byline are capped at mid widths so the card's column cannot meet the text at any width above the phone breakpoint.
- **A shelf card's hover lift works again.** `.trip-enter`'s entrance ran with `fill-mode: both`, which retains the animation's closing `transform: none` and outranks a `:hover` declaration — so a grid card answered a pointer with a shadow change and no movement, while the very same component on a creator page (which passes no `enterIndex`, so it never animates) lifted as intended. The entrance now fills backwards and releases the transform when it ends.

## [0.60.0] - 2026-09-18

**Scope.** A whole-app refinement pass — the shell, all eight workspace tabs, the creation and
editing flows, the discovery and creator surfaces, the marketing pages and the admin console,
reviewed route by route and worked to the project's own design language. Presentation, semantics,
motion and measured contrast only: no token value changed and no surface was redesigned. The
design-system ratchet falls from `9 / 11 / 32 / 30 / 1` to `7 / 0 / 28 / 29 / 1` — the dark theme
has no known contrast violation left.

### Fixed
- **A rejected profile save now takes you to the field it is complaining about.** "Save profile" sits well below Your details, so clearing the display name and saving put its error message in a card the button had scrolled away from — the click looked like it had done nothing at all. The message was always announced to a screen reader; the page now also scrolls to and focuses the field, so the reason is visible where the fix goes. Same pattern the stop editor already used.
- **The map's numbered pin badges and its quick-add button are readable in dark mode.** Both painted a hard white against ink that inverts in dark mode, so the pin numeral measured 1.13:1 and the quick-add glyph 2.05:1 — effectively invisible. Each now draws through the surface/foreground tokens, which resolve correctly in both themes. These were two of the frozen contrast entries, not approved ones.
- **The board's peek motion glides again.** Map-focus mode moved a column by transform, but the theme cross-fade rule re-declared `.board-col`'s whole transition list later in the file and a shorthand replaces rather than merges — so the movement snapped while everything else on the board eased. The column now declares all four properties itself, on the shared motion token instead of a raw 500ms.
- **A viewer can no longer type into trip settings.** The starting-point and destination searches had no permission gate, so a viewer could edit the route and then find they could not save it. Both are locked for non-editors the way the rest of the form already was.
- **Keyboard users can operate the map's idea cards again.** The card row handled every Enter and Space that bubbled up from it and called preventDefault, so the shortlist, reason filter and Add controls inside it could not be activated by keyboard at all. The row now only claims keys aimed at itself.
- **A long stop name can wrap in the day's route chain.** The chain wrapped between names, but each name was pinned to one line, so a single long one pushed the row instead of breaking.
- **Roles, statuses and categories read properly, and one role can no longer be changed without permission.** Member roles rendered as raw lowercase values ("editor") and the shared capitaliser was bypassed in three places; both now go through the one display helper the rest of the app uses. Separately, "Unpublish" was offered to anyone who could see a published trip and always announced success, though the store refuses non-owners — it is now owner-only and the refusal can no longer be masked by a toast. Also on this pass: warning notes use the deepened warning ink rather than a mid amber that fails as text, the board's numeric metadata lines up on tabular figures, and the phone bottom sheet keeps the dynamic-viewport cap it had just been given (a later rule was overriding it back to `vh`).
- **Decorative motion stops when you cannot see it.** The landing's route vignette, the map's rotating engine tips and the Plan Bench's drifting blobs, badge ping and call-to-action sheen all kept running while scrolled out of view and while the tab was in the background — frames spent on something nobody was looking at, on the surfaces most likely to be left open in a background tab. Each now pauses when it leaves the viewport or the document is hidden, and picks up where it left off.
- **Reduced motion removes the staggers and the sheen.** The global rule froze animation and transition *durations* but never their *delays*, so staggered entrances still waited their turn to appear, and the budget and per-day bar sheens survived as a frozen white streak parked on every bar. Delays are cleared now and the sheen layer is removed outright. The "jump to this idea" flash deliberately keeps its feedback as a static ring rather than losing it.
- **A field row animates at one speed, and movement eases like movement.** A text input and the select beside it in the same row were easing at different speeds (120ms against 180ms); the glider, the drag carry, the board's drop settle and the popups now share the app's glide curve instead of the generic one. The board's cards also stopped losing their border and background transitions to a later rule, which had left a card snapping while the zone beside it eased.
- **The selected travel-style filter looks selected again.** On Explore and in the My Trips toolbar the glass chip style and the selected style had the same specificity, and the glass one came later — so it won every property and an active filter was pixel-identical to an inactive one. The selected pair now carries its own rule, the way the saffron "Saved" chip already did.
- **A viewer can tell which settings are locked.** The transport-mode grid, the traveller buttons and the pace dial kept full opacity, a pointer cursor and their hover lift while disabled, so a viewer saw an editable form that silently ignored every press. They now dim and stop responding, keeping a locked-but-selected option showing the state it is locked to.
- **A rejected source link says why.** A stop's "Source link" field validated the URL, marked the field invalid and then showed nothing — the error text was computed but never rendered, so a link without http:// was refused with no explanation. The message now appears on the field, and the shared field wrapper no longer erases an invalid flag a control set for itself.
- **Two more small mismatches.** A disabled select no longer lights its border on hover, and the share screen's role picker is included in the phone-size rule that keeps iOS from zooming the page when a control is focused.
- **The map's shortlist tray no longer hides under the Android bottom bar.** The trip workspace's POI tray — "Add all", "Send to a vote", "Clear" — was the one page-level bottom element that positioned itself with a hardcoded 12px rather than the shared bottom offset, so in the shell the fixed bar sat on top of its actions and on the web it sat inside the gesture strip. It now clears the same offset the trip dock uses.
- **An open field dropdown no longer covers "Save settings".** The settings form's sticky save bar sat on a raw z-index of 5, while the blocks that can spawn a floating surface — the location dropdown, the date calendar — sit on the nav-glass rung, so a popup opened near the bottom of the page painted over the primary action. The bar now shares that rung and wins on document order, being the form's last child.
- **The expanded map and scroll landings clear the gesture bar.** The full-screen map paints above the bottom nav, so it owns the real bottom edge and has to clear the system gesture strip itself — anything pinned to the map's bottom edge, the legend included, sat inside it. Scroll-into-view and focus landings now respect the bottom offset on the web too, instead of only inside the shell.
- **A success and an error toast no longer look the same in dark mode.** The dark theme's blanket toast rule tied on specificity with the success/error rules and came later, so it won every time: in dark mode each toast rendered as the same neutral pill and the two outcomes became indistinguishable at a glance. The semantic pairs now declare their own dark treatment, keeping their fills and taking the dark ink this codebase already uses wherever a lightened teal carries text — 7.9:1 on the success fill and 5.1:1 on the error fill, against 2.05:1 and 3.22:1 for white.
- **A toast now waits while you read it.** Each notification ran on a fixed timer that nothing could pause, so the undo affordance — the only way back from a destructive action — could expire while the pointer was already on its way to it. Pointing at the stack or tabbing into it now holds every countdown and resumes each one where it stopped; a toast that arrives while you are already holding the stack no longer starts a clock you cannot see running.
- **A dialog on a phone clears the home indicator and the browser's toolbar.** Below 640px the modal is a bottom sheet, and two device facts were ignored: its height was measured against a viewport the mobile toolbar still occupies, and its fixed padding put the last control inside the home-indicator strip. The sheet now sizes to the dynamic viewport unit and pads by the device's bottom inset — the same pairing the map shell, the header tray and the drawer's own input row already use. Desktop is unaffected, since both insets resolve to zero.
- **The phone menu's last row stays reachable.** The header tray hangs from the pill and grew with its item count, so on a short viewport — a phone in landscape, a small desktop window — the final row (Profile & settings) sat behind the browser's own toolbar with nothing to scroll. It is now capped to the space actually left beneath the pill and scrolls inside itself, with the dynamic viewport unit taking over from `vh` where the browser supports it.
- **The Plan Bench fits a 360px phone, and a long call-to-action no longer runs off the screen.** Buttons keep their labels on one line by design, but that made a sentence-length label's *minimum* width the whole label — and the floor then propagated through every flex or grid ancestor whose item is `min-width: auto`. Two surfaces paid for it: the landing's "Create a free account — demo trips included" measured 400px inside a 316px band at a 390px viewport, and the receipt's call-to-action floored the Plan Bench grid at 366px inside a 360px viewport, taking the calculator's controls and receipt off a common Android width. Buttons at the `lg` size — the size that carries a sentence — can now wrap; word-pair pills are unchanged.
- **A phone no longer scrolls sideways on the planning screens.** The shared two-column layout collapsed to a single `1fr` track, whose implicit `min-width: auto` let any child with intrinsic width — a nowrap label, the expense table, a chip row — push the track wider than the page. Group input, Budget and the public itinerary each rendered past the right edge (measured at 390px: 481px, 420px and 537px of document against a 390px viewport), which put their right-hand controls and figures out of reach. The track is now `minmax(0, 1fr)` with `min-width: 0` on its items.
- **The Timeline's move up/down buttons actually move the stop.** Every stop's up/down arrow was inert: the reorder hook fed the drag path and the button path through one callback, and the timeline resolved the destination from the live drag insertion slot, which is empty when no drag is running — so both arrows resolved to a no-op. The two contracts are now distinct (`ReorderSource`), a button carrying its own destination and a drop still reading the insertion slot, and the regression is pinned by six tests.
- **Every date in the trip calendar is clickable on a phone.** The calendar popup was raised to the floating-chrome rung but its host block still declared `z-index: 2`; because that block is positioned, it owns a stacking context, so the popup's own rung never applied and the whole calendar painted under the fixed bottom dock. The host now sits on the floating-chrome rung, so the popup and the location dropdown beside it clear the dock. The same block-level rule had hidden the location dropdown.
- **The landing header fits the smallest phones.** Brand, control tray, "Log in" and "Sign up free" needed 392.8px in a 346px header at 390px, so the signup button rendered past the right edge. The wordmark now yields below 440px — the mark keeps the identity and the link's own accessible name keeps the product name — while both auth actions stay visible at their 44px targets, and the tightest supported width (320px) reclaims the last pixels from padding rather than from the target.
- **A trip card's emoji cover stays in its cover box.** The shared fallback is absolutely positioned, but only the wide cover variant established a containing block, so on the My Trips cards the emoji escaped its box and painted over the trip title. Every cover variant now establishes the containing block and clips.
- **A single day's route no longer appears to stop in the middle of nowhere.** The line drawn for a selected day follows the engine's planned ride, which can open at the previous night's place and end at a synthesized destination — the ride home, or the next planned stop — while the pins come only from that day's stored stops. An end of the line could therefore sit on a spot with no marker at all and read as a truncated route. Those synthesized ends now carry their own plane/flag pin, labelled with the place they stand for, and are suppressed when a real stop already covers the same spot (the engine's own 1 km "same place" rule).
- **"Needs you" links, cross-day drag and the folded place rail work again.** Three interaction gaps on the trip workspace: a digest row whose card was filtered out did nothing when clicked (the request now parks, the filter switches to "all", and the card is scrolled to, focused and flashed); a stop could not be dragged to another day while the accordion held one day open (the persistent day header now accepts the drop, empty days have an end zone, and Move-to-day stays the keyboard route); and folding the map's place rail sprang back to the full desktop grid on a narrow screen, because the narrow-width reset was declared after the folded rule at equal specificity.
- **A place lookup can no longer overwrite the stop you are editing.** A slow lookup could land after a newer edit and replace it, and "Find real spots" could restore halts the user had removed mid-search; both now own their requests and discard a stale answer. The board's drag settles the same way — a settle animation that outlived a re-grabbed card could keep driving it, so the handles are retained and cancelled.
- **Timeline rows that failed contrast in the light theme are legible.** A mixed day, a rejected stop's metadata, a collapsed stay and a foreign leg measured 1.8–3.6:1 against their surfaces; all four now use the deepened inks and drop the whole-content opacity that caused it, with a rejected stop keeping a dashed border cue so its status still reads.
- **The times the timeline computes for you are no longer hidden from a screen reader.** Arrival and departure figures carried `aria-hidden` along with the decorative rail beside them; the times are now labelled text and only the rail is hidden, with the narrow-width departure keeping its own accessible equivalent.
- **The expense table and the creator ledgers can be scrolled by keyboard.** All three scrolled horizontally with nothing focusable to scroll them by — an axe `scrollable-region-focusable` failure that made a five-column table unreachable — and the administration console's six tables had the same gap. Each is now a focusable, named scroll region with the shared focus ring.
- **Controls on the map, the trip cards and the Trash screen meet the app's 40px touch floor.** The POI rail's controls, the save heart, the calendar's month arrows, several map-rail buttons and Trash's Restore and Delete forever were all below it, the last two rendering at the compact size meant for a secondary control. Alongside, the idea-pin and live-location pulses and the budget bars now pause when they are offscreen or in a hidden tab.
- **Budget and Group input gain the panel heading their neighbouring tabs already had**, and Share's Free and Premium choices are announced with their visible labels rather than by tone alone.
- **Overview's stat cluster regains the separation its neighbouring cards use**, and the briefing header follows the Timeline's recipe instead of drifting from it.
- **The decision guide's copy control and the Trip Ticket's fuel and budget rows use the drawn icon set rather than emoji.**
- **The demo-trips button keeps its name on a phone, and a trip card's focus ring follows the card's own corner.** The button's label was hidden below 720px with a `title` that is not an accessible name, and the card's stretched link carried a radius that left the focus ring sitting inside the card's corners.
- **The date field announces what it is, and the ticket's route line can be read in full.** The date trigger had no accessible name at all — the shared field wrapper cannot associate a label with a `div` — and the ticket's route line ellipsised a long stop name with no other surface showing it. A travel leg's four columns also stop being hard-coded inline, so they respond to the sheet's width like every other row.
- **Explore's filters fit a phone in two rows instead of three,** a long itinerary name on the featured card stops crowding its tagline, the save heart meets the touch floor, and a card's metadata steps down to the metadata size instead of matching the tagline beside it.
- **A creator's social links are checked before they are saved.** The YouTube and Instagram fields are `type="url"` but sit outside a form, so the browser never validated them: any string was saved, toasted as success, and later published as a live `href`. A value that is not an http/https URL now raises an inline error on the field, does not save, and does not claim success.
- **The creator surfaces' heading outline reads in order.** The hub skipped from `h1` to `h3`, the public creator page had no `h2` at all, and the admin console's Growth section did the same.
- **The public itinerary's cover image reserves its space while it loads,** so the page's largest element cannot shift the article as it arrives.
- **The destination strip stops scrolling when nobody is looking.** It was the last of the app's decorative loops still running while scrolled out of view or in a background tab.
- **The Plan Bench's "Surprise me" action and its selected transport tile clear AA in the light theme.** They measured 3.92:1 and ~3.75:1 on washed and translucent fills the contrast gate cannot see, and now take the deepened warning ink and the tile's own fill respectively.
- **The sign-in panel is announced correctly.** The form carried `role="tabpanel"`, which is not permitted on a `<form>` element, so the panel semantics were ignored; the role and the id the tablist points at now sit on the wrapper.
- **The administration console's tables are named and can be scrolled by keyboard** — deliberately without a `role` override, which would have replaced the implicit table role and stripped row and cell semantics from every one of them.
- **The printed sheet no longer drops half a day's warnings.** It attributed a warning to a day by requiring a colon after the day number, and only five of the ten day-scoped warning titles have one — so "Day 3 is over-packed", "is busy", "ends very late", "runs past plan" and "is weather-dependent" appeared on screen but never reached paper. All ten now attribute, and the sheet's expenses table gains the header row that labels its columns.
- **The installed app's live-trip thumbnail is legible in the light theme.** It painted white on the mid-teal whose dark value had already been corrected while light was left alone; it now uses the semantic pair the rest of the app's primary surfaces use, and the redundant dark-only rule and its stale comment go with it.
- **The AI drawer holds its focus, locks the page behind it, and keeps the transcript in view.** The drawer declares `aria-modal` and traps Tab but never locked the page, so content stayed scrollable while assistive technology was told the rest of the page was inert. Its focus timer was re-armed on every parent render — enough to pull focus back to the composer 300 ms after the user had tabbed to a prompt chip — the composer no longer loses focus after every send, the header takes the top safe-area inset, each message carries an off-screen speaker prefix so a linearised transcript is attributed, and the transcript scrolls to the newest message when it reopens.
- **The impact preview's verdicts clear AA in the light theme, and the sheet fits a phone.** Both verdict inks sat on the soft cell fill at 3.67:1 and 4.36:1; they now resolve to the deepened inks in light while dark keeps the values it already passed. The sheet had no height cap and clipped from above the viewport on a phone with no scroll path to its warning list, and it rendered before the panel it describes — so after editing a timeline row, Tab had to walk the whole workspace to reach Keep or Remove. Its six markers now use the icon set, a saving no longer renders as "₹-500" or a tiny delta as "₹-0", the always-mounted print copy no longer sits in the accessibility tree as a second itinerary, and two further dark-theme contrasts are fixed — a drag bubble at 3.34:1 and a route action's hover at 4.09:1.
- **Three claims that outran the product are corrected.** "Free forever" was a pricing commitment the roadmap is actively working to change, so the landing fine print and the sign-up subtitle say "Free to plan". Profile's "everything is stored locally in your browser" contradicted the app's own data layer — trips, votes, decisions and publications follow you between devices while only display preferences stay on this one — and now says so. And the creator badge read "Verified creator", which the self-service enable flow does not establish; it reads "Creator", which is what the badge on the creator's public page already said.

### Changed
- **The gallery features an itinerary only when it can say why.** The featured block printed its evidence even when the evidence was zero ("0 forks · 13 views"), and two publications that scored equally could swap places on load order. Leading the page now takes a fork or 25 views, the credibility line leads with forks when there are any and views otherwise, and the order is decided by copies, then views, then publication date. On a shelf with nothing yet worth boasting about, the block does not appear. The hero line that claimed plans "from travellers who actually went" was cut back to what the catalogue can support.
- **The public itinerary page no longer offers a purchase it cannot complete.** "Unlock Premium" sat on the page in two places while no payment rail exists, and the only possible response was a notice that payments are not live. The price stays visible as a label — on the locked days and in the sidebar — and the copy says the later days are preview-only until paid unlock ships.
- **The gallery says what Fork means.** "Fork any itinerary to copy it into your own trips — then change whatever you like" now sits above the cards, before the first button that carries the word.
- **The itinerary page states which days are held back from the publication's own data.** The premium line promised that "the later days stay preview-only", which is only true when the creator marked the *tail* as free — on a live ₹500 publication the withheld days were 5–8 while days 9 and 10 stayed readable, so a reader who scrolled past the locks found the page contradicting itself. The sentence is now derived from `freeDayIndexes` (`lib/previewSplit.ts`), including the free/total count, and says nothing at all when a publication withholds no days.
- **Fork says it needs an account, before the click.** Signed out, every Fork button navigated straight to the sign-up form while its label promised an in-place copy, so the click read as a broken button — and the toast that explained it was swallowed by the redirect that followed. The shared trip card, the featured block and both buttons on the public page now read "Log in to fork" when nobody is signed in, and Explore states the requirement once, above the cards. Signed in, nothing changes.
- **One micro-label recipe.** Five uppercase labels on the itinerary page rendered at two different sizes and two different trackings — the hero badge (11px / 800 / .1em), the hero byline (12.5px / 800 / .08em), and three that already rode the kicker recipe. All five now take the documented recipe (10.5px / 700 / .06em, uppercase applied in CSS), which also retires a badge-shaped one-off that badge peers like the bench and creator badges never had. The day-highlight kicker stops shouting in JSX, where it typed capitals over a transform CSS was already applying, and duplicated the kind chip printed beside it. The map rail's own two label classes join the same list, having carried their own declarations — one of them with no weight at all, so a reason label and a group label of the same role rendered side by side at 400 and 700; they now set colour and nothing else, and a guardrail keeps them from re-declaring the recipe.
- **One vertical rhythm on the Explore gallery.** The page separated its own blocks with four different gaps in a row (10, 14, 20 and 22px for gloss → chips → filter bar → featured → grid) and its cards carried off-ladder interiors (15/17/17 padding with a 9px gap above a 10/17/15 footer). The small gaps are now 12px within the filter group, the section beat stays the 22px the itinerary page's featured card, action bar, day sections and highlights already share, and the card interior lands on the ladder — 16px padding, an 8px gap and a 12/16/16 footer that still lines up with the body text above it. The three controls layered on a card's cover (style chip, route line, save heart) share one 12px inset instead of three different ones, the 30px paper-sheet radius joins the documented 12/18/24 ladder, and the featured title takes the same section-title ramp as the itinerary page's own section titles rather than a 2px-different one. That rhythm is now **enforced** rather than described: `DESIGN_TOKENS.md`'s `--s-1…--s-8` scale was deleted in SYS-2 on the grounds that nothing routed through it, which left 76 off-ladder values in use across the app and nothing to stop the next one joining them. `tests/design-system.test.ts` freezes exactly that set — keyed by `property: value`, so a CSS edit that only moves lines cannot force a re-baseline the way the contrast and duration gates can — and fails the build on a new off-ladder gap, margin or padding. The set may only shrink.

## [0.59.1] - 2026-09-17

**A route no longer stops short of where it is going.** The corridor measurement handed one leg its neighbour's result, so the drawn line ended early — and cached the wrong road under that leg's key.

### Fixed
- **A map route no longer stops short of where it is going.** The routing layer measures a corridor as a single span request, but assigned that span's legs by their position among the *uncached* legs instead of their position within the span. Whenever a cached leg sat between two uncached ones — the normal case, because the leg cache is deliberately shared between the whole-trip chain and each day's ride — the last leg received its neighbour's geometry and was cached under its neighbour's key, so the drawn line ended early and every later measurement of that leg was served the wrong road. Each leg now takes its own span result and is cached under its own key (`lib/routing.ts`).

## [0.59.0] - 2026-09-17

**The map measures a corridor in one go instead of making you wait for every leg.** Copied public itinerary addresses also keep their trip-specific previews, with navigation that works in any tab.

### Changed
- **The map's road lines draw as one road-measurement per corridor, not one request per leg.** `routePath` used to fire N−1 sequential OSRM round-trips per chain — a 20-stop trip paid 19 serial fetches against the shared rate-limited demo server, so the map showed straight chords for tens of seconds (or permanently, once the rate limiter answered) before the real road arrived. A whole corridor is now ONE chain request (chunked past 25 waypoints), measured legs are cached for the tab session, and cancelled measurements actually stop fetching instead of burning rate-limit budget in the background.
- **The map's day filter measures only the day on screen.** Switching day chips used to re-measure EVERY day's ride serially before painting anything — a 7-day trip cost ~35 fetches to draw one day's line. One day is now measured (one chain request, retried once on a rate-limit, cached by its route shape so revisiting a chip is instant), and the day cache shares legs with the whole-trip measurement through the session cache.
- **Google-keyed routing measures a corridor in ONE quota event.** `computeRoutes` `intermediates` carries the whole waypoint chain in a single call (chunked past 25 waypoints) with the response split into per-leg geometry — the old path spent one Google event PER LEG, ~19× the quota for the same 20-stop trip. Per #187's rule the response is asserted before it is drawn: every requested waypoint must sit on the returned polyline, and a response that silently re-routed is refused to the per-leg fallback.
- **The Return-home toggle now steers the suggestion corridor, not just the drawing.** Hiding the return leg makes the rails' km labels read the OUTBOUND road: a place on the ride home shows its distance from home ("~30 km in (outbound)") instead of a meaningless 90%+ of the loop, and the toggle's tooltip says exactly what each state means.

### Fixed
- **Road measurement refuses malformed stop coordinates instead of crashing or sending them to the routing server.** Stop data hydrates from Supabase as untyped JSON, so a poisoned row could crash the measurement outright (`toFixed` on a string) or — with coercive validation — slip `'12.9'`/`null`-as-`0` into a request URL. Coordinates are now strictly type- and range-checked at one boundary (cache key + request URL together); a bad leg degrades to the engine estimate exactly like a network failure.
- **The all-days map line no longer stops short of the destination.** The Map tab's road view sliced the drawn geometry to the outbound legs only, so a one-way trip whose destination anchor sits after its last plotted stop drew one leg short of where the plan actually ends; the destination tail is now drawn (without entering the plan totals, which stay outbound-only). A stored `(0, 0)`/mixed placeholder coordinate can no longer stretch the map's polyline across the globe — the plotting boundary drops it the same way the suggestion rail always has.
- **Copying a public itinerary's browser address now preserves its trip-specific preview, and navigation links open the intended page in any tab.** Public pages retain the hash router while displaying `/i/<id>#/pub/<id>`, including routes with trailing slashes or tracking queries, so link crawlers can read the publication metadata. Shell navigation and the public page's creator link point at the app root for new tabs; ordinary clicks stay in-app without reloading. Navigating elsewhere removes the publication path; creator, invite and snapshot links remain rooted at the app rather than inheriting it. Native and file routing are unchanged.

### Docs
- **Commercial docs now live under `docs/commercial/`.** The strategy report, monetisation plan and launch plan (from `d370aef` on `main`) move out of `docs/` root into `docs/commercial/`, joined by the execution plan and a new `STEP-0-DECISIONS.md` recording the ratified Step-0 numbers (15% fee → 10% tiered, ₹99/mo + ₹49/trip test, Branch-1 intermediary pending CA, reconciled funnel, F1 thresholds). `docs/README.md` indexes the folder.

## [0.58.0] - 2026-09-17

**Shared links finally have a picture.** A shared itinerary with no cover of its own now previews as a branded 1200×630 card instead of no image at all, and the covers the app picks for itself stop arriving tens of times larger than a link preview can use.

### Added
- **A shared itinerary without a cover still previews as a card.** Two of the three live publications carry no `cover_image_url`, so their links previewed with no picture at all, and `og:image` was missing from the shell too. The app now ships a 1200×630 card (`public/og-default.png`) that the preview handler falls back to whenever a publication has no HTTPS cover, with its dimensions declared and `twitter:card` promoted to `summary_large_image` so the picture is shown large. The card is drawn from the product's own vocabulary — the brand mark, a route with its stop sequence and the saffron destination node the logo's sun already uses, over contour rings gathering around it like a summit — and its source is `scripts/og-default-card.html`, so a brand change regenerates it rather than leaving an unreproducible binary in the tree. One test pins the asset's real pixel size to the dimensions the tags declare, and another that the URL names a file that is actually shipped.

### Fixed
- **A shared itinerary no longer previews with a multi-megabyte cover.** Auto covers came from Wikipedia's REST summary, which hands back either the *unscaled* upload or a 3840px thumbnail, so every card and hero shipped a 1.3–3.3 MB image — and WhatsApp is documented to want the `og:image` under 600 KB. Both extraction paths now route a Wikimedia file through `Special:Redirect/file/<name>?width=1200` (`lib/tripThumb.ts`), the supported way to ask for a size: 144 KB where the original was 1304 KB, 406 KB where it was 2894 KB, and nine of ten real destinations measured between 144 and 406 KB. A width cannot be composed into the URL — Wikimedia answers 400 for any size it has not itself generated, including one substituted into a URL the API returned — and a cover that is not a Wikimedia URL is left untouched. The thumb cache is keyed `_v2` so entries holding the old oversized URLs are dropped rather than served forever.

## [0.57.0] - 2026-09-17

**Sharing works, and the companion stops overclaiming.** A published itinerary link now previews as a card instead of a bare URL: `/i/<id>` reaches a real server that answers with that itinerary's own Open Graph tags before sending the browser to the hash route, which is what the product's one real distribution channel needed. A trip JSON imports in one step from My Trips and reads both formats the repo ships, permanent user deletion lands in the masteradmin console, the offline companion stops sending overloaded days, cost questions and mentions of children to the wrong handler, and every route finally has its own browser-tab title.

### Added
- **Published itinerary links carry itinerary-specific social metadata.** Both sharing surfaces use `/i/<id>`; the Vercel endpoint returns the public title, description and optional HTTPS cover before redirecting browsers to the existing hash route. Native shares use the public website. Metadata reads have a deadline, unavailable responses are not cached, and the endpoint never fetches another deployment's app shell. The production origin is necessarily written in three places — the handler, the client share helper and the static shell — so a test pins them to each other; a domain move can no longer break native share links and `og:url` while every other test still passes. Deployment and messaging-client verification remain required (#226).
- **The browser tab says where you are.** `index.html` carried one static title, so every route shared it: four open tabs all read "YatraFlow — Plan real trips, together", and a bookmark of one itinerary was indistinguishable from a bookmark of the site. `pageTitle()` (`src/lib/pageTitle.ts`) maps the route to a title, applied in one effect in `App.tsx` on hash change, and `routeParts()` becomes the single definition of what a URL's segments are — the router and the tab can no longer disagree about what a URL means. Routes whose name lives in the store (`/trip/…`, `/pub/…`) get a generic title there and are refined by the page that already holds the record, so `App` keeps its sliced subscriptions.
- **A trip JSON imports in one step, from My Trips, and reads both formats.** The only import affordance lived inside an existing trip's Share tab, so bringing in a file meant planning a throwaway trip just to reach the button. **My Trips** now carries **Import JSON** beside *Plan a new trip*, backed by a shared `ImportTripButton` that both places mount, so the two entry points cannot drift. `parseTripImport()` (`src/lib/tripImport.ts`) is pure and detects the format, fills the collections a hand-written export omits (`expenses` and `fixedCommitments` are both `.map()`ed by `buildTripCopy`, so a missing key was a crash rather than a cosmetic gap), drops the fields a file must not decide (`inviteCode`, `members` and `visibility` — a gallery file says `public`, and an import must not arrive public), and refuses with a message naming the actual problem: an empty file, a non-JSON file, a snapshot-link payload, a bare publication row, an export with no days, or a truncated day by number. A gallery file's `publication` block is reported to the user rather than applied — publishing stays a deliberate step in the Share tab.
- **True user deletion in the masteradmin console.** The Users tab gains a permanent Delete alongside Disable (the existing reversible soft-ban): an audited `admin_delete_user` RPC deletes the auth account, which cascades every trip the user owns (plan, expenses, votes, decisions, activity, publications), their memberships and authored rows in other crews' trips, and their notifications — while other people's trips survive for the remaining crew. Protected by an explicit force confirmation before destroying published Explore listings, self-deletion and last-admin deletion are refused outright, and the audit log records the blast radius (email, owned-trip count, published count, force flag) before the delete. The console confirms by typing the user's email.

### Fixed
- **A gallery itinerary JSON was rejected by the app's own importer.** Every file in `docs/examples/itineraries/` is `{ trip, publication }` — the v0.55.0 contract — and the import check read `days` off the **outer** object, found `trip` and `publication` instead, and refused a file the repo's own gates had already certified with "That file is not a valid YatraFlow trip export". The inner `trip` was importable all along; it omits only the tool-managed fields (`id`, `createdAt`, `updatedAt`) and `members`, which the importer assigns. `tests/trip-import.test.ts` now parses **every** shelf file the repo ships, so the two formats cannot drift apart again without CI saying so.
- **An imported trip is no longer named "… (copy)".** `buildTripCopy` labels every copy as one, which is right for *Copy this trip* and wrong for a file the user brought: nothing was copied, and a published import carried that label into the public gallery title. `importTrip()` keeps the plan's own name; the copy path is unchanged.
- **Offline companion routing distinguishes overloaded days from pace comparisons.** Savings requests no longer match saved-edit messages, cost-accuracy questions avoid spending breakdowns, and positive mentions of children no longer trigger stop-removal advice. Regression tests preserve valid comparison, savings, spending and child-suitability requests; development-only Jev audits remain opt-in and do not ship in the app.

### Docs
- **The share-preview path and the traps behind it are written down.** `docs/DEPLOYMENT.md` gains the `/i/<id>` section: the two env vars the function reads at runtime (not the `VITE_` pair, which is inlined at build time), what it answers when a publication is missing (404) versus unconfigured (503), why its responses are `no-store`, and the four acceptance steps that can only happen on a real deployment. `AGENTS.md` §4 records why a preview test must execute the handler rather than grep it for tag strings, and the two traps that made this feature's own verification lie — `process.env.X = undefined` sets the string `"undefined"` instead of clearing it, and Vercel's SSO login page answers 200 with its own `og:title`, so a probe that only checks for the tag passes on the very wall it should be blocked by.
- **The status docs catch up with the promotion and the queue.** `AGENTS.md` §1.1 and the ROADMAP snapshot still described the promotion to `main` as pending and the issue queue as empty; both are re-derived from the repo — `main` carries v0.56.0 (**PR #223**), `test` adds the unreleased, migration-gated user-deletion work (**PR #225**), and the queue holds **14 open issues** (the #226–#234 launch-readiness criteria and the #236–#240 milestone tracks, which now exist as issues and not only as roadmap prose). Three further stale claims went with them: **PR #224** was recorded as landed on `test` though it is still open (its six commits are absent from `origin/test`), the `shabtab` fork remote was recorded as removed though it is present and fetching, and the verify gate was quoted at 961 tests / 96 files when it now stands at **970 / 97**. The release ledger gains its missing v0.56.0 row.

## [0.56.0] - 2026-09-17

### Added
- **Party + vehicle preferences persist across reloads.** `driverCount` (2 / 3), `hasVulnerable`, `driveAfterDinnerMin` and `vehicleProfile` are now persisted to the trips table — the four fields that the Day Planner finishing batch (#205 / #207) shipped as UI-only and that silently reverted to "1 driver / adults / dinner ends the day / no profile" on every reload. A trip set to "2 drivers, infants, drive after dinner, motorcycle" is now a trip set to that on the next reload too. Migration `20260915_trip_party_prefs.sql` adds the four columns (applied to the live Supabase project); the store's optional-column probe gates writes until then, exactly like the stay-budget pattern.
- **The persisted vehicle profile drives fuel-stop spacing.** `MapTab`'s corridor-search options now pass `vehicleProfile` through to `planJourneyHalts`, so a 60 L / 20 km-L motorcycle is planned at motorcycle cadence and a 50 kWh EV is planned at charge cadence — previously every self-drive fell through to the 450 km car fallback because no app caller ever set `opts.vehicleProfile`. Junk profiles from a hand-edited row are dropped on read (`normalizeVehicleProfile` rejects unknown `vehicleType`/`fuelType`, non-finite or out-of-range `capacity`/`economy`), so the engine never sees garbage math.

### Changed
- **Trip settings is now its own workspace tab.** The crew, dates, places, budget, mileage, fuel price and vehicle profile controls leave the Share tab — Share now carries Plan together, Share publicly and Keep a record alone — and surface as the eighth workspace tab (`#/trip/<id>/settings`), where they are deep-linkable, swipable into on mobile and no longer compete with invite / publish / record for the same sub-tablist.
- **Trip settings changes propagate everywhere, every time.** Five concrete fixes close the realtime gap that hid the trip settings tab from the rest of the workspace (#213 Phase 3):
  - `MapTab`'s `wholeTrip` memo now depends on `trip`, so a transport-mode / round-trip / driver-count / vulnerable tweak re-derives the plan totals — previously it was stable on `[stopSig, routeTotalKm, routeTotalMin]` with the eslint-disable masking the omission.
  - The suggestion cache hash (`planInputsHash`, a one-owner pure function in `useSuggestionCache.ts`) now covers every input the search reads — travellers, driverCount, hasVulnerable, driveAfterDinnerMin, budgetPerPersonInr, fuelEconomyKmL, fuelPricePerL, roundTrip, vehicleProfile — not just anchors, route, scope, travel style and transport mode. A crew / fuel / budget tweak now busts the cache and re-searches at the new fatigue cadence instead of serving 4-hour-old suggestions tuned for the old party. `CACHE_VERSION` bumped 3→4 so old entries are dropped on next load.
  - `MapTab`'s split / clock verdicts now include `dayWeatherCode` in their deps, so a storm-code change with an unchanged rain percent re-weights the rain factor honestly (previously the banner stayed stale).
  - `TripWorkspace`'s road chain now memoises on a geometry-only signature (`roadChainSig(trip)` in `lib/tripRoad.ts`), not on the cloned trip object — a fuel-price / crew / dates / budget save keeps the existing chain and legs, so totals don't blink to haversine, the corridor search isn't re-planned, and the split/clock verdicts keep their numbers.
  - `Group` and `Budget` tabs now read `effective = pending?.proposed ?? trip` instead of `trip`, so while an impact preview is open, the suggested day's expense / fuel / lodging line on the Budget tab and the Group Input filters follow the proposed values, not the persisted ones. Share still reads `trip` (it doesn't render day plans, so the split is immaterial).
  - `DaySection`'s nearby-ideas effect now includes `trip.transportMode`, `trip.startLocationCoords`, and `trip.travelStyle` in its deps, so a transport-mode / start move / style change re-derives the mode-tuned chips instead of keeping the old ones until a stop change.
- **The bed's price can no longer go silently wrong.** Three faults in the stay-budget dial (#213 Phase 4): an unrecognised `stay_style` (the column deliberately has no CHECK constraint) indexed the rate table to `undefined` and multiplied the whole lodging line — and the trip total with it — into `NaN`; the Plan Bench hand-off mapped its stay tier onto the *travel* style and never set the dial, so a Luxury bench run (₹8,000 a room-night) created a trip that billed comfort (₹3,200); and Create Trip's travel-style copy claimed that dial prices the bed, which it does not. The stored key is now validated (anything outside `budget`/`comfort`/`luxury` falls through to the legacy rule, so no stored trip is re-priced), the bench passes its tier through as an explicit dial, and the copy says what the algorithm actually does.
- **Create Trip and Trip settings offer the same choices.** Six vocabulary mismatches closed (#213 Phase 5): **every transport mode is now creatable** (the create grid was a hand-rolled six, missing `taxi` and `mixed`, so a trip could be switched to a mode it was impossible to create — the tiles are now derived from `TRANSPORT_MODES` through an exhaustive Record, so a new mode is a compile error rather than a silent gap); **one crew vocabulary** (`CREW_CHIPS` / `CREW_MIN` / `CREW_MAX` / `clampCrew` in `lib/crew.ts`, with the custom-size field on both surfaces — Trip settings used to render a fixed 1–12 and clamp the display at 12, so a 15-person trip showed "12" and any tap silently dropped the party); **the stay tiers are one list** (`STAY_STYLES` in `data/types.ts`, replacing four hand-written copies — including one inside the bench's random-preset helper); **one fuel-economy default** (`DEFAULT_FUEL_ECONOMY_KML = 15`, which Trip settings used to show as 18); **the party controls are gated by the engine's own `isSelfDrivenMode`** on both surfaces (Create listed `taxi`, which the engine ignores, and omitted `mixed`, which it honours — dead dials in one place, hidden ones in the other); and **Create Trip accepts a ₹0 per-person budget**, matching the settings page and the pacing tile's honest "no target yet" state instead of an arbitrary ₹500 floor. A trip switched to a conducted mode now clears the party dials it can no longer use.

### Fixed
- **A blank tank or economy no longer writes car numbers onto a bike or an EV.** Trip settings fell back to `Number(capacity) || 45` / `|| 15` regardless of the chosen vehicle, so leaving either field empty on a motorcycle (12 L / 40 km-L) or an EV (50 kWh / 6 km-kWh) persisted a car's profile — and the same form re-saved it on every later edit (#213 Phase 6). The defaults now come from `defaultVehicleProfile(vehicleType)`. Also: the per-person figure is divided by `Math.max(1, travellers)` so the bill can never render `₹∞`/`₹NaN` (`engine.ts`), a stored custom "drive after dinner" allowance (say 60 min) is no longer silently rewritten to 120 by any unrelated save, and a fuel price entered without a mileage now says so plainly instead of being quietly ignored in favour of the blended rate.

### Docs
- **The status docs record the settings audit and the queue's real state.** `AGENTS.md` §1.1 now lists the audit among this cycle's landed work and carries the gate's measured size (**961 tests across 96 files**, read from the green CI run on `test`), and the roadmap's snapshot, queue paragraph and Open-issues section say what actually happened: issue #213 was filed and closed the same day, its six phases shipped as PRs #219/#220. Three stale claims are corrected with it — the "nothing is open" line dated to the previous day, the M5 paragraph still pointing at "five items", and the snapshot's "leads `main` by that release" written before the audit landed.

## [0.55.0] - 2026-09-16

### Added
- **A gallery import pipeline with a contract, a validator and an engine gate.** `docs/ITINERARY-IMPORT-SPEC.md` is the canonical JSON contract for an itinerary import that breaks nothing: every numeric is required (a missing `visitMinutes` renders `NaNh NaNm` and poisons the day's dwell), **both** coordinates are checked (a `(0,0)` or mixed-placeholder pin drags the whole route to the Gulf of Guinea), unknown keys are rejected outright (a typo'd field is otherwise silently dropped), and `days.length` must equal the inclusive date span. `scripts/validate-itinerary.mjs` is that contract's executable half — zero dependencies, run against any file or an `examples/` directory — and `scripts/gallery-geocode.mjs` supplies the coordinates the way the spec demands (Nominatim lookups with punctuation fallbacks, so an apostrophe or a comma cannot lose a stop). `tests/golden-itineraries.test.ts` is the second gate: it spawns the validator, then runs each `docs/examples/itineraries/*.golden.json` through the real engine and requires **health ≥ 85 with no HIGH-severity warning** and a declared budget within **±15 %** of the engine's own estimate. It also pins the validator's enum tables to `src/data/types.ts`, so a schema change cannot silently desync the two.
- **`docs/PLAYBOOK-GALLERY-RESEARCH.md` — how the gallery gets filled.** The five-stage workflow (select → research → draft → validate → publish) with the source ladder (official tourism/ASI/IRCTC pages for every fee, the app's own router for every distance, recent trip reports for rhythm), a research sheet, the publish step, a gallery ledger, and the first-impression checklist. It records the two rules the first shelf entry taught: **coordinates are geocoded, never recalled** (hand-typed coordinates for the Bylakuppe/Dubare cluster were ~15 km off), and **fee conflicts are reconciled in the open** (Mysore Palace shows ₹50 in the palace's own announcement and ₹70 in guidebooks — publish the official figure, cite it, and say so in `warningsAndAssumptions`).
- **The first shelf entry — `coorg-loop-from-bangalore`, 5 days, ₹12,100/person against the engine's ₹12,102.** Its first shape was the popular 3-day Bangalore→Coorg weekend, and Gate 2 rejected it: day 1 measured **423 min / 268 km** — a HIGH "heavy travel time" warning, because that drive is honestly 6–7 hours. The published loop breaks the drive at Mysore in both directions (max day 262 min), cites every ticketed fee to a Tier-1 source, and geocodes every stop against OSM — the same provider stack the app uses.
- **The gallery shelf's first five trips, every one engine-priced and fee-cited.** With Coorg as the reference entry, the shelf now carries `goa-north-to-south` (5 days, ₹14,350), `kerala-hills-and-backwaters` (6 days, ₹17,500), `mewar-forts-and-the-blue-city` (Udaipur → Jodhpur, one-way, 5 days, ₹14,300), `kashmir-valley-in-six` (6 days, ₹16,200) and `meghalaya-rain-and-root-bridges` (5 days, ₹8,150) — five archetypes, three fly-in `taxi` trips and one self-drive rental, spanning a backpacker band and a comfort week. Every ticketed stop cites its source, conflicting figures are reconciled in `warningsAndAssumptions` instead of quietly picked, every coordinate is a geocoder lookup, and every declared budget is the engine's own printed estimate (worst drift 0.6 %). Health after the gates: 97 / 100 / 93 / 100 / 100. The gate earned its keep by reshaping three drafts — Mewar's Ranakpur→Jodhpur day measured **319 min**, a HIGH, so Mehrangarh moved to the next morning; Meghalaya's declared budget sat **97 % above** the engine's; and two drafts had same-coordinate stops tripping the backtracking rule.
- **`docs/GALLERY-BACKLOG.md` — the twenty shelf trips, ranked by demand rather than by taste.** Domestic visitor data, the itineraries that exist as search phrases, season honesty and the engine's own shape constraints set the order; the page records what the first five optimise for as a set (archetype and budget spread, no trip needing a permit) and why Ladakh, Spiti and the Golden Triangle come next rather than first. The docs index carries it beside the spec and the playbook.
- **Vercel Web Analytics is wired into the app shell.** The keyless `<Analytics />` component mounts at the root of the web app (deliberately not in the Capacitor shell, where the insights endpoint can't be reached) and reports pageviews and web vitals to the Vercel dashboard. One honest caveat: the app's router is hash-based and the script auto-tracks via the History API, so the dashboard counts sessions and totals, not per-route visits — funnel-level route tracking will ride on explicit `track` events later.
- **An accepted night halt now holds its position.** Accepting a night halt remembers it by **night ordinal** (0 = the first overnight), so a re-split that shifts day indices can't misattribute it, and every later plan snaps that overnight back to the accepted spot. When the route genuinely moves the halt — a new stop, a different start time — the plan **asks**: drift beyond 15 km surfaces as a "Move here" proposal rather than silently relocating the night, drift below it holds quietly, and changing the trip's endpoints clears its pins outright (#143).
- **An existing trip can change who is driving (#142).** The party inputs — drivers sharing the wheel, infants or seniors aboard, drive after dinner — shipped in the Create-trip flow, so a trip was frozen at whatever crew it was created with: `driverCount` appeared seven times in `CreateTrip.tsx` and **zero** times in `TripSettingsForm.tsx`. Trip settings now carries the same three controls, and because the engine already honours them, changing them moves the split verdict, the daily wheel cap and the clock walk on the next re-plan (#142).

### Changed
- **Dinner stays late — the sunset does not move it.** Deriving the dinner window from sunset shipped and was reverted the same day: it landed dinner at 17:00–18:00 through a northern winter, and that is not how this market eats. The window is back to its late norm for everyone (20:00–21:00, night end 23:00), and the sunset plumbing is deleted rather than left dormant so nothing quietly depends on it. #122's season half stays open, and the honest shape for it is an **advisory** ("this day finishes after dark") or an opt-in early dinner — never a silent shift of the meal.
- **The terrain profile resolves terrain inside a leg (#204).** The profile added for #124 was built from leg totals, so a hill route only heard about its ghat if a stop happened to sit at the boundary — on Jaipur→Shimla or Kochi→Munnar the whole climb lives inside the first stop-to-stop leg and the anchors drifted by tens of km. The road measurement now asks OSRM for per-coordinate distance and duration on the **same** request it already makes (no extra call, no billing) and builds the profile at that resolution, so the ghat reaches the anchors. Where a provider returns no annotations — Google Routes, or the haversine fallback — the leg-total behaviour is unchanged.

### Fixed
- **The enhancement batch is reconciled onto the released realism design, and now fixture-pinned.** The batch's engine pieces — party-aware caps (+2 h with two drivers, +3 h with three, −1 h with infants or seniors, inside 6–12 h rails), dinner as an input rather than a biological absolute (kids and seniors eat at 19:00; a trip allowing post-dinner driving halts for the meal and carries on within its allowance and the night end), severity-banded rain, fuel ticks folding into a nearby meal or halt with an EV charging on its own cadence, the directed return walk, and lodging identity by provider place-id — are unified onto the shipped design instead of duplicating it: **one** mode gate (`isSelfDrivenMode`, replacing the batch's private `DRIVEN_MODES`) and **one** rain model, with the motorcycle's saddle fatigue priced through the mode-tuned cap rather than a second constant. Nine acceptance fixtures pin each behaviour, so the reconciliation cannot silently drift apart again (#122, #126, #141, #142, #144, #145, #146).
- **The Day Planner stopped walking the day on one blended speed.** Every anchor — lunch, tea, the night halt — and every arrival ETA was positioned with a single `totalKm / driveMinutes` rate, so on any day whose terrain differed from the trip's average the times were wrong in the direction of the mismatch: a ghat-first day put lunch **81 km** past where the car actually is at 11:30 (156 km against a true 75) and the halt 47 km late, while a plains-first day undershot by 24 km — the same average cannot serve both. The walk now converts time↔km through the measured road's own terrain profile (the legs it already fetches), and the split's night-halt boundary is placed where **cumulative wheel time** is even rather than where km is even — so its reported `maxDailyWheelMin` is a real number again (it was reporting 520 min for a day that takes 590, understating exactly the fatigue the cap exists to enforce). One-way trips are untouched: with no profile the blended rate is used byte-for-byte, which every existing fixture pins (#124).
- **The trip's road is measured once, by one owner.** The workspace and the Map tab each ran their own routing chain over the same points — doubling the load on the shared OSRM demo server (the rate-limiting behind the transient failures) and letting the map draw a road the detour math could not see. One measurement now feeds both the engine's leg corrections and the map's line, totals and suggestion corridor, with the single retry living in that one place. A chain where every leg fell back to the straight-line estimate counts as *unresolved* rather than passing as a measured road, so a rate-limited day degrades honestly instead of drawing chords as if they were roads (#188).

### Docs
- **Status docs refreshed for the promotion to `main`.** `AGENTS.md` §1.1 and the ROADMAP snapshot still described the promotion as pending — `main` at v0.53.0, `test` nine commits ahead — and the verify-gate counts predated the batch. They now record the converged state: both lines carry v0.54.0, `test` is an ancestor of `main` with nothing outstanding, and the gate stands at 93 files / 885 tests (#212).
- **The issue queue is empty, and the plan of record says so.** The rebrand (#96) is archived — there is no need or plan to rename, so `refactor/brand-seam` is kept as archaeology rather than pending work (with the `appId`-breaks-updates caveat recorded for any revival) — and #122's season half is closed as not planned: the late dinner window is deliberate, and the advisory/opt-in shapes are recorded on the issue if it is ever revisited. The ROADMAP's table, snapshot counts and the AGENTS in-flight note all reflect it.
- **The roadmap's stale claims are gone, and its ledger reaches the present.** Six claims were checked against the repo and corrected: the snapshot stanza (it still described `main` at v0.53.0 and a ~45-commit gap, when both branches had carried v0.54.0 for hours), a closed issue listed as open, M5's "the only milestone with open issues" (both of its issues closed, so it has none — the framing had now been wrong in both directions), a "next version" line frozen at `0.48.0` + 1, an open-issues table whose rows understated shipped code, and a progress ledger that stopped at v0.41 — **fourteen releases, v0.42 through v0.54, are now recorded**, each summarised from the CHANGELOG's own banner rather than recalled (#202).
- **#124's roadmap row and the issue now read fixed.** The terrain-blind walk is done (above); the row records the residual as data GRANULARITY — a leg-derived profile cannot see a terrain change inside a single leg — pointing at its own issue rather than at the walk.
- **The roadmap stopped claiming a fixed defect was pending.** Five places in `ROADMAP.md` said the M0 demo-seed guard was "never implemented" — the code has gated it since #94 (`store.ts` seeds only when `!tripCountUnknown`, i.e. only when the trip count could actually be read), so the plan of record was carrying an unchecked box and a "headline defect" note for a problem that no longer existed. Verified against source and corrected.
- **The doc index covers the docs again.** `docs/README.md` gained the missing rows — `MOTION-TOKENS.md`, `DESIGN-SYSTEM-GUARDRAILS.md` (the two halves of the design system the v0.53.0 audit documented), `PERFORMANCE_AUDIT_2026-09-05.md` and `SUGGESTION_ENGINE_BRAINSTORM.md` — each tagged with its Diátaxis flavor, per the §6 protocol.
- **The roadmap's queue is one issue, and the Day Planner finishing set is recorded.** #122 (the dinner window now follows the sun), #142 (trip settings carries the party controls), #202 and #204 (the intra-leg terrain profile) all shipped, so the open-issues table and the live-queue sentence now name the rebrand (#96) alone — and the snapshot's gap counts were re-derived against the repo (test 6 ahead, main 8).

- **Strategy, monetisation and launch docs added** (`docs/`), anchored to the shipped product rather than to a projection: `REPORT-2026-09-15-strategy-and-position.md` (the position, every figure tagged *measured / derived / assumption / unknown / decision*, the vendor market-sizing spread, the staged ladder) · `PLAN-MONETISATION.md` (the paywall surface that already ships, the fee arithmetic — Razorpay 2% TDR + 18% GST = 2.36% effective, a ~3.86% floor before the platform earns anything, Rs 25.30 net per Rs 199 unlock, and the ~Rs 27/sale gap between intermediary and merchant-of-record — pricing, five stages with gates and kill criteria, the M7 schema, conversion mechanics, failure modes) · `PLAN-LAUNCH-AND-DISTRIBUTION.md` (the live deployment measured in a real browser, the share-preview gap, the public gallery, instrumentation, the first distribution loop). Two live captures added under `docs/screenshots/`.
- **`PLAN-MONETISATION.md` §6.0 records a fix that precedes M7 — the premium lock is not an access control.** Publishing flips `trips.visibility` to `'public'`; the `trips read` policy carries no `to` clause, so it applies to `anon`; and the whole itinerary is the `days` column on that row. Locked days are therefore readable without an entitlement, so entitlements alone would not make the unlock real. The redacting read path (a `SECURITY DEFINER` RPC mirroring `get_invite_trip`, plus a narrowed table policy — shipping together, or the public page breaks) is **item zero of M7 and gates the first sale**. The full audit write-up, including its reproduction detail, is deliberately held outside this repository until the fix ships; §6.0 carries the finding, the evidence and the fix without the how-to.
## [0.54.0] - 2026-09-15

**The suggestion pipeline tells the truth.** Three faults had been quietly draining the Map tab's suggestions and the Day Planner's halts: detours were computed by subtracting one routing engine's route total from another's internal legs, so every on-road dhaba read "50 km off-route" on a long corridor and the per-day budget withheld almost everything behind it; the workspace and the Map tab each measured the same road, doubling the load that caused the transient failures they then could not recover from; and the night-halt town layer was asking for a place type that Google rejects outright, so it had been returning nothing at all. All three are fixed — detours are measured against the road the search actually ran on, one measurement feeds every surface, and night halts anchor on real towns with beds. The Day Planner's meal and fuel cadences came back with them (a load-balanced 350 km day was absorbing its own lunch and could never fit a fuel stop), Create Trip learned the Plan Bench's money motion and its route integrity, and a rate-limited day now degrades visibly instead of drawing straight lines as if they were roads.

### Added
- **A route-integrity guardrail** (`tests/route-integrity.test.ts`): every `#/…` link and
  `navigate('/…')` call in `src/` must resolve to a route `App.tsx` handles — the
  `switch (parts[0])` cases plus the pre-switch `parts[0] === '…'` checks. Comments are
  stripped first, so a route named in prose is not read as a live link, and both
  assertions carry a vacuity guard, so a parse that found nothing cannot pass.
- **The fatigue cadence is hours, not km.** Stretch breaks fire at `STRETCH_CLOCK_MIN`
  (120 min) of wheel time — 150 km was ≈2 h at highway speed but 3.6 h at the engine's own
  blended 42 km/h — and `planDriveDays` derives the drive-day split a route **demands**
  from the style/rain-tuned wheel-hour cap, load-balanced (700 km → 2 × 350, never
  585 + 115).
- **Fixed meal anchors on the clock** (`planTravelClock`): breakfast 08:00–09:30 fires
  only for pre-08:00 starts, lunch 11:30–14:30, tea 16:30–17:30, dinner 20:00–21:00
  **ends the driving day**. The night halt lands where the day's km budget, dinner, or
  the wheel cap arrives first — never night driving. Late starts get honest outcomes: a
  short hop to a night halt, or a "leave tomorrow 06:00" defer proposal.
- **The Map tab proposes the split the route demands** — "this drive needs N travel days
  — apply?" — counted from the travel clock, which knows the start time and bills round
  trips there and back, so one drive tells one story (#123). Applying it stamps real day
  shells (title, 08:30 start, extended trip dates); declining is respected with the
  honest red fatigue verdict (#133, #135).
- **Short trips stopped being silent.** The 90 km floor yields to the 2-hour clock rule
  (80 km of ghat crawl earns its stretch), the destination exclusion zone scales with
  journey length, and ¼/½/¾ fraction rows keep the strip useful below the fatigue floor —
  serving sights and meals, not errands, and no place wins two quarters (#128).
- **Derived day attribution everywhere:** DRIVE/STAY/MIXED labels on timeline day headers
  share the planner's own km-or-hours floor (#134); suggestion rows carry the wall clock
  their halt was derived from, "Day N · after your night stop" chips, and return-leg
  chips on the far quarter of round trips.
- **The bill prices the bed.** Hotel stops — accepted night halts or hand-added stays —
  gain a lodging line (overnights × rooms × style rate) from one stay-rate table shared
  with the budget bench (#125b); lodging identity keys on the provider place-id first
  (#146 — carried from picked hits through StopEditor and Add-to-timeline), with the
  coordinate cluster and normalized-name fallbacks beneath it for hand-typed stops
  (#125a). The night halt's minutes are never charged to the day's detour budget.
- **Create-trip helps from the first two points**: the route's own verdict — "The drive
  wants N travel days" with one-tap "Make it N days" (and the honest single-stretch wheel
  time when it doesn't fit the dates); it says "there and back" when the round-trip
  toggle is billing the drive home.
- **Style and budget are separate dials.** Travel style tunes stop frequency and
  suggestion flavors and never touches pricing; a **Stay budget** dial
  (Budget/Comfort/Luxury, ₹1,200/₹3,200/₹8,000 per room per night) prices the bed.
  Existing trips derive the dial from their legacy style — nothing re-prices silently.
- **Trip-aware map search**: results project onto the trip's own road and rank by detour
  (then road position), each showing "~X km into the trip · Y km off-route"; anything
  beyond the detour scope renders muted with an honest toast.
- **Optional-spend watch (opt-in)**: a soft 20%-of-estimate line on the Budget tab —
  tips only, nothing changes, off by default.
- **"Day out" / "Weekend dash" presets** on trip creation. The hero map frames the
  trip's own road (`heroBearingForRoute`) and always opens 2D.
- The planner is documented in [docs/PLAN-DAY-PLANNER.md](docs/PLAN-DAY-PLANNER.md) and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §8; the fixtures in
  `tests/dayPlanner.test.ts` are the spec.

### Changed
- **Night halts anchor on real towns.** Google's locality data bottoms out at village level on rural corridors (hamlets like "Gauriyapur", nothing to rank by), so the night-halt town anchor now also consults OpenStreetMap's `place=city\|town` — population-ranked, free and keyless, and the only source carrying town-grade data out there (Chunar 37k, Mirzapur 234k, Hazaribagh on the same corridor). When real towns are available the hamlet-grade entries are dropped, so a halt lands somewhere with a bed; where OSM has no town (dense urban corridors, where Google's locality coverage is strongest) the previous list is kept. This is a deliberate, narrow amendment to the Google-only provider directive — scoped to the town anchor; POIs, meals and fuel stay Google-only (#189).
- **Trip settings opens with two bars, not one.** Budget preference (Budget / Comfort /
  Luxury) and Travel style used to share a single block with the style bar on top and
  the price bar tucked underneath it, so the second read as a sub-option of the first.
  Each is now its own bar, at the top of Trip settings and of Create Trip, in that
  order: Budget preference answers what the bed costs, Travel style answers how the trip
  moves and what it suggests. Neither touches the other.
- **Suggestion rows sync to the map on click, not hover** — hovering a row no longer
  glides the camera (accidental map movement); rows show a pointer cursor.
- **Directions sits beside the travel card's title**, not on its own line.
- **Resolving a map-sourced vote adds the winner to the plan.** Shortlisted stops
  sent to a group vote carry their place with the option; hitting "Resolve" lands
  the winning place as a confirmed stop on the suggested day (clamped to the trip's
  range) — so it shows up on the Timeline, Board and Map at once, and the
  suggestion rail drops the rows it settles, winner included. Hand-raised
  decisions without a place resolve exactly as before.
- **Deleting a stop from the map pin.** The pin popup gains a Remove action
  (editors only) with an Undo toast — the undo restores the stop at its original
  position within the day instead of appending it at the end.
- **Shared sources under the planner**: one lunch window, one stay-rate table
  (`src/lib/rates.ts`), one drive-day floor (`isDriveDay`), tolerant style/rain
  parsing (#130, #132).
- **Create Trip's money figures roll like the Plan Bench** — the rough bill's transport /
  stay / food rows, the total, the per-head figure and the mobile dock amount animate
  into place instead of swapping, so tuning travellers or dates reads as a recalculation
  rather than a silent replacement. `Odometer` and `useMedia` move out of `PlanBench.tsx`
  into `src/components/ui.tsx` as shared exports — the rolling figure is the app's, not
  the landing page's — and `Odometer` takes an optional `label` so each call site renders
  the `sr-only` alternative it needs. Reduced motion still gets plain text, and the Plan
  Bench imports the same two primitives with its own rendering unchanged.

### Fixed
- **A night halt can no longer be anchored to a town hundreds of kilometres away.** The town candidates are filtered against *any* halt position, so a segment with nothing nearby could take the least-bad candidate from further down the corridor — live-verified: a 350 km halt "anchored" on Jhumri Tilaiya, 800 km later. A populated-place anchor more than 120 km from its own halt is now rejected, and the segment reports an honest gap instead (#189).
- **Night halts stopped starving on the corrected city lookup.** The city anchor layer's switch to Google's Nearby Search asked for `administrative_area_level_3` alongside `locality` — a type Nearby Search rejects, so the whole request returned 400 and the layer reported **zero cities everywhere**. Because the caller catches, that read as "no towns near any halt" rather than as a broken request: every overnight suggestion quietly starved on every trip. The lookup asks for `locality` alone now (live-verified: 6 places per rural halt point), and night halts anchor again (#189).
- **The trip's road is measured once, by one owner.** The workspace and the Map tab each ran their own routing chain over the same points — doubling the load on the shared OSRM demo server (the rate-limiting behind the transient failures) and letting the map draw a road the detour math could not see. One measurement now feeds both the engine's leg corrections and the map's line, totals and suggestion corridor, with the single retry living in that one place. A chain where every leg fell back to the straight-line estimate counts as *unresolved* rather than passing as a measured road, so a rate-limited day degrades honestly instead of drawing chords as if they were roads (#188).
- **Suggestions stopped charging phantom detours on long drives.** A dhaba or petrol pump sitting right on the highway could read "50 km off-route" on a 1,400 km corridor — the detour math subtracted one routing provider's route total from another's internal leg sums, and the difference (≈47 km on that corridor, a plausible-looking 1–3 km on short trips) was charged to every suggestion. That torched the per-day detour budget, held back most See & do ideas, and thinned the halt rails. Detours are now measured geometrically against the same road line the search ran along, so a place on the drawn road reads "on route" no matter which routing engine answered (#187).
- **Multi-day drives grew their lunch and fuel stops back.** On a load-balanced plan (say 4 days × 350 km) the planner's lunch was silently absorbed into every night halt — it slides to the 14:30 window edge, ~2 h 20 m of wheel time before the halt, inside the old merge bound — and the fuel cadence restarted at each day's start, so it could never land inside a day shorter than the tank stride. A 1,400 km trip produced zero meal and zero fuel suggestions. Lunch now survives as its own stop unless it lands within an hour of the halt (that is dinner at the halt anyway), and fuel follows the tank on a corridor-wide cadence (#189).
- **Night halts find their towns again.** The city anchor layer asked Google's Text Search for "towns and cities" — a query that matches POI names, not places, so it had quietly returned nothing and every night-halt suggestion starved. It now uses Google's Nearby Search with the locality place type, searched at each night halt's actual road position, and refuses to fill a halt with a town hundreds of kilometres away — an honest gap instead of a misleading card (#189).
- **The budget tier reverted on every reload.** The dial shipped in `deecbcc` with no
  column and no row mapping, so the tier a traveller picked was session-only and
  silently fell back to the legacy-derived value. It is persisted now
  (`20260914_trip_stay_budget.sql`), and the mapping is covered by tests — including
  the pre-migration path, which must stay a no-op rather than write a column the
  database does not have.
- **Create Trip's bill priced the bed from the travel style.** `estimateTripStarter`
  took a `travelStyle` and derived the tier from it, so the bill and the settings page
  could disagree about the same room. The bill takes the budget dial.
- **Trip deletion works again** — the production "trips read hide trashed" policy
  rejected the tombstone UPDATE (its added-row check saw a trashed row that
  nobody, including the owner, could read), so Delete silently rolled back and
  the trip reappeared after refresh. The policy now lets tombstoned rows reach
  their owner/editors while everyone else still never sees them, hydration
  filters tombstoned rows out of the live list itself (the Trash view reads
  them via `get_trashed_trips`), and `supabase/fix-trashed-read-policy.sql` is
  the idempotent Dashboard repair. Reproduced with a live QA account before and
  after.
- **The travel clock walks every day of a long drive** — the re-balance loop subtracted
  the absolute halt position from a relative budget, truncating a ~3,300 km walk at 4
  days (#137).
- **Night halts never land inside the destination exclusion** (#140), and the final
  day's arrival is clock-checked — past-night arrivals are flagged, not hidden (#138).
- **Segment ETAs carry halt dwell time** (#129); a meal folds into the overnight halt
  instead of sitting inside its gap floor (#131), and a fuel tick lands in the halt too
  when it falls within the fold window before the overnight — no refuel-then-sleep
  double stop at dusk (#144).
- **A wet day caps only that day** — the clock walk takes per-day rain instead of one
  trip-wide factor (#127), and the cap weights rain *severity*, not just chance: a 90%
  drizzle day damps ≈0.66× while a 90% thunderstorm hits the 0.5 floor (#141).
- **Conducted modes get no split verdict** — train/bus/flight/taxi legs (someone else
  drives) stay silent in the Map tab's banner, day chips, Apply-split and CreateTrip's
  verdict, and a motorcycle rides 1.5 h below the same style's car cap (#126).
- **Corrupt `startTime` can't silently become midnight** — out-of-range input clamps
  to a valid, loudly non-midnight start (#136).
- **The corridor search no longer re-runs on unrelated edits** — verdict memos key on
  stable signatures instead of object identity (#135).
- **The drive-day banner no longer flashes on map open** — it waits for the OSRM road
  measurement instead of rendering from the rough haversine estimate.
- **Saving trip settings no longer toasts success on a rejected save** — a date shrink
  blocked by a day holding stops shows only the reason.
- **Select's keyboard scroll honours reduced motion** (`scrollBehavior()`), as does the
  suggestion panel's cross-highlight scroll (#118).
- **Haptics DEV logs tell the truth** — they fire only where a backend exists,
  native-plugin failures surface in DEV, and vibrate-less browsers stay silent (#119).
- **Landing hero sheen leak** — the glass-sheen sweep is `position: absolute` but `.btn`
  never established a clipping box, so a skewed bar swept the whole hero face and read as
  a stray grey blob sliding across empty space beside the CTAs. Each hero button is now
  its own clip box.
- **The Map tab's suggestion rails pass a dedicated accessibility and consistency audit (#152–#181).** Warn text on light theme reads through the AA-passing ink tier (5.3:1) on facts, chips and the map spur, which now paints from `--warn` instead of a hardcoded hex; rail cards are keyboard-operable with real names and the fold buttons carry `aria-controls`; the rotating engine tip no longer spams screen readers every 7 s. Card, ruler and map now tell one story: ruler dots nudge apart instead of stacking at shared km and read the same km the card prints, the detour spur snaps to the same road projection the card's minutes use, one "fits-budget" predicate decides warn/held-back, unknown-km hits say so instead of silently attributing to Day 1, and "Best fit" appears only on the top-scoring pick. Chip filtering keys on stable ids instead of display copy, ratings endorse only with a 10+ review sample, the detour whisker's spur length now scales with share of the day's budget, quota outages get one honest story on every rail (never dressed up as a short trip), the detour-scope preference is guarded and namespaced with the rest, threshold chips got estimate-proof bands, and stale planner copy was rewritten to describe the clock-first engine.
- **Map zoom/fullscreen controls were unusable** — mapcn's `MapControls` ships Tailwind
  utility classes this app doesn't compile, so the group rendered as static flow under
  the canvas (invisible in 2D, stray and clipped otherwise). The handful of rules it
  needs are hand-ported in app tokens under `.yf-map-ctrls`, pinned top-right, above
  the canvas, in both themes.
- **Dark-mode pin hover tooltips unreadable** — maplibre's stock popup chrome is bare
  white regardless of theme, and light text on it vanished. Popups (hover tips + the
  stop cross-link popup) are reskinned to the app card in both themes, tip included.
- **Map search results carry real coordinates** — the search-to-add box ranked Google
  autocomplete hits, which are deliberate (0,0) "resolve on pick" placeholders, so every
  row measured Null Island and rendered the identical "~1675 km · 8448 km off-route".
  It now runs one free-form Text Search (the same event the corridor scan pays) whose
  hits carry real locations; coord-less stragglers are resolved-or-dropped; quota
  exhaustion toasts honestly.
- **Placeholder coordinates can't poison a trip** — Add-to-timeline and location picking
  resolve "resolve on pick" placeholders before any write, refuse unpinnable hits with a
  visible error, and mixed placeholders (latitude 0, real longitude) are rejected — the
  route can no longer dive to the Gulf of Guinea on an unnoticed (0,0) stop.
- **Timeline drag got cropped at the day card** — the carried row escaped nothing: the
  day-collapse clip (`overflow: hidden`) cut it off at the card edge. While a drag is
  live the owning section unclips (`drag-live`), same fix applied to Board columns.
- **Plan/Inspect pill jumped sides** — the long Plan copy's max-content pushed the
  header tools row into a left-aligned wrap. The copy is now the flexible item and the
  tools pin right (margin-left auto keeps them right-aligned even when wrapped).
- **The Plan Bench's "Turn these numbers into a real trip" went nowhere** — the CTA set
  `location.hash = '#/create'` and the router has no `create` case, so its `default:`
  branch rendered the landing page: the button read as inert and the prefill it had just
  stashed was never read. It targets `#/new`, the Create Trip route the nav already uses.
- **The admin console's published-itinerary links landed on the landing page** — the
  table linked `#/p/<id>` where every other published link (PubCard, Creator Hub,
  Explore, the share link) uses `#/pub/<id>`.
- **On a phone the printed bill had nowhere to appear** — `.ts-rail` was `display:none`
  at ≤900px, so "Print bill" fed a hidden container: no split, no formulas, no pace
  verdict, and the dock's figure only arrived after the tap. The ticket stays in the page
  flow at that width, as the Plan Bench shows its receipt, and its own "Create trip"
  button steps aside so the fixed dock stays the single primary CTA. Printing scrolls the
  bill into view (`block: 'nearest'` via `scrollBehavior()`) — minimal scroll,
  reduced-motion aware, and a no-op on desktop where the sticky rail already has it.
- **The hand-off copy named figures that do not transfer** — the Plan Bench stashes
  travellers, mode, travel style, budget, the return flag and the fuel figures, not the
  distance (`km`) or trip length (`nights`) its own headline price is built on. The
  fineprint names what actually carries over.
- **The smart budget rewrote its field unannounced** — the rough take landing in the
  per-person budget as the plan grows is deliberate, but a value changing under a
  screen-reader user is a mutation they never hear. A polite live region reports the new
  amount when the auto-fill writes, and stays quiet while the field is the user's focus.
- **ROADMAP status section refreshed to v0.53.0** — snapshot, open-issues table and the
  stale #84–#90 evidence bullets brought up to date, plus `tests/roadmap-status.test.ts`
  pinning ROADMAP/package.json/CHANGELOG version parity.

### Docs
- **Status docs refreshed for the `main` promotion** — `AGENTS.md` §1.1 recorded the #107 tracker as
  "96 ticked/annotated" over "five batches (PRs #109–#114)"; it now records the true final state:
  **117/117 boxes closed** across PRs #109–#116, plus the post-release UI fixes promoted alongside.
- **README screenshots refreshed** — the pre-build concept mockup on the landing hero is replaced by two real captures of the shipped page (`docs/screenshots/landing-hero.png`, `docs/screenshots/plan-bench.png`), taken from a production build of `main` with the scroll-reveal animations settled; the original concept boards stay in `docs/redesign/` as the design-history record.
- **Status docs reflect the final #107 state** — `AGENTS.md` §1.1 records
  **117/117 boxes closed**, and the Day Planner docs carry honest open-item
  markers (lodging-anchored halt placement is P1-C, not shipped).
- **The design-system contrast gate now covers the Map rails (#154)** — a new
  pinned contract measures the rail's warn-ink pairs against their real
  surfaces in both themes; color-only overrides can no longer ship a
  sub-AA pair unnoticed (the hole #152 slipped through).

## [0.53.0] - 2026-09-13

**The design-system audit gets fixed, not just filed.** An independent AI audit of all 19
pages, 20 overlay surfaces and 20 native selects became issue #107 — a root-cause-grouped
tracker — and five batches worked it to the floor: a per-theme contrast pass that fixed every
live AA failure (deepened light inks, dark-foreground swaps on solid-teal fills, literal navy
gradient stops where `--gray-900` broke dark), the motion vocabulary consolidated onto the
tokens (one stagger step, JS timing read from CSS), the mechanical tail (kicker recipe for
every micro-label, coarse-pointer hit areas, disabled states that look disabled, layout
shifts), native-select popups replaced by a real ARIA listbox on the high-traffic surfaces,
and the last design decisions resolved — including a scenic 292° hue that finally separates
the "places to see" lane and the viewpoint spine from the day-route palette they'd been
borrowing. The map's day filter draws the selected day's whole journey again. Android
`versionCode 14 / 0.14-native`.

### Added

- **Page-by-page UI design-system audit committed as a reference doc** —
  `docs/UI-PAGE-AUDIT.md` is a diagnostic-only (no fixes applied) pass over all 19 pages/sections,
  20 overlay surfaces and 20 native `<select>`s, measured against the project's own token/motion
  system with computed WCAG values and `file:line` citations. It is the write-up behind
  **[issue #107](https://github.com/hasnaina955/Yatraflow/issues/107)**, now the complete fix
  tracker (contrast · tokens · motion · layout · a11y · selects), grouped by root cause so the
  "known rule, siblings unfixed" families (light-ink deepening, dark-foreground swap, motion
  tokens, `pointer: coarse` hit areas) each collapse to one change. Indexed in `docs/README.md` as
  a companion to the earlier accessibility `UI_AUDIT.md`, not a replacement. A provenance banner
  notes the line cites predate v0.51.0/v0.52.0 — re-locate by selector.

### Fixed

- **Single-day map view draws only the selected day's journey** (PR #106, on `test`). A regression
  from the engine-journeys change: the single-day branch switched its source to every day that *has*
  a route and dropped the day filter, so selecting Day 2 kept rendering all days' lines while the
  camera fit Day 2 alone. Restores the one-day-in, one-day-out contract; the selected day still
  shows its whole engine journey (anchor-only outbound and ride-home included), and the Board
  backdrop regains its documented `focusDay` behaviour.
- **UI audit #107 — contrast, ink-tier, a11y and layout batch (verified per theme).** Fixing the
  root causes first, every value re-computed against the *current* tokens (many audit rows had
  already shipped fixed in v0.51/v0.52 — e.g. `notif-badge` is 8.2:1 now — so only the live
  failures were touched):
  - A **deepened light text-ink tier** (`--ink-amber` #8F5B06 · `--ink-ok` #1F6B41; dark re-declares
    them to the already-passing raw aliases) now backs `chip-ok`, `metric-good`/`balance-pos`,
    `metric-warn`, `impact-head`, `.delta-neg`, `tl-total-warn`, the amber-sibling block and the
    `tab-count--hot` (which also lost a dark-on-dark hardcoded `#8F5B06`).
  - The **solid-teal-fill + white** family (`step-num`, `vote-btn.on`, `mode-btn.on`, `crew-btn.on`,
    `cal-day.edge`, `route-dot`) moves to `--teal-deep` in light and the `#06251f` dark-foreground
    swap in dark — the pattern `.map-legend-toggle.map-live-on` already used; the mode-tile hint gets
    its dark ink too. `--color-primary` (light) steps one notch deeper so the primary CTA's white
    label clears 5.19:1 at rest (which also lifts `.share-tab.is-active`, it shares the token).
  - **Explore:** the Saved chip's selected state drops white-on-saffron (1.97:1) for the soft-fill +
    deep-ink recipe its siblings use; the hero search placeholder goes to full `#e2f1ef`; and the
    focus now declares a **white** ring so the dark-teal hero can't wash the shared `.input:focus`
    indicator out to 1.18:1.
  - **SYS-5:** `.card.route-snap` and `.trip-head-card` end their gradients in a **literal** navy
    (not `--gray-900`, which flips near-white in dark and stranded the white text at ~1.1:1) — which
    also makes the Public Itinerary glance text legible in both themes as a side effect.
  - **A11y:** `PayerSelect` now forwards the `id`/`aria-*` that `Field` injects (the "Paid by" label
    previously pointed at a non-existent id — no accessible name); the Budget metric strip gets
    `role="group"` (so its `aria-label` isn't ignored); the expense table's empty actions `<th>` gets
    a screen-reader label; the Group Input **consensus bar** low/mid segments move to a neutral→amber
    →green ramp (was `--line` 1.18 / `--saffron` 1.85 — the low bar was invisible in both themes).
  - **Layout / state-drawn:** `.form-row` wraps again (its flex override had dropped the original
    responsive intent — the `commitment-row` grid tracks were dead code behind it), `.pulse-bar` spans
    its grid row full-width, `.chip-count` drops the `opacity:.65` that washed it to ~2.5–3.2:1, and
    `.btn.on-teal` gets the missing rule so the My Trips Trash toggle's pressed state is drawn (its
    `aria-pressed` was always correct — a sighted-only gap).
- **UI audit #107 — fill contrasts + motion-token batch.** The border/fill half of the ink work,
  plus the motion vocabulary:
  - **Fills** (3:1 non-text, light only — dark passes as authored): the health "Tight" number and
    bar move `--yf-amber` → `--warn-600` (2.01/1.89 → 3.92/3.69), the Board pulse band routes
    through the ink tier (`mid` 1.94, `ok` 4.03) with the `bad` band taking the deep red in light
    (3.83 → 6.43), the day-progress medium-severity fill (1.85 → 3.40) and the daily-average tick
    (2.40 → 3.40) go to `--warn-600`, `--cat-tolls-parking` deepens to slate (2.76/2.77 → pass), the
    white switch knob gets dark ink on the checked dark-teal track (2.05 → 6.5), and the stop-kind
    **food/rest** pair — 3.9° apart (the same colour) and ~2:1 as the spine — separates to **18°**
    AND clears 3:1 in light (burnt orange #C2410C / gold #A16207; dark keeps its primitives).
    The remaining cat-hue re-space (food vs local-travel vs emergency, all within 6°) is the one
    deliberately open palette decision.
  - **Motion (SYS-7):** the snap controls (`route-btn`, `mode-btn`, `crew-btn`, `cal-day`,
    `quick-budget .chip`, `move-btn`, `board-fit`, `board-pulse-link`, `vote-btn`) gain the shared
    `--t-fast` ease; the `.clickable-chip` duplicate transition is merged into one declaration (the
    old pair fought — colour and glow popped while the fill eased); every raw `.15s`/`.3s`/`.4s`/
    `.5s` duration routes through `--t-fast`/`--t-med`/`--t-slow` + `--ease-out` (28 values across
    13 rules; the one `.15s` stagger *delay* stays literal for SYS-7f); and the Board FLIP pass now
    resolves its timing from the tokens via `motionTiming()` (`--motion-slow` + `--ease-out`) instead
    of a byte-for-byte duplicated easing string. The pill glider was verified already token-driven
    and frozen under reduced motion.
- **UI audit #107 — the mechanical tail: type recipes, hit areas, layout and state bugs.** The
  root-cause method applied to the remaining discrete rows:
  - **Kicker / micro-labels (SYS-1):** Create-Trip's eight section labels had no base rule at all —
    they rendered as 15px/400 sentence-case body text and the page hierarchy collapsed to h1→body.
    `.eyebrow` (and the calendar's `.cal-wd`) joins the kicker-unification recipe, and the five
    sibling specs that pre-dated it (`.bench-eyebrow`, `.group-lab`, `.mini-lab`, `.route-tag`,
    `.editorial-kicker`) drop their dead font declarations — the recipe block is now the single
    source of type truth (colour stays per-label).
  - **Touch (SYS-4):** the `pointer: coarse` hit-area extensions now also cover `.link-btn`,
    `.move-btn`, `.board-pulse-link`, `.cal-day`, `.route-btn` and `.vote-btn` (the vote — the
    flow's primary control — was 34×30).
  - **Form states:** disabled `.input`/`.select`/`.textarea` finally *look* disabled
    (opacity + not-allowed, matching `.btn:disabled`) — three shipped identical to enabled ones;
    the travel panel's hand-styled time/number fields move onto the shared `.input` surface via a
    compact variant (same focus ring as every other field), and the halt planner's stray
    `.input`-classed select becomes a real `.select` (the last of the two conventions).
  - **My Trips:** the empty-state CTA demotes to outline (one filled primary per view — the header
    already owns one); the Clear button is always mounted (visibility-toggled) so the search field
    stops shrinking on the first keystroke; the header gets real classes, killing the
    `:first-child` structural selector and the inline-style `!important` fight; the style chips'
    Explore-only margin is scoped out of the toolbar; and trash rows drop their trailing border
    via `:last-child`.
  - **Explore:** the hero search gains an in-field clear affordance (the only Clear button sat in
    the filter card ~300px below the input that set `q`); the featured card labels itself
    "outside your filters" when filters are active (it deliberately ignores them); the hero kicker
    is typed in sentence case (CSS uppercases it) and the hero h1 rejoins the global ramp instead
    of running a second `clamp`; PubCard's social icon links and the creator-line anchor get
    interactive affordances (hover + `focus-visible`) instead of copying `.muted`.
  - **Overview:** the six identical heading-underlines come out (a `.card-head` gap replaces them —
    dividers return only where two groups share a card) and the page-head h2 steps down under
    578px, where the global h1's 26px floor made the two adjacent heading levels render the same
    size on every phone.
  - **Budget:** the ≤700px category-name track gets `min-width: 0` + ellipsis (a 44px track was
    handing "Accommodation" ~14px); "over the daily average" gains a ▲ shape cue + screen-reader
    text instead of fill-colour-only; and the inline-JS fills normalize onto the alias token
    family (`--teal`/`--saffron`/a new `--coral` alias — zero visual change).
  - **Board / timeline:** the phantom `--focus` token (never defined) is gone from the two
    focus-visible outlines; the timeline's three copies of the `74px 1fr` rail geometry merge into
    one rule.
  - **Dark-theme inks:** NativeHome's live trip thumb (white icon on dark-lightened teal, 2.47:1)
    and bell count (3.21) get dark ink, as does the AI drawer's user bubble (2.11); and the
    Create-Trip dock switches to near-solid glass (90%) so the amount's teal can't be dragged
    below AA by whatever scrolls beneath it.
  - **Motion (SYS-7f):** one stagger step — `--stagger-step: 60ms` now drives the board columns,
    My Trips cards (previously a 70ms step) and the Create-Trip blocks (was a 40ms lead-in) via
    `calc`.
  - **POI tokens (SYS-8a):** the hardcoded `#7C5CFC`/`#5540B8` purple pair moves to
    `--yf-poi-see`/`--yf-poi-see-ink` (dark lifts to `#B4A5FF` via the token, so two override
    rules delete). Re-measured, the sight chip passes ~5.7/6.9:1 — the audit's 1.99/1.84 had
    compared the ink against the raw, uncomposited hex.
  - **Admin:** the 5–6 column tables scroll on phones (block-level `overflow-x`) instead of
    clipping the page; the tablist row was verified already correct (stale in the audit).
  - **Public itinerary:** the floating hero stats card — the one surface that ignored the theme —
    gains a dark variant. **Share:** the scrollable tablist gets edge fades that only show where
    content remains, and arrowing through tabs scrolls the focused tab into view (in `useTablist`,
    so every tablist surface inherits it). **Auth:** the support link gains an underline tell.
  - Deliberately left: the budget category hues (user decision — keep as authored), the
    native-select popup rebuild (A-family, its own batch), the stop-kind spine+tag double encoding
    and the viewpoint hue (design decisions), and the token-scale adopt-or-delete (SYS-2a/b).
- **UI audit #107 — native-select popups replaced on the high-traffic surfaces (A-family).**
  The themed `.select` trigger stayed, but its popup was OS-rendered — on Capacitor Android that
  ships as a stock system dialog (the "still looks html" complaint). A shared `Select` component
  (`components/Select.tsx`, the WAI-ARIA select-only combobox on the `LocationInput` contract)
  now backs the **14 editing/filtering selects**: StopEditor's category/priority/status, the
  Create-Trip commitment type/day, Trip Settings vehicle + fuel (including the disabled state
  that used to render enabled), My Trips when/sort, Explore duration/budget/sort, the travel
  panel halt purpose (compact variant) and the map's add-POI day pick. Focus stays on the
  trigger; the popup is `aria-activedescendant`-driven with wrapping arrows, Home/End,
  typeahead and Esc/outside-click/Tab dismiss — and Esc no longer bubbles into the enclosing
  dialog. Keyboard math is node-tested in `lib/listbox.ts` + `tests/listbox.test.ts`. The six
  low-traffic selects keep the native control by design (trigger look is identical; only the
  popup differed).
- **UI audit #107 — SYS-2 decided and cleaned up.** The adopt-or-delete call on the unused
  token scales lands on **delete**: the `--text-*` scale (1 of 8 steps used) and the `--s-*`
  spacing scale (0 uses) are gone — with 340+ literal sizes in the cascade, a parallel scale
  nobody routed through was a trap, not a tool (`--text-xs` stays for the bottom-nav label;
  sizes elsewhere stay literal by design). SYS-2c: Profile's eight inline card margins move
  to a `.stack-gap` class, and the commitment row weights its fields by content again (the
  grid's 2fr/1fr/.8fr intent, re-expressed in flex — "What" grows, "Day" no longer takes half
  the row).
- **UI audit #107 — the design-decision tail.** The last open rows, resolved:
  - **The scenic hue split (SYS-8a, finished):** the "places to see" lane and the viewpoint
    stop-kind now own **292° magenta-violet** (`--yf-poi-see` #db4cf0 light / #e488f2 dark,
    ink `--yf-poi-see-ink` #8a2999 / #f0a7fb) — 40° clear of the Day-3 route violet they used
    to share byte-for-byte, 38° clear of the activity purple (which sat ~2° from the old
    POI colour), and clear of every other day colour. The viewpoint spine also stops wearing
    the interactive teal (the selection colour) on every viewpoint card. Computed per theme:
    spine 3.33/7.61:1, chip ink 5.78/8.00:1.
  - **Explore gains its entrance choreography** — grid cards ride the shared `trip-enter`
    stagger (`--stagger-step`, capped at 8 like My Trips), via a new `enterIndex` prop on
    PubCard; the discovery page no longer arrives instantly while every other page cascades.
  - **StopEditor's priority/status options carry tone dots** in the custom listbox (dual-coded
    with their text labels). Category icons were skipped deliberately: no category→icon map
    exists in the codebase to reuse, and inventing one for a nicety wasn't worth the surface.
  - **Landing repaint mitigation:** `background-attachment` drops from `fixed` to `scroll` on
    coarse pointers — the pinned full-page ramp forces a repaint every scroll frame on the
    Android WebView. Desktop keeps the seamless pinned ramp; the touch change still needs a
    low-end device check to confirm the win.

## [0.52.0] - 2026-09-12

**The map learns relief.** The light basemap moves to Liberty — cream land,
vivid water, named roads: it reads like a travel atlas instead of a grey
canvas — and the Map tab gains three view modes on one shared palette: flat 2D,
Terrain relief (hillshade over the keyless AWS terrarium DEM, never burying the
river lines), and a pitched 3D hero that rides real elevation and puts the
terrain back exactly when the theme swaps reload the style underneath it. The
Board stays hard-2D by design; the choice persists; the spec and live
prototype landed with the code. Android `versionCode 13 / 0.13-native`.

### Added

- **Map view modes: 2D · Terrain · 3D hero** (spec + prototype live in
  `docs/FEATURE-REQUEST-MAP-VIEWS.md` and `docs/MAP-MOCKUPS.html`). The Map tab's
  toolbar gains a segmented switcher (`role="group"` of three `aria-pressed` chips
  in the day-filter's glass language; the long form — "Flat map", "Terrain
  relief", "3D terrain" — lives in the `aria-label`s). **Terrain** lays a single
  hillshade layer over the still-flat map — relief with no camera or gesture
  change — sourced from the keyless AWS terrarium DEM, whose credit appears only
  while a terrain mode is on (the source is added on demand, and the basemap
  credit is never duplicated). **3D hero** drives the same DEM through
  `setTerrain` (exaggeration 1.8) with an eased camera to pitch 70 / bearing 235
  — `maxPitch` is raised 60 → 75 because MapLibre silently clamps a higher ease —
  instant under prefers-reduced-motion; leaving 3D resets the camera and drops
  the terrain stack (`getTerrain()` back to null). The choice persists globally
  and degrades to 2D on corrupt storage, and the terrain stack re-applies itself
  after every theme style swap (a full reload wipes sources, layers AND terrain).
  The Board stays hard 2D: a pinned backdrop must not spend GPU on terrain, and
  one surface's mode choice must not hijack another's. The pure half — the
  water/waterway `beforeId` resolution (Liberty's river lines sit above `water`;
  matching `water` alone buries them), mode parsing, and the idempotent
  reconcile step — is `lib/mapViewModes.ts` with 19 node tests.

### Changed

- **The light-theme basemap is Liberty now, not positron.** The product leans on
  the map to sell the trip, and positron's deliberate grey undersells it: Liberty
  (OpenFreeMap's OSM-carto lineage) has cream land, vivid water, a real place
  hierarchy and named roads at trip zoom — it reads like a travel atlas and is
  the closest stock style to the brand's warm palette, keeping the teal/saffron
  overlays legible on top. One line in `mapcn/map.tsx`'s `defaultStyles`; every
  map surface (Map tab, Board backdrop, expanded overlay) inherits. Dark theme
  keeps the existing dark style — OpenFreeMap ships no Liberty dark, and a
  recoloured twin is a follow-up, not part of this swap (spec §2.7).

## [0.51.0] - 2026-09-11

**The timeline learns to move.** The 1,500-line TimelineTab monolith is split into
modules, every pill toggle animates like the workspace tab bar, dropdowns and the
calendar/location pickers share one frosted-glass recipe, drag-reorder is rebuilt on
pointer events (the carried card rides the finger, warps with the throw, and the drop
zones read the card's centre against stable layout), the day planner gains an
Optimise button (2-opt ordering + real road polylines + Google Directions), and Plan
a trip prefills a live rough-bill budget you can hand back to the maths with one
tap. Motion is governed by a token system (`docs/MOTION-TOKENS.md`, AGENTS rule 10)
so the older-vs-newer smoothness gap stays closed. Android `versionCode 12 / 0.12-native`.

### Added

- **bencho-grade drag: the row rides the finger.** Drag-reorder on the Timeline
  and the Board now runs entirely on pointer events (`lib/touchDnd.ts`); the
  HTML5 drag API — whose OS-owned ghost bitmap and throttled `dragover` capped
  how smooth a reorder could ever feel — is gone. The carried row is pinned to
  the pointer with no easing at all (free, unfenced: only the insertion
  *reading* is clamped, so carrying a row out of the list and back is a real
  gesture), its inner card stretches along the moving axis, thins the other
  and leans into the throw (velocity warp, signed tilt — a flick back rights
  it), and a 90ms calm timer eases the deformation flat the moment the finger
  stops. Position and deformation live on two separate transforms (row vs
  skin) because one must never ease while the other always must. Drops settle
  once via the FLIP pass, with the carried row springing from where it was
  released; a no-op release springs it home. Touch keeps its long-press gate,
  now with the same visible carry; mouse drags start on an 8px move. The
  goo/metaball morphing stays excluded, and the drag-start wiggle is retired.
- **Every pill toggle animates like the workspace tab bar.** The Plan/Inspect
  toggle and the Group Input composer switch are the tabbar's exact glass
  capsule with `.tab-btn` children, and inside *any* PillNav the sliding
  glider is now the only thing that paints the active state — the per-chip
  glow shadow that used to pop off/on while the background glided (the
  "two-step switch" feel) is gone. Saffron highlights hand their paint to the
  glider the same way (dark-amber ink for 4.8:1 on saffron).
- **Location + calendar: the real frosted glass, plus a modernised combobox.**
  Root cause of the dropdowns never matching the navbar's frost: the
  CreateTrip section entrance used `animation-fill-mode: forwards`, which
  keeps each block a compositor group after it ends — blinding
  `backdrop-filter` on the `.popover` dropdowns inside them (they rendered as
  plain translucent sheets). The entrance now fills `backwards` and the frost
  is the navbar's, exactly. The combobox itself got the design-language pass:
  option rows with a 32px tinted icon chip, hover/keyboard highlight on one
  teal surface, and the provider caption ("Place search · Google") became a
  quiet footer row inside the dropdown instead of a floating caption below it.
  The calendar range reads as one capsule (start day rounds left, end day
  rounds right), month steppers are proper round buttons, and form controls'
  transitions moved onto the motion tokens.
- **Quick budget amounts are a toggle, not a one-way trap.** ₹10k/15k/25k
  chips claim the field for manual editing when clicked — and clicking the
  highlighted amount again releases it: `budgetTouched` resets and the rough
  bill's suggested amount flows back in, with the field hint explaining the
  state ("Manual amount — tap the highlighted quick amount again to hand the
  field back to our maths").
- **The Timeline opens collapsed — one day at a time, as scannable summary rows.** Phase 1 of
  the Timeline restructure (`docs/TIMELINE-PLAN.md`, mockups in `docs/TIMELINE-MOCKUPS.html`):
  every day now starts as a summary row — the collapse control is a visible circular chevron
  button that rotates open/closed, and under the title a single "Drive day · Tea Museum →
  Top Station → Kundala Lake" line names the middle stops the stats line never showed (stay
  days read "Stay day · No driving today — …", dimmed). Stop names wrap instead of truncating
  mid-word, the full chain rides in a tooltip, and a new per-stop dwell chart puts amber on
  the stop that eats the most of the day (with a measured 3:1 boundary in light theme).
  Opening a day collapses the others (accordion), and the one open day is persisted per trip
  (`yatraflow_open_day` in `uiPrefs.ts`) so a reload restores where you were — the old
  per-day collapsed map is retired, since per-day booleans can't express accordion state.
  The "Jump to day" chip rail now opens the day it scrolls to, and `+ Add here` on a
  collapsed day expands it before opening the editor, so an add never lands in a hidden day.
  Collapse state is lifted into `TimelineTab` (`DaySection` is now a controlled component
  with `open` / `onToggleOpen`); pure helpers live in the new node-testable
  `src/lib/daySummary.ts` (route chain, stay-day summary, accordion transition, dwell
  segments), pinned by `tests/daySummary.test.ts` plus open-day persistence tests in
  `tests/uiPrefs.test.ts` — including the negative-control that opening Day 2 collapses
  Day 1. Drag-reorder, cross-day moves and the realtime echo guard are untouched.
- **Plan/Inspect modes + Board-parity drag + smooth day open/close (restructure Phase 3).**
  A segmented Plan/Inspect toggle lives in the Timeline header and persists per user like the
  theme: **Plan** is today's editing timeline; **Inspect** is the same data with every
  editing affordance off — no drag, delete, add, rename, halt-planner actions or impact
  sheet — rendered through the existing `editable` permission seam, so the plan is safe to
  study on a phone during the trip itself. Drag-reorder now uses the Board's premium kanban
  pattern (until now only the Board had it): the DOM order never changes mid-drag, a slim
  teal marker glides to the insertion slot, drops resolve through the marker, and a FLIP
  pass settles the arrangement once on commit — no more per-card shuffle. Day bodies now
  animate open and closed (grid-rows `0fr→1fr`, height-agnostic, reduced-motion aware) while
  still unmounting when closed, so collapsed days cost nothing. The mode hook lives in
  `src/pages/trip/timeline/useTimelineMode.ts`.
- **Motion tokens + a liquid drag feel, everywhere (the "newer sections feel
  cheaper" fix).** `docs/MOTION-TOKENS.md` is the design-tokens doc for motion:
  three duration steps (`--motion-fast/med/slow`: 120/180/240ms), the easing set,
  and a pattern catalog (dropdown entrance, toggle glider, day collapse, drag
  follow/settle) — and AGENTS.md gains rule 10: every new interactive surface
  ships motion from the tokens, so the gap between long-refined surfaces and
  fresh ones stays closed. The drag on both the Timeline and the Board is now
  bencho-style liquid arrangement: siblings glide out of the way in real time
  while you drag (transform-only, no scale/bounce morphing), the carried row
  sits as a dashed ghost slot, and the FLIP settle snaps the final arrangement
  home — the gliding teal marker is retired. Dropdowns and menus share one
  `.popover` surface (the navbar's exact glass recipe with entrance motion —
  location list, calendar, notifications, account menu), and the Plan/Inspect
  toggle is a real animated glider whose switching no longer reflows the header
  (the add button dims in place instead of vanishing).
- **Plan a trip prefills the budget with the app's own maths.** The rough-bill
  estimate (stay + food + transport, `estimateTripStarter`) was already computed
  live but hidden behind a "Print my bill" reveal — it now shows under the
  budget field ("Our rough take ≈ ₹X/head · ₹Y total") and **auto-fills the
  per-person field** (rounded to ₹500) as dates, crew, mode and route make the
  number possible, until you edit the field yourself. The round-trip control is
  "Drive back to start" with a real hint (≈ N km back to your start), and the
  return-stops switch is "Plot the drive back".
- **Travel-style chips now tell the truth — and the truth got wired in.**
  Copy states exact engine values (relaxed: halts ~120 km / meals ~260 km /
  60 min detour slack; packed 180/300/30; balanced 150/300/45; budget/luxury:
  the ₹1,200/₹8,000 stay tiers vs comfort ₹3,200), the fake claims are gone,
  and the five decorative styles now really act: `computeCategoryBias` gains
  style→category priors (adventure→adventure/nature, spiritual→temple,
  food-focused→food, creator→sightseeing/museum) consumed by the nearby-POI
  ranking, so "suggestions favour temple stops" is a fact, not a promise.
- **Group Input speaks one filter language.** The duplicate count-pill row and
  filter bar are merged into a single workspace-style pill rail with the counts
  inside the pills (All · n open, Need you with its amber badge, Resolved), the
  composer's Stop idea/Question switch is a visually distinct segmented mode
  toggle, the unstyled `.gi-guide` box is styled, and the text-glyph vote
  buttons are lucide chevrons.
- **Timeline restructure plan and mockups (planning artefacts).** `docs/TIMELINE-PLAN.md` is
  the phased, code-audited implementation plan (collapsed accordion day rows → evict
  specialist tools → Plan/Inspect split + file split) with the three design decisions signed
  off; `docs/TIMELINE-MOCKUPS.html` is the approved visual prototype rendered in YatraFlow's
  design tokens.

- **"Optimise day" — the anti-crisscross reorder** (Timeline, per-day header). Days with 3+ movable stops whose current order wastes travel show an `Optimise (−X km)` button: it opens a before/after preview (travel distance, estimated driving time at the trip's average speed, and the full new stop order) and commits through the same impact-preview gate as a manual drag. Under the hood, a new pure `optimizeDayOrder` engine helper runs greedy nearest-neighbour from the day's wake-up origin (where the previous day's journey ended — `originOf`, not a naive first-stop guess) followed by a full 2-opt improvement sweep, with an open-time tie-break so two near-equal candidates pick the earlier-opening door. Auto anchors (your base and the day's destination/continuation waypoints) stay pinned first/last — the engine builds the journey around them; a mid-day auto anchor (an unusual shape) refuses to optimize rather than risk dropping it, and rejected stops ride along untouched. 8 node tests pin the behaviours (crisscross collapse, unchanged days, anchor pinning + mid-anchor refusal, no-op <3 stops, rejected survival, never-worse guarantee, open-time tie-break). The per-leg travel chips between stops (km, minutes, cost — OSRM-corrected) and the mapped route this builds on already existed. Delta figures use the canonical font-weight ramp (650/750 are not loaded faces — caught by the design-system invariant after the base adopted it).

- **"Open in Google Maps" — a day's ride opens with turn-by-turn directions.** The travel panel (Timeline) and the map's day toolbar gain a Directions action that hands the ride to your own Google Maps — origin, your stops in order, destination, `travelmode=driving` (the URL API has no two-wheeler mode; switch once inside the app if you ride with it on). The URL is built from the engine's day journey, so synthesized legs are included: the Day-1 outbound from an anchor-only day and the final day's ride home both open complete. Waypoints are capped at Google's 9-waypoint limit with the true destination always preserved. New pure `googleMapsDirectionsUrl` in `lib/externalMaps.ts`, 5 node tests.

### Changed

- **The 1,500-line `TimelineTab.tsx` monolith is split into modules** (`restructure Phase 3`,
  same behaviour, prop-identity discipline preserved): the shell (364 lines — tab state,
  accordion open-day, mode, StopEditor, warnings grouping) composes
  `timeline/DaySection.tsx` (689 — day header/summary row, animated body, stop rows,
  suggestions), `timeline/TravelPanel.tsx` (471 — travel card + halt planner),
  `timeline/DaySpark.tsx`, `timeline/MoveStopModal.tsx` and `timeline/useTimelineMode.ts`.
  `DaySection`'s prop signature remains the shared contract.

### Fixed

- **Drag drop zones no longer make you hunt for the slot.** The insertion
  reading was a function of the *pointer* against the *live transformed row
  boxes*, with holes in it: where you grabbed the card shifted when the slot
  flipped, the gliding rows moved the very hit areas being aimed at (the
  target chased itself), and over the 8px margins or whitespace the reading
  froze until a row was found again. It is now a pure geometric function of
  the carried card's **centre** against each row's own midpoint measured in
  **stable layout** (`insertionIndexFor` + `rowLayoutBoxes`, lib/touchDnd.ts —
  `offsetTop` ignores transforms), and the whole list root is a live surface
  (`data-yf-list`), so the gap opens the moment the card's centre crosses a
  neighbour's centre regardless of grab point, and dropping in the gap
  between rows commits instead of springing back. Own-list drops now always
  consume the engine's carry rect, so a release at rest can no longer leak a
  stale rect into a later FLIP settle.
- **The drag gap-glide slid rows the wrong way.** The live sibling-glide
  offsets had their signs inverted in both the Timeline and the Board: rows
  between the carried slot and the cursor slid DOWN onto their neighbour on a
  downward drag (and up on an upward one) instead of toward the vacated slot —
  with the offset being exactly one row pitch, the displaced row landed
  precisely on top of the next one. The math now lives in a pure
  `glideOffsetPx` (lib/touchDnd.ts) with tests pinning the directions, and
  both surfaces consume it.
- **Forking a published itinerary no longer vanishes on reload.** Every trip copy inherited
  the source's `inviteCode` — and since invite codes carry a unique index
  (`idx_trips_invite_code`), forking any trip that had ever been invite-shared failed the
  `trips` insert, left a cache-only copy that toasted success anyway, and silently
  disappeared on the next reload (verified live: all three published trips on the production
  project carry invite codes). `buildTripCopy` in `src/store/store.ts` now strips
  `inviteCode` and `deletedAt` from every copy (a fork of a trashed source also used to
  arrive pre-trashed); `duplicateTripPersisted` / `duplicateTripPublicPersisted` report
  whether the rows actually landed, retract the copy on failure instead of leaving a zombie,
  and `forkPublication` toasts the truth. Pinned by `tests/forkPersist.test.ts`.
- **Forking from the Explore grid works now.** The grid cards fork via `tripById`, but the
  membership-scoped hydration only ever caches your own trips — every foreign publication
  answered "That itinerary is no longer available." `forkPublication` now falls back to
  `fetchSharedTrip` (public by definition) before giving up.
- **"Trip not found" is no longer the answer to a cache hiccup.** `TripWorkspace` opened
  strictly from the hydration cache, so a partial hydrate (a failed trips read on a flaky
  connection — including one that wiped previously-loaded trips, since the hydration patch
  overwrote good rows with an empty result) rendered "Trip not found" for trips that exist.
  The workspace now fetches the row directly on a cache miss (`fetchSharedTrip`; it merges
  into the cache and shows a loading state, with "Trip not found" reserved for genuinely
  unreadable trips), and hydration keeps the previous cache when the trips/memberships reads
  fail instead of overwriting them. Seeded demo trips whose membership insert fails are now
  logged instead of silently leaving invisible rows.

- **"Optimise day" no longer mutates the live trip while merely rendering.**
  The review of the optimise-day feature caught `optimizeDayOrder` renumbering
  `orderInDay` on the caller's stop objects — violating its own "input
  untouched" contract — while the Timeline calls it in a render-phase memo
  with the live store stops. On any day with a suggested improvement, that
  wrote the optimized order into the store outside the impact-preview gate:
  the day silently reordered on the next re-render without approval, and the
  preview then compared against the already-mutated state. The helper now
  clones the stops before renumbering (a regression test pins the contract),
  and a no-op ternary in its 2-opt objective is cleaned up.
- **Day routes on the map follow what the engine plans, not just the stored stops.** Selecting a day on the map drew only lines between that day's *stored* stops, so any day whose ride exists in the engine's synthesis drew nothing — the anchor-only outbound (Day 1 of a Kolkata → Mandarmani trip showed nothing at all when only the anchors existed) and the final day's ride home (Mandarmani → Kolkata, which the timeline's travel panel already described) were invisible on the map. Single-day routes now build from `buildJourney`'s points — origin → stops → synthesized destination — so every day the travel panel describes as a drive draws its route on the map, and stay days stay quiet.
- **Manually planned halts sit on the road now, not off it.** A halt added "after N km" was placed by interpolating straight-line km along the sparse stop-to-stop chain, while the km the travel panel displays (and the route the map draws) are OSRM/Google road km — on anything but a ruler-straight highway the halt landed at the wrong spot, visibly floating off the drawn route, and could even slot next to the wrong stop in the day's order. The routing layer's per-leg road geometry is now retained instead of discarded, the day's ride is assembled into one continuous road polyline (`dayRoadPolyline`), and halt placement, halt ordering, corridor-spot km and slack-pick km all measure along it — falling back to the old chord math only while routing hasn't resolved (offline/estimate). Roadside breaks stay exactly what bikers want: on-route points at your km, with the detour-to-a-named-spot checkbox still opt-in as before.
- **The Map tab's halt plan budgets time and picks days on road km too.** `planKm` already used the OSRM road total, but the wheel-time budget (`wholeTrip.min`) and the "which day does this km belong to" default still summed haversine estimates — on curvy routes the fatigue cadence ran ~15–40% short and halts could default to the wrong day. The routing legs already fetched for the map now also yield road-true total minutes and per-day road km (a leg is ridden on the day of its destination), with the journey sums kept as the fallback.
- **The Optimise-day preview speaks road km now.** Its before/after figures and "saves ~X km" were straight-line sums, unreconcilable with the travel panel's road distance shown on the same screen. The ordering objective stays straight-line (pairwise road km between arbitrary stops would need N² route calls), but every displayed number is rescaled by the day's road-vs-chord ratio from the corrected legs.
- **The Timeline's halt-spot scan is road-aware like the Map tab's.** Search anchors sample the day's road polyline when routing has resolved (chord anchors sat off-highway on curvy rides), Google mode runs one Search-Along-Route request with routingSummary detours instead of per-anchor scans, and the slack prompt's "cheapest detour" ranking measures detours asymmetrically against the road — all matching what the Map tab already did.
- **`package-lock.json`'s version field matches `package.json` again** (0.50.2 — the 0.50.x release cuts skipped re-syncing it; caught when a local `npm install` corrected the field).

## [0.50.2] - 2026-09-11

**The Android app drops the website's top bar entirely.** The floating topnav was website chrome — wrong inside the installed app. The signed-in shell now hides it completely; its controls relocate to the Profile page (a bottom-nav destination): theme toggle under Appearance, the in-app notifications list with Mark all read, and the account actions (Creator hub, Send feedback, Log out). Theme state is shared via a new `src/lib/theme.ts` hook so the web topnav toggle and the Profile card can't drift. The topnav — and the web — are byte-identical; it stays for signed-out users as the login entry. Pinned by a new `mobile-shell.test.ts` invariant. `versionCode 11 / 0.11-native`.

### Changed

- **The top bar is gone from the signed-in Android app.** `App.tsx` gates the topnav behind `(!isNative || !me)`; signed-out users and the web keep it.
- **Controls relocated to Profile.** Appearance (dark/light), in-app notifications (list + mark-all-read), and account (Creator hub / Send feedback / Log out).
- **Theme is shared.** New `useTheme()`/`setTheme()` in `src/lib/theme.ts` keep the web toggle and the Profile card in sync and paint the Android status bar.

## [0.50.1] - 2026-09-11

**The installed app no longer flashes the marketing website on launch.** The hydration ready-gate excluded the bare route unconditionally — a web-first choice (the landing paints instantly instead of a spinner) that backfired in the shell: every app launch rendered the website's home — its chrome and all — for as long as hydration took past the splash, before flipping to the app home. In the shell the loading block now covers the bare route, and an unknown deep link falls back to the app home instead of the landing. The web is byte-identical.

### Fixed

- **No more website flash at app launch (shell).** `App.tsx`'s ready-gate now covers the bare route when `isNative`: a signed-in user opening the app sees splash → loading → app home, never the marketing landing. Signed-out users still get the landing (it is the login entry).
- **Unknown deep links in the shell fall back to the app home**, not the marketing landing — same parity rule, pinned by two new static invariants in `mobile-shell.test.ts`. Android `versionCode 10 / 0.10-native` so phones update cleanly over 0.9-native.

## [0.50.0] - 2026-09-11

**Every trip edit finally sticks — the "Change saved but nothing changed" defect is dead.** `updateTrip()` treated *every* full-trip save from the impact-preview flow as a date change (a full `Trip` always carries truthy `startDate`/`endDate`), rebuilt the day grid from the *pre-edit* cached days, and overwrote the proposed reorder/delete/move in both the cache and the persisted row — while still toasting "Change saved". The day grid now reconciles only when the dates actually changed, and reconciles the *incoming* days, so reorders, arrow moves, drag-and-drop, deletes and cross-day moves all persist in real time and survive reload. Pinned by two regression tests that fail on the old code and pass with the fix.

### Fixed

- **Trip edits (reorder / arrows / drag-and-drop / delete / cross-day move) no longer silently discard themselves on Keep.** `updateTrip` in `src/store/store.ts` gated day-grid reconciliation on `patchFields.startDate || patchFields.endDate` — always truthy for the full-Trip `pending.proposed` that `keepPending()` / `moveToAnotherDay()` pass — then ran `reconcileDays(t.days, …)` over the *old* days and assigned the result back over the proposal. The fix compares resolved dates against the cached trip and skips reconciliation entirely when unchanged; when dates did change it reconciles `patchFields.days ?? t.days`. `tests/reconcile-days.test.ts` gains two regression tests (full-Trip reorder keeps the new order in cache + persisted payload; full-Trip delete keeps the deletion).
- **Board delete, in-place edit and tab order from v0.49.0 verified live on this release** (Board cards carry delete + edit, tab rail is Overview → Board → Map → Timeline).

## [0.49.0] - 2026-09-11

**The Board becomes a first-class editor, drag-reorder becomes trustworthy, and the entire open-issue backlog closes.** The Board tab can now add, edit and delete stops in place (sharing one stop-form implementation with the Timeline instead of a drifting copy) and moves to the front of the tab rail; the realtime echo-suppression guard is armed at commit time so a collaborator's stale echo can no longer revert an accepted reorder — the third and final symptom of that family; and all eight open issues close in one pass: two P1 data-integrity fixes (demo trips no longer seed into real accounts on a flaky connection; "Delete forever" finally confirms), five accessibility repairs (the unread badge and five warn-on-tint labels now pass WCAG AA, the cover-URL field is labelled, the notifications panel stops silently truncating at 12), a single APG tablist contract across all four tab surfaces, and Profile drops its empty desktop gutter.

### Added

- **The Board can now add, edit and delete stops without leaving the view.** The
  board had up/down reorder and a move-to-day modal but no way to delete a stop, no
  way to edit one, and its only "+ Add a stop" button navigated away to the Timeline.
  All three now happen in place: a delete button on each card routes through the same
  impact-preview flow as the Timeline's (so Keep/Remove remains the confirmation step),
  the card title opens the shared stop editor, and each day column's dashed foot zone
  is a click-to-add button while keeping its drag-drop role. The add/edit plumbing
  (`initialValues` / `legContextFor` / `dayIndexOfStop`) moved from TimelineTab's
  private scope into `lib/stopForm.ts` so both views share one implementation instead
  of drifting — the same drift that already made their rejected-stop handling disagree.

### Changed

- **Tab order is now Overview → Board → Map → Timeline.** The Board — the
  rearrange/edit/delete surface with the route visible — is the first stop after
  Overview; the Timeline becomes the deliberate, information-dense view you open when
  you need timings and legs, rather than the default editing surface. Deep links are
  unaffected (tabs are addressed by slug, not position).

### Fixed

- **Board and Timeline drag-reorder no longer reverts after you accept the change.**
  `persistTripFieldNow` (and the trip INSERT path, `persistTrip`) recorded its
  realtime echo-suppression stamp *after* awaiting the row write, so the guard only
  covered the moment the write **resolved** — the whole server round trip was
  unguarded. An echo that arrived in that hole was read as a collaborator's edit and
  replaced the freshly reordered `days` with the stale server row, so an accepted
  reorder visibly snapped back. The stamp is now taken *before* the await. This also
  fixes the reported cross-day drag, which failed for the same reason: a cross-day
  drag routes through the identical persist → realtime path.

- **Reorder no longer reverts from an echo that lands *during* the debounce window.**
  The previous fix armed the echo-suppression stamp only inside `persistTripFieldNow`,
  i.e. when the debounced row write fired ~600 ms *after* you clicked Keep. A
  `postgres_changes` echo that arrived in that 600 ms gap — before any write was even
  issued — found no stamp and was therefore *not* suppressed, so it reverted the
  optimistic reorder in the cache and the trailing debounced write then persisted the
  reverted (stale) order. The stamp is now also taken synchronously inside
  `persistTripField`, at the moment the change is committed, so the guard spans the
  whole commit → write → echo span. This is the residual symptom that survived the
  first fix on the live preview. (A negative-control test fires a stale echo during the
  gap and fails on the old code.)

- **Timeline reorder now drops where you put it.** `useReorder`'s card-level drop
  passed the *hovered card's index* straight to `onMove`, with no adjustment for the
  dragged item's removal shift. Dragging **downward** therefore landed one slot too
  far — dropping a card onto its immediate neighbour moved it when the pointer was
  aimed at a no-op, and dropping onto the last card overshot the end. Upward drags
  were unaffected, which is why the bug read as intermittent. A drop now resolves the
  hovered card to an insertion slot, using which half of the card the cursor is over.

- **#94 (P1): a flaky connection can no longer seed demo trips into a real account.** `hydrateFromSupabase` trusted "the trip list came back empty" even when the membership or trips query had *errored* — so a sign-in on a bad connection could write ten fake trips alongside the user's real ones (right after telling them "some data didn't load"). The seed condition now consults a `tripCountUnknown` flag set by any query whose failure could fake an empty account; a genuinely new account (clean reads, zero trips) still seeds exactly as before. Three regression tests in `store-sweep.test.ts`: the membership-fail and trips-fail cases block the seed, the clean-empty control still seeds.
- **#89 (P1): "Delete forever" in the Trash is confirmed now.** It was the app's only irreversible, protection-free action — one click destroyed the trip, its votes, decisions, activity and publication with no dialog and no undo (every other destructive path confirms first; trashing even offers undo). It now opens a dedicated `ConfirmDialog` whose copy states plainly that this cannot be undone.
- **#90: the unread badge is readable.** White on saffron measured 2.14:1 (light) / 1.97:1 (dark). Same lightness-not-hue fix as the selected chips: dark ink (`#06251F`) on the identical bright fill — 7.6:1 / 8.3:1.
- **#85: the same `--warn`-on-tint failure was fixed at the source once and never propagated.** Five sibling surfaces (`.day-warn-pill`, `.day-rail-chip.warn`, `.share-intent--saffron`, `.stop-num.cat-food`, `.gi-stat.hot b`) measured 3.48–3.69:1 in light theme; all five now share the `.chip-saffron` precedent's deeper amber (`#8F5B06`, 5.1–5.4:1) in one light-theme-only rule. `.day-warn-pill.sev-high` (danger on coral, 4.54:1) is excluded — it already passes.
- **#88: the cover-image URL field is labelled for screen readers.** It sits two levels below `Field` (a custom URL box inside a picker div), outside `Field`'s direct-child label wiring, so SR users heard "edit text, blank". Explicit `aria-label="Cover image URL"` with a comment naming the constraint.
- **#84: the notifications panel is no longer silently lossy.** It capped at 12 items with no path to older ones — the badge could count 27 while 12 were reachable. Past-12 accounts now get a "Show all N notifications" disclosure row inside the popover (the full list is already in the store, so this is pure disclosure); the list resets to the recent view when the popover closes, and the expanded view caps its height to the viewport.
- **#86: the Profile page stopped reserving an empty 340px column.** Its whole body is one column inside a `1fr 340px` grid — at desktop widths the right track sat empty and the page read as half-finished. Now a single readable column (`.profile-col`, max-width 720px) instead of the gutter.
- **#87: one ARIA tablist, not four dialects.** Only ShareTab implemented the APG contract; `Auth` declared `role="tablist"` over `aria-pressed` buttons (spec mismatch), `AdminPage` used `aria-pressed` on real tabs, and the workspace tab bar had `aria-selected` but left every tab in the tab order with dead arrow keys. ShareTab's exact behavior (roving tabindex + Arrow/Home/End with automatic activation) is now the shared `hooks/useTablist.ts` primitive, applied to all four surfaces; the three panels got their `role="tabpanel"` + `aria-labelledby` links too.
- **`.env.example` now exists — the documented first step works again.** The README's
  Getting-started block and the runtime hint in `src/lib/supabase.ts` both told contributors
  to `cp .env.example .env.local`, but the file had never been committed, so the first command
  a new contributor runs failed. Adding it needed a `.gitignore` change too: the bare `.env*`
  rule swallowed the template (and would have swallowed it forever, silently). A
  `!.env.example` negation now tracks the template while `.env`, `.env.local`,
  `.env.production` and `.env.*.local` stay ignored — verified with `git check-ignore`.
  The template documents all six `VITE_*` variables the app reads (two required, four
  optional with their fallbacks), and ships `https://YOUR-PROJECT.supabase.co` as its
  placeholder on purpose: `isRealSupabaseUrl()` already rejects anything containing
  `YOUR-PROJECT`, so an unedited copy fails loudly instead of silently.

### Changed

- **README corrections from a full source audit.** A v0.48.0 section was added (the release
  narrative had stopped one release short, leaving the newest work invisible while two older
  runs had sections of their own); the "Hotel/flight booking — placeholder buttons only"
  constraint was reworded because no booking UI exists (stops carry a *needs booking* flag);
  `AdminPage.tsx`, `CreatorHubPage.tsx` and `NativeHome.tsx` were added to the project-
  structure map, which had omitted three files that each own a feature the README describes.

## [0.7.0-native] - 2026-09-11 (`v0.7.0-native` — APK attached to the GitHub release)

**The web app is now an installable Android app.** Capacitor 8 wraps the Vite build in a native shell (`app.yatraflow.mobile`), CI builds a signed APK on every push to main and every `v*` tag, and every capability the WebView does badly — clipboard, share sheets, geolocation, vibration, external links, system bars, the back button — is routed through a real native plugin instead. The web app runs the exact same code and never touches a plugin: every native path is behind a platform check with the browser API as fallback. Signed-in users on a phone get a task-first app home instead of the marketing landing.

_History note (2026-09-11): a stub for the pre-`0.42.0` record is deliberate and tracked in
`docs/history/README.md`. Do not bulk-rewrite this file with a script — that path has eaten
leading bytes out of code spans twice (see `adf5f66` and the `[0.43.0]` repair note below)._

### Added

- **A native bridge with one job: make the app's web-API calls work on-device.** `lib/native.ts` centralises clipboard (`nativeCopyText`), image clipboard (`nativeCopyImage` — the plugin takes a full data URL, the browser path takes a `ClipboardItem`), text and file share (`nativeShareText`, `nativeShareImage` — the Share plugin only accepts `file://` URLs, so the trip-bill PNG is written to the cache dir via the Filesystem plugin before the native sheet sees it), one-shot and streaming location (`nativeLocate`, `nativeWatch`) and external-URL opening (`openExternal`). Every helper no-ops or falls back on the web, so the same bundle ships to both platforms. Call sites migrated: CopyButton, the Share tab's snapshot link, Plan Bench's copy-text and bill-image share chain, and the map's locate button.
- **App-shell wiring (`lib/appShell.ts`): splash, system bars, Android back.** The launch splash hides when the store's ready-gate flips (2.5s worst-case cap), so it never lingers behind a loading block. System-bar styling rides Capacitor 8's core `SystemBars` API — one call styles status + navigation bars, and it replaces the separate `@capacitor/status-bar` plugin the scaffold started with (one dependency lighter). The Android back button maps to the app's own UX: open overlays close first, then the WebView history walks back, and at the first entry a second press within 2s exits.
- **"Locate me" — a live GPS layer on the trip map.** A toggle chip by the map key starts a continuous position watch: the user renders as a pulsing blue dot, the camera follows the latest fix until *they* pan away (self-initiated `movestart` releases the follow; the layer's own `easeTo` never counts as a pan), and toggling off stops the watch entirely so GPS burns nothing idle. On-device the stream is the plugin's fused provider behind the system permission dialog; on the web it's the plain browser watch. A denied permission turns the dot red. One-shot locate on the map controls was migrated to the same bridge.
- **Haptics that actually fire on Android.** The app always had `navigator.vibrate` calls — which Android WebViews don't implement, so every one was silently dead in the APK. `lib/haptics.ts` now routes the same named intents (tick / select / toggle / success / surprise / warn / heavy) through `@capacitor/haptics`: a delegated `pointerup` listener gives every button, chip and tab in the tree (lazy pages included) a light tick; toasts buzz success/warn; confirm dialogs thump heavy; long-press drag pickup gets the strongest pattern. The web keeps the Vibration API path, reduced-motion still silences everything.
- **A CI pipeline that produces an installable, updatable APK** (`.github/workflows/yatraflow-apk.yml`). Builds run on every push to main and every `v*` tag: `npm ci` → web build (env keys from repo secrets) → `cap sync android` → signed `assembleDebug`, uploaded as `YatraFlow-v<tag>.apk` on tags (branch builds fall back to versionName + short SHA). The APK release cadence is decoupled from Vercel web deploys without forking the code. The web bundle needs `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/`VITE_MAPPLS_KEY`/`VITE_GOOGLE_MAPS_API_KEY` at compile time; they live only in gitignored local files, so CI writes a `.env.production` from secrets — the first APK was built keyless and greeted testers with the auth page's "no backend configured" banner.
- **Android sizing pass.** Coarse-pointer devices get Material's 48dp touch-target floor on the compact controls (`.btn-sm` ~33px, `.icon-btn` 40px, chips ~28px) via invisible negative-margin hit-area extensions — visuals unchanged. Bottom-sheet modals cap their height and padding to the safe area so the last row clears the gesture bar. The My Trips page reworks its phone layout: header stacks with a full-width primary CTA (demo-trips collapses to icon-only), When/Sort selects split one row, cards go single-column without hover-lift.
- **A task-first app home for the shell** (`pages/NativeHome.tsx`). The website's `/` is a marketing landing — right for a browser first-timer, wrong for a signed-in app user. In the native shell the root route renders an Android-grammar home instead: greeting by time of day with an unread-notification bell and avatar, a two-tile action row (Plan a trip primary / Explore secondary), and trip rows ordered live → upcoming (soonest) → recently-edited, each showing phase (a steady "Live now" dot), per-person cost, crew size and start date — capped at six with an "All N trips" row. Empty accounts get a one-tap onboarding card. Platform-gated at the router (`isNative && me`), so the website is byte-for-byte unchanged.

### Fixed
- **Updates install — every build now signs with one stable key.** GitHub's runners generate a *fresh* debug keystore per run, so every APK had a different signature — and Android refuses to update an app whose signature changed (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), silently keeping the old build. On-device this read as "nothing I do changes anything". One PKCS#12 keystore is generated once, stored in repo secrets (base64), materialised by CI where gradle expects it, and `signingConfigs.stableDebug` signs every debug build with it. Verified end-to-end: the shipped APK's signature block contains exactly that certificate. The signing config lives in `android/app/build.gradle`; releases bump `versionCode`/`versionName` there (this release: 7 / "0.7-native") so builds are visibly distinct under Settings → Apps.
- **External links did nothing — target="_blank" is a no-op in a WebView.** WebViews create no new window, so the Maps button, stop source links and social links went nowhere on tap. All external links now route through `openExternal()` (`window.open`), which the Capacitor bridge converts into an `ACTION_VIEW` intent — Maps opens in the real app or browser.
- **Content sat under the system bars (Android 15 edge-to-edge).** Android 15 forces the WebView full-bleed behind translucent bars, but the WebView reports `env(safe-area-inset-*)` as **0** — the pre-existing safe-area guards compensated for nothing, so the topnav tucked under the status bar and the last page row under the gesture bar. Capacitor's `SystemBars.insetsHandling: 'css'` injects real `--safe-area-inset-*` values; every fixed/sticky call site now consumes them via a `var()` → `env()` → `0px` fallback chain, and the topnav's sticky offset and the app-shell's bottom padding follow the inset. (One `useStoreReady()` call that had briefly duplicated in App.tsx during this work was consolidated back.)
- **The homepage lagged badly in the shell — the desktop choreography is now budgeted for phones.** The landing page layered 18px backdrop-blur glass across ~27 surfaces, two 340–380px blobs drifting under an 80px blur, an infinite ticker, dash-animated SVG road and odometer digits — a desktop GPU show that janked a phone WebView. `@media (pointer: coarse)` and `.native-shell` (set on `<html>` before first paint in `main.tsx`) cap every oversized blur at 8px, freeze the blobs and ticker as static washes, and the below-fold landing sections skip layout/paint entirely until scrolled near (`content-visibility: auto` with intrinsic sizes). The website keeps the full look.
- **A yellow smear bled through the nav behind the logo.** The landing canvas paints a peach radial at 88%/28% — directly behind the 58%-opaque glass nav pill, which on a small screen read as a stain, not the intended wash. In the native shell the canvas is a flat cream ramp and the nav pill is near-opaque (light and dark variants), so it reads as a solid Android top bar.
- **The thick right-edge scrollbar is gone.** Android apps never draw one — the finger is the scroll indicator. The shell hides page scrollbars in CSS *and* at the WebView level (`MainActivity` disables the view's scrollbars and overscroll glow), so scrolling is pure content motion.
- **Notifications stalled while backgrounded.** Android freezes the WebView when backgrounded; Supabase's realtime websocket dies without an event, so anything that happened while away never arrived until a manual refresh. `resumeSync()` (full re-hydrate + realtime re-subscribe, bypassing hydrate's same-user dedupe with a fresh generation) now runs on Capacitor's `appStateChange → active`. Anonymous and mid-auth-switch sessions correctly skip it.
- **Two CI traps worth recording.** (1) `gradlew` lost its executable bit in the Windows checkout — `Permission denied` on the Linux runner; fixed with `git update-index --chmod=+x` plus a defensive `chmod` in the workflow. (2) Storing the keystore secret: `gh secret set` was fed the **raw binary** PKCS12 — an invalid-UTF-8 secret makes GitHub's job-creation die instantly (`startup_failure`, zero jobs, no logs to read), which killed every build until a bisect with secret-free workflow variants isolated it. The secret is ASCII base64 now; secrets ride via step `env:` rather than inline `${{ }}` interpolation as defense in depth.

### Added

- **The Android shell scaffold and its seven native plugins.** `android/` (Capacitor 8, compileSdk 36, minSdk 24) and `capacitor.config.ts` with `SystemBars.insetsHandling: 'css'`; manifest permissions for coarse/fine location (locate-me) and vibrate (haptics). Seven plugins: app, clipboard, filesystem, geolocation, haptics, share, splash-screen. Keys never enter the repo; the keystore file itself is gitignored.

## [0.48.0] - 2026-09-11

**A consistency-and-shell release: the design system collapses to one green, one kicker recipe and four blur tiers, and the Android shell gains a real bottom navigation bar — with map gestures that stop fighting the page scroll and a keyboard that resizes the WebView.**

### Added
- **Execution playbook for the invites & onboarding milestone (M9).** A new
  `docs/PLAN-INVITES-ONBOARDING.md` guide turns the approved plan into an
  executor-ready playbook: one unified `platform_invites` entity shipped as R1
  creator invites → R2 referral → R3 invite-only gate, with phase-by-phase
  implementation steps (migration + RLS + RPCs, `src/lib/accessCode.ts`, the
  `#/access/<code>` gate, the masteradmin Invites-tab rebuild, creator
  onboarding flush, tests) and per-phase acceptance criteria. ROADMAP picks up
  an M9 strategic-track section plus an idea-pool pointer; docs/README indexes
  the new plan.
- **A real bottom navigation bar in the Android shell.** `components/BottomNav.tsx`
  gives the installed app the primary navigation it never had: four Material
  destinations — Home, My trips, Explore, Profile — in a fixed 58px glass bar
  above the gesture bar, four equal columns, icon over an 11px label, the active
  one tinted like a selected tab, `aria-current="page"` for assistive tech, and
  a 48px tap floor per item. It is gated on `isNative && me` exactly like the
  shell home, so the website never renders a byte of it. `/trip/:id` counts as
  My trips (the workspace is opened from that list and back returns there);
  every other route lights nothing. The floating pill is hidden in the shell,
  but the hamburger tray stays as the overflow — Plan a trip, Creator hub and
  Log out all remain reachable.
- **One bottom-chrome offset every page-level bottom layer clears.**
  `--shell-nav-h` is the shell's navigation row (58px inside `html.native-shell`,
  **0px** everywhere else) and `--bottom-ui-offset` is that plus the device's
  gesture bar, so a single `var()` now lifts the app shell's padding, the toast
  zone, the AI button, the Plan Bench dock, the sticky settings save bar and the
  trip dock above the new nav. The overlays that deliberately own the true bottom
  edge — modals, the impact sheet, the AI drawer, the expanded map — keep the raw
  inset. `scroll-padding-bottom` moves with it, so focus and scroll-into-view
  landings clear the bar too.
- **`tests/mobile-shell.test.ts`** — 19 static invariants over the shipped files
  pin the whole pass: the four destinations and their native gate, the hidden
  pill and the surviving tray, the safe-area `var()` fallback chain (no bare
  `env()` left anywhere), the offset tokens and their exact consumer list, the
  cooperative-gesture switch, and the manifest's keyboard mode.

### Changed

- **Design-system consistency pass: fonts, casing, glass and colour.** One green
  (CTI teal `#0D8D82`) now drives primary buttons, focus rings and form
  accents. Glass blur is unified into four tiers (chrome 18 / panel 14 / chip 8 /
  scrim 3) with every translucent surface mapped to one. Card and popover radii
  touched by the pass snap to the token set (12/18/24), and a handful of one-off
  card radii remain, staged with the spacing sweep. Mobile row actions rise to
  40px. Every micro-label shares one recipe (10.5px / 700 / .06em, uppercase via
  CSS). Type- and spacing-token scales join the existing token ladder.
- **The shell navigates from the bottom, so the floating pill steps aside.** The
  `.nav-links` pill is hidden under `html.native-shell` — a class gate, not the
  ≤720px width gate, because the shell also ships to tablets and landscape — and
  the four destinations live in the new bar instead. Nothing was deleted: the
  pill is still the website's primary nav, and the hamburger tray still carries
  Plan a trip, Creator hub and Log out.
- **`.app-home-section` stops being a one-off.** The shell home's section
  heading carried its own 13px / 800 / .08em / uppercase recipe; it now joins the
  unified kicker block (`--kicker-size` / `--kicker-weight` / `--kicker-tracking`,
  uppercase via CSS) with its margin and colour kept.

### Fixed

- **Off-scale font weights flattened the hierarchy, and the declarations lied
  about it.** The stylesheet declared 550 (×3), 650 (×20), 750 (×11) and Inter
  800; the font link loaded none of them — but CSS font matching resolves an
  unloaded weight to the nearest real face (550→600, 650→700, 750→700,
  Inter-800→700), so **nothing rendered as browser-synthesised faux bold**. The
  real defect was a flattened hierarchy and declarations that lied about it.
  Inter now loads 400–800 and every declared weight rounds to a loaded face.
- **Literal ALL-CAPS strings** are retyped in sentence case across the app
  (public itinerary, Explore, trips list, Plan Bench, trip settings, timeline),
  and the uppercase look now comes from CSS `text-transform`, which also stops
  screen readers spelling the words out.
- Casing and typography nits: "Trip board", "Master admin", "Explore
  itineraries", capitalised helper sentences, typographic apostrophes.
- **An inline map no longer swallows the page scroll.** A one-finger drag that
  started on the trip map panned the map and left the page stuck. Every embed now
  opts into MapLibre's cooperative gestures on touch devices — one finger scrolls
  the page, two fingers pan the map, and MapLibre paints its own "use two
  fingers" hint — while the expanded fullscreen map hands normal gestures back
  (there is no page scroll left to protect once it owns the viewport). The gate is
  the pointer type, so a mouse-driven desktop keeps plain wheel-zoom and
  one-finger drags unchanged.
- **The soft keyboard resizes the WebView instead of floating over it.** The
  manifest left `windowSoftInputMode` to the platform's `adjustUnspecified`
  heuristic, which picks pan-or-resize per window; `MainActivity` now pins
  `adjustResize` so the layout reflows deterministically and a focused field is
  never left behind the keyboard.
- **The Create-trip dock was the last fixed surface reading `env()` directly.**
  `.trip-dock` — the fixed bar carrying **Print bill** and the primary
  **Create trip** CTA — was the one fixed/sticky call site still reading
  `env(safe-area-inset-bottom)` directly, a value Android WebViews report as
  `0`, so the bar sat under the gesture navigation bar and took its primary CTA
  with it. It now uses the same `var()` → `env()` → `0px` chain as every other
  call site.

## [0.47.0] - 2026-09-10

**A cleanup-and-polish release: deletes become reversible, the app writes faster, and the whole backlog of small wins lands at once.**

### Added
- **Browser push notifications (local Notification API, no service worker).** Profile & settings gains a Notifications card with an explicit opt-in toggle: enabling it requests OS permission *in the click* (browsers ignore prompts outside a user gesture) and stores `yatraflow_browser_notif=1`. From then on, new unread in-app rows for the session user also fire an OS-level ping — but only when the tab is in the background (`document.hasFocus()` guard, so a focused tab never double-announces via bell + OS), only once per notification id (per-session seen-set, seeded at login so the existing inbox never replays), and never for rows already marked read. New pure `src/lib/browserNotifications.ts` (13 node tests: flag round-trip, support/permission guards, prompt gating, dedupe vs read-flag vs focus matrix); wiring is a small `useEffect` in `App.tsx` off the existing subscribed notifications slice.
- **A "Send feedback" link** in the account menu and the landing footer. It opens a `mailto:` to `support@yatraflow.app` (the same address the password-reset flow already uses) pre-filled with the app version and current route — the version is inlined at build time from `package.json` via a new `__APP_VERSION__` Vite `define`, so a report is reproducible without the reporter typing a word. Closes the P4 "feedback button" pool item.
- **Explore itineraries pagination.** The community grid renders 12 cards at a time with a "Load more · N more" button instead of dumping the whole catalog; the window resets to the first page whenever a filter/sort changes (but not on a live realtime insert, so a new publication doesn't yank you back to the top). Closes the P4 "Explore pagination" pool item.
- **In-map place search (CTI §6.5).** The Map tab's "Nearby ideas" card gains a free-text search box over the same provider facade (`searchPlaces` — Google when keyed, the free stack otherwise), with the top 5 results listed inline and a "+ Add" that drops the place into the existing pick-a-day flow. Closes the "In-map place search" deferral.
- **Map popup → Timeline/Board cross-links (CTI §6.5).** Clicking a stop pin now raises a compact popup over the map offering "Open in Timeline" and "Open in Board", jumping straight to those tabs — the "compact selected-stop popup with direct navigation" the design doc asked for. Closes the "Map popup cross-links" deferral.
- **Per-decision trip context + offline recommendation (CTI §6.8).** Open decision cards now show a grounded one-liner ("Xh Ym on the road · ₹Z total · health 82/100") and a deterministic, data-grounded recommendation — the option with the smallest declared cost, then time, else the leading vote — labelled "(offline)". New pure `src/lib/decisionGuide.ts` (7 node tests) so the recommendation is testable and honest; M5's configurable LLM assistant will layer on top. Closes the "Per-decision impact panel + grounded assistant" deferral.
- **Trip trash + 30-day purge (soft-delete).** "Delete" now moves a trip to the trash instead of hard-deleting: the row's `deleted_at` tombstone is stamped and a restrictive RLS policy hides it from normal reads, so it survives 30 days for restore before a `purge_trashed_trips()` sweep hard-deletes it. My Trips gains a **Trash** view (populated from a new `get_trashed_trips()` RPC) with per-trip **Restore** and **Delete forever** (`restore_trashed_trip` / `purge_trashed_trip` RPCs). Two migrations ship the backend (`20260910_trip_trash.sql` — column + policy + bulk purge; `20260910_trip_trash_rpc.sql` — per-user RPCs); the client paths are probe-gated on the `deleted_at` column so un-migrated/test databases keep the old hard-delete behaviour.

### Changed
- **Bursty trip edits now write to Supabase once instead of once per keystroke.** `persistTripField` coalesces rapid edits to the same trip (drag-reorder, settings keystrokes, undo/redo chains) into a single trailing 600 ms row UPDATE whose snapshot is always the freshest cache state; deletes and member changes stay immediate. Pending writes flush on `visibilitychange(hidden)`/`pagehide` (guarded — the node test env has no DOM) and via an exported `_flushTripWrites()`. A `_setTripWriteDebounceMs(0)` test hook restores immediate writes for the existing write-through suite, and a new `tests/store-debounce.test.ts` pins the coalescing + flush behaviour (3 tests). Closes the P4 "debounced store writes" pool item.

## [0.46.0] - 2026-09-09

**The masteradmin console: command over the whole app, from one unlinked route.** `#/admin` — typed, never linked — gives the two administrators a god-view over every user, trip, invite, publication and audit row, with every destructive action behind an audited, role-rechecking RPC and an append-only audit log. Shipped alongside PR #81's v0.45.0 create-flow release on the same day; the backend migration was applied and verified live before the PR opened.
### Added
- **A masteradmin console (`#/admin`) gives you command over the whole app.** A new private route (never linked from any nav — admins type it; non-admins fall through to the landing page) surfaces seven tabs driven by the JWT `app_metadata` role, not a database column: **Overview** KPI tiles (users, trips, private/public split, published count, Explore views/forks, open suggestions/decisions, avg crew per trip, 7d activity with the prior week, creators, disabled), **Users** (searchable directory with owned-trip counts, creator/disabled/you chips, make/unmake creator, and a reversible disable that signs the account back out — v1's "delete", hard deletion deferred), **Trips** (every trip, owner, crew, visibility, date, plus make-private/make-public and a type-to-confirm permanent delete that keeps an audit snapshot), **Invites & sharing** (30-day member-join velocity over the member slice), **Content** (the published catalog with an admin unpublish), **Analytics** (activation, collaboration, publish and view→fork funnels plus a 12-week signup/trip growth table), and an **Audit log** showing every admin action with who, what, when and the target. Every destructive button calls an audited `SECURITY DEFINER` RPC and renders through the plain existing cards/tables — no new component system.
- **The masteradmin role is a JWT claim, not a self-grantable column.** The role lives in `auth.users.raw_app_meta_data` (`{"role":"masteradmin"}`), so RLS reads it via `auth.jwt()` and there is deliberately no `is_admin` boolean on `profiles` — a column would be promotable through the "profiles update self" policy. Administrators hydrate the **entire** app (all trips, all collab slices, the audit log); everyone else keeps the membership-scoped cache. Under the hood: `is_admin()` + `is_disabled()` RLS helpers, RESTRICTIVE deny policies on every table for disabled accounts, permissive admin read/write bypass policies, an append-only `admin_audit` table, and six audited RPCs (`admin_set_disabled`, `admin_set_creator`, `admin_set_trip_visibility`, `admin_remove_member`, `admin_unpublish`, `admin_delete_trip`) — each re-checks the role inside, refuses self-harm / last-admin removal, and writes the audit row in the same transaction before the effect. Grant/revoke are SQL one-liners in `supabase/migrations/20260909_masteradmin.sql` (hasnaina955@gmail.com + shabtab@outlook.com documented there; sign out/in to mint the new JWT).

## [0.45.0] - 2026-09-09

**The create flow gets its ticket, invites get their codes, and trip settings get the bench.** Creating a trip becomes the Trip Ticket — a live boarding-pass starter that prints its rough bill on demand and seeds your timeline; invites shrink to trip-shaped codes with a join flow that actually completes; and Trip settings is rebuilt on the Plan Bench's own controls with editable dates that reconcile the day grid. My Trips gets its search/filter/sort back, car rental joins the transport modes, and two reliability fixes land: the pre-patch `updateTrip` persistence bug and the auth-refresh logout race.
### Added
- **Trip settings is now the Plan Bench, inside your trip.** The Share tab's settings
  panel was a flat stack of twelve look-alike fields with Save parked below the fold. It
  now speaks the landing calculator's own control language — the same classes at the same
  proportions, nothing re-invented: eyebrow-headed blocks carrying a big live value, the
  transport-mode icon grid (icon, name, ≈speed), the 1–12 travellers crew buttons, slider
  dials with drag bubbles for budget and fuel, and the pill rail for travel style. A sticky
  **settings bill** on the right mirrors every choice as you make it — the group budget
  (₹ × head-count, live), what the date range will do to the day grid, and whether costs run
  on fuel or per-km fares — so the outcome is readable *before* saving rather than after.
  Below 980px the receipt drops under the controls; Save rides a sticky, safe-area-aware bar
  spanning both columns. Two shared primitives came out of it (`RangeDial`, `StickyFormBar`
  in `ui.tsx`); everything else is the bench's own CSS, so the two surfaces can no longer
  drift apart. The publish editor keeps the matching density: neutralised field margins, a
  2-column free-preview day grid, inline styles replaced by tokens.
- **Trip dates are finally editable after creation — and the day grid follows them.** Trip settings (Share tab) gains Start/End date pickers. Lengthening the range appends empty days at the end; shortening drops trailing *empty* days only — a day holding stops or a fixed commitment is load-bearing and blocks the shrink with a toast naming the day ("Day 4 still has stops — move or delete them before shortening"), rather than silently deleting a user's plan. Indexes re-sequence after any change. The End-date field's live hint shows what the save will do ("Adds 2 empty days at the end" / "Drops 1 empty trailing day"). New pure `reconcileDays` helper in the store (11 node tests: grow/shrink, load-bearing stops and commitments, invalid and inverted dates, 1-day ranges).
- **My Trips search, filters and sort (restored).** The upstream squash-merge of the on-the-road PR carried the calendar/print exports but silently dropped this file, so My Trips had reverted to a bare recently-edited list. Restored from the fork's `feat/on-the-road` branch: a search box (name, start/destination, and every stop title), travel-style chips with counts (Explore's pattern), a When filter (upcoming & live / past / drafts — date-bucketed on the trip's end date so an in-progress trip counts as upcoming; dirty dates count as drafts), and sort by recently-edited / name / longest / budget low→high / high→low. Filtering to nothing shows its own "no trips match" empty state with a clear action, distinct from the no-trips onboarding. Local view state only (a private page — no URL sync, unlike Explore's shareable filters).

### Fixed
- **`updateTrip` persisted the pre-patch trip, not the edit.** The settings save path persisted the *current* trip row and only then applied the patch to the in-memory cache — so every Trip-settings edit (name, budget, cover, day titles…) reached the database only if a *later, unrelated* write happened to persist the trip again; otherwise it silently vanished on reload. Found while wiring the date fields: the flow now mutates the cache first and persists the draft that already contains the patch, pinned by a write-through test asserting the DB payload carries the *new* budget.
- **The bench's selected controls failed AA contrast in *both* themes.** The saturated
  selected states (`.bench-mode-btn.on`, `.bench-crew-btn.on`) painted white on teal-600:
  4.08:1 in light and 2.46:1 in dark against the 4.5:1 floor. The pale-tinted ones
  (`.bench-toggle.on`, `.bench-stay-row.on`) passed light at 5.14:1 but fell to 4.08:1 in
  dark, because teal-700 *is* the bright shade there. Fixed at the source rather than
  per-surface, since the same classes now render on the landing hero and in Trip settings:
  light fills step down to teal-700 (5.84:1), and a dark-theme override flips the saturated
  fills to the near-black ink the pill-nav glider already uses (#06251f on #2BB8AC = 6.62:1)
  and the tinted ones to teal-600 (5.55:1). Every ratio computed from the token values.
- **Pill navigation is readable in light mode.** Inside a `PillNav` the active chip's background is painted by the glider — pale teal in light mode — but the chip inherited `#fff` ink from its selected style: white on near-white, ~1.2:1. The Creator Hub and Group Input filter pills were the visible casualties. The active chip now carries deep-teal ink on the pale glider (5.05:1); dark mode keeps its saturated glider with dark ink. The new settings tiles/stepper were switched to the same tinted-selected pattern after computing their filled style at 4.1:1 (light) and 2.6:1 (dark) — both failing AA.
- **Per-day cost bars got the sheen.** The "Where the money goes" category bars sweep a calm light gradient; the per-day bars above them were the only budget bars without it (a bare width transition only). Both now share the same `barSheen` sweep; the global reduced-motion guard freezes it as before.
- **Every enum the UI renders is now sentence-cased.** Trip Settings' transport-mode and travel-style dropdowns showed raw machine values — "car", "food-focused" — because the form never ran any label formatter; the Plan Bench masked its raw values with CSS `text-transform` but carried the same debt. The root cause was systemic: **thirteen** private copies of the same three formatters had drifted apart (StopEditor's replaced only the *first* hyphen, rendering "Transport-hub"). They collapse into one `lib/labels.ts` (`cap`, `titleCase`, `statusLabel`), with tests pinning the exact wording. The Trip Settings fix also had to add the missing `value=` attributes — without them an `<option>`'s value is its *text*, so capitalising the label alone would have written "Car" into `trip.transportMode` and corrupted the data model.

## [0.44.0] - 2026-09-08

**The numbers you actually ask mid-trip, answered where you're planning.** The Budget tab now says what is still safe to spend today, timeline day headers show what each day costs and how long you'll be at its stops — and three reliability fixes make already-open tabs survive a deploy while public itinerary pages and invite links finally work for people who aren't members yet.

### Added
- **"Safe to spend / day" pacing tile on the Budget tab.** The metric strip gains a fifth tile answering the one question a running trip actually asks: given the group's target and what's been spent, how much can we still spend each remaining day without blowing the budget. Backed by two new pure engine helpers — `daysRemaining` (today counts as a full remaining day; dirty `startDate`/`endDate` strings clamp to the day count instead of returning `NaN`, and a finished trip returns 0) and `safeToSpendPerDay` (returns `null` when no per-person target is set, so the tile honestly asks you to set one in Trip settings rather than inventing an infinity). Overspend renders the figure in the danger colour. Strip goes 4 → 5 columns with new 1400px / existing 1100px responsive steps.
- **Per-day cost and time-at-stops chips on timeline day headers.** Each day header now carries two quiet metadata pills — "≈ ₹X" (tooltip splits travel from day costs incl. entry fees) and "Xh Ym at stops" (visit time plus buffers; driving time stays in the day summary line) — so the numbers the engine already computes (`computeTotals().byDay` and `simulateDay` dwell) surface where the plan is actually edited. Both hide while a day is collapsed, keeping a folded header calm, and the dwell chip drops out below 720px.

### Fixed
- **Open tabs survive deploys instead of crashing.** Every deploy replaces the hashed lazy chunks, so an already-open tab's next lazy import (Board, map, any page) 404'd with "Failed to fetch dynamically imported module" — and since the browser caches the failed module fetch, "Try again" could never recover; only a manual reload worked. The error boundary now recognises stale-chunk failures and reloads into the fresh deploy automatically (once — a session flag guards against reload loops; if the reload itself fails you get an honest "YatraFlow was just updated" screen with a reload button). Real bugs keep the existing recovery UI.
- **Public itinerary pages and invite links work again for non-members.** The membership-scoped hydration (the v0.41 anti-bloat fix) deliberately keeps other people's trips out of the cache — which silently broke every flow that needs them: an anonymous visitor opening an Explore card hit "Itinerary not found", and an invite link showed "This invite link is broken" for anyone who wasn't already a member (the join itself reads the cached trip). Both pages now fetch the trip on demand (`fetchSharedTrip`): a direct row read covers owner/member/public trips, and a new `get_invite_trip` security-definer RPC covers private invite previews — holding the link (the trip's unguessable UUID) is the capability, the same trust as the public URL. Publishing now also flips the trip to `visibility='public'` (and unpublishing back to private) so the RLS read path is the primary one. The companion migration `supabase/migrations/20260907_shared_trip_reads.sql` — backfilling `visibility='public'` for everything already published and creating the RPC + grant — has been applied to the live database.
- **The public page no longer crashes with React #310 when its trip loads.** The fetch-on-miss fix made the backing trip arrive after first render, exposing four `useMemo` calls that sat *below* the not-found gate — a hooks-count change between renders crashes React. All memos now run unconditionally with null-guards.

## [0.43.0] - 2026-09-07

**The suggestion engine comes alive: See & do finally fills, the map and the suggestion panels point at each other, and every add lands in road order.** This release fixes the structural reason sightseeing never appeared, turns the Map tab into one connected surface, and locks the AI companion away ahead of its paid launch. It also repairs a bad merge that had corrupted two core files and silently reverted the tabbed Share page.

### Added
- **Sightseeing suggestions actually exist now.** See & do was empty *by construction*, on every route: the fatigue planner only schedules food/fuel/rest/overnight segments, and the sightseeing column was filled from whatever the food and hotel searches happened to return as leftovers — so a long Kolkata → Jaipur drive got dhabas and hotels and nothing else, however far you drove. The corridor scan now always includes a sightseeing pass — "tourist attractions" through Google's `tourist_attraction` type gate, Overpass attraction/viewpoint/monument selectors in the keyless free mode — so real sights (forts, viewpoints, temples, waterfalls) surface along the corridor, flow into the See & do panel with their story arcs, and pin to the map. Fuel halts remain self-drive-only by design (car/motorcycle), anchored to your tank range.
- **The panels and the map now point at each other.** Hovering or selecting a suggestion card makes its map pin glow and glides the camera to it — "where is this?" answered without touching the map. Hovering or clicking a pin highlights the matching card and scrolls it into view — "which card is this?" answered without scanning the list. Because pin clicks now mean "locate", adding moved to an explicit teal + chip under each pin, so the quick-add is still one click away (and pins are real keyboard-focusable buttons).
- **New stops insert in road order, not at the end.** Add a stop that sits between two confirmed stops and it lands between them — the plan reads A → B → C, not A → C → B. Each addition is projected onto the real OSRM road geometry to find its position, the day's stop order is renumbered, and the Timeline agrees. Works for single adds, "Also nearby" chips, and the story-arc "Add all" batches (which insert pre-sorted so a multi-stop arc lands in journey order).
- **A rolling guide to the engine, on the Map tab itself.** A quiet purple strip cycles through what the suggestion engine actually does — fatigue spacing (stretch ~150 km, lunch ~300, tuned to crew size and travel style), the lunch clock sliding meals into 11:30–14:30, fuel cadence on your tank's rhythm, overnight cities every ~550 km, per-day detour budgets, Trip DNA learning from your accepts and declines, the rain re-rank, road-personality warnings, story arcs, and the new cross-highlighting — so the intelligence is discoverable without a docs trip. Dots jump between tips; it holds still under reduced motion.

### Changed
- **Travel style and transport mode now re-tune suggestions immediately.** Both settings change the plan — relaxed drives get a 120/260 km cadence vs packed 180/300, and fuel stops only make sense for self-drive — but the suggestion cache ignored them, so switching style kept serving suggestions tuned for the old setting until you hit ↻ Refresh. The cache key now includes both, so changing them re-searches straight away (an explicit user action, so it doesn't violate the expensive-search persistence rule).
- **The AI companion is locked, not deleted.** The drawer, its trip-grounded answers and the FAB are fully implemented but unmounted behind a `VITE_AI_COMPANION=on` flag (`lib/featureFlags.ts`) while the premium milestone (M8) decides its paywall shape. Nothing was removed — flip the flag for local preview.

### Fixed
- **The AI drawer closes again — and looks like YatraFlow.** A merge had deleted the drawer's display-when-closed rule, so the panel rendered permanently open on every trip page, with its long quick-prompt labels wrapping into tall ovals inside the pill radius. The close rule is restored, and the panel is redesigned onto the CTI design language: navy→teal gradient header with a glass icon badge, brand-teal user bubbles (white on `--teal-deep`, 5.2:1 AA), bordered bot bubbles, single-line quick-prompt pills on a horizontal scroll rail, a teal-gradient FAB with the brand glow, and a safe-area-aware input row.
- **Encoding corruption repair.** The same bad merge had mojibake-corrupted every non-ASCII character in `styles.css` and `ShareTab.tsx` — em-dashes and section signs turned into double-encoded garbage, including user-visible strings like the snapshot-copied toast — and silently reverted the tabbed Share-page refactor (PR #74). Both files were restored byte-clean from the pre-merge commit and the intended additions re-applied on top: the print/PDF day-card styles, the per-day cost/dwell chip styles, the saffron idea-pin gradient, and the ICS/print buttons threaded with OSRM leg corrections. Corrupted CHANGELOG notes (a BEL character where an "a" should be; a split `routeHash` line) were repaired too.

## [0.42.0] - 2026-09-07

**C1–C4: Hy4 audit P0 fixes.** The suggestion engine's persistent state and UI behaviour are now reliable: 'Add all' batch-applies with write-through (C1), the suggestion cache expires when the route geometry changes (C2), the degenerate-route guard stops short routes crashing (C3), and the detour budget is enforced from the actual itinerary (C4).

### Fixed
- **C1: 'Add all' button now batch-applies all stops with write-through** — previously collected stops only updated UI state without persisting to the database. Now uses `applyChange` to batch-add all selected stops, with the same optimistic UI pattern as per-stop 'Add to timeline'.
- **C2: Suggestion cache invalidates when route geometry changes** — added `routeHash` to include OSRM road geometry in the cache key. When OSRM resolves the route after mount and the road changes, the cache now correctly expires instead of showing stale corridor suggestions.
- **C3: Guard corridorAnchors when all stops are within 500m** (pts.length < 2) prevents cum[1] undefined crash on degenerate routes.
- **C4: Detour budget now enforced from actual itinerary stops** instead of skipping added/dismissed suggestions.


<!-- Link references. Only tags that exist on the remote are linked; untagged releases
     fall back to a friendly commit-range compare so no heading 404s. -->

[Unreleased]: https://github.com/hasnaina955/Yatraflow/compare/v0.54.0...HEAD
[0.54.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.53.0...v0.54.0
[0.53.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.52.0...v0.53.0
[0.7.0-native]: https://github.com/hasnaina955/Yatraflow/releases/tag/v0.7.0-native
[0.48.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.47.0...v0.48.0
[0.47.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.46.0...v0.47.0
[0.46.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.45.0...v0.46.0
[0.45.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.44.0...v0.45.0
[0.44.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.43.0...v0.44.0
[0.43.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.42.0...v0.43.0
[0.42.0]: https://github.com/hasnaina955/Yatraflow/releases
