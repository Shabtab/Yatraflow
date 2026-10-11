# YatraFlow Design Tokens

`src/styles.css` is authoritative; correct this reference when the two disagree,
never change CSS to honour an obsolete table. Reconciliation evidence below uses
one measured CSS snapshot (SHA-256 in the appendix); line numbers may move during
concurrent CSS work. Counts describe source declarations, not computed rendering.

Token architecture adopted from the `ui-ux-pro-max-skill` design-system reference
(audit issue #24). Three layers:

1. **Primitives** — raw palette values (`--teal-500`, `--gray-900`, …).
2. **Semantics** — purpose aliases (`--color-*`) mapped from primitives; carry
   hover/active/foreground so interactive states stay consistent across themes.
3. **Components** — consume semantics only.

> Legacy flat names (`--teal`, `--saffron`, `--bg`, `--text`, …) are **kept as
> aliases** of the primitives so the ~200 existing references keep working.
> **New code should use `--color-*` semantic tokens.**
> (v0.30.0 — the `--color-*` members nothing consumed — background/foreground/
> card/popover/muted/border/success/warning/info-soft and the destructive
> hover/foreground pair — were **deleted** per the M4 adopt-or-delete rule;
> re-add them with an adopter, not speculatively. The adopted action-color set
> below stays.)

## Calm Travel Intelligence layer (design refresh, `redesign/calm-travel-intelligence`)

The redesign adds a `--yf-*` primitive scale from
`docs/redesign/YATRAFLOW_DESIGN_DIRECTION.md` §4.1. These sit **beside** the
existing primitives (evolve, don't replace); semantics re-point to them only
where the direction doc says so. Every token is mirrored in
`[data-theme='dark']`.

| Token | Light | Dark | Use |
|------|-------|------|-----|
| `--yf-navy` | `#123F49` | `#0F2A33` | header bands, dark cards, AI surfaces |
| `--yf-teal-600` / `--yf-teal-700` | `#0D8D82` / `#0C716D` | `#2BB8AC` / `#1E9D92` | CTI primary / pressed |
| `--yf-teal-100` | `#E5F4EE` | `#12332F` | selected backgrounds |
| `--yf-saffron` / `--yf-saffron-100` | `#F3AA3D` / `#FFF4E4` | `#F5A94A` / `#3A2C15` | invite / share / publish |
| `--yf-amber` / `--yf-amber-100` | `#E4AE43` / `#FFF7E9` | `#D99A2B` / `#36290F` | attention / trade-offs |
| `--yf-coral` / `--yf-coral-100` | `#D6534D` / `#FFF0EC` | `#E06C6C` / `#3A2020` | critical / destructive |
| `--yf-purple` / `--yf-purple-100` | `#897ABB` / `#F0EAFA` | `#A99BD6` / `#2A2440` | scenic discovery |
| `--yf-cream` | `#F8F7EF` | `#0C1420` | main canvas (aliased as `--bg` in light) |
| `--yf-mist` / `--yf-peach` | `#ECF8F4` / `#FFF2E8` | `#0F1B2B` / `#1A2030` | atmosphere gradient edges |
| `--yf-atmos-mint` / `--yf-atmos-peach` | `rgba(124,225,207,.20)` / `rgba(255,179,107,.16)` | `rgba(43,184,172,.10)` / `rgba(245,169,74,.08)` | gradient blobs |
| `--yf-surface` | `#FFFFFF` | `#16233A` | readable cards |
| `--yf-border` | `#DCE7E1` | `#27395A` | soft boundaries |
| `--yf-text-muted` | `#566A6C` | `#8FA0B5` | secondary text |
| `--yf-glass` / `--yf-glass-border` | `rgba(255,255,255,.58)` / `rgba(255,255,255,.65)` | `rgba(16,27,43,.58)` / `rgba(255,255,255,.14)` | level-2 overlays |

(`--yf-ink`, `--yf-mint` and `--yf-surface-muted` were removed in v0.30.0 —
defined but never referenced by any component.)

**Expense-category tokens (v0.36.0, Budget tab):** one hue per spend category,
consumed by the "Where the money goes" bars and the per-line icon chips.
Defined in `:root` and mirrored in `[data-theme='dark']` — reference the token,
never the hex.

| Token | Light | Dark | Category |
|------|-------|------|-----|
| `--cat-transport` | `#2D61A9` | `#689ADF` | transport (steel blue) |
| `--cat-accommodation` | `#237895` | `#68C1DF` | accommodation (cerulean) |
| `--cat-food` | `#B24F24` | `#DF8C68` | food (terracotta) |
| `--cat-activities` | `#378637` | `#6BC76B` | activities (leaf green) |
| `--cat-entry-fees` | `#AB367A` | `#DF68AD` | entry fees (rose) |
| `--cat-tolls-parking` | `--gray-500` → `#5A6A80` | `#93A6BC` | tolls & parking (neutral) |
| `--cat-local-travel` | `#747722` | `#D0D454` | local travel (olive) |
| `--cat-emergency-buffer` | `#9E6D1A` | `#DFB368` | emergency buffer (deep honey) |

**The ramp is its own categorical family, NOT the status palette.** The first
version reused `--warn-600`, `--ok-500`, `--danger-500` and `--yf-amber`
verbatim, so an entry-fees bar wore the critical coral and read as an alert,
and a chart colour was indistinguishable from a status chip. The replacement
keeps one lightness band, every hue ≥15° from its siblings (the hue gate reads
the first four) and clear of the POI magenta — the gate's tolerated-collision
list is empty as a result.

Also (v0.37.0, selects): `.select` drops its glass-pill override and shares the
exact `.input` surface — the custom chevron `background-image` is the only
difference, and `.select option` takes the theme's card colors so the native
popup stops clashing.

**Utilities (doc §3.3 transparency levels):**
- `.atmos` — level-1 atmospheric canvas (doc §4.2): two soft radial blobs over
  the mist→cream→peach ramp. For Landing, Explore, Public Itinerary and the
  workspace outer shell; keep it quiet behind dense content.
- `.glass` — level-2 expressive overlay (nav, map panels, hero support cards):
  translucent `--yf-glass` background + blur + light border. Readable/editable
  content stays on near-opaque `--card` (level 3).

**Also added:** `--radius-lg: 24px` (large bento cards) and `--shadow-soft`
(diffuse CTI depth) in both themes.

**Shared page tokens (on `:root`):** Explore and My trips use the same look, so they share
five tokens. `--font-serif` is Playfair Display for a hero headline. `--font-hand` is Caveat
for the handwritten note. `--line-strong` is the border of a control (22% of `--text`).
`--shadow-card` and `--shadow-card-hover` are the resting and hover shadows of a catalog card.
The older `--ex-font-serif`, `--ex-font-hand`, `--ex-line-strong`, `--ex-shadow-sm` and
`--ex-shadow-md` names stay as aliases of these tokens.

## Primitive palette

| Token | Light | Dark |
|------|-------|------|
| `--teal-500` (dark primary; light CTI teal) | `#0D8D82` | `#2BB8AC` |
| `--teal-600` (light primary / dark hover) | `#0E7A72` | `#35C9BC` |
| `--teal-700` (light hover / dark active) | `#0B6B63` | `#1E9D92` |
| `--saffron-500` (accent) | `#F59E2D` | `#F5A94A` |
| `--saffron-600` (accent hover) | `#E0860F` | `#E0860F` |
| `--danger-500` (destructive) | `#C93B3B` | `#E06C6C` |
| `--danger-600` (destructive hover) | `#A82E2E` | `#C95050` |
| `--ok-500` (success) | `#2E8B57` | `#52BE80` |
| `--warn-600` (warning) | `#B47207` | `#D99A2B` |
| `--gray-50` (bg) | `#FAF7F2` | `#0C1420` |
| `--gray-100` (bg-soft/muted) | `#F3EEE5` | `#101B2B` |
| `--gray-200` (line/border) | `#E4DCCC` | `#27395A` |
| `--gray-500` (text-3/muted-fg) | `#5A6A80` | `#8FA0B5` |
| `--gray-700` (text-2) | `#45566E` | `#ADBCCF` |
| `--gray-900` (text/fg) | `#0B2545` | `#ECF1F8` |

## Semantic tokens (theme-aware)

| Token | Maps to (light) | Notes |
|------|-----------------|-------|
| `--color-primary` | `--teal-600` → `#0E7A72` | dark: `--teal-500` → `#2BB8AC` |
| `--color-primary-hover` | `--teal-700` → `#0B6B63` | dark: `--teal-600` → `#35C9BC` |
| `--color-primary-active` | literal `#095750` | dark: `--teal-700` → `#1E9D92` |
| `--color-primary-foreground` | `#FFFFFF` (dark `#06251F`) | text on primary |
| `--color-accent` / `--color-accent-hover` / `--color-accent-foreground` | `--saffron-500` / `--saffron-600` / `#3A2506` | saffron CTA |
| `--color-destructive` / `--color-destructive-soft` | `--danger-500` / `#F9E7E7` | danger actions |
| `--ring` | `0 0 0 3px color-mix(in srgb, var(--yf-teal-600) 35%, transparent)` | dark: 40% mix; shared focus token |

Evidence: `src/styles.css:18–20,181–183,112–121,235–244` — two declarations
per primary-state token and two rings. The light fill was deepened for white-label
contrast (CSS comment at `109–111`); do not reverse that fix to honour an older doc.
The grey rows above follow `src/styles.css:32,59,137,194,218,257`: two
`--gray-500` declarations, two `--text-3` aliases and two category declarations.
`#647489` has zero CSS matches.

**Gate limitation:** `tests/design-system.test.ts:145–148` checks the whole CSS
string for `--color-primary: var(--teal-500);`. Its one matching declaration is
in dark (`src/styles.css:235`), so that assertion does not gate the light mapping.
No test change is part of this correction pass.

(Removed in v0.30.0 as never-referenced: `--color-background`,
`--color-foreground`, `--color-card(-foreground)`, `--color-popover(-foreground)`,
`--color-muted(-foreground)`, `--color-border`, `--color-destructive-hover`,
`--color-destructive-foreground`, `--color-success(-foreground)`,
`--color-warning`, `--color-info-soft`.)

## Component state matrix

### Button (`.btn`)
**Variants** (background / foreground):
- `.btn-primary` → `--color-primary` / `--color-primary-foreground`
- `.btn-saffron` → `--color-accent` / `--color-accent-foreground`
- `.btn-navy` → `--text` / `--bg`
- `.btn-outline` → transparent / `--text`, border `--line`
- `.btn-ghost` → none / `--text-2`
- `.btn-danger` → `--color-destructive-soft` / `--color-destructive`

**Catalog pages:** inside `.ex-page` and `.trips-page` every `.btn` has 12px corners, weight
700 and a one-pixel press. The rest of the app keeps the pill shape.

**Sizes** (padding-y / padding-x / font):
- `.btn-sm` → 6px / 12px / 13px
- default → 9px / 17px / 14px
- `.btn-lg` → 12px / 24px / 15.5px

These three base size rules have zero `height`/`min-height` declarations
(`src/styles.css:555–561,581,591`): height emerges from padding, line box and
border, not a fixed 32/38/48px ladder. Context can override this: the ≤720px
`.btn` rule sets `min-height: 44px` (`src/styles.css:4166,4241`), and
`.bench-dock .btn` sets 40px (`src/styles.css:3900`).

**States:**
| State | Rule |
|------|------|
| default | token background |
| hover | `--color-primary-hover` (primary) / `--color-accent-hover` (saffron) / `--bg-soft` (outline/ghost) |
| active | `transform: scale(.97)`; primary uses `--color-primary-active` |
| focus-visible | `outline:none; box-shadow: var(--ring)` |
| disabled | `opacity:.55; cursor:not-allowed` |

### Input (`.input` / `.select` / `.textarea`)
- default: border `--line`, text `--text`
- focus-visible: `outline:none; box-shadow: var(--ring)`
- mobile (≤720px): min-height 44px, font-size 16px (prevents iOS zoom-on-focus)

## Accessibility notes
- `--text-3` resolves through `--gray-500` to `#5A6A80` (light) and `#8FA0B5`
  (dark), not the formerly documented `#647489` (`src/styles.css:32,137,194,257`).
  Re-check `--text-3` usage on colored surfaces; a palette value alone is not a
  contrast guarantee.
- `--yf-text-muted` was deepened light-only from `#637B7D` to `#566A6C`: the old
  value measured 4.19:1 on `--yf-cream` and 4.36:1 on `--yf-surface`, both under
  AA for the 10.5-13.5px text it paints (`.eyebrow`, `.cal-trigger .muted`,
  `.unit-input .unit`, `.unit-input .group-lab`, `.mini-lab`). Now 5.01:1 and
  5.53:1. The dark value was already AA and is unchanged.
- All interactive elements share one `--ring` focus token — keyboard users get a
  consistent, visible focus indication in both themes.
- Touch targets on mobile are ≥40px per the `@media (max-width:720px)` block.
- **The `--ink-*` family is the AA-bearing text layer for tinted surfaces** —
  `--ink-amber` / `--ink-ok` (SYS-3a), plus `--ink-coral` (`#A82E2E`; 5.16–5.69
  on the soft danger tints where `#C93B3B` read 4.22:1) and `--ink-teal`
  (`#0B6B63`; 5.08–5.79 on the tint chips and hover states where `--teal-deep`
  read 4.0–4.5:1). Dark re-declares each to the raw alias, whose lighter values
  already pass there, so one declaration is correct in both themes. **The
  light-theme AA exception list is now empty** — the seven previously tolerated
  pairs (danger chips, saffron chips, warn pills, the fuel chip, the icon-link
  hover) were folded into the base rules rather than exempted.

## v0.48 consistency pass

### Glass blur tiers

One ladder replaces the eight blur values previously scattered across components:

| Tier | Token | Value | Used by |
|------|-------|-------|---------|
| Chrome | `--yf-blur-nav` | 18px + `saturate(1.2)` | top nav, tab bar, user menu, notifications, board corner cards, mobile trip dock, segmented filter capsule |
| Panel | `--yf-blur-panel` | 14px + `saturate(1.15)` | sticky totals strip, location dropdown, calendar pop, `glass-soft` |
| Chip | `--yf-blur-chip` | 8px | map day chips, map legend, explore chips, hero search, role select, cover chips |
| Scrim | `--yf-blur-scrim` | 3px | modal and locked overlays |

Text-bearing overlays (map legend body) keep a near-opaque `--yf-surface` with a
glass border: readability before transparency. The locked-CTA scrim keeps
its gentler 1.5px frost by design.

### Native-shell dialect (the installed app)

`html.native-shell` — set by `main.tsx` inside Capacitor — deliberately renders
a **flatter variant**: backdrop blur on the nav / bottom-nav / glass layers and
the landing's decorative animations are switched off for WebView performance,
scrollbars are hidden, and the shell swaps the website topnav for the
`BottomNav`. This is a platform dialect, not a regression to repair: the same
tokens, the same hierarchy, fewer GPU effects. A future "the app looks flatter
than the site" pass should read this paragraph first.

### One green

`--teal-500` is now `#0D8D82` (the CTI primary), so primary buttons, focus rings,
form accents and selected states all resolve to a single green. The dark theme
already resolved to `#2BB8AC` in both families, so nothing there changes.

### Typography policy

- **Catalog pages:** Explore and My trips set a hero headline in Playfair Display 600
  (`--font-serif`) with one italic accent phrase. They set the handwritten note in Caveat 600
  (`--font-hand`). Their section titles are Plus Jakarta Sans 800 (28px, 24px on a phone). Their
  card titles are Plus Jakarta Sans 700 (19px). Do not use the two hero fonts anywhere else.
- **Weights:** only 500/600/700/800. The font link loads Plus Jakarta Sans
  400-800 (it was Inter until Sep 2026 - the ramp is identical, which is why the
  weight gate moved not at all) and Sora 600-800. Plus Jakarta Sans alone loads
  400, so never set 400 on Sora. Never declare a weight the link does not load -
  the browser fakes it with synthetic bold.
- **Micro-labels ("kickers"):** the incumbent recipe is 10.5px / 700 / `.06em` /
  uppercase via CSS `text-transform`; keep source text sentence case. Each of
  `--kicker-size`, `--kicker-weight`, `--kicker-tracking` has one declaration
  (`src/styles.css:5208`) and one recipe consumer (`5259–5262`).
  **Legacy exception, settled for this reconciliation:** grandfather the incumbent
  `.eyebrow`/kicker recipe; add no new above-heading kickers. Leave the labels,
  tokens and gate alone. `craft-floor.md:27` (Impeccable reference) bans an eyebrow
  above a heading; this exception preserves the existing recipe, not permission
  to extend it. The unified block includes `.eyebrow` (`src/styles.css:5250–5263`)
  and its gate remains at `tests/design-system.test.ts:197–202`.
- **Type scale:** only `--text-xs: 11px` exists — one declaration and one
  `var()` usage, the bottom-nav label (`src/styles.css:5198,5207`).
  `--text-2xs`, `--text-sm`, `--text-base`, `--text-md`, `--text-lg`, `--text-xl`
  and `--text-2xl` are absent: each has zero declarations and zero usages in
  `src/styles.css`. The CSS records deletion rather than adoption of the unused
  steps (`5202–5205`); the previously documented eight-step scale does not exist.
- **Spacing scale:** the historical `--s-1…--s-8` set stays deleted (it never
  had a consumer). The ladder now lives in `--space-1…--space-10`
  (2/4/6/8/12/14/16/20/22/24 — the spacing gate's `LADDER` set exactly), added
  **with adopters** per the adopt-or-delete rule (`.card` padding, `.poi-grp`
  gap/margins, `.opt-delta`, `.day-warn-pill`). No value changed; only the home
  is new. A pin in `tests/design-system.test.ts` fails the build if the ramp and
  the gate's ladder drift apart, and the literal-padding inventory below is a
  dated snapshot of what has not yet moved.

### Icon stroke

- Stroke comes from the `--icon-stroke` tokens in `src/styles.css`. Do not set stroke with a `strokeWidth` prop. The CSS rule overrides the SVG attribute, so the prop has no effect.
- Glyphs at 12px and under use `--icon-stroke-sm`, through the `.ic-sm` class.

### Radii

Card and popover radii touched by the consistency pass use `--radius-sm` (12), `--radius` (18) or
`--radius-lg` (24); pills use 999px — the eight rules that spelled the pill radius `99px` (tracks,
badges, chip counts) are unified on `999px`, and every one is a small-height element where the two
values clamp identically. A handful of one-off card radii (9-14px) remain, staged for the spacing sweep. The mobile trip dock, sticky totals strip
and board corner cards moved from 16/20 to `--radius`.

### Z-index ladder

All 15 tokens below are declared once in `src/styles.css:78–94`; all have at
least one `var()` consumer (counts are declaration consumers, not rendered
instances). Roles and the tie rationale follow the CSS comments there.

| Token | Value | Role | Consumers |
|------|------:|------|-----------:|
| `--z-under` | 0 | decorative layers | 5 |
| `--z-content` | 1 | content above decor | 8 |
| `--z-raised` | 2 | second local layer | 5 |
| `--z-topbar` | 3 | board topbar | 1 |
| `--z-frost` | 5 | frosted local overlays | 4 |
| `--z-strip` | 40 | sticky trip totals | 1 |
| `--z-dock` | 55 | mobile chrome below nav | 3 |
| `--z-nav-glass` | 60 | floating glass chrome | 9 |
| `--z-map-expanded` | 70 | expanded map below dialogs | 1 |
| `--z-ai-fab` | 70 | AI floating action button | 1 |
| `--z-notif` | 80 | notification popover | 1 |
| `--z-drawer` | 90 | AI drawer | 1 |
| `--z-modal` | 100 | modal overlay | 1 |
| `--z-toast` | 200 | toast zone | 1 |
| `--z-impact` | 210 | impact sheet above toasts | 2 |

**Intentional tie:** `--z-map-expanded` and `--z-ai-fab` both equal 70; DOM order
resolves the tie, explicitly preserved by the CSS (`src/styles.css:88–89`).
The 60 rung also preserves DOM ordering (`85–87`). These are documented
intentions, not a new stacking decision.

### Bottom chrome (native shell)

One offset every page-level bottom layer clears: the shell's own bottom
navigation row plus the device's gesture bar. Outside `html.native-shell` the
shell term is `0px`, so both the offset and every consumer of it collapse to
exactly the gesture-bar inset the web resolved before this family existed —
which is what makes the website provably unaffected.

| Token | Web | Native shell | Use |
|------|-------|------|-----|
| `--safe-bottom` | gesture-bar inset | gesture-bar inset | the `var(--safe-area-inset-bottom, env(…, 0px))` chain, named once |
| `--shell-nav-h` | `0px` | `58px` | height of the shell's bottom navigation row |
| `--bottom-ui-offset` | `calc(0px + --safe-bottom)` | `calc(58px + --safe-bottom)` | bottom offset for page-level fixed/sticky chrome |

Consumers (a `bottom` or `padding-bottom`): `.app-shell`, `.toast-zone`,
`.ai-fab`, `.bench-dock`, `.ts-savebar`, `.trip-dock`, plus the shell's
`scroll-padding-bottom`. The overlays that intentionally own the true bottom
edge — `.modal` / `.modal-overlay`, `.impact-sheet`, `.ai-drawer` /
`.ai-input-row`, `.map-shell--expanded` — keep the raw inset and are deliberately
NOT lifted: they paint above the nav (`--z-modal` 100, `--z-impact` 210,
`--z-drawer` 90, `--z-map-expanded` 70 all beat `--z-nav-glass` 60).

The bar itself is `height: calc(var(--shell-nav-h) + var(--safe-bottom))` with
`padding-bottom: var(--safe-bottom)`. `box-sizing` is border-box, so
padding-only would eat into the 58px row and drop the items under Material's
48dp tap floor.

## Measured appendix — reconciliation snapshot

**Verified method:** grep located the declarations; a PostCSS declaration walk
counted every authored occurrence, including overridden rules and media blocks,
excluding comments, custom-property definitions and other shorthands. `padding`
counts only its first value (not padding longhands). Distinct values below are
whole authored value strings unless explicitly normalised; `var()` values are
not expanded. These are inventories, not defects or a proposed replacement scale.

Snapshot: `src/styles.css:1–5433`, SHA-256
`fa96fea0353d8fca62db4698d4d2339a4a44c11ec6706cdd3e118f304cb27e06`.
All `.pr-*` rules, including the on-screen preview, and `@media print` are counted
separately (`src/styles.css:1986–2055`). Print's `pt` units are correct, not defects.

| Screen property | Measured inventory | Source range (print excluded) |
|------|------|------|
| `font-size` | 36 distinct literal px sizes across 355 declarations. Top five: 13px **45×**, 12px **44×**, 12.5px **37×**, 11px **36×**, 11.5px **25×**. Total 368 declarations / 49 whole values: also 11 `clamp()` values and 2 token references. | `src/styles.css:382–5414` |
| `letter-spacing` | 64 declarations / 24 authored values; 20 after normalising leading zeros (19 numeric values + 1 token reference). `.04em` **10×**, `.06em` **9×**, `.08em` **8×**. | `src/styles.css:432–5388` |
| `line-height` | 50 declarations / 18 values: 15 unitless values (47 declarations), plus 13px / 17px / 18px (one each). This mixes units across the stylesheet, not inside one declaration. | `src/styles.css:382–5352`; px at `2332,2469,5086` |
| `padding` first value | 266 declarations / 34 values. Top five: 0 **35×**, 10px **27×**, 8px **25×**, 9px **24×**, 2px **17×**. 20 values are off a 4px base, covering **162/266 (60.9%)** declarations. | `src/styles.css:391–5421` |
| `border-radius` | 261 declarations / 32 whole values: **53 token-routed (20.3%)**, **206 literal (78.9%)**, **2 inherit (0.8%)**. Mixed token/literal corner lists count as token-routed. | `src/styles.css:378–5414` |
| `font-weight` | 214 declarations: 500 **9×**, 600 **60×**, 700 **76×**, 800 **68×**, `var(--kicker-weight)` **1×** (700). Zero explicit 400 declarations; this does not mean inherited normal text is absent. | `src/styles.css:382–5414`; token at `5208` |

Off-4px padding first-values, in px (value × declarations):
1×6, 2×17, 2.5×1, 3×11, 5×15, 6×8, 7×9, 9×24, 10×27, 11×6,
13×3, 14×14, 15×4, 17×1, 18×6, 21×2, 22×2, 26×4, 42×1, 54×1.
Evidence: the `padding` inventory at `src/styles.css:391–5421`, excluding the
print/preview block; zero and multiples of 4px are not counted as off-base.

**Print/preview inventory** (`src/styles.css:2002–2040`):
- `font-size`: 11 declarations / 6 values — 9.5pt **5×**, 8.5pt **2×**,
  10pt / 10.5pt / 12.5pt / 17pt **1×** each.
- `letter-spacing`: `-0.01em` **1×**. No explicit `line-height` declaration;
  `.pr-sheet` separately uses the shorthand `font: 10.5pt/1.5 var(--font-body)`
  (`2002`), excluded from the longhand counts above.
- `padding` first-values: 6 declarations / 5 values — 2pt **2×**;
  0, 2.5pt, 8pt and preview 18px **1×** each.
- `border-radius`: 3 literal declarations / 3 values — 6pt, 3pt and preview
  12px **1×** each; zero token-routed declarations.
- `font-weight`: 700 **3×**; one distinct explicitly declared value.

## Proposals not applied

- **Two greens — open, not an intentional-unification claim.** The historical
  “One green” paragraph above is retained pending the requested user decision;
  it is not true of light primary buttons today. Verified: light primary uses
  `--teal-600` / `#0E7A72` (one light declaration, `src/styles.css:19,112,568`);
  the root accent and light ring use `--yf-teal-600` / `#0D8D82`
  (`15,39,121`). The shared input focus border uses `--teal` → `--teal-500`,
  also `#0D8D82` (`18,139,641–642`), not directly `--yf-teal-600`.
  Dark primary and CTI teal both resolve to `#2BB8AC` (`181,200,235`).
  **Is the remaining light split deliberate, or should light unify on one green,
  and which?** Preserve the deeper button's contrast fix (`109–111`); do not
  treat a lighter fill as an acceptable default resolution.
- **Gate coverage:** should the primary-chain assertion become theme-scoped so
  light and dark mappings are checked independently? The current single global
  string assertion only finds dark (`tests/design-system.test.ts:145–148`,
  `src/styles.css:235`); no test edits were made here.
- **Literal rhythm — inference, not a verified defect:** should the 20 off-4px
  padding values and three px line-heights be reviewed by role, or retained as
  local optical/density choices? The measured appendix establishes variation,
  not intent; no scale adoption or CSS normalisation was performed.

## Reconciliation check result

`npx vitest run tests/design-system.test.ts`: **29 passed, 3 failed** during
concurrent CSS work. The primary-chain and kicker tests passed. The failures
were the light contrast, dark contrast and raw-duration ratchets
(`tests/design-system.test.ts:479,483,517`, reporting through `410`). Reported
entries: light `.ride-purpose-fuel` (4.45:1); dark `.yf-map-idea-add` (2.05:1),
`.bench-bubble` (3.34:1), `.route-btn:hover:not(:disabled)` (4.09:1); 25
raw-duration entries. These are test-output observations, not browser-verified
contrast results or proof of a new regression. CSS line numbers changed during
the pass; no source, tests or baselines were edited for this reconciliation.

## Status since the reconciliation snapshot (2026-09-22 design-audit pass)

The token layer changed after the measured appendix above, without a full
re-measure: the categorical ramp and the `--ink-*` additions (see their tables),
the `--space-*` ramp with its first adopters, the shadow hue unified on
`--shadow-navy-rgb` (two hardcoded `16,46,75` shadows joined the shared var),
eight `99px` pills spelled `999px`, and two dead kicker spec blocks deleted —
the kicker-unification block was already the render truth, because it is
declared later at equal specificity and therefore wins; a static read that
compares the base declarations alone will wrongly call the recipe inconsistent.
Line references in the historical sections above may be stale, and the
appendix's counts describe the pre-pass file.
