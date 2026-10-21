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
import { settingsAreDirty, settingsDryRun, formFromTrip } from '../src/pages/trip/TripSettingsForm'
import { zipDests } from '../src/lib/destPairs'

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

/** The same row through the real reader, which is what a reopened form sees. */
function savedRow(t: Trip) {
  return rowToTrip(tripToRow(t, 'u_1', ALL_COLS))
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

  it('leaves a No trip with no wheel, and keeps the stored pair for a later Yes', () => {
    const answered = trip({ transportMode: 'mixed', drivesPart: false, driverCount: 3 })
    expect(transportPolicy({ transportMode: 'mixed', drivesPart: false }).driving).toBe(false)
    expect(wheelCapHoursForParty({ transportMode: 'mixed', drivesPart: false, driverCount: 3 })).toBeNull()
    expect(answered.driverCount).toBe(3) // still stored, and still usable after Yes
  })
})

describe('the save keeps choices a mode does not currently use', () => {
  // The gate's repro: save No with three drivers and a 60-minute dinner
  // allowance, reopen and choose Yes, and both values were gone. It called the
  // real save mapping, because the write is where the loss happened.
  const stored = () => trip({ transportMode: 'mixed', driverCount: 3, hasVulnerable: true, driveAfterDinnerMin: 60 })

  const dryRun = (form: ReturnType<typeof formFromTrip>, row: Trip) =>
    settingsDryRun(form, zipDests(row.destinations, row.destinationCoords), null, row)

  it('writes the stored pair back when the answer is No', () => {
    const row = stored()
    const run = dryRun({ ...formFromTrip(row), drivesPart: false }, row)
    if (!run.ok) throw new Error(run.reason)
    expect(run.patch.drivesPart).toBe(false)
    expect(run.patch.driverCount).toBe(3)
    expect(run.patch.hasVulnerable).toBe(true)
    expect(run.patch.driveAfterDinnerMin).toBe(60)
  })

  it('reopens with both choices after the No save, and uses them again on Yes', () => {
    const row = stored()
    const no = dryRun({ ...formFromTrip(row), drivesPart: false }, row)
    if (!no.ok) throw new Error(no.reason)
    const saved = savedRow({ ...row, ...no.patch } as Trip)
    // The row round trip is the reopen: both values are still on the trip.
    expect(saved.drivesPart).toBe(false)
    expect(saved.driverCount).toBe(3)
    expect(saved.hasVulnerable).toBe(true)
    expect(saved.driveAfterDinnerMin).toBe(60)
    // Choosing Yes now writes the same stored pair again, not a cleared one.
    const reopened = formFromTrip(saved)
    expect(reopened.driverCount).toBe(3)
    expect(reopened.driveAfterDinner).toBe(true)
    const yes = dryRun({ ...reopened, drivesPart: true }, saved)
    if (!yes.ok) throw new Error(yes.reason)
    expect(yes.patch.driverCount).toBe(3)
    expect(yes.patch.hasVulnerable).toBe(true)
    expect(yes.patch.driveAfterDinnerMin).toBe(60)
    // And the pair reaches the planner again once the wheel is back.
    const reopenedYes = savedRow({ ...saved, ...yes.patch } as Trip)
    expect(reopenedYes.driverCount).toBe(3)
    expect(wheelCapHoursForParty({
      transportMode: 'mixed', drivesPart: reopenedYes.drivesPart, driverCount: reopenedYes.driverCount,
      hasVulnerable: reopenedYes.hasVulnerable, travelStyle: reopenedYes.travelStyle,
    })).not.toBeNull()
  })

  it('keeps the pair when the mode becomes a passenger mode', () => {
    const row = trip({ transportMode: 'car', driverCount: 2, hasVulnerable: true, driveAfterDinnerMin: 60 })
    const run = dryRun({ ...formFromTrip(row), transportMode: 'bus' }, row)
    if (!run.ok) throw new Error(run.reason)
    expect(run.patch.transportMode).toBe('bus')
    expect(run.patch.driverCount).toBe(2)
    expect(run.patch.hasVulnerable).toBe(true)
    expect(run.patch.driveAfterDinnerMin).toBe(60)
    // The passenger plan still ignores them.
    expect(transportPolicy({ transportMode: 'bus', driverCount: 2 }).driving).toBe(false)
  })

  it('still clears the allowance when the traveller turns it off in a driving mode', () => {
    // Keeping an INACTIVE choice must not make the visible toggle un-clearable.
    const row = trip({ transportMode: 'car', driveAfterDinnerMin: 60 })
    const run = dryRun({ ...formFromTrip(row), driveAfterDinner: false }, row)
    if (!run.ok) throw new Error(run.reason)
    expect(run.patch.driveAfterDinnerMin).toBeUndefined()
    expect(settingsAreDirty(run.patch, row)).toBe(true)
  })

  it('a passenger row that never had a wheel stays without one, and saves cleanly', () => {
    // The old clearing behaviour is kept where it applies: a row with no wheel
    // carries no wheel settings, so an untouched save writes the same nothing.
    const row = trip({ transportMode: 'bus', driverCount: undefined, hasVulnerable: undefined, driveAfterDinnerMin: undefined })
    const run = dryRun(formFromTrip(row), row)
    if (!run.ok) throw new Error(run.reason)
    expect(run.patch.driverCount).toBeUndefined()
    expect(run.patch.hasVulnerable).toBeUndefined()
    expect(run.patch.driveAfterDinnerMin).toBeUndefined()
    expect(settingsAreDirty(run.patch, row)).toBe(false)
  })
})