// ============ #367 — admin console: precise eviction, live audit, the hatch ============
// Three rough edges, one suite:
// 1. adminDeleteUser's optimistic patch evicted a WHOLE trip when the target
//    was a mere member — the DB keeps that trip for the remaining crew, so the
//    patch alarmed the admin mid-session with a removal that never happened.
//    The behavioural pin runs the REAL store against a mocked transport.
// 2. The audit tab was poll-only; a second admin's actions were invisible
//    until a manual refresh, and a FAILED read rendered as the friendly empty
//    copy. Now the channel carries admin_audit, the read failure surfaces
//    with a Retry, and the tab re-reads on focus.
// 3. The workspace's admin FOR ALL write hatch is unaudited by design — pinned
//    as a documented boundary on the console header until it is closed.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8').replace(/\r\n/g, '\n')

// ---- the mocked transport (same shape as tests/m6-together.test.ts) ----
const { state, toast } = vi.hoisted(() => ({
  state: {
    /** Rows answered for `.rpc(name)` calls, keyed by function name. */
    rpcErrors: new Map<string, { message: string } | null>(),
    /** Rows the `.from('admin_audit')` read answers with (or an error). */
    auditRows: [] as Array<Record<string, unknown>>,
    auditReadError: null as { message: string } | null,
    writes: [] as Array<{ kind: string; name?: string }>,
  },
  toast: vi.fn(),
}))

vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/supabase', () => {
  function makeBuilder(table: string) {
    const qb: any = {}
    qb.select = () => qb
    qb.eq = () => qb
    qb.order = () => qb
    qb.limit = () => Promise.resolve({
      data: table === 'admin_audit' ? state.auditRows : [],
      error: table === 'admin_audit' ? state.auditReadError : null,
    })
    qb.maybeSingle = () => Promise.resolve({ data: null, error: null })
    qb.in = () => Promise.resolve({ data: [], error: null })
    qb.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: table === 'admin_audit' ? state.auditRows : [], error: null }).then(res)
    return qb
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: (name: string, _args: unknown) => {
        state.writes.push({ kind: 'rpc', name })
        const err = state.rpcErrors.get(name) ?? null
        return Promise.resolve({ data: null, error: err })
      },
      channel: () => ({ on: function () { return this }, subscribe: function () { return this } }),
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
      },
    },
  }
})

// The admin gate reads the JWT-carried role through lib/adminSession; the
// store keeps its own cache. Flip it through the store's test seam if one
// exists, else seed the session cache directly.
import {
  adminDeleteUser, adminRemoveMember, getSnapshot, _applyRealtimeEventForTest,
} from '../src/store/store'
import { seedData } from '../src/data/seed'
import { setAdminForTest } from '../src/lib/adminSession'

beforeEach(() => {
  state.rpcErrors.clear()
  state.auditRows = []
  state.auditReadError = null
  state.writes.length = 0
  toast.mockClear()
  setAdminForTest(true)
})

function crewTripWith(ownerId: string, memberId: string | null): any {
  const trip = JSON.parse(JSON.stringify(seedData.trips[0]))
  trip.id = 'trip-evict-test'
  trip.members = [
    { userId: ownerId, role: 'owner', name: 'Owner' },
    ...(memberId ? [{ userId: memberId, role: 'member', name: 'Member' }] : []),
  ]
  return trip
}

function seedTrip(trip: any) {
  // The store's trips realtime path carries the trip ROW only — members live
  // on trip_members and arrive as their own events (the same split the real
  // channel has). Seed the row, then each member through its own event.
  _applyRealtimeEventForTest('trips', {
    eventType: 'INSERT', schema: 'public', table: 'trips',
    commit_timestamp: new Date().toISOString(), old: {}, new: trip,
  } as never)
  for (const m of trip.members ?? []) {
    // #567 — the honest payload shape: `trip_members` has no `id` column (the
    // composite (trip_id, user_id) is the key), and the dispatch keys the
    // composite for this table. The old comment here asserted the false belief
    // that real rows carry an id — and fabricated one to get past the guard,
    // pinning behaviour against a shape the wire never produces.
    _applyRealtimeEventForTest('trip_members', {
      eventType: 'INSERT', schema: 'public', table: 'trip_members',
      commit_timestamp: new Date().toISOString(), old: {},
      new: { trip_id: trip.id, user_id: m.userId, role: m.role, joined_at: Date.now() },
    } as never)
  }
  return getSnapshot().trips.find(t => t.id === trip.id)!
}

describe("#367 — deleting a mere member keeps the crew's trip", () => {
  it('a member-only target: the trip REMAINS, the membership row is gone', async () => {
    seedTrip(crewTripWith('owner-1', 'member-9'))
    const ok = await adminDeleteUser('member-9')
    expect(ok).toBe(true)
    const db = getSnapshot()
    expect(db.trips.find(t => t.id === 'trip-evict-test')).toBeTruthy()
    expect(db.trips.find(t => t.id === 'trip-evict-test')?.members.some(m => m.userId === 'member-9')).toBe(false)
  })

  it('an owner target: the trip goes with them (the DB cascade is honest)', async () => {
    seedTrip(crewTripWith('owner-2', 'member-9'))
    const ok = await adminDeleteUser('owner-2')
    expect(ok).toBe(true)
    expect(getSnapshot().trips.find(t => t.id === 'trip-evict-test')).toBeUndefined()
  })

  it('an RPC failure restores the exact pre-patch slices (rollback intact)', async () => {
    seedTrip(crewTripWith('owner-1', 'member-9'))
    state.rpcErrors.set('admin_delete_user', { message: 'cannot delete the last admin account' })
    const before = getSnapshot().trips.find(t => t.id === 'trip-evict-test')
    const ok = await adminDeleteUser('member-9')
    expect(ok).toBe(false)
    const after = getSnapshot().trips.find(t => t.id === 'trip-evict-test')
    expect(JSON.stringify(after?.members)).toBe(JSON.stringify(before?.members))
    expect(toast).toHaveBeenCalledWith('cannot delete the last admin account', 'err')
  })
})

describe('#367 — the audit read speaks for itself', () => {
  it('a failed audit read flips the status bit (the tab renders a Retry)', async () => {
    // Drive the refresh through a real, SUCCEEDING action — the refresh only
    // runs on the success path (a failed RPC toasts and rolls back first),
    // and it is fire-and-forget, so the flag lands a tick after the action
    // resolves. `vi.waitFor` rides that tick instead of guessing a sleep.
    seedTrip(crewTripWith('owner-1', 'member-9'))
    state.auditReadError = { message: 'permission denied' }
    await adminRemoveMember('trip-evict-test', 'member-9')
    await vi.waitFor(() => { expect(getSnapshot().adminAuditFailed).toBe(true) })
  })

  it('a successful read clears the flag', async () => {
    seedTrip(crewTripWith('owner-1', 'member-9'))
    state.auditReadError = { message: 'permission denied' }
    await adminRemoveMember('trip-evict-test', 'member-9')
    await vi.waitFor(() => { expect(getSnapshot().adminAuditFailed).toBe(true) })
    state.auditReadError = null
    // Seed the member back so the second removal succeeds too.
    seedTrip(crewTripWith('owner-1', 'member-9'))
    await adminRemoveMember('trip-evict-test', 'member-9')
    await vi.waitFor(() => { expect(getSnapshot().adminAuditFailed).toBe(false) })
  })

  it('a live audit INSERT lands in the cache newest-first (the realtime path)', () => {
    _applyRealtimeEventForTest('admin_audit', {
      eventType: 'INSERT', schema: 'public', table: 'admin_audit',
      commit_timestamp: new Date().toISOString(), old: {},
      new: { id: 'a1', actor_id: 'admin-1', action: 'user.disable', target_type: 'user', target_id: 'u1', detail: { disabled: true }, at: Date.now() },
    } as never)
    expect(getSnapshot().adminAudit[0]?.action).toBe('user.disable')
  })
})

// ---- source invariants: the subscription and the hatch label ----
describe('#367 — source invariants', () => {
  const store = read('src/store/store.ts')
  const page = read('src/pages/AdminPage.tsx')

  it('connectRealtime subscribes admin_audit (the publication already carries it)', () => {
    expect(store).toMatch(/table: 'admin_audit'/)
  })

  it('the console header states the hatch boundary', () => {
    // The workspace's admin FOR ALL policies let an admin edit through the
    // normal UI without an audit row; until that is closed, the console says
    // so where the admin will read it.
    expect(page).toMatch(/Actions taken through the regular workspace are not\./)
  })

  it('the audit tab re-reads on focus (the socket gap is replayed for trips only)', () => {
    expect(page).toMatch(/refreshAdminAuditNow\(\)/)
    expect(page).toMatch(/visibilitychange/)
  })
})

// ============ #561 — the content tab learns the soft-unpublish marker ============
// The tab still described the DELETE-based unpublish ("removes the page and
// flips the trip back to private") that died with #350, contradicted its own
// dialog twelve lines below, and listed withdrawn rows indistinguishably from
// live ones — the marker was already in the cache and the table never read it.
// Copy and moderation UX only, no wire behaviour: the pins are on the source.
describe('#561 — the content tab labels live vs withdrawn', () => {
  const page = read('src/pages/AdminPage.tsx')

  it('no longer claims unpublish flips the trip back to private', () => {
    // The string that shipped — and that its own ConfirmDialog below already
    // contradicted. Rewritten to the shipped policy, in the register the Share
    // tab and creator hub already use.
    expect(page).not.toContain('flips the trip back to private')
    expect(page).toContain('takes a plan off Explore and stops it')
  })

  it('renders the row state from the marker, keeping withdrawn rows listed', () => {
    // Label, not filter: moderation needs the withdrawn rows — they are
    // exactly the rows an operator is looking for, and #350's whole point is
    // that the history survives.
    expect(page).toContain('{p.unpublishedAt')
    expect(page).toContain('<Chip tone="info">Unpublished ')
    expect(page).toContain('<Chip tone="ok">Live</Chip>')
    // …and the table still enumerates every row.
    expect(page).toContain('pubs.map(p => {')
  })

  it('reads honestly on an already-withdrawn row instead of re-offering the action', () => {
    // The re-stamp is idempotent server-side; what was wrong was a working
    // button on a withdrawn row that read as an action doing something new.
    // Pinned on the disabled-with-tooltip branch.
    expect(page).toContain('title={`Already unpublished on ')
    expect(page).toContain('Already unpublished on ${new Date(p.unpublishedAt)')
  })
})
