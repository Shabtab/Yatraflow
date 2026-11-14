import { beforeEach, describe, expect, it, vi } from 'vitest'

const { map } = vi.hoisted(() => ({
  map: {
    addSource: vi.fn(), addLayer: vi.fn(),
    getSource: vi.fn(() => ({ setData: vi.fn() })),
    getLayer: vi.fn(() => true), setPaintProperty: vi.fn(),
  },
}))

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useContext: () => ({ map, isLoaded: true }),
  useId: () => 'test-route',
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => unknown) => { effect() },
}))

import { MapRoute } from '../src/components/mapcn/map'

describe('MapRoute source tolerance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the supplied tolerance and width expression to MapLibre', () => {
    const width = ['interpolate', ['linear'], ['zoom'], 7, 8, 12, 46] satisfies import('maplibre-gl').ExpressionSpecification
    MapRoute({ coordinates: [[77, 10], [77.1, 10.1]], width, tolerance: 1.5, interactive: false })
    expect(map.addSource).toHaveBeenCalledWith('route-source-test-route', expect.objectContaining({ type: 'geojson', tolerance: 1.5 }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ paint: expect.objectContaining({ 'line-width': width }) }))
  })

  it('keeps the default tolerance and numeric width for existing callers', () => {
    MapRoute({ coordinates: [[77, 10], [77.1, 10.1]], interactive: false })
    expect(map.addSource.mock.calls[0][1]).not.toHaveProperty('tolerance')
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ paint: expect.objectContaining({ 'line-width': 3 }) }))
  })
})
