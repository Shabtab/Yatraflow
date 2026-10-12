# CLAUDE.md — YatraFlow agent routing

@AGENTS.md

The import above loads [`AGENTS.md`](AGENTS.md), which holds the workflow rules.
This file holds only the routing rules for Claude sessions.

## Roles

| Role | Model and effort | Job |
| --- | --- | --- |
| Main thread | Opus, medium effort | Plan, write briefs, guide workers, check every report against git, report to the user. Do as little hands-on work as possible. |
| Worker | Haiku 5.5, max or high effort | Do all the labour, including UI work, fixes and doc edits. Run a swarm in parallel. Use max for work that needs judgment (SQL, security, logic, honesty fixes, spec-matched UI). Use high for mechanical work (class moves, changelog, version bumps, sweeps, rebases). If you are not sure, use max. |
| Reviewer | Sonnet, high effort | Review UI and complex work before it reaches the user. |
| Advisor | Opus, high effort | Advise on hard decisions only. Spawn it as a subagent. Do not use it for labour. |

The main thread may run short read-only checks itself, such as `git log`, `git diff --stat` and `grep`.
It must not write code, tests or docs that a worker can write. A one-line fix to its own
briefing files is the exception.

## Lanes

Cline and Codex no longer work on this repo. Haiku workers do all the labour. Opus
orchestrates, Sonnet reviews and an Opus subagent advises. Read "Cline" and "Codex" in the rulings as
"a Haiku worker". The rulings that name their clones (R9, R10) do not apply. R11 still
applies: one batch branch per worker group, no push until the user says so.

## Rules

1. Give every worker disjoint files or its own worktree.
2. Name every subagent `[Model effort] task`. Example: `[Haiku max] budget-tab classes`.
3. Check each worker report against `git log` and `git status -sb`. Do not trust a summary.
4. Do not push or merge without the user's say-so (`AGENTS.md` §2.1, §2.8, §2.11).
5. Run `git fetch origin` with no wildcard refspec.
6. Append CSS only at the end of `src/styles.css`.
7. Convert CRLF to LF in source-scanning tests.
8. Edit `CHANGELOG.md` with editor primitives only (`AGENTS.md` §2.9).
9. Write prose in STE (`AGENTS.md` §2.13).
10. Keep the failed, loading and empty states separate. Do not invent data.

## Consistency effort

Read these three files before you start consistency work:

- [`docs/consistency/consistency-rulings.md`](docs/consistency/consistency-rulings.md): rulings R1 to R23.
- [`docs/consistency/app-consistency-plan.md`](docs/consistency/app-consistency-plan.md): the plan, with pages P1 to P16.
- The newest `docs/consistency/handoff-*.md`: the branch map and next steps from the last session.

The Roles table in this file overrides every routing line in the plan.
A ruling overrides the plan where they differ. Example: R14 limits the serif font to the
page h1, which answers plan question Q1. Re-derive the open pull requests from `gh` and
git. Do not rely on a status line in these files.
