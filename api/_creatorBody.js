// Pure public-profile rendering. Select fields explicitly, even from wider rows.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

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
  return `<main>
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
