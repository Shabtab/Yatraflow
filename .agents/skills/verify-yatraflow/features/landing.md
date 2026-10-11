# Landing page

The signed-out home page at `/` introduces YatraFlow. It shows a hero with a sample trip, a join-by-code field, and links to start a plan or to explore itineraries. A visitor leaves the page through sign-up or Explore.

## Sub-features

- `landing-hero` shows the headline and the sample trip card.
- `landing-join` shows the trip code field and its Join button.
- `landing-start` shows the hero "Start a trip plan" link. It is broken on web; see Gotchas.
- `landing-explore` shows the hero "Explore itineraries" link. It is broken on web; see Gotchas.

## How to get to it (user POV)

- Open the site root in a browser.
- Choose the YatraFlow logo or the home route from any page that has a header.

## Driving it with verify.mjs

Preconditions:

- `start` ran and `doctor` passes.
- Signed out. No session is needed.

- **Render.** Run `MSYS_NO_PATHCONV=1 node .agents/skills/verify-yatraflow/scripts/verify.mjs drive / landing --expect "Built for Indian travellers"`. Exit code is `0`. `finalUrl` is `http://localhost:5178/`. The screenshot shows "Plan trips that actually flow together".
- **Start link (defect).** Run `... drive / landing-start --click "Start a trip plan" --expect "Create your account"`. Expected exit `0`. Current exit is `1`: the page stays on the landing and the URL becomes `/#/auth?mode=signup&next=%2Fnew`. See [start-planning.md](start-planning.md).
- **Explore link (defect).** Run `... drive / landing-explore --click "Explore itineraries" --expect "DISCOVER · TRUST · FORK"`. Expected exit `0`. Current exit is `1`: the page stays on the landing and the URL becomes `/#/explore`. Use this marker, not "Explore itineraries", because the landing also shows that label.

## Gotchas

- The hero links use hash hrefs (`src/pages/Landing.tsx`). The web router reads the pathname and ignores hash-only changes. A failing run here is a product defect, not a harness fault. Do not weaken the `--expect` to make it pass.
- The landing also has two hash links that this map does not drive yet: the footer DMCA link and the bench sign-up button.
- Every landing load logs React duplicate-key warnings. The stack trace points at `PlanBench`. Record them in the evidence. Do not fail a run on them.
- Use "Built for Indian travellers" to confirm the landing. It is a stable marker.
