// ============ Presence pure-state tests (M6 · B1) ============
// The channel wiring is integration-tested (a presence round-trip needs a
// second live session — see scripts/integration/); these pin the reducer the
// channel callbacks run: join/leave/replace, one-avatar-per-user, stable
// ordering, and hostile sync payloads.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
// The serializer that builds the snapshot presenceState() returns. Imported
// from the SDK this repo installs, so the contract test runs the real code.
import PresenceAdapter from '@supabase/realtime-js/dist/module/phoenix/presenceAdapter.js'
import {
  reducePresence, removePresence, presenceFromSync, visiblePeers,
  presenceChannelName, presenceKey, presencePayload, EMPTY_PRESENCE, presenceView,
} from '../src/lib/presence'

describe('reducePresence', () => {
  it('adds a peer', () => {
    const s = reducePresence(EMPTY_PRESENCE, 'u1:aaa', { userId: 'u1', name: 'Amelia' }, 100)
    expect(s.peers).toEqual([{ sessionKey: 'u1:aaa', userId: 'u1', name: 'Amelia', joinedAt: 100 }])
  })

  it('replaces the SAME session in place (refresh/rejoin) without reshuffling others', () => {
    let s = reducePresence(EMPTY_PRESENCE, 'u1:aaa', { userId: 'u1', name: 'Amelia' }, 100)
    s = reducePresence(s, 'u2:bbb', { userId: 'u2', name: 'Ravi' }, 200)
    s = reducePresence(s, 'u1:aaa', { userId: 'u1', name: 'Amelia' }, 300)
    expect(s.peers.map(p => p.sessionKey)).toEqual(['u2:bbb', 'u1:aaa'])
    expect(s.peers.find(p => p.sessionKey === 'u1:aaa')?.joinedAt).toBe(300)
  })

  it('ignores malformed input (empty key or userId)', () => {
    expect(reducePresence(EMPTY_PRESENCE, '', { userId: 'u1', name: 'x' }, 1)).toBe(EMPTY_PRESENCE)
    expect(reducePresence(EMPTY_PRESENCE, 'k', { userId: '', name: 'x' }, 1)).toBe(EMPTY_PRESENCE)
  })
})

describe('removePresence', () => {
  it('removes exactly one session', () => {
    let s = reducePresence(EMPTY_PRESENCE, 'u1:aaa', { userId: 'u1', name: 'A' }, 1)
    s = reducePresence(s, 'u2:bbb', { userId: 'u2', name: 'B' }, 2)
    s = removePresence(s, 'u1:aaa')
    expect(s.peers.map(p => p.sessionKey)).toEqual(['u2:bbb'])
  })

  it('is a no-op for an unknown key', () => {
    const s = reducePresence(EMPTY_PRESENCE, 'u1:aaa', { userId: 'u1', name: 'A' }, 1)
    expect(removePresence(s, 'nope')).toEqual(s)
  })
})

describe('one avatar per user (dedupe)', () => {
  it('collapses two sessions of one user to the OLDEST join', () => {
    let s = reducePresence(EMPTY_PRESENCE, 'u1:aaa', { userId: 'u1', name: 'A' }, 100)
    s = reducePresence(s, 'u1:zzz', { userId: 'u1', name: 'A' }, 200)
    expect(s.peers).toHaveLength(1)
    expect(s.peers[0].sessionKey).toBe('u1:aaa')
    expect(s.peers[0].joinedAt).toBe(100)
  })

  it('keeps the oldest session when the second tab joined first (order-stable)', () => {
    let s = reducePresence(EMPTY_PRESENCE, 'u1:zzz', { userId: 'u1', name: 'A' }, 200)
    s = reducePresence(s, 'u1:aaa', { userId: 'u1', name: 'A' }, 100)
    expect(s.peers[0].sessionKey).toBe('u1:aaa')
  })
})

describe('ordering', () => {
  it('sorts by joinedAt asc, ties by userId (stable across re-syncs)', () => {
    let s = reducePresence(EMPTY_PRESENCE, 'u3:c', { userId: 'u3', name: 'C' }, 30)
    s = reducePresence(s, 'u1:a', { userId: 'u1', name: 'A' }, 10)
    s = reducePresence(s, 'u2:b', { userId: 'u2', name: 'B' }, 20)
    s = reducePresence(s, 'u4:d', { userId: 'u4', name: 'D' }, 10)
    expect(s.peers.map(p => p.userId)).toEqual(['u1', 'u4', 'u2', 'u3'])
  })
})

// The wire shape the installed SDK produces: a map of session key to a LIST of
// records. Each record carries the broadcast payload and the SDK's presence_ref.
// Field values cross the wire, so they are not ours to trust.
const sdkSnapshot = {
  'u1:aaa': [{ userId: 'u1', name: 'Amelia', joinedAt: 5, presence_ref: 'F1' }],
  'u2:bbb': [{ userId: 'u2', name: 'Ravi', joinedAt: 3, presence_ref: 'F2' }],
}

describe('presenceFromSync — the real SDK snapshot shape', () => {
  it('keeps every peer when each key holds a list of records', () => {
    const s = presenceFromSync(sdkSnapshot)
    expect(s.peers.map(p => p.userId)).toEqual(['u2', 'u1'])
    expect(s.peers.map(p => p.sessionKey)).toEqual(['u2:bbb', 'u1:aaa'])
    expect(s.peers[1]).toEqual({ sessionKey: 'u1:aaa', userId: 'u1', name: 'Amelia', joinedAt: 5 })
  })

  it('treats an empty snapshot as an empty room', () => {
    expect(presenceFromSync({})).toEqual(EMPTY_PRESENCE)
    expect(presenceFromSync({ 'u1:aaa': [] })).toEqual(EMPTY_PRESENCE)
  })

  it('treats a snapshot that is not a map of lists as empty', () => {
    expect(presenceFromSync(null)).toBe(EMPTY_PRESENCE)
    expect(presenceFromSync(undefined)).toBe(EMPTY_PRESENCE)
    expect(presenceFromSync('nope')).toBe(EMPTY_PRESENCE)
    expect(presenceFromSync([{ userId: 'u1' }])).toBe(EMPTY_PRESENCE)
  })

  it('collapses records under one key to one avatar per user', () => {
    const s = presenceFromSync({
      'u1:aaa': [
        { userId: 'u1', name: 'Amelia', joinedAt: 100, presence_ref: 'F1' },
        { userId: 'u1', name: 'Amelia', joinedAt: 200, presence_ref: 'F2' },
      ],
    })
    expect(s.peers).toEqual([{ sessionKey: 'u1:aaa', userId: 'u1', name: 'Amelia', joinedAt: 100 }])
  })

  it('keeps two different users that share one key', () => {
    const s = presenceFromSync({
      shared: [
        { userId: 'u1', name: 'Amelia', joinedAt: 1 },
        { userId: 'u2', name: 'Ravi', joinedAt: 2 },
      ],
    })
    expect(s.peers.map(p => p.userId)).toEqual(['u1', 'u2'])
  })

  it('skips hostile records instead of crashing (wire payloads are not ours to trust)', () => {
    const hostile: Record<string, unknown> = {
      bad1: [null, 42, 'text', []],
      bad2: [{ name: 'no id' }, { userId: 42 }, {}],
      empty: [],
      '': [{ userId: 'ghost', name: 'Ghost' }],
      flat: { userId: 'u1', name: 'A' },
      ok: [{ userId: 'u9', name: 'A', joinedAt: 'not-a-number' }],
    }
    const s = presenceFromSync(hostile)
    expect(s.peers).toHaveLength(1)
    expect(s.peers[0]).toEqual({ sessionKey: 'ok', userId: 'u9', name: 'A', joinedAt: 0 })
  })

  it('falls back to the userId when the name is missing or empty', () => {
    const s = presenceFromSync({ 'u9:k': [{ userId: 'u9', joinedAt: 1, name: '' }] })
    expect(s.peers[0].name).toBe('u9')
  })

  it('replaces stale membership on a full resync', () => {
    const before = presenceFromSync(sdkSnapshot)
    const after = presenceFromSync({ 'u2:bbb': sdkSnapshot['u2:bbb'] })
    expect(before.peers).toHaveLength(2)
    expect(after.peers.map(p => p.userId)).toEqual(['u2'])
  })

  it('drops a peer that left between two syncs', () => {
    const two = presenceFromSync({
      'u1:a': [{ userId: 'u1', name: 'A', joinedAt: 1 }],
      'u2:b': [{ userId: 'u2', name: 'B', joinedAt: 2 }],
    })
    const one = presenceFromSync({ 'u1:a': [{ userId: 'u1', name: 'A', joinedAt: 1 }] })
    expect(two.peers).toHaveLength(2)
    expect(one.peers.map(p => p.userId)).toEqual(['u1'])
  })

  it('filters the caller out of a real snapshot and keeps the others', () => {
    const s = presenceFromSync(sdkSnapshot)
    expect(visiblePeers(s, 'u1:aaa').map(p => p.userId)).toEqual(['u2'])
    const solo = presenceFromSync({ 'u1:aaa': sdkSnapshot['u1:aaa'] })
    expect(presenceView(visiblePeers(solo, 'u1:aaa'), true)).toEqual({ kind: 'solo' })
  })
})

describe('presenceFromSync × the installed SDK serializer', () => {
  // The serializer is the code that builds what presenceState() returns. Its
  // real output is the input this parser must keep. A hand-built fixture
  // cannot stand in for it.
  const rawTwoUsers = {
    'u1:aaa': { metas: [{ phx_ref: 'F1', userId: 'u1', name: 'Amelia', joinedAt: 5 }] },
    'u2:bbb': { metas: [{ phx_ref: 'F2', userId: 'u2', name: 'Ravi', joinedAt: 3 }] },
  }

  it('keeps the peers the installed SDK serializer emits', () => {
    const snapshot = PresenceAdapter.transformState(rawTwoUsers)
    expect(Array.isArray(snapshot['u1:aaa'])).toBe(true)
    expect(snapshot['u1:aaa'][0]).toMatchObject({ userId: 'u1', name: 'Amelia', joinedAt: 5 })
    expect(presenceFromSync(snapshot).peers.map(p => p.userId)).toEqual(['u2', 'u1'])
  })

  it('keeps a second record the SDK holds under one key', () => {
    const snapshot = PresenceAdapter.transformState({
      'u1:aaa': { metas: [
        { phx_ref: 'F1', userId: 'u1', name: 'Amelia', joinedAt: 100 },
        { phx_ref: 'F2', userId: 'u1', name: 'Amelia', joinedAt: 200 },
      ] },
    })
    const s = presenceFromSync(snapshot)
    expect(s.peers).toHaveLength(1)
    expect(s.peers[0].joinedAt).toBe(100)
  })

  it('drops a meta that carries no usable payload', () => {
    const snapshot = PresenceAdapter.transformState({ 'u1:aaa': { metas: [{ phx_ref: 'F1' }] } })
    expect(presenceFromSync(snapshot).peers).toEqual([])
  })
})

describe('presenceFromSync × the installed SDK serializer — malformed joinedAt', () => {
  // JSON can carry an object whose toString and valueOf are both null.
  // The SDK serializer keeps that value. A global coercion throws on it.
  const hostileJoinedAt = { toString: null, valueOf: null }

  it('keeps the good peer and does not abort when a bad joinedAt arrives', () => {
    const snapshot = PresenceAdapter.transformState({
      bad: { metas: [{ phx_ref: 'bad-ref', userId: 'bad', name: 'Bad', joinedAt: hostileJoinedAt }] },
      good: { metas: [{ phx_ref: 'good-ref', userId: 'good', name: 'Good', joinedAt: 1 }] },
    })
    // The serializer passes the malformed field through as-is.
    expect(Array.isArray(snapshot.bad)).toBe(true)
    expect(snapshot.bad[0].joinedAt).toEqual({ toString: null, valueOf: null })
    expect(presenceFromSync(snapshot).peers).toEqual([
      { sessionKey: 'bad', userId: 'bad', name: 'Bad', joinedAt: 0 },
      { sessionKey: 'good', userId: 'good', name: 'Good', joinedAt: 1 },
    ])
  })

  it('survives a room where the only peer is malformed', () => {
    const snapshot = PresenceAdapter.transformState({
      bad: { metas: [{ phx_ref: 'r', userId: 'bad', name: 'Bad', joinedAt: hostileJoinedAt }] },
    })
    expect(presenceFromSync(snapshot).peers).toEqual([
      { sessionKey: 'bad', userId: 'bad', name: 'Bad', joinedAt: 0 },
    ])
  })
})

describe('presenceFromSync — joinedAt boundary shapes', () => {
  it('keeps numeric and numeric-string clocks', () => {
    const s = presenceFromSync({
      a: [{ userId: 'a', name: 'A', joinedAt: 12.5 }],
      b: [{ userId: 'b', name: 'B', joinedAt: '1000' }],
      c: [{ userId: 'c', name: 'C', joinedAt: ' 7 ' }],
      d: [{ userId: 'd', name: 'D', joinedAt: '0x10' }],
    })
    expect(Object.fromEntries(s.peers.map(p => [p.userId, p.joinedAt])))
      .toEqual({ a: 12.5, b: 1000, c: 7, d: 16 })
  })

  it('falls back to 0 for every unsupported clock shape and keeps the valid peers', () => {
    const unsupported: unknown[] = [
      { toString: null, valueOf: null },
      {}, [], [1, 2], ['5'], true, false, null, undefined, Infinity, -Infinity, NaN, 'nope', Symbol('seq'),
    ]
    const snap: Record<string, unknown> = { valid: [{ userId: 'valid', name: 'V', joinedAt: '250' }] }
    unsupported.forEach((value, i) => { snap['k' + i] = [{ userId: 'w' + i, name: 'W', joinedAt: value }] })
    const peers = presenceFromSync(snap).peers
    expect(peers).toHaveLength(unsupported.length + 1)
    expect(peers.find(p => p.userId === 'valid')?.joinedAt).toBe(250)
    expect(peers.filter(p => p.userId !== 'valid').every(p => p.joinedAt === 0)).toBe(true)
  })
})

describe('visiblePeers', () => {
  it('filters the caller\'s own session out', () => {
    let s = reducePresence(EMPTY_PRESENCE, 'me:aaa', { userId: 'me', name: 'Me' }, 1)
    s = reducePresence(s, 'u2:bbb', { userId: 'u2', name: 'B' }, 2)
    expect(visiblePeers(s, 'me:aaa').map(p => p.userId)).toEqual(['u2'])
    expect(visiblePeers(s, 'me:aaa')).toHaveLength(1)
  })
})

describe('helpers', () => {
  it('names the channel per trip', () => {
    expect(presenceChannelName('t1')).toBe('presence:t1')
  })

  it('mints session keys that carry the user id prefix', () => {
    expect(presenceKey('u1')).toMatch(/^u1:/)
    expect(presenceKey('u1')).not.toBe(presenceKey('u1'))
  })

  it('never repeats a key across a roomful of tabs', () => {
    const keys = new Set(Array.from({ length: 500 }, () => presenceKey('u1')))
    expect(keys.size).toBe(500)
  })

  it('still mints distinct keys with no Web Crypto (the insecure-context path)', () => {
    vi.stubGlobal('crypto', undefined)
    try {
      const keys = new Set(Array.from({ length: 200 }, () => presenceKey('u2')))
      expect(keys.size).toBe(200)
      expect(presenceKey('u2')).toMatch(/^u2:/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the module off the weak generator the linter flags', () => {
    const src = readFileSync(new URL('../src/lib/presence.ts', import.meta.url), 'utf8')
    // Comments may name the generator — the key's history is worth recording —
    // so judge code lines only, and only an actual CALL counts.
    const code = src
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(code).not.toMatch(/Math\s*\.\s*random\s*\(/)
  })

  it('broadcasts a payload with userId, name and a fresh joinedAt', () => {
    const p = presencePayload('u1', 'Amelia')
    expect(p.userId).toBe('u1')
    expect(p.name).toBe('Amelia')
    expect(typeof p.joinedAt).toBe('number')
  })
})

describe('presenceView — what the trip header row shows', () => {
  const amelia = { sessionKey: 'u1:aaa', userId: 'u1', name: 'Amelia', joinedAt: 100 }

  it('hides the row only when presence is not actually running', () => {
    // The quiet no-op: no backend (channel null), anon/public views and
    // "no trip open" all land here.
    expect(presenceView([], false)).toEqual({ kind: 'hidden' })
    // Peers known but the session is not live: still hidden — the row is a
    // live claim, never a cached one.
    expect(presenceView([amelia], false)).toEqual({ kind: 'hidden' })
  })

  it('says the room is empty instead of rendering nothing', () => {
    expect(presenceView([], true)).toEqual({ kind: 'solo' })
  })

  it('hands the peers through once someone else is here', () => {
    expect(presenceView([amelia], true)).toEqual({ kind: 'peers', peers: [amelia] })
  })

  it('is the gate the trip header renders from', () => {
    // Follow-up 1 of docs/PLAN-TOGETHER-M6.md: the bare `peers.length > 0`
    // gate made an empty room indistinguishable from a dead feature. The
    // header must go through presenceView, so a solo viewer always reads
    // "just you" rather than nothing.
    const src = readFileSync(new URL('../src/pages/TripWorkspace.tsx', import.meta.url), 'utf8')
    expect(src).toMatch(/presenceView\(presence\.peers, presence\.connected\)/)
    expect(src).not.toMatch(/presence\.peers\.length\s*>/)
  })
})
