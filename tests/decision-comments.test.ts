// ============ Decision comments (I-7), under the stage-A command path ============
// Decision comments used to ride a whole-JSON column UPDATE guarded by a
// client-side capability probe. Stage A of #832 moves them through the
// `submit_collab_command` RPC: the comment travels as a `decision.comment`
// command with a stable comment id, the receipt decides what the caller
// learns, and a refused command rolls the optimistic comment back instead of
// leaving a session-only ghost behind.
import { describe, it, expect, vi } from 'vitest'
import { seedData } from '../src/data/seed'

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; payload?: unknown }>,
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let method: string | undefined
    let payload: unknown
    const builder: Record<string, unknown> = {}
    const chain = (m: string, p?: unknown) => { method = m; payload = p; return builder }
    builder.update = (p: unknown) => chain('update', p)
    builder.insert = (p: unknown) => chain('insert', p)
    builder.delete = () => chain('delete')
    builder.select = (cols?: string) => { method = 'select'; payload = cols; return builder }
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => { if (method) calls.push({ table, method, payload }); resolve({ data: null, error: null }) }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      // The command RPC. A test sets `receipt` to shape the answer; the
      // default applied receipt carries no canonical row, so the optimistic
      // cache entry stands.
      rpc: (fn: string, params?: unknown) => {
        const qb: Record<string, unknown> = {}
        qb.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
          new Promise(resolve => { calls.push({ table: fn, method: 'rpc', payload: params }); resolve({ data: currentReceipt(), error: null }) }).then(res)
        return qb
      },
    },
  }
})

// Fresh module per case: the capability probe memoizes its promise, which is
// the production behaviour but pins one answer for the whole file.
async function freshStore() {
  vi.resetModules()
  return import('../src/store/store')
}

let receipt: unknown
function currentReceipt(): unknown {
  return receipt
}

const keralaTrip = seedData.trips[0]
const ownerId = 'owner-test'

function commentCommands() {
  return calls.filter(c => c.table === 'submit_collab_command' && c.method === 'rpc')
    .map(c => (c.payload as { p_command?: { type?: string } })?.p_command)
    .filter(cmd => cmd?.type === 'decision.comment')
}

describe('decision comments (I-7) through the command RPC', () => {
  it('lands the comment in the cache and sends it as a decision.comment command', async () => {
    receipt = { status: 'applied', tripRevision: 3, activityId: 'act-1', notificationIds: ['n-1'] }
    calls.length = 0
    const store = await freshStore()
    const trip = store.duplicateTrip(keralaTrip, ownerId)
    store.getSnapshot().sessionUserId = ownerId
    await store.addDecision(trip.id, { question: 'Houseboat or resort?', options: [{ id: 'o_1', label: 'Houseboat' }] })
    const d = store.getSnapshot().decisions[store.getSnapshot().decisions.length - 1]

    const outcome = await store.addCommentToDecision(trip.id, d.id, 'Book the upper deck.')

    const after = store.getSnapshot().decisions.find(x => x.id === d.id)!
    expect(after.comments).toHaveLength(1)
    // The author is the SIGNED-IN account — the caller cannot name one (#801).
    expect(after.comments[0]).toMatchObject({ authorId: ownerId, text: 'Book the upper deck.' })
    expect(outcome.status).toBe('applied')

    const commands = commentCommands()
    expect(commands).toHaveLength(1)
    const cmd = commands[0] as { decisionId?: string; commentId?: string; text?: string }
    expect(cmd.decisionId).toBe(d.id)
    expect(cmd.text).toBe('Book the upper deck.')
    // The stable comment id is what makes a retry answer alreadyApplied.
    expect(typeof cmd.commentId).toBe('string')
    expect(cmd.commentId!.startsWith('cm_')).toBe(true)
  })

  it('rolls the comment back when the command cannot be committed (no receipt)', async () => {
    receipt = { status: 'applied', tripRevision: 1 }
    calls.length = 0
    const store = await freshStore()
    const trip = store.duplicateTrip(keralaTrip, ownerId)
    store.getSnapshot().sessionUserId = ownerId
    await store.addDecision(trip.id, { question: 'Houseboat or resort?', options: [{ id: 'o_1', label: 'Houseboat' }] })
    const d = store.getSnapshot().decisions[store.getSnapshot().decisions.length - 1]

    // The answer this time is NOT a parseable receipt — the database answered
    // 200 with nothing this client can trust, or the RPC is not deployed.
    receipt = undefined
    const outcome = await store.addCommentToDecision(trip.id, d.id, 'Book the upper deck.')

    // No optimistic success and no session-only ghost: the caller learns the
    // write did not happen and the cache says so too.
    expect(outcome.status).toBe('unavailable')
    const after = store.getSnapshot().decisions.find(x => x.id === d.id)!
    expect(after.comments).toHaveLength(0)
    expect(commentCommands()).toHaveLength(1)
  })

  it('an empty comment is invalid, and an unknown decision is invalid — both answered', async () => {
    receipt = { status: 'applied', tripRevision: 1 }
    calls.length = 0
    const store = await freshStore()
    const trip = store.duplicateTrip(keralaTrip, ownerId)
    store.getSnapshot().sessionUserId = ownerId
    await store.addDecision(trip.id, { question: 'Houseboat or resort?', options: [{ id: 'o_1', label: 'Houseboat' }] })
    const d = store.getSnapshot().decisions[store.getSnapshot().decisions.length - 1]

    const empty = await store.addCommentToDecision(trip.id, d.id, '   ')
    expect(empty.status).toBe('invalid')

    const unknown = await store.addCommentToDecision(trip.id, 'no-such-decision', 'hello')
    expect(unknown.status).toBe('invalid')
    expect(commentCommands()).toHaveLength(0)
  })
})
