// Pure public-profile rendering. Select fields explicitly, even from wider rows.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

// The one class that scopes the creator card stylesheet. api/c.js writes the
// <style> block into the document head. This module owns the class name and the
// element that wears it, so the selector and the markup cannot drift apart.
export const CREATOR_PAGE_CLASS = 'yf-creator-page'

// The public card carries its own small stylesheet. The card is a raw document
// for crawlers. It loads no app bundle and no app stylesheet, so it must not
// depend on src/styles.css or on a design token.
//   - a 65ch measure, centred, 16px padding, and border-box sizing
//   - overflow-wrap: anywhere, so one unbroken handle cannot scroll the page
//   - each anchor is a 44px target that still wraps its own long text
export const CREATOR_PAGE_STYLE = [
  `.${CREATOR_PAGE_CLASS}{box-sizing:border-box;max-width:65ch;margin:0 auto;padding:16px;overflow-wrap:anywhere}`,
  `.${CREATOR_PAGE_CLASS} *{box-sizing:border-box;overflow-wrap:anywhere}`,
  `.${CREATOR_PAGE_CLASS} a{display:inline-flex;align-items:center;min-height:44px;min-width:0;max-width:100%;white-space:normal}`,
].join('')

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function renderCreatorBody(profile, publications, appHref) {
  const name = escapeHtml(text(profile?.name))
  const bio = text(profile?.creator_bio)
  const items = (publications ?? []).flatMap(publication => {
    const id = publication?.id
    const title = text(publication?.title)
    if (typeof id !== 'string' || !ID_RE.test(id) || !title) return []
    const tagline = text(publication?.tagline)
    return [`<li><h3><a href="/i/${encodeURIComponent(id)}">${escapeHtml(title)}</a></h3>` +
      `${tagline ? `<p>${escapeHtml(tagline)}</p>` : ''}</li>`]
  })
  const catalogue = publications === null
    ? '<p>Published itineraries could not be loaded. Open the app to try again.</p>'
    : items.length ? `<ul>${items.join('\n')}</ul>` : '<p>No itineraries published yet.</p>'
  return `<main class="${CREATOR_PAGE_CLASS}">
<h1>${name}</h1>
${bio ? `<p>${escapeHtml(bio)}</p>` : ''}
<h2>Published itineraries</h2>
${catalogue}
<p><a href="${escapeHtml(appHref)}">Open this creator in the YatraFlow app</a></p>
</main>`
}

export function creatorJsonLd(profile, canonical) {
  const person = { '@type': 'Person', name: text(profile?.name), url: canonical }
  const bio = text(profile?.creator_bio)
  if (bio) person.description = bio
  // Escape script delimiters in user text. JSON is not HTML attribute text.
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: canonical,
    mainEntity: person,
  }).replace(/</g, '\\u003c')
}
