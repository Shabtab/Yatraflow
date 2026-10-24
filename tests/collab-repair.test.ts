// ============ Stage A repair gate (rounds 2-5) — maintained probes ============
//
// Ports the parent gate's behavioral probes into the maintained suite and
// broadens them to the decision path. The fake server implements the contract
// semantics the probes rely on: a command ledger keyed by id (replay answers
// alreadyApplied with the STORED receipt, artifact ids included), canonical
// snake_case rows in receipts, camelCase tripRevision, server-side
// activity/notification creation, holdable RPC + SELECT transports, and a
// A consistent query builder (setHeader, eq on any column, limit, trips and
// membership reads) so the trip-reconciliation fetch really executes through
// admission.
//
// Premises are the gate's own and are not weakened: every test drives the
// real store writers, the real receipt parser, the real admission path and
// the real realtime dispatch; only the transport, persistence and session are
// synthetic.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type CommentRow = { id: string; authorId: string; text: string; createdAt: number }
type SuggestionRow = {
  id: string; trip_id: string; day_index: number; proposed_by: string; title: string
  category: 'food'; location_name: string; lat: number; lng: number; description: null
  visit_minutes: number; estimated_entry_fee_inr: number; estimated_transport_inr: number
  votes: Array<{ userId: string; value: number; createdAt: number }>; comments: CommentRow[]
  status: 'open'; created_at: number
}
type DecisionRow = {
  id: string; trip_id: string; question: string; context: null
  options: Array<{ id: string; label: string }>; votes_by_user_id: Record<string, string>
  comments: CommentRow[]; status: 'open'; raised_by: string; created_at: number
}
type Command = { type: 'suggestion.comment'; suggestionId: string; commentId: string; text: string }
  | { type: 'decision.comment'; decisionId: string; commentId: string; text: string }
  | { type: 'suggestion.ballot'; suggestionId: string; value: 1 | -1 | null }
  | { type: 'decision.ballot'; decisionId: string; optionId: string | null }
  | { type: 'decision.create'; decisionId: string; decision: { question: string; context?: string; options: Array<{ id: string; label: string }> } }
  | { type: 'activity.append'; activityId: string; verb: string; target?: string }
type Params = { p_command_id: string; p_trip_id: string; p_command: Command }
type Receipt = { status: string; tripRevision: number; suggestion?: SuggestionRow; decision?: DecisionRow; activityId?: string; notificationIds?: string[] }
type Response = { data: Receipt | SuggestionRow | DecisionRow | unknown[] | null; error: { message: string } | null }

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
    reads: [] as { table: string; id?: string; tripId?: string }[],
    held: [] as { params: Params; resolve: (r: Response) => void }[],
    selects: [] as { snapshot: SuggestionRow | DecisionRow | null; resolve: (r: Response) => void }[],
    hold: false,
    holdSelect: false,
    loseAfterCommit: false,
    conflict: false,
    readError: false,
    /** A coherent authoritative trips row for the admission path, and the
     *  membership row admission needs. Null = the read answers empty. */
    tripsRow: null as Record<string, unknown> | null,
    membersRow: null as Record<string, unknown> | null,
    tripUpdateFails: false,
    tripUpdates: [] as Array<Record<string, unknown>>,
    reset() {
      fake.rows.clear(); fake.decisionRows.clear(); fake.ledger.clear()
      fake.activity = []; fake.notifications = []
      fake.calls = []; fake.reads = []; fake.held = []; fake.selects = []
      fake.hold = false; fake.holdSelect = false; fake.loseAfterCommit = false
      fake.conflict = false; fake.readError = false
      fake.tripsRow = null; fake.membersRow = null; fake.tripUpdateFails = false
      fake.tripUpdates = []
    },
    apply(params: Params): Response {
      const c = params.p_command
      const prior = fake.ledger.get(params.p_command_id)
      if (prior) {
        if (JSON.stringify(prior.params) !== JSON.stringify(params)) return { data: { status: 'conflict', tripRevision: 0 }, error: null }
        const canonical = c.type.startsWith('suggestion.') ? { suggestion: structuredClone(fake.rows.get(c.suggestionId)!) }
          : c.type.startsWith('decision.') && c.type !== 'decision.create' ? { decision: structuredClone(fake.decisionRows.get(c.decisionId)!) }
          : c.type === 'decision.create' ? { decision: structuredClone(fake.decisionRows.get(c.decisionId)!) }
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
      if (c.type === 'suggestion.ballot') {
        suggestionRow = structuredClone(fake.rows.get(c.suggestionId)!)
        const votes = suggestionRow.votes.filter(v => v.userId !== fake.actor)
        if (c.value !== null) votes.push({ userId: fake.actor, value: c.value, createdAt: 1 })
        suggestionRow.votes = votes
        fake.rows.set(suggestionRow.id, suggestionRow)
      }
      if (c.type === 'decision.create') {
        if (fake.decisionRows.has(c.decisionId)) return { data: { status: 'conflict', tripRevision: 0 }, error: null }
        decisionRow = {
          id: c.decisionId, trip_id: params.p_trip_id, question: c.decision.question, context: null,
          options: structuredClone(c.decision.options), votes_by_user_id: {}, comments: [],
          status: 'open', raised_by: fake.actor, created_at: 1,
        }
        fake.decisionRows.set(decisionRow.id, decisionRow)
        const nid = crypto.randomUUID()
        notificationIds.push(nid)
        fake.notifications.push({ id: nid, userId: 'peer' })
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
      if (c.type === 'decision.ballot') {
        decisionRow = structuredClone(fake.decisionRows.get(c.decisionId)!)
        if (c.optionId !== null) decisionRow.votes_by_user_id[fake.actor] = c.optionId
        else delete decisionRow.votes_by_user_id[fake.actor]
        fake.decisionRows.set(decisionRow.id, decisionRow)
      }
      fake.activity.push({ id: activityId, tripId: params.p_trip_id, text: c.type === 'activity.append' ? c.verb : c.type })
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
    read(table: string, eqs: Record<string, unknown>, single = false): Promise<Response> {
      fake.reads.push({ table, id: eqs.id as string | undefined, tripId: eqs.trip_id as string | undefined })
      if (fake.readError) return Promise.resolve({ data: null, error: { message: 'synthetic read failure' } })
      const row = table === 'suggestions' ? fake.rows.get(String(eqs.id ?? ''))
        : table === 'decisions' ? fake.decisionRows.get(String(eqs.id ?? ''))
        : table === 'trips' ? (fake.tripsRow && fake.tripsRow.id === eqs.id ? fake.tripsRow : null)
        : null
      const snapshot = row ? structuredClone(row) : null
      if (fake.holdSelect) return new Promise(resolve => fake.selects.push({ snapshot: snapshot as SuggestionRow | DecisionRow | null, resolve }))
      // A plain select (no maybeSingle) answers a LIST, as PostgREST does —
      // the membership reads in the admission and write paths need their
      // own shapes: the list read feeds admission, the maybeSingle read feeds
      // the queued-write membership check.
      if (table === 'trip_members') {
        const match = fake.membersRow && fake.membersRow.trip_id === eqs.trip_id
        return Promise.resolve({ data: single ? (match ? structuredClone(fake.membersRow) : null) : (match ? [structuredClone(fake.membersRow)] : []), error: null })
      }
      return Promise.resolve({ data: snapshot, error: null })
    },
    /** The trips UPDATE, so a queued-edit test can fail it for real. Every
     *  try is recorded, so a test can prove the UPDATE was reached. */
    updateTrips(eqs: Record<string, unknown>): Response {
      fake.tripUpdates.push(structuredClone(eqs))
      if (fake.tripUpdateFails) return { data: null, error: { message: 'synthetic trips write failure' } }
      return { data: [{ id: eqs.id, updated_at: 2, write_version: Number(eqs.write_version ?? 0) + 1 }], error: null }
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
      const eqs: Record<string, unknown> = {}
      let method: 'select' | 'update' | 'insert' = 'select'
      const qb = {
        select: () => qb,
        update: () => { method = 'update'; return qb },
        insert: () => { method = 'insert'; return qb },
        eq: (column: string, value: unknown) => { eqs[column] = value; return qb },
        is: () => qb,
        limit: () => qb,
        setHeader: () => qb,
        maybeSingle: () => fake.read(table, eqs, true),
        then: <T, U>(resolve: (r: Response) => T, reject?: (e: unknown) => U) =>
          (method === 'update' && table === 'trips' ? Promise.resolve(fake.updateTrips(eqs)) : fake.read(table, eqs)).then(resolve, reject),
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

/** A coherent authoritative trips row (the shape admission needs), at the
 *  revision the test wants the server to observe. */
function authoritativeTripsRow(tripId: string, ownerId: string, writeVersion: number): Record<string, unknown> {
  return {
    id: tripId, owner_id: ownerId, name: 'Synthetic trip', start_location: 'Kochi',
    start_location_coords: null, destinations: ['Kochi'], destination_coords: null,
    start_date: '2026-10-23', end_date: '2026-10-25', travellers: 2,
    transport_mode: 'car', budget_per_person_inr: 10000, travel_style: 'balanced',
    fixed_commitments: [], days: [], expenses: [], cover_emoji: '🧭', invite_code: null,
    visibility: 'private', created_at: 1_700_000_000_000, updated_at: 1_700_000_000_050,
    write_version: writeVersion, deleted_at: null,
    flights: [], tank_l: null, rent_per_day_inr: null, local_train: null, ref: null,
    fuel_economy_km_per_l: null, fuel_price_per_l: null, round_trip: null,
    cover_image_url: null, stay_style: null, driver_count: null, has_vulnerable: null,
    drive_after_dinner_min: null, vehicle_profile: null,
  }
}

async function freshStore() {
  vi.resetModules()
  fake.reset()
  const store = await import('../src/store/store')
  const { suggestionRowToEntry, decisionRowToEntry } = await import('../src/store/collabCommand')
  const db = store.getSnapshot()
  db.sessionUserId = fake.actor
  db.trips.push({ id: fake.trip, title: 'Synthetic trip', destination: 'Synthetic',
    startDate: '2026-10-23', endDate: '2026-10-23', attendees: 2, ownerId: fake.actor,
    writeVersion: 0, budgetPerPersonInr: 10000, members: [{ userId: fake.actor, role: 'owner', joinedAt: 1 }],
    days: [{ index: 0, date: '2026-10-23', label: 'Day 1', stops: [] }], expenses: [], collaborators: [],
  } as Parameters<typeof db.trips.push>[0])
  for (const id of [S1, S2]) {
    const row = { id, trip_id: fake.trip, day_index: 0, proposed_by: '10000000-0000-4000-8000-000000000002',
      title: id === S1 ? 'First row' : 'Independent row', category: 'food' as const, location_name: 'Synthetic',
      lat: 12, lng: 77, description: null, visit_minutes: 30, estimated_entry_fee_inr: 0,
      estimated_transport_inr: 0, votes: [] as SuggestionRow['votes'], comments: [] as CommentRow[], status: 'open' as const, created_at: 1 }
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

/** Admit a server row through the real realtime dispatch, so the cache row
 *  the writers clone is the same object a live peer event would produce. */
function admitRow(store: Awaited<ReturnType<typeof freshStore>>, table: 'suggestions' | 'decisions', row: Record<string, unknown>): void {
  store._applyRealtimeEventForTest(table, {
    eventType: 'UPDATE', schema: 'public', table,
    commit_timestamp: new Date().toISOString(), old: { id: (row as { id: string }).id }, new: structuredClone(row),
  } as Parameters<typeof store._applyRealtimeEventForTest>[1])
}

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
    // The failed try's own activity entry is gone (B's canonical entry,
    // same verb by design, stays — exactly one commented entry remains).
    expect(db.activity.filter(a => a.verb === 'commented on a suggestion')).toHaveLength(1)
    // And the failed try's row residue is gone.
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

describe('gate round 3 — R1 the poll retry keeps the retained action', () => {
  it('a poll retry without caller option ids replays the first command and creates one poll', async () => {
    const store = await freshStore()
    const draft = { question: 'Which meal?', options: [{ label: 'A' }, { label: 'B' }] }
    fake.hold = true
    const first = store.addDecision(fake.trip, structuredClone(draft))
    await tick()
    expect(fake.held).toHaveLength(1)
    // The command commits, but the response is lost on the wire.
    const committed = fake.apply(fake.held[0].params)
    fake.held[0].resolve({ data: null, error: { message: 'lost response after commit' } })
    expect((await first).status).toBe('unavailable')
    // One poll beyond the seeded D1 fixture: the lost response committed
    // exactly one.
    expect(fake.decisionRows.size).toBe(2)

    fake.hold = false
    const second = await store.addDecision(fake.trip, structuredClone(draft))
    // The replay control: the retained command id answers alreadyApplied.
    const { submitCollabCommand } = await import('../src/store/collabCommand')
    const retained = fake.calls[0]
    const control = await submitCollabCommand(retained.p_command_id, retained.p_trip_id, retained.p_command)
    expect(control.status).toBe('alreadyApplied')
    expect(control.decision!.id).toBe((committed.data as Receipt).decision!.id)
    // The retry REPLAYED the retained envelope: same command id, same payload
    // (including the option ids minted inside the first action), one poll.
    expect(second.status).toBe('alreadyApplied')
    expect(fake.calls[1].p_command_id).toBe(fake.calls[0].p_command_id)
    expect(fake.calls[1].p_command).toEqual(fake.calls[0].p_command)
    expect(fake.decisionRows.size).toBe(2)
    expect(fake.activity).toHaveLength(1)
    expect(fake.notifications).toHaveLength(1)
  })

  it('caller-supplied option ids are preserved and a settled repeat mints a new poll', async () => {
    const store = await freshStore()
    // The Map rail's slot ids are load-bearing: they must survive into the
    // command exactly as supplied.
    const outcome = await store.addDecision(fake.trip, {
      question: 'Day 1 lunch - where?', context: 'Voting from the day plan',
      options: [{ id: 'slot:lunch:h1', label: 'Grand Hotel' }, { id: 'slot:lunch:h2', label: 'Halais' }],
    })
    expect(outcome.status).toBe('applied')
    const sent = (fake.calls[0].p_command as Extract<Command, { type: 'decision.create' }>)
    expect(sent.decision.options.map(o => o.id)).toEqual(['slot:lunch:h1', 'slot:lunch:h2'])
    // The envelope freed on applied: the SAME form again is a NEW poll.
    const second = await store.addDecision(fake.trip, {
      question: 'Day 1 lunch - where?', context: 'Voting from the day plan',
      options: [{ id: 'slot:lunch:h1', label: 'Grand Hotel' }, { id: 'slot:lunch:h2', label: 'Halais' }],
    })
    expect(second.status).toBe('applied')
    expect(fake.calls[1].p_command_id).not.toBe(fake.calls[0].p_command_id)
    expect(fake.calls[1].p_command).not.toEqual(fake.calls[0].p_command)
    expect(fake.decisionRows.size).toBe(3)
  })
})

describe('gate round 3 — R2 ballot ownership', () => {
  it('a ballot refused after a concurrent comment retracts the ghost vote and keeps the comment', async () => {
    const store = await freshStore()
    fake.hold = true
    const vote = store.voteSuggestion(fake.trip, S1, 1)
    await tick()
    const comment = store.addCommentToSuggestion(fake.trip, S1, 'new local work')
    await tick()
    expect(fake.held).toHaveLength(2)
    // The comment's optimistic clone inherited the upvote; the server never
    // got the ballot.
    fake.held[0].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await vote).status).toBe('forbidden')
    const cached = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(cached.votes).toEqual([])
    expect(cached.comments.map(c => c.text)).toEqual(['new local work'])
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    expect((await comment).status).toBe('applied')
  })

  it('a lost-response vote retry replays value 1 under the same command id and keeps the vote', async () => {
    const store = await freshStore()
    fake.hold = true
    const vote = store.voteSuggestion(fake.trip, S1, 1)
    await tick()
    // The upvote commits; the response is lost. A concurrent comment's clone
    // is holding the optimistic vote when the failure lands.
    fake.apply(fake.held[0].params)
    const comment = store.addCommentToSuggestion(fake.trip, S1, 'new local work')
    await tick()
    fake.held[0].resolve({ data: null, error: { message: 'lost after commit' } })
    expect((await vote).status).toBe('unavailable')
    // The ghost is retracted, so the retry derives a SET again — never a
    // removal — and the retained envelope replays the original value.
    fake.hold = false
    const retry = await store.voteSuggestion(fake.trip, S1, 1)
    expect(fake.calls[2].p_command_id).toBe(fake.calls[0].p_command_id)
    expect((fake.calls[2].p_command as Extract<Command, { type: 'suggestion.ballot' }>).value).toBe(1)
    expect(fake.calls[2].p_command).toEqual(fake.calls[0].p_command)
    expect(retry.status).toBe('alreadyApplied')
    expect(fake.rows.get(S1)!.votes).toEqual([{ userId: fake.actor, value: 1, createdAt: 1 }])
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    await comment
  })

  it('a later intentional ballot supersedes the refused one', async () => {
    const store = await freshStore()
    fake.hold = true
    const first = store.voteSuggestion(fake.trip, S1, 1)
    await tick()
    // The actor intentionally changes their mind while the first vote is
    // uncertain: the second operation owns the entry now.
    const second = store.voteSuggestion(fake.trip, S1, -1)
    await tick()
    expect(fake.held).toHaveLength(2)
    fake.held[0].resolve({ data: null, error: { message: 'synthetic unavailable' } })
    expect((await first).status).toBe('unavailable')
    // The refused operation must NOT retract the newer intentional ballot.
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.votes)
      .toEqual([{ userId: fake.actor, value: -1, createdAt: expect.any(Number) }])
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    expect((await second).status).toBe('applied')
  })

  it('a refused decision ballot retracts its ghost too (broadened path)', async () => {
    const store = await freshStore()
    fake.hold = true
    const vote = store.voteOnDecision(D1, 'opt-1')
    await tick()
    const comment = store.addCommentToDecision(fake.trip, D1, 'poll note')
    await tick()
    fake.held[0].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await vote).status).toBe('forbidden')
    const cached = store.getSnapshot().decisions.find(x => x.id === D1)!
    expect(cached.votesByUserId).toEqual({})
    expect(cached.comments.map(c => c.text)).toEqual(['poll note'])
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    expect((await comment).status).toBe('applied')
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

describe('gate round 2-3 — F4/C1 conflict reconciliation and the unresolved draft', () => {
  it('a conflict keeps the draft, drops uncreated artifacts and starts authoritative reads', async () => {
    const store = await freshStore()
    fake.conflict = true
    const outcome = await store.addCommentToSuggestion(fake.trip, S1, 'keep draft')
    expect(outcome).toEqual({ status: 'conflict', tripRevision: 7 })
    await tick()
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toEqual(['keep draft'])
    expect(store.getSnapshot().activity).toHaveLength(0)
    expect(store.getSnapshot().notifications).toHaveLength(0)
    // The feedback says the latest version is loading — reads must back it,
    // including the trip revision reconciliation.
    const tables = fake.reads.map(r => r.table)
    expect(tables).toContain('suggestions')
    expect(tables).toContain('trips')
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

  it('the receipt never advances the trip CAS directly; the reconciliation admits the authoritative revision', async () => {
    const store = await freshStore()
    fake.conflict = true
    // The server's authoritative trip, at the revision the receipt observed.
    fake.tripsRow = authoritativeTripsRow(fake.trip, fake.actor, 7)
    fake.membersRow = { id: 'tm-1', trip_id: fake.trip, user_id: fake.actor, role: 'owner', joined_at: 1 }

    const outcome = await store.addCommentToSuggestion(fake.trip, S1, 'ack only')
    expect(outcome.status).toBe('conflict')
    // The receipt itself is an acknowledgment only: the cached CAS did not
    // move at receipt time.
    expect((store.getSnapshot().trips.find(t => t.id === fake.trip) as { writeVersion: number }).writeVersion).toBe(0)
    await tick()
    // The background reconciliation read the authoritative trip through the
    // REAL admission path, which legitimately lands revision 7.
    expect((store.getSnapshot().trips.find(t => t.id === fake.trip) as { writeVersion: number }).writeVersion).toBe(7)
  })

  it('a queued trip edit blocks admission and survives the reconciliation', async () => {
    const store = await freshStore()
    store._setTripWriteDebounceMs(0)
    fake.conflict = true
    // The server is AHEAD of the edit's base revision (7 vs 0): this proves
    // the queued-conflict branch, which stops at preflight. The separate
    // same-revision fixture below proves a real failed UPDATE.
    fake.tripsRow = authoritativeTripsRow(fake.trip, fake.actor, 7)
    fake.membersRow = { id: 'tm-1', trip_id: fake.trip, user_id: fake.actor, role: 'owner', joined_at: 1 }
    // A real local edit whose trip write fails, so the edit is queued.
    fake.tripUpdateFails = true
    store.addExpense(fake.trip, { label: 'Queued fuel', category: 'transport', amountInr: 500 })
    await tick()
    const before = store.getSnapshot().trips.find(t => t.id === fake.trip)!
    expect(before.expenses.some(e => e.label === 'Queued fuel')).toBe(true)

    const outcome = await store.addCommentToSuggestion(fake.trip, S1, 'keep draft')
    expect(outcome.status).toBe('conflict')
    await tick()
    const after = store.getSnapshot().trips.find(t => t.id === fake.trip)!
    // Admission was BLOCKED (a queued edit outranks the authoritative row):
    // the local edit and revision 0 survive, and the pending copy stays.
    expect(after.writeVersion).toBe(0)
    expect(after.expenses.some(e => e.label === 'Queued fuel')).toBe(true)
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('a conflict draft survives an authoritative realtime replacement', async () => {
    const store = await freshStore()
    fake.conflict = true
    const outcome = await store.addCommentToSuggestion(fake.trip, S1, 'unresolved input')
    expect(outcome.status).toBe('conflict')
    await tick()
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toEqual(['unresolved input'])
    // A canonical peer UPDATE lands through the real realtime dispatch.
    const peer = structuredClone(fake.rows.get(S1)!)
    peer.comments.push({ id: 'peer-comment', authorId: 'peer', text: 'peer event', createdAt: 2 })
    fake.rows.set(S1, peer)
    store._applyRealtimeEventForTest('suggestions', {
      eventType: 'UPDATE', schema: 'public', table: 'suggestions',
      commit_timestamp: new Date().toISOString(), old: { id: peer.id }, new: structuredClone(peer),
    } as Parameters<typeof store._applyRealtimeEventForTest>[1])
    const observed = store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text)
    expect(observed).toContain('peer event')
    expect(observed).toContain('unresolved input')
  })
})

describe('gate round 4 — ballot ownership and per-action draft ownership', () => {
  it('a refused change to an existing ballot restores the prior vote across a concurrent comment', async () => {
    const store = await freshStore()
    // The actor already holds an upvote, admitted through the realtime path.
    const voted = structuredClone(fake.rows.get(S1)!)
    voted.votes = [{ userId: fake.actor, value: 1, createdAt: 1 }]
    fake.rows.set(S1, voted)
    admitRow(store, 'suggestions', voted)
    fake.hold = true
    // A downvote on top of the upvote, then a concurrent comment whose clone
    // carries the optimistic downvote away from the vote's own row object.
    const vote = store.voteSuggestion(fake.trip, S1, -1)
    const comment = store.addCommentToSuggestion(fake.trip, S1, 'independent pending comment')
    expect(fake.held).toHaveLength(2)
    fake.held[0].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await vote).status).toBe('forbidden')
    const cached = store.getSnapshot().suggestions.find(x => x.id === S1)!
    // The refused downvote is gone and the actor's REAL prior vote is back:
    // the ownership record captured it before the optimistic mutation.
    expect(cached.votes).toEqual([{ userId: fake.actor, value: 1, createdAt: 1 }])
    expect(cached.comments.map(c => c.text)).toEqual(['independent pending comment'])
    expect(fake.rows.get(S1)!.votes).toEqual([{ userId: fake.actor, value: 1, createdAt: 1 }])
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    await comment
    await tick()
  })

  it('a refused removal restores the prior vote it removed', async () => {
    const store = await freshStore()
    const voted = structuredClone(fake.rows.get(S1)!)
    voted.votes = [{ userId: fake.actor, value: 1, createdAt: 1 }]
    fake.rows.set(S1, voted)
    admitRow(store, 'suggestions', voted)
    fake.hold = true
    // Toggling the same value is a removal: the optimistic row has NO vote
    // entry, so the rollback must re-INSERT the prior, not replace it.
    const vote = store.voteSuggestion(fake.trip, S1, 1)
    const comment = store.addCommentToSuggestion(fake.trip, S1, 'concurrent comment')
    expect(fake.held).toHaveLength(2)
    fake.held[0].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await vote).status).toBe('forbidden')
    const cached = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(cached.votes).toEqual([{ userId: fake.actor, value: 1, createdAt: 1 }])
    expect(cached.comments.map(c => c.text)).toEqual(['concurrent comment'])
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    await comment
    await tick()
  })

  it('a refused decision ballot change restores the prior option across a concurrent comment', async () => {
    const store = await freshStore()
    const voted = structuredClone(fake.decisionRows.get(D1)!)
    voted.options = [{ id: 'opt-1', label: 'Time Out' }, { id: 'opt-2', label: 'Late Night' }]
    voted.votes_by_user_id = { [fake.actor]: 'opt-1' }
    fake.decisionRows.set(D1, voted)
    admitRow(store, 'decisions', voted)
    fake.hold = true
    const vote = store.voteOnDecision(D1, 'opt-2')
    const comment = store.addCommentToDecision(fake.trip, D1, 'concurrent comment')
    expect(fake.held).toHaveLength(2)
    fake.held[0].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await vote).status).toBe('forbidden')
    const cached = store.getSnapshot().decisions.find(x => x.id === D1)!
    expect(cached.votesByUserId[fake.actor]).toBe('opt-1')
    expect(cached.comments.map(c => c.text)).toEqual(['concurrent comment'])
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    await comment
    await tick()
  })

  it('an unrelated successful settlement retires only its own unresolved draft', async () => {
    const store = await freshStore()
    fake.conflict = true
    expect((await store.addCommentToSuggestion(fake.trip, S1, 'unresolved input')).status).toBe('conflict')
    await tick()
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toEqual(['unresolved input'])
    // A ballot on the SAME row succeeds while the comment is unresolved.
    fake.conflict = false
    expect((await store.voteSuggestion(fake.trip, S1, 1)).status).toBe('applied')
    await tick()
    // The ballot's canonical receipt row must not retire the comment's draft
    // owner: the overlay belongs to the unresolved action, not to the row.
    const afterSuccess = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(afterSuccess.comments.map(c => c.text)).toContain('unresolved input')
    // A later canonical realtime replacement re-attaches it again.
    const peer = structuredClone(fake.rows.get(S1)!)
    peer.comments.push({ id: 'peer-comment', authorId: 'peer', text: 'peer event', createdAt: 2 })
    fake.rows.set(S1, peer)
    admitRow(store, 'suggestions', peer)
    const afterRealtime = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(afterRealtime.comments.map(c => c.text)).toContain('peer event')
    expect(afterRealtime.comments.map(c => c.text)).toContain('unresolved input')
    // And the action itself is untouched: the retry replays the SAME identity.
    const retry = await store.addCommentToSuggestion(fake.trip, S1, 'unresolved input')
    expect(retry.status).toBe('applied')
    expect(fake.calls[2].p_command_id).toBe(fake.calls[0].p_command_id)
    expect(fake.calls[2].p_command).toEqual(fake.calls[0].p_command)
  })

  it('a same-revision queued edit really sends its UPDATE, and a failed one stays queued', async () => {
    const store = await freshStore()
    store._setTripWriteDebounceMs(0)
    // The server sits at the SAME revision the edit is based on, so the queued
    // write passes preflight and really reaches its UPDATE — this fixture is a
    // real failed write, not the preflight conflict the revision-7 test proves.
    fake.tripsRow = authoritativeTripsRow(fake.trip, fake.actor, 0)
    fake.membersRow = { id: 'tm-1', trip_id: fake.trip, user_id: fake.actor, role: 'owner', joined_at: 1 }
    fake.tripUpdateFails = true
    store.addExpense(fake.trip, { label: 'Queued fuel', category: 'transport', amountInr: 500 })
    await tick(); await tick(); await tick()
    expect(fake.tripUpdates.length).toBeGreaterThanOrEqual(1)
    const after = store.getSnapshot().trips.find(t => t.id === fake.trip)!
    expect(after.expenses.some(e => e.label === 'Queued fuel')).toBe(true)
    expect(after.writeVersion).toBe(0)
    // The queue still owns the edit: a replay sends the same write, and this
    // time it lands — proof that the failed try preserved the entry.
    fake.tripUpdateFails = false
    const synced = await store.replayQueuedWrites()
    await tick()
    expect(synced).toBeGreaterThanOrEqual(1)
    expect(fake.tripUpdates.length).toBeGreaterThanOrEqual(2)
    const final = store.getSnapshot().trips.find(t => t.id === fake.trip)!
    expect(final.expenses.some(e => e.label === 'Queued fuel')).toBe(true)
    expect(final.writeVersion).toBe(1)
  })
})

describe('gate round 5 — chained ballot refusals and in-flight comment drafts', () => {
  it('two refused overlapping ballots leave no ghost vote and the next upvote is a SET', async () => {
    const store = await freshStore()
    fake.hold = true
    const up = store.voteSuggestion(fake.trip, S1, 1)
    const down = store.voteSuggestion(fake.trip, S1, -1)
    expect(fake.held).toHaveLength(2)
    fake.held[0].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await up).status).toBe('forbidden')
    fake.held[1].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await down).status).toBe('forbidden')
    await tick()
    // Neither command committed, so no trace of either may survive: the
    // second rollback restored the CONFIRMED baseline (no vote), not the
    // first operation's unconfirmed upvote.
    const afterRefusals = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(afterRefusals.votes).toEqual([])
    expect(fake.rows.get(S1)!.votes).toEqual([])
    expect(fake.ledger.size).toBe(0)
    expect(store.getSnapshot().activity).toHaveLength(0)
    // The semantic consequence: with no server-backed ballot, a real Upvote
    // click must issue SET 1 — never a removal read off the ghost.
    fake.hold = false
    const next = await store.voteSuggestion(fake.trip, S1, 1)
    expect(next.status).toBe('applied')
    expect(fake.calls[2].p_command.value).toBe(1)
    expect(fake.rows.get(S1)!.votes.map(v => v.value)).toEqual([1])
  })

  it('chained refusals across a concurrent comment also restore the confirmed baseline', async () => {
    const store = await freshStore()
    fake.hold = true
    const up = store.voteSuggestion(fake.trip, S1, 1)
    const down = store.voteSuggestion(fake.trip, S1, -1)
    const comment = store.addCommentToSuggestion(fake.trip, S1, 'independent pending comment')
    expect(fake.held).toHaveLength(3)
    fake.held[0].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await up).status).toBe('forbidden')
    // The comment's clone moved the row, so the second rollback takes the
    // moved-on retraction path with the chained baseline.
    fake.held[1].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await down).status).toBe('forbidden')
    const cached = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(cached.votes).toEqual([])
    expect(cached.comments.map(c => c.text)).toEqual(['independent pending comment'])
    fake.held[2].resolve(fake.apply(fake.held[2].params))
    await comment
    await tick()
  })

  it('two refused overlapping decision ballots leave no ghost option and the next vote is a SET', async () => {
    const store = await freshStore()
    const seeded = structuredClone(fake.decisionRows.get(D1)!)
    seeded.options = [{ id: 'opt-1', label: 'Time Out' }, { id: 'opt-2', label: 'Late Night' }]
    fake.decisionRows.set(D1, seeded)
    admitRow(store, 'decisions', seeded)
    fake.hold = true
    const first = store.voteOnDecision(D1, 'opt-1')
    const second = store.voteOnDecision(D1, 'opt-2')
    expect(fake.held).toHaveLength(2)
    fake.held[0].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await first).status).toBe('forbidden')
    fake.held[1].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await second).status).toBe('forbidden')
    await tick()
    const afterRefusals = store.getSnapshot().decisions.find(x => x.id === D1)!
    expect(afterRefusals.votesByUserId[fake.actor]).toBeUndefined()
    expect(Object.keys(fake.decisionRows.get(D1)!.votes_by_user_id)).toEqual([])
    fake.hold = false
    const next = await store.voteOnDecision(D1, 'opt-1')
    expect(next.status).toBe('applied')
    expect(fake.calls[2].p_command.optionId).toBe('opt-1')
    expect(fake.decisionRows.get(D1)!.votes_by_user_id[fake.actor]).toBe('opt-1')
  })

  it('an echo landing mid-flight refreshes the confirmed baseline a later rollback restores', async () => {
    const store = await freshStore()
    fake.hold = true
    const up = store.voteSuggestion(fake.trip, S1, 1)
    // The upvote commits server-side and its realtime echo lands while the
    // RPC response is still held: the canonical row refreshes the in-flight
    // operation's confirmed baseline to the committed vote.
    fake.apply(fake.held[0].params)
    admitRow(store, 'suggestions', fake.rows.get(S1)!)
    const down = store.voteSuggestion(fake.trip, S1, -1)
    const comment = store.addCommentToSuggestion(fake.trip, S1, 'concurrent comment')
    expect(fake.held).toHaveLength(3)
    fake.held[0].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await up).status).toBe('forbidden')
    fake.held[1].resolve({ data: { status: 'forbidden', tripRevision: 0 }, error: null })
    expect((await down).status).toBe('forbidden')
    // The downvote rollback restores the ECHO-confirmed upvote, not the
    // "no vote" baseline the first claim captured.
    const cached = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(cached.votes).toEqual([{ userId: fake.actor, value: 1, createdAt: 1 }])
    expect(fake.rows.get(S1)!.votes).toEqual([{ userId: fake.actor, value: 1, createdAt: 1 }])
    fake.held[2].resolve(fake.apply(fake.held[2].params))
    await comment
    await tick()
  })

  it('an in-flight comment stays visible through an earlier ballot recovery and settles once', async () => {
    const store = await freshStore()
    fake.hold = true
    const ballot = store.voteSuggestion(fake.trip, S1, 1)
    const comment = store.addCommentToSuggestion(fake.trip, S1, 'still sending input')
    expect(fake.held).toHaveLength(2)
    const command = structuredClone(fake.held[1].params)
    expect(store.getSnapshot().suggestions.find(x => x.id === S1)!.comments.map(c => c.text)).toContain('still sending input')
    // The ballot commits first; its receipt is stale relative to the later
    // optimistic comment, so it triggers the real fenced recovery SELECT.
    fake.held[0].resolve(fake.apply(fake.held[0].params))
    expect((await ballot).status).toBe('applied')
    await tick()
    // The recovery SELECT replaced the row with the canonical one, which has
    // no trace of the uncommitted comment: the dispatch-time draft overlay
    // must keep it on screen.
    expect(fake.ledger.has(command.p_command_id)).toBe(false)
    const whilePending = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(whilePending.comments.map(c => c.text)).toContain('still sending input')
    expect(whilePending.votes.map(v => v.value)).toEqual([1])
    // Drain the still-pending transport: success settles the same comment
    // exactly once, with no duplicate.
    fake.held[1].resolve(fake.apply(fake.held[1].params))
    expect((await comment).status).toBe('applied')
    await tick()
    const final = store.getSnapshot().suggestions.find(x => x.id === S1)!
    expect(final.comments.map(c => c.id)).toEqual([command.p_command.commentId])
    expect(fake.rows.get(S1)!.comments.map(c => c.id)).toEqual([command.p_command.commentId])
    expect(fake.calls).toHaveLength(2)
    expect(fake.notifications).toHaveLength(1)
  })
})
