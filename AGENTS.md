# AGENTS.md — YatraFlow

Operating manual for AI coding agents (Cline and friends) working in this repo.
Read it fully before starting work. Follow the rules. **Keep this file growing.**

## 0. The learning rule (this file must grow)

Any crucial learning made while working here — a pitfall that cost debugging
time, a project quirk, a convention the user cares about, a "local lied, CI was
right" moment — **must be recorded in this file in the same session it was
learned**, as a short actionable rule in the most relevant section below.
Before committing, ask: *"did this session teach something a fresh session
would need?"* If yes, add it here and include the update in the same commit.
Prune entries that stop being true.

## 1. What this project is

YatraFlow — collaborative India trip-planning app. React 18 + Vite 8 +
TypeScript, Supabase (auth + data), MapLibre GL maps, hash-based routing,
deployed on Vercel from `main`. No bookings/payments — planning only.

Key locations:
- `src/App.tsx` — app shell: hash routes, nav (hamburger ≤720px), theme, notifications
- `src/store/store.ts` — data layer (`useSyncExternalStore`) over Supabase
- `src/lib/engine.ts` — pure planning engine (schedule, budget, breaks, warnings)
- `src/lib/geocode.ts` — provider facade: Google-first (opt-in key), free-stack fallback
- `src/lib/providers/` — `google.ts`, `free.ts` (OSM/Wikipedia/Mappls), shared hits logic
- `src/lib/timefmt.ts` — 12h/24h clock preference + formatters (default 12h)
- `src/lib/uiPrefs.ts` — per-day collapse persistence (localStorage)
- `src/components/TripMap.tsx` — MapLibre map (lazy chunk); `src/components/mapcn/` wrapper
- `src/pages/TripWorkspace.tsx` — the big one: tabs (timeline, map, budget, share…)
- `tests/` — vitest in **node env (no DOM)** — test pure logic, not DOM
- CHANGELOG.md — Keep-a-Changelog-style; versions are pre-1.0 milestones

## 2. Workflow rules (non-negotiable, user-mandated)

1. **Never push to `main` without the user's explicit confirmation** — commit
   locally, then ask.
2. **Every push ships documentation**: CHANGELOG.md entry in the same commit
   (under `[Unreleased]`, or a versioned section for releases). Feature-worthy
   releases also bump `package.json` + lockfile version and update README.
3. Fixes and features get changelog entries with enough context to understand
   them six months later.
4. **Another agent may commit into this same working copy** — Hermes has
   dropped doc commits directly onto local `test` (an uncorrected duplicate
   of its own PR branch). Before trusting or pushing a local branch, run
   `git status -sb` and `git log origin/<branch>..<branch>`; reconcile
   foreign unpushed commits (reset/supersede **with user approval**) rather
   than shipping them.
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
7. **When asking the user to review/test locally, always hand them the exact
   URL — never make them find or start the server.** Check if the dev server
   is up (probe `http://localhost:5173`); if not, start `npm run dev`
   detached (`Start-Process npm.cmd -ArgumentList 'run','dev'`). Confirm it
   serves *this* working tree before linking (fetch
   `http://localhost:5173/src/styles.css` and grep for a token/marker that
   only exists in the current branch's changes — a stale server from another
   branch will otherwise silently show old UI). Then give deep links per
   screen (e.g. `http://localhost:5173/#/` for Landing,
   `http://localhost:5173/#/trips` for My Trips) and say what to check
   (themes, mobile width, specific interactions).


## 3. Verification before every push

Use `npm run verify` — it runs the full gate:
`tsc -b --clean` → fresh typecheck → full test suite → production build.

Hard rules (each learned the hard way — do not relearn them):
- **Bare commands only.** NEVER verify with `cmd /c "... & echo %ERRORLEVEL%"`.
  `cmd` expands `%ERRORLEVEL%` **at parse time, before the commands run**, so it
  echoes a stale exit code and masks real failures. This caused repeated
  "local passes / Vercel fails" drift (Aug 2026, twice).
- **PowerShell: a bare `echo;` (no argument) prompts for `InputObject` and hangs
  captured output** — always pass an argument (`echo '---'` / `Write-Host "…"`).
  The terminal looks stuck and shell-integration reports the command as still
  running (cost debugging time fetching `gh issue view` bodies, Aug 2026).
- **`tsc -b --clean` first** in any session before trusting a typecheck —
  incremental build caches pass code that clean builds reject.
- If Vercel's deploy fails, reproduce locally with `npm run build` (the exact
  Vercel command: `tsc -b && vite build`), not `tsc` alone.
- `npm warn allow-scripts` about esbuild is a **warning, not a failure**; it's
  allowlisted via `allowScripts` in package.json.
- **Never fetch with a wildcard refspec** (`git fetch origin
  '+refs/*:refs/remotes/origin/*'`) — it remaps `refs/heads/*` to
  `refs/remotes/origin/heads/*` and **deletes** `origin/main`, `origin/test`
  and PR-tracking refs, so `origin/main` becomes "not a valid object name".
  Use plain `git fetch origin [--prune]`; to grab a PR, use
  `gh pr checkout <n>` or `git fetch origin pull/<n>/head`.
- **Never run dependent git checks as parallel shell calls** — during the PR
  audit, a ref-rewriting fetch raced a `merge-base --is-ancestor` check and
  returned contradictory results. Sequence dependent git commands in one call,
  and confirm merges via `gh pr view <n> --json mergeCommit` +
  `git merge-base --is-ancestor <mergeCommit> origin/main` (exit 0 = merged),
  not by eyeballing short `git log` windows.
- **CSS breakage is invisible to `tsc` + tests — only the full `vite build`
  sees it** (issue #14): a dangling declaration + stray `}` passed the
  typecheck and all 128 tests while vite 5 logged it as a mere minify
  *warning* for an entire release; a vite upgrade turned that warning into a
  hard error. Treat ANY minify warning in build output as a latent build
  blocker and fix it in the same pass. Related: junk dependencies can sneak
  into package.json from accidental installs (the `"24": "^0.0.0"` of
  issue #19) — review dependency diffs before committing. Since the vite 8
  upgrade, `@vitejs/plugin-react` must be v6+ (native vite 8 peers);
  plugin-react 4.x triggers ERESOLVE — the temporary `.npmrc`
  `legacy-peer-deps` pin was removed once v6 landed (0.19.0).
- **Vercel env vars are per-environment *and per-git-branch*, and Vite bakes
  them at build time.** The real cause of the recurring "login breaks on
  preview" was **not** Production-only scoping: `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` *were* ticked for Preview, but pinned to
  `gitBranch: "test"` — so only previews built from branch `test` got a
  backend and every other branch compiled blind. The app renders normally,
  then login fails with a bare `Failed to fetch` that reads exactly like a
  wrong password. `vite.config.ts` now **aborts a Vercel build** when
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are missing or still the
  `YOUR-PROJECT` template; CI and local builds only warn, since they
  legitimately have no credentials. Editing a var never fixes an existing
  deployment — **Redeploy** it.
- **Trust `vercel env ls`, not the dashboard's checkboxes.** Its
  `environments (git branch)` column is the only place a branch pin shows up;
  the UI reads as "all enabled" (this misread cost a full wrong-diagnosis
  cycle). `vercel env add NAME preview --value … --type config --force`
  **adds** a branch-free record rather than editing the pinned one — both then
  coexist. Inspect/delete precisely via the API:
  `vercel api '/v10/projects/<prj>/env?teamId=<team>'` lists every record with
  its `id` + `gitBranch` (payload key is `.envs`, not `.env`),
  `vercel api '/v1/projects/<prj>/env/<id>?teamId=<team>'` returns the
  **decrypted** value (the only way to prove what is really stored), and
  duplicates go via the *batch* endpoint —
  `-X DELETE --field 'ids=["<id>","<id>"]'` on `/v1/projects/<prj>/env`
  (a per-id DELETE path 404s). Caveat: captured CLI output can swallow an id's
  **first character** into a preceding ANSI escape — print `.Length` (16) to
  catch it before a 404.
- **To reproduce a no-env build, move `.env.local` aside — blanking
  `$env:VITE_*` does nothing.** `vite build` reads `.env.local` regardless of
  the process environment, so a "stripped" build silently still had the real
  values and appeared to disprove the diagnosis. Check what a live deployment
  actually contains by fetching its `index-*.js` and grepping for `supabase.co`
  (recipe in `docs/DEPLOYMENT.md`) — with three traps, all of which produced
  wrong readings here:
  - **SSO walls more than previews.** The *deployment-specific* URL
    (`yatraflow-<8char>-<scope>.vercel.app`) is behind Vercel SSO **even when
    `vercel inspect` reports `target production`**, so an anonymous fetch
    returns Vercel's own Next.js login page (~340 KB, `X-Matched-Path: /login`)
    and the grep reports a misleading `False`. Grep the **canonical alias**
    (`yatraflow-blond.vercel.app`). Tell them apart by size: the real
    `index.html` is ~1.2 KB, the login page ~340 KB.
  - **The `localhost:54321` fallback is in *every* bundle.** `supabase.ts`
    compiles `import.meta.env.X || 'http://localhost:54321'`, so the placeholder
    string is present whether or not the env var was set — its presence proves
    nothing. Only the real `.supabase.co` host / project ref discriminates.
  - **`vercel ls` is newest-first** — `Select-Object -Last N` returns the
    *oldest* rows and can make a deploy that finished two minutes ago look
    entirely absent. Use `-First N`, or filter on `vercel\.app`.
  A green Vercel check is the proof for previews. Strongest proof for
  production: the alias's bundle hash equals a local `npm run build`'s, i.e.
  the artifact you tested is the artifact that shipped.
- **Supabase auth fails two different ways** — rejected credentials come back as
  `{ error }`, but a network failure *throws* `AuthRetryableFetchError`. Wrap
  both (see `store.login`/`signup`) and map through `lib/authErrors.ts`; an
  unwrapped throw leaves the sign-in form silently re-enabling after its 10 s
  failsafe timer with no message shown.
- **Each `run_commands` array entry is a separate shell process** — a `$var`
  assigned in one entry is empty in the next, so multi-step probes silently
  return nothing and look like failures. Put a dependent pipeline in a single
  command string, with `try/finally` whenever it touches real files.

## 4. Code conventions & pitfalls

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
- **Overlay z-index ladder** — toast 200 > modal 100 > impact sheet 90 >
  notif 80 > expanded map shell 70. Any full-page overlay (e.g. the map's
  `⤢ Expand` mode, `.map-shell--expanded`) must sit BELOW the dialogs it can
  spawn, so modals/impact sheets opened from it still layer on top — no
  collapse-on-open coordination needed. Corollary: container-size changes need
  no manual `map.resize()` — mapcn's wrapper already runs a ResizeObserver
  that re-fits the canvas (map.tsx).
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
- Test style: pure logic only, node env; mock `fetch` with route tables
  (`tests/providers.test.ts` has the pattern); `vi.stubEnv` for API keys.
- **View Transitions + theme radiate (Sep 2026): VT is usable on glass-heavy pages ONLY with `backdrop-filter` suppressed during the transition** — Chromium renders glass inside VT snapshots without its backdrop, so any glass layer (`--yf-glass: rgba(255,255,255,.58)`) turns the captured page into a flat gray veil (page-dependent: "perfect" on Landing, broken on #/trips). Shipped pattern in `toggleTheme` (App.tsx): set `--vt-x/--vt-y/--vt-r` on `<html>`, add a direction class (`vt-radiate-out` = dark→light, new view expands; `vt-radiate-in` = light→dark, old view collapses — and it needs old z-index 2 / new 1, since UA stacks new on top) plus `vt-active` (`html.vt-active :where(*) { backdrop-filter: none !important }`) BEFORE `startViewTransition`; the clip-path animation lives in CSS keyframes with `fill: both` (first-frame-correct, end-state held), classes removed on `vt.finished`. A DOM-overlay radiate was tried and rejected (flat color, not the real UI). Don't re-learn these the hard way.
- **`env(safe-area-inset-*)` is inert without `viewport-fit=cover`** — `.impact-sheet` shipped an `env(safe-area-inset-bottom)` padding that silently did nothing because `index.html`'s viewport meta lacked `viewport-fit=cover` (found while fixing UI-audit F-26, Sep 2026). Activating `cover` turns EVERY inset on at once, so audit all fixed/sticky layers (topnav, toast zone, fabs, drawers, `top:`/`scroll-padding` offsets derived from `--nav-h`) in the same change — adding them one at a time leaves half the UI under the home indicator.
- **Section-restructure edits can silently swallow bullets** — an edit whose
  `old_text` spans `<heading>` + its bullets + the next `<heading>`, replaced
  by just the next heading, **deletes the bullets**, not only the heading.
  After any heading-level restructure (CHANGELOG releases especially),
  re-grep all headings and re-read the affected range before trusting it.
  (The 0.18.0 restructure briefly lost four Fixed bullets this way.)
- **Supabase failures come back as `{ error }`, not rejections — a `void supabase…write()` with no `.then(({ error }))` is a silent data-loss hole.** `publishItinerary` fire-and-forget its upsert while the optimistic in-memory write made the UI look successful; the next refresh hydrated the (empty) table and the data "vanished" (Sep 2026). Rule: every write-through checks its error and either toasts or rolls back the optimistic cache (see `updateProfile`, `publishItinerary`); every hydration table result is error-logged, because a failed `select` also returns `{ data: null, error }` rather than throwing — a denied/missing table silently hydrates as `[]`.
- **When diagnosing "works in the session, gone after refresh"**, probe the live table with the anon key via PostgREST (`GET /rest/v1/<table>?select=…` — RLS SELECT policies decide what's readable; `published_itineraries` is public) before touching code: it immediately separates "never persisted" from "persisted but not rendered". Column-existence probes work on empty tables (`select=<cols>&limit=1` errors naming a missing column); the OpenAPI root (`/rest/v1/`) needs the service-role key, so it's useless with the anon key. To test an *authenticated* write, sign up a throwaway QA account via `POST /auth/v1/signup` (email confirmation off → session token in the response) and replay the insert — but record the generated email immediately (it's randomized and unrecoverable from auth without the service key; the profiles table's public read policy can restore it).
- **`git diff --check` before committing any merge** — conflict markers in
  *non-code* files (CHANGELOG.md) are invisible to the whole verify gate
  (`tsc` + tests + `vite build` all passed with a leftover `<<<<<<< HEAD` in
  the CHANGELOG during the PR #30 merge, Aug 2026). `git diff --check` exits
  non-zero on leftover markers; run it before `git commit` on every merge.
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
- **An effect that depends on asynchronously-hydrated store data must list those values in its dep array.** `InviteGate` used a mount-only `[]` effect, which fired before `init()` resolved — `me`/`trip` were both null, so the invite never auto-joined and the user sat on the spinner. `react-hooks/exhaustive-deps` (now wired via `npm run lint`) flags exactly this; don't suppress it with `eslint-disable` when the fix is to depend on the resolved object.
- **The halt planner's plan + resolved spots must be written together** (`setHaltCache(day, segments, plan)`), because hydration rebuilds the editable plan from `cache.plan` and the pinnable real spots from `cache.segments[i]`. And the corridor search behind "🔎 Find real spots" runs **only on that button** — never on plan edits — per the §4 persistence rule; a `[day, sugCache]` hydrate effect that clobbers an in-progress edit is guarded with an "only rehydrate while the plan is empty" check.
- **`kmFromStartForHit` takes `Pick<PlaceHit, 'latitude' | 'longitude' | 'alongRouteKm'>`** — an ItineraryStop's `lat`/`lng` must be remapped (`{ latitude: s.lat, longitude: s.lng }`), it will not type-accept the stop directly. Same asymmetry to watch on any `PlaceHit`-shaped helper.

- **The impact dialog's time delta must include dwell, not just driving.** `computeImpact` summed `totalTravelMinutes` (wheel time only), so adding a 20-minute halt showed a ~0 time extension and the preview looked broken. `DaySchedule` now exposes `dwellMinutes` (visit minutes + per-stop buffers) and the delta sums both — relabelled "Time on the road (driving + stops)" so the semantics are visible. Note `computeTotals.totalTravelMinutes` is still driving-only for budget/warning math; don't "fix" one and silently change the other.
- **Planned halts are on-route by default; real spots are opt-in.** The halt planner's `pin` flag must default to `false` — the planner auto-attaches the best place found near a km point, and a `true` default silently redirected every halt to that place. The row shows an explicit "detour to <place> instead of the route point" checkbox.
- **Coerce persisted numeric fields before math, never trust them as numbers.** Rows hydrated from Supabase (or hand-edited JSON) can carry `undefined`/`null` for numeric columns — a stop's `visitMinutes` arriving as `undefined` once made `undefined + bufferMinutesPerStop = NaN` poison the whole day's dwell and the impact dialog rendered `NaNh NaNm`. `simulateDay` coerces `visitMinutes` to a finite number (0 fallback) before use, and `minutesToHM` renders `—` for non-finite input as a last-resort display guard. When adding new numeric trip/stop math, apply the same finite-check at the point of use.

## 5. External services

Supabase (auth/data) · Vercel (auto-deploy from `main`) · Google Places
(opt-in key, quota-guarded, always falls back to the free stack) · OSRM ·
Open-Meteo · Mappls · **OpenFreeMap** (basemap tiles — keyless, no request
limits, commercial-OK; its TileJSON carries the required attribution, see §4). Live probe for
Google: `scripts/verify-google-places.mjs`.
When touching provider code, keep the facade contract: Google failure or
absent key must silently fall back to the free stack.

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
