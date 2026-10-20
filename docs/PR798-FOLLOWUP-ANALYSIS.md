# PR798 follow-up — analysis notes (MiniMax lane)

Base: `origin/test` @ `90d3f4b4` (PR #798 merge).
Branch: `codex/t3-pr798-followup-mm-cline`.

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
owner/editor role. A demoted user therefore lost the download action for a
copy that was still on their own device.

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
  owner** only. A live edit role is no longer required: the copy is already on
  that device. The shared trip's name is used for the title only when the
  account can read that trip; the queued snapshot's own name is never shown.
- A copy that is not exportable shows an accurate line and no Download button,
  so the banner never promises an action it cannot perform.
- The banner counts a reasoned copy as "kept on this device", not as "waiting
  to sync", because it will not sync on its own.

### Scope held

Only the four paths the brief names keep the copy: the membership branch, the
missing/deleted branch, hydrate cleanup, and the realtime tombstones. The
explicit `deleteTrip`, `trashTrip` and the `discard` recovery choice still drop
the copy, because the account asked for that.

Residual, not fixed here: `trashTrip` drops the copy before the trash write
runs, so a **failed** trash write loses the queued copy. That is pre-existing
and outside the four named paths.

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
whether the caller may write. But it can **overwrite a collaborator's newer
plan**: the metadata payload is narrow (`invite_code`, `visibility`), so the
lost update is a lost *revision bump*, not a lost plan. The `write_version`
trigger advances the counter on every update, so the counter still moves.

**Callers.** Two: `mintInviteCode` (~1444, writes `invite_code` under a
`null` guard on the column) and the publish path (~3985, writes
`visibility: 'public'`). Both are narrow metadata writes, never a plan write.

**Why defer.** The queued plan write path (`sendQueuedTripWrite`) refuses
anything without a valid `baseVersion` and parks the copy as a conflict
("Old queue entries and an old backend need review instead of an unsafe
overwrite"). A metadata write has no queued copy and no user-visible plan to
protect, so parking it would strand a publish or an invite code with no way
out. Making the metadata path refuse would break publish for every account on
a database that has not taken the migration yet, and the migration is
documented as a prerequisite that must land first.

**Recommended bounded change (not applied).** When the cached trip has no valid
`writeVersion`, read the current server revision first and use it as the
predicate, exactly as the `replace` recovery choice does
(`resolveQueuedTripWrite`, ~3123). That restores the conditional write without
changing the policy for an un-migrated database. It needs its own test and a
decision on whether the read is a second round trip, so it does not belong in
this packet.
