// ============ Same-place repeat confirmation over the command ledger ============
// The last open product contract of #838: accepting a suggestion whose place is
// already a confirmed stop on the chosen day must NOT silently absorb into the
// existing stop. The server refuses with `needsDuplicate` (suggestion stays
// open), and only an explicit "Add another visit" (`allowDuplicate: true`)
// records the repeat. These pins drive the store's real path — the
// `submit_collab_command` RPC — not a local-write shortcut.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { seedData } from '../src/data/seed'
import { suggestionRowToEntry } from '../src/store/collabCommand'

type RpcCommand = { type?: string; allowDuplicate?: unknown }
type RpcParams = { p_command_id: string; p_trip_id: string; p_command: RpcCommand }

const { rpcCalls, ledger, rpcScript, accepts } = vi.hoisted(() => ({
  rpcCalls: [] as RpcParams[],
  /** command id → receipt, mirroring the server's collab_commands ledger. */
  ledger: new Map<string, Record<string, unknown>>(),
  rpcScript: {
    // The fixture suggestion's day; tests override per case.
    dayId: 'day-0',
    dayIndex: 0,
    /** The seeded suggestion row, mirrored here so the applied receipt can
     *  hydrate the cache the way the real server row would. */
    row: null as Record<string, unknown> | null,
  },
  /** Only the suggestion.accept calls — other commands (activity.append from
   *  ordinary writes) share the transport but not this contract. */
  accepts: [] as RpcParams[],
}))

vi.mock('../src/lib/supabase', async () => {
  const { tripWriteClient } = await import('./helpers/tripWriteClient')
  const makeBuilder = (table: string) => {
    let method: string | undefined
    let payload: unknown
    const builder: Record<string, unknown> = {}
    const chain = (m: string, p?: unknown) => { method = m; payload = p; return builder }
    builder.update = (p: unknown) => chain('update', p)
    builder.insert = (p: unknown) => chain('insert', p)
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.lt = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => { if (method) void payload; resolve({ data: null, error: null }) }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: true,
    supabase: tripWriteClient({
      from: (t: string) => makeBuilder(t),
      rpc: (name: string, params: RpcParams) => {
        if (name !== 'submit_collab_command') return Promise.resolve({ data: null, error: null })
        rpcCalls.push(structuredClone(params))
        const prior = ledger.get(params.p_command_id)
        if (prior) {
          if (JSON.stringify((prior as { __params?: RpcParams }).__params) !== JSON.stringify(params)) {
            return Promise.resolve({ data: { status: 'conflict', tripRevision: 0 }, error: null })
          }
          return Promise.resolve({ data: { ...structuredClone(prior), status: 'alreadyApplied' }, error: null })
        }
        const c = params.p_command
        let receipt: Record<string, unknown>
        if (c.type === 'activity.append') {
          // Ordinary writes append activity through the same ledger; a truthful
          // receipt keeps the queue from retrying around the assertion.
          receipt = { status: 'applied', tripRevision: 0, activityId: 'act-fixture', notificationIds: [] }
        } else if (c.type !== 'suggestion.accept') {
          receipt = { status: 'conflict', tripRevision: 0 }
        } else {
          accepts.push(structuredClone(params))
          if ((rpcScript.row as { status?: string } | null)?.status === 'accepted') {
            // State idempotency: the suggestion is already accepted, so a further
            // accept answers alreadyApplied without a placement (the row may have
            // lost its stop — the #839/F5 contract).
            receipt = { status: 'alreadyApplied', tripRevision: 1 }
          } else if (c.allowDuplicate === true) {
            const hydrated = structuredClone(rpcScript.row ?? {}) as Record<string, unknown>
            hydrated.status = 'accepted'
            hydrated.accepted_stop_id = 'st_repeat-new'
            receipt = { status: 'applied', tripRevision: 1, stopId: 'st_repeat-new', suggestion: hydrated }
          } else {
            // The server contract under repair: same-place same-day is refused,
            // naming the resolved day — never answered with the existing stop id.
            receipt = { status: 'needsDuplicate', tripRevision: 0, dayId: rpcScript.dayId, dayIndex: rpcScript.dayIndex }
          }
          ledger.set(params.p_command_id, { ...structuredClone(receipt), __params: structuredClone(params) })
        }
        return Promise.resolve({ data: structuredClone(receipt), error: null })
      },
    }),
  }
})

import {
  addStop, duplicateTrip, tripById, getSnapshot, _setTripWriteDebounceMs,
} from '../src/store/store'

_setTripWriteDebounceMs(0)

const keralaTrip = seedData.trips[0]
const ownerId = 'owner-repeat'

function singleTrip() {
  rpcCalls.length = 0
  accepts.length = 0
  ledger.clear()
  getSnapshot().sessionUserId = ownerId
  const copy = duplicateTrip(keralaTrip, ownerId)
  // A fresh copy is unsynced (writeVersion undefined) and honestly refuses
  // every transition; these tests exercise the SYNCED state, so give the copy
  // the revision its persisted row would carry.
  copy.writeVersion = 0
  return copy
}

function seedSuggestion(tripId: string) {
  const db = getSnapshot()
  const row = {
    id: 'sugg-repeat', trip_id: tripId, day_index: 0, day_id: 'day-0', proposed_by: ownerId,
    title: 'Suggestion Cafe', category: 'food', location_name: 'Somewhere', lat: 10.1, lng: 76.7,
    description: null, visit_minutes: 30, estimated_entry_fee_inr: 0, estimated_transport_inr: 0,
    votes: [], comments: [], status: 'open', created_at: 1,
  }
  rpcScript.row = structuredClone(row)
  // Prior suites share this module cache; the fixture owns its row id.
  db.suggestions = db.suggestions.filter(x => x.id !== row.id)
  db.suggestions.push(suggestionRowToEntry(structuredClone(row)))
  return db.suggestions[db.suggestions.length - 1]
}

/** The existing stop that makes the place a same-day repeat. */
function seedExistingStop(tripId: string) {
  getSnapshot().sessionUserId = ownerId
  return addStop(tripId, 0, {
    title: 'Suggestion Cafe', category: 'food', locationName: 'Somewhere',
    lat: 10.1, lng: 76.7, visitMinutes: 30,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'nice-to-have', status: 'confirmed',
  })
}

beforeEach(() => {
  rpcScript.dayId = 'day-0'
  rpcScript.dayIndex = 0
  rpcScript.row = null
})

describe('#838 repeat confirmation over the command ledger', () => {
  it('a same-place same-day accept is refused as needsDuplicate; the suggestion stays open', async () => {
    const copy = singleTrip()
    const dayId = tripById(copy.id)!.days[0].id
    rpcScript.dayId = dayId
    seedExistingStop(copy.id)
    const sg = seedSuggestion(copy.id)
    const { acceptSuggestionIntoTimeline } = await import('../src/store/store')

    const outcome = await acceptSuggestionIntoTimeline(copy.id, sg.id)

    expect(outcome).toMatchObject({ status: 'needsDuplicate', dayId, dayIndex: 0 })
    // Nothing was accepted: the row the user sees is untouched.
    expect(getSnapshot().suggestions.find(x => x.id === sg.id)!.status).toBe('open')
    // The refusal reached the server as a plain accept — the flag exists only
    // on an explicit Add-another choice.
    expect(accepts).toHaveLength(1)
    expect(Object.keys(accepts[0].p_command)).not.toContain('allowDuplicate')
  })

  it('a retry of the refused command answers needsDuplicate again, never alreadyApplied', async () => {
    const copy = singleTrip()
    const dayId = tripById(copy.id)!.days[0].id
    rpcScript.dayId = dayId
    seedExistingStop(copy.id)
    const sg = seedSuggestion(copy.id)
    const { acceptSuggestionIntoTimeline } = await import('../src/store/store')

    expect((await acceptSuggestionIntoTimeline(copy.id, sg.id)).status).toBe('needsDuplicate')
    // A client retry mints a fresh command id (the ledger holds no refused
    // receipt), and the server refuses again — a refusal is never promoted to
    // a confirmed accept by trying once more.
    expect((await acceptSuggestionIntoTimeline(copy.id, sg.id)).status).toBe('needsDuplicate')
    expect(accepts).toHaveLength(2)
    expect(accepts[1].p_command).toMatchObject({ type: 'suggestion.accept' })
    expect(getSnapshot().suggestions.find(x => x.id === sg.id)!.status).toBe('open')
  })

  it('Add another records the repeated visit: applied once, suggestion accepted', async () => {
    const copy = singleTrip()
    const dayId = tripById(copy.id)!.days[0].id
    seedExistingStop(copy.id)
    const sg = seedSuggestion(copy.id)
    const { acceptSuggestionIntoTimeline } = await import('../src/store/store')

    const outcome = await acceptSuggestionIntoTimeline(copy.id, sg.id, { dayId, allowDuplicate: true })

    expect(outcome).toMatchObject({ status: 'applied', stopId: 'st_repeat-new' })
    expect(getSnapshot().suggestions.find(x => x.id === sg.id)!.status).toBe('accepted')
    // The explicit user choice is on the wire — the only way it ever is.
    expect(accepts).toHaveLength(1)
    expect(accepts[0].p_command).toMatchObject({ type: 'suggestion.accept', allowDuplicate: true })
  })

  it('accepting an already-accepted suggestion answers alreadyApplied without a new placement', async () => {
    const copy = singleTrip()
    const dayId = tripById(copy.id)!.days[0].id
    seedExistingStop(copy.id)
    const sg = seedSuggestion(copy.id)
    const { acceptSuggestionIntoTimeline } = await import('../src/store/store')

    expect((await acceptSuggestionIntoTimeline(copy.id, sg.id, { dayId, allowDuplicate: true })).status).toBe('applied')
    // Mirror the server row the first accept just flipped; a further accept
    // (fresh command id) is a state no-op — one suggestion, no second receipt
    // flip, no placement.
    rpcScript.row = { ...(rpcScript.row ?? {}), status: 'accepted', accepted_stop_id: 'st_repeat-new' }
    const second = await acceptSuggestionIntoTimeline(copy.id, sg.id, { dayId, allowDuplicate: true })
    expect(second).toMatchObject({ status: 'alreadyApplied' })
    expect('stopId' in second && second.stopId !== undefined ? second.stopId : undefined).toBeUndefined()
    expect(getSnapshot().suggestions.filter(x => x.id === sg.id)).toHaveLength(1)
    expect(getSnapshot().suggestions.find(x => x.id === sg.id)!.status).toBe('accepted')
  })
})
