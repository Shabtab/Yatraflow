// A member restore is acknowledged only by an applied receipt that carries the
// membership state (#935, fault 2). A failed restore returns false, leaves the
// member out of the cache, and reports the failure. It never reports success.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seedData } from '../src/data/seed'
import type { MemberAccessState } from '../src/lib/memberAccess'

const transport = vi.hoisted(() => ({
  /** The error a change_trip_access call returns. Reads are not affected. */
  error: null as null | { message: string },
  /** The body a change_trip_access call returns. */
  reply: null as unknown,
  /** The membership state trip_access_state returns. */
  server: null as MemberAccessState | null,
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}))
const notice = vi.hoisted(() => vi.fn())
vi.mock('../src/components/ui', () => ({ toast: notice }))
vi.mock('../src/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'owner' }, access_token: 'token-owner' } } }),
    },
    from: () => { throw new Error('Membership commands must not use a direct write.') },
    rpc: (fn: string, args: Record<string, unknown>) => {
      const response = {
        setHeader() { return response },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          transport.calls.push({ fn, args })
          const answer = fn === 'trip_access_state'
            ? structuredClone(transport.server)
            : structuredClone(transport.reply)
          const error = fn === 'change_trip_access' ? transport.error : null
          return Promise.resolve({ data: answer, error }).then(resolve, reject)
        },
      }
      return response
    },
  },
}))

let store: typeof import('../src/store/store')

/** The trip as the server holds it: the owner is the only member, and the guest
 *  was removed at revision 7. */
const removedGuest = { userId: 'guest', role: 'commenter' as const, joinedAt: 2, revision: 7 }
const serverWithGuestRemoved = (): MemberAccessState => ({
  version: 7, inviteCode: 'YATRA-ABCDEFGH',
  members: [{ userId: 'owner', role: 'owner', joinedAt: 1, revision: 1 }],
  removed: [removedGuest],
})
const cached = () => store.tripById('restore-fixture')!

beforeEach(async () => {
  vi.resetModules()
  store = await import('../src/store/store')
  transport.error = null
  transport.reply = null
  transport.server = serverWithGuestRemoved()
  transport.calls.length = 0
  notice.mockClear()
  const db = store.getSnapshot()
  db.sessionUserId = 'owner'
  db.trips = [{
    ...structuredClone(seedData.trips[0]), id: 'restore-fixture',
    members: [{ userId: 'owner', role: 'owner', joinedAt: 1 }],
    inviteCode: 'YATRA-ABCDEFGH',
  }]
})

describe('a failed member restore does not report success', () => {
  it('an RPC error returns false, keeps the member removed, and says why', async () => {
    transport.error = { message: 'permission denied for function change_trip_access' }
    expect(await store.restoreMember('restore-fixture', removedGuest)).toBe(false)
    expect(cached().members?.some(m => m.userId === 'guest')).toBe(false)
    expect(notice).toHaveBeenCalledWith('permission denied for function change_trip_access', 'err')
  })

  it('a stale receipt returns false, keeps the member removed, and reports the change', async () => {
    transport.reply = { status: 'stale', state: serverWithGuestRemoved() }
    expect(await store.restoreMember('restore-fixture', removedGuest)).toBe(false)
    expect(cached().members?.some(m => m.userId === 'guest')).toBe(false)
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('membership changed'), 'err')
  })

  it('an applied receipt without a membership state is not a confirmed restore', async () => {
    transport.reply = { status: 'applied' }
    expect(await store.restoreMember('restore-fixture', removedGuest)).toBe(false)
    expect(cached().members?.some(m => m.userId === 'guest')).toBe(false)
    expect(notice).toHaveBeenCalledWith('Could not confirm the membership change. Refresh and try again.', 'err')
  })

  it('an applied receipt with the restored state is the one success, and the member returns', async () => {
    transport.reply = {
      status: 'applied',
      state: {
        version: 8, inviteCode: 'YATRA-ABCDEFGH',
        members: [{ userId: 'owner', role: 'owner', joinedAt: 1, revision: 1 }, { userId: 'guest', role: 'commenter', joinedAt: 2, revision: 8 }],
        removed: [],
      },
    }
    expect(await store.restoreMember('restore-fixture', removedGuest)).toBe(true)
    expect(cached().members?.find(m => m.userId === 'guest')?.role).toBe('commenter')
    expect(transport.calls.at(-1)?.args).toMatchObject({ p_action: 'restore', p_user_id: 'guest', p_expected_revision: 7 })
  })
})
