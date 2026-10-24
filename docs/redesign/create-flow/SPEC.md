# Create trip, guided flow (P11)

Specification for the guided Create trip flow. It replaces the long single-page form with one question per screen, at every screen size.

Status: the guided build is local and under verification. The feature flag remains in place. Every figure in the images is sample data, not a measured route.

| | |
| --- | --- |
| Page | P11, Create trip |
| Mockup set | 53 images, 23 Oct 2026 |
| Mockups and build kit | `C:\Users\hasna\yatraflow-saved\2026-10-23\create-flow-mockups\` |
| Build branch | cut from `origin/test`, not `main` |
| Feature flag | `createFunnelOn('guided')` in `src/lib/featureFlags` |

## 1. Why

The current page is one long form. It asks every question at once, it shows no progress, and controls appear and disappear as the mode changes. A traveller cannot tell how much is left or why a control appeared.

The guided flow asks one question per screen. It shows progress, it keeps a live ticket beside the question, and it uses one flow at every size.

## 2. The six steps

The order is fixed. It was chosen so that each answer removes a question that would otherwise be asked and then withdrawn.

| # | Step | Question | Notes |
| --- | --- | --- | --- |
| 1 | Where | Where are you going? | Starting location first, then each stop in order. |
| 2 | How | How are you travelling? | Nine modes. The driving question appears only for modes that drive. Return route lives here, not on Where. |
| 3 | When | When do you leave? | Dates, then departure time. |
| 4 | Who | Who's coming? | Party size, crew, drivers. Drivers and the vulnerable-traveller switch appear only on driving trips. |
| 5 | Budget | What is your budget? | Per-person figure with the total beside it. |
| 6 | Review | Check and create | Change links in return mode. |

Add details is an optional step that hangs off Review. It is not one of the six and never blocks Create. It holds the side trip and free notes.

### Why this order

- **Where before How.** The route length decides which modes are sensible. The distance line on Where is the first proof that the app understood the input.
- **How before When.** The mode decides whether a departure time matters and whether a return route is needed.
- **When before Who.** Dates fix the number of days, and the day count is what the budget is spent across.
- **Who before Budget.** The budget is per person, so the party size must be known first.
- **Budget before Review.** Review shows a bill. A bill with no budget cannot be checked.

## 3. Screen sizes

| Range | Name | Layout |
| --- | --- | --- |
| under 700px | Phone | One column. Sticky bottom bar. The ticket opens as a sheet from the peek line. |
| height under 500px, any width | Landscape phone | One column. A compact header. The bar is not sticky. |
| 700–1023px | Tablet | Two columns: question `1fr`, live ticket 280px. |
| 1024–1439px | Laptop | Three zones: step list 200px, question max 560px, ticket rail 320px. |
| 1440px and up | Wide | The same three zones. The content is capped at 1200px and centred. |

560px is a column width, not a breakpoint. The landscape rule is height-only. A phone held sideways can be 740px or wider, and 740 × 360 is the reference frame. The old spec capped the flow at 900px; that cap is dropped.

Tablet and wide screens leave empty space at the bottom by design. The images show the device viewport in full, so the space is real and not a crop. Do not stretch content to fill it.

## 4. Rules the flow must keep

1. **Next is never disabled.** A press with an incomplete answer moves focus to the first field that needs one. A disabled button tells the traveller nothing.
2. **Every error is linked to its control** with `aria-describedby`. The error text names the fix, not the fault.
3. **Progress tells the truth.** Phone shows "Step 3 of 6" and six segments. Tablet and larger show a labelled step list where completed steps are links.
4. **Numbers never disagree.** The stop count, the distance line, the day count and the bill derive from one source. If the list shows one stop, every figure shows one stop.
5. **A failed save is not an empty state.** The answers stay on screen, the ticket says the trip is not created yet, and the action reads "Try again".
6. **The primary action is never disabled on Review.** A press with a missing answer moves focus to the first blocking row.
7. **Motion uses tokens only**, with a `prefers-reduced-motion` opt-out on every rule. A raw `ms` value is a review flag.

## 5. The images

All 53 images are static HTML rendered at device scale 2 from one kit. They are in `images/`.

The contact sheets are **not** in this folder: at 14 MB they would double the repository's `docs/` size. They stay with the kit, at `C:\Users\hasna\yatraflow-saved\2026-10-23\create-flow-mockups\png\_overview-*.png`, and `_overview-5-phase-a2.png` covers the last 19 images.

| Images | What they show |
| --- | --- |
| 01–06 | Where, When and Review on a laptop, light and dark |
| 10–17 | Phone: How, When, dark Where/Budget/Review, failed save, distance lookup failed, offline |
| 20–25 | Wide Review, tablet How and When, landscape How |
| 30–32 | Motion storyboards: step forward, ticket print, create handoff |
| 40–43 | Start screen: nothing chosen, draft banner, one card tapped, blank |
| 44–46 | Who on phone and laptop |
| 47–50 | Validation: invalid Where, unanswered Mixed, bad departure time, unpicked stop |
| 51–53 | Add details on phone and laptop, then Review on return |
| 54–57 | Review variants: blocking rows, failed save on laptop and tablet, Creating |
| 58–59 | Where: keyboard-driven suggestions, a stop removed |
| 60–69 | Size matrix: laptop How and Budget, four tablet screens, wide dark, landscape dark, the shortcut on When and Who |

## 6. Copy changes this flow makes

Each one is a deliberate change from the live page, not a drift.

| Where | From | To |
| --- | --- | --- |
| Where lede | "Start typing - places geocode and order themselves along the road." | "Start from where you leave, then add each stop in order." |
| Start lede | "Five short questions" (already wrong) | "Six short steps. Most take one tap." |
| Who heading | — | "Who's coming?" |
| Crew chips | Full phone number | Masked to the last three digits, for example "Ammu · ••• 234" |
| Review, phone | — | "Check and create" |
| Review, laptop and wide | "Start planning" | Pick one wording before the build. Both strings exist in the live page today. |

The template names in the images are invented: Kerala Backwaters, Himachal loop, Rajasthan forts, Goa slow coast.

## 7. Build order

One commit per step. `npm run verify` before every commit. A CHANGELOG line with every user-visible commit.

| Step | Commit | Done when |
| --- | --- | --- |
| 1 | Extract the rules into `src/lib/createSteps.ts` (`validateCreate`, `stepOfError`) with node-env tests | Every existing message maps to one step. Submit uses the same function. |
| 2 | Add `step` to the draft | An old draft still loads. A new draft resumes at its step. Phone numbers are masked. |
| 3 | Step state in the URL (`?step=`) | Browser Back moves one step. A reload keeps the step. |
| 4 | Step shell behind `createFunnelOn('guided')` | Progress, Back, Next and focus on the step h2 work. The old form is unchanged with the flag off. |
| 5 | Where and How | Return route lives on How. The Mixed question blocks Next. Where lede per §6. |
| 6 | When, Who, Budget | Departure time on When. Drivers on Who for driving modes only. Budget copy fixed. |
| 7 | Review | Change buttons in return mode. Failed save StateBlock. Offline state. Suggested name. |
| 8 | Responsive layout, appended to `src/styles.css` | Screenshots at 360, 740 × 360, 820, 1280, 1920, light and dark, match the approved images. |
| 9 | Motion, appended to `src/styles.css` | Tokens only. Reduced-motion opt-out on every rule. `check:motion` and the motion tests pass. |
| 10 | Copy and accessibility | `npm run lint:ste` passes. A keyboard-only run completes the flow. Screen reader h1 on phone. |
| 11 | Remove the old long form | One release after the flag is on by default. Own commit. |

## 8. What the build will break, and how to fix it

- **The When step label changes.** Search `tests/` for "When?" and update the pins in the same commit as the copy.
- **Pages must keep `page-enter`.** The design-system test pins it.
- **New CSS goes at the end of `src/styles.css`.** The design-system baseline is keyed by line number. If you must insert mid-file, re-baseline deliberately and prove the diff is line numbers only.
- **A `step_completed` funnel event carries the step name only**, no values. Pass `userId` as the other events do.
- **The build depends on code that is on `origin/test` and not on `main`.** That code is the Departure time field (#827, `dayStartTime`), its hint, the `drivesPart` segmented control and the transport policy.

## 9. Proof required for every UI step

- `npm run verify`
- `npm run check:ui`
- `npm run lint:ratchet`
- `npm run lint:ste`

Browser proof uses a local mock backend, never the live database. A signed-in browser is bound to its origin, so sign in on the port that serves the tree under test. Prove the backend is compiled in before handing over a URL.

## 10. Open items

| # | Item | State |
| --- | --- | --- |
| 1 | Primary button wording on laptop and wide Review | "Check and create" at every size. A failed save uses "Try again". |
| 2 | Odometer overshoot on the bill | Kept as drawn for the mockups. Decide at build step 9 whether to move the curve to `--ease-out`. |
| 3 | Hover and focus frames for tiles and completed step links | Not drawn. The mockup set has no images for them. |
| 4 | Issue #822, a failed first save leaves a local trip | Check its state before build step 7. |
| 5 | Tracker issue and ROADMAP row for the build | Approved, not yet opened. |

## 11. Non-goals

- No MapLibre map on the create page. It is a lazy chunk, and it would add its own loading and failed states for little gain.
- No booking. The flow plans a trip and unlocks an itinerary; it never reserves anything.
- No change to the step title size. It stays 18px on desktop.
