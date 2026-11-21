// Package C, item 4 (#904): photos on the place card. Without a Google key the
// card keeps its category tile. With photos, each one shows its own attribution.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardPhotoRefs, placePhotoUrl } from '../src/lib/providers/google'
import type { PlacePhotoRef } from '../src/lib/providers/hits'
import { photoStep, attributionOf, ageText, coverageText } from '../src/components/map/placeCardFacts'

const ref = (over: Partial<PlacePhotoRef['attribution']> = {}): PlacePhotoRef => ({
  name: 'places/abc/photos/xyz', widthPx: 800, heightPx: 600, attribution: { text: 'A. Rao', authorUri: 'https://maps.google.com/contrib/1', ...over },
})

describe('photos without a key', () => {
  // A developer .env.local can hold a real key, so clear it for this case.
  beforeEach(() => vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', ''))
  afterEach(() => vi.unstubAllEnvs())
  it('give the card nothing to show', () => {
    expect(cardPhotoRefs({ photos: [ref()] })).toEqual([])
    expect(placePhotoUrl(ref(), 640)).toBeNull()
  })
})

describe('photoStep', () => {
  it('moves with the arrow keys and wraps', () => {
    expect(photoStep(0, 3, 'ArrowRight')).toBe(1)
    expect(photoStep(2, 3, 'ArrowRight')).toBe(0)
    expect(photoStep(0, 3, 'ArrowLeft')).toBe(2)
    expect(photoStep(1, 3, 'Home')).toBe(0)
    expect(photoStep(1, 3, 'End')).toBe(2)
  })
  it('ignores other keys and a single photo', () => {
    expect(photoStep(1, 3, 'a')).toBeNull()
    expect(photoStep(0, 1, 'ArrowRight')).toBeNull()
  })
})

describe('attributionOf', () => {
  it('links the author when a link is set', () => {
    expect(attributionOf(ref())).toEqual({ text: 'A. Rao', href: 'https://maps.google.com/contrib/1' })
  })
  it('shows plain text when there is no link', () => {
    expect(attributionOf(ref({ authorUri: null }))).toEqual({ text: 'A. Rao', href: null })
  })
  it('refuses a link that is not https', () => {
    expect(attributionOf(ref({ authorUri: 'javascript:alert(1)' })).href).toBeNull()
  })
})

describe('ageText and coverageText', () => {
  const now = 1_000_000_000_000
  it('says nothing when the age is unknown', () => {
    expect(ageText(null, now)).toBeNull()
    expect(ageText(undefined, now)).toBeNull()
    expect(ageText(Number.NaN, now)).toBeNull()
    expect(ageText(now + 5000, now)).toBeNull()
  })
  it('states a real age in plain units', () => {
    expect(ageText(now - 20_000, now)).toBe('Checked just now')
    expect(ageText(now - 12 * 60_000, now)).toBe('Checked 12 min ago')
    expect(ageText(now - 3 * 3_600_000, now)).toBe('Checked 3 h ago')
    expect(ageText(now - 2 * 86_400_000, now)).toBe('Checked 2 days ago')
  })
  it('says nothing when coverage is unknown', () => {
    expect(coverageText(null)).toBeNull()
    expect(coverageText(undefined)).toBeNull()
  })
  it('states what was searched', () => {
    const base = { method: 'circles' as const, anchorCount: 3, radiusM: 5000 }
    expect(coverageText({ ...base, totalKm: 120, coveredKm: 120, complete: true })).toBe('Whole road searched')
    expect(coverageText({ ...base, totalKm: 120, coveredKm: 80, complete: false })).toBe('Searched 80 of 120 km of the road')
    expect(coverageText({ ...base, totalKm: null, coveredKm: null, complete: false })).toBeNull()
  })
})

describe('wiring', () => {
  const card = readFileSync('src/components/map/MapPickCard.tsx', 'utf8')
  const view = readFileSync('src/pages/trip/map/driveSuggestionView.ts', 'utf8')
  const photos = readFileSync('src/components/map/PlacePhotos.tsx', 'utf8')
  it('adds photos to the drive row', () => {
    expect(view).toMatch(/photos: PlacePhotoRef\[\]/)
    expect(view).toContain('photos: hit.photos ?? []')
  })
  it('asks for a photo URL only when the image is shown, lazily', () => {
    expect(photos).toContain('cardPhotoRefs(')
    expect(photos).toContain('placePhotoUrl(')
    expect(photos).toContain('loading="lazy"')
    expect(card).toContain('<PlacePhotos')
  })
})
