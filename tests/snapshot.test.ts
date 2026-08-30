// ============ Trip snapshot encode/decode symmetry ============
// Pure logic (node env): guards the URL-share format from issue #21.
import { describe, it, expect } from 'vitest'
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
})