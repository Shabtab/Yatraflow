import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appLink, appLinkHref, shouldHandleAppLink } from '../src/lib/appLink'
import { forceNativeRouting, navigate } from '../src/lib/router'

const plainClick = {
  button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false,
}
// #426 slice 2: routes are real paths on the web — the address bar and the
// router read the same pathname, so a link's href IS the destination.
const routes = ['/', '/trips', '/new', '/explore', '/creator-hub', '/auth', '/auth?mode=signup', '/profile', '/creator/alice'] as const

beforeEach(() => forceNativeRouting(null))
afterEach(() => { forceNativeRouting(null); vi.unstubAllGlobals() })

describe('app link hrefs', () => {
  it.each(routes)('carries the path itself for %s', route => {
    const href = appLinkHref(route)
    expect(href).toBe(route)
    const target = new URL(href, 'https://app.example.test/trips')
    expect(target.pathname + target.search).toBe(route)
  })

  it.each(['file:', 'capacitor:'])('keeps the fragment form on %s', protocol => {
    expect(appLinkHref('/explore', false, protocol)).toBe('#/explore')
  })

  it('keeps native https WebViews fragment-only', () => {
    expect(appLinkHref('/explore', true, 'https:')).toBe('#/explore')
  })
})

describe('app link click decisions', () => {
  it('handles unmodified left clicks and explicit same-tab targets', () => {
    expect(shouldHandleAppLink(plainClick)).toBe(true)
    expect(shouldHandleAppLink(plainClick, '_self')).toBe(true)
  })

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'defaultPrevented'] as const)('leaves %s clicks to their existing handler', flag => {
    expect(shouldHandleAppLink({ ...plainClick, [flag]: true })).toBe(false)
  })

  it.each([1, 2, 3, 4])('ignores mouse button %s', button => {
    expect(shouldHandleAppLink({ ...plainClick, button })).toBe(false)
  })

  it.each(['_blank', '_parent', '_top', 'other-tab'])('leaves target %s to the browser', target => {
    expect(shouldHandleAppLink(plainClick, target)).toBe(false)
  })

  it('leaves download anchors to the browser', () => {
    expect(shouldHandleAppLink(plainClick, '', true)).toBe(false)
  })

  // URL objects and structural event stubs exercise the adapter, not DOM events,
  // browser tab creation, popstate delivery or document-load counts.
  it('prevents the full page load and pushes one history entry for a same-tab click', () => {
    const address = new URL('https://app.example.test/trips')
    vi.stubGlobal('location', address)
    const entries: string[] = []
    vi.stubGlobal('history', { state: null, pushState: (_s: unknown, _t: string, url: string) => entries.push(url), replaceState: () => {} })
    const link = appLink('/auth?mode=signup')
    const preventDefault = vi.fn()
    link.onClick({ ...plainClick, preventDefault, currentTarget: { target: '', hasAttribute: () => false } } as unknown as Parameters<typeof link.onClick>[0])
    expect(link.href).toBe('/auth?mode=signup')
    expect(preventDefault).toHaveBeenCalledOnce()
    // One pushState inside the running document — the full page load the
    // preventDefault exists for would have dropped the store and the shell.
    expect(entries).toEqual(['/auth?mode=signup'])
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { button: 1 }, { defaultPrevented: true }])('does not navigate or cancel a browser-owned click: %j', override => {
    const address = new URL('https://app.example.test/trips')
    vi.stubGlobal('location', address)
    const entries: string[] = []
    vi.stubGlobal('history', { state: null, pushState: (_s: unknown, _t: string, url: string) => entries.push(url), replaceState: () => {} })
    const link = appLink('/explore')
    const preventDefault = vi.fn()
    link.onClick({ ...plainClick, ...override, preventDefault, currentTarget: { target: '', hasAttribute: () => false } } as unknown as Parameters<typeof link.onClick>[0])
    expect(preventDefault).not.toHaveBeenCalled()
    expect(entries).toEqual([])
  })
})

describe('native links stay fragments until slice 4', () => {
  it('the native shell navigates by hash, not pushState', () => {
    forceNativeRouting(true)
    const address = new URL('https://localhost/index.html')
    vi.stubGlobal('location', address)
    const push = vi.fn()
    vi.stubGlobal('history', { state: null, pushState: push, replaceState: () => {} })
    navigate('/trips')
    expect(push).not.toHaveBeenCalled()
    expect(address.hash).toBe('#/trips')
  })
})

describe('publication-reachable anchor wiring', () => {
  it.each([['../src/App.tsx', 13], ['../src/pages/PublicItinerary.tsx', 1]] as const)('uses the shared pattern on every route anchor in %s', (path, count) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    expect(source.match(/\{\.\.\.appLink\(/g)).toHaveLength(count)
    // No anchor carries its route in a fragment any more — the sweep in
    // tests/route-integrity.test.ts reads the appLink destinations themselves.
    expect(source).not.toMatch(/href=\{?["'`]#\//)
  })
})
