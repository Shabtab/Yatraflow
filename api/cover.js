// A Wikimedia cover served from our own domain, at a size we asked for.
//
// Two crawlers disagree about Wikimedia, and both break the preview: Facebook's
// crawler is answered 403 by upload.wikimedia.org, so a publication whose cover
// is a raw Commons upload previews with no image at all, and every other crawler
// gets the 587 KB original. `api/i.js` therefore points og:image at this function
// for every Wikimedia cover. It asks the MediaWiki API for the direct thumb at a
// known width, fetches that thumb once, and answers the bytes with a long edge
// cache so the fetch happens rarely.
//
// The `f` and `w` values arrive from a URL we minted, but a crawler may replay any
// query it likes, so both are validated here and every failure answers the brand
// card instead of an error. Only `upload.wikimedia.org` may be fetched: the API's
// own answer is checked, because a hostile `thumburl` would otherwise turn this
// function into a fetcher for any address.
import { resolveOrigin } from './_origin.js'
import { defaultCard } from './_shareCard.js'

const WIDTHS = [640, 960, 1200]
const DEFAULT_WIDTH = 960
const MAX_FILE_LENGTH = 255
const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 6000
// MediaWiki answers thumbnails from `thumb.wikimedia.org` — the live shape,
// measured on File:Chandratal_1.JPG at iiurlwidth=1200 — and older or
// unsized answers use `upload.wikimedia.org`. Both are Wikimedia's own image
// hosts. The lookup is an exact host match against this set, never a suffix, so
// `upload.wikimedia.org.evil.test` cannot pass.
const THUMB_HOSTS = new Set(['thumb.wikimedia.org', 'upload.wikimedia.org'])
// The width the share card asks for. Kept here so the two files cannot drift.
export const CARD_COVER_WIDTH = 1200
const OK_CACHE = 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400'
const FALLBACK_CACHE = 'public, s-maxage=300'
const QUERY = 'https://commons.wikimedia.org/w/api.php'
// Control characters, the two path separators and any `..` segment. A file name
// is a Commons title, never a path.
const CONTROL_RE = /[\u0000-\u001F\u007F]/
const DIGITS_RE = /^[0-9]+$/

/**
 * The validated Wikimedia file name, or null.
 *
 * `%2C` and its kin survive: the MediaWiki API wants the file title encoded
 * exactly as it is stored, and a second round of encoding would miss the file.
 * The `..` test runs on the value the platform already decoded, so an encoded
 * traversal is refused too.
 */
export function coverFile(value) {
  if (typeof value !== 'string') return null
  if (value.length < 1 || value.length > MAX_FILE_LENGTH) return null
  if (CONTROL_RE.test(value)) return null
  if (value.includes('/') || value.includes('\\')) return null
  if (value.includes('..')) return null
  return value
}

/** One of the three allowed widths. Anything else is the default, never a refusal. */
export function coverWidth(value) {
  if (typeof value !== 'string' || !DIGITS_RE.test(value)) return DEFAULT_WIDTH
  const width = Number(value)
  return WIDTHS.includes(width) ? width : DEFAULT_WIDTH
}

/** Is this the host the thumb must come from? Exact host, https, nothing else. */
export function thumbAllowed(value) {
  if (typeof value !== 'string' || !value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && THUMB_HOSTS.has(parsed.host)
  } catch {
    return false
  }
}

/** A fresh abort signal per fetch, cleared when the request settles. */
function startTimeout() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  return { signal: controller.signal, stop: () => clearTimeout(timer) }
}

function userAgent(origin) {
  return `YatraFlowShareCard/1.0 (+${origin})`
}

/** The MediaWiki answer for one file at one width, or null. */
async function thumbUrl(file, width, origin) {
  const url = new URL(QUERY)
  url.searchParams.set('action', 'query')
  url.searchParams.set('titles', `File:${file}`)
  url.searchParams.set('prop', 'imageinfo')
  url.searchParams.set('iiprop', 'url|mime|size')
  url.searchParams.set('iiurlwidth', String(width))
  url.searchParams.set('format', 'json')
  const timer = startTimeout()
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': userAgent(origin) },
      signal: timer.signal,
    })
    if (!response.ok) return null
    const body = await response.json()
    const pages = body?.query?.pages
    if (!pages || typeof pages !== 'object') return null
    const info = Object.values(pages).map(page => page?.imageinfo).find(Array.isArray)
    const thumb = Array.isArray(info) && info[0]?.thumburl
    return thumbAllowed(thumb) ? thumb : null
  } catch {
    return null
  } finally {
    timer.stop()
  }
}

/** The thumb's bytes and its own content type. Throws on anything unexpected. */
async function thumbBytes(url, origin) {
  const timer = startTimeout()
  try {
    const response = await fetch(url, {
      headers: { accept: 'image/*', 'user-agent': userAgent(origin) },
      signal: timer.signal,
    })
    if (!response.ok) throw new Error('thumb status')
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!type.startsWith('image/')) throw new Error('thumb type')
    // A sed card is small; anything over the ceiling is not the image we asked for.
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('thumb length')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new Error('thumb size')
    return { type, bytes }
  } finally {
    timer.stop()
  }
}

/** Every failure lands on the brand card, cacheable for five minutes. */
function fallback(res, origin) {
  res.setHeader('location', defaultCard(origin).url)
  res.setHeader('cache-control', FALLBACK_CACHE)
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.statusCode = 302
  return res.end('See the YatraFlow card.\n')
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD')
    res.statusCode = 405
    return res.end()
  }
  const origin = resolveOrigin()
  const file = coverFile(req.query?.f)
  if (!file) return fallback(res, origin)
  try {
    const thumb = await thumbUrl(file, coverWidth(req.query?.w), origin)
    if (!thumb) return fallback(res, origin)
    const { type, bytes } = await thumbBytes(thumb, origin)
    res.setHeader('content-type', type)
    res.setHeader('cache-control', OK_CACHE)
    res.setHeader('x-content-type-options', 'nosniff')
    res.statusCode = 200
    return req.method === 'HEAD' ? res.end() : res.end(bytes)
  } catch {
    return fallback(res, origin)
  }
}
