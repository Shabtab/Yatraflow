import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creatorJsonLd, renderCreatorBody } from '../api/_creatorBody.js'
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

function respond(rows: unknown = [publication]) {
  fetchMock.mockResolvedValueOnce(response([profile]))
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

  it('requests only public fields with the anon key and live-publication filter', async () => {
    respond()
    await run()
    const [profileCall, publicationCall] = fetchMock.mock.calls
    const profileUrl = new URL(String(profileCall[0]))
    expect(profileUrl.searchParams.get('select')).toBe('name,creator_bio')
    const url = new URL(String(publicationCall[0]))
    expect(url.searchParams.get('select')).toBe('id,title,tagline')
    expect(url.searchParams.get('creator_id')).toBe(`eq.${ID}`)
    expect(url.searchParams.get('unpublished_at')).toBe('is.null')
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual({ apikey: 'anon-test-key', authorization: 'Bearer anon-test-key' })
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
