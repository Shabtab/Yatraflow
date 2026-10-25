import { describe, expect, it } from 'vitest'
import {
  ART_MANIFEST,
  type ArtManifest,
  type ArtRegion,
  artIdFor,
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
    const onlyIds: Partial<Record<ArtRegion, string>> = { kerala: 'kerala-1', rajasthan: 'rajasthan-1', kashmir: 'himalaya-1' }
    for (const [region, expectedId] of Object.entries(onlyIds)) {
      for (let index = 0; index < 200; index += 1) {
        expect(artIdFor(region as ArtRegion, `seed-${index}`)).toBe(expectedId)
      }
    }
  })

  it('returns null for a region with no generated image', () => {
    for (const region of ['goa', 'coorg', 'meghalaya', 'generic'] as const) {
      expect(artIdFor(region, 'any-seed')).toBeNull()
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

  it('uses road art for a region without images and two or more places', () => {
    expect(coverFor({ region: 'goa', seed: 'trip-1', placeCount: 2 })).toEqual({ kind: 'generated', id: 'road-1' })
  })

  it('uses city art for a region without images and one place', () => {
    expect(coverFor({ region: 'generic', seed: 'trip-1', placeCount: 1 })).toEqual({ kind: 'generated', id: 'city-1' })
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
  it('resolves a declared page state to its square master', () => {
    expect(vignetteArtFor('first-trip')).toBe('es-first-trip')
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
  it('keeps the generic motif for a place no region names, and never borrows another region', () => {
    // A tile shows only its own region's scene. "Rishikesh" matches no keyword,
    // so regionFor gives "generic" and artIdFor gives null: the tile keeps its
    // inline SVG. It must not fall through to the Himalaya scene, which would
    // claim the place is in Kashmir.
    for (const place of ['Rishikesh', 'Hampi', 'Ziro Valley']) {
      const region = regionFor({ destinations: [place] })
      expect(region, place).toBe('generic')
      expect(artIdFor(region, place), place).toBeNull()
    }
  })

  it('still gives a named place its own region scene', () => {
    expect(artIdFor(regionFor({ destinations: ['Srinagar'] }), 'Srinagar')).toBe('himalaya-1')
    expect(artIdFor(regionFor({ destinations: ['Munnar'] }), 'Munnar')).toBe('kerala-1')
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
  it('has a list for every region, empty where no image exists yet', () => {
    for (const region of REGIONS) {
      expect(Array.isArray(ART_MANIFEST.regions[region])).toBe(true)
    }
    expect(ART_MANIFEST.regions.goa).toEqual([])
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
