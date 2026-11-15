import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  viewer: 'viewer' as string | null,
  data: null as unknown,
  error: null as unknown,
  calls: [] as Array<[string, unknown]>,
}))
vi.mock('../src/store/store', () => ({ currentUser: () => state.viewer ? { id: state.viewer } : null }))
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      state.calls.push(['from', table])
      const query = {
        select: (columns: string) => { state.calls.push(['select', columns]); return query },
        insert: (row: unknown) => { state.calls.push(['insert', row]); return query },
        delete: () => { state.calls.push(['delete', null]); return query },
        eq: (key: string, value: unknown) => { state.calls.push([key, value]); return query },
        single: () => query,
        abortSignal: () => query,
        then: (resolve: (result: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data: state.data, error: state.error }).then(resolve),
      }
      return query
    },
    rpc: (name: string, args: unknown) => {
      state.calls.push([name, args])
      return { abortSignal: async () => ({ data: state.data, error: state.error }) }
    },
  },
}))

import { creatorFollowerCount, creatorFollowerCountLabel, followCreator, getCreatorFollowerCount, isFollowing, unfollowCreator } from '../src/lib/creatorFollows'
const signal = new AbortController().signal

beforeEach(() => { state.viewer = 'viewer'; state.data = null; state.error = null; state.calls = [] })

describe('YatraFlow follows', () => {
  it('shows a failed follower count as Unavailable', () => {
    expect(creatorFollowerCountLabel({ kind: 'failed' })).toBe('Unavailable')
    expect(creatorFollowerCountLabel({ kind: 'ready', value: 0 })).toBe('0')
    expect(creatorFollowerCountLabel({ kind: 'reading' })).toBe('Loading…')
  })
  it('accepts an existing follow after a duplicate insert', async () => {
    state.error = { code: '23505', message: 'duplicate key' }
    await expect(followCreator('creator', signal)).resolves.toBeUndefined()
    state.error = null
    state.data = [{ follower: 'viewer', creator: 'creator' }]
    expect(await isFollowing('creator', signal)).toBe(true)
  })
  it('reads only the signed-in account row, never a follower list', async () => {
    state.data = [{ follower: 'viewer', creator: 'creator' }]
    expect(await isFollowing('creator', signal)).toBe(true)
    expect(state.calls).toContainEqual(['follower', 'viewer'])
    expect(state.calls).toContainEqual(['creator', 'creator'])
    state.data = []
    expect(await isFollowing('creator', signal)).toBe(false)
  })
  it('rejects failed or malformed status reads instead of claiming not followed', async () => {
    for (const data of [null, {}, [{ follower: 'other', creator: 'creator' }], [{ follower: 'viewer', creator: 'other' }]]) {
      state.data = data
      await expect(isFollowing('creator', signal)).rejects.toThrow()
    }
    state.data = []
    state.error = new Error('offline')
    await expect(isFollowing('creator', signal)).rejects.toThrow('offline')
  })
  it('writes the own row and checks the accepted insert', async () => {
    state.data = { follower: 'viewer', creator: 'creator' }
    await followCreator('creator', signal)
    expect(state.calls).toContainEqual(['insert', { follower: 'viewer', creator: 'creator' }])
    state.data = null
    await expect(followCreator('creator', signal)).rejects.toThrow('not saved')
  })
  it('filters both keys when removing the own follow', async () => {
    await unfollowCreator('creator', signal)
    expect(state.calls).toContainEqual(['delete', null])
    expect(state.calls).toContainEqual(['follower', 'viewer'])
    expect(state.calls).toContainEqual(['creator', 'creator'])
    state.error = new Error('refused')
    await expect(unfollowCreator('creator', signal)).rejects.toThrow('refused')
    await expect(followCreator('creator', signal)).rejects.toThrow('refused')
  })
  it('rejects self-follow and signed-out operations before a request', async () => {
    for (const viewer of [null, 'creator']) {
      state.viewer = viewer
      await expect(followCreator('creator', signal)).rejects.toThrow()
      await expect(unfollowCreator('creator', signal)).rejects.toThrow()
      await expect(isFollowing('creator', signal)).rejects.toThrow()
    }
    expect(state.calls).toEqual([])
  })
  it('reads the public count RPC without querying identities', async () => {
    state.viewer = null
    state.data = '42'
    expect(await getCreatorFollowerCount('creator', signal)).toBe(42)
    expect(state.calls).toEqual([['get_creator_follower_count', { p_creator: 'creator' }]])
    state.error = new Error('missing RPC')
    await expect(getCreatorFollowerCount('creator', signal)).rejects.toThrow('missing RPC')
  })
  it('accepts a real zero and refuses invalid counts', () => {
    expect(creatorFollowerCount(0, null)).toBe(0)
    for (const value of [null, undefined, '', ' ', '1.2', -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, false]) {
      expect(() => creatorFollowerCount(value, null)).toThrow()
    }
  })
})
