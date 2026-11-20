// Group input and the commenter role (#935). A viewer reads the trip and sends
// nothing. A commenter votes and comments through the four comment and ballot
// commands. Every other Group input command keeps the editor gate, so a
// commenter is refused before any optimistic row is written.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seedData } from '../src/data/seed'
import type { TripMember } from '../src/data/types'

type Store = typeof import('../src/store/store')

const { calls, state } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; payload?: unknown }>,
  /** The answer of every submit_collab_command call. */
  state: { receipt: undefined as unknown },
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
      new Promise<{ data: unknown; error: unknown }>(resolve => {
        if (method) calls.push({ table, method, payload })
        resolve({ data: null, error: null })
      }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: (fn: string, params?: unknown) => {
        const qb: Record<string, unknown> = {}
        qb.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
          new Promise<{ data: unknown; error: unknown }>(resolve => {
            calls.push({ table: fn, method: 'rpc', payload: params })
            resolve({ data: state.receipt, error: null })
          }).then(res)
        return qb
      },
    },
  }
})

const keralaTrip = seedData.trips[0]
const ownerId = 'owner-935'
const meId = 'crew-935'

async function freshStore(): Promise<Store> {
  vi.resetModules()
  return import('../src/store/store')
}

/** The command types the store sent through the collab-command RPC, one by one. */
function sentTypes(): string[] {
  return calls
    .filter(c => c.table === 'submit_collab_command' && c.method === 'rpc')
    .map(c => (c.payload as { p_command?: { type?: string } }).p_command?.type ?? '?')
}

/** Seat the signed-in account as `role` on the trip. The owner stays a member. */
function seatAs(store: Store, tripId: string, role: TripMember['role']): void {
  store.getSnapshot().sessionUserId = meId
  Object.assign(store.tripById(tripId)!, {
    members: [{ userId: ownerId, role: 'owner', joinedAt: 1 }, { userId: meId, role, joinedAt: 2 }],
  })
}

/** The owner raises one idea and one decision, so both rows exist before the role changes. */
async function seedContent(store: Store, tripId: string): Promise<{ suggestionId: string; decisionId: string }> {
  store.getSnapshot().sessionUserId = ownerId
  state.receipt = { status: 'applied', tripRevision: 1 }
  await store.addSuggestion(tripId, {
    dayIndex: 0, title: 'Mattancherry walk', category: 'sightseeing', locationName: 'Kochi',
    lat: 9.95, lng: 76.26, visitMinutes: 60, estimatedEntryFeeInr: 0, estimatedTransportInr: 100,
  })
  const suggestion = store.getSnapshot().suggestions.find(s => s.tripId === tripId)!
  await store.addDecision(tripId, {
    question: 'Beach or backwater?',
    options: [{ id: 'o_1', label: 'Beach' }, { id: 'o_2', label: 'Backwater' }],
  })
  const decision = store.getSnapshot().decisions.find(d => d.tripId === tripId)!
  calls.length = 0
  return { suggestionId: suggestion.id, decisionId: decision.id }
}

beforeEach(() => {
  calls.length = 0
  state.receipt = undefined
})

describe('canComment: the comment and ballot right', () => {
  it.each([
    ['owner', true],
    ['editor', true],
    ['commenter', true],
    ['viewer', false],
    [null, false],
  ] as const)('%s → %s', async (role, expected) => {
    const store = await freshStore()
    expect(store.canComment(role)).toBe(expected)
  })

  it('an enabled admin passes the comment gate, as canEditAdmin lets an admin through', async () => {
    const store = await freshStore()
    const adminSession = await import('../src/lib/adminSession')
    expect(store.canCommentAdmin('viewer')).toBe(false)
    adminSession.setAdminForTest(true)
    try {
      expect(store.canCommentAdmin('viewer')).toBe(true)
      expect(store.canCommentAdmin(null)).toBe(true)
    } finally {
      adminSession.setAdminForTest(false)
    }
  })
})

describe('a viewer reads Group input and sends nothing', () => {
  it('refuses a vote or a comment locally, with no optimistic change and no RPC', async () => {
    const store = await freshStore()
    const trip = store.duplicateTrip(keralaTrip, ownerId)
    const { suggestionId, decisionId } = await seedContent(store, trip.id)
    seatAs(store, trip.id, 'viewer')
    const suggestionsBefore = structuredClone(store.getSnapshot().suggestions)
    const decisionsBefore = structuredClone(store.getSnapshot().decisions)
    const activityBefore = store.getSnapshot().activity.length

    const refusal = { status: 'invalid', reason: 'your role cannot vote or comment' }
    expect(await store.voteSuggestion(trip.id, suggestionId, 1)).toEqual(refusal)
    expect(await store.addCommentToSuggestion(trip.id, suggestionId, 'Nice idea')).toEqual(refusal)
    expect(await store.voteOnDecision(decisionId, 'o_1')).toEqual(refusal)
    expect(await store.addCommentToDecision(trip.id, decisionId, 'Beach it is')).toEqual(refusal)

    expect(sentTypes()).toEqual([])
    expect(store.getSnapshot().suggestions).toEqual(suggestionsBefore)
    expect(store.getSnapshot().decisions).toEqual(decisionsBefore)
    expect(store.getSnapshot().activity).toHaveLength(activityBefore)
  })

  it('refuses every editor command as forbidden, and sends nothing', async () => {
    const store = await freshStore()
    const trip = store.duplicateTrip(keralaTrip, ownerId)
    const { suggestionId, decisionId } = await seedContent(store, trip.id)
    seatAs(store, trip.id, 'viewer')

    expect((await store.addSuggestion(trip.id, {
      dayIndex: 0, title: 'Fort Kochi', category: 'sightseeing', locationName: 'Kochi',
      lat: 9.96, lng: 76.24, visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
    })).status).toBe('forbidden')
    expect((await store.declineSuggestion(trip.id, suggestionId)).status).toBe('forbidden')
    expect((await store.acceptSuggestionIntoTimeline(trip.id, suggestionId)).status).toBe('forbidden')
    expect((await store.addDecision(trip.id, { question: 'Dinner?', options: [{ label: 'Fish' }, { label: 'Dal' }] })).status).toBe('forbidden')
    expect((await store.addDecisionOption(decisionId, { label: 'Prawns' })).status).toBe('forbidden')
    expect((await store.resolveDecision(decisionId, 'o_1')).status).toBe('forbidden')

    expect(sentTypes()).toEqual([])
  })
})

describe('a commenter votes and comments, and cannot write the editor commands', () => {
  it('sends the comment and ballot commands through the RPC', async () => {
    const store = await freshStore()
    const trip = store.duplicateTrip(keralaTrip, ownerId)
    const { suggestionId, decisionId } = await seedContent(store, trip.id)
    seatAs(store, trip.id, 'commenter')
    state.receipt = { status: 'applied', tripRevision: 2 }

    expect((await store.voteSuggestion(trip.id, suggestionId, 1)).status).toBe('applied')
    expect((await store.addCommentToSuggestion(trip.id, suggestionId, 'Go early')).status).toBe('applied')
    expect((await store.voteOnDecision(decisionId, 'o_2')).status).toBe('applied')
    expect((await store.addCommentToDecision(trip.id, decisionId, 'Backwater, then')).status).toBe('applied')

    expect(sentTypes()).toEqual(['suggestion.ballot', 'suggestion.comment', 'decision.ballot', 'decision.comment'])
  })

  it('is refused the create, accept, decline, raise, option and resolve commands before any write', async () => {
    const store = await freshStore()
    const trip = store.duplicateTrip(keralaTrip, ownerId)
    const { suggestionId, decisionId } = await seedContent(store, trip.id)
    seatAs(store, trip.id, 'commenter')
    const suggestionsBefore = structuredClone(store.getSnapshot().suggestions)

    expect((await store.addSuggestion(trip.id, {
      dayIndex: 0, title: 'Fort Kochi', category: 'sightseeing', locationName: 'Kochi',
      lat: 9.96, lng: 76.24, visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
    })).status).toBe('forbidden')
    expect((await store.acceptSuggestionIntoTimeline(trip.id, suggestionId)).status).toBe('forbidden')
    expect((await store.declineSuggestion(trip.id, suggestionId)).status).toBe('forbidden')
    expect((await store.addDecision(trip.id, { question: 'Dinner?', options: [{ label: 'Fish' }, { label: 'Dal' }] })).status).toBe('forbidden')
    expect((await store.addDecisionOption(decisionId, { label: 'Prawns' })).status).toBe('forbidden')
    expect((await store.resolveDecision(decisionId, 'o_1')).status).toBe('forbidden')

    expect(sentTypes()).toEqual([])
    expect(store.getSnapshot().suggestions).toEqual(suggestionsBefore)
  })
})

describe('an editor keeps every command', () => {
  it('still sends the create command and the comment command', async () => {
    const store = await freshStore()
    const trip = store.duplicateTrip(keralaTrip, ownerId)
    const { suggestionId } = await seedContent(store, trip.id)
    seatAs(store, trip.id, 'editor')
    state.receipt = { status: 'applied', tripRevision: 3 }

    expect((await store.addSuggestion(trip.id, {
      dayIndex: 0, title: 'Fort Kochi', category: 'sightseeing', locationName: 'Kochi',
      lat: 9.96, lng: 76.24, visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
    })).status).toBe('applied')
    expect((await store.addCommentToSuggestion(trip.id, suggestionId, 'Book the guide')).status).toBe('applied')

    expect(sentTypes()).toEqual(['suggestion.create', 'suggestion.comment'])
  })
})

describe('the Group input tab gates its controls on canComment', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const tab = read('../src/pages/trip/GroupInputTab.tsx')
  const workspace = read('../src/pages/TripWorkspace.tsx')

  it('renders the vote buttons, the ballot radios and the Vote button only for a commenter', () => {
    expect(tab).toMatch(/\{canComment && \(\s*<button className=\{`vote-btn \$\{myVote === 1/)
    expect(tab).toMatch(/\{canComment && \(\s*<button className=\{`vote-btn \$\{myVote === -1/)
    expect(tab).toMatch(/disabled=\{locked \|\| !canComment\}/)
    expect(tab).toMatch(/\{!locked && canComment && \(\s*<button type="button" className="btn btn-primary btn-sm"/)
  })

  it('renders the comment forms and the comment toggle only for a commenter', () => {
    expect(tab).toMatch(/\{canComment && \(\s*<CommentForm onSubmit=\{text => addCommentToSuggestion/)
    expect(tab).toMatch(/\{canComment && \(\s*<SmoothCollapse open=\{commenting\}/)
    expect(tab).toMatch(/\{canComment \? \(\s*<button ref=\{commentToggleRef\}/)
  })

  it('keeps the composers and the accept, decline and resolve controls behind editable', () => {
    expect(tab).toMatch(/\{editable && \(\s*<div id="gi-idea-composer"/)
    expect(tab).toMatch(/\{editable && \(\s*<Surface className="card gin-panel">\s*<DecisionComposerForm/)
    expect(tab).toMatch(/\{editable && open && \(\s*<div className="gin-item-actions">/)
  })

  it('keeps the decision placement picker behind editable', () => {
    // A viewer or commenter must not see the day picker or the place button.
    expect(tab).toMatch(/\{editable && pickerOptionId && pickerOption\?\.place && \(/)
  })

  it('gets canComment from the same role source as editable', () => {
    expect(workspace).toContain('const commentable = canComment(role)')
    expect(workspace).toMatch(/const editable = canEdit\(role\)/)
    expect(workspace).toContain('editable={editable} canComment={commentable}')
  })
})
