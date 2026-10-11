# Start planning

Start planning is the signed-out path into trip creation. A visitor chooses a planning link, signs up on the auth page, and returns to the create-trip page at `/new`. The header "Start planning free" link works. The landing hero "Start a trip plan" link does not reach sign-up on web.

## Sub-features

- `start-header` opens sign-up from the header link, with the sign-up route as the target.
- `start-hero` opens sign-up from the landing hero link. It is broken on web; see Gotchas.
- `start-direct` renders the sign-up page from a direct URL with `next=/new`.
- `start-create` shows the create-trip page to a signed-in user. It is not drivable yet.

## How to get to it (user POV)

- Choose "Start planning free" in the top bar.
- Choose "Start a trip plan" in the landing hero. This path is broken on web.
- Open `/auth?mode=signup` directly.

## Driving it with verify.mjs

Preconditions:

- `start` ran and `doctor` passes.
- Signed out.

- **Header entry.** Run `MSYS_NO_PATHCONV=1 node .agents/skills/verify-yatraflow/scripts/verify.mjs drive / start-header --click "Start planning free" --expect "Create your account"`. Exit code is `0`. `finalUrl` is `http://localhost:5178/auth?mode=signup`.
- **Hero entry (defect).** Run `... drive / start-hero --click "Start a trip plan" --expect "Create your account"`. Expected exit `0`. Current exit is `1`: the page stays on the landing and the URL becomes `/#/auth?mode=signup&next=%2Fnew`.
- **Direct URL.** Run `... drive "/auth?mode=signup&next=%2Fnew" start-direct --expect "Create your account"`. Exit code is `0`. The body shows "Free to plan. No card needed."
- **Create page, signed in.** Not drivable. It needs a test account and the harness has no sign-in step yet. Do not report it as verified.

## Gotchas

- The hero link is a hash href (`src/pages/Landing.tsx`). The header link is a path (`src/App.tsx`). When you change the router, check both.
- Loading `/new` signed out shows the landing page, not an error. The document title still reads "New trip". Do not read the landing as a missing create page.
- The legacy hash form `/#/auth?mode=signup&next=%2Fnew` redirects correctly on a fresh load. The failure happens only on an in-page click.
