import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The edge cache policy for the two share-card handlers. A found card may be
// cached at the edge; every not-found, error or fallback answer must stay
// no-store, or a shared typo or an outage would be cached under its address.
// Executed, not string-matched: the header is the behavior under test.

const CARD_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600'
const PUB_ID = 'kerala-trip_1'
const CREATOR_ID = '11111111-1111-4111-8111-111111111111'
const fetchMock = vi.fn<typeof fetch>()

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

async function runPublication(id: string = PUB_ID) {
  const res = makeRes()
  const { default: handler } = await import('../api/i.js')
  await handler({ method: 'GET', query: { id } }, res)
  return res
}

async function runCreator(id: string = CREATOR_ID) {
  const res = makeRes()
  const { default: handler } = await import('../api/c.js')
  await handler({ method: 'GET', query: { id } }, res)
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

describe('publication card (api/i.js) cache header', () => {
  it('sends the edge cache policy for a found card', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{
      id: PUB_ID, title: 'Monsoon Escape', route_summary: ['Kochi'], duration_days: 5,
    }]), { status: 200 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{
      days: [{ index: 0, title: 'Arrival', stops: [] }],
    }]), { status: 200 }))
    const res = await runPublication()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('og:title')
    expect(res.headers['cache-control']).toBe(CARD_CACHE)
  })

  it('keeps no-store when the trip read fails, so a crawler never keeps the empty card', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{
      id: PUB_ID, title: 'Monsoon Escape', route_summary: ['Kochi'], duration_days: 5,
    }]), { status: 200 }))
    const res = await runPublication()
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('keeps no-store for a not-found publication', async () => {
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }))
    const res = await runPublication()
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('<meta name="robots" content="noindex" />')
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('keeps no-store when the database read fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unavailable', { status: 500 }))
    const res = await runPublication()
    expect(res.statusCode).toBe(503)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('creator card (api/c.js) cache header', () => {
  it('sends the edge cache policy for a found card', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ name: 'Asha Menon', creator_bio: null }]), { status: 200 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      { id: 'trip-1', title: 'Kerala' }, { id: 'trip-2', title: 'Goa' },
    ]), { status: 200 }))
    const res = await runCreator()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Asha Menon on YatraFlow')
    expect(res.headers['cache-control']).toBe(CARD_CACHE)
  })

  it('keeps no-store for a not-found creator', async () => {
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }))
    const res = await runCreator()
    expect(res.statusCode).toBe(404)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('keeps no-store for the noindex fallback when the profile has no name', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ name: '   ', creator_bio: 'x' }]), { status: 200 }))
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }))
    const res = await runCreator()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<meta name="robots" content="noindex" />')
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('keeps no-store when the profile read fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unavailable', { status: 500 }))
    const res = await runCreator()
    expect(res.statusCode).toBe(503)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
