// ============ Ride along mosaic — three different pictures ============
// The mosaic draws the first readable days. Two days of one place often
// resolve to one scene, which drew the same picture twice. This picker keeps
// one image source per tile. It skips a used source and takes the next
// readable day, then, if that runs out, the next scene of the same family.
// It never invents a tile: fewer than three sources means fewer tiles.

/** One day a mosaic tile may draw. Only readable days reach this module. */
export interface MosaicDay {
  index: number
  title: string
  /** The day's own uploaded photo, when it has one. */
  photo?: string
  /** The scenes this day may use, its first choice first. Empty for a photo-only day. */
  family: readonly string[]
}

/** One tile: the day it names and the source it draws. */
export interface MosaicPhoto {
  index: number
  title: string
  /** The uploaded photo, when this tile draws one. */
  photo?: string
  /** The scene file, when this tile draws a generated scene. */
  sceneId?: string
}

const PHOTO_SOURCE_PREFIX = 'photo:'

function sourcesOf(day: MosaicDay): string[] {
  if (day.photo) return [PHOTO_SOURCE_PREFIX + day.photo]
  const seen = new Set<string>()
  return day.family.filter(id => id && !seen.has(id) && seen.add(id) !== undefined)
}

function tileFor(day: MosaicDay, source: string): MosaicPhoto {
  return source.startsWith(PHOTO_SOURCE_PREFIX)
    ? { index: day.index, title: day.title, photo: source.slice(PHOTO_SOURCE_PREFIX.length) }
    : { index: day.index, title: day.title, sceneId: source }
}

/** The tiles for at most `limit` readable days, each with an unused source. */
export function pickMosaicPhotos(days: readonly MosaicDay[], limit = 3): MosaicPhoto[] {
  const used = new Set<string>()
  const picked = new Set<number>()
  const tiles: MosaicPhoto[] = []

  // Pass one takes the next readable day whose first choice is free.
  for (const day of days) {
    if (tiles.length >= limit) break
    const source = sourcesOf(day)[0]
    if (!source || used.has(source)) continue
    used.add(source)
    picked.add(day.index)
    tiles.push(tileFor(day, source))
  }

  // Pass two keeps the same day and steps to another scene of its family.
  for (const day of days) {
    if (tiles.length >= limit) break
    if (picked.has(day.index)) continue
    const source = sourcesOf(day).find(candidate => !used.has(candidate))
    if (!source) continue
    used.add(source)
    picked.add(day.index)
    tiles.push(tileFor(day, source))
  }

  return tiles
}
