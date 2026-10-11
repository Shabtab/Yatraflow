# My trips

My trips lists the trips a signed-in user owns or joined, at `/trips`. A signed-out visitor who opens `/trips` does not see a sign-in prompt. The app shows the landing page while the browser tab title still reads "Your trips".

## Sub-features

- `trips-signed-out` shows the signed-out result of opening `/trips`. It is verified.
- `trips-list` shows the signed-in trip list. It needs a test account and is not drivable yet.

## How to get to it (user POV)

- Choose "My trips" in the top bar, if the top bar shows it. Check the signed-in condition before you rely on it.
- Open `/trips` directly.

## Driving it with verify.mjs

Preconditions:

- `start` ran and `doctor` passes.
- Signed out for `trips-signed-out`.

- **Signed-out result.** Run `MSYS_NO_PATHCONV=1 node .agents/skills/verify-yatraflow/scripts/verify.mjs drive /trips my-trips-signed-out --expect "Built for Indian travellers"`. Exit code is `0`. `finalUrl` is `http://localhost:5178/trips`. The record's `title` is "Your trips · YatraFlow". The body is the landing page.
- **Signed-in list.** Not drivable. It needs a test account. Do not report it as verified.

## Gotchas

- A signed-out `/trips` looks like a broken or missing page. Check the record's `title` and the body text. Do not conclude from the landing alone.
- A signed-in run changes shared data. Use a disposable account and list the trips it reads in the evidence.
