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

## Calm Travel Intelligence layer (design refresh, `redesign/calm-travel-intelligence`)

The redesign adds a `--yf-*` primitive scale from
`docs/redesign/YATRAFLOW_DESIGN_DIRECTION.md` §4.1. These sit **beside** the
existing primitives (evolve, don't replace); semantics re-point to them only
where the direction doc says so. Every token is mirrored in
`[data-theme='dark']`.

| Token | Light | Dark | Use |
|------|-------|------|-----|
| `--yf-ink` | `#102E4B` | `#ECF1F8` | headings, high-trust text |
| `--yf-navy` | `#123F49` | `#0F2A33` | header bands, dark cards, AI surfaces |
| `--yf-teal-600` / `--yf-teal-700` | `#0D8D82` / `#0C716D` | `#2BB8AC` / `#1E9D92` | CTI primary / pressed |
| `--yf-teal-100` | `#E5F4EE` | `#12332F` | selected backgrounds |
| `--yf-mint` | `#DFF5ED` | `#16301F` | confirmed / synced |
| `--yf-saffron` / `--yf-saffron-100` | `#F3AA3D` / `#FFF4E4` | `#F5A94A` / `#3A2C15` | invite / share / publish |
| `--yf-amber` / `--yf-amber-100` | `#E4AE43` / `#FFF7E9` | `#D99A2B` / `#36290F` | attention / trade-offs |
| `--yf-coral` / `--yf-coral-100` | `#D6534D` / `#FFF0EC` | `#E06C6C` / `#3A2020` | critical / destructive |
| `--yf-purple` / `--yf-purple-100` | `#897ABB` / `#F0EAFA` | `#A99BD6` / `#2A2440` | scenic discovery |
| `--yf-cream` | `#F8F7EF` | `#0C1420` | main canvas (now `--color-background`/`--bg` in light) |
| `--yf-mist` / `--yf-peach` | `#ECF8F4` / `#FFF2E8` | `#0F1B2B` / `#1A2030` | atmosphere gradient edges |
| `--yf-atmos-mint` / `--yf-atmos-peach` | `rgba(124,225,207,.20)` / `rgba(255,179,107,.16)` | `rgba(43,184,172,.10)` / `rgba(245,169,74,.08)` | gradient blobs |
| `--yf-surface` / `--yf-surface-muted` | `#FFFFFF` / `#F0F4F1` | `#16233A` / `#101B2B` | readable cards / inputs |
| `--yf-border` | `#DCE7E1` | `#27395A` | soft boundaries |
| `--yf-text-muted` | `#637B7D` | `#8FA0B5` | secondary text |
| `--yf-glass` / `--yf-glass-border` | `rgba(255,255,255,.72)` / `rgba(255,255,255,.65)` | `rgba(16,27,43,.72)` / `rgba(255,255,255,.14)` | level-2 overlays |

**Utilities (doc §3.3 transparency levels):**
- `.atmos` — level-1 atmospheric canvas (doc §4.2): two soft radial blobs over
  the mist→cream→peach ramp. For Landing, Explore, Public Itinerary and the
  workspace outer shell; keep it quiet behind dense content.
- `.glass` — level-2 expressive overlay (nav, map panels, hero support cards):
  translucent `--yf-glass` background + blur + light border. Readable/editable
  content stays on near-opaque `--color-card` (level 3).

**Also added:** `--radius-lg: 24px` (large bento cards) and `--shadow-soft`
(diffuse CTI depth) in both themes.

## Primitive palette

| Token | Light | Dark |
|------|-------|------|
| `--teal-500` (primary) | `#149A90` | `#2BB8AC` |
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
| `--color-background` | `--gray-50` | page bg |
| `--color-foreground` | `--gray-900` | body text |
| `--color-card` / `--color-card-foreground` | white / `--gray-900` | surfaces |
| `--color-popover` / `--color-popover-foreground` | white / `--gray-900` | dropdowns |
| `--color-muted` / `--color-muted-foreground` | `--gray-100` / `--gray-500` | disabled/secondary text |
| `--color-border` | `--gray-200` | hairlines |
| `--color-primary` | `--teal-500` | primary action |
| `--color-primary-hover` | `--teal-600` | primary :hover |
| `--color-primary-active` | `--teal-700` | primary :active |
| `--color-primary-foreground` | `#FFFFFF` (dark `#06251F`) | text on primary |
| `--color-accent` / `--color-accent-hover` / `--color-accent-foreground` | `--saffron-500` / `--saffron-600` / `#3A2506` | saffron CTA |
| `--color-destructive` / `--color-destructive-hover` / `--color-destructive-foreground` / `--color-destructive-soft` | `--danger-500` / `--danger-600` / `#FFFFFF` / `#F9E7E7` | danger actions |
| `--color-success` / `--color-success-foreground` | `--ok-500` / `#FFFFFF` | success |
| `--color-warning` | `--warn-600` | warning |
| `--ring` | `0 0 0 3px color-mix(teal 35%)` | focus ring (all `:focus-visible`) |

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
