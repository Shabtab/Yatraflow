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

- **"Optimise day" — the anti-crisscross reorder** (Timeline, per-day header). Days with 3+ movable stops whose current order wastes travel show an `Optimise (−X km)` button: it opens a before/after preview (travel distance, estimated driving time at the trip's average speed, and the full new stop order) and commits through the same impact-preview gate as a manual drag. Under the hood, a new pure `optimizeDayOrder` engine helper runs greedy nearest-neighbour from the day's wake-up origin (where the previous day's journey ended — `originOf`, not a naive first-stop guess) followed by a full 2-opt improvement sweep, with an open-time tie-break so two near-equal candidates pick the earlier-opening door. Auto anchors (your base and the day's destination/continuation waypoints) stay pinned first/last — the engine builds the journey around them; a mid-day auto anchor (an unusual shape) refuses to optimize rather than risk dropping it, and rejected stops ride along untouched. 8 node tests pin the behaviours (crisscross collapse, unchanged days, anchor pinning + mid-anchor refusal, no-op <3 stops, rejected survival, never-worse guarantee, open-time tie-break). The per-leg travel chips between stops (km, minutes, cost — OSRM-corrected) and the mapped route this builds on already existed. Delta figures use the canonical font-weight ramp (650/750 are not loaded faces — caught by the design-system invariant after the base adopted it).

- **"Open in Google Maps" — a day's ride opens with turn-by-turn directions.** The travel panel (Timeline) and the map's day toolbar gain a Directions action that hands the ride to your own Google Maps — origin, your stops in order, destination, `travelmode=driving` (the URL API has no two-wheeler mode; switch once inside the app if you ride with it on). The URL is built from the engine's day journey, so synthesized legs are included: the Day-1 outbound from an anchor-only day and the final day's ride home both open complete. Waypoints are capped at Google's 9-waypoint limit with the true destination always preserved. New pure `googleMapsDirectionsUrl` in `lib/externalMaps.ts`, 5 node tests.

### Fixed

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

[Unreleased]: https://github.com/hasnaina955/Yatraflow/compare/v0.48.0...HEAD
[0.7.0-native]: https://github.com/hasnaina955/Yatraflow/releases/tag/v0.7.0-native
[0.48.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.47.0...v0.48.0
[0.47.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.46.0...v0.47.0
[0.46.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.45.0...v0.46.0
[0.45.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.44.0...v0.45.0
[0.44.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.43.0...v0.44.0
[0.43.0]: https://github.com/hasnaina955/Yatraflow/compare/v0.42.0...v0.43.0
[0.42.0]: https://github.com/hasnaina955/Yatraflow/releases
