// ============ External maps deep-link tests ============
// googleMapsDirectionsUrl hands a day's ride to Google Maps' URL API for
// turn-by-turn directions. Pinned behaviours: origin/destination from the
// first/last finite points, middle stops as ordered waypoints, the 9-waypoint
// URL cap, driving as the default mode (the URL API has no two-wheeler mode),
// and null when there is no ride to navigate.
import { describe, it, expect } from 'vitest'
import { googleMapsDirectionsUrl } from '../src/lib/externalMaps'

const kolkata = { lat: 22.5726, lng: 88.3639 }
const kolaghat = { lat: 22.3199, lng: 87.8694 }
const mandarmani = { lat: 21.6637, lng: 87.7056 }

function paramsOf(url: string | null): URLSearchParams {
  expect(url).not.toBeNull()
  return new URL(url!).searchParams
}

describe('googleMapsDirectionsUrl', () => {
  it('builds driving directions from origin to destination', () => {
    const p = paramsOf(googleMapsDirectionsUrl([kolkata, mandarmani]))
    expect(p.get('api')).toBe('1')
    expect(p.get('origin')).toBe('22.572600,88.363900')
    expect(p.get('destination')).toBe('21.663700,87.705600')
    expect(p.get('waypoints')).toBeNull()
    expect(p.get('travelmode')).toBe('driving')
  })

  it('keeps middle stops as ordered waypoints', () => {
    const p = paramsOf(googleMapsDirectionsUrl([kolkata, kolaghat, mandarmani]))
    expect(p.get('waypoints')).toBe('22.319900,87.869400')
  })

  it('caps waypoints at Google’s 9-waypoint URL limit, keeping the true destination', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({ lat: 20 + i * 0.1, lng: 86 + i * 0.1 }))
    const p = paramsOf(googleMapsDirectionsUrl(pts))
    expect(p.get('waypoints')!.split('|')).toHaveLength(9)
    expect(p.get('destination')).toBe('21.100000,87.100000') // the 12th point, not a capped one
  })

  it('returns null when there is no ride to navigate', () => {
    expect(googleMapsDirectionsUrl([])).toBeNull()
    expect(googleMapsDirectionsUrl([kolkata])).toBeNull()
    expect(googleMapsDirectionsUrl([kolkata, { lat: NaN, lng: 87 }])).toBeNull() // filters to 1
  })

  it('honours an explicit travel mode', () => {
    const p = paramsOf(googleMapsDirectionsUrl([kolkata, mandarmani], { travelmode: 'bicycling' }))
    expect(p.get('travelmode')).toBe('bicycling')
  })
})
