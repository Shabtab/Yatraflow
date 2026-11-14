// ============ Artwork covers (#914) ============
//
// A publication's cover can be generated artwork. The choice is stored as an
// https URL, so it must survive a redeploy and must be recognisable later.
// These tests pin the URL shape, the id parser and the public origin.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  artCoverOrigin, artCoverUrl, artIdFromCoverUrl, PUBLIC_ART_ORIGIN,
} from '../src/lib/artCover'
import { ART_MANIFEST } from '../src/lib/regionArt'

const ORIGIN = 'https://app.example.test'

describe('artCoverUrl', () => {
  it('builds a stable https URL for a generated scene', () => {
    expect(artCoverUrl('goa-1', ORIGIN)).toBe('https://app.example.test/art/goa-1.webp')
    expect(artCoverUrl('dest-agra-v2', ORIGIN)).toBe('https://app.example.test/art/dest-agra-v2.webp')
  })

  it('accepts a trailing slash on the origin and no origin at all', () => {
    expect(artCoverUrl('kerala-1', `${ORIGIN}/`)).toBe('https://app.example.test/art/kerala-1.webp')
    expect(artCoverUrl('kerala-1')).toBe(`${PUBLIC_ART_ORIGIN}/art/kerala-1.webp`)
  })

  it('refuses a non-https origin, a path and an unknown id', () => {
    expect(artCoverUrl('goa-1', 'http://app.example.test')).toBeNull()
    expect(artCoverUrl('goa-1', 'https://app.example.test/app')).toBeNull()
    expect(artCoverUrl('no-such-scene', ORIGIN)).toBeNull()
  })
})

describe('artIdFromCoverUrl', () => {
  it('reads the scene id back from the stored URL', () => {
    expect(artIdFromCoverUrl('https://app.example.test/art/goa-2.webp')).toBe('goa-2')
    expect(artIdFromCoverUrl('https://app.example.test/art/dest-leh-v2.webp?x=1#top')).toBe('dest-leh-v2')
  })

  it('does not call a photo, an insecure URL or an unknown id artwork', () => {
    expect(artIdFromCoverUrl('https://images.example.test/cover.jpg')).toBeNull()
    expect(artIdFromCoverUrl('https://app.example.test/art/goa-1.png')).toBeNull()
    expect(artIdFromCoverUrl('http://app.example.test/art/goa-1.webp')).toBeNull()
    expect(artIdFromCoverUrl('https://app.example.test/art/no-such-scene.webp')).toBeNull()
    expect(artIdFromCoverUrl(null)).toBeNull()
  })

  it('round-trips every id the app can store', () => {
    for (const id of ['kerala-1', 'himalaya-2', 'road-1', 'generic-1', 'dest-munnar-v2']) {
      const url = artCoverUrl(id, ORIGIN)
      expect(url, id).not.toBeNull()
      expect(artIdFromCoverUrl(url), id).toBe(id)
    }
  })
})

describe('the cover origin', () => {
  it('falls back to the public origin in node and on a localhost page', () => {
    expect(artCoverOrigin()).toBe(PUBLIC_ART_ORIGIN)
  })

  it('is the same origin the share helpers advertise', () => {
    const shareUrl = readFileSync(new URL('../src/lib/shareUrl.ts', import.meta.url), 'utf8')
    expect(shareUrl).toContain(`const PUBLIC_ORIGIN = '${PUBLIC_ART_ORIGIN}'`)
  })
})

describe('the handler and the client agree on the scene', () => {
  it('repeats the client region keywords exactly', () => {
    // api/i.js cannot import client code, so it carries a small copy of the
    // region table. These two lists must not drift.
    const tripsPage = readFileSync(new URL('../src/lib/tripsPage.ts', import.meta.url), 'utf8')
    const handler = readFileSync(new URL('../api/i.js', import.meta.url), 'utf8')
    const rows = (source: string) => [...source.matchAll(/\['([a-z]+)', \[([^\]]+)\]\]/g)]
      .map(match => `${match[1]}:${match[2]}`)
    const client = rows(tripsPage).filter(row => !row.startsWith('es-'))
    expect(client.length).toBeGreaterThanOrEqual(6)
    expect(rows(handler).filter(row => !row.startsWith('es-'))).toEqual(client)
  })

  it('has a scene family for every keyword region', () => {
    for (const region of ['kerala', 'goa', 'rajasthan', 'coorg', 'meghalaya', 'kashmir'] as const) {
      expect(ART_MANIFEST.regions[region]?.length, region).toBeGreaterThan(0)
    }
  })
})
