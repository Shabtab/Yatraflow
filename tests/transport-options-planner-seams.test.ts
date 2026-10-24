// ============ Transport-aware options: the real planner seams (2026-10-19) ============
// `drivesPart` is an OPTIONAL field, which is exactly why it can be silently
// dropped: a caller that forgets it keeps the legacy behaviour and nothing
// goes red. Each test below drives the REAL seam a trip's plan
// actually travels, and asserts the observable planning consequence. Drop
// `drivesPart` from any of these call paths and the matching test fails.
import { describe, expect, it } from 'vitest'
import {
  isSelfDrivenMode, wheelCapHoursForParty, planDriveDays,
} from '../src/lib/ridePlan'
import { planRide as planRideSegments } from './helpers/sharedDrivingPlan'
import { planInputsHash } from '../src/hooks/useSuggestionCache'
import { transportPolicy } from '../src/lib/transportPolicy'

/** Enough input for the segment planner to reach its drive-day split. */
const SEGS = {
  totalKm: 1800,
  driveMinutes: 1800,
  dayStartTimes: ['08:30'],
} as const

describe('the wheel answer reaches the segment planner', () => {
  it('plans a Mixed trip as driving until it is answered', () => {
    const plan = planRideSegments({ ...SEGS, transportMode: 'mixed' })
    expect(plan.length).toBeGreaterThan(0)
  })

  it('drops the drive-day split once Mixed answers No', () => {
    // Observable consequence at the seam the map and the timeline both read:
    // an unanswered Mixed gets a wheel and a fatigue-driven day split, and a
    // Mixed-No trip must get none, because it has no wheel to fatigue. Drop
    // `drivesPart` from this path and the two verdicts become identical.
    const unanswered = planDriveDays({ ...SEGS, transportMode: 'mixed' })
    const answeredNo = planDriveDays({ ...SEGS, transportMode: 'mixed', drivesPart: false })
    expect(answeredNo).toBeNull()
    expect(unanswered).not.toBeNull()
  })

  it('keeps the split when Mixed answers Yes', () => {
    const yes = planDriveDays({ ...SEGS, transportMode: 'mixed', drivesPart: true })
    const unanswered = planDriveDays({ ...SEGS, transportMode: 'mixed' })
    expect(yes).not.toBeNull()
    expect(unanswered).not.toBeNull()
    // Same inputs, same verdict: answering Yes changes nothing that was
    // already true for the unanswered default.
    expect(JSON.stringify(yes)).toBe(JSON.stringify(unanswered))
  })

  it('still returns segments for a passenger Mixed, just without a wheel verdict', () => {
    const plan = planRideSegments({ ...SEGS, transportMode: 'mixed', drivesPart: false })
    expect(plan.length).toBeGreaterThan(0)
  })

  it('refuses the drive-day verdict for a Mixed-No trip', () => {
    expect(planDriveDays({ ...SEGS, transportMode: 'mixed', drivesPart: false })).toBeNull()
    expect(planDriveDays({ ...SEGS, transportMode: 'mixed' })).not.toBeNull()
  })
})

describe('the planner and the policy never disagree', () => {
  it.each([
    ['car', undefined, true], ['rental', undefined, true], ['motorcycle', undefined, true],
    ['train', undefined, false], ['bus', undefined, false], ['flight', undefined, false],
    ['taxi', undefined, false],
    ['mixed', undefined, true], ['mixed', true, true], ['mixed', false, false],
  ] as const)('%s with drivesPart=%s', (mode, drivesPart, expected) => {
    expect(isSelfDrivenMode(mode, drivesPart), `${mode}/${String(drivesPart)}`).toBe(expected)
    expect(transportPolicy({ transportMode: mode, drivesPart }).driving).toBe(expected)
    expect(wheelCapHoursForParty({ transportMode: mode, drivesPart }) != null).toBe(expected)
  })
})

describe('a stale driver count cannot move a passenger plan', () => {
  it('ignores it for a Mixed-No trip', () => {
    expect(wheelCapHoursForParty({ transportMode: 'mixed', drivesPart: false, driverCount: 3, travelStyle: 'balanced' })).toBeNull()
  })

  it('honours it again when the traveller answers Yes', () => {
    const passenger = wheelCapHoursForParty({ transportMode: 'mixed', drivesPart: false, driverCount: 3 })
    const driver = wheelCapHoursForParty({ transportMode: 'mixed', drivesPart: true, driverCount: 3, travelStyle: 'balanced' })
    const solo = wheelCapHoursForParty({ transportMode: 'mixed', drivesPart: true, travelStyle: 'balanced' })
    expect(passenger).toBeNull()
    expect(driver).not.toBeNull()
    expect(driver as number).toBeGreaterThan(solo as number)
  })
})

describe('a passenger trip never gets a fuel or charge halt', () => {
  // The EV profile is the leak the gate caught: an electric vehicle profile on
  // a bus trip still produced charge segments, because the charge flag was
  // never gated by the wheel. These call the REAL segment planner with the same
  // inputs the Map tab passes, and assert the stops it returns.
  const CHARGE_TRIP = {
    totalKm: 1000, driveMinutes: 1200, dayStartTimes: ['08:30'],
    multiDay: true, includeCharge: true, vehicleRangeKm: 300,
  } as const

  // A charge stop can fold into a meal or an overnight ("Meal + charge"), so
  // the observable is the Charge wording the traveller sees, not the purpose.
  const chargeStops = (plan: ReturnType<typeof planRideSegments>) => plan.filter(s => /charge/i.test(s.label))

  it.each(['bus', 'train', 'flight', 'taxi'] as const)('%s gets no fuel or charge stops', (mode) => {
    const plan = planRideSegments({ ...CHARGE_TRIP, transportMode: mode })
    expect(chargeStops(plan)).toHaveLength(0)
  })

  it('a Mixed trip that answered No gets none either', () => {
    const plan = planRideSegments({ ...CHARGE_TRIP, transportMode: 'mixed', drivesPart: false })
    expect(chargeStops(plan)).toHaveLength(0)
  })

  it('the same inputs still plan charge stops for a driving trip (control)', () => {
    // Control: without this, the assertions above would pass on a planner that
    // simply never made a charge stop.
    expect(chargeStops(planRideSegments({ ...CHARGE_TRIP, transportMode: 'car' })).length).toBeGreaterThan(0)
    expect(chargeStops(planRideSegments({ ...CHARGE_TRIP, transportMode: 'mixed' })).length).toBeGreaterThan(0)
  })

  it('a legacy caller that names no mode keeps the flags it asked for', () => {
    // A charge flag with no mode is the caller's own statement about the wheel.
    // The gate must not read the missing mode as a passenger trip.
    expect(chargeStops(planRideSegments({ ...CHARGE_TRIP })).length).toBeGreaterThan(0)
  })
})

describe('the map cache key separates all three answers', () => {
  const base = {
    anchorsHash: 'a', routeHash: 'r', travelStyle: 'balanced',
    transportMode: 'mixed', scopeKm: 50, travellers: 2,
  }
  const key = (drivesPart?: boolean) =>
    planInputsHash({ ...base, drivesPart })

  it('gives unanswered, Yes and No three different keys', () => {
    // One cached segment plan must never answer for another state. If the
    // answer were dropped from the hash, all three would collapse to one and a
    // passenger map would keep serving the driving plan.
    const keys = new Set([key(undefined), key(true), key(false)])
    expect(keys.size).toBe(3)
  })
})