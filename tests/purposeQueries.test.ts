import { describe, it, expect } from 'vitest'
import { queriesForPurpose } from '../src/lib/purposeQueries'

describe('purposeQueries', () => {
  it('meal purpose returns food queries', () => {
    const q = queriesForPurpose('meal')
    expect(q.googleQueries.some(s => s.includes('dhaba') || s.includes('restaurant'))).toBe(true)
    expect(q.overpassSelectors).toContain('amenity=restaurant')
    expect(q.categoryBias).toContain('food')
  })

  it('fuel purpose returns petrol queries by default', () => {
    const q = queriesForPurpose('fuel')
    expect(q.googleQueries.some(s => s.includes('petrol') || s.includes('fuel'))).toBe(true)
    expect(q.overpassSelectors).toContain('amenity=fuel')
    expect(q.categoryBias).toContain('transport-hub')
  })

  it('fuel purpose for EV returns charging queries', () => {
    const q = queriesForPurpose('fuel', 'electric')
    expect(q.googleQueries.some(s => s.includes('charging'))).toBe(true)
    expect(q.overpassSelectors).toContain('amenity=charging_station')
  })

  it('fuel purpose for CNG returns CNG queries', () => {
    const q = queriesForPurpose('fuel', 'cng')
    expect(q.googleQueries.some(s => s.includes('CNG'))).toBe(true)
    expect(q.overpassSelectors).toContain('amenity=fuel')
  })

  it('overnight purpose returns hotel queries', () => {
    const q = queriesForPurpose('overnight')
    expect(q.googleQueries.some(s => s.includes('hotel'))).toBe(true)
    expect(q.overpassSelectors).toContain('tourism=hotel')
    expect(q.categoryBias).toContain('hotel')
  })

  it('sight purpose returns tourist queries', () => {
    const q = queriesForPurpose('sight')
    expect(q.googleQueries.some(s => s.includes('tourist') || s.includes('attraction'))).toBe(true)
    expect(q.categoryBias).toContain('sightseeing')
  })

  it('stretch purpose returns cafe queries', () => {
    const q = queriesForPurpose('stretch')
    expect(q.googleQueries.some(s => s.includes('cafe') || s.includes('tea'))).toBe(true)
    expect(q.categoryBias.some(c => c === 'cafe' || c === 'food')).toBe(true)
  })

  it('rest purpose returns rest-area queries', () => {
    const q = queriesForPurpose('rest')
    expect(q.overpassSelectors.some(s => s.includes('rest_area') || s.includes('shelter'))).toBe(true)
  })
})
