// ============ PWA contract (phase 1: the installable shell) ============
// Source-level pins for the pieces a browser ignores SILENTLY: a manifest with
// a missing or wrong-sized icon, a service worker registered inside the native
// shell, or a cache rule that starts keeping /api responses. Every one of those
// fails quietly in production and loudly here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')

const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name?: string
  short_name?: string
  start_url?: string
  scope?: string
  display?: string
  background_color?: string
  theme_color?: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}
const vercel = JSON.parse(read('vercel.json')) as {
  headers?: { source: string; headers: { key: string; value: string }[] }[]
}
const sw = read('public/sw.js')
const html = read('index.html')
const main = read('src/main.tsx')

describe('the manifest makes the app installable', () => {
  it('carries the members installability actually requires', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    // A hash-routed SPA installs as one document, so scope and start are '/'.
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.background_color).toMatch(/^#[0-9A-F]{6}$/i)
    expect(manifest.theme_color).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('ships 192 + 512 "any" icons and a maskable one — each file present at its declared size', () => {
    expect(manifest.icons.filter(i => i.purpose === 'any').map(i => i.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    )
    expect(manifest.icons.filter(i => i.purpose === 'maskable').length).toBeGreaterThan(0)

    for (const icon of manifest.icons) {
      const png = readFileSync(new URL('../public' + icon.src, import.meta.url))
      // PNG signature, then the IHDR width/height: a wrong-sized file is an
      // installability failure the manifest alone cannot reveal.
      expect(png.subarray(0, 8).toString('hex'), icon.src).toBe('89504e470d0a1a0a')
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes)
    }
  })
})

describe('the service worker caches the shell and nothing private', () => {
  it('keeps /api, the crawler preview, the sitemap and the mappls proxy out of the cache', () => {
    for (const prefix of ["'/api/'", "'/i/'", "'/sitemap.xml'", "'/mappls/'"]) {
      expect(sw, `${prefix} must stay in the NEVER list`).toContain(prefix)
    }
    // Cross-origin is left to the network too: Supabase, tiles, fonts. A cached
    // auth/rest response is a correctness bug, not a performance win.
    expect(sw).toContain('url.origin !== self.location.origin')
  })

  it('serves navigations network-first with the cached shell as the offline fallback', () => {
    expect(sw).toContain("request.mode === 'navigate'")
    expect(sw).toContain('caches.match(SHELL)')
  })

  it('never skipWaiting — a running session must not have its shell swapped underneath it', () => {
    // The comment above the install handler legitimately NAMES it, so strip
    // comment lines before asserting on code (the repo's own source-scan rule).
    const code = sw
      .split('\n')
      .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(code).not.toContain('skipWaiting')
  })
})

describe('registration and update plumbing', () => {
  it('registers only on the web and only from a production build', () => {
    expect(main).toContain("if (!isNative && import.meta.env.PROD && 'serviceWorker' in navigator)")
    expect(main).toContain("navigator.serviceWorker.register('/sw.js')")
  })

  it('index.html links the manifest and an opaque apple-touch-icon', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />')
  })

  it('serves sw.js uncached — a cached worker is a worker that never updates', () => {
    const rule = (vercel.headers ?? []).find(entry => entry.source === '/sw.js')
    expect(rule, 'a /sw.js header rule must exist').toBeTruthy()
    const cacheControl = rule?.headers.find(header => header.key === 'Cache-Control')?.value ?? ''
    expect(cacheControl).toContain('no-cache')
  })
})

describe('the asset branch refuses rewritten answers (#575 Face A)', () => {
  // The host's catch-all rewrite answers a MISSING hashed asset with 200 + the
  // HTML shell. Caching that would file markup under a .js URL and serve it
  // cache-first until a version bump — the durable poison this guards against.
  const assetsBranch = () => sw.slice(sw.indexOf("startsWith('/assets/')"))

  it('bumps the version — the policy changed, so activate sweeps poisoned v1 caches', () => {
    expect(sw).toContain("const SW_VERSION = 'v2'")
  })

  it('refuses to cache a text/html response under an asset URL', () => {
    expect(assetsBranch()).toContain("type.includes('text/html')")
    expect(assetsBranch()).toContain('return Response.error()')
  })

  it('resolves an offline asset miss as a network error, not a rejected respondWith', () => {
    expect(assetsBranch()).toContain('.catch(() => Response.error())')
  })
})
