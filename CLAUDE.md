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

## Consistency effort rulings

The full rulings R1 to R19 and the plan are local files outside this repo. They are
not visible in cloud sessions. R14 to R19 in short:

- R14: Playfair only on the page h1. Caveat only in the page note, once per page.
- R15: The button skin stays on `yf-page` until P16.
- R16: One `SegmentedTabs` component with two variants, tablist and toggle.
- R17: My trips keeps its own filter bar until one approved PR matches it to Explore.
- R18: Merge order is #695, #696, #697, #698, then `feat/consistency-foundations-2`.
- R19: `page-enter` owns the entrance. Stage B pages wait for it.
