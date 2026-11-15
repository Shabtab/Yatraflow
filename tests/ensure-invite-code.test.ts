import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seedData } from '../src/data/seed'
import type { MemberAccessState } from '../src/lib/memberAccess'

const transport = vi.hoisted(() => ({
  actor: 'owner', error: null as null | { message: string },
  server: null as MemberAccessState | null, reply: null as unknown,
  gate: null as Promise<void> | null,
  calls: [] as Array<{ fn: string; args: Record<string, unknown>; header: string | null }>,
}))
const notice = vi.hoisted(() => vi.fn())
vi.mock('../src/components/ui', () => ({ toast: notice }))
vi.mock('../src/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: transport.actor }, access_token: `token-${transport.actor}` } } }) },
    from: () => { throw new Error('Membership commands must not use a direct write.') },
    rpc: (fn: string, args: Record<string, unknown>) => {
      let header: string | null = null
      return {
        setHeader(name: string, value: string) { header = `${name}: ${value}`; return this },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          transport.calls.push({ fn, args, header })
          const answer = fn === 'trip_access_state' ? structuredClone(transport.server) : structuredClone(transport.reply)
          const error = transport.error
          return (async () => {
            if (fn === 'change_trip_access') await transport.gate
            return { data: answer, error }
          })().then(resolve, reject)
        },
      }
    },
  },
}))

let store: typeof import('../src/store/store')
const state = (version = 1): MemberAccessState => ({
  version, inviteCode: 'YATRA-ABCDEFGH',
  members: [{ userId: 'owner', role: 'owner', joinedAt: 1, revision: 1 }, { userId: 'guest', role: 'viewer', joinedAt: 2, revision: 1 }],
  removed: [],
})
const cached = () => store.tripById('member-fixture')!

beforeEach(async () => {
  vi.resetModules()
  store = await import('../src/store/store')
  transport.actor = 'owner'
  transport.error = null
  transport.gate = null
  transport.server = state()
  transport.reply = { status: 'applied', state: state(2) }
  transport.calls.length = 0
  notice.mockClear()
  const db = store.getSnapshot()
  db.sessionUserId = 'owner'
  db.trips = [{ ...structuredClone(seedData.trips[0]), id: 'member-fixture', members: state().members, inviteCode: 'STALE-ABCDEFGH' }]
})

describe('acknowledged trip membership and invites', () => {
  it('checks the server even with a cached invite and binds the caller bearer', async () => {
    expect(await store.ensureInviteCode('member-fixture')).toBe('YATRA-ABCDEFGH')
    expect(cached().inviteCode).toBe('YATRA-ABCDEFGH')
    expect(transport.calls).toEqual([{ fn: 'change_trip_access', args: { p_trip_id: 'member-fixture', p_action: 'invite', p_expected_revision: null }, header: 'Authorization: Bearer token-owner' }])
  })

  it('does not invent an invite when server support is absent', async () => {
    transport.error = { message: 'Function is unavailable' }
    expect(await store.ensureInviteCode('member-fixture')).toBeNull()
    expect(cached().inviteCode).toBe('STALE-ABCDEFGH')
  })

  it('waits for removal acknowledgement, then installs the rotated code and Undo revision', async () => {
    let release = () => {}
    transport.gate = new Promise<void>(resolve => { release = resolve })
    const after = state(2)
    after.inviteCode = 'YATRA-JKLMNPQR'
    after.removed = [{ ...after.members[1], revision: 2 }]
    after.members = [after.members[0]]
    transport.reply = { status: 'applied', state: after }
    const pending = store.removeMember('member-fixture', 'guest')
    await vi.waitFor(() => expect(transport.calls.some(c => c.fn === 'change_trip_access')).toBe(true))
    expect(cached().members?.some(m => m.userId === 'guest')).toBe(true)
    release()
    expect(await pending).toEqual(after.removed[0])
    expect(cached().members?.some(m => m.userId === 'guest')).toBe(false)
    expect(cached().inviteCode).toBe(after.inviteCode)
    expect(transport.calls.every(c => c.header === 'Authorization: Bearer token-owner')).toBe(true)
  })

  it('keeps membership on refusal and makes the failure visible', async () => {
    transport.reply = { status: 'stale', state: state(2) }
    expect(await store.removeMember('member-fixture', 'guest')).toBeNull()
    expect(cached().members?.find(m => m.userId === 'guest')?.role).toBe('viewer')
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('membership changed'), 'err')
  })

  it('sends the acknowledged removal revision for Undo and later restore', async () => {
    const removed = { userId: 'guest', role: 'viewer' as const, joinedAt: 2, revision: 7 }
    transport.server = { ...state(7), members: [state().members[0]], removed: [removed] }
    transport.reply = { status: 'applied', state: state(8) }
    expect(await store.restoreMember('member-fixture', removed)).toBe(true)
    expect(transport.calls.at(-1)?.args).toMatchObject({ p_action: 'restore', p_user_id: 'guest', p_expected_revision: 7 })
  })

  it('does not optimistically change a role and refuses malformed acknowledgements', async () => {
    transport.reply = { status: 'applied', state: { ...state(2), members: [{ userId: 'guest', role: 'owner' }] } }
    expect(await store.setMemberRole('member-fixture', 'guest', 'editor')).toBe(false)
    expect(cached().members?.find(m => m.userId === 'guest')?.role).toBe('viewer')
  })

  it('retires a held response after the account changes', async () => {
    let release = () => {}
    transport.gate = new Promise<void>(resolve => { release = resolve })
    const pending = store.removeMember('member-fixture', 'guest')
    await vi.waitFor(() => expect(transport.calls.some(c => c.fn === 'change_trip_access')).toBe(true))
    store.getSnapshot().sessionUserId = 'another-account'
    release()
    expect(await pending).toBeNull()
    expect(notice).not.toHaveBeenCalled()
  })

  it('accepts the new role and rejects a stale Undo without reporting success', async () => {
    const after = state(2)
    after.members[1] = { ...after.members[1], role: 'commenter', revision: 2 }
    transport.reply = { status: 'applied', state: after }
    expect(await store.setMemberRole('member-fixture', 'guest', 'commenter')).toBe(true)
    expect(cached().members?.find(m => m.userId === 'guest')?.role).toBe('commenter')
    transport.reply = { status: 'stale', state: after }
    expect(await store.restoreMember('member-fixture', { ...state().members[1], revision: 1 })).toBe(false)
    expect(notice).toHaveBeenCalled()
  })
})
