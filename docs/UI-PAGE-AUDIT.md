# YatraFlow — Page-by-Page UI Audit

> **Provenance.** This is a **diagnostic-only** audit (no fixes applied) run against **v0.50.2**
> (`f754b7e`). It is committed as the reference write-up behind the fix tracker
> **[issue #107](https://github.com/hasnaina955/Yatraflow/issues/107)**. **The `styles.css:line`
> cites below have since drifted** — v0.51.0 (Timeline restructure + motion system) and v0.52.0
> (Liberty basemap + map view modes) both reshaped the file and `TripMap.tsx`. Re-locate a rule by
> its **selector**, not its line number, and re-measure any value before acting on it — several
> rows (the map basemap, drag-motion, `--t-*` tokens) are already superseded by shipped work.
>
> **Token-reference correction (current CSS, not a rewrite of the v0.50.2 audit):**
> the type/spacing-scale findings below are historical, not current declarations.
> Only `--text-xs: 11px` remains (one declaration, one `var()` consumer);
> the other seven documented type steps and all seven spacing steps each have
> zero declarations and zero usages. The CSS records their deletion
> (`src/styles.css:5198,5202–5208`, reconciliation snapshot). Likewise the old
> light-primary `#0D8D82` findings are superseded: primary now maps to
> `--teal-600` / `#0E7A72`, hover to `--teal-700`, active to literal `#095750`
> (`src/styles.css:18–20,109–115`; one light declaration each). The incumbent
> kicker recipe includes `.eyebrow` (`src/styles.css:5250–5263`, same snapshot).
> Do not restore the deleted scales or reverse the contrast fix from these rows;
> use `DESIGN_TOKENS.md` for the current inventory and legacy-kicker exception.
>
> **Explore rebuild.** The Explore page was rebuilt with `ex-` classes. The old `explore-hero` and `featured-card` selectors no longer exist, so their rows below describe the pre-rebuild page.

**Started:** 2026-09-12 · `main` = `test` = `f754b7e` (release v0.50.2)
**Method:** rule-by-rule pass against the project's own design language — `src/styles.css` token system,
`DESIGN_TOKENS.md`, `AGENTS.md` §4/§6, and the `design/*.html` mockups — using three review lenses:
**colour**, **layout**, **typography**. Motion is checked against the project's own motion tokens
(`--ease-out`/`--ease-soft`, `--t-fast`/`--t-med`/`--t-slow`).
**Evidence:** every contrast value below was **computed**, not estimated (WCAG relative-luminance,
alpha compositing applied where the real rule composites). Every colour claim traces to a declared
token pair in `src/styles.css`. Findings cite `file:line`.

> **Not a replacement for `docs/UI_AUDIT.md`.** That report (2026-09-01, v0.22.0) audited
> accessibility/forms/state. This one is a *design-system consistency* audit and is organised
> page by page. Overlaps are cross-referenced, not repeated.

## Severity key

| Tag | Meaning |
|---|---|
| **HIGH** | Content unreadable, an action blocked, or a state that is simply not drawn |
| **MED** | Breaks the type/colour system, heading hierarchy, or adaptability |
| **LOW** | Isolated alignment, spacing or polish |

**Verdict per page:** `Block` while any HIGH remains, else `Approve`. Coverage I did not inspect is
listed as `Not verified` — never silently approved.

---

## Master tracker

**Legend:** `[x]` audited · `[~]` in progress · `[ ]` not started · `[!]` blocked
`P1` = shell/overlay that appears on many pages, audited **once** in its own right.
Rule: **one page = one section, deep pass.** A page is only `[x]` when its rows below are written
and its overlays are ticked in the register.

### Page tree

```
YatraFlow
│
├─ SHELL  (P1 — shared chrome, audit once, affects every page)
│  ├─ [x] topnav  glass pill · .pill-glider · nav-link active state      App.tsx:371-376
│  ├─ [x] mobile bottom nav + .mobile-menu drawer                        App.tsx:461-467
│  ├─ [x] user-menu  (portaled fixed panel)                              App.tsx
│  ├─ [x] notif-pop  (notification popover)                              App.tsx
│  ├─ [x] page transition  .vt-active / routeIn / View Transition API    styles.css:2669
│  ├─ [x] Toast + undoToast + ConfirmDialog  (global feedback)           ui.tsx
│  └─ [x] .atmos canvas · .app-shell · --bottom-ui-offset safe areas     styles.css:451
│
├─ [x] #/                    Landing                                      Landing.tsx
│  ├─ [x] hero · route-snapshot scenario cycle (8s choreography)
│  ├─ [x] PlanBench  ("bench") — the other trip-start entry point
│  ├─ [x] hero-bench-cta boarding pass · ticker · CTA bands
│  └─ [x] motif + blob animations (all no-preference gated)
│
├─ [x] #/trips               My Trips                                     TripsList.tsx
│  ├─ [x] page header + 3-button action row
│  ├─ [x] toolbar (search · style chips · when · sort · Clear)
│  ├─ [x] itin-card grid (cover, body, meta footer, delete)
│  ├─ [x] Trash view (restore / delete forever)
│  └─ [x] both EmptyStates
│
├─ [x] #/new                 Create Trip (Trip Ticket)                    CreateTrip.tsx
│  ├─ [x] 6 bento blocks (Route · Dates · Crew · Budget · Cover · Pinned)
│  ├─ [x] route-line + numbered dots + return section
│  ├─ [x] DateRangeCalendar  (.cal-pop overlay)          → register
│  ├─ [x] mode-grid / crew-row / quick-budget / style carousel
│  ├─ [x] Trip Ticket rail + bill printer
│  └─ [x] mobile .trip-dock
│
├─ [x] #/explore             Explore                       3H 5M 3L    Explore.tsx
│  ├─ [x] editorial hero + search input
│  ├─ [x] style chips + the "Saved" chip
│  ├─ [x] filter bar — 3 native <select>s   A8–A10          → register
│  ├─ [x] featured card
│  └─ [x] results grid + PubCard + Load more
│
├─ [x] #/trip/:id            Trip Workspace
│  ├─ [x] Overview      OverviewTab.tsx   3H 4M 3L
│  ├─ [x] Board         BoardView.tsx     2H 5M 4L
│  ├─ [x] Map           MapTab.tsx        1H 1M 1L   + travel-panel · legend · poi-col
│  ├─ [x] Timeline      TimelineTab.tsx   2H 2M 2L   day rail · kind spine/tag · 1 select
│  ├─ [x] Group input   GroupInputTab.tsx 2H 1M 1L   vote buttons · consensus bar
│  ├─ [x] Budget        BudgetTab.tsx     3H 3M 2L   metric strip · cat bars · balances
│  ├─ [x] Share         ShareTab.tsx      1 native select · role pills
│  └─ [x] TripSettingsForm.tsx            2 native selects (settings modal)
│  ├─ [x] trip-head-card (navy hero) — forced-dark gradient   → §SYS-5
│  └─ [x] tabbar / PillNav + container--board / --map widths  → B16
│
├─ [x] #/pub/:slug           Public Itinerary                             PublicItinerary.tsx
│  ├─ [x] editorial hero · cover-route · stats ledger
│  └─ [x] pr-sheet / pr-sheet-portal / save-heart
│
├─ [x] #/creator/:id         Creator Page          0H 0M 1L            CreatorPage.tsx
├─ [x] #/creator-hub         Creator Hub           0H 2M 2L (B17 ok)     CreatorHubPage.tsx
├─ [x] #/profile             Profile & Settings  0H 1M 1L            Profile.tsx
├─ [x] #/auth                Auth  0H 0M                              Auth.tsx
├─ [x] #/admin               Admin (JWT-gated)       0H 1M 3L            AdminPage.tsx
└─ [x] NativeHome            installed-app front door (native shell) 0H 2M 1L  NativeHome.tsx
```

### Overlay & dropdown register (P1 — audit once each, then tick per page that hosts it)

The gap this register exists to close: a dropdown's **trigger** can be perfectly on-brand while its
**popup** is raw OS chrome. Auditing only the closed control misses it entirely.

**A · Native `<select>` family — 20 instances across 10 files. Trigger is themed; the popup is not.**

| # | Surface | Host page(s) | Where | Done |
|---|---|---|---|---|
| A1 | Category | **Edit stop** modal | `StopEditor.tsx:178` | [x] |
| A2 | Priority | **Edit stop** modal | `StopEditor.tsx:194` | [x] |
| A3 | Status | **Edit stop** modal | `StopEditor.tsx:282` | [x] |
| A4 | When ("Any time…") | My Trips toolbar | `TripsList.tsx:166` | [x] |
| A5 | Sort ("Recently edited…") | My Trips toolbar | `TripsList.tsx:172` | [x] |
| A6 | Commitment Type | Create Trip | `CreateTrip.tsx:751` | [x] |
| A7 | Commitment Day | Create Trip | `CreateTrip.tsx:760` | [x] |
| A8–A10 | 3 × duration / max-budget / sort | Explore | `Explore.tsx:153,159,166` | [x] |
| A11–A13 | 3 × category/cost selects | Budget | `BudgetTab.tsx` | [x] |
| A14–A15 | 2 × selects | Group input | `GroupInputTab.tsx` | [x] |
| A16 | 1 × select | Map tab | `MapTab.tsx` | [x] |
| A17 | 1 × select | Share | `ShareTab.tsx` | [x] |
| A18 | 1 × select | Timeline | `TimelineTab.tsx` | [x] |
| A19–A20 | 2 × selects | Trip settings form | `TripSettingsForm.tsx` | [x] |

**B · Custom overlays / popovers (already hand-built — check each against the system)**

| # | Surface | Host page(s) | Where | Done |
|---|---|---|---|---|
| B1 | LocationInput combobox + listbox | Create Trip, StopEditor, Trip settings (**not** Explore — its search is a plain `.input`) | `LocationInput.tsx:104-118` | [x] |
| B2 | `.cal-pop` date picker | Create Trip | `CreateTrip.tsx:158` | [x] |
| B3 | Modal (base, focus-trapped) | everywhere | `ui.tsx:27` | [x] |
| B4 | ConfirmDialog | My Trips, Timeline | `ui.tsx` | [x] |
| B5 | StopEditor "Edit stop" modal (hosts A1–A3) | Timeline, Board | `StopEditor.tsx` | [x] |
| B6 | `.cover-picker` controls | Create Trip | `CreateTrip.tsx:703` | [x] |
| B7 | `.loc-dropdown` + `.loc-empty` + `.loc-option` | LocationInput (Create Trip, StopEditor, Trip settings) | `styles.css:2074,2093,2180` | [x] |
| B8 | `.user-menu` | shell (every page) | `styles.css:1910` | [x] |
| B9 | `.notif-pop` | shell (every page) | `styles.css:1750` | [x] |
| B10 | AiDrawer | everywhere | `AiDrawer.tsx:82` | [x] |
| B11 | `.impact-sheet` / `.impact-panel` | Timeline | `styles.css` | [x] |
| B12 | `.mobile-menu` drawer | shell ≤720px | `styles.css` | [x] |
| B13 | `.travel-panel` / `.route-panel` | Map tab | `styles.css` | [x] |
| B14 | map legend + expanded map shell | Map tab | `TripMap.tsx:801` | [x] |
| B15 | `.pr-sheet` / `.pr-sheet-portal` | Public Itinerary | `styles.css` | [x] |
| B16 | PillNav + `.pill-glider` | workspace tabs, Create Trip | `PillNav.tsx` | [x] |
| B17 | `.filter-pillbar` segmented control | Decisions/Group input · **Creator Hub** | `styles.css:649` | [x] |
| B18 | Toast / undoToast | global | `ui.tsx` | [x] |
| B19 | `.trip-dock` mobile CTA bar | Create Trip ≤900px | `styles.css:4468` | [x] |
| B20 | `.locked-overlay` / `.paper-sheet` | Public Itinerary | `styles.css` | [x] |

---

## Executive summary

The token *architecture* is genuinely good — three tiers, primitives → semantics → components, a
documented z-index ladder, a kicker recipe, both theme blocks present. The problem is **adoption**,
and it clusters into four root causes that repeat across pages:

1. **Two token scales are defined and abandoned.** `--text-2xs … --text-2xl` (8 steps) has
   **1 usage against 342 raw `font-size` declarations**; `--s-1 … --s-8` has **0 usages against 480
   raw padding/margin declarations**. This is the mechanical cause of 36 distinct font sizes.
2. **A dark-mode foreground pattern exists but wasn't applied everywhere.** `.clickable-chip.on-teal`,
   `.bench-mode-btn.on` and `.map-legend-toggle.map-live-on` all carry a `[data-theme='dark']` override
   that swaps white for `#06251f`; their siblings (`.mode-btn.on`, `.crew-btn.on`, `.route-dot`,
   `.cal-day.edge`, **`.vote-btn.on`**) do not.
3. **The "kicker" unification pass missed one class.** The block that gives 39 micro-label classes one
   recipe omits `.eyebrow` — the only label class Create Trip uses. That class also lost its rule
   during the mockup→implementation rename. Two independent misses on the same selector.
4. **Motion is a two-vocabulary system.** Tokens are used 33 times; raw `160ms`/`.15s`/`0.5s` values sit
   beside them, and several interactive controls declare no transition at all, so they snap.
5. **Dropdowns are themed on the outside only.** All **20** `<select>`s have an on-brand trigger and a
   browser/OS-rendered popup — a stock Android dialog in the shipped APK. Three different classes are
   used for the one control, one of which (`className="input"`, `TimelineTab.tsx:1110`) falls back to
   the native OS arrow entirely. See the **overlay register** and the dropdown findings below.
6. **`--gray-900` in forced-dark gradients (SYS-5).** It flips to near-white in dark theme. Two cards
   still use it, stranding white text at **1.13:1** — while the codebase documents the rule three times
   and follows it in three other places.
7. **Light-theme semantic inks are too light (SYS-6).** `--yf-amber`, `--yf-saffron`, `--warn`, `--ok`
   and `--gray-400` all fail as **text, borders and fills** on light surfaces — **twelve instances across
   five pages**, measuring 1.74–4.25:1. All twelve pass in dark. The remedy (`#8F5B06`) already ships for
   one chip and measures 5.08–5.73:1 everywhere.

### The meta-pattern worth acting on

Four of the seven root causes have the **same shape**: the project already knows the rule and applies it
in one place, but the siblings were never updated.

| Known rule | Where it's applied | Where it's missing |
|---|---|---|
| Dark-mode foreground swap | `.clickable-chip.on-teal` `:659`, `.bench-mode-btn.on` `:2919`, `.map-legend-toggle.map-live-on` `:1519` | `.mode-btn.on`, `.crew-btn.on`, `.route-dot`, `.cal-day.edge`, **`.vote-btn.on`** |
| `--gray-900` needs a literal in forced-dark gradients | `.hero-adventure` `:1361`, `.cta-band` `:1425`, `.budget-hero` `:1217` | `.card.route-snap` `:384`, `.trip-head-card` `:1846` |
| Light theme needs a deeper ink | `.chip-saffron` `:636` (`#8F5B06`) | 12 instances across 5 pages — see **SYS-6** |
| One micro-label recipe | 39 selectors at `:4646` | `.eyebrow` |
| A custom control wrapped in `Field` must accept `id` | `LocationInput` `:20-24,91` (with a comment citing the fix) | `PayerSelect` (`BudgetTab.tsx:66-80`) — `Field` sets `htmlFor` to an id the component never forwards, so "Paid by" has no accessible name and its label doesn't focus it |
| White on a brand fill | `--color-accent-foreground` (#3A2506) exists as a token — `.btn-saffron` already uses it | `.notif-badge` (`styles.css:1923`) hardcodes `color: #fff` on `var(--saffron)` — **both themes, ~1.98:1**, and there is **no `[data-theme='dark']` override** |
| `--yf-teal-600` is too light for <14px text | `.bench-receipt-kicker` was switched to `--yf-teal-700` (`:2937` comment) | `.editorial-kicker` `:2644` and `.share-tab.is-active` `:4046` still use `--yf-teal-600` #0D8D82 = **4.08:1** on white — passes large-text AA, fails 4.5 for 12–14px |

The last row is the same shape as the others and worth stating plainly: **`Field` marks the field as
"associated" the moment it clones a child, whether or not that child forwards the `id`.** The two
outcomes are indistinguishable in the component tree and only show up in the rendered DOM.

That is why **grepping for the pattern, not the instance, is the highest-yield move** on the remaining
pages — and why each of these is a small, mechanical fix rather than a design decision.

---

## App shell (P1 — shared chrome, audit once)

The chrome that wraps every signed-in page, audited as a unit: `App.tsx` (topnav, mobile-menu,
user-menu, notif-pop, the theme View Transition, Toast/ConfirmDialog mount, skip link) plus the shell
classes in `styles.css`.

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:1923` `.notif-badge` | `color: #fff` on `var(--saffron)` = **1.98:1 light** (#F3AA3D) / **1.98:1 dark** (#F5A94A) | `color: var(--color-accent-foreground)` (#3A2506) | The unread count is a 10px/800 number → needs 4.5:1. Fails in **both** themes, and there is **no `[data-theme='dark']` override** (unlike most other shell items), so the white-on-saffron error is unfixed everywhere. Root cause: **white-on-brand** — the same shape as `.btn-primary`'s resting fill (Page 1) and the Explore "Saved" chip. The fix already exists as the `--color-accent-foreground` token the saffron button uses. No other text in the pill is white-on-saffron, so this is one line |
| **MED** | `styles.css:4046` `.share-tab.is-active` · `:2644` `.editorial-kicker` | `var(--yf-teal-600)` #0D8D82 on the white/paper surface = **4.08:1** | Use `--yf-teal-700` | 14px/600 tab label and 12px/800 kicker are normal-size text needing 4.5:1. The team **already found and fixed this exact case** for the receipt kicker (comment at `:2937`: "teal-600 read 4.08:1 on paper — under AA for the 11px kicker") but never propagated it to the two siblings. Dark passes (6.30 / 7.39) |
| **LOW** | `App.tsx:367` brand "Flow" | `var(--teal)` #0D8D82 on the 58%-white glass nav = ~3.7:1 | — | 19px/800 display text → passes the 3:1 large-text floor. Borderline, not a defect |

**Verified, no finding:** `.user-menu-item.danger` — light `#A82E2E` = **6.78:1**, and the dark override
`:1922` swaps to `--danger-500` #E06C6C = **4.76:1** (passes). The dark foreground pattern is correctly
applied *here*, which makes the missing applications elsewhere (Create Trip, Group input, Map) stand out
more. `.nav-link` inactive (`--text-2`) = 7.0:1 light / 5.9:1 dark; `.nav-link.active` glider + teal-deep
ink = 5+:1 both. user-menu/notif-pop/mobile-menu lift panel text to `--text-2` so mid-gray never goes
muddy on glass (`styles.css:1917`).

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **LOW** | `styles.css:2111` `.mobile-menu` | `z-index: var(--z-dock)` (55) sits **below** the topnav (`--z-nav-glass` 60) | — | Fine as-is: the drawer drops *below* the nav (`top = nav-h + 22px`), so no overlap. Noted only to confirm it was a considered choice, not an accident |

**Verified, no finding — the shell is the best-built part of the app:**
- **Focus management**: notif-pop and user-menu `focus()` on open and return focus to the trigger on
  close (`App.tsx:188-203`); Escape closes any open popover (`:207-215`); click-outside via
  `useClickOutside`.
- **Skip link** (`:362`) programmatic-focuses `<main>` (the `#main` hash trick would fight the router) — correct.
- **ARIA tablist** for the share tabs with roving tabindex + Arrow/Home/End (ShareTab.tsx:244-254) — the reference pattern.
- **Glass panels portal to `body`** with a captured viewport rect (`:72-87`) so the backdrop blur samples
  the page, not the nav's own interior — a subtle but correct call.

### Motion

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **LOW** | `App.tsx:155-184` theme View Transition | — | — | **Verified good.** Light→dark radiates *out* of the icon; dark→light collapses *in*; the landing page skips VT entirely to avoid freezing continuous CSS animations; `prefers-reduced-motion` short-circuits to an instant swap; backdrop-filter is suppressed for the transition's lifetime to avoid the gray-veil bug. This is the correct, documented implementation — recorded only to protect it |

**Register (P1):** B8 `.user-menu`, B9 `.notif-pop`, B12 `.mobile-menu`, B16 PillNav/`.pill-glider`,
B18 Toast, B4 ConfirmDialog, B20 `.locked-overlay`/`.paper-sheet` all ticked. The shell has no native
`<select>`, so no A items; the role-select lives on the Share tab → A17.

---

## Page 1 — My Trips (`src/pages/TripsList.tsx`)

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:530` `.btn-primary` — rendered by `TripsList.tsx:106,144` | `#FFFFFF` on `--color-primary` `#0D8D82` = **4.08:1** | Darken the fill to `--teal-600` `#0E7A72` (**5.19:1**) or use `--color-primary-foreground` dark-on-teal as the dark theme already does | Fails AA (4.5) for the page's primary CTA at 14px/700. Note the *hover* state already passes — only the resting state fails |
| **MED** | `styles.css:2738` `.chip-count` (used `TripsList.tsx:162`) | `opacity: .65` composites the chip ink → **2.54:1** on selected, **2.98:1** on unselected | Drop `opacity`, use `--text-3` at full strength | The style-count badge is unreadable in light theme. In dark it measures 3.70 / 4.54 — so the light theme is the worse case, the opposite of the usual pattern |
| **MED** | `TripsList.tsx:106` + `:144` | Header renders `btn-primary` **and** the empty state renders `btn-primary` — two filled primaries in one view; "Load demo trips" also appears in both | One filled action per view: the header CTA stays primary, the empty-state CTA becomes `btn-outline` | Violates "fill exactly one action per view" — two filled buttons compete and neither reads as *the* next step |
| **MED** | `TripsList.tsx:104` `.btn.btn-outline.on-teal` | `on-teal` matches **no rule** for `.btn` (every `on-teal` rule is scoped to `.clickable-chip` or `.pill-nav .clickable-chip`) → pressed and unpressed render identically | Add a `.btn.on-teal` rule (reuse the `.clickable-chip.on-teal` recipe + its dark override) | The Trash toggle's pressed state is invisible to sighted users. `aria-pressed` is correct, so this is a sighted-only defect — but the state is not drawn at all |

**Verified, no finding:** `.itin-meta` and `.stop-meta` both measure **5.51:1** on the card (light) and
**5.89:1** (dark); `.small.muted` is 5.13:1 on the page canvas. All pass.

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:4114` `.trips-toolbar` + `:2737` `.explore-chips` | Toolbar is `align-items: center`; `.explore-chips` carries `margin-bottom: 14px`, which in a centre-aligned flex row lifts the chips ~7px out of line with the search input and selects | Scope the margin to the places that need it, or reset it for `.trips-toolbar .explore-chips` on desktop too | The style chips sit visibly high against the field they filter. The mobile query (`:4127`) already zeroes it — only desktop is affected |
| **MED** | `TripsList.tsx:179` Clear button | `hasFilters` flips true on the **first character typed**, appending a `btn-ghost` to a flex row whose search input is `flex: 1 1 240px` | Reserve the space, or place Clear outside the flow (e.g. inside the field) | The search box visibly shrinks as the user types the first character — a layout shift during input |
| **MED** | `styles.css:4134-4144` `.trips-page .row-between:first-child` | Phone layout is keyed on **DOM position** (`:first-child`), because the header is inline-styled in TSX; `TripsList.tsx:97` also sets `paddingTop: 26` inline, which `:4136` then fights with `!important` | Give the header a real class (`.trips-head`) and move the padding into CSS | Adding any element above the header — a banner, the trip-total strip — silently breaks the phone header. `!important` against an inline style is a maintainability fault with no upside |
| **LOW** | `TripsList.tsx:122` | Every trash row gets an inline `borderBottom: '1px solid var(--line)'`, including the last | Drop the border on the last row (`:last-child`), or use the existing `.divider` pattern | A trailing rule floats above the card's bottom padding, reading as a clipped row |
| **LOW** | `styles.css:1440` vs `:645` | `.itin-card:hover` lifts `translateY(-2px)`; `.clickable-chip:hover` lifts `translateY(-1px)` | Pick one lift distance | Two hover-lift values for the same gesture |

### Typography

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:1454-1459` `.itin-body .card-title` | Card titles are `h2` forced to **16px** — exactly the global `h3` size — while `.empty-state h2` (`:1824`) is **18px** | Give each level one size; if the card title must be 16px, make it an `h3` (or add a `--text-*` step for it) | Two different sizes for the same heading level on one page, and h2 is visually indistinguishable from h3 — heading level stops predicting size. The CSS comment at `:1457` records this as deliberate for outline correctness, which is the right instinct applied the wrong way round |
| **MED** | `styles.css:443` vs `:4160` | `h1` is `clamp(26px, 4.5vw, 40px)` globally; Create Trip overrides its `h1` to 28px | One `h1` step, or a documented page-level variant | The two sibling pages' `h1`s differ by 12px at desktop width for no semantic reason |
| **MED** | `styles.css:4635` type scale | `--text-2xs … --text-2xl` defined; **1 of 8 steps used**, against **342** raw `font-size` declarations | Adopt the scale, or delete it | A scale nobody consumes is documentation that lies. It is also the direct cause of the 36 distinct sizes in the file |
| **LOW** | `styles.css:1828` `.small` vs `:4161` `.ts-head .small` | `.small` is 12.5px globally but **13.5px** inside `.ts-head` | Keep one size for one class | The same utility class means two different sizes across the two audited pages |

---

## Page 2 — Create Trip (`src/pages/CreateTrip.tsx`)

### Typography

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:4159,4180,4221` — rendered by `CreateTrip.tsx:449,461,503,520,536,656,688,729` | `.eyebrow` has **no base rule anywhere**. The three rules that mention it set `margin` only. The mockup's rule — `design/trip-ticket-mockup.html:75`: `font-size: 10.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--teal)` — was never carried over | Add `.eyebrow` to the kicker recipe at `styles.css:4646` — **root cause SYS-1** | **All 8 section labels** ("Start something", "Route", "Dates", "Crew & transport", "Budget & style", "Trip cover", "Pinned plans", "Return") render as inherited **15px/400 sentence-case** body text. They stop reading as labels, and the page's visual hierarchy collapses to h1 → body. The class was renamed in the mockup→implementation port and the rule was lost in transit |
| **MED** | `styles.css:4238,4268,4211` vs the unstyled `.eyebrow` | `.group-lab` and `.mini-lab` (10px/700/.1em/uppercase) and `.route-tag` (10px/700/.08em) are properly styled on the *same page* as `.eyebrow` | One kicker recipe for all of them | The page uses two systems for one visual role — the correctly-styled labels sit inches from the unstyled ones, which is why the defect reads as "inconsistent" rather than "missing" |
| **HIGH** | `styles.css:4210` `.route-name` (rendered `CreateTrip.tsx:427`) | `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` with no `title` and no other surface showing the full name | Add `title={d.name}` (and/or let it wrap to 2 lines) | A stop the user just added — "Thiruvananthapuram, Kerala" — is truncated with **no way to recover it**. Truncation that hides content the user cannot otherwise reach |
| **LOW** | `styles.css:4320` `.cal-wd` 9.5px · `:4238` `.group-lab` 10px · `:4268` `.mini-lab` 10px | Three caption roles below the 12px floor | Raise to the `--text-2xs`/`--text-xs` steps | 9.5px uppercase weekday initials are at the edge of legibility; the type scale already has a 10.5px step |
| **LOW** | `styles.css:4523-4526` | `.tk-title` has `overflow-wrap: anywhere`; `.dock-meta b` (`:4477`) has ellipsis | — | Recorded as verified-correct for `.tk-title`; the dock's truncation is recoverable from the Trip-name field on the same page, so it is **not** a finding |

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:4204-4207` `.route-dot` | `#fff` on `--yf-teal-600`: **4.08:1** light (`#0D8D82`), **2.45:1** dark (`#2BB8AC`) | Use the existing pattern — `[data-theme='dark'] { color: #06251f }` (measures **6.62:1**) | The route numbers are 11px/800 — normal-size text needing 4.5:1. Fails in **both** themes |
| **HIGH** | `styles.css:4247` `.mode-btn.on` (transport tiles) | `#fff` on `--yf-teal-600` = **4.08:1** light / **2.45:1** dark | Same `[data-theme='dark']` foreground swap the landing-page twin already has (`styles.css:2919-2923`) | The selected transport mode's name (12.5px/700) is unreadable in dark. Its sibling `.bench-mode-btn.on` **was** given the override — this one wasn't |
| **HIGH** | `styles.css:4328` `.cal-day.edge` (the picked start/end day) | `#fff` on `--yf-teal-600` = **4.08:1** light / **2.45:1** dark | Same override | The two most important cells in the calendar — the user's chosen dates — fail AA in both themes |
| **MED** | `styles.css:4278` `.crew-btn.on` | `#fff` on `--yf-teal-600` = **4.08:1** light / **2.45:1** dark | Same override | The selected crew size. Mitigated by the block header repeating "N travellers", hence MED not HIGH |
| **MED** | `styles.css:4248` `.mode-btn.on .hint` | `rgba(255,255,255,.8)` composited on `#2BB8AC` = **2.09:1** in dark | Inherit the corrected foreground, or use `rgba(6,37,31,.75)` | The mode's explanatory line ("your fuel · ≈42 km/h") is the least readable text on the tile in dark |
| **MED** | `styles.css:4193` `.ts-switch-track::after` | White knob on the checked track: **2.45:1** in dark (needs 3:1 as a non-text UI boundary) | Give the knob a dark-theme treatment | The switch's on/off position becomes hard to read in dark. Light passes at 4.08:1 |

**Verified, no finding** (this is the pattern that proves the fix is already known): `.clickable-chip.on-teal`
(`:659`) carries `[data-theme='dark'] { color: #06251f }` → **6.62:1**; `.quick-budget .chip.on` (`:4287`),
`.cal-day.in-range` (`:4327`) and `.trip-starter .pill` (`:4234`) all carry a dark override →
**5.55:1**; `.ts-block-value` → **6.40:1**; the whole trip ticket on navy measures 5.80–13.86:1.
The dark theme is *mostly* right — the six rows above are the exceptions.

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:616` vs `:4186` `.form-row` | **Duplicate definition.** `:616` declares a responsive `display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))`; `:4186` overrides it with `display: flex` and **no `flex-wrap`**. The grid version is dead code | Delete the dead rule and add `flex-wrap: wrap` to the survivor | `.commitment-row` (`CreateTrip.tsx:748`) puts **4 Fields + an Add button** in one non-wrapping flex row. Below ~900px they compress instead of wrapping — the responsive intent is silently gone |
| **MED** | `styles.css:4187` `.form-row .field { flex: 1 }` | All four commitment fields get equal width regardless of content | Weight by content (`flex: 2` for "What", `flex: 0 1 auto` for Day/Time) | "What" (a name) and "Day" (a 1–2 digit number) get identical widths; the name field is the one that needs the room |
| **LOW** | `styles.css:4283` `.quick-budget { padding-top: 24px }` | A magic number optically aligning the chips with an input that has a 13px label above it | Use the field's own baseline (e.g. align to the input's top edge via the grid) | If the label wraps to two lines — a longer translation, a narrow column — the chips stop aligning. Growth/clipping risk from a hard-coded offset |
| **LOW** | `styles.css:4636` spacing scale | `--s-1 … --s-8` defined; **0 usages** against **480** raw padding/margin declarations | Adopt the scale, or delete it | Same class of defect as the type scale: a system that exists only as a comment. `padding-top: 24px` above is exactly `var(--s-8)` |

**Verified, no finding:** the mobile layout is well handled — `.ts-layout` collapses to one column at
≤900px, `.ts-rail` hides, `.trip-starter` gains `padding-bottom: 118px` to clear the fixed dock
(`styles.css:4466`), and the dock itself respects `--bottom-ui-offset`. The `.ts-block:has(.cal-pop)`
z-index fix (`:4174`) is a genuinely good catch recorded in-code.

### Motion

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:4213-4218` `.route-btn`, `:4240` `.mode-btn`, `:4273` `.crew-btn`, `:4321` `.cal-day`, `:4284` `.quick-budget .chip` | These declare **no `transition` at all**, yet each changes `background`/`border-color`/`color` on hover or selection | Add `transition: background var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out)` | On one page, some controls ease (`.ts-switch-track`, `.btn`, `.clickable-chip`) and others **snap**. Selecting a transport mode, a crew size, a date or a budget chip is an abrupt flip |
| **MED** | `styles.css:640` + `:642` `.clickable-chip` | **Duplicate `transition`.** `:640` declares a 4-property transition; `:642` overrides it with 3 — the survivor omits `color` and `box-shadow` | Merge into one declaration including `color` and `box-shadow` | The selected chip's background eases over 180ms while its text colour and the `--shadow-glow-teal` glow pop instantly — the visible tell that two rules are fighting |
| **MED** | `styles.css:4284` vs `:640` | The trips-page style chips are `.clickable-chip` (eased); the create-page quick-budget chips are raw `.chip` (no transition) | Point both at one selectable-pill recipe | The same affordance — "pick one of these" — animates on one page and snaps on the other |
| **MED** | throughout | Raw durations beside tokens: `160ms`×7, `280ms`×3, `80ms`×2, plus `.15s`, `.18s`, `.5s`. Tokens (`--t-fast/med/slow`) used 33 times | Route through the three tokens | Two motion vocabularies. `.itin-card` and `.input/.select` both use `.15s ease` — not the project's easing family, and not `--t-fast` (180ms), so nothing lines up |
| **LOW** | `TripsList.tsx:199` (70ms) · `styles.css:4455` (60ms) · `:2701` (40ms) | Three entrance-stagger rhythms across the app | One stagger step | Card grids, create-page blocks and board columns drift in at three different cadences |

**Verified, no finding — and worth protecting:** reduced-motion is handled properly. The global block
at `styles.css:2281` (`animation-duration: .01ms !important` etc.) plus the `no-preference` gates mean
the create page's `ts-rise` entrance and the bill-printer animation are correctly frozen, and `.ts-block`'s
`opacity: 0` start state sits **inside** the `no-preference` block so content is never stranded invisible.

---

## Page 3 — Explore (`src/pages/Explore.tsx`)

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:589` + `:2736` `.explore-hero-search:focus` | `.explore-hero-search:focus` overrides `border-color` and `outline` but **not** `box-shadow`, so `.input:focus`'s teal ring (`0 0 0 3px color-mix(teal 18%)`) survives and composites over the hero to **1.18:1** | Declare a hero-appropriate `box-shadow` on `.explore-hero-search:focus` (a white ring) | The keyboard focus indicator on the page's primary input is invisible against the dark teal hero. Needs 3:1 as a non-text indicator |
| **HIGH** | `styles.css:2735` `.explore-hero-search::placeholder` | `rgba(226,241,239,.75)` composited over the field (`rgba(255,255,255,.12)` on the hero) = **4.17:1** | Raise the placeholder to full `#e2f1ef` (6.96:1) | The placeholder is the field's **only** label — "Search a route, place or creator — try "Alleppey"…" — and it misses AA. The typed value measures 6.96:1, so only the empty state fails |
| **HIGH** | `styles.css:680-682` + `Explore.tsx:146` | The **Saved** chip's active state is `#fff` on `--saffron` = **2.14:1** light / **1.97:1** dark | Use the existing `.clickable-chip.on-saffron` recipe (soft fill + `--warn` ink, which passes) — or `.on-teal` like every sibling chip | Fails in **both** themes. It is also the only chip in the row whose selected state differs from the other eight, so the row has two meanings for "selected" |
| **MED** | `PubCard.tsx:57,60` | Two icon links (YouTube / Instagram) are styled `className="muted"` — the same colour as static muted text | Give them an interactive treatment (accent or a bordered shape) | An interactive element rendered neutral "misleads just as badly" as a static one rendered accent. Contrast passes (5.51:1); the **role** is wrong |

**Verified, no finding:** the hero's hardcoded palette is sound — kicker 7.18–11.07:1, sub 8.11–12.50:1,
h1 9.73–15.01:1 across both theme stops. The featured card passes everywhere: kicker 9.03–11.20,
h2 link 12.28–15.23, tagline 9.58–11.88, credibility 7.84–9.73, meta 10.56–13.10. `.save-heart` 4.30
light / 6.34 dark (needs 3:1). So Explore's *bespoke* surfaces are the best-measured part of the app.

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `Explore.tsx:184-208` vs `:59-78` | The featured card is computed from `published` **ignoring every active filter** (deliberate, per the comment at `:90`) | Suppress the featured card when `filtersActive`, or label it "outside your filters" | Filter to "Under ₹10k" and the lead card can still show a ₹60k itinerary — the page visibly contradicts the constraint the user just set |
| **MED** | `Explore.tsx:173-175` vs `:128` | `filtersActive` includes `q`, but `q` is typed in the **hero** while the `Clear filters` button renders down in the separate filter card | Put the clear affordance with the input that triggers it | The control appears far from its cause; a user typing in the hero has no reason to look 300px below for a button they just summoned |
| **LOW** | `Explore.tsx:123` | Kicker text is typed in caps: `DISCOVER · TRUST · FORK` | `Discover · Trust · Fork` + let `.editorial-kicker`'s `text-transform` do it | The project's own rule (`styles.css:4659`) says *"Decorative stamps keep caps visually, but via CSS, not typed text"* — this line breaks it |

### Typography

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:2644` vs `:4654` | `.editorial-kicker` declares `font-size: 12px; font-weight: 800; letter-spacing: .12em`, but the kicker unification block later overrides all three with `--kicker-size/weight/tracking` (10.5px/700/.06em) | Delete the dead declarations, keep the colour — **root cause SYS-2** | 3 of the class's 4 properties are dead. A reader tuning the kicker in its own rule sees no change — a debugging trap |
| **LOW** | `styles.css:2727` | `.explore-hero h1` = `clamp(30px, 4.6vw, 46px)` vs the global `h1` `clamp(26px, 4.5vw, 40px)` | Use one `h1` scale | A second, larger h1 ramp. Explore's hero h1 is 6px bigger than every other page's at desktop width |

### Motion

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **LOW** | `Explore.tsx` (whole page) | Explore has **no entrance choreography** — no stagger on the hero, featured card or grid | Either add it, or accept it as the calm page | My Trips staggers its cards (`trip-enter`, 70ms steps) and Create Trip staggers its blocks (`ts-rise`, 60ms) — Explore, the discovery page where motion would help most, arrives instantly. Inconsistency by omission |

### Register

- **A8–A10** ticked: all three filter selects are `className="select"` with `aria-label` and self-describing
  options ("Any length", "Any budget", "Most popular"), so no visible label is needed. They inherit the
  systemic native-popup issue (**A**) and nothing else.
- **B7** corrected: `.loc-dropdown`/`.loc-empty` belong to `LocationInput`, **not** Explore — Explore's
  search is a plain `.input`. Ticked under Create Trip.

---

## Page 4 — Trip Workspace · Overview (`src/pages/trip/OverviewTab.tsx`)

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:360` `.health-num-big.mid` + `:365` `.health-bar > i.mid` | `--yf-amber` `#E4AE43` on the card = **2.01:1** (needs 3:1 as 54px/800); the bar fill against its `--yf-amber-100` track = **1.89:1** (needs 3:1) | Use the deeper amber the project already ships for light theme (`#8F5B06` measures 5.73:1 on a white card) | The **"Tight"** band — the one that most needs to read as a warning — is the least legible of the three. Light theme only; dark measures 6.44 / 5.81. Root cause **SYS-6** |
| **HIGH** | `styles.css:384` `.card.route-snap` and `:1846` `.trip-head-card` | Both are forced-dark surfaces whose gradient ends in `var(--gray-900)`, which **flips to `#ECF1F8`** in dark theme — while the text stays `#fff` | Replace the bottom stop with a literal, exactly as `.hero-adventure` (`:1361`) and `.cta-band` (`:1425`) already do | White text fails 4.5:1 from ~42% along the gradient and reaches **1.13:1**; the route line (white at `opacity:.85`) reaches **1.11:1**. Root cause **SYS-5** — and this is the app's own documented rule, violated twice |
| **MED** | `styles.css:636` vs `:103` | `.chip chip-saffron` (the "N to review" badge) is the one amber surface that **does** pass: `#8F5B06` on `#FCF0DC` = **5.08:1** | — | Verified good. Recorded because it is the *existing remedy* for SYS-6 that was never generalised |

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:407` `.pulse-bar` + `:1840` `.two-col` | `.pulse-bar` is the **3rd child** of the 2-column `.two-col` grid (`1fr 340px`) and has **no `grid-column: 1 / -1`** | Add `grid-column: 1 / -1` | The comment calls it a "full-width strip"; it renders in column 1 with an empty cell beside it. Only above 980px — the media query at `:3638` collapses `.two-col` to one column, which masks the bug on small screens |
| **MED** | `styles.css:401` `.link-btn` | `padding: 0`, and `.link-btn` is **absent** from the `@media (pointer: coarse)` hit-area list (`:560`) | Add `.link-btn` to that list (or give it inline padding) | Four on this page (3 × "Open Timeline / Open map / Invite travellers" + 1 in the pulse bar) with a hit area exactly the height of 13px text. Hit-area *classification* belongs to `better-accessibility`; recorded as a spacing defect |
| **LOW** | `OverviewTab.tsx:68,105,152,176,240` | `<hr className="divider">` after **every** card heading (6×) | Rely on the card's own padding, or use the divider only where two groups share one card | Space groups first, lines last. Six identical rules stop carrying information and just add height |

### Typography

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:443` vs `:1837` | Global `h1` = `clamp(26px, 4.5vw, 40px)`; `.page-head h2` = fixed **26px** | Give the `h1` a higher clamp floor, or drop the `h2` a step | Below **578px** the `4.5vw` term falls under the 26px floor, so the trip name `h1` and the "Trip briefing" `h2` render at **exactly the same size** — adjacent heading levels become indistinguishable on every phone |
| **LOW** | `styles.css:1592` `.feed-time` 11.5px · `:1838` `.page-head-sub` 14.5px | Two more one-off sizes | Fold into `--text-*` | Contributes to the 36-distinct-sizes count (**SYS-3**) |

### Motion

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:363` `.health-bar > i` | `transition: width .5s ease` | `transition: width var(--t-slow) var(--ease-out)` | A **fifth** duration (`.5s`) and a non-project easing. The health bar animates on every recompute, so it is the most-seen transition on the page — and the one that matches nothing |
| **LOW** | `OverviewTab.tsx` (whole tab) | No entrance choreography, while My Trips and Create Trip both stagger | — | Same omission as Explore |

---

## Page 5 — Trip Workspace · Board (`src/components/BoardView.tsx`)

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:1116-1119` `.board-pulse-band` | All three bands fail **4.5:1 in light** on the glass panel: `.mid` **1.94:1**, `.ok` **4.10:1**, `.bad` **3.89:1** | Route the band through the same ink the chip uses | The band is the *word* for trip health ("Comfortable" / "Tight") — the only place health is stated in language rather than a number — and it is unreadable in light theme for every value. Dark passes (7.09 / 7.44 / 5.38) |
| **HIGH** | `styles.css:1022-1028` `.stop-card.kind-*` | `kind-food` (`--yf-amber`, hue **39.9°**) and `kind-rest` (`--yf-saffron`, hue **35.9°**) are **3.9° apart** — the same colour by the ≤15° rule — and both fail 3:1 against a light card (**2.01** / **1.98**) | Give food and rest distinguishable hues, and deepen both for light theme | Two of the seven stop kinds are visually the same *and* both nearly invisible on white. In dark both pass (7.81 / 7.96), so this is light-theme only. Root cause **SYS-6** |
| **MED** | `styles.css:1028` `.stop-card.kind-viewpoint` | Uses `--yf-teal-600` — the same hue as every interactive/focused teal: `.stop-card:hover` border (`:728`), `.board-col--focused` outline (`:1147`), the drop marker, the selected chip | Give "viewpoint" its own hue | Colour collision: teal means both "this stop is a viewpoint" and "this thing is focused / selected / interactive". The kind label text is also rendered, so meaning isn't lost — but the border colour lies |
| **MED** | `styles.css:997-1002` `.day-warn-pill` | `--warn` `#B47207` on `--yf-amber-100` = **3.69:1** (needs 4.5) | Same deeper-amber remedy | The per-day warning label in the column header. Light theme only; dark measures 5.81. Root cause **SYS-6** |

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:782` `.move-btn` | **22 × 24px**, and absent from the `@media (pointer: coarse)` hit-area list (`:560`) | Add `.move-btn` to that list | Three of these per board card (up / down / move-day) plus delete — four 22×24 targets per card on touch, where the app's other controls get a 6px pseudo-extension. The in-code comment calls it "the same 22×24 tap target as its siblings", so the size is deliberate but the touch budget was never applied |
| **LOW** | `styles.css:811` | `outline: 2px solid var(--focus, var(--teal))` — but **`--focus` is never defined anywhere** (`grep`: 0 hits) | Use `--ring` (the token every other focus style uses) or define `--focus` | A dangling token reference. It works via the fallback, but it reads as themeable and isn't — and it's the one focus style that bypasses `--ring` |
| **LOW** | `BoardView.tsx:152,364,394,416,422,435` | Six `title` attributes used as tooltips | Keep `title`, but surface the important ones visually | Touch has no hover, so "Move to another day" and "Delete — you'll see the impact first" are unreachable in the APK. `aria-label` covers AT, so this is a sighted-touch gap only |

### Typography

**Verified, no finding:** `.board-stop-kicker` is in the kicker unification list (`:4651`) and renders
correctly; `.board-stop-title-btn:hover .stop-title` uses a **dotted** underline with `text-underline-offset`
— exactly the pattern the typography rules recommend for an "extra information" hint, and `text-decoration`
is legitimate here because nothing animates.

### Motion

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `BoardView.tsx:353` | The FLIP pass hardcodes `{ duration: 240, easing: 'cubic-bezier(.22, .61, .36, 1)' }` | Read `--t-*`/`--ease-*` into JS (the project already has `lib/motion.ts`) | The easing string is `--ease-out` duplicated **byte-for-byte** in JavaScript, and `240` matches no token (180 / 300 / 440). This is the only place motion lives in JS, and it is the one place that can't be retuned from CSS. `prefersReducedMotion()` **is** correctly checked (`:343`) |

**Verified, no finding — worth protecting:** the board's z-ladder is correct and deliberate
(`--z-under` map backdrop → `--z-topbar` → `--z-raised` columns, `:1085/:1095/:1127`), so no panel can
cover a column; `role="list"` / `role="listitem"` on the columns is right; and the drag design (DOM order
never changes mid-drag, a marker carries in-drag feedback, FLIP fires once on commit) is a genuinely
better pattern than the timeline's — it is the reference implementation for the PR #100 work.

---

## Page 6 — Trip Workspace · Budget (`src/pages/trip/BudgetTab.tsx`)

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `BudgetTab.tsx:28-37` `CAT_META` → `styles.css:47-54` `--cat-*` | **Three of eight** expense categories collide in hue: `food` 33.9° vs `local-travel` 37.1° = **3.2°**; `food` vs `emergency-buffer` 39.9° = **6.0°**; `local-travel` vs `emergency-buffer` **2.8°** | Re-space the eight hues so each pair clears 15° | Three of eight spend categories are the same colour by the ≤15° rule, in a chart whose entire job is telling them apart. Same defect family as the Board's stop kinds, but with three collisions instead of one |
| **HIGH** | `BudgetTab.tsx:239,279` `.cat-chip` | The icon renders in the **full** category colour on a 15% tint of itself. In light theme three of eight fail 3:1: `food` **1.91**, `emergency-buffer` **1.82**, `tolls-parking` **2.76** | Darken the icon ink in light theme, or raise the tint | In the expense **table** (`:279`, `.sm` chip) the chip is the *only* category indicator on the row — the name isn't shown — so a category becomes unidentifiable, not merely decorative. All eight pass in dark (3.12–5.86) |
| **HIGH** | `styles.css:1597-1607` `.budget-bar-fill` · `:3820` `.daybar-fill` · `:3833` `.daybar-avg` | Fills fail 3:1 against the `--bg-soft` track **in light**: `--saffron-500` **1.85** (the "Optional" bar and every over-average day bar), `--saffron-600` **2.40** (the daily-average tick), plus `food` 1.85, `emergency-buffer` 1.74, `tolls-parking` 2.77 | Same deeper-light-theme inks as SYS-6 | Five bars and the average marker are below the non-text floor in light theme; all pass in dark (5.38–8.78). Root cause **SYS-6**, extended below to cover fills |
| **MED** | `styles.css:3813-3814` `.metric-good` · `:3872` `.balance-pos` | `--ok` `#2E8B57` on a white card = **4.25:1** at 12px and 13.5px | Deepen `--ok` for light-theme text | The "under target" percentage and every "gets ₹X" balance fail AA in light theme; dark passes at 6.77. `--ok` is the third light-theme ink in the SYS-6 family, after amber and saffron |
| **MED** | `BudgetTab.tsx:207,326,378,383` | Components apply **primitive** tokens directly via inline JS: `'var(--saffron-500)'`, `'var(--teal-500)'`, and inconsistently `'var(--yf-coral)'` | Point semantic tokens at the primitives and use those | Primitives are never meant to be applied in a component, and this mixes two primitive naming schemes in one file. Because it lives in JS, no CSS tooling can see it |
| **MED** | `BudgetTab.tsx:207` `.daybar-fill` | "Over the daily average" is encoded by the fill colour (saffron vs teal) with no other in-bar cue | Add a shape/marker cue, or label the bar | Colour is the only carrier inside the bar. The nudge paragraph below names only the single worst day, so other over-average days rely on colour alone |

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:3926` | At ≤1100px `.catbars .budget-bar-row` becomes `grid-template-columns: 44px 1fr auto`, but `.cat-name` (`:3840`) still renders a 22px `.cat-chip` + 8px gap + the **full** category name with no `min-width: 0` or overflow handling | Give the category row its own breakpoint (or drop the chip below 1100px) | The `44px` track is fixed, so it cannot grow: after the 22px chip and the gap, ~14px remains for "Accommodation". The same `44px` value was applied to `.daybar-row` (`:3924`), where the label is "Day 1" and fits — one value, two different label lengths. *Inferred from the cascade; not rendered* |
| **MED** | `BudgetTab.tsx:168` | `<div className="metric-strip" aria-label="Budget at a glance">` | Add `role="group"`, or use `<section>` | `aria-label` on a role-less `<div>` is ignored by assistive tech — the label is dead code |
| **LOW** | `BudgetTab.tsx:263` | `<thead>` ends with an empty `<th />` for the actions column | Give it a visually-hidden label | A column header with no accessible name |

**Verified, no finding — and worth protecting:** the metric strip **is** properly responsive
(`repeat(5,1fr)` → 3 at ≤1400px → 2 at ≤1100px, `:3812,3921,3922`); `.budget-hero` correctly uses
**literal** gradient stops per the SYS-5 rule, and every text pair on it passes (label 8.10–10.04,
sub 8.82–10.94, pct 7.66–9.50, num 11.38–14.11, both action pills 5.62–6.86).

### Motion

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:1599` `.budget-bar-fill` | `transition: width .4s ease` | `var(--t-slow)` + `var(--ease-out)` | A **sixth** raw duration (`.5s`, `.4s`, `.3s`, `240ms`, `160ms`, `.15s` now all coexist). `.4s` sits between `--t-med` (300) and `--t-slow` (440) and matches neither |

---

## Page 7 — Trip Workspace · Map (`src/pages/trip/MapTab.tsx`)

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:2461` `.poi-col--see .ride-purpose-sight` | `color: #5540B8` — a **hardcoded** dark purple — on a chip of 16% `#7C5CFC` over the column tint = **1.99:1 light-adjacent, 1.84:1 in dark**. There is **no `[data-theme='dark']` override** | Tokenise the ink and add the dark value | The "places to see" purpose label is unreadable in dark theme. It survives in light (5.38) only by luck of the background being pale |
| **MED** | `styles.css:2443,2444,2447,2455,2461` | `#7C5CFC` is hardcoded **five times** — and the same hex is `DAY_COLORS[2]` in `TripMap.tsx:34`, i.e. the **Day 3 route colour** | Promote it to a token, distinct from the day palette | One purple means "Day 3" on the map and "places to see" in the POI panel, and the sibling column (`.poi-col--needs`) *is* tokenised (`var(--teal)`) — so the two halves of one feature are built two different ways. See **SYS-8** |
| **LOW** | `styles.css:2444` | `.poi-col--see` border = 1.56:1 (light) / 1.90:1 (dark) against its own background | — | Below the 3:1 non-text floor, but the column is identified by its heading text and tint, so the border is decorative. Recorded for completeness, not as a defect |

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:875-882` `.tps-dep input[type="time"]` · `:900-904` `.travel-panel-add input[type="number"]` | Two inputs are hand-styled instead of using `.input`: `border: 1px` (vs 1.5px), `border-radius: 8px` (vs `--radius-sm` 12px), `font-size: 13px` (vs 14.5px), and **no `.input:focus` ring** | Use `className="input"` (with a compact modifier if the size is deliberate) | The travel panel's departure-time and halt-minutes fields read as a different control family from every other input in the app. The UA outline still shows on focus, so this is a consistency defect rather than a lost indicator — but the focus ring is the app's own language and these two opt out of it |

### Register

- **A16** ticked: `MapTab.tsx:796` is `className="select"` inside `<Field label="Add to which day?">`,
  so `Field` wires its label correctly (host element). Inherits the systemic native-popup issue (**A**) only.
- **B14** ticked, and it **passes**: `.map-legend-toggle.map-live-on` (`styles.css:1516-1519`) carries an
  explicit `[data-theme='dark'] { color: #06251f }` — **5.19:1 light / 6.62:1 dark**. This is the
  correct pattern, and it is the exact fix `.vote-btn.on`, `.mode-btn.on` and `.crew-btn.on` are missing.

---

## Page 8 — Trip Workspace · Timeline (`src/pages/trip/TimelineTab.tsx`)

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:997-1004` `.day-warn-pill` · `:994` `.day-rail-chip.warn` · `:978-984` `.tl-total-warn` | All three use `--warn` on `--yf-amber-100` = **3.69:1** in light | Same deeper-amber remedy as SYS-6 | The amber-on-amber-100 pair is repeated in **three** separate Timeline components — the sticky total strip, the day rail and the day header. One token fix clears all three. Dark passes (5.81) |
| **HIGH** | `styles.css:949` `.day-progress-fill.sev-medium` | `--saffron` on the `--bg-soft` track = **1.85:1** in light (needs 3:1) | Deepen the fill for light theme | The "medium severity" day-progress bar is invisible in light theme, so a partly-full day reads the same as an empty one. Dark passes at 8.78. Root cause **SYS-6** |
| **MED** | `styles.css:1021-1028` (shared with Board) | The stop-kind **spine** — `border-left: 4px solid var(--kind-c)` — fails 3:1 in light for `kind-food` **2.01** and `kind-rest` **1.98** | See SYS-6 | The comment at `:1027-1029` says *"the spine carries the hue"* — and for 2 of 7 kinds it doesn't carry anything legible on a light card |
| **MED** | `styles.css:1029-1040` vs `:1021-1028` | The same seven kinds are encoded **two different ways**: Timeline/Board use a full-colour 4px spine *and* a soft-tint tag; the tag text is `--text-2` on tints | Pick one encoding per surface | The tag is verified safe (worst 6.36:1 light / 7.01:1 dark — its comment's AA claim holds exactly), so the card carries a safe encoding *and* an unsafe one side by side |

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:875-882`, `:900-904` | Same raw-input styling as the Map tab's travel panel | — | Shared component, shared defect — recorded once here, referenced from the Map section |
| **LOW** | `styles.css:906,921,924` | `.tl-row`, `.tl-legrow` and `.tl-end` each independently redeclare `grid-template-columns: 74px 1fr; gap: 12px` | One shared rule | Three copies of one geometry; changing the time-rail width means finding all three |

### Motion

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:947` `.day-progress-fill` | `transition: width .3s ease` | `var(--t-med)` + `var(--ease-out)` | A seventh raw duration, and this one animates on every recompute — the most-seen transition on the tab |

**Verified, no finding:** `.tl-total-label` and `.day-cost-chip` both use `--teal-deep` on light surfaces
(5.14–5.19:1) and both carry dark overrides (`:1016`, `:4234`-style) — the teal ink pattern applied
correctly. `.tl-time.tl-dep` measures 5.14:1.

---

## Page 9 — Trip Workspace · Group input (`src/pages/trip/GroupInputTab.tsx`)

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:1580` `.vote-btn.on` | `#fff` on `var(--teal)` = **4.08:1 light / 2.45:1 dark** | Add the `[data-theme='dark'] { color: #06251f }` override the legend already has | The **selected vote** is the single most important state in the whole group-input flow, and it fails AA in both themes. `.map-legend-toggle.map-live-on` (`:1516-1519`) measures 5.19 / **6.62** doing exactly this — the fix is already written in the same file |
| **HIGH** | `GroupInputTab.tsx:240` + `styles.css:1582` `.consensus-bar` | The `<35%` segment is `var(--line)` on the `--bg-soft` track = **1.18:1 light / 1.50:1 dark** — invisible in both themes | Use a mid-tone that clears 3:1, or drop the segment | "Low consensus" renders as *no bar at all* rather than a short one, so the weakest state is indistinguishable from the strongest absence. The 35–59% segment (`--saffron`, 1.85:1 light) fails too; only ≥60% (`--ok`, 3.67 light / 7.44 dark) passes |

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:1578` `.vote-btn` | **34 × 30px**, and absent from the `@media (pointer: coarse)` list (`:560`) | Add to the hit-area list | The primary voting control on touch. Same omission as `.move-btn` (SYS-4) |

### Motion

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:1578-1580` `.vote-btn` | Has `:hover` and `.on` states, and **no `transition`** | One shared transition | **SYS-7** — casting a vote snaps while the chip two rows above eases |

### Register

- **A14–A15** ticked: both are `className="select"` inside `<Field>` (`GroupInputTab.tsx:420,425`), so
  `Field` wires their labels. Inherit the systemic native-popup issue (**A**) only.
- **B17** (`.filter-pillbar`) inspected on **Creator Hub** (Page 16): it is a `PillNav`, so its active chip
  reuses the B16 glider fix (transparent bg → pale glider shows, deep-teal ink ≈5.1:1 light / 6.56 dark).
  **NON-defect** — ticked above. (The base `.clickable-chip.on-teal` `:658` is white-on-teal-600 = 4.08:1,
  but only the non-`PillNav` fallback hits that; every real usage is glider-scoped.)

**Verified, no finding:** the consensus bar carries `role="img"` with a real
`aria-label={`Consensus ${consensusPct}% of members upvoted`}` (`:238`) — the colour-encoded bar is
described in text, so the meaning is not colour-only.

---

## Page 10 — Trip Workspace · Share + Trip settings (`src/pages/trip/ShareTab.tsx`, `TripSettingsForm.tsx`)

Rebuilt from a two-column grid into an ARIA tablist (Plan together · Share publicly · Keep a record ·
Trip settings). The settings form reuses the Plan Bench's own classes (blocks, eyebrow, mode grid, crew
buttons, slider dials, receipt) at their homepage proportions, plus a sticky live "settings bill".

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `styles.css:4046` `.share-tab.is-active` | `var(--color-primary)` #0D8D82 on white = **4.08:1** | `--yf-teal-700` | 14px/600 normal text. Same teal-600-on-white borderline as the shell (SHELL-A2); the `border-bottom` also carries the active state, so it is a polish-grade miss, not a stranded state |
| **LOW** | `ShareTab.tsx:316` `.role-select` (Members & roles) | Closed pill is on-brand (glass, token chevron) — **good** | — | The **popup is OS-rendered**: there is **no `.role-select option` rule** (only `.select option` at `:610`), so the editor/commenter/viewer list opens as a stock OS menu — exactly the "still looks html type" gap. A17 / SYS-7 instance |

**Verified, no finding:** the three `.share-intent` badges all pass — `--teal`/`--saffron`/`--info`
variants use soft tints with deep ink (teal-deep 5.1:1, `--warn` on saffron-soft 5+:1, text-2 on info-soft
5+:1) in both themes; the `Chip` tones (teal/info/saffron) used for member roles and "Creator" pass;
`chip-saffron` carries its light-theme `#8F5B06` remedy (5.08:1). The PublicationForm reuses
`.input`/`.textarea` + `Field` consistently, and the live receipt reuses the theme-aware bench-receipt
vars (dark override at `:2961`).

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** | `TripSettingsForm.tsx:123,263,280` `.form-row` | **Duplicate definition** (`styles.css:616` grid vs `:4186` flex, no-wrap) — the grid rule is dead, so the date row and the two vehicle-profile rows render in a **non-wrapping flex** row | Add `flex-wrap: wrap` to the survivor | The 2-up rows (Start/End date; Vehicle type/Fuel; Tank/Economy) compress instead of wrapping below ~900px. Same defect as the Create-Trip commitment row (Page 2, layout HIGH) — the responsive intent is silently gone |
| **LOW** | `ShareTab.tsx:274-283` `.share-tablist` | Scrolls horizontally on narrow screens (`overflow-x: auto`) with no visible affordance | Add a fade or keep the active tab in view | Long tab labels can push the active tab off-screen on a 360px phone. Keyboard nav is fine; sighted scroll is the gap |

### Typography

**Verified, no finding:** the tablist is a real ARIA tablist (roving tabindex, Arrow/Home/End);
`.share-intent` labels are 10.5px/800 kicker-spec; the live "settings bill" mirrors every choice before
save. The `.btn.on-teal` missing-rule class of defect does **not** appear here.

### Motion

**Verified, no finding:** `.share-tab` eases `color`/`border-color` over `--t-fast`; `.ts-form
.tab-btn:disabled` gets `opacity:.55; cursor:not-allowed` so the travel-style rail reads as disabled when
the trip isn't editable.

**Register:** A17 (`.role-select`) ticked — inherits SYS-7 popup issue only. A19–A20 (TripSettingsForm
vehicle/fuel `.select`s) ticked — `.select option` exists so Chromium tints the popup; still OS chrome
(SYS-7). B4 ConfirmDialog ticked (remove-member / unpublish). B6 `.cover-picker` ticked — `CoverImagePicker`
renders inside `Field`, themed like the rest (no popup).

---

## Page 11 — Public Itinerary (`src/pages/PublicItinerary.tsx`)

A shareable travel document: destination-led hero, creator attribution, an editorial "why this route
works" story, a practical stat cluster, curated day highlights, and the day-by-day plan with a premium
lock. Read-only by design.

### Colour

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **HIGH** | `styles.css:382-385` `.card.route-snap` + `:2651-2653` `.route-glance-*` | Gradient ends in `var(--gray-900)`, which flips to `#ECF1F8` in dark; `color:#fff` → **~1.05:1** at the bottom ~88%. The glance text is **hardcoded light teal** (`#bbe0d9` label, `#d5e7e4` list, `#9fc4bf` meta) — `#9fc4bf` on the near-white dark-mode gradient = **1.66:1** | End the gradient in a **literal** dark navy (as `.hero-adventure`/`.cta-band`/`.budget-hero` already do) and make the glance text token-driven (teal-100/`-200` in dark) | The "route at a glance" aside is **unreadable in dark mode** on two independent fronts — white text *and* hardcoded light-teal text on a near-white surface. This is **SYS-5 on a public-facing page**; the route-snap rule is one of the two already named in SYS-5, but the hardcoded glance colours are a second miss on the same element |
| **MED** | `styles.css:2644` `.editorial-kicker` (public) | `var(--yf-teal-600)` #0D8D82 on paper-sheet = **4.08:1** | `--yf-teal-700` | 12px/800 normal text. Same borderline as SHELL-A2; the team fixed it for the receipt kicker and didn't propagate |
| **LOW** | `PublicItinerary.tsx:1797-1801` `.pub-hero-stats` | The floating "practical bit" card is **hardcoded near-white** (`rgba(255,253,245,.96)`) in **both** themes; its text is hardcoded dark, so it reads fine — but the card never goes dark | Consider a dark-theme variant | A bright white card floating over the dark hero is a deliberate "paper" look that survives the theme flip. Not a contrast bug, but the only surface on the page that ignores the theme — worth a conscious decision, not an accident |

**Verified, no finding:** `.pub-hero` gradient (navy→teal→amber) keeps white text legible — the amber
stop `#b97a3f` only appears past 100% and the large title clears 3:1; `.pub-hero-badge` #8e5b21 on #fff7e6
= 5.35:1; `.day-badge` #fff on navy = 5.8:1 both themes; `.stop-kind-tag` keeps `--text-2` ink on every
pastel tint (worst 6.36:1 light / 7.01:1 dark — the safe encoding the Timeline/Board comment claimed);
`.save-btn`/`fork-btn` pass; `.locked-overlay`/`.locked-cta` text inherits and stays legible over both
themes' scrims.

### Layout

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **LOW** | `PublicItinerary.tsx:268` `.day-section` | `position: relative; overflow: hidden` on every day — the locked overlay's `blur` clips to the day box | — | Intentional (the blur stays inside the day card); noted only so a later "why is the blur squared off" doesn't get "fixed" accidentally |

### Typography

**Verified, no finding:** `editorial-title`/`editorial-body`/`day-highlight-card` all use the system
`h2`/`--text`/`--text-2` assignment; day numbers use `.day-badge` (display font, large); the highlight
cards reuse `.editorial-kicker` + `.stop-kind-tag` consistently with the rest of the app.

### Motion

**Verified, no finding:** the page inherits the global `.route-panel` entrance (keyed remount) and the
theme View Transition; no raw-duration overrides were introduced here. `.locked-overlay` and the
fork/save buttons use the shared `.btn`/`.chip-btn` motion.

**Register:** B15 `.pr-sheet`/`.pr-sheet-portal` — not a separate surface on this page (it uses
`.paper-sheet`, already ticked under B20). B20 `.paper-sheet`/`.locked-overlay` ticked. The public page
has **no** native `<select>` (it is a read-only document), so no A items.

---

## Page 12 — Landing (`src/pages/Landing.tsx` + `src/components/PlanBench.tsx`)

One continuous atmospheric canvas (`.landing-canvas`, `background-attachment: fixed`) carries the hero,
Plan Bench, feature/steps grids and CTA band as a single seam-free surface; the floating nav pill (SHELL)
is pulled up *behind* it (`margin-top: calc(-1 * (var(--nav-h) + 12px))`) so there is no white band above
the pill. The Plan Bench receipt reuses the bench tokens already audited on the Trip settings form
(Page 10) — only the Landing-unique surfaces and the receipt's *new* sub-parts are measured here. No
native `<select>` and none of the owed overlays (`B10`/`B11`/`B17`/`B19`) live on this page, so the
register is not ticked for Landing.

### Colour

| # | Surface | Token pair (light / dark) | Measured | Verdict |
|---|---|---|---|---|
| L1 | `.step-num` ordinal badge (1–4) | `background: var(--teal)` = `#0D8D82` / `#2BB8AC`; `color:#fff` | white-on-teal **4.08:1 light · 2.45:1 dark** | **HIGH** — SYS-3. The number is 14px/800 bold, which is *not* large text (AA normal needs 4.5). Fails **both** themes. Same root cause as `.notif-badge` but on the teal-500 family. Fix: ink (`var(--text)`) on `var(--yf-teal-100)`, or a darker teal token — `var(--yf-teal-700)` alone only lifts the dark row to 3.34:1, still under 4.5. |
| L2 | `.chip-saffron` hero eyebrow ("Built for Indian travellers") | corrected by `:636` → light `#8F5B06` on `var(--saffron-soft)` `#FCF0DC`; dark `var(--warn)` `#D99A2B` on `#3A2C15` | **5.09:1 light · 5.56:1 dark** | **NON-defect** — the per-theme amber fix at `:636` (deeper `#8F5B06` in light; the SYS-6 remedy) lifts it from the raw `--warn` 3.47:1 to 5.09:1. Passes both themes. (An earlier draft flagged this as MED using the un-overridden `--warn`; the `:636` rule makes that a false positive.) |
| L3 | `.hero h1` "flow together" span | `var(--yf-teal-600)` = `#0D8D82` / `#2BB8AC` on the cream→peach ramp | ~3.81:1 on cream (worst case over a mint blob ≈ 4.08:1) | **NON-defect** — the word is `clamp(2.4rem,5vw,3.7rem)` (≥24px), i.e. large text; AA-large needs only 3:1. Passes. (Had this been body text it would have been the SYS-3 miss — but the large-text exemption applies.) |
| L4 | `.hero-bench-cta` boarding pass | label `var(--text)`; `.hbc-sub`/`hbc-code span` `var(--text-3)`; `.hbc-code b` `var(--yf-teal-700)`; `.hbc-arrow` `var(--yf-teal-600)`; stub `var(--yf-teal-100)`+ink icon | 5.53 / 5.91 (text-3) · 5.83 / 4.73 (teal-700) · 4.08 / 6.42 (teal-600, graphic ≥3) | **NON-defect** — every cell passes; the bespoke boarding-pass is the best-measured new component on the page. |
| L5 | `.dest-ticker` items + tags | item `var(--text-2)` on `var(--card)`; `.t-tag` `var(--yf-teal-700)`; `.t-off` light `#6F60A6` / dark `var(--yf-purple)` | 7.46 / 8.16 (text-2) · 5.83 / 6.09 (teal-700) · 5.41 (light `#6F60A6` on white) | **NON-defect** — the per-theme tag-colour fix at `:3485-3486` (deeper violet for light, brighter teal for dark) is the *correct* handling; `.ticker-sep` saffron is a decorative SVG (exempt). |
| L6 | `.feature-card` / `.step-card` body | `var(--text-2)` on `var(--card)`; `.feature-ico` `var(--teal-soft)` + `currentColor` icon | 7.46 / 8.16 | **NON-defect**. |
| L7 | `.cta-band` (Demo CTA) | forced-dark **both** themes: `linear-gradient(150deg,#143f4c,#112c4c)` + `color:#fff`; `:1422-1431` | white on `#112c4c` ≈ **14.3:1** | **NON-defect — model implementation.** Literal stops, not `--gray-900` (which flips near-white in dark). This is exactly the SYS-5 fix; contrast with the *broken* Public Itinerary `.route-snap`, which used the token and stranded white. |
| L8 | `.hero-adventure` (RouteSquiggle frame) + `.ha-*` rows | forced-dark `linear-gradient(150deg,var(--yf-navy),#0c1e35)` + `#fff`; `.ha-warn`/`ha-sync` have dark mirrors `:1387-1390` | white ≈ 13:1; `.ha-kicker` 10.5px @.75 ≈ 13.4:1; `.ha-warn` `#3A2506` on `#FFF4E4` / `#FFD9A0` on `#3B2B12` | **NON-defect — second correct SYS-5 surface.** The `:1385-1390` dark mirrors avoid the dark-on-dark ghost text the UI audit flagged. |
| L9 | Plan Bench receipt *new* sub-parts | `.bench-badge` `var(--yf-teal-700)`; `.bench-split-legend` / `.bench-fineprint` = `receipt-ink-soft` / `-faint`; `.bench-dock-figures` `var(--text)`/`var(--text-3)`; `.odo` `var(--receipt-hero)`; `.bench-gauge` `var(--receipt-accent)` | all ≥ 5:1 (light) / ≥ 9:1 (dark composite) | **NON-defect** — the receipt correctly consumes the audited bench tokens; `.bench-receipt-kicker` already uses the fixed `var(--receipt-accent)` = teal-700 (meta-pattern). |

### Layout

- `.landing-canvas` negative margin pulls the hero up behind the floating nav pill → seamless, no hard
  edge where the hero ends. Intentional and correct.
- `.hero-split` is `grid: 1.05fr .95fr; gap:44px; align-items:center` — reads well on desktop; collapses to
  one column at narrow widths (verify the exact breakpoint; not declared in the hero block itself).
- `.feature-strip` / `.steps-grid` use `repeat(auto-fit, minmax(250/210px,1fr))` → fluid, no orphan columns.
- `.cta-band`, `.feature-strip`, `.steps-grid` set `content-visibility:auto` — measured first-paint win on
  the phone WebView. Good.
- `.bench-dock` is a `position:fixed` mobile total bar, `display:none` ≥721px — one-screen rule for the
  calculator. Good.
- **LOW (perf risk, not contrast):** `.landing-canvas` `background-attachment: fixed` plus two `blur(70px)`
  blobs is a known jank/repaint cost on the Android WebView (the app's target) and unreliable on iOS
  WebView. "Not verified" without a device — flag for a low-end-phone check, not a fail.
- **LOW:** hero `invite-entry` form and `footer` use inline `style` (`display:flex; gap; maxWidth`) that
  bypass the spacing token scale (SYS-2). Visual only.

### Typography

- `.ha-kicker` (10.5px/800 uppercase @.75) on forced-dark navy → 13.4:1, passes. `.ha-stats span`
  (9.5px @.72) and `.ha-warn`/`.ha-sync` rows also pass (dark mirrors present).
- `.section-title` (`clamp(1.45rem,3vw,1.9rem)`, centred) + `.reveal-underline` draws the underline via
  `::after` (caps via CSS, **not** typed text) — follows the project's own rule (`styles.css:4659`). Good.
- `.feature-card h3` 15.5px / `.step-card h3` 15px — consistent with card titles elsewhere; no SYS-1
  (`.eyebrow` base) hit because Landing uses `.chip-saffron` and `.bench-eyebrow` (both defined).
- `.bench-eyebrow` 11px uppercase `var(--text-3)` → 5.53:1 light, passes.
- **LOW (SYS-2):** the `h1` sets `fontSize: clamp(2.4rem,5vw,3.7rem)`, `margin`, `lineHeight` inline and the
  "flow together" span sets `color` inline — bypasses `--text-*` and the colour tokens. Works, but it is
  the same token-abandonment pattern audited app-wide (342 raw `font-size`).

### Motion

- `.hero-rise` stagger (`hero-rise .65s var(--ease-out) both` + `.rise-d1..5` delays) — consistent with the
  project's entrance convention and uses the `--ease-out` token. Good.
- Every looping animation (`blob-drift` 16s/22s, `ticker-scroll` 38s, `hbc-slide` 3.5s, `hbc-plane` 5.5s,
  `hbc-nudge` 1.6s) is wrapped in `@media (prefers-reduced-motion: no-preference)`. Good.
- **LOW (SYS-6):** those same loops use raw `ease-in-out`/`linear` and raw durations rather than the
  `--ease-*` / `--t-*` tokens (7 raw durations app-wide). Inconsistent, not broken.
- Reduced-motion path for the ticker sets `.ticker-track{animation:none}` (`:3442`) — the strip freezes but
  stays readable and is `aria-label`led; the duplicate set is `aria-hidden`. Good.
- Reveal system: `useReveal()` arms `body.reveal-armed` **only** when motion is allowed and bails out under
  reduced-motion, so content is never hidden if JS is off or motion is reduced. Good a11y pattern.
- `scroll-behavior:smooth` is also gated `no-preference` (`:3350`). Good.

**Verdict: Approve** — only L1 (`.step-num`) is a HIGH; L2 was a false flag (the `:636` amber fix already
passes). Fix L1 (ink on `var(--yf-teal-100)`) to fully approve.

---

## Page 13 — Profile & settings (`src/pages/Profile.tsx`)

Reuses the generic settings chrome (`.form-page`, `.two-col`, `.card`, `Field`, `Chip`, `Avatar`, `.btn-*`) —
no bespoke CSS classes of its own. The audit therefore checks (a) the shared components it leans on and
(b) colour-system breaks that surface here. The `Chip` component renders `clickable-chip` (tone-less) when
it has an `onClick` and `chip chip-<tone>` only when static — so the travel-style / clock-format chips
(clickable) and the Creator-hub status chip (static `ok`/`info`) exercise different code paths.

### Colour

| # | Surface | Token pair (light / dark) | Measured | Verdict |
|---|---|---|---|---|
| P1 | `.chip-ok` status badge ("Enabled") | `color: var(--ok)` = `#2E8B57` / `#52BE80`; `background: var(--ok-soft)` = `#E3F2EA` / `#16301F` | **3.67:1 light · 6.13:1 dark** | **MED** — light only. Green on its soft tint drops under 4.5 for the 12px chip label; dark passes. No per-theme override exists (unlike `.chip-saffron` `:636`). Fix: deepen `var(--ok)` to ~`#1F6B41` in light, or use `var(--text)`. |
| P2 | `.clickable-chip` selected (travel styles / clock) | active `:658` light `var(--teal-deep)` `#0E7A72`+#fff; dark `:659` `var(--teal)` `#2BB8AC`+`#06251f` | **5.20:1 light · 6.56:1 dark** | **NON-defect** — the "one selected-state pattern" (`styles.css:657`) is correctly themed both ways; the dark branch swaps to dark text so it never hits white-on-mid-teal. |
| P3 | `.clickable-chip` idle (not selected) | `background: var(--card)`; inherits `var(--text)` | ≥ 12:1 | **NON-defect**. |
| P4 | `Avatar` initials (`sm` 11px / `lg` 16px) | `background: var(--teal-soft)`; `color: var(--teal-deep)` | 4.70 light / 6.64 dark | **NON-defect** — passes AA at both sizes. |
| P5 | `.chip-info` ("Off") | `var(--info-soft)` + `var(--text-2)` | 6.47 light / 7.36 dark | **NON-defect**. |
| P6 | `.hint-text` helper copy | `var(--text-3)` 12.5px | 5.53 light / 5.91 dark | **NON-defect**. |
| P7 | `.creator-line` + `Field` label/err | text-2 / ink | ≥ 5.5 | **NON-defect**; `Field` wires `id`+`htmlFor`+`aria-describedby`/`aria-invalid` (`ui.tsx:124-152`) — label association correct (resolves the meta-pattern worry about custom children not forwarding `id`). |

### Layout

- `.two-col` (`grid: 1fr 340px`, gap 18px) **collapses to one column at ≤980px** (`:3638`) — no mobile
  overflow. Good.
- Cards use `marginTop:16` between them via **inline `style`** on every card (`Profile.tsx:64,74,112,130,172`)
  plus inline `marginBottom`/`marginLeft`/`gap` throughout — bypasses the spacing token scale (SYS-2). The
  most inline-spacing-heavy page audited so far; a `.card-stack` gap utility would remove ~9 repeated
  `marginTop:16` declarations.
- The notification row and Creator-hub header use `.row-between` (flex space-between, wraps) — fine.

### Typography

- `h1` "Profile & settings" uses the default heading scale; card `<h3>` titles are consistent with the rest
  of the app. No `.eyebrow` base reliance.
- Chips are 12–12.5px/600 — consistent with `.chip`/`.clickable-chip`.
- Inline `style` on the intro `<p>` (`marginBottom:20`) and several fields — SYS-2, visual only.

### Motion

- No bespoke animation on this page. `Chip`/`.clickable-chip` transitions use `var(--t-fast)`/`--ease-out`
  (`:642`) — on-token. Good.
- Notification toggle conveys state by **text** ("On"/"Off") **and** `aria-pressed`, not colour alone — the
  filled `btn-primary` vs outline `btn-outline` is supplementary. Good a11y.

**Verdict: Approve** — 0 HIGH; P1 (`.chip-ok` light) is a MED. No HIGH blocks the page.

---

## Page 14 — Auth (`src/pages/Auth.tsx`)

A centred auth card with a `PillNav` tablist (Log in / Sign up), three `Field` inputs and a primary submit.
Reuses `PillNav` (audited as B16) and `Field` (label association verified on Profile). No native `<select>`
and no custom overlay, so the register is untouched.

### Colour

| # | Surface | Token pair (light / dark) | Measured | Verdict |
|---|---|---|---|---|
| A1 | `.err-text` (no-backend warning + inline errors) | `color: var(--danger)` = `#C93B3B` / `#E06C6C` on `var(--card)` | **5.04:1 light · 4.89:1 dark** | **NON-defect** — passes AA (≥4.5) both themes; the upfront "no backend" banner is readable. |
| A2 | Active tab (`.tab-btn.active` on `.pill-glider`) | light `var(--teal-deep)` `#0E7A72` on `var(--teal-soft)` `#E5F4EE`; dark `#06251f` on `var(--teal)` `#2BB8AC` | **4.70:1 light · 6.56:1 dark** | **NON-defect** — the documented B16 fix (`:500-506`): pale glider + deep-teal ink in light avoids the 1.2:1 white-on-pale failure; saturated glider + dark ink in dark. |
| A3 | Inactive tab (`.tab-btn`) | `var(--text-3)` on `var(--card)` | 5.53 / 5.91 | **NON-defect**. |
| A4 | Links inside `.hint-text` (forgot-password / mail-support) | global `a { color: var(--teal-deep); text-decoration: none }` | 4.70 / 7.67 | **NON-defect (contrast)** — teal is colour-distinct from the gray hint text and passes AA. Note: relies on colour alone (no underline) — unlike the PubCard `.muted` link, this one *is* distinguishable, but an underline would firm it up. LOW polish. |
| A5 | `.input` + `Field` labels | ink on card; `Field` wires `id`/`htmlFor`/`aria-describedby` | ≥ 12 | **NON-defect** — label association correct; `autoComplete` + `type=password/email` set. |

### Layout

- `.auth-wrap` (`flex; center; padding:54px 18px`) + `.auth-card` (`max-width:430px`) — a well-centred,
  single-column form. Good.
- `PillNav` renders `role="tablist"` + `aria-label` + per-tab `aria-pressed` — correct tab semantics
  (cross-ref B16); the glider is `aria-hidden`. Good.
- Submit button uses `disabled={saving}`; `.btn:disabled` is styled (SYS-7 lists `.btn` among the
  disabled-aware controls), so the in-flight state is drawn. Good.
- **LOW (SYS-2):** the `h1` sets `fontSize:26` inline and several blocks use inline `marginTop`/
  `marginBottom`/`width:'100%'` — bypasses the type/spacing tokens. Visual only.

### Typography

- `.muted.small` intro and `.hint-text` helper copy are `var(--text-3)` (5.53 / 5.91) — pass.
- Inline `h1` size (26px) overrides the heading scale — SYS-2.

### Motion

- `.pill-glider` slides with a **raw** `cubic-bezier(0.2,0,0,1)` + `260ms` (`:490`) — SYS-6 (not a `--t-*`/
  `--ease-*` token). The component comment claims the global reduced-motion guard freezes it, but no
  `.pill-glider` rule appears in the reduced-motion media blocks reviewed — **Not verified** whether the
  slide is suppressed for reduced-motion users; recommend a `prefers-reduced-motion` check. LOW.

**Verdict: Approve** — 0 HIGH, 0 MED. Clean page; only SYS-2/SYS-6 polish + the colour-only link note.

---

## Page 15 — Creator public page (`src/pages/CreatorPage.tsx`)

The shareable, **logged-out** destination for creator chips on Explore cards and public itineraries: a navy
identity hero (avatar · name · bio · social links · copy-link) + a 3-tile track-record strip + the same
`PubCard` grid used by Explore. Reuses `Avatar`, `CopyButton`, `EmptyState`, `Chip`, `PubCard`. No native
`<select>` and no custom overlay, so the register is untouched.

### Colour

| # | Surface | Token / value (light / dark) | Measured | Verdict |
|---|---|---|---|---|
| C1 | `.creator-hero` background | `linear-gradient(160deg, var(--yf-navy) #123F49, #0d4b56 58%, #0b3844)` — **hardcoded navy in BOTH themes** | — | **NON-defect + reference pattern** — this is the *correct* SYS-5 implementation: the stop is a literal navy, so it does **not** flip like Public Itinerary's `.route-snap` (`var(--gray-900)`). The inline comment at `:3960` is explicit that the hero stays navy in both themes. |
| C2 | `.creator-hero-meta` (homeCity · languages) | `color: #d9efeb` on navy | **≈10.5:1** (worst case on the `#0b3844` stop) | **NON-defect** — passes AAA; readable in both themes. |
| C3 | `.creator-hero-bio` | `color: #c5e1dc` on navy | **≈9.1:1** | **NON-defect** — AAA. |
| C4 | `.creator-badge` ("Creator" pill) | `background: rgba(243,170,61,.18)` over navy ≈ `#3B5247`; `color: #ffcc74` | **≈5.70:1** | **NON-defect** — passes AA for the 11px/800 label (near-large). Saffron-tint composited over navy, not over a flipping token. |
| C5 | `.creator-hero` `h1` | `color:#fff` on navy | **≈11:1** | **NON-defect**. |
| C6 | `.creator-hero-actions .btn-outline` | `color:#fff` on `rgba(255,255,255,.08)` over navy | **≈10:1** | **NON-defect** — light text is correct because the hero is navy in both themes (no dark override needed; the `:3961` rule hardcodes white). |
| C7 | `.stat-label` (Itineraries / views / forks) | `color: var(--text-3)` = `var(--gray-500)` `#5A6A80` / `#8FA0B5` on `var(--card)` `#FFF` / `#16233A` | **5.51:1 light · 6.34:1 dark** | **NON-defect** — 12px uppercase passes AA both themes. |
| C8 | `.stat-value` | inherits `var(--text)` = `var(--gray-900)` | ≥ 12:1 | **NON-defect**. |
| C9 | `PubCard` `.chip-teal` (travel style) | `color: var(--teal-deep)` `#0E7A72` / `#06251f` on `var(--teal-soft)` `#E5F4EE` / `#2BB8AC` | **4.70 / 6.56** | **NON-defect** — same pairing as the B16 active tab; passes. |
| C10 | `PubCard` `.card-title` / `.creator-line` | `--text` / `--text-2` (`var(--gray-700)` `#45566E` / `#ADBCCF`) | **≥12 (title) · 7.47 / 8.77 (line)** | **NON-defect (contrast)** — but see L1. |
| C11 | `PubCard` `.save-heart` icon | `#c25b4a` on near-white pill (light) · `#e58875` on `rgba(20,32,46,.85)` (dark) | **4.29 (light, icon) · 5.07 (dark)** | **NON-defect** — heart is a 13px graphical icon, so the 3:1 non-text threshold applies; both clear it. |

### Layout

- `.creator-hero-inner` is a wrapping flex (`gap:18px; align-items:flex-start; flex-wrap:wrap`); the
  `.creator-hero-id` has `min-width:220px` so the name/bio column doesn't crush. At `≤720px` it flips to
  `flex-direction:column` (`:3975`). Good responsive behaviour.
- `.creator-stats` is a 3-col grid that collapses to 1 col at `≤720px` (`:3976`); `.pub-row` also stacks.
  Good.
- `.explore-grid` reuses the audited Explore `repeat(auto-fill, minmax(290px,1fr))` → 1 col at the mobile
  breakpoint. Good.
- Avatar `size="lg"` (64px) with a 3px white ring — visible against navy. Good.
- **No native `<select>` / custom overlay** on this page → register unchanged.

### Typography

- `h1` uses `clamp(24px, 3.4vw, 34px)` in the display family — inside the heading scale. Good.
- `.creator-badge` (11px/800/uppercase) and `.stat-label` (12px/600/uppercase) are the standard small-kicker
  pattern; contrast passes (C4, C7), so not a fault.
- EmptyState, `CopyButton` label, and `.stat-value` tabular-nums are consistent with the rest of the app.

### Motion

- `.creator-hero::before` is a **static** radial accent — no animation, nothing to gate. Good.
- `PubCard` hover lift (`.itin-card:hover { transform: translateY(-2px) }`, `:1440`, raw `ease` `0.15s`) is
  SYS-6 (raw easing token) and is **not** wrapped in a reduced-motion guard at the global level (only
  suppressed on mobile at `:4148`). LOW — a reduced-motion user still gets the 2px shift on hover; harmless
  but worth a `prefers-reduced-motion` opt-out for consistency with the shell's gated reveals.

### Accessibility

- **L1 (LOW):** `.creator-line` is an `<a>` styled as plain `var(--text-2)` text (no underline, no distinct
  link colour) — and on a creator's *own* page it is a self-link, so it reads as ordinary text. The social
  icons below use `.muted` (`--text-3`) with no hover/focus affordance either. Contrast is fine (C10), but
  the lack of link affordance is a weak-target a11y note (same family as the Auth colour-only links). An
  underline or `:hover` colour would firm it up.

**Verdict: Approve** — 0 HIGH, 0 MED. The hero is the reference-correct forced-dark surface (the pattern
`.route-snap` *should* have followed). Only L1 (link affordance) + the PubCard hover reduced-motion LOW.

---

## Page 16 — Creator Hub (`src/pages/CreatorHubPage.tsx`)

Gated creator-account home: a "Creator mode" profile card (bio + YouTube/Instagram `Field`s + save/disable)
and a "My publications" card with two `PillNav` segmented controls (Overview/Earnings, Actual/Projection),
`PubCard`-style KPI tiles, per-publication manager rows, and a `compare-table` payout ledger. Reuses
`PillNav` (B16/B17), `Field`, `Chip`, `ConfirmDialog` (B4), `CopyButton`-style buttons. No native `<select>`.

### Colour

| # | Surface | Token / value (light / dark) | Measured | Verdict |
|---|---|---|---|---|
| H1 | **B17** `.filter-pillbar` active chip (Overview/Earnings/Actual/Projection) | `PillNav` → `.pill-nav .clickable-chip.on-teal` `:497` bg `transparent` (pale glider `var(--teal-soft)` shows), `:504` ink `var(--yf-teal-700)` `#0C716D` / `#06251f` | **≈5.1:1 light · 6.56:1 dark** | **NON-defect (B17 ticked)** — the documented B16 glider fix; the generic `.clickable-chip.on-teal` `:658` is white-on-teal-600 (4.08:1, SYS-3) but only the *non-`PillNav`* fallback hits that — every real usage is glider-scoped. Inactive chips: `--text` on `var(--yf-glass)`, pass. |
| H2 | `.btn-saffron` ("Enable creator mode" / "Update page") | `background: var(--color-accent)` (saffron) `color: var(--color-accent-foreground)` `#3A2506` | **≈9:1** | **NON-defect + reference fix** — this is exactly the dark-ink-on-saffron pattern `.notif-badge` (SHELL HIGH) *should* adopt; the `:3532` comment even calls out the 1.9:1 white-on-saffron it avoided. |
| H3 | `Chip tone="ok"` "Enabled" | `color: var(--ok)` on `var(--ok-soft)` | **3.67:1 light · 6.13:1 dark** | **MED (carried SYS-6)** — light-only; no `:636`-style light deepen for `var(--ok)`. Same family as Profile's `.chip-ok`. Fix: deepen `var(--ok)` in light or use `var(--text)`. |
| H4 | `Chip tone="saffron"` "Page behind itinerary" | `color: #8F5B06` (light override `:636`) on `var(--saffron-soft)` | **5.09:1 light · 5.56:1 dark** | **NON-defect** — the `:636` amber deepen already lifts it past AA. |
| H5 | `.metric-warn` ("Behind" stale count) | `color: var(--warn-600)` `#B47207` / `#D99A2B` on `var(--card)` | **3.92:1 light · 6.94:1 dark** | **MED (SYS-6)** — light-only; 16.5px/800 is *not* large text, so it fails AA normal (needs 4.5). The warn-600-on-light "amber too light" pattern; deepen `var(--warn-600)` in light or switch to `var(--text)`. |
| H6 | `.hub-note` body + `<b>` | bg `var(--yf-teal-100)`; body `--text`, `<b>` `var(--teal-deep)` `#0D8D82` / `var(--yf-teal-600)` | **body ≥12 · `<b>` 4.70 / 6.56** | **NON-defect** — teal-ink on pale teal ≥4.5; body dark-on-pale. |
| H7 | `.pub-ledger th` (10.5px uppercase) | `var(--text-3)` on `var(--card)` | **5.53 / 5.91** | **NON-defect (contrast)** but see L1. |
| H8 | `.pub-row-title a` · `.empty-ledger` · `.hint-text` | `var(--text)` / `var(--text-3)` | ≥ 7 | **NON-defect**. |
| H9 | `.stat-label` (pub-kpis) | `var(--text-3)` `var(--gray-500)` | 5.51 / 6.34 | **NON-defect**. |

### Layout

- Two `PillNav` segmented controls (`hub-tabs`, earnings view) — glass capsules (`:649` backdrop-blur), correct
  `role="group"` + `aria-label` + `aria-pressed` per chip. Good. (B17 = NON-defect, above.)
- `.pub-kpis` is a 4-col grid → 2-col at `≤720px` (`:4003-4004`); `.stat-tile.wide` spans 2. Good responsive.
- `.pub-row` is a flex `row-between` that stacks at `≤720px` (`:3977`). Good.
- **L2 (LOW, carried `.form-row`):** the YouTube/Instagram row uses `.form-row` (`:4186` = `display:flex`
  **no-wrap**, the dead `:616` grid twin aside). The two `Field`s are `flex:1; min-width:0`, so they shrink
  instead of overflow — but on a ~360px phone the two URL inputs get tight. Same duplicate-def defect flagged
  on Create Trip (Page 2) and TripSettingsForm (Page 10); the fix is to make `.form-row` wrap or use the
  grid variant.

### Typography

- `.pub-ledger th` is **10.5px** (`:3993`) — below the 12px minimum for data-table headers. Contrast passes
  (H7) but the size is an SYS-2 readability LOW. Recommend 11–12px.
- `h1` ("Creator hub") + `h3` section heads use the heading scale; `.hint-text`/`.muted` are `var(--text-3)`.
  Inline `marginBottom:20` on the email `p` is SYS-2 (bypasses spacing token).

### Motion

- `.filter-pillbar` glider slides via the `PillNav` measure/transition; the global reduced-motion guard is
  claimed to freeze it (component comment `:38`) but no `.pill-glider` rule appears in the reviewed
  reduced-motion blocks — **Not verified** (same LOW as Auth/B16). The `filter-pillbar` glass uses
  `backdrop-filter` (fine; not a motion concern).
- `ConfirmDialog` (B4) open/close is covered under SHELL.

### Accessibility

- `ConfirmDialog` "Disable creator mode" / "Unpublish" use `danger` + real `title`/`body`/`confirmLabel` —
  good destructive-action confirmation (cross-ref B4).
- `PillNav` chips expose `aria-pressed`; the "View public page" link is an `<a>` with an `ExternalLink` icon
  but no visible label text beyond the icon+text (acceptable — it has text "View public page").

**Verdict: Approve** — 0 HIGH, 2 MED (both carried SYS-6 light-only: `.chip-ok` 3.67, `.metric-warn` 3.92).
B17 filter-pillbar is the **good** reference (reuses B16). Only LOWs: `.pub-ledger th` 10.5px, `.form-row`
no-wrap.

---

## Page 17 — Master Admin (`src/pages/AdminPage.tsx`)

JWT-gated console (7-tab `PillNav` + Overview/Analytics `creator-stats` tiles + Users/Trips/Invites/Content/
Audit `compare-table`s + a type-to-confirm delete `Modal`). Reuses `PillNav` (B16/B17), `Field`-style `input`s,
`Chip` tones, `ConfirmDialog` (B4), `Modal`. No native `<select>`.

### Colour

| # | Surface | Token / value (light / dark) | Measured | Verdict |
|---|---|---|---|---|
| A1 | **B17** admin tablist (7 tabs) | `PillNav` glider fix (B16) | 5.1 / 6.56 | **NON-defect** (B17, already ticked). |
| A2 | `Chip tone="ok"` ("Creator") | `var(--ok)` `#2E8B57` / `#52BE80` on `var(--ok-soft)` | **3.67:1 light · 6.13:1 dark** | **MED (carried SYS-6)** — same light-only failure as Profile/Creator Hub `.chip-ok`. |
| A3 | `Chip tone="danger"` ("Disabled") | `var(--danger)` `#C93B3B` / `#E06C6C` on `var(--danger-soft)` | **4.68:1 light · ≈4.6:1 dark** | **NON-defect (borderline)** — passes AA but only just (4.68); a token drift toward `#A82E2E` would drop it under 4.5. Note for the palette owner. |
| A4 | `Chip tone="info"` ("You" / audit action) | `var(--text-2)` on `var(--info-soft)` | 7.47 / 8.77 | **NON-defect**. |
| A5 | `.btn-danger` (Disable / Delete) | `color: var(--color-destructive)` `#C93B3B` on `var(--color-destructive-soft)` `#F9E7E7` | 4.68 / ≈4.6 | **NON-defect** — same pairing as A3; passes. |
| A6 | `.stat-label` / `.stat-value` (Overview/Analytics tiles) | `var(--text-3)` / `var(--text)` | 5.51/≥12 · 6.34/≥12 | **NON-defect**. |
| A7 | `compare-table th` / `.muted` / `.hint-text` | `var(--text-3)` | 5.53 / 5.91 | **NON-defect (contrast)**. |
| A8 | Analytics bars (teal/saffron) | inline `var(--yf-teal-600)` / `var(--yf-saffron)` | decorative | **NON-defect** — `aria-hidden` + `.sr-only` value text; hue-only pairing is mitigated by the SR copy (LOW, see L3). |

### Layout

- `.filter-pillbar` tablist + the Trips-tab visibility `PillNav` (`role="group"`) — both glass capsules, correct
  responsive wrap. Good.
- Overview/Analytics use `.creator-stats` (3-col → 1-col ≤720px). Good.
- **L1 (LOW):** the wide `compare-table`s (Users 5 col, Trips 6 col, Audit 5 col) have no observed
  `overflow-x:auto` wrapper — on a phone they will overflow the viewport horizontally. Recommend a scroll
  container or card-ized rows at `≤640px`.
- Inline `style` blocks (`display:flex; gap:10; marginBottom:12`, `maxWidth:320` on search) bypass spacing
  tokens — SYS-2 (same as other form pages).

### Typography

- Table headers/text use the established `var(--text-3)` / `var(--text)` / `.small` scale. Consistent.
- `h1` "Master admin" + `h3` section heads use the heading scale. Inline `h3` `marginTop:18` bypasses token.

### Motion

- `PillNav` glider + `Modal` open/close — glider reduced-motion guard **Not verified** (same LOW as B16/Auth);
  `Modal`/`.modal-overlay` use `position:fixed` with no entrance animation observed (acceptable). The disabled
  buttons use `disabled={busy}` and `.btn:disabled` is styled (SYS-7) — in-flight state drawn. Good.

### Accessibility

- **L2 (LOW, semantics):** the admin tablist (`role="tablist"`) renders chips with **`aria-pressed`** instead of
  **`aria-selected`**, and the panels are not linked via `aria-controls`/`id`. For a true tablist the selected
  tab should expose `aria-selected` and the panes `role="tabpanel"` + `id`/`aria-controls`. (The Creator Hub
  pillbars correctly used `role="group"`, so this is an Admin-only inconsistency.) Low impact — the chips are
  still operable buttons.
- **L3 (LOW, contrast/disabled-state):** **disabled-user rows** apply `style={{ opacity: 0.6 }}` to the whole
  `<tr>` (`:124`). Opacity composites with the white card, so the dimmed identity text (name ≈ `--text`,
  email `.muted`) drops to roughly **2.2:1 / 1.9:1** — below AA. It's a deliberate "account disabled"
  treatment (likely within the WCAG *inactive-component* exemption), but if the row text is meant to stay
  readable, prefer a muted token or `opacity ≥ .7` with AA-checked colours over a blanket 0.6.
- Destructive actions are well-guarded: disable/unpublish/remove use `ConfirmDialog` `danger`; trip **delete**
  uses a type-to-confirm `Modal` whose Delete button stays `disabled` until the typed name matches exactly
  (`:258`). Solid pattern. The `Modal` auto-focuses the first input. Good.
- `sr-only` status live regions announce result counts ("N users" / "N trips"). Good.

**Verdict: Approve** — 0 HIGH, 1 MED (`.chip-ok` 3.67 light, carried SYS-6). Only LOWs: table overflow on
mobile, `aria-pressed`-vs-`aria-selected` tablist, and the `opacity:.6` disabled-row dim.

---

## Page 18 — Native app home (`src/pages/NativeHome.tsx`)

The installed-app "/" (task-first home: greeting, 2-up quick actions, live/upcoming trip rows, unread bell).
Mounts only in the native shell (`isNative && me`). Single column, Material list grammar (88px actions,
44px bell/thumb, 56px rows). No native `<select>`; the only overlay is the shared `BottomNav` (covered by
SHELL's topnav/mobile-menu audit).

**Token trap resolved:** `--teal` = `--teal-500` (#0D8D82 light / #2BB8AC dark) and `--teal-deep` =
`--teal-600` (#0E7A72 light). Resolving these *per theme* changes two verdicts below versus a naive
"white-on-teal" assumption.

### Colour

| # | Surface | Token / value (light / dark) | Measured | Verdict |
|---|---|---|---|---|
| N1 | `.app-home-action--primary` ("Plan a trip") | `background: var(--teal-deep)` = `#0E7A72` / `var(--teal)` `#2BB8AC`; `color:#fff` (light) / `#06251f` (dark) | **5.19:1 light · 6.56:1 dark** | **NON-defect** — the per-theme token resolve saves it: light is `#06251f`-avoided white-on-**#0E7A72** (5.19), not the 4.08 teal-500; dark uses dark ink. 14px/700 passes both. |
| N2 | `.app-home-trip-thumb.is-live` (live trip icon) | `background: var(--teal)` `#0D8D82` / `#2BB8AC`; `color:#fff` | **4.08:1 light (≥3:1 non-text OK) · 2.47:1 dark (<3:1)** | **MED (dark-only, SYS-3 inverse)** — white icon on the *lightened* dark-theme teal-500 fails WCAG 1.4.11 (3:1). Light passes. Fix: dark-mode live thumb should use dark ink `#06251f` (like N1) or a darker teal fill. |
| N3 | `.app-home-bell-count` (unread badge) | `background: var(--danger-500)` `#C93B3B` / `#E06C6C`; `color:#fff`; 11px/800 | **4.68:1 light · 3.21:1 dark** | **MED (dark-only)** — light passes AA (barely, 4.68); dark `#E06C6C` is too light for white text (3.21 < 4.5). Fix: dark-mode badge needs dark ink or a deeper danger fill. |
| N4 | `.app-home-bell` icon | `color: var(--text-2)` on `var(--card)` | 7.47 / 8.77 | **NON-defect** — 44px touch target also satisfies SYS-4. |
| N5 | `.app-home-section` / `.app-home-trip-meta` / `.app-home-more` | `var(--text-2)` | 7.47 / 8.77 | **NON-defect**. |
| N6 | `.app-home-trip-name` | `--text` (inherited) | ≥ 12 | **NON-defect**. |
| N7 | `.app-home-live-dot` (7px status dot) | `background: var(--teal)` on page bg | 4.08 light · 5.3 dark | **NON-defect** — ≥3:1 both themes (graphical indicator). |
| N8 | `.app-home-action` (Explore, secondary) | `var(--text)` on `var(--card)` | ≥ 12 | **NON-defect**. |

### Layout

- `.app-home` is `max-width:640px` single column — correct mobile grammar; no awkward column collapse at 360px.
- `.app-home-actions` is a `2fr 1fr` grid that *stays* 2-col (Plan a trip wider) — fine at 360px (≈210/100px).
- Touch targets: bell 44px, thumb 44px, action min-height 88px, trip rows 56px — all meet SYS-4. Good.
- `HomeTripRow` name truncates with ellipsis (`min-width:0` + `text-overflow`) — no overflow. Good.

### Typography

- `h1` is inline `font-size:24px` (not the heading token) — SYS-2 (visual only). `.app-home-section` uses the
  global kicker override (`:4653`) — consistent with the rest of the app.
- `.app-home-bell-count` 11px is below the 12px minimum but passes AA contrast in light (N3); dark fails on
  contrast, not size.

### Motion

- `:active { transform: scale(.98) }` on actions/rows — instant (no transition), acceptable for a press state.
- `.app-home-live-dot` is intentionally **steady** (comment `:4564` "no pulse — motion budget") — motion
  discipline respected. No entrance animations. Good.

### Accessibility

- Bell button has `aria-label={`${unread} unread notifications`}`; trip rows are real `<button>`s with
  `onClick`; "All N trips" / empty-state CTAs navigate. Good.
- **N2/N3 are the only defects** — both dark-mode-only, both the *inverse* of the usual light-mode failures:
  the dark-theme `--teal-500`/`--danger-500` are lightened for dark surfaces, so white text/icon on them
  drops under the threshold. Same root cause as SYS-3/SYS-6 but surfacing in **dark** mode here.

**Verdict: Approve** — 0 HIGH, 2 MED (both dark-only: N2 live-thumb icon 2.47:1, N3 bell-count 3.21:1).
The primary CTA is clean once tokens are resolved per theme. Only LOW: inline `h1` size.

---

## Overlay register audit — B10 / B11 / B19

The three still-unticked overlays, audited once each (their CSS is reused across pages).

### B10 · `AiDrawer` (`src/components/AiDrawer.tsx` + `styles.css:1702`)

Right-side `role="dialog" aria-modal="true"` panel with a **proper dialog contract**: focus moves to the
input on open (`:32`), Tab cycles inside (`:38-46`), Escape closes (`:34`), focus returns to the trigger
(`:50`). `role="log" aria-live="polite"` for the message stream. This is the best-implemented overlay.

- **MED (dark-only, SYS-3 inverse):** `.ai-bubble.user` is `background: var(--teal-deep)` (=
  `--teal-600`) with `color:#fff`. Light `--teal-600` = `#0E7A72` → white = **5.19:1 (passes)**; dark
  `--teal-600` = `#35C9BC` (the dark theme *lightens* teal-600) → white = **2.11:1 (fails AA)**. Same
  root cause as N2/N3 — the dark-theme teal-600 is too light for white text. Fix: dark-mode user bubble
  needs dark ink `#06251f` (like `.btn-primary`/`.app-home-action--primary` do) or a darker teal fill.
- NON-defect: `.ai-head` navy→teal-700 gradient with `color:#fff` (white on teal-700 end = 5.83:1);
  `.ai-head-sub` `rgba(255,255,255,.78)`; `.ai-bubble.bot` (`--text` on `--bg-soft`); `.ai-assumption`
  (`--text-3`); quick-prompt `clickable-chip`s (no `.on-teal`, so no white-on-teal trap).
- **Motion — GOOD:** `drawerIn` uses `var(--t-med) var(--ease-out)` (`:1706`) — not a raw easing (no SYS-6).

### B11 · `.impact-sheet` / `.impact-panel` (`src/components/ImpactPreview.tsx` + `styles.css:1238`)

Fixed bottom sheet (non-modal, `role="status"`), saffron-bordered panel, `slideUp` uses `var(--t-med)
var(--ease-out)` — motion is clean (no SYS-6).

- **MED (light-only, SYS-6):** `.impact-head` is `color: var(--warn)` (`--warn-600` #B47207) on
  `var(--saffron-soft)` #FBF1DD = **3.50:1 light** (dark 6.87 passes). The "Impact preview — estimates only"
  label is below AA in light. Same amber-too-light-on-light pattern as `.metric-warn`/`.chip-ok`.
- **MED (light-only, SYS-6):** `.impact-cell .v.delta-neg` (a *decrease* — good) is `var(--ok)` #2E8B57 on
  `--bg-soft` ≈ **3.67:1 light** (dark passes). The `--ok` token is again too light on a light surface
  (same as `.chip-ok`). `.v.delta-pos` (`--danger` on `--bg-soft`) sits at ~4.5–4.8 light — borderline pass.
- **MED (light-only, carried):** the no-warnings head chip is `chip-ok` = **3.67:1 light** (the same carried
  defect). The `+N warnings` state uses `chip-danger` = 4.68 (passes).
- LOW: `.impact-cell .k` is 11px (below 12 min, contrast OK); `role="status"` wraps action buttons (Keep /
  Remove) — a non-modal live region is a slightly odd contract for an interactive decision sheet (no focus
  trap / Escape), but it is intentionally non-modal. `.impact-grid` `auto-fit minmax(140px)` is responsive.

### B19 · `.trip-dock` (`src/pages/CreateTrip.tsx:849` + `styles.css:4464`, mobile ≤900px)

Fixed glass CTA bar (`.yf-glass` + blur), `role="region"`, 46px `.dock-cta` touch target (meets SYS-4).

- **MED (dark-only):** `.dock-amt` (the trip cost figure) is `var(--yf-teal-700)` light / `var(--yf-teal-600)`
  dark, sitting on the **dark glass**. `var(--yf-teal-600)` #2BB8AC on the translucent dark glass lands
  roughly **2.8–4.3:1** depending on the glass alpha — likely under AA for the figure. Verify against the
  rendered glass; if it dips, give the dark-mode amount a darker teal or `--text`.
- NON-defect: `.dock-cta` is `background: var(--yf-saffron)` + `color:#3A2506` (`--color-accent-foreground`)
  ≈ **9:1** — the *reference* dark-ink-on-saffron fix (same as `.btn-saffron`, the cure for `.notif-badge`).
  `.dock-meta b` (`--text`) and `.dock-meta span` (`--yf-text-muted`) on glass pass; `.dock-thumb` teal-100.
- No entrance animation (a persistent bar) — acceptable.

**Overlay verdicts:** B10 Approve (0 HIGH, 1 MED dark-only bubble). B11 Approve (0 HIGH, 3 MED light-only:
head 3.50, delta-neg 3.67, chip-ok 3.67). B19 Approve (0 HIGH, 1 MED dark-only amount). All three use
token-based motion (no SYS-6). All HIGH-severity structural issues (focus traps, aria-modal, Escape) are
already handled — the only defects are the per-theme colour contrasts above.

---

## Cross-page / systemic

Page sections cite these by ID instead of restating them.

| ID | Severity | Location | Before | After | Why |
|---|---|---|---|---|---|
| **SYS-1** | **MED** | `styles.css:4645-4661` "Kicker unification" | The block claims "one recipe for every micro-label role" and lists **39 selectors** — `.bench-eyebrow`, `.route-tag`, `.group-lab`, `.mini-lab`, `.editorial-kicker`, `.tk-brand`… — but **omits `.eyebrow`** | Add `.eyebrow` to the list | Two independent misses landed on one selector: the mockup rule was lost in the rename, and this later unification pass didn't know the class existed. Adding one selector fixes all 8 Create-Trip labels |
| **SYS-2** | **MED** | `styles.css:2788,2644,4238,4211,4639` | **Seven** competing micro-label specs: `.eyebrow` (none) · `.bench-eyebrow` 11/800/.14em · `.group-lab`+`.mini-lab` 10/700/.1em · `.route-tag` 10/700/.08em · `.editorial-kicker` 12/800/.12em · kicker tokens 10.5/700/.06em | One recipe, one token set | Six specs and one omission for one visual role. Note the kicker token tracking is `.06em` while the mockup asked `.14em` — even the unification didn't agree with the design |
| **SYS-3** | **MED** | `styles.css:4635-4636` | `--text-*` (1/8 used) and `--s-*` (0/8 used) token scales | Adopt or delete both | ~890 raw values where 16 tokens exist. The single highest-leverage systemic fix in the audit — it is the *cause* of most of the LOW typography/layout rows, not a separate defect |
| **SYS-4** | **LOW** | `styles.css:559-569` | The `@media (pointer: coarse)` hit-area list covers `.btn, .icon-btn, .chip, .clickable-chip, .toast-action, .tab-btn, .map-legend-toggle, .nav-link` — but **not** `.link-btn`, `.move-btn`, `.board-pulse-link`, `.cal-day`, `.route-btn` | Add them | Five more text-only/undersized controls are outside the budget: `.link-btn` (`padding: 0`), `.move-btn` (22×24), `.cal-day` (32px), `.board-pulse-link` (`padding: 0`). `.route-btn` and `.cal-day` also carry three progressive size overrides across separate media queries (`:4301,4503,4666`). Hit-area *classification* belongs to `better-accessibility` |
| **SYS-5** | **HIGH** | `styles.css:384` `.card.route-snap` · `:1846` `.trip-head-card` | Two **forced-dark** surfaces end their gradient in `var(--gray-900)`, which flips to `#ECF1F8` in dark theme, while the text stays `#fff` | Use a literal bottom stop, as the project already does elsewhere | White text fails 4.5:1 from ~42% along the gradient and reaches **1.13:1** (route line, `opacity:.85`, **1.11:1**). The app **documents this exact rule three times** — `:1360-1361` "the bottom stop must be a literal (--gray-900 flips near-white in dark mode)" for `.hero-adventure`, `:1422-1425` "its gradient stops must be literals… Same rule as .budget-hero" for `.cta-band` — and these two were missed. Same shape as SYS-6: a known rule with unfixed siblings |
| **SYS-6** | **HIGH** | text `:360,997,978,994,3813,3872` · borders/fills `:365,1022-1028,949,1597-1607,3820,3833` | Several light-theme inks are too light for **text, borders and fills** on light surfaces: `--yf-amber` **2.01:1** on white, `--yf-saffron` **1.98:1**, `--warn` on `--yf-amber-100` **3.69:1**, `--ok` **4.25:1**, `--gray-400` **2.76:1** | Add a light-theme deepened tier per role and point the text/border/fill roles at it | **Twelve instances across five pages** — text: `.health-num-big.mid` 2.01, `.board-pulse-band.mid` 1.94, `.day-warn-pill`/`.day-rail-chip.warn`/`.tl-total-warn` 3.69 (×3), `.metric-good`/`.balance-pos` 4.25 (×2); fills: `.health-bar > i.mid` 1.89, `.day-progress-fill.sev-medium` 1.85, `.budget-bar-fill`/`.daybar-fill` 1.74–2.40 (×5), `.cat-chip` icons 1.82–2.76 (×3); borders: `.kind-food` 2.01, `.kind-rest` 1.98. **Every one passes in dark (3.12–8.78)** — this is a light-theme-only failure, the inverse of the usual direction. **The remedy already exists**: `:634-636` gives `.chip-saffron` a light-theme `#8F5B06` with the comment *"AA contrast: warn-600 reads 3.48:1 on the saffron tint — light theme gets a deeper amber"*, and that value measures **5.08–5.73:1 on every light surface** it would be used on. One token tier generalises |
| **SYS-8** | **MED** | `styles.css:2443,2444,2447,2455,2461` | `#7C5CFC` is hardcoded **five times**, and `#5540B8` once — and `#7C5CFC` is also `DAY_COLORS[2]` (`TripMap.tsx:34`), the **Day 3 route colour** | Promote both to tokens, with a hue distinct from the day palette | A day colour doubles as the "places to see" POI-column colour, so one purple means "Day 3" on the map and "sightseeing" in the panel beside it. The sibling column `.poi-col--needs` *is* tokenised (`var(--teal)`), so one feature is built two ways — and `#5540B8` has no dark override, leaving that label at **1.84:1** in dark theme |
| **SYS-7** | **MED** | `styles.css:4213,4240,4273,4284,4321` + `:782,1107,1122` | Interaction states that declare **no `transition` at all** while their siblings ease: `.route-btn`, `.mode-btn`, `.crew-btn`, `.quick-budget .chip`, `.cal-day` (Create Trip); `.move-btn`, `.board-fit`, `.board-pulse-link` (Board) | Add one shared transition | Same page, two motion languages: `.ts-switch-track`, `.btn` and `.clickable-chip` ease over `--t-fast`, everything in this list snaps. Selecting a transport mode, a crew size, a date, a budget chip, or hovering a board action is an abrupt flip |

---

## Overlay & dropdown findings

These are cross-cutting: they are properties of the **control family**, not of one page, so they are
recorded once here and referenced from the page sections. Ticked off in the register above.

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| **MED** *(highest volume — 20 instances)* | `styles.css:596-615` + all 20 `<select>` sites | The **trigger** is fully themed (`appearance: none` + brand chevron + `.input` surface). The **popup is browser/OS-rendered** — the code's own comment at `:608-610` admits it: *"Chromium/Edge honour this; the system highlight stays"* | Replace the high-traffic ones with a custom listbox (`role="listbox"` + `role="option"`, reuse the `LocationInput` pattern at `LocationInput.tsx:104-118`) | `<option>` cannot carry radius, padding, row height, hover/highlight colour, popup border or shadow — and WebKit ignores even `background`/`color`. On **Capacitor Android the WebView renders the popup as a stock Android dialog**, so in the shipped APK the app's most-used input looks like the platform, not the product. This is the "still look html type" complaint, and it is 20 instances on 10 files |
| **MED** | `TimelineTab.tsx:1110` `<select className="input">` | `appearance: none` and the brand chevron are declared **only in `.select`** (`:596, :601`). A select wearing `.input` gets the themed border but the **native OS arrow**, and `padding-right: 13px` instead of `32px` | Change to `className="select"` | The one control that is visually a raw OS widget while its 18 siblings show the brand chevron. The narrow right padding also risks the native arrow overlapping a longer value — *inferred from the cascade, not rendered* |
| **MED** | `styles.css:582-607` — no `:disabled` rule | `.input`/`.select`/`.textarea` have **no `:disabled` styling** (every `:disabled` rule in the file targets `.btn`, `.move-btn`, `.chip`, `.bench-surprise`, `.ts-form .tab-btn`) | Add a disabled treatment (reuse `.btn:disabled { opacity: .55; cursor: not-allowed }`) | Three disabled selects render **identically to enabled ones**: `CreateTrip.tsx:760` (Day, when no dates are picked) and `TripSettingsForm.tsx:265,272` (when the trip isn't editable). Same defect family as `.btn.on-teal` — a state that simply isn't drawn |
| **MED** | `StopEditor.tsx:178,194,282` (Category · Priority · Status) | Three native selects in the **highest-traffic editing surface** ("Edit stop"), listed as plain `titleCase(c)` text | Custom listbox with the category icon + the priority/status tone colour | These are exactly the fields where a themed list earns its keep — a category has an icon, a priority has a colour, a status has a tone. Today the modal's trigger is on-brand and its three most important fields open a raw OS list |
| **MED** | `.select` ×18 · `.role-select` ×1 (`ShareTab.tsx:316`) · `.input` ×1 (`TimelineTab.tsx:1110`) | **Three class conventions for one control type** | One `.select` recipe plus documented variants (a compact/glass variant for the share row) | `.role-select` duplicates `appearance: none`, the padding and a second hand-built chevron (`styles.css:1862-1875`) — a parallel implementation of a solved problem |

**Verified, no finding — and the thing that makes the current state tolerable:** `color-scheme` is set
correctly per theme (`:root` `:12`, `[data-theme='dark']` `:161`), so the native popup renders dark in
dark mode instead of glaring white. That one declaration is why the selects don't look broken today —
worth protecting when the listbox work happens.

**Overlays already done well:** `Modal` (`ui.tsx:27`) is focus-trapped with Escape, scroll-lock,
`aria-modal` and focus restore; `LocationInput` is a proper `role="combobox"` with
`aria-activedescendant` and full keyboard nav (`:104-118`); `.cal-pop` closes on outside pointerdown
and Escape and carries `role="dialog"` + `aria-label` (`CreateTrip.tsx:158`). The custom-overlay
register (B) is therefore mostly a consistency pass, not a rebuild.

---

## What's already strong — keep these

- **Token architecture** — primitives → `--color-*` semantics → components, both theme blocks present
  and complete, with a documented state matrix in `DESIGN_TOKENS.md`.
- **The dark-mode foreground pattern exists** (`.clickable-chip.on-teal:659`, `.bench-mode-btn.on:2919`).
  The six contrast findings above are *missing applications* of a known-good fix, not a design gap.
- **Reduced-motion discipline** — a global freeze plus `no-preference` gates on every decorative animation.
- **`tabular-nums`** already applied to `.num`, `.stop-meta`, `.chip-count`, `.stat-value` — changing
  numbers don't shift layout.
- **`text-wrap: balance`** on all headings (`styles.css:442`).
- **`@media (pointer: coarse)` hit-area extension** (`:559`) — visuals unchanged, hit area grown.
- **`.ts-block:has(.cal-pop)` z-index elevation** (`:4174`) — a real stacking bug found and documented in-code.
- **`.trip-enter` / `.ts-switch` use motion tokens**, and `.cal-pop`/`.trips-search` carry proper ARIA.

---

## Verification log

**Run:** contrast computed from declared token pairs via WCAG relative luminance, with alpha compositing
wherever the real rule composites — `chip-count` `opacity: .65`, `.tk-route` `rgba(…,.66)`,
`.mode-btn.on .hint` `rgba(…,.8)`, the Explore hero's `rgba(255,255,255,.12)` field and its
`rgba(226,241,239,.75)` placeholder, the `.board-pulse` glass panel (`--yf-glass` over `--yf-mist`),
and `.route-snap`'s white-at-`opacity:.85` route line. Gradient backgrounds were sampled at several
positions along the ramp, since a gradient's midpoint is not its worst case.

**Cascade traced by hand** for: `.eyebrow` (no base rule anywhere — verified across `src/` and all CSS),
`.btn.on-teal`, `.explore-hero-search:focus` (which `box-shadow` survives from `.input:focus`),
`.editorial-kicker` (3 of 4 properties overridden), `--focus` (referenced, never defined),
`.form-row` (duplicate definition), `.pulse-bar` (no `grid-column`), the two `--gray-900` gradients,
`Field`'s association path (`ui.tsx:118-160` — host controls wired, `PayerSelect` cloned but never
forwards the `id`), `.metric-strip`'s breakpoints, `.catbars .budget-bar-row` at ≤1100px, and the
`.travel-panel` inputs that bypass `.input`. Hue distances computed in HSV for the 7 stop kinds and the
8 expense categories.

**Counts from `grep`** over `src/styles.css`: 36 distinct `font-size` values · 342 raw `font-size` vs
1 `var(--text-*)` usage · 480 raw padding/margin vs **0** `var(--s-*)` usages · 20 `<select>` across
10 files · 6 `:disabled` rules, none for form primitives · 39 selectors in the kicker list ·
7 distinct raw transition durations · `#7C5CFC` hardcoded 5× · `--focus` defined 0×.

**`color-mix()` evaluated by hand** where it sets a rendered background: the `.cat-chip` 15% tints,
`.poi-col--see`/`--needs` 5/12/24% mixes, `.ride-purpose-sight`'s 16% chip, and the `.board-pulse`
glass panel.

**One correction made mid-audit:** an early Board/health contrast pass passed light-theme token values
for the dark rows, which produced five wrong numbers (e.g. a spurious 2.31:1 for `.board-pulse-lines` in
dark; the correct value is **8.96:1**). Re-run per-theme before reporting. Recorded because the same
mistake is easy to repeat: **always resolve the token per theme, not once.**

**Not verified (needs a browser render):**
- Wrapping, widows and truncation **at real content lengths** — the `.route-name`, `.dock-meta b` and
  `PubCard` creator-bio truncation claims are read from CSS, not from a rendered long string.
- Gradients measured against sampled stop values, not a composited raster (the trip ticket, Explore's
  hero, `.featured-card`, `.route-snap`, `.trip-head-card`).
- The `--gray-900` gradient break is **computed from the declared stops**, not observed. The direction
  and the 1.13:1 endpoint are certain; the exact percentage at which the text becomes illegible depends
  on where the content actually sits in the box.
- 200% zoom, the RTL mirror, and every supported viewport width. The `.trips-page` `:first-child` layout,
  the `.commitment-row` squeeze and the h1/h2 collision at ≤578px are reasoned from the cascade, not
  observed at those widths.
- The native `<select>` popup's actual rendering on Android/WebKit — the `<option>` limitation is
  documented in-repo (`styles.css:608-610`) and standard, but not observed on a device here.
- The React app was **not** rendered: the shared working tree carries another agent's in-progress
  refactor (17 modified files), so a dev-server run would report on their code, not these pages'.

---

## Working method (one page, one section, deep pass)

1. **Pick the next unticked page** from the tree — order is Explore → the 7 workspace tabs → Public
   Itinerary → Profile → Auth → Landing → Creator Hub → Admin → NativeHome. The shell (P1) is audited
   once on its own; it appears on every page so it is not re-done per page.
2. **Write one section for that page only**, with the three lenses (colour · layout · typography) plus
   motion, using the same table format: one row per root cause, `file:line`, measured values.
3. **Tick every overlay in the register that this page hosts** — the trigger *and* the popup. This is
   the step that would otherwise be missed: a dropdown can have a perfect closed state and a raw OS list.
4. **Cite systemic IDs** (`SYS-n`, `A-n`, `B-n`) instead of restating a cross-cutting defect, so the
   report stays a list of distinct defects rather than a list of places each one appears.
5. **Tick the page `[x]`** in the tree, and update its HIGH/MED/LOW counts.
6. Record what a browser render would be needed to confirm under `Not verified` — never silently approve.

**Done this batch:** `SHELL` (P1) — topnav, `.mobile-menu`, `user-menu`, `notif-pop`, theme View
Transition, global Toast/ConfirmDialog, `.atmos`. **Share** (`ShareTab.tsx`) + **Trip settings form**
(`TripSettingsForm.tsx`, A19–A20). **Public Itinerary** (`PublicItinerary.tsx`). **Landing**
(`Landing.tsx` + `PlanBench.tsx`) — hero, boarding-pass CTA, destination ticker, Plan Bench receipt,
feature/steps/CTA bands, blobs + motifs. **Profile** (`Profile.tsx`) — settings chrome, Creator-hub badge,
notification toggle, `.chip-ok` light MED. **Auth** (`Auth.tsx`) — clean (0 HIGH / 0 MED; PillNav active
state themed, `.err-text` passes both themes). The tracker tree now reflects SHELL (P1), Landing, Profile,
Auth and all trip-workspace tabs as `[x]`; **Creator Page** (`CreatorPage.tsx`) — Approve (0 HIGH/0 MED;
navy forced-dark hero is the reference-correct SYS-5 pattern next to the broken `.route-snap`, PubCard grid
reused from Explore). **Creator Hub** (`CreatorHubPage.tsx`) — Approve (0 HIGH, 2 MED carried SYS-6:
`.chip-ok` 3.67 light, `.metric-warn` 3.92 light); **B17 `.filter-pillbar` ticked — NON-defect** (reuses
the B16 glider fix, ≈5.1 light / 6.56 dark). `.btn-saffron` is the reference dark-ink fix for `.notif-badge`.
**Native Home** (`NativeHome.tsx`) — Approve (0 HIGH, 2 MED **dark-only**: live-thumb white-on-teal-500
2.47:1 <3:1 N2, bell-count white-on-danger-500 3.21:1 N3) — the *inverse* of SYS-3/SYS-6 (surfaces in dark).
Primary CTA is clean once `--teal`/`--teal-deep` are resolved per theme (5.19 light / 6.56 dark). Register
ticks still: B4, B6, B8, B9, B12, B15, B16, B17, B18, B20, A17, A19–A20.

**AUDIT COMPLETE — all 19 pages/sections, all 20 overlay rows (B1–B20), and all 20 native-select rows (A1–A20) are audited and ticked in the registers above.** The three final overlays (`B10` AiDrawer, `B11` impact-sheet, `B19` `.trip-dock`) were the last surfaces written up and are now ticked. No fixes were applied — this is a diagnostic-only pass.

**Tracking: this audit is now GitHub issue [#107](https://github.com/hasnaina955/Yatraflow/issues/107)** — every HIGH/MED/LOW below is a checkbox there, ticked and commented with the PR/commit as each fix lands. This file remains the full reference write-up; #107 is the fix tracker.

**Highest-priority open defects (still unaddressed):**
- **HIGH** `.notif-badge` white-on-saffron ~1.98:1 both themes (one-line fix: `color: var(--color-accent-foreground)`). [SHELL]
- **HIGH** Public Itinerary `.route-snap` aside unreadable in dark mode — SYS-5 (gradient) **+** hardcoded light-teal glance text. The one public-facing dark-mode regression.
- **HIGH** (Landing) `.step-num` white-on-`var(--teal)` 4.08:1 light / 2.45:1 dark — SYS-3 again, on the teal-500 family. Fix: ink on `var(--yf-teal-100)`, or a darker teal token.

**Carried MED (light or dark only):**
- `--yf-teal-600` 4.08:1 on `.editorial-kicker` (`:2644`) and `.share-tab.is-active` (`:4046`) — fixed on
  `.bench-receipt-kicker` but un-propagated. (Landing `.chip-saffron` corrected to NON-defect via `:636`.)
- **(Profile / Creator Hub / Admin)** `.chip-ok` green-on-soft **3.67:1 light** (dark 6.13 passes) — no
  `:636`-style light deepen for `var(--ok)`.
- **(Creator Hub)** `.metric-warn` warn-600 **3.92:1 light** on card (16.5px/800 not large).
- **(Native Home, dark-only)** live-thumb icon 2.47:1 (N2) · bell-count 3.21:1 (N3) — dark-theme teal-500 /
  danger-500 lightened too far for white.
