# Explore itineraries

Explore is the public list of shared multi-day itineraries at `/explore`. Anyone can browse the plans. A signed-in user can fork one to make a private copy. Browsing works signed out.

## Sub-features

- `explore-list` renders the itinerary page with its heading and copy.
- `explore-nav` opens Explore from the top bar.
- `explore-hero` opens Explore from the landing hero. It is broken on web; see Gotchas.
- `explore-fork` copies an itinerary into the user's trips. It needs sign-in and is not drivable yet.

## How to get to it (user POV)

- Choose "Explore" in the top bar.
- Choose "Explore itineraries" in the landing hero. This path is broken on web.
- Open `/explore` directly.

## Driving it with verify.mjs

Preconditions:

- `start` ran and `doctor` passes.
- Signed out.

- **Direct render.** Run `MSYS_NO_PATHCONV=1 node .agents/skills/verify-yatraflow/scripts/verify.mjs drive /explore explore --expect "DISCOVER · TRUST · FORK"`. Exit code is `0`. `finalUrl` is `http://localhost:5178/explore`. The body shows "Explore itineraries" as the heading.
- **Top bar.** Run `... drive / explore-nav --click "Explore" --expect "DISCOVER · TRUST · FORK"`. Exit code is `0`. `finalUrl` is `http://localhost:5178/explore`.
- **Landing hero (defect).** Run `... drive / explore-hero --click "Explore itineraries" --expect "DISCOVER · TRUST · FORK"`. Expected exit `0`. Current exit is `1`: the page stays on the landing and the URL becomes `/#/explore`.
- **Fork.** Not drivable. It needs a signed-in test account.

## Gotchas

- "Explore itineraries" is both a landing button and the Explore page heading. Use "DISCOVER · TRUST · FORK" as the `--expect` marker. A loose label passes on the wrong page.
- The hero link is a hash href (`src/pages/Landing.tsx`). The bench link on the planning page is also a hash href (`src/components/PlanBench.tsx`). Neither is driven yet.
- The first drive to a route can time out while Vite compiles that route. The timeout error names the route. Run the same command again. A second run after a warm compile passes. Report both attempts.
- Explore's own "Sign up free" button (`src/pages/Explore.tsx`) appears only in some states. Do not assume it is present.
