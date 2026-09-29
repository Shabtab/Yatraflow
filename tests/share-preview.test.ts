import { existsSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const apiPath = '../api/i.js'
const shareUrlPath = '../src/lib/shareUrl.ts'
const fetchMock = vi.fn<typeof fetch>()
const publication = {
  id: 'kerala-trip_1',
  title: 'Tom & Jerry\'s "Monsoon" Escape',
  tagline: 'Kochi & back via "Munnar" tea hills',
  route_summary: ['Kochi', 'Munnar'],
  duration_days: 5,
  estimated_budget_per_person_inr: 12500,
}

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

async function runHandler(
  method = 'GET',
  id: unknown = publication.id,
  extra: Record<string, unknown> = {},
) {
  const res = makeRes()
  const { default: handler } = await import(apiPath)
  await handler({ method, query: { id, ...extra } }, res)
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

describe('share preview handler in node', () => {
  it('renders publication-specific metadata and escapes benign ampersands and quotes', async () => {
    respond([publication])
    const res = await runHandler()
    const title = 'Tom &amp; Jerry&#39;s &quot;Monsoon&quot; Escape — YatraFlow'
    const description = 'Kochi &amp; back via &quot;Munnar&quot; tea hills'
    const canonical = `https://yatraflow-blond.vercel.app/i/${publication.id}`
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body).toContain(`<title>${title}</title>`)
    for (const property of ['og:title', 'twitter:title']) {
      expect(res.body).toContain(`${property}" content="${title}"`)
    }
    for (const property of ['description', 'og:description', 'twitter:description']) {
      expect(res.body).toContain(`${property}" content="${description}"`)
    }
    expect(res.body).toContain(`og:url" content="${canonical}"`)
    expect(res.body).toContain(`<link rel="canonical" href="${canonical}"`)
    expect(res.body).toContain(`location.replace("/#/pub/${publication.id}")`)
    expect(res.body).toContain(`href="/#/pub/${publication.id}"`)
    // No cover on this row, so the app's own asset has to carry the card.
    const fallback = 'https://yatraflow-blond.vercel.app/og-default.png'
    expect(res.body).toContain(`og:image" content="${fallback}"`)
    expect(res.body).toContain(`twitter:image" content="${fallback}"`)
    expect(res.body).toContain('og:image:width" content="1200"')
    expect(res.body).toContain('og:image:height" content="630"')
    expect(res.body).toContain('twitter:card" content="summary_large_image"')
  })

  it('uses duration, Indian-formatted budget and array route facts without a tagline', async () => {
    respond([{ ...publication, tagline: null }])
    const res = await runHandler()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('content="5 days · ₹12,500/person · Kochi → Munnar"')
  })

  it('supports a string route summary', async () => {
    respond([{ ...publication, tagline: '', route_summary: 'Delhi & Agra' }])
    expect((await runHandler()).body).toContain('5 days · ₹12,500/person · Delhi &amp; Agra')
  })

  it('includes an optional https cover in Open Graph and Twitter metadata', async () => {
    respond([{ ...publication, cover_image_url: 'https://images.example.test/cover.jpg?width=800&height=400' }])
    const res = await runHandler()
    for (const property of ['og:image', 'twitter:image']) {
      expect(res.body).toContain(`${property}" content="https://images.example.test/cover.jpg?width=800&amp;height=400"`)
    }
    expect(res.body).toContain('twitter:card" content="summary_large_image"')
    // A cover's own dimensions are unknown, so none are declared for it.
    expect(res.body).not.toContain('og:image:width')
    expect(res.body).not.toContain('og:image:height')
  })

  it('sizes a Wikimedia cover through the redirect instead of shipping the raw upload', async () => {
    // The one live publication with a cover carried the unscaled upload
    // (`...?utm_content=thumbnail_unscaled`, 1.3 MB) because the picker only
    // started sizing later. The client sizes the same URL on the display path
    // and the handler cannot import it, so the rule is duplicated — this pins
    // the duplication, including the `thumb/` and subdomain handling.
    respond([{
      ...publication,
      cover_image_url: 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Chandratal_1.JPG?utm_source=en.wikipedia.org&utm_content=thumbnail_unscaled',
    }])
    const res = await runHandler()
    expect(res.body).toContain('og:image" content="https://commons.wikimedia.org/wiki/Special:Redirect/file/Chandratal_1.JPG?width=1200"')
    expect(res.body).not.toContain('upload.wikimedia.org')
    // twitter:image carries the same sized URL, not the raw one.
    expect(res.body).toContain('twitter:image" content="https://commons.wikimedia.org/wiki/Special:Redirect/file/Chandratal_1.JPG?width=1200"')
  })

  it('serves an uploaded cover exactly as stored, adding nothing to it', async () => {
    // The join between the cover uploader and this handler. A photo taken from a
    // phone is already re-encoded to a 1200px JPEG by the client before it lands
    // in our own bucket, so this handler must pass that URL through untouched —
    // the same rule as any other non-Wikimedia host, but this is the one URL
    // shape our own upload path produces, and rewriting or re-sizing it would
    // break the newest covers while every older one kept working. The URL below
    // is the measured shape of a live upload (served at 200 / image/jpeg /
    // 77,818 bytes from a 1,335,523-byte original).
    const uploaded = 'https://hqlqbfpzjmailxydjojw.supabase.co/storage/v1/object/public/covers/d507b604-1f89-46bd-b793-3d0bd67bbd2f/d2g9huw8g9dp.jpg'
    respond([{ ...publication, cover_image_url: uploaded }])
    const res = await runHandler()
    expect(res.body).toContain(`og:image" content="${uploaded}"`)
    expect(res.body).toContain(`twitter:image" content="${uploaded}"`)
    // No Wikimedia hop is invented for it, and our bucket host is not rewritten.
    expect(res.body).not.toContain('Special:Redirect')
    expect(res.body).not.toContain('upload.wikimedia.org')
  })

  it('leaves an already-sized Wikimedia redirect and other hosts alone', async () => {
    respond([{ ...publication, cover_image_url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Chandratal_1.JPG?width=1200' }])
    expect((await runHandler()).body).toContain('og:image" content="https://commons.wikimedia.org/wiki/Special:Redirect/file/Chandratal_1.JPG?width=1200"')
    // An already-thumbed path keeps the file but re-asks at our width, and a
    // non-commons project redirects through its own host.
    respond([{ ...publication, cover_image_url: 'https://upload.wikimedia.org/wikipedia/en/thumb/1/23/Foo.png/800px-Foo.png?x=1' }])
    expect((await runHandler()).body).toContain('https://en.wikipedia.org/wiki/Special:Redirect/file/Foo.png?width=1200')
  })

  it.each([undefined, null, '', 'http://images.example.test/cover.jpg'])(
    'falls back to the default card for a missing or non-https cover (%s)',
    async cover => {
      respond([{ ...publication, cover_image_url: cover }])
      const res = await runHandler()
      expect(res.body).not.toContain('http://images.example.test/cover.jpg')
      expect(res.body).toContain('og:image" content="https://yatraflow-blond.vercel.app/og-default.png"')
      expect(res.body).toContain('twitter:card" content="summary_large_image"')
    },
  )

  it('points at a default card that is actually shipped, at the declared size', async () => {
    respond([publication])
    const res = await runHandler()
    const url = /og:image" content="([^"]+)"/.exec(res.body)?.[1] ?? ''
    expect(url).toBeTruthy()
    const file = new URL(url).pathname.replace(/^\//, '')
    expect(existsSync(new URL(`../public/${file}`, import.meta.url)), `${file} is referenced but not in public/`).toBe(true)
    // A declared size that disagrees with the asset renders letterboxed or
    // cropped on the client, and nothing else in the gate would notice.
    const png = readFileSync(new URL(`../public/${file}`, import.meta.url))
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
  })

  it('honors the configured public origin without a trailing slash', async () => {
    vi.stubEnv('PUBLIC_ORIGIN', 'https://app.example.test/')
    respond([publication])
    expect((await runHandler()).body).toContain(`href="https://app.example.test/i/${publication.id}"`)
  })

  it('fetches only the publication REST row with an AbortSignal, never the application shell', async () => {
    respond([publication])
    await runHandler()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    const target = new URL(String(url))
    expect(target.origin).toBe('https://database.example.test')
    expect(target.pathname).toBe('/rest/v1/published_itineraries')
    expect(target.searchParams.get('id')).toBe(`eq.${publication.id}`)
    expect(target.searchParams.get('limit')).toBe('1')
    expect(target.searchParams.get('select')?.split(',')).toEqual([
      'id', 'title', 'tagline', 'route_summary', 'cover_image_url', 'duration_days', 'estimated_budget_per_person_inr',
    ])
    expect(init?.headers).toMatchObject({ apikey: 'test-anon-key', authorization: 'Bearer test-anon-key' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.signal?.aborted).toBe(false)
  })

  it.each(['GET', 'HEAD'])('%s returns 404 for a missing publication', async method => {
    respond([])
    const res = await runHandler(method)
    expect(res.statusCode).toBe(404)
    expect(res.headers['cache-control']).toBe('no-store')
    if (method === 'HEAD') {
      expect(res.body).toBe('')
      expect(res.ended).toBe(true)
    }
  })

  it('a missing publication gets a noindex card with no canonical or og:url', async () => {
    // #362's hygiene item: the 404 card used to advertise the very id it could
    // not find — a canonical and an og:url for a page that does not exist. It
    // now says "not found", noindexes, and carries no self-referential tags.
    respond([])
    const res = await runHandler()
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('<meta name="robots" content="noindex" />')
    expect(res.body).toContain('Itinerary not found')
    expect(res.body).not.toContain('rel="canonical"')
    expect(res.body).not.toContain('og:url')
    expect(res.body).not.toContain(`/i/${publication.id}`)
  })

  it('HEAD returns the successful GET status and headers without a body', async () => {
    respond([publication])
    const get = await runHandler()
    respond([publication])
    const head = await runHandler('HEAD')
    expect(head.statusCode).toBe(200)
    expect(head.statusCode).toBe(get.statusCode)
    expect(head.headers).toEqual(get.headers)
    expect(head.body).toBe('')
    expect(head.ended).toBe(true)
  })

  it.each(['GET', 'HEAD'])('%s returns 503 no-store when fetch rejects', async method => {
    fetchMock.mockRejectedValue(new Error('Offline fixture'))
    const res = await runHandler(method)
    expect(res.statusCode).toBe(503)
    expect(res.headers['cache-control']).toBe('no-store')
    if (method === 'HEAD') expect(res.body).toBe('')
  })

  it.each(['upstream error', 'invalid JSON', 'unexpected shape'])('returns 503 no-store for %s', async failure => {
    if (failure === 'upstream error') respond({}, 500)
    else if (failure === 'invalid JSON') fetchMock.mockResolvedValue(new Response('Unavailable'))
    else respond({ message: 'Unavailable' })
    const res = await runHandler()
    expect(res.statusCode).toBe(503)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it.each(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'both'])('returns 503 no-store without fetch when %s is missing', async missing => {
    if (missing !== 'SUPABASE_ANON_KEY') vi.stubEnv('SUPABASE_URL', undefined)
    if (missing !== 'SUPABASE_URL') vi.stubEnv('SUPABASE_ANON_KEY', undefined)
    const res = await runHandler()
    expect(res.statusCode).toBe(503)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['two words', 'x'.repeat(65)])('rejects a malformed id (%s) without fetch', async id => {
    const res = makeRes()
    const { default: handler } = await import(apiPath)
    await handler({ method: 'GET', query: { id } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.ended).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // #362: a bare `/i/` — the rewrite forwards it without a query — is a
  // missing page, not the app shell and not a bad request. An empty-string id
  // is the same page asked for by hand.
  it.each([undefined, ''])('answers 404 for the id-less publication path (%s)', async id => {
    const res = makeRes()
    const { default: handler } = await import(apiPath)
    await handler({ method: 'GET', query: { id } }, res)
    expect(res.statusCode).toBe(404)
    expect(res.ended).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([[['one']], [['one', 'two']]])('rejects an array id (%j) without fetch', async id => {
    const res = await runHandler('GET', id)
    expect(res.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('returns 405 for %s without fetch', async method => {
    const res = await runHandler(method)
    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('GET, HEAD')
    expect(res.body).toBe('')
    expect(res.ended).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/** The buyer-thrown request: the publication row, then the gate's verdict. */
const BUYER = '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f601'
const DEFAULT_ORIGIN = 'https://yatraflow-blond.vercel.app'

function respondBuyerCard(bought: unknown, publicationRows: unknown = [publication]) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(publicationRows)))
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(bought)))
}

describe('the buyer’s card (I-21)', () => {
  it('renders the purchase framing once the gate confirms the entitlement', async () => {
    respondBuyerCard(true)
    const res = await runHandler('GET', publication.id, { buyer: BUYER })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('I bought Tom &amp; Jerry&#39;s &quot;Monsoon&quot; Escape — YatraFlow')
    expect(res.body).toContain('Bought on YatraFlow · 5 days · ₹12,500/person · Kochi → Munnar')
    // The creator's own pitch belongs on the creator's card.
    expect(res.body).not.toContain('tea hills')
    expect(res.body).toContain('<meta name="twitter:title" content="I bought')
  })

  it('asks the database with a POST to the gate, carrying only the pair', async () => {
    respondBuyerCard(true)
    await runHandler('GET', publication.id, { buyer: BUYER })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(call => new URL(String(call[0])).pathname))
      .toEqual(['/rest/v1/published_itineraries', '/rest/v1/rpc/owns_publication'])
    const [, init] = fetchMock.mock.calls[1]!
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ p_entitlement: BUYER, p_pub_id: publication.id })
    expect(init?.headers).toMatchObject({ apikey: 'test-anon-key', authorization: 'Bearer test-anon-key' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('declares itself as its own address while the canonical stays the publication’s', async () => {
    respondBuyerCard(true)
    const body = (await runHandler('GET', publication.id, { buyer: BUYER })).body
    expect(body).toContain(
      `<meta property="og:url" content="${DEFAULT_ORIGIN}/i/${publication.id}?buyer=${BUYER}" />`,
    )
    expect(body).toContain(`<link rel="canonical" href="${DEFAULT_ORIGIN}/i/${publication.id}" />`)
  })

  it('names the entitlement in exactly one place — the address, never the words', async () => {
    respondBuyerCard(true)
    const body = (await runHandler('GET', publication.id, { buyer: BUYER })).body
    expect(body.split(BUYER)).toHaveLength(2)
    const words = body.slice(0, body.indexOf('<meta property="og:url"'))
    expect(words).not.toContain(BUYER)
  })

  it.each([
    ['a plain no', () => respondBuyerCard(false)],
    ['a missing function (migration not applied)', () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([publication])))
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 }))
    }],
    ['a server error', () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([publication])))
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    }],
    ['a request that rejects', () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([publication])))
      fetchMock.mockRejectedValueOnce(new Error('Offline fixture'))
    }],
    ['a body that is not a literal true', () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([publication])))
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ bought: true })))
    }],
  ])('falls back to the creator’s card on %s', async (_label, script) => {
    script()
    const res = await runHandler('GET', publication.id, { buyer: BUYER })
    // A preview must still render: unverified reads as the ordinary card, not
    // as an error and never as a claim nobody checked.
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('I bought')
    expect(res.body).not.toContain('Bought on YatraFlow')
    expect(res.body).toContain('tea hills')
  })

  // The array entry is double-wrapped on purpose: an un-wrapped `[BUYER]` row
  // is treated as the argument LIST and would test a plain string instead.
  it.each(['', 'not-a-uuid', BUYER.replace(/-/g, ''), BUYER.toUpperCase() + 'x', 42, [[BUYER]]])(
    'ignores an unusable buyer id (%j) without asking the database',
    async buyer => {
      respond([publication])
      const res = await runHandler('GET', publication.id, { buyer })
      expect(res.statusCode).toBe(200)
      expect(res.body).not.toContain('I bought')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('accepts an upper-case uuid — they are the same id', async () => {
    respondBuyerCard(true)
    const res = await runHandler('GET', publication.id, { buyer: BUYER.toUpperCase() })
    expect(res.body).toContain('I bought')
  })

  it('never asks about a purchase for a publication that is not there', async () => {
    respond([])
    const res = await runHandler('GET', publication.id, { buyer: BUYER })
    expect(res.statusCode).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HEAD with a buyer still sends no body', async () => {
    respondBuyerCard(true)
    const res = await runHandler('HEAD', publication.id, { buyer: BUYER })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('')
    expect(res.ended).toBe(true)
  })
})

describe('the buyer’s share address and message (I-21)', () => {
  it('adds the entitlement to the publication’s own address, escaped', async () => {
    const { buyerShareUrl } = await import(shareUrlPath)
    expect(buyerShareUrl('kerala-trip_1', 'ent/1 2', 'https://app.example.test/', false))
      .toBe('https://app.example.test/i/kerala-trip_1?buyer=ent%2F1%202')
  })

  it('sends a native share to the public origin, never the WebView origin', async () => {
    const { buyerShareUrl } = await import(shareUrlPath)
    expect(buyerShareUrl('kerala-trip_1', 'ent-1', 'capacitor://localhost', true))
      .toBe(`${DEFAULT_ORIGIN}/i/kerala-trip_1?buyer=ent-1`)
  })

  it('writes one sentence that names the plan and links the card', async () => {
    const { purchaseShareMessage } = await import(shareUrlPath)
    const message = purchaseShareMessage('Spiti Valley Circuit', 'https://x.test/i/p?buyer=e')
    expect(message).toContain('I bought the "Spiti Valley Circuit" plan on YatraFlow')
    expect(message).toContain('https://x.test/i/p?buyer=e')
  })

  it('states nothing the buyer did not say — no price, no figures', async () => {
    const { purchaseShareMessage } = await import(shareUrlPath)
    const message = purchaseShareMessage('Spiti Valley Circuit', 'https://x.test/i/p?buyer=e')
    expect(message).not.toMatch(/₹/)
    expect(message).not.toMatch(/\bpaid\b/i)
    expect(message).not.toMatch(/\d+\s*(days|places|km)/i)
  })
})

describe('public share URLs', () => {
  it.each(['https://app.example.test', 'https://app.example.test/'])('uses root /i/id for web origin %s', async origin => {
    const { publicShareUrl } = await import(shareUrlPath)
    expect(publicShareUrl(publication.id, origin)).toBe(`https://app.example.test/i/${publication.id}`)
    expect(publicShareUrl(publication.id, origin, false)).toBe(`https://app.example.test/i/${publication.id}`)
  })

  it.each(['capacitor://localhost', 'http://localhost', 'https://preview.example.test'])('uses production https for native origin %s', async origin => {
    const { publicShareUrl } = await import(shareUrlPath)
    expect(publicShareUrl(publication.id, origin, true)).toBe(`https://yatraflow-blond.vercel.app/i/${publication.id}`)
  })
})

describe('public address bar', () => {
  async function sync(url: string) {
    const address = new URL(url)
    const state = { restored: true }
    const replaceState = vi.fn()
    vi.stubGlobal('location', address)
    vi.stubGlobal('history', { state, replaceState })
    const { syncPublicAddress } = await import(shareUrlPath)
    syncPublicAddress()
    return { address, state, replaceState, syncPublicAddress }
  }

  it('makes a legacy hash link crawler-readable without changing the route or history state', async () => {
    const { state, replaceState } = await sync('https://app.example.test/?campaign=share#/pub/kerala-trip_1')
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(state, '', '/i/kerala-trip_1?campaign=share#/pub/kerala-trip_1')
  })

  it('does not rewrite an already canonical browser address', async () => {
    const { replaceState } = await sync('https://app.example.test/i/kerala-trip_1#/pub/kerala-trip_1')
    expect(replaceState).not.toHaveBeenCalled()
  })

  it.each(['/explore', '/creator/alice', '/join/code', '/invite/trip', '/share/yf1_payload', '/auth?next=%2Ftrips', '/'])('clears the publication path when moving to %s', async route => {
    const { state, replaceState } = await sync(`https://app.example.test/i/kerala-trip_1#${route}`)
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(state, '', `/#${route}`)
  })

  it('aligns the pathname when switching publications', async () => {
    const { state, replaceState } = await sync('https://app.example.test/i/old-trip#/pub/new-trip')
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(state, '', '/i/new-trip#/pub/new-trip')
  })

  it('drops a stale buyer credential when the promoted publication changes (#362)', async () => {
    // `?buyer=` is minted for ONE publication's entitlement. The sync used to
    // carry it across the switch, so the address bar advertised a capability
    // for the publication just left behind — the handler fail-closes on it,
    // but the address still lies. The query goes when the id changes.
    const { state, replaceState } = await sync('https://app.example.test/i/old-trip?buyer=entitlement-1#/pub/new-trip')
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(state, '', '/i/new-trip#/pub/new-trip')
  })

  it('keeps the buyer credential when the publication does not change', async () => {
    // A buyer refreshing their own link: the id is the same, the path is
    // already canonical, so nothing is rewritten and the query stays.
    const { replaceState } = await sync('https://app.example.test/i/kerala-trip_1?buyer=entitlement-1#/pub/kerala-trip_1')
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('keeps an unrelated query when promoting from the shell', async () => {
    // Not every query belongs to a publication the visitor is leaving — a
    // campaign parameter rides along exactly as before.
    const { state, replaceState } = await sync('https://app.example.test/?campaign=share#/pub/kerala-trip_1')
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(state, '', '/i/kerala-trip_1?campaign=share#/pub/kerala-trip_1')
  })

  it('normalizes restored hash routes on repeated Back/Forward calls', async () => {
    const { address, state, replaceState, syncPublicAddress } = await sync('https://app.example.test/i/kerala-trip_1#/pub/kerala-trip_1')
    address.hash = '#/explore'
    syncPublicAddress()
    expect(replaceState).toHaveBeenLastCalledWith(state, '', '/#/explore')
    address.pathname = '/'
    address.hash = '#/pub/kerala-trip_1'
    syncPublicAddress()
    expect(replaceState).toHaveBeenLastCalledWith(state, '', '/i/kerala-trip_1#/pub/kerala-trip_1')
  })

  it.each(['#/pub/', '#/pub/two%20words', `#/pub/${'x'.repeat(65)}`, '#/explore'])('does not promote unsupported route %s', async hash => {
    const { replaceState } = await sync(`https://app.example.test/${hash}`)
    expect(replaceState).not.toHaveBeenCalled()
  })

  const publicationRoutes = [
    '#/pub/kerala-trip_1/',
    '#/pub/kerala-trip_1?utm_source=x',
    '#//pub///kerala-trip_1//',
    '#/pub?source=nav/kerala-trip_1?utm_source=x/',
    '#/pub/kerala-trip_1/extra',
  ]

  it.each(publicationRoutes)('promotes the router-rendered publication for %s', async hash => {
    const { state, replaceState } = await sync(`https://app.example.test/?campaign=share${hash}`)
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(state, '', `/i/kerala-trip_1?campaign=share${hash}`)
  })

  it.each(publicationRoutes)('never erases an already correct publication path for %s', async hash => {
    const { replaceState } = await sync(`https://app.example.test/i/kerala-trip_1${hash}`)
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('promotes trailing segments ignored by the router', async () => {
    const { state, replaceState } = await sync('https://app.example.test/#/pub/one/extra')
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(state, '', '/i/one#/pub/one/extra')
  })

  it.each(['a', 'A0_-', 'x'.repeat(64)])('accepts handler-allowed id %s in the pure path decision', async id => {
    const { publicAddressPath } = await import(shareUrlPath)
    expect(publicAddressPath(`#/pub/${id}?utm_source=x/`, '/')).toBe(`/i/${id}`)
  })

  it.each(['', 'two%20words', 'one.two', 'x'.repeat(65)])('does not promote handler-rejected id %s', async id => {
    const { publicAddressPath } = await import(shareUrlPath)
    expect(publicAddressPath(`#/pub/${id}`, '/')).toBe('/')
    expect(publicAddressPath(`#/pub/${id}`, '/i/old')).toBe('/')
  })

  it.each(['#/explore', '#/pub/?source=x/one', '#/?source=x/pub/one', '#/public/one'])('uses router semantics rather than finding pub anywhere in %s', async hash => {
    const { publicAddressPath } = await import(shareUrlPath)
    expect(publicAddressPath(hash, '/i/old')).toBe('/')
    expect(publicAddressPath(hash, '/other')).toBe('/other')
  })

  it.each(['file:///app/index.html#/pub/kerala-trip_1', 'capacitor://localhost/#/pub/kerala-trip_1'])('leaves non-web addresses unchanged: %s', async url => {
    const { replaceState } = await sync(url)
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('leaves native https WebViews unchanged', async () => {
    const { Capacitor } = await import('@capacitor/core')
    const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    try {
      const { replaceState } = await sync('https://localhost/#/pub/kerala-trip_1')
      expect(replaceState).not.toHaveBeenCalled()
    } finally {
      native.mockRestore()
    }
  })

  it('keeps snapshot links rooted even while a publication path is present', async () => {
    vi.stubGlobal('location', new URL('https://app.example.test/i/kerala-trip_1#/pub/kerala-trip_1'))
    const { snapshotUrl } = await import('../src/lib/snapshot')
    expect(snapshotUrl({} as Parameters<typeof snapshotUrl>[0], 'yf1_payload')).toBe('https://app.example.test/#/share/yf1_payload')
  })
})

describe('public share source wiring', () => {
  it('synchronizes the address on mount and before rendering a hash navigation', () => {
    const source = read('../src/App.tsx')
    expect(source).toMatch(/useEffect\(\(\) => \{\s*syncPublicAddress\(\)/)
    expect(source).toMatch(/const onHash = \(\) => \{ syncPublicAddress\(\); setRoute\(currentRoute\(\)\)/)
    expect(source).toContain("window.addEventListener('hashchange', onHash)")
  })

  it.each(['../src/pages/CreatorPage.tsx', '../src/pages/trip/ShareTab.tsx', '../src/lib/snapshot.ts'])('%s does not inherit a publication pathname for hash links', path => {
    expect(read(path)).not.toContain('${location.pathname}')
  })

  it('rewrites /i/:id to the handler and forwards the id', () => {
    const config = JSON.parse(read('../vercel.json'))
    expect(config.rewrites).toContainEqual({ source: '/i/:id', destination: '/api/i?id=:id' })
  })

  it.each(['../src/pages/PublicItinerary.tsx', '../src/pages/trip/ShareTab.tsx'])('%s calls currentPublicShareUrl for published links', path => {
    const source = read(path)
    expect(source).toMatch(/import\s*\{[^}]*\bcurrentPublicShareUrl\b[^}]*\}\s*from\s*['"][^'"]*\/lib\/shareUrl['"]/)
    expect(source).toMatch(/currentPublicShareUrl\(\s*pub\.id\s*\)/)
    expect(source).not.toContain('${location.pathname}#/pub/')
  })

  it('the creator page shares the server path, not the fragment (#362)', () => {
    const source = read('../src/pages/CreatorPage.tsx')
    expect(source).toMatch(/import \{ currentCreatorShareUrl \} from '\.\.\/lib\/shareUrl'/)
    expect(source).toMatch(/currentCreatorShareUrl\(creatorId\)/)
    // The fragment form never leaves the browser — it cannot be the shared link.
    expect(source).not.toContain('${location.origin}/#/creator/')
  })

  it('creatorShareUrl mints the /c/<id> address, origin-aware and native-stable', async () => {
    const { creatorShareUrl } = await import(shareUrlPath)
    expect(creatorShareUrl('alice', 'https://app.example.test/', false))
      .toBe('https://app.example.test/c/alice')
    expect(creatorShareUrl('alice', 'capacitor://localhost', true))
      .toBe('https://yatraflow-blond.vercel.app/c/alice')
  })
})

// The cover is the one field whose absence is invisible from inside the app: a
// publication with none previews as the brand card, and the creator never sees
// the link they sent. So the publish form requires one — and its acceptance
// rule has to be the handler's own, or a creator could satisfy the form with an
// http:// URL the preview silently refuses.
describe('publishing requires a cover the handler will actually use', () => {
  const form = read('../src/pages/trip/ShareTab.tsx')
  /** #354 — the six rules moved into a lib module so `publishItinerary` enforces
   *  the same ones the form does. The pins below follow the RULE rather than
   *  the file it used to be written in, and this test is also what keeps the
   *  three call sites of the cover literal pinned to one another. */
  const rules = read('../src/lib/publishRules.ts')
  const picker = read('../src/components/CoverImagePicker.tsx')

  it('offers the trip cover picker inside the publish form', () => {
    expect(form).toMatch(/import \{ CoverImagePicker \} from '\.\.\/\.\.\/components\/CoverImagePicker'/)
    // The picker takes the form's cover message now (#389) — two of the six
    // rules are about this control and it used to be able to say nothing.
    expect(form).toMatch(/<CoverImagePicker trip=\{trip\} editable=\{isOwner\} error=\{errs\.cover \?\? null\} \/>/)
  })

  it('refuses to publish without a cover', () => {
    expect(form).toMatch(/const cover = trip\.coverImageUrl\?\.trim\(\)/)
    // The refusal itself is the shared derivation, and the writer calls it too.
    expect(rules).toMatch(/if \(!coverImageUrl\) errs\.cover = 'Add a cover photo/)
    expect(form).toMatch(/publishValidation\(\{/)
  })

  it('validates the cover with the same rule the handler applies', () => {
    // THREE call sites now, and the handler still cannot import client code, so
    // the pin is by LITERAL rather than by sharing (#390 added the picker as a
    // third site; #354 moved the first two into `lib/publishRules`).
    const rule = String.raw`/^https:\/\/\S+$/`
    expect(read('../api/i.js')).toContain(rule)
    expect(rules).toContain(rule)
    expect(picker).toContain(rule)
  })

  it('publishes the trip cover as the publication cover, still sized by the picker', () => {
    // The cover still comes from the trip (never re-derived or dropped), but it
    // is published as the value the rules above VALIDATED — the trimmed one.
    // Storing the raw field shipped a space-padded URL that this handler's
    // `^https://\S+$` test rejects, so the link previewed as the brand card
    // while the form said it was fine (#388/#360).
    expect(form).toMatch(/coverImageUrl: cover,/)
    expect(form).not.toMatch(/coverImageUrl: trip\.coverImageUrl,/)
    // The picker sizes on the way in, which is what keeps a stored cover from
    // being a multi-megabyte original in the first place.
    expect(read('../src/components/CoverImagePicker.tsx')).toMatch(/coverImageUrl: url \? sizedCoverUrl\(url\)/)
  })
})

// The one constant this feature cannot define in a single place. The handler is
// plain JS outside the typechecked `src` (and must not import client code, which
// pulls in Capacitor), and the shell is static HTML, so the production origin is
// written three times. Silence between them is how a domain move breaks native
// share links and og:url while every other test still passes — so the copies are
// pinned to each other here instead of trusted.
describe('the production origin agrees everywhere it is written', () => {
  function constFrom(source: string, name: string): string {
    const match = new RegExp(`const ${name}\\s*=\\s*'([^']+)'`).exec(source)
    expect(match, `${name} is not declared in the source`).not.toBeNull()
    return match![1]!.replace(/\/+$/, '')
  }

  // #362: the handlers' literal moved into api/_origin.js — the ONE resolver
  // the publication card, the creator card and the sitemap read. The literal
  // agreement is pinned from where it is now written.
  const inHandler = constFrom(read('../api/_origin.js'), 'DEFAULT_ORIGIN')
  const inClient = constFrom(read('../src/lib/shareUrl.ts'), 'PUBLIC_ORIGIN')
  const shell = read('../index.html')

  it('is https, so a share link is never a downgrade', () => {
    expect(inHandler).toMatch(/^https:\/\//)
  })

  it('is the same origin in the preview handler and the client share helper', () => {
    expect(inClient).toBe(inHandler)
  })

  it('is what the shell advertises as its own url, canonical and card image', () => {
    expect(shell).toContain(`<meta property="og:url" content="${inHandler}/" />`)
    expect(shell).toContain(`<link rel="canonical" href="${inHandler}/" />`)
    // The handler builds its fallback image from this same constant, so a domain
    // move must not leave one of the two pointing at the old host.
    expect(shell).toContain(`<meta property="og:image" content="${inHandler}/og-default.png" />`)
    expect(shell).toContain(`<meta name="twitter:image" content="${inHandler}/og-default.png" />`)
  })

  it('is the origin a native share is sent to, never the WebView origin', () => {
    const source = read('../src/lib/shareUrl.ts')
    expect(source).toContain('native ? PUBLIC_ORIGIN :')
    expect(source).toMatch(/Capacitor\.isNativePlatform\(\)/)
  })
})

// F3 (#227) — the send unit for "one published link to a WhatsApp group".
describe('sending a publication on WhatsApp', () => {
  it('builds a click-to-chat address whose message survives the encoding', async () => {
    // The message carries a URL: spaces and query separators must not be
    // eaten, or the chat box opens with half an address.
    const { whatsAppSendUrl } = await import('../src/lib/whatsAppShare')
    expect(whatsAppSendUrl('The "Kerala 10d" plan — see it here: https://app.test/i/a?x=1&y=2'))
      .toBe('https://wa.me/?text=' +
        encodeURIComponent('The "Kerala 10d" plan — see it here: https://app.test/i/a?x=1&y=2'))
    expect(whatsAppSendUrl('a b')).toBe('https://wa.me/?text=a%20b')
  })

  it('carries one honest sentence with the plan name and the link', async () => {
    const { publicationShareMessage } = await import(shareUrlPath)
    const url = 'https://app.example.test/i/kerala-trip_1'
    const message = publicationShareMessage('Kerala 10d', url)
    expect(message).toBe(`The "Kerala 10d" trip plan on YatraFlow — see it here: ${url}`)
    // One sentence of prose before the link (the URL's own dots are not
    // punctuation), and no claim the sender has not made.
    const prose = message.split(url)[0]
    expect(prose).not.toMatch(/[.!?]\s+\S/)
    expect(message).not.toMatch(/₹|INR|price|free/)
  })

  it('the send module never reads a window handle', async () => {
    // §6e: window.open(..., 'noopener') always returns null; the moment-after
    // screen's "Send invite" read that as popup-blocked and never once opened
    // WhatsApp. The send is fire-and-forget through the house opener, and the
    // clipboard is the honest fallback, not a guess about the popup.
    const source = read('../src/lib/whatsAppShare.ts')
    expect(source).toMatch(/openExternal\(whatsAppSendUrl\(text\)\)/)
    expect(source).not.toMatch(/window\.open/)
    expect(source).toMatch(/nativeShareText\(/)
    expect(source).toMatch(/nativeCopyText\(/)
  })

  it('the public page offers the send with an in-flight guard', () => {
    const source = readFileSync(new URL('../src/pages/PublicItinerary.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/import \{ sharePublicationOnWhatsApp \} from '\.\.\/lib\/whatsAppShare'/)
    // §6a: the async path is disabled while it runs — the #409 shelf pattern.
    expect(source).toMatch(/const \[sendingWhatsApp, setSendingWhatsApp\] = useState\(false\)/)
    expect(source).toMatch(/if \(sendingWhatsApp \|\| !pub\) return/)
    expect(source).toMatch(/disabled=\{sendingWhatsApp\}/)
    // The address comes from the shared resolver, never a second origin rule.
    expect(source).toMatch(/currentPublicShareUrl\(pub\.id\)/)
  })
})
