// ============ External maps deep links ============
// The in-app map plots a day's ride but doesn't navigate. These helpers hand
// the ride to the traveller's own Google Maps with turn-by-turn directions,
// routed through openExternal() so the native shell (Capacitor) opens the
// installed app instead of a web tab.

/** Google's Maps URL API caps a directions request at origin + destination + 9 waypoints. */
const MAX_WAYPOINTS = 9

export type MapsTravelMode = 'driving' | 'transit' | 'walking' | 'bicycling'

/**
 * Google Maps directions URL through a ride's points (origin → stops →
 * destination). Returns null when fewer than two finite points — nothing to
 * navigate. `travelmode` defaults to driving: the URL API has no two-wheeler
 * mode, and driving is what bike riders use in practice on Indian highways
 * (the app can be switched to two-wheeler once inside Google Maps).
 */
export function googleMapsDirectionsUrl(
  points: { lat: number; lng: number }[],
  opts: { travelmode?: MapsTravelMode } = {},
): string | null {
  const pts = points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (pts.length < 2) return null
  const c = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
  const q = new URLSearchParams()
  q.set('api', '1')
  q.set('origin', c(pts[0]))
  q.set('destination', c(pts[pts.length - 1]))
  const middle = pts.slice(1, -1).slice(0, MAX_WAYPOINTS)
  if (middle.length > 0) q.set('waypoints', middle.map(c).join('|'))
  q.set('travelmode', opts.travelmode ?? 'driving')
  return `https://www.google.com/maps/dir/?${q.toString()}`
}
