// ============ UNIT 1 — attempt lifetime and profile gaps (real reducer) ============
//
// These run the product's own `joinMachine`, so every phase and try id below is
// the app's decision, not a copy of it.
//
// Contract C2/R4: an attempt identity must be monotonic across a remount, a
// profile gap, and a same-account reauth, and a new attempt must never reuse a
// retired completion's identity. A resettable React state cannot promise that,
// which is exactly why these cases are written against two independent mounts.
//
// Expected red on the frozen source: the machine allocates `tryId` from the
// state it is handed, and a remount hands it `initialJoinState` again. Two mounts
// therefore allocate the same id, and a late completion from the first mount is
// accepted by the second. The green controls below must keep holding.

import { describe, expect, it } from 'vitest'
import {
  initialJoinState,
  joinAllowsNavigation,
  joinMachine,
  joinOffersRetry,
  type JoinState,
} from '../src/lib/inviteGateStates'

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** One gate mount: the machine starts from the product's initial state. */
function mount(state: JoinState = initialJoinState) {
  return joinMachine(state, { type: 'begin', userId: ALICE, gen: 7, member: false })
}

describe('C2 — a remount must not reuse a retired attempt identity', () => {
  it('two mounts allocate different try ids', () => {
    const first = mount()
    const second = mount()

    expect(second.state.tryId).toBeGreaterThan(first.state.tryId)
  })

  it('a late completion from the previous mount is ignored', () => {
    // Mount 1 dispatches a join.
    const first = mount()
    expect(first.action.type).toBe('join')

    // A profile gap remounts the gate. The machine starts again from the
    // product's initial state, exactly as a fresh mount does.
    const second = mount()

    // The retired attempt's answer arrives after the remount.
    const late = joinMachine(second.state, {
      type: 'join-settled',
      userId: ALICE,
      gen: 7,
      tryId: first.state.tryId,
      result: 'joined',
    })

    expect(late.state.phase, 'a retired attempt never settles the new mount').not.toBe('joined')
    expect(joinAllowsNavigation(late.state), 'and it never opens the trip').toBe(false)
  })
})

describe('lifetime controls that must keep holding', () => {
  it('a profile gap to another account ignores the earlier completion', () => {
    const started = mount()
    const aliceTry = started.state.tryId

    const gap = joinMachine(started.state, { type: 'begin', userId: BOB, gen: 8, member: false })
    expect(gap.state.tryId).not.toBe(aliceTry)

    const late = joinMachine(gap.state, {
      type: 'join-settled',
      userId: ALICE,
      gen: 7,
      tryId: aliceTry,
      result: 'joined',
    })
    expect(late.state.phase).toBe(gap.state.phase)
    expect(joinAllowsNavigation(late.state)).toBe(false)
  })

  it('a retry after a failure supersedes the earlier try on the same account', () => {
    const started = mount()
    // A retry is only offered after a terminal state, so reach one first.
    const failed = joinMachine(started.state, {
      type: 'join-settled',
      userId: ALICE,
      gen: 7,
      tryId: started.state.tryId,
      result: 'failed',
    })
    expect(failed.state.phase).toBe('failed')

    const retry = joinMachine(failed.state, { type: 'retry', userId: ALICE, gen: 7, member: false })
    expect(retry.state.phase).toBe('joining')
    expect(retry.state.tryId).not.toBe(started.state.tryId)

    const superseded = joinMachine(retry.state, {
      type: 'join-settled',
      userId: ALICE,
      gen: 7,
      tryId: started.state.tryId,
      result: 'joined',
    })
    expect(joinAllowsNavigation(superseded.state)).toBe(false)

    const live = joinMachine(retry.state, {
      type: 'join-settled',
      userId: ALICE,
      gen: 7,
      tryId: retry.state.tryId,
      result: 'joined',
    })
    expect(joinAllowsNavigation(live.state)).toBe(true)
  })

  it('a terminal failure stays terminal until an explicit retry', () => {
    const started = mount()
    const failed = joinMachine(started.state, {
      type: 'join-settled',
      userId: ALICE,
      gen: 7,
      tryId: started.state.tryId,
      result: 'failed',
    })
    expect(failed.state.phase).toBe('failed')

    const rerun = joinMachine(failed.state, { type: 'begin', userId: ALICE, gen: 7, member: false })
    expect(rerun.state.phase).toBe('failed')
    expect(rerun.action).toEqual({ type: 'none' })
    expect(joinOffersRetry(rerun.state)).toBe(true)
  })

  it('a known member retry re-reads and never joins again', () => {
    const member = joinMachine(initialJoinState, { type: 'begin', userId: ALICE, gen: 7, member: true })
    expect(member.action.type).toBe('reload')

    const unread = joinMachine(member.state, {
      type: 'reload-settled',
      userId: ALICE,
      gen: 7,
      tryId: member.state.tryId,
      result: 'failed',
    })
    expect(unread.state.phase).toBe('joined-unloaded')

    const retry = joinMachine(unread.state, { type: 'retry', userId: ALICE, gen: 7, member: true })
    expect(retry.action.type).toBe('reload')
  })
})
