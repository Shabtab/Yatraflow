# Motion Tokens

The app's motion system — the companion to the colour/radius tokens in
`src/styles.css`. **Every interactive surface ships motion from these tokens;
no ad-hoc durations.** This is the rule that keeps the refined surfaces
(Timeline, Board) and newly added ones at the same level of smoothness: when
something changes or gets added, it picks a pattern from here rather than
inventing a feel.

## Duration steps

| Token | Value | Use it for |
| --- | --- | --- |
| `--motion-fast` | `120ms` | hovers, chip/press feedback, colour-only transitions |
| `--motion-med` | `180ms` | dropdowns & popovers, toggle gliders, drag sibling glide, small position changes |
| `--motion-slow` | `240ms` | large surfaces: FLIP settle, drawers, panels |
| `--motion-slower` | `560ms` | very large travel — hundreds of px that relayout the page (a day body is ~950px) |

The first three land under ~250ms — the app's motion is "quick and settled",
never showy. The fourth exists because peak frame speed is **distance ÷
duration**: the day collapse at `--motion-slow` moved the rows below it 115px
inside a single 60Hz frame (measured, 942px of travel), which is what "the
cards collide" looks like; at 560ms it is ~47px. This step is deliberately above
Material's guidance for a large expansion (375–500ms), which is only defensible
because the thing moving is ~950px rather than a panel — reach for it when the
distance is measured in hundreds of px, not when a surface merely feels large.
Anything that must not animate at all (scaffolding, measurement passes) uses no
transition.

## Easing

| Token | Value | Use |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(.22, .61, .36, 1)` | the default for everything entering, exiting or settling |
| `--ease-glide` | `cubic-bezier(.3, .86, .48, 1)` | continuous follow while a drag is live (targets the cursor, no lag bounce) |
| `--ease-resize` | `cubic-bezier(.42, 0, .58, 1)` | a surface that resizes **in place** and moves a long way (day collapse): starts and ends at rest, symmetric |

`--ease-out` and `--ease-glide` are one shape to the eye: they agree within
`.015` at every sampled point, and both put 86% of a surface's distance
inside the first 44% of the time. That is exactly right for a 60px dropdown — and
it is a pop on a 1000px one. Measured on the Timeline's day collapse (a 967px
body): the decelerate curve spent 24% of the whole height in the first 6ms and
then dribbled for 150ms, which is what "the collapse is not smooth" looks like.
Resizes at that scale take `--ease-resize`, whose gentle start leaves ~3px of
movement in the first 60Hz frame and settles its own tail. It is **symmetric**
(`.42,0,.58,1`) rather than Material's asymmetric standard curve: peak slope is
what a long move is felt through, and on the day collapse's ~920px of travel the
asymmetric curve peaks at 2.73× its average (96px inside a 60Hz frame) against
1.72× (60px) for the symmetric one, for the same total time and the same first
frame. Take the asymmetric curve only for a short move, where the peak is
reached before the eye has caught up.

Springs/bounce are not in the system. No scale or border-radius morphing on
drag; movement is translation only (compositor-only).

## Pattern catalog

| Pattern | Recipe | Where it lives |
| --- | --- | --- |
| Dropdown / popover entrance | fade 0→1 + rise 4px, `--motion-med`, `--ease-out` | `.popover` (location list, calendar, menus), `.map-legend-body` (the map key card), `.map-filters-pop` (the toolbar's idea filters) |
| Page / section entrance | fade 0→1 + rise 8px, `--motion-slow`, `--ease-out`, `backwards`, staggered per direct child with `animation-delay: calc(var(--stagger-step) * N)`. The **container owns it** — children never opt in, so a block added to the page later cannot miss one. That is the whole point: My Trips had a cascade on its cards and none on its hero, the page head, the toolbar, the viewbar or the saved shelf, and a still hero above moving cards reads as broken rather than calm. Write the rule at the TOP level, not inside `prefers-reduced-motion: no-preference`: the design-system gates read top-level rules only, so a rule inside `@media` is invisible to all of them — the opt-out is instead asserted against the raw file | `.page-enter > *` (every routed page root — the set is discovered from `src/App.tsx`), `.empty-state > *` |
| Toggle glider | thumb slide on the glider's own **box** — `left`/`top`/`width`/`height` transition together, `--motion-med`, `--ease-glide`. This row previously read "thumb `transform` slide", which was simply wrong about the implementation; a `scaleX` transform version was tried and **rejected**: resizing a rounded pill by scaling stretches its ends into ellipses (scaleX 1.93 on a 76px -> 146px tab change), which reads as the animation breaking rather than the pill gliding. The box is affordable because the glider is absolutely positioned, so its own box cannot reflow its siblings | `.pill-glider` (workspace tabs, Plan/Inspect, filters, composer mode) |
| Day collapse | grid-rows `0fr↔1fr`, `--motion-slower`, `--ease-resize` (both ends at rest, symmetric — the body can be 1000px, and the peak lands mid-animation), unmount after that token's duration (and a clip that unmounts the focused element hands focus to the day's collapse control as the close begins — a hidden element is blurred on the spot, so waiting for the unmount is too late). Anything that changes the header's height rides the same collapse in reverse (the route chain), and the state-only extras take the entrance pattern below | `.day-body-clip` (SmoothCollapse) |
| Drag carry | pointer-pinned `translate3d(var(--carry-x/-y))` on the row, **no transition** — position never eases | `.is-carried` (Timeline `.tl-row`, Board `.board-row`) |
| Drag warp | skin `rotate(tilt) scale(1+x−y·.55, 1+y−x·.55)` from pointer velocity, `--motion-fast`, `--ease-out`; JS calm timer (`WARP_CALM_MS` 90ms) flattens the vars when the finger stops | `.is-carried .stop-card / .travel-endpoint` |
| Drag sibling glide | rows between slot and target translate by the carried row's height, `--motion-fast`, `--ease-glide` | Timeline `.tl`, Board `.board-row` |
| Drag settle | FLIP translate→none, `--motion-slow`, `--ease-out`; the carried row springs from its release point (engine `consumeCarryRect`) | same surfaces, on commit |
| Map shell expand / collapse | `scale(.94↔1)` + fade, `--motion-slow`, `--ease-out`; TripMap's unmount timer reads `motionTiming('--motion-slow')` so CSS and JS can't drift (0 under reduced motion — the glide is skipped entirely) | `.map-shell--expanded` / `.map-shell--closing` |
| Rail fold | `grid-template-columns` glide, `--motion-slow`, `--ease-resize` — an in-place resize of both rails with the map re-fitting beside them (a day-collapse in miniature, so the symmetric curve; the fold icon rides the same clock so one click reads as one movement) | `.map-ideas-grid` folded states |

**Ambient loops are the cadence's own exception.** An `infinite` keyframe — the map
skeleton's breathe, the live dot's ping — is exempt from the raw-duration ratchet
because its cadence belongs to the effect, not to a UI transition; its easing still
rides a token (`--ease-resize` / `--ease-out`), and it still stops under
`prefers-reduced-motion`.

The drag is pointer-events–driven (lib/touchDnd.ts): mouse starts on an 8px
move, touch keeps the long-press gate. The warp is a skin-only deformation
(the row's inner card), never the position layer, and is skipped entirely
under reduced motion. No goo/metaball morphing — explicitly excluded.

## Governance (AGENTS.md rule 10)

Any PR that adds or changes an interactive surface must:

1. pick durations/easings from the tokens above — a raw `ms` value in a new
   rule is a review flag;
2. pick the motion pattern from the catalog (or extend the catalog in this
   file in the same PR);
3. respect `prefers-reduced-motion: reduce` (transitions off; state changes
   become instant) — every animated rule carries the media-query opt-out.

## Verification

`grep -n "ms" src/styles.css` should show new durations as `var(--motion-*)`;
legacy literals are grandfathered on already-refined surfaces and migrate when
those surfaces are next touched.

A timing change is proved by sampling, not by feel: record each item's rect
every animation frame across a toggle, then read three numbers per item —
first-frame delta (a non-zero value means the move starts with a snap, which no
duration can smooth), peak per-frame delta (how hard one frame hits), and
whether the peak sits mid-animation rather than on frame one. Peak per-frame
speed ≈ `distance × curve peak slope ÷ duration`, so when a move reads as a
collision, check the distance first: if the element travels hundreds of px,
duration is the only honest lever. Quote it as **px/ms**, not px per frame — a
145fps renderer hands you 7ms frames and makes the same motion look half as
fast as it will on a 60Hz screen. Two more noise traps: a single long frame
inflates one delta (read the p90 as well as the max, and report the frame
intervals beside them), and an element that unmounts mid-sample reports a
zero-rect, which reads as a jump to the top of the page — skip anything that is
no longer connected.
