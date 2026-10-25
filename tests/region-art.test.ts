import { describe, expect, it } from 'vitest'
import {
  ART_MANIFEST,
  type ArtManifest,
  type ArtRegion,
  artIdFor,
  artEntryFor,
  coverFor,
  fallbackKindFor,
  focalYFor,
  hashSeed,
  vignetteArtFor,
} from '../src/lib/regionArt'
import { srcsetFor } from '../src/lib/artUrls'
import { regionFor } from '../src/lib/tripsPage'

const REGIONS: ArtRegion[] = ['kerala', 'goa', 'rajasthan', 'coorg', 'meghalaya', 'kashmir', 'generic']

/** A manifest with three ids in one region, to test distribution. */
function threeVariantManifest(): ArtManifest {
  return {
    ...ART_MANIFEST,
    regions: { ...ART_MANIFEST.regions, kerala: ['v-a', 'v-b', 'v-c'] },
  }
}

describe('hashSeed', () => {
  it('matches the FNV-1a 32-bit reference values', () => {
    expect(hashSeed('')).toBe(0x811c9dc5)
    expect(hashSeed('a')).toBe(0xe40c292c)
  })

  it('returns an unsigned 32-bit integer', () => {
    for (const seed of ['trip-1', 'Munnar, Kerala', 'pub-9f2']) {
      const value = hashSeed(seed)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('artIdFor', () => {
  it('returns the same id for the same seed, 1000 times', () => {
    const first = artIdFor('kerala', 'trip-stable-seed', threeVariantManifest())
    for (let index = 0; index < 1000; index += 1) {
      expect(artIdFor('kerala', 'trip-stable-seed', threeVariantManifest())).toBe(first)
    }
  })

  it('spreads picks across the variants of a region', () => {
    const manifest = threeVariantManifest()
    const counts: Record<string, number> = { 'v-a': 0, 'v-b': 0, 'v-c': 0 }
    const total = 3000
    for (let index = 0; index < total; index += 1) {
      const id = artIdFor('kerala', `trip-${index}`, manifest)
      if (id) counts[id] += 1
    }
    for (const count of Object.values(counts)) {
      expect(count / total).toBeGreaterThanOrEqual(0.25)
      expect(count / total).toBeLessThanOrEqual(0.42)
    }
  })

  it('always returns the only id of a region that has one id', () => {
    const onlyIds: Partial<Record<ArtRegion, string>> = { kerala: 'kerala-1' }
    for (const [region, expectedId] of Object.entries(onlyIds)) {
      for (let index = 0; index < 200; index += 1) {
        expect(artIdFor(region as ArtRegion, `seed-${index}`)).toBe(expectedId)
      }
    }
  })

  it('returns the generic scene for a region whose only scene is the generic one', () => {
    // Batch 2 gave "generic" a scene of its own. It is one id, so every seed
    // picks it, and a place tile can now paint an honest scene instead of
    // keeping its motif.
    for (const seed of ['any-seed', 'Palolem', 'Rishikesh', '']) {
      expect(artIdFor('generic', seed)).toBe('generic-1')
    }
  })

  it('picks a seeded scene in each region that now has two', () => {
    // Batch 1 filled goa, coorg and meghalaya and added a second scene to
    // rajasthan and kashmir. Every pick must still be a declared id of that
    // region, and a region with two scenes must reach both across seeds.
    const paired: Array<[ArtRegion, string, string]> = [
      ['goa', 'goa-1', 'goa-2'],
      ['coorg', 'coorg-1', 'coorg-2'],
      ['meghalaya', 'meghalaya-1', 'meghalaya-2'],
      ['rajasthan', 'rajasthan-1', 'rajasthan-2'],
      ['kashmir', 'himalaya-1', 'himalaya-2'],
    ]
    for (const [region, first, second] of paired) {
      const seen = new Set<string>()
      for (let index = 0; index < 200; index += 1) {
        const id = artIdFor(region, `seed-${index}`)
        expect([first, second], `${region} seed-${index}`).toContain(id)
        if (id) seen.add(id)
      }
      expect([...seen].sort(), region).toEqual([first, second])
    }
  })
})

describe('fallbackKindFor', () => {
  it('uses road art for two or more places and city art for one', () => {
    expect(fallbackKindFor(0)).toBe('city')
    expect(fallbackKindFor(1)).toBe('city')
    expect(fallbackKindFor(2)).toBe('road')
    expect(fallbackKindFor(5)).toBe('road')
  })
})

describe('coverFor', () => {
  it('prefers the user cover over every generated image', () => {
    expect(coverFor({ userCover: 'https://example.com/cover.jpg', region: 'kerala', seed: 's', placeCount: 1 })).toEqual({
      kind: 'user',
      url: 'https://example.com/cover.jpg',
    })
  })

  it('ignores a blank user cover', () => {
    expect(coverFor({ userCover: '   ', region: 'kerala', seed: 's', placeCount: 1 })).toEqual({ kind: 'generated', id: 'kerala-1' })
    expect(coverFor({ userCover: null, region: 'rajasthan', seed: 's', placeCount: 1 })).toEqual({ kind: 'generated', id: 'rajasthan-1' })
  })

  it('uses the region variant before the fallback', () => {
    expect(coverFor({ region: 'kashmir', seed: 'trip-1', placeCount: 3 })).toEqual({ kind: 'generated', id: 'himalaya-1' })
  })

  it('uses the generic scene for a destination no region matches, whatever the place count', () => {
    // Batch 2 gave "generic" a scene, so an unmatched destination no longer
    // borrows the road or city family. Both place counts reach the same id:
    // the generic scene does not depend on how many places the trip has.
    expect(coverFor({ region: 'generic', seed: 'trip-1', placeCount: 2 })).toEqual({ kind: 'generated', id: 'generic-1' })
    expect(coverFor({ region: 'generic', seed: 'trip-1', placeCount: 1 })).toEqual({ kind: 'generated', id: 'generic-1' })
  })

  it('still reaches the road and city family when a region list is empty', () => {
    // No shipped region is empty any more, so the fallback step is proved
    // against a manifest that empties one. The order matters: the region step
    // is tried first, and only then the family for the place count.
    const noRegionScene: ArtManifest = {
      ...ART_MANIFEST,
      regions: { ...ART_MANIFEST.regions, generic: [] },
    }
    expect(coverFor({ region: 'generic', seed: 'trip-1', placeCount: 2 }, noRegionScene)).toEqual({ kind: 'generated', id: 'road-1' })
    expect(coverFor({ region: 'generic', seed: 'trip-1', placeCount: 1 }, noRegionScene)).toEqual({ kind: 'generated', id: 'city-1' })
  })

  it('returns null when no image exists at any step, which means the SVG floor', () => {
    const empty: ArtManifest = {
      ...ART_MANIFEST,
      regions: Object.fromEntries(REGIONS.map(region => [region, []])) as ArtManifest['regions'],
      fallbacks: { road: [], city: [] },
    }
    for (const region of REGIONS) {
      expect(coverFor({ region, seed: 'x', placeCount: 2 }, empty)).toBeNull()
    }
  })
})

describe('vignetteArtFor', () => {
  it('resolves every declared page state to its square master', () => {
    expect(vignetteArtFor('first-trip')).toBe('es-first-trip')
    expect(vignetteArtFor('no-saved')).toBe('es-no-saved')
    expect(vignetteArtFor('no-results')).toBe('es-no-results')
    expect(vignetteArtFor('no-purchases')).toBe('es-no-purchases')
    expect(vignetteArtFor('no-published')).toBe('es-no-published')
    expect(vignetteArtFor('offline')).toBe('es-offline')
    expect(vignetteArtFor('error')).toBe('es-error')
  })

  it('returns null for a state with no image, which keeps the block icon', () => {
    expect(vignetteArtFor('no-such-state')).toBeNull()
  })

  it('never hands a state vignette to a cover, because the masters are square', () => {
    // A vignette id is not in any region or fallback list, so coverFor cannot
    // reach one and no 1:1 master is ever cropped to a 16:10 cover.
    const inCovers = [
      ...Object.values(ART_MANIFEST.regions).flat(),
      ...Object.values(ART_MANIFEST.fallbacks).flat(),
    ]
    for (const id of Object.values(ART_MANIFEST.vignettes)) {
      expect(inCovers).not.toContain(id)
    }
  })
})

describe('honest region matching for place tiles', () => {
  it('gives a place no region names the generic scene, and never another region scene', () => {
    // A tile shows its own region's scene, or the generic scene, and nothing
    // else. "Rishikesh" matches no keyword, so regionFor gives "generic" and the
    // tile paints generic-1. It must not fall through to the Himalaya scene,
    // which would claim the place is in Kashmir. The generic scene is
    // geographically neutral by design, so it identifies no region.
    for (const place of ['Rishikesh', 'Hampi', 'Ziro Valley']) {
      const region = regionFor({ destinations: [place] })
      expect(region, place).toBe('generic')
      expect(artIdFor(region, place), place).toBe('generic-1')
    }
  })

  it('still gives a named place its own region scene', () => {
    expect(artIdFor(regionFor({ destinations: ['Srinagar'] }), 'Srinagar')).toBe('himalaya-1')
    expect(artIdFor(regionFor({ destinations: ['Munnar'] }), 'Munnar')).toBe('kerala-1')
  })

  it('gives a place in a newly filled region that region scene, not the generic one', () => {
    expect(regionFor({ destinations: ['Shillong'] })).toBe('meghalaya')
    expect(['meghalaya-1', 'meghalaya-2']).toContain(artIdFor('meghalaya', 'Shillong'))
    expect(regionFor({ destinations: ['Madikeri'] })).toBe('coorg')
    expect(['coorg-1', 'coorg-2']).toContain(artIdFor('coorg', 'Madikeri'))
    expect(regionFor({ destinations: ['Panjim, Goa'] })).toBe('goa')
    expect(['goa-1', 'goa-2']).toContain(artIdFor('goa', 'Panjim, Goa'))
    // A town the keyword list does not name is still "generic", and it now
    // paints the generic scene. The new scenes must not widen what counts as a
    // region match: Palolem stays generic rather than becoming Goa.
    expect(regionFor({ destinations: ['Palolem'] })).toBe('generic')
    expect(artIdFor('generic', 'Palolem')).toBe('generic-1')
  })
})

describe('focalYFor', () => {
  it('returns the focal point for a named ratio and the default for others', () => {
    expect(focalYFor('kerala-1', '21:9')).toBe(40)
    expect(focalYFor('kerala-1', '3:1')).toBe(60)
    expect(focalYFor('kerala-1', '3.5:1')).toBe(55)
    expect(focalYFor('kerala-1', '3:2')).toBe(50)
  })

  it('returns 50 for an unknown id', () => {
    expect(focalYFor('no-such-id', '3:1')).toBe(50)
  })

  it('keeps the per-asset 3:1 focal point for himalaya-2 and leaves its neighbours alone', () => {
    // himalaya-2 puts its peaks high in the frame, so a 3:1 crop centred at 60
    // cuts them. It carries its own 3:1 value; every other wide scene keeps the
    // shared one. This is a manifest value, not a code branch.
    expect(focalYFor('himalaya-2', '3:1')).toBe(40)
    expect(focalYFor('himalaya-2', '21:9')).toBe(40)
    expect(focalYFor('himalaya-1', '3:1')).toBe(60)
    expect(focalYFor('goa-2', '3:1')).toBe(60)
  })

  it('gives generic-1 the family focal point, with no per-asset exception', () => {
    // The generic scene is a wide landscape like every other scene, so it takes
    // the shared values. A per-asset exception here would need its own reason.
    expect(ART_MANIFEST.ids['generic-1'].ratio).toBe('3:2')
    expect(ART_MANIFEST.ids['generic-1'].focalY).toEqual(ART_MANIFEST.ids['road-1'].focalY)
    for (const ratio of ['default', '21:9', '3:1', '3.5:1']) {
      expect(focalYFor('generic-1', ratio), ratio).toBe(focalYFor('road-1', ratio))
    }
  })

  it('finds no entry for a name it does not declare, including inherited Object names', () => {
    // `ids` is a plain object, so an unguarded read of ids['constructor'] returns
    // Object's own constructor: truthy, and with no widths or focalY. The lookup
    // must answer "no entry" for every name the manifest does not declare, or the
    // picture would build a srcset from undefined and throw.
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'no-such-id']) {
      expect(artEntryFor(name), name).toBeUndefined()
      expect(focalYFor(name, '3:1'), name).toBe(50)
    }
    expect(artEntryFor('generic-1')?.ratio).toBe('3:2')
  })

  it('applies the same guard to a caller-supplied manifest', () => {
    // coverFor and the tests pass their own manifests, so the guard cannot live
    // only in the default-map path.
    const custom: ArtManifest = { ...ART_MANIFEST, ids: { only: ART_MANIFEST.ids['generic-1'] } }
    expect(artEntryFor('only', custom)?.ratio).toBe('3:2')
    expect(artEntryFor('constructor', custom)).toBeUndefined()
    expect(focalYFor('constructor', '3:1', custom)).toBe(50)
  })

  it('resolves every declared id, so no slot loses its picture to the guard', () => {
    // The guard must reject only names the manifest does not declare. If the map
    // were built from the wrong source, every slot would silently fall to the
    // motif — a whole-page visual regression that no other test would catch.
    const declared = Object.keys(ART_MANIFEST.ids)
    expect(declared.length).toBe(22)
    for (const id of declared) {
      const entry = artEntryFor(id)
      expect(entry, id).toBeDefined()
      expect(entry?.widths.length, id).toBeGreaterThan(0)
      expect(srcsetFor(id, entry?.widths ?? []), id).not.toBe('')
    }
  })
})

describe('srcsetFor', () => {
  it('lists the AVIF widths of an id in order', () => {
    const srcset = srcsetFor('kerala-1', [320, 640, 960])
    const entries = srcset.split(', ')
    expect(entries).toHaveLength(3)
    entries.forEach((entry, index) => {
      expect(entry).toMatch(/\.avif \d+w$/)
      expect(entry.endsWith(` ${[320, 640, 960][index]}w`)).toBe(true)
    })
  })

  it('skips widths that have no file', () => {
    expect(srcsetFor('kerala-1', [320, 1280])).not.toContain('1280w')
  })

  it('returns an empty string for an unknown id', () => {
    expect(srcsetFor('no-such-id', [320, 640])).toBe('')
  })
})

describe('manifest shape', () => {
  it('has a non-empty list for every region, including the generic one', () => {
    for (const region of REGIONS) {
      expect(Array.isArray(ART_MANIFEST.regions[region])).toBe(true)
      // No region is empty any more. An unmatched destination reaches the
      // generic scene rather than falling through to the road or city family.
      expect(ART_MANIFEST.regions[region].length, region).toBeGreaterThan(0)
    }
    expect(ART_MANIFEST.regions.generic).toEqual(['generic-1'])
  })

  it('gives each region its own scenes and keeps the fallback families separate', () => {
    expect(ART_MANIFEST.regions.goa).toEqual(['goa-1', 'goa-2'])
    expect(ART_MANIFEST.regions.coorg).toEqual(['coorg-1', 'coorg-2'])
    expect(ART_MANIFEST.regions.meghalaya).toEqual(['meghalaya-1', 'meghalaya-2'])
    expect(ART_MANIFEST.regions.kashmir).toEqual(['himalaya-1', 'himalaya-2'])
    expect(ART_MANIFEST.regions.rajasthan).toEqual(['rajasthan-1', 'rajasthan-2'])
    expect(ART_MANIFEST.fallbacks.road).toEqual(['road-1', 'road-2'])
    expect(ART_MANIFEST.fallbacks.city).toEqual(['city-1'])
    // A fallback id must never sit in a region list, or a generic trip would
    // claim a named region's geography.
    for (const id of [...ART_MANIFEST.fallbacks.road, ...ART_MANIFEST.fallbacks.city]) {
      expect(Object.values(ART_MANIFEST.regions).flat()).not.toContain(id)
    }
  })

  it('points every region, fallback and vignette at a declared id', () => {
    const declared = new Set(Object.keys(ART_MANIFEST.ids))
    const referenced = [
      ...Object.values(ART_MANIFEST.regions).flat(),
      ...Object.values(ART_MANIFEST.fallbacks).flat(),
      ...Object.values(ART_MANIFEST.vignettes),
    ]
    for (const id of referenced) {
      expect(declared.has(id), `${id} is referenced but not declared`).toBe(true)
    }
  })
})
