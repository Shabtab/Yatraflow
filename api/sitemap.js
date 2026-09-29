// #362: the sitemap used to stop at 1000 publications — PostgREST's default
// page size — and ordered by published_at alone, so an updated classic was
// buried under anything newer and publication 1001 was invisible forever. It
// now pages past the ceiling with a composite cursor, orders by the newer of
// published/refreshed, and lists creator pages (`/c/<id>`) alongside the
// publications. The catalogue reads once; the order is computed here.
import { resolveOrigin } from './_origin.js'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
// Creator ids are profile UUIDs; listing anything else would put a URL in the
// sitemap that the creator card handler answers 400 for. Same literal the
// handler pins (the api files cannot import client code, so this is the
// literal-test agreement the repo uses).
const CREATOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = 1000
// 20k publications plus their creators stays inside the sitemap protocol's
// 50k-URL limit while bounding the handler's runtime; the old ceiling's
// comment admitted the cap rather than removing it, which this replaces.
const MAX_PAGES = 20

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character])
}

/**
 * Epoch-milliseconds → W3C date (`YYYY-MM-DD`).
 * An absent or unparseable timestamp yields `''` and the caller omits the tag:
 * a missing `<lastmod>` is honest, a guessed one is not.
 */
function toLastmod(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/** The row's recency for ordering: the newer of refreshed and published.
 *  `publishItinerary` preserves `publishedAt` and bumps only `refreshedAt`,
 *  so this is what makes an updated classic resurface without touching the
 *  `lastmod` contract below (which still prefers `refreshed_at`). */
function recencyOf(row) {
  const refreshed = Number(row?.refreshed_at)
  if (Number.isFinite(refreshed) && refreshed > 0) return refreshed
  const published = Number(row?.published_at)
  if (Number.isFinite(published) && published > 0) return published
  return 0
}

/** One page of the catalogue, cursor-paged on (published_at, id) so no row is
 *  skipped while another is revisited. `published_at IS NULL` rows sort first
 *  under DESC, so a null cursor pages within the nulls rather than dropping
 *  them (null comparisons are never true in SQL). The query is built as raw
 *  text — not URLSearchParams — because PostgREST's `or=(...)` and `and(...)`
 *  grammar percent-encodes into something a human reading the fetch log (and
 *  the pins) cannot audit, and the values that go into it (integers,
 *  id-validated ids) need no encoding beyond encodeURIComponent on the id. */
function pageQuery(cursor) {
  const params = [
    'select=id,refreshed_at,published_at,creator_id',
    'order=published_at.desc,id.desc',
    `limit=${PAGE}`,
  ]
  if (cursor) {
    if (cursor.publishedAt === null) {
      params.push('published_at=is.null', `id=lt.${encodeURIComponent(cursor.id)}`)
    } else {
      params.push(`or=(published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${encodeURIComponent(cursor.id)}))`)
    }
  }
  return params.join('&')
}

async function fetchPublicationRows(url, key) {
  const rows = []
  let cursor = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(
      `${url.replace(/\/+$/, '')}/rest/v1/published_itineraries?${pageQuery(cursor)}`,
      {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(4000),
      },
    )
    if (!response.ok) throw new Error(`catalogue read failed: ${response.status}`)
    const body = await response.json()
    if (!Array.isArray(body)) throw new Error('catalogue read failed: unexpected body')
    rows.push(...body)
    if (body.length < PAGE) break
    const last = body[body.length - 1]
    const id = last?.id
    // A cursor id that is not a valid path id cannot be echoed into a query
    // safely, so the paging stops rather than risking injection into the
    // next request; the rows already collected still list.
    if (typeof id !== 'string' || !ID_RE.test(id)) break
    const publishedAt = Number(last.published_at)
    cursor = { publishedAt: Number.isFinite(publishedAt) && publishedAt > 0 ? publishedAt : null, id }
  }
  return rows
}

function renderSitemap(rows, creators, origin) {
  // The shell is the only non-publication URL a crawler can address: the app
  // routes on the hash, so `/#/explore` and friends are `/` to a crawler and
  // cannot be listed separately.
  const entries = [`  <url>\n    <loc>${escapeXml(`${origin}/`)}</loc>\n  </url>`]
  // Ordered by recency, not arrival: an updated classic belongs above a newer
  // row nobody has touched since it published.
  const ordered = [...rows].sort((a, b) => recencyOf(b) - recencyOf(a))
  for (const row of ordered) {
    const id = row?.id
    if (typeof id !== 'string' || !ID_RE.test(id)) continue
    const lastmod = toLastmod(row.refreshed_at ?? row.published_at)
    entries.push(
      '  <url>\n' +
      `    <loc>${escapeXml(`${origin}/i/${id}`)}</loc>\n` +
      (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
      '  </url>',
    )
  }
  for (const creatorId of creators) {
    entries.push(`  <url>\n    <loc>${escapeXml(`${origin}/c/${creatorId}`)}</loc>\n  </url>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/xml; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD')
    return res.status(405).end()
  }

  const origin = resolveOrigin()

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  let rows = null
  if (url && key) {
    try {
      rows = await fetchPublicationRows(url, key)
    } catch {
      rows = null
    }
  }

  // An unreachable catalogue answers 503 rather than a valid-looking document
  // listing only the shell: the latter tells a crawler every publication has
  // gone. A 503 is retried; a wrong sitemap is believed.
  if (rows === null) return res.status(503).end()

  // Every creator with at least one publication gets a discoverable page;
  // deduped from the same rows so the catalogue is read exactly once.
  const creators = [...new Set(rows
    .map(row => row?.creator_id)
    .filter(id => typeof id === 'string' && CREATOR_ID_RE.test(id)),
  )].sort()

  // The catalogue only changes when someone publishes, so an hour at the edge
  // costs nothing and keeps crawls off the database.
  res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  res.status(200)
  return req.method === 'HEAD' ? res.end() : res.send(renderSitemap(rows, creators, origin))
}
