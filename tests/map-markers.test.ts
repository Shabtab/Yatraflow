// Map markers need real coordinates. Mappls hits arrive as (0,0) pending
// resolution — the panel lists them, but the map must wait until they resolve.
import { describe, it, expect } from 'vitest'
import { mappablePois } from '../src/lib/providers/hits'
import type { PlaceHit } from '../src/lib/providers/hits'

function hit(id: string, lat: number, lng: number): PlaceHit {
  return { id, name: id, latitude: lat, longitude: lng, kind: 'poi' }
}

describe('mappablePois', () => {
  it('keeps hits with real coords', () => {
    expect(mappablePois([hit('a', 10, 76)])).toHaveLength(1)
  })

  it('drops pending (0,0) and non-finite coords', () => {
    const list = [hit('pending', 0, 0), hit('nan', NaN, 76), hit('ok', 10, 76)]
    const out = mappablePois(list)
    expect(out.map(h => h.id)).toEqual(['ok'])
  })
})
