// ============ Deferred promises and explicit interleavings ============
// #804 needs to pause a REAL await inside the product, change the world while it
// is suspended, and only then let it continue. A test that merely awaits a
// promise can never reach that window, which is why earlier rounds could not see
// the account switch.
//
// Nothing here sleeps. A deferred settles only when the test says so, and
// `flush` runs the microtask queue until the continuation has finished.

export interface Deferred<T> {
  /** What the code under test awaits. */
  readonly promise: Promise<T>
  /** True once the promise has settled. A second settle is ignored. */
  readonly settled: () => boolean
  resolve(value: T | PromiseLike<T>): void
  reject(reason: unknown): void
}

/** Create a promise that stays pending until the test settles it. */
export function createDeferred<T = void>(): Deferred<T> {
  let resolveFn!: (value: T | PromiseLike<T>) => void
  let rejectFn!: (reason: unknown) => void
  let done = false
  const promise = new Promise<T>((res, rej) => {
    resolveFn = (value) => {
      if (done) return
      done = true
      res(value)
    }
    rejectFn = (reason) => {
      if (done) return
      done = true
      rej(reason)
    }
  })
  // An unobserved rejection is a node warning and, under some runners, a failure.
  promise.catch(() => {})
  return { promise, settled: () => done, resolve: resolveFn, reject: rejectFn }
}

/**
 * Run the continuations unlocked by a settlement.
 * A resolved promise does not run its continuation synchronously, so a test that
 * asserts immediately would read the pre-await state.
 */
export async function flush(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await Promise.resolve()
  }
}

/**
 * Wait for a receipt, change the world, then settle the held await.
 * `receipt` resolves when the code under test has actually entered the await;
 * waiting on it is the ordering proof, and no timer is involved.
 */
export async function interleave(
  receipt: Promise<unknown>,
  before: () => void | Promise<void>,
  held: Deferred<unknown>,
): Promise<void> {
  await receipt
  await before()
  held.resolve(undefined)
  await flush()
}
