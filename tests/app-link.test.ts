import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appLink, appLinkHref, shouldHandleAppLink } from '../src/lib/appLink'
import { forceNativeRouting, navigate } from '../src/lib/router'
import * as routeTable from '../src/lib/routes'

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
  })
})

// The hash-route ban covers every src component. Source is read with CRLF
// folded to LF, so a line break never hides a link from the pattern.
const srcRoot = new URL('../src/', import.meta.url)
const componentFiles = readdirSync(srcRoot, { recursive: true })
  .map(file => String(file).split('\\').join('/'))
  .filter(file => file.endsWith('.tsx'))
const readComponent = (file: string) => readFileSync(new URL(file, srcRoot), 'utf8').replace(/\r\n/g, '\n')

// Whole-line comments are prose, so a route named in a comment is not a link.
const isCommentLine = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line)
// Identifier tokens in a source fragment. A token is a whole identifier, so
// CREATE_ROUTE never matches inside CREATE_ROUTES.
const identifiersIn = (text: string): Set<string> => new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])

// Route constants whose value is a hash address. Found by value, not by name,
// so a renamed constant with the same hash value is still caught.
const HASH_CONSTANTS = Object.entries(routeTable)
  .filter(([, value]) => typeof value === 'string' && value.startsWith('#/'))
  .map(([name]) => name)

// Names declared on one line whose value reaches a hash address, carried to a
// fixed point: `const startPlanningHref = me ? CREATE_ROUTE : …` is hash-valued.
function hashValuedNames(lines: string[]): Set<string> {
  const declarations = lines
    .filter(line => !isCommentLine(line))
    .map(line => /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => ({ name: match[1], value: match[2] }))
  const hashValued = new Set(HASH_CONSTANTS)
  let grew = true
  while (grew) {
    grew = false
    for (const { name, value } of declarations) {
      const valueIds = identifiersIn(value)
      const reachesHash = value.includes('#/') || [...hashValued].some(hash => valueIds.has(hash))
      if (!hashValued.has(name) && reachesHash) {
        hashValued.add(name)
        grew = true
      }
    }
  }
  return hashValued
}

// Offending lines: a quoted hash-route literal, or an href expression that names
// a hash-valued name. Page anchors such as href="#main" do not start with #/.
function hashRouteOffenders(): string[] {
  const offenders: string[] = []
  for (const file of componentFiles) {
    const lines = readComponent(file).split('\n')
    const hashValued = hashValuedNames(lines)
    lines.forEach((line, index) => {
      if (isCommentLine(line)) return
      const quotedHash = /["'`]#\//.test(line)
      const href = /\bhref\s*=\s*\{([^}]*)\}/.exec(line)
      const computedHash = href !== null && [...identifiersIn(href[1])].some(id => hashValued.has(id))
      if (quotedHash || computedHash) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
    })
  }
  return offenders
}

describe('no component links to a hash route', () => {
  it('scans every src component and finds the hash constant by value', () => {
    // Without these, a scan that found nothing would pass while checking nothing.
    expect(componentFiles.length).toBeGreaterThan(40)
    expect(HASH_CONSTANTS).toContain('CREATE_ROUTE')
  })

  it('bans hash-route anchors, string links and computed hrefs in src', () => {
    expect(hashRouteOffenders()).toEqual([])
  })
})

describe('the signed-out planning link keeps its signup mode and return path', () => {
  it('targets signup with the create-trip page as the next step', () => {
    expect(routeTable.signupThenCreatePath()).toBe('/auth?mode=signup&next=%2Fnew')
  })

  it('keeps the query on the web and the fragment form in the native shell', () => {
    const target = routeTable.signupThenCreatePath()
    expect(appLinkHref(target, false, 'https:')).toBe('/auth?mode=signup&next=%2Fnew')
    expect(appLinkHref(target, true, 'https:')).toBe('#/auth?mode=signup&next=%2Fnew')
  })
})
