# AGENTS.md — YatraFlow

Operating manual for AI coding agents. Each rule in §2 points to its full text in `docs/agents/AGENTS-FULL.md`.

## 0. The learning rule (this file must grow)

Record each crucial learning in the same session, as a short rule. Before you commit, ask: did this session teach something a fresh session needs? If yes, add it in the same commit. Prune rules that stop being true.

| What you learned | Where it goes |
| --- | --- |
| A class of work, or a pitfall | `CODING_STANDARDS.md` |
| What the gate runs, CI, or migrations | `docs/AGENTS-VERIFICATION.md` |
| A workflow rule the user mandated | This file, §2 |

## 1. What this project is

YatraFlow is a collaborative India trip-planning app, built with React 18, Vite 8, TypeScript, Supabase and MapLibre GL. It deploys on Vercel from `main`. No bookings — planning plus paid itinerary unlocks.

Key locations:

- `src/App.tsx` — app shell: routes, nav, theme, notifications; links must use `appLink(path)` (`src/lib/appLink.ts`)
- `src/store/store.ts` — data layer over Supabase (`useSyncExternalStore`)
- `src/lib/engine.ts` — pure planning engine: schedule, budget, breaks, warnings
- `src/lib/geocode.ts` — provider facade: Google-only with a key, free stack without one (see §5)
- `src/lib/providers/` — `google.ts`, `free.ts` (OSM/Wikipedia/Mappls)
- `src/lib/timefmt.ts` — 12h/24h clock formatters
- `src/lib/uiPrefs.ts` — per-day collapse state in localStorage
- `src/components/TripMap.tsx` — MapLibre map (lazy chunk); `src/components/mapcn/` wrapper
- `src/pages/TripWorkspace.tsx` — workspace tabs: timeline, map, budget, share
- `tests/` — vitest in node env (no DOM): pure logic only
- `CHANGELOG.md` — Keep-a-Changelog style

## 1.1 Current project status

Do not read project status from this file. Derive it with these commands:

```bash
git status -sb
git log --oneline -5
git rev-list --left-right --count origin/test...HEAD
git describe --tags --abbrev=0
gh issue list --state open --limit 500
gh pr list --state open --limit 500
```

Pass `--limit 500` on every `gh` list, or a bare list silently returns 30 rows. The open-issue count and the branch-level claim this section used to carry **do not exist** here on purpose. Re-derive both from `gh` and git.

Before any push to `test`, run:

```bash
git merge-base --is-ancestor origin/test origin/main && echo "test is BEHIND main - resync first"
git rev-list --count origin/main..origin/test
```

## 2. Workflow rules (non-negotiable, user-mandated)

1. Never push to `main` without explicit user confirmation. Commit locally first. Full text: docs/agents/AGENTS-FULL.md §2.1
2. Every push ships a `CHANGELOG.md` entry in the same commit, written as final state. Full text: docs/agents/AGENTS-FULL.md §2.2
3. Give each fix and feature a changelog entry readable six months later. Full text: docs/agents/AGENTS-FULL.md §2.3
4. Claim an issue in the same breath as your analysis, or another lane may repeat the fix. Full text: docs/agents/AGENTS-FULL.md §2.4
5. Tick a UI-audit finding in `ROADMAP.md` in the same commit that fixes it. Full text: docs/agents/AGENTS-FULL.md §2.5
6. Check each "done" claim against git first. Rules 6a to 6z live in `CODING_STANDARDS.md`. Full text: docs/agents/AGENTS-FULL.md §2.6
7. Prove a localhost URL serves this tree with its backend. A server without its backend looks broken. Full text: docs/agents/AGENTS-FULL.md §2.7
8. Run `npm run verify` before any push. Wait for the user to confirm the branch. Every PR to `hasnaina955/Yatraflow` targets `test`, security fixes included. Full text: docs/agents/AGENTS-FULL.md §2.8
9. Edit `CHANGELOG.md` with editor primitives only. A bulk rewrite once cut it from 830 lines to 21. Full text: docs/agents/AGENTS-FULL.md §2.9
10. Every interactive surface ships motion from `docs/MOTION-TOKENS.md`. A raw `ms` value is a review flag. Full text: docs/agents/AGENTS-FULL.md §2.10
11. Keep work local until the batch is complete and the localhost check passes. Full text: docs/agents/AGENTS-FULL.md §2.11
12. GitHub closes issues only on merges into `main`. Close each one by hand after a `test` merge. Full text: docs/agents/AGENTS-FULL.md §2.12
13. Write new prose in Simplified Technical English. Run `npm run lint:ste` before you commit. Full text: docs/agents/AGENTS-FULL.md §2.13
14. Never add lint errors. `npm run lint:ratchet` fails when any count rises, so never raise `eslint-baseline.json`. Full text: docs/agents/AGENTS-FULL.md §2.14
15. Clear `NODE_ENV` before any install, or npm skips devDependencies silently. You must hand each migration the user runs over as complete SQL in the chat, with its absolute path. Full text: docs/agents/AGENTS-FULL.md §2.15
16. Work only in your own clone, and give every command an explicit root. Full text: docs/agents/AGENTS-FULL.md §2.16
17. Promote `test` to `main` once per finished batch: a minor release for a feature, a patch release for a fix. Full text: docs/agents/AGENTS-FULL.md §2.17
18. Search for prior art before you build: compare up to three maintained GitHub projects. Adapt code only from MIT, Apache-2.0, BSD or ISC sources. Full text: docs/agents/AGENTS-FULL.md §2.18
19. Claim an issue before you start it, and check for an existing claim. A claim holds even when its branch is not pushed. Full text: docs/agents/AGENTS-FULL.md §2.19

### What enforces each rule

A rule with no row here is a judgment call.

| Rule | Gate, or who decides |
| --- | --- |
| §2.1 push to `main` | Judgment (the user) |
| §2.2–3 changelog | `lint:ste`; review; `.gitattributes` union merge |
| §2.4 claim the work | Judgment; `git ls-remote --heads origin` |
| §2.5 UI-audit ticks | Review |
| §2.6 done claims | `git status -sb` and `git log` on every resume |
| §2.7 localhost URL | Judgment; probe commands in the rule |
| §2.8 build and branch | Judgment (the user confirms) |
| §2.9 CHANGELOG edits | Review of the diff stat; `lint:ste` |
| §2.10 motion | `tests/design-system.test.ts`; `npm run check:ui` |
| §2.11 stays local | Judgment (the user says when to push) |
| §2.12 issues closed | `.github/workflows/issue-autoclose.yml`; `gh issue view` |
| §2.13 STE prose | `npm run lint:ste` |
| §2.14 lint ratchet | `npm run lint:ratchet` vs `eslint-baseline.json` |
| §2.15 NODE_ENV | `npm run clean:env` |
| §2.16 own clone | Judgment (global clone table) |
| §2.17 promote | Judgment; `git rev-list --count origin/main..origin/test` |
| §2.18 prior art | Judgment; the PR description lists projects, licences and choice |
| §2.19 claim before you start | Judgment; the issue assignee, the claim comment and `git ls-remote --heads origin` |
| §3 gate, CI, migrations | `npm run verify`; `ci.yml`; `npm run check:migrations`; live probe |
| §4 conventions | `CODING_STANDARDS.md`; `supabase/tests/rls_contract.test.sql`; `tests/design-system.test.ts` |
| §6 roadmap version | `tests/roadmap-status.test.ts` |
| §6 docs claims | `tests/doc-drift.test.ts` |
| Glass panel blur | `tests/design-system.test.ts` |
| Page block motion | CI job `motion` (`npm run check:motion`) |

## 3. Verification, CI and the migration check

Moved to `docs/AGENTS-VERIFICATION.md` (gate, CI, migration check). Full text: docs/agents/AGENTS-FULL.md §3.

## 4. Code conventions & pitfalls

Moved to `CODING_STANDARDS.md`. Read the rule for your area. Full text: docs/agents/AGENTS-FULL.md §4.

## 5. External services

Supabase (auth and data), Vercel (deploys from `main`), Google Places (opt-in key), OSRM, Open-Meteo, Mappls, and OpenFreeMap (basemap tiles).

Provider directive: with a Google key configured, the POI pipeline must stay Google-only, with no silent fallback. The night-halt town anchor is the one exception.

Supabase DDL can fail read-only, so manage realtime publications in the Dashboard. Probe before you prune data. Full text: docs/agents/AGENTS-FULL.md §5.

## 6. Documentation protocol

Keep ROADMAP.md, CHANGELOG.md and the doc index current in the same commit as the work. Full text: docs/agents/AGENTS-FULL.md §6.

- ROADMAP.md is the only plan of record. Its Idea bank lists every unbuilt idea, tiered by readiness.
- Update progress lines in the same edit as the tick. Put each deferral in the Idea bank in the same commit.
- A roadmap row can be wrong. A Sep-6 row was still listed as unbuilt, though the engine had shipped it. Check `src/` first.
- Changelog entries open with a bold outcome sentence. Version headings use a hyphen: `## [X.Y.Z] - YYYY-MM-DD`.
- README highlights run newest first. Re-derive evergreen claims from the code.
- Every new doc gets a row in `docs/README.md`.
- iOS Safari never vibrates. Only the Capacitor native shell does.
- Every open issue carries exactly one `priority: P0` to `P3` label. Set it from the label definitions.

Pitfalls, one line each. Full text: docs/agents/AGENTS-FULL.md §6.

- **Recovery paths.** Verify the write. A failed read must not look empty.
- **Money mismatches.** Read `purchase_orders` and `entitlements` first.
- **Policy re-runs.** Guard each policy with `drop policy if exists`.
- **Function signatures.** Drop the old overload before `create or replace`.
- **Constraint changes.** Match the DDL form that created it.
- **JSONB RPCs.** Fail closed on every unexpected shape.
- **RESTRICTIVE policies.** Assert `pg_policies.permissive`. The flag is load-bearing.
- **Unapplied SQL.** Call each new function through its real client path.
- **Revokes.** Name `anon` too: `revoke ... from public, anon`.
- **Vitest include.** Pin `test.include` in `vite.config.ts`.
- **Popups.** Fix the stacking host. Prove it with `elementFromPoint`.
- **Design-system baseline.** Keyed by line number. Re-baseline only with proof.
- **CSS placement.** Append new CSS at the end of `styles.css`.
- **Funnels.** Counters must measure one kind of thing. Never clamp a rate.
- **Preview replace.** Start the new server before `replace: true`.
- **UI sweeps.** A probe must fire on known-bad input first.
- **Source guards.** They read comments too. Do not quote their literal.
- **Scripted edits.** Use an anchor that is unique.

## Agent skills

### Browser verification

`.agents/skills/verify-yatraflow/` starts the dev server and drives a headless browser to a route. Read its `SKILL.md` first.

### Issue tracker

Issues: GitHub, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, used alongside `priority: P0`–`P3`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
