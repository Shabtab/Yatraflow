import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatorFollowApi } from '../src/lib/creatorFollows'

const runtime = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  deps: [] as unknown[][],
  pending: [] as (() => void)[],
  cleanups: [] as (void | (() => void))[],
}))
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = runtime.cursor++
    if (!(index in runtime.slots)) runtime.slots[index] = initial
    return [runtime.slots[index], (next: unknown) => {
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
})
afterEach(() => runtime.cleanups.forEach(cleanup => cleanup?.()))

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
    expect(render(api).following.kind).toBe('reading')
    await settle()
    const recovered = render(api)
    expect(recovered.following).toEqual({ kind: 'ready', value: !initiallyFollowing })
    expect(recovered.count).toEqual({ kind: 'ready', value: initiallyFollowing ? 0 : 1 })
    expect(recovered.busy).toBe(false)
    expect(api.isFollowing).toHaveBeenCalledTimes(2)
    expect(api.count).toHaveBeenCalledTimes(2)
  })
})
