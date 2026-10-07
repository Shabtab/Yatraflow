// ============ Trip snapshots ============
// Export/import as JSON files, plus shareable URL snapshots: the whole trip
// is JSON-encoded, deflated and base64url'd into the hash
// (#/share/<payload>) so no server storage is needed.
//
// Two different directions, two different treatments — both versioned:
//
//   A SNAPSHOT is our own trip, so decoding must be LOSSLESS for a clean
//   trip. It carries `formatVersion`, so decoding runs the shape migrations;
//   a link made by an older build keeps working. The repair wall runs here
//   too; the payload's own identity rides back on top.
//
//   A FILE IMPORT is someone else's document, so it goes through the full
//   repair pass in lib/tripImport.ts.
import type { Trip } from '../data/types'
import {
  ITINERARY_FORMAT_VERSION, buildTripExport, emptyReport, isObject, migrateTrip,
  normalizeTrip, publicationExport,
} from './itinerarySpec'

const PREFIX = 'yf1_' // payload tag so future encodings can be detected

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Encode a trip into a compact URL payload. */
export async function encodeTripSnapshot(trip: Trip): Promise<string> {
  // The version rides inside the payload so a link made today decodes into
  // tomorrow's shape — a snapshot is shared far more widely than a file.
  const json = JSON.stringify({ ...trip, formatVersion: ITINERARY_FORMAT_VERSION })
  // 1-byte flag: 1 = deflate-raw, 0 = raw (browser without CompressionStream)
  const useDeflate = typeof CompressionStream !== 'undefined'
  const body = useDeflate
    ? new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    : new TextEncoder().encode(json)
  const out = new Uint8Array(body.byteLength + 1)
  out[0] = useDeflate ? 1 : 0
  out.set(body, 1)
  return PREFIX + toBase64Url(out)
}

/** Decode a URL payload back into a trip. Throws on malformed input. */
export async function decodeTripSnapshot(payload: string): Promise<Trip> {
  if (!payload.startsWith(PREFIX)) throw new Error('unknown format')
  const json = await inflate(fromBase64Url(payload.slice(PREFIX.length)))
  const raw = JSON.parse(json) as Record<string, unknown>
  if (!raw || typeof raw !== 'object') throw new Error('bad data')
  const declared = typeof raw.formatVersion === 'number' ? raw.formatVersion : 1
  const migrated = migrateTrip(stripVersion(raw), declared) as unknown as Trip
  if (!migrated || typeof migrated.id !== 'string' || !Array.isArray(migrated.days)) throw new Error('bad data')
  // This decode runs the same repair wall a file import runs. A stop that
  // cannot be placed is dropped; 0-based orders are rebuilt; stale leg fields
  // go. A share link has no report channel, so the report is discarded — the
  // trip arrives clean, or the link is refused as bad data.
  const walled = normalizeTrip(migrated as unknown as Record<string, unknown>, emptyReport(), [])
  if (!walled) throw new Error('bad data')
  return restoreSnapshotIdentity(raw, walled)
}

// ---- the lossless half ----
// The wall was built for foreign files: it mints import ids, forces the
// visibility private and drops store-only fields. A snapshot is our own trip,
// so those fields ride back from the payload after the wall. The wall still
// owns the content: coords, orders and stale legs stay repaired.

const SNAPSHOT_IDENTITY_KEYS = [
  'id', 'createdAt', 'updatedAt', 'visibility', 'members', 'inviteCode',
  'deletedAt', 'ref', 'vehicleProfile', 'startLocationCoords',
  'destinationCoords', 'driverCount', 'hasVulnerable', 'driveAfterDinnerMin',
] as const

/** Put the payload's own identity back on the walled trip. A clean trip then
 *  round-trips byte-for-byte, and a repaired one keeps its true identity. */
function restoreSnapshotIdentity(raw: Record<string, unknown>, walled: Trip): Trip {
  const identity: Record<string, unknown> = {}
  for (const k of SNAPSHOT_IDENTITY_KEYS) identity[k] = raw[k]
  return {
    ...walled,
    ...identity,
    expenses: restoreOwnRows(Array.isArray(raw.expenses) ? raw.expenses : [], walled.expenses) as Trip['expenses'],
    fixedCommitments: restoreOwnRows(
      Array.isArray(raw.fixedCommitments) ? raw.fixedCommitments : [], walled.fixedCommitments,
    ) as Trip['fixedCommitments'],
  }
}

/** The wall mints fresh row ids and folds explicit false flags to undefined —
 *  file-import idioms, not repairs. When the wall kept every row and changed
 *  nothing else, the original rows come back; a repaired row stays repaired. */
function restoreOwnRows<T extends { id: string }>(original: unknown[], rows: T[]): T[] {
  if (original.length !== rows.length) return rows
  return rows.map((row, i) => {
    const own = original[i]
    if (!isObject(own) || typeof own.id !== 'string') return row
    const withOwnId = { ...row, id: own.id } as Record<string, unknown>
    return rowKey(withOwnId) === rowKey(own) ? (own as T) : row
  })
}

/** Content signature of a row, with key order normalized. False and absent
 *  compare equal on the two boolean flags the wall folds. */
function rowKey(row: Record<string, unknown>): string {
  const out: Array<[string, unknown]> = []
  for (const k of Object.keys(row).sort()) {
    const v = row[k]
    if (v === undefined) continue
    if ((k === 'optional' || k === 'perPerson') && v === false) continue
    out.push([k, v])
  }
  return JSON.stringify(out)
}

/** Split the payload's own version tag off the trip it describes. */
function stripVersion(raw: Record<string, unknown>): Record<string, unknown> {
  const { formatVersion, ...rest } = raw
  void formatVersion
  return rest
}

export function snapshotUrl(trip: Trip, payload: string): string {
  void trip
  return `${location.origin}/share/${payload}`
}

// ---- decompression helper ----

async function inflate(bytes: Uint8Array): Promise<string> {
  if (bytes.length === 0) throw new Error('empty')
  const flag = bytes[0]
  const body = bytes.slice(1)
  if (flag === 0) return new TextDecoder().decode(body)
  if (typeof DecompressionStream === 'undefined') throw new Error('no decompression support')
  const ds = new DecompressionStream('deflate-raw')
  const buf = await new Response(new Blob([body]).stream().pipeThrough(ds)).arrayBuffer()
  return new TextDecoder().decode(buf)
}

// ---- file download / upload helpers ----

/** Write the trip to a file the importer can read back, versioned and
 *  self-describing. `publication` (a PublishedItinerary, when the trip has
 *  one) is carried in the file's `publication` block — filtered to the fields
 *  the contract defines, so tool-managed stats (views, copies, timestamps)
 *  never land in an archived file. */
export function downloadTripJson(trip: Trip, publication?: Record<string, unknown>): void {
  const doc = buildTripExport(
    trip,
    publication ? publicationExport(publication) : undefined,
    __APP_VERSION__,
  )
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${trip.name.replace(/[^\w\-]+/g, '_') || 'trip'}_yatraflow.json`
  a.click()
  URL.revokeObjectURL(url)
}
