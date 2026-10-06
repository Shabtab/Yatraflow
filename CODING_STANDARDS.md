# CODING_STANDARDS.md — YatraFlow

Conventions and hard-won pitfalls. Read during **review**, and reach for a
single rule while implementing when a change touches that area.

This file was extracted from `AGENTS.md` §4 (conventions & pitfalls) and
`AGENTS.md` §2 rules 6a–6z (the pitfall entries that had accreted there
over time). The rule **numbers are unchanged** — a reference to `§2.6b`
anywhere in this repo means the entry labelled `6b` below.

**Index by what you are changing:**

| Changing | Read |
| --- | --- |
| Effects, deps arrays, memoisation | 6a, 6d, 6e, 6f, 6g, 6u, 6w |
| Async writes, rollback, race conditions | 6a, 6i, 6v |
| Payments, entitlements, deletes, keys | 6j, 6k, 6l, 6m |
| Flags, env, build-time config | 6n |
| Labels, counts, ids, display strings | 6p, 6q, 6r, 6s |
| Maps, drawing vs measurement | 6t |
| Stale caches, lazy gates, reset controls | 6h, 6v, 6w, 6x, 6z |
| Copy-paste contracts | 6y |
| Data model, times, optional fields | Conventions below |
| Stored vs rendered, covers, media, buckets | [store-persistence.md](docs/standards/store-persistence.md) |
| Store writes, Supabase, RLS, offline, import | [store-persistence.md](docs/standards/store-persistence.md) |
| Maps, basemaps, provider quota, coords, routing | [maps-and-providers.md](docs/standards/maps-and-providers.md) |
| CSS, contrast, motion, a11y, z-index, chunking | [ui-and-design-system.md](docs/standards/ui-and-design-system.md) |

---

## 1. Pitfall entries (`AGENTS.md` §2 rules 6a–6z)

 6a. **Async operations need input guards.** The AI drawer's `ask()` function had no protection against rapid re-submission during its 650ms processing delay — users could trigger duplicate questions. Fix: `disabled={thinking}` on input and button. When adding async paths (API calls, simulated latency, data processing), always disable user inputs to prevent race conditions, duplicate requests, or state inconsistency. The guard should match the visual feedback state (spinner, disabled button, etc.).
 6b. **A release cut is not done until every change in it has a CHANGELOG entry — check coverage, not just the heading.** The v0.60.0 refinement pass ran 20 commits and only 10 of them touched `CHANGELOG.md`, so the release was about to go out describing the first half of its own work — while the plan document recording that work also stopped mid-way and read as finished. Both artifacts agreed with each other and neither agreed with `git log`. Before cutting a release, diff the two lists — `git log --oneline <base>..HEAD -- CHANGELOG.md` against `git log --oneline <base>..HEAD` — and account for every commit: it has a bullet, or it is genuinely invisible to a user (a doc reconciliation, a de-duplication, a test-only change). The entries are also where a superseded claim gets *edited* rather than appended, so that diff is the audit.
 **Check what the cut REMOVED as well as what it added.** A cut edits the head of `CHANGELOG.md` — the place the preamble lives — and the v0.70.0 cut (`36b13b7`) deleted that whole block on its way past: `# Changelog`, the Keep-a-Changelog line, and the "Two version lines" note that stops anyone comparing the Android shell's `-native` numbering with web semver. Nothing failed, because no test reads prose; the loss surfaced days later while adding an unrelated bullet. So a cut's own diff deserves a look at the file's head (`git diff <base>..HEAD -- CHANGELOG.md | head -30`), and the preamble is not part of any release — it is never correct for a version heading to replace it. This block has now been repaired twice (`dfdd2d0`, then the restore after `36b13b7`), which is what makes it worth the glance rather than a rule about paranoia.
 6c. **A "missing guard" claim needs the same git check as a "done" claim.** A comment or summary saying something was *absent* ("the one animation with no reduced-motion guard") is also a hypothesis — grep `origin/test` for the guard before "adding" it, or you ship a duplicate rule plus a changelog sentence that isn't true. The map-tab review round did exactly this; found 2026-09-22 while polishing its motion. The mirror case: an absence claim expires at the *next* merge, not at the date on the block — the slots decision record (2026-09-22, 17:27) logged three plan items as still outstanding, and PR #303 landed them 70 minutes later, leaving the sentence false from the moment it merged (fixed 2026-09-23). Check an absence claim against merged-PR timestamps, not the block's date.
 6d. **Wired is not "looks like the approved mockup" — and a RESTYLE folds into the
   original rule, it never appends a twin (learned 2026-09-23).** The create funnel
   shipped with every phase wired, honesty-guarded and tested while rendering the v0.45
   navy boarding-pass ticket instead of the mockup's light card. The mockup is a VISUAL
   contract: check the surface RENDERED against it, not only the plan's wiring checklist.
   Two mechanical traps from the fix: (1) an appended rule that re-declares an existing
   top-level selector trips `duplicate top-level selectors`, and a new font-size under
   11px trips the type floor — grandfathered names keep their sub-floor sizes, so
   restyles fold INTO the original rules with line counts preserved, and only genuinely
   new names go in an appended block (media-nested refinements are exempt); (2) filled
   teal carries `color: var(--card)`, never `#fff` — dark theme flips `--teal-deep` to a
   LIGHT teal where white text measures 2.05:1 (measured on the CTA pill 2026-09-23;
   the flipped pair reads 5.84 light / 7.66 dark). (3) A shared-recipe GROUP rule can
   re-assert itself over the fold-in and win by source order — the kicker unification
   list still named `.tk-brand`/`.tk-kind` and fed them `--kicker-size` long after their
   own rule, so the rendered size never changed. After a fold, confirm the RENDERED
   computed style, and when a class changes role (kicker → boarding-pass head bar),
   REMOVE it from the shared-recipe list — that is the delete-cheaper-than-add fix.
 6e. **Two silent killers from the crew-channels pass (learned 2026-09-23).**
   (1) `window.open(url, '_blank', 'noopener')` **always returns null** — the
   `noopener` feature implies no window handle — so `if (!win) throw` or
   `return !!win` misreads every SUCCESS as a popup-blocked failure (the
   moment-after screen's "Send invite" therefore never once opened WhatsApp
   and always fell through to the share sheet). Read nothing from the return:
   open without the feature flag and detach the opener yourself
   (`win.opener = null`), or just fire-and-forget. `src/lib/native.ts`'s use
   is statement-only and unaffected. (2) A hook placed **below** an early
   return crashes with "Rendered more hooks than during the previous render"
   the moment data hydrates after mount (store async) — the component renders
   the not-loaded branch first, then the loaded branch, and the hook counts
   differ. It only reproduces on a FULL reload, never on hash navigation
   into an already-hydrated app, so "it worked when I clicked around" proves
   nothing: test the fresh-load path for any component with an early return.
 6f. **Two wiring traps the fuel-halts line caught (2026-09-23).** (1) An async
   result that feeds a `useMemo` MUST be in the memo's deps — the halt fetch
   landed in state while the memo kept its empty closure and the line never
   rendered; every pure-layer test was green because the drop happened in the
   page, so only a rendered check catches this family. (2) A planner halt whose
   fuel tick folded into a meal/overnight (#144A) keeps the combined service in
   its `label` ("Overnight + fuel"), not its singular `purpose` — a consumer
   filtering `purpose === 'fuel'` drops nearly every planned refuel on a
   multi-day corridor (measured: 3 planned, 0 surfaced). Match the label too.
 6g. **A deps-object field rename is type-checked only where the object literal
   is FRESH — and one project decision can land on two unrelated deps objects
   (learned 2026-09-25).** Renaming `travellers` → `memberCount` for #335 was
   applied by grep to three `travellers: trip.travellers` lines in MapTab, but
   only two of them were `DaySlotsDeps` (the vote quorum). The third fed
   `NearbyOpts` (the corridor's fatigue cadence) and a fourth — in the
   suggestion-cache hash — surfaced as `error TS2353` while the `NearbyOpts` one
   built GREEN: `const opts: NearbyOpts = useMemo(() => ({ … }))` is not a fresh
   literal to TS (the initializer is a call, and excess-property checking does
   not reach through it), so the wrong key is accepted and `opts.travellers`
   reads `undefined` at runtime — cadence silently reverts to the default. The
   generic form `useMemo<NearbyOpts>(() => ({ … }))` DOES reject it. So: after
   any deps-field rename, enumerate call sites by the TYPE each object feeds
   (not by grep), and treat a green build as no evidence for the inferred-generic
   sites. Same family as 6f(1) — the drop happens in a page, and pure-layer
   tests stay green.
 6h. **An insert-if-absent cache merge is a staleness bug waiting for a state
   change — and a new tripwire must be run against the PRE-FIX source (learned
   2026-09-25).** `fetchPublicTrip` merged its row with `if (!some(…))`, which is
   fine while a row never changes and wrong the moment one does: after a paid
   unlock the same RPC answered with real days while `tripById` kept serving the
   pre-purchase stub, so the page body and the fork both stayed on placeholders
   until a reload (#349). **When a reader is server-authoritative, the merge is a
   REPLACE** — and if it writes `cache.trips` it must honor the two guards the
   realtime handler already uses (`isStaleServerRow` against
   `serverTripTimestamps`, `isRecentLocalWrite` against the echo window) or the
   echo of a local write starts fighting the fetch. Companion trap: a "trust
   flag" parameter that is accepted and ignored is worse than none — wire it to a
   POSITIVE only and never trust its negative, because a page's flag is `false`
   while its own entitlement read is still in flight, which is exactly when a
   buyer who just paid clicks the button.
   **Proving the test is not vacuous:** a tripwire written after the fix tends to
   pass for the fix's own reasons, so stash the implementation and watch it fail —
   `git stash push -q -- src/store/store.ts src/lib/forkPub.ts` → run the new
   suite → `git stash pop -q`. Eight of #349's eleven tests fail that way; the
   other three are the fail-closed controls, which SHOULD pass before the fix
   too. Do this before every fix-verifying commit, not just this one.
   **Sequence companion (2026-10-05, #154):** for an audit sweep, extend the
   gate BEFORE or WITH the fixes it pins — #154's map-rail batch landed the
   measurement harness first, so every fix landed already pinned; fix-first
   leaves the defect class free to re-enter the next batch unmeasured.
   **Fixture companion (2026-10-06, #553/#562): a break that passes points at
   the fixture first.** Two break proofs in this repo passed at first, and
   both times the fixture was the defect, not the code. #553's attribution
   test placed the rival edits on other days. The day filter hid the missing
   title check, so the weakened pin still passed. #562's overlay test set the
   overlay open before the first press. The press never armed, so the disarm
   had nothing to disarm. Strengthen the fixture until it proves its own
   precondition, then re-run the break, then read the result.
 6i. **A create that is awaited must roll back like the copy path, retry on the
   SAME object, and tolerate its own duplicate key — and its UI guard must span
   the await (learned 2026-09-25).** #374/#373: `createTrip` admitted the trip,
   fired `void persistTrip(...)` and returned, so the page routed into a
   workspace over a row that might not exist; there was no submitting state, so
   both CTAs stayed live and every submit minted a fresh uuid. Two mechanics
   worth keeping: (1) **a retry must reuse the built trip object** — its id is
   the idempotency key, so a first attempt that reached the server is not
   followed by a twin; (2) **an upsert CANNOT express that retry.** `trips
   update`'s policy is `is_editor(trips.id)`, which reads the `trip_members` row
   the same failed attempt may not have written, so a conflict-update is refused
   by RLS — tolerate the `23505` on a retry instead (`opts.retry`), on BOTH the
   trips and the members insert, and never on the first attempt. (3) A "trust the
   await" flag on the create half must be a ref checked before `setState`
   resolves, or a same-tick double-click reads `false` twice; and the create
   wrapper must `try/catch` the persist, because a dropped fetch rejects where
   supabase-js usually answers `{error}` — an uncaught throw leaves the
   optimistic row in the cache forever, which is the zombie the fix removes.
   Test-mock trap from the same session: a mocked thenable must pass BOTH `then`
   handlers (`Promise.resolve(x).then(res, rej)`) — a `then` that ignores the
   rejection handler makes the awaiting caller hang to the 5s timeout while the
   rejection surfaces separately as an unhandled error.
 6j. **Deleting a row that money hangs off is a revocation, not a cleanup — and a
   guard keyed on that row's EXISTENCE breaks in the direction you are not
   looking (learned 2026-09-25).** `unpublishItinerary` deleted the
   `published_itineraries` row, and `entitlements`, `purchase_orders` and
   `pub_events` all carry `on delete cascade` on `pub_id` — so "remove it from
   Explore" silently confiscated what buyers had paid for and erased the
   creator's own sales ledger and funnel, with no status change, no refund and no
   record anywhere. Unpublishing is now a marker (`unpublished_at`, bigint ms
   like its siblings `published_at`/`refreshed_at`) and the ROW SURVIVES: that is
   what keeps buyers whole. Three things worth keeping: (1) before deleting a
   row, grep every FK that cascades FROM it — the blast radius is the schema, not
   the call site; (2) `get_invite_trip`'s paywall guard keys on a priced
   publication row EXISTING for the trip, so deleting that row would have opened
   the very leak the guard was written to close — an existence-keyed guard is
   satisfied by presence, and silently satisfied again by absence in the other
   direction; (3) a reader that must work before its migration is applied has to
   fail CLOSED here — with the column missing, unpublish refuses and names the
   migration, because the old fallback (delete) IS the bug. Companions: the trip
   must NOT be flipped `private` on the way out (`get_public_trip` requires
   `visibility = 'public'` to serve an entitled buyer, so that flip revokes the
   very buyers the row was kept for — and the tightened `trips read` policy
   already restricts direct reads to owner/member/admin, so keeping it public
   leaks nothing); and a KPI that counted those rows stops being true the moment
   they stop being deleted — a "Live" cell and a "Behind" count had to learn the
   marker in the same commit, or the strip contradicts the list printed under it.
 6k. **A capability one endpoint leaks is a key for every other endpoint — and a
   `select *` in an anon-facing function is how it gets leaked (learned 2026-09-25,
   #351).** `get_public_trip` stubbed the paid days correctly and then returned the
   whole trip row anyway, `invite_code` included; `get_trip_by_invite_code` had no
   premium gate at all, so the same anonymous caller traded that code back for the
   complete plan — 4 days, ZERO stubbed stops, no account, no payment. Five rules:
   (1) a function granted to `anon` must name its columns — `select *` makes every
   column a future migration adds public by default, and the default has to be the
   other way round; (2) `returns setof public.<table>` does not let you omit a
   column, so a secret stays on the wire until the columns are enumerated and it is
   replaced by a typed NULL (`null::text as invite_code`) — the return type is not a
   licence to select the row; (3) a gate only guards the paths that have it — the
   uuid invite link was gated in v0.63.0 while the short code was deliberately
   "left untouched", which read as caution and was in fact the hole, so when two
   endpoints serve one capability, guard BOTH and test the pair; (4) a leaked
   capability is a CHAIN, not a bug: ask "can this field be traded for anything?"
   before rating the leak, because the field alone is harmless and the second
   endpoint is what turns it into a bypass; (5) prove it live — three
   unauthenticated curl calls settled in minutes what reading four migrations only
   suggested, which is why the issue's own "confirm the bypass first" step is the
   one that decides hygiene vs incident. Companion trap, specific to this repo's
   migration style: TWO files redefining one function means NAME ORDER decides
   which body a fresh database ends up running, so a later fix must carry every
   earlier guard forward verbatim (#350's soft-unpublish gate had to survive #351's
   rewrite of the same function, and the rewrite is exactly where it would have
   been dropped) — pin that ordering with a test, because the failure is invisible
   until someone rebuilds the database from scratch.
 6l. **A grant is API surface, and `service_role` is the right default for a
   caller-independent delete (learned 2026-09-25, #356).** `prune_pub_events`
   deletes on `at < horizon` — no pub, no creator, no caller — and shipped
   `grant execute … to authenticated`, so any signup could erase every
   publication's funnel history. The symptom is a trend that reads "nothing
   recorded", which looks like a bug in the reader rather than an attack, and
   there is no audit trail to say otherwise. Four rules: (1) choose the grant
   from WHO ACTUALLY CALLS IT — grep first; nothing called this one, which is
   what makes `service_role` correct and an `is_admin()` gate wrong (it would
   invent a caller the function does not have and still leave the delete
   reachable from an anon key plus a user token carrying an admin claim);
   (2) `revoke … from public` does not revoke from `anon`, and does not revoke
   from `authenticated` either — name all three, and note that a check covering
   one role is not a check covering the others (the contract suite asserted anon
   for months while `authenticated` stayed wide open); (3) a grants-only fix
   belongs in its OWN migration that creates no function and deletes nothing, so
   it cannot silently disturb what the function pins (here the 730-day clamp
   paired with the funnel reader) — and it must sort AFTER the file that granted
   the door, which is load-bearing rather than cosmetic; (4) `schema.sql` is a
   second and independent way to build the database, so a grant fixed only in
   the migration series leaves a fresh `schema.sql` instance wide open. Fix both
   and let a test compare them.
 6m. **A redefinition inherits the holes of the body it copies — and a comment
   claiming a field is unused is a hypothesis, not evidence (learned
   2026-09-25, #352/#353).** `get_public_trip` was rewritten three times in one
   week (#350, then #351, then #352/#353), and the third rewrite is where two
   long-standing holes finally got fixed: `free_day_indexes` was read with no
   shape guard, so a scalar in that column makes the RPC raise and the public
   page shows "didn't load" for **every** visitor (an availability bug, not a
   disclosure one — failing closed still takes the page down), and the trip's
   `expenses` and `fixed_commitments` were served in full while the days were
   stripped. Both had been carried forward **verbatim** by the two rewrites
   that were busy fixing something else, which is the trap: when you
   `create or replace` a body you own every unguarded input in it, so read the
   whole body looking for the input its neighbour loops guard and it does not
   (this one guarded days, day indexes, stops and corrupt arrays, and missed
   the free-day list). The second half is worse than a bug: the note this fix
   deleted asserted the public page "renders neither" money field — written
   from reading the component's imports instead of grepping for the field. The
   page calls `computeTotals(trip)`, which reads `trip.expenses`, and its own
   locked copy promises "the budget breakdown [is] in the full plan". A
   withheld field with no day key to filter on gets the honest rule — an
   unentitled viewer of a priced plan receives no money at all — because a
   partial strip leaves exactly the breakdown the copy says is withheld.
 6n. **"Deployed" is not "launched": a build-time flag's switch is part of its
   release, and its dark default is deliberately asymmetric (learned
   2026-09-25, #427).** The v0.65.0 create funnel was fully deployed to
   production and fully invisible there — `/new` loaded, the app rendered, and
   all seven phases were missing — because `VITE_CREATE_FUNNEL` was never set in
   Vercel and **no test, check or deploy step can see that**: Vite inlines
   `VITE_*` at build time and "unset" is a valid state. The asymmetry is the
   trap: unset means *all on* in a dev build and *dark* in a production one (so
   `test` can dark-run a phase before `main` sees it), so a dark production
   build reads as a broken feature rather than a missing switch — never "fix" it
   by changing the default. Prove a deployed flag without trusting the dashboard
   by **content-addressed chunk hash equality**: a local build with the variable
   unset emitted `featureFlags-Exwc-GsR.js` containing `t(void 0,!1)`, the same
   chunk name production served, so production's baked value was provably
   `undefined` — the same trick `docs/DEPLOYMENT.md` already documents for
   `index-<hash>.js`. What ships with the flag: a row in the deploy table (not
   just a line in the release notes), a source-text test keeping the documented
   phase list identical to the `createFunnelOn()` call sites (a typo in the
   deployed value darkens exactly one phase while the rest light up), and a
   **production-only warning** in `vite.config.ts` — warn, never abort, because
   a preview branch dark-running a phase is what the flag is for.
 6o. **The issue auto-close parser cannot read negation — "this does not close
   #N" closes #N (learned 2026-09-25, PR #443).** The workflow that mirrors the
   tracker for `test` matches GitHub's own grammar — a closing keyword
   (`close[sd]?`, `fix(?:e[sd])?`, `resolve[sd]?`) followed by a reference — and
   that grammar has no negation. A PR body written to be *careful* — "It does
   not close the P0, because production is still dark…" — closed that P0 the
   instant it merged; `github-actions[bot]` did it, and it was reopened by hand
   twelve seconds later. The reopen is the cheap part: a P0 that stays closed
   while everyone believes it shipped is not. `refs` is **not** a keyword, so a
   bare "Refs #N" line is inert — which makes the lesson narrower and nastier
   than "do not mention issues": a keyword within reach of a number closes it,
   whatever the surrounding sentence says. To reference an issue you do not mean
   to close, keep the number out of a keyword's reach ("see the dark-funnel
   issue"), and if a PR must explain why it is *not* closing something, say so
   without putting the number behind the word. Pinned in
   tests/pr-auto-close.test.ts so nobody "improves" the parser into guessing
   intent.
 6p. **A display string is not a key — and a derived value is not free to
   move (learned 2026-09-26, the Timeline/Board wave).** Two sides of one
   lesson from the same day's fixes. (1) Warnings were filed per day by
   PARSING their rendered title (`/^Day (\d+):/`), which silently lost every
   warning whose title leads with a stop name instead of a day (opening hours)
   and every trip-level one (accommodation churn — no day to find). The fix is
   the general rule: when a surface needs to know which entity a record
   belongs to, the PRODUCER must attach it as data (`dayIndex` on
   `ScheduleWarning`, `null` for trip-wide) and the surface must group on that
   field; a regex over prose is only a fallback for legacy shapes, and an
   unmatched record must land in a "trip-wide" bucket rather than vanish. Say
   the count out loud too: a chip that promises "+N more — see Timeline"
   forces the Timeline to render exactly those N, trip-wide block included.
   (2) `optimizeDayOrder` pinned a day's tail only when the tail stop was a
   hotel or a rest, but `originOf(next day)` derives tomorrow's wake-up point
   from whatever the day's LAST stored stop is — so a tail stop that was only a
   dinner move relocated the next morning (~16 km in the reported case).
   Before letting any writer touch a stored value, ask which OTHER derived
   values read it (the repo's own dayEndPosition/originOf pair), pin the
   source, and write the property test that asserts the derived value is
   unchanged rather than trusting the shape — that property test is what
   caught this. Companion trap from the same family: the optimize preview was
   a SNAPSHOT taken when the dialog opened, so a drag that landed while it was
   up was discarded on Apply; re-derive from current state at commit time and
   refuse-with-a-toast on divergence rather than last-write-winning silently.
   And when a number is an estimate, label it as one at every point it is
   shown (the optimize dialog presented chord km as road km whenever the road
   had not been measured yet — `measuredLegCount(...) === 0` is the honest
   signal; a scale ratio of 1 is ambiguous and must never imply measurement).
 6q. **An id the UI stages is a claim about the PLAN — reconcile it against
   the plan, never against time (learned 2026-09-26).** Five inline
   “already added?” checks in one file disagreed: a rejected stop blocked its
   name forever, `" Hotel Taj "` never matched `"Hotel Taj"`, a provider
   `placeId`/`eLoc` was ignored, arcs advertised owned places, and one path
   marked a hit added BEFORE Keep while another marked it after — so a
   discarded preview left a ghost id that hid the place until reload, and
   during an open preview the same hit could be staged twice. One predicate
   (`lib/placeIdentity.ts`) now owns the rule for every caller, and the staged
   set is released by a preview-close effect that asks the PLAN whether the
   place arrived (`discardedStagedIds(staged, identity.names)`) instead of
   asking how much time has passed. When several call sites each answer the
   same membership question, that is one predicate with one normalization
   contract (trim/lowercase/collapse + provider key join) — and the exit path
   (discard) needs the inverse of the entry path (stage) in the SAME change.
 6r. **A display filter is not a mutation scope — hidden rows still own the state
   other surfaces render, and one gesture must place a stop the same way on every
   surface (learned 2026-09-26, #371).** The Board's reorder spliced only the
   non-rejected cards it shows and remapped orders onto those survivors, so a
   hidden rejected stop kept its old `orderInDay`: two stops could claim one
   position, and the hidden one resurfaced mispositioned on the Timeline, which
   renders every stop. The rule lives in `lib/stopOrder.ts` in an ACTIVE-list
   form (`moveActiveStopWithinDay`): splice the visible list, then rebuild and
   renumber the WHOLE day, hidden rows keeping their slots. When a surface
   mutates a FILTERED view of a collection, either run the mutation on the full
   list and map the view onto it, or renumber everything the filter excluded —
   never leave excluded entries holding their old numbers. Companion from the
   same issue: the Board's move dialog appended to the target day while its drag
   inserted positionally, so one gesture produced two different plans; the
   dialog now road-orders through the same `moveStopToDay` the Timeline's dialog
   uses. Pinned in `tests/stop-order.test.ts` (the active-list describe plus a
   Board source assertion).
 6s. **A label and its colour must come from the same value — and a count's
   NOUN is part of its meaning (learned 2026-09-26, the Board wave).** Two ways
   one surface contradicted itself in the same panel. (1) The Board printed the
   engine's BAND word (`Unrealistic`) and coloured it with its own score cuts
   (`≥70 ok | ≥40 mid`), so a 45-point trip wore the alarm word in reassuring
   mid-blue — at 70–84 and 55–69 it happened to agree, which is luck, not
   correctness. Style from the SAME value the text came from, and when two
   surfaces already map that value, lift the mapping into a shared module
   (`lib/healthBand.ts`) instead of copying it. (2) The pulse counted DAYS
   (`Object.keys(dayWarnings).length`) while the copy said “route days
   overloaded” — a wrong unit that stayed invisible for exactly the case its
   author had in mind, and read as an alarm for a day whose only issue was a
   late lunch. Count the thing you name, and reserve an alarm word for the state
   that earns it (here: a CATEGORY test — density / fatigue / travel — never a
   severity test). Companions from the same pass: a shared formatter is the
   right home for a finite guard (`formatInr(NaN)` → `—`, one fix for every
   caller, and “—” is not “₹0”); and a `React.memo` pass is really a
   PROP-IDENTITY pass — one fresh literal in the props defeats it, so hoist the
   shared empty value, `useCallback` every handler, and pass a column's own
   index INTO a stable callback rather than closing over it in an inline arrow.
   Take the before/after by COUNT, not by feel: a temporary dev-only render
   counter plus a driven localhost session showed one editor-open re-rendering
   0 columns with the memo and all 12 without (3 columns × the dev
   double-render) — then remove the counter before committing.
 6t. **A drawing is a claim about the same measurement the numbers came from —
   and a failure must not wear the mark of success (learned 2026-09-26, #370).**
   The Board's mini-map measured a road of its own over the stops alone, while
   its budget/health/arrival figures came from the workspace's fuller chain
   (start leg + stops + drive home + one-way destination tail), so one trip drew
   two different roads under two sets of numbers describing only one of them —
   and when nothing resolved, the chord fallback was painted with the same
   casing, colour and chevrons as a measured road. Three rules: (1) a surface
   that DRAWS a measurement must derive it from the same source the surfaces
   that PRINT it use — here the workspace's one chain, through the same helper
   (`mapRoadViewFromLegs`) — never a private shorter one; (2) grade what you draw
   from the MEASURED geometry it should have come from, not from the coordinates
   in hand (they always exist), and grade failures and "still measuring" the same
   way — with a distinct treatment (`routeDrawGrade` in `lib/tripRoad.ts`), so no
   surface can paint a guess as a road; put the WORDS on the surface that knows
   `road.status` (this component cannot tell failed from pending, so it says
   nothing); (3) when one identity is already derived in a lib (`roadChainSig`),
   use it — a private stops-only cache key missed a moved start point. Two
   techniques worth reusing: **a shared renderer's honesty fix lands on every
   host** (grading inside `TripMap` gave the Map tab's own chord fallback the
   same treatment, without touching lane A's file), and **a driven check can read
   the props two surfaces actually passed**: React keeps them on the DOM node's
   fiber (`Object.keys(el).find(k => k.startsWith('__reactFiber$'))`, walk
   `.return` to the component, `.child`/`.sibling` for the lines below it), which
   proved Board-line == Map-line as identical 2,146-point arrays, and — with
   `window.fetch` stubbed to reject the routing host and a trip switch to force a
   fresh measurement — that the failed state paints dashed amber and no
   chevrons. Restore the stub when done.
 6u. **Identity is not content — a store echo mints fresh objects, so a memo
   must compare content where identity is guaranteed to churn (learned
   2026-09-26, the Timeline wave #340/#347).** The Timeline's day cards were
   memoized and still re-rendered every day on every edit. Two different causes,
   both worth carrying forward:
   (1) **Every read of the trip came from the trip OBJECT.** `useMemo(…, [trip])`
   on a clone-per-save store is a memo that never hits, so a day card re-derived
   its own journey, schedule and origin on every unrelated keystroke. Resolve the
   trip-wide slice a card reads ONCE per trip change (`lib/dayCards.ts`), keyed on
   the EXACT inputs the engine reads, hand the same object back while the key
   holds, and make the prop the card reads optional (`trip?: Trip`) so a closed
   card cannot read the trip at all — a `trip.x` on that path is then a compile
   error instead of a stale render.
   (2) **The store hands every merged/echoed row fresh day objects with identical
   content.** So even with the facts reused, the memo's shallow default saw a
   "changed" `day` and re-rendered every card — a counter alone cannot tell
   "memo worked" from "re-rendered with identical props", which is why the
   instrumentation must record WHICH prop changed and in which parent commit.
   Compare `day` by CONTENT and exhaustively (`JSON.stringify` over the day, or
   any full compare) — never a hand-written field list, which goes stale the day
   someone adds a field. Two companions: the comparator must be exhaustive BY
   CONSTRUCTION (iterate the props object's key set and compare everything but
   the one key you special-case — a hand-written prop list skips a new prop
   silently), and a handler that closes over the churning value re-renders the
   tree just as surely (`useStopConflict`'s `openEditor` depended on `trip.days`,
   flipping `onAdd`/`onEdit` on every save — read the live value through a
   latest-value ref and keep the dep list empty). Measured, after both: renaming
   one day re-rendered that card and **0** of the others.
 6v. **A gate keyed on the failure it just reported cannot see the retry it
   offers — an in-flight re-attempt is a THIRD state, not the absence of the
   failure (learned 2026-09-26, the road-retry wave).** `TripRoadView.retry`
   existed at the source since #188; when a surface finally grew the Retry
   button, both of its failure gates were keyed on `status === 'failed'` alone —
   so the moment the retry flipped the status to `pending`, the honest note (or
   the banner) vanished, taking its own "these figures are estimates" warning
   with it exactly when the user had asked for another attempt. Three rules:
   (1) an affordance on a failed state must keep that state's honest rendering
   up through its own in-flight — gate on `failed OR pending` (Board's note) or
   latch the failure in a ref that clears on a resolve (MapTab's banner, whose
   gate also needs the failure to survive `pending`); latch in RENDER, not in
   an effect, so a same-tick flip never reads stale, and clear it on `ok` AND on
   a chain rebuild (a stale latched failure must not pin a dead banner after a
   route edit — the new chain measures on its own).
   (2) the in-flight must be SAID, not implied: "Measuring…" copy plus a
   disabled/hidden control (§6a's input-guard family — a retry button that
   stays clickable mid-flight double-fires the counter, which is harmless here
   but is the reflex to avoid everywhere).
   (3) a driven check of a "failed → resolved" cycle must respect what the
   session cache can do: `lib/routing.ts`'s module-level `legCache` keeps
   resolved legs for the whole session (estimate legs are deliberately never
   cached), so a fetch stub that rejects the OSRM host yields a full failure
   only on a COLD chain — a warm chain still resolves from cached real legs
   (a partial real corridor is legitimately `ok`, #188's rule), and `failed`
   must be watched at ~2s granularity (the internal backoff is 2s and the
   in-flight state lasts about that long).
 6w. **A cached derived list and its live re-derivation must agree on the
   input BASE, or the two surfaces that read them contradict each other
   (learned 2026-09-27, the #344/#346 wave).** The slot rail budgeted an
   empty-day 45-minute detour budget because the `plannedStops` dep it
   documented was passed by NOBODY, while the see-&-do rail subtracted per
   stop — the same day, two verdicts, on screen at once. Three mechanics:
   (1) when a per-day fact can be DERIVED from data the function already
   receives (`dayStops`), derive it beside the use — a caller-passed prop
   invited the bug by existing unused, and a single shared count would have
   poisoned `tripReadiness`'s other days with the ACTIVE day's density;
   (2) a "preference" must never re-order a SPENDING walk — stay-proximity
   used to sort meal candidates before the budget was spent, so a stay-close
   off-route place ate the budget ahead of the on-route engine-best; rank by
   the score everything else uses and apply the preference as a labeled
   tie-break (bonus seconds within a window) plus an honest label ("straight
   line" where every detour elsewhere speaks road minutes);
   (3) a supersede must be LOUD: a cancelled in-flight search that only
   re-enables its button reads as completion — toast, and exempt the
   search's OWN final write from its toast via a flag, or the completion
   toasts itself.
 6x. **A lazy gate's proof is what MOUNTS, not what unmounts — and a
   "never calls X" tripwire must read code, never prose (learned 2026-09-27,
   the #421/#422 wave).** Review mode had to keep provider fetches off days
   that are merely visible, so the shell hands a day its live `trip` (which
   is what mounts a TravelPanel) only when the day is near the viewport.
   Two mechanics worth keeping:
   (1) the gate is on FIRST mount only — the day card holds the last trip it
   was given (`lastTrip.current`) so its body can keep rendering through the
   collapse animation, which means an off-screen day keeps the panel it
   already mounted. That is the right behaviour (no flicker, no re-fetch),
   but it changes what evidence you need: prove the gate with `chip: false`
   → `panel: true` transitions as days enter and leave the viewport, not by
   expecting off-screen days to empty out;
   (2) a negative assertion against raw source matches the module's own
   COMMENTS — `expect(quick).not.toMatch(/applyChange|updateTrip/)` failed
   on a file whose header documents that it deliberately never writes, and
   the fix is the one the Math.random tripwire already used: strip `//`,
   `*` and `/*` lines first, so the assertion judges code (which is what
   "this module never writes" actually claims).
   Companion trap for any CSS this repo adds: the spacing ratchet keys on
   `property: value`, so a new rule matching an ALREADY-FROZEN pair
   (`padding: 10px` is in the baseline) is free, while a new pair is a
   build failure — check `tests/design-system-baseline.json`'s
   `offLadderSpacing` before choosing values, and prefer the ladder
   (2/4/6/8/12/14/16/20/22/24) or the `--space-*` tokens outright.
 6y. **A contract that converged by copy-paste has not converged — and
   `undoToast` REGISTERS its undo, so a test that calls the capture callback
   proves nothing about the restore (learned 2026-09-28, lane S / #424).**
   Three surfaces had the same delete-and-undo sequence, five more had the
   same refusal sentence pasted in, and a sixth had re-invented it as a local
   helper — so "the same action behaves the same way everywhere" was true by
   coincidence of copies, and the next surface inherited nothing. Worse, the
   cost of that shape is invisible: the copies were all correct. The fix is a
   module whose HOME is the rule (`lib/mutationLifecycle`), and this is what
   made it worth doing:
   (1) promote the SEQUENCE, not just the sentence — the composer takes
   `{ trip, stopId, dayIndex, applyChange }` and owns capture → stage →
   Undo, so a surface cannot keep the staging and improvise the recovery;
   (2) pin the convergence with SOURCE invariants, because a shared helper
   nobody is forced to call is a suggestion: "`removeStopFromDay(` appears in
   exactly two files", "`PREVIEW_BUSY` in exactly two", "each surface passes
   the same four keys, and a variant fails". Those tests are what stop the
   next surface, and they failed 4/5/7-files-wide against the pre-fix tree
   (§6h — run them stashed, and check the failure MESSAGES, not just the
   count);
   (3) when a table declares recovery, make it greppable in both directions:
   the allow-list of files that may write directly must (a) cover everything
   that does and (b) each name a file that really contains the call — the
   first draft's entry claimed the composer wrote directly, and the second
   half of the check caught it;
   (4) the toast trap, which cost the most time: `undoToast(msg, run)` only
   RAISES the toast — `run` is the Undo button's click. So the callback the
   workspace hands to `applyChange` is "a toast appeared", and a store test
   that invokes it and asserts the row came back asserts a no-op. Capture the
   pair (`vi.mock` the ui module with `importOriginal`, wrap `undoToast`) and
   have the test CLICK it — that is the only version of the test that can
   fail on a broken restore, and it is what lets the file keep the undo
   assertion at all;
   (5) a behavioural predicate must handle the shapes callers actually hold:
   `blocksDirectWrite` read an empty `Set` of staged ids as `true` (every
   object is truthy), which would have refused a write for no reason — the
   footnote to §6t/§6u: "total" and "correct for the real inputs" are
   different claims.
 6z. **A clear/reset control is only as real as the keys it removes, and a
   "way back" table must be greppable in BOTH directions (learned 2026-09-28,
   the #424 recovery audit).** Auditing "every destructive action has Undo or a
   confirmation" started by finding this repo's most destructive button — the
   crash screen's "Reset app data & reload" — removing `yatraflow_db_v1`, a
   localStorage key **nothing in the tree writes**. It had been a real key back
   when the app kept a localStorage database; the app moved to Supabase and the
   line stayed, so the control cleared nothing while promising a reset, in the
   primary style, on one click. Four mechanics, all reusable:
   (1) before believing any reset/clear/wipe promise, **grep the literal key
   across `src`** — a key with exactly one occurrence (the removal itself) is a
   no-op with a safeguard's appearance. The fix is a module that KNOWS what local
   app data is (`lib/localData.ts`) plus a source test that every
   `localStorage.*Item` key and every `*KEY*` constant is either inside the app's
   namespace or a NAME handed to the pref helpers (which add the prefix) — that
   second rule is what caught a real key being the literal `'***'`;
   (2) an audit needs its own anti-rot mechanism or it is a one-off: enumerate
   the destructive-named STORE exports and require each to be declared in the
   recovery table, excused as non-destructive with a reason, or recorded as
   superseded — and check the other direction too (a table row naming a function
   the store no longer exports must fail). Interrogate the failures, don't just
   count them: 16 exports matched, and one was a pre-trash hard delete nothing
   calls;
   (3) if the vocabulary has an escape hatch, pin its burden of proof. A fourth
   recovery value (`regenerated`) exists for removals whose old value would now
   be FALSE (halt pins voided by moving the endpoints), and its test requires the
   row to name what re-derives the thing — without that, it becomes the silent
   catch-all the table exists to prevent;
   (4) a destructive action with no way back is not always dramatic — a tray's
   "Clear" and a settings "Clear" that discarded a pasted API key were both small
   and both real, and an Undo toast is the cheap correct answer for work the user
   assembled. Ask of every removal: can they get it back, and if not, did we ask?

 6aa. **`simulateDay`'s legs are INTO-legs and its arrays are per-ACTIVE-stop —
   a surface looks rows up by stop id, never by render index (learned
   2026-10-02, #555).** `sim.legs[k]` is the drive that brought you TO
   `activeStops[k]` (`legs[0]` is the day's opening drive), and
   `arrivalTimes[k]`/`departures[k]` are that row's clocks — but every rendered
   list (DaySection's `ordered`, PublicItinerary's `stops`) can also carry
   rejected stops the simulator skips, so a positional read shifts at the first
   rejected row. Two surfaces had the model backwards in opposite directions:
   the Timeline's gap under row k showed `legs[k]` (the leg into the row ABOVE
   the gap) and the public strip showed `legs[i - 1]` (one leg stale the other
   way), and one rejected stop moved every clock below it onto the wrong row.
   The vocabulary is printModel's: a leg row renders the INTO-leg of the row it
   leads (`legs[0]` unshifted at the top; the gap under row k carries the leg
   into row k+1), and every clock/leg read goes through `scheduleRowsById(sim)`
   (engine.ts). Positional reads over `sim`'s arrays are only safe where both
   sides come from the same filtered list in the same order (the engine's own
   `activeStops[i]`-paired reads). Pinned in tests/timeline-leg-rows.test.ts —
   and mind the pin split: pure-helper tests cannot police component call
   sites, so the two surfaces carry source pins too (the timeline-quick-add
   pattern); stashing just the components fails exactly those.

 6ab. **A tombstone and a sale-withdrawal are two different verbs — and
   `raise exception` rolls back its own audit row (learned 2026-10-02, the
   marker-family sweep).** Trashing a trip stamped only `trips.deleted_at`,
   while every selling surface (Explore, the sitemap, the share card, checkout)
   reads `published_itineraries.unpublished_at` — so a trashed trip kept
   SELLING while `get_public_trip`'s tombstone filter simultaneously darkened
   the buyers' links: the worst of both halves, from one write where the verb
   needed two. Mechanics: (1) when a lifecycle verb spans two rows, name BOTH
   writes and order them so a half-done state is the harmless one (withdraw
   first, tombstone second — a plan that stopped selling but stayed listed is
   survivable; the reverse is not); (2) when the second write is gated by a
   different principal (`published write` is `auth.uid() = creator_id`, `trips
   update` is `is_editor`), the actor who cannot write it is REFUSED the whole
   verb rather than half-served — and deliberately no trigger: withdrawing the
   sale is the creator's action, not a side effect; (3) `raise exception` aborts
   the transaction INCLUDING any insert made earlier in the same function, so
   "audit before the effect leaves an attempted row" is only true when the
   failure arrives as an error RESPONSE after the body commits, never for a
   raise inside it. A refusal that must be recorded cannot also raise — pick the
   return-value shape or surface the sentence to the caller; a refusal with
   nothing destroyed and nothing to record should raise and say why. The
   comment in 20260929_trash_purge_audit.sql still over-promises on this point.

 6ac. **A module-level timer Map is unowned state — and a write must capture
   WHOSE it is at schedule time (learned 2026-10-02, #578).** The debounced
   trip-write coalescer kept its timers in a module Map no lifecycle event knew
   about: `logout()` wiped the durable queue and cancelled nothing, so a timer
   firing after the wipe RE-QUEUED the discarded entry (stamped with the trip
   OWNER — #393's zombie shape inverted) and sent the UPDATE under whatever JWT
   was live at fire time, the NEXT account's on an A→B switch (which goes
   through `hydrate`, never `logout`). Mechanics: (1) any debounce whose
   callback can outlive a lifecycle boundary needs a hook ON that boundary —
   cancel on logout AND on the hydrate identity transition (the only place a
   one-tab account switch is visible), with a test hook mirroring the flush
   hook; (2) the guard that matters is at FIRE time: capture the session id at
   schedule time beside the captured snapshot and refuse to write under any
   other identity — that also covers the pagehide flush racing a sign-out — and
   "no session at capture" means DROP, never borrow the owner's id (an anon
   write is refused by RLS anyway, so the fallback only ever minted zombies);
   (3) the suites that drive writes with no session now stub one deliberately
   (`getSnapshot().sessionUserId = …`) — the contract change is pinned by
   tests/session-lifecycle.test.ts's #578 block. Quirk: tests/lint-ste.test.ts
   enforces house vocabulary in prose ("try" over its -ments synonym) and fails
   as a TEST — a comment can break the gate, and the lint reads AGENTS.md too.
 6ad. **A hook output called during render must be data, not a function call — an opaque render-time call fails the whole file's compiler check (learned 2026-10-04, #420 slice 9).** `eslint-plugin-react-hooks` v7 (`recommended-latest`) compiles each component; when it bails, `preserve-manual-memoization` reports "Compilation Skipped" on every manual memo and `refs`/`set-state-in-effect` surface every latent pattern — 22 errors on lines the slice never touched (the pristine file lints 0 on those rules, so each flag is cascade, not cause). Bisects isolated the trigger shape: the hook call alone is clean, the effect change alone is clean, undefined-callee calls are clean; the failure needs render-time calls (`slotCands(slot)`, `filingOptionsForPicked(h)`) resolving to hook-returned functions that consume hook-input-derived values. The handler-only hooks from slices 7–8 pass, and `isShortlisted(hit)` passes (a boolean over another hook's data). Wrapping the outputs in `useCallback` does NOT fix it (tried — still 22; cross-file is opaque, so the memoization is invisible where it matters). Shape rule for future slices: hook outputs consumed during render must be state/memo reads (like `searchResults`), never calls; a derivation that needs a call keeps a thin local in the page or moves fully. Specimen: the reverted `useSlotSearch.ts` (deleted uncommitted) moved the slot derivations out while the render kept feeding them `activeDaySlots`-derived values; the replacement slice (`useAddModal.ts`, draft state + handler-only opener) passes clean.
 6ae. **A state that a slice declares may still belong to the page (learned
   2026-10-04, #420 slice 11).** The corridor block declared `searchQuotaOut`.
   The slot search below also wrote it. You must grep each setter across the
   whole file before you move a declaration. You must leave a shared state
   with the caller. A state with one writer moves. A state with two writers
   stays.
 6af. **You must end a scripted cut on the construct's closing line (learned
   2026-10-04, #420 slices 12-14).** A `useMemo` ends on its closing paren,
   not on its deps line. You must include that line in the cut range. Cutting
   at the deps line leaves a stray paren, and tsc reports it far from the
   edit.
 6ag. **A runner with a quota-mapped catch must stay in the page (learned
   2026-10-04, #420 slice 17).** Moving `runSlotSearch` (or the cells it
   writes) into a hook trips the render compiler with a file-wide bail.
   Bisects proved the trigger sits in the catch: any `err instanceof` body
   keeps the file compiling, any reduction bails. You must keep the runner
   and its cells in the page. You must move only the writer beside it. You
   must record the split in the hook header.

 6ah. **A fix-ready comment earns its title in stages — verified facts, root cause, patch,
   delivery (learned 2026-10-05, the review-loop retro).** The day-planner wave (#117–#181)
   ran 53 of these, and every operator correction was a missing stage: a premise taken from
   the issue body without reading the code (#43 — the "lost itinerary" was a
   collaboration-layer delete; #159's claim was already fixed), a delivery claim the diff did
   not contain (#142 — `driverCount` appeared zero times in the settings form the PR claimed
   to change), or a half-delivery closed as done (#122's season half, re-opened the same
   day). The stages: (1) open with what you verified — file and line, the constants as they
   ship, the behavior as it runs; (2) name the root cause before the patch, so a wrong
   diagnosis is visible before code exists; (3) correct a wrong premise on the issue, up
   front, before any fix lands; (4) a partial delivery closes nothing — say which half
   shipped, keep the issue open with the narrowed scope, and put the deferred half where the
   next run will find it (AGENTS §6's idea bank). "Verified" names what you read or ran,
   never what you expect to find. Companions: §6c's absence-claim rule for the
   missing-guard family, the shell-mangling rule for what counts as having read a line, and
   the contrast-claims rule for when verification means measurement.

## 2. Conventions (`AGENTS.md` §4)

The store, maps and UI entries live in `docs/standards/` now (2026-10-05
split); the index table says which file a change touches. What follows is
the cross-cutting residue: data model, platform APIs, verification and
process.

- **You must test both sides of a shared focus or schedule contract.** A prop-presence test cannot prove that a child reads the prop. Check a tab round trip through the browser. Compare arrivals and warnings for the same stop after road measurements resolve.

- **lint:ste counts code tokens as prose on added lines.** A long string inside a call fails the 20-word limit — build user-facing strings in `const` lines (the checker skips them) and keep the call short. A new line naming a banned field (a stop's `priority`) fails the vocabulary check — spread the helper that already declares it. (Learned 2026-10-03, #607–#609.)

- **A verification probe can lie about the thing it probes — and a preview URL lies about its own content.** Two traps hit while closing #226. (1) `process.env.X = undefined` does **not** unset a variable: Node coerces it to the string `"undefined"`, which is truthy, so a probe that "cleared" `PUBLIC_ORIGIN` made the handler's `PUBLIC_ORIGIN || …` fallback resolve to a literal origin of `undefined` and `og:url` read `undefined/i/<id>`. It looked exactly like a product bug for a step; the unit test for the same branch was green the whole time, because `vi.stubEnv(k, undefined)` genuinely deletes. Use `delete` in a probe, and never diagnose a handler from a value the probe itself set. (2) A preview deployment answers **200 with a full Open Graph block** — Vercel's SSO login page carries its own tags (`og:title: "Protected Deployment – Vercel"`), so a "does it contain `og:title`" check passes on the wall itself. Match on the origin/description or check the byte size (~1.2 KB app shell vs ~340 KB login page), never the mere presence of a tag. Keep such probes in the scratch directory, not the repo. (3) **A source-scanning test can match its own subject's prose:** the tripwire asserting that `presence.ts` calls no weak generator failed on the doc comment *explaining* that it no longer does. Strip comment lines before asserting on source text, and match the call (`/Math\s*\.\s*random\s*\(/`) rather than the bare name — a test that forbids a string has to decide whether it forbids mentioning it.

- **Jev audits are development-only review aids, not correctness oracles.** Keep `JEV_AUDIT` opt-in and credentials outside `VITE_*`. Repository seed/copy strings are not user transcripts or an independent holdout after tuning. Report code/model/expected-label results separately, disclose label corrections, and pin confirmed keyword collisions in offline regression tests before changing the router.

- **Data model**: times are always stored as 24h `"HH:MM"` strings. Format at
  render with `formatHM`/`formatHMRange` + `useTimeFormat()` from
  `lib/timefmt.ts`. 12h is the default; 24h is a user setting (Profile page).

- **Optional fields are `string | undefined`** (`closeTime`, `openTime`,
  `departTime`, …). Helpers must type their params for the data model's real
  shape, not the happy-path call site — a helper requiring bare `string` turned
  into a Vercel-only build failure.

- `dev.log` is untracked local clutter — ignore it, never commit it. (It **did** get committed in `f09aaf9` when a bulk `git add` in this shared working copy swept it up — and the commit was pushed, so removing it needed a follow-up untrack commit. Stage explicit paths only; never `git add -A` / `git add .` here.)

- **An agent tool's scratch file must never be *tracked* — and a commit about something else must never sweep one in.** `.verdent/pr-body.md` was tracked on `test`, so every branch that used that tool rewrote it: no two of them could stay open together without conflicting on the file, and a three-file feature PR carried **115 lines of another PR's prose** in its diff (found 2026-09-19 while rebasing #254/#258, where it read as unexplained noise until the file was checked). It is now untracked and ignored alongside the other agent-tool output; **`.verdentc.json` deliberately stays tracked** — that one is real deploy config (install/build commands, output dir), not tool output. Before blaming a diff on your own work, run `git diff --name-only <base>...HEAD` and check what is actually in it.

- **A test that walks every source file must read them in parallel — sync reads cost ~12 ms each on this box (learned 2026-09-28).** A 194-file `src/` sweep spent 2.4 s in `readFileSync` (the directory walk itself: 8 ms) and timed out at vitest's 5 s default under full-suite load; the same sweep with `Promise.all(readFile…)` runs in 64 ms. The AV serializes per-file opens, so batching the opens is the fix — measure before reaching for a bigger timeout.

- Test style: pure logic only, node env; mock `fetch` with route tables
  (`tests/providers.test.ts` has the pattern); `vi.stubEnv` for API keys.

- **Diagnostic logging should be guard-claused.** Haptics logging (`haptics.ts`) showed `[HAPTIC]` entries even on iOS where `navigator.vibrate` doesn't exist — misleading noise. Guard `import.meta.env.DEV` logging behind `typeof navigator !== 'undefined'` so logs only appear when the API actually exists. Corollary: test environments that mock `window`/`navigator` must include `vibrate` (even as a no-op) to avoid console spam.

- **Gate a control and its surface with the same predicate (learned 2026-09-22, APK audit).** The signed-out Android shell kept the topnav's hamburger button while its tray was `!isNative`-only — a visible control whose tap toggled state that rendered nothing. When a surface is platform- or flag-gated, grep for its trigger and gate that too; the shared gate is pinned in `tests/mobile-shell.test.ts`.

- **Combining a caller's AbortSignal with a timeout must feature-detect `AbortSignal.any` (learned 2026-09-21, PR #289 review).** `AbortSignal.any` is Baseline-2024 — Safari < 17.4 throws on it, and if the throw sits *outside* a try it escapes whatever fallback the call site promised (a configured companion would have shown the canned error instead of the offline router's answer). The guarded pattern lives in `routing.ts`'s `requestSignal` and `aiProvider.ts`'s `mergeSignal`: detect `Any.any`, fall back to the bare timeout, and hand an already-aborted caller an already-aborted signal — never a fresh timeout, which would send post-abort fallback fetches out live.

- **Never rewrite JSON with a text regex you cannot count.** A pass that added 1 to every `orderInDay` via a pattern requiring a trailing comma silently skipped the last key of each object, and a bulk rewrite of a data file has no type to catch it — the file still parses, it is just partly un-migrated. Prefer repairing through the parser (`JSON.parse`/`stringify`) or, when the raw text must be preserved for a minimal diff, assert the replacement count against the parsed count and re-validate afterwards. Same family as rule 9's changelog rewrites.

- **A day's END is not a free variable — a reorder that moves a night's base rewrites the next morning.** `dayEndPosition` returns a day's last *stored* stop and `originOf(next day)` walks forward through it, so anything that moves the tail moves where tomorrow starts. Optimise-day pinned only `auto` stops (engine-synthesized waypoints) and never a stored hotel, so on the six shelf itineraries **21 of 32 optimisable days had their tail replaced, 18 of them the night's base, and 14 day-pairs shifted the next wake-up point — worst 16.3 km** (sleep in Candolim, plan the morning from the Basilica). A `hotel`/`rest` stop at the tail is now an implicit anchor. Two rules for any future reorder surface: **(1) before treating a stored value as movable, ask which other days are DERIVED from it** — endpoints, origins, roll-ups; **(2) a warning count is not a safety net** — optimising every shelf day moved Coorg 2→4 warnings but Goa **1→0**, silently dropping the only flag while the endpoint had moved 16 km. Test the property, not the symptom: assert `originOf(next day)` is unchanged after the reorder, which is what caught it. (Found 2026-09-18.)

- **The shell MANGLES non-ASCII — `₹` printed as `?`, and that invented a defect that did not exist (learned 2026-10-02).** `BudgetTab`'s quick-add amount field was reported as `placeholder="?"`, a bare question mark where the currency glyph should be. It was never a question mark — the file has always said `₹`. Any console dump (`Select-String`, `grep`) of a line containing a non-Latin-1 character is suspect: **read the file with the `read` tool before believing anything inferred from shell output**, and never file a copy or a11y finding whose evidence is a mangled glyph. That session produced two further phantoms for unrelated-but-same-root reasons — a `.link-btn` "1.98:1 failure" that every call site overrides with `.teal` (and two sibling classes with no call sites at all), and 13 "unlabelled" inputs a `Field` in a *different file* had already named. Standing rule: **a review finding is a hypothesis until you have read the line that renders it.**

- **A UI gate earns its place only with zero false positives — COUNT every candidate rule against `src/` before shipping it (learned 2026-10-02).** `npm run check:ui` (`scripts/uiAntipatterns.mjs`) enforces exactly three rules, because the other ~20 candidates were measured first and rejected on the numbers: `scale()` in `:hover` has **9** sites and all are correct (a `position:fixed` FAB, absolute map markers, a range thumb — none reflow, which is what the rule is really about); emoji-as-icons has **403** codepoints across **78** files, mostly `weather.ts`'s legitimate WMO map and user-chosen `coverEmoji`; `outline: none` has 44 uses and only 4 lack a replacement, several of those being a `border-color` change that is a perfectly good focus ring. A gate that fires on correct code gets muted, ignored, then deleted — so add the count to the script's header with the exclusion, and don't re-derive it next session. Contrast is already owned by the design-system baseline ratchet; never add a second, weaker check beside it.

- **`gh` batch loops in this shell exit 1 while partially succeeding.** A PowerShell `foreach` over `gh issue close` reported command failure with no visible output, yet had closed every item — the next retry only surfaced "! already closed". After any compound `gh` batch, re-derive state (`gh issue list`) before retrying; idempotent retries are safe, blind assumptions are not.

- **Section-restructure edits can silently swallow bullets** — an edit whose
  `old_text` spans `<heading>` + its bullets + the next `<heading>`, replaced
  by just the next heading, **deletes the bullets**, not only the heading.
  After any heading-level restructure (CHANGELOG releases especially),
  re-grep all headings and re-read the affected range before trusting it.
  (The 0.18.0 restructure briefly lost four Fixed bullets this way.) A
  variant: replacing a long bullet's **lead sentence as a prefix substring**
  splits the bullet — the orphaned tail stays glued to whatever the
  replacement ends with (a duplicated `### Fixed` + a Frankenstein bullet,
  Sep 2026). Never match a bullet by its lead alone; include the full line or
  re-read the section after the edit.

- **`git diff --check` before committing any merge** — conflict markers in
  *non-code* files (CHANGELOG.md) are invisible to the whole verify gate
  (`tsc` + tests + `vite build` all passed with a leftover `<<<<<<< HEAD` in
  the CHANGELOG during the PR #30 merge, Aug 2026). `git diff --check` exits
  non-zero on leftover markers; run it before `git commit` on every merge.
  **Markers can arrive already committed from someone else's merge** (found
  Sep 2026: merge `f83fee4` shipped `<<<<<<< HEAD` + an orphaned `=======`
  into CHANGELOG.md on `test`, where everything downstream — including the
  next release cut — inherits them). After syncing or merging remote work
  that touched CHANGELOG, grep for `<<<<<<<`/`=======`/`>>>>>>>` before
  writing prose near the affected section.

- **When merging an agent PR that's based on pre-rewrite code, keep the local
  structure and re-apply the PR's *intent*** — PR #30 was based on the
  pre-`ridePlan.ts` tree, so its TripWorkspace hunks showed obsolete ranking
  code; taking "their" side wholesale would have reverted the ride-plan
  engine. Also: a signature change arriving via merge (`detourKm` →
  `number | null`) must be null-guarded at *every* caller, including files
  the PR never touched (`ridePlan.ts:256` — tsc catches it, but only because
  strict null checks were on; auto-merged hunks in other files won't be
  flagged by the PR author's green CI).

- **GitHub markdown links resolve from the file's own directory** — a
  root-level file links `docs/X.md` (never `../docs/`), files in `docs/`
  need `../` to reach root files like `DESIGN_TOKENS.md`, and emoji
  headings anchor with a leading dash (`## 🚀 Getting started` →
  `#-getting-started`). PR #25 shipped four broken links this way — check
  every link target against the tree before merging doc changes.

- **An effect that depends on asynchronously-hydrated store data must list those values in its dep array.** `InviteGate` used a mount-only `[]` effect, which fired before `init()` resolved — `me`/`trip` were both null, so the invite never auto-joined and the user sat on the spinner. `react-hooks/exhaustive-deps` (now wired via `npm run lint`) flags exactly this; don't suppress it with `eslint-disable` when the fix is to depend on the resolved object.

- **The impact dialog's time delta must include dwell, not just driving.** `computeImpact` summed `totalTravelMinutes` (wheel time only), so adding a 20-minute halt showed a ~0 time extension and the preview looked broken. `DaySchedule` now exposes `dwellMinutes` (visit minutes + per-stop buffers) and the delta sums both — relabelled "Time on the road (driving + stops)" so the semantics are visible. Note `computeTotals.totalTravelMinutes` is still driving-only for budget/warning math; don't "fix" one and silently change the other.

- **An Edit whose `old_string` ends mid-line silently drops the line's tail.**
  Editing JSX whose expression closes as `</>}` with an `old_string` ending at
  `</>` matched the prefix and deleted the trailing `}`, leaving a parser error
  (TS1005) one line below the edit — and a second edit anchored on a nearby
  comment duplicated a `const` instead of moving it. After any multi-part
  restructuring edit in this repo, run `npx tsc -b` immediately and diff-review
  before continuing (M3.3, Sep 2026). Variant (halt-planner fix, Sep 2026):
  replacing "line + trailing newline" with the same line *without* the newline
  merges the NEXT line into it — and since two statements on one line is valid
  TS, **tsc stays green on the merge**; only re-reading the edited region
  catches it. Anchor `old_string`/`new_string` pairs so line endings can't
  shift: include the following line in both, or end neither with a newline.

- **`src/styles.css` is CRLF on disk — Node one-off scripts must handle `\r`.**
  Bulk CSS edits via `node` scripts split on `\n`, so every line carries a
  trailing `\r` and exact-string anchors silently fail (or, worse, writing
  LF-only sections leaves the file mixed-ending). Strip `\r` before matching,
  and re-normalize to CRLF after writing (`git show HEAD:file` is LF-normalized,
  so byte-diffs against it need `\r` stripped too). Also: this shell mangles
  backslashes inside heredocs/`node -e` — write the script to a file (Write
  tool), run it, delete it.

- **Never round-trip file bytes through a PowerShell pipeline** (`git show X:file
  | Out-File` or `>`). The decode-then-re-encode step mojibakes every non-ASCII
  character (em-dash → `ΓÇö`, § → `┬º`) and the damage ships green: tsc, vitest
  and vite all pass on valid-but-corrupted CSS/TSX — only a byte-level check
  (python counting `\xe2\x80\x94` vs the mojibake sequence) catches it. Materialize
  git blobs with `git checkout <ref> -- <path>` / `git restore --source`, or read
  them byte-exact via python `subprocess`. Unquoted backticks in shell command
  strings suffer the same fate: a BEL (`\x07`) landed in committed CHANGELOG
  prose where the letter "a" should be (Sep 2026) — that is how `\u0007pplyChange`
  happened.

- **Porting a feature from a stale branch by copying its whole file silently
  reverts everything the base gained since the fork.** The calendar-export merge
  overwrote the tabbed ShareTab (PR #74's refactor) and deleted the
  `.ai-drawer:not(.open)` close rule that way — and nobody noticed because the
  verify gate has no UI assertions. Before taking a branch's version of a file,
  diff it against the merge base (`git diff <merge-base> <branch> -- <file>`)
  and port only the intended hunks.

- **A stale visual branch is re-cut, never merged — and layout overrides on shared classes belong inline, not in the stylesheet (learned 2026-09-29, #512).** The V2 settings branch predated five behavior waves on the same form, so merging either way silently reverted one side. The recut keeps test's state/handlers/tests verbatim and re-applies only the presentation — and every landed mapping stays landed (the branch's stale `HEALTH_TONE`/`MODE_ICON`/inline settlement math were the traps). Companion: `tests/health-band.test.ts` collects every rule whose SELECTOR mentions health/pulse, so four layout overrides (`.tsx-read .health-*`) failed it as non-vocabulary additions — one-off compositions on shared classes go inline (`style={{ gap: 14 }}`), keeping the tripwire asserting exactly the band vocabulary.

- **A squash-merge can silently DROP files, and nothing in the gate catches it.**
  PR #75's squash carried the calendar/print/ShareTab files but silently omitted
  `src/pages/TripsList.tsx` — My Trips reverted to a bare list for a release, the
  contributor had to file a restore PR (#80), and the earlier session summary even
  claimed the feature "was already merged" without file-level proof. The gate stays
  green (nothing exercises an absent feature). Rules: after merging external work,
  diff the PR's `--name-only` list against what actually landed (`git show <merge> --stat`
  / grep for a marker from each claimed feature) before writing any summary; and when
  a contributor's PR says "this was dropped", believe them enough to verify — grep for
  the feature's symbols (`useMemo`, a state key) in the current tree, not in memory.

- **A casing audit needs `-CaseSensitive` and must grep the enum definitions, not the
  literals.** Two traps cost a false alarm and a near-miss in the same session: (1)
  PowerShell's `Select-String` is case-insensitive by default, so `label="[a-z]` happily
  matched `label="Menu"` and reported ~85 phantom offenders; (2) raw-enum renders
  (`{TRANSPORT_MODES.map(m => <option>{m}</option>)}`) are invisible to string-literal
  greps — the lowercase lives in `types.ts`, not the JSX. Audit the enum arrays and find
  their render sites. Related: an `<option>` without `value=` derives its value from its
  *text*, so capitalising the label alone writes "Car" into the data model — always add
  the explicit `value=` when prettifying option labels. And prefer consolidating the
  per-file copies of a formatter (`cap` had 7, `labelCat` 4 with drifting behaviour) into
  one `lib/labels.ts` over fixing sites one by one.

- **Merging external work that also edits CHANGELOG can produce TWO `## [Unreleased]`
  sections — invisible to the entire gate.** PR #80's squash carried its own `[Unreleased]`
  while the working tree already had one, leaving a duplicate header (and a duplicate
  `### Fixed`) that tsc/tests/build all pass on. The release-cut keys off the **first**
  `[Unreleased]`, so the next version bump would have silently dropped half the entries.
  After any merge touching CHANGELOG: `Select-String -Pattern '^## |^### '` and confirm the
  counts are 1/1/1 before committing.

- **Changing approach mid-task orphans both the code AND the changelog text you already
  wrote.** Trip settings went from "extract compact primitives" to "reuse the bench's own
  classes"; that left `SettingsGroup`/`CountStepper`/`OptionTiles` as dead exports
  (`noUnusedLocals: false` never flags them) and a committed CHANGELOG bullet naming
  primitives that no longer exist. On any approach change: re-grep for every symbol you
  introduced in this session and re-read your own changelog prose against the final code.

- **Vendored ripgrep can be missing in the desktop environment — `code_search` fails with ENOENT (`rg.exe` not found).** Don't retry it; fall back to `grep -n` / `awk` in the shell, which answer the same question.

- **Release tags are not automatic — they were skipped after v0.44.0.** `git tag` stopped at v0.44.0 while `package.json` climbed to 0.47.0 and nothing in the gate reads tags, so nobody noticed. Verify tag state with `git tag --sort=-creatordate | head` when a release claims to be tagged; backfilling needs an explicit tag push to the remote.

- **A day is addressed by `day.index` and never by array position — and one report names only one of the places that got it wrong (learned 2026-09-26).** Issue #338 read as a per-day money bug in `computeTotals` (`byDay` was built positionally but read with `byDay[day.index]`, the round-trip drive home went to `byDay[len - 1]`, and an expense's `dayIndex` was clamped to the last day — so on a sparse trip, indexes 0,2,3 after a deleted middle day, a day could show a stranger's total). Fixing exactly that was not enough for the issue's own acceptance test *"an unsorted `trip.days` array follows `day.index`"*: the same index-vs-position mistake lived in `originOf`'s `dayEndPosition` (`trip.days[dayIndex]`, so a sparse trip's later days woke up at their own start and measured zero legs), in `firstFixedPoint`/`lastActiveStopPoint` ("home" and the return turnaround read from the array's first/last slot, so shuffling the array moved the whole route), and in two `day.index === trip.days.length - 1` return-shape checks (a count is not the last index). When a day-keyed bug lands, grep `trip.days[` **and** `days.length - 1` across `src/lib` before calling it fixed. The readers clamp too: the Timeline's chip, `printModel` and the engine's own lookups each had their own positional `Math.min(index, len - 1)` — a lookup that finds no bucket must render NOTHING, never another day's number. Two smaller lessons from the same wave: the page handlers that carry this class of bug can still be regression-tested in the node suite — `react-dom/server` renders a pure component (`tests/timefmt.test.ts`, `tests/form-error-summary.test.ts` are the precedent, used here for `DaySpark`'s NaN coordinates) and a narrow source assertion binds a handler to the helper it must call (`tests/decision-resolve.test.ts` is the precedent); and a guard keyed on a row's `status` must treat a MISSING status as open (`if (sg.status && sg.status !== 'open')`), because a hydrated row that predates the field would otherwise become un-actionable — the `fire-and-forget` fixture has no status and caught exactly that.

## 3. Scripted edits

Read this section **before** writing any script that edits a source file.
The editor primitives are the default; a script is the exception.

- **A scripted replace needs an anchor that is unique.** `.NET String.Replace`
  replaces every occurrence, and `-replace` has no "first only" mode. A
  `useEffect` was once inserted after the anchor `}, [isLoaded, map, data,
  sourceId]);` in `mapcn/map.tsx`, which matched **two** components
  (`MapGeoJSON` and `MapClusterLayer`) and wrote the effect into both. `tsc`
  then failed with "Cannot find name" about 700 lines from the intended edit.
  Count the anchor first — `[regex]::Matches($src, [regex]::Escape($anchor)).Count`
  must be 1 — and use `$rx.Replace($src, $new, 1)` when it really appears twice.
  Note that `[regex]::Matches($src, $rx.Pattern)` counts something else
  entirely: `.Pattern` is a string, so the call returned the file's byte length.
- **Never delete a range you found by scanning forward to the next match.**
  That scan took the enclosing block's brace with it and left a file that did
  not parse. The fast recovery was `git checkout -- <file>` and redo.
- **PowerShell parses the whole script before running any of it.** Three
  separate typos (a variable name with `?:`, a stray `)`, a backslash-escaped
  quote) each aborted before the first statement, so nothing was ever
  half-written. Keep that property: assert every anchor exists and is unique,
  `throw` before any write, then verify by counting the token you inserted.
