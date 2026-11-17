---
name: verify-yatraflow
description: Drive the running YatraFlow web app in a headless browser. Use it to prove that a UI, routing or auth change works.
---

# Verify YatraFlow

Surface: the web UI. The harness drives signed-out flows and signed-in flows. Signed-in flows use a disposable test account (see Sign in).

Work only in the clone you own. Run every command from that clone's repo root.

Before you start, these must be true:

- Node 22 or newer. This clone uses Node 24.
- Dependencies installed with `npm ci`. Clear `npm_config_allow_scripts` first.
- `.env.local` present, with `VITE_SUPABASE_URL` set.
- For signed-in checks, `.env.local` also holds `VERIFY_TEST_EMAIL` and `VERIFY_TEST_PASSWORD`. See Sign in.

Git Bash users must prefix each command with `MSYS_NO_PATHCONV=1`. Without it, a `/` route becomes a Windows path and the harness refuses it. PowerShell does not need the prefix.

The one helper is `scripts/verify.mjs`. Shown below as `V`:

```bash
V=".agents/skills/verify-yatraflow/scripts/verify.mjs"
```

## Launch

```bash
node $V start
```

Starts Vite on port 5178 with `--strictPort`. Set `VERIFY_APP_PORT` to use another port. Output goes to `.verify-evidence/run/dev.log`. The command returns when `http://localhost:5178` answers 200. It refuses to proceed if port 5178 is held by a server the harness did not start. It does not kill that server.

## Doctor

```bash
node $V doctor
```

Checks three things, one line each:

- The dev server is one the harness started.
- The app answers on `http://localhost:5178`.
- The Supabase project ref from `.env.local` is compiled into the served client.

Exit code is non-zero if any check fails. Run `doctor` first whenever a result looks wrong.

## Drive

```bash
MSYS_NO_PATHCONV=1 node $V drive <route> <name> [--click <text>] [--expect <text>] [--width <px>] [--settle <ms>] [--signin]
```

- `<route>` is an app path, for example `/explore`, `/auth?mode=signup` or `/trip/<id>/map`.
- `--click` clicks the first link or button whose text matches exactly. If none matches, it uses a substring match.
- `--settle` waits this many milliseconds after a click before it reads the page. Default is 3000. Without `--click`, `--settle` has no effect: the page is read about 4 seconds after load. A cold dev server can take longer than that. Use `--expect`, or reach the page through a `--click`, so that a slow load is not recorded as a stuck page.
- `--expect` checks the page text. The command waits up to 15 seconds for the text, then exits `1` if it is still missing.
- `--width` sets the viewport width. Default is 1280. Below 720 the page renders as mobile.
- `--signin` runs `signin` first. It does nothing when the account is already signed in.

Each drive opens headless Edge (Chrome as fallback) on DevTools port 9333. Set `VERIFY_CDP_PORT` to change it, and `VERIFY_BROWSER` to point at a browser executable. The browser profile lives in `.verify-evidence/run/browser-profile`. A session is bound to an origin, so a sign-in on port 5178 would persist across drives.

Pick `--expect` text that appears only on the destination. Some labels appear on more than one page.

## Sign in

The test account lets the harness reach signed-in pages. Put both keys in `.env.local`:

```
VERIFY_TEST_EMAIL=
VERIFY_TEST_PASSWORD=
```

Use a disposable account only. The harness never prints these values. It replaces them with `[test account]` in every record and message.

```bash
node $V signin
MSYS_NO_PATHCONV=1 node $V trips
MSYS_NO_PATHCONV=1 node $V drive <route> <name> --signin [--expect <text>]
```

- `signin` signs the test account in on the running app. It exits `1` with a message when a key is missing or sign-in fails. When the account is already signed in, it prints that and does nothing else.
- `trips` signs in if needed. It prints each trip title with its workspace route (`/trip/<id>`) and its Map tab route (`/trip/<id>/map`).
- `drive --signin` runs `signin` first, then drives the route.
- `stop` removes `.verify-evidence/run/`, and with it the browser profile and the session. Run `signin` again after the next `start`.

To reach a trip's Map tab, run `trips`, then drive the `map` route it prints. Use the trip title as `--expect` text. The signed-out trip page shows "Sign in to open this trip" instead of the title.

## Evidence

Each drive writes two files to `.verify-evidence/`:

- `<name>.png` is a screenshot of the viewport.
- `<name>.json` is the record: `route`, `finalUrl`, `title`, `width`, `click`, `expectation`, `consoleErrors`, `bodyTextExcerpt`, `screenshot`, `capturedAt`.

Proof standard:

- Check the action and the resulting state. Read `finalUrl`, `title` and `expectation` in the JSON. Do not rely on the screenshot alone.
- Record every entry in `consoleErrors`. Treat new errors as findings.
- A failed `--expect` is a result, not a harness fault. Report it with the record.

A drive can also fail with a load timeout. This happens when Vite compiles a route for the first time. Run the same command again. Report both tries.

## Cleanup

```bash
node $V stop
```

Kills the browser and the dev server by the PIDs recorded in `.verify-evidence/run/`, using `taskkill /T` on each tree. It never kills by process name. Edge helpers can outlive `taskkill /T`. On Windows it then kills each process whose command line names this run's profile folder. It removes `.verify-evidence/run/`. It keeps every proof file in `.verify-evidence/`.

Run `stop` after every failed try too, so no process stays on port 5178 or 9333.

## Features

The feature map is in [`features/`](features/README.md). Start there, pick the file for the feature you need, and follow its Driving section.

## Known defects (found by this skill)

- Every landing load logs React duplicate-key warnings. The stack trace points at `PlanBench`.

## Gaps

- Signed-in flows are drivable with the disposable test account. Use `signin`, `trips` and `drive --signin`.
- UI work on signed-in pages must be proven on the signed-in dev server. `dev/` fixtures are a supplementary check, not acceptance proof.
- Sign-in seeds three demo trips into an account that has no trips. Use a disposable account only.
