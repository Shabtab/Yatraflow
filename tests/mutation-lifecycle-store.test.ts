// #424 — the destructive-stop path against REAL store state.
//
// tests/mutation-lifecycle.test.ts proves the wiring is shared (source
// invariants) and that the composer is well-formed (pure rules). This proves what
// that shared wiring does to the data, using the real store, the real preview
// chain and the real restore:
//
//   · a delete from any surface only STAGES — the committed row is untouched
//     until Keep (this is exactly what the map pin's old direct write violated);
//   · a second delete CHAINS onto the first rather than replacing it (#334);
//   · the Undo that Keep leaves restores identity, day and order.
//
// Non-vacuous by construction: against the map's old path (a direct deleteStop)
// the first assertion fails, and against a hand-rolled "push it back on the day"
// Undo the last one does.
import { describe, it, expect, vi } from 'vitest'
import { seedData } from '../src/data/seed'

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; payload?: unknown }>,
}))

/** The Undo the Keep leaves is a TOAST BUTTON, not a function call: `undoToast`
 *  registers it and the user's click runs the restore. Capturing the pair here is
 *  what lets the last test click it — otherwise it would assert that a toast was
 *  raised and call that a recovery, which is the vacuity this suite exists to
 *  avoid. */
const { toasts } = vi.hoisted(() => ({ toasts: [] as Array<{ msg: string; run: () => void }> }))
vi.mock('../src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/ui')>()
  return { ...actual, undoToast: (msg: string, run: () => void) => { toasts.push({ msg, run }) } }
})

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
    supabase: { from: (t: string) => makeBuilder(t) },
  }
})

import { duplicateTrip, tripById, updateTrip, _setTripWriteDebounceMs } from '../src/store/store'
import { stagedChange } from '../src/lib/previewChain'
import { computeImpact } from '../src/lib/impact'
import { removeStopWithUndo, type ApplyChange } from '../src/lib/mutationLifecycle'
import type { Trip } from '../src/data/types'

_setTripWriteDebounceMs(0)

const seedTrip = seedData.trips[0]
const OWNER = 'lane-s-owner'
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function seeded(): Trip {
  calls.length = 0
  toasts.length = 0
  return duplicateTrip(seedTrip, OWNER)
}

/** A day with enough stops to see a renumber, and the ids it starts with. */
function aBusyDay(trip: Trip): { dayIndex: number; before: string[]; orders: number[] } {
  const day = trip.days.find(d => d.stops.length >= 2) ?? trip.days[0]
  return {
    dayIndex: day.index,
    before: day.stops.map(s => s.id),
    orders: day.stops.map(s => s.orderInDay),
  }
}

/** The workspace's applyChange, reduced to what the lifecycle touches: chain onto
 *  the staged proposal, measure against the committed row, hold the newest
 *  onKept (that is the callback the sheet's Keep fires). */
function harness(tripId: string) {
  let staged: Trip | null = null
  let kept: (() => void) | undefined
  const kinds: string[] = []
  const applyChange: ApplyChange = (mutator, kind, dayIndex, onKept) => {
    const committed = tripById(tripId)!
    staged = stagedChange(committed, staged, mutator)
    kinds.push(computeImpact(committed, staged, kind, dayIndex).kind)
    kept = onKept
  }
  return {
    applyChange,
    kinds,
    proposed: () => staged!,
    keep: () => kept?.(),
  }
}

describe('a destructive stop delete against real state', () => {
  it('stages the removal — the committed row is untouched until Keep', () => {
    const trip = seeded()
    const { dayIndex, before } = aBusyDay(trip)
    const victim = before[1]
    const h = harness(trip.id)

    const outcome = removeStopWithUndo({ trip: tripById(trip.id)!, stopId: victim, dayIndex, applyChange: h.applyChange })

    expect(outcome).toBe('staged-undo')
    expect(h.kinds).toEqual(['remove'])
    // THE claim: nothing is written while the proposal is being studied. The old
    // map pin wrote here, which is why the same click behaved differently.
    expect(tripById(trip.id)!.days[dayIndex].stops.map(s => s.id)).toEqual(before)
    // …and the proposal is what Keep would write: the stop gone, 1..n again.
    const proposed = h.proposed().days[dayIndex]
    expect(proposed.stops.map(s => s.id)).toEqual(before.filter(id => id !== victim))
    expect(proposed.stops.map(s => s.orderInDay)).toEqual(before.filter(id => id !== victim).map((_, i) => i + 1))
  })

  it('chains a second delete onto the first instead of silently replacing it', () => {
    const trip = seeded()
    const { dayIndex, before } = aBusyDay(trip)
    const h = harness(trip.id)

    removeStopWithUndo({ trip: tripById(trip.id)!, stopId: before[0], dayIndex, applyChange: h.applyChange })
    removeStopWithUndo({ trip: tripById(trip.id)!, stopId: before[1], dayIndex, applyChange: h.applyChange })

    // Both removals survive in ONE proposal (#334), and the row still holds all.
    expect(h.proposed().days[dayIndex].stops.map(s => s.id)).toEqual(before.slice(2))
    expect(tripById(trip.id)!.days[dayIndex].stops.map(s => s.id)).toEqual(before)
  })

  it('restores identity, day and order from the Undo the Keep leaves', async () => {
    const trip = seeded()
    const { dayIndex, before, orders } = aBusyDay(trip)
    const victim = before[1]
    const h = harness(trip.id)

    const title = tripById(trip.id)!.days[dayIndex].stops.find(s => s.id === victim)!.title
    removeStopWithUndo({ trip: tripById(trip.id)!, stopId: victim, dayIndex, applyChange: h.applyChange })

    // Keep, the way the workspace does it: the proposal becomes the row.
    updateTrip(trip.id, h.proposed())
    expect(tripById(trip.id)!.days[dayIndex].stops.map(s => s.id)).toEqual(before.filter(id => id !== victim))

    // The Keep leaves the toast, and the toast names the day the stop returns
    // to — an Undo that forgot the day would restore something else.
    h.keep()
    const undo = toasts[toasts.length - 1]
    expect(undo.msg).toBe(`“${title}” removed from Day ${dayIndex + 1}`)

    // …and clicking it puts the stop back at its OLD order — not appended to the
    // end, which is the difference between "restored" and "back somewhere". The
    // survivors were renumbered 1..n by the removal, so the stop that inherited
    // the deleted order must not keep the slot.
    undo.run()
    await flush()
    expect(tripById(trip.id)!.days[dayIndex].stops.map(s => s.id)).toEqual(before)
    expect(tripById(trip.id)!.days[dayIndex].stops.map(s => s.orderInDay)).toEqual(orders)
  })

  it('lifts the stop from the day it was deleted from, not day 1 by default', () => {
    const trip = seeded()
    const day = trip.days[1] ?? trip.days[0]
    const h = harness(trip.id)
    const elsewhere = h.proposed()

    removeStopWithUndo({
      trip: tripById(trip.id)!,
      stopId: day.stops[0].id,
      dayIndex: day.index, // the map passes meta.dayIndex; the day row passes its own
      applyChange: h.applyChange,
    })

    const proposed = h.proposed()
    expect(proposed.days[day.index].stops.map(s => s.id)).not.toContain(day.stops[0].id)
    for (const d of proposed.days) {
      if (d.index !== day.index) expect(d.stops.map(s => s.id)).toEqual(trip.days.find(x => x.index === d.index)!.stops.map(s => s.id))
    }
    expect(elsewhere).toBeDefined()
  })
})
