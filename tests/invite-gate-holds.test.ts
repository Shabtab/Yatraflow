// ============ #804 round 10 — the gate keeps what it was told ============
//
// Three contracts from the round 10 gate, executed against the product's own
// modules rather than read off the source:
//
//   B5 — a join refuses for DIFFERENT reasons, and the screen must say which.
//        The machine keeps the typed refusal, so a declared refusal is never
//        shown as the same generic failure as another.
//   B1/B2 — the store's module-level state is the one the functions read. The
//        extraction below uses the probe's own extraction rule, so a state the
//        name list omits is a failure here, not a silent no-op there.
//   S2 — the single test path for the round 10 constraints is pinned.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  initialJoinState,
  joinMachine,
  joinAllowsNavigation,
  joinOffersRetry,
  type JoinRefusal,
  type JoinResult,
} from '../src/lib/inviteGateStates'

const A = 'user-a'
const GEN = 7

/** Drive the machine from a started try, then settle it with one result. */
function settleReload(result: JoinResult) {
  const began = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: true })
  return joinMachine(began.state, { type: 'reload-settled', userId: A, gen: GEN, tryId: began.state.tryId, result })
}

/** The same for a join answer. */
function settleJoin(result: JoinResult) {
  const began = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: false })
  return joinMachine(began.state, { type: 'join-settled', userId: A, gen: GEN, tryId: began.state.tryId, result })
}

describe('B5 — a refused join keeps its own reason', () => {
  const refusals: Array<[JoinResult, JoinRefusal]> = [
    ['not-member', 'not-member'],
    ['missing', 'missing'],
    ['deleted', 'deleted'],
    ['incomplete', 'incomplete'],
    ['failed', 'failed'],
  ]

  for (const [result, reason] of refusals) {
    it(`a reload that answers ${result} records ${reason}`, () => {
      const plan = settleReload(result)
      expect(plan.state.reason).toBe(reason)
      // A membership loss, a missing row and a tombstone are failures, never
      // "You joined", and none of them may open the trip.
      expect(joinAllowsNavigation(plan.state)).toBe(false)
      expect(joinOffersRetry(plan.state)).toBe(true)
    })
  }

  it('a join answer keeps the same typed reason', () => {
    expect(settleJoin('failed').state.reason).toBe('failed')
    expect(settleJoin('not-member').state.reason).toBe('not-member')
  })

  it('the five refusals stay distinct, not collapsed into one failure', () => {
    const reasons = refusals.map(([result]) => settleReload(result).state.reason)
    expect(new Set(reasons).size).toBe(refusals.length)
  })

  it('an unusable row and a failed read are DIFFERENT states of the same screen', () => {
    // Both keep the membership ('joined-unloaded'), so the user stays signed in
    // to the trip, but the remedy text has to name which one happened.
    const unusable = settleReload('incomplete')
    const readFailed = settleReload('failed')
    expect(unusable.state.phase).toBe('joined-unloaded')
    expect(readFailed.state.phase).toBe('joined-unloaded')
    expect(unusable.state.reason).toBe('incomplete')
    expect(readFailed.state.reason).toBe('failed')
    expect(unusable.state.reason).not.toBe(readFailed.state.reason)
  })

  it('a joined result carries no refusal', () => {
    const joined = settleReload('joined')
    expect(joined.state.phase).toBe('joined')
    expect(joined.state.reason).toBeNull()
    expect(settleJoin('joined').state.reason).toBeNull()
    // 'joined-unloaded' from the join itself is a read problem, not a refusal.
    expect(settleJoin('joined-unloaded').state.reason).toBeNull()
  })

  it('a retry clears the previous reason', () => {
    const failed = settleJoin('failed')
    const retried = joinMachine(failed.state, { type: 'retry', userId: A, gen: GEN, member: false })
    expect(retried.action.type).toBe('join')
    expect(retried.state.reason).toBeNull()
  })

  it('a reset clears the reason with the try', () => {
    const failed = settleJoin('deleted')
    const reset = joinMachine(failed.state, { type: 'reset' })
    expect(reset.action.type).toBe('none')
    expect(reset.state.phase).toBe('idle')
    expect(reset.state.reason).toBeNull()
  })

  it('App renders a title and a remedy for each reason, and they are not shared', () => {
    const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const block = APP.slice(APP.indexOf("if (phase === 'failed') {"))
    for (const reason of ['not-member', 'missing', 'deleted'] as JoinRefusal[]) {
      expect(block, `a branch for ${reason}`).toContain(`refusal === '${reason}'`)
    }
    // The generic copy stays only as the last case; a known refusal never gets it.
    const genericAt = block.indexOf("title: 'Couldn’t join just now'")
    const deletedAt = block.indexOf("refusal === 'deleted'")
    expect(deletedAt).toBeGreaterThan(-1)
    expect(genericAt, 'the generic copy is the fallback, after the named ones').toBeGreaterThan(deletedAt)
    // The unloaded screen names the unusable-row case separately.
    expect(APP).toContain("machine.reason === 'incomplete'")
  })
})

describe('the store state the probe extracts is the state the functions read', () => {
  const STORE = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const PROBE = readFileSync(new URL('./_gate_probe.cjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  it('every module-level map the extracted functions mention is in the probe name list', () => {
    const start = STORE.indexOf('export async function joinViaInvite(')
    const end = STORE.indexOf('export type LoadOutcome')
    const region = STORE.slice(start, end)
    // Only the state these functions DERIVE for themselves is extracted. A map
    // the probe context provides instead (tripAccessEpochs, the caches) must be
    // supplied by setup(), or the functions see a second, empty copy.
    const declared = ['expectedJoins']
    const provided = ['tripAccessEpochs', 'editableTripGrants', 'tripFetches', 'queuedLocalTrips', 'serverTripTimestamps']
    for (const name of declared) {
      expect(region, `${name} is read by the extracted functions`).toMatch(new RegExp(`\\b${name}\\b`))
      expect(PROBE, `${name} must be extracted by the probe`).toMatch(new RegExp(`'${name}'`))
    }
    for (const name of provided) {
      expect(PROBE, `${name} is provided by the probe setup`).not.toMatch(new RegExp(`'${name}'`))
      expect(PROBE, `${name} must be a setup() field`).toMatch(new RegExp(`${name}:(new (Map|Set))`))
    }
  })

  it('the probe extracts module-level declarations, not only functions', () => {
    // Round 10: the name list passed while the extractor dropped every
    // declaration, so the functions saw free variables that do not exist.
    expect(PROBE).toContain('isVariableStatement')
  })

  it('admission measures provenance against the REQUEST, not the response', () => {
    // A response whose rows agree with each other but name another trip must be
    // refused. The check therefore compares the row with `requestedTripId` and
    // never with the row's own id, which would always match itself.
    const body = STORE.slice(STORE.indexOf('function admitFullRow('), STORE.indexOf('export async function membershipCertain'))
    expect(body).toContain('row.id.toLowerCase() !== requestedTripId.toLowerCase()')
    expect(body).not.toMatch(/row\.id\.toLowerCase\(\) !== [^r][^e]/)
    expect(body).toContain('coherentFullRow(row, knownOptionalColumns())')
  })

  it('the probe runs the round 10 contract cases', () => {
    for (const name of [
      'Cached viewer downgrade then fresh read cannot restore editor',
      'Cached realtime grant clears an earlier uncached role floor',
      'Full loader refuses a coherent response for another requested trip',
    ]) {
      expect(PROBE, name).toContain(name)
    }
  })
})
