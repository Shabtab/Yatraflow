// Route integrity: every in-app hash link must point at a route the router
// actually resolves. Static source check — no browser needed.
//
// Why this exists: the Plan Bench's primary CTA pointed at '#/create' for a
// while. App.tsx has no `create` case, so the router's `default:` branch
// rendered the landing page — the CTA read as inert, and the prefill it had
// just stashed into sessionStorage was never read, because CreateTripPage never
// mounted. The admin console had the same shape ('#/p/<id>' where every other
// published link uses '#/pub/<id>'). Neither was caught, because nothing
// compared the links against the router.
//
// #398 moved the create route into `lib/routes` and pointed the router's case and
// every CTA at that constant. The scanners below resolve the constant instead of
// matching a literal, so they keep seeing the route while the rename-proof form
// stays in place.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { CREATE_SEGMENT, CREATE_PATH, CREATE_ROUTE } from '../src/lib/routes'

/** Strip comments so a route named in prose is never mistaken for a real link.
 *  Only whole-line `//` comments are removed, so `https://` survives. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The source with route constants spelled out, so a link written as
 *  `appLink(CREATE_ROUTE)` is scanned exactly like one written `'#/new'`. */
function expandRouteConstants(text: string): string {
  return stripComments(text)
    .split('CREATE_ROUTE').join(CREATE_ROUTE)
    .split('CREATE_PATH').join(CREATE_PATH)
}

const app = expandRouteConstants(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'))

/** Routes the router resolves: the `switch (parts[0])` cases, plus the
 *  pre-switch `parts[0] === '…'` checks (share / join / invite). '' is the
 *  bare '/' route. */
const handled = new Set<string>([
  ...Array.from(app.matchAll(/case '([a-z-]+)'/g), (m) => m[1]),
  ...Array.from(app.matchAll(/parts\[0\] === '([a-z-]+)'/g), (m) => m[1]),
  // The create route's case matches an imported constant, which the literal scan
  // above cannot see. Naming it here is honest only because the sweep below then
  // proves the constant still points at a route the router handles.
  CREATE_SEGMENT,
  '',
])

const srcRoot = new URL('../src/', import.meta.url)
const files = readdirSync(srcRoot, { recursive: true })
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => 'src/' + f.split('\\').join('/'))

/** Every in-app destination in a file: `#/<slug>` literals and
 *  `navigate('/<slug>')` calls (including template-literal and constant forms). */
function targetsIn(text: string): string[] {
  const body = expandRouteConstants(text)
  return [
    ...Array.from(body.matchAll(/#\/([a-z-]*)/g), (m) => m[1]),
    ...Array.from(body.matchAll(/navigate\(\s*[`'"]?\/([a-z-]*)/g), (m) => m[1]),
  ]
}

describe('route integrity', () => {
  it('parses a plausible router and a plausible source tree', () => {
    // Without these, a parse that silently found nothing would make the
    // assertion below pass while checking nothing at all.
    expect(handled.size).toBeGreaterThan(8)
    expect(handled.has('new')).toBe(true)
    expect(handled.has('trips')).toBe(true)
    expect(handled.has('pub')).toBe(true)
    expect(files.length).toBeGreaterThan(40)
  })

  it('points every in-app link at a route the router handles', () => {
    const orphans = new Map<string, string[]>()
    let seen = 0
    for (const rel of files) {
      const text = readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
      for (const slug of targetsIn(text)) {
        seen++
        if (handled.has(slug)) continue
        orphans.set(slug, [...(orphans.get(slug) ?? []), rel])
      }
    }
    // Guard against a vacuous pass: the sweep must actually have seen links.
    expect(seen).toBeGreaterThan(20)
    expect(
      [...orphans].map(([slug, where]) => `#/${slug} <- ${where.join(', ')}`),
      'hash targets with no matching case in App.tsx',
    ).toEqual([])
  })
})
