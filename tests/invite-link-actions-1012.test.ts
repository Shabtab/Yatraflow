// #1012 Track B client: the invite link role and reset actions in the store.
// The harness follows tests/ensure-invite-code.test.ts. Each write is checked against the RPC it sent,
// and after a failed write the outcome is read again before any claim is made.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'
import type { MemberAccessState } from '../src/lib/memberAccess'

const transport = vi.hoisted(() => ({
  actor: 'owner',
  error: null as null | { message: string },
  server: null as unknown,
  reply: null as unknown,
  onWrite: null as null | (() => void),
  calls: [] as Array<{ fn: string; args: Record<string, unknown>; header: string | null }>,
}))
const notice = vi.hoisted(() => vi.fn())
vi.mock('../src/components/ui', () => ({ toast: notice }))
vi.mock('../src/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: transport.actor }, access_token: `token-${transport.actor}` } } }) },
    // duplicateTrip persists its copy in the background. This stub accepts those writes, so they cannot reject unseen.
    // Membership commands never reach it: they go through rpc.
    from: () => {
      const chain: unknown = new Proxy({}, {
        get: (_target, key) => (key === 'then' ? (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null }) : () => chain),
      })
      return chain
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      let header: string | null = null
      return {
        setHeader(name: string, value: string) { header = `${name}: ${value}`; return this },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          transport.calls.push({ fn, args, header })
          if (fn === 'change_trip_access') transport.onWrite?.()
          const answer = fn === 'trip_access_state' ? structuredClone(transport.server) : structuredClone(transport.reply)
          const error = fn === 'change_trip_access' ? transport.error : null
          return Promise.resolve({ data: answer, error }).then(resolve, reject)
        },
      }
    },
  },
}))

let store: typeof import('../src/store/store')
const state = (version = 1, inviteCode: string | null = 'YATRA-ABCDEFGH', inviteRole: 'editor' | 'viewer' = 'editor'): MemberAccessState => ({
  version, inviteCode, inviteRole,
  members: [{ userId: 'owner', role: 'owner', joinedAt: 1, revision: 1 }],
  removed: [],
})
const cached = () => store.tripById('member-fixture')!
const writes = () => transport.calls.filter(c => c.fn === 'change_trip_access')
const header = 'Authorization: Bearer token-owner'

beforeEach(async () => {
  vi.resetModules()
  store = await import('../src/store/store')
  transport.actor = 'owner'
  transport.server = state()
  transport.reply = { status: 'applied', state: state(2, 'YATRA-JKLMNPQR', 'viewer') }
  transport.error = null
  transport.onWrite = null
  transport.calls.length = 0
  notice.mockClear()
  const db = store.getSnapshot()
  db.sessionUserId = 'owner'
  db.trips = [{
    ...structuredClone(seedData.trips[0]), id: 'member-fixture', members: state().members,
    inviteCode: 'YATRA-ABCDEFGH', inviteRole: 'editor', accessVersion: 1,
  }]
})

describe('invite link role and reset (#1012)', () => {
  it('a role change sends the five named arguments and installs the role it confirmed', async () => {
    const outcome = await store.setInviteRole('member-fixture', 'viewer')
    expect(outcome.status).toBe('done')
    expect(writes()).toEqual([{
      fn: 'change_trip_access',
      args: { p_trip_id: 'member-fixture', p_action: 'invite_role', p_user_id: null, p_role: 'viewer', p_expected_revision: null },
      header,
    }])
    expect(cached().inviteRole).toBe('viewer')
    expect(cached().inviteCode).toBe('YATRA-JKLMNPQR')
  })

  it('a reset sends invite_reset with no role and replaces the cached code', async () => {
    transport.reply = { status: 'applied', state: state(2, 'YATRA-NEWCODE12', 'editor') }
    const outcome = await store.resetInviteLink('member-fixture')
    expect(outcome.status).toBe('done')
    expect(writes()).toEqual([{
      fn: 'change_trip_access',
      args: { p_trip_id: 'member-fixture', p_action: 'invite_reset', p_user_id: null, p_role: null, p_expected_revision: null },
      header,
    }])
    expect(cached().inviteCode).toBe('YATRA-NEWCODE12')
  })

  it('after a failed reset, a re-read that still shows the old code reports the old link as working', async () => {
    transport.error = { message: 'network' }
    expect(await store.resetInviteLink('member-fixture')).toEqual({ status: 'unchanged' })
    expect(cached().inviteCode).toBe('YATRA-ABCDEFGH')
    expect(notice).not.toHaveBeenCalled()
  })

  it('after a failed reset, a re-read that shows a new code means the reset worked', async () => {
    transport.error = { message: 'network' }
    transport.onWrite = () => { transport.server = state(2, 'YATRA-NEWCODE12', 'editor') }
    expect((await store.resetInviteLink('member-fixture')).status).toBe('done')
    expect(cached().inviteCode).toBe('YATRA-NEWCODE12')
  })

  it('after a failed role change, a re-read that shows the old role reports no change', async () => {
    transport.error = { message: 'network' }
    expect(await store.setInviteRole('member-fixture', 'viewer')).toEqual({ status: 'unchanged' })
    expect(cached().inviteRole).toBe('editor')
  })

  it('when the re-read after a failed write also fails, the outcome is unknown and nothing is claimed', async () => {
    transport.error = { message: 'network' }
    transport.onWrite = () => { transport.server = null }
    expect(await store.resetInviteLink('member-fixture')).toEqual({ status: 'unknown' })
    expect(notice).not.toHaveBeenCalled()
  })

  it('NEGATIVE: a failed read before the write sends no write, and says nothing was sent', async () => {
    transport.server = null
    expect(await store.setInviteRole('member-fixture', 'viewer')).toEqual({ status: 'unsent' })
    expect(writes()).toEqual([])
  })

  it('a member who is not the owner reads the access state, and the role is cached from that read', async () => {
    transport.actor = 'guest'
    transport.server = {
      ...state(4, 'YATRA-ABCDEFGH', 'viewer'),
      members: [
        { userId: 'owner', role: 'owner', joinedAt: 1, revision: 1 },
        { userId: 'guest', role: 'viewer', joinedAt: 2, revision: 1 },
      ],
    }
    const db = store.getSnapshot()
    db.sessionUserId = 'guest'
    db.trips = db.trips.map(t => ({ ...t, members: [...(t.members ?? []), { userId: 'guest', role: 'viewer' as const, joinedAt: 2 }] }))
    const read = await store.readMemberAccess('member-fixture')
    expect(read?.inviteRole).toBe('viewer')
    expect(cached().inviteRole).toBe('viewer')
    expect(transport.calls.map(c => c.fn)).toEqual(['trip_access_state'])
    expect(transport.calls[0].header).toBe('Authorization: Bearer token-guest')
  })

  it('an old server answer carries no role, and a bad role fails closed', async () => {
    const legacy: Partial<MemberAccessState> = state(1)
    delete legacy.inviteRole
    transport.server = legacy
    await store.readMemberAccess('member-fixture')
    expect(cached().inviteRole).toBeUndefined()
    transport.server = { ...state(3), inviteRole: 'owner' }
    expect(await store.readMemberAccess('member-fixture')).toBeNull()
  })

  it('buildTripCopy clears the cached role with the code', () => {
    const source = { ...structuredClone(seedData.trips[0]), inviteCode: 'KERALAHILL-XPNX', inviteRole: 'viewer' } as Trip
    const copy = store.duplicateTrip(source, 'forker-1')
    expect(copy.inviteCode).toBeUndefined()
    expect(copy.inviteRole).toBeUndefined()
  })

  it('the realtime handler drops the cached role when the access version moves', () => {
    const src = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(src).toMatch(/draft\.inviteRole = undefined\n\s*draft\.accessVersion = accessVersion/)
  })
})
