// The default link-preview card: one definition for every server-rendered share page.
// `index.html` and the static calculator page write the same values by hand.
// tests/share-preview.test.ts pins them to this module and to the real PNG.
// The source and its render command are in scripts/og-default-card.html.
import { escapeHtml } from './_escape.js'
import { DEFAULT_ORIGIN } from './_origin.js'
import artManifest from '../src/assets/art/manifest.json' with { type: 'json' }

export const DEFAULT_CARD_PATH = '/og-default.png'
export const DEFAULT_CARD_WIDTH = 1200
export const DEFAULT_CARD_HEIGHT = 630
export const DEFAULT_CARD_TYPE = 'image/png'
export const DEFAULT_CARD_ALT = 'YatraFlow: India trips, planned together. Plan, Map, Budget and Share.'

// Every scene under public/art/ is a 640 x 427 WebP, except the empty-state
// vignettes. The test reads each scene file to keep these numbers true.
export const ART_CARD_WIDTH = 640
export const ART_CARD_HEIGHT = 427
export const ART_CARD_TYPE = 'image/webp'

/** The default card at an absolute URL, with the size and type it really has. */
export function defaultCard(origin) {
  return {
    url: `${origin}${DEFAULT_CARD_PATH}`,
    width: DEFAULT_CARD_WIDTH,
    height: DEFAULT_CARD_HEIGHT,
    type: DEFAULT_CARD_TYPE,
    alt: DEFAULT_CARD_ALT,
  }
}

/** The Open Graph image tags. A size or type is written only when it is known. */
export function ogImageTags(image) {
  return [
    `<meta property="og:image" content="${escapeHtml(image.url)}" />`,
    ...(image.width && image.height ? [
      `<meta property="og:image:width" content="${image.width}" />`,
      `<meta property="og:image:height" content="${image.height}" />`,
    ] : []),
    ...(image.type ? [`<meta property="og:image:type" content="${escapeHtml(image.type)}" />`] : []),
    ...(image.alt ? [`<meta property="og:image:alt" content="${escapeHtml(image.alt)}" />`] : []),
  ].join('\n')
}

/** The X image tags, with the same URL and alt text as the Open Graph tags. */
export function twitterImageTags(image) {
  return [
    `<meta name="twitter:image" content="${escapeHtml(image.url)}" />`,
    ...(image.alt ? [`<meta name="twitter:image:alt" content="${escapeHtml(image.alt)}" />`] : []),
  ].join('\n')
}

const VIGNETTE_IDS = new Set(Object.values(artManifest.vignettes ?? {}))
const ART_PATH_RE = /^\/art\/([a-z0-9][a-z0-9-]*)\.webp$/

/** A scene card with its real size, or null for every other URL.
 *
 *  Only a scene on this deployment's host or the production host qualifies.
 *  A file on another host can have any size, so its tags declare none. */
export function artCardImage(url, origin, alt) {
  let parsed
  try { parsed = new URL(url) } catch { return null }
  const hosts = [origin, DEFAULT_ORIGIN].map(value => { try { return new URL(value).host } catch { return null } })
  const id = ART_PATH_RE.exec(parsed.pathname)?.[1]
  if (!id || parsed.search || parsed.protocol !== 'https:' || !hosts.includes(parsed.host)) return null
  if (VIGNETTE_IDS.has(id)) return null
  return { url, width: ART_CARD_WIDTH, height: ART_CARD_HEIGHT, type: ART_CARD_TYPE, alt }
}
