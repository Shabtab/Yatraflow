// #334: the impact-preview sheet is NOT modal, so a second mutation while a
// preview is open used to clone the COMMITTED trip and replace the pending
// proposal — the first staged change vanished with no toast, no merge and no
// warning. The policy is to CHAIN (the issue's Option A): the second mutation
// builds on the staged proposal and the sheet reports the combined delta, while
// the impact stays measured against the committed trip. The one thing that is
// NOT staged is a direct-cache crew signal — an accepted suggestion, a resolved
// decision, a status flip — which refuses instead, so no resolution ever lives
// inside somebody's unkept preview. These fixtures pin the pure composition and
// tripwire every surface that must not race it.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  acknowledgedReceiptOf, cacheHoldsProposal, composeOperations, discardOperations, isAcknowledgement, keepIsStale, keepOutcomeOf, markAttempted, markUnadmitted, notifyUncertain, previewBase,
  runOperations, runStoreDiscarded, stagedChange, withUncertainty, withoutOperations,
} from '../src/lib/previewChain'
import type { ItineraryStop, Trip } from '../src/data/types'

function trip(): Trip {
  return {
    id: 'trip-1', name: 'Kerala, 4 days', startLocation: 'Kochi', destinations: ['Munnar'],
    startDate: '2026-10-01', endDate: '2026-10-04', travellers: 2, transportMode: 'car',
    budgetPerPersonInr: 12000, travelStyle: 'balanced', fixedCommitments: [],
    days: [{
      id: 'day-1', index: 0, title: 'Day 1',
      stops: [{
        id: 'st-1', title: 'Fort Kochi', category: 'sightseeing', locationName: 'Fort Kochi',
        lat: 9.93, lng: 76.26, visitMinutes: 90, entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
        priority: 'must-do', status: 'confirmed', orderInDay: 1,
      }],
    }],
    expenses: [], coverEmoji: '🌴', visibility: 'private', createdAt: 1, updatedAt: 2,
    members: [{ userId: 'amelia', role: 'owner', joinedAt: 0 }],
  }
}

const stop = (id: string, title: string): ItineraryStop => ({
  id, title, category: 'food', locationName: title, lat: 9.5, lng: 76.3,
  visitMinutes: 45, entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
  priority: 'nice-to-have', status: 'suggested', orderInDay: 2,
})

describe('previewChain — a second edit builds on the first (#334)', () => {
  it('without a preview, a mutation clones the committed trip', () => {
    const committed = trip()
    const proposed = stagedChange(committed, null, d => { d.name = 'Renamed trip' })
    expect(proposed.name).toBe('Renamed trip')
    expect(committed.name).toBe('Kerala, 4 days')
    expect(previewBase(committed, null)).toBe(committed)
  })

  it('the first staged change SURVIVES the second mutation', () => {
    const committed = trip()
    const first = stagedChange(committed, null, d => { d.days[0].title = 'Coastal day' })
    const second = stagedChange(committed, first, d => { d.days[0].stops.push(stop('st-2', 'Lunch')) })
    // Both edits are in the chained shape — the old code kept only the second.
    expect(second.days[0].title).toBe('Coastal day')
    expect(second.days[0].stops.map(s => s.title)).toEqual(['Fort Kochi', 'Lunch'])
    // …and neither the staged shape nor the committed row was mutated.
    expect(first.days[0].stops).toHaveLength(1)
    expect(committed.days[0].title).toBe('Day 1')
    expect(committed.days[0].stops).toHaveLength(1)
    expect(previewBase(committed, first)).toBe(first)
  })

  it('Keep refuses a preview whose committed row moved underneath it', () => {
    const committed = trip()
    // No preview yet: nothing to go stale.
    expect(keepIsStale(null, committed)).toBe(false)
    // The preview was built on THIS row object…
    expect(keepIsStale(committed, committed)).toBe(false)
    // …a direct write (resolved decision, accepted suggestion, realtime edit)
    // replaces the cached row with a new object, which is the stale signal.
    expect(keepIsStale(committed, structuredClone(committed))).toBe(true)
  })
})

describe('the surfaces that must not race a preview (#334)', () => {
  it('the workspace chains, refuses a stale Keep, re-stages Move, and clears on trip switch', () => {
    const src = readFileSync(new URL('../src/pages/TripWorkspace.tsx', import.meta.url), 'utf8')
    expect(src).toMatch(/stagedChange\(trip, staged\?\.proposed \?\? null, mutator\)/)  // chain, don't fork
    expect(src).toMatch(/keepIsStale\(baseRef\.current, trip\)/)                        // stale Keep refuses
    expect(src).toMatch(/applyChange\(draft => \{/)                                     // Move goes through the chain
    expect(src).toMatch(/'move-day', dayIndex\)/)
    expect(src).toMatch(/previewOpen=\{!!pending\}/)                                    // timeline is told
    expect(src).toMatch(/Staged change discarded. You switched trips/)
  })

  it('the map popup delete and every expense write refuse while a preview is open', () => {
    const ws = readFileSync(new URL('../src/pages/TripWorkspace.tsx', import.meta.url), 'utf8')
    // all five surfaces are told: timeline, board, group input, map, budget
    expect(ws.match(/previewOpen=\{!!pending\}/g) ?? []).toHaveLength(5)

    const map = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')
    // #424: the popup delete USED to be the map's one live direct writer, and so
    // had to refuse while a preview was open — which made the same delete behave
    // differently from the Timeline's and the Board's. It now stages through the
    // shared lifecycle like they do, so it neither writes the row nor refuses:
    // it CHAINS. (The fill/undo deleteStops still run inside onKept, after Keep
    // has closed the preview, and are declared as stop.remove-from-fill.)
    expect(map).toMatch(/function removeStopFromMap\(stopId: string[\s\S]*?removeStopWithUndo\(\{ trip, stopId, dayIndex: meta\.dayIndex, applyChange \}\)/)
    expect(map).not.toMatch(/import \{ PREVIEW_BUSY \}/)

    const budget = readFileSync(new URL('../src/pages/trip/BudgetTab.tsx', import.meta.url), 'utf8')
    // delete, mark settled, reopen, quick-add, inline edit — five direct writers
    expect(budget.match(/if \(refuseWhileStaged\(previewOpen\)\) return/g) ?? []).toHaveLength(5)
    // …and both inline writers are told, so the typed line survives the refusal
    expect(budget.match(/previewOpen=\{previewOpen\}/g) ?? []).toHaveLength(2)
  })

  it('day rename, ride start and status flips are refused while a preview is open', () => {
    const src = readFileSync(new URL('../src/pages/trip/TimelineTab.tsx', import.meta.url), 'utf8')
    const guards = src.match(/if \(refuseWhileStaged\(previewOpen\)\) return/g) ?? []
    // rename, ride start, status flip AND the day cover — all four write the
    // committed row directly, so all four refuse while a preview is open.
    expect(guards).toHaveLength(4)
    // One spelling of the refusal AND one home for it: since #424 the surfaces
    // import the rule from lib/mutationLifecycle instead of pasting the message,
    // so a drift has nowhere to hide.
    expect(src).toMatch(/import \{ refuseWhileStaged, removeStopWithUndo, type ApplyChange \} from '\.\.\/\.\.\/lib\/mutationLifecycle'/)
    expect(src).not.toMatch(/PREVIEW_BUSY/)
  })

  it('the Board’s status flip refuses while a preview is open — its edits chain instead', () => {
    // The Board stages every edit through applyChange, which CHAINS onto the
    // open preview (#334) rather than being disabled. Its one live direct
    // writer is the status flip, and that one refuses like the Timeline's.
    const board = readFileSync(new URL('../src/components/BoardView.tsx', import.meta.url), 'utf8')
    expect(board).toMatch(/import \{ refuseWhileStaged, removeStopWithUndo \} from '\.\.\/lib\/mutationLifecycle'/)
    expect(board).toMatch(/if \(refuseWhileStaged\(previewOpen\)\) return[\s\S]{0,200}?setStopStatus\(trip\.id, status, stop\.id\)/)
  })

  it('accepting a suggestion and resolving a decision wait for the preview', () => {
    const src = readFileSync(new URL('../src/pages/trip/GroupInputTab.tsx', import.meta.url), 'utf8')
    // ONE refusal helper, spoken by EVERY crew-signal writer — resolve, accept
    // and decline all write the committed row, so all three refuse while a
    // preview holds a staged proposal (the definition takes a typed parameter,
    // so it is not among them). #839 added a fourth: the retarget /
    // add-another-visit follow-up writes the same row from its own buttons, so
    // it refuses too rather than being the one path around the guard.
    // The closed-vote card has a separate Resolve control. It must refuse too.
    expect(src.match(/refuseWhileStaged\(previewOpen\)/g) ?? []).toHaveLength(5)
    // #424: this surface's own helper went into the shared lifecycle — its rule,
    // its wording and its six call sites are one contract now, not a copy.
    expect(src).toMatch(/import \{ refuseWhileStaged \} from '\.\.\/\.\.\/lib\/mutationLifecycle'/)
    expect(src).not.toMatch(/refuseWhilePreviewing|PREVIEW_BUSY/)
    // …and the workspace actually tells the tab that a preview is open.
    const ws = readFileSync(new URL('../src/pages/TripWorkspace.tsx', import.meta.url), 'utf8')
    expect(ws).toMatch(/<GroupInputTab trip=\{effective\} editable=\{editable\} canComment=\{commentable\} me=\{me\} previewOpen=\{!!pending\} slotResolution=\{groupInputResolution\} \/>/)
  })
})

describe('#563 — a stale day index refuses, it never crashes', () => {
  it('the belt: a mutator that throws proposes the unchanged base, loudly', () => {
    const base = trip()
    const proposed = stagedChange(base, null, draft => {
      const day = draft.days.find(d => d.index === 99)!
      day.stops = []
    })
    // Zero-delta: the half-applied draft is discarded, not staged.
    expect(proposed).toEqual(base)
    expect(proposed.days[0]!.stops).toHaveLength(1)
  })

  it('the guarded mutator shape: a missing day is a no-op over a 1-day trip', () => {
    const base = trip()
    const proposed = stagedChange(base, null, draft => {
      const day = draft.days.find(d => d.index === 99)
      if (!day) return
      day.stops = []
    })
    expect(proposed).toEqual(base)
    // And chaining still works after a refusal — the next change clones the
    // refused (unchanged) proposal, never a half-state.
    const second = stagedChange(base, proposed, d => { d.days[0]!.stops.push(stop('st-2', 'Lunch')) })
    expect(second.days[0]!.stops).toHaveLength(2)
  })
})

describe('operation metadata and the receipt (#841)', () => {
  const receipt = { kind: 'acknowledged', revision: 'rev-7', writeVersion: 4 } as const

  it('rebuilds the receipt field by field and hands each callback a frozen copy', () => {
    const outcome = keepOutcomeOf({ ...receipt, extra: 'dropped' })
    expect(outcome).toEqual(receipt)
    expect(acknowledgedReceiptOf({ ...receipt, extra: 'dropped' })).toEqual(receipt)
    expect(acknowledgedReceiptOf({ kind: 'conflict', revision: 'x' })).toBeNull()
    const seen: unknown[] = []
    const ops = composeOperations([], got => { seen.push(got) })
    runOperations(ops, receipt)
    expect(seen).toEqual([receipt])
    expect(Object.isFrozen(seen[0])).toBe(true)
  })

  it('an existing zero-argument callback still runs and a missing receipt reaches the callback as undefined', () => {
    const zero = vi.fn(() => {})
    runOperations(composeOperations([], zero))
    expect(zero).toHaveBeenCalledTimes(1)
    expect(zero).toHaveBeenCalledWith(undefined)
  })

  it('creates a record for an onDiscard-only operation', () => {
    const onDiscard = vi.fn()
    const ops = composeOperations([], undefined, { id: 'op-a', onDiscard })
    expect(ops).toHaveLength(1)
    expect(ops[0]!.operationId).toBe('op-a')
    expect(runOperations(ops, receipt)).toBe(0)
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('dedupes a stable operation id and keeps the first record, but never dedupes plain callbacks', () => {
    const first = vi.fn()
    const second = vi.fn()
    const one = composeOperations([], first, { id: 'op-1' })
    const two = composeOperations(one, second, { id: 'op-1' })
    expect(two).toBe(one)
    runOperations(two, receipt)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    const plainA = vi.fn()
    const plainB = vi.fn()
    const plain = composeOperations(composeOperations([], plainA), plainB)
    expect(plain).toHaveLength(2)
    expect(plain[0]!.id).not.toBe(plain[1]!.id)
    runOperations(plain)
    expect([plainA, plainB].map(fn => fn.mock.calls.length)).toEqual([1, 1])
  })

  it('a default record never collides with an explicit id that looks like a default', () => {
    const plain = composeOperations([], vi.fn())
    const explicit = composeOperations(plain, vi.fn(), { id: String(plain[0]!.id) })
    expect(explicit).toHaveLength(2)
    const emptyId = composeOperations(explicit, vi.fn(), { id: '' })
    const emptyAgain = composeOperations(emptyId, vi.fn(), { id: '' })
    expect(emptyAgain).toHaveLength(4)
  })

  it('a record settles once: kept records do not discard and discarded records do not keep', () => {
    const kept = vi.fn()
    const dropped = vi.fn()
    const keptOps = composeOperations([], kept, { id: 'a', onDiscard: dropped })
    runOperations(keptOps, receipt)
    expect(discardOperations(keptOps)).toBe(0)
    expect(dropped).not.toHaveBeenCalled()
    const lateKept = vi.fn()
    const discardOps = composeOperations([], lateKept, { id: 'b', onDiscard: dropped })
    expect(discardOperations(discardOps)).toBe(1)
    expect(discardOperations(discardOps)).toBe(0)
    runOperations(discardOps, receipt)
    expect(lateKept).not.toHaveBeenCalled()
    expect(dropped).toHaveBeenCalledTimes(1)
  })

  it('a record a Keep attempted is skipped by discard, and one chained later is released', () => {
    const early = vi.fn()
    const late = vi.fn()
    const first = composeOperations([], undefined, { id: 'early', onDiscard: early })
    markAttempted(first)
    const ops = composeOperations(first, undefined, { id: 'late', onDiscard: late })
    expect(ops.map(record => record.attempted)).toEqual([true, false])
    expect(discardOperations(ops)).toBe(1)
    expect(early).not.toHaveBeenCalled()
    expect(late).toHaveBeenCalledTimes(1)
    // The tried record keeps its state, so nothing else claims or releases it.
    expect(ops[0]!.state).toBe('staged')
    expect(ops[1]!.state).toBe('discarded')
  })

  it('a record proven unadmitted may be discarded again, and a settled record never reverts', () => {
    const drop = vi.fn()
    const ops = composeOperations([], undefined, { id: 'a', onDiscard: drop })
    markAttempted(ops)
    markUnadmitted(ops)
    expect(ops[0]!.attempted).toBe(false)
    expect(discardOperations(ops)).toBe(1)
    markAttempted(ops)
    expect(ops[0]!.attempted).toBe(false)
    expect(discardOperations(ops)).toBe(0)
    expect(drop).toHaveBeenCalledTimes(1)
  })

  it('an exception in a discard callback does not block its peers', () => {
    const calls: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let ops = composeOperations([], undefined, { id: 'x', onDiscard: () => { calls.push('x') } })
    ops = composeOperations(ops, undefined, { id: 'y', onDiscard: () => { calls.push('y'); throw new Error('boom') } })
    ops = composeOperations(ops, undefined, { id: 'z', onDiscard: () => { calls.push('z') } })
    expect(discardOperations(ops)).toBe(2)
    err.mockRestore()
    expect(calls).toEqual(['x', 'y', 'z'])
  })

  it('treats a stale or refused result as unwritten and the rest as uncertain only with cache evidence', () => {
    const base = trip()
    const patch = { ...structuredClone(base), name: 'Proposed' }
    const written = { ...structuredClone(base), name: 'Proposed', updatedAt: 99 }
    expect(cacheHoldsProposal(written, base, patch)).toBe(true)
    expect(cacheHoldsProposal(structuredClone(base), base, patch)).toBe(false)
    expect(cacheHoldsProposal(undefined, base, patch)).toBe(false)
    expect(cacheHoldsProposal({ ...structuredClone(base), name: 'Crew' }, base, patch)).toBe(false)
    expect(withUncertainty({ kind: 'unavailable' }, true)).toEqual({ kind: 'unavailable', uncertain: true })
    expect(withUncertainty({ kind: 'conflict' }, false)).toEqual({ kind: 'conflict' })
    expect(withUncertainty({ kind: 'stale' }, true)).toEqual({ kind: 'stale' })
    expect(withUncertainty({ kind: 'refused' }, true)).toEqual({ kind: 'refused' })
    expect(withUncertainty(receipt, true)).toEqual(receipt)
  })
})

describe('operation-owned completion records (#841)', () => {
  it('composes callbacks instead of replacing the earlier one, and runs each at most once', () => {
    const calls: string[] = []
    const first = composeOperations([], () => { calls.push('a') })
    const second = composeOperations(first, () => { throw new Error('boom') })
    const third = composeOperations(second, () => { calls.push('c') })
    expect(composeOperations(third, undefined)).toBe(third)
    expect(third).toHaveLength(3)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    // The throwing callback does not count as completed, and does not stop its peers.
    expect(runOperations(third)).toBe(2)
    expect(runOperations(third)).toBe(0)
    err.mockRestore()
    expect(calls).toEqual(['a', 'c'])
    expect(withoutOperations(third, [third[0]!]).map(o => o.id)).toEqual([third[1]!.id, third[2]!.id])
  })

  it('treats only a complete receipt as an acknowledgement', () => {
    expect(isAcknowledgement({ kind: 'acknowledged', revision: 'r1', writeVersion: 3 })).toBe(true)
    expect(isAcknowledgement({ kind: 'acknowledged', revision: '', writeVersion: 3 })).toBe(false)
    expect(isAcknowledgement({ kind: 'acknowledged', revision: 'r1' })).toBe(false)
    expect(isAcknowledgement(null)).toBe(false)
    expect(isAcknowledgement({ kind: 'acknowledged', revision: 'r1', writeVersion: -1 })).toBe(false)
    expect(isAcknowledgement({ kind: 'acknowledged', revision: 'r1', writeVersion: 1.5 })).toBe(false)
    expect(isAcknowledgement({ kind: 'acknowledged', revision: 'r1', writeVersion: Number.NaN })).toBe(false)
    expect(isAcknowledgement({ kind: 'acknowledged', revision: 'r1', writeVersion: '3' })).toBe(false)
    expect(isAcknowledgement({ kind: 'acknowledged', revision: 'r1', writeVersion: 0 })).toBe(true)
    expect(keepOutcomeOf({ kind: 'conflict', revision: null })).toEqual({ kind: 'conflict' })
    expect(keepOutcomeOf({ kind: 'something-new' })).toEqual({ kind: 'unavailable' })
  })

  it('notifies only the records a Keep captured, once, and never settles them', () => {
    const uncaptured = vi.fn()
    const chained = vi.fn()
    const kept = vi.fn()
    const captured = composeOperations([], kept, { id: 'op-a', onUncertain: uncaptured })
    markAttempted(captured)
    const later = composeOperations(captured, undefined, { id: 'op-b', onUncertain: chained })
    expect(later[0]!.uncertainNotified).toBe(false)
    expect(notifyUncertain(captured)).toBe(1)
    expect(notifyUncertain(captured)).toBe(0)
    expect(uncaptured).toHaveBeenCalledTimes(1)
    expect(chained).not.toHaveBeenCalled()
    expect(later[0]!.uncertainNotified).toBe(true)
    expect(later[1]!.uncertainNotified).toBe(false)
    // The notification is not a settlement: the record stays staged, and a
    // later acknowledgement still runs the kept callback exactly once.
    expect(later[0]!.state).toBe('staged')
    expect(runOperations(captured, { kind: 'acknowledged', revision: 'rev-1', writeVersion: 1 })).toBe(1)
    expect(kept).toHaveBeenCalledTimes(1)
    expect(later[0]!.state).toBe('kept')
    expect(notifyUncertain(captured)).toBe(0)
  })

  it('never notifies a pre-admission, kept or proven-discarded record', () => {
    const neverAdmitted = vi.fn()
    const pre = composeOperations([], undefined, { id: 'pre', onUncertain: neverAdmitted })
    // A store refusal before any admission leaves the record unmarked.
    markAttempted(pre)
    markUnadmitted(pre)
    expect(notifyUncertain(pre)).toBe(0)
    expect(neverAdmitted).not.toHaveBeenCalled()

    const keptRecord = vi.fn()
    const acknowledged = composeOperations([], undefined, { id: 'kept', onUncertain: keptRecord })
    markAttempted(acknowledged)
    runOperations(acknowledged, { kind: 'acknowledged', revision: 'rev-2', writeVersion: 2 })
    expect(notifyUncertain(acknowledged)).toBe(0)
    expect(keptRecord).not.toHaveBeenCalled()

    const discardedRecord = vi.fn()
    const abandoned = composeOperations([], undefined, { id: 'gone', onUncertain: discardedRecord })
    markAttempted(abandoned)
    runStoreDiscarded(abandoned)
    expect(notifyUncertain(abandoned)).toBe(0)
    expect(discardedRecord).not.toHaveBeenCalled()
  })

  it('a throwing uncertainty callback does not block its peers', () => {
    const calls: string[] = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let ops = composeOperations([], undefined, { id: 'x', onUncertain: () => { calls.push('x') } })
    ops = composeOperations(ops, undefined, { id: 'y', onUncertain: () => { calls.push('y'); throw new Error('boom') } })
    ops = composeOperations(ops, undefined, { id: 'z', onUncertain: () => { calls.push('z') } })
    markAttempted(ops)
    expect(notifyUncertain(ops)).toBe(2)
    err.mockRestore()
    expect(calls).toEqual(['x', 'y', 'z'])
    expect(notifyUncertain(ops)).toBe(0)
  })

  it('the workspace tells the captured records through the separate uncertainty call', () => {
    const src = readFileSync(new URL('../src/pages/TripWorkspace.tsx', import.meta.url), 'utf8')
    // #841: onKept stays reserved for a validated acknowledgement. The admitted
    // but unconfirmed generation reaches the writer through notifyUncertain, so
    // a real failed save can never leave the writer record merely staged.
    expect(src).toMatch(/if \(admittedHeld\) notifyUncertain\(operations\)/)
    const mapWriter = readFileSync(new URL('../src/pages/trip/map/mapWriterActions.ts', import.meta.url), 'utf8')
    expect(mapWriter).toMatch(/onUncertain: \(\) => \{/)
    expect(mapWriter).toMatch(/if \(!isWriterReceipt\(receipt\)\) return/)
  })

  it('the workspace keeps through the real admission and never reports a bare updateTrip as success', () => {
    const src = readFileSync(new URL('../src/pages/TripWorkspace.tsx', import.meta.url), 'utf8')
    // #841: the admission trace names the exact write generation, so the workspace
    // no longer guesses admission from the cache or emptiness from the queue.
    expect(src).toMatch(/trackTripPreview\(\{ tripId: base\.id, expectedBase: base, patch \}\)/)
    expect(src).toMatch(/observeTripPreview\(operation, onObservation\)/)
    expect(src).toMatch(/tripPreviewPending\(watch\.operation\)/)
    expect(src).not.toMatch(/cacheHoldsProposal\(/)
    expect(src).not.toMatch(/pendingWrites\(/)
    expect(src).not.toMatch(/\bupdateTrip\(/)
  })
})
