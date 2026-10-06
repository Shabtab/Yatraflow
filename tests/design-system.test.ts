// Design-system consistency invariants (v0.48 pass).
// Static source checks: they read the shipped files as text, so a regression
// in any of these rules fails CI without needing a browser.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')

const srcRoot = new URL('../src/', import.meta.url)
const sourceFiles = readdirSync(srcRoot, { recursive: true })
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => {
    const rel = 'src/' + f.split('\\').join('/')
    return { rel, text: readFileSync(new URL('../' + rel, import.meta.url), 'utf8') }
  })

const source = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')

const loadedWeights = (s: string): Set<number> => {
  const out = new Set<number>()
  // Family-agnostic on purpose: read every vendored weight import rather than
  // naming the families, so swapping one (Inter -> Plus Jakarta Sans, Sep 2026)
  // or adding a third cannot silently empty this set and turn the gate into a
  // no-op that passes on nothing. The fonts moved off the Google CDN onto
  // @fontsource imports in main.tsx (2026-10-06), so the gate follows them.
  for (const m of s.matchAll(/@fontsource\/[a-z-]+\/(\d+)\.css/g)) {
    out.add(Number(m[1]))
  }
  return out
}

/** Ranges of every @media block whose condition contains `query`. */
function mediaBlocks(cssText: string, query: string): string[] {
  const lines = cssText.split(/\r?\n/)
  const out: string[] = []
  let start = -1
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (start === -1 && line.includes(query) && line.includes('{')) {
      start = i
      depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
      continue
    }
    if (start !== -1) {
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
      if (depth <= 0) {
        out.push(lines.slice(start, i + 1).join('\n'))
        start = -1
      }
    }
  }
  return out
}

// 1 ---------------------------------------------------------------------------

describe('font weights match the loaded faces', () => {
  const loaded = loadedWeights(main)

  it('loads the canonical weight set (Plus Jakarta Sans 400-800, Sora 600-800)', () => {
    for (const w of [400, 500, 600, 700, 800]) expect(loaded.has(w), `Plus Jakarta Sans/Sora must ship ${w}`).toBe(true)
  })

  it('declares no font-weight that the vendored imports do not load', () => {
    const declared = [...css.matchAll(/font-weight:\s*(\d+)/g)].map((m) => Number(m[1]))
    expect(declared.length).toBeGreaterThan(100)
    const off = [...new Set(declared.filter((w) => !loaded.has(w)))]
    expect(off, `declared but not loaded: ${off.join(', ')}`).toEqual([])
  })

  it('keeps inline fontWeight styles inside the loaded faces', () => {
    const off: string[] = []
    for (const { rel, text } of sourceFiles) {
      for (const m of text.matchAll(/fontWeight:\s*["']?(\d+)/g)) {
        const w = Number(m[1])
        if (!loaded.has(w)) off.push(`${rel} -> ${w}`)
      }
    }
    expect(off, off.join('; ')).toEqual([])
  })
})

// 2 ---------------------------------------------------------------------------

describe('glass blur tiers', () => {
  it('defines the four tier tokens', () => {
    expect(css).toContain('--yf-blur-nav: 18px')
    expect(css).toContain('--yf-blur-panel: 14px')
    expect(css).toContain('--yf-blur-chip: 8px')
    expect(css).toContain('--yf-blur-scrim: 3px')
  })

  it('has retired the superseded sm/md/lg ladder', () => {
    expect(css).not.toMatch(/--yf-blur-(sm|md|lg)\b/)
  })

  it('routes every backdrop-filter through a tier token', () => {
    const lines = css.split(/\r?\n/)
    let selector = ''
    const offenders: string[] = []
    const exceptions: string[] = []
    lines.forEach((line, i) => {
      const sel = line.match(/([^{}]+)\{/)
      if (sel) selector = sel[1].trim()
      const dm = line.match(/backdrop-filter:\s*blur\(([^)]*)\)/)
      if (!dm) return
      const arg = dm[1].trim()
      if (arg.startsWith('var(--yf-blur-')) return
      if (arg === '1.5px' && /locked-cta/.test(selector)) {
        exceptions.push(selector)
        return
      }
      offenders.push(`line ${i + 1} (${selector || 'unknown'}): blur(${arg})`)
    })
    expect(exceptions, 'the locked-CTA scrim is the single documented 1.5px exception').toHaveLength(1)
    expect(offenders, offenders.join('; ')).toEqual([])
  })

  it('still uses every tier somewhere', () => {
    for (const tier of ['nav', 'panel', 'chip', 'scrim']) {
      expect(css).toContain(`var(--yf-blur-${tier})`)
    }
  })
})

// 3 ---------------------------------------------------------------------------

describe('one green (#0D8D82)', () => {
  it('re-points the primary primitive to the CTI teal', () => {
    expect(css).toContain('--teal-500: #0D8D82;')
  })

  it('keeps light and dark themes in parity with the CTI scale', () => {
    const teal500 = [...css.matchAll(/--teal-500:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1].toUpperCase())
    const yfTeal600 = [...css.matchAll(/--yf-teal-600:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1].toUpperCase())
    expect(teal500.length).toBe(2)
    expect(yfTeal600.length).toBe(2)
    expect(teal500[0]).toBe(yfTeal600[0])
    expect(teal500[1]).toBe(yfTeal600[1])
  })

  it('drives the focus ring and form accents through the CTI token', () => {
    expect(css).toContain('accent-color: var(--yf-teal-600);')
    // The ring's VISIBILITY is asserted as an outcome in 'a focus indicator you
    // can actually see' below. This used to pin the implementation instead
    // (`color-mix(in srgb, var(--yf-teal-600) 35%, transparent)`), which froze
    // an alpha that measured 1.50:1 against --bg — the pin held the defect in
    // place, so changing the tint failed the build that should have wanted it.
    // What matters here is only that the ring still routes through the CTI
    // token, in both themes.
    for (const tokens of [rootTokens, darkTokens]) {
      expect(tokens.get('--ring')).toContain('var(--yf-teal-600)')
    }
  })

  it('paints the primary button through the semantic chain', () => {
    expect(css).toContain('.btn-primary { background: var(--color-primary);')
    expect(css).toContain('--color-primary: var(--teal-500);')
  })

  it('retires the old teal everywhere', () => {
    expect(css).not.toContain('149A90')
    expect(html).not.toContain('149A90')
    for (const { rel, text } of sourceFiles) {
      expect(text, rel).not.toContain('149A90')
      expect(text, rel).not.toContain('20, 154, 144')
    }
  })

  it('keeps the map palette, logo mark and favicon on the unified green', () => {
    expect(source('src/components/TripMap.tsx')).toContain("const DAY_COLORS = ['#0D8D82'")
    expect(source('src/components/ui.tsx')).toContain('fill="#0D8D82"')
    expect(html).toContain("%230D8D82")
  })
})

// 4 ---------------------------------------------------------------------------

describe('kicker casing: sentence case in source, uppercase via CSS', () => {
  const retyped: Array<[string, string, string]> = [
    ['src/pages/PublicItinerary.tsx', 'The journey', 'THE JOURNEY'],
    ['src/pages/PublicItinerary.tsx', 'Trip highlights', 'TRIP HIGHLIGHTS'],
    ['src/pages/PublicItinerary.tsx', 'The practical bit', 'THE PRACTICAL BIT'],
    ['src/pages/PublicItinerary.tsx', 'The route at a glance', 'THE ROUTE AT A GLANCE'],
    ['src/pages/PublicItinerary.tsx', 'Why this route works', 'WHY THIS ROUTE WORKS'],
    ['src/pages/Explore.tsx', 'Featured itinerary', 'FEATURED ITINERARY'],
  ]

  it.each(retyped)('types "%s" in sentence case and drops the caps form', (file, good, bad) => {
    const src = source(file)
    expect(src).toContain(good)
    expect(src).not.toContain(bad)
  })

  it('types the day badges in sentence case', () => {
    for (const file of ['src/pages/trip/timeline/DaySection.tsx', 'src/pages/PublicItinerary.tsx']) {
      expect(source(file)).toContain('<small>Day</small>')
      expect(source(file)).not.toContain('<small>DAY</small>')
    }
  })

  it('keeps the decorative stamps CSS-uppercased too', () => {
    expect(source('src/components/PlanBench.tsx')).toContain('>Estimate</span>')
    expect(source('src/pages/trip/TripSettingsForm.tsx')).toContain('>Preview</span>')
    expect(css).toMatch(/\.bench-stamp \{[^}]*text-transform: uppercase/)
  })

  it('owns the uppercase look through the unified kicker block', () => {
    expect(css).toContain('font-size: var(--kicker-size)')
    expect(css).toContain('text-transform: uppercase;')
    expect(css).toContain('.editorial-kicker, .pub-stats-label,')
    expect(css).toContain('.route-glance .route-glance-label,')
  })

  it('keeps visible all-caps text to the documented allowlist', () => {
    const allow = new Set([
      'CNG',
      'SEAT 1A',
      'YF-10S',
      'DISCOVER \u00b7 TRUST \u00b7 FORK',
      'YATRAFLOW \u00b7 ROUGH BILL',
    ])
    const offenders: string[] = []
    for (const { rel, text } of sourceFiles.filter((f) => f.rel.endsWith('.tsx'))) {
      for (const m of text.matchAll(/>([^<>{}\n]{2,80})</g)) {
        const t = m[1].trim()
        if (!t || t.includes('&')) continue
        const core = t.replace(/\u00b7/g, ' ')
        if (/^[A-Z0-9]/.test(t) && /^[A-Z0-9 &'\.,\-\/:]+$/.test(core) && /[A-Z]{2,}/.test(t) && !allow.has(t)) {
          offenders.push(`${rel}: "${t}"`)
        }
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([])
  })
})

// 5 ---------------------------------------------------------------------------

describe('mobile row-action touch targets', () => {
  const mobile = mediaBlocks(css, '(max-width: 720px)').join('\n')

  it('sizes the timeline row actions at exactly 40px inside the <=720px block', () => {
    expect(mobile).toContain('.move-btn { width: 40px; height: 40px;')
    expect(mobile).toContain('.stop-actions .icon-btn { width: 40px; height: 40px; }')
  })

  it('leaves no smaller definition for them behind', () => {
    expect(css).not.toMatch(/\.move-btn \{ width: (2\d|3\d)px/)
    expect(css).not.toMatch(/\.stop-actions \.icon-btn \{ width: (2\d|3\d)px/)
  })
})

// 6 ---------------------------------------------------------------------------
// The #107 classes, as regression gates.
// The v0.53.0 audit found its defects by measuring the shipped CSS by hand; these
// checks make the two highest-volume measurements permanent, so the same class of
// defect fails `npm run verify` instead of waiting for the next audit.

/** Blank out comments but keep every newline, so reported line numbers stay true. */
const stripCssComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/** Body of the first top-level block whose selector line matches `re`. */
function topLevelBlock(text: string, re: RegExp): string {
  const m = re.exec(text)
  if (!m) return ''
  const open = text.indexOf('{', m.index)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i)
  }
  return ''
}

/** First declaration of each property in a block. */
function declMap(block: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of block.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const key = m[1].trim()
    if (!out.has(key)) out.set(key, m[2].trim())
  }
  return out
}

const rootTokens = declMap(stripCssComments(topLevelBlock(css, /^:root\s*\{/m)))
const darkOverrides = declMap(stripCssComments(topLevelBlock(css, /^\[data-theme='dark'\]\s*\{/m)))
const darkTokens = new Map<string, string>([...rootTokens, ...darkOverrides])

/** Follow a `var(--token)` chain inside one theme's table. */
function resolveVar(value: string, tokens: Map<string, string>, depth = 0): string {
  const v = value.trim()
  if (depth > 8) return v
  const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/)
  if (!m) return v
  const next = tokens.get(m[1]) ?? (m[2] === undefined ? undefined : m[2].trim())
  return next === undefined ? v : resolveVar(next, tokens, depth + 1)
}

interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

function parseColor(value: string): Rgb | null {
  const s = value.trim().toLowerCase()
  if (['transparent', 'none', 'currentcolor', 'inherit', 'unset', 'initial'].includes(s)) return null
  let m = s.match(/^#([0-9a-f]{3})$/)
  if (m) {
    const [r, g, b] = [...m[1]].map((c) => parseInt(c + c, 16))
    return { r, g, b, a: 1 }
  }
  m = s.match(/^#([0-9a-f]{6})$/)
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/)
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a }
  }
  return null
}

const channel = (c: number) => {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}
const luminance = ({ r, g, b }: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

/** WCAG contrast, compositing a translucent foreground over the background. */
function contrast(fg: Rgb, bg: Rgb): number {
  const flat: Rgb =
    fg.a < 1
      ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 }
      : fg
  const values = [luminance(flat), luminance(bg)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

interface CssRule {
  selector: string
  body: string
  line: number
}

/** Top-level rules only (rules inside @media are out of scope — see the note). */
function topLevelRules(text: string): CssRule[] {
  const src = stripCssComments(text)
  const out: CssRule[] = []
  let selector = ''
  let body = ''
  let depth = 0
  let line = 1
  let selectorLine = 1
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\n') line++
    if (c === '{') {
      if (depth === 0) {
        selectorLine = line
        body = ''
      }
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) {
        const s = selector.trim()
        if (s && !s.startsWith('@') && body.includes(':')) out.push({ selector: s, body, line: selectorLine })
        selector = ''
      }
    } else if (depth === 0) selector += c
    else if (depth === 1) body += c
  }
  return out
}

const cssRules = topLevelRules(css)

/** Base selectors that a `[data-theme='dark'] …` rule re-styles. */
const darkOverridden = new Set<string>()
for (const rule of cssRules) {
  for (const part of rule.selector.split(',')) {
    const m = part.trim().match(/^\[data-theme='dark'\]\s+([\s\S]+)$/)
    if (m) darkOverridden.add(m[1].trim().replace(/\s+/g, ' '))
  }
}

/** Base selectors a `:root:not([data-theme='dark']) …` rule re-styles (the light-only deepen). */
const lightOverridden = new Set<string>()
for (const rule of cssRules) {
  for (const part of rule.selector.split(',')) {
    const m = part.trim().match(/^:root:not\(\[data-theme='dark'\]\)\s+([\s\S]+)$/)
    if (m) lightOverridden.add(m[1].trim().replace(/\s+/g, ' '))
  }
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim()

// --- ratchet ------------------------------------------------------------------
// The audit's classes are measured here, but a handful of the results are
// deliberate owner decisions or surfaces whose real backdrop lives outside this
// file. So the known set is frozen in a committed baseline that may only shrink:
// a NEW offender fails the build, and an entry that no longer reproduces must be
// deleted (re-baseline deliberately with UPDATE_DESIGN_SYSTEM_BASELINE=1).
//
// Every key is the offender's own text with the `styles.css:<line>` prefix
// DROPPED, for the same reason in every gate: a line number is where a rule
// happens to sit, not what it is, so a key carrying one is invalidated by any
// insertion above it — every CSS edit anywhere in the file re-failed the
// contrast and duration gates with phantom "new violations" and forced a
// re-baseline instead (hit twice, and it is what a rebase between two branches
// that both moved `styles.css` conflicted on). Keyed by what the rule declares,
// a shift moves nothing and only a real change to that declaration does. The
// trade-off is explicit and narrow: a *second* rule repeating an
// already-tolerated pair is not flagged, because the pair is what the key
// names — `duplicateSelectors` catches that selector twice at the top level,
// which is where it would surface first.

const baselineUrl = new URL('./design-system-baseline.json', import.meta.url)
const updatingBaseline = process.env.UPDATE_DESIGN_SYSTEM_BASELINE === '1'

function ratchet(key: string, offenders: string[]): void {
  const baseline = JSON.parse(readFileSync(baselineUrl, 'utf8')) as Record<string, string[]>
  const current = [...new Set(offenders)].sort()
  if (updatingBaseline) {
    baseline[key] = current
    writeFileSync(baselineUrl, JSON.stringify(baseline, null, 2) + '\n')
    return
  }
  const known = new Set(baseline[key] ?? [])
  const added = current.filter((o) => !known.has(o))
  const cleared = (baseline[key] ?? []).filter((o) => !current.includes(o))
  expect(added, `new ${key} violation(s) — fix them, or re-baseline deliberately:\n${added.join('\n')}`).toEqual([])
  expect(cleared, `${key}: these no longer reproduce — delete them from design-system-baseline.json:\n${cleared.join('\n')}`).toEqual([])
}

describe('contrast contract: colour pairs declared in one rule', () => {
  it('parses both theme token blocks and the rule set', () => {
    expect(rootTokens.size).toBeGreaterThan(100)
    expect(darkOverrides.size).toBeGreaterThan(30)
    expect(cssRules.length).toBeGreaterThan(400)
  })

  const offendersFor = (theme: 'light' | 'dark'): string[] => {
    const tokens = theme === 'light' ? rootTokens : darkTokens
    const out: string[] = []
    for (const rule of cssRules) {
      const sel = normalise(rule.selector)
      const isDarkRule = sel.startsWith("[data-theme='dark']")
      const isLightOnly = sel.includes(":not([data-theme='dark'])")
      if (theme === 'light' && isDarkRule) continue
      if (theme === 'dark' && isLightOnly) continue
      if (theme === 'dark' && !isDarkRule && darkOverridden.has(sel)) continue
      if (theme === 'light' && !isLightOnly && lightOverridden.has(sel)) continue
      const decls = declMap(rule.body)
      const fgRaw = decls.get('color')
      const bgRaw = decls.get('background-color') ?? decls.get('background')
      if (fgRaw === undefined || bgRaw === undefined) continue
      const fg = parseColor(resolveVar(fgRaw, tokens))
      const bg = parseColor(resolveVar(bgRaw, tokens))
      if (!fg || !bg) continue
      // A translucent backdrop sits on a surface this file cannot see (a hero band,
      // the page atmosphere), so its real contrast is unknowable from source alone.
      if (bg.a !== 1) continue
      const ratio = contrast(fg, bg)
      if (ratio < 4.5) out.push(`${sel} — ${ratio.toFixed(2)}:1`)
    }
    return out
  }

  // #154: the mechanical gate above only sees rules that declare fg+bg in ONE
  // rule — a color-only override like `.poi-fact--warn { color: … }` on a
  // separate background rule was invisible to it, which is exactly how the
  // 3.65:1 warn-on-white shipped. These pins make the Map-rail's warn-ink
  // pairs an explicit contract: measured against the surfaces the rail
  // actually paints (its own card bg, and the soft warn chip fill).
  //
  // #271 added five more colour-only amber-ink rules (the closing-slot label,
  // the empty-slot hint, the day chip's rain flag, the unplanned shape block,
  // the empty matrix cell) and reproduced the same 3.65:1 — on `--card`, which
  // was not in this list. `--card` is therefore a pinned surface now, and every
  // amber-ink rule in the rail routes through `--ink-amber` (which resolves to
  // `--warn` in the dark theme, where the surface token IS the ink token).
  it('map-rail warn ink meets AA on every surface it paints (#154)', () => {
    const surfaces: Array<[string, string]> = [
      ['--bg', 'card background'],
      ['--card', 'raised card / rail surface'],
      ['--warn-soft', 'warn chip fill'],
    ]
    for (const [theme, tokens] of [['light', rootTokens], ['dark', darkTokens]] as const) {
      const warn = resolveVar('var(--warn)', tokens)
      const ink = resolveVar('var(--ink-amber)', tokens)
      const warnFg = parseColor(warn)
      const inkFg = parseColor(ink)
      expect(warnFg, `--warn must resolve in ${theme}`).not.toBeNull()
      expect(inkFg, `--ink-amber must resolve in ${theme}`).not.toBeNull()
      for (const [bgVar, surfaceName] of surfaces) {
        const bg = parseColor(resolveVar(`var(${bgVar})`, tokens))
        expect(bg, `${bgVar} must resolve in ${theme}`).not.toBeNull()
        // whichever ink a rail warn surface uses in that theme must clear 4.5
        expect(
          contrast(theme === 'light' ? inkFg! : warnFg!, bg!),
          `${theme}: warn ink on ${surfaceName} (${bgVar}) must meet AA`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('introduces no new AA failure in the light theme', () => {
    ratchet('contrastLight', offendersFor('light'))
  })

  it('introduces no new AA failure in the dark theme', () => {
    ratchet('contrastDark', offendersFor('dark'))
  })
})

describe('no duplicate top-level selectors', () => {
  it('declares each top-level selector exactly once', () => {
    const seen = new Map<string, number[]>()
    for (const rule of cssRules) {
      const key = normalise(rule.selector)
      seen.set(key, [...(seen.get(key) ?? []), rule.line])
    }
    const dups = [...seen.entries()].filter(([, lines]) => lines.length > 1)
    ratchet('duplicateSelectors', dups.map(([sel]) => sel))
  })
})

describe('motion vocabulary: durations come from the tokens', () => {
  // AGENTS §2.10: a raw `ms` in a new CSS rule is a review flag. Ambient loops
  // (`infinite` keyframes — a spinner, a live ping) are a deliberate exception:
  // their cadence is a property of the ambient effect, not of a UI transition.
  it('introduces no new raw duration', () => {
    const offenders: string[] = []
    for (const rule of cssRules) {
      const decls = declMap(rule.body)
      for (const prop of ['transition', 'animation', 'transition-duration', 'animation-duration']) {
        const value = decls.get(prop)
        if (value === undefined) continue
        if (prop.startsWith('animation') && /\binfinite\b/.test(value)) continue
        for (const m of value.matchAll(/(?<![\d.])[0-9]*\.?[0-9]+m?s\b/g)) {
          if (parseFloat(m[0]) === 0) continue
          offenders.push(`${normalise(rule.selector)} — ${prop}: ${m[0]}`)
        }
      }
    }
    ratchet('rawDurations', offenders)
  })

  it('keeps the map tab on the motion tokens, not the legacy --t-* ladder', () => {
    // The map-tab review round moved the tab's own rules off the pre-catalog
    // ladder (--t-fast/med/slow); this holds that surface there. Scope is the
    // tab's selector families: toolbar chips and its filters popover, legend,
    // shell, skeleton, rails, slots, ledger rows, chevrons/fold, shelf, tips.
    const scoped = /\.(map-(day-chip|legend|shell|skel|idea|toolbar|filters|mode-group|util-group|day-filter)|slots-|day-slot|lrow-|lr-(go|name|meta)|poi-(chev|fold)|shelf-alt|engine-tips)/
    const legacy: string[] = []
    for (const rule of cssRules) {
      if (!rule.selector.split(',').some((p) => scoped.test(p.trim()))) continue
      for (const m of rule.body.matchAll(/var\(--t-(?:fast|med|slow)\)/g)) {
        legacy.push(`${normalise(rule.selector)} — ${m[0]}`)
      }
    }
    expect([...new Set(legacy)].sort(), `migrate these to var(--motion-*):\n${legacy.join('\n')}`).toEqual([])
  })
})

describe('the day collapse moves as one gesture', () => {
  // Measured 2026-09-19. The collapse ran on --ease-glide, and a day body runs
  // up to ~1000px: a decelerate curve throws 24% of that distance away in the
  // first 6ms (0 → 930px of 967 inside 45% of the duration), so the collapse
  // read as a pop followed by a 150ms dribble. Both --ease-glide and --ease-out
  // are that curve (they agree within .015 at every sampled point), so the fix
  // is the both-ends --ease-resize — ~3px of movement in the first 60Hz frame.
  //
  // Measured again the same day, frame by frame: with the right easing the row
  // below a folding day still moved 115px between two sampled frames (942px of
  // travel on --motion-slow) — the "cards colliding" report. Peak speed is
  // distance ÷ duration (x the curve's peak slope), so the collapse moved to
  // --motion-slower/560ms, and its curve was made symmetric: on this much
  // travel the Material standard curve peaks at 2.73x its average (96px inside
  // a 60Hz frame) against 1.72x for the symmetric one (60px), for the same
  // total time. Both halves are pinned here.
  const rule = (selector: string) => cssRules.find((r) => normalise(r.selector) === selector)

  it('opens and closes on the both-ends easing, not the decelerate family', () => {
    const clip = rule('.day-body-clip')
    expect(clip, '.day-body-clip is missing from styles.css').toBeTruthy()
    expect(clip!.body).toMatch(/transition:\s*grid-template-rows var\(--motion-slower\) var\(--ease-resize\)/)
    expect(clip!.body).not.toMatch(/--ease-(glide|out)\b/)
  })

  it('runs on the large-surface duration, and holds visibility for all of it', () => {
    // The inner's visibility must lag the whole collapse. Pinning both keeps a
    // retime from leaving content unpaintable mid-animation or a timer from
    // unmounting a body that is still moving.
    const inner = rule('.day-body-clip-inner')
    expect(inner, '.day-body-clip-inner is missing from styles.css').toBeTruthy()
    expect(inner!.body).toMatch(/visibility 0s var\(--motion-slower\)/)
    const declared = [...css.matchAll(/--motion-slower:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(declared).toEqual(['560ms'])
  })

  it('declares that easing once, in the motion token block', () => {
    // Symmetric, not the asymmetric Material standard curve: the peak slope is
    // what a large resize is felt through (see the comment above).
    const declared = [...css.matchAll(/--ease-resize:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(declared).toEqual(['cubic-bezier(.42, 0, .58, 1)'])
  })

  it('turns the chevron on the same clock as the body', () => {
    // At --t-fast/180ms the arrow settled ~90ms before the body did, so one
    // click read as two separate movements.
    const icon = rule('.day-collapse-icon')
    expect(icon, '.day-collapse-icon is missing from styles.css').toBeTruthy()
    expect(icon!.body).toMatch(/transform var\(--motion-slower\) var\(--ease-resize\)/)
  })

  it('takes the unmount delay from the token, not a literal', () => {
    // Retiming the CSS must not leave a half-collapsed body mounted.
    const src = source('src/pages/trip/timeline/DaySection.tsx')
    expect(src).toMatch(/window\.setTimeout\(\(\) => \{ setMounted\(false\) \}, motionTiming\('--motion-slower'\)\.duration \+ COLLAPSE_UNMOUNT_SLACK_MS\)/)
    // Covers both shapes of the callback (`setMounted(false), 280` and the
    // braced `{ setMounted(false) }, 280`) — the second arrived when a lint rule
    // asked for braces on a void shorthand, and the pin has to survive that.
    expect(src).not.toMatch(/setMounted\(false\)\s*\}?\s*,\s*\d+/)
    // and the token itself is what the stylesheet declares (no drift between
    // the JS timer and the CSS transition it is waiting on)
    expect(source('src/lib/motion.ts')).toMatch(/'--motion-slower':\s*560/)
  })

  it('pins the header items to the top, so no sibling can re-centre them', () => {
    // Measured: the chevron and the day badge moved ~32px in the frame the click
    // landed — the middle block's height changes with the collapse and a centred
    // sibling is repositioned by every one of those changes. Top-aligned, every
    // item's position is its own; after the fix the displacement of each header
    // item across a toggle is 0px (the chips' 4px is their entrance rise).
    const header = rule('.day-header')
    expect(header, '.day-header is missing from styles.css').toBeTruthy()
    expect(header!.body).toMatch(/align-items:\s*flex-start/)
    expect(header!.body).not.toMatch(/align-items:\s*center/)
  })

  it('collapses the route chain with the body instead of popping it', () => {
    // That line is what changes the header's height; appearing at full height in
    // one frame moved every wrapped row below it at once.
    const src = source('src/pages/trip/timeline/DaySection.tsx')
    expect(src).toContain('<SmoothCollapse open={collapsed} fallbackFocus={collapseRef}>')
    // It discloses the same body as the chevron, so it carries the same state.
    expect(src).toMatch(/className="day-route"[^>]*aria-expanded=\{!collapsed\}/)
  })

  it('gives the day chevron the coarse-pointer hit budget too', () => {
    // 28px is under both the repo's 40px floor and the 48dp Android budget, and
    // this was the one compact control the block's inventory missed. The
    // expander brings it to 40px; measured, its only neighbour within 14px is
    // the day badge, 12px away, so the extra 6px stays clear of it. The
    // collapsed route line deliberately needs no expander — it wraps to 2+ lines
    // (41–62px) at phone widths, which the budget already covers.
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse, 'no coarse-pointer block').not.toBe('')
    expect(coarse).toMatch(/\.day-collapse \{\s*position: relative;/)
    expect(coarse).toMatch(/\.day-collapse::after \{[^}]*inset: -6px;/)
  })

  it('wears the app ring on the route line, not the browser default', () => {
    // Focused, this control painted Chromium's own `1px auto rgb(16,16,16)` —
    // invisible on the dark card — while every other control in the header
    // carried var(--ring).
    // The list's last selector is .bench-surprise, so the declaration block ends
    // at the first `}` after it (searching for .yf-map-pin would stop early — it
    // appears inside the list itself).
    const listStart = css.indexOf('.day-collapse:focus-visible')
    const shared = css.slice(listStart, css.indexOf('}', css.indexOf('.bench-surprise:focus-visible', listStart)))
    expect(shared, 'the shared ring list').toContain('.day-route:focus-visible')
    expect(shared).toMatch(/outline: none;\s*box-shadow: var\(--ring\)/)
    // the radius a wrapped multi-line line box needs (same call as .link-btn)
    expect(css).toMatch(/\.day-route:focus-visible \{ border-radius: 6px; \}/)
  })

  it('hands focus back before a clip unmounts under the keyboard user', () => {
    // Measured: opening a day from its route line (Enter on the chain) unmounted
    // that control one animation later and dropped focus to <body> — the next Tab
    // restarted at the top of the document. Both clips can unmount the focused
    // element (the chain on open, the body on collapse), so both must hand it back.
    const src = source('src/pages/trip/timeline/DaySection.tsx')
    expect(src).toMatch(/clipRef\.current\?\.contains\(document\.activeElement\)\) fallbackFocus\?\.current\?\.focus\(\)/)
    // And it must run BEFORE the unmount timer's line: the clip's inner wrapper
    // flips to visibility:hidden one animation earlier, and the browser blurs a
    // hidden element on the spot — a handoff after that point finds <body>.
    const handoff = src.indexOf('fallbackFocus?.current?.focus()')
    const unmount = src.indexOf('window.setTimeout(() => { setMounted(false) }')
    expect(handoff, 'no focus handoff found').toBeGreaterThan(-1)
    expect(unmount, 'no token-derived unmount timer found').toBeGreaterThan(-1)
    expect(handoff).toBeLessThan(unmount)
    const callSites = [...src.matchAll(/<SmoothCollapse open=\{[^}]+\}([^>]*)>/g)].map((m) => m[1])
    expect(callSites.length, 'expected exactly two anchored clips').toBe(2)
    expect(callSites.every((s) => s.includes('fallbackFocus={collapseRef}'))).toBe(true)
  })

  it('fades the header extras that exist in one state only', () => {
    const chips = rule('.day-cost-chip, .day-dwell-chip, .weather-chip, .dwell-bars')
    expect(chips, 'the header extras are missing from styles.css').toBeTruthy()
    expect(chips!.body).toMatch(/animation:\s*popover-in var\(--motion-med\) var\(--ease-out\)/)
  })
})

describe('the day collapse moves as one gesture', () => {
  // Measured 2026-09-19. The collapse ran on --ease-glide, and a day body runs
  // up to ~1000px: a decelerate curve throws 24% of that distance away in the
  // first 6ms (0 → 930px of 967 inside 45% of the duration), so the collapse
  // read as a pop followed by a 150ms dribble. Both --ease-glide and --ease-out
  // are that curve (they agree within .015 at every sampled point), so the fix
  // is the both-ends --ease-resize — ~3px of movement in the first 60Hz frame.
  //
  // Measured again the same day, frame by frame: with the right easing the row
  // below a folding day still moved 115px between two sampled frames (942px of
  // travel on --motion-slow) — the "cards colliding" report. Peak speed is
  // distance ÷ duration (x the curve's peak slope), so the collapse moved to
  // --motion-slower/560ms, and its curve was made symmetric: on this much
  // travel the Material standard curve peaks at 2.73x its average (96px inside
  // a 60Hz frame) against 1.72x for the symmetric one (60px), for the same
  // total time. Both halves are pinned here.
  const rule = (selector: string) => cssRules.find((r) => normalise(r.selector) === selector)

  it('opens and closes on the both-ends easing, not the decelerate family', () => {
    const clip = rule('.day-body-clip')
    expect(clip, '.day-body-clip is missing from styles.css').toBeTruthy()
    expect(clip!.body).toMatch(/transition:\s*grid-template-rows var\(--motion-slower\) var\(--ease-resize\)/)
    expect(clip!.body).not.toMatch(/--ease-(glide|out)\b/)
  })

  it('runs on the large-surface duration, and holds visibility for all of it', () => {
    // The inner's visibility must lag the whole collapse. Pinning both keeps a
    // retime from leaving content unpaintable mid-animation or a timer from
    // unmounting a body that is still moving.
    const inner = rule('.day-body-clip-inner')
    expect(inner, '.day-body-clip-inner is missing from styles.css').toBeTruthy()
    expect(inner!.body).toMatch(/visibility 0s var\(--motion-slower\)/)
    const declared = [...css.matchAll(/--motion-slower:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(declared).toEqual(['560ms'])
  })

  it('declares that easing once, in the motion token block', () => {
    // Symmetric, not the asymmetric Material standard curve: the peak slope is
    // what a large resize is felt through (see the comment above).
    const declared = [...css.matchAll(/--ease-resize:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(declared).toEqual(['cubic-bezier(.42, 0, .58, 1)'])
  })

  it('turns the chevron on the same clock as the body', () => {
    // At --t-fast/180ms the arrow settled ~90ms before the body did, so one
    // click read as two separate movements.
    const icon = rule('.day-collapse-icon')
    expect(icon, '.day-collapse-icon is missing from styles.css').toBeTruthy()
    expect(icon!.body).toMatch(/transform var\(--motion-slower\) var\(--ease-resize\)/)
  })

  it('takes the unmount delay from the token, not a literal', () => {
    // Retiming the CSS must not leave a half-collapsed body mounted.
    const src = source('src/pages/trip/timeline/DaySection.tsx')
    expect(src).toMatch(/window\.setTimeout\(\(\) => \{ setMounted\(false\) \}, motionTiming\('--motion-slower'\)\.duration \+ COLLAPSE_UNMOUNT_SLACK_MS\)/)
    // Covers both shapes of the callback (`setMounted(false), 280` and the
    // braced `{ setMounted(false) }, 280`) — the second arrived when a lint rule
    // asked for braces on a void shorthand, and the pin has to survive that.
    expect(src).not.toMatch(/setMounted\(false\)\s*\}?\s*,\s*\d+/)
    // and the token itself is what the stylesheet declares (no drift between
    // the JS timer and the CSS transition it is waiting on)
    expect(source('src/lib/motion.ts')).toMatch(/'--motion-slower':\s*560/)
  })

  it('pins the header items to the top, so no sibling can re-centre them', () => {
    // Measured: the chevron and the day badge moved ~32px in the frame the click
    // landed — the middle block's height changes with the collapse and a centred
    // sibling is repositioned by every one of those changes. Top-aligned, every
    // item's position is its own; after the fix the displacement of each header
    // item across a toggle is 0px (the chips' 4px is their entrance rise).
    const header = rule('.day-header')
    expect(header, '.day-header is missing from styles.css').toBeTruthy()
    expect(header!.body).toMatch(/align-items:\s*flex-start/)
    expect(header!.body).not.toMatch(/align-items:\s*center/)
  })

  it('collapses the route chain with the body instead of popping it', () => {
    // That line is what changes the header's height; appearing at full height in
    // one frame moved every wrapped row below it at once.
    const src = source('src/pages/trip/timeline/DaySection.tsx')
    expect(src).toContain('<SmoothCollapse open={collapsed} fallbackFocus={collapseRef}>')
    // It discloses the same body as the chevron, so it carries the same state.
    expect(src).toMatch(/className="day-route"[^>]*aria-expanded=\{!collapsed\}/)
  })

  it('gives the day chevron the coarse-pointer hit budget too', () => {
    // 28px is under both the repo's 40px floor and the 48dp Android budget, and
    // this was the one compact control the block's inventory missed. The
    // expander brings it to 40px; measured, its only neighbour within 14px is
    // the day badge, 12px away, so the extra 6px stays clear of it. The
    // collapsed route line deliberately needs no expander — it wraps to 2+ lines
    // (41–62px) at phone widths, which the budget already covers.
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse, 'no coarse-pointer block').not.toBe('')
    expect(coarse).toMatch(/\.day-collapse \{\s*position: relative;/)
    expect(coarse).toMatch(/\.day-collapse::after \{[^}]*inset: -6px;/)
  })

  it('wears the app ring on the route line, not the browser default', () => {
    // Focused, this control painted Chromium's own `1px auto rgb(16,16,16)` —
    // invisible on the dark card — while every other control in the header
    // carried var(--ring).
    // The list's last selector is .bench-surprise, so the declaration block ends
    // at the first `}` after it (searching for .yf-map-pin would stop early — it
    // appears inside the list itself).
    const listStart = css.indexOf('.day-collapse:focus-visible')
    const shared = css.slice(listStart, css.indexOf('}', css.indexOf('.bench-surprise:focus-visible', listStart)))
    expect(shared, 'the shared ring list').toContain('.day-route:focus-visible')
    expect(shared).toMatch(/outline: none;\s*box-shadow: var\(--ring\)/)
    // the radius a wrapped multi-line line box needs (same call as .link-btn)
    expect(css).toMatch(/\.day-route:focus-visible \{ border-radius: 6px; \}/)
  })

  it('hands focus back before a clip unmounts under the keyboard user', () => {
    // Measured: opening a day from its route line (Enter on the chain) unmounted
    // that control one animation later and dropped focus to <body> — the next Tab
    // restarted at the top of the document. Both clips can unmount the focused
    // element (the chain on open, the body on collapse), so both must hand it back.
    const src = source('src/pages/trip/timeline/DaySection.tsx')
    expect(src).toMatch(/clipRef\.current\?\.contains\(document\.activeElement\)\) fallbackFocus\?\.current\?\.focus\(\)/)
    // And it must run BEFORE the unmount timer's line: the clip's inner wrapper
    // flips to visibility:hidden one animation earlier, and the browser blurs a
    // hidden element on the spot — a handoff after that point finds <body>.
    const handoff = src.indexOf('fallbackFocus?.current?.focus()')
    const unmount = src.indexOf('window.setTimeout(() => { setMounted(false) }')
    expect(handoff, 'no focus handoff found').toBeGreaterThan(-1)
    expect(unmount, 'no token-derived unmount timer found').toBeGreaterThan(-1)
    expect(handoff).toBeLessThan(unmount)
    const callSites = [...src.matchAll(/<SmoothCollapse open=\{[^}]+\}([^>]*)>/g)].map((m) => m[1])
    expect(callSites.length, 'expected exactly two anchored clips').toBe(2)
    expect(callSites.every((s) => s.includes('fallbackFocus={collapseRef}'))).toBe(true)
  })

  it('fades the header extras that exist in one state only', () => {
    const chips = rule('.day-cost-chip, .day-dwell-chip, .weather-chip, .dwell-bars')
    expect(chips, 'the header extras are missing from styles.css').toBeTruthy()
    expect(chips!.body).toMatch(/animation:\s*popover-in var\(--motion-med\) var\(--ease-out\)/)
  })
})

describe('icon stroke weight is a token, not a library default', () => {
  // Lucide's stock weight is 2, emitted as a presentation attribute on every
  // glyph - `stroke-width="2"` on all ~291 icon tags in the app. A presentation
  // attribute loses to any CSS declaration, so the app re-inks the whole set
  // from ONE rule rather than carrying a prop on each usage. These pins keep it
  // that way: the token must exist, the rule must consume it, and no component
  // may drift back to the library default.
  it('declares the token and consumes it from the .lucide base rule', () => {
    expect(css, '--icon-stroke token missing from styles.css').toMatch(/--icon-stroke:\s*1\.5;/)
    expect(css, 'the .lucide base rule is missing').toMatch(/\.lucide\s*\{\s*stroke-width:\s*var\(--icon-stroke\)/)
  })

  it('leaves no icon component on the library default weight', () => {
    const off: string[] = []
    for (const { rel, text } of sourceFiles) {
      for (const m of text.matchAll(/<([A-Z]\w*)[^>]*\bstrokeWidth=\{2\}/g)) off.push(`${rel} -> <${m[1]}>`)
    }
    expect(off, `use the --icon-stroke token instead of strokeWidth={2}:\n${off.join('\n')}`).toEqual([])
  })
})

describe('the typefaces are the language, not a preference', () => {
  // The weight gate above is deliberately FAMILY-AGNOSTIC: it reads every
  // vendored @fontsource weight import so that swapping a family cannot
  // silently empty the loaded-weight set and leave the gate passing on
  // nothing. That symmetry has a cost - on its own it would let a revert to
  // Inter pass the build. The families themselves are pinned here instead,
  // named the way the vendored packages declare them.
  const SLUG_TO_FAMILY: Record<string, string> = {
    'plus-jakarta-sans': 'Plus Jakarta Sans',
    sora: 'Sora',
  }
  const families = [...main.matchAll(/@fontsource\/([a-z-]+)\/\d+\.css/g)]
    .map((m) => SLUG_TO_FAMILY[m[1]] ?? m[1])

  it('declares Plus Jakarta Sans and Sora among the vendored font imports', () => {
    expect(families, `font imports declare: ${families.join(', ')}`).toContain('Plus Jakarta Sans')
    expect(families, `font imports declare: ${families.join(', ')}`).toContain('Sora')
  })

  it('routes both font tokens through them, so every surface inherits them', () => {
    expect(css, 'the body token must lead with Plus Jakarta Sans').toMatch(/--font-body:\s*'Plus Jakarta Sans'/)
    expect(css, 'the display token must lead with Sora').toMatch(/--font-display:\s*'Sora'/)
  })
})

describe('the toggle glider glides on its box, not a transform', () => {
  // Two regressions in a single day motivate this block, and both were caught by
  // eye rather than by the suite. (1) A `scaleX` FLIP was built to match
  // MOTION-TOKENS.md's catalog row, which claimed a "transform slide" the
  // implementation never had - it stretched the pill's rounded ends into
  // ellipses (scaleX 1.93 on a 76px -> 146px tab change), so the glide read as
  // the animation breaking. (2) That same rewrite dropped the +4 which insets
  // the glider 4px top and bottom against its `- 8` height, so every active pill
  // across the fifteen surfaces PillNav renders on sat 4px high.
  it('transitions the box and never a transform', () => {
    const rule = cssRules.find((r) => normalise(r.selector) === '.pill-glider')
    expect(rule, 'the .pill-glider rule is missing from styles.css').toBeTruthy()
    const transition = declMap(stripCssComments(rule!.body)).get('transition') ?? ''
    expect(transition, 'the glider must transition its own box').toMatch(/\bleft\b/)
    expect(transition, 'the glider must transition its own box').toMatch(/\bwidth\b/)
    expect(transition, 'a transform glide stretches a rounded pill into ellipses - see the note above').not.toMatch(/transform/)
  })

  it('keeps the 4px inset that centres the fill on its label', () => {
    const nav = source('src/components/PillNav.tsx')
    expect(nav, 'the glider must be inset 4px from the item top, paired with the -8 on its height').toMatch(/wrap\.clientTop\s*\+\s*4/)
    expect(nav, 'the glider must write its box').toMatch(/glider\.style\.left\s*=/)
    expect(nav, 'and must not write a transform').not.toMatch(/glider\.style\.transform\s*=/)
  })

  it('does not describe the glider as a transform slide', () => {
    const row = source('docs/MOTION-TOKENS.md').split(/\r?\n/).find((l) => l.startsWith('| Toggle glider'))
    expect(row, 'the Toggle glider row is missing from the catalog').toBeTruthy()
    expect(row!, 'the catalog must describe a BOX glide - its old "transform slide" claim is what pointed the change the wrong way').toMatch(/\bbox\b/i)
  })
})

describe('spacing rhythm: new values land on the documented ladder', () => {
  // DESIGN_TOKENS.md's `--s-1…--s-8` set was deleted in SYS-2 because nothing
  // routed through it, which left the app with no enforceable rhythm at all —
  // hundreds of declarations carry a value the ladder does not contain, and
  // 10px and 9px between them are the app's *de facto* beat rather than an
  // oversight. Rewriting every literal in one sweep is unverifiable (the
  // workspace tabs need a signed-in trip), so the drift is FROZEN instead: a
  // new off-ladder value fails the build, and re-baselining is the same env var
  // the contrast and duration gates use. The ladder is the documented one plus
  // the two beats the editorial family already shares — 14 (two cards in a
  // column) and 22 (two sections). `border-radius` and friends are not spacing
  // and are not read.
  //
  // Keyed by `property: value`, the ratchet's rule for every gate. The frozen
  // set (76 pairs at the time of writing) is immune to the line-number churn
  // that made every CSS insertion force a re-baseline, and the set may only
  // shrink — retiring one of these values means deleting its entry, after which
  // it can never come back.
  const LADDER = new Set([2, 4, 6, 8, 12, 14, 16, 20, 22, 24])
  const SPACING = /^(gap|row-gap|column-gap|margin|padding)(-top|-bottom|-left|-right)?$/

  it('introduces no new off-ladder spacing', () => {
    const offenders = new Set<string>()
    for (const rule of cssRules) {
      for (const [prop, value] of declMap(rule.body)) {
        if (!SPACING.test(prop)) continue
        for (const m of value.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)px/g)) {
          const n = parseFloat(m[1])
          if (n === 0 || LADDER.has(n)) continue
          offenders.add(`${prop}: ${m[0]}`)
        }
      }
    }
    ratchet('offLadderSpacing', [...offenders])
  })
})

describe('the spacing ladder has a token home (design-audit F4)', () => {
  // The --s-1…--s-8 set was deleted by SYS-2 as unconsumed, leaving the ladder
  // with no token home. The --space-* ramp re-homes it WITH adopters (the
  // adopt-or-delete rule), and this pin keeps ramp and ratchet in lockstep.
  it('declares --space-1…--space-10 matching the gate ladder exactly', () => {
    const ladder = [2, 4, 6, 8, 12, 14, 16, 20, 22, 24]
    ladder.forEach((px, i) => {
      expect(css).toContain('--space-' + (i + 1) + ': ' + px + 'px')
    })
  })
})

describe('categorical palettes: hues stay distinguishable', () => {
  // Colour-coded categories must not collide: two "days" or two expense categories
  // sharing a hue are indistinguishable in a legend, however different their
  // lightness. 15° is the floor.
  const MIN_HUE_SEPARATION = 15

  const hueOf = (hex: string): number => {
    const rgb = parseColor(hex)
    if (!rgb) return 0
    const max = Math.max(rgb.r, rgb.g, rgb.b)
    const min = Math.min(rgb.r, rgb.g, rgb.b)
    const d = max - min
    if (d === 0) return 0
    const h =
      max === rgb.r ? ((rgb.g - rgb.b) / d) % 6 : max === rgb.g ? (rgb.b - rgb.r) / d + 2 : (rgb.r - rgb.g) / d + 4
    return (h * 60 + 360) % 360
  }

  const separation = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 360
    return Math.min(d, 360 - d)
  }

  const collisions = (label: string, colours: string[]): string[] => {
    const out: string[] = []
    for (let i = 0; i < colours.length; i++) {
      for (let j = i + 1; j < colours.length; j++) {
        const gap = separation(hueOf(colours[i]), hueOf(colours[j]))
        if (gap < MIN_HUE_SEPARATION) out.push(`${label} ${colours[i]} vs ${colours[j]} — ${gap.toFixed(1)}°`)
      }
    }
    return out
  }

  it('introduces no new hue collision', () => {
    const daySource = source('src/components/TripMap.tsx').match(/const DAY_COLORS = \[([^\]]+)\]/)?.[1] ?? ''
    const days = [...daySource.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0])
    expect(days.length, 'DAY_COLORS must parse').toBeGreaterThanOrEqual(7)

    const cats = ['--cat-transport', '--cat-accommodation', '--cat-food', '--cat-activities']
      .map((token) => rootTokens.get(token))
      .filter((v): v is string => v !== undefined)

    // The POI lane is drawn on the same map as the day routes, so it must also
    // stay clear of every day colour and every expense category.
    const poiSee = rootTokens.get('--yf-poi-see')
    const cross: string[] = []
    if (poiSee !== undefined) {
      for (const c of [...days, ...cats]) {
        const gap = separation(hueOf(poiSee), hueOf(c))
        if (gap < MIN_HUE_SEPARATION) cross.push(`--yf-poi-see vs ${c} — ${gap.toFixed(1)}°`)
      }
    }

    ratchet('hueCollisions', [...collisions('DAY_COLORS', days), ...collisions('--cat-*', cats), ...cross])
  })
})

describe("a popup's host claims the rung, never the popup", () => {
  // A popup's own z-index is bounded by its HOST's stacking context: a host
  // that paints one (backdrop-filter, opacity < 1, transform) traps the menu
  // inside it, and a positioned card painted later covers the open menu
  // however high the popup's rung is. Both rules below shipped broken from that
  // oversight and were found by hit-testing — a menu option resolving to the
  // card's own node — not by reading z-indexes.
  const rule = (selector: string) => cssRules.find((r) => normalise(r.selector) === selector)

  it('gives the Explore filter bar a rung above the cards its menu opens over', () => {
    const bar = rule('.explore-filterbar')
    expect(bar, '.explore-filterbar is missing from styles.css').toBeTruthy()
    expect(bar!.body).toMatch(/position:\s*relative/)
    expect(bar!.body).toMatch(/z-index:\s*var\(--z-frost\)/)
    // The rule changes nothing unless the page carries the class on the bar
    // that actually holds the selects.
    expect(source('src/pages/Explore.tsx')).toContain('card glass-soft explore-filterbar')
  })

  it('keeps the card footer row clear of the corner it sits in', () => {
    // The creator line + channel icons are a card's last row whenever the
    // creator has a bio or a link; unpadded they sat 1px inside the 12px
    // bottom-right radius and read as clipped by the card's own edge.
    const foot = rule('.itin-foot')
    expect(foot, '.itin-foot is missing from styles.css').toBeTruthy()
    expect(foot!.body).toMatch(/padding:\s*0 16px 14px/)
    expect(source('src/components/PubCard.tsx')).toContain('row-between itin-foot')
  })
})

describe('a flex row under pressure gives up the right part', () => {
  // The bench's mode buttons pack an icon, a name and a speed pill into one
  // row. In the 721-1000px band each button is a QUARTER of the controls card
  // (78.7px at 768), and because the name was the row's only flexible part it
  // ellipsized to a single letter ("T…") while the icon squashed 15px -> 3px.
  // The block now asks its OWN width, not the viewport, how many columns it can
  // hold: the grid's space is a fraction of the window here, and the Trip
  // Settings tab hosts the same grid under a different parent. A viewport band
  // was measured and rejected: dropping the pill instead of stacking leaves the
  // longest name clipped from 721px to ~755px, because the icon grows back to
  // its true 15px and takes 12 of the ~33px the pill was holding.
  const rule = (selector: string) => cssRules.find((r) => normalise(r.selector) === selector)
  const containerBlocks = mediaBlocks(css, '@container').join('\n')

  it('keeps two columns as the base layout, so the stack stays proportional', () => {
    const grid = rule('.bench-mode-grid')
    expect(grid, '.bench-mode-grid is missing from styles.css').toBeTruthy()
    expect(grid!.body).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
  })

  it('stacks the modes when the block cannot hold a full row', () => {
    const block = rule('.bench-mode-block')
    expect(block, '.bench-mode-block is missing from styles.css').toBeTruthy()
    expect(block!.body).toMatch(/container-type:\s*inline-size/)
    // 230px = 2 x (15 icon + 7 gap + 31 longest name + 7 gap + 26 pill + 23
    // padding/border) + 6 gap, i.e. the width at which two columns fit a row
    // whole. Held textually: no offline gate can measure a string's width.
    expect(containerBlocks).toMatch(/@container \(max-width: 230px\)/)
    expect(containerBlocks).toMatch(/\.bench-mode-grid\s*\{[^}]*grid-template-columns:\s*1fr/)
  })

  it('drops nothing when the modes stack', () => {
    // Stacking is the answer, not hiding the speed pill: the pill is where the
    // mode's km/h lives, and hiding it was measured to leave "Train" clipped
    // for the first ~35px of the band.
    expect(css).not.toMatch(/\.bench-mode-speed[^{,]*\{[^}]*display:\s*none/)
  })

  it('stops the icon being the first thing that squashes', () => {
    expect(rule('.bench-mode-btn > svg')?.body).toMatch(/flex:\s*none/)
  })

  it('wires the container class onto both mode-grid hosts', () => {
    // The rule changes nothing unless the block that holds the grid carries it.
    expect(source('src/components/PlanBench.tsx')).toContain('bench-block bench-mode-block')
    expect(source('src/pages/trip/TripSettingsForm.tsx')).toContain('bench-block bench-mode-block')
  })
})

describe('a class name has one owner: a new block may not claim an existing one', () => {
  // The Landing page's scroll-reveal utility IS the bare `.reveal` class —
  // `body.reveal-armed .reveal` in the stylesheet, nine elements in
  // `Landing.tsx` (the section title, three feature cards, four steps), armed
  // by one IntersectionObserver. I-20's unlock sheet shipped its own `.reveal`
  // block; being later in the file, it won on equal specificity, so every one
  // of those elements was silently re-laid-out as a flex column with the
  // sheet's padding and each of their children took the sheet's stagger
  // animation. No node test can see that and neither the contrast nor the
  // spacing gate can either — the only thing that caught it was rendering the
  // Landing page — so the collision is pinned here instead. Render the page
  // when you rename CSS: the gates all stayed green through this.
  it('never selects a bare `.reveal` — that one belongs to the Landing page', () => {
    const offenders: string[] = []
    for (const rule of cssRules) {
      for (const part of rule.selector.split(',')) {
        const sel = part.trim().replace(/\s+/g, ' ')
        // Exactly `.reveal`, optionally with one pseudo — the shape a block
        // claims for its own root. `body.reveal-armed .reveal`, `.reveal-d1`
        // and the namespaced `.unlock-reveal*` family are all legitimate.
        if (/^\.reveal(?::[\w-]+)?$/.test(sel)) offenders.push(sel)
      }
    }
    expect(
      offenders,
      "these rules claim the Landing page's `.reveal` class — namespace the new block instead (e.g. `.unlock-reveal`)",
    ).toEqual([])
  })
})

// --- the focus indicator -------------------------------------------------------
// WCAG 1.4.11 asks a focus indicator for 3:1 against the colours adjacent to it.
// The contrast gate above cannot see one: `--ring` is a `box-shadow`, so no rule
// declares the `color` + `background` pair it measures, and a token's own value
// is never a rule at all. That blind spot is how a 35% tint measuring 1.50:1 on
// --bg survived a ratchet reporting "no known dark-theme violation left" — and
// how a `--focus-ring` token referenced by four rules and defined by none kept
// its sub-3:1 amber fallback on the three controls that had already removed
// their outline, leaving that ring as the only focus signal on the slots rail.

/** The colour a `box-shadow`-shaped ring paints, as an alpha-carrying Rgb. */
function ringColor(shadow: string | undefined, tokens: Map<string, string>): Rgb | null {
  if (shadow === undefined) return null
  const mix = shadow.match(/color-mix\(in srgb,\s*([^,]+?)\s+([\d.]+)%\s*,\s*transparent\s*\)/i)
  if (mix) {
    const base = parseColor(resolveVar(mix[1], tokens))
    return base ? { ...base, a: Number(mix[2]) / 100 } : null
  }
  // A solid colour at the end of the shadow: `0 0 0 3px var(--yf-teal-600)`.
  const solid = shadow.trim().match(/(var\([^)]*\)|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))$/)
  return solid ? parseColor(resolveVar(solid[1], tokens)) : null
}

describe('a focus indicator you can actually see', () => {
  const FLOOR = 3 // 1.4.11: non-text contrast, and a focus ring is the state it names.

  it('paints one focus recipe, not one per block', () => {
    // The `.reveal` lesson applied to a token: a second one declared later in
    // the file wins on equal specificity, so the controls that adopted it and
    // the ones that kept the first would silently disagree about what focus
    // looks like. Evolving the recipe means editing `--ring`, in place.
    const declared = [...new Set([...stripCssComments(css).matchAll(/(--(?:focus-)?ring)\s*:/g)].map((m) => m[1]))].sort()
    expect(
      declared,
      'more than one focus token is declared — evolve `--ring` in place instead of adding a parallel token',
    ).toEqual(['--ring'])
  })

  it('clears 3:1 against every surface it outlines, in both themes', () => {
    const surfaces = [
      ['--bg', 'the page'],
      ['--card', 'a card / rail'],
    ] as const
    for (const [theme, tokens] of [['light', rootTokens], ['dark', darkTokens]] as const) {
      const ring = ringColor(tokens.get('--ring'), tokens)
      expect(ring, `--ring must resolve to a colour in ${theme}`).not.toBeNull()
      for (const [bgVar, name] of surfaces) {
        const bg = parseColor(resolveVar(tokens.get(bgVar) ?? '', tokens))
        expect(bg, `${bgVar} must resolve in ${theme}`).not.toBeNull()
        const ratio = contrast(ring!, bg!)
        expect(
          ratio,
          `${theme}: the focus ring measures ${ratio.toFixed(2)}:1 on ${name} (${bgVar}) — it must clear ${FLOOR}:1`,
        ).toBeGreaterThanOrEqual(FLOOR)
      }
    }
  })
})

// --- type floor ----------------------------------------------------------------
describe('data type keeps its floor', () => {
  // The day plan set the numbers a decision hangs on — the day chip's fill count,
  // a window's closing time, a candidate's detour cost, its share of the budget —
  // at 9.5–10.5px, in the weakest ink (`--text-3`), while the decoration around
  // them read at 12–14px. The smallest type on the screen was the type the screen
  // was for. 11px is the floor; 12px+ is the target for anything carrying a
  // number. The ratchet freezes what remains below it and may only shrink.
  //
  // A later override does NOT retire an entry: the frozen key is the declaration,
  // so a descendant selector that lifts a size leaves the original below the
  // floor until the declaration itself moves. That is deliberate — the entry is
  // the thing to fix, not the thing to shadow.
  const FLOOR = 11

  it('introduces no new type below the floor', () => {
    const offenders: string[] = []
    for (const rule of cssRules) {
      for (const [prop, value] of declMap(rule.body)) {
        if (prop !== 'font-size') continue
        const m = value.match(/(?<![\d.])(\d+(?:\.\d+)?)px/)
        if (!m) continue
        if (parseFloat(m[1]) >= FLOOR) continue
        offenders.push(`${normalise(rule.selector)} — font-size: ${m[1]}px`)
      }
    }
    ratchet('subPixelType', offenders)
  })
})
