# Triage labels

The five canonical triage roles. Each label string equals its name — no
overrides, because this tracker had no prior triage vocabulary to match.

| Label | Meaning |
| --- | --- |
| `needs-triage` | Maintainer needs to evaluate. Where an unlabeled issue lands first. |
| `needs-info` | Waiting on the reporter for more information. Returns to `needs-triage` once they reply. |
| `ready-for-agent` | Fully specified, ready for an AFK agent. Carries an agent brief as the authoritative contract. |
| `ready-for-human` | Needs human implementation — judgment calls, external access, design decisions, manual testing. |
| `wontfix` | Will not be actioned. A rejected *request* must also record a file in `.out-of-scope/`. |

For a PR the same states read against the attached code: `ready-for-agent`
means an agent should take the next step on the diff; `ready-for-human`
means it's ready for a human to merge.

## How these combine with the repo's own labels

An issue carries **both** vocabularies, and they answer different questions:

- `priority: P0`–`P3` (**this repo's convention**, `AGENTS.md` §6) — *how
  urgent is this?* Exactly one per issue, assigned at creation.
- The five labels above — *what state is this in?* At most one at a time,
  moved by `triage` as the issue is worked.

So a typical issue reads `priority: P2` + `ready-for-agent`. Never a second
priority label; the triage label is orthogonal to it.

Note that `AGENTS.md` §2.4 still governs how work gets claimed — a triage
label is a queue position, not a claim on the work.