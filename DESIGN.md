---
name: YatraFlow
description: Calm Travel Intelligence — a warm, map-aware, glass-accented planning system for India trips that work in the real world.
colors:
  planning-teal: "#0E7A72"
  calm-teal: "#0D8D82"
  teal-pressed: "#0B6B63"
  teal-selected-bg: "#E5F4EE"
  chart-navy: "#123F49"
  ink: "#0B2545"
  ink-2: "#45566E"
  ink-3: "#5A6A80"
  canvas-cream: "#F8F7EF"
  surface: "#FFFFFF"
  surface-soft: "#F3EEE5"
  line: "#E4DCCC"
  marigold-saffron: "#F59E2D"
  saffron-soft: "#FCF0DC"
  amber-ink: "#8F5B06"
  ok-green-ink: "#1F6B41"
  coral-critical: "#C93B3B"
  scenic-purple: "#897ABB"
  dark-canvas: "#0C1420"
  dark-surface: "#16233A"
  dark-teal: "#2BB8AC"
typography:
  display:
    fontFamily: "Sora, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Sora, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.05em"
rounded:
  sm: "12px"
  md: "18px"
  lg: "24px"
  pill: "999px"
spacing:
  space-1: "2px"
  space-2: "4px"
  space-3: "6px"
  space-4: "8px"
  space-5: "12px"
  space-6: "14px"
  space-7: "16px"
  space-8: "20px"
  space-9: "22px"
  space-10: "24px"
components:
  button-primary:
    backgroundColor: "{colors.planning-teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "9px 17px"
  button-primary-hover:
    backgroundColor: "{colors.teal-pressed}"
    textColor: "{colors.surface}"
  button-saffron:
    backgroundColor: "{colors.marigold-saffron}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "9px 17px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "20px"
  chip-selected:
    backgroundColor: "{colors.calm-teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "5px 13px"
  stat-value:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
---

# Design System: YatraFlow

## Overview

**Creative North Star: "Calm Travel Intelligence"**

YatraFlow is a high-quality travel planning studio, not a booking site and not an
over-styled SaaS dashboard. The system blends warm minimalism (cream foundations,
mint atmosphere, saffron highlights, generous spacing) with the clarity of modern
collaborative software (compact metric cards, filters, status chips, actionable
controls), restrained glassmorphism for chrome and map overlays (translucent nav,
broad low-contrast shadows), and an editorial register for public itineraries.
Every choice has to stay connected to a real travel outcome: route time, fatigue,
cost, stays, commitments, votes, changing plans.

The canvas is quiet and the actions are not. Pale grounds, thin borders and soft
depth carry the atmosphere; teal carries the primary planning verb; saffron carries
invite, share, publish and explore; amber carries trade-offs and pending decisions;
coral is reserved for genuine risk. Colour is semantic before it is decorative —
the same hue never means two things on two screens.

The system is deliberately *not* a destination-imagery product, not a low-contrast
embossed one, and not a fintech console in travel clothes. Density is honest about
data (tables, ledgers, funnels) while the surfaces around it stay calm, and every
number that drives a decision uses tabular figures so it can be scanned and compared.

**Key Characteristics:**
- Cream canvas (`#F8F7EF`) with a restrained mint/peach atmosphere gradient.
- One brand teal (`#0D8D82`) as the single primary accent; a second, deeper teal
  (`#0E7A72`) is used for fills that carry white text so the label clears AA.
- Sora for display and figures, Plus Jakarta Sans for body; tabular numerals wherever a number
  is compared. The page h1 uses Playfair Display (`--font-serif`), set by `PageHeader` and the
  catalog heroes. A handwritten note uses Caveat (`--font-hand`). Each face has a fixed scope; see Typography.
- Pill-first form language: 999px chips and segmented rails; 12/18/24px radii for cards and
  inputs. Buttons are 12px on the two catalog pages and pills elsewhere.
- Depth from soft navy shadows and four blur tiers — never from heavy borders.
- Copy states consequences in plain sentences ("2 travellers still need to vote"),
  never system language ("data unavailable").

## Colors

A warm cream ground with one teal accent, a navy structure colour, and a small set
of status hues that keep their meaning across every surface and both themes.

### Primary
- **Calm Teal** (`#0D8D82`, `--yf-teal-600` / `--color-primary` in dark): the CTI
  primary. Active tabs, selected chips, focus ring, positive route progress.
- **Planning Teal** (`#0E7A72`, `--color-primary` in light): the primary button
  fill. Deliberately one notch deeper than Calm Teal so its white label clears AA
  (4.08 → 5.19 at rest); the whole ladder deepens one step so hover stays darker
  than rest (`#0B6B63`).
- **Selected Teal Tint** (`#E5F4EE`, `--yf-teal-100`): selected backgrounds and
  low-emphasis success surfaces. In dark this becomes `#12332F`.

### Secondary
- **Marigold Saffron** (`#F59E2D`, `--saffron`): invite, share, publish, explore —
  meaningful social actions and warm attention. Never a primary verb.
- **Chart Navy** (`#123F49`, `--yf-navy`): header bands, dark cards, the anchor
  surface for map and AI panels.

### Tertiary
- **Amber Ink** (`#8F5B06`, `--ink-amber`): trade-offs, pending answers, route
  pressure. The deepened text ink — raw amber only passes ~3.5:1 on light tints.
- **Critical Coral** (`#C93B3B`, `--color-destructive`): blocked plans, missed
  commitments, destructive actions.
- **Scenic Purple** (`#897ABB`, `--yf-purple`): optional, creative, discovery-only.
- **Category hues** (`--cat-*`, eight): a dedicated categorical family for expense
  bars and per-line chips, kept ≥15° apart. It is deliberately *not* the status
  palette — entry fees once wore the critical coral and a money bar read as an alert.

### Neutral
- **Ink** (`#0B2545`): primary text and strong structure.
- **Ink 2** (`#45566E`) / **Ink 3** (`#5A6A80`): secondary text, helper copy,
  qualifiers.
- **Canvas Cream** (`#F8F7EF`): the app canvas. **Surface** (`#FFFFFF`): readable
  cards and inputs. **Surface Soft** (`#F3EEE5`): secondary surfaces.
- **Line** (`#E4DCCC`): 1px borders and dividers.

### Named Rules
**The One Green Rule.** There is exactly one brand green, `#0D8D82`. Every teal in
the product derives from it; a second, unrelated green is a defect.

**The Semantic Colour Rule.** Teal = primary planning action. Saffron = invite,
share, publish, explore. Mint/green = confirmed, saved, synced. Amber = attention,
trade-off, pending. Coral = critical risk. Purple = optional inspiration. A hue
never carries two meanings.

**The AA Ink Rule.** Status text uses the deepened inks (`--ink-amber`, `--ink-ok`,
`--ink-coral`, `--ink-teal`), not the raw primitives, which fail on light tints.

## Typography

**Display Font:** Sora (with Plus Jakarta Sans, system-ui fallback) - loaded 600, 700, 800
**Body Font:** Plus Jakarta Sans (with system-ui, -apple-system fallback) - loaded 400-800

**Character:** Confident and warm rather than corporate. Sora carries headings,
panel titles and every decision-bearing figure; Plus Jakarta Sans carries prose and controls.
The catalog pages (Explore and My trips) differ. Their section titles and card titles use
Plus Jakarta Sans (800 and 700). Their hero headline uses Playfair Display 600 with one
italic accent phrase. A short handwritten note beside the hero uses Caveat 600.

**Font scope (ruling R14).** The serif face (Playfair Display, `--font-serif`) sets the page h1 only. You must use it only in `.ex-hero h1` and `.yf-header-title`. The hand face (Caveat, `--font-hand`) sets the handwritten note only. You must use it only in `.ex-note` and `.yf-header-note`. Use at most one handwritten note on a page. You must not use the hand face in a `StateBlock`. Set the note with the `note` slot of `PageHeader`. Write only a true line in the note. Mark it `aria-hidden`. Keep the same meaning in the lede. The two face names belong only in the token definitions in `:root`. Source files must not name them. The guard `tests/page-consistency.test.ts` counts the existing exceptions.

Discouraged weights are not merely avoided in new code — a gate fails the build if a
declared weight is not in the loaded set.

### Hierarchy
- **Display** (800, 23px, 1.15): the metric tile figure — the number a decision hangs on.
- **Title** (700, 16px, 1.3): panel titles and publication names at row level.
- **Card title** (800, 18px, 1.25): card titles, such as the title of a compact `StateBlock`.
- **Body** (400–500, 15px, 1.55): prose, hints, notes. Helper copy runs 12.5px.
- **Label** (600, 12px, 0.05em, uppercase via CSS): stat labels and kickers. Short
  metadata only — the source text stays sentence case and CSS owns the caps.
- **Micro-label** (700, 10.5px, `--kicker-size`): the unified kicker block, frozen
  from before the type floor existed.
- **Numerals**: tabular everywhere a number is compared (`font-variant-numeric`).

### Named Rules
**The Type Floor Rule.** No new type below 11px. Existing 9–10.5px declarations are
frozen in a baseline that may only shrink. 12px+ is the target for anything carrying
a number.

**The Kicker Casing Rule.** Sentence case in source, uppercase in CSS. Visible
all-caps strings in markup are a violation unless on the short documented allowlist.

### Phase 0 notes: title font

**Title font.** Plus Jakarta Sans 800 is the title font. Sora is retired for titles.
Phase 0 makes no global heading font change. Each page adopts the title font when you migrate it.
The final cleanup removes Sora from titles.

## Layout

A centred container, `max-width: 1180px` with `padding: 0 20px`. Pages open with a
`padding-top` of 24px. Rhythm comes from a ten-step spacing ladder — 2, 4, 6, 8, 12,
14, 16, 20, 22, 24px (`--space-1`…`--space-10`) — and new spacing values must land on
it; off-ladder values are frozen and may only shrink.

Breakpoints are content-derived, not device presets. `1280px` (min) is the app's own
split threshold — the map tab, and the Creator hub's two-column dashboard grid
(2fr / 1fr with `align-items: start`). `720px` (max) is the single mobile block.
Narrow-phone rungs at `560`, `480`, `440`, `360` and `350px` tighten the header
rather than hiding controls. Mobile stacks: rows become columns and full-width
controls, and any flex row that carries actions must be allowed to wrap.

The full set in the stylesheet — `1400`, `1280↑`, `1279`, `1278`, `1100`, `980`,
`900`, `721↑`, `720`, `700`, `640`, `640↑`, `578`, `560`, `480`, `440`, `360`,
`350` — is what accumulated from each point where content stopped fitting, which is
the only justification a new one gets. Prefer the existing threshold that matches
the content's real limit over adding a neighbouring number.

**Named Rules**
**The Container Rule.** Page content lives inside `.container` (1180px, 20px inline
padding); backgrounds and media may bleed, controls and text may not.

**The Logical Property Rule.** Direction-dependent padding, margin and borders use
`padding-inline-*`, `margin-inline-*`, `border-inline-start` — physical left/right
only for genuinely physical geometry.

### Phase 0 notes: page width and skin

The `yf-page` class gives a page the catalog container width.
The planned page width token is `--page-max`, at 1240px. It is not yet defined in `src/styles.css`. Do not use it until it is defined.
Add new page-skin rules at the end of `src/styles.css`. Do not edit the older rules.

## Elevation & Depth

A hybrid, leaning on soft navy shadows and tonal atmosphere rather than heavy
borders. Cards sit on the cream canvas with a 1px line border and a broad,
low-contrast shadow; chrome floats above content with restrained glass. Blur is a
four-tier vocabulary, never an ad-hoc value — a gate fails any `backdrop-filter`
that does not route through a tier token. Dense data stays near-opaque by rule.

### Shadow Vocabulary
- **`--shadow-sm`** (`0 1px 2px rgba(11,37,69,.07)`): resting small surfaces.
- **`--shadow`** (`0 1px 2px … .05, 0 8px 28px … .08`): standard cards.
- **`--shadow-soft`** (`0 2px 6px … .04, 0 16px 40px … .10`): the CTI diffuse
  depth used by floating glass chrome.
- **`--shadow-glow-teal`** (`0 2px 10px rgba(13,141,130,.35)`): the selected pill's
  brand glow — one triplet, not three.
- **`--shadow-carry`**: the lifted card while a row is being dragged.

### Glass tiers
- **nav** 18px · **panel** 14px · **chip** 8px · **scrim** 3px (`--yf-blur-*`).

### Named Rules
**The Not-Pure-Glassmorphism Rule.** Dense itinerary cards, form fields, tables and
financial data remain near opaque. Glass is for chrome, overlays and map panels.

## Shapes

Pill-first. Buttons, chips, segmented rails and status pills are fully rounded
(`999px`); cards and inputs use the radius ladder — `12px` (`--radius-sm`), `18px`
(`--radius`, the default card), `24px` (`--radius-lg`, large bento panels).
Boundaries are a single hairline in `--line`; list rows separate with a dashed
border rather than a heavy rule. Focus is a 3px solid ring (`--ring`) on
`box-shadow`, never a removed outline — a gate measures it for 3:1 against the
adjacent colours.

## Illustration

Papercut scenes are the picture for trip and place cards when the user has no cover photo.
The style is layered cut paper, flat colour and soft paper grain. The images contain no text,
no faces and no maps. Use the palette tokens above when you make or edit a scene.

Each scene has one image for both themes. The dark scrim sits over the image, as it does over
the inline SVG motif. A user cover photo always wins over a generated scene.

The files, the manifest and the size budget are described in
[`docs/ART-PIPELINE.md`](docs/ART-PIPELINE.md). The style brief is in
[`design/art/STYLE.md`](design/art/STYLE.md).

## Components

### Buttons
- **Shape:** pill (999px), 1.5px transparent border, `9px 17px` padding, 600 weight,
  14px label.
- **Primary:** Planning Teal fill with white ink; hover deepens to `#0B6B63`.
- **Saffron:** marigold fill for invite/share/publish actions.
- **Outline / Ghost:** transparent ground with a line border / no border; the
  destructive path uses ghost + a confirmation dialog.
- **Hover / Focus:** `translateY` lift is reserved for chips; buttons use shadow and
  background transitions from the motion tokens. Focus is the ring, always visible.
- **Motion:** durations come only from the motion tokens; a raw `ms` in new CSS is a
  review flag.

### Chips
- **Style:** pill, 1.5px line border, card ground, 12.5px / 600.
- **State:** selected chips paint `--teal-deep` with white ink and the brand glow;
  inside a `PillNav` the sliding glider owns the active paint instead, so the chip
  itself goes transparent.
- **Tones:** ok / saffron / info tints carry status; each must state its own ink
  colour in the same rule as its background so the contrast gate can measure it.

### Cards / Containers
- **Corner Style:** 18px (`--radius`), 24px for large panels.
- **Background:** Surface white on the cream canvas; chart navy for dark anchor
  panels.
- **Shadow Strategy:** `--shadow` at rest; see Elevation & Depth.
- **Border:** 1px `--line`.
- **Internal Padding:** `--space-8` (20px).

### Inputs / Fields
- **Style:** 12px radius, card ground, 1.5px line border.
- **Focus:** the shared `--ring`.
- **Error:** message text in the deepened danger ink, placed under the field, in
  sentence case.

### Navigation
- **Top nav:** a floating glass pill (18px blur tier) with the brand mark, section
  links and an account tray; the signing-out CTA is saffron. Tightens at 560/480/440/
  360/350px rather than dropping controls.
- **Tabs:** `PillNav` segmented rails with a sliding glider; the glider is the only
  active paint. Above 350px the auth pair is the only path to an account, so the
  wordmark is the one element that may hide.

### Signature Component: the recorded-traffic trend
The Creator hub's trend draws visits (area), forks (line) and unlocks (marks) on ONE
shared scale — a second axis would make unlocks look healthy beside a visits collapse.
It shares one window rule and one clock with the table beneath it, so the chart and
the rows can never describe different periods, and a failed read never renders as a
zero: the empty state only appears once the log was actually read.

### Phase 0 notes: page primitives

The page primitives are in `src/components/page/`: `PageHero`, `PageHeader`, `StateBlock`, `SectionHead` and `Surface`.
Use `StateBlock` for loading, failed and empty states on a new page.
Add `yf-page` to the root of a page when you convert it. The page skin then applies to that page.

**Button skin (ruling R15).** The catalog button skin stays scoped to `yf-page` until phase P16. Before the workspace page (P2) converts, the design lead decides where the skin stops. At P16, only the corner radius and the weight move into base `.btn`.

**Segmented tabs (ruling R16).** `SegmentedTabs` is one component with two variants. Select a variant with its `semantics` prop. The tablist variant (workspace, auth, hub, admin) uses the glass `tabbar` and a teal glider. The toggle variant (Grid and List) uses `mt-seg` with an ink glider. `ViewSwitch` is its caller. The toggle must emit the active-state attribute that the glider reads.

**Compact state block (ruling R22).** Use `size="compact"` on `StateBlock` inside a workspace tab or a card. The compact block has no dashed border and smaller padding. It keeps the roles and kinds of the full block. It has no entrance of its own, so its container gives the entrance. A whole page uses the full block.

**Rich body.** The `body` prop takes a string or a ReactNode. Use a ReactNode only when the copy needs inline markup, such as a `<b>`. Keep the copy short.

**Surface roots.** Set `as` to `button` for a card that is one whole action. A button surface lifts and presses like an interactive surface. The button gets `type="button"` unless you pass a `type`. Set `as` to `details` for a card that folds. Its children must set the `<summary>`.

## Do's and Don'ts

### Do:
- **Do** keep the canvas calm and the actions obvious — cream ground, thin borders,
  soft depth, then one unmistakable primary control per view.
- **Do** use tabular numerals for every figure that gets compared.
- **Do** state consequences in plain language: "Day 3 needs a real break", not
  "Warning: schedule status has changed".
- **Do** use the deepened status inks for text on tints, and keep every colour pair
  inside one rule so it is measurable.
- **Do** use the spacing ladder and the radius ladder; promote a genuinely reusable
  value to a token rather than inventing a local exception.
- **Do** give every control a visible focus ring, a hover state and a disabled state.

### Don't:
- **Don't** build pure glassmorphism — dense data stays near opaque.
- **Don't** drift into a generic fintech dashboard; journeys and people are the
  centre, budgets are a lens on them.
- **Don't** clone booking sites: no crowded grids, no price-pressure language, no
  destination imagery that hides planning capability.
- **Don't** use neumorphism or any low-contrast embossed control.
- **Don't** make colour decorative: if a hue does not help a user decide,
  understand or share a plan, it does not belong.
- **Don't** introduce a second green, a raw duration, an off-ladder spacing value,
  or type below 11px.
- **Don't** read `PRODUCT.md`'s surface strategy into this file — page-level
  direction belongs to the surface brief.
