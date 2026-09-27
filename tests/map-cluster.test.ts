/**
 * #417 — dense suggestion pins cluster.
 *
 * The grouping geometry is MapLibre's (`clusterRadius` at the current zoom), so
 * there is deliberately no second clustering implementation here to test. What is
 * pinned is the contract the app owns: which pins may be grouped, which must stay
 * individually addressable, what the layer is handed, and the words a
 * pointer-free reader gets for what the badges draw.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  clusterCandidates,
  clusterCountLabel,
  clusterFeatureCollection,
  clusterSummary,
  splitByCluster,
} from '../src/lib/mapCluster'
import type { PlaceHit } from '../src/lib/providers/hits'

function hit(over: Partial<PlaceHit> & { id: string | number }): PlaceHit {
  return { name: `hit ${over.id}`, latitude: 26.9, longitude: 75.8, kind: 'poi', ...over }
}

const tripMap = readFileSync(new URL('../src/components/TripMap.tsx', import.meta.url), 'utf8')
const mapcn = readFileSync(new URL('../src/components/mapcn/map.tsx', import.meta.url), 'utf8')

describe('clusterCandidates', () => {
  it('keeps placeable pins in order and drops the ones the map cannot place', () => {
    const out = clusterCandidates([
      hit({ id: 'a', latitude: 26.9, longitude: 75.8 }),
      hit({ id: 'b', latitude: Number.NaN, longitude: 75.8 }),
      hit({ id: 'c', latitude: 0, longitude: 0 }),
      hit({ id: 'd', latitude: 27.1, longitude: 76.2 }),
      hit({ id: 'e', latitude: 26.9, longitude: Number.POSITIVE_INFINITY }),
    ])
    expect(out.map(c => c.id)).toEqual(['a', 'd'])
    expect(out.every(c => Number.isFinite(c.lat) && Number.isFinite(c.lng))).toBe(true)
    expect(out.map(c => [c.lng, c.lat])).toEqual([[75.8, 26.9], [76.2, 27.1]])
  })

  it('exempts the rail\'s highlighted suggestion, whichever list raised the id', () => {
    const hits = [hit({ id: 12 }), hit({ id: '12b' }), hit({ id: '99' })]
    expect(clusterCandidates(hits, { activeId: 12 }).map(c => c.exempt)).toEqual([true, false, false])
    // the same place, named as a string by the other provider
    expect(clusterCandidates(hits, { activeId: '12' }).map(c => c.exempt)).toEqual([true, false, false])
    expect(clusterCandidates(hits, { activeId: 99 }).map(c => c.exempt)).toEqual([false, false, true])
  })

  it('exempts every hit of the current search', () => {
    const out = clusterCandidates(
      [hit({ id: 'x' }), hit({ id: 7 }), hit({ id: 'z' })],
      { searchIds: new Set<string | number>(['x', 7]) },
    )
    expect(out.map(c => c.exempt)).toEqual([true, true, false])
  })

  it('groups everything when nothing is being worked with', () => {
    expect(clusterCandidates([hit({ id: 1 }), hit({ id: 2 })]).every(c => !c.exempt)).toBe(true)
  })
})

describe('clusterFeatureCollection', () => {
  it('hands the clusterer every eligible pin and nothing else', () => {
    const candidates = clusterCandidates(
      [hit({ id: 'a' }), hit({ id: 'b' }), hit({ id: 'c', latitude: 0, longitude: 0 })],
      { activeId: 'b' },
    )
    const fc = clusterFeatureCollection(candidates)
    expect(fc.type).toBe('FeatureCollection')
    // 'b' is exempt (the user is on it) and 'c' cannot be placed: neither is offered
    expect(fc.features.map(f => f.properties.id)).toEqual(['a'])
    expect(fc.features[0].id).toBe('a')
    expect(fc.features[0].geometry.coordinates).toEqual([75.8, 26.9])
  })

  it('is an empty collection rather than undefined when there is nothing to group', () => {
    const fc = clusterFeatureCollection([])
    expect(fc.features).toEqual([])
  })
})

describe('splitByCluster', () => {
  const candidates = clusterCandidates([
    hit({ id: 'grouped-a' }),
    hit({ id: 'grouped-b' }),
    hit({ id: 'loose' }),
  ])

  it('keeps exactly the reported pins in the pile and every other pin a marker', () => {
    const { clustered, individual } = splitByCluster(candidates, new Set(['grouped-a', 'grouped-b']))
    expect(clustered.map(c => c.id)).toEqual(['grouped-a', 'grouped-b'])
    expect(individual.map(c => c.id)).toEqual(['loose'])
  })

  it('never swallows an exempt pin, even when the map reports it as grouped', () => {
    const withActive = clusterCandidates([hit({ id: 'a' }), hit({ id: 'b' })], { activeId: 'a' })
    const { clustered, individual } = splitByCluster(withActive, new Set(['a', 'b']))
    expect(clustered.map(c => c.id)).toEqual(['b'])
    expect(individual.map(c => c.id)).toEqual(['a'])
  })
})

describe('clusterSummary', () => {
  it('says nothing when nothing is grouped', () => {
    expect(clusterSummary(0)).toBeNull()
    expect(clusterSummary(-3)).toBeNull()
    expect(clusterSummary(Number.NaN)).toBeNull()
    expect(clusterSummary(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('names the count and what to do about it', () => {
    expect(clusterSummary(1)).toBe('1 suggestion grouped into map clusters at this zoom — zoom in to open them one by one.')
    expect(clusterSummary(9)).toContain('9 suggestions')
    expect(clusterSummary(9)).toContain('zoom in')
  })

  it('uses one noun for the badge language and the sentence', () => {
    expect(clusterCountLabel(1)).toBe('1 suggestion')
    expect(clusterCountLabel(4)).toBe('4 suggestions')
    expect(clusterSummary(4)).toContain(clusterCountLabel(4))
  })
})

describe('#417 wiring — the Map tab groups its suggestion pins', () => {
  it('renders the suggestion family through the one cluster implementation', () => {
    expect(tripMap).toContain("from '../lib/mapCluster'")
    expect(tripMap).toMatch(/<MapClusterLayer[\s\S]{0,500}?data=\{clusterData\}/)
    expect(tripMap).toMatch(/<MapClusterLayer[\s\S]{0,500}?onClustersChange=\{onClustersChange\}/)
  })

  it('keeps the GL unclustered circles off, because those pins are DOM markers here', () => {
    expect(tripMap).toMatch(/<MapClusterLayer[\s\S]{0,500}?unclusteredVisible=\{false\}/)
  })

  it('filters only the idea pins by the cluster report — confirmed stops keep their markers', () => {
    const ideaLoop = tripMap.slice(tripMap.indexOf('{visiblePois.map(hit => {'), tripMap.indexOf('</MapLibreMap>'))
    expect(ideaLoop.length, 'the idea-pin loop moved — re-anchor this guard').toBeGreaterThan(0)
    expect(ideaLoop).toContain('individualPinIds')

    const stopLoop = tripMap.slice(
      tripMap.indexOf('return allPoints.map((p, idx) => {'),
      tripMap.indexOf('{dayEndpointMarkers.map'),
    )
    expect(stopLoop.length, 'the confirmed-stop loop moved — re-anchor this guard').toBeGreaterThan(0)
    // the pitfall: a confirmed stop must never become an anonymous count
    expect(stopLoop).not.toContain('individualPinIds')
    expect(stopLoop).toContain('yf-pin-cluster')
  })

  it('says the grouped count in words, since a GL badge has no DOM node', () => {
    expect(tripMap).toContain('clusterNote')
    expect(tripMap).toMatch(/role="status"[\s\S]{0,160}?\{clusterNote\}/)
  })

  it('the map key names the badge', () => {
    const legend = tripMap.slice(tripMap.indexOf('map-legend-body'), tripMap.indexOf('hint-text', tripMap.indexOf('map-legend-body')))
    expect(legend).toMatch(/count badge/i)
  })

  it('keeps the count legible where the badge is not opaque', () => {
    // The circle is painted at 0.85, so the count's real background is the badge
    // composited over the basemap — and over positron's near-white land that is what
    // decides AA for a 12px glyph. The planning teal alone measures 5.19:1 on white
    // but only 3.97:1 once the land shows through, so the palette is chosen for the
    // composited pair rather than for the swatch (measured 2026-09-27).
    const palette = tripMap.match(/IDEA_CLUSTER_COLORS[^=]*=\s*\[([^\]]+)\]/)?.[1] ?? ''
    const colors = [...palette.matchAll(/#[0-9A-Fa-f]{6}/g)].map(m => m[0])
    const clusterSource = mapcn.slice(
      mapcn.indexOf('function MapClusterLayer'),
      mapcn.indexOf('// Update source data'),
    )
    const opacity = Number(clusterSource.match(/"circle-opacity":\s*([\d.]+)/)?.[1] ?? Number.NaN)
    expect(colors.length, 'the cluster palette moved — re-anchor this guard').toBe(3)
    expect(Number.isFinite(opacity), 'the cluster circle opacity moved — re-anchor this guard').toBe(true)

    const srgb = (c: number) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    const luminance = (rgb: number[]) =>
      0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2])
    const rgbOf = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    const land = rgbOf('#F7F7F5') // positron's land — the lightest ground a badge sits on

    for (const color of colors) {
      const composited = rgbOf(color).map((c, i) => opacity * c + (1 - opacity) * land[i])
      const ratio = 1.05 / (luminance(composited) + 0.05)
      expect(
        ratio,
        `${color} puts the white count at ${ratio.toFixed(2)}:1 on a light basemap`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('#417 wiring — MapClusterLayer gains only what the caller needs', () => {
  it('gates the unclustered layer so a caller can draw its own markers instead', () => {
    expect(mapcn).toContain('unclusteredVisible')
    expect(mapcn).toMatch(/if \(unclusteredVisible\) \{\s*map\.addLayer\(\{\s*id: unclusteredLayerId/)
  })

  it('reports membership from the cluster source rather than guessing it from geometry', () => {
    expect(mapcn).toContain('onClustersChange')
    expect(mapcn).toContain('querySourceFeatures(sourceId)')
    expect(mapcn).toContain('getClusterLeaves')
  })

  it('draws the count in a font the basemap actually serves', () => {
    // A count badge with no count is just a circle: MapLibre renders no glyphs for
    // a fontstack the style's glyph endpoint does not have. Measured against the
    // OpenFreeMap glyph endpoint on 2026-09-27 — "Open Sans Semibold" answered
    // 404, "Noto Sans Bold" and "Noto Sans Regular" answered 200.
    const fontStack = mapcn.match(/"text-font":\s*\[([^\]]+)\]/)?.[1] ?? ''
    expect(fontStack, 'the cluster count layer moved — re-anchor this guard').not.toBe('')
    expect(fontStack).toContain('Noto Sans')
    expect(fontStack).not.toContain('Open Sans')
  })
})
