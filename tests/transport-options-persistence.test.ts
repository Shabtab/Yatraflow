// ============ Transport-aware options: policy, persistence and transfers (2026-10-19) ============
// The capability table is pinned in tests/transport-policy.test.ts. This file
// pins what the policy BUYS: that a stale driving value cannot move a passenger
// plan, that a legacy Mixed trip is untouched by an unrelated save, and that the
// answer survives every seam it has to cross.
import { describe, expect, it } from 'vitest'
import { rowToTrip, tripToRow, drivesPartWriteVerdict, DRIVES_PART_MISSING_REASON, type OptionalColumnsProbe } from '../src/lib/tripRow'
import { transportPolicy } from '../src/lib/transportPolicy'
import { isSelfDrivenMode, wheelCapHoursForParty } from '../src/lib/ridePlan'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'

/** A probe that says the database has every column. */
const ALL_COLS: OptionalColumnsProbe = {
  economy: true, price: true, roundTrip: true, cover: true, inviteCode: true,
  deleted: true, stayStyle: true, driverCount: true, hasVulnerable: true,
  driveAfterDinner: true, vehicleProfile: true, tankL: true, rentPerDayInr: true,
  localTrain: true, flights: true, ref: true, drivesPart: true,
}

function trip(over: Partial<Trip> = {}): Trip {
  return { ...structuredClone(seedData.trips[0]), ...over } as Trip
}

/** The trip id and timestamps rowToTrip needs. */
function row(over: Record<string, unknown> = {}) {
  const t = trip()
  return {
    id: t.id, owner_id: 'u_1', name: t.name, start_location: t.startLocation,
    destinations: t.destinations, start_date: t.startDate, end_date: t.endDate,
    travellers: t.travellers, transport_mode: t.transportMode,
    budget_per_person_inr: t.budgetPerPersonInr, travel_style: t.travelStyle,
    stay_style: 'comfort', fixed_commitments: [], days: t.days, expenses: t.expenses,
    cover_emoji: 'dY-', visibility: 'private', created_at: 1, updated_at: 1,
    ...over,
  } as never
}

describe('the policy and the planner agree on the wheel', () => {
  it('gives an unanswered Mixed a wheel cap, which is what it has always had', () => {
    const cap = wheelCapHoursForParty({ transportMode: 'mixed', travelStyle: 'balanced' })
    expect(cap).not.toBeNull()
    expect(isSelfDrivenMode('mixed')).toBe(true)
    expect(transportPolicy({ transportMode: 'mixed' }).driving).toBe(true)
  })

  it('gives a Mixed trip that answered No no wheel cap', () => {
    expect(wheelCapHoursForParty({ transportMode: 'mixed', drivesPart: false })).toBeNull()
  })

  it('gives a passenger mode no wheel cap', () => {
    for (const mode of ['train', 'bus', 'flight', 'taxi']) {
      expect(wheelCapHoursForParty({ transportMode: mode }), mode).toBeNull()
    }
  })

  it('lets a stale driver count buy hours again once Mixed answers Yes', () => {
    // The values are never cleared on a No, so this is what makes a
    // passenger-to-driving switch correct rather than lossy: answer No and the
    // stored 2 drivers stop mattering, answer Yes and they apply again.
    const withStale = { transportMode: 'mixed', driverCount: 2, travelStyle: 'balanced' }
    // Unanswered, and answered No: no wheel, so no cap.
    expect(wheelCapHoursForParty({ ...withStale, drivesPart: false })).toBeNull()
    // Answered Yes: the same stored driver count is live again.
    const yesCap = wheelCapHoursForParty({ ...withStale, drivesPart: true })
    expect(yesCap).not.toBeNull()
    // And it is genuinely the stale pair earning the longer day.
    expect(yesCap).toBe(wheelCapHoursForParty({ ...withStale, drivesPart: true }))
    const soloCap = wheelCapHoursForParty({ ...withStale, driverCount: undefined, drivesPart: true })
    expect(yesCap).toBeGreaterThan(soloCap as number)
  })
})

describe('the Mixed answer survives the database round trip', () => {
  it('reads a stored Yes and a stored No', () => {
    expect(rowToTrip(row({ drives_part: true })).drivesPart).toBe(true)
    expect(rowToTrip(row({ drives_part: false })).drivesPart).toBe(false)
  })

  it('reads an unanswered answer as unanswered, not as No', () => {
    // NULL and "the column does not exist yet" must both mean unanswered. A
    // row that came back as `false` would demote a legacy Mixed trip.
    expect(rowToTrip(row({ drives_part: null })).drivesPart).toBeUndefined()
    expect(rowToTrip(row()).drivesPart).toBeUndefined()
    expect(rowToTrip(row({ drives_part: 'yes' })).drivesPart).toBeUndefined()
  })

  it('writes an answer, and writes NULL for an unanswered trip', () => {
    expect(tripToRow(trip({ drivesPart: true }), 'u_1', ALL_COLS).drives_part).toBe(true)
    expect(tripToRow(trip({ drivesPart: false }), 'u_1', ALL_COLS).drives_part).toBe(false)
    expect(tripToRow(trip(), 'u_1', ALL_COLS).drives_part).toBeNull()
  })

  it('omits the column entirely when the database has not got it', () => {
    const cols = { ...ALL_COLS, drivesPart: false }
    expect('drives_part' in tripToRow(trip({ drivesPart: true }), 'u_1', cols)).toBe(false)
  })
})

describe('a Mixed answer is never lost silently', () => {
  it('accepts an answer when the column exists', () => {
    expect(drivesPartWriteVerdict({ drivesPart: false }, ALL_COLS)).toEqual({ ok: true, value: false })
  })

  it('refuses an answer when the column is missing, and says nothing about SQL', () => {
    const verdict = drivesPartWriteVerdict({ drivesPart: false }, { ...ALL_COLS, drivesPart: false })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('expected a refusal')
    // Traveller-facing copy: no column, no migration, and a retry to try.
    expect(verdict.reason).not.toMatch(/column|migration|database/i)
    expect(verdict.reason).toMatch(/try again/i)
    expect(verdict.reason).toBe(DRIVES_PART_MISSING_REASON)
  })

  it('has nothing to write for a trip that never answered', () => {
    // An unanswered Mixed must keep writing NULL. Writing false would invent an
    // answer nobody gave.
    expect(drivesPartWriteVerdict({}, { ...ALL_COLS, drivesPart: false })).toEqual({ ok: true, value: null })
  })
})

describe('a legacy Mixed trip keeps its preferences through an unrelated save', () => {
  it('keeps every driving value while the answer is missing', () => {
    // This is the acceptance line that a visibility-driven save would break:
    // gating the PATCH on `showsDrivingControls` would strip these, and the
    // trip would plan differently after a reload it never asked for.
    const legacy = trip({ transportMode: 'mixed', driverCount: 3, hasVulnerable: true, driveAfterDinnerMin: 120 })
    expect(transportPolicy({ transportMode: 'mixed' }).driving).toBe(true)
    expect(transportPolicy({ transportMode: 'mixed' }).showsDrivingControls).toBe(false)
    const written = tripToRow(legacy, 'u_1', ALL_COLS)
    expect(written.driver_count).toBe(3)
    expect(written.has_vulnerable).toBe(true)
    expect(written.drive_after_dinner_min).toBe(120)
    expect(written.drives_part).toBeNull()
  })

  it('removes them once the traveller explicitly says No', () => {
    const answered = trip({ transportMode: 'mixed', drivesPart: false, driverCount: 3 })
    expect(transportPolicy({ transportMode: 'mixed', drivesPart: false }).driving).toBe(false)
    expect(wheelCapHoursForParty({ transportMode: 'mixed', drivesPart: false, driverCount: 3 })).toBeNull()
    expect(answered.driverCount).toBe(3) // still stored, and still usable after Yes
  })
})