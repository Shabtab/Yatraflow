// /c/<creatorId> — the creator's public card (#362).
//
// `CreatorPage` shared itself as `${location.origin}/#/creator/<id>`, and a
// fragment never leaves the browser: every unfurl of a creator link was the
// generic app shell. This is the server path for sharing — the same
// metadata-then-redirect shape `api/i.js` uses, deliberately, because
// inventing a second pattern is how the handlers drifted before (#362).
//
// Dependency-free by design (the i.js header explains why): no client code,
// one DB read for the profile, one counted read for the publications, and a
// fail-closed card — an unknown or unreadable profile answers the same
// honest 404-without-canonical card as a missing publication does.
import { resolveOrigin } from './_origin.js'

const DEFAULT_TITLE = 'YatraFlow — Plan real trips, together'
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
function renderCreator(profile, id, publicationCount) {
  const origin = resolveOrigin()
  const name = typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim() : null
  if (!name) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(DEFAULT_TITLE)}</title>
<script>location.replace(${JSON.stringify('/#/explore')})</script>
</head>
<body><p>Opening <a href="/#/explore">Explore</a>…</p></body>
</html>`
  }
  const bio = typeof profile.creator_bio === 'string' && profile.creator_bio.trim() ? profile.creator_bio.trim() : null
  const count = Number(publicationCount)
  const published = Number.isFinite(count) && count > 0
    ? `${count} published ${count === 1 ? 'itinerary' : 'itineraries'}`
    : 'New to YatraFlow'
  const title = `${name} on YatraFlow`
  // The bio and the count are BOTH the card's story — a description that was
  // only the bio dropped the one number that tells a reader whether this
  // creator has anything to look at.
  const description = [bio, published].filter(Boolean).join(' · ')
  const canonical = `${origin}/c/${id}`
  const target = `/#/creator/${id}`
  return `<!doctype html>
<html lang="en">
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
<script>location.replace(${JSON.stringify(target)})</script>
</head>
<body><p><a href="${escapeHtml(target)}">${escapeHtml(`${name} — ${published}`)}</a></p></body>
</html>`
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

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return res.status(503).end()

  let profile = null
  let profileReadFailed = false
  let publicationCount = null
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

  // The count rides the content-range of a HEAD with an exact-count
  // preference — the cheapest way to say "0-0/N" without transferring rows.
  // It is decoration: a failed or absent count leaves the card honest
  // ("New to YatraFlow") rather than taking the page down with it.
  try {
    const countResponse = await fetch(
      `${url.replace(/\/+$/, '')}/rest/v1/published_itineraries?creator_id=eq.${encodeURIComponent(id)}&select=id&limit=1`,
      {
        method: 'HEAD',
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          prefer: 'count=exact',
        },
        signal: AbortSignal.timeout(4000),
      },
    )
    if (countResponse.ok) {
      const range = countResponse.headers.get('content-range') ?? ''
      const total = Number(/\/\s*(\d+)\s*$/.exec(range)?.[1])
      if (Number.isFinite(total)) publicationCount = total
    }
  } catch {
    // Countless but present — the card still says who they are.
  }

  res.status(200)
  return req.method === 'HEAD' ? res.end() : res.send(renderCreator(profile, id, publicationCount))
}
