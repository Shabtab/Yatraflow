# Changelog

All notable changes to YatraFlow. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 MVP milestones.

## [Unreleased]

## [0.45.0] — 2026-09-09

**The create flow gets its ticket, invites get their codes, and trip settings get the bench.** Creating a trip becomes the Trip Ticket — a live boarding-pass starter that prints its rough bill on demand and seeds your timeline; invites shrink to trip-shaped codes with a join flow that actually completes; and Trip settings is rebuilt on the Plan Bench's own controls with editable dates that reconcile the day grid. My Trips gets its search/filter/sort back, car rental joins the transport modes, and two reliability fixes land: the pre-patch `updateTrip` persistence bug and the auth-refresh logout race.
### Added
- **Create trip is now the "Trip Ticket" — a bento-compact starter that prints its bill on demand and seeds your timeline.** The last pre-redesign page joins the Calm Travel Intelligence language: bench-style blocks (Route with a numbered dashed route line, Dates, Crew & transport, Budget & style, Trip cover, Pinned plans) assemble a live boarding-pass ticket on the right — cover, title, route summary, dates, crew, budget — with no money on it. The rough bill stays hidden until the traveller presses **Print my bill**: a minimal printer slot unrolls a textured-paper receipt (torn bottom edge, per-line formulas, gentle wind sway that respects `prefers-reduced-motion`) carrying the bench-honest breakdown — transport ÷ mileage × pump price, stay via rooms × style tier, food per head per day, and the ≈ per-head total labelled a "rough take". A **↔ Return stops** switch pre-fills an editable custom return leg (the bill stops double-counting the roads when a loop is plotted); fuel fields (mileage / pump price / tank with the ≈ km-per-tank note) mirror the Plan Bench; crew gets 1–10 chips plus a custom entry; travel style is a scrollable pill carousel with an honest explainer of what each style tunes later (halt cadence, detour slack, AI planner tone). Under 900px the ticket collapses into a fixed frosted dock that carries the same print-then-create flow. On **Create trip**, the route's geocoded destinations seed a rough timeline outline — confirmed must-do sightseeing stops spread across the days (custom return stops fill the tail; the final destination stays store-anchored, never double-pinned) — so the workspace opens with a starting plan to modify, not empty days, and the create→overview hop rides a `startViewTransition` cross-fade. Landing's "Start planning free" is flow-aware: signed-in visitors go straight to `#/new`, everyone else funnels through signup with `next=%2Fnew`.
- **Car rental joins the transport modes.** `rental` slots in after `car` across the engine tables (≈42 km/h, blended ₹7.5/km), joins the fuel-economy family (self-drive burns fuel, so mileage/price/tank fields and the round-trip toggle apply, with a ₹/day rent field on the create page), and gets its icon in Trip settings' mode grid. Taxi and mixed remain available later in Trip settings; the create page's tile grid shows the six everyday choices.
- **Trip Ticket refinement pass.** The Dates block swaps its two raw date inputs for a single range calendar (first click sets the start, second the end, hover previews the span, month navigation, Escape/outside-click closes). A **Local** toggle inside the train tile bills suburban/unreserved fares at ₹0.45/km instead of express ₹1.6/km (estimate-only in v1, flagged in the bill's formula line). The open location dropdown and calendar no longer paint under the block below (the entrance animation's stacking contexts were swallowing them). Mode tiles let their hint text wrap instead of cropping; the travel-style carousel wraps to show all ten styles on desktop (scroll strip below 720px) and the explainer now states plainly what each style tunes — pace, detour slack, bill stay tier, AI planner leanings. The bill print animation feeds out in mechanical `steps()` increments with a slot warm-up blink instead of a quick ease. A printed bill can be **discarded** to edit and reprint, and the printer slot + paper are theme-aware — dark mode prints on warm charcoal paper rather than glaring cream.
- **Invite links are short codes now — and the join actually works.** The invite
  URL was the trip's raw UUID: 36 random characters that meant nothing to the
  person reading it. The Share tab now mints a trip-shaped code — `GOABEACHWE-K7QF`,
  head from the trip name, 4-char unambiguous tail (no 0/O/1/I/5/S so it survives
  being read out over a call) — and the invite link becomes `#/join/<code>`.
  The code sits in its own boarding-pass-stub chip with a copy button, the full
  link stays below it, and the landing page gains a "Have a trip code?" entry box
  so a friend who only got the code (not the link) can type it on the home screen.
  Codes are minted lazily on first share and persisted to a new unique
  `trips.invite_code` column (`supabase/migrations/20260909_invite_codes.sql`
  also backfills a code for every existing trip and adds a security-definer
  `get_trip_by_invite_code` lookup RPC — the code is the capability, same trust
  model as the old UUID link). Old `#/invite/<uuid>` links keep working forever.
  **The join flow was broken at three points, all fixed:**
  1. *The login round-trip dropped the invite.* The gate's Log in button went to
     plain `/auth`, and AuthPage's post-login redirect hard-navigated to My Trips —
     so the trip never joined and never appeared in the list. The gate now parks
     the invite in the URL and bounces through `/auth?next=/join/<code>`; AuthPage
     honours the `next` param (validated as a same-app route — the param is
     attacker-controllable input and must not bounce the user off-site) and drops
     the user back on the invite, which then joins and opens the trip.
  2. *Already-logged-in users can get a silent dead spinner.* If the on-demand
     trip fetch hiccuped, the gate gave up with no retry and no message — a
     permanent "Joining…" spinner. The gate now resolves its trip into local state
     (immune to cache evictions), reports a broken link honestly, shows a toast
     on join success ("You're on Goa Beach Week — happy planning!") or failure,
     and a member re-clicking the link just opens the trip instead of re-joining.
  3. *The join's side effects fired before the join itself.* `joinViaInvite`
     wrote the activity log and the owner's notification *before* the
     `trip_members` row — both are RLS-gated on `is_editor()`, which is false
     until the membership exists, so every join logged console errors while the
     side effects silently never landed (and the fire-and-forget insert could
     fail invisibly too). The membership row is now written first and awaited;
     only a confirmed write optimistically adds the member to the cache, so the
     trip shows up in My Trips immediately — and honestly doesn't on failure.
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

## [0.44.0] — 2026-09-08

**The numbers you actually ask mid-trip, answered where you're planning.** The Budget tab now says what is still safe to spend today, timeline day headers show what each day costs and how long you'll be at its stops — and three reliability fixes make already-open tabs survive a deploy while public itinerary pages and invite links finally work for people who aren't members yet.

### Added
- **"Safe to spend / day" pacing tile on the Budget tab.** The metric strip gains a fifth tile answering the one question a running trip actually asks: given the group's target and what's been spent, how much can we still spend each remaining day without blowing the budget. Backed by two new pure engine helpers — `daysRemaining` (today counts as a full remaining day; dirty `startDate`/`endDate` strings clamp to the day count instead of returning `NaN`, and a finished trip returns 0) and `safeToSpendPerDay` (returns `null` when no per-person target is set, so the tile honestly asks you to set one in Trip settings rather than inventing an infinity). Overspend renders the figure in the danger colour. Strip goes 4 → 5 columns with new 1400px / existing 1100px responsive steps.
- **Per-day cost and time-at-stops chips on timeline day headers.** Each day header now carries two quiet metadata pills — "≈ ₹X" (tooltip splits travel from day costs incl. entry fees) and "Xh Ym at stops" (visit time plus buffers; driving time stays in the day summary line) — so the numbers the engine already computes (`computeTotals().byDay` and `simulateDay` dwell) surface where the plan is actually edited. Both hide while a day is collapsed, keeping a folded header calm, and the dwell chip drops out below 720px.

### Fixed
- **Open tabs survive deploys instead of crashing.** Every deploy replaces the hashed lazy chunks, so an already-open tab's next lazy import (Board, map, any page) 404'd with "Failed to fetch dynamically imported module" — and since the browser caches the failed module fetch, "Try again" could never recover; only a manual reload worked. The error boundary now recognises stale-chunk failures and reloads into the fresh deploy automatically (once — a session flag guards against reload loops; if the reload itself fails you get an honest "YatraFlow was just updated" screen with a reload button). Real bugs keep the existing recovery UI.
- **Public itinerary pages and invite links work again for non-members.** The membership-scoped hydration (the v0.41 anti-bloat fix) deliberately keeps other people's trips out of the cache — which silently broke every flow that needs them: an anonymous visitor opening an Explore card hit "Itinerary not found", and an invite link showed "This invite link is broken" for anyone who wasn't already a member (the join itself reads the cached trip). Both pages now fetch the trip on demand (`fetchSharedTrip`): a direct row read covers owner/member/public trips, and a new `get_invite_trip` security-definer RPC covers private invite previews — holding the link (the trip's unguessable UUID) is the capability, the same trust as the public URL. Publishing now also flips the trip to `visibility='public'` (and unpublishing back to private) so the RLS read path is the primary one. The companion migration `supabase/migrations/20260907_shared_trip_reads.sql` — backfilling `visibility='public'` for everything already published and creating the RPC + grant — has been applied to the live database.
- **The public page no longer crashes with React #310 when its trip loads.** The fetch-on-miss fix made the backing trip arrive after first render, exposing four `useMemo` calls that sat *below* the not-found gate — a hooks-count change between renders crashes React. All memos now run unconditionally with null-guards.

## [0.43.0] — 2026-09-07

**The suggestion engine comes alive: See & do finally fills, the map and the suggestion panels point at each other, and every add lands in road order.** This release fixes the structural reason sightseeing never appeared, turns the Map tab into one connected surface, and locks the AI companion away ahead of its paid launch. It also repairs a bad merge that had corrupted two core files and silently reverted the tabbed Share page.

### Added
- **Sightseeing suggestions actually exist now.** See & do was empty *by construction*, on every route: the fatigue planner only schedules food/fuel/rest/overnight segments, and the sightseeing column was filled from whatever the food and hotel searches happened to return as leftovers — so a long Kolkata → Jaipur drive got dhabas and hotels and nothing else, however far you drove. The corridor scan now always includes a sightseeing pass — "tourist attractions" through Google's `tourist_attraction` type gate, Overpass attraction/viewpoint/monument selectors in the keyless free mode — so real sights (forts, viewpoints, temples, waterfalls) surface along the corridor, flow into the See & do panel with their story arcs, and pin to the map. Fuel halts remain self-drive-only by design (car/motorcycle), anchored to your tank range.
- **The panels and the map now point at each other.** Hovering or selecting a suggestion card makes its map pin glow and glides the camera to it — "where is this?" answered without touching the map. Hovering or clicking a pin highlights the matching card and scrolls it into view — "which card is this?" answered without scanning the list. Because pin clicks now mean "locate", adding moved to an explicit teal + chip under each pin, so the quick-add is still one click away (and pins are real keyboard-focusable buttons).
- **New stops insert in road order, not at the end.** Add a stop that sits between two confirmed stops and it lands between them — the plan reads A → B → C, not A → C → B. Each addition is projected onto the real OSRM road geometry to find its position, the day's stop order is renumbered, and the Timeline agrees. Works for single adds, "Also nearby" chips, and the story-arc "Add all" batches (which insert pre-sorted so a multi-stop arc lands in journey order).
- **A rolling guide to the engine, on the Map tab itself.** A quiet purple strip cycles through what the suggestion engine actually does — fatigue spacing (stretch ~150 km, lunch ~300, tuned to crew size and travel style), the lunch clock sliding meals into 11:30–14:30, fuel cadence on your tank's rhythm, overnight cities every ~550 km, per-day detour budgets, Trip DNA learning from your accepts and declines, the rain re-rank, road-personality warnings, story arcs, and the new cross-highlighting — so the intelligence is discoverable without a docs trip. Dots jump between tips; it holds still under reduced motion.

### Changed
- **Travel style and transport mode now re-tune suggestions immediately.** Both settings change the plan — relaxed drives get a 120/260 km cadence vs packed 180/300, and fuel stops only make sense for self-drive — but the suggestion cache ignored them, so switching style kept serving suggestions tuned for the old setting until you hit ↻ Refresh. The cache key now includes both, so changing them re-searches straight away (an explicit user action, so it doesn't violate the expensive-search persistence rule).
- **The AI companion is locked, not deleted.** The drawer, its trip-grounded answers and the FAB are fully implemented but unmounted behind a `VITE_AI_COMPANION=on` flag (`lib/featureFlags.ts`) while the premium milestone (M8) decides its paywall shape. Nothing was removed — flip the flag for local preview.
- **Version bumped to 0.43.0.**

### Fixed
- **The AI drawer closes again — and looks like YatraFlow.** A merge had deleted the drawer's display-when-closed rule, so the panel rendered permanently open on every trip page, with its long quick-prompt labels wrapping into tall ovals inside the pill radius. The close rule is restored, and the panel is redesigned onto the CTI design language: navy→teal gradient header with a glass icon badge, brand-teal user bubbles (white on `--teal-deep`, 5.2:1 AA), bordered bot bubbles, single-line quick-prompt pills on a horizontal scroll rail, a teal-gradient FAB with the brand glow, and a safe-area-aware input row.
- **Encoding corruption repair.** The same bad merge had mojibake-corrupted every non-ASCII character in `styles.css` and `ShareTab.tsx` — em-dashes and section signs turned into double-encoded garbage, including user-visible strings like the snapshot-copied toast — and silently reverted the tabbed Share-page refactor (PR #74). Both files were restored byte-clean from the pre-merge commit and the intended additions re-applied on top: the print/PDF day-card styles, the per-day cost/dwell chip styles, the saffron idea-pin gradient, and the ICS/print buttons threaded with OSRM leg corrections. Corrupted CHANGELOG notes (a BEL character where an "a" should be; a split `routeHash` line) were repaired too.

## [0.42.0] — 2026-09-07

**C1-C5: Hy4 audit P0 fixes.** The suggestion engine's persistent state and UI behaviors are now fully reliable. The 'Add all' button batches all POI additions with proper write-through; the cache correctly expires when the route geometry changes; and the degenerate route guard prevents crashes on short routes. Full audit sweep completes all P0 items.

**Suggestion engine polish.** Every suggestion in the app — the Map tab's nearby ideas and the Timeline's halt planner — now correctly invalidates when the route geometry changes, preventing stale corridor suggestions after OSRM resolves.

### Fixed
- **C1: 'Add all' button now batch-applies all stops with write-through** — previously collected stops only updated UI state without persisting to the database. Now uses `applyChange` to batch-add all selected stops, with the same optimistic UI pattern as per-stop 'Add to timeline'.
- **C2: Suggestion cache invalidates when route geometry changes** — added `routeHash` to include OSRM road geometry in the cache key. When OSRM resolves the route after mount and the road changes, the cache now correctly expires instead of showing stale corridor suggestions.
- **C3: Guard corridorAnchors when all stops are within 500m** (pts.length < 2) prevents cum[1] undefined crash on degenerate routes.
- **C4: Detour budget now enforced from actual itinerary stops** instead of skipping added/dismissed suggestions.

### Changed
- **Version bumped to 0.42.0**


