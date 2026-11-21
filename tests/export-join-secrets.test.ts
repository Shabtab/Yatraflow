import { describe, it, expect } from 'vitest'
import { seedData } from '../src/data/seed'
import type { Trip, TripMember } from '../src/data/types'
import { buildTripExport } from '../src/lib/itinerarySpec'
import { parseTripImport } from '../src/lib/tripImport'

const CREW_NAME = 'MEERA-SECRET-NAME'
const CREW_EMAIL = 'meera.secret@example.in'
const JOIN_CODE = 'JOIN-SECRET-123'

function secretTrip(): Trip {
  return {
    ...structuredClone(seedData.trips[0]),
    name: 'Secret strip check',
    inviteCode: JOIN_CODE,
    members: [
      {
        userId: 'usr_CREWSECRET',
        role: 'owner',
        joinedAt: 1700000000000,
        // TripMember declares ids, role and time only. Extra markers make the
        // leak check cover every kind of crew detail, including name and email.
        name: CREW_NAME,
        email: CREW_EMAIL,
      } as TripMember,
    ],
  }
}

const stopCount = (t: Trip): number => t.days.reduce((n, day) => n + day.stops.length, 0)

describe('buildTripExport strips join secrets (#784)', () => {
  it('omits the inviteCode and members keys from the exported trip', () => {
    const doc = buildTripExport(secretTrip())
    expect('inviteCode' in doc.trip).toBe(false)
    expect('members' in doc.trip).toBe(false)
  })

  it('does not write the join code or crew details into the file text', () => {
    const text = JSON.stringify(buildTripExport(secretTrip()))
    expect(text).not.toContain(JOIN_CODE)
    expect(text).not.toContain(CREW_NAME)
    expect(text).not.toContain(CREW_EMAIL)
    expect(text).not.toContain('usr_CREWSECRET')
  })

  it('does not mutate the input trip', () => {
    const t = secretTrip()
    buildTripExport(t)
    expect(t.inviteCode).toBe(JOIN_CODE)
    expect(t.members).toHaveLength(1)
    expect(t.members![0]).toMatchObject({ name: CREW_NAME, email: CREW_EMAIL })
  })

  it('still round-trips the trip name and stop count through import', () => {
    const t = secretTrip()
    const back = parseTripImport(JSON.stringify(buildTripExport(t))).trip
    expect(back.name).toBe(t.name)
    expect(back.days.reduce((n, day) => n + day.stops.length, 0)).toBe(stopCount(t))
  })
})
