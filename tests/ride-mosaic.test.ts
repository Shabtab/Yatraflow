import { describe, expect, it } from 'vitest'
import { pubArtFamily, pubArtId } from '../src/lib/pubDayArt'
import { pickMosaicPhotos, type MosaicDay } from '../src/lib/rideMosaic'

const PLAN = ['Kochi', 'Munnar', 'Thekkady', 'Alleppey']

function day(index: number, title: string): MosaicDay {
  return {
    index,
    title,
    family: pubArtFamily({
      seed: `pub:day:${index}`,
      slotPlaces: title.split(/\s+/).filter(Boolean),
      planPlaces: PLAN,
    }),
  }
}

function sources(picked: ReturnType<typeof pickMosaicPhotos>): string[] {
  return picked.map(p => p.photo ?? p.sceneId ?? '')
}

describe('Ride along mosaic', () => {
  it('gives every tile a different picture when days share one scene', () => {
    const days: MosaicDay[] = [
      { index: 0, title: 'Munnar', family: ['scene-a', 'scene-b'] },
      { index: 1, title: 'Munnar tea estates', family: ['scene-a', 'scene-c'] },
      { index: 2, title: 'Top Station', family: ['scene-a', 'scene-d'] },
    ]
    const picked = pickMosaicPhotos(days)
    expect(sources(picked)).toEqual(['scene-a', 'scene-c', 'scene-d'])
    expect(new Set(sources(picked)).size).toBe(3)
  })

  it('keeps three different files for a real plan whose days resolve alike', () => {
    const days = Array.from({ length: 6 }, (_, i) => day(i, 'Munnar'))
    const primaries = days.map(d => d.family[0])
    expect(new Set(primaries).size).toBeLessThan(primaries.length)
    const picked = pickMosaicPhotos(days)
    const chosen = sources(picked)
    expect(chosen.length).toBeLessThanOrEqual(3)
    expect(chosen.length).toBeGreaterThanOrEqual(2)
    expect(new Set(chosen).size).toBe(chosen.length)
  })

  it('shows fewer tiles instead of inventing a picture', () => {
    const days: MosaicDay[] = [
      { index: 0, title: 'Munnar', family: ['only-scene'] },
      { index: 1, title: 'Munnar', family: ['only-scene'] },
      { index: 2, title: 'Munnar', family: ['only-scene'] },
    ]
    expect(pickMosaicPhotos(days)).toHaveLength(1)
  })

  it('keeps the resolver first choice unchanged', () => {
    for (const seed of ['pub:day:0', 'pub:day:1', 'pub:day:7']) {
      const family = pubArtFamily({ seed, slotPlaces: ['Munnar'], planPlaces: PLAN })
      expect(pubArtId({ seed, slotPlaces: ['Munnar'], planPlaces: PLAN })).toBe(family[0] ?? null)
    }
  })

})
