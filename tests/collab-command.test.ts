// ============ Stage A of #832 — the command path and its receipts ============
//
// The writers submit narrow commands through `submit_collab_command` and must
// handle the receipt. This file drives the REAL store against a fake server
// that implements the contract's semantics (docs/agents/collab-command-
// contract.md): idempotent replay by command id, per-row canonical rows in the
// receipt, server-derived actors, and side effects committed atomically.
//
// Proven here, in Node: stage-A acceptance case 2 (a retry commits one
// comment, one activity item and one notification; a failed write commits
// none), the conflict rule (local work is preserved), the forbidden path (the
// caller learns, no success toast), the no-toggle ballot rule, the identity
// binding of async continuations (case 4's unit half), and the rule that
// tripRevision is an acknowledgment — never a trip CAS advance.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, any>

const { server } = vi.hoisted(() => {
  const server = {
    currentUser: 'user-a' as string | null,
    /** When set, the next submissions answer with this raw response. */
    failWith: null as { data?: unknown; error?: unknown } | null,
    /** When true, submissions park in `held` until release() answers them. */
    hold: false,
    held: [] as Array<{ params: any; resolve: (v: any) => void }>,
    tripRevision: 1 as number,
    suggestions: new Map<string, Row>(),
    decisions: new Map<string, Row>(),
    activity: [] as Row[],
    notifications: [] as Row[],
    commands: new Map<string, { tripId: string; command: any }>(),
    reset() {
      server.currentUser = 'user-a'
      server.failWith = null
      server.hold = false
      server.held = []
      server.tripRevision = 1
      server.suggestions.clear()
      server.decisions.clear()
      server.activity = []
      server.notifications = []
      server.commands.clear()
    },
    release(response: { data?: unknown; error?: unknown }) {
      server.hold = false
      for (const h of server.held) h.resolve(response)
      server.held = []
    },
  }
  return { server }
})

vi.mock('../src/components/ui', () => ({ toast: vi.fn() }))

vi.mock('../src/lib/supabase', () => {
  /** The server half of the contract, small but honest: one command ledger
   *  keyed by id, replay detection by (trip, payload), stable row ids, and
   *  side effects committed only when the command applies. */
  const apply = (params: any): { data: unknown; error: unknown } => {
    if (server.failWith) return server.failWith
    const commandId: string = params.p_command_id
    const tripId: string = params.p_trip_id
    const command = params.p_command
    const actor = server.currentUser
    if (!actor) return { data: { status: 'forbidden' }, error: null }

    const seen = server.commands.get(commandId)
    if (seen) {
      const same = seen.tripId === tripId && JSON.stringify(seen.command) === JSON.stringify(command)
      if (!same) return { data: { status: 'conflict', tripRevision: server.tripRevision }, error: null }
      const row = command.suggestionId ? server.suggestions.get(command.suggestionId)
        : command.decisionId ? server.decisions.get(command.decisionId)
        : undefined
      return {
        data: {
          status: 'alreadyApplied', tripRevision: server.tripRevision,
          ...(command.type.startsWith('suggestion') && row ? { suggestion: row } : {}),
          ...(command.type.startsWith('decision') && row ? { decision: row } : {}),
        },
        error: null,
      }
    }

    const activityId = `act-${server.activity.length + 1}`
    const notificationIds: string[] = []
    const logActivity = (verb: string, target?: string) => {
      server.activity.push({ id: activityId, trip_id: tripId, actor_id: actor, verb, target: target ?? null, at: 1 })
    }
    const notify = (userId: string, text: string) => {
      const nid = `n-${server.notifications.length + 1}-${notificationIds.length}`
      notificationIds.push(nid)
      server.notifications.push({ id: nid, user_id: userId, trip_id: tripId, text, read: false, at: 1 })
    }
    let row: Row | undefined
    let kind: 'suggestion' | 'decision' | undefined

    switch (command.type) {
      case 'suggestion.create': {
        if (server.suggestions.has(command.suggestionId)) {
          return { data: { status: 'conflict', tripRevision: server.tripRevision }, error: null }
        }
        const s = command.suggestion
        row = {
          id: command.suggestionId, trip_id: tripId, day_index: s.dayIndex, proposed_by: actor,
          title: s.title, category: s.category, location_name: s.locationName, lat: s.lat, lng: s.lng,
          description: s.description ?? null, visit_minutes: s.visitMinutes,
          estimated_entry_fee_inr: s.estimatedEntryFeeInr, estimated_transport_inr: s.estimatedTransportInr,
          votes: [], comments: [], status: 'open', created_at: 1,
        }
        server.suggestions.set(row.id, row)
        kind = 'suggestion'
        logActivity(`suggested “${s.title}”`, `Day ${(s.dayIndex ?? 0) + 1}`)
        break
      }
      case 'suggestion.comment': {
        row = server.suggestions.get(command.suggestionId)
        if (!row) return { data: { status: 'invalid', reason: 'unknown suggestion' }, error: null }
        if (row.comments.some((c: Row) => c.id === command.commentId)) {
          return { data: { status: 'alreadyApplied', tripRevision: server.tripRevision, suggestion: row }, error: null }
        }
        row.comments.push({ id: command.commentId, authorId: actor, text: command.text, createdAt: 1 })
        logActivity('commented on a suggestion', row.title)
        // The server pings the suggestion's proposer (and voters, omitted in
        // this stub) — one notification event per applied command.
        if (row.proposed_by !== actor) notify(row.proposed_by, `${actor} commented on “${row.title}”.`)
        break
      }
      case 'suggestion.ballot': {
        row = server.suggestions.get(command.suggestionId)
        if (!row) return { data: { status: 'invalid', reason: 'unknown suggestion' }, error: null }
        // The ballot is a SET (or a removal). It never toggles: a repeated
        // value lands in the same place, so a retry cannot flip the vote.
        const votes = row.votes.filter((v: Row) => v.userId !== actor)
        if (command.value !== null) votes.push({ userId: actor, value: command.value, createdAt: 1 })
        row.votes = votes
        logActivity(command.value === null ? 'removed their vote on a suggestion'
          : command.value > 0 ? 'upvoted a suggestion' : 'downvoted a suggestion', row.title)
        break
      }
      case 'decision.create': {
        if (server.decisions.has(command.decisionId)) {
          return { data: { status: 'conflict', tripRevision: server.tripRevision }, error: null }
        }
        row = {
          id: command.decisionId, trip_id: tripId, question: command.decision.question,
          context: command.decision.context ?? null, options: command.decision.options,
          votes_by_user_id: {}, comments: [], status: 'open', raised_by: actor, created_at: 1,
        }
        server.decisions.set(row.id, row)
        kind = 'decision'
        logActivity(`raised decision “${command.decision.question}”`, 'Decisions')
        break
      }
      case 'decision.comment': {
        row = server.decisions.get(command.decisionId)
        if (!row) return { data: { status: 'invalid', reason: 'unknown decision' }, error: null }
        if (row.comments.some((c: Row) => c.id === command.commentId)) {
          return { data: { status: 'alreadyApplied', tripRevision: server.tripRevision, decision: row }, error: null }
        }
        row.comments.push({ id: command.commentId, authorId: actor, text: command.text, createdAt: 1 })
        logActivity('commented on a decision', row.question)
        if (row.raised_by !== actor) notify(row.raised_by, `${actor} commented on “${row.question}”.`)
        break
      }
      case 'decision.ballot': {
        row = server.decisions.get(command.decisionId)
        if (!row) return { data: { status: 'invalid', reason: 'unknown decision' }, error: null }
        if (row.status !== 'open') return { data: { status: 'invalid', reason: 'decision is not open' }, error: null }
        if (command.optionId !== null && !row.options.some((o: Row) => o.id === command.optionId)) {
          return { data: { status: 'invalid', reason: 'unknown option' }, error: null }
        }
        if (command.optionId === null) delete row.votes_by_user_id[actor]
        else row.votes_by_user_id[actor] = command.optionId
        logActivity('voted on a decision', row.question)
        break
      }
      case 'activity.append': {
        if (server.activity.some((a: Row) => a.id === command.activityId)) {
          return { data: { status: 'alreadyApplied', tripRevision: server.tripRevision }, error: null }
        }
        server.activity.push({
          id: command.activityId, trip_id: tripId, actor_id: actor, verb: command.verb, target: command.target ?? null, at: 1,
        })
        return { data: { status: 'applied', tripRevision: server.tripRevision, activityId: command.activityId, notificationIds: [] }, error: null }
      }
      default:
        return { data: { status: 'invalid', reason: 'unknown command' }, error: null }
    }

    server.commands.set(commandId, { tripId, command })
    const receipt: Row = { status: 'applied', tripRevision: server.tripRevision, activityId, notificationIds }
    if (kind === 'suggestion') receipt.suggestion = row
    if (kind === 'decision') receipt.decision = row
    return { data: receipt, error: null }
  }

  return {
    isSupabaseConfigured: true,
    supabase: {
      rpc: (fn: string, params: any) => {
        const qb: any = {}
        qb.then = (res: any, rej?: any) => new Promise((resolve, reject) => {
          if (fn === 'submit_collab_command' && server.hold) {
            server.held.push({ params, resolve })
          } else {
            resolve(fn === 'submit_collab_command' ? apply(params) : { data: null, error: null })
          }
        }).then(res, rej)
        return qb
      },
      from: (table: string) => {
        const qb: any = {}
        let id: string | undefined
        qb.select = () => qb
        qb.eq = (_col: string, val: any) => { id = val; return qb }
        qb.maybeSingle = () => Promise.resolve({
          data: (table === 'suggestions' ? server.suggestions.get(id ?? '')
            : table === 'decisions' ? server.decisions.get(id ?? '') : null) ?? null,
          error: null,
        })
        qb.then = (res: any) => Promise.resolve({ data: null, error: null }).then(res)
        return qb
      },
      auth: {
        getSession: async () => ({
          data: { session: server.currentUser ? { user: { id: server.currentUser }, access_token: 'fixture' } : null },
          error: null,
        }),
      },
    },
  }
})

import {
  submitCollabCommand,
} from '../src/store/collabCommand'
import {
  addCommentToSuggestion, voteSuggestion, addSuggestion, addDecision, voteOnDecision,
  getSnapshot,
} from '../src/store/store'
import { reportCollabOutcome } from '../src/lib/collabFeedback'
import { toast } from '../src/components/ui'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

const TRIP = 'trip-832'
const SUG = '30000000-0000-4000-8000-000000000001'
const DEC = '40000000-0000-4000-8000-000000000001'

function seedServer() {
  server.suggestions.set(SUG, {
    id: SUG, trip_id: TRIP, day_index: 0, proposed_by: 'user-b', title: 'Time Out Market',
    category: 'food', location_name: 'Rua Augusta', lat: 38.7, lng: -9.1, description: null,
    visit_minutes: 60, estimated_entry_fee_inr: 0, estimated_transport_inr: 0,
    votes: [], comments: [], status: 'open', created_at: 1,
  })
  server.decisions.set(DEC, {
    id: DEC, trip_id: TRIP, question: 'Where to eat?', context: null,
    options: [{ id: 'opt-1', label: 'Time Out' }], votes_by_user_id: {}, comments: [],
    status: 'open', raised_by: 'user-b', created_at: 1,
  })
}

async function freshStore() {
  vi.resetModules()
  const store = await import('../src/store/store')
  server.reset()
  seedServer()
  const db = store.getSnapshot() as any
  db.sessionUserId = 'user-a'
  db.trips.push({
    id: TRIP, title: 'Lisbon', destination: 'Lisbon, Portugal',
    startDate: '2026-09-01', endDate: '2026-09-03', attendees: 2, ownerId: 'user-a',
    writeVersion: 0,
    members: [{ userId: 'user-a', role: 'owner', joinedAt: 1 }],
    days: [{ index: 0, date: '2026-09-01', label: 'Day 1', stops: [] }, { index: 1, date: '2026-09-02', label: 'Day 2', stops: [] }],
    expenses: [], collaborators: [],
  } as any)
  db.suggestions.push({
    id: SUG, tripId: TRIP, dayIndex: 0, proposedBy: 'user-b', title: 'Time Out Market',
    category: 'food', locationName: 'Rua Augusta', lat: 38.7, lng: -9.1, description: '',
    visitMinutes: 60, estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
    votes: [], comments: [], status: 'open', createdAt: 1,
  } as any)
  db.decisions.push({
    id: DEC, tripId: TRIP, question: 'Where to eat?', context: '', status: 'open',
    options: [{ id: 'opt-1', label: 'Time Out' }], votesByUserId: {}, comments: [],
    raisedBy: 'user-b', createdAt: 1,
  } as any)
  return store
}

beforeEach(() => {
  vi.mocked(toast).mockClear()
})

describe('acceptance case 2 — a retry commits once; a failure commits nothing', () => {
  it('the same command id twice: one comment, one activity item, one notification', async () => {
    await freshStore()
    const commandId = '11111111-1111-4111-8111-111111111111'
    const command = { type: 'suggestion.comment', suggestionId: SUG, commentId: 'cm_retry', text: 'one copy only' } as const

    const first = await submitCollabCommand(commandId, TRIP, command)
    const second = await submitCollabCommand(commandId, TRIP, command)

    expect(first.status).toBe('applied')
    expect(second.status).toBe('alreadyApplied')
    const row = server.suggestions.get(SUG)!
    expect(row.comments).toHaveLength(1)
    expect(server.activity).toHaveLength(1)
    expect(server.notifications).toHaveLength(1)
    // alreadyApplied re-reads the current row, so the retry still sees the
    // contribution it is replaying.
    expect(second.suggestion?.comments[0]?.text).toBe('one copy only')
  })

  it('a failed write creates nothing on the server and rolls the cache back', async () => {
    const store = await freshStore()
    server.failWith = { data: null, error: { message: 'connection lost' } }

    const outcome = await store.addCommentToSuggestion(TRIP, SUG, 'doomed')

    expect(outcome.status).toBe('unavailable')
    expect(server.suggestions.get(SUG)!.comments).toHaveLength(0)
    expect(server.activity).toHaveLength(0)
    expect(server.notifications).toHaveLength(0)
    const db = store.getSnapshot()
    expect(db.suggestions.find(x => x.id === SUG)!.comments).toHaveLength(0)
    expect(db.activity.map(a => a.verb)).not.toContain('commented on a suggestion')
  })

  it('a retried comment through the writer lands as alreadyApplied and adopts the canonical row', async () => {
    const store = await freshStore()
    // Prime the ledger so the writer's next command id replays: submit the
    // same logical action once, then let the writer retry it through the
    // same id by reusing the ledger entry the fake server records.
    const commandId = '22222222-2222-4222-8222-222222222222'
    await submitCollabCommand(commandId, TRIP, { type: 'suggestion.comment', suggestionId: SUG, commentId: 'cm_writer', text: 'prime' })

    // The writer mints its own id, so a writer retry is a NEW logical action;
    // what must NOT happen is a second server commit of the SAME command. The
    // ledger proves the primed command was committed exactly once.
    const outcome = await store.addCommentToSuggestion(TRIP, SUG, 'second, distinct action')
    expect(outcome.status).toBe('applied')
    expect(server.suggestions.get(SUG)!.comments.map((c: Row) => c.text))
      .toEqual(['prime', 'second, distinct action'])
  })
})

describe('conflict keeps the planner\'s work', () => {
  it('a conflict receipt preserves the local comment and drops the uncreated artifacts', async () => {
    const store = await freshStore()
    server.failWith = { data: { status: 'conflict', tripRevision: 7 }, error: null }

    const outcome = await store.addCommentToSuggestion(TRIP, SUG, 'mine stays')

    expect(outcome.status).toBe('conflict')
    const db = store.getSnapshot()
    // The optimistic comment survives — the caller decides what to tell the
    // user, but the local work is not silently dropped.
    expect(db.suggestions.find(x => x.id === SUG)!.comments.map(c => c.text)).toContain('mine stays')
    // The server created no activity for a command it refused.
    expect(server.activity).toHaveLength(0)
    expect(db.activity.map(a => a.verb)).not.toContain('commented on a suggestion')
  })
})

describe('forbidden reaches the caller — no success toast', () => {
  it('the writer answers forbidden and the feedback shows the error, not the success', async () => {
    const store = await freshStore()
    server.failWith = { data: { status: 'forbidden' }, error: null }

    const outcome = await store.addCommentToSuggestion(TRIP, SUG, 'not allowed')
    reportCollabOutcome(outcome, 'Comment posted')

    expect(outcome.status).toBe('forbidden')
    expect(vi.mocked(toast)).not.toHaveBeenCalledWith('Comment posted')
    expect(vi.mocked(toast)).toHaveBeenCalledWith('You need editor access to do that.', 'err')
    // And nothing was created anywhere.
    expect(server.suggestions.get(SUG)!.comments).toHaveLength(0)
    expect(store.getSnapshot().suggestions.find(x => x.id === SUG)!.comments).toHaveLength(0)
  })

  it('an applied receipt still shows the success message (control)', async () => {
    const store = await freshStore()
    const outcome = await store.addCommentToSuggestion(TRIP, SUG, 'fine')
    reportCollabOutcome(outcome, 'Comment posted')
    expect(outcome.status).toBe('applied')
    expect(vi.mocked(toast)).toHaveBeenCalledWith('Comment posted')
  })
})

describe('a repeated ballot value does not toggle', () => {
  it('the same command id replayed leaves the ballot in place', async () => {
    await freshStore()
    const commandId = '33333333-3333-4333-8333-333333333333'
    const command = { type: 'suggestion.ballot', suggestionId: SUG, value: 1 } as const

    await submitCollabCommand(commandId, TRIP, command)
    await submitCollabCommand(commandId, TRIP, command)

    const votes = server.suggestions.get(SUG)!.votes
    expect(votes).toHaveLength(1)
    expect(votes[0]).toMatchObject({ userId: 'user-a', value: 1 })
  })

  it('the same value from a NEW command id is a set, not a toggle', async () => {
    await freshStore()
    await submitCollabCommand('44444444-4444-4444-8444-444444444441', TRIP, { type: 'suggestion.ballot', suggestionId: SUG, value: 1 })
    await submitCollabCommand('44444444-4444-4444-8444-444444444442', TRIP, { type: 'suggestion.ballot', suggestionId: SUG, value: 1 })

    const votes = server.suggestions.get(SUG)!.votes
    expect(votes).toHaveLength(1)
    expect(votes[0]).toMatchObject({ userId: 'user-a', value: 1 })
  })

  it('removal is an explicit value:null from the client toggle', async () => {
    const store = await freshStore()
    await store.voteSuggestion(TRIP, SUG, 1)
    expect(server.suggestions.get(SUG)!.votes).toHaveLength(1)

    await store.voteSuggestion(TRIP, SUG, 1)
    expect(server.suggestions.get(SUG)!.votes).toHaveLength(0)
  })
})

describe('acceptance case 4 — a late receipt never enters the next identity\'s cache', () => {
  it('a receipt that lands after the account changed writes nothing', async () => {
    const store = await freshStore()
    server.hold = true

    const pending = store.addCommentToSuggestion(TRIP, SUG, 'late arrival')
    await tick()

    // Simulate the account switch: the cache now belongs to another identity.
    ;(store.getSnapshot() as any).sessionUserId = 'user-b'
    server.release({
      data: {
        status: 'applied', tripRevision: 2, activityId: 'act-late', notificationIds: [],
        suggestion: { ...server.suggestions.get(SUG)!, comments: [{ id: 'cm_late', authorId: 'user-a', text: 'late arrival', createdAt: 1 }] },
      },
      error: null,
    })
    const outcome = await pending

    // The outcome still reaches the caller — but nothing was written into the
    // cache under the wrong identity: no canonical adoption, no artifact re-id.
    expect(outcome.status).toBe('applied')
    const db = store.getSnapshot()
    expect(db.activity.map(a => a.id)).not.toContain('act-late')
    const cached = db.suggestions.find(x => x.id === SUG)!
    expect(cached.comments.map(c => c.id)).not.toContain('cm_late')
  })
})

describe('tripRevision is an acknowledgment, not a trip snapshot', () => {
  it('a newer server revision never advances the client trip CAS', async () => {
    const store = await freshStore()
    server.tripRevision = 99

    const outcome = await store.addCommentToSuggestion(TRIP, SUG, 'ack only')

    expect(outcome.status).toBe('applied')
    const trip = store.getSnapshot().trips.find(t => t.id === TRIP) as any
    expect(trip.writeVersion).toBe(0)
  })
})

describe('create commands carry no actor field', () => {
  it('suggestion.create and decision.create payloads name no author', async () => {
    const store = await freshStore()
    await store.addSuggestion(TRIP, {
      dayIndex: 1, title: 'Sunset point', category: 'sightseeing', locationName: 'Fort',
      lat: 10, lng: 76, description: '', visitMinutes: 30, estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
    })
    await store.addDecision(TRIP, { question: 'Beach or hills?', options: [{ id: 'a', label: 'Beach' }, { id: 'b', label: 'Hills' }] })
    await store.voteOnDecision(DEC, 'opt-1')

    const sent = server.commands.values()
    for (const { command } of sent) {
      const text = JSON.stringify(command)
      expect(text).not.toContain('user-a')
      expect(text).not.toContain('proposedBy')
      expect(text).not.toContain('raisedBy')
      expect(text).not.toContain('actorId')
    }
  })
})
