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
