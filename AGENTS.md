# AGENTS.md — YatraFlow

Operating manual for AI coding agents (Cline and friends) working in this repo.
This file is the **short** one on purpose — workflow rules and where everything
else lives. Conventions, pitfalls and the verification detail sit behind pointers,
so a run pays for the branch it actually takes. **Keep this file growing**, and
grow it by tightening, not by appending.

## 0. The learning rule (this file must grow)

Any crucial learning made while working here — a pitfall that cost debugging
time, a project quirk, a convention the user cares about, a "local lied, CI was
right" moment — **must be recorded in the same session it was learned**, as a
short actionable rule in the most relevant file:

| What you learned | Where it goes |
| --- | --- |
| How to do this class of work, or a pitfall | [`CODING_STANDARDS.md`](CODING_STANDARDS.md) |
| What the gate runs, what CI does, migrations | [`docs/AGENTS-VERIFICATION.md`](docs/AGENTS-VERIFICATION.md) |
| A workflow rule the user mandated | Here, in §2 |

Before committing, ask: *"did this session teach something a fresh session
would need?"* If yes, add it and include the update in the same commit.
Prune entries that stop being true.

## 1. What this project is

YatraFlow — collaborative India trip-planning app. React 18 + Vite 8 +
TypeScript, Supabase (auth + data), MapLibre GL maps, hash-based routing,
deployed on Vercel from `main`. No bookings — planning plus paid itinerary unlocks.

Key locations:
- `src/App.tsx` — app shell: hash routes, nav (hamburger ≤720px), theme, notifications
- `src/store/store.ts` — data layer (`useSyncExternalStore`) over Supabase
- `src/lib/engine.ts` — pure planning engine (schedule, budget, breaks, warnings)
- `src/lib/geocode.ts` — provider facade: Google-only suggestions when a key is configured, free stack as the keyless mode (see §5 directive)
- `src/lib/providers/` — `google.ts`, `free.ts` (OSM/Wikipedia/Mappls), shared hits logic
- `src/lib/timefmt.ts` — 12h/24h clock preference + formatters (default 12h)
- `src/lib/uiPrefs.ts` — per-day collapse persistence (localStorage)
- `src/components/TripMap.tsx` — MapLibre map (lazy chunk); `src/components/mapcn/` wrapper
- `src/pages/TripWorkspace.tsx` — the big one: tabs (timeline, map, budget, share…)
- `tests/` — vitest in **node env (no DOM)** — test pure logic, not DOM
- CHANGELOG.md — Keep-a-Changelog-style; versions are pre-1.0 milestones

## 1.1 Current project status

**Do not read status out of this file — derive it.** Every number below has a
command that is faster and correct where a hand-maintained line is not:

```bash
git status -sb                                  # branch + dirty tree
git log --oneline -5                            # what actually landed
git rev-list --left-right --count origin/test...HEAD   # local vs integration
git describe --tags --abbrev=0                  # newest release
gh issue list --state open --limit 200          # the real queue
gh pr list --state open                         # in-flight PRs
```

`git log` is the release history; `CHANGELOG.md` is the user-facing record of what
each version does. Neither is summarised here — a summary is a cache of a lookup
the agent can make itself, and a stale one silently misleads. The open-issue count
and the branch-level claim this section used to carry **do not exist** here on
purpose: re-derive both, because a hand-maintained number rots and no reader can
tell which of them is still true.

**The one thing worth checking before a push to `test`** (the promotion pattern is
`feature → test → main`, so a fix pushed to a stale `test` lands on a tree that
cannot be built):

```bash
git merge-base --is-ancestor origin/test origin/main && echo "test is BEHIND main - resync first"
git rev-list --count origin/main..origin/test   # non-zero = test has unique work
```

`test` has drifted behind `main` before (49 commits, found 2026-09-11, missing the
whole Android shell and v0.45–v0.48). Re-derive both numbers in the same session
that notices the drift.

## 2. Workflow rules (non-negotiable, user-mandated)

1. **Never push to `main` without the user's explicit confirmation** — commit
   locally, then ask.
2. **Every push ships documentation**: CHANGELOG.md entry in the same commit
   (under `[Unreleased]`, or a versioned section for releases). Feature-worthy
   releases also bump `package.json` + lockfile version and update README.
   **The changelog records final state, not session history.** No "round 2",
   "PR #N follow-up", "bug-hunt batch", branch names or finding-the-bug
   stories in the entry text — say what the product does now, once, under the
   right Added/Changed/Fixed heading. When a fix supersedes an earlier
   `[Unreleased]` entry, **edit that entry** instead of adding a second one;
   issue numbers may trail an entry as traceability (`(#123)`), never as its
   framing. Release notes consolidate; the reader gets the shipped truth.
3. Fixes and features get changelog entries with enough context to understand
   them six months later.
4. **Another agent may commit into this same working copy** — Hermes has
   dropped doc commits directly onto local `test` (an uncorrected duplicate
   of its own PR branch). Before trusting or pushing a local branch, run
   `git status -sb` and `git log origin/<branch>..<branch>`; reconcile
   foreign unpushed commits (reset/supersede **with user approval**) rather
   than shipping them.
   **A diagnosis in the tracker is an invitation, so claim the work in the
   same breath (learned 2026-09-29).** One lane re-verified #360, posted a
   precise analysis on the issue — what had landed, what was left, which of
   two options it recommended — and then started building that option. A
   second lane read the comment, agreed with the recommendation, and built
   the same fix; both were complete, tested and gated, and one had to be
   closed as superseded. Neither agent did anything wrong: the comment said
   *what* to do without saying *who*, and an unclaimed recommendation in a
   shared tracker reads as an invitation. So end an analysis you intend to
   implement with the claim ("taking this — branch `x` from `test`"), and
   before starting an issue you have just analysed, run
   `git ls-remote --heads origin | grep <issue-number>` — a lane-D branch
   already existed for this one and one command would have shown it. The
   cheap version of the same check: assign yourself the issue.
5. **UI-audit remediation is tracked in `ROADMAP.md`** (🟣 section): tick a
   finding in the same commit that fixes it — batch status table only, prose
   goes to CHANGELOG. `docs/UI_AUDIT.md` is the per-finding reference
   (file:line + example fix); don't duplicate its content in the tracker.
6. **Verify "done" claims against git before acting on them.** A session cut
   off mid-batch can leave completion summaries that were never true — this
   cost a full re-do when batches 5–6 were reported as committed while
   `git log` showed only batch 3 and half of batch 4 sat uncommitted in the
   working tree. On resume: `git status -sb` + `git log --oneline -5` +
   re-grep the tracker table, and treat any prior "committed ✅" summary as a
   hypothesis until the commit hash exists. Never re-report status from
   memory; re-derive it from the repo.

   **Rules 6a–6z moved to [`CODING_STANDARDS.md`](CODING_STANDARDS.md)** — they are
   code pitfalls, not workflow, and they had accreted here to the point where they
   were a third of this file. The numbers are unchanged, so a `§2.6b` reference
   anywhere in this repo still resolves — read it in the standards file.

 7. **When asking the user to review/test locally, always hand them the exact
   URL — never make them find or start the server.** Check if the dev server
   is up (probe `http://localhost:5173`); if not, start `npm run dev`
   detached (`Start-Process npm.cmd -ArgumentList 'run','dev'` in PowerShell,
   or from Git Bash `nohup npm run dev -- --port 5173 --strictPort > /tmp/dev.log
   2>&1 &` — the durable form, since a harness `BACKGROUND` mode may not exist
   and a plain `&` alone can leave the tool waiting on the pipe). Confirm it
   serves *this* working tree before linking (fetch
   `http://localhost:5173/src/styles.css` and grep for a token/marker that
   only exists in the current branch's changes — a stale server from another
   branch will otherwise silently show old UI). "Up" is not "current": a
   long-running dev server's file-watcher can die during branch churn and
   keep serving a dead module graph with HTTP 200 (happened on the 5176
   server, Sep 14 2026 — hot reload silently stopped mid-session). If the
   marker greps come back empty on a *responding* port, kill the PID
   (`netstat -ano | grep :PORT` → `Stop-Process -Id <pid> -Force`) and start
   fresh, then re-grep the markers before handing over the URL. Then give
   deep links per screen (e.g. `http://localhost:5173/#/` for Landing,
   `http://localhost:5173/#/trips` for My Trips) and say what to check
   (themes, mobile width, specific interactions). **"Serving this tree" is not
   "serving it with a backend":** a dev server started before `.env.local`
   existed (or from another clone of the repo) serves the current source and
   still renders blind — the console reports *"No Supabase project compiled
   into this build"* and every data surface sits on `Loading…` with
   `hydrate … failed`, which reads exactly like a broken product. Before
   handing over a URL, prove the backend is compiled in by grepping the served
   client for the project ref
   (`curl -s http://localhost:PORT/src/lib/supabase.ts | grep -o <ref>`) and
   start a fresh server if it comes back empty; the `localhost:54321` fallback
   string is in every bundle, so it discriminates nothing. (Found 2026-09-17:
   the long-running 5173 server had no Supabase project compiled in at all.)

   **A signed-in browser is bound to an ORIGIN, not to a person or a machine
   (learned 2026-09-27).** A Supabase session lives in the origin's storage, so
   every dev-server port is its own world: a profile signed in on another clone's
   server (or on production) still reads **"Log in"** on *this* tree's port, and a
   browser check of a signed-in surface therefore needs the sign-in performed on
   the port that serves the tree under test. Ask for that explicitly instead of
   assuming the profile carries a session — and prove it before driving the check,
   because the signed-out app renders the marketing landing at a protected hash
   route rather than an error, which reads like the feature under test is missing.
8. **Build locally first; confirm the target branch before every push.** A feature
   or fix is always implemented and verified (`npm run verify`) on the current
   local branch before any push is even discussed. When the work is ready, tell
   the user which branch you propose to push to and wait for explicit
   confirmation — never push to `main`, `test`, or any other branch as part of
   the implementation step. This prevents unauthorized code from reaching a
   shared branch and keeps the user in control of what ships.
9. **Never bulk-rewrite `CHANGELOG.md` with a script, heredoc or shell
   interpolation — edit it with editor primitives only.** This failure mode has
   already hit twice — three, counting the scripting-language variant (2026-09-21):
   a python splice meant as `lines[i:i] = [entry]` was written as `lines[i:i] =
   entry` over a *string*, which slice-assigns CHARACTER-wise and shredded 4
   lines into 6,000 (the file blew up 4×; `git restore` recovered it, and was
   only safe because every other change in the file was already committed).
   Splice lists of LINES, and re-check the diff stat before moving on: a doc
   edit whose insertions outnumber the lines you meant to add is a shredding
   in progress. In `adf5f66` (*"chore: v0.42.0 — changelog cleanup"*) a
   bulk rewrite truncated the file from **830 lines to 21**, discarding the
   entire pre-`0.42.0` record, and while rewriting ate the leading byte out of
   code spans — `` `applyChange` `` committed as `` `pplyChange` ``,
   `` `routeHash` `` as `` `outeHash` ``. The `[0.43.0]` entry records an
   earlier instance of the same class (*"a BEL character where an 'a' should
   be"*). A byte-eating rewrite in the one file that records the project's
   history destroys the evidence you would need to notice it happened.
   The truncated record was recovered on 2026-09-11 as
   `docs/history/CHANGELOG-through-0.41.1.md`; the rule and the archive's
   rationale are documented in `docs/history/README.md`.
   Corollary: **destructive edits to documentation get their own commit**, so
   the diff is reviewable in isolation and a revert is surgical.
10. **Every interactive surface ships motion from the motion tokens** —
   `docs/MOTION-TOKENS.md` (durations `--motion-fast/med/slow`, easings
   `--ease-out`/`--ease-glide`, and the pattern catalog: dropdown entrance,
   toggle glider, day collapse, drag follow/settle). Pick a pattern from the
   catalog, don't invent a feel; a raw `ms` value in a new CSS rule is a
   review flag; `prefers-reduced-motion` opt-outs are mandatory on animated
   rules. This exists because the long-refined surfaces (Timeline, Board) feel
   smooth while newer additions shipped motion-less — the gap only stays
   closed if motion is part of "done" for every update.

11. **Work stays locally committed until it is complete and the localhost check
   is satisfactory.** Commit as work lands on the working branch; a push is the
   last step of a finished batch, never the end of each fix or review pass. The
   author decides when a batch is finished and testable, and says so before any
   push (user-mandated 2026-09-17).

12. **A PR merged into `test` does NOT auto-close its issues — close them by
   hand (learned 2026-09-25).** GitHub's `Closes #N` keywords fire only when a
   PR merges into the DEFAULT branch (`main`), so every fix that lands on
   `test` leaves its issues OPEN: the Wave-0 map merges (#380/#399) carried
   seven closing keywords and closed nothing until each issue was closed
   manually with a landing comment (merge SHA + PR number). After merging a
   PR into `test`, verify with `gh issue view` and close the referenced issues
   yourself — the tracker must mirror reality, not the keyword's promise.
   **Automation (same day):** `.github/workflows/issue-autoclose.yml` mirrors
    the tracker on every PR merged into `test` (keyword grammar in
    `scripts/pr-auto-close.mjs`, pinned by `tests/pr-auto-close.test.ts`) and
    leaves a landing comment on each issue it closes. Still verify after a
    merge, and close by hand when that job is red — the rule is the mirror, not
    the mechanism.

13. **Write new prose in Simplified Technical English (ASD-STE100) — this
    covers new documentation, new rules, changelog entries, and how an agent
    explains a problem, a fix or a design in chat (user-mandated 2026-10-02).**
    Use these rules for the prose you write from now on:

    - Put one instruction in each sentence.
    - Keep each sentence under 20 words.
    - Use plain words. Do not use a technical term when a plain word works.
    - Do not start a step with a gerund. Write "Check the value." Do not
      write "Checking the value."
    - Address the reader as "you".
    - Use the active voice. Name the actor.
    - Use "must" and "must not" for a rule. Do not use "should".
    - Do not put a bullet list inside a sentence.

    These rules do not change the text that is already in this repo. The
    existing pitfall rules stay as they are. They exist to explain a failure
    in full. A new rule uses the list above.

    **Check the new prose before you commit:**

    ```bash
    npm run lint:ste        # checks only the files you changed
    ```

    See [`CODING_STANDARDS.md`](CODING_STANDARDS.md) §2 for the full
    vocabulary and the exceptions.


   **A migration the USER must run is handed over as complete SQL, in the chat,
   with its full local path — never as a filename to go and find (user-mandated
   2026-09-25).** These are applied by hand in the Supabase SQL editor, so the
   handover is the whole file, verbatim, pasted as one runnable block, with the
   absolute path beside it
   (`C:\Users\hasna\yatraflow-freebuff\supabase\migrations\<file>.sql`). Say
   whether re-running is safe and what the status check should read afterwards.
   Then PROVE it landed instead of assuming: `npm run check:migrations` must fall
   to `0 missing`, and an independent live probe is the stronger evidence — a
   PostgREST `select` of the new column answers `200`, while the same request
   naming a control column the schema never had answers `400 42703`. A file
   sitting in the repo says nothing about the database (#432's
   `resolved_option_id` type change is the case that proves it:
   `check:migrations` can never see it, and only the probe did).


## 3. Verification, CI and the migration check

Moved to [`docs/AGENTS-VERIFICATION.md`](docs/AGENTS-VERIFICATION.md). It answers
*what the gate runs, which CI job fires on which destination, and what `verify`
cannot see*. Sections `3.1` and `3.2` keep their numbers there, so a `§3.1`
reference still resolves.

## 4. Code conventions & pitfalls

Moved to [`CODING_STANDARDS.md`](CODING_STANDARDS.md) — the reviewer reads it, and
an implementer reaches for the one rule that covers the area being changed.

## 5. External services

Supabase (auth/data) · Vercel (auto-deploy from `main`) · Google Places
(opt-in key, quota-guarded) · OSRM ·
Open-Meteo · Mappls · **OpenFreeMap** (basemap tiles — keyless, no request
limits, commercial-OK; its TileJSON carries the required attribution, see §4). Live probe for
Google: `scripts/verify-google-places.mjs`.
**Provider directive (Sep 2026, PR #73; amended 2026-09-15 for #189): with a
Google key configured, the POI pipeline is Google-ONLY** — food, fuel,
lodging, sights and the along-route scan all come from Google; Google failure,
quota exhaustion or empty scans render an honest "no match"/quota note, they do
NOT silently fall back. The free stack (Overpass/Wikipedia/Mappls) serves
keyless mode, with ONE narrow exception: the **night-halt town anchor** also
asks OSM `place=city|town` even in Google mode, because Google's `locality`
type bottoms out at village level in rural India while OSM carries real towns
with populations — a halt needs a bed, and `preferTownGrade` drops the
hamlet-grade entries when towns are available (live-verified: hamlets like
"Gauriyapur" vs Chunar 37k / Mirzapur 234k / Hazaribagh). That exception is
scoped to the town anchor alone; never extend it to POIs or the corridor scan.
Round-trip routes (origin ≈ destination) get a Google point-search supplement
instead of the along-route scan. Geocoding (search box) still degrades
Google → free; don't reintroduce a silent fallback into the suggestion path,
and update surfaces that claim it never degrades (this section, README,
ARCHITECTURE).

Applying `supabase/schema.sql` DDL: the Dashboard SQL editor can run inside a
**read-only transaction** — DDL like `ALTER PUBLICATION` then fails with
`cannot execute … in a read-only transaction` (typical causes: the disk-full
read-only flip on the free tier, or a replica-routed session). Manage realtime
publications via **Dashboard → Database → Publications** instead (the UI
mutates through the management plane, not your SQL session), and verify live
membership with a plain SELECT (always allowed):
`select * from pg_publication_tables where pubname = 'supabase_realtime';`
No-SQL alternative: subscribe a `postgres_changes` channel per table with the
public anon key — Realtime rejects non-published tables at SUBSCRIBE time, so
a `SUBSCRIBED` status is functional proof of membership (verified all 8 tables
PASS this way after the #18 `profiles` toggle).

**Pruning junk Supabase data — probe before you prune, and prune by owner, not
by orphan check** (Sep 2026): the reported "802 orphan rows" turned out to be
~2,100 *valid* cross-account rows from demo-seed replays, not orphans.
- An orphan probe (`child.trip_id NOT IN (SELECT id FROM trips)`) validates ONE
  link only. If the cascade broke higher up (auth user → profile → trip), child
  rows look "valid" while the whole subtree is junk. Probe each level: profiles
  without auth users, trips without owner profiles, then children without trips.
- **Membership counts ≠ trip-owner counts.** `trip_members` grouped by user
  showed only 3 accounts (~412 rows) while `trips` held 2,113 — seed replays
  wrote trips whose member inserts silently failed. The authoritative junk map
  is `SELECT owner_id, COUNT(*) … FROM trips` joined to `profiles.email`, not
  the membership table.
- **The prune is one statement.** All six child tables carry `ON DELETE CASCADE`
  on `trip_id → trips(id)` (schema.sql), so `DELETE FROM public.trips WHERE
  owner_id <> '<keep-uuid>'` in the SQL editor (management plane, bypasses RLS)
  sweeps everything. Capture per-table counts before/after in the same session
  and paste them into the CHANGELOG entry.
- **Accumulation signature:** trips-owned far exceeding memberships + a fresh
  trip UUID per replay = the demo seed re-ran on every load because silent
  write-through failures kept the hydrated trip count at zero. The
  scoped-hydration + write-through fixes close the loop; if bloat reappears,
  look for a new path that re-seeds non-idempotently.


See [`docs/README.md`](docs/README.md) for the full doc index.

## 6. Documentation protocol

- **`ROADMAP.md` is the single plan of record** (milestone/release structure:
  stabilization + strategic tracks, and the `## Idea bank` — every unbuilt idea,
  tiered by readiness). New plans/phases merge into
  it — don't open competing plan files. Executed plans get archived to
  `docs/history/` with a `⚠️ HISTORICAL` banner and their status line flipped
  (a plan saying "in execution" while every milestone is ✅ cost a re-read to
  distrust, Sep 2026).
- **Update progress lines in the same edit as tracker ticks.** The UI-audit
  table read 32/32 ✅ while the "Progress" line said 16/32 for two releases —
  any counter derived from ticked rows must be recomputed in the commit that
  ticks them.
- **Deferrals must land in the ROADMAP's `## Idea bank` the same commit
  they're deferred** — Tier 1 if small and unblocked, Tier 2 if it names a
  dependency, Tier 3 as a track row if it's milestone-shaped.
  (ALIGNMENT/plan docs saying "deliberately deferred" is not enough — the item
  disappears otherwise.)
- **A roadmap/idea row is a claim about code, not a fact — verify it against
  `src/` before acting on it.** Consolidating rows (moving text between
  sections) preserves whatever is wrong with them. Sep 2026: the idea bank
  inherited a Sep-6 brainstorm table in which "Safe-to-spend per day" was
  still listed as unbuilt, though `engine.ts` had shipped it — and the README
  had described it correctly the whole time. The two files disagreed and the
  roadmap was the one that was wrong. Budget for a source check whenever you
  touch, quote, or pick up a row.
- **Keep-a-Changelog with a lead sentence.** CHANGELOG entries: first bold
  sentence = user-visible outcome; detail after; deep technical dives belong
  in `docs/` or the commit body, not a 300-word bullet. Categories stay
  Added/Changed/Fixed/Removed per release.
- **Version headings use a hyphen separator: `## [X.Y.Z] - YYYY-MM-DD`.** Not an
  em-dash. Keep a Changelog specifies `-`, and the em-dash variant had drifted
  into all nine headings before being normalised (Sep 2026). The one
  deliberate exception is `[0.7.0-native]`, whose trailing parenthetical is the
  author's own annotation for the native release (`a2fc4fa`) — leave it alone.
  A release banner states its scope **once**: if the entry has a `### Fixed`
  list, the banner summarises and does not restate every bullet (the `[0.42.0]`
  banner shipped stating its content three times and claiming a C5 that never
  existed — see `docs/history/README.md`).
- **README release highlights are newest-first, and its evergreen lines rot
  faster than any other doc's (learned 2026-09-24).** A release's "in plain
  words" section inserts at the TOP of the highlights block (under the pointer
  line) — v0.66's once sat between v0.60–61 and v0.55 while v0.62–v0.65 had no
  section at all, and the tail below ran in no discernible order. The evergreen
  claims rot just as fast: "six everyday modes" survived the move to eight, the
  AI-companion bullet outlived its production flag, and "❌ Payments — no
  gateway integration" outlived the Razorpay rail by four releases. When
  touching evergreen lines (mode counts, flag-gated features, the MVP
  constraint list, the structure block), re-derive them from the code — and
  remember README is in `tests/doc-drift.test.ts`'s LIVE list with zero
  registered claims, so new prose must avoid the gate's absence-cue phrasings.
  Screenshots in `docs/screenshots/` need the same freshness check after any
  visual pass — the v0.66 pass landed ten days after the last capture.
- **`docs/README.md` is the doc index** — every new doc gets a row there
  (Diátaxis flavor: tutorials / how-to / reference / explanation — tag the
  row with which it is). Root stays lean: README, AGENTS, CONTRIBUTING,
  CHANGELOG, ROADMAP, DESIGN_TOKENS; everything else lives in `docs/`.

- **iOS Safari never vibrates — only Capacitor native does.** `navigator.vibrate` is unsupported on all iOS browsers (WebKit). Haptics that must work on iPhone require `@capacitor/haptics` inside a Capacitor iOS shell (`Capacitor.isNativePlatform()`). Keep the web vibrate fallback for Android Chrome; never assume a pure-web PWA will taptic on iOS.

- **Every open issue carries exactly one `priority: P0`–`P3` label** (scheme added Sep 2026; the definitions live in the label descriptions, read them with `gh label list` rather than guessing). P0 = data loss/corruption, security, or a broken core flow — fix before shipping. P1 = real correctness or user-visible bug with a workaround — fix this milestone. P2 = low-risk, narrow surface — slot when convenient. P3 = hygiene, cosmetics, or blocked on a product decision. Assign one at creation; re-triage only by re-reading the definitions, never by gut severity. The label is a *routing* signal only — the justification belongs in the issue body. Queue via `gh issue list --state open --label 'priority: P0'`, and re-derive counts from `gh` rather than recalling them (same rule as §2.6).
- **A recovery path that reports success must verify the thing it recovered — and a surface that can fail must not render failure as emptiness.** Two payment-rail bugs from one live incident (Sep 2026): (1) checkout's self-heal toasted "already unlocked" without checking its `claim_paid_order` result — a failed grant would strand the buyer AND let the next click mint a fresh order for money already taken (double charge). Recovery branches must treat "I ran the write" as nothing; only the write's observable result counts, and a failed recovery is a 503 that says what will NOT happen ("no second payment will be taken"). Corollary: the orphan-order guard must read the buyer's NEWEST order of ANY status, not `status=eq.pending` — a row stranded 'paid' by a failed grant otherwise vanishes from the guard's view. (2) `fetchCreatorSales` degraded a failed read to `[]`, so the Earnings tab rendered "No sales yet" over a broken read — an empty-state UI and a broken-state UI must be different renderings (error + retry), or every future read failure hides behind friendly copy. The empty-vs-error distinction cost a whole debugging session to discover.
- **Diagnose a payment/money mismatch from the DATABASE first, not the code.** The ₹500-vs-empty-ledger incident resolved in one probe once the tables were read: the "missing" sale belonged to a DIFFERENT creator than the account being checked, and the stranded order was visible as `status=pending` + no entitlement row. `select * from purchase_orders; select * from entitlements;` answers "did the money land, did the grant land, whose ledger should show it" before any code reading. Multiple test accounts amplify this: buyer ≠ creator ≠ the account you're logged in as.

- **Postgres has no `create policy if not exists`, so a policy-creating migration is not re-runnable without a `drop policy if exists` guard — and a half-applied SQL-editor run is exactly the case that matters (learned 2026-09-21).** `20260921_user_dna.sql` created six policies bare, and its own PR described the file as "safe to re-run" before that was true: a second run, or the remainder of a run that failed midway, dies on the first policy it reaches and leaves a table half-secured. The pattern was already one migration over — `20260919_covers_bucket.sql` wraps every `create policy` in `drop policy if exists "x" on t` — so match the NEWEST policy migration rather than writing the statement from memory. `create table if not exists` and `alter table … enable row level security` are idempotent; the policies are the part that is not. Then verify the claim against the statements and write it after, not before: nothing in the gate can see it, because green tsc/vitest/build says nothing about SQL that has never run.
- **`create or replace function` cannot change a signature — and a DEFAULTED new parameter beside a surviving old overload makes every old call AMBIGUOUS (learned 2026-09-29, #230).** Adding `p_source text default null` to `bump_published_stats` while the `(text, text)` overload still existed would answer `function is not unique` for every cached client's two-argument call. The statement ORDER is load-bearing: `drop function if exists …(text, text);` BEFORE the `create or replace` of the three-argument form — pinned as an ORDER assertion (not a presence one) in tests/share-attribution.test.ts and tests/pub-funnel.test.ts, and mirrored in schema.sql (the second build path). Companion: when a later migration REDEFINES a function, every test pinning that function's body must read the LAST definition in the series, not the file that first created it — pub-funnel's byte-identical schema↔migration pin and its guard pins moved to the new file for exactly this reason (6k's name-order rule, applied to tests).
- **A migrate-time constraint change must match how the constraint was CREATED.** The rail migration's `unique (user_id, pub_id)` is a CONSTRAINT; `drop index if exists entitlements_user_pub_unique` on it fails live ("other objects depend on it") — dropping a constraint-backed index via `drop index` errors, it does not fall through to `if exists`. Check the creating migration's exact DDL form (constraint vs index, named vs auto-named) before writing the swap. Also: a partial unique index breaks `on conflict (user_id, pub_id)` inference (conflict_target must carry the predicate) — and the swap is usually unnecessary anyway, because NULLs are distinct in a full unique constraint, which is exactly what the nullable-column migration wanted.
- **Vitest 4's default include sweeps EVERY untracked tool worktree** — its glob is `**/*.{test,spec}.*` minus node_modules/.git, so a stale full repo copy inside `.cache/`, `.agents/` etc. (git-ignored, invisible to git status) ran months-old tests and failed the verify gate while the repo tree was green (2549 tests instead of ~1290 was the tell). Pin `test.include` to the repo's real test trees (`tests/**`, `scripts/**`) in vite.config.ts — structurally immune to ANY future debris dir, not just the one that bit.
- **A SQL RPC iterating JSONB must fail closed on every shape it doesn't expect.** The paywall RPC stubs locked days with `jsonb_array_length` loops; a corrupt row (days not an array, day.index missing, stops not an array) would either 500 the whole public page or — worse — skip stubbing and leak the content. Each iteration guards its type; unknown shape ⇒ treated as LOCKED (empty array), never skipped. Paywall code is adversarial-input code: fail closed, never fail open.
- **A policy's RESTRICTIVE flag is load-bearing — drop it and a "hide" becomes a widen.** PostgreSQL permissive policies OR-combine, so the trip-trash policy's bare `deleted_at is null` OR-clause on a *permissive* `trips read hide trashed` let EVERY authenticated user read EVERY live trip (Sep 14–18 2026, live) — the Sep-14 repair that caused it had dropped the policy's `as restrictive` flag. Catalog-level checks stayed green the whole time: the escape-hatch tokens (`owner_id`/`auth.uid()`/`is_editor`) all lived in the same qual, and token presence is not semantics. A restrictive policy is also evaluated against an UPDATE's added row, so it must carry an accepter for the new row (owner/editor/admin) — without one the tombstone UPDATE fails 42501 and "Delete" silently no-ops, which is why those clauses exist. The shape is pinned mechanically in `supabase/tests/rls_contract.test.sql` (a `deleted_at is null` branch may only sit on a RESTRICTIVE trips SELECT; hide-trashed must be RESTRICTIVE with a live-row branch *and* an added-row accepter). When touching RLS, assert the policy KIND (`pg_policies.permissive`) and run the opt-in harness — never read token presence as behavior.
- **A SQL function that ships in an unapplied migration is unexercised code — its first live call will find the type errors.** `get_public_trip` went live with a bare string literal passed to polymorphic `to_jsonb` (`42804: could not determine polymorphic type because input has type unknown` — a `::text` cast fixes it) and an early return that answered an empty set where the trip should come back, so every public itinerary page failed for anonymous visitors while tsc, vitest and the catalog contract suite stayed green — none of them execute SQL. Cast literals fed to polymorphic functions, exercise every new RPC through its real client path before calling a migration done (an anon curl is the cheapest test), and keep a paywall probe in the integration harness: a priced publication must come back with locked days stubbed, an unpriced one whole. (First live call of that RPC, Sep 18 2026.)
- **`revoke … from public` does not revoke from `anon` on Supabase — name the roles.** `get_creator_sales` was intended for signed-in callers but stayed callable by anonymous requests (which got an empty list), because Supabase's default privileges grant EXECUTE to `anon`/`authenticated` directly; only `revoke all … from public, anon` removes it (proved by the control: `revoke_refunded_entitlement`, revoked from `public, anon, authenticated`, answers 42501). When a definer function is meant for one role, revoke the others by name.
- **A popup inside a host that paints its own stacking context cannot be raised from the popup side — and the trap is invisible in a screenshot.** The Explore filter bar is `.glass-soft` (`backdrop-filter` creates a stacking context), so the `Select` menu opened inside it was bounded by the BAR's rung: the featured card and the grid cards below are positioned, so they painted over the menu's last two rows and clicks landed on the card. Reading the popup's own `z-index` said 5 — fine — while `document.elementFromPoint()` at each option's centre resolved to `.featured-body`; the hit test is the only honest oracle (the Create-Trip calendar's lesson, now with its mechanism). A screenshot cannot reveal it: the covered rows are simply painted over, so the menu merely looks shorter. Fix on the HOST (`.explore-filterbar { position: relative; z-index: var(--z-frost) }`) — raising the popup's rung changes nothing, it is scoped inside its ancestor's context.
- **The design-system baseline is keyed by `styles.css` LINE NUMBER, so any insertion above an entry silently invalidates it.** Twelve added lines failed `contrastLight` and `rawDurations` with "new violation(s)" and "no longer reproduce" at the same time — the same rules, remapped. Re-baseline deliberately (`UPDATE_DESIGN_SYSTEM_BASELINE=1 npx vitest run tests/design-system.test.ts`), then prove the diff is line numbers only (strip `styles.css:\d+` from both sides and compare the entry sets) before committing it: re-baselining to clear a ratchet failure is how a real new violation gets laundered.
- **Appending new CSS to the END of `styles.css` keeps the line-keyed design-system baseline valid — inserting above an existing rule does not (learned 2026-09-21).** The entry above is the reason: each finding is keyed by line number, so a rule added at the bottom moves nothing, while one added mid-file remaps every entry beneath it and reports unchanged violations as if they were new. Prefer appending under a new section comment (the file already groups by feature, so this matches its shape), and when a mid-file insertion is genuinely needed, run the re-baseline procedure above instead of reading the failure as noise. Verified the good direction: the funnel's eight new rules went in at the bottom and `tests/design-system.test.ts` passed 52/52 with no re-baseline.
- **Before drawing a funnel from counters, check that the counters count the same KIND of thing — and that no stage is forbidden from exceeding the one before it (learned 2026-09-21).** `published_itineraries.views` and `.copies` looked like two stages of one funnel and were not: a view is deduped to one per browser session and skips the creator's own visits (`registerPubView`), while a fork was a raw event count with neither exclusion — so any rate derived from the pair was a ratio of unlike things, and one of the two stages also counted the creator converting themself. Two further facts decide whether a funnel is drawable at all: a counter has **no time dimension**, so no window can be computed from it or recovered later (the events have to be recorded); and the stages can legitimately **invert** — forks outnumbered visits here, because Explore's card carries its own Fork CTA while a visit is counted once per session on the plan's own page. So **clamping a conversion at 100% to keep the funnel monotone hides a real product fact**: compute the rate straight and name the case in the UI. And **record only the stages that do not already exist as dated rows** — `entitlements` already dates every sale, so an "unlock" event would have been a second source of truth for the same money (the log added holds views and forks only, written by the same function that moves the counter so the two cannot drift).
- **`register_preview(…, replace: true)` stops the dev server that is currently registered — start the replacement first.** Swapping this thread's preview mid-session killed the 5173 Vite server (http 000, no listener). Start the new server on a free port, then call replace with the NEW pid. Companion: a preview page left holding a hidden, full-size `iframe` that never finishes loading reports "the page main thread is busy" for every later evaluate while the pane renders blank — re-register to recover; waiting does not.
- **A "nothing is broken" UI sweep is only worth its silence if the probe fires on known-bad input — and each rule must measure the right box.** Three traps cost a full re-run each during the whole-app crop/padding sweep (Sep 2026): (1) `Range.getClientRects()` returns LINE boxes, so a centred hint line flags a corner it never touches — measure the first and last WORD (set the range to those text offsets) instead; (2) `scrollWidth` is inflated by pseudo-elements and transformed decorations (`.trip-head-card::after` is a blob at `right:-60px`, `.btn`'s sheen, the trip ticket's SVG ellipse), so a hit must name its overflowing descendant before it is called a crop; (3) the corner test needs a corner-SQUARE precondition — a box that merely starts far from the corner is outside the disc but nowhere near the cut region — and must skip children that bleed to both side edges (a card-wide hit area, a cover), whose corners are the box's by design. With those fixed, 41 route×width measurements across the public and signed-in surfaces returned zero real crops and zero unpadded rows; the probe (in the scratch dir, never committed) was first proved to fire on three synthetic fixtures — one unpadded footer, one corner-cut control, one correctly padded control.
- **A source-scanning guard reads comments too -- in the file being guarded, not just in the test (learned 2026-09-26, second instance).** `tests/stage2-p1.test.ts` pins that `styles.css` contains exactly ONE narrow-band reset, so a NEW comment in that file that merely *names* the at-rule (`@media (max-width: 1278px)` in prose) made the count 2 and turned a correct fix red. The same trap had already bitten a `tabIndex={-1}` guard earlier in the same session. So when a guard counts or greps a literal, that literal is banned from prose in the guarded file as well: write the shape out (`max-width: 1278px`, "a -1 tabIndex`) instead of quoting it, and after any edit to a file that guards scan, re-run that guard rather than assuming comments are invisible.
- **`.NET String.Replace` replaces EVERY occurrence — a scripted "insert after this anchor" needs a uniqueness check, or it edits a component you never looked at (learned 2026-09-27).** Inserting a `useEffect` after the anchor `}, [isLoaded, map, data, sourceId]);` in `mapcn/map.tsx` matched **two** components (`MapGeoJSON` and `MapClusterLayer`) and silently wrote the effect into both; `tsc` then failed with "Cannot find name" in the component that had no such prop, ~700 lines from where the edit was intended. `String.Replace` and `-replace` have no "first only" mode — count the anchor first (`([regex]::Matches($src, [regex]::Escape($anchor))).Count` must be 1) and use `(regex).Replace($src, $new, 1)` when it genuinely appears more than once. Corollary for deletions: never delete a range you located by *scanning forward to the next matching line* — that scan is how a 61-line removal took the enclosing block's brace with it and left a file that no longer parsed.
- **PowerShell parses the WHOLE script before running any of it, so one typo discards the batch — and that is the safety property, not the problem (learned 2026-09-27).** Three separate parse failures in one session (`$iunclusteredVisible?:` read as a variable name — needs `${i}` before a `?:`; a stray `)` ; a backslash-escaped quote) each aborted before the first statement, which is why nothing was half-written. Build on that: make every scripted source edit **fail closed** — assert each anchor exists and is unique, `throw` before any write, and after writing verify by **counting the token you meant to insert**, then run a parser or typecheck (`npx tsc -b`) before the gate. For a file whose braces are load-bearing and whose components repeat each other, prefer the editor primitives over a script entirely: today's one range-deletion left a source file that did not parse, and the fast recovery was `git checkout -- <file>` and redo, not repair. A `[regex]::Matches($src, $rx.Pattern)` call is also wrong twice over — `.Pattern` is a string, so it counts something else entirely (it returned the file's byte length here).