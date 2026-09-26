import { describe, expect, it } from 'vitest'
import {
  applyViewModeOnMap,
  HERO_3D_CAMERA,
  HILLSHADE_LAYER,
  MAP_VIEW_MODES,
  MAP_VIEW_MODE_META,
  TERRARIUM_DEM_SOURCE,
  YF_DEM_SOURCE_ID,
  YF_HILLSHADE_LAYER_ID,
  heroBearingForRoute,
  heroCameraMove,
  isWaterishLayerId,
  parseMapViewMode,
  resolveHillshadeBeforeId,
  type MapLike,
} from '../src/lib/mapViewModes'

describe('parseMapViewMode', () => {
  it('accepts exactly the three mode strings', () => {
    expect(parseMapViewMode('2d')).toBe('2d')
    expect(parseMapViewMode('terrain')).toBe('terrain')
    expect(parseMapViewMode('3d')).toBe('3d')
  })

  it('degrades missing, empty, and corrupt values to 2d', () => {
    expect(parseMapViewMode(null)).toBe('2d')
    expect(parseMapViewMode(undefined)).toBe('2d')
    expect(parseMapViewMode('')).toBe('2d')
    expect(parseMapViewMode('flat')).toBe('2d')
    expect(parseMapViewMode('Terrain')).toBe('2d')
    expect(parseMapViewMode('3D')).toBe('2d')
    expect(parseMapViewMode('{"mode":"3d"}')).toBe('2d')
  })
})

describe('resolveHillshadeBeforeId', () => {
  it('Liberty order: picks the first waterway line ABOVE water, not water itself', () => {
    // Liberty's real shape (verified 2026-09-12): waterway_* at idx 14–16,
    // water at idx 17. Matching `water` alone would insert the hillshade
    // under the river lines and bury them.
    const libertyLike = [
      { id: 'background' },
      { id: 'landcover' },
      { id: 'waterway-tunnel' },
      { id: 'waterway-line-casing' },
      { id: 'waterway-line' },
      { id: 'water' },
      { id: 'water-shadow' },
      { id: 'building' },
    ]
    expect(resolveHillshadeBeforeId(libertyLike)).toBe('waterway-tunnel')
  })

  it('positron order: picks water, which comes before waterway there', () => {
    const positronLike = [
      { id: 'background' },
      { id: 'water' },
      { id: 'landcover' },
      { id: 'waterway' },
    ]
    expect(resolveHillshadeBeforeId(positronLike)).toBe('water')
  })

  it('a style with no water layer yields null (caller must not insert)', () => {
    expect(resolveHillshadeBeforeId([{ id: 'background' }, { id: 'road' }])).toBeNull()
    expect(resolveHillshadeBeforeId(undefined)).toBeNull()
    expect(resolveHillshadeBeforeId([])).toBeNull()
  })

  it('skips id-less layer entries instead of throwing', () => {
    expect(resolveHillshadeBeforeId([{}, { id: 'water' }])).toBe('water')
  })
})

describe('isWaterishLayerId', () => {
  it('matches water and every waterway variant, nothing else that merely starts with water', () => {
    expect(isWaterishLayerId('water')).toBe(true)
    expect(isWaterishLayerId('waterway')).toBe(true)
    expect(isWaterishLayerId('waterway-tunnel')).toBe(true)
    expect(isWaterishLayerId('water-shadow')).toBe(false)
    expect(isWaterishLayerId('watermark')).toBe(false)
  })
})

describe('mode catalogue', () => {
  it('has exactly the three first-class modes, none an "off" state', () => {
    expect(MAP_VIEW_MODES).toEqual(['2d', 'terrain', '3d'])
  })

  it('every mode carries a short label and a long aria label', () => {
    for (const mode of MAP_VIEW_MODES) {
      expect(MAP_VIEW_MODE_META[mode].label.length).toBeGreaterThan(0)
      expect(MAP_VIEW_MODE_META[mode].aria.length).toBeGreaterThan(0)
    }
    expect(MAP_VIEW_MODE_META.terrain.label).toBe('Terrain')
    expect(MAP_VIEW_MODE_META['3d'].aria).toBe('3D terrain')
  })
})

describe('terrain specs', () => {
  it('DEM source is the keyless terrarium endpoint with its own credit', () => {
    expect(TERRARIUM_DEM_SOURCE.type).toBe('raster-dem')
    expect(TERRARIUM_DEM_SOURCE.encoding).toBe('terrarium')
    expect(TERRARIUM_DEM_SOURCE.tileSize).toBe(256)
    expect(TERRARIUM_DEM_SOURCE.maxzoom).toBe(14)
    expect(TERRARIUM_DEM_SOURCE.tiles[0]).toContain('s3.amazonaws.com/elevation-tiles-prod/terrarium')
    expect(TERRARIUM_DEM_SOURCE.tiles[0]).not.toMatch(/[?&]key=/)
    expect(TERRARIUM_DEM_SOURCE.attribution).toContain('AWS Terrain Tiles')
  })

  it('hillshade paints from the same DEM source with the prototype values', () => {
    expect(HILLSHADE_LAYER.id).toBe(YF_HILLSHADE_LAYER_ID)
    expect(HILLSHADE_LAYER.source).toBe(YF_DEM_SOURCE_ID)
    expect(HILLSHADE_LAYER.paint['hillshade-exaggeration']).toBe(0.6)
    expect(HILLSHADE_LAYER.paint['hillshade-shadow-color']).toBe('#3E5560')
    expect(HILLSHADE_LAYER.paint['hillshade-accent-color']).toBe('#3D6B70')
  })
})

describe('applyViewModeOnMap (fake-map transitions)', () => {
  // Liberty's real layer order: waterway lines ABOVE water.
  const libertyLayers = [
    { id: 'background' }, { id: 'landcover' },
    { id: 'waterway-tunnel' }, { id: 'waterway-line-casing' }, { id: 'waterway-line' },
    { id: 'water' }, { id: 'building' }, { id: 'place-labels' },
  ]

  function fakeMap(layers: { id?: string }[] = [...libertyLayers]) {
    const log: string[] = []
    const sources = new Map<string, unknown>()
    const layerIds = new Set(layers.map(l => l.id))
    const map: MapLike = {
      getStyle: () => ({ layers }),
      getSource: id => sources.get(id) ?? null,
      addSource: (id, spec) => { sources.set(id, spec); log.push(`addSource:${id}`) },
      removeSource: id => { sources.delete(id); log.push(`removeSource:${id}`) },
      getLayer: id => (layerIds.has(id) ? {} : null),
      addLayer: (layer, beforeId) => {
        const l = layer as { id: string }
        const at = beforeId ? layers.findIndex(x => x.id === beforeId) : layers.length
        if (beforeId && at === -1) throw new Error(`beforeId ${beforeId} does not exist`)
        layers.splice(at === -1 ? layers.length : at, 0, { id: l.id })
        layerIds.add(l.id)
        log.push(`addLayer:${l.id}${beforeId ? ` before ${beforeId}` : ''}`)
      },
      removeLayer: id => { layerIds.delete(id); log.push(`removeLayer:${id}`) },
      getTerrain: () => terrain,
      setTerrain: t => { terrain = t; log.push(`setTerrain:${t === null ? 'null' : 'on'}`) },
    }
    let terrain: unknown = null
    return { map, log, sources, layerIds }
  }

  it('2d → terrain adds the DEM and shades above land but below waterways', () => {
    const { map, log } = fakeMap()
    applyViewModeOnMap(map, 'terrain')
    expect(log).toEqual([
      `addSource:${YF_DEM_SOURCE_ID}`,
      `addLayer:${YF_HILLSHADE_LAYER_ID} before waterway-tunnel`,
    ])
    expect(map.getTerrain()).toBeFalsy()
  })

  it('terrain → 3d drops the shading and raises real terrain', () => {
    const { map, log } = fakeMap()
    applyViewModeOnMap(map, 'terrain')
    log.length = 0
    applyViewModeOnMap(map, '3d')
    expect(log).toEqual([`removeLayer:${YF_HILLSHADE_LAYER_ID}`, 'setTerrain:on'])
    expect(map.getTerrain()).toEqual({ source: YF_DEM_SOURCE_ID, exaggeration: 1.8 })
  })

  it('3d → 2d leaves nothing behind — no terrain, no layer, no source (credit gone)', () => {
    const { map } = fakeMap()
    applyViewModeOnMap(map, '3d')
    applyViewModeOnMap(map, '2d')
    expect(map.getTerrain()).toBeFalsy()
    expect(map.getLayer(YF_HILLSHADE_LAYER_ID)).toBeFalsy()
    expect(map.getSource(YF_DEM_SOURCE_ID)).toBeFalsy()
  })

  it('is idempotent: re-applying the same mode duplicates nothing', () => {
    const { map, log } = fakeMap()
    applyViewModeOnMap(map, 'terrain')
    log.length = 0
    applyViewModeOnMap(map, 'terrain')
    expect(log).toEqual([])
  })

  it('re-applies cleanly after a theme style swap wipes the whole terrain stack', () => {
    const before = fakeMap()
    applyViewModeOnMap(before.map, '3d')
    // setStyle(full reload): sources, layers and terrain are all gone.
    const fresh = fakeMap()
    applyViewModeOnMap(fresh.map, '3d')
    expect(fresh.log).toEqual([
      `addSource:${YF_DEM_SOURCE_ID}`,
      'setTerrain:on',
    ])
  })

  it('2d touches nothing on a map that never had terrain (no stray requests)', () => {
    const { map, log } = fakeMap()
    applyViewModeOnMap(map, '2d')
    expect(log).toEqual([])
  })
})

describe('heroBearingForRoute — the dynamic 3D hero camera', () => {
  it('frames the road the driver will see: a west→east route looks east (~90°)', () => {
    const bearing = heroBearingForRoute([
      { lat: 20, lng: 72 },
      { lat: 20.01, lng: 72.3 },
      { lat: 20.02, lng: 72.6 },
    ])
    expect(bearing).not.toBeNull()
    expect(bearing!).toBeGreaterThan(75)
    expect(bearing!).toBeLessThan(105)
  })

  it('a south→north route looks north (~0°)', () => {
    const bearing = heroBearingForRoute([
      { lat: 20, lng: 72 },
      { lat: 20.4, lng: 72.001 },
      { lat: 20.8, lng: 72.002 },
    ])
    expect(bearing!).toBeLessThan(15)
  })

  it('skips coordinate jitter and uses the first meaningful segment', () => {
    const bearing = heroBearingForRoute([
      { lat: 20, lng: 72 },
      { lat: 20.00001, lng: 72.00001 }, // jitter — skipped
      { lat: 20.4, lng: 72.001 },
    ])
    expect(bearing!).toBeLessThan(15)
  })

  it('no usable geometry → null (caller keeps the prototype fallback)', () => {
    expect(heroBearingForRoute(undefined)).toBeNull()
    expect(heroBearingForRoute([{ lat: 20, lng: 72 }])).toBeNull()
    expect(heroBearingForRoute([{ lat: 20, lng: 72 }, { lat: 20.00001, lng: 72.00001 }])).toBeNull()
  })
})

describe('heroCameraMove (#332 R1)', () => {
  it('2d → 3d enters with the road\'s own bearing', () => {
    expect(heroCameraMove('3d', '2d', 42, null)).toEqual({ move: 'enter', bearing: 42 })
  })

  it('terrain → 3d is an entry too, not a flatten', () => {
    expect(heroCameraMove('3d', 'terrain', 90, null)).toEqual({ move: 'enter', bearing: 90 })
  })

  it('a bearing that arrives AFTER 3d opened re-aims the camera', () => {
    // The bug this rule exists for: OSRM resolved late, the fallback bearing had
    // already been eased, and the edge trigger alone left the camera stuck on it.
    const geometryLess = heroCameraMove('3d', '3d', null, null)
    expect(geometryLess.move).toBe('re-aim')
    expect(geometryLess.bearing).toBe(HERO_3D_CAMERA.bearing)
    expect(heroCameraMove('3d', '3d', 42, HERO_3D_CAMERA.bearing)).toEqual({ move: 're-aim', bearing: 42 })
  })

  it('an unchanged bearing is a no-op — this is what stops the camera grinding', () => {
    expect(heroCameraMove('3d', '3d', 42, 42).move).toBe('none')
    expect(heroCameraMove('2d', '2d', null, null).move).toBe('none')
    expect(heroCameraMove('terrain', 'terrain', 42, 42).move).toBe('none')
  })

  it('leaving 3d flattens, from any other mode', () => {
    expect(heroCameraMove('2d', '3d', 42, 42).move).toBe('flatten')
    expect(heroCameraMove('terrain', '3d', 42, 42).move).toBe('flatten')
  })

  it('a geometry-less trip keeps the prototype fallback, then re-aims off it', () => {
    const entered = heroCameraMove('3d', '2d', null, null)
    expect(entered.bearing).toBe(HERO_3D_CAMERA.bearing)
    expect(heroCameraMove('3d', '3d', 187, entered.bearing)).toEqual({ move: 're-aim', bearing: 187 })
  })

  it('re-aim reports the bearing only — the caller must not re-pitch', () => {
    // Pinned as a contract: `re-aim` exists so a late resolve does not pitch the
    // camera out from under someone already looking at the 3d view. The move name
    // is the whole signal; there is no "re-aim with pitch" state.
    expect(heroCameraMove('3d', '3d', 12, 300).move).toBe('re-aim')
  })
})
