// ============ #377 — what create is told survives into Settings ============
// The create form computed its vehicle inputs into the bill and then dropped
// them at submit, so Settings opened on mode defaults and a reload silently
// disproved every value the user had typed (the missing-optional-column class,
// twice-lived before: cover_image_url, stay_style). These tests walk the real
// chain — NewTripInput → createTrip → row → the Trip Settings initializes
// from — and pin the two derivations the create side adds.
//
// Store half is behavioural (real store, mocked transport), like
// tests/create-persist-submit.test.ts.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { rowToTrip, tripToRow } from '../src/lib/tripRow'
import { vehicleProfileFor } from '../src/lib/tripStarter'
import { TRANSPORT_MODES } from '../src/data/types'
import type { TripMember } from '../src/data/types'

vi.mock('../src/components/ui', () => ({ toast: vi.fn() }))

vi.mock('../src/lib/supabase', () => {
  function query() {
    const qb: any = {}
    qb.select = () => qb
    qb.eq = () => qb
    qb.in = () => qb
    qb.order = () => qb
    qb.limit = () => qb
    qb.then = (res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res, rej)
    qb.maybeSingle = () => ({
      then: (res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(res, rej),
    })
    return qb
  }
  function write() {
    const qb: any = {}
    qb.eq = () => qb
    qb.in = () => qb
    qb.select = () => qb
    qb.then = (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(res, rej)
    return qb
  }
  return {
    isSupabaseConfigured: () => true,
    supabase: {
      from: () => {
        const qb = query()
        qb.insert = () => write()
        qb.update = () => write()
        qb.upsert = () => write()
        qb.delete = () => write()
        return qb
      },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: () => {},
      rpc: async () => ({ data: null, error: null }),
    },
  }
})

import { createTrip } from '../src/store/store'
import type { NewTripInput } from '../src/store/store'

const MEMBERS: TripMember[] = [{ userId: 'owner-377', role: 'owner', joinedAt: 1 }]

const ALL_COLUMNS = {
  economy: true, price: true, roundTrip: true, cover: true,
  inviteCode: true, deleted: true, stayStyle: true,
  driverCount: true, hasVulnerable: true, driveAfterDinner: true, vehicleProfile: true,
  tankL: true, rentPerDayInr: true, localTrain: true,
}

function input(over: Partial<NewTripInput> = {}): NewTripInput {
  return {
    name: 'Kerala in four days', startLocation: 'Kochi', destinations: ['Munnar'],
    startDate: '2026-10-01', endDate: '2026-10-04', travellers: 2,
    transportMode: 'car', budgetPerPersonInr: 22000, travelStyle: 'balanced',
    fixedCommitments: [],
    ...over,
  } as NewTripInput
}

/** The whole persistence chain, ending at the Trip shape Settings inits from. */
function throughSettings(payload: NewTripInput) {
  const trip = createTrip('owner-377', payload)
  return rowToTrip(tripToRow(trip, 'owner-377', ALL_COLUMNS), MEMBERS)
}

describe('create → Settings round-trip', () => {
  it('every vehicle input set on create reads back identical', () => {
    const vehicleProfile = { vehicleType: 'car' as const, fuelType: 'diesel' as const, capacity: 60, economy: 21 }
    const back = throughSettings(input({
      vehicleProfile, tankL: 60, rentPerDayInr: 1800, localTrain: true,
      transportMode: 'train',
    }))
    expect(back.vehicleProfile).toEqual(vehicleProfile) // deep-equal
    expect(back.tankL).toBe(60)
    expect(back.rentPerDayInr).toBe(1800)
    expect(back.localTrain).toBe(true)
  })

  it('roundTrip survives for EVERY mode, not just the fuel ones', () => {
    // The old submit gated the flag on isFuelEconomyMode, so a non-fuel round
    // trip silently became one-way the moment Settings read it back.
    for (const mode of TRANSPORT_MODES) {
      expect(throughSettings(input({ transportMode: mode, roundTrip: false })).roundTrip, mode).toBe(false)
      expect(throughSettings(input({ transportMode: mode, roundTrip: true })).roundTrip, mode).toBe(true)
    }
  })
})

describe('vehicleProfileFor — the create form’s stated details become the profile', () => {
  it('the tank and mileage the user typed ride over the mode default', () => {
    expect(vehicleProfileFor({ mode: 'car', tankL: 60, economyKmL: 21 })).toEqual({
      vehicleType: 'car', fuelType: 'petrol', capacity: 60, economy: 21,
    })
    expect(vehicleProfileFor({ mode: 'motorcycle', tankL: 18 })).toEqual({
      vehicleType: 'motorcycle', fuelType: 'petrol', capacity: 18, economy: 40,
    })
  })

  it('nothing stated → no profile: the mode default stays the live fallback', () => {
    expect(vehicleProfileFor({ mode: 'car' })).toBeUndefined()
    // A stated-but-impossible tank is nothing stated (the persistence bound).
    expect(vehicleProfileFor({ mode: 'car', tankL: 9999 })).toBeUndefined()
  })

  it('a stated tank with a junk mileage keeps the tank and the default mileage', () => {
    expect(vehicleProfileFor({ mode: 'car', tankL: 60, economyKmL: 9999 })).toEqual({
      vehicleType: 'car', fuelType: 'petrol', capacity: 60, economy: 15,
    })
  })
})

describe('the page half (pinned textually — the node suite cannot render the form)', () => {
  it('submit persists the four vehicle inputs and the round-trip flag for every mode', () => {
    // The #377 bug lived HERE, in the submit assembly: the vehicle inputs
    // never reached NewTripInput and the flag was gated on isFuelEconomyMode,
    // so a non-fuel round trip read back one-way. The chain tests above prove
    // the store half; this pin is the page contract, same style as
    // tests/create-persist-submit.test.ts.
    const page = readFileSync(new URL('../src/pages/CreateTrip.tsx', import.meta.url), 'utf8')
    expect(page).not.toMatch(/roundTrip:\s*fuelMode\s*\?/) // the old gate
    expect(page).toMatch(/roundTrip: f\.roundTrip/)
    expect(page).toContain('vehicleProfile: vehicleProfileFor(')
    expect(page).toContain('tankL: Number.isFinite(tankNum)')
    expect(page).toContain('rentPerDayInr: Number.isFinite(rentNum)')
    expect(page).toContain("localTrain: f.transportMode === 'train'")
  })
})
