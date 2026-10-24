// The one entity table for the HTML and XML that the api/ handlers write.
// escapeHtml writes &#39; for an apostrophe. escapeXml writes &apos;.
// Both functions read the same table, so they cannot drift apart.

// A Map, not an object: a lookup by .get() is not an object-injection sink.
const HTML_ENTITIES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
])

// XML differs from HTML in one entry: the apostrophe.
const XML_ENTITIES = new Map(HTML_ENTITIES).set("'", '&apos;')

function escapeWith(table, value) {
  return String(value).replace(/[&<>"']/g, character => table.get(character))
}

export function escapeHtml(value) {
  return escapeWith(HTML_ENTITIES, value)
}

export function escapeXml(value) {
  return escapeWith(XML_ENTITIES, value)
}
