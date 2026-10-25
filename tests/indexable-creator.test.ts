import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREATOR_PAGE_CLASS, CREATOR_PAGE_STYLE, creatorJsonLd, renderCreatorBody } from '../api/_creatorBody.js'
import handler from '../api/c.js'
import { SHARE_SOURCES } from '../src/lib/shareUrl'

const ID = '11111111-1111-4111-8111-111111111111'
const profile = {
  name: 'Asha Menon', creator_bio: 'Slow travel across Kerala',
  email: 'private@example.test', payout_details: 'PRIVATE_BANK',
  earnings: 'PRIVATE_EARNINGS', ai_api_key: 'PRIVATE_API_KEY',
}
const publication = {
  id: 'kerala-1', title: 'Kerala by road', tagline: 'Tea hills and coast',
  trip_id: 'PRIVATE_TRIP_ID', sales: 'PRIVATE_SALES', days: [{ notes: 'PRIVATE_NOTES' }],
}
const fetchMock = vi.fn<typeof fetch>()
const response = (rows: unknown) => new Response(JSON.stringify(rows))

function res() {
  return {
    statusCode: 0, body: '', ended: false, headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this.headers[key.toLowerCase()] = value },
    status(code: number) { this.statusCode = code; return this },
    send(body: string) { this.body = body; return this },
    end() { this.ended = true; return this },
  }
}

async function run(query: Record<string, unknown> = {}, method = 'GET') {
  const result = res()
  await handler({ method, query: { id: ID, ...query } }, result)
  return result
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example.test')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key')
  vi.stubEnv('PUBLIC_ORIGIN', 'https://app.example.test')
  fetchMock.mockReset()
  fetchMock.mockRejectedValue(new Error('Unexpected fetch'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function respond(rows: unknown = [publication], card: unknown = profile) {
  fetchMock.mockResolvedValueOnce(response([card]))
  fetchMock.mockResolvedValueOnce(response(rows))
}

describe('readable creator page', () => {
  it('prints only public fields in HTML and ProfilePage data', async () => {
    respond()
    const result = await run()
    expect(result.statusCode).toBe(200)
    expect(result.body).toContain('<h1>Asha Menon</h1>')
    expect(result.body).toContain('<p>Slow travel across Kerala</p>')
    expect(result.body).toContain('<a href="/i/kerala-1">Kerala by road</a>')
    expect(result.body).not.toContain('location.replace(')
    expect(result.body).not.toMatch(/private@example|PRIVATE_/)
    const data = JSON.parse(result.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1])
    expect(data).toEqual({
      '@context': 'https://schema.org', '@type': 'ProfilePage',
      url: `https://app.example.test/c/${ID}`,
      mainEntity: {
        '@type': 'Person', name: profile.name, description: profile.creator_bio,
        url: `https://app.example.test/c/${ID}`,
      },
    })
    expect(data).not.toHaveProperty('aggregateRating')
    expect(data).not.toHaveProperty('offers')
  })

  it('reads the creator card through the public RPC with the anon key', async () => {
    // #800: the card no longer reads `profiles` directly. The private table is
    // self-plus-admin only, so a direct anon read would answer 42501 for every
    // creator — the typed public RPC is the only path, and its allowlist is what
    // keeps this endpoint from widening.
    respond()
    await run()
    const [profileCall, publicationCall] = fetchMock.mock.calls
    const profileUrl = new URL(String(profileCall[0]))
    expect(profileUrl.pathname).toBe('/rest/v1/rpc/get_public_profile_cards')
    expect(profileCall[1]?.method).toBe('POST')
    expect(JSON.parse(String(profileCall[1]?.body))).toEqual({ p_ids: [ID] })
    const url = new URL(String(publicationCall[0]))
    expect(url.searchParams.get('select')).toBe('id,title,tagline')
    expect(url.searchParams.get('creator_id')).toBe(`eq.${ID}`)
    expect(url.searchParams.get('unpublished_at')).toBe('is.null')
    for (const [call, init] of fetchMock.mock.calls) {
      const isRpc = String(call).includes('/rpc/')
      expect(init?.headers).toEqual(isRpc
        ? { apikey: 'anon-test-key', authorization: 'Bearer anon-test-key', 'content-type': 'application/json' }
        : { apikey: 'anon-test-key', authorization: 'Bearer anon-test-key' })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it.each(SHARE_SOURCES)('keeps the %s share handoff and clean canonical', async ref => {
    respond()
    const { body } = await run({ ref })
    expect(body).toContain(`location.replace("/creator/${ID}?ref=${ref}")`)
    expect(body).toContain(`rel="canonical" href="https://app.example.test/c/${ID}"`)
    expect(body).toContain('<h1>Asha Menon</h1>')
  })

  it.each(['unknown', '</script><script>bad()</script>', ['copy'], ''])('drops an invalid share tag %s', async ref => {
    respond()
    const { body } = await run({ ref })
    expect(body).not.toContain('location.replace(')
    expect(body).not.toContain('?ref=')
  })

  it('keeps a successful empty catalogue distinct from a failed read', async () => {
    respond([])
    const result = await run()
    expect(result.body).toContain('No itineraries published yet.')
    expect(result.body).not.toContain('could not be loaded')
    expect(result.headers['cache-control']).toContain('s-maxage=300')
  })

  it.each(['http', 'network', 'shape', 'json'])('keeps a %s catalogue failure uncached', async failure => {
    fetchMock.mockResolvedValueOnce(response([profile]))
    if (failure === 'http') fetchMock.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    if (failure === 'shape') fetchMock.mockResolvedValueOnce(response({ error: 'bad shape' }))
    if (failure === 'json') fetchMock.mockResolvedValueOnce(new Response('invalid json'))
    const result = await run()
    expect(result.body).toContain('<h1>Asha Menon</h1>')
    expect(result.body).toContain('Published itineraries could not be loaded')
    expect(result.body).not.toContain('No itineraries published yet')
    expect(result.body).not.toContain('New to YatraFlow')
    expect(result.headers['cache-control']).toBe('no-store')
  })

  it('pages beyond 1000 publications without losing the last itinerary', async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({ id: `p${String(index).padStart(4, '0')}`, title: `Trip ${index}` }))
    respond(rows)
    fetchMock.mockResolvedValueOnce(response([publication]))
    const result = await run()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('id')).toBe('gt.p0999')
    expect(result.body).toContain('1001 published itineraries')
    expect(result.body).toContain('href="/i/kerala-1"')
  })

  it('discards a partial catalogue if a later page fails', async () => {
    respond(Array.from({ length: 1000 }, (_, index) => ({ id: `p${index}`, title: 'A trip' })))
    const result = await run()
    expect(result.body).toContain('could not be loaded')
    expect(result.body).not.toContain('1000 published itineraries')
    expect(result.headers['cache-control']).toBe('no-store')
  })

  it('refuses a disabled creator rather than serving a cacheable public page', async () => {
    // #800: a disabled account keeps its public identity card for crews it already
    // belongs to, so the RPC still returns a row — with `creator_available:false`.
    // This route must not turn that into a public creator page that names them.
    respond([publication], { ...profile, name: 'Disabled synthetic creator', creator_available: false })
    const result = await run()
    expect(result.statusCode).toBe(404)
    expect(result.body).not.toContain('Disabled synthetic creator')
    expect(result.body).not.toContain(profile.creator_bio)
    expect(result.headers['cache-control']).toBe('no-store')
  })

  it('still serves a former creator whose badge is gone but who is enabled', async () => {
    // The suppression reads availability, not the creator badge: a former creator
    // with live publications must stay listable once re-enabled.
    respond([publication], { ...profile, is_creator: false, creator_available: true })
    const result = await run()
    expect(result.statusCode).toBe(200)
    expect(result.body).toContain('<h1>Asha Menon</h1>')
  })

  it('keeps nameless profiles noindex with no canonical or public body', async () => {
    fetchMock.mockResolvedValueOnce(response([{ ...profile, name: ' ' }]))
    fetchMock.mockResolvedValueOnce(response([]))
    const result = await run()
    expect(result.body).toContain('name="robots" content="noindex"')
    expect(result.body).not.toContain('rel="canonical"')
    expect(result.body).not.toContain('application/ld+json')
    expect(result.body).not.toContain(profile.creator_bio)
    expect(result.headers['cache-control']).toBe('no-store')
  })

  it('answers HEAD with matching cache headers and no body', async () => {
    respond()
    const result = await run({}, 'HEAD')
    expect(result.statusCode).toBe(200)
    expect(result.body).toBe('')
    expect(result.ended).toBe(true)
    expect(result.headers['cache-control']).toContain('s-maxage=300')
  })
})

describe('hostile public text', () => {
  it('escapes HTML and closes no JSON-LD script with user text', () => {
    const hostile = '</script><script>alert("x")</script>'
    const row = { ...profile, name: hostile, creator_bio: hostile }
    const body = renderCreatorBody(row, [{ ...publication, title: hostile, tagline: hostile }], '/creator/test')
    expect(body).not.toContain('<script>')
    expect(body).toContain('&lt;/script&gt;')
    const json = creatorJsonLd(row, 'https://app.example.test/c/test')
    expect(json).not.toContain('</script>')
    expect(JSON.parse(json).mainEntity.name).toBe(hostile)
  })

  it('omits malformed itinerary links and private fields', () => {
    const body = renderCreatorBody(profile, [
      { ...publication, id: '"><script>bad()</script>' },
      { ...publication, id: '../../private' },
      { ...publication, title: '' }, null,
    ], '/creator/test')
    expect(body).not.toContain('<li>')
    expect(body).not.toMatch(/private@example|PRIVATE_|<script>/)
  })
})

// #701 follow-up: the card is user-facing, so its links are 44px targets and its
// text wraps. The card loads no app stylesheet, so it ships its own small block.
describe('creator card stylesheet', () => {
  const styleBlock = /<style>([^<]*)<\/style>/

  // Bounded string parsing, not a RegExp built from a variable. The selector and
  // the property name are fixed strings. A dynamic pattern buys nothing and reads
  // as pattern injection to the SAST pass. `split` is the honest instrument for
  // "which rule, which declaration", with the same reasoning as
  // tests/publish-rules.test.ts. A selector compared as text is also stricter
  // than a pattern. A drifted selector fails here instead of matching loosely.
  const ruleFor = (css: string, selector: string): string | null => {
    for (const chunk of css.split('}')) {
      const brace = chunk.indexOf('{')
      if (brace < 0) continue
      if (chunk.slice(0, brace).trim() === selector) return chunk.slice(brace + 1)
    }
    return null
  }

  const pxValueOf = (declarations: string, property: string): number | null => {
    for (const declaration of declarations.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      if (declaration.slice(0, colon).trim() !== property) continue
      const value = declaration.slice(colon + 1).trim()
      if (!/^\d+(\.\d+)?px$/.test(value)) return null
      return Number(value.slice(0, -2))
    }
    return null
  }

  it('ships one style block in the head and none in the body', async () => {
    respond()
    const { body } = await run()
    const headEnd = body.indexOf('</head>')
    expect(headEnd).toBeGreaterThan(-1)
    expect(body.slice(0, headEnd)).toContain(`<style>${CREATOR_PAGE_STYLE}</style>`)
    expect(body.slice(headEnd)).not.toContain('<style>')
    expect((body.match(/<style>/g) ?? []).length).toBe(1)
  })

  it('scopes every rule to the class the body element wears', async () => {
    respond()
    const { body } = await run()
    expect(body).toContain(`<main class="${CREATOR_PAGE_CLASS}">`)
    const css = body.match(styleBlock)![1]
    for (const rule of [`.${CREATOR_PAGE_CLASS}{`, `.${CREATOR_PAGE_CLASS} *{`, `.${CREATOR_PAGE_CLASS} a{`]) {
      expect(css).toContain(rule)
    }
    // A bare element selector would leak the card's rules into any other card.
    expect(css).not.toMatch(/(^|[}]) *(main|h1|h2|h3|p|a|ul|li)[{ ,]/)
  })

  it('declares the readable measure and the 44px target rules', async () => {
    respond()
    const { body } = await run()
    const css = body.match(styleBlock)![1]
    for (const declaration of [
      'box-sizing:border-box', 'max-width:65ch', 'margin:0 auto', 'padding:16px',
      'overflow-wrap:anywhere', 'display:inline-flex', 'align-items:center',
      'min-height:44px', 'min-width:44px', 'max-width:100%', 'white-space:normal',
    ]) {
      expect(css).toContain(declaration)
    }
  })

  // The Gate's P2. A height-only floor let a one-word title shrink to 33px wide.
  // The anchor rule must floor BOTH axes at 44px, and nothing may cancel the
  // width floor.
  it('gives each anchor a floor of at least 44px in both directions', async () => {
    respond()
    const { body } = await run()
    const css = body.match(styleBlock)![1]
    const declarations = ruleFor(css, `.${CREATOR_PAGE_CLASS} a`)
    expect(declarations, `no exact rule for .${CREATOR_PAGE_CLASS} a`).not.toBeNull()
    const minWidth = pxValueOf(declarations!, 'min-width')
    const minHeight = pxValueOf(declarations!, 'min-height')
    expect(minWidth, 'the anchor rule declares no px min-width').not.toBeNull()
    expect(minHeight, 'the anchor rule declares no px min-height').not.toBeNull()
    expect(minWidth!).toBeGreaterThanOrEqual(44)
    expect(minHeight!).toBeGreaterThanOrEqual(44)
    // A zero or missing width floor is the exact defect this test exists for.
    expect(declarations!).not.toMatch(/min-width:\s*0(?:px)?(?:;|$)/)
    // The maximum and the wrap rule must survive the wider floor.
    expect(declarations!).toContain('max-width:100%')
    expect(declarations!).toContain('white-space:normal')
  })

  it('keeps the class on the fragment and the stylesheet out of it', () => {
    const body = renderCreatorBody(profile, [publication], '/creator/test')
    expect(body).toContain(`<main class="${CREATOR_PAGE_CLASS}">`)
    expect(body).not.toContain('<style')
    expect(body).not.toContain('</style>')
  })

  it('delivers the stylesheet to the noindex fallback, so its Explore link is a target', async () => {
    fetchMock.mockResolvedValueOnce(response([{ ...profile, name: ' ' }]))
    fetchMock.mockResolvedValueOnce(response([]))
    const result = await run()
    expect(result.body).toContain(`<style>${CREATOR_PAGE_STYLE}</style>`)
    expect(result.body).toContain(`<main class="${CREATOR_PAGE_CLASS}">`)
    expect(result.body).toContain('<a href="/explore">Explore</a>')
    expect(result.body).not.toContain('rel="canonical"')
  })

  it('keeps user text out of the stylesheet and closes no tag with it', async () => {
    const hostile = 'x{color:red}</style><style>p{display:none}'
    fetchMock.mockResolvedValueOnce(response([{ ...profile, name: hostile }]))
    fetchMock.mockResolvedValueOnce(response([]))
    const result = await run()
    expect(result.body.match(styleBlock)![1]).toBe(CREATOR_PAGE_STYLE)
    expect((result.body.match(/<style>/g) ?? []).length).toBe(1)
    expect(result.body).not.toContain('<style>p{display:none}')
    // The hostile text is escaped, so it cannot close the real style element.
    expect(result.body).toContain('<h1>x{color:red}&lt;/style&gt;&lt;style&gt;p{display:none}</h1>')
  })
})
