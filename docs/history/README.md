# docs/history/ — archived records

Point-in-time documents kept for provenance. Nothing in here is current; each file states
what superseded it and when.

| File | What it is | Superseded by |
|---|---|---|
| [`CHANGELOG-through-0.41.1.md`](CHANGELOG-through-0.41.1.md) | Every release from `0.1.0` to `0.41.1` (48 versions) as they stood before the `0.42.0` cleanup | [`/CHANGELOG.md`](../../CHANGELOG.md) — the live file |
| [`implementation-plan-v0.23.0-cti.md`](implementation-plan-v0.23.0-cti.md) | The Calm Travel Intelligence implementation plan | Shipped in v0.31.0 |

## Why the changelog archive exists

Commit `adf5f66` (*"chore: v0.42.0 - C1-C5 Hy4 audit P0 fixes, changelog cleanup"*,
Sep 7 2026) rewrote `CHANGELOG.md` from **830 lines to 21**, discarding the entire
pre-`0.42.0` record. The content was not lost — it survives in `git log` — but it stopped
being readable from the file a public reader actually opens.

This archive restores that readability. It is a verbatim copy of
`git show adf5f66^:CHANGELOG.md`, recovered on 2026-09-11. No entry was edited, reordered
or reformatted.

## Rule for this file (also stated in `AGENTS.md`)

**Never bulk-rewrite `CHANGELOG.md` through a script, heredoc or shell interpolation.**
That path has eaten the leading byte out of code spans twice in this repo:

- `adf5f66` — `` `applyChange` `` committed as `` `pplyChange` ``, `` `routeHash` `` as `` `outeHash` ``
- The `[0.43.0]` entry records an earlier repair: *"a BEL character where an 'a' should be,
  a split `routeHash` line"*

A byte-eating rewrite in the file that records the project's history destroys the evidence
you would need to notice it happened. Edit `CHANGELOG.md` with editor primitives only.

## Resolved: the "C5" question (2026-09-11)

The live `[0.42.0]` entry's banner used to claim **"C1-C5: Hy4 audit P0 fixes"**, but the
entry only ever described C1, C2, C3 and C4 — there was no C5 anywhere in the file, the
recovered archive, or the commit history. Asked to resolve it, the project owner's answer
was to drop it: the banner now reads **C1–C4** and no C5 item is tracked.

**This was a claim with no work behind it**, which is why it could not be resolved by
reading the repo — only by asking. Recorded here so a future reader who finds an old
reference to "C1-C5" knows it was a banner overstating its entry, not a lost fix.

