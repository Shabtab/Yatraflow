# Featured-trip hierarchy prototype

## Question

Which hierarchy makes the next trip and its next action clear without hiding the other trips?

This is a layout study, not production code.
You can compare three variants with the same sample trips and existing YatraFlow palette.

## Open the prototype

Open [the standalone HTML](FEATURED-TRIP-PROTOTYPE.html).
You can double-click the file without a dev server.
The embedded photo works offline.
The fonts use the app's existing Google Fonts link and fall back to system fonts offline.

The running preview is:

- [A — Featured journey](http://localhost:5173/docs/FEATURED-TRIP-PROTOTYPE.html?variant=A).
- [B — Planning brief](http://localhost:5173/docs/FEATURED-TRIP-PROTOTYPE.html?variant=B).
- [C — Compact list](http://localhost:5173/docs/FEATURED-TRIP-PROTOTYPE.html?variant=C).

Use the bottom arrows to switch variants.
You can also press the left and right arrow keys outside text inputs.
The URL keeps the chosen variant through reload.
All simulated trip changes reset on reload.

## Variants

| Variant | Hierarchy | Trade-off |
| --- | --- | --- |
| A — Featured journey | A large trip image leads into the next task and its button. | Closest to the mockup; the feature takes more mobile space. |
| B — Planning brief | The pending decision leads; trip context sits beside it. | Strong task focus; the journey feels less prominent. |
| C — Compact list | One compact featured row leads into a full-width trip list. | Best scan density; less travel atmosphere. |

**Start with A for the mockup direction.**
You can borrow C's compact mobile treatment if A takes too much space.
No variant is approved for production yet.

## What you can try

1. Switch between all three variants.
2. Switch between light and dark themes.
3. Search the supporting trips.
4. Select a trip-stage filter.
5. Switch supporting trips between grid and list.
6. Open the featured review action.
7. Keep the sample stop to reveal the next pending task.
8. Open Overview to compare general navigation with targeted navigation.
9. Expand the state panel to inspect the current sample state.

The featured trip stays outside the supporting-trip filters.
The label says Search your other trips to make that scope explicit.

## Boundaries

- Palette values come from [the current styles](../src/styles.css).
- Motion uses the documented duration and easing tokens.
- Progress means days with activities, not readiness to travel.
- The sample clock is fixed at 2026-10-05.
- The featured sample is the closest upcoming departure.
- The photo comes from the app's existing landing asset.
- The photo is a layout placeholder, not a Goa destination photo.
- Supporting cards use inline illustrations rather than mockup assets.
- No Supabase client, app store, product routes, or write APIs are imported.
- State remains in memory.
- No product code, package scripts, commits, or remote branches changed.

## Evidence

The browser checks covered three variants, two themes, and two widths: 1440px and 390px.
All twelve views had zero page overflow and zero card overflow.
Visible buttons met the 40px height floor.
Search, stage filters, empty results, layout controls, keyboard switching, and dialog actions worked.
The simulated confirmation updated the next task and reduced open decisions from two to one.
Escape closed the dialog and restored its opener's focus.
Arrow keys did not switch variants while the search field held focus.
Reduced-motion mode removed transitions.
The standalone file loaded through a local file URL.
The browser made no backend requests.

The clean typecheck passed.
The prototype script passed a syntax check.
Documentation checks and STE lint passed.

Screenshots:

| Variant | Light desktop | Light mobile | Dark desktop | Dark mobile |
| --- | --- | --- | --- | --- |
| A | [1440px](screenshots/featured-trip-prototype/A-light-1440.jpg) | [390px](screenshots/featured-trip-prototype/A-light-390.jpg) | [1440px](screenshots/featured-trip-prototype/A-dark-1440.jpg) | [390px](screenshots/featured-trip-prototype/A-dark-390.jpg) |
| B | [1440px](screenshots/featured-trip-prototype/B-light-1440.jpg) | [390px](screenshots/featured-trip-prototype/B-light-390.jpg) | [1440px](screenshots/featured-trip-prototype/B-dark-1440.jpg) | [390px](screenshots/featured-trip-prototype/B-dark-390.jpg) |
| C | [1440px](screenshots/featured-trip-prototype/C-light-1440.jpg) | [390px](screenshots/featured-trip-prototype/C-light-390.jpg) | [1440px](screenshots/featured-trip-prototype/C-dark-1440.jpg) | [390px](screenshots/featured-trip-prototype/C-dark-390.jpg) |

## Remaining decisions

You must choose the hierarchy before implementation.
The production feature also needs empty, undated, in-progress, and completed-trip selection rules.
Those rules are not settled by this visual prototype.
Any implementation must preserve the app's existing access and navigation checks.
