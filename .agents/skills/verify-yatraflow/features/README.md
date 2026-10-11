# YatraFlow verification map

This directory is the maintained source for verifying the user-visible behavior of YatraFlow in the browser. Read this index first. Then open the matching feature file and follow its Driving section.

## Baseline preconditions

- Run `verify.mjs start` and require `verify.mjs doctor` to pass.
- Start signed out unless a feature file says otherwise.
- Never drive a server the harness did not start.

## Features

| File | Covers | Signed in? | Status |
| --- | --- | --- | --- |
| [landing.md](landing.md) | Home page at `/` | No | Verified; hero links broken |
| [start-planning.md](start-planning.md) | Entry to trip planning and sign-up | No (create page: yes) | Header verified; hero broken |
| [explore.md](explore.md) | Public itinerary list at `/explore` | No (fork: yes) | Verified; hero link broken |
| [sign-in.md](sign-in.md) | Log in and create account at `/auth` | No (real sign-in: test account) | Verified (forms render) |
| [my-trips.md](my-trips.md) | `/trips` list | Yes | Signed-out gate verified; list not drivable |

## Driving conventions

- Use the exact visible text from the feature file in `--click`. Text match is exact first, then substring.
- Use an `--expect` string that appears only on the destination page. Some labels also appear on the page you came from.
- Git Bash: prefix each command with `MSYS_NO_PATHCONV=1`. Otherwise `/` becomes a Windows path and the harness refuses it.
- Give each run a unique `<name>`. The name sets the evidence file names.

## Proof and skip reporting

- Capture the action and the resulting state. Check `finalUrl`, the expected text, and console errors.
- A screenshot alone is not proof. Read the `expectation` field in the JSON record.
- Report an unreachable path with the command you ran and the unmet precondition.
- Do not report a path as verified when you drove a different path. A direct URL does not prove the link that leads to it.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph of user-visible behavior. It then uses exactly four H2 sections in this order:

1. `Sub-features` lists short IDs with one line each.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify.mjs` starts with `Preconditions:`. Each bullet pairs one user action with its command and its observable result.
4. `Gotchas` lists traps that waste or invalidate a run.
