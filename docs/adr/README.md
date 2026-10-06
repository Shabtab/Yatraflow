# Architecture decision records

One file per decision worth remembering: choices that are **expensive to
reverse**, **surprising without context**, or **contested when made**. Not a
log of every change — `CHANGELOG.md` is that.

Consumer rules (also in [`docs/agents/domain.md`](../../docs/agents/domain.md)):

- An ADR records a **decision and its reason**. The code records the
  implementation; an ADR that restates the code rots.
- **Never edit an Accepted ADR's decision.** Supersede it with a new file that
  links back, and mark the old one `Superseded by ADR-NNNN`. The history of
  what was believed *then* is the point.
- A roadmap or idea-bank row is a **claim about code**, not a decision. Verify
  it against `src/` before treating it as one.

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-two-branch-release-model.md) | Feature work integrates on `test`; only releases reach `main` | Accepted |

## Status values

`Proposed` → `Accepted` → (`Superseded by ADR-NNNN` | `Amended by ADR-NNNN`)

## Naming

`NNNN-short-title.md`, numbered in creation order and never reused, including
after supersession.

## Template

```markdown
# NNNN. <the decision, as a sentence>

**Status:** Proposed · **Date:** YYYY-MM-DD

## Context

What forced the decision. Constraints, forces, and what was true at the time
— the part a future reader cannot reconstruct from the code.

## Decision

What was decided, in the active voice: "We will …".

## Consequences

What this makes easy, what it makes hard, and what it costs. Include the
options rejected and why, if that is not obvious.
```