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
| Stored vs rendered, covers, media, buckets | Conventions below |

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

## 2. Conventions (`AGENTS.md` §4)

- **Anything that leaves the device must read STORED state, never what a component happens to render (learned 2026-09-19).** `CoverThumb` resolves a trip's cover from three sources in order — the owner's explicit `coverImageUrl`, then a Wikipedia photo fetched at runtime and cached in localStorage — so a trip with no stored cover still *looks* illustrated. The share preview has no such fallback chain: `api/i.js` reads `published_itineraries.cover_image_url` and nothing else, so a publication published without an explicit cover stamped `NULL` and previewed as the brand card while the app showed a photo of the destination. Both halves were correct in isolation and the reporter's symptom ("it shows the brand image on all links") read like a handler bug; the data answered it in one query (`select id, cover_image_url from published_itineraries`). Rule: when a rendered value has a runtime fallback, ask what the *stored* value is before debugging the consumer — and if a downstream surface (a crawler, an API, an export) can only read the stored one, make the fallback explicit and persisted at the moment the user commits (here: the publish form requires a saved cover), or the two will disagree silently forever.

- **A user-facing rule that exists to satisfy a server-side consumer must be pinned to that consumer's own rule, not restated.** The publish form's cover validation is the preview handler's `^https://\S+$` — and if it drifts (say the form starts accepting http), a creator satisfies the form and still ships a link that silently falls back to the brand card. The cheapest guard is a test that the *same literal* appears in both files, next to the assertions that already pin the production origin across `api/i.js`, `src/lib/shareUrl.ts` and `index.html`; the duplication is unavoidable (the handler is plain JS outside `src` and must not import client code), so pin it rather than trust it.

- **A value that looks applied and reverts on reload is a missing optional column, not a UI bug — and the probe is what hides it (learned 2026-09-19).** `trips.cover_image_url` was probed by the store (`tripsHaveOptionalColumns`) from the day the cover picker shipped, but no migration ever created it, so `tripToRow`'s `if (cols?.cover)` omitted the field on every save: the picker showed the new cover, it survived until the next reload, and then silently reverted to the runtime Wikipedia suggestion. `probeOptionalColumn` is *deliberately* graceful (a false negative must not block unrelated settings writes), so the failure is invisible in the UI, in `tsc`, and in the test suite — the only artifact that answers it is the column list itself, or a reload. Two reflexes close the class: when a stored-looking value reverts, `select *` the row and check the column exists before touching the component; and `tests/tripRow.test.ts` now pins every `probeOptionalColumn('…')` literal in `src/store/store.ts` against the migration set, which is the check that would have caught this one. Adding a probed field therefore means adding its migration in the same change.

- **Uploaded images are the only bytes in this repo on a meter we pay for, and the downscale is what keeps them free (learned 2026-09-19).** A cover is fetched by every crawler that unfurls a shared link, so both storage and egress scale with *bytes*, and Supabase charges for both past the plan allowance (Storage **$0.0213/GB-month**, egress **$0.09/GB uncached / $0.03/GB cached** — Free allows 1 GB and 5 GB, Pro 100 GB and 250 GB). Measured through the real pipeline: a phone-class 1,335,523-byte photo becomes **77,818 bytes** at 1200px, 17× smaller and invisible at the sizes we render — so 1,000 covers cost ~$0.002/month to hold and ~$0.002 to serve a thousand preview fetches, while the free tier holds ~13,000 sized covers against ~780 originals. Resize on the client before the upload; never raise `COVER_MAX_EDGE` without redoing that arithmetic.

- **An uploaded object's URL is copied onto forks and publications, so its original uploader must never delete it (learned 2026-09-19).** `duplicateTrip`/`importTrip` copy `coverImageUrl` onto every forked trip (`store.ts`), and publishing stamps it onto `published_itineraries.cover_image_url`, which `api/i.js` serves as `og:image`. A fork belongs to a *different* user, so when the creator replaces their cover the app cannot know what still points at the old object — and the failure is silent in the worst direction: the replacing creator's own screen keeps showing the new photo while every fork and every live share card 404s. The delete-on-replace that looks like housekeeping is therefore a correctness bug, and the same hazard applies to any future "remove my upload" control. Keep orphans (~100 KB each, $0.0213/GB-month); a janitor may only collect an object it can prove unreferenced, which no single client can. `tests/cover-upload.test.ts` pins the absence of the delete so it cannot be re-added as an "optimization".

- **The `covers` bucket must stay public-read, and writing is folder-scoped to the uploader.** A preview crawler never presents a session and never will, so a private bucket makes every uploaded cover fall back to the brand card *while looking perfect in the app* — the same silent disagreement as the stored-vs-rendered cover bug, one layer down. Writes are confined to `<auth.uid()>/<random>.jpg` (`storage.foldername(name)[1] = auth.uid()::text`), which is also why the client always uploads a fresh random name and deletes the previous object *after* the new one lands: a failed upload can never destroy the live cover, and the delete keeps storage proportional to publications rather than to uploads ever made.

- **A client-side visibility filter is a second policy, and it will disagree with the server's — never gate a public catalog on a different table's readability (learned 2026-09-19).** Hydration kept a published itinerary only if the trip behind it was in the client's trip cache (`dedupePublished(pubRows, visibleTripIds)`), which was fine until the paywall hardening made another creator's trip row unreadable to a non-member **on purpose** (`20260918_payments_security.sql`). The two features were each correct and together they emptied Explore for every signed-in visitor: the rows were read, then thrown away by the client, and `#/pub/<id>` said "This itinerary didn't load" because the public page finds its publication in that same cache — while the identical page worked logged out. Ask what the row *is* before filtering it: a publication is the public artifact (the preview handler, the public page and Explore serve it), and `published_itineraries.trip_id ... on delete cascade` already guarantees it cannot outlive its trip, so no client-side visibility test is needed or correct. The follow-on worth knowing: the workaround that fed that filter (`catalogTrips` — fetching foreign trips so the valid set would be non-empty) put other people's raw trip rows in the client cache, which is exactly what the paywall's wire-level stubbing exists to prevent; the fork path preferred that cache hit. When a hardening lands, grep the client for places that treat "a row I can see" as "a row exists" — `tests/gallery-visibility.test.ts` pins this one, and the same shape applies to any list derived from a table you are about to make less readable.

- **A write-path fix is not a backfill, and only the row's own creator can perform one (learned 2026-09-19).** Taking ownership of an auto-suggested cover shipped *inside* `publishItinerary`, so every publication created before it — and every publish whose copy fell back, which is the copy's deliberate failure mode — kept its `og:image` on a third-party host. Existing rows need their own pass, and that pass must be **derived from the data** rather than guarded by a flag: a row still pointing at Wikimedia *is* the work list, which makes a second run free and makes a swallowed failure retry on the next load instead of being forgotten. Know the boundary before designing one: the `covers` bucket confines every write to `<auth.uid()>/…`, so **only the creator of each row can collect it** — no cron, no job and no admin-console action can take another user's cover (the console holds no service key), and a creator who never opens the app again leaves their row as it was. Say that limitation where the feature is described instead of implying the sweep is complete. `store.collectUnclaimedCovers()` is that pass for covers; the same shape applies to any future "own it instead of linking to it" copy.

- **`20260919_covers_bucket.sql` is migration-gated — probe the bucket before doubting the client.** Until it is applied, every upload fails with `Upload failed: Bucket not found`, which the picker shows verbatim; the client path, the resize and the request are all fine. One anonymous call answers it: `curl $SUPA/storage/v1/object/public/covers/x.jpg` returns `NoSuchBucket` when the bucket is absent. The bucket also enforces `allowed_mime_types` and a 5 MB `file_size_limit` of its own — a client allowlist is not a boundary, so the two lists are pinned to each other by a test.

- **A drawn layer and a marker layer must share their source, or the line will touch points nothing marks.** The Map tab draws a selected day's engine journey (`buildJourney` — which can open at the previous night's stop and close at a synthesized destination or the ride home) while its pins come only from that day's *stored* stops. A route end could therefore sit on a bare spot and read as "the route stops" — a real report on 2026-09-17, where the line proved complete (3,481 road points ending exactly at the engine's endpoints) and only the marker was missing. Synthesized journey endpoints now get their own pin, deduplicated through `coLocates` (< 1 km); `lib/journeyMarkers.ts` is that seam. When two layers derive from different data, walk the drawn geometry's endpoints and assert every one is marked.

- **A span request's results are indexed by span offset, not by missing-leg position.** `routePath` measures ONE span covering the `first..last` *uncached* leg — which necessarily includes any cached legs inside it — so `missing[k]` and `chainLegs[k]` are different legs the moment there is a hole. Indexing by `k` handed the tail leg its neighbour's geometry **and** cached it under the neighbour's key, so the corruption outlived the draw (the symptom was a route that visibly stopped early, #polylines). Cached holes are this design's normal state, not an edge case — the leg cache is deliberately shared between the whole-trip chain and each day's ride — so every span-assignment change needs a test with a hole *between* two misses, not a cold cache or a single missing leg.

- **Route anchors reachable from a public pathname need `appLink` on the real `<a>`.** Root-absolute web hrefs let new tabs escape `/i/<id>`; unmodified left clicks must still set only the hash to avoid reloading. Leave modified/already-handled clicks to the browser, and keep native/file hrefs fragment-only. The metadata handler cannot recover a fragment. Address promotion must use `routeParts`, then the handler's id allowlist — trailing slashes, per-segment queries and extra segments can still render the publication.

- **A browser-copied public URL must carry the publication id before the hash.** Fragments never reach preview crawlers. `syncPublicAddress` aligns the web pathname with `#/pub/<id>` on mount and hash changes, using `replaceState` without adding history entries. Clear `/i/<id>` when leaving the public route, keep native/file routing untouched, and never build creator/invite/snapshot links from the current publication pathname. Test Back/Forward, switching publications and the handler's root-shell redirect separately; correct metadata in an HTTP probe does not prove WhatsApp rendered it.

- **Share-preview tests must execute the handler, not merely find tag strings.** A preview fetching the production shell can combine production bundle hashes with preview-host assets. The `/i/<id>` endpoint instead returns metadata and an explicit redirect to the hash route, with a bounded public-metadata fetch and no app-shell request. Native share URLs must use the public website, never the WebView origin. Keep deployment/crawler acceptance separate from local test success.

- **A verification probe can lie about the thing it probes — and a preview URL lies about its own content.** Two traps hit while closing #226. (1) `process.env.X = undefined` does **not** unset a variable: Node coerces it to the string `"undefined"`, which is truthy, so a probe that "cleared" `PUBLIC_ORIGIN` made the handler's `PUBLIC_ORIGIN || …` fallback resolve to a literal origin of `undefined` and `og:url` read `undefined/i/<id>`. It looked exactly like a product bug for a step; the unit test for the same branch was green the whole time, because `vi.stubEnv(k, undefined)` genuinely deletes. Use `delete` in a probe, and never diagnose a handler from a value the probe itself set. (2) A preview deployment answers **200 with a full Open Graph block** — Vercel's SSO login page carries its own tags (`og:title: "Protected Deployment – Vercel"`), so a "does it contain `og:title`" check passes on the wall itself. Match on the origin/description or check the byte size (~1.2 KB app shell vs ~340 KB login page), never the mere presence of a tag. Keep such probes in the scratch directory, not the repo. (3) **A source-scanning test can match its own subject's prose:** the tripwire asserting that `presence.ts` calls no weak generator failed on the doc comment *explaining* that it no longer does. Strip comment lines before asserting on source text, and match the call (`/Math\s*\.\s*random\s*\(/`) rather than the bare name — a test that forbids a string has to decide whether it forbids mentioning it.

- **Jev audits are development-only review aids, not correctness oracles.** Keep `JEV_AUDIT` opt-in and credentials outside `VITE_*`. Repository seed/copy strings are not user transcripts or an independent holdout after tuning. Report code/model/expected-label results separately, disclose label corrections, and pin confirmed keyword collisions in offline regression tests before changing the router.

- **Data model**: times are always stored as 24h `"HH:MM"` strings. Format at
  render with `formatHM`/`formatHMRange` + `useTimeFormat()` from
  `lib/timefmt.ts`. 12h is the default; 24h is a user setting (Profile page).
- **Optional fields are `string | undefined`** (`closeTime`, `openTime`,
  `departTime`, …). Helpers must type their params for the data model's real
  shape, not the happy-path call site — a helper requiring bare `string` turned
  into a Vercel-only build failure.
- Browser-native `<input type="time">` follows the OS format **by design** and
  cannot be forced to 12h — don't replace it. The convention: keep the native
  input and echo the app preference as a live `.time-preview` ("= 6:30 PM")
  under it (see StopEditor / timefmt).
- **Mobile**: breakpoint is **720px**; mobile CSS lives in the single
  `@media (max-width: 720px)` block at the end of `src/styles.css`; keep touch
  targets ≥40px; inputs 16px on mobile (iOS Safari zooms smaller ones).
- **MapLibre/mapcn**: don't import `maplibre-gl` types directly in components —
  use the structural-cast pattern (`GeoJSONSourceLike` in TripMap.tsx).
- **Overlay z-index ladder** — use the `--z-*` token rungs in `styles.css` (`:root`, M4):
  impact sheet 210 > toast 200 > modal 100 > ai-drawer 90 > notif 80 > expanded map
  shell 70 / ai-fab 70 (tie — DOM order decides) > nav glass 60 > mobile dock 55.
  Any full-page overlay (e.g. the map's `⤢ Expand` mode, `.map-shell--expanded`) must sit BELOW the dialogs it can spawn, so modals/impact sheets opened from it still layer on top — no
  collapse-on-open coordination needed. The impact sheet is DELIBERATELY above toasts
  (210 > 200): a transient toast must never cover the Keep/Remove controls. Corollary: container-size changes need
  no manual `map.resize()` — mapcn's wrapper already runs a ResizeObserver
  that re-fits the canvas (map.tsx).
- **A popup's stacking rung is decided by its HOST, not by the popup.** A `position: relative`
  block that carries a `z-index` becomes a stacking context, so every descendant — including an
  absolutely-positioned calendar or dropdown sitting at a high rung of its own — paints at the
  BLOCK's rung. The Create-Trip calendar declared `z-index: 60` inside a host pinned at `2`, so
  the whole popup painted under the fixed bottom dock (55) and its lower rows were unclickable
  on a phone. Raise the host, not the popup. Verify by **hit-testing**, never by reading
  z-indexes: `document.elementFromPoint()` at the overlap must return the popup's own child.
- **`scrollWidth` is not evidence of a horizontal-scroll defect.** `html { overflow-x: clip }`
  (this file's chosen answer for decorative bleed) lets the document report a scrollWidth far
  wider than the viewport while `scrollLeft` stays `0` — the landing page measures ~600px at a
  390px viewport purely from the destination marquee's offscreen track. Test what the user
  actually experiences: `canScrollRight` (set `scrollLeft = 9999`, read it back) plus, per
  element, whether its right edge passes the viewport **without a clipping ancestor**. The same
  clip cuts both ways: overflowing content is unreachable rather than scrollable, so a
  clipped-but-wide layout HIDES controls instead of exposing them. (Both faces of this were
  live: the marquee was a false positive, the `.two-col` blowout a real one.)
- **An absolutely-positioned child needs a positioned ancestor in EVERY class variant.** One
  shared child (`CoverThumb`'s `.itin-cover-fallback`) is `position: absolute; inset: 0`, but
  only the wide `.itin-cover` variant declared `position: relative` — so the short `.itin-emoji`
  variant let the fallback escape its box and paint over the card's title. When a child is
  positioned, grep every parent variant for the containing block.
- **Basemaps are OpenFreeMap (keyless, commercial-OK) — never reintroduce CARTO
  or Esri tiles.** `mapcn/map.tsx` `defaultStyles` =
  `https://tiles.openfreemap.org/styles/{positron,dark}`. Their `style.json`
  ships without `sources.*.attribution`, **but** the `openmaptiles` source
  points at the TileJSON `https://tiles.openfreemap.org/planet`, which carries
  the required OSM/OpenMapTiles credit — MapLibre resolves it and renders it
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
- **HTML5 drag-and-drop does not work on touch devices** (no `dragstart`).
  The convention: keep HTML5 DnD for desktop, and route touch through the
  long-press pointer engine in `lib/touchDnd.ts` (integrated via `useReorder`).
  Any new drag surface must add both paths or explicitly opt out.
- **View prefs pattern**: per-object UI preferences (day collapse
  `yatraflow_day_collapsed`, hidden ride hints `yatraflow_ride_hints_hidden`,
  clock format `yatraflow_time_format`) live in localStorage via
  `lib/uiPrefs.ts`/`lib/timefmt.ts` — failure-tolerant maps of booleans keyed
  `"<tripId>:<dayIndex>"`, never trip data.
- `dev.log` is untracked local clutter — ignore it, never commit it. (It **did** get committed in `f09aaf9` when a bulk `git add` in this shared working copy swept it up — and the commit was pushed, so removing it needed a follow-up untrack commit. Stage explicit paths only; never `git add -A` / `git add .` here.)
- **An agent tool's scratch file must never be *tracked* — and a commit about something else must never sweep one in.** `.verdent/pr-body.md` was tracked on `test`, so every branch that used that tool rewrote it: no two of them could stay open together without conflicting on the file, and a three-file feature PR carried **115 lines of another PR's prose** in its diff (found 2026-09-19 while rebasing #254/#258, where it read as unexplained noise until the file was checked). It is now untracked and ignored alongside the other agent-tool output; **`.verdentc.json` deliberately stays tracked** — that one is real deploy config (install/build commands, output dir), not tool output. Before blaming a diff on your own work, run `git diff --name-only <base>...HEAD` and check what is actually in it.
- **A test that walks every source file must read them in parallel — sync reads cost ~12 ms each on this box (learned 2026-09-28).** A 194-file `src/` sweep spent 2.4 s in `readFileSync` (the directory walk itself: 8 ms) and timed out at vitest's 5 s default under full-suite load; the same sweep with `Promise.all(readFile…)` runs in 64 ms. The AV serializes per-file opens, so batching the opens is the fix — measure before reaching for a bigger timeout.
- Test style: pure logic only, node env; mock `fetch` with route tables
  (`tests/providers.test.ts` has the pattern); `vi.stubEnv` for API keys.
- **`tests/design-system.test.ts` pins every declared `font-weight:` to a face the font link actually loads — the canonical ramp is 400/500/600/700/800 only.** The consistency pass ships Inter/Sora as static faces, so a variable-font interpolation weight (650/750 appeared in the Optimize-day preview) fails verify with `declared but not loaded`. When styling new UI, reach for the canonical weights; rebase replays of older branches are where off-ramp weights sneak back in (Sep 2026).
- **View Transitions + theme radiate (Sep 2026): VT is usable on glass-heavy pages ONLY with `backdrop-filter` suppressed during the transition** — Chromium renders glass inside VT snapshots without its backdrop, so any glass layer (`--yf-glass: rgba(255,255,255,.58)`) turns the captured page into a flat gray veil (page-dependent: "perfect" on Landing, broken on #/trips). Shipped pattern in `toggleTheme` (App.tsx): set `--vt-x/--vt-y/--vt-r` on `<html>`, add a direction class (`vt-radiate-out` = dark→light, new view expands; `vt-radiate-in` = light→dark, old view collapses — and it needs old z-index 2 / new 1, since UA stacks new on top) plus `vt-active` (`html.vt-active :where(*) { backdrop-filter: none !important }`) BEFORE `startViewTransition`; the clip-path animation lives in CSS keyframes with `fill: both` (first-frame-correct, end-state held), classes removed on `vt.finished`. A DOM-overlay radiate was tried and rejected (flat color, not the real UI). Don't re-learn these the hard way.
- **A full-page View-Transition FREEZES every CSS animation for its duration — skip it on animation-heavy pages.** The landing route runs continuous motion (atmosphere blobs, route draw, ticker, odometer); toggling theme there made the whole scenery visibly pause ~700 ms while the DOM snapshot played, and on mobile the eruption point read as off-target. Fix (Sep 2026): `toggleTheme` early-returns to an **instant swap on `route === '/'`** (radiate kept for calmer in-app pages). When adding any VT elsewhere, gate it off routes dominated by looping animation or the "pause" reads as a frozen tab.

- **Diagnostic logging should be guard-claused.** Haptics logging (`haptics.ts`) showed `[HAPTIC]` entries even on iOS where `navigator.vibrate` doesn't exist — misleading noise. Guard `import.meta.env.DEV` logging behind `typeof navigator !== 'undefined'` so logs only appear when the API actually exists. Corollary: test environments that mock `window`/`navigator` must include `vibrate` (even as a no-op) to avoid console spam.

- **AI assistant input must disable while thinking.** `AiDrawer.tsx` had the input enabled during `thinking` state, allowing duplicate questions while the bot was already processing — the simulated 650ms latency made this easy to trigger. The fix: `disabled={thinking}` on the input and submit button. When adding async operations that take >200ms, always disable user inputs to prevent race conditions or duplicate requests.

- **A replay-tolerant webhook must filter its grant read to the state that justifies the grant (learned 2026-09-22, security audit).** `payments-webhook.js` marked orders paid idempotently but read the row UNFILTERED, so a replayed `payment.captured` after a refund would have re-granted a revoked entitlement (the revoke RPC flips paid → failed). Idempotency of the write is not safety of the read: a recovery/replay path must ask "which states may proceed" and filter to exactly those. Pinned in `tests/payments-functions.test.ts`. Sibling rules from the same audit: invite/access codes come from the platform CSPRNG (the presence-key class — `inviteCode.ts` has a tripwire); any WebView app holding session tokens sets `allowBackup="false"`; and a CSP starts as **report-only** (`vercel.json` headers) — an enforced-but-untested CSP on a map app with six third-party origins is a self-DoS.
- **Gate a control and its surface with the same predicate (learned 2026-09-22, APK audit).** The signed-out Android shell kept the topnav's hamburger button while its tray was `!isNative`-only — a visible control whose tap toggled state that rendered nothing. When a surface is platform- or flag-gated, grep for its trigger and gate that too; the shared gate is pinned in `tests/mobile-shell.test.ts`.
- **Combining a caller's AbortSignal with a timeout must feature-detect `AbortSignal.any` (learned 2026-09-21, PR #289 review).** `AbortSignal.any` is Baseline-2024 — Safari < 17.4 throws on it, and if the throw sits *outside* a try it escapes whatever fallback the call site promised (a configured companion would have shown the canned error instead of the offline router's answer). The guarded pattern lives in `routing.ts`'s `requestSignal` and `aiProvider.ts`'s `mergeSignal`: detect `Any.any`, fall back to the bare timeout, and hand an already-aborted caller an already-aborted signal — never a fresh timeout, which would send post-abort fallback fetches out live.
- **A service worker here is web-only, production-only, and never touches identity-bearing paths (learned 2026-09-22, PWA phase 1).** Three hard rules, each with a silent failure mode: (1) register only when `!isNative && import.meta.env.PROD` — inside the Capacitor shell every asset already ships in the APK (a worker fights the WebView cache), and in dev Vite's HMR rewrites modules that a cache-first worker would then serve stale; (2) the cache NEVER holds `/api/*`, `/i/*` (the crawler preview is server-rendered), `/sitemap.xml`, `/mappls/*` or any cross-origin response — Supabase auth/rest cached is a correctness bug, not a performance win; (3) navigations are network-first with the cached shell only as the offline fallback, and the shell copy is re-put on every successful navigation, so a deploy rolls the offline copy forward without a version bump. Deliberately NO `skipWaiting`: a running session must not have its shell swapped under it — the stale-chunk auto-reload is the app's existing answer to a mid-session deploy. Icons are generated from the brand mark by a repo script (no image dependency) and their declared sizes are pinned by a test, because a wrong-sized icon is an installability failure nothing else reports.

- **The offline snapshot cache has three rules, and each one fails SILENTLY (learned 2026-09-22, PWA phase 2).** (1) It is keyed by account and **cleared on sign-out** — issue #45 was the in-memory version of this bug (the previous user's rows re-patched into the cache after a logout); the on-disk version would outlive a reload, so the sign-out path clears it. (2) Only a **clean** hydrate is persisted (`partial.length === 0`) — the store's partial-failure model is the signal, and writing a partial snapshot presents half an account as the truth on the next cold boot. (3) A cache boot must never trigger the demo seed, which the existing `tripCountUnknown` guard already covers: the failed reads that made the cache necessary are exactly what sets it. `lib/offlineCache.ts` degrades to "no cache" on every path (no IndexedDB, quota, blocked upgrade) and validates the version plus EVERY slice on read, so a half-written record reads as absence rather than as a partial account.

- **The offline write queue is durable BEFORE the send, one snapshot per trip, bounded, and cleared with its account (learned 2026-09-22, PWA phase 3).** (1) `persistTripFieldNow` queues the edit to IndexedDB BEFORE attempting the network write — durability-after-failure loses the edit to a crashed tab or a closed laptop, which are the common cases. The drop happens only on a CONFIRMED write. (2) The queue is keyed by trip id, mirroring the in-memory coalescer: a second edit replaces the first, so replay can never resurrect stops the user deleted. (3) Replays are bounded (three attempts, then a loud drop) and deliberately NOT routed through `persistTripFieldNow` — that path always re-queues with `attempts: 0`, which would unbound the retries. (4) Sign-out clears the departing account's entries (`clearWritesFor`): the next person on the device must never be the one whose session "syncs" the last one's unsynced edits. (5) A conflict (server row newer than the edit's capture) is last-writer-wins with BOTH sides told — the app's whole-trip write model makes rebasing a non-goal, and the peer's existing remote-edit banner covers their side. The replay carries no `markLocalWrite` on purpose: the echo of our own replay refreshes the cache from server truth instead of being suppressed.

- **Drawer animations need a class-based toggle.** `AiDrawer.tsx` originally animated via inline style transitions; switching to a `.open` class on the container (`<div className={`ai-drawer ${open ? 'open' : ''}`}>) fixed the animation state reset on re-render. Rule: always use CSS classes for enter/exit animations, never inline styles — React re-renders can reset inline styles mid-animation. The `.ai-drawer:not(.open) { display: none }` pattern is also cleaner than `style={{ display: open ? 'flex' : 'none' }}`.

- **FAB should hide while assistant is open.** `AiDrawer.tsx` kept the `ai-fab` visible behind the drawer, cluttering the UI. Fix: `{!open && !thinking && <button className="ai-fab" ... />}` — only show when drawer is closed AND not processing. Rule: when a panel overlays a floating action button, hide the FAB while the panel is open OR while the panel is in an intermediate state (thinking, loading, saving).

- **Every trip-data mutation must write through — but know the real signatures before you "enforce" an order.** The store fixes (Sep 2026) revealed three bugs, and a later correction (M6 B0, Sep 19 2026) fixed the write-through paragraph itself:
  1. `setStopStatus` performed redundant lookups before committing, risking stale data.
  2. `moveStopBetweenDays` committed twice — once in `updateStop`, once explicitly — which bypassed the single-patch guarantee. Its no-stop-found early-return path still skipped the persist entirely; it now calls `persistTripField` like every sibling.
  3. `updateTrip` committed before persisting, so UI showed success but DB failed silently.

  The facts (verified against `src/store/store.ts`, don't restate from memory): **`persistTripField(tripId, snapshotTrip)` is SYNCHRONOUS and returns void** — it coalesces the row UPDATE through `pendingTripWrites` (600 ms trailing debounce). There is no promise to await and no ordering rule between it and `commit()`; what matters is that the mutation path CALLS it with the post-mutation snapshot, because a path that only edits the cache vanishes on refresh (the verify gate stays green — nothing exercises write-through). The debounce holds the **snapshot captured at call time** (`{ timer, trip }`), and both the timer and `_flushTripWrites()` persist THAT snapshot — never a re-read of `tripById(id)`, which would let a remote update landing inside the debounce window be persisted over (or silently discard) the local pending edit. If you change the coalescer's shape, keep the snapshot semantics and their tests (`tests/m6-together.test.ts`).

- **"Resolved on pick" placeholder coordinates must be resolved AT the ingestion boundary — a raw write into trip data pins the journey to Null Island.** Both providers emit `latitude: 0, longitude: 0` placeholders on some hits, and the Map tab's Add-to-timeline paths copied them raw: a real user's route ran to the Gulf of Guinea, the split banner demanded 116 travel days, impact previews read ±45,616 km, and halt suggestions landed "around ~2400 km" in the Atlantic — every downstream number honest math over an ocean round-trip, and the whole verify gate stayed green (nothing exercises live pick flows). Fix: `requireHitCoords()` at every write-into-a-trip path (single add, Add-all, `LocationInput.choose`), refuse with a visible error/toast when unresolvable. Corollary: coordinate sentinels need BOTH coordinates checked — the live incident was a MIXED placeholder (lat 0, real lng) that `a !== 0 || b !== 0` happily accepted. When debugging "impossible" route geometry, screenshot-locate the offending pin first; every impossible number downstream of it is a red herring. (Found live 2026-09-14.)
- **A surface that RANKS or ANNOTATES by coordinates before any pick cannot consume "resolve-on-pick" placeholders — it needs a real-coords search.** The Map tab's search-to-add box used `searchPlaces` (Google autocomplete), whose hits are deliberately `(0,0)` placeholders — the quota economy is one Place Details call per *picked* row. But that box projects every hit onto the route to label/rank it, so all five results measured Null Island and rendered the identical "~1675 km into the trip · 8448 km off-route" — the tell that a ranking surface ignores hit coords entirely is *equal annotations on different hits*. Fix: `searchPlacesText` (one free-form Text Search Pro event, real locations in the same single call the corridor scan already pays; coord-less stragglers resolved-or-dropped; `QuotaExhaustedError` rethrown to an honest toast). Rule of thumb: **autocomplete for pick-one inputs, Text Search for rank-everything surfaces** — don't "reuse" the cheaper SKU on a surface whose math needs coordinates it doesn't have. (Found live 2026-09-14.)
- **A directive that reverses behavior must sweep its own strings in the same commit.** When the Google-only directive landed, `QuotaExhaustedError` still said *"falling back to the free stack"* and the quota-guard header still described the old fallback — the code had changed, its self-description lied. When reversing any behavior, grep for the OLD behavior's phrasing in error messages, comments, README, and ARCHITECTURE (this bit us once per surface: message, quota.ts header, geocode docstring).

- **A mechanical CSS gate only sees pairs declared in ONE rule.** The design-system contrast gate skips color-only overrides (`.x--warn { color: … }` on a separate background rule) — a 3.65:1 warn-on-white shipped straight past it (#152). When styling new UI, add explicit AA pins for any warn/tone pair your surface paints (#154's `map-rail warn ink` test is the pattern), and remember the baseline keys entries on **line numbers** — inserting CSS shifts them and fails the gate with phantom "new violations"; re-map  the numbers (or `UPDATE_DESIGN_SYSTEM_BASELINE=1`) and diff to confirm nothing but line numbers moved.
- **The overlay measures an element's DECLARED background, not the composite — flatten before believing a
  contrast finding on a layered surface.** Its report of `PublicItinerary`'s hero at 2.6–3.1:1 was against
  `.pub-hero`'s own gradient end stop (`#b97a3f` at 118%), not the pixels behind the kicker/title/byline:
  the numbers were **bit-identical** after adding a scrim to the child `.pub-hero-bg` layer, and vanished
  only when `.pub-hero`'s own background was replaced. Discriminate with that test (flatten the element,
  re-inject, compare) before acting — a child/sibling layer is invisible to the rule. The *risk* it pointed
  at was real and now bounded: `.pub-hero-photo` is a creator upload at `opacity: .42` with nothing
  guaranteeing a floor, so a bright cover could pull the hero text toward ~3:1; the flat scrim added over
  the text zone plus `tests/hero-contrast.test.ts` (which composites the scrim over a **white** photo — the
  conservative worst case) close it. Triage the output generally: that page's 61 findings held 21
  `nested-cards` for **4** real ones (measured, depth 1), 4 `line-length` that prose measurements did not
  reproduce, `all-caps-body` on `.pub-hero-byline` (a deliberate uppercase byline), and ~18 that are this
  repo's deliberate system — now listed in `.impeccable/critique/ignore.md`. Setup: mutation preflight,
  `impeccable live-server --background`, inject `http://localhost:PORT/detect.js`, `live-server stop`
  (its `config_missing` warning is expected when you injected by hand) — `index.html` stays byte-clean.
- **A contrast probe that resolves backgrounds from `backgroundColor` mis-measures gradient- and photo-backed cards.** The 2026-09-23 entry-path review's browser harness walked the computed chain and read white-on-navy as white-on-cream wherever the navy arrived from a `linear-gradient` (which lives in `backgroundImage`, never `backgroundColor`) — it flagged three deliberate forced-dark surfaces as failures, twice, before the declared scrims were grepped and the pairs disproven. When measuring contrast on any card that might be gradient- or image-backed, resolve the *declared* scrim from CSS (grep the class) or composite the rendered pixels — and treat a probe finding only `gradient` surfaces as unverified until cross-checked. The review also confirmed the cheaper discipline: when the CSS documents a token's own failing figure (styles.css:129 documents `--yf-teal-600` = 3.80:1 as a *ring* value), grep that ledger before asserting small text may borrow it — the kicker was sitting at exactly the documented 3.80:1.

- **A derived input that algebraically cancels is a constant in disguise.** Road personality's "per-window speed" was `windowKm / (driveMinutes × windowKm / totalKm / 60)` — the `windowKm` cancels, leaving the day's average painted on every window, and the tests then codified the wrong semantics. When a derived value cancels to something coarser than its name implies, stop and either compute the real signal (per-leg durations from OSRM) or move the verdict to the level it actually measures (day-average → explicit day-level check, as now done for the city-crawl kind).

- **Never subtract one engine's route total from another engine's internal legs.** Google's Search-Along-Route `routingSummaries` route start→place→end independently of the polyline, so `(leg0 + leg1) − <route total measured by anything else>` inflates by the two engines' route-variant difference: **+47 km on a 1,400 km corridor** (a highway petrol pump read "50 km off", torching the detour budget and holding back See & do) but only ~1–3 km — plausible-looking — on the short corridors used in earlier testing, which is how it hid for weeks. `routesEnabled()` only checks that a key string exists, so an un-enabled Routes API (HTTP 404) silently fell back to OSRM totals while the summaries stayed Google-baselined. SAR detours are now the geometric spur against the same polyline the search ran on (`spurKm`, google.ts); leg0 remains the road position. The invariant to pin in any future detour source: **a place on the drawn road must read ≈0**, and it must hold on a 1,000+ km corridor, not a 50 km fixture. (#187)

- **Cadence bugs only show on load-balanced multi-day plans — fixture the 350-km day.** planRideSegments' per-day-reset cadences were designed when days were the 550-km tick; load balancing (P1-A) shrank days to ~350 km and two cadences silently produced ZERO segments on every such plan (a 1,400 km trip grew no meal and no fuel suggestions): the fuel push (382.5 km step from each day start never landed inside a 350-km day — fuel runs on a corridor-wide cadence; the tank doesn't reset overnight) and the #131a overnight absorb (a slid lunch sits at the 14:30 window edge, ~98 km = 2 h 20 m before the halt, inside the 110-km km-only bound — the absorb is now time-bounded to ~1 h: a stop that close is "dinner at the halt anyway", an earlier one is a real meal). When touching halt cadences, test with 1,400 km / 4-day load-balanced shapes, not just single-day or 550-tick shapes. (#189)

- **Google Text Search cannot discover place TYPES — it matches text against POI names.** `textQuery: 'towns and cities'` returns 200 with zero places (or ice-cream shops named "Top N Town") — the city anchor layer had quietly returned zero localities, starving every night-halt suggestion. Type-based discovery is `places:searchNearby` + `includedTypes: ['locality', …]` with the Essentials-only field mask (hours/rating fields upgrade the SKU), counted under its own `nearbySearch` quota SKU. Rural corridors can still return zero localities in a 35–50 km circle while the start-city circle returns many — guard the assignment: a city nowhere near its segment's km is dropped (an honest GAP beats a "night halt" 700 km from its halt). (#189)

- **`searchNearby` accepts a NARROW type list, and ONE bad member 400s the whole request.** Asking for `['locality', 'administrative_area_level_3']` (both fine in Text Search) failed every call with `Unsupported types: administrative_area_level_3` — and because the caller `.catch()`es, the layer returned `[]` and the surface read as "no towns anywhere" instead of as a broken request. Every night halt starved on every trip while tsc, tests and build stayed green (the fixtures mock fetch, so no test could see it). **Validate provider enum values against the LIVE API before shipping the list** — `scripts/verify-google-places.mjs` is the place for it — and prefer one type per call over a speculative union. (#189)

- **Google's `locality` bottoms out at VILLAGE level in rural India.** At halt points on a 1,400 km corridor it returns hamlets (Gauriyapur, Muhammadpur, Kuit Mandir) with no population to rank by, while OSM's `place=city|town` at the same points returns real towns WITH population (Chunar 37k, Mirzapur 234k, Hazaribagh). A night halt needs a town with a bed, so "the locality layer returned something" is not the same as "the halt is anchorable" — check what KIND of place came back, not just the count.

- **A provider that degrades internally must be checked for QUALITY, not just for throwing.** `routePath` never rejects: on an OSRM failure it returns haversine `estimate` legs (by design — "planning never blocks"), so the `.catch()` handlers around it could not see a rate-limited day at all. The code drew straight chords and treated them as a measured road, and the symptoms ("no retry", starved suggestions) read as provider flakiness rather than a swallowed failure. The road measurement now grades the RESULT (`legs.some(l => l.source !== 'estimate')`) and retries once on an all-estimate chain. When wrapping a facade that swallows its own failures, assert on the degraded output (a `source` field, a flag, a sentinel) — a rejection you never receive is not a failure signal. (#188)

- **A duplicated measurement needs a WIRING test, not just a unit test.** #184 unified MapTab → TripMap and its acceptance asked for a fetch counter "per map open"; the workspace kept its own `routePath` chain anyway, because nothing asserted WHERE the measurement happens — tsc, tests and build all stayed green with two callers, and the duplicate doubled the load that caused the failures it was fixing. The pin is a source invariant (`tests/trip-road.test.ts`): the map surface must not call `routePath`, the workspace must measure through `tripRoad`, and that module owns exactly one call. Same shape as route-integrity / mobile-shell — cheap, and it fails the moment a second caller appears.

- **A gate that validates VALUES cannot see a defect in the RELATIONSHIP between them — and a wrong map is how it shows up.** Six shelf itineraries passed the validator and the golden engine test while 27 coordinates were shared between different places (a four-stop Gulmarg day sat on one point), because every individual coordinate was valid India-range data. The map then drew one marker where the timeline listed four and the route appeared to end at an unmarked spot, which reads as "the importer lost a stop" rather than "two rows share a number". When two layers are derived from different data, check the *relationships* too — uniqueness, distinctness, cross-references — and give the rule a mechanical form so it can be checked: a coordinate may carry at most two stops and one of them must be `food`/`hotel`/`rest` (a meal at the place you sleep is one place; anything else is a geocode shortcut). The gate must print the offending cluster with its titles — that list IS the fix list. (Found live 2026-09-18, on the first import of a shelf file into the app.)

- **A prose contract and the code can disagree for months without a single failure — grep the convention, don't trust the doc.** `ITINERARY-IMPORT-SPEC.md` stated `orderInDay` was 0-based while `createTrip`, `addStop`, the Board and the Timeline all write `i + 1`. Sorting hides it completely (both orders sort identically), so nothing broke and nobody noticed. Before writing a rule into a spec — or believing one already there — confirm it against the implementation that would have to satisfy it; a falsy `0` in an ordering field is also a latent presence-check trap. The importer now renumbers from any base and the validator requires the app's own.

- **A format that evolves needs a declared version, a pure migration chain and a repair report — and the runtime reader and the offline gate are deliberately different policies.** Import must never reject what it can fix: it reads `formatVersion`, walks `MIGRATIONS` to the current shape, then normalizes (1-based renumbering, day `index` to position, honest numeric defaults, duplicate ids re-issued, dates reconciled to the day count) and reports every intervention as a one-line digest rather than a stack trace. A file claiming a *newer* version is refused with the reason, never half-read. The offline validator stays strict — a file *you* author should fail before it ships, a file a *user* hands the app should import as cleanly as possible. Corollary: the wire version is file metadata, so strip it before the trip's unknown-key allowlist sees it (`formatVersion` on a bare trip warned about "a field nothing reads" until 2026-09-18), and pin the convergence property — exporting what was just imported must produce the same shape, ignoring the session-local `imp_*` ids.

- **Never rewrite JSON with a text regex you cannot count.** A pass that added 1 to every `orderInDay` via a pattern requiring a trailing comma silently skipped the last key of each object, and a bulk rewrite of a data file has no type to catch it — the file still parses, it is just partly un-migrated. Prefer repairing through the parser (`JSON.parse`/`stringify`) or, when the raw text must be preserved for a minimal diff, assert the replacement count against the parsed count and re-validate afterwards. Same family as rule 9's changelog rewrites.

- **A day's END is not a free variable — a reorder that moves a night's base rewrites the next morning.** `dayEndPosition` returns a day's last *stored* stop and `originOf(next day)` walks forward through it, so anything that moves the tail moves where tomorrow starts. Optimise-day pinned only `auto` stops (engine-synthesized waypoints) and never a stored hotel, so on the six shelf itineraries **21 of 32 optimisable days had their tail replaced, 18 of them the night's base, and 14 day-pairs shifted the next wake-up point — worst 16.3 km** (sleep in Candolim, plan the morning from the Basilica). A `hotel`/`rest` stop at the tail is now an implicit anchor. Two rules for any future reorder surface: **(1) before treating a stored value as movable, ask which other days are DERIVED from it** — endpoints, origins, roll-ups; **(2) a warning count is not a safety net** — optimising every shelf day moved Coorg 2→4 warnings but Goa **1→0**, silently dropping the only flag while the endpoint had moved 16 km. Test the property, not the symptom: assert `originOf(next day)` is unchanged after the reorder, which is what caught it. (Found 2026-09-18.)

- **A11y contrast claims get computed, not eyeballed.** Issue #64 claimed sub-AA tab contrast; the WCAG luminance math showed 7.53:1 dark / 4.86:1 light — not reproducible. Before accepting or "fixing" a contrast report, run the numbers on the actual token pair and surface (the issue's premise named the wrong variable). Close such issues WITH the measurement. **A per-theme colour is a second trap on the same finding**: `[data-theme='dark']` RE-DECLARES the whole primitive ramp (styles.css:240-260), so `--warn-600` goes `#B47207` → `#D99A2B` and `--gray-900` inverts to `#ECF1F8`. Every status token here is an indirection (`--warn: var(--warn-600)`), so a dark ratio computed off the `:root` value is measuring the LIGHT ink and reports a confident phantom — resolve the chain to what the active theme supplies, and treat "the light value fails in dark" as the tell that you read the wrong block.
- **A dark-theme ratio computed off the `:root` value is a phantom finding — the theme block RE-DECLARES every status primitive (learned 2026-10-02).** `[data-theme='dark']` redefines the whole primitive ramp (styles.css:240-260): `--warn-600` goes `#B47207` → `#D99A2B`, `--danger-500` → `#E06C6C`, `--gray-900` even inverts to `#ECF1F8`. So a semantic token read from `:root` is the LIGHT ink, and measuring it against the dark surface yields a confident, wrong defect: `.poi-rchip--warn` "measured" 3.56:1 in dark and was queued for a fix, while the real pair is `#D99A2B` on `#36290F` at **5.82:1** and already passed. Every contrast token here is an indirection (`--warn: var(--warn-600)`), so resolve the chain to the value the ACTIVE theme supplies before reporting, and treat "the light value fails in dark" as the tell that you read the wrong block. Same discipline as the ratchet note above: a finding that names only a `:root` colour has not been checked against the theme that renders it.
- **The shell MANGLES non-ASCII — `₹` printed as `?`, and that invented a defect that did not exist (learned 2026-10-02).** `BudgetTab`'s quick-add amount field was reported as `placeholder="?"`, a bare question mark where the currency glyph should be. It was never a question mark — the file has always said `₹`. Any console dump (`Select-String`, `grep`) of a line containing a non-Latin-1 character is suspect: **read the file with the `read` tool before believing anything inferred from shell output**, and never file a copy or a11y finding whose evidence is a mangled glyph. That session produced two further phantoms for unrelated-but-same-root reasons — a `.link-btn` "1.98:1 failure" that every call site overrides with `.teal` (and two sibling classes with no call sites at all), and 13 "unlabelled" inputs a `Field` in a *different file* had already named. Standing rule: **a review finding is a hypothesis until you have read the line that renders it.**
- **A UI gate earns its place only with zero false positives — COUNT every candidate rule against `src/` before shipping it (learned 2026-10-02).** `npm run check:ui` (`scripts/uiAntipatterns.mjs`) enforces exactly three rules, because the other ~20 candidates were measured first and rejected on the numbers: `scale()` in `:hover` has **9** sites and all are correct (a `position:fixed` FAB, absolute map markers, a range thumb — none reflow, which is what the rule is really about); emoji-as-icons has **403** codepoints across **78** files, mostly `weather.ts`'s legitimate WMO map and user-chosen `coverEmoji`; `outline: none` has 44 uses and only 4 lack a replacement, several of those being a `border-color` change that is a perfectly good focus ring. A gate that fires on correct code gets muted, ignored, then deleted — so add the count to the script's header with the exclusion, and don't re-derive it next session. Contrast is already owned by the design-system baseline ratchet; never add a second, weaker check beside it.

- **`gh` batch loops in this shell exit 1 while partially succeeding.** A PowerShell `foreach` over `gh issue close` reported command failure with no visible output, yet had closed every item — the next retry only surfaced "! already closed". After any compound `gh` batch, re-derive state (`gh issue list`) before retrying; idempotent retries are safe, blind assumptions are not.
- **`overflow-x: clip` silently clips BOTH axes — the pair rule.** Setting `overflow-x: clip; overflow-y: visible` makes `overflow-y` compute to `clip`, so absolutely-positioned blobs that bleed past an element's top/bottom (`top:-90px`/`bottom:-70px` atmosphere blurs) get hard-sliced into visible "seam" lines at the container edges, and right-side bleed (`right:-150px`) shows as a crop bar. To clip horizontal blowout you can't rely on section-level `overflow-x: clip`. Prefer `html { overflow-x: clip }` (a true clip that isn't a scroll container, so `position: sticky` nav keeps working) and leave the section overflow-free so soft blurs can bleed across section bounds onto a shared fixed canvas.
- **`env(safe-area-inset-*)` is inert without `viewport-fit=cover`** — `.impact-sheet` shipped an `env(safe-area-inset-bottom)` padding that silently did nothing because `index.html`'s viewport meta lacked `viewport-fit=cover` (found while fixing UI-audit F-26, Sep 2026). Activating `cover` turns EVERY inset on at once, so audit all fixed/sticky layers (topnav, toast zone, fabs, drawers, `top:`/`scroll-padding` offsets derived from `--nav-h`) in the same change — adding them one at a time leaves half the UI under the home indicator.
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
- **In-page anchors on hash-routed pages must be `button` + `scrollIntoView`,
  never `href="#id"`** — the router owns `location.hash`, so a plain anchor link
  rewrites the hash to `#plan-bench` and the router treats it as an unknown
  route (the Plan Bench hero anchor, Sep 2026). Pair the target section with
  `scroll-margin-top` so the sticky nav doesn't cover it.
- **A `role="switch"` with only an on/off state reads poorly when both states
  are first-class** — the bench's return toggle became a segmented control
  (two `aria-pressed` buttons in a `role="group"`); prefer that pattern when
  neither state is "off".
- **Supabase failures come back as `{ error }`, not rejections — a `void supabase…write()` with no `.then(({ error }))` is a silent data-loss hole.** `publishItinerary` fire-and-forget its upsert while the optimistic in-memory write made the UI look successful; the next refresh hydrated the (empty) table and the data "vanished" (Sep 2026). Rule: every write-through checks its error and either toasts or rolls back the optimistic cache (see `updateProfile`, `publishItinerary`); every hydration table result is error-logged, because a failed `select` also returns `{ data: null, error }` rather than throwing — a denied/missing table silently hydrates as `[]`.
- **Gallery-import quality is mechanical, and the engine's realism rule shapes the route.** `docs/examples/itineraries/*.golden.json` are the Explore shelf's source files, and `tests/golden-itineraries.test.ts` gates every one of them in CI: `scripts/validate-itinerary.mjs` for structure (required numerics so `NaN` can't poison a day, both coordinates checked so a Null-Island pin can't bend the route, unknown keys rejected so a typo'd field isn't silently dropped, `days.length` = inclusive date span) and the real `computeHealth`/`computeTotals` for truth. The arithmetic decides whether a plan can ship: high = −11, medium = −7, low = −3, so **health ≥ 85 allows at most two mediums**, and a day over **5 h / 300 min of engine travel is a HIGH that fails outright**. That rule rejected the obvious 3-day Bangalore→Coorg weekend (day 1 = 423 min / 268 km) and produced the 5-day loop that breaks the drive at Mysore both ways — so when a gallery itinerary "looks fine" but fails, **fix the route shape, not the threshold**. Two research rules ship with it (spec + playbook in `docs/`): **geocode coordinates, never recall them** (`scripts/gallery-geocode.mjs`, Nominatim — the app's own OSM stack; hand-typed coords for the Bylakuppe/Dubare cluster were ~15 km off), and **resolve fee conflicts in the open** (Mysore Palace: ₹50 official vs ₹70 guidebooks → publish the official figure, cite it in `sourceUrl`, and state the conflict in `warningsAndAssumptions`). Budgets are never hand-picked: run the golden test, then set `budgetPerPersonInr` from its printed engine estimate. The first five shelf trips (Goa, Kerala, Mewar, Kashmir, Meghalaya — the ranked twenty are in `docs/GALLERY-BACKLOG.md`) added three more mechanical lessons: **(a) the engine measures straight-line × 1.25 at the mode speed plus a 10-min pad per leg** (`legBetween`), so ~120 km is the medium line and ~182 km the HIGH line — a real 175 km Ranakpur→Jodhpur drive read 283 min and had to move off its day, while winding hill roads read *shorter* than the road sign; **(b) two consecutive stops on identical coordinates trip the backtracking warning** when the day's long leg follows (a zero-length inbound hop), and its "reorder stops" fix is impossible when the day must return home — give every stop its own real coordinate; **(c) lodging prices per distinct base, not per night**, and `stayStyle` swings the total hardest (budget ₹1,200 vs comfort ₹3,200 per room-night) — Meghalaya's declared budget was 97 % above the engine's until it was set from the printed estimate.

**When diagnosing "works in the session, gone after refresh"**, probe the live table with the anon key via PostgREST (`GET /rest/v1/<table>?select=…` — RLS SELECT policies decide what's readable; `published_itineraries` is public) before touching code: it immediately separates "never persisted" from "persisted but not rendered". Column-existence probes work on empty tables (`select=<cols>&limit=1` errors naming a missing column); the OpenAPI root (`/rest/v1/`) needs the service-role key, so it's useless with the anon key. To test an *authenticated* write, sign up a throwaway QA account via `POST /auth/v1/signup` (email confirmation off → session token in the response) and replay the insert — but record the generated email immediately (it's randomized and unrecoverable from auth without the service key; the profiles table's public read policy can restore it).
- **An UPDATE is checked against the SELECT policy too — a "hide the row" policy can silently break "write the row".** The trash tombstone (`UPDATE … SET deleted_at`) failed with `42501 new row violates row-level policy "trips read hide trashed"` because that SELECT policy had no owner clause — Postgres evaluates SELECT policies against the UPDATE's added row, so hiding tombstoned rows from *everyone* made them unwritable by anyone. Symptom was a silent optimistic-rollback: trip vanishes, then reappears on refresh. Fix shape: the hide policy must keep owner/editor visibility for tombstoned rows, hydration filters them client-side (the Trash RPC is their surface), and the repair SQL lives in `supabase/fix-trashed-read-policy.sql`. Proven live with a QA signup (Sep 14 2026). Probe RLS write failures with `Prefer: return=representation` OFF first (that header adds RETURNING and fires a *different* 42501), then verify with a follow-up SELECT.
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
- **Suggestion searches are expensive — persistence is the contract.** Corridor
  searches (Map-tab nearby, timeline halt spots) must hydrate from
  `useSuggestionCache` and never auto-refetch from derived-state churn: the map
  effect's deps on `planKm`/`wholeTrip.min` re-fire when OSRM resolves *after*
  mount, and a `[day]`-reset effect wiped timeline spots on every trip edit.
  Only explicit user controls (↻ Refresh, detour-scope slider, 📍 Suggest) may
  re-run a search. Corollary: a "clear the cache" button does nothing unless
  some state it affects is in the fetch effect's dep array (the broken ↻
  Refresh) — pair cache-clearing with a `refreshTick` bump.

- **Every trip-data store mutation must write through (`persistTripField`), not just `commit()`.** `addStop()` — the Suggestions "Add to timeline" path — updated the cache and logged activity but skipped the DB write, so the stop vanished on the next reload. The whole verify gate (`tsc` + tests + `vite build`) stays green with this class of bug because nothing exercises write-through. When a mutation adds an "add" path that mirrors `updateStop`/`deleteStop`, verify it calls `persistTripField` too, and cover it with a mocked-`supabase` write-through test (`tests/store-persistence.test.ts` has the pattern: `vi.mock` the client, `await` a microtask flush, assert the `.from('trips').update` captured the change).
- **Undo/restore helpers must honour their own documented contract — and deletion renumbers, so "old order" needs `>=`, not `>`.** `restoreStop` claimed "back at its old order" but pushed + renumbered, dumping the restored stop at the day's end. The first fix attempt (`> stop.orderInDay`) still failed the test because `deleteStop` renumbers the survivors — the stop that *inherited* the deleted slot then compared equal, not greater. When a restore targets a position in a collection that mutates on delete, derive the insertion point from the POST-delete numbering (`>=` the captured order), and pin the contract with a test asserting the restored `orderInDay`, not just membership. (Found while wiring map-pin delete undo, Sep 2026.)
- **A cross-surface mutation needs a follow-the-surface check: what does each consumer derive, and does it re-render?** Wiring "resolve vote → stop lands on timeline" required walking every surface that shows the place: Board/Timeline read the trip (free), but the Map rail's see-&-do rows and its count badges derived visibility from `existingNames` only in *some* paths — rows kept offering an already-added place. When adding a mutation that makes a thing "already added", grep every consumer for its added-test and route them all through one predicate (here name-based dedupe), including derived counts (`seeAndDoLive`), not just row render.
- **An effect that depends on asynchronously-hydrated store data must list those values in its dep array.** `InviteGate` used a mount-only `[]` effect, which fired before `init()` resolved — `me`/`trip` were both null, so the invite never auto-joined and the user sat on the spinner. `react-hooks/exhaustive-deps` (now wired via `npm run lint`) flags exactly this; don't suppress it with `eslint-disable` when the fix is to depend on the resolved object.
- **Scoping a query invalidates every cache-shape assumption downstream of it.** When hydration was scoped to the user's memberships, `tripById` — consumed by the public itinerary page and the invite gate — silently started returning undefined for every non-member (and every anonymous visitor): "Itinerary not found" on Explore cards, "This invite link is broken" on invites. Before changing what a fetch returns, grep for consumers that derive invariants from that data; flows that legitimately need OTHER people's rows (public pages, invites) get an on-demand fetch (`fetchSharedTrip`) plus an RLS/RPC path, never a cache-shape accident.
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

- **The impact dialog's time delta must include dwell, not just driving.** `computeImpact` summed `totalTravelMinutes` (wheel time only), so adding a 20-minute halt showed a ~0 time extension and the preview looked broken. `DaySchedule` now exposes `dwellMinutes` (visit minutes + per-stop buffers) and the delta sums both — relabelled "Time on the road (driving + stops)" so the semantics are visible. Note `computeTotals.totalTravelMinutes` is still driving-only for budget/warning math; don't "fix" one and silently change the other.
- **Planned halts are on-route by default; real spots are opt-in.** The halt planner's `pin` flag must default to `false` — the planner auto-attaches the best place found near a km point, and a `true` default silently redirected every halt to that place. The row shows an explicit "detour to <place> instead of the route point" checkbox.
- **Coerce persisted numeric fields before math, never trust them as numbers.** Rows hydrated from Supabase (or hand-edited JSON) can carry `undefined`/`null` for numeric columns — a stop's `visitMinutes` arriving as `undefined` once made `undefined + bufferMinutesPerStop = NaN` poison the whole day's dwell and the impact dialog rendered `NaNh NaNm`. `simulateDay` coerces `visitMinutes` to a finite number (0 fallback) before use, and `minutesToHM` renders `—` for non-finite input as a last-resort display guard. When adding new numeric trip/stop math, apply the same finite-check at the point of use.

- **A `backdrop-filter` ancestor is a blur root — nested glass silently can't frost.** The nav
  popovers used the navbar's exact glass recipe yet stayed sharp-edged: their blur sampled the
  topnav's own interior; the page behind never entered their backdrop. Floating panels must
  render outside the filtered ancestor — portal to `document.body` + `position: fixed`, with the
  rect captured from the trigger at open time (see `App.tsx` notif/user-menu). Corollaries:
  click-outside guards must cover BOTH the trigger wrapper and the portaled node
  (`useClickOutside` returns `[ref, portalRef]`), and focus must be moved into the open panel
  explicitly (`tabIndex={-1}` + `focus({ preventScroll: true })`) — portaled nodes leave the
  trigger's tab neighbourhood.

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

- **Heavy DOM-snapshot/image libraries stay out of the main chunk.** `html-to-image`
  is lazy-imported inside `billCapture.ts`'s share handler: static import measured the
  landing main chunk at 695.7 kB vs 682.4 kB lazy (+13 kB). Any new canvas/rendering
  dependency goes through `await import()` at the click site, and the choice is
  measured with `npm run build` before committing. Related: to snapshot themed UI
  (the bench receipt), pin the component's scoped custom properties to the wanted
  theme via an override class for the capture frame (`.bench-receipt.capture-dark`)
  instead of flipping `data-theme` on `<html>` — no theme flash, no restore race.
- **"Landing + core stays in the main chunk" decisions rot — audit static page imports against the build, not the comment.** An old code-splitting note in `App.tsx` said the workspace "stays in the main chunk (it is the app's core)", and three `import { X } from './pages/...'` statements quietly kept TripsList + TripWorkspace (138 kB) + Explore eagerly in the landing bundle for months (main chunk 683 kB; landing LCP paid for tabs and editors it never renders). `lazy()` + `Suspense` is already the established pattern for secondary routes — default every non-landing route to it and re-measure the main chunk whenever a page grows. Corollary for Lighthouse a11y: `label-content-name-mismatch` requires the accessible name to contain the FULL visible text — a state suffix like "Return leg ×2" must appear inside the `aria-label`, and a decorative glyph separator (`.ticker-sep`'s ◇) can never pass text contrast; render it as an SVG shape instead of chasing a passing text colour.
- **Buttons without an explicit colour inherit UA `buttontext` (black)** — fine on light
  surfaces, invisible on dark ones (Profile travel-style chips rendered black-on-navy in dark
  mode). The global `button { color: inherit }` reset in `styles.css` makes every button take
  theme text; set a colour explicitly only when a button deliberately differs.

- **lucide-react 1.x removed all brand icons** (`Instagram`, `Youtube`, `Twitter`, … were
  dropped upstream) — importing them is a tsc error, not a lint nit. Substitute a generic
  glyph and carry the network in the `aria-label` (Explore creator links use
  `TvMinimalPlay` for YouTube and `Camera` for Instagram). Check availability with
  `node -e "console.log(Object.keys(require('lucide-react')).filter(n => /x/i.test(n)))"`
  before writing the import.

- **Jakarta 400 is the faded body, not a contrast failure — and one icon stroke does not fit all sizes (learned 2026-09-27).** The Inter→Jakarta switch left every unweighted line at 400, which reads washed out at 12–15px in `--text-2`/`--text-3` while measuring 5–16:1 (all AA) — so the contrast gate stays green and only a rendered specimen shows it. The base weight is 500 now (`body`, Sora headers untouched). Same session: one global 1.5 icon stroke fills dense glyphs in at ≤12px in dark ink (Sparkles, Lock, kind kickers) — the shared wrappers (InlineIcon/MetaIcon/KindIcon) carry `.ic-sm` at 12px and under through the `--icon-stroke-sm` (1.25) token, 11px glyphs were raised to 12, and direct 12px glyphs to 13. When judging type or glyphs, render the specimen — the gate cannot see either.

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
- **A light-mode-passing colour can fail dark mode, because the teal scale INVERTS.**
  `--yf-teal-600`/`-700` are ordered dark→light in light theme (#0D8D82 → #0C716D) but
  bright→dim in dark theme (#2BB8AC → #1E9D92). So `#fff` on teal-600 measured 4.08:1 light /
  **2.46:1 dark**, and teal-700-on-teal-100 measured 5.14:1 light / **4.08:1 dark** — the
  bench's four selected states all failed at least one theme while looking intentional.
  Always compute BOTH themes from the token values (AGENTS: contrast is computed, not
  eyeballed), and fix the shared class rather than the surface: the same `.bench-*` classes now
  render on the landing hero and in Trip settings. The dark fix reuses the project's own answer
  for saturated fills — near-black ink `#06251f` on bright teal (6.62:1), exactly what
  `[data-theme='dark'] .pill-nav … .on-teal` already does.

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

- **`.card + .card { margin-top: 14px }` also matches GRID items — every new grid of `.card`s shoes it the same way.**
  A grid already spaces its items with `gap`, so the stacked-card beat double-applied: in a row of peers every card
  after the first rendered 14px lower *and* 14px shorter (live measure: tops 839/853, heights 477/463, and 26px of
  space where the grid declared 12). It is invisible to tsc, to every test and to the build because nothing renders
  these pages in CI, and it reads as "the cards look oddly placed" rather than as a spacing bug. `.explore-grid > .card
  + .card` and `.two-col > .card + .card` zero it; **when you add a grid whose children are `.card`s, add it to that
  selector list** (Explore, CreatorPage, TripsList and the public page's Travel-tips/Warnings row are covered).
  Related: a two-column grid nested inside a content column keeps the `1fr 340px` sidebar width it doesn't have —
  peer content in a row wants `.two-col--even` (1fr/1fr), not the sidebar shape. This pair is pinned by
  `tests/public-surface-guardrails.test.ts`.

- **`animation-fill-mode: both` outranks a `:hover` declaration, so an entrance animation silently kills hover motion.**
  `.trip-enter` animated `transform: none` as its last keyframe with `both`, which retained that value forever and beat
  `.itin-card:hover { translateY(-2px) }` — a shelf card answered the pointer with a shadow change and no movement while
  the *same component* on a creator page (no `enterIndex`, so never animated) lifted. Use `backwards` when the
  animation's end state equals the element's own resting state; it applies the `from` state during the stagger delay
  exactly as `both` did, then releases the property. Debugging tell: compare the same component on a surface that
  animates it against one that doesn't.

- **A grid or flex item's automatic minimum size is its MIN-CONTENT, so one unbreakable run sets the width of the
  whole document.** The published page's sticky sidebar held a nowrap share URL in a flex row: that gave the column a
  **451px floor inside a 362px column**, scrolling the document 75px sideways at a 390px viewport — and the
  `overflow: hidden` + `text-overflow: ellipsis` the rule already declared could never fire, because the item refused
  to shrink below its min-content. `min-width: 0` on the grid children (`.two-col > *`) and on the flex item fixes it.
  Two corollaries: the fix belongs at the *container* level (setting it on the inner `<code>` alone changed nothing —
  the column's floor is what overflows), and **diagnose it with `document.documentElement.scrollWidth - clientWidth`
  plus a `getBoundingClientRect().right > viewport` sweep**, not by eye — the widest offender here was an 8px-wide
  visible element sitting inside an invisible 451px floor.

- **A container's `overflow: hidden` deletes absolutely-positioned children that "hang" past its edge — and the
  geometry reads as fine until you hit-test.** `.pub-hero-stats` was positioned at `bottom: -66px` over a hero with
  `overflow: hidden`: its box measured 507→720 against a clip at 654, so the bottom two of its four evidence rows
  were never painted and `elementFromPoint` at their centres returned the Save/Fork buttons *underneath*. Two tells:
  a `getBoundingClientRect()` box that exceeds its nearest clipping ancestor, and rows whose hit-test result is a
  sibling surface. Check for a negative offset over a clipping ancestor whenever a floating card sits on a fold —
  and if the design intends the straddle, the reserve/clearance must move with it (here the card was brought inside
  instead: `bottom: 16px` with the hero's bottom padding grown to match, so nothing moves on screen except the clip).

- **A responsive rung placed BEFORE a wider one loses to it — media-query order is the cascade, not specificity.**
  A `@media (max-width: 360px)` block written above the `<=480` and `<=720` blocks applied only the one declaration
  those blocks don't themselves set; everything they touch won. Rungs go in **descending-width order** (or the narrow
  one last), and a comment saying "placed after X on purpose" is cheaper than rediscovering it. The related trap: a
  shared selector *list* (`A, B, C { … }`) and a later per-class rule have equal specificity, so the later one wins and
  silently overrides the recipe — when routing an existing class through a shared recipe, **delete its own
  declarations in the same edit**, don't just add it to the list.

- **A guardrail regex anchored on `\.class \{` also matches the TAIL of a shared selector list.** `.poi-grp-k, .poi-reason-k {` contains `.poi-reason-k {`, so a rule-extraction pattern written for "this class's own rule" read the shared recipe's declarations back as the class's own and reported a phantom violation — and the inverse: a teeth-test can pass for the wrong reason. Anchor to the start of a line (`^` with the `m` flag) in a one-rule-per-line stylesheet, and confirm each class has exactly one rule before trusting the pattern.

- **A gate's baseline key must never carry a line number — key it by what the rule declares.** The contrast and duration keys were line-numbered (`styles.css:1285 .day-rail-chip.warn:hover — 3.48:1`), so *every* CSS insertion anywhere above them failed the gate with phantom "new violations" and forced a deliberate re-baseline — hit twice while building the gates, and a third time as a rebase conflict, which is the worst form: two branches had both moved `styles.css`, so each side read the other's entries as new (the same selectors, different numbers, neither side mergeable). All six arrays now key on the offender's own text: `selector — ratio`, `selector — prop: value`, `property: value`, or the bare name for `duplicateSelectors`/`hueCollisions`. The migration was proven exact — every array identical once the prefix is stripped (36 entries, none collapsed, nothing added or lost). The trade-off is explicit, narrow, and now uniform: a *second* rule repeating an already-tolerated pair is **not** flagged, because the pair is what the key names; `duplicateSelectors` catches that selector twice at the top level, which is where it surfaces first. Every set still only shrinks — an entry that stops reproducing fails the gate until it is deleted — and zero stays exempt (`margin: 0px` is not rhythm). Re-baseline deliberately with `UPDATE_DESIGN_SYSTEM_BASELINE=1`.

- **To verify a cascade on a surface you cannot sign into, inject a probe element and read `getComputedStyle`.** The map rail's labels need a signed-in trip, so the computed style was read by appending a detached `<span class="poi-grp-k">` to the live page and reading back `fontSize`/`fontWeight`/`letterSpacing`/`textTransform` — which is how the routing was proven to *take effect* (10.5px / 700 / 0.63px) rather than merely to be declared, and how the one-class list-override trap above would have shown up. `agent-browser eval` takes the JS as its argument (there is no `--file`), and the DOM injection leaves the repo untouched (`index.html` stays byte-clean).

- **A Wikimedia cover cannot be fetched from a browser even though curl reads it fine (learned 2026-09-19).** Copying an auto-suggested cover into our own bucket needs the bytes, and `Special:Redirect/file/<File>?width=N` — the shape `sizedCoverUrl` writes and the picker stores — answers a **301** to `upload.wikimedia.org`. Only the final 200 carries `access-control-allow-origin: *`; the 301 hop carries none, and a cross-origin fetch must clear **every** hop, so `fetch()` rejects with a bare `TypeError: Failed to fetch` while the identical curl request downloads 586 KB happily. Resolve the direct address first through the file's own wiki API — `https://<host>/w/api.php?action=query&prop=imageinfo&iiprop=url&titles=File:<name>&origin=*` — whose `imageinfo[0].url` is an `upload.` file, and `upload.wikimedia.org` file URLs are the only Wikimedia addresses a browser may read directly. Three corollaries: the API appends its own `?utm_*` query, which must be stripped before the URL is stored; the name in the URL is percent-encoded while the API wants it decoded, so decode **once** or `Telkupi%252C_Purulia.jpg` is born; and `wikimediaFile` in `tripThumb.ts` parses only the direct `/wikipedia/…` shape, so the `Special:Redirect` form needs `wikimediaFileName` — assuming the one function covers both is how the first version failed.

- **Wikimedia serves only the thumbnail widths it has generated — a composed width answers 400.** Auto covers read the REST summary's `originalimage`/`thumbnail`, which is either the *unscaled* upload or a 3840px thumb (1.3–3.3 MB measured across real destinations), so the obvious fix — build `…/thumb/<h>/<hh>/<File>/1200px-<File>` — 400s on **both** `upload.` and `thumb.wikimedia.org`, and so does substituting the width into a URL the API itself returned. The supported route is `Special:Redirect/file/<File>?width=N`, which 301s to the nearest size that exists (1200 → 1280) and measured 144 KB where the original was 1304 KB. Two corollaries when matching these paths: strip the `?utm_*` query the API appends (it is captured as part of the file name otherwise and produces a nonsense URL), and take the file name **exactly as it arrives** — it is already percent-encoded, so decoding then re-encoding double-escapes `Telkupi%2C_Purulia.jpg`. `lib/tripThumb.ts` `COVER_WIDTH` is the single lever if a future cover exceeds the 600 KB preview ceiling.

- **The only server-rendered URL is `/i/<id>`; a hash fragment never reaches the server, so every in-app screen is `/` to a crawler (learned 2026-09-19).** `/#/explore`, `/#/trips` and `/#/pub/<id>` are all served by the shell, which makes a `Disallow: /#/…` rule in `robots.txt` inert — it looks correct and does nothing, and a test now forbids adding one. Public discovery runs through `public/robots.txt` plus `api/sitemap.js`, which lists the shell and every `published_itineraries` row and answers **503** rather than a one-URL sitemap when the catalogue is unreachable (a valid-looking document naming only `/` tells a crawler every publication was deleted). A new `api/*` handler needs its `vercel.json` rewrite in the same change, and `/api/` stays disallowed so the rewritten target never becomes a second URL for the same page.

- **A crowded flex row squeezes whichever child CAN shrink — find which one gives, then key the fix to the space the row actually gets, never to the viewport (learned 2026-09-19).** The Plan Bench's mode buttons pack an icon, a name and a speed pill into one row; in the 721–1000px band each button is a *quarter* of the controls card, so the row's only flexible child — the name — ellipsized to a single letter ("T…" at 78.7px) while the inline SVG beside it squashed 15px → 3px (`flex: none` on the icon is the one-line half of the fix). Two traps. (1) A viewport media band is a *proxy* for a row's width: it must be re-derived by hand whenever the container's max-width, the grid ratio or a gap moves, and the cheap fix it suggests is not even correct — hiding the speed pill was measured to still clip the longest name from 721px to ~755px, because the icon grows back to its true 15px and takes 12 of the ~33px the pill was holding. (2) The same row can be hosted under a different parent (the Trip Settings tab's 8-mode grid, longest label "Motorcycle"), where one viewport is not the same width at all — so the rule has to be about the row's own box. What holds: `container-type: inline-size` on the block that owns the row plus `@container (max-width: …)` switching the grid to one column — it follows the real constraint, covers the sibling surface for free, and survives minification (`max-width` ships as the range form `(width<=230px)`, so grep the built CSS, not only the source). Verify by measuring `scrollWidth − width` per label and the icon's own width across the whole band, never by reading the CSS — and check the height cost against the surface's own budget (here the stack costs 80px in a band that already overflowed its one-screen promise).

- **A decelerate curve is right for a dropdown and a pop on a 1000px surface — measure the motion's SHAPE, not the transition rule (learned 2026-09-19).** `--ease-out` and `--ease-glide` agree within .015 at every sampled point and both put 86% of a surface's distance inside the first 44% of the duration, so the Timeline's day collapse spent 24% of a 967px body in the first 6ms and dribbled the last 10% over 150ms — a defect no amount of CSS reading shows, and one that looked like "the collapse is not smooth". Two instruments worth reusing: (1) sample `getBoundingClientRect().height` per rAF across a toggle and plot fraction-moved against ms — that curve tells you whether you are looking at the easing, the interpolation or a dead beat (the open path here had a ~35ms beat before anything moved, the two rAFs that let the `0fr` row paint first); (2) forcing `transition-timing-function: linear` in the live page isolates the easing from the technique — with linear the `grid-template-rows 0fr↔1fr` interpolation was a straight line, which pinned the entire defect on the curve. `--ease-resize` (`cubic-bezier(.42, 0, .58, 1)`, both ends at rest AND symmetric) is now the token for a surface that resizes in place and moves a long way — symmetric because peak slope is what a long move is felt through: on the day collapse's ~920px the asymmetric Material standard curve peaks at 2.73× its average speed (96px in one 60Hz frame) against 1.72× (60px) for the symmetric one, for the same total time and the same 3px first frame, so the asymmetric family belongs on short moves only. Corollaries: the affordance must run on the SAME duration and easing as the thing it announces (a chevron at `--t-fast`/180ms finished ~90ms before the body, so one click read as two movements), and any JS timeout that outlives the animation (unmounting a collapsed body) must take its duration from the token via `motionTiming()` — a literal 280ms quietly leaves a half-collapsed body mounted the moment the token is retimed. **Duration is the other half of the same defect, and the only lever that reaches peak frame speed.** With the curve fixed, the rows below a folding day still peaked at **10.5px/ms** (942px of travel on `--motion-slow`/240ms) — reported by the user as the cards "colliding". Peak speed ≈ `distance × the curve's peak slope ÷ duration`, so once the easing is right the options are a longer duration or less travel; a ~950px accordion body has only the first. `--motion-slower` is the fourth duration token, reserved for travel measured in hundreds of px, and its value was set by measurement rather than taste: 240ms peaked at 10.5px/ms, 440ms at 3.6, 560ms at **2.8px/ms (47px inside a 60Hz frame) with a first-frame delta of 0** (nothing moves on the click itself), and the measured per-frame peak fell in both directions (79→25 and 115→25px on a ~145fps renderer). One tension worth naming: 560ms is above Material's 375–500ms guidance for a large expansion, and it is only defensible because the distance is ~950px — set this token by the px/ms you need, not by the duration table's habit. Two measurement traps this caught, both of which would have made the wrong call: **quote px/ms, never px per frame** — a 145fps renderer hands you ~7ms frames and makes the same motion look half as fast as a 60Hz phone will show it — and a **single long frame inflates one delta**, so read p90 beside the max and report the frame intervals next to them (a 69px 'peak' at 86% of the animation was one dropped frame, not the curve). Also: an element that unmounts mid-sample reports a zero rect, which reads as a jump to the top of the page — skip anything detached. When a move still reads as a collision after the easing is fixed, check the DISTANCE before adding more curve.

- **A focused element is blurred the moment it stops being visible — so a focus handoff must run when the close STARTS, not when the node unmounts (learned 2026-09-19).** The day collapse's clip unmounts 600ms after the close (the token's duration + 40ms slack), and the obvious place to hand focus back — inside that unmount timer — is already too late: the clip's inner wrapper carries `visibility: hidden` on a transition *delay* of the same token, so it flips at 560ms and Chromium blurs the focused control right then, leaving `document.activeElement === document.body` by the time the timer fires. The measured symptom was a keyboard user losing their place: activating the day's route line with Enter (the control that opens the day) removed that line one animation later, and the next Tab restarted at the top of the document. The handoff belongs in the effect body beside `setExpanded(false)`, where the clip is still on screen. Generalise it: **whenever a rule hides or removes whatever has focus, ask which comes first — the blur or your cleanup — and hang the handoff on the earlier one.** Every clip that can unmount the focused element needs its own handoff (here: the route line on open, the body on collapse), and the same fix is the reason a disclosure control should own the fallback focus rather than the clip guessing.

- **A programmatic `.click()` does not move focus; a real mouse click does — so a focus-loss finding from `.click()` is a probe artifact (learned 2026-09-19).** Collapsing a day while focus sat inside its body reported `document.activeElement === document.body` when the click came from `el.click()` in an eval, and I nearly shipped a fix for it; the same interaction through a real CDP click (`agent-browser click`) lands focus on the chevron, because a pointer click focuses the button it hits. **Probe focus behaviour through the input path the user has** — real clicks for pointer, real `Tab`/`Enter` (`agent-browser press`) for keyboard — and expect the two to disagree: only the keyboard path had a genuine defect here, and only the keyboard path could have revealed it. Re-run any focus or state anomaly through the real input before writing a line of code for it.

- **A centred flex item is re-positioned by every sibling's height change — top-align a row's items when its content toggles (learned 2026-09-19).** The Timeline day header is `flex-wrap: wrap` + `align-items: center`, and collapsing a day makes the middle block taller (the collapsed-only route chain appears, and the stats line re-wraps as the chips come and go). Every centred sibling then re-centres on the new line height: the collapse chevron and the Day badge moved **up to 32px within the frame the click landed**, while the body animation took 240ms — the "jerky displacement" the user reported, and invisible in any CSS read. `align-items: flex-start` makes each item's position its own; re-measured, the displacement of every header item across a toggle is 0px. Three companions from the same fix: (1) **a wrapped line's position follows the animating line above it**, so once the height change is eased the second line glides too (the day's action row moves 43.8px *smoothly* during an open — correct, and it used to be a jump); (2) the one element that changes a container's height should ride the collapse (here the route chain reuses `SmoothCollapse` in reverse) rather than appearing at full height in one frame; (3) the elements that exist in only ONE state and change *width* (chips) can't be eased by a height animation at all — give them the catalog's entrance pattern (fade + 4px rise) so they arrive as a fade instead of a pop, and accept that their layout slot appears at once. Instrument: sample each child's `getBoundingClientRect()` per rAF across the toggle and report per-child max |Δx|/|Δy| + the container's height curve — that separates "something jumped" from "something glided 40px".

- **A day is addressed by `day.index` and never by array position — and one report names only one of the places that got it wrong (learned 2026-09-26).** Issue #338 read as a per-day money bug in `computeTotals` (`byDay` was built positionally but read with `byDay[day.index]`, the round-trip drive home went to `byDay[len - 1]`, and an expense's `dayIndex` was clamped to the last day — so on a sparse trip, indexes 0,2,3 after a deleted middle day, a day could show a stranger's total). Fixing exactly that was not enough for the issue's own acceptance test *"an unsorted `trip.days` array follows `day.index`"*: the same index-vs-position mistake lived in `originOf`'s `dayEndPosition` (`trip.days[dayIndex]`, so a sparse trip's later days woke up at their own start and measured zero legs), in `firstFixedPoint`/`lastActiveStopPoint` ("home" and the return turnaround read from the array's first/last slot, so shuffling the array moved the whole route), and in two `day.index === trip.days.length - 1` return-shape checks (a count is not the last index). When a day-keyed bug lands, grep `trip.days[` **and** `days.length - 1` across `src/lib` before calling it fixed. The readers clamp too: the Timeline's chip, `printModel` and the engine's own lookups each had their own positional `Math.min(index, len - 1)` — a lookup that finds no bucket must render NOTHING, never another day's number. Two smaller lessons from the same wave: the page handlers that carry this class of bug can still be regression-tested in the node suite — `react-dom/server` renders a pure component (`tests/timefmt.test.ts`, `tests/form-error-summary.test.ts` are the precedent, used here for `DaySpark`'s NaN coordinates) and a narrow source assertion binds a handler to the helper it must call (`tests/decision-resolve.test.ts` is the precedent); and a guard keyed on a row's `status` must treat a MISSING status as open (`if (sg.status && sg.status !== 'open')`), because a hydrated row that predates the field would otherwise become un-actionable — the `fire-and-forget` fixture has no status and caught exactly that.

- **A new CSS block may not claim an existing bare class name — later in the file wins on equal specificity, and the whole gate stays green while it does it (learned 2026-09-21).** I-20's unlock sheet shipped as `.reveal`, which is the Landing page's scroll-reveal utility (`body.reveal-armed .reveal` — nine elements: the section `h2`, three feature cards, four steps, all armed by one IntersectionObserver). The new block sits further down the stylesheet, so it won: those elements were re-laid-out as a flex column wearing the sheet's padding, and `.reveal > *` handed each of their children the sheet's stagger animation. **Nothing in the gate can see this** — `tsc` does not read CSS, the node tests have no DOM, and the contrast/spacing ratchets key on declarations rather than ownership — so it survived a fully green `npm run verify` (1613 passed, build clean). What caught it was rendering a page and asking the DOM a question: `document.querySelector('.reveal')` came back **truthy on a Landing render**. The recipe, cheap enough to run for every class a new block defines: `git show origin/test:src/styles.css | grep -c "\.<name>[ ,{:]"` — 15 of that block's 16 names cleared at zero and the sixteenth was the collision. Prefer a prefix you cannot collide with over a good short name (`.unlock-reveal*`, not `.reveal*`). It is now pinned by `tests/design-system.test.ts` → *"a class name has one owner"*, which fails on a bare `.reveal` selector naming the reason, and the pin was teeth-tested by appending `.reveal { outline: 0; }` and watching it fail before reverting. Same collision class as the two idea-banks' `I-19` and `I-20` (AGENTS §6): when a name is shared across the project, check the *namespace*, not just the name.

