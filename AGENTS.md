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
- `src/lib/geocode.ts` — provider facade: Google-only suggestions when a key is configured, free stack as the keyless mode (see §5 directive)
- `src/lib/providers/` — `google.ts`, `free.ts` (OSM/Wikipedia/Mappls), shared hits logic
- `src/lib/timefmt.ts` — 12h/24h clock preference + formatters (default 12h)
- `src/lib/uiPrefs.ts` — per-day collapse persistence (localStorage)
- `src/components/TripMap.tsx` — MapLibre map (lazy chunk); `src/components/mapcn/` wrapper
- `src/pages/TripWorkspace.tsx` — the big one: tabs (timeline, map, budget, share…)
- `tests/` — vitest in **node env (no DOM)** — test pure logic, not DOM
- CHANGELOG.md — Keep-a-Changelog-style; versions are pre-1.0 milestones

## 1.1 Current project status (as of Sep 9, 2026)

**Version:** v0.46.0 on `redesign/masteradmin-v045` (feature branch; not yet on `test`/`main`).

**State:** Stabilization complete, UI audit all 32 findings fixed. The Corridor Concierge suggestion-engine brainstorm is FULLY shipped (Horizons 1–3, 16/16 incl. asymmetry, hours scoring, fuel corridors, trip DNA) — see ROADMAP's 🧭 table. v0.46.0 adds the **masteradmin console** (`#/admin`): a JWT-`app_metadata`-gated god-view over every user, trip, invite, publication and audit row, with audited destructive RPCs (disable/re-enable accounts, creator badge, visibility flips, member removal, unpublish, type-to-confirm trip delete) and an append-only `admin_audit` log — see the migration's grant one-liners to mint the two admin JWTs. v0.44.0 added the budget pacing tile and restored public itinerary pages + invite links for non-members. Branch model simplified: only `main` (production, Vercel) and `test` (integration) exist. `npm run verify` gate: tsc clean + 504 tests + production build.

**Recent major releases:**
- **v0.44.0** — Budget pacing tile ("Safe to spend / day", via new pure `daysRemaining` / `safeToSpendPerDay` helpers), per-day cost + dwell chips on timeline day headers, stale-chunk auto-reload so already-open tabs survive a deploy, and `fetchSharedTrip` + the `get_invite_trip` RPC restoring public itinerary pages and invite links for non-members

- **v0.43.0** — Suggestion-engine fixes: sights in the corridor scan (See & do fed), panel↔map cross-highlighting, route-ordered additions (A→B→C), engine-tips roll-out, realtime style/mode re-tune, AI companion locked for premium; plus the encoding-corruption repair of the bad calendar-export merge (styles.css/ShareTab.tsx restored, tabbed Share page re-applied) and the AI drawer close-fix + CTI redesign
- **v0.42.0** — C1–C5 Hy4 audit P0 fixes: 'Add all' batch write-through, routeHash cache invalidation, degenerate-route guard, detour budget from actual stops
- **v0.41.0** — Corridor Concierge: H3 suggestion engine (road personality, enforced detour budget, trip DNA, crew seeds, story arcs, slack prompts), asymmetric detours + hours scoring + fuel advisories, Google-only provider directive, store + AI-drawer sweep (issues 15/15 closed)
- **v0.40.1** — Sliding glider on all pill navigation, accessibility fixes (ARIA roles, focus rings, contrast), dead code removal
- **v0.40.0** — Hard-surface pass: full UI audit (32 findings), lucide icon consistency, numeric typography (tabular digits), a11y structure, one grammar across the workspace
- **v0.38.0** — Creator hub: Overview + Earnings tabs (payouts ledger), projection view, M7 contract documentation
- **v0.37.0** — Creator bios + newest sorting, select dropdown theming
- **v0.36.0** — Impact Preview improvements (time delta includes dwell), expense categories with `--cat-*` tokens, per-vote decision pings
- **v0.35.0** — Publish editor (preview/price/CTA), fork premium gate, creator mode, sourcemaps
- **v0.31.0** — M0–M7 Calm Travel Intelligence redesign shipped (user-driven halt planner, 3-layer tokens, OpenFreeMap basemap, touch drag-and-drop)

**Current branch:** `test` (synced with `origin/test`)

**In-flight:**
- v0.44.0 shipped to `main` (Sep 8, 2026) — nothing pending merge
- No open PRs or feature branches; only `main` + `test` exist, and the `shabtab` fork remote is removed (re-add with `git remote add shabtab https://github.com/Shabtab/Yatraflow.git` to check contrib progress)

**What's next (ROADMAP.md):**
- M8: Creator monetization (payouts ledger + fee model)
- M9: Creator analytics (funnels, statements, revenue attribution)
- M10: Budget improvements (envelopes, alerts, recurring templates)
- Strategic track: Together (real-time sync, social features), Premium (payments, bookings), 1.0 (stabilization, polish)

**Key conventions:**
- `npm run verify` gate before every push
- Releases on `redesign/calm-travel-intelligence`, then PR to `test`, `main` only with explicit user confirmation (AGENTS §1)
- Every push ships CHANGELOG.md entry + version bump
- `tsc -b --clean` first in verify to catch incremental cache issues

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
 6a. **Async operations need input guards.** The AI drawer's `ask()` function had no protection against rapid re-submission during its 650ms processing delay — users could trigger duplicate questions. Fix: `disabled={thinking}` on input and button. When adding async paths (API calls, simulated latency, data processing), always disable user inputs to prevent race conditions, duplicate requests, or state inconsistency. The guard should match the visual feedback state (spinner, disabled button, etc.).
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
8. **Build locally first; confirm the target branch before every push.** A feature
   or fix is always implemented and verified (`npm run verify`) on the current
   local branch before any push is even discussed. When the work is ready, tell
   the user which branch you propose to push to and wait for explicit
   confirmation — never push to `main`, `test`, or any other branch as part of
   the implementation step. This prevents unauthorized code from reaching a
   shared branch and keeps the user in control of what ships.


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
- **Overlay z-index ladder** — use the `--z-*` token rungs in `styles.css` (`:root`, M4):
  impact sheet 210 > toast 200 > modal 100 > ai-drawer 90 > notif 80 > expanded map
  shell 70 / ai-fab 70 (tie — DOM order decides) > nav glass 60 > mobile dock 55.
  Any full-page overlay (e.g. the map's `⤢ Expand` mode, `.map-shell--expanded`) must sit BELOW the dialogs it can spawn, so modals/impact sheets opened from it still layer on top — no
  collapse-on-open coordination needed. The impact sheet is DELIBERATELY above toasts
  (210 > 200): a transient toast must never cover the Keep/Remove controls. Corollary: container-size changes need
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
- **A full-page View-Transition FREEZES every CSS animation for its duration — skip it on animation-heavy pages.** The landing route runs continuous motion (atmosphere blobs, route draw, ticker, odometer); toggling theme there made the whole scenery visibly pause ~700 ms while the DOM snapshot played, and on mobile the eruption point read as off-target. Fix (Sep 2026): `toggleTheme` early-returns to an **instant swap on `route === '/'`** (radiate kept for calmer in-app pages). When adding any VT elsewhere, gate it off routes dominated by looping animation or the "pause" reads as a frozen tab.

- **Diagnostic logging should be guard-claused.** Haptics logging (`haptics.ts`) showed `[HAPTIC]` entries even on iOS where `navigator.vibrate` doesn't exist — misleading noise. Guard `import.meta.env.DEV` logging behind `typeof navigator !== 'undefined'` so logs only appear when the API actually exists. Corollary: test environments that mock `window`/`navigator` must include `vibrate` (even as a no-op) to avoid console spam.

- **AI assistant input must disable while thinking.** `AiDrawer.tsx` had the input enabled during `thinking` state, allowing duplicate questions while the bot was already processing — the simulated 650ms latency made this easy to trigger. The fix: `disabled={thinking}` on the input and submit button. When adding async operations that take >200ms, always disable user inputs to prevent race conditions or duplicate requests.

- **Drawer animations need a class-based toggle.** `AiDrawer.tsx` originally animated via inline style transitions; switching to a `.open` class on the container (`<div className={`ai-drawer ${open ? 'open' : ''}`}>) fixed the animation state reset on re-render. Rule: always use CSS classes for enter/exit animations, never inline styles — React re-renders can reset inline styles mid-animation. The `.ai-drawer:not(.open) { display: none }` pattern is also cleaner than `style={{ display: open ? 'flex' : 'none' }}`.

- **FAB should hide while assistant is open.** `AiDrawer.tsx` kept the `ai-fab` visible behind the drawer, cluttering the UI. Fix: `{!open && !thinking && <button className="ai-fab" ... />}` — only show when drawer is closed AND not processing. Rule: when a panel overlays a floating action button, hide the FAB while the panel is open OR while the panel is in an intermediate state (thinking, loading, saving).

- **Every trip-data mutation must write through BEFORE committing.** The store fixes (Sep 2026) revealed three bugs:
  1. `setStopStatus` performed redundant lookups before committing, risking stale data.
  2. `moveStopBetweenDays` committed twice — once in `updateStop`, once explicitly — which bypassed the single-patch guarantee.
  3. `updateTrip` committed before persisting, so UI showed success but DB failed silently.
  
  Rule: call `persistTripField(tripId, mutator)` first, await its Promise, THEN `commit()`. The `persistTripField` now returns `Promise<void>` to enforce this order. If your mutation path doesn't call `persistTripField`, it will update the cache but vanish on refresh — the full verify gate (`tsc` + tests + `vite build`) stays green because nothing exercises write-through.

- **A directive that reverses behavior must sweep its own strings in the same commit.** When the Google-only directive landed, `QuotaExhaustedError` still said *"falling back to the free stack"* and the quota-guard header still described the old fallback — the code had changed, its self-description lied. When reversing any behavior, grep for the OLD behavior's phrasing in error messages, comments, README, and ARCHITECTURE (this bit us once per surface: message, quota.ts header, geocode docstring).

- **A derived input that algebraically cancels is a constant in disguise.** Road personality's "per-window speed" was `windowKm / (driveMinutes × windowKm / totalKm / 60)` — the `windowKm` cancels, leaving the day's average painted on every window, and the tests then codified the wrong semantics. When a derived value cancels to something coarser than its name implies, stop and either compute the real signal (per-leg durations from OSRM) or move the verdict to the level it actually measures (day-average → explicit day-level check, as now done for the city-crawl kind).

- **A11y contrast claims get computed, not eyeballed.** Issue #64 claimed sub-AA tab contrast; the WCAG luminance math showed 7.53:1 dark / 4.86:1 light — not reproducible. Before accepting or "fixing" a contrast report, run the numbers on the actual token pair and surface (the issue's premise named the wrong variable). Close such issues WITH the measurement.

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
- **Scoping a query invalidates every cache-shape assumption downstream of it.** When hydration was scoped to the user's memberships, `tripById` — consumed by the public itinerary page and the invite gate — silently started returning undefined for every non-member (and every anonymous visitor): "Itinerary not found" on Explore cards, "This invite link is broken" on invites. Before changing what a fetch returns, grep for consumers that derive invariants from that data; flows that legitimately need OTHER people's rows (public pages, invites) get an on-demand fetch (`fetchSharedTrip`) plus an RLS/RPC path, never a cache-shape accident.
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
  before continuing (M3.3, Sep 2026).

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


## 5. External services

Supabase (auth/data) · Vercel (auto-deploy from `main`) · Google Places
(opt-in key, quota-guarded) · OSRM ·
Open-Meteo · Mappls · **OpenFreeMap** (basemap tiles — keyless, no request
limits, commercial-OK; its TileJSON carries the required attribution, see §4). Live probe for
Google: `scripts/verify-google-places.mjs`.
**Provider directive (Sep 2026, PR #73): with a Google key configured, the
suggestion pipeline is Google-ONLY** — POIs and city anchors both come from
Google; Google failure, quota exhaustion or empty scans render an honest "no
match"/quota note, they do NOT silently fall back. The free stack
(Overpass/Wikipedia/Mappls) serves ONLY keyless mode. Round-trip routes
(origin ≈ destination) get a Google point-search supplement instead of the
along-route scan. Geocoding (search box) still degrades Google → free; don't
reintroduce a silent fallback into the suggestion path, and update surfaces
that claim it still exists (this section, README, ARCHITECTURE).

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

## 6. Documentation protocol

- **`ROADMAP.md` is the single plan of record** (milestone/release structure:
  stabilization + strategic tracks, backlog pool). New plans/phases merge into
  it — don't open competing plan files. Executed plans get archived to
  `docs/history/` with a `⚠️ HISTORICAL` banner and their status line flipped
  (a plan saying "in execution" while every milestone is ✅ cost a re-read to
  distrust, Sep 2026).
- **Update progress lines in the same edit as tracker ticks.** The UI-audit
  table read 32/32 ✅ while the "Progress" line said 16/32 for two releases —
  any counter derived from ticked rows must be recomputed in the commit that
  ticks them.
- **Deferrals must land in the roadmap pool the same commit they're deferred**
  (ALIGNMENT/plan docs saying "deliberately deferred" is not enough — the item
  disappears otherwise).
- **Keep-a-Changelog with a lead sentence.** CHANGELOG entries: first bold
  sentence = user-visible outcome; detail after; deep technical dives belong
  in `docs/` or the commit body, not a 300-word bullet. Categories stay
  Added/Changed/Fixed/Removed per release.
- **`docs/README.md` is the doc index** — every new doc gets a row there
  (Diátaxis flavor: tutorials / how-to / reference / explanation — tag the
  row with which it is). Root stays lean: README, AGENTS, CONTRIBUTING,
  CHANGELOG, ROADMAP, DESIGN_TOKENS; everything else lives in `docs/`.

- **iOS Safari never vibrates — only Capacitor native does.** `navigator.vibrate` is unsupported on all iOS browsers (WebKit). Haptics that must work on iPhone require `@capacitor/haptics` inside a Capacitor iOS shell (`Capacitor.isNativePlatform()`). Keep the web vibrate fallback for Android Chrome; never assume a pure-web PWA will taptic on iOS.

- **Every open issue carries exactly one `priority: P0`–`P3` label** (scheme added Sep 2026; the definitions live in the label descriptions, read them with `gh label list` rather than guessing). P0 = data loss/corruption, security, or a broken core flow — fix before shipping. P1 = real correctness or user-visible bug with a workaround — fix this milestone. P2 = low-risk, narrow surface — slot when convenient. P3 = hygiene, cosmetics, or blocked on a product decision. Assign one at creation; re-triage only by re-reading the definitions, never by gut severity. The label is a *routing* signal only — the justification belongs in the issue body. Queue via `gh issue list --state open --label 'priority: P0'`, and re-derive counts from `gh` rather than recalling them (same rule as §2.6).

