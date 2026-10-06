# Issue tracker

**GitHub Issues** in `hasnaina955/Yatraflow`, driven with the `gh` CLI.

- Remote: `https://github.com/hasnaina955/Yatraflow.git`
- Create: `gh issue create --title "..." --body "..." --label "priority: P2"`
- List: `gh issue list --state open`
- View: `gh issue view <n> --json title,body,labels,comments`

**PRs are not a request surface.** External PRs do not enter the triage
queue. Flip `prsAsRequests: true` below if that ever changes.

```yaml
tracker: github
repo: hasnaina955/Yatraflow
cli: gh
prsAsRequests: false
```

## Repo conventions that override skill defaults

- Every open issue carries exactly **one** `priority: P0`–`P3` label
  (see `AGENTS.md` §6). Triage state labels sit alongside it, never a
  second priority label.
- A diagnosis posted on an issue is an invitation — claim the work in the
  same breath (`AGENTS.md` §2.4).
- Merges into `test` do not auto-close issues; close them by hand
  (`AGENTS.md` §12).