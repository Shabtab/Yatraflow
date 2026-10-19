// ============ Transport-aware options: the shared policy (2026-10-19) ============
// One policy decides, for every surface, whether the wheel is the traveller's.
// These tests are the policy's contract, so they name the mode table rather
// than restating it, and they cover the Mixed tri-state because that is the
// only mode whose answer can change after the trip exists.
import { describe, expect, it } from 'vitest'
import { TRANSPORT_MODES, type TransportMode } from '../src/data/types'
import { transportPolicy } from '../src/lib/transportPolicy'
import { isSelfDrivenMode } from '../src/lib/ridePlan'

/** Modes the specification names as the traveller's own wheel. */
const DRIVING: TransportMode[] = ['car', 'rental', 'motorcycle']
/** Modes the specification names as someone else's shift. */
const PASSENGER: TransportMode[] = ['train', 'bus', 'flight', 'taxi']

describe('the transport policy table', () => {
  it('treats car, self-drive rental and motorcycle as driving', () => {
    for (const mode of DRIVING) {
      expect(transportPolicy({ transportMode: mode }).driving, mode).toBe(true)
    }
  })

  it('treats train, bus, flight and taxi as passenger', () => {
    for (const mode of PASSENGER) {
      expect(transportPolicy({ transportMode: mode }).driving, mode).toBe(false)
    }
  })

  it('covers every declared mode, so a new one cannot slip through', () => {
    const accounted = new Set<TransportMode>([...DRIVING, ...PASSENGER, 'mixed'])
    expect([...TRANSPORT_MODES].filter(m => !accounted.has(m))).toEqual([])
  })

  it('never asks the driving question outside Mixed', () => {
    for (const mode of TRANSPORT_MODES) {
      if (mode === 'mixed') continue
      expect(transportPolicy({ transportMode: mode }).mustAnswerDriving, mode).toBe(false)
    }
  })
})

describe('Mixed carries a tri-state answer', () => {
  it('keeps planning as driving while the answer is missing, which is what Mixed does today', () => {
    // Existing Mixed trips keep their planning behaviour until the traveller
    // saves an answer. A silent switch to passenger here would rewrite every
    // Mixed trip already in the database.
    const policy = transportPolicy({ transportMode: 'mixed' })
    expect(policy.driving).toBe(true)
    expect(policy.answered).toBe(false)
    expect(policy.mustAnswerDriving).toBe(true)
  })

  it('hides the driving controls while the answer is missing', () => {
    // The open question is what the surface shows. A dial nobody has answered
    // yet is not a setting, so unanswered Mixed plans as driving and renders as
    // "not answered". These two are deliberately not the same flag.
    const policy = transportPolicy({ transportMode: 'mixed' })
    expect(policy.showsDrivingControls).toBe(false)
    expect(policy.driving).toBe(true)
  })

  it('drives when the traveller says they drive any part', () => {
    const policy = transportPolicy({ transportMode: 'mixed', drivesPart: true })
    expect(policy.driving).toBe(true)
    expect(policy.showsDrivingControls).toBe(true)
    expect(policy.answered).toBe(true)
    expect(policy.mustAnswerDriving).toBe(false)
  })

  it('follows passenger behaviour when the traveller says they do not drive', () => {
    const policy = transportPolicy({ transportMode: 'mixed', drivesPart: false })
    expect(policy.driving).toBe(false)
    expect(policy.showsDrivingControls).toBe(false)
    expect(policy.answered).toBe(true)
    expect(policy.mustAnswerDriving).toBe(false)
  })

  it('ignores the answer outside Mixed rather than letting it flip a car trip', () => {
    // The column exists on every row. A stale `false` left over from a Mixed
    // answer must not turn a later car trip into a passenger one.
    for (const mode of DRIVING) {
      expect(transportPolicy({ transportMode: mode, drivesPart: false }).driving, mode).toBe(true)
    }
    for (const mode of PASSENGER) {
      expect(transportPolicy({ transportMode: mode, drivesPart: true }).driving, mode).toBe(false)
    }
  })
})

describe('the control flag and the planner flag agree outside Mixed', () => {
  it.each(DRIVING)('%s shows controls and drives', mode => {
    const policy = transportPolicy({ transportMode: mode })
    expect(policy.showsDrivingControls).toBe(true)
    expect(policy.driving).toBe(true)
  })

  it.each(PASSENGER)('%s hides controls and does not drive', mode => {
    const policy = transportPolicy({ transportMode: mode })
    expect(policy.showsDrivingControls).toBe(false)
    expect(policy.driving).toBe(false)
  })
})

describe('the policy and the historical predicate agree', () => {
  it.each([
    ['car', true], ['rental', true], ['motorcycle', true],
    ['train', false], ['bus', false], ['flight', false], ['taxi', false],
    ['mixed', true], ['teleport', false],
  ] as const)('%s', (mode, expected) => {
    // ridePlan.isSelfDrivenMode delegates here, so this table is the contract
    // that predicate has to keep for every existing caller.
    expect(isSelfDrivenMode(mode), mode).toBe(expected)
  })

  it('answers false for an omitted mode, which several callers rely on', () => {
    expect(isSelfDrivenMode()).toBe(false)
    expect(isSelfDrivenMode('')).toBe(false)
    expect(isSelfDrivenMode(undefined, true)).toBe(false)
  })
})

describe('a missing or unreadable mode claims no wheel', () => {
  it('falls back to false, which is what isSelfDrivenMode has always answered', () => {
    // Several legacy callers omit transportMode entirely and keep planning.
    // Guessing a car here would give every one of them a driving trip.
    expect(transportPolicy({ transportMode: undefined }).driving).toBe(false)
    expect(transportPolicy({ transportMode: 'teleport' as TransportMode }).driving).toBe(false)
  })

  it('shows no controls and asks no question, because there is no mode to ask about', () => {
    const policy = transportPolicy({ transportMode: undefined })
    expect(policy.showsDrivingControls).toBe(false)
    expect(policy.mustAnswerDriving).toBe(false)
    expect(policy.answered).toBe(false)
  })
})
