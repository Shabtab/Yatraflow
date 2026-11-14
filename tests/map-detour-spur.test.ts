// ============ The detour spur must never write a map style mid-load ============
// The proved crash (app harness, 2026-11-07): "Style is not done loading" thrown
// by m.addSource in the spur effect, and the uncaught throw unmounted #root.
// TripMap's `mapLoaded` is a camera latch. The 4 s watchdog opens it on a
// stalled style, and no swap closes it. So it cannot gate a style write.
// The spur is now a child of the mapcn provider and reads `isLoaded`, which is
// loaded AND style loaded: it closes for a theme swap and reopens on style.load.
// These tests drive the PRODUCTION apply/teardown helpers. The map double throws
// on any write while its style is not loaded, as MapLibre's _checkLoaded does.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDetourSpur, removeDetourSpur, type SpurMap } from '../src/components/map/DetourSpurOverlay'
import type { PlaceHit } from '../src/lib/providers/hits'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tripMapSrc = readFileSync(join(root, 'src', 'components', 'TripMap.tsx'), 'utf8')
const overlaySrc = readFileSync(join(root, 'src', 'components', 'map', 'DetourSpurOverlay.tsx'), 'utf8')

const INK = '#B47207'
// A flat road at 18°N. A pin at 18.4N/73.5E snaps to 18N/73.5E.
const ROUTE: [number, number][] = [[73, 18], [74, 18]]

function hitAt(id: string, latitude: number, longitude: number): PlaceHit {
  return { id, name: `Hit ${id}`, latitude, longitude, kind: 'poi' }
}

const PIN_A = hitAt('a', 18.4, 73.5)
const PIN_B = hitAt('b', 18.6, 73.2)

type SpurSource = { data?: unknown; setData?: (d: unknown) => void }

/** A map whose style gate is explicit, and whose writes fail while it is shut. */
function strictStyleMap() {
  const log: string[] = []
  const sources = new Map<string, SpurSource>()
  const layerSpecs = new Map<string, Record<string, unknown>>()
  let styleReady = false

  // MapLibre's Style._checkLoaded throws on every style mutation. The double
  // does the same, so a premature write fails this test instead of passing.
  const checkLoaded = () => {
    if (!styleReady) throw new Error('Style is not done loading.')
  }

  const map: SpurMap = {
    getSource: id => sources.get(id),
    addSource: (id, spec) => {
      checkLoaded()
      const data = (spec as { data?: unknown }).data
      sources.set(id, { data, setData(next) { this.data = next } })
      log.push(`addSource:${id}`)
    },
    addLayer: layer => {
      checkLoaded()
      const spec = layer as Record<string, unknown> & { id: string }
      layerSpecs.set(spec.id, spec)
      log.push(`addLayer:${spec.id}`)
    },
    getLayer: id => layerSpecs.get(id),
    removeLayer: id => { checkLoaded(); layerSpecs.delete(id); log.push(`removeLayer:${id}`) },
    removeSource: id => { checkLoaded(); sources.delete(id); log.push(`removeSource:${id}`) },
  }

  return {
    map,
    log,
    layerSpecs,
    /** The initial style and every style.load settle here. */
    styleLoaded() { styleReady = true },
    /** setStyle({diff:false}): the gate shuts and the new style starts empty. */
    reload() { styleReady = false; sources.clear(); layerSpecs.clear() },
    defaultData: () => sources.get('yf-spur-src')?.data,
  }
}

describe('applyDetourSpur — a style write happens only on a ready style', () => {
  it('the stalled-style case (camera watchdog open, style shut) writes nothing', () => {
    const style = strictStyleMap()
    // The old gate read TripMap's `mapLoaded`, which the 4 s watchdog opens on
    // a stalled style. The spur now receives the provider readiness instead.
    expect(() => applyDetourSpur(style.map, {
      ready: false, activeHitId: 'a', nearbyPois: [PIN_A], route: ROUTE, ink: INK,
    })).not.toThrow()
    expect(style.log).toEqual([])
    expect(style.defaultData()).toBeUndefined()
  })

  it('a ready style gets the source, the layer and the current geometry', () => {
    const style = strictStyleMap()
    style.styleLoaded()
    applyDetourSpur(style.map, { ready: true, activeHitId: 'a', nearbyPois: [PIN_A], route: ROUTE, ink: INK })

    expect(style.log).toEqual(['addSource:yf-spur-src', 'addLayer:yf-spur'])
    const layer = style.layerSpecs.get('yf-spur')!
    expect(layer.type).toBe('line')
    expect(layer.source).toBe('yf-spur-src')
    // The approved paint is unchanged: the --warn ink, 2 px, dashed, round cap.
    expect(layer.paint).toEqual({ 'line-color': INK, 'line-width': 2, 'line-dasharray': [2, 2] })
    expect(layer.layout).toEqual({ 'line-cap': 'round' })

    const features = (style.defaultData() as { features: { geometry: { coordinates: [number, number][] } }[] }).features
    expect(features).toHaveLength(1)
    const [[ax, ay], [px, py]] = features[0].geometry.coordinates
    // The card's own segment projection decides the anchor (#158).
    expect(ax).toBeCloseTo(73.5, 6)
    expect(ay).toBeCloseTo(18, 6)
    expect(px).toBeCloseTo(PIN_A.longitude, 6)
    expect(py).toBeCloseTo(PIN_A.latitude, 6)
  })

  it('re-applying the same props duplicates nothing', () => {
    const style = strictStyleMap()
    style.styleLoaded()
    const options = { ready: true, activeHitId: 'a', nearbyPois: [PIN_A], route: ROUTE, ink: INK }
    applyDetourSpur(style.map, options)
    const logAfterFirst = [...style.log]
    applyDetourSpur(style.map, options)
    expect(style.log).toEqual(logAfterFirst)
  })

  it('a reload with changed ideas writes nothing, and the next ready render applies the latest', () => {
    // This is the window a monotonic style epoch leaves open: the counter keeps
    // its old value while the new style loads, so a data change still runs.
    const style = strictStyleMap()
    style.styleLoaded()
    applyDetourSpur(style.map, { ready: true, activeHitId: 'a', nearbyPois: [PIN_A], route: ROUTE, ink: INK })
    expect(style.log).toHaveLength(2)

    style.reload()
    expect(() => applyDetourSpur(style.map, {
      ready: false, activeHitId: 'b', nearbyPois: [PIN_B], route: ROUTE, ink: INK,
    })).not.toThrow()
    expect(() => applyDetourSpur(style.map, {
      ready: false, activeHitId: 'a', nearbyPois: [PIN_A], route: ROUTE, ink: INK,
    })).not.toThrow()
    expect(style.log).toHaveLength(2)
    expect(style.defaultData()).toBeUndefined()

    // style.load: the provider reopens and the effect re-runs with the latest props.
    style.styleLoaded()
    applyDetourSpur(style.map, { ready: true, activeHitId: 'b', nearbyPois: [PIN_B], route: ROUTE, ink: INK })
    const features = (style.defaultData() as { features: { geometry: { coordinates: [number, number][] } }[] }).features
    expect(features).toHaveLength(1)
    const [, [px, py]] = features[0].geometry.coordinates
    expect(px).toBeCloseTo(PIN_B.longitude, 6)
    expect(py).toBeCloseTo(PIN_B.latitude, 6)
  })

  it('an active hit without coordinates keeps the source and draws no feature', () => {
    const style = strictStyleMap()
    style.styleLoaded()
    applyDetourSpur(style.map, {
      ready: true, activeHitId: 'p', nearbyPois: [hitAt('p', 0, 0)], route: ROUTE, ink: INK,
    })
    const features = (style.defaultData() as { features: unknown[] }).features
    expect(features).toEqual([])
  })
})

describe('removeDetourSpur — teardown owns only its layer and source', () => {
  it('removes the layer then the source, once, and a second call is a no-op', () => {
    const style = strictStyleMap()
    style.styleLoaded()
    applyDetourSpur(style.map, { ready: true, activeHitId: 'a', nearbyPois: [PIN_A], route: ROUTE, ink: INK })
    style.log.length = 0

    removeDetourSpur(style.map)
    expect(style.log).toEqual(['removeLayer:yf-spur', 'removeSource:yf-spur-src'])
    expect(style.layerSpecs.size).toBe(0)

    removeDetourSpur(style.map)
    expect(style.log).toHaveLength(2)
  })

  it('a teardown after a style swap is guarded, not a throw', () => {
    const style = strictStyleMap()
    style.styleLoaded()
    applyDetourSpur(style.map, { ready: true, activeHitId: 'a', nearbyPois: [PIN_A], route: ROUTE, ink: INK })
    style.reload()
    style.log.length = 0

    expect(() => removeDetourSpur(style.map)).not.toThrow()
    expect(style.log).toEqual([])
  })
})

describe('the spur is a map child, not a latch-gated effect', () => {
  it('the unsafe write is gone from TripMap and the overlay renders inside <MapLibreMap>', () => {
    expect(tripMapSrc).not.toContain("'yf-spur-src'")
    const open = tripMapSrc.indexOf('<MapLibreMap')
    const close = tripMapSrc.indexOf('</MapLibreMap>')
    expect(open, 'the map element moved').toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(open)
    const mapChildren = tripMapSrc.slice(open, close)
    expect(mapChildren).toContain('<DetourSpurOverlay')
    // The paint token still comes from TripMap's theme-scoped --warn read.
    expect(mapChildren).toMatch(/<DetourSpurOverlay[^>]*ink=\{warnInk\}/)
  })

  it('the overlay takes its readiness from the provider, never from mapLoaded', () => {
    expect(overlaySrc).toContain('const { map, isLoaded } = useMap()')
    expect(overlaySrc).toContain('ready: isLoaded')
    // The retry rides the dep list: a readiness edge re-runs the effect with the
    // latest props. Without isLoaded here a guard would never re-apply.
    expect(overlaySrc).toContain('}, [map, isLoaded, activeHitId, nearbyPois, route, ink])')
    // Code only: the header comment names mapLoaded to warn the next reader off
    // it. No line of code may read the camera latch.
    const code = overlaySrc.split(/\r?\n/)
      .filter(line => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(code).not.toContain('mapLoaded')
  })

  it('the camera latch and its fit stay exactly as they were', () => {
    // The latch opens on the instance alone; only the style write moved.
    expect(tripMapSrc).toContain('if (!mapLoaded || !mapRef.current) return')
    expect(tripMapSrc).toMatch(/if \(mapRef\.current\) \{ setMapLoaded\(true\); clearInterval\(tick\) \}/)
  })
})
