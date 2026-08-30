// ============ Realtime collaboration hot-path reducers (issue #18) ============
// Tests the pure helpers in src/lib/realtimeCore.ts that the store's
// postgres_changes handlers run for every remote event.
import { describe, it, expect } from 'vitest'
import { reduceSlice, applyMemberChange, isRecentLocalWrite } from '../src/lib/realtimeCore'
import type { TripMember } from '../src/data/types'

type Item = { id: string; n: number }

describe('reduceSlice', () => {
  const base: Item[] = [
    { id: 'a', n: 1 },
    { id: 'b', n: 2 },
  ]

  it('INSERT appends a new row', () => {
    expect(reduceSlice(base, 'INSERT', { id: 'c', n: 3 })).toEqual([...base, { id: 'c', n: 3 }])
  })

  it('INSERT is idempotent for an already-present id (prevents duplicate cards on echo)', () => {
    expect(reduceSlice(base, 'INSERT', { id: 'a', n: 99 })).toEqual(base)
  })

  it('UPDATE replaces in place, preserving order', () => {
    expect(reduceSlice(base, 'UPDATE', { id: 'a', n: 10 })).toEqual([{ id: 'a', n: 10 }, { id: 'b', n: 2 }])
    expect(reduceSlice(base, 'UPDATE', { id: 'b', n: 20 })).toEqual([{ id: 'a', n: 1 }, { id: 'b', n: 20 }])
  })

  it('UPDATE for an unknown id appends (remote added a row we had not seen)', () => {
    expect(reduceSlice(base, 'UPDATE', { id: 'c', n: 3 })).toEqual([...base, { id: 'c', n: 3 }])
  })

  it('DELETE removes by id (falls back to row.id)', () => {
    expect(reduceSlice(base, 'DELETE', undefined, 'a')).toEqual([{ id: 'b', n: 2 }])
    expect(reduceSlice(base, 'DELETE', { id: 'b', n: 2 })).toEqual([{ id: 'a', n: 1 }])
  })
})

describe('applyMemberChange', () => {
  const members: TripMember[] = [
    { userId: 'u1', role: 'owner', joinedAt: 1 },
    { userId: 'u2', role: 'editor', joinedAt: 2 },
  ]

  it('inserts a new member', () => {
    const next = applyMemberChange(members, { event: 'INSERT', userId: 'u3', role: 'editor', joinedAt: 3 })
    expect(next.map(m => m.userId)).toEqual(['u1', 'u2', 'u3'])
  })

  it('updates a role in place (user promoted to owner)', () => {
    const next = applyMemberChange(members, { event: 'UPDATE', userId: 'u2', role: 'owner', joinedAt: 2 })
    expect(next).toEqual([
      { userId: 'u1', role: 'owner', joinedAt: 1 },
      { userId: 'u2', role: 'owner', joinedAt: 2 },
    ])
  })

  it('removes a member on DELETE', () => {
    expect(applyMemberChange(members, { event: 'DELETE', userId: 'u2', role: 'editor', joinedAt: 2 }).map(m => m.userId)).toEqual(['u1'])
  })
})

describe('isRecentLocalWrite (echo guard)', () => {
  it('suppresses events within the echo window', () => {
    const recent = new Map<string, number>([['trips:t1', 1000]])
    expect(isRecentLocalWrite(recent, 'trips', 't1', 1500)).toBe(true)
    expect(isRecentLocalWrite(recent, 'trips', 't1', 2999)).toBe(true)
  })

  it('lets events through once the window expires or the id differs', () => {
    const recent = new Map<string, number>([['trips:t1', 1000]])
    expect(isRecentLocalWrite(recent, 'trips', 't1', 3001, 2000)).toBe(false)
    expect(isRecentLocalWrite(recent, 'trips', 't2', 1200)).toBe(false)
    expect(isRecentLocalWrite(recent, 'suggestions', 't1', 1200)).toBe(false)
  })
})