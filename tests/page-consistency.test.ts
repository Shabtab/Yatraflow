// Phase 0 design-consistency ratchet (plan section 4.5).
// Static source checks: they read the shipped files as text, so a regression fails
// `npm run verify` without a browser. Every count is keyed by file path, never by line.
// Each rule is a pure function with one bad and one good fixture below. A rule that
// stops firing fails in this file rather than passing silently.
// Rule (e), the serif scope, is not enforced: plan section 9 Q1 has no recorded answer.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const APP = 'src/App.tsx'
const STYLES = 'src/styles.css'
const PAGE_DIR = 'src/pages/'
const baselineUrl = new URL('./page-consistency-baseline.json', import.meta.url)
const updating = process.env.UPDATE_PAGE_CONSISTENCY_BASELINE === '1'

const read = (rel: string): string =>
  readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const exists = (rel: string): boolean => existsSync(new URL('../' + rel, import.meta.url))

interface RoutedUnit {
  key: string
  file: string
  symbol: string
}

interface PageMetrics {
  EmptyState: number
  loadingBlock: number
  inlineStyle: number
  rawH1: number
}

const METRIC_KEYS = ['EmptyState', 'loadingBlock', 'inlineStyle', 'rawH1'] as const
const PAGE_SCOPE_CLASS = /className=\{?[^>]*?\byf-page\b/

// Rule (a): discover the routed pages from App.tsx ----------------------------

function importPathFor(appText: string, name: string): string | undefined {
  for (const m of appText.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/g)) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      .filter(Boolean)
    if (names.includes(name)) return m[2]
  }
  return undefined
}

function resolvePageFile(rel: string, fileExists: (p: string) => boolean): string {
  const base = 'src/' + rel.replace(/^\.\//, '')
  for (const candidate of [`${base}.tsx`, `${base}/index.tsx`, `${base}.ts`]) {
    if (fileExists(candidate)) return candidate
  }
  throw new Error(`routed import ${rel} resolves to no file under src/`)
}

/** Every component the page switch in App.tsx renders. Throws when a binding cannot be read. */
function discoverRoutedUnits(appText: string, fileExists: (p: string) => boolean): RoutedUnit[] {
  const lines = appText.split('\n')
  const assigns = lines.map((l, i) => (/\bpage = /.test(l) ? i : -1)).filter((i) => i !== -1)
  if (assigns.length === 0) throw new Error('no page assignments found in App.tsx')
  const region = lines.slice(assigns[0], assigns[assigns.length - 1] + 1).join('\n')
  const names = new Set<string>()
  for (const m of region.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)) {
    if (m[1] !== 'Suspense') names.add(m[1])
  }
  const units: RoutedUnit[] = []
  for (const name of names) {
    if (new RegExp(`^function ${name}\\(`, 'm').test(appText)) {
      units.push({ key: `${APP}#${name}`, file: APP, symbol: name })
      continue
    }
    const lazyMatch = new RegExp(`const ${name} = lazy\\(\\(\\) => import\\('(\\.\\/[^']+)'\\)`).exec(appText)
    const importRel = lazyMatch?.[1] ?? importPathFor(appText, name)
    if (!importRel) throw new Error(`cannot read a binding for routed component ${name} in App.tsx`)
    const file = resolvePageFile(importRel, fileExists)
    units.push({ key: file, file, symbol: name })
  }
  return units
}

/** Whether a routed unit's root carries yf-page. A component defined in App.tsx is checked on its own body. */
function unitHasScope(unit: RoutedUnit, source: (rel: string) => string): boolean {
  const text = source(unit.file)
  if (unit.file !== APP) return PAGE_SCOPE_CLASS.test(text)
  const start = text.indexOf(`function ${unit.symbol}(`)
  if (start === -1) throw new Error(`cannot find the body of ${unit.symbol} in App.tsx`)
  const end = text.indexOf('\n}\n', start)
  return PAGE_SCOPE_CLASS.test(text.slice(start, end === -1 ? undefined : end))
}

/** Routed pages without yf-page must be allowlisted. Allowlist entries must go once they are no longer true. */
function scopeProblems(units: Array<{ key: string; hasScope: boolean }>, allowlist: string[]): string[] {
  const out: string[] = []
  const known = new Set(units.map((u) => u.key))
  const allowed = new Set(allowlist)
  for (const u of units) {
    if (!u.hasScope && !allowed.has(u.key)) out.push(`${u.key}: routed page lacks yf-page and is not in pageRootAllowlist`)
    if (u.hasScope && allowed.has(u.key)) out.push(`${u.key}: carries yf-page now; delete it from pageRootAllowlist`)
  }
  for (const key of allowlist) {
    if (!known.has(key)) out.push(`${key}: no longer a routed page; delete it from pageRootAllowlist`)
  }
  return out
}

// Rules (b), (c), (d): per page file ------------------------------------------

const count = (text: string, re: RegExp): number => [...text.matchAll(re)].length

/**
 * Per-file counts. An h1 counts as raw when no PageHero or PageHeader tag
 * appears before it in the same file. This is an approximation: it reads
 * order in the file, not nesting.
 */
function pageMetrics(text: string): PageMetrics {
  const headerAt = text.search(/<Page(Hero|Header)\b/)
  let rawH1 = 0
  for (const m of text.matchAll(/<h1[\s>]/g)) {
    if (headerAt === -1 || (m.index ?? 0) < headerAt) rawH1++
  }
  return {
    EmptyState: count(text, /<EmptyState\b/g),
    loadingBlock: count(text, /loading-block/g),
    inlineStyle: count(text, /style=\{\{/g),
    rawH1,
  }
}

/**
 * Ratchet over page files. A count may not rise. A file missing from the
 * baseline is a new page file and starts at zero. A count that fell must be
 * locked in by regenerating the baseline.
 */
function compareMetrics(current: Record<string, PageMetrics>, baseline: Record<string, PageMetrics>): string[] {
  const out: string[] = []
  for (const [file, now] of Object.entries(current)) {
    const before = baseline[file]
    if (!before) {
      for (const k of METRIC_KEYS) {
        if (now[k] > 0) out.push(`${file}: new page file has ${k} = ${now[k]}; a new page file must use StateBlock and keep this at 0`)
      }
      continue
    }
    for (const k of METRIC_KEYS) {
      if (now[k] > before[k]) out.push(`${file}: ${k} rose from ${before[k]} to ${now[k]}`)
      else if (now[k] < before[k]) out.push(`${file}: ${k} fell from ${before[k]} to ${now[k]}; regenerate the baseline`)
    }
  }
  for (const file of Object.keys(baseline)) {
    if (!(file in current)) out.push(`${file}: in the baseline but no longer a page file; regenerate the baseline`)
  }
  return out
}

// Rule (f): card hover rules ---------------------------------------------------

const hasRawTime = (value: string): boolean =>
  [...value.matchAll(/(?<![\d.])[0-9]*\.?[0-9]+m?s\b/g)].some((t) => parseFloat(t[0]) !== 0)

/**
 * Top-level and nested rules whose selector has a card class on hover, and
 * which set a box-shadow other than the card hover token, or a raw duration.
 * Each violation is one entry. Aliases such as an --ex-shadow-md chain count as violations.
 */
function cardHoverProblems(cssText: string): string[] {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const out: string[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    const isCardHover = selector.split(',').some((part) => part.includes(':hover') && /\.[\w-]*card/.test(part))
    if (!isCardHover) continue
    for (const d of m[2].matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      const prop = d[1]
      const value = d[2].trim()
      if (prop === 'box-shadow' && !value.includes('var(--shadow-card-hover)')) out.push(`${selector}: box-shadow ${value}`)
      const isMotion = ['transition', 'transition-duration', 'animation', 'animation-duration'].includes(prop)
      const isLoop = prop.startsWith('animation') && /\binfinite\b/.test(value)
      if (isMotion && !isLoop && hasRawTime(value)) out.push(`${selector}: ${prop} ${value}`)
    }
  }
  return out
}

// Snapshot, baseline and the one-env regeneration path ------------------------

interface Baseline {
  pageRootAllowlist: string[]
  pageFiles: Record<string, PageMetrics>
  cardHoverViolations: number
}

interface Snapshot {
  routed: Array<{ key: string; hasScope: boolean }>
  pageFiles: Record<string, PageMetrics>
  cardProblems: string[]
}

function listPageFiles(): string[] {
  return readdirSync(new URL('../' + PAGE_DIR, import.meta.url), { recursive: true })
    .map((f) => PAGE_DIR + f.split('\\').join('/'))
    .filter((f) => f.endsWith('.tsx'))
    .sort()
}

function snapshot(): Snapshot {
  const appText = read(APP)
  const units = discoverRoutedUnits(appText, exists)
  const routed = units.map((u) => ({ key: u.key, hasScope: unitHasScope(u, read) }))
  const pageFiles: Record<string, PageMetrics> = {}
  for (const f of listPageFiles()) pageFiles[f] = pageMetrics(read(f))
  return { routed, pageFiles, cardProblems: cardHoverProblems(read(STYLES)) }
}

const snap = snapshot()

function writeBaseline(): void {
  const sortedPages = Object.fromEntries(Object.entries(snap.pageFiles).sort(([a], [b]) => a.localeCompare(b)))
  const next: Baseline = {
    pageRootAllowlist: snap.routed.filter((u) => !u.hasScope).map((u) => u.key).sort(),
    pageFiles: sortedPages,
    cardHoverViolations: snap.cardProblems.length,
  }
  writeFileSync(baselineUrl, JSON.stringify(next, null, 2) + '\n')
}

const loadBaseline = (): Baseline => JSON.parse(readFileSync(baselineUrl, 'utf8')) as Baseline

// The guard ------------------------------------------------------------------

describe('page consistency ratchet (plan section 4.5)', () => {
  it('discovers the routed pages from App.tsx', () => {
    expect(snap.routed.length).toBeGreaterThanOrEqual(10)
    expect(snap.routed.map((u) => u.key)).toContain('src/pages/Explore.tsx')
  })

  it('keeps every routed page on yf-page, or on the shrinking allowlist (rule a)', () => {
    if (updating) return writeBaseline()
    const problems = scopeProblems(snap.routed, loadBaseline().pageRootAllowlist)
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('keeps page-file counts from rising and starts new page files clean (rules b, c, d)', () => {
    if (updating) return writeBaseline()
    const problems = compareMetrics(snap.pageFiles, loadBaseline().pageFiles)
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('keeps card hover rules on the card shadow token and motion durations (rule f)', () => {
    if (updating) return writeBaseline()
    const base = loadBaseline().cardHoverViolations
    const now = snap.cardProblems.length
    expect(now, `card hover violations rose above the baseline:\n${snap.cardProblems.join('\n')}`).toBeLessThanOrEqual(base)
    expect(now, `card hover violations fell to ${now}; regenerate the baseline`).toBeGreaterThanOrEqual(base)
  })
})

// Fixtures: each rule fails its bad input and passes its good one -------------

describe('each rule fails on its bad fixture and passes its good one', () => {
  const zero: PageMetrics = { EmptyState: 0, loadingBlock: 0, inlineStyle: 0, rawH1: 0 }
  const scopedApp = 'function Local() {\n  return <div className="container yf-page">x</div>\n}\n'
  const sourceOf = (text: string) => (): string => text

  it('rule a: discovers a routed page through its import, and throws on an unbound name', () => {
    const app = "import { FooPage } from './pages/Foo'\nif (x) page = <FooPage />\n"
    const units = discoverRoutedUnits(app, (p) => p === 'src/pages/Foo.tsx')
    expect(units).toEqual([{ key: 'src/pages/Foo.tsx', file: 'src/pages/Foo.tsx', symbol: 'FooPage' }])
    const bad = 'if (x) page = <Mystery />\n'
    expect(() => discoverRoutedUnits(bad, () => true)).toThrow(/Mystery/)
  })

  it('rule a: an unscoped routed page is flagged, a scoped one passes', () => {
    const unscoped = { key: 'src/pages/Foo.tsx', hasScope: false }
    expect(scopeProblems([unscoped], [])).toHaveLength(1)
    expect(scopeProblems([{ ...unscoped, hasScope: true }], [])).toEqual([])
    expect(scopeProblems([unscoped], ['src/pages/Foo.tsx'])).toEqual([])
  })

  it('rule a: an allowlist entry that now carries yf-page or is no longer routed is flagged', () => {
    expect(scopeProblems([{ key: 'src/pages/Foo.tsx', hasScope: true }], ['src/pages/Foo.tsx'])).toHaveLength(1)
    expect(scopeProblems([], ['src/pages/Gone.tsx'])).toHaveLength(1)
  })

  it('rule a: reads the scope of a component defined in App.tsx from its own body', () => {
    const unit = { key: 'src/App.tsx#Local', file: APP, symbol: 'Local' }
    expect(unitHasScope(unit, sourceOf(scopedApp))).toBe(true)
    expect(unitHasScope(unit, sourceOf('function Local() {\n  return <div>x</div>\n}\n'))).toBe(false)
  })

  it('rule b: a new page file with an EmptyState or loading block is flagged, a StateBlock file passes', () => {
    const bad = pageMetrics('<EmptyState title="none" />\n<div className="loading-block" />')
    expect(bad.EmptyState).toBe(1)
    expect(bad.loadingBlock).toBe(1)
    expect(compareMetrics({ 'src/pages/New.tsx': bad }, {})).toHaveLength(2)
    const good = pageMetrics('<StateBlock kind="empty" title="none" />')
    expect(compareMetrics({ 'src/pages/New.tsx': good }, {})).toEqual([])
  })

  it('rule b: a count that fell must be locked in by regenerating the baseline', () => {
    const fell = compareMetrics({ 'src/pages/A.tsx': zero }, { 'src/pages/A.tsx': { ...zero, EmptyState: 1 } })
    expect(fell).toHaveLength(1)
    expect(fell[0]).toContain('regenerate the baseline')
  })

  it('rule c: an inline style that rises above its baseline is flagged', () => {
    const bad = pageMetrics('<div style={{ color: "red" }} />')
    expect(bad.inlineStyle).toBe(1)
    expect(compareMetrics({ 'src/pages/A.tsx': bad }, { 'src/pages/A.tsx': zero })).toHaveLength(1)
    const good = pageMetrics('<div className="card-row" />')
    expect(compareMetrics({ 'src/pages/A.tsx': good }, { 'src/pages/A.tsx': zero })).toEqual([])
  })

  it('rule d: a raw h1 is counted, a PageHeader-led file is not', () => {
    expect(pageMetrics('<h1 className="x">Trips</h1>').rawH1).toBe(1)
    expect(pageMetrics('<PageHeader headline={{ lead: "Trips", accent: "" }} lede="x" />').rawH1).toBe(0)
  })

  it('rule f: a card hover with a raw shadow or raw duration is flagged, a token-only card passes', () => {
    const bad = [
      '.trip-card:hover { box-shadow: 0 4px 8px #000; }',
      '.trip-card:hover { transition: transform 200ms ease; }',
    ].join('\n')
    expect(cardHoverProblems(bad)).toHaveLength(2)
    const good = [
      '.trip-card:hover { box-shadow: var(--shadow-card-hover); transition: box-shadow var(--motion-med) var(--ease-out); }',
      '.stop-card:hover { border-color: red; }',
    ].join('\n')
    expect(cardHoverProblems(good)).toEqual([])
  })
})
