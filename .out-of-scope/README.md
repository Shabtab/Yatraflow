# Out of scope

One file per **rejected feature request**, so `triage` stops re-litigating a
decision the maintainer already made. The `triage` skill reads this directory
during step 1 (prior-rejection check) and surfaces anything resembling the
request it is about to triage.

## When to add a file

When a feature request is closed as `wontfix` **and the reason is a decision,
not a defect**. A bug is fixed, not filed here. The label alone is not enough:
an unexplained `wontfix` teaches the next reader nothing.

## When not to add a file

- The request is a **bug** — fix it.
- The rejection is **scope for this milestone**, not for the product. That
  belongs in `ROADMAP.md`'s idea bank, which is the plan of record; a file here
  would read as "never".
- The request is **already implemented** — triage's redundancy check finds
  that from the code; record where you looked in the triage notes instead.

## Naming

`NNNN-short-slug.md`, numbered in creation order (`0001-…`). The number keeps
the ordering stable; the slug carries the meaning.

## Template

```markdown
# <the request, in one line>

**Closed:** YYYY-MM-DD · **Issue:** #N · **Label:** wontfix

## What was asked

One paragraph, in the reporter's terms.

## Why it is out of scope

The decision and its reason. Be specific about *why*, not just *what* — a
future reader needs to tell whether this still applies.

## What would change our mind

The condition that would reopen it. Omit only if nothing would.
```