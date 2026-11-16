// ============ Per-route browser-tab titles ============
// `index.html` carries one static title, so before this every route shared it —
// four open tabs all read the same thing, and a bookmark of one itinerary was
// indistinguishable from a bookmark of the site. The mapping is pure, so the
// whole contract is testable without a router or a DOM.
//
// The integration cases at the bottom are the ones that matter: `routeParts` is
// what App.tsx derives its router segments from, so if the two ever disagree a
// title starts naming a route the router does not have.
import { describe, expect, it } from 'vitest'
import { SITE, pageTitle, routeParts } from '../src/lib/pageTitle'

describe('routeParts', () => {
  it.each([
    ['/', []],
    ['', []],
    ['/auth', ['auth']],
    ['/trips', ['trips']],
    ['/trip/abc-123', ['trip', 'abc-123']],
    ['/creator/someone', ['creator', 'someone']],
  ])('splits %s into %j', (route, expected) => {
    expect(routeParts(route)).toEqual(expected)
  })

  it('strips a query string, which rides on the head segment', () => {
    expect(routeParts('/auth?mode=signup')).toEqual(['auth'])
    expect(routeParts('/explore?when=weekend&sort=cheap')).toEqual(['explore'])
  })

  it('ignores empty segments from doubled or trailing slashes', () => {
    expect(routeParts('/explore/')).toEqual(['explore'])
    expect(routeParts('//trips//new//')).toEqual(['trips', 'new'])
  })

  it('keeps a slug that contains a hyphen or digits intact', () => {
    expect(routeParts('/pub/pub_1cp2i9jq872')).toEqual(['pub', 'pub_1cp2i9jq872'])
  })
})

describe('pageTitle', () => {
  it('names the site on the root route', () => {
    expect(pageTitle(routeParts('/'))).toBe(`${SITE}: Plan real trips, together`)
  })

  it.each([
    ['/auth', 'Sign in'],
    ['/trips', 'Your trips'],
    ['/new', 'New trip'],
    ['/explore', 'Explore itineraries'],
    ['/creators', 'Creator rankings'],
    ['/creator-hub', 'Creator hub'],
    ['/purchases', 'My purchases'],
    ['/admin', 'Admin'],
    ['/profile', 'Profile'],
    ['/join', 'Join a trip'],
    ['/invite', 'Join a trip'],
    ['/share', 'A shared trip'],
  ])('titles %s as "%s"', (route, label) => {
    expect(pageTitle(routeParts(route))).toBe(`${label} · ${SITE}`)
  })

  it('titles a query-bearing route the same as its bare path', () => {
    expect(pageTitle(routeParts('/auth?mode=signup'))).toBe(pageTitle(routeParts('/auth')))
  })

  it.each([
    ['pub', 'Itinerary'],
    ['trip', 'Trip'],
    ['creator', 'Creator'],
  ])('falls back to a generic label for /%s when the record is not loaded', (head, label) => {
    expect(pageTitle([head])).toBe(`${label} · ${SITE}`)
    expect(pageTitle([head, 'some-id'])).toBe(`${label} · ${SITE}`)
  })

  it.each([
    ['pub', 'Kerala hills and backwaters'],
    ['trip', 'Coorg weekend'],
    ['creator', 'Dheeraj'],
  ])('uses the record name for /%s when the page supplies one', (head, subject) => {
    expect(pageTitle([head, 'some-id'], subject)).toBe(`${subject} · ${SITE}`)
  })

  it('falls back to the generic label when the subject is empty', () => {
    expect(pageTitle(['pub'], '')).toBe(`Itinerary · ${SITE}`)
    expect(pageTitle(['pub'], null)).toBe(`Itinerary · ${SITE}`)
    expect(pageTitle(['pub'], undefined)).toBe(`Itinerary · ${SITE}`)
  })

  it('names only the site for a route it does not know', () => {
    expect(pageTitle(['nonsense'])).toBe(SITE)
    expect(pageTitle([])).toBe(`${SITE}: Plan real trips, together`)
  })

  it('never returns an empty title, whatever it is handed', () => {
    for (const parts of [[], [''], ['nonsense'], ['pub'], ['pub', 'x']]) {
      expect(pageTitle(parts).length).toBeGreaterThan(0)
      expect(pageTitle(parts)).toContain(SITE)
    }
  })
})
