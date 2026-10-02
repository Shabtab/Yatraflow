# 0001. Feature work integrates on `test`; only releases reach `main`

**Status:** Accepted · **Date:** 2026-10-02

## Context

YatraFlow ships continuously to Vercel from `main`, while a great deal of work
is still in flight. Promoting a branch straight to `main` would deploy
unverified work, so the repo needs a place where work lands *before* it is
considered releasable — and that place needs a promotion path of its own.

The two must be distinguishable at a glance. The failure this prevents is
concrete and has happened: work pushed to a `test` that had drifted behind
`main` landed on a tree that could not build, and the release cut that followed
described only part of its own contents.

The cost of this decision is a permanent ambiguity — two branches, and a
question at any moment about which is ahead — so the answer to that question
has to be mechanical rather than remembered.

## Decision

**`main` is production and `test` is integration.**

- A feature is built and verified on its own branch, and merges into `test`.
- A **release** is promoted from `test` to `main` as its own PR, with a full
  local gate green on `test` and refreshed status docs.
- No push to `main` happens without the maintainer's explicit confirmation.

**Drift is checked mechanically before every push**, never recalled:

```bash
git merge-base --is-ancestor origin/test origin/main && echo "test is BEHIND main"
git rev-list --count origin/main..origin/test   # non-zero = test carries unique work
```

The second command is the one that answers the question. The first only tells
you a rebase is needed, not which side is ahead.

Two consequences follow from that pair, and both are load-bearing:

- A branch merged into `test` is **not** releasable, and issues are **not**
  closed by that merge — GitHub's closing keywords fire only on a merge into
  the default branch. The tracker is corrected by hand.
- The release size is quoted as `git diff --stat`, never as a commit count. A
  shallow or long-lived stack inflates the count while contributing nothing.

## Consequences

**Makes easy:** verifying before production; a bisectable promotion per
release; the Android artifact built from a known tree.

**Makes hard:** every push needs the drift check, and the branch question must
be re-derived rather than remembered. Promotion carries its own review.

**Costs:** the two-branch ambiguity above, plus the manual issue-closing step
that a merge would otherwise have handled.

A release's database half is a **separate, user-run step** on the same
reasoning: CI, the merge and the deploy all pass without migrations applied, so
a release is not finished until someone has run them.