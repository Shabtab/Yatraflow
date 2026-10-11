# CLAUDE.md — YatraFlow agent routing

Read [`AGENTS.md`](AGENTS.md) first. It holds the workflow rules. This file holds
only the routing rules for Claude sessions.

## Roles

| Role | Model and effort | Job |
| --- | --- | --- |
| Main thread | Sonnet | Plan, write the brief, check every report against git, report to the user. |
| Worker | Haiku 5.5, max effort | Do the labour, including UI work. Run a swarm in parallel. |
| Reviewer | Sonnet, high effort | Review UI and complex work. |
| Advisor | Opus | Advise on hard decisions only. Do not use Opus for labour. |

## Lanes

Cline and Codex no longer work on this repo. Haiku workers do all the labour. Sonnet
orchestrates and reviews. Opus advises. Read "Cline" and "Codex" in the rulings as
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

Read these two files before you start consistency work:

- [`docs/consistency/consistency-rulings.md`](docs/consistency/consistency-rulings.md): rulings R1 to R19.
- [`docs/consistency/app-consistency-plan.md`](docs/consistency/app-consistency-plan.md): the plan, with pages P1 to P16.

A ruling overrides the plan where they differ. Example: R14 limits the serif font to the
page h1, which answers plan question Q1. Re-derive the open pull requests from `gh` and
git. Do not rely on a status line in these files.
