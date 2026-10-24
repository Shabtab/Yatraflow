/**
 * The route and Places providers both use this codec.
 *
 * Points use the OSRM order, [lng, lat], at 1e5 precision.
 * The decoder stops when the string ends inside a value.
 * It returns only the points that it finished before the cut.
 */

/** One signed value and the index just after its last character. */
interface EncodedValue {
  value: number
  next: number
}

/**
 * Reads one signed value that begins at index `start`.
 * Returns null when the string ends before the value is complete.
 */
function readValue(str: string, start: number): EncodedValue | null {
  let result = 0
  let shift = 0
  let idx = start
  let b = 0
  do {
    if (idx >= str.length) return null
    b = str.charCodeAt(idx++) - 63
    result |= (b & 0x1f) << shift
    shift += 5
  } while (b >= 0x20)
  return { value: result & 1 ? ~(result >> 1) : result >> 1, next: idx }
}

/**
 * Decodes a Google encoded polyline into [lng, lat] points at 1e5 precision.
 * A cut-off string returns only the points that it finished.
 */
export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = []
  let at = 0
  let lat = 0
  let lng = 0
  while (at < str.length) {
    const dLat = readValue(str, at)
    if (dLat === null) break
    const dLng = readValue(str, dLat.next)
    // A lat without a lng drops the last half-point.
    if (dLng === null) break
    lat += dLat.value
    lng += dLng.value
    out.push([lng / 1e5, lat / 1e5])
    at = dLng.next
  }
  return out
}

/** Encodes one signed value as 5-bit chunks, for encodePolyline. */
function encVal(v: number): string {
  let out = ''
  let n = v < 0 ? ~(v << 1) : (v << 1)
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63)
    n >>= 5
  }
  out += String.fromCharCode(n + 63)
  return out
}

/**
 * Encode OSRM-style [lng, lat][] coordinates as a Google encoded polyline.
 * It skips any point with a non-finite coordinate.
 */
export function encodePolyline(coords: [number, number][]): string {
  let out = ''
  let prevLat = 0
  let prevLng = 0
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const ilat = Math.round(lat * 1e5)
    const ilng = Math.round(lng * 1e5)
    out += encVal(ilat - prevLat) + encVal(ilng - prevLng)
    prevLat = ilat
    prevLng = ilng
  }
  return out
}
