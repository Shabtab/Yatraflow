# Collaboration command contract

This document defines the Stage A server contract for issues #801 and #802.
The additive migration adds the RPC before clients use it. The cutover migration
removes unsafe direct writes after every active client uses the RPC.

## Submit a command

Call `submit_collab_command` with these PostgREST arguments:

```json
{
  "p_command_id": "UUID",
  "p_trip_id": "UUID",
  "p_command": { "type": "..." }
}
```

The caller must be a signed-in trip editor. The server reads the actor from
`auth.uid()`. A command must not include an actor or author field.

Command IDs, entity IDs, activity IDs, and trip IDs are stable UUIDs. Comment
IDs are stable text keys. Comment IDs accept letters, digits, `_`, `:`, and `-`.

### Suggestion commands

```json
{
  "type": "suggestion.create",
  "suggestionId": "UUID",
  "suggestion": {
    "dayIndex": 0,
    "title": "Walk the river path",
    "category": "nature",
    "locationName": "Riverside",
    "lat": 12.9,
    "lng": 77.6,
    "description": "A short walk",
    "visitMinutes": 45,
    "estimatedEntryFeeInr": 0,
    "estimatedTransportInr": 0
  }
}
```

Optional suggestion fields may be omitted. The server sets `proposed_by`,
votes, comments, status, and creation time.

```json
{
  "type": "suggestion.comment",
  "suggestionId": "UUID",
  "commentId": "cm_stable_key",
  "text": "Looks good"
}
```

```json
{ "type": "suggestion.ballot", "suggestionId": "UUID", "value": 1 }
```

Use `value: -1` to set a downvote. Use `value: null` to remove the caller's
ballot. A repeated value does not toggle the ballot.

### Decision commands

```json
{
  "type": "decision.create",
  "decisionId": "UUID",
  "decision": {
    "question": "Choose a stop",
    "context": "Optional context",
    "options": [
      { "id": "place-a", "label": "Option A", "place": { "title": "A" } },
      { "id": "place-b", "label": "Option B", "costImpactInr": 100 }
    ]
  }
}
```

Each option needs a distinct ID and a label. The server preserves supported
option impact fields and the place payload.

```json
{
  "type": "decision.comment",
  "decisionId": "UUID",
  "commentId": "cm_stable_key",
  "text": "I prefer A"
}
```

```json
{ "type": "decision.ballot", "decisionId": "UUID", "optionId": "place-a" }
```

Use `optionId: null` to remove the caller's ballot. The decision must be open.
The chosen ID must exist in its options.

### Activity command

```json
{
  "type": "activity.append",
  "activityId": "UUID",
  "verb": "added a note",
  "target": "Optional target"
}
```

The server sets `actor_id`. Use this command for activity without another
contribution command. Other commands create their activity in the same
transaction and return its ID.

## Receipt

Every receipt has a `status` and `tripRevision` field.

| Status | Meaning |
| --- | --- |
| `applied` | The command and its side effects committed. |
| `alreadyApplied` | The same actor retried the same command ID and payload. |
| `conflict` | The command ID or stable row ID conflicts with another write. |
| `invalid` | The command or stored contribution has an invalid shape. |
| `forbidden` | The caller lacks a signed-in editor role. |
| `unavailable` | The database could not commit the whole command. |

Suggestion receipts include the canonical `suggestion` row. Decision receipts
include the canonical `decision` row. These rows use the current database read
shape. Receipts also include `activityId` and `notificationIds` when present.
An `alreadyApplied` receipt reads the current row again, so it can include newer
peer contributions.

Serialize commands for each suggestion or decision, or track freshness for that
row. Record the row generation before each RPC. Apply its receipt only if that
generation is still current. If realtime or a later command changed the row,
discard the receipt row and fetch that suggestion or decision. Fetching only the
trip does not prove contribution freshness. Keep the existing identity guards
on each async continuation.

If the trip revision differs from the client's known revision, fetch the
authoritative trip and reconcile pending edits. The receipt contains no trip
payload. A client must not advance its trip CAS revision while keeping an older
trip snapshot. Keep trip writes on the existing serialized write path.

Contribution commands do not update `trips`. `tripRevision` is the locked
revision observed by the command. It is an acknowledgment value, not a trip
snapshot or permission to replace queued trip edits. It does not order
contribution rows because these commands do not change that revision.

The command ledger survives trip deletion. It stores a payload hash and receipt,
not comment text. The server returns `conflict` when a caller reuses a command
ID with another actor, trip, or payload.

## Restore and cutover

`restore_trip_contributions(p_trip_id)` restores the server archive for a direct
owner deletion. It accepts no client-supplied rows. The trigger archives rows
only for a live trip deleted by its active owner. Restore needs the same
owner, or an admin, and the recreated trip must keep its original owner. It does
not replace rows that already exist. The restore window is ten minutes.

The cutover migration schedules a ten-minute cleanup job when `pg_cron` is
enabled and the job is active for this database with the expected schedule and
cleanup command. The delete trigger archives rows only while that job is active.
Enable `pg_cron` before cutover to keep the legacy hard-delete Undo path. Without it,
the trigger refuses a live owner hard delete and names Trash as the safe path.
Soft-trash restore still works. The service-role cleanup RPC supports
deployments that manage their own schedule. If the job is later removed, old
archives can remain until cleanup runs. Account deletion removes archives that
contain that account. The local SQL test uses a cron catalog stub. It does not
prove that Supabase runs the scheduled job.

Apply `20261023a_collab_commands.sql`, deploy clients, then apply
`20261023b_collab_cutover.sql`. Before cutover, direct writes remain available
for old clients. After cutover, create, ballot, comment, and activity writes
must use the RPC. Suggestion and decision workflow updates remain editor-scoped.
Direct updates cannot replace contribution columns. Activity remains
append-only. Notification reads, updates, and deletes remain recipient-only.
