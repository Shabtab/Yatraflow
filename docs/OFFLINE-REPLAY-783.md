# Offline replay, conflicts, and account isolation

Issue: [#783](https://github.com/hasnaina955/Yatraflow/issues/783).
Audit date: 2026-10-17. Base: `origin/test`, commit `9760ea2`.

## Scope and evidence

This change covers the existing whole-trip queue and its recovery surface.
It preserves the 600 ms debounce and per-trip ordering from #549.
It adds no merge engine, external analytics, or new identity store.

The evidence below comes from deterministic transport tests and an isolated PostgreSQL database.
Production data, production policies, and signed-in browser journeys remain unverified.
This environment has no Supabase project variables or disposable test account.
No production events, records, migrations, or deployments were created.

## Audit

| Area | Baseline finding | Resolution and evidence |
| --- | --- | --- |
| Whole-trip snapshots and ordering | Verified existing. One latest snapshot per trip; sends already shared a trip tail. | Reused. [Serialization tests](../tests/trip-write-serialization.test.ts) still verify older acknowledgements cannot clear newer edits. |
| Queue ownership | Confirmed gap. The disk key contained only the trip ID. | Keys now include account and trip. [Queue tests](../tests/write-queue.test.ts) cover two accounts editing the same trip. |
| Edit identity | Confirmed gap. Capture time alone identified a queue generation. | Random local revisions distinguish edits. Same-millisecond cases cover retry and cleanup. |
| Queue durability | Confirmed gap. Request success preceded transaction commit; unavailable storage could report success. | [Durability tests](../tests/offline-idb-durability.test.ts) cover abort, quota, blocked open, and transaction completion. |
| Restart recovery | Confirmed gap. Hydration did not overlay the latest queued plan. | [Replay tests](../tests/offline-replay-protocol.test.ts) restart the store, restore edits, reconnect, and verify server-model contents. Deleted stops stay deleted. |
| Conflicts | Confirmed gap. Timestamp comparison allowed automatic whole-plan replacement. | Server revision checks pause changed or unknown baselines. Explicit replacement remains conditional on the latest observed revision. |
| Retry exhaustion | Confirmed gap. The third failed replay deleted the saved edit. | Three failed sends pause it. Retry and download remain available. No failure path reports a successful sync. |
| Account transitions | Confirmed gap. Several awaited callbacks could act after an identity change. | [Identity tests](../tests/offline-identity-boundaries.test.ts) cover stale hydration, cached boot, replay, resync, and trip fetches. |
| Request identity | Confirmed gap. The SDK can await token acquisition after the last client guard. | Requests pin the captured account's Authorization header. [SDK test](../tests/offline-auth-header.test.ts) uses the installed client with a local fetch stub. |
| Membership changes | Confirmed gap. Delayed fetches and cleanup could cross a revoke/grant boundary. | Permission generations cancel stale callbacks. Revoked work is removed; a fresh grant starts a separate generation. |
| Deletion | Confirmed gap. Echo suppression and pending overlays could hide removal. | Deletes and tombstones cancel pending work before ordinary realtime guards. |
| Recovery UI | Missing. Online conflicts and exhausted retries had no persistent action surface. | [OfflineBanner](../src/components/OfflineBanner.tsx) shows recovery choices. [Render tests](../tests/offline-recovery-ui.test.ts) cover privacy, controls, and motion. |
| Live database and device journey | Unverified. Credentials and a test account are unavailable. | Follow the staging procedure below before deployment. |

The nine identity regressions failed against the original code before their fixes.
The PostgreSQL harness separately proves the database revision contract.
Transport fixtures model permission checks; they do not replace production RLS verification.

## Current queue policy

- `persistTripField` captures the plan and starts storage before the debounce timer.
- There is one latest snapshot per account and trip, including shared trips.
- `capturedAt` orders work. It does not determine whether a server plan changed.
- `revision` identifies the exact local edit for conditional updates and removal.
- `baseVersion` records the server revision that this plan includes.
- IndexedDB database version 3 migrates existing queue keys atomically.
- Legacy entries without a known server baseline need an explicit recovery choice.
- Each trip has one send tail per identity generation.
- Replay rereads the current queued revision inside that tail.
- Membership, account, and trip access are checked before and after awaited work.
- A send needs current owner/editor access, or the existing administrator exception.
- The server update filters both trip ID and `write_version`.
- Exactly one returned row, with a higher valid revision, proves acceptance.
- A zero-row or malformed acknowledgement pauses as a conflict.
- Transport or policy errors increment the failure count.
- Three failed sends pause automatic retries. A manual retry resets that count.
- A later local edit can receive a fresh retry budget. Conflict state stays paused.
- Signing out clears the departing account's queue, snapshots, timers, and private cache.

Source: [writeQueue](../src/lib/writeQueue.ts), [offlineCache](../src/lib/offlineCache.ts),
and [store](../src/store/store.ts).

### Conflicts and recovery

There is no automatic field merge.
The local plan stays visible while its queued copy waits for review.
The server plan stays unchanged until an explicit replacement passes its revision check.

| Action | Effect |
| --- | --- |
| Download my copy | Downloads the local plan after a fresh account and membership check. Keep the file private. |
| Use shared plan | Removes the selected local edit and reads the shared plan. A newer local edit is preserved. |
| Replace shared plan | Reads a current baseline, then tries one conditional whole-plan replacement. Another concurrent edit still causes a conflict. |
| Retry | Resets failed-send state and tries again. It cannot approve a conflict implicitly. |
| Check sync | Refreshes membership and server state, then attempts eligible replay. Paused edits remain visible. |

Recovery choices use the same trip tail as ordinary sends.
Late hydration cannot replace a higher acknowledged server revision.
Invite-code metadata uses conditional writes and rebases only its own proven changes.
Trash cancels old work. Undo reads the restored server row before later edits use it.

### Storage limits

Only transaction completion proves an edit will survive restart.
If storage fails, the live tab keeps a memory copy and shows a warning.
Keep the tab open and download the copy before closing it.
A failed durable deletion cannot claim success. The live tab pauses any older disk copy it finds.
Concurrent newer edits survive cleanup of an older revision.

Clearing all browser data removes durable offline recovery.
A fresh boot must not recreate queue entries from an old account snapshot.
Disconnected devices cannot learn remote membership revocation until they reconnect.
An already transmitted request may finish under its captured account token.
Its stale callback cannot update the next account's cache.
Server RLS still decides whether the request may write.

## Database contract

Apply [20261017_trip_write_version.sql](../supabase/migrations/20261017_trip_write_version.sql) before the app update.
The same SQL appears verbatim in [schema.sql](../supabase/schema.sql).

The additive migration creates `trips.write_version` and a server sequence.
Existing rows start at zero. Each insert and update receives a fresh revision.
Deleting and reinserting the same UUID cannot reuse an earlier revision.
Client payloads cannot choose, reset, or preserve a revision.

The trigger has one privileged operation: assigning the next sequence value.
It reads and writes no other application records.
Sequence and trigger-function access remain revoked from application roles.
Existing table grants, membership policies, and RLS remain unchanged.

Rerunning the migration preserves row revisions and never moves the sequence backward.
The migration takes a table lock while aligning its sequence.
Use a maintenance window suitable for that lock.
After restoring a database backup, rerun this migration before accepting writes.
This aligns the sequence above any restored revisions.

Old clients also advance the revision through the trigger.
They can still perform their previous unconditional writes.
The updated client detects those changes; this migration cannot retrofit old client conflict UI.
Without the migration, new guarded writes fail safely and remain recoverable.
Do not deploy the app first.

## Local verification

Run the repository gate:

```sh
npm run verify
```

Run the isolated database checks:

```sh
node scripts/integration/trip-write-version-db.mjs
```

The harness uses PostgreSQL 17 in a disposable Docker container.
It publishes no ports and has no network access.
It accepts no remote database URL and removes its container after completion.
It checks stale and repeated sends, forged revisions, sequence permissions, and same-ID restore.
It also applies the migration repeatedly and simulates restored higher revisions.

Focused regression files:

- `tests/offline-replay-protocol.test.ts`
- `tests/offline-identity-boundaries.test.ts`
- `tests/offline-idb-durability.test.ts`
- `tests/offline-key-upgrade.test.ts`
- `tests/offline-snapshot-order.test.ts`
- `tests/offline-auth-header.test.ts`
- `tests/offline-recovery-ui.test.ts`
- `tests/trip-write-version-migration.test.ts`
- Existing queue, cache, serialization, settings, hydration, and session tests.

## Staging and device verification

Use disposable accounts A, B, and C in a staging project.
Do not use customer trips or log invitation codes, tokens, or trip contents.
Keep all migration and device checks separate from production until reviewed.

1. Apply the migration to staging. Run `npm run check:migrations` with staging project variables.
2. Create a trip as A. Add C as an editor. Record its revision through an authorized read.
3. Disconnect A. Edit two stops, then delete one. Reload the installed app while offline.
4. Confirm the latest local plan appears. Reconnect and read the authorized server record.
5. Confirm all latest edits exist once and the deleted stop remains absent.
6. Disconnect A again. Save a local edit. Have C change the same shared trip online.
7. Reconnect A. Confirm a conflict appears and C's server plan stays unchanged.
8. Download A's copy. Choose Use shared plan. Confirm both the cache and reload show C's plan.
9. Repeat the conflict. Choose Replace shared plan while C makes another edit.
10. Confirm a changed revision blocks replacement. Repeat without another edit and confirm one accepted replacement.
11. Reject three sends in the staging transport. Confirm the edit remains visible with retry and download actions.
12. Restore access. Retry once. Confirm one accepted server revision and removal of only that queued edit.
13. Hold a replay request. Sign out A and sign in B. Release the response.
14. Confirm B never sees A's private cache, recovery titles, or downloaded plan.
15. Repeat while C removes A's membership. Confirm pending replay cannot write or restore the removed trip.
16. Reinvite A. Confirm stale removal callbacks cannot delete A's newly captured edit.
17. Clear browser data with pending work. Sign in as B. Confirm A's offline plan does not reappear.
18. Block IndexedDB storage. Confirm the warning appears and download works before closing the tab.
19. Check recovery on a phone width, both themes, keyboard navigation, and reduced motion.

Record browser, app build, staging migration state, and observed results with the release review.
Mark failed or unrun checks separately. Local transport tests do not establish device completion.
