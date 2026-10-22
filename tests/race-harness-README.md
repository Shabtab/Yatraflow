# The race harness

Six tests that hold a real await open, change the world while it is suspended,
and then read what the store did about it.

## Why the first harness could not fail

The earlier race harness flipped a field on its own mock and asserted on that
same field. Every assertion was circular: the product could stop guarding
entirely and the suite would stay green. A gate reviewer deleted the identity
re-check in `fetchTripByInviteCode` and all thirteen of its tests passed. The
harness measured the mock, not the store.

This harness measures the store. Three rules hold the difference.

1. The identity change reaches the real store. The account switch travels
   through `init()` and the Supabase auth callback, so the store's own
   `cache.sessionUserId` changes and the store's own identity epoch advances.
   A field on a mock is not an identity.
2. The assertions read what the store produced. They read the value the store
   returned, the state the store's cache holds, and the requests the store
   issued. A value the test wrote into a mock is not evidence.
3. Every test names the guard it pins, and the mutation table below records the
   scratch mutation that turns that test red.

## The shape of a race

The store enters an await. The world changes while the await is suspended. The
continuation that runs after the change is the one that shipped the bug.

No test here waits for a clock. `tests/helpers/deferred.ts` holds the await
open, and the test decides when it lands. A receipt tells the test that the
store is inside the await, so the change lands in the right place and not
beside it.

`tests/helpers/deferred.ts` already ships on `test`, and its `interleave`
helper is the one this suite uses. The older branch proposed a second helper
with a different signature, which would have collided with it. This suite
reuses the helper that ships and adds no second one.

## The contract under test

The suite reads the current contract, the one that ships after #804.

- `fetchTripByInviteCode` answers `Trip | null`, and a preview is never cached.
- `joinViaInvite` answers a `JoinResult`, and `abandoned` and `not-member` are
  two different answers to two different questions.
- The membership pre-query answers with certainty, so the store knows whether
  it may claim a join write.

## The mutation table

Each row names the guard, the scratch mutation, the test that pins it, and the
result. Every mutation was applied to `src/store/store.ts`, the suite was run,
and the file was restored from the in-memory original. `git diff` was empty
after all six.

| Guard | Scratch mutation | Test | Result |
| --- | --- | --- | --- |
| `fetchTripByInviteCode`: identity re-check after the invite RPC await | delete the re-check | a preview that resolves after the account changed is refused | red |
| `fetchTripByInviteCode`: the positive return of the preview row | return `null` instead of the row | a preview that resolves for the same account is returned | red |
| `joinAfterScope`: identity re-check after the membership pre-query | drop the re-check | a join whose membership pre-query answers after the account changed is abandoned | red |
| `admitFullRow`: the membership check that refuses a full row | stop the check from firing | a join whose full-row read answers after the membership was revoked reports not-member | red |
| `admitFullRow`: the same line, the other side | make the check always fire | a join whose membership is intact reports joined and admits the row | red |
| `init`: the auth callback that publishes the new account | hydrate nobody | the store really changed its session account on the switch | red |

Each mutation failed exactly one test and left the other five green. To repeat
a check, apply the mutation to a scratch copy and run the test file.

## How to run it

```sh
npx vitest run tests/race-identity-continuation.test.ts
```

The suite mocks one module, `src/lib/supabase`. Everything else is the real
store, reached through `init()` and the auth callback. The mock answers reads
as the server would: it filters rows by the filters the store wrote, and it
holds a named read open until the test releases it.
