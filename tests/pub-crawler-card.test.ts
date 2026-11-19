import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A crawler that fetches a copied /pub/<id> link must see the same card as
// /i/<id>. Humans fetching the same address still get the app. Two halves are
// pinned here: the rewrite order and user-agent gate in vercel.json, and the
// address the card advertises when the handler is called with `via=pub`.

/** Normalised to `\n` on read: this repo checks out CRLF on Windows. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

type Rewrite = {
  source: string
  destination: string
  has?: Array<{ type: string; key: string; value: string }>
}

const config = JSON.parse(read('../vercel.json')) as { rewrites: Rewrite[] }

// The crawler list is built from this string literal only. The handler never
// builds a RegExp from a request value; neither does this test.
const CRAWLER_NAMES = 'facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|twitterbot|linkedinbot|slackbot|slack-imgproxy|discordbot|telegrambot|skypeuripreview|applebot|googlebot|bingbot|pinterest|redditbot|embedly'
const crawlerRe = new RegExp(CRAWLER_NAMES, 'i')
const CRAWLER_HEADER = `(?i).*(${CRAWLER_NAMES}).*`

const PUB_ID = 'kerala-trip_1'
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

async function runCard(query: Record<string, string>) {
  const res = makeRes()
  const { default: handler } = await import('../api/i.js')
  await handler({ method: 'GET', query }, res)
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
  // A found row and a readable trip: the card is complete and cacheable.
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{
    id: PUB_ID, title: 'Monsoon Escape', route_summary: ['Kochi'], duration_days: 5,
  }]), { status: 200 }))
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{
    days: [{ index: 0, title: 'Arrival', stops: [] }],
  }]), { status: 200 }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('vercel.json — crawler card at /pub/<id>', () => {
  it('puts the /pub rewrite before the SPA catch-all', () => {
    const pub = config.rewrites.find((r) => r.source === '/pub/:slug')
    const catchAll = config.rewrites.find((r) => r.destination === '/index.html')
    expect(pub).toBeDefined()
    expect(catchAll).toBeDefined()
    expect(config.rewrites.indexOf(pub!)).toBeLessThan(config.rewrites.indexOf(catchAll!))
    expect(pub!.destination).toBe('/api/i?id=:slug&via=pub')
  })

  it('gates that rewrite on the crawler user-agent header', () => {
    const pub = config.rewrites.find((r) => r.source === '/pub/:slug')!
    expect(pub.has).toEqual([{ type: 'header', key: 'user-agent', value: CRAWLER_HEADER }])
    for (const agent of ['facebookexternalhit/1.1', 'WhatsApp/2.23', 'Twitterbot/1.0']) {
      expect(crawlerRe.test(agent), agent).toBe(true)
    }
    expect(crawlerRe.test('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe(false)
  })
})

describe('api/i.js — /pub card address', () => {
  it('advertises the copied /pub/<id> link for via=pub', async () => {
    const res = await runCard({ id: PUB_ID, via: 'pub' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain(`<meta property="og:url" content="https://www.yatraflow.in/pub/${PUB_ID}" />`)
    expect(res.body).toContain(`<link rel="canonical" href="https://www.yatraflow.in/pub/${PUB_ID}" />`)
    expect(res.headers['vary']).toBe('User-Agent')
  })

  it('keeps the /i/<id> card and its headers for every other caller', async () => {
    const res = await runCard({ id: PUB_ID })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain(`<meta property="og:url" content="https://www.yatraflow.in/i/${PUB_ID}" />`)
    expect(res.body).toContain(`<link rel="canonical" href="https://www.yatraflow.in/i/${PUB_ID}" />`)
    expect(res.headers['vary']).toBeUndefined()
  })
})
