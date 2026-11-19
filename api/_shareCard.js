// The default link-preview card: one definition for every server-rendered share page.
// `index.html` and the static calculator page write the same values by hand.
// tests/share-preview.test.ts pins them to this module and to the real PNG.
// The source and its render command are in scripts/og-default-card.html.
import { escapeHtml } from './_escape.js'

export const DEFAULT_CARD_PATH = '/og-default.png'
export const DEFAULT_CARD_WIDTH = 1200
export const DEFAULT_CARD_HEIGHT = 630
export const DEFAULT_CARD_TYPE = 'image/png'
export const DEFAULT_CARD_ALT = 'YatraFlow: India trips, planned together. Plan, Map, Budget and Share.'

// Every generated scene under public/art/ is one size and one format.
// The test reads each scene file to keep these numbers true.
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
