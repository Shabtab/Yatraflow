import { existsSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const sitemapPath = '../api/sitemap.js'
const fetchMock = vi.fn<typeof fetch>()

// 2026-09-17T00:00:00Z — a fixed instant so the expected <lastmod> is a literal
// rather than the handler's own formatting fed back to itself.
const SEP_17_2026_MS = 1789603200000

function makeRes() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    ended: false,
    setHeader(key: string, value: string) { this.headers[key.toLowerCase()] = value },
    status(code: number) { this.statusCode = code; return this },
    send(body: string) { this.body = body; return this },
    end() { this.ended = true; return this },
  }
}

function respond(rows: unknown, status = 200) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(rows), { status }))
}

async function runHandler(method = 'GET') {
  const res = makeRes()
  const { default: handler } = await import(sitemapPath)
  await handler({ method }, res)
  return res
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example.test/')
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubEnv('PUBLIC_ORIGIN', undefined)
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', undefined)
  fetchMock.mockReset()
  fetchMock.mockRejectedValue(new Error('Unexpected fetch'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('robots.txt', () => {
  it('ships as a real file rather than relying on a 404', () => {
    expect(existsSync(new URL('../public/robots.txt', import.meta.url))).toBe(true)
  })

  it('allows the app, blocks the API and the map proxy, and points at the sitemap', () => {
    const robots = read('../public/robots.txt')
    expect(robots).toMatch(/^User-agent: \*$/m)
    expect(robots).toMatch(/^Allow: \/$/m)
    // The /i/<id> rewrite target: indexing it would duplicate every itinerary.
    expect(robots).toMatch(/^Disallow: \/api\/$/m)
    expect(robots).toMatch(/^Disallow: \/mappls\/$/m)
    expect(robots).toMatch(/^Sitemap: https:\/\/www\.yatraflow\.in\/sitemap\.xml$/m)
  })

  it('keeps the app-shell id-bearing paths out of the index (#426 slice 3)', () => {
    // The real paths serve the client-rendered shell — one shell per unbounded
    // id, nothing per-URL for a crawler to read. Blocking the crawl keeps the
    // tag-carrying cards (the sitemap's entries) as the only indexed surface;
    // a visitor is unaffected, robots binds crawlers and not people.
    // Exact-line membership, not a built RegExp: the rules are literals and
    // the guard must read them as bytes, the way a crawler does.
    const rules = read('../public/robots.txt').split('\n').map(l => l.trim())
    for (const prefix of ['/pub/', '/creator/', '/trip/', '/join/', '/created/', '/share/']) {
      expect(rules).toContain(`Disallow: ${prefix}`)
    }
  })

  it('does not try to disallow hash routes, which a crawler never sends', () => {
    // A fragment is not part of the request, so `Disallow: /#/trips` would be
    // inert. Guard against the rule being added later by someone who assumes
    // otherwise — the hash-routed screens are `/` and share the shell's rules.
    expect(read('../public/robots.txt')).not.toMatch(/Disallow:.*#/)
  })
})

describe('vercel.json', () => {
  it('routes /sitemap.xml to the sitemap handler and keeps the publication rewrite', () => {
    const config = JSON.parse(read('../vercel.json'))
    expect(config.rewrites).toContainEqual({ source: '/sitemap.xml', destination: '/api/sitemap' })
    expect(config.rewrites).toContainEqual({ source: '/i/:id', destination: '/api/i?id=:id' })
  })

  it('routes the creator card and the id-less publication path in the same change (#362)', () => {
    // A handler without its rewrite is an unreachable surface — the repo rule
    // both sitemap and i.js followed, and /c/<id> follows it here.
    const config = JSON.parse(read('../vercel.json'))
    expect(config.rewrites).toContainEqual({ source: '/c/:id', destination: '/api/c?id=:id' })
    // `/i/:id` does not match `/i/` (no id segment), so without this the bare
    // path served the app shell instead of the handler's 404.
    expect(config.rewrites).toContainEqual({ source: '/i/', destination: '/api/i' })
  })

  it('the handlers share one canonical-origin resolver (#362)', () => {
    // Four surfaces used to mint addresses and disagreed; the two handlers and
    // the creator card now read the same module, pinned by the import.
    for (const path of ['../api/i.js', '../api/sitemap.js', '../api/c.js']) {
      expect(read(path)).toMatch(/import \{ resolveOrigin \} from '\.\/_origin\.js'/)
    }
    expect(read('../api/_origin.js')).toMatch(/export function resolveOrigin\(/)
  })
})

describe('sitemap handler in node', () => {
  it('lists the shell and every publication as absolute URLs', async () => {
    respond([
      { id: 'kerala-trip_1', refreshed_at: null, published_at: SEP_17_2026_MS },
      { id: 'goa-north', refreshed_at: null, published_at: SEP_17_2026_MS },
    ])
    const res = await runHandler()
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/xml; charset=utf-8')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(res.body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(res.body).toContain('<loc>https://www.yatraflow.in/</loc>')
    expect(res.body).toContain('<loc>https://www.yatraflow.in/i/kerala-trip_1</loc>')
    expect(res.body).toContain('<loc>https://www.yatraflow.in/i/goa-north</loc>')
    expect(res.body.trimEnd().endsWith('</urlset>')).toBe(true)
  })

  it('reads the catalogue from the published-itineraries table', async () => {
    respond([])
    await runHandler()
    const [requested] = fetchMock.mock.calls[0] as [string]
    expect(String(requested)).toContain('/rest/v1/published_itineraries')
    expect(String(requested)).toContain('select=id,refreshed_at,published_at')
  })

  it('prefers refreshed_at over published_at, and falls back when it is null', async () => {
    const earlier = SEP_17_2026_MS - 86_400_000 // 2026-09-16
    respond([
      { id: 'refreshed', refreshed_at: SEP_17_2026_MS, published_at: earlier },
      { id: 'never-refreshed', refreshed_at: null, published_at: SEP_17_2026_MS },
    ])
    const res = await runHandler()
    expect(res.body).toContain('<loc>https://www.yatraflow.in/i/refreshed</loc>\n    <lastmod>2026-09-17</lastmod>')
    expect(res.body).toContain('<loc>https://www.yatraflow.in/i/never-refreshed</loc>\n    <lastmod>2026-09-17</lastmod>')
  })

  it('omits lastmod entirely rather than guessing when no timestamp is usable', async () => {
    respond([{ id: 'undated', refreshed_at: null, published_at: null }])
    const res = await runHandler()
    expect(res.body).toContain('<loc>https://www.yatraflow.in/i/undated</loc>')
    expect(res.body).not.toContain('<lastmod>')
  })

  it('skips rows whose id could not be a valid publication path', async () => {
    respond([
      { id: 'fine', refreshed_at: null, published_at: SEP_17_2026_MS },
      { id: 'has space', refreshed_at: null, published_at: SEP_17_2026_MS },
      { id: '', refreshed_at: null, published_at: SEP_17_2026_MS },
      { id: 42, refreshed_at: null, published_at: SEP_17_2026_MS },
    ])
    const res = await runHandler()
    expect(res.body).toContain('/i/fine')
    expect(res.body).not.toContain('has space')
    expect(res.body).not.toContain('has+space')
    expect((res.body.match(/<loc>/g) ?? []).length).toBe(2) // shell + one publication
  })

  it('serves the shell alone when the catalogue is genuinely empty', async () => {
    respond([])
    const res = await runHandler()
    expect(res.statusCode).toBe(200)
    expect((res.body.match(/<loc>/g) ?? []).length).toBe(1)
  })

  it('answers 503 rather than publishing a sitemap that omits every itinerary', async () => {
    // A valid-looking document listing only `/` would tell a crawler the
    // publications are gone. Unreachable must be distinguishable from empty.
    fetchMock.mockRejectedValue(new Error('network down'))
    const res = await runHandler()
    expect(res.statusCode).toBe(503)
    expect(res.body).toBe('')
  })

  it('answers 503 when the database credentials are absent', async () => {
    vi.stubEnv('SUPABASE_URL', undefined)
    vi.stubEnv('SUPABASE_ANON_KEY', undefined)
    const res = await runHandler()
    expect(res.statusCode).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches at the edge for an hour', async () => {
    respond([])
    const res = await runHandler()
    expect(res.headers['cache-control']).toContain('s-maxage=3600')
  })

  it('rejects writes and answers HEAD without a body', async () => {
    const post = await runHandler('POST')
    expect(post.statusCode).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')

    respond([])
    const head = await runHandler('HEAD')
    expect(head.statusCode).toBe(200)
    expect(head.body).toBe('')
    expect(head.ended).toBe(true)
  })

  it('honours PUBLIC_ORIGIN so preview deployments do not advertise production URLs', async () => {
    vi.stubEnv('PUBLIC_ORIGIN', 'https://preview.example.test/')
    respond([])
    const res = await runHandler()
    expect(res.body).toContain('<loc>https://preview.example.test/</loc>')
    expect(res.body).not.toContain('www.yatraflow.in')
  })

  it('escapes XML metacharacters in the origin instead of emitting raw markup', async () => {
    // The escape function is the only barrier between an env-provided origin and
    // malformed XML. Codacy reads its `[...]` lookup as a "Generic Object Injection
    // Sink"; this asserts the emitted document, which is what actually matters and
    // is narrower than the pattern that cannot see the character-class restriction.
    vi.stubEnv('PUBLIC_ORIGIN', 'https://ex.test/?a=1&b=<2>')
    respond([])
    const res = await runHandler()
    expect(res.body).toContain('<loc>https://ex.test/?a=1&amp;b=&lt;2&gt;/</loc>')
  })

  // #362 — the ceiling that was a comment instead of a fix, and the order that
  // buried updated classics.
  describe('pages past the 1000-row ceiling and orders by recency', () => {
    const PAGE = 1000
    const row = (id: string, publishedAt: number, refreshedAt: number | null = null) =>
      ({ id, published_at: publishedAt, refreshed_at: refreshedAt })

    it('keeps paging with a composite cursor until a short page, so row 1001 is listed', async () => {
      // Two full pages then a short one: the loop must issue three fetches and
      // emit all 1005 publications. A single-response mock would hide a
      // non-paging implementation, so each page is its own response.
      const first = Array.from({ length: PAGE }, (_, i) => row(`pub-${String(i).padStart(4, '0')}`, SEP_17_2026_MS - i))
      const second = Array.from({ length: PAGE }, (_, i) => row(`pub-b-${String(i).padStart(4, '0')}`, SEP_17_2026_MS - PAGE - i))
      const third = [row('pub-the-1001st', 1)]
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 200 }))
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(second), { status: 200 }))
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(third), { status: 200 }))
      const res = await runHandler()
      expect(res.statusCode).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(res.body).toContain('/i/pub-the-1001st')
      // shell + 1005 publications
      expect((res.body.match(/<loc>/g) ?? []).length).toBe(PAGE * 2 + 1 + 1)
    })

    it('the second page carries the cursor it was handed', async () => {
      const first = Array.from({ length: PAGE }, (_, i) => row(`pub-${i}`, SEP_17_2026_MS - i))
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 200 }))
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      await runHandler()
      const second = String((fetchMock.mock.calls[1] as [string])[0])
      // A composite cursor on (published_at, id): strictly-before on the pair,
      // so the boundary row is neither skipped nor revisited.
      expect(second).toContain('or=(published_at.lt.')
      expect(second).toContain('and(published_at.eq.')
      expect(second).toContain('id.lt.pub-999')
    })

    it('an updated classic resurfaces above a newer untouched publication', async () => {
      const older = SEP_17_2026_MS - 86_400_000 * 30
      const newer = SEP_17_2026_MS - 86_400_000
      respond([
        row('newer', newer),
        row('updated-classic', older, SEP_17_2026_MS),
      ])
      const res = await runHandler()
      expect(res.body.indexOf('/i/updated-classic')).toBeGreaterThan(-1)
      expect(res.body.indexOf('/i/updated-classic')).toBeLessThan(res.body.indexOf('/i/newer'))
      // lastmod still prefers the refreshed timestamp — unchanged contract.
      expect(res.body).toContain('<loc>https://www.yatraflow.in/i/updated-classic</loc>\n    <lastmod>2026-09-17</lastmod>')
    })

    it('lists a creator page per creator with publications, deduped and id-validated', async () => {
      const alice = '11111111-1111-4111-8111-111111111111'
      const bob = '22222222-2222-4222-8222-222222222222'
      respond([
        { id: 'p1', published_at: SEP_17_2026_MS, refreshed_at: null, creator_id: alice },
        { id: 'p2', published_at: SEP_17_2026_MS - 1, refreshed_at: null, creator_id: alice },
        { id: 'p3', published_at: SEP_17_2026_MS - 2, refreshed_at: null, creator_id: bob },
        { id: 'p4', published_at: SEP_17_2026_MS - 3, refreshed_at: null, creator_id: 'not-a-uuid' },
      ])
      const res = await runHandler()
      expect(res.body).toContain(`<loc>https://www.yatraflow.in/c/${alice}</loc>`)
      expect(res.body).toContain(`<loc>https://www.yatraflow.in/c/${bob}</loc>`)
      // One entry per creator, and nothing that would 400 at the handler.
      expect((res.body.match(new RegExp(`/c/${alice}`, 'g')) ?? []).length).toBe(1)
      expect(res.body).not.toContain('/c/not-a-uuid')
    })

    it('answers 503 when any page of the paged read fails', async () => {
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: PAGE }, (_, i) => row(`p${i}`, 1))), { status: 200 }))
      fetchMock.mockRejectedValueOnce(new Error('network down mid-page'))
      const res = await runHandler()
      expect(res.statusCode).toBe(503)
    })
  })
})

// #362 — the creator card handler. Executed, not string-matched: the repo rule
// is that a handler is pinned by running it, because the metadata is the
// product.
const creatorPath = '../api/c.js'
const CREATOR_ID = '11111111-1111-4111-8111-111111111111'

async function runCreator(query: Record<string, unknown> = { id: CREATOR_ID }, method = 'GET') {
  const res = makeRes()
  const { default: handler } = await import(creatorPath)
  await handler({ method, query }, res)
  return res
}

function creatorProfileResponse(name = 'Asha Menon', bio = 'Slow travel across the Western Ghats') {
  return new Response(JSON.stringify([{ name, creator_bio: bio }]), { status: 200 })
}

function countResponse(total: number) {
  return new Response(null, {
    status: 200,
    headers: { 'content-range': `0-0/${total}` },
  })
}

describe('creator card handler in node', () => {
  it('serves the creator card with the profile read, then redirects to the hash route', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(creatorProfileResponse())
    fetchMock.mockResolvedValueOnce(countResponse(3))
    const res = await runCreator()
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.body).toContain('<title>Asha Menon on YatraFlow</title>')
    expect(res.body).toContain('Slow travel across the Western Ghats')
    expect(res.body).toContain('3 published itineraries')
    // #426 slice 3: the hand-off targets the app page's real path.
    expect(res.body).toContain(`location.replace("/creator/${CREATOR_ID}")`)
    expect(res.body).toContain(`<link rel="canonical" href="https://www.yatraflow.in/c/${CREATOR_ID}"`)
    expect(res.body).toContain('og:url" content="https://www.yatraflow.in/c/')
    // The count is the exact-count HEAD, not the profile rows.
    const second = fetchMock.mock.calls[1] as [string, { method?: string }]
    expect(String(second[0])).toContain('creator_id=eq.')
    expect(second[1]?.method).toBe('HEAD')
  })

  it('falls back to the publication count in the description when there is no bio', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(creatorProfileResponse('Ravi', ''))
    fetchMock.mockResolvedValueOnce(countResponse(1))
    const res = await runCreator()
    expect(res.statusCode).toBe(200)
    // The description is the count, and the body line names the creator with it.
    expect(res.body).toContain('1 published itinerary')
    expect(res.body).toContain('Ravi — 1 published itinerary')
  })

  it('says "new" rather than guessing when the count header is absent', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(creatorProfileResponse())
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    const res = await runCreator()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('New to YatraFlow')
  })

  it('escapes profile-controlled text instead of emitting raw markup', async () => {
    // The behavioural pin for what Codacy's taint rules gesture at in
    // api/c.js (see .codacy.yml): the name and bio are the only user data the
    // card renders, and they go through the escaper. This asserts the EMITTED
    // document, which is what actually matters and is narrower than the pattern
    // that cannot see the escape call — the same argument the sitemap's origin
    // escaping pin makes.
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(creatorProfileResponse('<script>alert(1)</script> & "friends"', 'bio with <b>markup</b> & \'quotes\''))
    fetchMock.mockResolvedValueOnce(countResponse(2))
    const res = await runCreator()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;friends&quot;')
    expect(res.body).toContain('bio with &lt;b&gt;markup&lt;/b&gt; &amp; &#39;quotes&#39;')
    expect(res.body).not.toContain('<script>alert(1)</script>')
  })

  it('answers 404 — a card, not a blank — for an unknown creator', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    const res = await runCreator()
    expect(res.statusCode).toBe(404)
    expect(res.ended).toBe(true)
  })

  it('answers 503 when the profile read fails, and never fetches the count', async () => {
    fetchMock.mockReset()
    fetchMock.mockRejectedValue(new Error('network down'))
    const res = await runCreator()
    expect(res.statusCode).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('answers 404 for a malformed id and 404 for the bare /c/ path, without fetch', async () => {
    const malformed = await runCreator({ id: 'two words' })
    expect(malformed.statusCode).toBe(400)
    const bare = await runCreator({ id: undefined })
    expect(bare.statusCode).toBe(404)
    const array = await runCreator({ id: ['one'] })
    expect(array.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 405 for writes and HEAD without a body', async () => {
    const post = await runCreator({ id: CREATOR_ID }, 'POST')
    expect(post.statusCode).toBe(405)
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(creatorProfileResponse())
    fetchMock.mockResolvedValueOnce(countResponse(2))
    const head = await runCreator({ id: CREATOR_ID }, 'HEAD')
    expect(head.statusCode).toBe(200)
    expect(head.body).toBe('')
    expect(head.ended).toBe(true)
  })

  it('honours PUBLIC_ORIGIN for the canonical, like the other handlers', async () => {
    vi.stubEnv('PUBLIC_ORIGIN', 'https://preview.example.test/')
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(creatorProfileResponse())
    fetchMock.mockResolvedValueOnce(countResponse(2))
    const res = await runCreator()
    expect(res.body).toContain(`rel="canonical" href="https://preview.example.test/c/${CREATOR_ID}"`)
    expect(res.body).not.toContain('www.yatraflow.in')
  })
})
