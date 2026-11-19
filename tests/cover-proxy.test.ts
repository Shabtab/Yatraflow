import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import coverHandler, { coverFile, coverWidth, thumbAllowed } from '../api/cover.js'

// A publication whose cover is a raw Commons upload — the live shape that made
// this proxy necessary — and one already through our own bucket.
const WIKI_RAW = 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Chandratal_1.JPG?utm_source=en.wikipedia.org&utm_content=thumbnail_unscaled'
const WIKI_REDIRECT = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Chandratal_1.JPG?width=1200'
const UPLOADED = 'https://hqlqbfpzjmailxydjojw.supabase.co/storage/v1/object/public/covers/d507b604-1f89-46bd-b793-3d0bd67bbd2f/d2g9huw8g9dp.jpg'
// The tag writer escapes every value, so the `&` between the two parameters
// reaches the HTML as `&amp;` and a crawler reads it back as `&`.
const PROXIED = 'https://www.yatraflow.in/api/cover?f=Chandratal_1.JPG&amp;w=1200'

function makeRes() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '' as string | Uint8Array,
    ended: false,
    setHeader(key: string, value: string) { this.headers[key.toLowerCase()] = value },
    status(code: number) { this.statusCode = code; return this },
    send(body: string | Uint8Array) { this.body = body; return this },
    end(body?: string | Uint8Array) { if (body !== undefined) this.body = body; this.ended = true; return this },
  }
}

beforeEach(() => {
  vi.stubEnv('PUBLIC_ORIGIN', undefined)
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', undefined)
  vi.stubEnv('SUPABASE_URL', 'https://database.example.test')
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected fetch')))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function runCover(query: Record<string, unknown> = {}, method = 'GET') {
  const res = makeRes()
  await coverHandler({ method, query }, res)
  return res
}

describe('the file name the cover proxy accepts', () => {
  it('keeps a plain Commons title', () => {
    expect(coverFile('Chandratal_1.JPG')).toBe('Chandratal_1.JPG')
    // The platform decodes `%2C` once; MediaWiki refuses a title with a percent
    // escape (measured: "contains invalid characters"), so the plain title is the input.
    expect(coverFile('Telkupi,_Purulia.jpg')).toBe('Telkupi,_Purulia.jpg')
  })

  it('refuses a path, a traversal, a control character and an out-of-range length', () => {
    for (const value of ['', 'a/b.jpg', 'a\\b.jpg', '..', 'a..b.jpg', '..%2Fetc', 'a.jpg|File:b.jpg', 'bad\u0000name.jpg', 'x'.repeat(256)]) {
      expect(coverFile(value), JSON.stringify(value)).toBeNull()
    }
    for (const value of [null, undefined, 7, ['a.jpg'], { f: 'a.jpg' }]) {
      expect(coverFile(value)).toBeNull()
    }
  })

  it('takes the longest allowed name', () => {
    expect(coverFile('y'.repeat(255))).toBe('y'.repeat(255))
  })
})

describe('the width the cover proxy accepts', () => {
  it('takes the three sizes the card can ask for', () => {
    expect(coverWidth('640')).toBe(640)
    expect(coverWidth('960')).toBe(960)
    expect(coverWidth('1200')).toBe(1200)
  })

  it('falls back to 960 for anything else, never refusing the preview', () => {
    for (const value of ['800', '0', '1200px', 'abc', '', '-1200', undefined, null, 1200]) {
      expect(coverWidth(value)).toBe(960)
    }
  })
})

describe('the host the thumb may come from', () => {
  it('accepts Wikimedia\'s two image hosts over https and nothing near them', () => {
    // The live API answers the thumb on thumb.wikimedia.org; upload.wikimedia.org
    // is the older and unsized shape. Both are exact hosts from the allowlist.
    expect(thumbAllowed('https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3a/Chandratal_1.JPG/1280px-Chandratal_1.JPG')).toBe(true)
    expect(thumbAllowed('https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Chandratal_1.JPG/1200px-Chandratal_1.JPG')).toBe(true)
    for (const value of [
      'http://upload.wikimedia.org/wiki/a.jpg',
      'https://upload.wikimedia.org.evil.test/a.jpg',
      'https://evil.test/upload.wikimedia.org/a.jpg',
      'https://thumb.wikimedia.org.evil.test/a.jpg',
      'https://commons.wikimedia.org/wiki/Special:Redirect/file/a.jpg',
      'https://upload.wikimedia.org@evil.test/a.jpg',
      '',
      'nonsense',
      undefined,
    ]) {
      expect(thumbAllowed(value), String(value)).toBe(false)
    }
  })
})

describe('the cover handler answers the brand card on every failure', () => {
  it('redirects a missing or malformed file name, cacheable for five minutes', async () => {
    const res = await runCover({})
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('https://www.yatraflow.in/og-default.png')
    expect(res.headers['cache-control']).toBe('public, s-maxage=300')
  })

  it('redirects when the API names a thumb on another host', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://evil.test/a.jpg' }] } } } })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await runCover({ f: 'Chandratal_1.JPG', w: '1200' })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('https://www.yatraflow.in/og-default.png')
    // The hostile address is never fetched: one call, the API lookup.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never follows a redirect from the thumb host', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.png' }] } } } })))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await runCover({ f: 'Chandratal_1.JPG' })
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('https://www.yatraflow.in/og-default.png')
    // Both fetches ask for a manual redirect, so a 3xx is an answer, not a hop.
    for (const call of fetchMock.mock.calls) expect((call[1] as RequestInit).redirect).toBe('manual')
  })

  it('refuses an SVG, which would run script from our own domain', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.svg' }] } } } })))
      .mockResolvedValueOnce(new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await runCover({ f: 'Chandratal_1.JPG' })
    expect(res.statusCode).toBe(302)
  })

  it('stops reading a body that grows past the ceiling, with no length header', async () => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(512 * 1024))
        if (pulled > 50) controller.close()
      },
    })
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.jpg' }] } } } })))
      .mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'content-type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await runCover({ f: 'Chandratal_1.JPG' })
    expect(res.statusCode).toBe(302)
    // 2 MiB is four 512 KiB chunks; the stream is cancelled right after the fifth.
    expect(pulled).toBeLessThan(10)
  })

  it('redirects a non-image answer from the thumb', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.png' }] } } } })))
      .mockResolvedValueOnce(new Response('<html>no</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await runCover({ f: 'Chandratal_1.JPG' })
    expect(res.statusCode).toBe(302)
  })
})

describe('the cover handler answers the bytes', () => {
  it('returns the thumb with its own type and the long edge cache', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Chandratal_1.JPG/1200px-Chandratal_1.JPG' }] } } } })))
      .mockResolvedValueOnce(new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.byteLength) } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await runCover({ f: 'Chandratal_1.JPG', w: '1200' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.headers['cache-control']).toBe('public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400')
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
    expect(new Uint8Array(res.body as Uint8Array).byteLength).toBe(bytes.byteLength)
    // The API call asked for our width and our own file title.
    const asked = new URL(String(fetchMock.mock.calls[0][0]))
    expect(asked.searchParams.get('iiurlwidth')).toBe('1200')
    expect(asked.searchParams.get('titles')).toBe('File:Chandratal_1.JPG')
    // The thumb is fetched with a User-Agent the card can be traced by.
    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>
    expect(headers['user-agent']).toBe('YatraFlowShareCard/1.0 (+https://www.yatraflow.in)')
  })

  it('refuses a method other than GET or HEAD', async () => {
    const res = await runCover({ f: 'Chandratal_1.JPG' }, 'POST')
    expect(res.statusCode).toBe(405)
    expect(res.headers['allow']).toBe('GET, HEAD')
  })
})

describe('the publication card points a Wikimedia cover at our own domain', () => {
  async function card(cover: string) {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ id: 'kerala-trip_1', title: 'Chandratal', cover_image_url: cover }])),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = makeRes()
    const { default: handler } = await import('../api/i.js')
    await handler({ method: 'GET', query: { id: 'kerala-trip_1' } }, res)
    return res.body as string
  }

  it('rewrites a raw upload and an already-sized redirect to the proxy', async () => {
    for (const cover of [WIKI_RAW, WIKI_REDIRECT]) {
      const body = await card(cover)
      expect(body).toContain(`og:image" content="${PROXIED}"`)
      expect(body).toContain(`twitter:image" content="${PROXIED}"`)
      expect(body).not.toContain('upload.wikimedia.org')
      expect(body).not.toContain('Special:Redirect')
      // The height follows the file, so neither size is declared.
      expect(body).not.toContain('og:image:width')
      expect(body).not.toContain('og:image:height')
    }
  })

  it('sends a decoded title, encoded once, for a name with an escape', async () => {
    const body = await card('https://commons.wikimedia.org/wiki/Special:Redirect/file/Telkupi%2C_Purulia.jpg?width=1200')
    expect(body).toContain('og:image" content="https://www.yatraflow.in/api/cover?f=Telkupi%2C_Purulia.jpg&amp;w=1200"')
    expect(body).not.toContain('%252C')
  })

  it('leaves a Supabase cover on its own address', async () => {
    const body = await card(UPLOADED)
    expect(body).toContain(`og:image" content="${UPLOADED}"`)
    expect(body).not.toContain('/api/cover')
  })
})
