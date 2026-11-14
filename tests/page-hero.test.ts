// PageHero: the shared hero shell, its two callers and the yf-page button scope.
// Node env, no DOM. The tests read source text, with CRLF turned into LF first.
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readCssSource } from '../scripts/css-source-graph.mjs'

const read = async (relativePath: string) =>
  (await readFile(join(process.cwd(), relativePath), 'utf8')).replace(/\r\n/g, '\n')

const PAGE_HERO = 'src/components/page/PageHero.tsx'
const EXPLORE_HERO = 'src/components/explore/ExploreHero.tsx'
const TRIPS_HERO = 'src/components/trips/TripsHero.tsx'
const STYLES_TEXT = readCssSource('src/styles.css')
const YF_PAGE_MARKER = '/* ===== Page scope: yf-page ===== */'

describe('PageHero component contract', () => {
  it('exports a PageHero component', async () => {
    const source = await read(PAGE_HERO)
    expect(source).toMatch(/export function PageHero\(/)
  })

  it('declares the headline, statsPlacement and visual props', async () => {
    const source = await read(PAGE_HERO)
    expect(source).toMatch(/headline: \{ lead: string; accent: string \}/)
    expect(source).toMatch(/statsPlacement\?: 'inline' \| 'below'/)
    expect(source).toMatch(/visual\?: ReactNode/)
  })

  it('keeps the useId and aria-labelledby wiring', async () => {
    const source = await read(PAGE_HERO)
    expect(source).toContain('const titleId = useId()')
    expect(source).toContain('aria-labelledby={titleId}')
  })

  it('puts the visual slot inside the ex-hero-visual area', async () => {
    const source = await read(PAGE_HERO)
    expect(source).toMatch(/className="ex-hero-visual"[^>]*>\s*\{visual\}/)
  })
})

describe('PageHero callers', () => {
  it('ExploreHero goes through PageHero', async () => {
    const source = await read(EXPLORE_HERO)
    expect(source).toMatch(/import \{ PageHero \} from '\.\.\/page\/PageHero'/)
    expect(source).toContain('<PageHero')
    expect(source).toContain('statsPlacement="below"')
  })

  it('TripsHero goes through PageHero', async () => {
    const source = await read(TRIPS_HERO)
    expect(source).toMatch(/import \{ PageHero \} from '\.\.\/page\/PageHero'/)
    expect(source).toContain('<PageHero')
    expect(source).toContain('statsPlacement="below"')
  })

  it('neither caller still builds the section or the ex-hero markup itself', async () => {
    for (const path of [EXPLORE_HERO, TRIPS_HERO]) {
      const source = await read(path)
      expect(source, path).not.toMatch(/<section[\s>]/)
      // The `.ex-hero` section itself. A child class such as `ex-hero-search` is
      // fine: the Explore hero passes its search form in through a slot.
      expect(source, path).not.toMatch(/className="ex-hero(?![\w-])/)
    }
  })

  it('keeps the stats aria-labels in the callers', async () => {
    expect(await read(EXPLORE_HERO)).toContain('statsLabel="Catalog at a glance"')
    expect(await read(TRIPS_HERO)).toContain('statsLabel="Your trips at a glance"')
  })
})

describe('yf-page scope in styles.css', () => {
  it('keeps the page width without a page-scoped button skin', async () => {
    const css = STYLES_TEXT
    const start = css.indexOf(YF_PAGE_MARKER)
    expect(start, 'the yf-page section comment').toBeGreaterThan(-1)
    const block = css.slice(start)
    expect(block).not.toMatch(/:is\(\.yf-page\) \.btn:where\(:not\(\.btn-sm, \.modal \*\)\) \{/)
    // The width moved from a direct declaration to the container's documented
    // variable, so a page selects it instead of restating the property. The
    // value the page asks for is unchanged.
    expect(block).toMatch(/\.container:is\(\.yf-page\) \{\s*--container-max: 1240px;/)
  })
})
