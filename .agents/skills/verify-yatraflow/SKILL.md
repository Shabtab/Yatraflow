---
name: verify-yatraflow
description: Drive the running YatraFlow web app in a headless browser. Use it to prove that a UI, routing or auth change works.
---

# Verify YatraFlow

Surface: the web UI. The harness drives signed-out flows today. Signed-in flows need a test account and are not drivable yet (see Gaps).

Work only in the clone you own. Run every command from that clone's repo root.

Before you start, these must be true:

- Node 22 or newer. This clone uses Node 24.
- Dependencies installed with `npm ci`. Clear `npm_config_allow_scripts` first.
- `.env.local` present, with `VITE_SUPABASE_URL` set.

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
MSYS_NO_PATHCONV=1 node $V drive <route> <name> [--click <text>] [--expect <text>] [--width <px>] [--settle <ms>]
```

- `<route>` is an app path, for example `/explore` or `/auth?mode=signup`.
- `--click` clicks the first link or button whose text matches exactly. If none matches, it uses a substring match.
- `--settle` waits this many milliseconds after a click before it reads the page. Default is 3000.
- `--expect` checks the page text. The command exits `1` if the text is missing.
- `--width` sets the viewport width. Default is 1280. Below 720 the page renders as mobile.

Each drive opens headless Edge (Chrome as fallback) on DevTools port 9333. Set `VERIFY_CDP_PORT` to change it, and `VERIFY_BROWSER` to point at a browser executable. The browser profile lives in `.verify-evidence/run/browser-profile`. A session is bound to an origin, so a sign-in on port 5178 would persist across drives.

Pick `--expect` text that appears only on the destination. Some labels appear on more than one page.

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

Kills the browser and the dev server by the PIDs recorded in `.verify-evidence/run/`, using `taskkill /T` on each tree. It never kills by process name. It removes `.verify-evidence/run/`. It keeps every proof file in `.verify-evidence/`.

Run `stop` after every failed try too, so no process stays on port 5178 or 9333.

## Features

The feature map is in [`features/`](features/README.md). Start there, pick the file for the feature you need, and follow its Driving section.

## Known defects (found by this skill)

- The landing hero links use hash hrefs, so they do not reach their page on web. This affects the hero "Start a trip plan" and "Explore itineraries" links in `src/pages/Landing.tsx`. The web router reads the pathname and ignores hash-only changes. The URL changes; the page stays on the landing. The header "Start planning free" link is a path and works. Driven in [`features/start-planning.md`](features/start-planning.md) and [`features/explore.md`](features/explore.md). Other hash links exist in `src/pages/Landing.tsx` (footer DMCA, bench sign-up) and `src/components/PlanBench.tsx`. Those are not driven yet.
- Every landing load logs React duplicate-key warnings. The stack trace points at `PlanBench`.

## Gaps

- Signed-in flows (create trip, My trips list, trip workspace, fork) need a test account. The harness has no sign-in step. Do not report these as verified.
- A real sign-in seeds sample trips into the account. Use a disposable account only.
