// ============ Trip snapshots ============
// Export/import as JSON files, plus shareable URL snapshots: the whole trip
// is JSON-encoded, deflated and base64url'd into the hash
// (#/share/<payload>) so no server storage is needed.
import type { Trip } from '../data/types'

const PREFIX = 'yf1_' // version tag so future formats can be detected

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
  const json = JSON.stringify(trip)
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
  const trip = JSON.parse(json) as Trip
  if (!trip || typeof trip.id !== 'string' || !Array.isArray(trip.days)) throw new Error('bad data')
  return trip
}

export function snapshotUrl(trip: Trip, payload: string): string {
  void trip
  return `${location.origin}${location.pathname}#/share/${payload}`
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

export function downloadTripJson(trip: Trip): void {
  const blob = new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${trip.name.replace(/[^\w\-]+/g, '_') || 'trip'}_yatraflow.json`
  a.click()
  URL.revokeObjectURL(url)
}
