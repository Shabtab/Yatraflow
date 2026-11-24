// @vitest-environment node
// #1012 Track B client: the invite role parser, the role-following invite copy, and the trips row,
// which never carries the link role. Pure logic only, so the store is not imported here.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMemberAccess, keepCurrentInvite, memberChangeReceipt } from '../src/lib/memberAccess'
import { crewInviteMessage } from '../src/lib/crewInvite'
import { tripToRow } from '../src/lib/tripRow'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'

const base = () => ({
  version: 3,
  inviteCode: 'YATRA-ABCDEFGH',
  members: [{ userId: 'owner', role: 'owner', joinedAt: 1, revision: 1 }],
  removed: [],
})

describe('invite role parser (#1012)', () => {
  it('an absent role is an old server, so the field is not set', () => {
    const parsed = parseMemberAccess(base())
    expect(parsed).not.toBeNull()
    expect('inviteRole' in parsed!).toBe(false)
  })

  it('editor and viewer are the only roles it returns', () => {
    expect(parseMemberAccess({ ...base(), inviteRole: 'editor' })?.inviteRole).toBe('editor')
    expect(parseMemberAccess({ ...base(), inviteRole: 'viewer' })?.inviteRole).toBe('viewer')
  })

  it('NEGATIVE: any other value fails closed, JSON null included', () => {
    for (const bad of ['owner', 'commenter', '', 'Editor', 7, null, {}]) {
      expect(parseMemberAccess({ ...base(), inviteRole: bad })).toBeNull()
    }
  })

  it('a receipt carries the confirmed role through', () => {
    const receipt = memberChangeReceipt({ status: 'applied', state: { ...base(), inviteRole: 'viewer' } })
    expect(receipt?.state?.inviteRole).toBe('viewer')
  })
})

describe('keepCurrentInvite carries the cached role with the code (#1012)', () => {
  it('a stale row keeps the cached code and role together', () => {
    const existing = { id: 't', accessVersion: 5, inviteCode: 'NEWCODE-AAAA', inviteRole: 'viewer' } as Trip
    const incoming = { id: 't', accessVersion: 4, inviteCode: 'OLDCODE-BBBB' } as Trip
    const kept = keepCurrentInvite(incoming, existing)
    expect(kept.inviteCode).toBe('NEWCODE-AAAA')
    expect(kept.inviteRole).toBe('viewer')
  })

  it('a newer row replaces the cache, and no old role comes with it', () => {
    const existing = { id: 't', accessVersion: 5, inviteCode: 'NEWCODE-AAAA', inviteRole: 'viewer' } as Trip
    const incoming = { id: 't', accessVersion: 6, inviteCode: 'LATEST-CCCC' } as Trip
    expect(keepCurrentInvite(incoming, existing).inviteRole).toBeUndefined()
  })
})

describe('the invite message follows the link role (#1012)', () => {
  const args = { tripName: 'Goa run', joinUrl: 'https://x/#/join/GOA-K7QF', plannerName: 'Asha' }

  it('an editor link keeps the vote line', () => {
    expect(crewInviteMessage({ ...args, role: 'editor' })).toContain('Join to vote on stops')
  })

  it('a viewer link never promises a vote', () => {
    const msg = crewInviteMessage({ ...args, role: 'viewer' })
    expect(msg).toContain('Join to see the plan: https://x/#/join/GOA-K7QF')
    expect(msg).not.toMatch(/vote/i)
  })

  it('an unknown role makes only the promise that holds for both roles', () => {
    expect(crewInviteMessage(args)).toContain('Join to see the plan')
    expect(crewInviteMessage({ ...args, role: null })).not.toMatch(/vote/i)
  })
})

describe('the trips row never carries the link role (#1012)', () => {
  it('tripToRow leaves the role out, even when the cached trip has one', () => {
    const trip = { ...structuredClone(seedData.trips[0]), inviteRole: 'viewer' } as Trip
    const row = tripToRow(trip, 'owner-1') as Record<string, unknown>
    expect(Object.keys(row).some(key => /invite_?role/i.test(key))).toBe(false)
  })

  it('the row mapper source never names the role', () => {
    const src = readFileSync(new URL('../src/lib/tripRow.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(src).not.toMatch(/inviteRole/)
  })
})
