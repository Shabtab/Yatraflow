// ============ Stage A repair gate (round 2) — maintained probes ============
//
// Ports the parent gate's round-2 behavioral probes into the maintained suite
// and broadens them to the decision path. The fake server implements the
// contract semantics the probes rely on: a command ledger keyed by id (replay
// answers alreadyApplied with the STORED receipt, artifact ids included),
// canonical snake_case rows in receipts, camelCase tripRevision, server-side
// activity/notification creation, and holdable RPC + SELECT transports so a
// test can interleave real writer calls.
//
// Premises are the gate's own and are not weakened: every test drives the
// real store writers and the real receipt parser; only the transport,
// persistence and session are synthetic.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type CommentRow = { id: string; authorId: string; text: string; createdAt: number }
type SuggestionRow = {
  id: string; trip_id: string; day_index: number; proposed_by: string; title: string
  category: 'food'; location_name: string; lat: number; lng: number; description: null
  visit_minutes: number; estimated_entry_fee_inr: number; estimated_transport_inr: number
  votes: []; comments: CommentRow[]; status: 'open'; created_at: number
}
type DecisionRow = {
  id: string; trip_id: string; question: string; context: null
  options: Array<{ id: string; label: string }>; votes_by_user_id: Record<string, string>
  comments: CommentRow[]; status: 'open'; raised_by: string; created_at: number
}
type Command = { type: 'suggestion.comment'; suggestionId: string; commentId: string; text: string }
  | { type: 'decision.comment'; decisionId: string; commentId: string; text: string }
  | { type: 'activity.append'; activityId: string; verb: string; target?: string }
type Params = { p_command_id: string; p_trip_id: string; p_command: Command }
type Receipt = { status: string; tripRevision: number; suggestion?: SuggestionRow; decision?: DecisionRow; activityId?: string; notificationIds?: string[] }
type Response = { data: Receipt | SuggestionRow | DecisionRow | null; error: { message: string } | null }

const { fake } = vi.hoisted(() => {
  const fake = {
    actor: '10000000-0000-4000-8000-000000000001',
    trip: '20000000-0000-4000-8000-000000000001',
    rows: new Map<string, SuggestionRow>(),
    decisionRows: new Map<string, DecisionRow>(),
    ledger: new Map<string, { params: Params; receipt: Receipt }>(),
    activity: [] as { id: string; tripId: string; text: string }[],
    notifications: [] as { id: string; userId: string }[],
    calls: [] as Params[],
    reads: [] as { table: string; id?: string }[],
    held: [] as { params: Params; resolve: (r: Response) => void }[],
    selects: [] as { snapshot: SuggestionRow | DecisionRow | null; resolve: (r: Response) => void }[],
    hold: false,
    holdSelect: false,
    loseAfterCommit: false,
    conflict: false,
    readError: false,
    reset() {
      fake.rows.clear(); fake.decisionRows.clear(); fake.ledger.clear()
      fake.activity = []; fake.notifications = []
      fake.calls = []; fake.reads = []; fake.held = []; fake.selects = []
      fake.hold = false; fake.holdSelect = false; fake.loseAfterCommit = false
      fake.conflict = false; fake.readError = false
    },
    apply(params: Params): Response {
      const c = params.p_command
      const prior = fake.ledger.get(params.p_command_id)
      if (prior) {
        if (JSON.stringify(prior.params) !== JSON.stringify(params)) return { data: { status: 'conflict', tripRevision: 0 }, error: null }
        const canonical = c.type === 'suggestion.comment' ? { suggestion: structuredClone(fake.rows.get(c.suggestionId)!) }
          : c.type === 'decision.comment' ? { decision: structuredClone(fake.decisionRows.get(c.decisionId)!) }
          : {}
        return { data: { ...structuredClone(prior.receipt), status: 'alreadyApplied', ...canonical }, error: null }
      }
      if (fake.conflict) return { data: { status: 'conflict', tripRevision: 7 }, error: null }
      const activityId = c.type === 'activity.append' ? c.activityId : crypto.randomUUID()
      const notificationIds: string[] = []
      let suggestionRow: SuggestionRow | undefined
      let decisionRow: DecisionRow | undefined
      if (c.type === 'suggestion.comment') {
        suggestionRow = structuredClone(fake.rows.get(c.suggestionId)!)
        if (suggestionRow.comments.some(x => x.id === c.commentId)) return { data: { status: 'conflict', tripRevision: 0 }, error: null }
        suggestionRow.comments.push({ id: c.commentId, authorId: fake.actor, text: c.text, createdAt: 1 })
        fake.rows.set(suggestionRow.id, suggestionRow)
        const nid = crypto.randomUUID()
        notificationIds.push(nid)
        fake.notifications.push({ id: nid, userId: suggestionRow.proposed_by })
      }
      if (c.type === 'decision.comment') {
        decisionRow = structuredClone(fake.decisionRows.get(c.decisionId)!)
        if (decisionRow.comments.some(x => x.id === c.commentId)) return { data: { status: 'conflict', tripRevision: 0 }, error: null }
        decisionRow.comments.push({ id: c.commentId, authorId: fake.actor, text: c.text, createdAt: 1 })
        fake.decisionRows.set(decisionRow.id, decisionRow)
        const nid = crypto.randomUUID()
        notificationIds.push(nid)
        fake.notifications.push({ id: nid, userId: decisionRow.raised_by })
      }
      fake.activity.push({ id: activityId, tripId: params.p_trip_id, text: c.type === 'activity.append' ? c.verb : c.text })
      const receipt: Receipt = { status: 'applied', tripRevision: 0, activityId, notificationIds,
        ...(suggestionRow ? { suggestion: structuredClone(suggestionRow) } : {}),
        ...(decisionRow ? { decision: structuredClone(decisionRow) } : {}) }
      fake.ledger.set(params.p_command_id, { params: structuredClone(params), receipt: structuredClone(receipt) })
      return { data: receipt, error: null }
    },
    rpc(params: Params): Promise<Response> {
      fake.calls.push(structuredClone(params))
      if (fake.hold) return new Promise(resolve => fake.held.push({ params: structuredClone(params), resolve }))
      const response = fake.apply(params)
      if (fake.loseAfterCommit) {
        fake.loseAfterCommit = false
        return Promise.reject(new Error('synthetic transport lost committed response'))
      }
      return Promise.resolve(response)
    },
    read(table: string, id?: string): Promise<Response> {
      fake.reads.push({ table, id })
      if (fake.readError) return Promise.resolve({ data: null, error: { message: 'synthetic read failure' } })
      const row = table === 'suggestions' ? fake.rows.get(id ?? '')
        : table === 'decisions' ? fake.decisionRows.get(id ?? '')
        : undefined
      const snapshot = row ? structuredClone(row) : null
      if (fake.holdSelect) return new Promise(resolve => fake.selects.push({ snapshot, resolve }))
      return Promise.resolve({ data: snapshot, error: null })
    },
  }
  return { fake }
})

vi.mock('../src/components/ui', () => ({ toast: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (name: string, params: Parameters<typeof fake.rpc>[0]) => name === 'submit_collab_command'
      ? fake.rpc(params) : Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      let id: string | undefined
      const qb = {
        select: () => qb,
        eq: (column: string, value: string) => { if (column === 'id') id = value; return qb },
        maybeSingle: () => fake.read(table, id),
        then: <T, U>(resolve: (r: Awaited<ReturnType<typeof fake.read>>) => T, reject?: (e: unknown) => U) => fake.read(table, id).then(resolve, reject),
      }
      return qb
    },
    auth: { getSession: async () => ({ data: { session: { user: { id: fake.actor }, access_token: 'synthetic' } }, error: null }) },
  },
}))

const S1 = '30000000-0000-4000-8000-000000000001'
const S2 = '30000000-0000-4000-8000-000000000002'
const D1 = '40000000-0000-4000-8000-000000000001'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

async function freshStore() {
  vi.resetModules()
  fake.reset()
  const store = await import('../src/store/store')
  const { suggestionRowToEntry, decisionRowToEntry } = await import('../src/store/collabCommand')
  const db = store.getSnapshot()
  db.sessionUserId = fake.actor
  db.trips.push({ id: fake.trip, title: 'Synthetic trip', destination: 'Synthetic',
    startDate: '2026-10-23', endDate: '2026-10-23', attendees: 2, ownerId: fake.actor,
    writeVersion: 0, members: [{ userId: fake.actor, role: 'owner', joinedAt: 1 }],
    days: [{ index: 0, date: '2026-10-23', label: 'Day 1', stops: [] }], expenses: [], collaborators: [],
  } as Parameters<typeof db.trips.push>[0])
  for (const id of [S1, S2]) {
    const row = { id, trip_id: fake.trip, day_index: 0, proposed_by: '10000000-0000-4000-8000-000000000002',
      title: id === S1 ? 'First row' : 'Independent row', category: 'food' as const, location_name: 'Synthetic',
      lat: 12, lng: 77, description: null, visit_minutes: 30, estimated_entry_fee_inr: 0,
      estimated_transport_inr: 0, votes: [] as [], comments: [] as CommentRow[], status: 'open' as const, created_at: 1 }
    fake.rows.set(id, row)
    db.suggestions.push(suggestionRowToEntry(structuredClone(row)))
  }
  const decisionRow = { id: D1, trip_id: fake.trip, question: 'Where to eat?', context: null,
    options: [{ id: 'opt-1', label: 'Time Out' }], votes_by_user_id: {}, comments: [] as CommentRow[],
    status: 'open' as const, raised_by: '10000000-0000-4000-8000-000000000002', created_at: 1 }
  fake.decisionRows.set(D1, decisionRow)
  db.decisions.push(decisionRowToEntry(structuredClone(decisionRow)))
  return store
}

beforeEach(() => vi.clearAllMocks())

describe('gate round 2 — F1 surgical rollback', () => {
  it('control: exact command replay commits one comment and retains canonical receipt fields', async () => {
    await freshStore()
    const { submitCollabCommand } = await import('../src/store/collabCommand')
    const id = crypto.randomUUID()
    const command = { type: 'suggestion.comment' as const, suggestionId: S1, commentId: 'stable-control', text: 'control' }
    expect((await submitCollabCommand(id, fake.trip, command)).status).toBe('applied')
    const replay = await submitCollabCommand(id, fake.trip, command)
    expect(replay.status).toBe('alreadyApplied')
    expect(replay.suggestion?.comments.map(c => c.text)).toEqual(['control'])
    expect(fake.activity).toHaveLength(1)
    expect(fake.notifications).toHaveLength(1)
  })

  it('rollback preserves a later successful comment, activity and notification on another row', async () => {
    const store = await freshStore()
    fake.hold = true
    const earlier = store.addCommentToSuggestion(fake.trip, S1, 'will fail')
    const later = store.addCommentToSuggestion(fake.trip, S2, 'must survive')
    expect(fake.held).toHaveLength(2)
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    expect((await later).status).toBe('applied')
    const successful = store.getSnapshot().suggestions.find(x => x.id === S2)!
    expect(successful.comments.map(c => c.text)).toEqual(['must survive'])
    const successfulActivity = fake.activity[0].id
    const successfulNotification = fake.notifications[0].id
    // The successful command's canonical artifact ids are adopted, not just
    // its row: the echo must upsert the same rows instead of duplicating.
    expect(store.getSnapshot().activity.some(a => a.id === successfulActivity)).toBe(true)
    expect(store.getSnapshot().notifications.some(n => n.id === successfulNotification)).toBe(true)
    fake.held[0].resolve({ data: null, error: { message: 'synthetic unavailable before commit' } })
    expect((await earlier).status).toBe('unavailable')
    const db = store.getSnapshot()
    // The failed operation retracts only ITS OWN entries: the later comment,
    // activity and notification on the independent row all survive.
    expect(db.suggestions.find(x => x.id === S2)!.comments.map(c => c.text)).toEqual(['must survive'])
    expect(db.activity.some(a => a.id === successfulActivity)).toBe(true)
    expect(db.notifications.some(n => n.id === successfulNotification)).toBe(true)
    // The failed attempt's own activity entry is gone (B's canonical entry,
    // same verb by design, stays — exactly one commented entry remains).
    expect(db.activity.filter(a => a.verb === 'commented on a suggestion')).toHaveLength(1)
    // And the failed attempt's row residue is gone.
    expect(db.suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toEqual([])
  })

  it('standalone activity rollback preserves a later successful append', async () => {
    const store = await freshStore()
    fake.hold = true
    const earlier = store.addActivity(fake.trip, 'will fail')
    const later = store.addActivity(fake.trip, 'must survive')
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    expect((await later).status).toBe('applied')
    const successId = fake.activity[0].id
    expect(store.getSnapshot().activity.some(a => a.id === successId)).toBe(true)
    fake.held[0].resolve({ data: null, error: { message: 'synthetic unavailable' } })
    expect((await earlier).status).toBe('unavailable')
    expect(store.getSnapshot().activity.some(a => a.id === successId)).toBe(true)
  })

  it('a failed decision comment preserves later suggestion work (broadened path)', async () => {
    const store = await freshStore()
    fake.hold = true
    const failing = store.addCommentToDecision(fake.trip, D1, 'decision ghost')
    const surviving = store.addCommentToSuggestion(fake.trip, S1, 'suggestion survives')
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    expect((await surviving).status).toBe('applied')
    fake.held[0].resolve({ data: null, error: { message: 'synthetic unavailable' } })
    expect((await failing).status).toBe('unavailable')
    const db = store.getSnapshot()
    expect(db.suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toEqual(['suggestion survives'])
    expect(db.decisions.find(x => x.id === D1)!.comments.map(c => c.text)).toEqual([])
  })
})

describe('gate round 2 — F2 the writer retry keeps one identity', () => {
  it('a real comment writer retry reuses the envelope after a committed response is lost', async () => {
    const store = await freshStore()
    fake.loseAfterCommit = true
    const first = await store.addCommentToSuggestion(fake.trip, S1, 'same intended comment')
    expect(first.status).toBe('unavailable')
    // The server committed; the client confirmed nothing and rolled back.
    expect(fake.rows.get(S1)!.comments).toHaveLength(1)
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments).toHaveLength(0)

    const second = await store.addCommentToSuggestion(fake.trip, S1, 'same intended comment')
    expect(second.status).toBe('alreadyApplied')
    // The retry replayed the SAME command id and payload — one server copy.
    expect(fake.calls[1].p_command_id).toBe(fake.calls[0].p_command_id)
    expect(fake.calls[1].p_command).toEqual(fake.calls[0].p_command)
    expect(fake.rows.get(S1)!.comments).toHaveLength(1)
    expect(fake.activity).toHaveLength(1)
    expect(fake.notifications).toHaveLength(1)
    // The canonical row (and its one comment) is back on screen.
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text))
      .toEqual(['same intended comment'])
  })

  it('a retried decision comment keeps one copy too (broadened path)', async () => {
    const store = await freshStore()
    fake.loseAfterCommit = true
    const first = await store.addCommentToDecision(fake.trip, D1, 'poll note')
    expect(first.status).toBe('unavailable')
    const second = await store.addCommentToDecision(fake.trip, D1, 'poll note')
    expect(second.status).toBe('alreadyApplied')
    expect(fake.calls[1].p_command_id).toBe(fake.calls[0].p_command_id)
    expect(fake.decisionRows.get(D1)!.comments).toHaveLength(1)
    expect(fake.activity).toHaveLength(1)
    expect(fake.notifications).toHaveLength(1)
  })

  it('a settled action frees the slot: the same text again is a NEW action with a NEW id', async () => {
    const store = await freshStore()
    const first = await store.addCommentToSuggestion(fake.trip, S1, 'deliberate repeat')
    expect(first.status).toBe('applied')
    const second = await store.addCommentToSuggestion(fake.trip, S1, 'deliberate repeat')
    expect(second.status).toBe('applied')
    // No over-deduplication: two intentional actions, two ids, two copies.
    expect(fake.calls[1].p_command_id).not.toBe(fake.calls[0].p_command_id)
    expect(fake.rows.get(S1)!.comments).toHaveLength(2)
  })

  it('a pending envelope never crosses to another account', async () => {
    const store = await freshStore()
    fake.hold = true
    const first = store.addCommentToSuggestion(fake.trip, S1, 'held for user-a')
    await tick()
    ;(store.getSnapshot() as any).sessionUserId = '10000000-0000-4000-8000-000000000009'
    const second = store.addCommentToSuggestion(fake.trip, S1, 'held for user-a')
    await tick()
    // A different user's identical call is a different logical action: its
    // command id and payload are its own.
    expect(fake.calls[1].p_command_id).not.toBe(fake.calls[0].p_command_id)
    expect(fake.calls[1].p_command).not.toEqual(fake.calls[0].p_command)
    fake.held[0].resolve({ data: null, error: { message: 'synthetic unavailable' } })
    fake.held[1].resolve({ data: null, error: { message: 'synthetic unavailable' } })
    expect((await first).status).toBe('unavailable')
    expect((await second).status).toBe('unavailable')
  })
})

describe('gate round 2 — F3 fenced recovery reads', () => {
  it('a delayed recovery SELECT cannot overwrite a newer canonical row', async () => {
    const store = await freshStore()
    fake.hold = true
    const old = store.addCommentToSuggestion(fake.trip, S1, 'older')
    const oldResponse = fake.apply(fake.held[0].params)
    const db = store.getSnapshot()
    // A peer replacement moves the row while the receipt is in flight — the
    // receipt is then correctly stale, and recovery starts.
    db.suggestions = db.suggestions.map(x => x.id === S1 ? { ...x, title: 'peer replacement triggers recovery' } : x)
    fake.holdSelect = true
    fake.held[0].resolve(oldResponse)
    expect((await old).status).toBe('applied')
    expect(fake.selects).toHaveLength(1)
    expect((fake.selects[0].snapshot as SuggestionRow).comments.map(c => c.text)).toEqual(['older'])
    fake.hold = false
    expect((await store.addCommentToSuggestion(fake.trip, S1, 'newer')).status).toBe('applied')
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toEqual(['older', 'newer'])
    // The earlier SELECT snapshot arrives late: it is stale against the row
    // generation captured at dispatch, so it must be discarded.
    fake.selects[0].resolve({ data: fake.selects[0].snapshot, error: null })
    await tick()
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toEqual(['older', 'newer'])
  })
})

describe('gate round 2 — F4 conflict reconciles and preserves the draft', () => {
  it('a conflict keeps the draft, drops uncreated artifacts and starts authoritative reads', async () => {
    const store = await freshStore()
    fake.conflict = true
    const outcome = await store.addCommentToSuggestion(fake.trip, S1, 'keep draft')
    expect(outcome).toEqual({ status: 'conflict', tripRevision: 7 })
    await tick()
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toEqual(['keep draft'])
    expect(store.getSnapshot().activity).toHaveLength(0)
    expect(store.getSnapshot().notifications).toHaveLength(0)
    // The feedback says the latest version is loading — reads must back it.
    expect(fake.reads.length).toBeGreaterThan(0)
  })

  it('a successful reconciliation lands the canonical row and keeps the unresolved draft', async () => {
    const store = await freshStore()
    fake.conflict = true
    // The crew had already spoken on the server before this command was
    // refused: the authoritative row carries their comment.
    fake.rows.get(S1)!.comments.push({ id: 'cm_peer', authorId: '10000000-0000-4000-8000-000000000002', text: 'peer voice', createdAt: 2 })
    const outcome = await store.addCommentToSuggestion(fake.trip, S1, 'keep draft')
    expect(outcome.status).toBe('conflict')
    await tick()
    // The reconciliation read landed the canonical row AND the server has no
    // copy of the refused comment, so the unresolved draft stays attached.
    const cached = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(cached.comments.map(c => c.text)).toEqual(['peer voice', 'keep draft'])
  })

  it('a failed reconciliation read leaves the draft exactly as it was', async () => {
    const store = await freshStore()
    fake.conflict = true
    fake.readError = true
    const outcome = await store.addCommentToSuggestion(fake.trip, S1, 'keep draft')
    expect(outcome.status).toBe('conflict')
    await tick()
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toEqual(['keep draft'])
  })

  it('a conflict never advances the client trip CAS from the receipt revision', async () => {
    const store = await freshStore()
    fake.conflict = true
    await store.addCommentToSuggestion(fake.trip, S1, 'ack only')
    await tick()
    const trip = store.getSnapshot().trips.find(t => t.id === fake.trip) as { writeVersion: number }
    expect(trip.writeVersion).toBe(0)
  })
})
