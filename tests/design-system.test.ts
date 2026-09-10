// Design-system consistency invariants (v0.48 pass).
// Static source checks: they read the shipped files as text, so a regression
// in any of these rules fails CI without needing a browser.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

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
  for (const m of s.matchAll(/(?:Inter|Sora):wght@([\d;]+)/g)) {
    for (const w of m[1].split(';')) out.add(Number(w))
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
  const loaded = loadedWeights(html)

  it('loads the canonical weight set (Inter 400-800, Sora 600-800)', () => {
    for (const w of [400, 500, 600, 700, 800]) expect(loaded.has(w), `Inter/Sora must ship ${w}`).toBe(true)
  })

  it('declares no font-weight that the font link does not load', () => {
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
    expect(css).toContain('color-mix(in srgb, var(--yf-teal-600) 35%, transparent)')
    expect(css).toContain('color-mix(in srgb, var(--yf-teal-600) 40%, transparent)')
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
    ['src/pages/PublicItinerary.tsx', 'Verified creator', 'VERIFIED CREATOR'],
    ['src/pages/Explore.tsx', 'Featured itinerary', 'FEATURED ITINERARY'],
  ]

  it.each(retyped)('types "%s" in sentence case and drops the caps form', (file, good, bad) => {
    const src = source(file)
    expect(src).toContain(good)
    expect(src).not.toContain(bad)
  })

  it('types the day badges in sentence case', () => {
    for (const file of ['src/pages/trip/TimelineTab.tsx', 'src/pages/PublicItinerary.tsx']) {
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
