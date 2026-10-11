// The readable body of a published itinerary's share page (/i/<id>), and its
// structured data (#691). Pure: no I/O, no environment, so a test can feed it
// a hostile trip and read the HTML it would send.
//
// The trip arrives from the anonymous `get_public_trip` RPC. The database
// already stubs locked days, and this module is the second lock: it decides
// which days are free from the PUBLICATION's own fields and prints a locked
// day as its title and nothing else. Anything it does not understand is
// locked. It never prints notes, times, costs, links or place ids.

export const LOCKED_MARKER = 'Locked —'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function text(value, max = 600) {
  if (typeof value !== 'string') return ''
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${Array.from(clean).slice(0, max - 1).join('')}…` : clean
}

/** The set of day indexes a stranger may read in full.
 *  An unpriced publication is free as a whole. A priced one, or one whose
 *  price field is missing, shows only the days its free list names. */
export function freeDaySet(publication) {
  const priceKnown = publication && 'premium_price_inr' in publication
  if (priceKnown && publication.premium_price_inr === null) return 'all'
  const list = publication?.free_day_indexes
  if (!Array.isArray(list)) return new Set()
  return new Set(list.filter(value => Number.isInteger(value) && value >= 0))
}

/** Split the trip's days into the parts the page prints.
 *  A free day that still carries the database's locked marker is demoted. */
export function planBody(publication, trip) {
  const days = Array.isArray(trip?.days) ? trip.days : []
  const free = freeDaySet(publication)
  return days.map((day, position) => {
    const stops = Array.isArray(day?.stops) ? day.stops : []
    const index = Number.isInteger(day?.index) ? day.index : null
    const stubbed = stops.some(stop => text(stop?.description).startsWith(LOCKED_MARKER))
    const open = index !== null && !stubbed && (free === 'all' || free.has(index))
    return {
      number: position + 1,
      title: text(day?.title, 160),
      open,
      stops: open
        ? stops.map(stop => ({
            title: text(stop?.title, 160),
            place: text(stop?.locationName, 160),
            description: text(stop?.description, 600),
          })).filter(stop => stop.title)
        : [],
    }
  })
}

export function renderBodyHTML(publication, trip, appHref) {
  const parts = planBody(publication, trip)
  const heading = escapeHtml(text(publication?.title, 200))
  const lead = text(publication?.tagline, 300)
  const facts = []
  if (Number.isFinite(Number(publication?.duration_days)) && Number(publication.duration_days) > 0) {
    facts.push(Number(publication.duration_days) === 1 ? '1 day' : `${Number(publication.duration_days)} days`)
  }
  const route = publication?.route_summary
  const routeText = Array.isArray(route) ? route.map(item => text(item, 80)).filter(Boolean).join(' → ') : text(route, 300)
  if (routeText) facts.push(routeText)
  const dayHtml = parts.map(part => {
    const name = part.title ? `Day ${part.number}: ${escapeHtml(part.title)}` : `Day ${part.number}`
    if (!part.open) {
      return `<section><h2>${name}</h2><p>The full plan for this day is in the app.</p></section>`
    }
    const items = part.stops.map(stop => {
      const place = stop.place && stop.place !== stop.title ? ` <span>(${escapeHtml(stop.place)})</span>` : ''
      const detail = stop.description ? `<p>${escapeHtml(stop.description)}</p>` : ''
      return `<li><h3>${escapeHtml(stop.title)}${place}</h3>${detail}</li>`
    }).join('')
    return `<section><h2>${name}</h2>${items ? `<ol>${items}</ol>` : ''}</section>`
  }).join('\n')
  return `<main>
<h1>${heading}</h1>
${lead ? `<p>${escapeHtml(lead)}</p>` : ''}
${facts.length ? `<p>${escapeHtml(facts.join(' · '))}</p>` : ''}
${dayHtml}
<p><a href="${escapeHtml(appHref)}">Open this itinerary in the YatraFlow app</a></p>
</main>`
}

/** schema.org TouristTrip. No rating, no offer, no price: the page claims
 *  nothing it cannot show. Only open days contribute stops. */
export function touristTripJsonLd(publication, trip, canonical) {
  const parts = planBody(publication, trip)
  const stops = parts.filter(part => part.open).flatMap(part => part.stops.map(stop => stop.title))
  const data = {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: text(publication?.title, 200),
    url: canonical,
    inLanguage: 'en-IN',
  }
  const lead = text(publication?.tagline, 300)
  if (lead) data.description = lead
  if (stops.length) {
    data.itinerary = {
      '@type': 'ItemList',
      itemListElement: stops.slice(0, 40).map((name, position) => ({
        '@type': 'ListItem', position: position + 1, name,
      })),
    }
  }
  // `<` is escaped so no value can close the script element.
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
