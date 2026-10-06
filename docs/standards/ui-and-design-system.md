## UI & design system

CSS cascade, contrast, motion, a11y, chunking. Extracted from
`CODING_STANDARDS.md` §2 on 2026-10-05; entries are verbatim. The root
file's index says when to read here; pitfall rules `6a`–`6ag` stay there.

- Browser-native `<input type="time">` follows the OS format **by design** and
  cannot be forced to 12h — don't replace it. The convention: keep the native
  input and echo the app preference as a live `.time-preview` ("= 6:30 PM")
  under it (see StopEditor / timefmt).

- **Mobile**: breakpoint is **720px**; mobile CSS lives in the single
  `@media (max-width: 720px)` block at the end of `src/styles.css`; keep touch
  targets ≥40px; inputs 16px on mobile (iOS Safari zooms smaller ones).

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

- **HTML5 drag-and-drop does not work on touch devices** (no `dragstart`).
  The convention: keep HTML5 DnD for desktop, and route touch through the
  long-press pointer engine in `lib/touchDnd.ts` (integrated via `useReorder`).
  Any new drag surface must add both paths or explicitly opt out.

- **View prefs pattern**: per-object UI preferences (day collapse
  `yatraflow_day_collapsed`, hidden ride hints `yatraflow_ride_hints_hidden`,
  clock format `yatraflow_time_format`) live in localStorage via
  `lib/uiPrefs.ts`/`lib/timefmt.ts` — failure-tolerant maps of booleans keyed
  `"<tripId>:<dayIndex>"`, never trip data.

- **`tests/design-system.test.ts` pins every declared `font-weight:` to a face the font link actually loads — the canonical ramp is 400/500/600/700/800 only.** The consistency pass ships Inter/Sora as static faces, so a variable-font interpolation weight (650/750 appeared in the Optimize-day preview) fails verify with `declared but not loaded`. When styling new UI, reach for the canonical weights; rebase replays of older branches are where off-ramp weights sneak back in (Sep 2026).

- **View Transitions + theme radiate (Sep 2026): VT is usable on glass-heavy pages ONLY with `backdrop-filter` suppressed during the transition** — Chromium renders glass inside VT snapshots without its backdrop, so any glass layer (`--yf-glass: rgba(255,255,255,.58)`) turns the captured page into a flat gray veil (page-dependent: "perfect" on Landing, broken on #/trips). Shipped pattern in `toggleTheme` (App.tsx): set `--vt-x/--vt-y/--vt-r` on `<html>`, add a direction class (`vt-radiate-out` = dark→light, new view expands; `vt-radiate-in` = light→dark, old view collapses — and it needs old z-index 2 / new 1, since UA stacks new on top) plus `vt-active` (`html.vt-active :where(*) { backdrop-filter: none !important }`) BEFORE `startViewTransition`; the clip-path animation lives in CSS keyframes with `fill: both` (first-frame-correct, end-state held), classes removed on `vt.finished`. A DOM-overlay radiate was tried and rejected (flat color, not the real UI). Don't re-learn these the hard way.

- **A full-page View-Transition FREEZES every CSS animation for its duration — skip it on animation-heavy pages.** The landing route runs continuous motion (atmosphere blobs, route draw, ticker, odometer); toggling theme there made the whole scenery visibly pause ~700 ms while the DOM snapshot played, and on mobile the eruption point read as off-target. Fix (Sep 2026): `toggleTheme` early-returns to an **instant swap on `route === '/'`** (radiate kept for calmer in-app pages). When adding any VT elsewhere, gate it off routes dominated by looping animation or the "pause" reads as a frozen tab.

- **AI assistant input must disable while thinking.** `AiDrawer.tsx` had the input enabled during `thinking` state, allowing duplicate questions while the bot was already processing — the simulated 650ms latency made this easy to trigger. The fix: `disabled={thinking}` on the input and submit button. When adding async operations that take >200ms, always disable user inputs to prevent race conditions or duplicate requests.

- **Drawer animations need a class-based toggle.** `AiDrawer.tsx` originally animated via inline style transitions; switching to a `.open` class on the container (`<div className={`ai-drawer ${open ? 'open' : ''}`}>) fixed the animation state reset on re-render. Rule: always use CSS classes for enter/exit animations, never inline styles — React re-renders can reset inline styles mid-animation. The `.ai-drawer:not(.open) { display: none }` pattern is also cleaner than `style={{ display: open ? 'flex' : 'none' }}`.

- **FAB should hide while assistant is open.** `AiDrawer.tsx` kept the `ai-fab` visible behind the drawer, cluttering the UI. Fix: `{!open && !thinking && <button className="ai-fab" ... />}` — only show when drawer is closed AND not processing. Rule: when a panel overlays a floating action button, hide the FAB while the panel is open OR while the panel is in an intermediate state (thinking, loading, saving).

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

- **A11y contrast claims get computed, not eyeballed.** Issue #64 claimed sub-AA tab contrast; the WCAG luminance math showed 7.53:1 dark / 4.86:1 light — not reproducible. Before accepting or "fixing" a contrast report, run the numbers on the actual token pair and surface (the issue's premise named the wrong variable). Close such issues WITH the measurement. **A per-theme colour is a second trap on the same finding**: `[data-theme='dark']` RE-DECLARES the whole primitive ramp (styles.css:240-260), so `--warn-600` goes `#B47207` → `#D99A2B` and `--gray-900` inverts to `#ECF1F8`. Every status token here is an indirection (`--warn: var(--warn-600)`), so a dark ratio computed off the `:root` value is measuring the LIGHT ink and reports a confident phantom — resolve the chain to what the active theme supplies, and treat "the light value fails in dark" as the tell that you read the wrong block.

- **A dark-theme ratio computed off the `:root` value is a phantom finding — the theme block RE-DECLARES every status primitive (learned 2026-10-02).** `[data-theme='dark']` redefines the whole primitive ramp (styles.css:240-260): `--warn-600` goes `#B47207` → `#D99A2B`, `--danger-500` → `#E06C6C`, `--gray-900` even inverts to `#ECF1F8`. So a semantic token read from `:root` is the LIGHT ink, and measuring it against the dark surface yields a confident, wrong defect: `.poi-rchip--warn` "measured" 3.56:1 in dark and was queued for a fix, while the real pair is `#D99A2B` on `#36290F` at **5.82:1** and already passed. Every contrast token here is an indirection (`--warn: var(--warn-600)`), so resolve the chain to the value the ACTIVE theme supplies before reporting, and treat "the light value fails in dark" as the tell that you read the wrong block. Same discipline as the ratchet note above: a finding that names only a `:root` colour has not been checked against the theme that renders it.

- **`overflow-x: clip` silently clips BOTH axes — the pair rule.** Setting `overflow-x: clip; overflow-y: visible` makes `overflow-y` compute to `clip`, so absolutely-positioned blobs that bleed past an element's top/bottom (`top:-90px`/`bottom:-70px` atmosphere blurs) get hard-sliced into visible "seam" lines at the container edges, and right-side bleed (`right:-150px`) shows as a crop bar. To clip horizontal blowout you can't rely on section-level `overflow-x: clip`. Prefer `html { overflow-x: clip }` (a true clip that isn't a scroll container, so `position: sticky` nav keeps working) and leave the section overflow-free so soft blurs can bleed across section bounds onto a shared fixed canvas.

- **`env(safe-area-inset-*)` is inert without `viewport-fit=cover`** — `.impact-sheet` shipped an `env(safe-area-inset-bottom)` padding that silently did nothing because `index.html`'s viewport meta lacked `viewport-fit=cover` (found while fixing UI-audit F-26, Sep 2026). Activating `cover` turns EVERY inset on at once, so audit all fixed/sticky layers (topnav, toast zone, fabs, drawers, `top:`/`scroll-padding` offsets derived from `--nav-h`) in the same change — adding them one at a time leaves half the UI under the home indicator.

- **In-page anchors on hash-routed pages must be `button` + `scrollIntoView`,
  never `href="#id"`** — the router owns `location.hash`, so a plain anchor link
  rewrites the hash to `#plan-bench` and the router treats it as an unknown
  route (the Plan Bench hero anchor, Sep 2026). Pair the target section with
  `scroll-margin-top` so the sticky nav doesn't cover it.

- **A `role="switch"` with only an on/off state reads poorly when both states
  are first-class** — the bench's return toggle became a segmented control
  (two `aria-pressed` buttons in a `role="group"`); prefer that pattern when
  neither state is "off".

- **A `backdrop-filter` ancestor is a blur root — nested glass silently can't frost.** The nav
  popovers used the navbar's exact glass recipe yet stayed sharp-edged: their blur sampled the
  topnav's own interior; the page behind never entered their backdrop. Floating panels must
  render outside the filtered ancestor — portal to `document.body` + `position: fixed`, with the
  rect captured from the trigger at open time (see `App.tsx` notif/user-menu). Corollaries:
  click-outside guards must cover BOTH the trigger wrapper and the portaled node
  (`useClickOutside` returns `[ref, portalRef]`), and focus must be moved into the open panel
  explicitly (`tabIndex={-1}` + `focus({ preventScroll: true })`) — portaled nodes leave the
  trigger's tab neighbourhood.

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

- **`.card + .card { margin-top: 14px }` also matches GRID items — every new grid of `.card`s shoes it the same way.**
  A grid already spaces its items with `gap`, so the stacked-card beat
  double-applied: in a row of peers every card after the first rendered 14px
  lower *and* 14px shorter (live measure: tops 839/853, heights 477/463, and
  26px of space where the grid declared 12). It is invisible to tsc, to every
  test and to the build because nothing renders these pages in CI, and it
  reads as "the cards look oddly placed" rather than as a spacing bug.
  `.explore-grid > .card + .card` and `.two-col > .card + .card` zero it;
  **when you add a grid whose children are `.card`s, add it to that selector
  list** (Explore, CreatorPage, TripsList and the public page's
  Travel-tips/Warnings row are covered).
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
  whole document.** The published page's sticky sidebar held a nowrap share URL in a flex row: that gave the column
  a **451px floor inside a 362px column**, scrolling the document 75px sideways at a 390px viewport — and the
  `overflow: hidden` + `text-overflow: ellipsis` the rule already declared could never fire, because the item refused
  to shrink below its min-content. `min-width: 0` on the grid children (`.two-col > *`) and on the flex item fixes it.
  Two corollaries: the fix belongs at the *container* level (setting it on the inner `<code>` alone changed nothing —
  the column's floor is what overflows), and **diagnose it with `document.documentElement.scrollWidth - clientWidth`
  plus a `getBoundingClientRect().right > viewport` sweep**, not by eye — the widest offender here was an 8px-wide
  visible element sitting inside an invisible 451px floor.
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

- **A crowded flex row squeezes whichever child CAN shrink — find which one gives, then key the fix to the space the row actually gets, never to the viewport (learned 2026-09-19).** The Plan Bench's mode buttons pack an icon, a name and a speed pill into one row; in the 721–1000px band each button is a *quarter* of the controls card, so the row's only flexible child — the name — ellipsized to a single letter ("T…" at 78.7px) while the inline SVG beside it squashed 15px → 3px (`flex: none` on the icon is the one-line half of the fix). Two traps. (1) A viewport media band is a *proxy* for a row's width: it must be re-derived by hand whenever the container's max-width, the grid ratio or a gap moves, and the cheap fix it suggests is not even correct — hiding the speed pill was measured to still clip the longest name from 721px to ~755px, because the icon grows back to its true 15px and takes 12 of the ~33px the pill was holding. (2) The same row can be hosted under a different parent (the Trip Settings tab's 8-mode grid, longest label "Motorcycle"), where one viewport is not the same width at all — so the rule has to be about the row's own box. What holds: `container-type: inline-size` on the block that owns the row plus `@container (max-width: …)` switching the grid to one column — it follows the real constraint, covers the sibling surface for free, and survives minification (`max-width` ships as the range form `(width<=230px)`, so grep the built CSS, not only the source). Verify by measuring `scrollWidth − width` per label and the icon's own width across the whole band, never by reading the CSS — and check the height cost against the surface's own budget (here the stack costs 80px in a band that already overflowed its one-screen promise).

- **A decelerate curve is right for a dropdown and a pop on a 1000px surface — measure the motion's SHAPE, not the transition rule (learned 2026-09-19).** `--ease-out` and `--ease-glide` agree within .015 at every sampled point and both put 86% of a surface's distance inside the first 44% of the duration, so the Timeline's day collapse spent 24% of a 967px body in the first 6ms and dribbled the last 10% over 150ms — a defect no amount of CSS reading shows, and one that looked like "the collapse is not smooth". Two instruments worth reusing: (1) sample `getBoundingClientRect().height` per rAF across a toggle and plot fraction-moved against ms — that curve tells you whether you are looking at the easing, the interpolation or a dead beat (the open path here had a ~35ms beat before anything moved, the two rAFs that let the `0fr` row paint first); (2) forcing `transition-timing-function: linear` in the live page isolates the easing from the technique — with linear the `grid-template-rows 0fr↔1fr` interpolation was a straight line, which pinned the entire defect on the curve. `--ease-resize` (`cubic-bezier(.42, 0, .58, 1)`, both ends at rest AND symmetric) is now the token for a surface that resizes in place and moves a long way — symmetric because peak slope is what a long move is felt through: on the day collapse's ~920px the asymmetric Material standard curve peaks at 2.73× its average speed (96px in one 60Hz frame) against 1.72× (60px) for the symmetric one, for the same total time and the same 3px first frame, so the asymmetric family belongs on short moves only. Corollaries: the affordance must run on the SAME duration and easing as the thing it announces (a chevron at `--t-fast`/180ms finished ~90ms before the body, so one click read as two movements), and any JS timeout that outlives the animation (unmounting a collapsed body) must take its duration from the token via `motionTiming()` — a literal 280ms quietly leaves a half-collapsed body mounted the moment the token is retimed. **Duration is the other half of the same defect, and the only lever that reaches peak frame speed.** With the curve fixed, the rows below a folding day still peaked at **10.5px/ms** (942px of travel on `--motion-slow`/240ms) — reported by the user as the cards "colliding". Peak speed ≈ `distance × the curve's peak slope ÷ duration`, so once the easing is right the options are a longer duration or less travel; a ~950px accordion body has only the first. `--motion-slower` is the fourth duration token, reserved for travel measured in hundreds of px, and its value was set by measurement rather than taste: 240ms peaked at 10.5px/ms, 440ms at 3.6, 560ms at **2.8px/ms (47px inside a 60Hz frame) with a first-frame delta of 0** (nothing moves on the click itself), and the measured per-frame peak fell in both directions (79→25 and 115→25px on a ~145fps renderer). One tension worth naming: 560ms is above Material's 375–500ms guidance for a large expansion, and it is only defensible because the distance is ~950px — set this token by the px/ms you need, not by the duration table's habit. Two measurement traps this caught, both of which would have made the wrong call: **quote px/ms, never px per frame** — a 145fps renderer hands you ~7ms frames and makes the same motion look half as fast as a 60Hz phone will show it — and a **single long frame inflates one delta**, so read p90 beside the max and report the frame intervals next to them (a 69px 'peak' at 86% of the animation was one dropped frame, not the curve). Also: an element that unmounts mid-sample reports a zero rect, which reads as a jump to the top of the page — skip anything detached. When a move still reads as a collision after the easing is fixed, check the DISTANCE before adding more curve.

- **A focused element is blurred the moment it stops being visible — so a focus handoff must run when the close STARTS, not when the node unmounts (learned 2026-09-19).** The day collapse's clip unmounts 600ms after the close (the token's duration + 40ms slack), and the obvious place to hand focus back — inside that unmount timer — is already too late: the clip's inner wrapper carries `visibility: hidden` on a transition *delay* of the same token, so it flips at 560ms and Chromium blurs the focused control right then, leaving `document.activeElement === document.body` by the time the timer fires. The measured symptom was a keyboard user losing their place: activating the day's route line with Enter (the control that opens the day) removed that line one animation later, and the next Tab restarted at the top of the document. The handoff belongs in the effect body beside `setExpanded(false)`, where the clip is still on screen. Generalise it: **whenever a rule hides or removes whatever has focus, ask which comes first — the blur or your cleanup — and hang the handoff on the earlier one.** Every clip that can unmount the focused element needs its own handoff (here: the route line on open, the body on collapse), and the same fix is the reason a disclosure control should own the fallback focus rather than the clip guessing.

- **A programmatic `.click()` does not move focus; a real mouse click does — so a focus-loss finding from `.click()` is a probe artifact (learned 2026-09-19).** Collapsing a day while focus sat inside its body reported `document.activeElement === document.body` when the click came from `el.click()` in an eval, and I nearly shipped a fix for it; the same interaction through a real CDP click (`agent-browser click`) lands focus on the chevron, because a pointer click focuses the button it hits. **Probe focus behaviour through the input path the user has** — real clicks for pointer, real `Tab`/`Enter` (`agent-browser press`) for keyboard — and expect the two to disagree: only the keyboard path had a genuine defect here, and only the keyboard path could have revealed it. Re-run any focus or state anomaly through the real input before writing a line of code for it.

- **A centred flex item is re-positioned by every sibling's height change — top-align a row's items when its content toggles (learned 2026-09-19).** The Timeline day header is `flex-wrap: wrap` + `align-items: center`, and collapsing a day makes the middle block taller (the collapsed-only route chain appears, and the stats line re-wraps as the chips come and go). Every centred sibling then re-centres on the new line height: the collapse chevron and the Day badge moved **up to 32px within the frame the click landed**, while the body animation took 240ms — the "jerky displacement" the user reported, and invisible in any CSS read. `align-items: flex-start` makes each item's position its own; re-measured, the displacement of every header item across a toggle is 0px. Three companions from the same fix: (1) **a wrapped line's position follows the animating line above it**, so once the height change is eased the second line glides too (the day's action row moves 43.8px *smoothly* during an open — correct, and it used to be a jump); (2) the one element that changes a container's height should ride the collapse (here the route chain reuses `SmoothCollapse` in reverse) rather than appearing at full height in one frame; (3) the elements that exist in only ONE state and change *width* (chips) can't be eased by a height animation at all — give them the catalog's entrance pattern (fade + 4px rise) so they arrive as a fade instead of a pop, and accept that their layout slot appears at once. Instrument: sample each child's `getBoundingClientRect()` per rAF across the toggle and report per-child max |Δx|/|Δy| + the container's height curve — that separates "something jumped" from "something glided 40px".

- **A new CSS block may not claim an existing bare class name — later in the file wins on equal specificity, and the whole gate stays green while it does it (learned 2026-09-21).** I-20's unlock sheet shipped as `.reveal`, which is the Landing page's scroll-reveal utility (`body.reveal-armed .reveal` — nine elements: the section `h2`, three feature cards, four steps, all armed by one IntersectionObserver). The new block sits further down the stylesheet, so it won: those elements were re-laid-out as a flex column wearing the sheet's padding, and `.reveal > *` handed each of their children the sheet's stagger animation. **Nothing in the gate can see this** — `tsc` does not read CSS, the node tests have no DOM, and the contrast/spacing ratchets key on declarations rather than ownership — so it survived a fully green `npm run verify` (1613 passed, build clean). What caught it was rendering a page and asking the DOM a question: `document.querySelector('.reveal')` came back **truthy on a Landing render**. The recipe, cheap enough to run for every class a new block defines: `git show origin/test:src/styles.css | grep -c "\.<name>[ ,{:]"` — 15 of that block's 16 names cleared at zero and the sixteenth was the collision. Prefer a prefix you cannot collide with over a good short name (`.unlock-reveal*`, not `.reveal*`). It is now pinned by `tests/design-system.test.ts` → *"a class name has one owner"*, which fails on a bare `.reveal` selector naming the reason, and the pin was teeth-tested by appending `.reveal { outline: 0; }` and watching it fail before reverting. Same collision class as the two idea-banks' `I-19` and `I-20` (AGENTS §6): when a name is shared across the project, check the *namespace*, not just the name.
