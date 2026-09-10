# YatraFlow Design Tokens

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
| `--yf-text-muted` | `#637B7D` | `#8FA0B5` | secondary text |
| `--yf-glass` / `--yf-glass-border` | `rgba(255,255,255,.58)` / `rgba(255,255,255,.65)` | `rgba(16,27,43,.58)` / `rgba(255,255,255,.14)` | level-2 overlays |

(`--yf-ink`, `--yf-mint` and `--yf-surface-muted` were removed in v0.30.0 —
defined but never referenced by any component.)

**Expense-category tokens (v0.36.0, Budget tab):** one hue per spend category,
consumed by the "Where the money goes" bars and the per-line icon chips.
Defined in `:root` and mirrored in `[data-theme='dark']` — reference the token,
never the hex.

| Token | Light | Dark | Category |
|------|-------|------|-----|
| `--cat-transport` | `#897ABB` | `#A99BD6` | transport |
| `--cat-accommodation` | `#0D8D82` | `#2BB8AC` | accommodation |
| `--cat-food` | `#F59E2D` | `#F5A94A` | food |
| `--cat-activities` | `#2E8B57` | `#52BE80` | activities |
| `--cat-entry-fees` | `#D6534D` | `#E06C6C` | entry fees |
| `--cat-tolls-parking` | `#8291A6` | `#93A6BC` | tolls & parking |
| `--cat-local-travel` | `#B47207` | `#D99A2B` | local travel |
| `--cat-emergency-buffer` | `#E4AE43` | `#E4B45E` | emergency buffer |

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

## Primitive palette

| Token | Light | Dark |
|------|-------|------|
| `--teal-500` (primary) | `#0D8D82` | `#2BB8AC` |
| `--teal-600` (primary hover) | `#0E7A72` | `#35C9BC` |
| `--teal-700` (primary active) | `#0B6B63` | `#1E9D92` |
| `--saffron-500` (accent) | `#F59E2D` | `#F5A94A` |
| `--saffron-600` (accent hover) | `#E0860F` | `#E0860F` |
| `--danger-500` (destructive) | `#C93B3B` | `#E06C6C` |
| `--danger-600` (destructive hover) | `#A82E2E` | `#C95050` |
| `--ok-500` (success) | `#2E8B57` | `#52BE80` |
| `--warn-600` (warning) | `#B47207` | `#D99A2B` |
| `--gray-50` (bg) | `#FAF7F2` | `#0C1420` |
| `--gray-100` (bg-soft/muted) | `#F3EEE5` | `#101B2B` |
| `--gray-200` (line/border) | `#E4DCCC` | `#27395A` |
| `--gray-500` (text-3/muted-fg) | `#647489` | `#8FA0B5` |
| `--gray-700` (text-2) | `#45566E` | `#ADBCCF` |
| `--gray-900` (text/fg) | `#0B2545` | `#ECF1F8` |

## Semantic tokens (theme-aware)

| Token | Maps to (light) | Notes |
|------|-----------------|-------|
| `--color-primary` | `--teal-500` | primary action |
| `--color-primary-hover` | `--teal-600` | primary :hover |
| `--color-primary-active` | `--teal-700` | primary :active |
| `--color-primary-foreground` | `#FFFFFF` (dark `#06251F`) | text on primary |
| `--color-accent` / `--color-accent-hover` / `--color-accent-foreground` | `--saffron-500` / `--saffron-600` / `#3A2506` | saffron CTA |
| `--color-destructive` / `--color-destructive-soft` | `--danger-500` / `#F9E7E7` | danger actions |
| `--ring` | `0 0 0 3px color-mix(teal 35%)` | focus ring (all `:focus-visible`) |

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

**Sizes** (height / padding-x / font):
- `.btn-sm` → 32px / 12px / 13px
- default → 38px / 17px / 14px
- `.btn-lg` → 48px / 24px / 15.5px

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
- `--text-3` was darkened from `#8291A6` → `#647489` (light) to improve small-text
  contrast against `--bg-soft` (toward WCAG AA). Re-check any remaining
  `--text-3` usage on colored surfaces.
- All interactive elements share one `--ring` focus token — keyboard users get a
  consistent, visible focus indication in both themes.
- Touch targets on mobile are ≥40px per the `@media (max-width:720px)` block.

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
glass border: readability before transparency. The public-hero photo and locked-CTA scrims keep
their gentler 1.5px frost by design.

### One green

`--teal-500` is now `#0D8D82` (the CTI primary), so primary buttons, focus rings,
form accents and selected states all resolve to a single green. The dark theme
already resolved to `#2BB8AC` in both families, so nothing there changes.

### Typography policy

- **Weights:** only 500/600/700/800. The font link loads Inter 400-800
  (800 added) and Sora 600-800. Never declare a weight the link does not load -
  the browser fakes it with synthetic bold.
- **Micro-labels ("kickers"):** one recipe - 10.5px / 700 / `.06em` / uppercase,
  applied with CSS `text-transform`. Never type capitals in components.
- **Type scale:** `--text-2xs` 10.5 · `--text-xs` 11 · `--text-sm` 12.5 ·
  `--text-base` 14 · `--text-md` 15.5 · `--text-lg` 17 · `--text-xl` 20 ·
  `--text-2xl` 24 (px). Kicker tokens: `--kicker-size`, `--kicker-weight`,
  `--kicker-tracking`.
- **Spacing scale:** `--s-1` 4 · `--s-2` 6 · `--s-3` 8 · `--s-4` 12 ·
  `--s-5` 16 · `--s-6` 20 · `--s-8` 24 (px).

### Radii

All card/popover radii now use `--radius-sm` (12), `--radius` (18) or
`--radius-lg` (24); pills use 999px. The mobile trip dock, sticky totals strip
and board corner cards moved from 16/20 to `--radius`.
