# Orchestration templates

Two templates keep the orchestrator thread small. Use them for every batch.
This is a how-to doc.

## Worker report format

A worker must end its work with this report. The orchestrator reads only this report.

```
MODEL: <exact model ID>
VERDICT: PASS | SEND-BACK | BLOCKED
SHA: <commit hash, or "none">
FILES: <changed paths, one line>
PROOF: <up to 10 lines of real command output>
LOG: <path to the long output, if any>
OPEN: <one line, or "none">
```

Rules:

1. Write the long output to a file. Point to it in `LOG`.
2. Do not paste logs into the report.
3. Do not post status messages to the orchestrator thread while you work.
4. Send the report once, when you finish.

## Orchestrator wait rule

1. Start the workers.
2. End the turn.
3. Wait for the completion notification.
4. Do not poll. Set one fallback wake-up of 20 minutes or more for a hung worker.

## Batch handoff file

Write this file when a batch ends. Start the next orchestrator thread from it.
Keep it to one screen.

```
BATCH: <name>            DATE: <YYYY-MM-DD>
BRANCH / HEAD SHA: <branch> @ <sha>
MERGED: <PR numbers>
OPEN PRS: <number: state, one line each>
WORKERS OPEN: <thread name: task, state>
GATES: <what ran, on which SHA, verdict>
NEXT STEP: <one action>
DO NOT: <push, SQL, deploy, or other held actions>
```

Rules:

1. Re-derive every line from `git` and `gh`. Do not copy it from memory.
2. One coordinator owns the batch. Other lanes report to files or PR comments.
3. Run one `npm run verify` per batch. Queue the Gates once per SHA.

## Close threads when the task is complete

The orchestrator settles a worker thread when all of these are true:

1. The worker's report is in `INBOX.md` with verdict PASS, or the lane is closed as superseded.
2. The orchestrator checked the claim against git or `gh`.
3. The thread is not running and has no pending request.
4. The deliverable is read, merged or recorded in `STATE.md`.

The orchestrator must not settle a running thread, a SEND-BACK or BLOCKED thread,
the covering coordinator, or a thread missing from `STATE.md`. Settle is reversible.
Record each settled thread in `STATE.md`. Record each worker thread ID there when you
start the worker.

## Start an orchestrator with one word

Type `/orch` in a new Claude thread. The skill reads `.orchestration/TAKEOVER.md`
and follows it. For Codex, send: "Read `C:\Users\hasna\Yatraflow-T3\.orchestration\TAKEOVER.md`
and follow it."

## Failover: when the orchestrator is unavailable

A usage limit can stop the orchestrator while workers still run. A second
orchestrator, such as Codex, then covers the role. The state lives in two files,
not in a chat thread. Both files sit in `C:\Users\hasna\Yatraflow-T3\.orchestration\`.
Git ignores that folder through `.git/info/exclude`. Every worker, in any worktree,
uses that absolute path.

### STATE.md

The active orchestrator owns this file. Use the batch handoff format above.
Add one first line:

```
ORCHESTRATOR: <Claude | Codex>   SINCE: <YYYY-MM-DD HH:MM>
```

Update the file after each decision. Do not wait until the end of the batch.

### INBOX.md

Workers only append to this file. Each report is one block:

```
--- <YYYY-MM-DD HH:MM> <worker name> ---
<the worker report format above>
```

Use an append operation (`>>`). Never rewrite the file. The active orchestrator
reads new blocks and acts on them.

### Takeover (covering orchestrator)

1. Read `STATE.md` and `INBOX.md`.
2. Re-derive the facts from `git` and `gh`. Do not trust the files alone.
3. Set the first line of `STATE.md` to yourself.
4. Do not message the unavailable orchestrator's thread.

### Handback

1. Write the final state into `STATE.md`. Set the first line back to the owner.
2. The owner reads `STATE.md` and `INBOX.md`. The owner does not ask for a summary.

### Worker rule

Report to `INBOX.md`. Do not send status messages while you work. Do not address
a report to a named orchestrator thread.
