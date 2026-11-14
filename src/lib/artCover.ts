// ============ Artwork covers — a stable address for a generated scene ======
//
// A publication can name generated artwork as its cover. That choice is stored
// as a URL in `published_itineraries.cover_image_url`, so it must keep working
// after the next deploy. Vite hashes bundled asset names, and an art rebuild
// changes those names, so a stored hashed URL would later 404.
//
// The stable answer is `public/art/<id>.webp`. Every manifest id has a WebP
// copy there, and `tests/art-manifest.test.ts` pins the copies to the source
// files. The app and `api/i.js` build the same URL from an id. The manifest
// remains the only list of valid ids.
import { artEntryFor } from './regionArt'

/** The https origin used when the page itself is not on https, such as a
 *  localhost dev server. A stored cover must pass the database's https check
 *  and the share handler's `^https://` test. */
export const PUBLIC_ART_ORIGIN = 'https://www.yatraflow.in'

/** An origin with no path, query or fragment, or null when it is not https. */
function httpsOrigin(origin: string | undefined | null): string | null {
  const value = (origin ?? '').trim().replace(/\/+$/, '')
  return /^https:\/\/[^/\s?#]+$/i.test(value) ? value : null
}

/** The origin to store in a cover URL. The live https page uses its own
 *  origin; every other context uses the public origin. */
export function artCoverOrigin(): string {
  if (typeof location !== 'undefined' && location.protocol === 'https:') return location.origin
  return PUBLIC_ART_ORIGIN
}

/**
 * The stored cover URL for one generated scene, or null when the id has no
 * manifest entry or the origin is not usable.
 *
 * `origin` defaults to the public origin. Tests pass an explicit origin, so
 * the function stays pure in node.
 */
export function artCoverUrl(artId: string, origin: string = PUBLIC_ART_ORIGIN): string | null {
  if (!artEntryFor(artId)) return null
  const base = httpsOrigin(origin)
  if (!base) return null
  return `${base}/art/${artId}.webp`
}

/** The scene id inside an artwork cover URL, or null for every other URL.
 *  A photo URL, another host's path and an unknown id all answer null, so the
 *  caller can treat "artwork" as an exact claim rather than a guess. */
export function artIdFromCoverUrl(url: string | null | undefined): string | null {
  const value = (url ?? '').trim()
  if (!/^https:\/\/\S+$/.test(value)) return null
  const match = /\/art\/([a-z0-9][a-z0-9-]*)\.webp(?:[?#]\S*)?$/i.exec(value)
  if (!match) return null
  return artEntryFor(match[1]) ? match[1] : null
}
