// #362: the one canonical-origin resolver — shared with the sitemap and the
// creator card so the handlers can never disagree about where they live. A
// sibling api module, not client code: the dependency rule below is about the
// bundler, and this compiles with the function.
import { resolveOrigin } from './_origin.js'

const DEFAULT_TITLE = 'YatraFlow — Plan real trips, together'
const DEFAULT_DESCRIPTION = 'Plan realistic India trips together. See the time, distance and cost impact of every stop.'
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// #230 — the share-attribution vocabulary. Mirrors SHARE_SOURCES in
// src/lib/shareUrl.ts (this handler is plain JS outside src and cannot import
// client code); tests/share-attribution.test.ts pins the two lists to each
// other, and supabase/migrations/20260929_pub_events_share_source.sql pins the
// same list into the CHECK constraints.
const SHARE_SOURCES = ['copy', 'buyer', 'explore', 'creator', 'purchases']
const COVER_WIDTH = 1200
const WIKIMEDIA_PATH_RE = /^https:\/\/[^/]*wikimedia\.org\/wikipedia\/([^/]+)\/(.+)$/

/** The same Wikimedia file at a sane width.
 *
 *  A stored cover is frequently the RAW upload — the one live publication that
 *  has one carries `.../Chandratal_1.JPG?…thumbnail_unscaled`, 1.3 MB — because
 *  it was written before the picker started sizing, or by the destination-photo
 *  fallback. The client sizes these on the display path through the same
 *  redirect (src/lib/tripThumb.ts `sizedCoverUrl`); this function cannot import
 *  that (it sits behind the bundler, and this file stays dependency-free), so
 *  the rule is repeated here. Measured on that cover: 1,335,523 bytes → 147,351.
 *  Non-Wikimedia URLs come back untouched, and an already-sized redirect does
 *  not match the path shape, so this is idempotent. */
function sizedCover(url) {
  const [path] = url.split('?')
  const match = WIKIMEDIA_PATH_RE.exec(path)
  if (!match) return url
  const rest = match[2].startsWith('thumb/') ? match[2].slice('thumb/'.length) : match[2]
  const file = /^[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(rest)?.[1]
  if (!file) return url
  const host = match[1] === 'commons' ? 'commons.wikimedia.org' : `${match[1]}.wikipedia.org`
  return `https://${host}/wiki/Special:Redirect/file/${file}?width=${COVER_WIDTH}`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

/** Does this entitlement belong to this publication?
 *
 *  The gate for a buyer's card (ROADMAP I-21). `?buyer=<entitlement id>` asks
 *  for the purchase framing, and that framing is a claim — "I bought this" —
 *  so it is rendered only when the database agrees the entitlement is real and
 *  is for THIS publication. The entitlement id is the capability: owner-only
 *  RLS keeps it readable to its buyer alone, so nobody else can mint the card.
 *
 *  Fails CLOSED and silently — every not-verified path (a missing function
 *  because the migration has not been applied, a timeout, an unexpected body)
 *  answers false, and the caller then renders the publication's own card. So
 *  the worst case is a buyer's link previewing as the creator's card, never a
 *  broken preview and never an unverified claim. */
async function ownsPublication(url, key, entitlement, id) {
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/owns_publication`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_entitlement: entitlement, p_pub_id: id }),
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return false
    // Strictly `=== true`: the RPC answers a JSON boolean, and anything else
    // (an error object, a string) must not read as verified.
    return (await response.json()) === true
  } catch {
    return false
  }
}

/**
 * A card for a publication that does not exist (#362's hygiene item: the old
 * one emitted canonical and og:url for the very id that 404'd). Noindex and
 * no canonical — a shared typo must never be indexed under its own address —
 * and it lands the visitor on Explore rather than a dead end.
 */
function renderNotFound() {
  const origin = resolveOrigin()
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>Itinerary not found — YatraFlow</title>
<meta name="description" content="This itinerary could not be found. Explore published itineraries on YatraFlow." />
<meta property="og:site_name" content="YatraFlow" />
<meta property="og:title" content="Itinerary not found — YatraFlow" />
<meta property="og:description" content="This itinerary could not be found. Explore published itineraries on YatraFlow." />
<meta property="og:image" content="${escapeHtml(`${origin}/og-default.png`)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Itinerary not found — YatraFlow" />
<meta name="twitter:description" content="This itinerary could not be found. Explore published itineraries on YatraFlow." />
<meta name="twitter:image" content="${escapeHtml(`${origin}/og-default.png`)}" />
<script>location.replace(${JSON.stringify('/#/explore')})</script>
</head>
<body><p>Opening <a href="/#/explore">Explore</a>…</p></body>
</html>`
}

function renderPublication(publication, id, buyer = null, ref = null) {
  // A row the database could not read is a 404-without-canonical card, never
  // the brand card under the id it failed to find (#362).
  if (!publication) return renderNotFound()
  const origin = resolveOrigin()
  const title = publication?.title
    ? (buyer ? `I bought ${publication.title} — YatraFlow` : `${publication.title} — YatraFlow`)
    : DEFAULT_TITLE
  const facts = []
  if (publication?.duration_days) facts.push(`${publication.duration_days} days`)
  const budget = Number(publication?.estimated_budget_per_person_inr)
  if (Number.isFinite(budget) && budget > 0) facts.push(`₹${budget.toLocaleString('en-IN')}/person`)
  const route = publication?.route_summary
  if (Array.isArray(route)) facts.push(route.join(' → '))
  else if (typeof route === 'string' && route) facts.push(route)
  // A buyer's card leads with the fact that was verified and then the plan's
  // own numbers; the creator's tagline belongs on the creator's card. No
  // amount paid and no buyer's name — see the migration header.
  const description = buyer
    ? ['Bought on YatraFlow', ...facts].join(' · ')
    : (publication?.tagline || facts.join(' · ') || DEFAULT_DESCRIPTION)
  const cover = typeof publication?.cover_image_url === 'string' && /^https:\/\/\S+$/.test(publication.cover_image_url)
    ? sizedCover(publication.cover_image_url) : ''
  // A publication with no cover still needs a picture: without one the link
  // previews as a bare URL rather than a card. The fallback is the app's own
  // asset, and only in that case are its dimensions known and worth declaring.
  const image = cover || `${origin}/og-default.png`
  const imageTags = [
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    ...(cover ? [] : [
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
    ]),
  ].join('\n')
  // #230 — the shared link's `ref` rides the QUERY, never the hash (a fragment
  // never reaches anything) and never the canonical (the share card stays
  // clean). The redirect forwards it so the app can read `location.search` and
  // attribute the visit: `/?ref=…#/pub/…`. `ref` was sanitized at the handler —
  // only vocabulary values arrive here.
  const target = ref ? `/?ref=${encodeURIComponent(ref)}#/pub/${id}` : `/#/pub/${id}`
  const canonical = `${origin}/i/${id}`
  // The buyer's address is a variant of the same page with its own metadata, so
  // it advertises itself; the canonical link still points at the publication.
  const ogUrl = buyer ? `${canonical}?buyer=${encodeURIComponent(buyer)}` : canonical
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="YatraFlow" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(ogUrl)}" />
${imageTags}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(image)}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<script>location.replace(${JSON.stringify(target)})</script>
</head>
<body><p>Opening <a href="${escapeHtml(target)}">this itinerary</a>…</p></body>
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
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    // Two different failures, two different answers (#362): a bare `/i/` —
    // the rewrite forwards it without a query — is a missing page, so 404
    // rather than the app shell; a malformed id is a bad request.
    return res.status(id ? 400 : 404).end()
  }
  // A malformed `buyer` is IGNORED rather than rejected: a garbled parameter
  // must still preview as the publication, never as a dead link. Nothing is
  // rendered from it until the RPC above confirms it.
  const rawBuyer = req.query?.buyer
  const buyer = typeof rawBuyer === 'string' && UUID_RE.test(rawBuyer) ? rawBuyer : null
  // A malformed `ref` is DROPPED, same as `buyer`: an unknown value must not
  // reach the funnel log. This list mirrors src/lib/shareUrl.ts's SHARE_SOURCES
  // (this function is plain JS outside src and cannot import client code —
  // tests/share-attribution.test.ts pins the two lists to each other).
  const rawRef = req.query?.ref
  const ref = typeof rawRef === 'string' && SHARE_SOURCES.includes(rawRef) ? rawRef : null

  let publication = null
  let status = 503
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (url && key) {
    try {
      const response = await fetch(
        `${url.replace(/\/+$/, '')}/rest/v1/published_itineraries?id=eq.${encodeURIComponent(id)}` +
        '&select=id,title,tagline,route_summary,cover_image_url,duration_days,estimated_budget_per_person_inr&limit=1',
        {
          headers: { apikey: key, authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(4000),
        },
      )
      if (response.ok) {
        const rows = await response.json()
        if (Array.isArray(rows)) {
          publication = rows[0] ?? null
          status = publication ? 200 : 404
        }
      }
    } catch {
      status = 503
    }
  }
  // Verified only once the publication is known to exist, so a purchase claim
  // can never be rendered over a missing plan.
  let verifiedBuyer = null
  if (publication && buyer && url && key && (await ownsPublication(url, key, buyer, id))) {
    verifiedBuyer = buyer
  }

  res.status(status)
  return req.method === 'HEAD' ? res.end() : res.send(renderPublication(publication, id, verifiedBuyer, ref))
}
