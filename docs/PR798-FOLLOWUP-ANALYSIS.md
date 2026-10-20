# PR798 follow-up — analysis notes (MiniMax lane)

Base: `origin/test` @ `90d3f4b4` (PR #798 merge).
Branch: `codex/t3-pr798-followup-mm-cline`.

## The base refresh

`origin/test` has moved on. PR #811 landed the Android update work, and it
**removed** the update-notice files that the old base still carried. A merge
with the current origin/test has two conflicts, and both are trivial append
collisions:

- `docs/README.md` — this branch adds one row and PR #811 adds another at the
  same place. Keep both rows.
- `src/styles.css` — this branch appends the sync-check height rule at the
  END of the file, and PR #811 appends its native-shell block at the END of
  the file. Keep both blocks. The order does not matter, because the two
  rules touch different selectors.

A merge resolved that way passes the full suite: 5514 tests, 1 skipped. The
resolution is mechanical, but it must be done by hand, so the base refresh
needs a coordinator step.

## The S1 defect, traced

`sendQueuedTripWrite` has two terminal branches that discard work:

1. **Membership branch** (`store.ts` ~2961) — the account is not an editor.
   It called `invalidateTripWork` (which drops the durable queued write) and
   then `cache.trips = cache.trips.filter(t => t.id !== entry.tripId)`.
   A **demoted viewer** still reads the shared trip, so the filter removed a
   trip the account can still open.
2. **Missing/deleted branch** (~2972) — same two calls.

`invalidateTripWork` (~2866) dropped the durable queued write via
`dropQueuedWrite` and a second `pendingWrites()` sweep. The queued copy was
gone with no message anywhere.

`hydrateFromSupabase` (~938) and the realtime handlers (~4666, ~4720, ~4729,
~4739) all route through `invalidateTripWork`, so they inherited the same
silent drop.

### The Download button was gated on the same thing

`OfflineBanner.download()` required the trip to be in the cache with an
owner/editor role. A demoted user lost the download action for a copy that
was still on their own device.

## The fix

- `QueuedWrite` gains `reason?: 'access-revoked' | 'access-removed' | 'trip-unavailable'`.
  - `access-revoked` — the account is still a member but may no longer edit.
  - `access-removed` — the membership is gone.
  - `trip-unavailable` — the trip is gone from the server.
- `invalidateTripWork` takes an optional reason. With one, the queued copy is
  **kept** for its owner and marked `state: 'failed'` with that reason. Without
  one (the explicit `discard` choice, a trash, a sign-out) the copy is dropped
  as before.
- The membership branch keeps a **readable** trip in the list, and shows the
  shared plan rather than the local copy. Only an account with no membership at
  all loses the trip.
- The store refuses `retry`/`replace` for a reasoned copy, so a revocation can
  never be papered over. The automatic replay skips it too, so a later grant
  does not silently replay it.
- The banner's Download binds to the **current identity** and the **queued
  owner** only. A live edit role is no longer needed: the copy is already on
  that device. The shared trip's name is used for the title only when the
  account can read that trip; the queued snapshot's own name is never shown.
- A copy that is not exportable shows an accurate line and no Download button,
  so the banner never promises an action it cannot perform.
- The banner counts a reasoned copy as "kept on this device", not as "waiting
  to sync", because it will not sync on its own.

### The scope guards

Every path that touches the cache after an `await` re-checks two things: the
**scope** that started the work, and the **access generation** of the trip.
The check is `sameScopeGeneration`, which is the weaker of the two, because a
branch that handles a lost edit right cannot use the edit-right check.

The same guard sits after every await in the discard path, the membership
branch and the missing-trip branch. A single guard is enough to stop the
defect, and they overlap: removing one alone leaves the scenario covered by a
neighbour. The mutation report in the evidence folder shows this. The
collective removal of the whole set fails the probes, so the set is what holds
the line.

The access generation moves when the access changes, so a guard that compares
against a generation captured BEFORE that change is always false.
`invalidateTripWork` bumps the generation, so it now returns the new value.
The demotion path compares the shared-plan refresh against that returned
value. A refresh that compared against its own captured generation would
never run, and the demoted reader would keep seeing the local proposal.

### The discard and a failed read

The discard separates three outcomes, because they used to be one. A read that
succeeded with a row refreshes the cached plan. A read that succeeded without
a row means the trip is gone, so the plan leaves the list. A read that
**failed** means the shared plan is unknown.

A failed read now **refuses the discard** when the cache is showing the local
overlay. The refusal happens before the copy is dropped, so the queue and the
visible plan still agree. Without the refusal the copy would be gone and the
overlay would stay on screen, and the user could edit the discarded content
and queue it again. A later try reads the shared plan and replaces the
overlay, so the removal completes once the server answers.

### Scope held

Only the four paths the brief names keep the copy: the membership branch, the
missing/deleted branch, hydrate cleanup, and the realtime tombstones. The
explicit `deleteTrip`, `trashTrip` and the `discard` recovery choice still drop
the copy, because the account asked for that.

Residual, not fixed here: `trashTrip` drops the copy before the trash write
runs, so a **failed** trash write loses the queued copy. That is pre-existing
and outside the four named paths.

## Open observations

These are recorded, not fixed. Each one needs a product call or a change
outside this packet.

### A trashed trip can come back as a kept copy

The realtime `trips` handler treats a `DELETE` event and a tombstone the same
way. A tombstone is a `UPDATE` that carries `deleted_at`, and the trip is
taken out of the list with the reason `trip-unavailable`. The queued copy
then stays with that reason.

The `trips` echo window is the risk. A trash write is a local write, so its
own echo arrives with the echo window open, and the echo branch records the
server timestamp and stops. The tombstone never reaches the removal branch.
The result is a trashed trip that stays in the list as a live plan, with the
copy held beside it.

The fix belongs in the trash path, not in the recovery path. A trip the
account trashed must leave the list when the server confirms the tombstone.
The recovery path cannot tell a trashed trip from a deleted one, because both
arrive as `deleted_at`.

### The demotion refresh skips the server timestamp ledger

`refreshSharedPlanAfterDemotion` writes the shared plan into the cache but
does not call `recordServerTripTimestamp`. The ledger records the clock the
server wrote, and the next remote row is compared against it. A missing entry
means the next remote row for that trip has nothing to compare with, so the
stale-row guard cannot drop a row that is older than the shared plan the
demotion just read.

The same branch in the send path does record the timestamp. The demotion
refresh must do the same.

### A removed member can still download the copy

A removed member keeps their queued copy, and the download action stays with
it. The copy is the account's own work, and it is already on their device, so
the export itself touches nothing the account no longer has.

The product question is whether a member who has been removed from a trip
must still be able to export that trip's plan. The copy can name stops,
places and notes the account can no longer read. The current behaviour keeps
the export, because the copy is already on the device and the alternative
leaves the account with no way to recover their own work.

This is a call for the product owner, not a defect on its own.

### The identity check is monotonic, so one guard is a candidate for trimming

`identityEpoch` only ever increments, and it is bumped on every account
change. `isCurrentIdentity` compares the captured epoch with the current one
and the captured user with the signed-in one, so once it returns false for a
given scope it stays false for that scope.

The P1-a guard after the queue read in the discard path is so
candidate for removal: the checks on either side of it already cover the
same account switch. The mutation report shows the guard is not pinned on its
own, which matches this. The collective removal of the whole set does fail,
so the set is what holds the line.

Trimming it would remove a defence-in-depth layer for a small gain in
readability, so it is left in place and recorded here.

## N4 — analysis only, no change

`persistTripMetadata` (store.ts ~2899) updates a trip row with a conditional
write:

```ts
const base = tripById(tripId)?.writeVersion
let query = supabase.from('trips').update(payload).eq('id', tripId)
if (validWriteVersion(base)) query = query.eq('write_version', base)
```

**Trigger.** The cached trip has no valid `writeVersion` (undefined, or the
column is absent because the `20261017_trip_write_version.sql` migration has
not been applied). `validWriteVersion` is false, so the `write_version`
predicate is **omitted**.

**Consequence.** The UPDATE becomes unconditional on the revision. It still
carries the trip id, so it cannot write the wrong row, and RLS still decides
whether the caller may write. The payload is narrow (`invite_code`,
`visibility`), so the write does **not** replace plan days, and it does not
lose a revision bump either: the `write_version` trigger advances the counter
on every update, so the counter still moves. The real cost is that the write
is not **conditional**. It no longer refuses to run against a server row that
moved on, so the app cannot tell a stale metadata write from a current one.
The invalid-base path does not adopt the returned revision into the cache or
into the queued baseline, because its advance expression needs an already
valid base.

**Callers.** Two: `mintInviteCode` (~1444, writes `invite_code` under a
`null` guard on the column) and the publish path (~3985, writes
`visibility: 'public'`). Both are narrow metadata writes, never a plan write.

**Why defer.** The queued plan write path (`sendQueuedTripWrite`) refuses
anything without a valid `baseVersion` and parks the copy as a conflict
("Old queue entries and an old backend need review instead of an unsafe
overwrite"). A metadata write has no queued copy and no user-visible plan to
protect, so parking it would strand a publish or an invite code with no way
out. A metadata path that refuses would break publish for every account on
a database that has not taken the migration yet, and the migration is
documented as a prerequisite that must land first.

**Recommended bounded change (not applied).** When the cached trip has no valid
`writeVersion`, read the current server revision first and use it as the
predicate, exactly as the `replace` recovery choice does
(`resolveQueuedTripWrite`, ~3123). That restores the conditional write without
changing the policy for an un-migrated database. It needs its own test and a
decision on whether the read is a second round trip, so it does not belong in
this packet.

**One rule if that change is ever applied.** The server revision must NEVER
become the baseline for an unknown pending whole-plan snapshot. A
queued plan whose baseline is unknown stays paused, and it is never rebased
from a metadata acknowledgement. The invite-code `null` predicate, the
per-trip ordering, and the identity and access guards all stay. The change
also needs a fail-closed decision for the case where the server revision
stays unavailable.
