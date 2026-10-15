// /c/<creatorId> serves a public profile and live itinerary links (#701).
// Search visitors read the page. A recognised share tag opens the app.
import { resolveOrigin } from './_origin.js'
import { renderCreatorBody, creatorJsonLd } from './_creatorBody.js'

const DEFAULT_TITLE = 'YatraFlow — Plan real trips, together'
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUBLICATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
// Must match src/lib/shareUrl.ts. The API cannot import client modules.
const SHARE_SOURCES = ['copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community']
const PAGE = 1000
const MAX_PAGES = 20
// A found card is edge-cacheable for five minutes, then served stale for ten
// while it revalidates. Everything else answers no-store.
const CARD_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

/**
 * The card. A profile the database could not read renders the noindex form:
 * no canonical and no og:url (a card for a nonexistent creator pointing a
 * crawler at its own address is the 404 hygiene #362 asks for), and a
 * <meta name="robots" content="noindex"> so a shared typo is never indexed.
 */
function renderCreator(profile, id, publications, ref) {
  const origin = resolveOrigin()
  const name = typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim() : null
  if (!name) {
    return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(DEFAULT_TITLE)}</title>
<script>location.replace(${JSON.stringify('/explore')})</script>
</head>
<body><p>Opening <a href="/explore">Explore</a>…</p></body>
</html>`
  }
  const bio = typeof profile.creator_bio === 'string' && profile.creator_bio.trim() ? profile.creator_bio.trim() : null
  const count = publications?.length
  const published = publications === null ? 'Published itineraries unavailable' : count > 0
    ? `${count} published ${count === 1 ? 'itinerary' : 'itineraries'}`
    : 'New to YatraFlow'
  const title = `${name} on YatraFlow`
  // The bio and the count are BOTH the card's story — a description that was
  // only the bio dropped the one number that tells a reader whether this
  // creator has anything to look at.
  const description = [bio, published].filter(Boolean).join(' · ')
  const canonical = `${origin}/c/${id}`
  // #426 slice 3: the browser lands on the app page's real path directly.
  const target = `/creator/${id}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="profile" />
<meta property="og:site_name" content="YatraFlow" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta property="og:image" content="${escapeHtml(`${origin}/og-default.png`)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(`${origin}/og-default.png`)}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<script type="application/ld+json">${creatorJsonLd(profile, canonical)}</script>
${ref ? `<script>location.replace(${JSON.stringify(target)})</script>` : ''}
</head>
<body>${renderCreatorBody(profile, publications, target)}</body>
</html>`
}

// Read only public card fields. Never fetch trips, emails or sales.
async function readPublications(url, key, id) {
  const publications = []
  let cursor = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const after = cursor ? `&id=gt.${encodeURIComponent(cursor)}` : ''
    const response = await fetch(
      `${url.replace(/\/+$/, '')}/rest/v1/published_itineraries?creator_id=eq.${encodeURIComponent(id)}` +
      `&unpublished_at=is.null&select=id,title,tagline&order=id.asc&limit=${PAGE}${after}`,
      {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(4000),
      },
    )
    if (!response.ok) return null
    const rows = await response.json()
    if (!Array.isArray(rows)) return null
    publications.push(...rows)
    if (rows.length < PAGE) return publications
    const last = rows.at(-1)?.id
    if (typeof last !== 'string' || !PUBLICATION_ID_RE.test(last) || (cursor && last <= cursor)) return null
    cursor = last
  }
  // A partial catalogue must not pose as the complete list.
  return null
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD')
    return res.status(405).end()
  }
  const id = req.query?.id
  // A missing id is the bare `/c/` path (the rewrite forwards it without a
  // query) — 404, exactly like a bare `/i/`. A malformed one is a request
  // error, matching how the publication handler answers it.
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return res.status(id ? 400 : 404).end()
  }
  const rawRef = req.query?.ref
  const ref = typeof rawRef === 'string' && SHARE_SOURCES.includes(rawRef) ? rawRef : null

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return res.status(503).end()

  let profile = null
  let profileReadFailed = false
  let publications = null
  try {
    const profileResponse = await fetch(
      `${url.replace(/\/+$/, '')}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}` +
      '&select=name,creator_bio&limit=1',
      {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(4000),
      },
    )
    if (profileResponse.ok) {
      const rows = await profileResponse.json()
      if (Array.isArray(rows)) profile = rows[0] ?? null
    } else {
      profileReadFailed = true
    }
  } catch {
    profileReadFailed = true
  }

  // An unreadable profile is an outage — the same 503 the publication handler
  // answers — while an unknown id is a real 404-with-a-card further down.
  if (profileReadFailed) return res.status(503).end()
  if (!profile) return res.status(404).end()

  try {
    publications = await readPublications(url, key, id)
  } catch {
    // Keep the public bio. Explain the failed catalogue read separately.
  }

  // Only a card that names a real creator may be shared at the edge. The
  // noindex fallback (a profile with no name) keeps the no-store header set above.
  const named = typeof profile?.name === 'string' && profile.name.trim() !== ''
  if (named && publications !== null) res.setHeader('cache-control', CARD_CACHE_CONTROL)
  res.status(200)
  return req.method === 'HEAD' ? res.end() : res.send(renderCreator(profile, id, publications, ref))
}
