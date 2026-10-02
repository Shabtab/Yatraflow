# UI review notes — chart selection and the new-surface checklist

Two reference notes for `ui-ux-pro-max`-style reviews of this codebase, kept
because both times one was needed, the first answer was wrong.

- **Written:** 2026-10-02
- **Scope:** `src/` surfaces that draw data, and the pre-flight check for new UI
- **Related:** `scripts/uiAntipatterns.mjs` (`npm run check:ui`), the 🟣
  section of [`ROADMAP.md`](../ROADMAP.md), and the dark-theme token note in
  [`AGENTS.md`](../AGENTS.md) §4

---

## 1. Chart selection

The design guidance carries a data-shape → chart-type table. Applied to what
this app actually draws, the existing choices are **correct** — nothing here
needs changing, and this table exists so the next reviewer doesn't re-open it.

| Surface | Data shape | Type in use | Verdict |
|---|---|---|---|
| `TrendChart.tsx` — creator traffic | views + forks over time | area/line with gradient fill, `role="img"` + computed `aria-label` | correct — trend over time |
| `BudgetTab` — *Where the money goes* | spend by category (6–8 series) | horizontal bars, one `--cat-*` hue + one Lucide icon per category | correct — compare categories |
| `AdminPage` — 12-week growth | signups + trips per week | grouped bars, 10px divs, teal/saffron | defensible — discrete weekly buckets read better as bars than as a line; internal console, low stakes |
| `AdminPage` — funnel | stage counts | staged funnel | correct — funnel/flow |
| `RouteSpark` (inline, `ui.tsx`) | route across N days | compact SVG | correct at that size |
| `healthBand` / `PlanBench` | one score + a band | number + band label | correct — KPI, not a chart |

Two things worth preserving if any of these are ever touched:

- The `--cat-*` budget palette is a **categorical** family, deliberately
  separate from the status palette (`--ok`, `--danger`, `--warn`). Entry fees
  wear `--cat-entry-fees` rose, not the critical coral, so a money bar never
  reads as an alert. Don't borrow status tokens for categories.
- Every chart here is hand-rolled SVG or divs — there is no charting library.
  That's a deliberate consequence of the bundle budget, not an oversight.
  Adding one to "do charts properly" is a regression.

## 2. Pre-flight for new UI surfaces

The generic pre-delivery checklist is 20 points. For this repo, five are worth
running before a new page or component merges. The rest are either already
satisfied by a shared primitive or deliberately deviated from.

**Run these:**

1. **Accessible name for every control.** Put it in a `Field` — it injects an
   `id` and a `htmlFor`. If a control must sit outside one (deeply nested, or
   a custom component that owns its own input), set `aria-label` explicitly
   *and leave a comment saying why*, the way `CreateTrip.tsx` does for the
   cover URL (#88).
2. **`npm run check:ui`** — three mechanical rules, no false positives.
3. **Light *and* dark.** Read the token through the theme that renders it.
   `[data-theme='dark']` re-declares the whole primitive ramp, so a colour read
   off `:root` is the light ink. A ratio computed that way is a phantom.
4. **Non-colour indicator.** Every status, band or chip needs a word, a
   number or a shape — colour alone fails for ~8% of men.
5. **Coarse-pointer hit area.** 40px floor, reached through a
   `::after { inset: -6px }` extension. A new control under that needs the
   same treatment, not just a bigger icon.

**Already handled by shared code — don't re-check:**

- Reduced motion. `styles.css:3411-3422` is a global `!important` clamp on
  `*`; motion is additionally gated behind `prefers-reduced-motion:
  no-preference`. A new keyframe inherits this for free.
- Focus rings. `.lucide` stroke width and the `--ring` token are global.
- Icon-set consistency. Import from `components/icons.tsx`; `lucide-react`
  directly is fine but inherits the same stroke token.

**Deliberately deviated — do not "fix":**

- **44×44 touch targets.** This repo floors at 40px (WCAG 2.5.8 AA). 44px is
  2.5.5 AAA. A product call, not a lint.
- **line-height.** The 1.5–1.75 guidance assumes body copy. The 16 rules using
  `line-height: 1` are single-line numerics (`.stat-tile`, `.odo`,
  `.daybar-avg`); headings sit at 1.08–1.22 on purpose. Normalising these
  would be ~25 false findings and worse typography.
- **Emoji.** `weather.ts` is a real WMO code→glyph map with a text label
  beside every glyph, and `coverEmoji` is user content. Emoji are not banned
  here — emoji used *as a UI icon* are.

## 3. What a generic checklist gets wrong here

Recorded because it cost real time on 2026-10-02, twice:

- It reports the **base declaration** of a selector and ignores the override
  that actually renders. `.link-btn` reads saffron (1.98:1) at
  `styles.css:513`, but every call site also passes `.teal`, which wins.
  `.mi-money` and `.mi-place` have no call sites at all.
- It reads **one file at a time**. Whether a control is labelled depends on a
  wrapper in a *different* file, which is how 26 of 29 "unlabelled input"
  findings turned out to be already fixed.
- It **mangles non-ASCII in shell output**. `placeholder="₹"` printed as
  `placeholder="?"` and read back as a bare question mark — a fabricated
  defect that did not exist. Read the file, not the console.

The through-line: measure against what *renders*, then re-measure the fix.