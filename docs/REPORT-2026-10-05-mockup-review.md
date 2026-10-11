# Mockup adoption review — 2026-10-05

## Verdict

The branch adds useful controls, but it does not yet reproduce the mockup's hierarchy.
The work is not ready to merge.
You must repair the list layout, save transition, and city markers before adding more surfaces.

- Branch: `feat/mockup-adoption`.
- Reviewed head: `8da6897`.
- Base: local `test`, `a53958f`.
- Diff: `git diff test...HEAD`.
- Scope: four commits, nineteen files.
- Reference: `C:\Users\hasna\yatraflow-mockup`.
- Contract: [ROADMAP MR track](../ROADMAP.md#mr--mockup-adoption-trip-list-and-trip-page-ideas-from-cusershasnayatraflow-mockup).
- Palette exception: [ADR 0002](adr/0002-mockup-palette-not-adopted.md).

I reviewed Standards and Spec directly.
No sub-agent tool was available.
I did not change product code, trip data, or branch history.

## Progress

The roadmap marks eight of twelve rows complete.
That count is not a measure of visual completion.
Several checked rows still have incomplete behavior.

| Row | Actual state | Acceptance gap |
| --- | --- | --- |
| MR1 | Partial | Each card has a label, but no featured trip or targeted action. |
| MR2 | Present, with narrow meaning | The count measures days containing a stop, not finished planning. |
| MR3 | Present | Counts and persistence exist; the filters differ from the mockup's lifecycle tabs. |
| MR4 | Broken on mobile | The footer overlaps content, and long labels escape the clipped card. |
| MR5 | Partial | The solo line exists; missing covers do not always get a prompt. |
| MR6 | Partial | The formatter works, but the page clock never advances while mounted. |
| MR7 | Partial and semantically wrong | Day titles become cities; short trips can hide the rail entirely. |
| MR8 | Partial | Normal save and reload work; repeated updater execution and unavailable storage break the transition. |
| MR9–MR12 | Untouched by these commits | The planned target pages and navigation contract need correction first. |

## Standards

### S1 — High: the save updater performs a non-idempotent write

Source: [TimelineTab:21–25](../src/pages/trip/TimelineTab.tsx#L21-L25), [uiPrefs:237–241](../src/lib/uiPrefs.ts#L237-L241).

The updater reads storage, flips membership, and writes storage during React's state calculation.
React can repeat that calculation.
The isolated browser fixture used the same hook body under the app's React Strict Mode.
The first click saved `day:0`.
The second click ran the updater twice and left `day:0` saved.
The call count advanced from one to three.

Unavailable storage causes a second defect.
Two toggles of `day:0` both returned `["day:0"]`.
The next save of `day:1` returned only `["day:1"]`.
The helper loses the current session state because each toggle reads empty storage.

**Better implementation:** derive the next set from the previous React state.
Persist that exact set with an idempotent write after the state change.
Keep the in-memory set authoritative when storage fails.
Test repeated calculation, two saves, removal, denied storage, and reload.

The normal app path passed save, removal, and reload checks.
That success does not make the repeated-calculation path safe.

### S2 — Medium: each heart change invalidates every day card

Source: [TimelineTab:695–696](../src/pages/trip/TimelineTab.tsx#L695-L696), [dayCards:199–207](../src/lib/dayCards.ts#L199-L207).
Rule: [CODING_STANDARDS §6s and §6u](../CODING_STANDARDS.md#L346-L409).

Every day receives the same saved-id array.
Each toggle creates a new array.
The exhaustive comparator rejects every day, including unrelated days.
This reverses the existing per-day memo boundary.

**Better implementation:** pass stable per-day saved data, or subscribe each day to its own saved slice.
Measure changed-day renders before and after the repair.
I did not measure a timing regression.

The comparator does compare the new props.
The suspected missing-prop bug is not present.
Trip switching also remounts Timeline through its existing trip-id key.

### S3 — Low: new motion rules use legacy duration tokens

Source: [styles:8243–8379](../src/styles.css#L8243-L8379).
Rule: [MOTION-TOKENS governance](MOTION-TOKENS.md#governance-agentsmd-rule-10).

The new rules use `--t-fast` and `--t-med` instead of the documented `--motion-*` durations.
For example, legacy `--t-fast` is 180ms; documented `--motion-fast` is 120ms.
Reduced-motion opt-outs exist.

**Better implementation:** use the documented durations and the existing toggle pattern.
Keep reduced-motion checks.

### S4 — Medium: completion records overstate the evidence

Sources: [ROADMAP:428–514](../ROADMAP.md#L428-L514), [CHANGELOG:27–91](../CHANGELOG.md#L27-L91).
Rules: [AGENTS §2.2 and §2.6](../AGENTS.md#L83-L137).

The roadmap says four workspace tabs; the app has eight.
MR5 calls a last-ranked next action an always-visible cover prompt.
MR7's screenshot note describes Trips-list repairs rather than saved Timeline evidence.
The changelog says all five filter counts add to the total.
In the browser, those counts were `7 + 0 + 7 + 0 + 0`.
Only the four exclusive buckets add to the total; All repeats that total.
The changelog also records debugging history instead of final product behavior.

**Better implementation:** separate implementation status from acceptance status.
Keep one final-state entry per behavior.
Attach evidence to the surface it actually proves.

### S5 — Low: the live probe is not a complete audit

Source: [next-step-probe:95–122](../scripts/next-step-probe.mjs#L95-L122).

The probe says every publication, but reads at most 500 without pagination.
It infers locked content from price instead of inspecting the returned shape.
Its machine output omits the lock flag.
Its error path calls `process.exit(2)` despite the documented Windows exit hazard.
The successful run checked six anonymous publication reads, not the signed-in My Trips collection.

**Better implementation:** paginate, bound network waits, and describe the exact collection being checked.
Report access state as data in both output formats.
Use orderly nonzero exit handling on failures.

## Spec

### P1 — High: list mode clips and overlaps real mobile content

Sources: [styles:8297–8303](../src/styles.css#L8297-L8303), [TripsList:383–440](../src/pages/TripsList.tsx#L383-L440).
Contract: MR4, both layouts.

At 1440px, list mode renders two 565px columns rather than a single scan order.
At 390px, the footer occupies the same horizontal space as the overflowing card body.
The screenshot shows the solo line and delete control over the progress text.
The Kerala card ends at x359, while its body ends near x460.
Its progress text ends near x419.
The page width still reads 373px because the card clips its children.
Zero page overflow did not prove correct layout.

**Better implementation:** use explicit thumbnail, content, and action columns.
Set `min-width: 0` on the content column.
Move the footer below the content at narrow widths.
Let metadata wrap and keep destructive controls outside the content's hit area.
Use one list column, or explicitly approve a tiled-list variant.

### P2 — High: the next action names a task but does not open it

Source: [TripsList:383 and 423–425](../src/pages/TripsList.tsx#L383-L425).
Contract: MR1, the most useful pending action on the featured trip.

The code derives `dayIndex` and `stopId`, then ignores both when building the link.
I clicked the Goa card offering confirmation of Anjuna Flea Market.
The app opened Overview, not that stop on Day 2.
The featured trip is also absent.
Every card keeps the same visual rank.

**Better implementation:** retain a general card link and add a separate task link.
Dates and covers must open Settings.
Day and stop actions must open Timeline with the correct focus request.
Do not place a second link inside the existing card link.
Add the featured trip as a separate, data-driven component.

### P3 — High: city markers compare activity descriptions

Source: [dayStrip:39–55](../src/lib/dayStrip.ts#L39-L55).
Contract: MR7, a marker where the city changes.

The helper treats `day.title` as a place.
Two Jaipur days titled Arrival and Fort visit produce a city-change marker.
The real Goa trip shows two markers between three different activity titles.
The fallback reads the first stored stop, without sorting or excluding rejected stops.
These are not reliable city identities.

The rail also disappears for a three-day trip in One day mode.
The new cards omit the mockup's separate date, city, description, and save entry point.
They are richer jump buttons, not equivalent itinerary cards.

**Better implementation:** keep the day title separate from location data.
Use a documented route/base identity for city changes.
When no reliable identity exists, omit the transit claim.
Do not add provider requests only to decorate the rail.
Show the rail for short trips if MR7 applies to every trip.

### P4 — Medium: the larger sticky rail breaks orientation

Sources: [TimelineTab:388–428](../src/pages/trip/TimelineTab.tsx#L388-L428), [styles:8314–8324](../src/styles.css#L8314-L8324).
Contract: MR7, reuse day navigation without losing its behavior.

The existing jump offset assumed a compact chip rail.
The new rail measures about 96px tall on mobile.
After a day jump, the day card starts near y90 while the rail covers through y181.
The rail hides the day header.
The warning rule also overrides the current-day rule because it appears later with equal specificity.
Every day in the Goa sample has a warning.
The selected day keeps the same warning skin as its neighbors.

**Better implementation:** measure the full sticky stack and use its height for jump offsets and scroll tracking.
Give the current day a border, shape, or marker that warning styling cannot replace.

### P5 — Medium: the missing-cover prompt is conditional on unrelated tasks

Source: [tripNextStep:89–129](../src/lib/tripNextStep.ts#L89-L129).
Contract: MR5, show Add a cover photo when a trip has none.

A coverless trip with an empty day gets only Plan day 1.
Tasks for bookings and confirmations also suppress the cover prompt.
An explicitly selected compass emoji still counts as no chosen cover.
Runtime cover photos can further differ from the stored cover state.

**Better implementation:** display an independent, secondary cover prompt.
Keep the main next action focused on planning.
Define whether the prompt means no saved photo or no chosen cover.
Do not infer user choice from one emoji value.

### P6 — Medium: progress can claim readiness from automatic anchors alone

Source: [tripNextStep:89–129 and 204–209](../src/lib/tripNextStep.ts#L89-L129).
Contract: MR1–MR2, useful next action and planned-day progress.

The store creates confirmed automatic route anchors on new trips.
The progress helper counts those anchors as planned stops.
A one-day fixture with only an automatic anchor and a chosen emoji returns 100% and Ready to travel.
It has no actual activity plan.
The mockup instead separates dates, accommodation, transport, activities, and budget progress.

**Better implementation:** define what planned means before choosing the percentage.
Exclude automatic anchors from activity progress, or label the measure Days with route points.
Do not use this narrow measure as a full readiness claim.
Reuse existing planning checks where their meaning matches.

### P7 — Medium: the countdown clock stays on its mount date

Source: [TripsList:125](../src/pages/TripsList.tsx#L125).
Contract: MR6, derive the countdown from the current date.

The page memoizes one Date for its entire mount.
A page left open overnight still reports yesterday's countdown.
Filter changes do not refresh that Date.
The same value now feeds the existing date filter.

**Better implementation:** keep one shared calendar-day clock that refreshes at midnight and on focus.
Test the boundary with an injected clock.
I confirmed the frozen source path; I did not wait for a live midnight boundary.

### P8 — Medium: future rows target the wrong surfaces

Sources: [ROADMAP:428–434 and 515–523](../ROADMAP.md#L428-L523).
Contract: MR9–MR11 and the separate-page mockups.

MR9 assumes scroll sections while D1 preserves routed tabs.
The actual workspace has eight tabs, not four.
MR10 assigns public discovery to the private creator dashboard.
MR11 assigns My publications management to the public creator profile.
The mockup's creator-hub board shows Overview and Earnings in the owner dashboard.
The current owner dashboard already implements much of that design.

**Better implementation:** map each mockup surface to the real user role and route before building.
Put discovery in Explore or a separate public route.
Keep publication management and earnings in the owner dashboard.
Keep the public creator profile visitor-facing.
Resolve MR9 against the retained tab model rather than adding a second navigation system.

## Visual assessment

The Trips grid remains coherent with the shipped design tokens.
The current palette is an approved choice, not a defect.
The missing hero banner is also a recorded deferral.

But the mockup's hierarchy depends on one prominent upcoming trip and a strong primary action.
The branch mainly adds small metadata to equal-sized cards.
On mobile, actions and two wrapped filter rows consume most of the first screen.
The first card starts near y670 before browser-panel scaling.
The reference phone instead leads quickly with trips and a short filter row.

The Timeline remains a dense editor with a text-only strip.
The reference uses distinct city, date, and description fields with quieter card hierarchy.
You can adopt that hierarchy without copying its palette or generated images.

The mockup is not correct in every detail.
Its day data repeats Day 4 and omits Day 6.
Its featured progress says 80%, while six of seven days is about 86%.
Its public hub also uses invented large audience counts and unsupported booking claims.
You must derive real counts and exclude unsupported promises.

A saved-items filter or shelf would make the new hearts useful beyond decoration.
That is a product proposal, not a missing requirement in MR8.

## Verification and limits

- `npm run verify`: exit 0.
- Full suite: 258 files passed; one file skipped.
- Tests: 3,650 passed; one skipped.
- Fresh typecheck and production build passed.
- Lint ratchet matched 142 existing errors and 29 warnings.
- Five focused suites: 84 tests passed.
- `npm run check:ui`: zero findings.
- Live read-only probe: six publications; declared invariants passed.
- Branch prose check: one STE error at [ADR 0002:27](adr/0002-mockup-palette-not-adopted.md#L27).

The normal STE gate checked zero lines because the tree was clean and the changes were committed.
I checked added branch prose separately through the linter's stdin interface.

I compared desktop and mobile Trips layouts and exercised the real Timeline in both themes.
Browser screenshots appear in this thread.
Some captures returned stale frames or changed the effective viewport width.
I used fresh page state and measured DOM boxes for the confirmed layout findings.
This was not a complete visual regression matrix.
Coarse-pointer hit expansion exists globally, so 28px chip visuals alone are not a confirmed touch-target defect.

The browser logged Google Routes CORS failures.
These files were not changed by the redesign commits.
I did not attribute those failures to this branch.

Normal day and stop saves persisted through reload.
I restored the temporary saves and the original light theme after testing.
No backend writes, commits, pushes, or pull requests were made.

## Recommended order

1. Repair mobile list columns and clipping.
2. Repair the save transition and unavailable-storage behavior.
3. Remove false city claims and repair sticky offsets.
4. Connect next actions to their actual tasks.
5. Define honest progress and cover-prompt semantics.
6. Correct the future-row route map and completion records.
7. Review a featured-card prototype before continuing MR9–MR12.

Summary: five Standards findings; the worst is the unsafe save updater.
Summary: eight Spec findings; the worst is the broken mobile list layout.
