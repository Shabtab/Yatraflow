// Mobile / Android-shell UX invariants (native-shell pass).
// Static source checks: they read the shipped files as text, so a regression
// in any of these shell-only rules fails CI without a device, an emulator or a
// browser. The recurring theme is website parity — every bottom-chrome rule
// here exists to prove the web build renders exactly what it rendered before.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')

const source = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')

/** Every declaration block in `cssText` whose selector is exactly `selector`. */
function rules(cssText: string, selector: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = cssText.indexOf(selector + ' {', from)
    if (at === -1) return out
    let depth = 0
    let end = at
    for (let i = cssText.indexOf('{', at); i < cssText.length; i++) {
      if (cssText[i] === '{') depth++
      else if (cssText[i] === '}' && --depth === 0) { end = i + 1; break }
    }
    if (end <= at) return out
    out.push(cssText.slice(at, end))
    from = end
  }
}

// 1 ---------------------------------------------------------------------------

describe('bottom navigation is a shell-only primary nav', () => {
  const nav = source('src/components/BottomNav.tsx')

  it('ships exactly the four destinations, in order', () => {
    const routes = [...nav.matchAll(/to:\s*'([^']+)'/g)].map(m => m[1])
    expect(routes).toEqual(['/', '/trips', '/explore', '/profile'])
  })

  it('uses real buttons and marks the current page for assistive tech', () => {
    expect(nav).toContain('<button')
    expect(nav).toContain('type="button"')
    expect(nav).toContain("aria-current={active ? 'page' : undefined}")
    expect(nav).toContain('role="navigation"')
    expect(nav).toContain('aria-label="Primary"')
  })

  it('keeps the trip workspace under My trips and leaves other routes unlit', () => {
    expect(nav).toContain("path.startsWith('/trip/')")
    expect(nav).toContain('return null')
  })

  it('mounts only behind the native gate in App.tsx', () => {
    expect(app).toContain("import { BottomNav } from './components/BottomNav'")
    expect(app).toContain('{isNative && me && <BottomNav route={route} onNavigate={navigate} />}')
  })

  it('hides the website top bar for the signed-in shell', () => {
    // The signed-in app drops the floating topnav entirely — its controls
    // (theme, notifications, account) relocate to the Profile page. The
    // topnav stays for signed-out users (login entry) and the web.
    expect(app).toContain('(!isNative || !me) &&')
    // And the relocated controls actually landed in Profile:
    const profile = source('src/pages/Profile.tsx')
    expect(profile).toContain('Appearance')
    expect(profile).toContain('setTheme(!dark)')
    expect(profile).toContain('notificationsFor(me.id)')
    expect(profile).toContain('feedbackHref()')
    expect(profile).toContain('logout()')
  })

  it('hides the redundant floating pill but keeps the hamburger overflow', () => {
    expect(css).toContain('html.native-shell .nav-links { display: none; }')
    expect(app).toContain('className="mobile-nav-btn"')
    // the tray keeps every destination the pill carried
    for (const dest of ['#/trips', '#/new', '#/explore', '#/creator-hub', '#/profile']) {
      expect(app, `${dest} must stay reachable`).toContain(dest)
    }
  })
})

// 2 ---------------------------------------------------------------------------

describe('safe-area fallback chain', () => {
  it('never reads env(safe-area-*) bare', () => {
    // Strip the canonical chain; anything env(safe-area-*) still standing is a
    // consumer that skipped it (env() reads 0 on Android WebViews).
    const stripped = css.replace(
      /var\(--safe-area-inset-(top|right|bottom|left),\s*env\(safe-area-inset-\1,\s*0px\)\)/g,
      'SAFE',
    )
    const bare = [...stripped.matchAll(/env\(safe-area[^)]*\)/g)].map(m => m[0])
    expect(bare, `bare env() reads: ${bare.join('; ')}`).toEqual([])
  })

  it('routes the shared bottom token through that same chain', () => {
    expect(css).toContain('--safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));')
  })
})

// 3 ---------------------------------------------------------------------------

describe('bottom chrome offset', () => {
  it('keeps the shell offset inert on the web', () => {
    // Exactly two definitions: the :root default the website resolves, and the
    // shell's. A third (or a reordering) would let a shell value leak out.
    const defs = [...css.matchAll(/--shell-nav-h:\s*([^;]+);/g)].map(m => m[1].trim())
    expect(defs, 'web default 0px, shell 58px').toEqual(['0px', '58px'])
    expect(rules(css, 'html.native-shell').join('\n')).toContain('--shell-nav-h: 58px;')
    expect(css).toContain('--bottom-ui-offset: calc(var(--shell-nav-h) + var(--safe-bottom));')
  })

  const lifted: Array<[string, string]> = [
    ['.app-shell', 'padding-bottom: var(--bottom-ui-offset)'],
    ['.toast-zone', 'bottom: calc(18px + var(--bottom-ui-offset))'],
    ['.ai-fab', 'bottom: calc(18px + var(--bottom-ui-offset))'],
    ['.bench-dock', 'bottom: calc(12px + var(--bottom-ui-offset))'],
    ['.ts-savebar', 'padding: 8px 0 calc(8px + var(--bottom-ui-offset))'],
    ['.trip-dock', 'bottom: calc(12px + var(--bottom-ui-offset))'],
  ]

  it.each(lifted)('%s clears the bottom nav and the gesture bar', (selector, decl) => {
    expect(rules(css, selector).join('\n')).toContain(decl)
  })

  it('leaves the true-bottom overlays on the raw inset', () => {
    // These paint ABOVE the nav (--z-modal / --z-impact / --z-drawer /
    // --z-map-expanded all beat --z-nav-glass), so they own the real bottom
    // edge and must not be pushed up by the shell's nav.
    for (const sel of ['.modal', '.modal-overlay', '.impact-sheet', '.ai-drawer', '.ai-input-row', '.map-shell--expanded']) {
      expect(rules(css, sel).join('\n'), `${sel} owns the bottom edge`).not.toContain('--bottom-ui-offset')
    }
  })

  it('sizes the nav itself to exactly one offset', () => {
    const nav = rules(css, '.bottom-nav').join('\n')
    expect(nav).toContain('height: calc(var(--shell-nav-h) + var(--safe-bottom))')
    expect(nav).toContain('padding-bottom: var(--safe-bottom)')
    expect(nav).toContain('z-index: var(--z-nav-glass)')
  })
})

// 4 ---------------------------------------------------------------------------

describe('inline map gestures', () => {
  const mapcn = source('src/components/mapcn/map.tsx')
  const tripMap = source('src/components/TripMap.tsx')

  /**
   * The shipped body of CooperativeGestures' effect, brace-matched out of the
   * file. It is still read as text — but the unit under test here is the ORDER
   * of the guard, and only running the real statements can show that a fine
   * pointer never reaches MapLibre's handler.
   */
  function cooperativeEffectBody(): string {
    const fn = tripMap.indexOf('function CooperativeGestures(')
    const open = tripMap.indexOf('useEffect(() => {', fn)
    expect(fn, 'CooperativeGestures is mounted').toBeGreaterThan(-1)
    expect(open, 'it switches through an effect').toBeGreaterThan(-1)
    let depth = 0
    for (let i = tripMap.indexOf('{', open); i < tripMap.length; i++) {
      if (tripMap[i] === '{') depth++
      else if (tripMap[i] === '}' && --depth === 0) {
        return tripMap.slice(tripMap.indexOf('{', open) + 1, i)
      }
    }
    throw new Error('CooperativeGestures: unbalanced effect body')
  }

  /** Run that body against a stub map and record every handler call it makes. */
  function runSwitch(opts: { coarse: boolean; enabled: boolean }): string[] {
    const calls: string[] = []
    const map = {
      cooperativeGestures: {
        enable: () => calls.push('enable'),
        disable: () => calls.push('disable'),
      },
    }
    try {
      new Function(
        'map', 'isLoaded', 'enabled', 'prefersCooperativeGestures',
        cooperativeEffectBody(),
      )(map, true, opts.enabled, () => opts.coarse)
    } catch (e) {
      throw new Error(`could not execute the shipped effect body verbatim: ${String(e)}`)
    }
    return calls
  }

  it('opts every embed into cooperative gestures on touch devices only', () => {
    // One exported predicate, called by the construction default...
    expect(mapcn).toContain('export function prefersCooperativeGestures(): boolean')
    expect(mapcn).toContain('cooperativeGestures: prefersCooperativeGestures()')
    expect(mapcn).toContain('"(pointer: coarse)"')
    // The default must be declared BEFORE the caller's props, so an embed can
    // still opt out at construction.
    const from = mapcn.indexOf('new MapLibreGL.Map({')
    const init = mapcn.slice(from, mapcn.indexOf('});', from))
    expect(init.indexOf('cooperativeGestures:')).toBeGreaterThan(-1)
    expect(init.indexOf('cooperativeGestures:')).toBeLessThan(init.indexOf('...props,'))
  })

  it('switches through that same predicate and never enables it on a fine pointer', () => {
    // ...and by the runtime switch, which imports that exact symbol rather than
    // re-deriving the pointer query — so the two paths cannot drift apart.
    expect(tripMap).toMatch(
      /import\s*\{[^}]*\bprefersCooperativeGestures\b[^}]*\}\s*from\s*'\.\/mapcn\/map'/,
    )
    expect(tripMap).not.toContain('(pointer: coarse)')

    // The inline-vs-expanded split still holds, on a coarse pointer: inline
    // keeps the two-finger mode, the expanded overlay hands gestures back.
    expect(tripMap).toContain('<CooperativeGestures enabled={!expanded} />')
    expect(runSwitch({ coarse: true, enabled: true })).toEqual(['enable'])
    expect(runSwitch({ coarse: true, enabled: false })).toEqual(['disable'])

    // A fine pointer reaches neither call. enable() would block plain
    // wheel-zoom and paint the two-finger hint over a mouse desktop, and
    // disable() has nothing to undo — the constructed state is already right.
    expect(runSwitch({ coarse: false, enabled: true })).toEqual([])
    expect(runSwitch({ coarse: false, enabled: false })).toEqual([])
    const body = cooperativeEffectBody()
    const gate = body.indexOf('prefersCooperativeGestures()')
    expect(gate, 'the fine-pointer gate must exist').toBeGreaterThan(-1)
    expect(gate, 'and must precede the first handler call').toBeLessThan(
      body.indexOf('map.cooperativeGestures'),
    )
  })
})

// 6 ---------------------------------------------------------------------------

describe('the shell never renders the marketing landing', () => {
  it('keeps the hydration ready-gate covering the bare route inside the shell', () => {
    // The web paints its landing instantly while the store hydrates (the
    // !bareRoute exclusion); the installed app must show the loading block
    // instead, so a signed-in user never flashes the website's home — logo
    // bar and all — before their app home arrives. Regression: the gate used
    // to exclude the bare route unconditionally, so every launch flashed the
    // marketing landing for as long as hydration took past the splash.
    expect(app).toContain('(!bareRoute || isNative)')
  })

  it('falls an unknown deep link back to the app home in the shell, not the landing', () => {
    // The route switch's default is the LAST "default:" in the file — every
    // lazy import above also writes `.then(m => ({ default: … }))`.
    const at = app.lastIndexOf('default:')
    expect(at).toBeGreaterThan(-1)
    const body = app.slice(at, at + 500)
    expect(body).toContain('isNative && me')
    expect(body).toContain('<NativeHomePage')
  })
})

// 5 ---------------------------------------------------------------------------

describe('soft keyboard resizes the WebView', () => {
  it('pins adjustResize on MainActivity instead of the platform default', () => {
    expect(manifest).toContain('android:windowSoftInputMode="adjustResize"')
    // The attribute form, not the word — the manifest's own comment about the
    // default heuristic must not satisfy (or break) this check.
    expect(manifest).not.toContain('android:windowSoftInputMode="adjustUnspecified"')
  })
})
