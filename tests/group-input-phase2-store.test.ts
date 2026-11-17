// Group input phase 2 (#972): the store actions, through a mocked transport.
// Covers loadCrewPreferences (failed, ready-empty, ready-with-rows, ordering),
// the own channel for crew_preferences, setMyCrewPreferences (rollback and the
// re-read after `unavailable`), addDecisionOption, the advisory closing-time
// pre-check on votes and options, and the cache cascade. Pattern: the mocked
// supabase of decision-comments.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seedData } from '../src/data/seed'
import { sliceState } from '../src/lib/readState'
import type { DecisionOption } from '../src/data/types'
import type { CollabCommand } from '../src/store/collabCommand'

type Answer = { data: unknown; error: unknown }
type Rec = { name: string; handlers: string[]; cb?: (status: string) => void }
type DecisionRow = {
  id: string; trip_id: string; question: string; context?: string
  options: DecisionOption[]; votes_by_user_id: Record<string, string | null>
  status: 'open'; raised_by: string; closes_at?: number; day_id?: string
}

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; payload?: unknown }>,
  channels: [] as Array<{ name: string; handlers: string[]; cb?: (status: string) => void }>,
  removed: [] as string[],
  /** Answer of each crew_preferences read, in call order. */
  crewReads: [] as Array<() => Promise<{ data: unknown; error: unknown }> | { data: unknown; error: unknown }>,
  /** Answer of each RPC, by name. */
  rpc: {} as Record<string, (params: unknown) => Promise<{ data: unknown; error: unknown }> | { data: unknown; error: unknown }>,
  decisions: new Map<string, DecisionRow>(),
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
    builder.select = () => { method = 'select'; return builder }
    builder.eq = (col: string, val: unknown) => { payload = { ...(payload as object), [col]: val }; return builder }
    builder.in = (col: string, val: unknown) => { payload = { ...(payload as object), [`in:${col}`]: val }; return builder }
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) => {
      if (method) h.calls.push({ table, method, payload })
      if (table === 'crew_preferences' && method === 'select') {
        const next = h.crewReads.shift()
        return Promise.resolve(next ? next() : { data: [], error: null }).then(res, rej)
      }
      return Promise.resolve({ data: null, error: null }).then(res, rej)
    }
    return builder
  }
  const supabase = {
    from: (t: string) => makeBuilder(t),
    rpc: (fn: string, params?: { p_trip_id: string; p_command: CollabCommand }) => {
      const qb: Record<string, unknown> = {}
      qb.then = (res: (v: Answer) => unknown, rej?: (e: unknown) => unknown) => {
        h.calls.push({ table: fn, method: 'rpc', payload: params })
        const defaultAnswer = () => {
          const command = params?.p_command
          if (fn !== 'submit_collab_command' || !command || !('decisionId' in command)) {
            return { data: { status: 'applied', tripRevision: 1 }, error: null }
          }
          if (command.type === 'decision.create') {
            h.decisions.set(command.decisionId, {
              id: command.decisionId, trip_id: params.p_trip_id,
              question: command.decision.question, context: command.decision.context,
              options: command.decision.options, votes_by_user_id: {},
              status: 'open', raised_by: 'owner-p2',
              closes_at: command.decision.closesAt, day_id: command.decision.dayId,
            })
          }
          const decision = h.decisions.get(command.decisionId)
          if (decision && command.type === 'decision.option.add') {
            decision.options = [...decision.options, { ...command.option, addedBy: 'owner-p2' }]
          }
          if (decision && command.type === 'decision.ballot') {
            decision.votes_by_user_id['owner-p2'] = command.optionId
          }
          return { data: { status: 'applied', tripRevision: 1, decision: structuredClone(decision) }, error: null }
        }
        // A Map lookup, so only a handler the test set can run.
        const handler = new Map(Object.entries(h.rpc)).get(fn)
        const answer = handler?.(params) ?? defaultAnswer()
        return Promise.resolve(answer).then(res, rej)
      }
      return qb
    },
    channel: (name: string) => {
      const rec: Rec = { name, handlers: [] }
      h.channels.push(rec)
      const ch: Record<string, unknown> = {}
      ch.on = (_type: string, cfg: { table: string }) => { rec.handlers.push(cfg.table); return ch }
      ch.subscribe = (cb?: (status: string) => void) => { rec.cb = cb; return ch }
      return ch
    },
    removeChannel: (ch: unknown) => { h.removed.push(String(ch)); return Promise.resolve('ok') },
  }
  return { supabase, isSupabaseConfigured: true }
})

const keralaTrip = seedData.trips[0]
const ownerId = 'owner-p2'
const otherId = 'member-p2'

async function freshStore() {
  vi.resetModules()
  const store = await import('../src/store/store')
  const trip = store.duplicateTrip(keralaTrip, ownerId)
  store.getSnapshot().sessionUserId = ownerId
  // The signed-in user is a member of the trip, which setMyCrewPreferences checks first.
  Object.assign(store.tripById(trip.id)!, {
    members: [{ userId: ownerId, role: 'owner', joinedAt: 1 }, { userId: otherId, role: 'editor', joinedAt: 2 }],
  })
  h.calls.length = 0
  return { store, tripId: trip.id }
}

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }
const row = (tripId: string, userId: string, interests: string[], updatedAt = 1) =>
  ({ trip_id: tripId, user_id: userId, interests, updated_at: updatedAt })
const commands = (type: string) => h.calls
  .filter(c => c.table === 'submit_collab_command' && c.method === 'rpc')
  .map(c => (c.payload as { p_command?: { type?: string } }).p_command)
  .filter(cmd => cmd?.type === type)
const crewReadCalls = () => h.calls.filter(c => c.table === 'crew_preferences' && c.method === 'select')
const crewRpcCalls = () => h.calls.filter(c => c.table === 'set_my_crew_preferences' && c.method === 'rpc')

beforeEach(() => {
  h.decisions.clear()
  h.calls.length = 0
  h.channels.length = 0
  h.removed.length = 0
  h.crewReads.length = 0
  for (const k of Object.keys(h.rpc)) delete h.rpc[k]
})

describe('loadCrewPreferences: failed, reading, ready-empty and ready-with-rows stay apart', () => {
  it('a failed read is `failed`, keeps no rows, and opens no channel', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: null, error: { message: 'relation "crew_preferences" does not exist' } }))
    expect(await store.loadCrewPreferences(tripId)).toBe('failed')
    const snap = store.getSnapshot()
    expect(sliceState(snap.crewPreferenceReads, tripId)).toBe('failed')
    expect(snap.crewPreferences).toEqual([])
    expect(h.channels).toEqual([])
  })

  it('a thrown read is `failed` too', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => Promise.reject(new Error('network down')))
    expect(await store.loadCrewPreferences(tripId)).toBe('failed')
    expect(sliceState(store.getSnapshot().crewPreferenceReads, tripId)).toBe('failed')
  })

  it('a read with no rows is `ready` and empty, which means nobody answered', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [], error: null }))
    expect(await store.loadCrewPreferences(tripId)).toBe('ok')
    const snap = store.getSnapshot()
    expect(sliceState(snap.crewPreferenceReads, tripId)).toBe('ready')
    expect(snap.crewPreferences.filter(p => p.tripId === tripId)).toEqual([])
  })

  it('a read with rows maps them and drops a row that has no member', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({
      data: [row(tripId, ownerId, ['food', 'temple'], 5), row(tripId, otherId, [], 6), { trip_id: tripId, interests: ['food'] }],
      error: null,
    }))
    expect(await store.loadCrewPreferences(tripId)).toBe('ok')
    const rows = store.getSnapshot().crewPreferences.filter(p => p.tripId === tripId)
    expect(rows).toHaveLength(2)
    expect(rows.find(p => p.userId === ownerId)).toMatchObject({ interests: ['food', 'temple'], updatedAt: 5 })
    // An empty list is an answer ("none of these"), not a missing row.
    expect(rows.find(p => p.userId === otherId)).toMatchObject({ interests: [] })
  })

  it('a failed re-read keeps the rows held and says `failed`', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'])], error: null }))
    await store.loadCrewPreferences(tripId)
    h.crewReads.push(() => ({ data: null, error: { message: 'boom' } }))
    expect(await store.loadCrewPreferences(tripId)).toBe('failed')
    const snap = store.getSnapshot()
    expect(sliceState(snap.crewPreferenceReads, tripId)).toBe('failed')
    expect(snap.crewPreferences.filter(p => p.tripId === tripId)).toHaveLength(1)
  })

  it('marks the trip `reading` before the fetch lands', async () => {
    const { store, tripId } = await freshStore()
    let release!: () => void
    h.crewReads.push(() => new Promise(resolve => { release = () => resolve({ data: [], error: null }) }))
    const pending = store.loadCrewPreferences(tripId)
    expect(store.getSnapshot().crewPreferenceReads[tripId]).toBe('reading')
    expect(sliceState(store.getSnapshot().crewPreferenceReads, tripId)).toBe('reading')
    await flush()
    release()
    expect(await pending).toBe('ok')
    expect(sliceState(store.getSnapshot().crewPreferenceReads, tripId)).toBe('ready')
  })

  it('does not flip a ready trip back to `reading` during a refresh', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'])], error: null }))
    await store.loadCrewPreferences(tripId)
    let release!: () => void
    h.crewReads.push(() => new Promise(resolve => { release = () => resolve({ data: [], error: null }) }))
    const pending = store.loadCrewPreferences(tripId)
    expect(store.getSnapshot().crewPreferenceReads[tripId]).toBe('ok')
    await flush()
    release()
    await pending
  })

  it('an older read cannot overwrite a newer one', async () => {
    const { store, tripId } = await freshStore()
    let releaseOld!: () => void
    h.crewReads.push(() => new Promise(resolve => {
      releaseOld = () => resolve({ data: [row(tripId, ownerId, ['beach'])], error: null })
    }))
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'])], error: null }))
    const older = store.loadCrewPreferences(tripId)
    const newer = store.loadCrewPreferences(tripId)
    expect(await newer).toBe('ok')
    releaseOld()
    await older
    const mine = store.getSnapshot().crewPreferences.find(p => p.tripId === tripId && p.userId === ownerId)
    expect(mine?.interests).toEqual(['food'])
  })

  it('returns `failed` with no session and sends nothing', async () => {
    const { store, tripId } = await freshStore()
    store.getSnapshot().sessionUserId = null
    expect(await store.loadCrewPreferences(tripId)).toBe('failed')
    expect(crewReadCalls()).toHaveLength(0)
  })
})

describe('crew_preferences has its own realtime channel', () => {
  it('opens `yatraflow-crew` after the first good read, once, and never touches the live channel', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [], error: null }), () => ({ data: [], error: null }))
    await store.loadCrewPreferences(tripId)
    await store.loadCrewPreferences(tripId)
    expect(h.channels.map(c => c.name)).toEqual(['yatraflow-crew'])
    expect(h.channels[0].handlers).toEqual(['crew_preferences'])
    expect(h.removed).toEqual([])
  })

  it('a channel error is logged and changes nothing else', async () => {
    const { store, tripId } = await freshStore()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'])], error: null }))
    await store.loadCrewPreferences(tripId)
    h.channels[0].cb?.('CHANNEL_ERROR')
    h.channels[0].cb?.('TIMED_OUT')
    await flush()
    expect(h.removed).toEqual([])
    expect(h.channels.map(c => c.name)).toEqual(['yatraflow-crew'])
    expect(store.getSnapshot().crewPreferences).toHaveLength(1)
    error.mockRestore()
  })

  it('resyncs on every SUBSCRIBED, the first one too, and sweeps a row the server dropped', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food']), row(tripId, otherId, ['rest'])], error: null }))
    await store.loadCrewPreferences(tripId)
    h.calls.length = 0
    // While the channel was down, the other member's row was deleted and the owner's row changed.
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['beach'], 9)], error: null }))
    h.channels[0].cb?.('SUBSCRIBED')
    await flush()
    expect(crewReadCalls()).toHaveLength(1)
    const rows = store.getSnapshot().crewPreferences.filter(p => p.tripId === tripId)
    expect(rows.map(p => [p.userId, p.interests])).toEqual([[ownerId, ['beach']]])
  })

  it('a failed resync leaves the cache as it was', async () => {
    const { store, tripId } = await freshStore()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'])], error: null }))
    await store.loadCrewPreferences(tripId)
    h.crewReads.push(() => ({ data: null, error: { message: 'down' } }))
    h.channels[0].cb?.('SUBSCRIBED')
    await flush()
    expect(store.getSnapshot().crewPreferences.filter(p => p.tripId === tripId)).toHaveLength(1)
    error.mockRestore()
  })

  it('does not list crew_preferences among the tables of the live channel', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8')
    const list = /const RESYNC_TABLES = \[([^\]]+)\]/.exec(source)
    expect(list).not.toBeNull()
    expect(list![1]).not.toContain('crew_preferences')
  })
})

describe('setMyCrewPreferences', () => {
  it('shows the answer at once and adopts the stored row', async () => {
    const { store, tripId } = await freshStore()
    let release!: () => void
    h.rpc.set_my_crew_preferences = () => new Promise(resolve => {
      release = () => resolve({ data: { status: 'applied', preference: row(tripId, ownerId, ['food', 'temple'], 77) }, error: null })
    })
    const pending = store.setMyCrewPreferences(tripId, ['temple', 'food'])
    expect(store.getSnapshot().crewPreferences.find(p => p.tripId === tripId && p.userId === ownerId)?.interests).toEqual(['food', 'temple'])
    await flush()
    release()
    expect(await pending).toMatchObject({ status: 'applied' })
    expect(store.getSnapshot().crewPreferences.find(p => p.tripId === tripId && p.userId === ownerId)?.updatedAt).toBe(77)
    expect(crewRpcCalls()[0].payload).toEqual({ p_trip_id: tripId, p_interests: ['food', 'temple'] })
  })

  it('puts the previous row back when the server refuses', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['rest'], 3)], error: null }))
    await store.loadCrewPreferences(tripId)
    h.rpc.set_my_crew_preferences = () => ({ data: { status: 'forbidden' }, error: null })
    expect(await store.setMyCrewPreferences(tripId, ['food'])).toMatchObject({ status: 'forbidden' })
    const mine = store.getSnapshot().crewPreferences.find(p => p.tripId === tripId && p.userId === ownerId)
    expect(mine).toMatchObject({ interests: ['rest'], updatedAt: 3 })
  })

  it('removes the optimistic row when there was none and the server refuses', async () => {
    const { store, tripId } = await freshStore()
    h.rpc.set_my_crew_preferences = () => ({ data: { status: 'invalid' }, error: null })
    expect(await store.setMyCrewPreferences(tripId, ['food'])).toMatchObject({ status: 'invalid' })
    expect(store.getSnapshot().crewPreferences.filter(p => p.tripId === tripId)).toEqual([])
  })

  it('reads the trip again after `unavailable`, and shows what the server holds', async () => {
    const { store, tripId } = await freshStore()
    h.rpc.set_my_crew_preferences = () => ({ data: null, error: { message: 'timeout' } })
    // The write did reach the server: the re-read finds the new answer.
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'], 12)], error: null }))
    expect(await store.setMyCrewPreferences(tripId, ['food'])).toMatchObject({ status: 'unavailable' })
    await flush()
    expect(crewReadCalls()).toHaveLength(1)
    const mine = store.getSnapshot().crewPreferences.find(p => p.tripId === tripId && p.userId === ownerId)
    expect(mine).toMatchObject({ interests: ['food'], updatedAt: 12 })
    expect(sliceState(store.getSnapshot().crewPreferenceReads, tripId)).toBe('ready')
  })

  it('does not read again after a plain refusal', async () => {
    const { store, tripId } = await freshStore()
    h.rpc.set_my_crew_preferences = () => ({ data: { status: 'forbidden' }, error: null })
    await store.setMyCrewPreferences(tripId, ['food'])
    await flush()
    expect(crewReadCalls()).toHaveLength(0)
  })

  it('refuses an unknown interest and a non-member without sending anything', async () => {
    const { store, tripId } = await freshStore()
    expect(await store.setMyCrewPreferences(tripId, ['nonsense' as never])).toMatchObject({ status: 'invalid' })
    store.getSnapshot().sessionUserId = 'stranger'
    expect(await store.setMyCrewPreferences(tripId, ['food'])).toMatchObject({ status: 'forbidden' })
    expect(crewRpcCalls()).toHaveLength(0)
  })
})

describe('addDecisionOption', () => {
  async function raise(closesAt?: number) {
    const ctx = await freshStore()
    await ctx.store.addDecision(ctx.tripId, {
      question: 'Houseboat or resort?',
      options: [{ id: 'o_1', label: 'Houseboat' }, { id: 'o_2', label: 'Resort' }],
      ...(closesAt !== undefined ? { closesAt } : {}),
    })
    const list = ctx.store.getSnapshot().decisions
    const d = list[list.length - 1]
    h.calls.length = 0
    return { ...ctx, decisionId: d.id }
  }
  const optionsOf = (store: Awaited<ReturnType<typeof freshStore>>['store'], id: string) =>
    store.getSnapshot().decisions.find(x => x.id === id)!.options

  it('adds the option, records the signed-in member and sends no addedBy', async () => {
    const { store, decisionId } = await raise()
    const outcome = await store.addDecisionOption(decisionId, { label: '  Tent  ', costImpactInr: 500 })
    expect(outcome).toMatchObject({ status: 'applied' })
    const added = optionsOf(store, decisionId).find(o => o.label === 'Tent')
    expect(added).toMatchObject({ label: 'Tent', costImpactInr: 500, addedBy: ownerId })
    const sent = commands('decision.option.add')
    expect(sent).toHaveLength(1)
    expect(JSON.stringify(sent[0])).not.toContain('addedBy')
    expect(sent[0]).toMatchObject({ type: 'decision.option.add', decisionId, option: { label: 'Tent', costImpactInr: 500 } })
  })

  it('refuses a duplicate label (trimmed, any case) before it sends', async () => {
    const { store, decisionId } = await raise()
    expect(await store.addDecisionOption(decisionId, { label: ' HOUSEBOAT ' })).toMatchObject({ status: 'invalid', reason: 'duplicate option' })
    expect(await store.addDecisionOption(decisionId, { label: '   ' })).toMatchObject({ status: 'invalid' })
    expect(commands('decision.option.add')).toHaveLength(0)
    expect(optionsOf(store, decisionId)).toHaveLength(2)
  })

  it('refuses an unknown decision and a resolved one without sending', async () => {
    const { store, decisionId } = await raise()
    expect(await store.addDecisionOption('nope', { label: 'Tent' })).toMatchObject({ status: 'invalid' })
    const snap = store.getSnapshot()
    snap.decisions = snap.decisions.map(d => d.id === decisionId ? { ...d, status: 'resolved' as const } : d)
    expect(await store.addDecisionOption(decisionId, { label: 'Tent' })).toMatchObject({ status: 'invalid', reason: 'decision is not open' })
    expect(commands('decision.option.add')).toHaveLength(0)
  })

  it('rolls the option back when the server refuses', async () => {
    const { store, decisionId } = await raise()
    h.rpc.submit_collab_command = () => ({ data: { status: 'invalid', tripRevision: 1, reason: 'too many options' }, error: null })
    expect(await store.addDecisionOption(decisionId, { label: 'Tent' })).toMatchObject({ status: 'invalid', reason: 'too many options' })
    expect(optionsOf(store, decisionId).map(o => o.label)).toEqual(['Houseboat', 'Resort'])
  })

  it('does not trust the device clock: a closing time that looks past still goes to the server', async () => {
    const { store, decisionId } = await raise(Date.now() + 3_600_000)
    // The device clock says the closing time passed; the server says it did not.
    const snap = store.getSnapshot()
    snap.decisions = snap.decisions.map(d => d.id === decisionId ? { ...d, closesAt: 1 } : d)
    const outcome = await store.addDecisionOption(decisionId, { label: 'Tent' })
    expect(outcome).toMatchObject({ status: 'applied' })
    expect(commands('decision.option.add')).toHaveLength(1)
  })

  it('shows the server reason when the server says voting is closed, and rolls back', async () => {
    const { store, decisionId } = await raise(Date.now() + 3_600_000)
    h.rpc.submit_collab_command = () => ({ data: { status: 'invalid', tripRevision: 1, reason: 'voting is closed' }, error: null })
    expect(await store.addDecisionOption(decisionId, { label: 'Tent' })).toMatchObject({ status: 'invalid', reason: 'voting is closed' })
    expect(optionsOf(store, decisionId)).toHaveLength(2)
  })
})

describe('voteOnDecision: the closing time is advisory on the client', () => {
  async function raise(closesAt: number) {
    const ctx = await freshStore()
    await ctx.store.addDecision(ctx.tripId, {
      question: 'Houseboat or resort?',
      options: [{ id: 'o_1', label: 'Houseboat' }, { id: 'o_2', label: 'Resort' }],
      closesAt,
    })
    const list = ctx.store.getSnapshot().decisions
    const d = list[list.length - 1]
    h.calls.length = 0
    return { ...ctx, decisionId: d.id }
  }

  it('sends the ballot even when the device clock says the vote closed', async () => {
    const { store, decisionId } = await raise(Date.now() + 3_600_000)
    const snap = store.getSnapshot()
    snap.decisions = snap.decisions.map(d => d.id === decisionId ? { ...d, closesAt: 1 } : d)
    expect(await store.voteOnDecision(decisionId, 'o_1')).toMatchObject({ status: 'applied' })
    expect(commands('decision.ballot')).toHaveLength(1)
  })

  it('takes the server refusal and removes the vote it showed', async () => {
    const { store, decisionId } = await raise(Date.now() + 3_600_000)
    h.rpc.submit_collab_command = () => ({ data: { status: 'invalid', tripRevision: 1, reason: 'voting is closed' }, error: null })
    expect(await store.voteOnDecision(decisionId, 'o_1')).toMatchObject({ status: 'invalid', reason: 'voting is closed' })
    const d = store.getSnapshot().decisions.find(x => x.id === decisionId)!
    expect(Object.values(d.votesByUserId ?? {})).not.toContain('o_1')
  })

  it('still refuses an option the decision does not have, before it sends', async () => {
    const { store, decisionId } = await raise(Date.now() + 3_600_000)
    expect(await store.voteOnDecision(decisionId, 'missing')).toMatchObject({ status: 'invalid' })
    expect(commands('decision.ballot')).toHaveLength(0)
  })
})

describe('the cache cascade drops crew preferences with the trip', () => {
  const payload = (eventType: 'DELETE', old: Record<string, unknown>) =>
    ({ eventType, schema: 'public', table: '', commit_timestamp: '', old, new: {}, errors: null }) as never

  it('when the trip is deleted', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'])], error: null }))
    await store.loadCrewPreferences(tripId)
    store._applyRealtimeEventForTest('trips', payload('DELETE', { id: tripId }))
    const snap = store.getSnapshot()
    expect(snap.crewPreferences.filter(p => p.tripId === tripId)).toEqual([])
    expect(tripId in snap.crewPreferenceReads).toBe(false)
  })

  it('when the signed-in member is removed from the trip', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food']), row(tripId, otherId, ['rest'])], error: null }))
    await store.loadCrewPreferences(tripId)
    store._applyRealtimeEventForTest('trip_members', payload('DELETE', { trip_id: tripId, user_id: ownerId }))
    const snap = store.getSnapshot()
    expect(snap.crewPreferences.filter(p => p.tripId === tripId)).toEqual([])
    expect(tripId in snap.crewPreferenceReads).toBe(false)
  })

  it('keeps the rows when another member leaves', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food']), row(tripId, otherId, ['rest'])], error: null }))
    await store.loadCrewPreferences(tripId)
    store._applyRealtimeEventForTest('trip_members', payload('DELETE', { trip_id: tripId, user_id: otherId }))
    expect(tripId in store.getSnapshot().crewPreferenceReads).toBe(true)
  })

  it('a read that lands after the trip was dropped writes nothing', async () => {
    const { store, tripId } = await freshStore()
    let release!: () => void
    h.crewReads.push(() => new Promise(resolve => {
      release = () => resolve({ data: [row(tripId, ownerId, ['food'])], error: null })
    }))
    const pending = store.loadCrewPreferences(tripId)
    await flush()
    store._applyRealtimeEventForTest('trips', payload('DELETE', { id: tripId }))
    release()
    await pending
    const snap = store.getSnapshot()
    expect(snap.crewPreferences.filter(p => p.tripId === tripId)).toEqual([])
    expect(tripId in snap.crewPreferenceReads).toBe(false)
  })
})

describe('crew channel lifecycle and ordering', () => {
  const change = (eventType: 'INSERT' | 'UPDATE', next: Record<string, unknown>) =>
    ({ eventType, schema: 'public', table: '', commit_timestamp: '', old: {}, new: next, errors: null }) as never
  const crewChannels = () => h.channels.filter(c => c.name === 'yatraflow-crew')

  it('connectRealtime reopens the crew channel when a crew read is ok', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'])], error: null }))
    await store.loadCrewPreferences(tripId)
    expect(crewChannels()).toHaveLength(1)
    store.connectRealtime(ownerId)
    expect(crewChannels()).toHaveLength(2)
    expect(h.channels.some(c => c.name === 'yatraflow-live')).toBe(true)
    // The first crew channel was closed by the reconnect.
    expect(h.removed.length).toBeGreaterThanOrEqual(1)
    // Same user again: nothing is torn down or reopened.
    store.connectRealtime(ownerId)
    expect(crewChannels()).toHaveLength(2)
  })

  it('connectRealtime opens no crew channel when no crew read is ok', async () => {
    const { store } = await freshStore()
    store.connectRealtime(ownerId)
    expect(crewChannels()).toHaveLength(0)
  })

  it('CLOSED forgets the crew channel and the next read opens a new one', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [], error: null }), () => ({ data: [], error: null }))
    await store.loadCrewPreferences(tripId)
    crewChannels()[0].cb?.('CLOSED')
    await store.loadCrewPreferences(tripId)
    expect(crewChannels()).toHaveLength(2)
  })

  it('logs a channel error once per channel lifetime', async () => {
    const { store, tripId } = await freshStore()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.crewReads.push(() => ({ data: [], error: null }))
    await store.loadCrewPreferences(tripId)
    crewChannels()[0].cb?.('CHANNEL_ERROR')
    crewChannels()[0].cb?.('CHANNEL_ERROR')
    crewChannels()[0].cb?.('TIMED_OUT')
    expect(error.mock.calls.filter(c => String(c[0]).includes('crew preferences channel'))).toHaveLength(1)
    error.mockRestore()
  })

  it('a resync keeps the optimistic row of an own write still in flight', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'], 5)], error: null }))
    await store.loadCrewPreferences(tripId)
    let release!: () => void
    h.rpc.set_my_crew_preferences = () => new Promise(resolve => {
      release = () => resolve({ data: { status: 'applied', preference: row(tripId, ownerId, ['temple'], 99) }, error: null })
    })
    const pending = store.setMyCrewPreferences(tripId, ['temple'])
    await flush()
    // The server still returns the old row while the write is in flight.
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'], 5)], error: null }))
    crewChannels()[0].cb?.('SUBSCRIBED')
    await flush()
    expect(store.getSnapshot().crewPreferences.find(p => p.userId === ownerId)?.interests).toEqual(['temple'])
    release()
    await pending
    expect(store.getSnapshot().crewPreferences.find(p => p.userId === ownerId)?.updatedAt).toBe(99)
  })

  it('a realtime upsert with an older updatedAt does not replace a newer cached row', async () => {
    const { store, tripId } = await freshStore()
    h.crewReads.push(() => ({ data: [row(tripId, ownerId, ['food'], 50)], error: null }))
    await store.loadCrewPreferences(tripId)
    store._applyRealtimeEventForTest('crew_preferences', change('UPDATE', row(tripId, ownerId, ['rest'], 10)))
    expect(store.getSnapshot().crewPreferences.find(p => p.userId === ownerId)?.interests).toEqual(['food'])
    store._applyRealtimeEventForTest('crew_preferences', change('UPDATE', row(tripId, ownerId, ['beach'], 60)))
    expect(store.getSnapshot().crewPreferences.find(p => p.userId === ownerId)?.interests).toEqual(['beach'])
  })
})
