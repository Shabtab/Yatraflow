// /c/<creatorId> serves a public profile and live itinerary links (#701).
// Search visitors read the page. A recognised share tag opens the app.
import { resolveOrigin } from './_origin.js'
import { CREATOR_PAGE_CLASS, CREATOR_PAGE_STYLE, renderCreatorBody, creatorJsonLd } from './_creatorBody.js'
import { escapeHtml } from './_escape.js'
import { defaultCard, fitOg, ogImageTags, twitterImageTags, OG_DESCRIPTION_MAX, OG_TITLE_MAX } from './_shareCard.js'

const DEFAULT_TITLE = 'YatraFlow — Plan Indian trips together'
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUBLICATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
// A post id, as `isPostId` in src/lib/creatorPosts.ts checks it.
const POST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Must match src/lib/shareUrl.ts. The API cannot import client modules, so
// this is the third mirror of one vocabulary (api/i.js holds the second).
// tests/indexable-creator.test.ts sends every value through this handler.
const SHARE_SOURCES = ['buyer', 'calculator', 'community', 'copy', 'creator', 'explore', 'purchases', 'wa']
const PAGE = 1000
const MAX_PAGES = 20
// A found card is edge-cacheable for five minutes, then served stale for ten
// while it revalidates. Everything else answers no-store.
const CARD_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600'

// The card's own stylesheet. It goes in the document head, never inside the body
// fragment, so a crawler reads the text and the style block as separate things.
const CREATOR_STYLE_TAG = `<style>${CREATOR_PAGE_STYLE}</style>`

/** A card title inside the WhatsApp budget. A long name drops the promise
 *  clause before it drops its own words. */
function creatorCardTitle(name) {
  const rich = `${name} on YatraFlow — India Routes & Stats`
  if (rich.length <= OG_TITLE_MAX) return rich
  const plain = `${name} on YatraFlow`
  return plain.length <= OG_TITLE_MAX ? plain : `${fitOg(name, OG_TITLE_MAX - ' on YatraFlow'.length)} on YatraFlow`
}

/** The states a catalogue covers, from the stored ISO codes. A code that is
 *  not a two-letter string is ignored, so a bad row cannot inflate the count. */
function coveredStateCount(rows) {
  const codes = new Set()
  for (const row of rows) {
    if (!Array.isArray(row?.state_codes)) continue
    for (const code of row.state_codes) {
      if (typeof code === 'string' && /^[A-Z]{2}$/.test(code)) codes.add(code)
    }
  }
  return codes.size
}

/** The planned distance across a catalogue, or null when no row has one.
 *  A null distance is unknown, never zero, so it is skipped before the
 *  conversion — one unknown row must not turn a whole catalogue into "0 km". */
function plannedKmTotal(rows) {
  let total = 0
  let seen = false
  for (const row of rows) {
    const raw = row?.planned_km
    if (raw === null || raw === undefined || raw === '') continue
    const km = Number(raw)
    if (!Number.isFinite(km) || km < 0) continue
    total += km
    seen = true
  }
  return seen ? Math.round(total) : null
}

/** The route line a storefront card leads with: how many timed routes, across
 *  how many states, over how many planned kilometres. Null when the catalogue
 *  carries no such facts, and then the plain count line speaks for it. */
function storefrontSummary(rows) {
  if (!rows.length) return null
  const states = coveredStateCount(rows)
  const km = plannedKmTotal(rows)
  if (!states && km === null) return null
  const count = rows.length
  const routes = `${count} timed ${count === 1 ? 'route' : 'routes'}`
  const across = states ? ` across ${states} Indian ${states === 1 ? 'state' : 'states'}` : ''
  const distance = km === null ? '' : ` (${km.toLocaleString('en-IN')} km planned)`
  return `${routes}${across}${distance}.`
}

/**
 * The card. A profile the database could not read renders the noindex form:
 * no canonical and no og:url (a card for a nonexistent creator pointing a
 * crawler at its own address is the 404 hygiene #362 asks for), and a
 * <meta name="robots" content="noindex"> so a shared typo is never indexed.
 */
function renderCreator(profile, id, publications, ref, post = null) {
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
${CREATOR_STYLE_TAG}
<script>location.replace(${JSON.stringify('/explore')})</script>
</head>
<body><main class="${CREATOR_PAGE_CLASS}"><p>Opening <a href="/explore">Explore</a>…</p></main></body>
</html>`
  }
  const bio = typeof profile.creator_bio === 'string' && profile.creator_bio.trim() ? profile.creator_bio.trim() : null
  const count = publications?.length
  const published = publications === null ? 'Published itineraries unavailable' : count > 0
    ? `${count} published ${count === 1 ? 'itinerary' : 'itineraries'}`
    : 'New to YatraFlow'
  const title = creatorCardTitle(name)
  // The bio and the count are BOTH the card's story — a description that was
  // only the bio dropped the one number that tells a reader whether this
  // creator has anything to look at. The stored route facts lead when they
  // exist, because the numbers are the pitch; the bio follows as context, and
  // the plain count speaks when no facts exist.
  const summary = publications && count > 0 ? storefrontSummary(publications) : null
  const facts = summary
    ? [summary, bio].filter(Boolean).join(' ')
    : [bio, published].filter(Boolean).join(' · ')
  const next = 'Open & fork for your group.'
  const joined = /[.!?]$/.test(facts) ? `${facts} ${next}` : `${facts}. ${next}`
  const description = joined.length <= OG_DESCRIPTION_MAX ? joined : fitOg(facts, OG_DESCRIPTION_MAX)
  const canonical = `${origin}/c/${id}`
  // #426 slice 3: the browser lands on the app page's real path directly.
  // A post-tagged link (G8) keeps its tag, so the app page counts the visit.
  const params = new URLSearchParams()
  if (ref) params.set('ref', ref)
  if (post) { params.set('src', 'post'); params.set('p', post) }
  const query = params.toString()
  const target = `/creator/${id}${query ? `?${query}` : ''}`
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
${ogImageTags(defaultCard(origin))}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
${twitterImageTags(defaultCard(origin))}
<link rel="canonical" href="${escapeHtml(canonical)}" />
${CREATOR_STYLE_TAG}
<script type="application/ld+json">${creatorJsonLd(profile, canonical)}</script>
${ref || post ? `<script>location.replace(${JSON.stringify(target)})</script>` : ''}
</head>
<body>${renderCreatorBody(profile, publications, target)}</body>
</html>`
}

// Read only public card fields. Never fetch trips, emails or sales.
const CATALOGUE_COLUMNS = 'id,title,tagline,planned_km,state_codes'
// A project that has not run the route-facts migration has no such columns,
// and the card must still read its rows.
const BASE_COLUMNS = 'id,title,tagline'
async function readPublications(url, key, id, columns = CATALOGUE_COLUMNS) {
  const publications = []
  let cursor = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const after = cursor ? `&id=gt.${encodeURIComponent(cursor)}` : ''
    const response = await fetch(
      `${url.replace(/\/+$/, '')}/rest/v1/published_itineraries?creator_id=eq.${encodeURIComponent(id)}` +
      `&unpublished_at=is.null&select=${columns}&order=id.asc&limit=${PAGE}${after}`,
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
  // A malformed post tag is dropped, like a malformed `ref`.
  const rawPost = req.query?.p
  const post = req.query?.src === 'post' && typeof rawPost === 'string' && POST_ID_RE.test(rawPost) ? rawPost : null

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return res.status(503).end()

  let profile = null
  let profileReadFailed = false
  let publications = null
  try {
    // #800: the creator card reads the PUBLIC projection through the typed RPC,
    // never the private `profiles` table. The old direct table read worked only
    // while `profiles read` was `using (true)`; with the table closed to self and
    // admin it would answer 42501 for every anonymous caller, and this endpoint
    // is anonymous by design. The RPC is the reviewed allowlist, so the card can
    // no longer be widened by a change to the projection list.
    const profileResponse = await fetch(
      `${url.replace(/\/+$/, '')}/rest/v1/rpc/get_public_profile_cards`,
      {
        method: 'POST',
        headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_ids: [id] }),
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
  // #800: a disabled account keeps its public identity card — its name and avatar
  // stay readable for crews it already belongs to — but it is NOT publicly
  // available as a creator. The card's `creator_available` flag is the derived
  // signal, so this route answers 404 for a disabled account rather than serving
  // a cacheable public creator page that names them. This is not a creator-badge
  // check: a former creator with live publications must stay listable when
  // enabled, and this reads availability, not the badge.
  if (profile.creator_available === false) return res.status(404).end()

  try {
    publications = await readPublications(url, key, id)
    // The route facts are optional columns. When they are missing, the card
    // reads the same rows without them instead of failing the catalogue.
    if (publications === null) publications = await readPublications(url, key, id, BASE_COLUMNS)
  } catch {
    // Keep the public bio. Explain the failed catalogue read separately.
  }

  // Only a card that names a real creator may be shared at the edge. The
  // noindex fallback (a profile with no name) keeps the no-store header set above.
  const named = typeof profile?.name === 'string' && profile.name.trim() !== ''
  if (named && publications !== null) res.setHeader('cache-control', CARD_CACHE_CONTROL)
  res.status(200)
  return req.method === 'HEAD' ? res.end() : res.send(renderCreator(profile, id, publications, ref, post))
}
