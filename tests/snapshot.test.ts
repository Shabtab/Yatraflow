// ============ Trip snapshot encode/decode symmetry ============
// Pure logic (node env): guards the URL-share format from issue #21.
import { describe, it, expect } from 'vitest'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { encodeTripSnapshot, decodeTripSnapshot } from '../src/lib/snapshot'
import { seedData } from '../src/data/seed'

describe('trip snapshot encode/decode symmetry (issue #21)', () => {
  it('round-trips a full trip losslessly (deflate or raw path, whichever the runtime supports)', async () => {
    const trip = seedData.trips[0]
    const payload = await encodeTripSnapshot(trip)
    expect(payload.startsWith('yf1_')).toBe(true)
    const back = await decodeTripSnapshot(payload)
    expect(back).toEqual(trip)
  })

  it('survives a trip that has been edited (expenses + notes present)', async () => {
    const trip = {
      ...structuredClone(seedData.trips[0]),
      expenses: [{ id: 'ex-1', label: 'Houseboat', category: 'accommodation' as const, amountInr: 8000, dayIndex: 1 }],
    }
    const back = await decodeTripSnapshot(await encodeTripSnapshot(trip))
    expect(back.expenses).toEqual(trip.expenses)
  })

  it('rejects malformed payloads instead of crashing', async () => {
    await expect(decodeTripSnapshot('nope')).rejects.toThrow('unknown format')
    await expect(decodeTripSnapshot('yf1_AAAA')).rejects.toThrow()
  })

  it('never carries the invite code or the member list', async () => {
    const trip = {
      ...structuredClone(seedData.trips[0]),
      inviteCode: 'GOA-K7QF',
      members: [{ userId: 'amelia', role: 'owner' as const, joinedAt: 1 }],
    }
    const back = await decodeTripSnapshot(await encodeTripSnapshot(trip))
    expect(back).not.toHaveProperty('inviteCode')
    expect(back).not.toHaveProperty('members')
    expect(back.name).toBe(trip.name)
  })

  it('refuses a link made by a newer build instead of half-decoding it', async () => {
    const future = { ...structuredClone(seedData.trips[0]), formatVersion: 4 }
    const payload = 'yf1_' + Buffer.concat([Buffer.from([1]), deflateRawSync(JSON.stringify(future))]).toString('base64url')
    await expect(decodeTripSnapshot(payload)).rejects.toThrow('newer YatraFlow')
  })

  it('holds the current version at 3', async () => {
    const payload = await encodeTripSnapshot(structuredClone(seedData.trips[0]))
    const raw = Buffer.from(payload.slice(4).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    expect(raw[0]).toBe(1)
    const json = JSON.parse(new TextDecoder().decode(inflateRawSync(raw.subarray(1))))
    expect(json.formatVersion).toBe(3)
  })

  it('drops an invite code and member list that a link from an older build still carries', async () => {
    const legacy = {
      ...structuredClone(seedData.trips[0]),
      inviteCode: 'GOA-K7QF',
      members: [{ userId: 'amelia', role: 'owner', joinedAt: 1 }],
      formatVersion: 1,
    }
    const payload = 'yf1_' + Buffer.concat([Buffer.from([1]), deflateRawSync(JSON.stringify(legacy))]).toString('base64url')
    const back = await decodeTripSnapshot(payload)
    expect(back).not.toHaveProperty('inviteCode')
    expect(back).not.toHaveProperty('members')
  })
})
