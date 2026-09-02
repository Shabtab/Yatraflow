/** Geo helpers. Coordinates are demo-grade; a real maps SDK can replace this module later. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * The coordinate at `targetKm` along a polyline of route points, interpolated
 * along the cumulative straight-line (haversine) distance. Used by the halt
 * planner to pin a break at a user-chosen km point (e.g. "halt after 100 km").
 * Clamps to the route's total length; returns null when the input is unusable.
 */
export function pointAtKm(
  pts: { lat: number; lng: number }[],
  targetKm: number,
): { lat: number; lng: number } | null {
  const raw = pts.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (raw.length === 0 || !Number.isFinite(targetKm)) return null
  // drop consecutive near-duplicates so short hops don't distort the cumulative sum
  const pts2 = raw.filter((p, i) => i === 0 || haversineKm(p.lat, p.lng, raw[i - 1].lat, raw[i - 1].lng) > 0.02)
  if (pts2.length === 0) return { lat: raw[0].lat, lng: raw[0].lng }
  const cum: number[] = [0]
  for (let i = 1; i < pts2.length; i++) {
    cum.push(cum[i - 1] + haversineKm(pts2[i - 1].lat, pts2[i - 1].lng, pts2[i].lat, pts2[i].lng))
  }
  const total = cum[cum.length - 1]
  if (total <= 0) return { lat: pts2[0].lat, lng: pts2[0].lng }
  const t = Math.max(0, Math.min(targetKm, total))
  let j = 1
  while (j < cum.length - 1 && cum[j] < t) j++
  const segLen = Math.max(1e-9, cum[j] - cum[j - 1])
  const f = Math.max(0, Math.min(1, (t - cum[j - 1]) / segLen))
  return {
    lat: pts2[j - 1].lat + (pts2[j].lat - pts2[j - 1].lat) * f,
    lng: pts2[j - 1].lng + (pts2[j].lng - pts2[j - 1].lng) * f,
  }
}
