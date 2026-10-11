// PageHeader and Surface: the shared compact header and the card skin.
// Node env, no DOM. The tests read source text, with CRLF turned into LF first.
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const read = async (relativePath: string) =>
  (await readFile(join(process.cwd(), relativePath), 'utf8')).replace(/\r\n/g, '\n')

const PAGE_HEADER = 'src/components/page/PageHeader.tsx'
const SURFACE = 'src/components/page/Surface.tsx'
const STYLES = 'src/styles.css'

describe('PageHeader component contract', () => {
  it('exports a PageHeader component', async () => {
    const source = await read(PAGE_HEADER)
    expect(source).toMatch(/export function PageHeader\(/)
  })

  it('renders the single h1 and labels the section with it', async () => {
    const source = await read(PAGE_HEADER)
    expect(source.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(source).toContain('const titleId = useId()')
    expect(source).toContain('aria-labelledby={titleId}')
    expect(source).toContain('<h1 id={titleId}')
  })

  it('declares every optional prop', async () => {
    const source = await read(PAGE_HEADER)
    expect(source).toMatch(/back\?: \{ label: string; onClick: \(\) => void \}/)
    expect(source).toMatch(/kicker\?: string/)
    expect(source).toMatch(/headline: \{ lead: string; accent\?: string \}/)
    expect(source).toMatch(/lede\?: ReactNode/)
    expect(source).toMatch(/actions\?: ReactNode/)
    expect(source).toMatch(/meta\?: ReactNode/)
    expect(source).toMatch(/stats\?: \{ label: string; value: number \}\[\]/)
  })

  it('renders each optional part only when it is given', async () => {
    const source = await read(PAGE_HEADER)
    expect(source).toMatch(/\{back \? \(/)
    expect(source).toMatch(/\{kicker \? <p className="ex-kicker yf-header-kicker">/)
    expect(source).toMatch(/\{actions \? <div className="yf-header-actions">/)
    expect(source).toMatch(/\{meta \? <div className="yf-header-meta">/)
    expect(source).toMatch(/\{hasLede \? <p className="yf-header-lede">/)
  })

  it('hides the counts row when the list is empty', async () => {
    const source = await read(PAGE_HEADER)
    expect(source).toContain('const hasStats = stats !== undefined && stats.length > 0')
    expect(source).toMatch(/\{hasStats \? \(\s*<dl className="ex-stats yf-header-stats"/)
  })

  it('sets the accent in italic inside the h1 only when it is given', async () => {
    const source = await read(PAGE_HEADER)
    expect(source).toMatch(/\{headline\.accent \? <> <em>\{headline\.accent\}<\/em><\/> : null\}/)
  })
})

describe('PageHeader styles', () => {
  it('uses the yf-header rules, the serif title and token motion', async () => {
    const css = await read(STYLES)
    const start = css.indexOf('/* ===== Shared page components: header ===== */')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('/* ===== Shared page components: surface ===== */'))
    expect(block).toContain('font-family: var(--font-serif)')
    expect(block).toContain('clamp(2rem, 1.2rem + 2vw, 2.75rem)')
    expect(block).toContain('border-bottom: 1px solid var(--line)')
    expect(block).toContain('animation: cardIn var(--motion-slow) var(--ease-out) backwards')
    expect(block).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.yf-header \{ animation: none; \}/)
    expect(block).not.toMatch(/\d+ms/)
  })
})

describe('Surface component contract', () => {
  it('exports a Surface with the four tags and the interactive flag', async () => {
    const source = await read(SURFACE)
    expect(source).toMatch(/export function Surface\(/)
    expect(source).toMatch(/as\?: 'div' \| 'article' \| 'li' \| 'section'/)
    expect(source).toMatch(/interactive\?: boolean/)
    expect(source).toContain("classNames.push('is-interactive')")
  })

  it('passes aria props and every other attribute through', async () => {
    const source = await read(SURFACE)
    expect(source).toContain("extends Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'>")
    expect(source).toContain('{...rest}')
  })

  it('lifts on hover only when interactive, with token motion and a reduced-motion opt-out', async () => {
    const css = await read(STYLES)
    const start = css.indexOf('/* ===== Shared page components: surface ===== */')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('/* ===== My purchases (page rules) ===== */'))
    expect(block).toContain('box-shadow: var(--shadow-card)')
    expect(block).toContain('.yf-surface.is-interactive:hover { transform: translateY(-2px); box-shadow: var(--shadow-card-hover); border-color: var(--line-strong); }')
    expect(block).not.toMatch(/\n\.yf-surface:hover/)
    expect(block).toMatch(/prefers-reduced-motion: reduce\) \{[\s\S]*transform: none/)
    expect(block).not.toMatch(/\d+ms/)
  })
})
