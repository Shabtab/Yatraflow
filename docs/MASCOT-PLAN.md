# Chakra mascot: where to use it

Status: phases 1, 2 and 3 shipped. The state surfaces, the
moments and the inline warnings in §4 use the mascot through
`src/components/mascot/Mascot.tsx`. Phase 4 (brand) is done. The Y logo stays the app
icon and favicon, by the user's decision.

Every phase 1 placement is wired. The curious head ships as its own file,
`chakra-head-curious.svg`, for the Explore no-results state, and it stays
legible at 24 to 32 px for the inline warnings in §4.

Phase 2 is fully wired: the trip-created column and the unlock reveal open with
`chakra-celebrate`, the AI drawer shows `chakra-thinking` while it waits, and
the Plan Bench confetti now carries the proud head.

Phase 3 is wired. Five small heads ship beside the curious one —
`chakra-head-proud.svg`, `chakra-head-sleepy.svg`, `chakra-head-worried.svg`,
`chakra-head-lost.svg` and `chakra-head-chai.svg`. `warningHead()` in
`src/lib/mascot.ts` is the one map from an engine warning code to its head; a
code with no honest head returns null and the warning stays plain text.

Chakra is an Asian koel. Its tail turns into a route line that ends in a marigold map dot.
The art is in `public/brand/mascot/`. The concept sheet is [`MASCOT-SHEET.html`](MASCOT-SHEET.html).

## 1. Asset set

| File | What it shows |
| --- | --- |
| `chakra-hero.svg`, `chakra-night-hero.svg` | Neutral perch, for light and dark themes |
| `chakra-pin.svg` | Chakra on a map pin |
| `chakra-scouting.svg` | Chakra in flight on a dashed route |
| `chakra-sleep.svg` | Chakra asleep in a nest, night palette |
| `chakra-chai.svg` | Chakra next to a kulhad |
| `chakra-budget.svg` | Chakra sweats as a winged coin flies off |
| `chakra-flock.svg` | Three koels on one route |
| `chakra-expressions.svg` | Twelve labelled heads |
| `chakra-mark-face.svg`, `chakra-mark-tile.svg` | Small marks, legible at 24 px |
| `chakra-head-curious.svg`, `chakra-head-proud.svg`, `chakra-head-sleepy.svg`, `chakra-head-worried.svg`, `chakra-head-lost.svg`, `chakra-head-chai.svg` | Single heads, legible at 22 to 32 px beside inline warnings |
| `animated/chakra-*.svg` | Eleven looping animations (see section 3) |

The twelve expressions are Happy, Curious, Surprised, Sleepy, Love, Wink, Proud, Thinking, Worried, Sad, Determined and Lost.

## 2. Rules for every placement

1. Keep the failed, loading and empty states separate. Each state gets its own pose.
2. Use loading poses only while a read is in progress. Do not show a happy pose for a failed read.
3. The mascot is decoration. Give it `alt=""` and `aria-hidden="true"`. The text carries the message.
4. Do not put the mascot on a dense editor surface. Use it on states, moments and warnings.
5. In the dark theme, use the night variant. `chakra-night-hero.svg` and `chakra-sleep.svg` already have a rim light.
6. Use the mascot accent colours (blush, clay, nest) only in mascot art.
7. Load each SVG with `<img loading="lazy">`. Each file is a few kilobytes.

## 3. Animations

Each animated SVG holds its own CSS. It loops, and it stops under `prefers-reduced-motion: reduce`.

| Animation | Motion | Use |
| --- | --- | --- |
| `chakra-idle` | Blink, bob, tuft sway | Onboarding, empty headers |
| `chakra-wave` | Wing wave, happy eyes | Sign-in, first visit, invite accepted |
| `chakra-loading` | Wing flap, route dashes march | Route and suggestion loading |
| `chakra-thinking` | Three dots pulse | AI drawer while it answers |
| `chakra-celebrate` | Hop, confetti, sparkles | Trip created, plan unlocked |
| `chakra-love` | Heart eyes beat, hearts float | Trip saved or liked |
| `chakra-chai` | Steam rises | Break warning |
| `chakra-budget` | Coin flutters off | Budget over its cap |
| `chakra-sleep` | Slow breath, z floats | Night halt |
| `chakra-sad` | Droop, tear falls | Failed read, error boundary |
| `chakra-lost` | Dizzy eye spins | Offline, missing page |

Motion rule (AGENTS §2.10): the loop timings live inside the SVG asset, not in `src/styles.css`.
The entrance of the box that holds the mascot must still use the tokens in `MOTION-TOKENS.md`.
An animation must not run in a list. Use one animated mascot per screen at most.

## 4. Placements

### Phase 1: states (largest reach, lowest risk)

| Surface | File | Today | Chakra |
| --- | --- | --- | --- |
| Route-level loading fallback | `src/App.tsx:71` | Spinner | `chakra-loading`, compact |
| Trips list loading | `src/pages/TripsList.tsx:279`, `:325` | Spinner | `chakra-loading` |
| Trips list failed | `src/pages/TripsList.tsx:329` | `error` vignette | `chakra-sad` |
| Trips list first trip | `src/pages/TripsList.tsx:338` | `first-trip` vignette | `chakra-pin` or `chakra-wave` |
| Trash empty | `src/pages/TripsList.tsx:286` | Trash icon | `chakra-sleep` (day palette head) |
| Explore failed | `src/pages/Explore.tsx:341` | `error` vignette | `chakra-sad` |
| Explore empty saved | `src/pages/Explore.tsx:388` | `no-saved` vignette | `chakra-love` |
| Explore no results | `src/pages/Explore.tsx:394` | `no-results` vignette | Curious head |
| Trip not found | `src/pages/TripWorkspace.tsx:712` | Text only | `chakra-lost` |
| Error boundary | `src/components/ErrorBoundary.tsx:70` | Text only | `chakra-sad` |
| Public itinerary loading | `src/pages/PublicItinerary.tsx:530`, `:547` | Spinner | `chakra-loading` |
| Notifications empty | `src/pages/Profile.tsx:526` | Text only | Sleepy head |
| No members on a trip | `src/pages/trip/ShareTab.tsx:585` | Text only | `chakra-wave` |

The existing raster vignettes (`StateVignette` in `src/components/RegionArt.tsx`) are approved art.
Decide per state whether Chakra replaces a vignette or sits beside it. Do not run both on one state.

### Phase 2: moments

| Surface | File | Chakra |
| --- | --- | --- |
| Trip created | `src/pages/TripCreated.tsx:542` | `chakra-celebrate` in the celebration column |
| Plan unlocked | `src/components/UnlockReveal.tsx` | `chakra-celebrate`, once, at the top of the sheet |
| Plan bench confetti | `src/components/PlanBench.tsx` | Proud head beside the existing confetti |
| AI drawer | `src/components/AiDrawer.tsx:35` | `chakra-thinking` while `thinking` is true |

### Phase 3: inline warnings

These use a small head (24 to 32 px) next to the existing text, not a full scene.

| Surface | File | Chakra |
| --- | --- | --- |
| Night halt chips | `src/pages/trip/timeline/TravelPanel.tsx` | Sleepy head on the night-halt line |
| Break warnings | Timeline warnings from `src/lib/engine.ts` (`meals`) | Kulhad head, via `warningHead()` |
| Budget over its cap | `src/pages/trip/BudgetTab.tsx` | Worried head on the over-target estimate |
| Offline banner | `src/components/OfflineBanner.tsx` | Lost head while offline |

### Phase 4: brand

1. **App icon and favicon: decided, no change.** The user keeps the Y logo as the app
   icon, the favicon and the brand mark. Chakra does not replace the Y logo anywhere. The
   mascot sits next to it, for example on the share image, but never in its place.
2. **Social share image: done.** `public/og-default.png` now shows `chakra-hero.svg` below
   the route, on the right of the card. The source is `scripts/og-default-card.html`. The
   hero is on the route plane. It is not next to the 25 px wordmark, because it would be too small there.
3. **README: done.** The hero sits at 96 px beside the Chakra highlight, not above the title, so it does not read as the logo. The expressions strip
   is not in the README: `chakra-expressions.svg` still holds live `<text>` for its labels.
   GitHub renders SVG through an `<img>`, so the labels would fall back to a system font.
   Convert them to paths (section 5, item 1), then add the strip.
4. **Store listing: nothing to change.** The repo holds no store listing metadata. `android/` is
   the Capacitor shell with launcher and splash art only.

## 5. Before the first placement

Done for phase 1: every placement file is free of live text (the sleep "z" is
now a path), `tests/mascot.test.ts` maps every pose to a file, and the light
and dark placements were checked on localhost at 390 px and 1280 px.

1. Convert SVG text to paths. The ₹ coin, the "z", the "?" and the expression labels use the Sora font. An `<img>` cannot load page fonts, so it falls back to a system font.
2. Add a small `Mascot` component with `pose`, `size` and `animated` props. It picks the night file in the dark theme.
3. Add a test that every pose name maps to a file in `public/brand/mascot/`.
4. Check each placement on localhost in light and dark themes, at 390 px and at 1280 px.
