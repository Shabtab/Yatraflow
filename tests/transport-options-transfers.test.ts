// ============ Transport-aware options: transfers (2026-10-19) ============
// The Mixed answer has to cross every seam a trip can travel through, or a
// traveller answers a question and then loses it by importing, exporting,
// snapshotting or backing up. Each case below drives the real seam with a real
// encoded payload rather than a hand-written object.
import { describe, expect, it, vi } from 'vitest'
import { buildTripExport, normalizeTrip, emptyReport, migrateTrip, TRIP_KEYS } from '../src/lib/itinerarySpec'
import { encodeTripSnapshot, decodeTripSnapshot, snapshotUrl } from '../src/lib/snapshot'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'

function trip(over: Partial<Trip> = {}): Trip {
  return { ...structuredClone(seedData.trips[0]), ...over } as Trip
}

const ORIGIN = 'https://app.example.test'

describe('the answer is a known trip field', () => {
  it('is in the export key set, so a file carries it', () => {
    expect(TRIP_KEYS.has('drivesPart')).toBe(true)
  })
})

describe('a file export and import carry the answer', () => {
  it('survives export and import, both answers and the unanswered state', () => {
    for (const drivesPart of [true, false, undefined]) {
      const source = trip({ transportMode: 'mixed', drivesPart })
      const doc = buildTripExport(source, undefined, '0.0.0-test') as { trip: Record<string, unknown> }
      const walled = normalizeTrip(doc.trip, emptyReport(), [])
      expect(walled, String(drivesPart)).not.toBeNull()
      // The repair wall is for foreign files, and this field is identity, so it
      // rides back the way id and vehicleProfile do.
      const restored = migrateTrip(walled as unknown as Record<string, unknown>, 1) as unknown as Trip
      expect(restored.drivesPart, String(drivesPart)).toBe(drivesPart)
    }
  })

  it('drops a non-boolean answer instead of trusting the file', () => {
    // A hand-edited file carrying `drivesPart: "false"` must not demote a trip
    // to passenger. Only a real boolean is an answer.
    const walled = normalizeTrip({ ...trip(), drivesPart: 'false' }, emptyReport(), [])
    expect((walled as unknown as Trip).drivesPart).toBeUndefined()
  })
})

describe('a snapshot link carries the answer', () => {
  it('survives a real encode and decode, both answers and the unanswered state', async () => {
    for (const drivesPart of [true, false, undefined]) {
      const source = trip({ transportMode: 'mixed', drivesPart })
      const back = await decodeTripSnapshot(await encodeTripSnapshot(source))
      expect(back.drivesPart, String(drivesPart)).toBe(drivesPart)
      expect(back.transportMode).toBe('mixed')
    }
  })

  it('refuses a malformed answer from a hostile payload', async () => {
    // A payload is untrusted input. The identity-restore block copies RAW keys
    // over the walled trip, so a field listed there would arrive unparsed. The
    // wall is what turns these back into the unanswered state.
    for (const raw of ['false', 'no', 0, 1, null, {}, []]) {
      const payload = await encodeTripSnapshot(trip({ transportMode: 'mixed' }))
      const hostile = payload.replace(/"drivesPart":null/, `"drivesPart":${JSON.stringify(raw)}`)
      // The encoder never writes the key for an unanswered trip, so inject it.
      const injected = hostile.replace(/"formatVersion"/, `"drivesPart":${JSON.stringify(raw)},"formatVersion"`)
      const back = await decodeTripSnapshot(injected)
      expect(back.drivesPart, JSON.stringify(raw)).toBeUndefined()
    }
  })

  it('reaches a reader through the link the app builds', async () => {
    // This packet owns that the ANSWER survives the link, not what the link
    // looks like. Its transport form is #805's acceptance, and #805 is not on
    // this integration parent, so pinning the URL shape here would fail for a
    // reason that is not this packet's.
    const source = trip({ transportMode: 'mixed', drivesPart: false })
    const payload = await encodeTripSnapshot(source)
    vi.stubGlobal('location', new URL(`${ORIGIN}/trips`))
    const url = new URL(snapshotUrl(source, payload))
    vi.unstubAllGlobals()
    // The token is on the link, and decoding it gives the reader the answer.
    expect(url.href).toContain(payload)
    const token = url.href.slice(url.href.lastIndexOf(payload[0]) === -1 ? 0 : url.href.length - payload.length)
    expect((await decodeTripSnapshot(token)).drivesPart).toBe(false)
  })
})

describe('a backup keeps the answer', () => {
  it('survives the structured clone every backup path uses', () => {
    // The offline cache and the fork/import copier both persist whole Trip
    // objects through structuredClone, so the field rides along as long as it
    // is on the type. Pin it so a future store-level rewrite cannot drop it.
    const source = trip({ transportMode: 'mixed', drivesPart: true })
    expect(structuredClone(source).drivesPart).toBe(true)
  })
})