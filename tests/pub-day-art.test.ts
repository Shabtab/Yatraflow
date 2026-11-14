import { describe, expect, it } from 'vitest'
import { pubArtId } from '../src/lib/pubDayArt'
import { ART_MANIFEST } from '../src/lib/regionArt'

const neutral = new Set(ART_MANIFEST.regions.generic)

describe('pubArtId', () => {
  it('always gives a scene, even with no places at all', () => {
    const id = pubArtId({ seed: 'pub_x:day:0', planPlaces: [] })
    expect(id).toBeTruthy()
  })

  it('is stable for the same seed', () => {
    const a = pubArtId({ seed: 'pub_x:day:2', planPlaces: ['Jaipur', 'Udaipur'] })
    const b = pubArtId({ seed: 'pub_x:day:2', planPlaces: ['Jaipur', 'Udaipur'] })
    expect(a).toBe(b)
  })

  it('gives a Rajasthan plan a non-neutral scene', () => {
    const id = pubArtId({ seed: 'pub_r:day:0', planPlaces: ['Jaipur', 'Jodhpur', 'Udaipur'] })
    expect(id).toBeTruthy()
    expect(neutral.has(id as string)).toBe(false)
  })

  it('falls back to the plan when the day places are unknown', () => {
    const plan = pubArtId({ seed: 'pub_r:day:1', planPlaces: ['Jaipur', 'Udaipur'] })
    const day = pubArtId({ seed: 'pub_r:day:1', slotPlaces: ['Some unnamed dhaba'], planPlaces: ['Jaipur', 'Udaipur'] })
    expect(day).toBe(plan)
  })
})
