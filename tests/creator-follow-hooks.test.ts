import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatorFollowApi } from '../src/lib/creatorFollows'

const runtime = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  deps: [] as unknown[][],
  pending: [] as (() => void)[],
  cleanups: [] as (void | (() => void))[],
  updates: vi.fn(),
}))
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = runtime.cursor++
    if (!(index in runtime.slots)) runtime.slots[index] = initial
    return [runtime.slots[index], (next: unknown) => {
      runtime.updates(index)
      runtime.slots[index] = typeof next === 'function' ? next(runtime.slots[index]) : next
    }]
  },
  useRef(initial: unknown) {
    const index = runtime.cursor++
    if (!(index in runtime.slots)) runtime.slots[index] = { current: initial }
    return runtime.slots[index]
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = runtime.cursor++
    if (!runtime.deps[index] || deps.some((value, key) => !Object.is(value, runtime.deps[index][key]))) {
      runtime.deps[index] = deps
      runtime.pending.push(() => {
        runtime.cleanups[index]?.()
        runtime.cleanups[index] = effect()
      })
    }
  },
}))
vi.mock('../src/store/store', () => ({ currentUser: () => ({ id: 'viewer' }) }))

import { useCreatorFollows } from '../src/hooks/useCreatorFollows'

function render(api: CreatorFollowApi) {
  runtime.cursor = 0
  const result = useCreatorFollows('creator', 'viewer', api)
  runtime.pending.splice(0).forEach(effect => effect())
  return result
}
const settle = () => new Promise(resolve => setImmediate(resolve))

beforeEach(() => {
  runtime.slots = []; runtime.deps = []; runtime.cleanups = []; runtime.pending = []
  runtime.updates.mockClear()
})
afterEach(() => {
  runtime.cleanups.forEach(cleanup => cleanup?.())
  vi.useRealTimers()
})

describe('follow write recovery', () => {
  it.each([false, true])('refreshes server truth when a write commits then times out, initially following %s', async initiallyFollowing => {
    let serverFollowing = initiallyFollowing
    const commitThenTimeout = async () => {
      serverFollowing = !serverFollowing
      throw new Error('timeout')
    }
    const api: CreatorFollowApi = {
      count: vi.fn(async () => serverFollowing ? 1 : 0),
      isFollowing: vi.fn(async () => serverFollowing),
      follow: vi.fn(commitThenTimeout),
      unfollow: vi.fn(commitThenTimeout),
    }
    render(api)
    await settle()
    const initial = render(api)
    expect(initial.following).toEqual({ kind: 'ready', value: initiallyFollowing })
    await initial.toggle()
    const refreshing = render(api)
    expect(refreshing.following.kind).toBe('reading')
    expect(refreshing.error).toBe('Follow change not saved. Try again.')
    await settle()
    const recovered = render(api)
    expect(recovered.following).toEqual({ kind: 'ready', value: !initiallyFollowing })
    expect(recovered.count).toEqual({ kind: 'ready', value: initiallyFollowing ? 0 : 1 })
    expect(recovered.busy).toBe(false)
    expect(recovered.error).toBeNull()
    expect(api.isFollowing).toHaveBeenCalledTimes(2)
    expect(api.count).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('keeps the error when the refresh returns the old value, initially following %s', async initiallyFollowing => {
    const api: CreatorFollowApi = {
      count: vi.fn(async () => initiallyFollowing ? 1 : 0),
      isFollowing: vi.fn(async () => initiallyFollowing),
      follow: vi.fn(async () => { throw new Error('timeout') }),
      unfollow: vi.fn(async () => { throw new Error('timeout') }),
    }
    render(api)
    await settle()
    await render(api).toggle()
    render(api)
    await settle()
    const recovered = render(api)
    expect(recovered.following).toEqual({ kind: 'ready', value: initiallyFollowing })
    expect(recovered.error).toBe('Follow change not saved. Try again.')
  })
})

describe('follow read lifecycle', () => {
  it('fails both reads after ten seconds without a response and aborts their signals', async () => {
    vi.useFakeTimers()
    const api: CreatorFollowApi = {
      count: vi.fn(() => new Promise<number>(() => {})),
      isFollowing: vi.fn(() => new Promise<boolean>(() => {})),
      follow: vi.fn(), unfollow: vi.fn(),
    }
    const initial = render(api)
    expect(initial.count.kind).toBe('reading')
    expect(initial.following.kind).toBe('reading')
    await vi.advanceTimersByTimeAsync(9_999)
    expect(render(api).count.kind).toBe('reading')
    expect(render(api).following.kind).toBe('reading')
    await vi.advanceTimersByTimeAsync(1)
    const expired = render(api)
    expect(expired.count.kind).toBe('failed')
    expect(expired.following.kind).toBe('failed')
    expect(vi.mocked(api.count).mock.calls[0][1].aborted).toBe(true)
    expect(vi.mocked(api.isFollowing).mock.calls[0][1].aborted).toBe(true)
  })

  it.each(['resolve', 'reject'])('aborts on unmount and ignores late read %s callbacks', async outcome => {
    vi.useFakeTimers()
    const count = Promise.withResolvers<number>()
    const following = Promise.withResolvers<boolean>()
    const api: CreatorFollowApi = {
      count: vi.fn(() => count.promise),
      isFollowing: vi.fn(() => following.promise),
      follow: vi.fn(), unfollow: vi.fn(),
    }
    render(api)
    runtime.cleanups.splice(0).forEach(cleanup => cleanup?.())
    expect(vi.mocked(api.count).mock.calls[0][1].aborted).toBe(true)
    expect(vi.mocked(api.isFollowing).mock.calls[0][1].aborted).toBe(true)
    runtime.updates.mockClear()
    if (outcome === 'resolve') { count.resolve(1); following.resolve(true) }
    else { count.reject(new Error('aborted')); following.reject(new Error('aborted')) }
    await vi.advanceTimersByTimeAsync(10_000)
    expect(runtime.updates).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
