// ============ Creator hub in the phone bottom navigation ============
// A creator sees five destinations; everyone else keeps four. These assert the
// rendered navigation and the route-to-destination map, not source text: what a
// viewer can see, which item is marked current, and where each item points.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BottomNav, areaOf, navDestinations } from '../src/components/BottomNav'

const markup = (route: string, isCreator: boolean) =>
  renderToStaticMarkup(createElement(BottomNav, { route, onNavigate: () => {}, isCreator }))

/** The visible labels, in bar order. */
function labels(html: string): string[] {
  return Array.from(html.matchAll(/<span class="bottom-nav-label">([^<]*)<\/span>/g)).map((m) => m[1])
}

/** The labels that carry aria-current="page". */
function current(html: string): string[] {
  const items = Array.from(html.matchAll(/<button[^>]*>.*?<span class="bottom-nav-label">([^<]*)<\/span>/g))
  return items.filter((m) => m[0].includes('aria-current="page"')).map((m) => m[1])
}

describe('destinations', () => {
  it('gives a non-creator the four primary items, Profile last', () => {
    expect(navDestinations(false).map((d) => d.label)).toEqual(['Home', 'My trips', 'Explore', 'Profile'])
    expect(navDestinations(false).some((d) => d.to === '/creator-hub')).toBe(false)
  })

  it('gives a creator a fifth item, and Profile still last', () => {
    const items = navDestinations(true)
    expect(items.map((d) => d.label)).toEqual(['Home', 'My trips', 'Explore', 'Creator', 'Profile'])
    expect(items[3].to).toBe('/creator-hub')
    expect(items[items.length - 1].to).toBe('/profile')
  })
})

describe('route to destination', () => {
  it('maps the hub, and only the hub, to the creator tab', () => {
    expect(areaOf('/creator-hub')).toBe('creator')
    // The public creator page is not the hub, and a stray query must not change that.
    expect(areaOf('/creator/1250e5c4-7d87-4813')).toBe(null)
    expect(areaOf('/creator-hub?tab=links')).toBe('creator')
  })

  it('keeps the existing mappings', () => {
    expect(areaOf('/')).toBe('home')
    expect(areaOf('/trips')).toBe('trips')
    expect(areaOf('/trip/abc?day=2')).toBe('trips')
    expect(areaOf('/explore?style=beach')).toBe('explore')
    expect(areaOf('/profile')).toBe('profile')
    expect(areaOf('/new')).toBe(null)
  })
})

describe('rendered navigation', () => {
  it('shows four items to a non-creator and no creator shortcut', () => {
    const html = markup('/profile', false)
    expect(labels(html)).toEqual(['Home', 'My trips', 'Explore', 'Profile'])
    expect(html).not.toContain('aria-label="Creator hub"')
    expect(current(html)).toEqual(['Profile'])
  })

  it('shows five items to a creator, with an accessible name on the short label', () => {
    const html = markup('/', true)
    expect(labels(html)).toEqual(['Home', 'My trips', 'Explore', 'Creator', 'Profile'])
    expect(html).toContain('aria-label="Creator hub"')
    expect(current(html)).toEqual(['Home'])
  })

  it('marks the creator item current on the hub route', () => {
    const html = markup('/creator-hub', true)
    expect(current(html)).toEqual(['Creator'])
  })

  it('leaves the creator item unlit on a non-hub route, and lights nothing on a hub visit by a non-creator', () => {
    expect(current(markup('/trips', true))).toEqual(['My trips'])
    // A non-creator who reaches the hub by typing the URL gets no lit tab: the
    // bar has no such item, and the page guard is what stops them.
    expect(current(markup('/creator-hub', false))).toEqual([])
  })
})
