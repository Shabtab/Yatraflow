// ============ #335 — an option id is a contract, not a placeholder ============
//
// `addDecision` used to rewrite EVERY option id with `uid('o')`, which broke
// the whole crew slot-vote line end to end:
//
//   * the Map rail raises a poll with ids `slot:<key>:<hit>` so `voteFor` can
//     join a poll to its part and `resolveDecision` can stamp `slotKey` on the
//     stop it lands — the rewrite destroyed both, so a resolved vote filled
//     nothing and the rail never showed the live tally;
//   * the shortlist raises one with the PLACE id (`String(h.id)`, #180) so a
//     re-add collapses into the poll already open — the rewrite forked a new
//     poll every time.
//
// These tests go through the REAL store (mocked transport) rather than a
// hand-built decision, because a fixture with `slot:` ids passes today's rail
// code even while the store rewrites them — which is exactly how the bug
// stayed invisible.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
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
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.lt = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => { if (method) calls.push({ table, method, payload }); resolve({ data: null, error: null }) }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: false,
    supabase: {
      from: (t: string) => makeBuilder(t),
      // Stage A of #832: decision.create travels through the collab-command
      // RPC. The stub records the arguments and answers an applied receipt
      // with no canonical row, so the optimistic cache entry stands.
      rpc: (fn: string, params?: unknown) => {
        const qb: Record<string, unknown> = {}
        qb.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
          new Promise(resolve => { calls.push({ table: fn, method: 'rpc', payload: params }); resolve({ data: { status: 'applied', tripRevision: 1 }, error: null }) }).then(res)
        return qb
      },
    },
  }
})

import {
  addDecision, voteOnDecision, resolveDecision, duplicateTrip, tripById, getSnapshot,
} from '../src/store/store'
import { daySlots, type DaySlotsDeps } from '../src/lib/daySlots'
import type { RideSegment, SegmentHit } from '../src/lib/ridePlan'
import type { TripDecision } from '../src/data/types'

const ownerId = 'owner-335'
const keralaTrip = seedData.trips[0]

function freshTrip() {
  calls.length = 0
  return duplicateTrip(keralaTrip, ownerId)
}

function lastDecision(): TripDecision {
  const list = getSnapshot().decisions
  return list[list.length - 1]
}

/** The Map-rail poll shape the transition path resolves. */
function raiseSlotPoll(tripId: string): TripDecision {
  addDecision(tripId, {
    question: 'Day 1 lunch - where?',
    options: [{
      id: 'slot:lunch:h1',
      label: 'Grand Hotel',
      place: {
        title: 'Grand Hotel', category: 'food', locationName: 'Ernakulam',
        lat: 10.01, lng: 76.3, description: '', visitMinutes: 45, dayIndex: 0,
      },
    }],
  })
  return lastDecision()
}

function decisionInsertPayload(): { options?: Array<{ id?: string }> } | undefined {
  const call = calls.find(c => c.table === 'submit_collab_command' && c.method === 'rpc')
  const params = call?.payload as { p_command?: { decision?: { options?: Array<{ id?: string }> } } } | undefined
  return params?.p_command?.decision
}

/** The transport is fire-and-forget: the builder's `then` records the call on
 *  a microtask, so a synchronous read would see an empty ledger and report the
 *  row as unwritten (the exact false negative this suite exists to avoid). */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** Minimal engine deps so a lunch slot exists (eta 735 = 12:15, inside the
 *  window — the same figure tests/daySlots.test.ts uses for this slot). */
function seg(purpose: RideSegment['purpose'], over: Partial<RideSegment> = {}): RideSegment {
  return {
    index: 0, purpose, label: purpose, targetKm: 100, minKm: 80, maxKm: 130,
    kmFromPrev: 100, minutesFromPrev: 120, hint: '', ...over,
  }
}
const railDeps = (over: Partial<DaySlotsDeps> = {}): DaySlotsDeps => ({
  haltSegments: [{ segment: seg('meal', { etaMinutes: 735 }), hit: null, score: 12 } as SegmentHit],
  dayStops: [],
  anchors: [{ lat: 10, lng: 76 }],
  ...over,
})

describe('#335 — addDecision preserves the option ids its caller supplied', () => {
  it('keeps the map rail`s slot ids, in the cache AND in the command it sends', async () => {
    const trip = freshTrip()
    getSnapshot().sessionUserId = ownerId
    addDecision(trip.id, {
      question: 'Day 1 lunch - where?',
      context: 'Voting from the day plan',
      options: [
        { id: 'slot:lunch:h1', label: 'Grand Hotel' },
        { id: 'slot:lunch:h2', label: 'Halais' },
      ],
    })
    await flush()

    const cached = lastDecision()
    expect(cached.options.map(o => o.id)).toEqual(['slot:lunch:h1', 'slot:lunch:h2'])
    // The DB row is a SEPARATE object — the old rewrite hit both, so both
    // halves are asserted: a cache-only fix would still lose it on reload.
    expect(decisionInsertPayload()?.options?.map(o => o.id)).toEqual(['slot:lunch:h1', 'slot:lunch:h2'])
  })

  it('keeps a shortlist poll`s place ids, so a re-add collapses into it', async () => {
    const trip = freshTrip()
    getSnapshot().sessionUserId = ownerId
    addDecision(trip.id, {
      question: 'Which of these should we add?',
      context: 'Shortlisted from the Map rail',
      options: [
        { id: 'h-1234', label: 'Baker Street Cafe' },
        { id: 'h-5678', label: 'Fort View Point' },
      ],
    })
    await flush()
    expect(lastDecision().options.map(o => o.id)).toEqual(['h-1234', 'h-5678'])
    expect(decisionInsertPayload()?.options?.map(o => o.id)).toEqual(['h-1234', 'h-5678'])
  })

  it('mints only what the caller did not supply — absent ids, and duplicates', () => {
    const trip = freshTrip()
    getSnapshot().sessionUserId = ownerId
    addDecision(trip.id, {
      question: 'Hand-typed, no ids at all?',
      options: [{ label: 'Yes' }, { label: 'No' }],
    })
    const minted = lastDecision().options.map(o => o.id)
    expect(minted).toHaveLength(2)
    expect(minted.every(id => /^o_/.test(id))).toBe(true)
    expect(new Set(minted).size).toBe(2)

    // A caller that hands the SAME id twice must not end up with one vote
    // counting for both options — the duplicate is minted, the first is kept.
    addDecision(trip.id, {
      question: 'Two options, one id?',
      options: [{ id: 'dup', label: 'A' }, { id: 'dup', label: 'B' }],
    })
    const deduped = lastDecision().options.map(o => o.id)
    expect(deduped[0]).toBe('dup')
    expect(deduped[1]).not.toBe('dup')
    expect(new Set(deduped).size).toBe(2)
  })
})

describe('#335 — the slot vote survives addDecision end to end', () => {
  it('the rail finds the live poll on its part after the store has stored it', () => {
    const trip = freshTrip()
    getSnapshot().sessionUserId = ownerId
    addDecision(trip.id, {
      question: 'Day 1 lunch - where?',
      options: [{ id: 'slot:lunch:h1', label: 'Grand Hotel' }, { id: 'slot:lunch:h2', label: 'Halais' }],
    })
    const d = lastDecision()
    voteOnDecision(d.id, d.options[1].id)
    // voteOnDecision clones the row into the cache — the object we hold is now
    // stale, and the rail reads votes off the LIVE one.
    const live = getSnapshot().decisions.find(x => x.id === d.id)!

    // THIS poll only: `voteFor` takes the first open decision naming the part,
    // and earlier tests in this file (or a seeded one) may name it too.
    const lunch = daySlots(0, railDeps({ decisions: [live], memberCount: 3 }))
      .find(s => s.key === 'lunch')
    expect(lunch?.vote?.decisionId).toBe(live.id)   // fails before the fix: the ids were rewritten
    expect(lunch?.vote?.votesCast).toBe(1)
    expect(lunch?.vote?.leadingLabel).toBe('Halais')
    // ONE quorum: the denominator is the crew (members), the same figure
    // Group Input divides by — not `travellers`, which can count non-crew.
    expect(lunch?.vote?.voters).toBe(3)
  })

  it('sends the stable slot option id through the server transition receipt', async () => {
    const trip = freshTrip()
    getSnapshot().sessionUserId = ownerId
    // The transition preflight is strict: a copy with no server revision never
    // sends a CAS transition, so this poll resolves on a persisted trip.
    tripById(trip.id)!.writeVersion = 1
    const before = tripById(trip.id)!.days[0].stops.length
    addDecision(trip.id, {
      question: 'Day 1 lunch - where?',
      options: [{
        id: 'slot:lunch:h1',
        label: 'Grand Hotel',
        place: {
          title: 'Grand Hotel', category: 'food', locationName: 'Ernakulam',
          lat: 10.01, lng: 76.3, description: '', visitMinutes: 45, dayIndex: 0,
        },
      }],
    })
    const d = lastDecision()
    await resolveDecision(d.id, d.options[0].id)

    const transition = calls.find(c => c.table === 'submit_collab_command' && c.method === 'rpc' &&
      (c.payload as { p_command?: { type?: string } } | undefined)?.p_command?.type === 'decision.resolve')
    expect((transition?.payload as { p_command?: { optionId?: string } } | undefined)?.p_command?.optionId).toBe('slot:lunch:h1')
    // The client holds no optimistic placement. The server must acknowledge a
    // winning stop before the itinerary can report the slot as filled.
    expect(tripById(trip.id)!.days[0].stops.length).toBe(before)
  })

  it('an unsynced copy refuses the transition before any RPC', async () => {
    const trip = freshTrip()
    getSnapshot().sessionUserId = ownerId
    // A duplicated copy has no server revision yet (buildTripCopy clears
    // writeVersion): the strict preflight must answer unavailable and the
    // ledger must show no decision.resolve command was sent.
    const d = raiseSlotPoll(trip.id)
    const outcome = await resolveDecision(d.id, d.options[0].id)
    expect(outcome.status).toBe('unavailable')
    expect(calls.some(c => c.table === 'submit_collab_command' && c.method === 'rpc' &&
      (c.payload as { p_command?: { type?: string } } | undefined)?.p_command?.type === 'decision.resolve')).toBe(false)
  })
})

describe('#335 — one quorum, on both surfaces', () => {
  it('the rail divides by members and the store no longer rewrites ids', () => {
    const daySlotsSource = readFileSync(new URL('../src/lib/daySlots.ts', import.meta.url), 'utf8')
    expect(daySlotsSource).toMatch(/voters: deps\.memberCount \?\? 0/)
    expect(daySlotsSource).not.toMatch(/deps\.travellers/)

    const groupSource = readFileSync(new URL('../src/pages/trip/GroupInputTab.tsx', import.meta.url), 'utf8')
    // Group Input already read the denominator off members; it stays there.
    expect(groupSource).toMatch(/const memberCount = \(trip\.members \?\? \[\]\)\.length/)
    expect(groupSource).toMatch(/ups \/ memberCount\)/)

    const storeSource = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8')
    expect(storeSource).not.toMatch(/id: uid\('o'\)\s*\}\)\)/)   // the old rewrite
    expect(storeSource).toMatch(/o\.id && !seen\.has\(o\.id\) \? o\.id : uid\('o'\)/)
  })
})
