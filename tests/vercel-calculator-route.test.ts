import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Vercel's rewrite `source` is a regex. Anchor it the way the router does so the
// test exercises the same match the platform applies to a request path.
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  redirects?: Array<{ source: string; destination: string; permanent?: boolean }>
  rewrites: Array<{ source: string; destination: string }>
}

const CALCULATOR = '/ladakh-trip-cost-calculator'
const CALCULATOR_SLASH = `${CALCULATOR}/`

const catchAll = config.rewrites.find((r) => r.destination === '/index.html')
const catchAllRe = new RegExp(`^${catchAll?.source ?? '$^'}$`)

describe('vercel.json — ladakh trip cost calculator route', () => {
  it('redirects the slash-less path to the slash form, permanently', () => {
    const redirect = config.redirects?.find((r) => r.source === CALCULATOR)
    expect(redirect).toBeDefined()
    expect(redirect?.destination).toBe(CALCULATOR_SLASH)
    expect(redirect?.permanent).toBe(true)
  })

  it('keeps the SPA catch-all exempting the slash form of the calculator', () => {
    expect(catchAll).toBeDefined()
    expect(catchAllRe.test(CALCULATOR_SLASH)).toBe(false)
    expect(catchAllRe.test(`${CALCULATOR_SLASH}index.html`)).toBe(false)
  })

  it('keeps the other catch-all exemptions intact', () => {
    for (const path of ['/sw.js', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml', '/api/sitemap']) {
      expect(catchAllRe.test(path), path).toBe(false)
    }
    expect(catchAllRe.test('/trips')).toBe(true)
  })
})
