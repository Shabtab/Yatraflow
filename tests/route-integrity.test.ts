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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { CREATE_SEGMENT, CREATE_PATH, CREATE_ROUTE, LEGACY_SCHEMES, ROUTED_SEGMENTS, legacyRedirectPath } from '../src/lib/routes'
import { legacyHashRoute } from '../src/lib/router'

/** Strip comments so a route named in prose is never mistaken for a real link.
 *  Only whole-line `//` comments are removed, so `https://` survives. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The source with route constants spelled out, so a link written as
 *  `appLink(CREATE_PATH)` is scanned exactly like one written `'/new'`. Since
 *  #426 slice 2 the in-app links are `appLink('/seg…')` spreads — normalizing
 *  the call name onto `navigate(` lets one regex see every link shape. */
function expandRouteConstants(text: string): string {
  return stripComments(text)
    .split('CREATE_ROUTE').join(CREATE_ROUTE)
    .split('CREATE_PATH').join(CREATE_PATH)
    .split('appLink(').join('navigate(')
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

/** Every in-app destination in a file: `#/<slug>` literals (the native shell
 *  still speaks fragments), `navigate('/<slug>')` calls and `appLink('/<slug>')`
 *  spreads — including template-literal and constant forms. */
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

// #426, slice 2: the bridge that promotes old hash addresses onto the path the
// router answers. It maps by IDENTITY onto ROUTED_SEGMENTS, so the pin is the
// direction slice 1's table did not need: every segment the bridge will
// promote must be a segment the router itself resolves — otherwise a stale
// bookmark lands on the `default:` (the #398 failure, one hop removed).
describe('legacy hash bridge (#426, slice 2)', () => {
  it('promotes only segments the router actually handles', () => {
    expect(ROUTED_SEGMENTS.length).toBeGreaterThan(8)
    for (const segment of ROUTED_SEGMENTS) {
      expect(
        handled.has(segment),
        `ROUTED_SEGMENTS names /${segment} but the router has no case for it`,
      ).toBe(true)
    }
  })

  it('keeps the segment list in step with the router it serves', () => {
    // The router's own cases minus the bridge's exclusions. '' is the bare
    // route; 'creator' keeps its switch case (the app page lives at
    // /creator/<id> while /c/<id> stays the crawler card — see routes.ts).
    for (const segment of ['trips', 'new', 'created', 'trip', 'explore', 'pub', 'creator', 'profile', 'purchases', 'creator-hub', 'admin', 'auth', 'join', 'invite', 'share']) {
      expect(ROUTED_SEGMENTS, `/${segment} must be bridged`).toContain(segment)
    }
  })

  it('maps the hashes the world still carries onto the path form', () => {
    expect(legacyHashRoute('#/trip/abc123')).toBe('/trip/abc123')
    expect(legacyHashRoute('#/trips')).toBe('/trips')
    expect(legacyHashRoute('#/creator/u_9')).toBe('/creator/u_9')
    expect(legacyHashRoute('#/join/GOA4X2')).toBe('/join/GOA4X2')
    expect(legacyHashRoute('#/pub/kerala-trip_1?utm_source=x')).toBe('/pub/kerala-trip_1?utm_source=x')
    expect(legacyHashRoute('#/auth?next=%2Fjoin%2Fx')).toBe('/auth?next=%2Fjoin%2Fx')
    // A hash this app never routed is left alone, not invented into a path.
    expect(legacyHashRoute('#/xyz/1')).toBeNull()
    expect(legacyHashRoute('#/')).toBeNull()
    expect(legacyHashRoute('')).toBeNull()
  })
})

// #426, slice 1: the legacy hash → real path table that the router migration will
// read. Deliberately behaviour-neutral — nothing on a live surface consults it
// yet — so what is pinned here is only what would make the redirect WRONG rather
// than merely unfinished: a scheme that maps to a path nothing serves, a scheme
// silently dropped from the table, or an id/query mangled on the way through.
describe('legacy hash → real path (#426)', () => {
  it('maps each shareable scheme to a path something actually serves', () => {
    for (const { scheme, segment } of LEGACY_SCHEMES) {
      // Either the router resolves the segment today, or a serverless function
      // answers that path: `/c/<id>` is the creator page's share address and has
      // its own function (api/c.js), exactly as `/i/<id>` does for a publication.
      // Anything else would redirect a live link onto the router's `default:` —
      // the landing page — which is the #398 failure with a worse blast radius.
      const servedInApp = handled.has(segment)
      const servedByFunction = existsSync(new URL(`../api/${segment}.js`, import.meta.url))
      expect(
        servedInApp || servedByFunction,
        `#/${scheme}/… maps to /${segment}/… but nothing serves it`,
      ).toBe(true)
    }
  })

  it('covers every scheme the issue names, and reads ids and queries through', () => {
    expect(LEGACY_SCHEMES.map(s => s.scheme)).toEqual(['pub', 'join', 'invite', 'share', 'creator'])
    expect(legacyRedirectPath('#/pub/pub_1cp2i9jq872')).toBe('/pub/pub_1cp2i9jq872')
    expect(legacyRedirectPath('#/creator/u_9')).toBe('/c/u_9')
    expect(legacyRedirectPath('#/join/GOA4X2')).toBe('/join/GOA4X2')
    expect(legacyRedirectPath('#/invite/u_9')).toBe('/invite/u_9')
    expect(legacyRedirectPath('#/share/t_7')).toBe('/share/t_7')
    // The id rides through untouched: re-encoding here is how %2F becomes %252F
    // on the second hop, and the query is part of the address a crawler saw.
    expect(legacyRedirectPath('#/pub/abc%2Fdef')).toBe('/pub/abc%2Fdef')
    expect(legacyRedirectPath('#/pub/abc?utm_source=whatsapp')).toBe('/pub/abc?utm_source=whatsapp')
  })

  it('leaves a non-legacy hash alone, and sends a bare scheme home', () => {
    // Null, not a guess: a hash the table does not own stays the router's problem.
    expect(legacyRedirectPath('#/trip/xyz')).toBeNull()
    expect(legacyRedirectPath('#/explore')).toBeNull()
    expect(legacyRedirectPath('#/')).toBeNull()
    expect(legacyRedirectPath('')).toBeNull()
    // A bare scheme names nothing, so it goes to the landing path rather than to
    // a path with an empty id.
    expect(legacyRedirectPath('#/pub')).toBe('/')
    expect(legacyRedirectPath('#/pub/')).toBe('/')
  })
})
