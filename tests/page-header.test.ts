// PageHeader and Surface: the shared compact header and the card skin.
// Node env, no DOM. The tests read source text, with CRLF turned into LF first.
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { surfaceButtonType, surfaceIsInteractive } from '../src/components/page/Surface'

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
  it('uses the yf-header rules and the serif title, and declares no entrance of its own', async () => {
    const css = await read(STYLES)
    const start = css.indexOf('/* ===== Shared page components: header ===== */')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('/* ===== Shared page components: surface ===== */'))
    expect(block).toContain('font-family: var(--font-serif)')
    expect(block).toContain('clamp(2rem, 1.2rem + 2vw, 2.75rem)')
    expect(block).toContain('border-bottom: 1px solid var(--line)')
    // R19: page-enter owns the page entrance, so the page header has no cardIn entrance.
    expect(block).not.toContain('cardIn')
    expect(block).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.yf-header \{ animation: none; \}/)
    expect(block).not.toMatch(/\d+ms/)
  })
})

describe('Surface component contract', () => {
  it('exports a Surface with its tag type and the interactive flag', async () => {
    const source = await read(SURFACE)
    expect(source).toMatch(/export function Surface\(/)
    expect(source).toMatch(/as\?: SurfaceTag/)
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

  it('keeps the list-row entrance with its opt-out, because the page cascade reaches direct children only', async () => {
    const css = await read(STYLES)
    const start = css.indexOf('/* ===== Shared page components: surface ===== */')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('/* ===== My purchases (page rules) ===== */'))
    expect(block).toContain('.yf-surface.is-entering { animation: cardIn var(--motion-slow) var(--ease-out) backwards; }')
    expect(block).toMatch(/prefers-reduced-motion: reduce\) \{[\s\S]*\.yf-surface\.is-entering \{ animation: none; \}/)
  })
})

describe('Surface root tags', () => {
  it('names the button and details roots in the tag type', async () => {
    const source = await read(SURFACE)
    expect(source).toContain("export type SurfaceTag = 'div' | 'article' | 'li' | 'section' | 'button' | 'details'")
    expect(source).toMatch(/as\?: SurfaceTag/)
  })

  it('sets type="button" on a button surface unless the caller gives a type', () => {
    expect(surfaceButtonType('button')).toBe('button')
    expect(surfaceButtonType('button', 'submit')).toBe('submit')
    expect(surfaceButtonType('div')).toBeUndefined()
    expect(surfaceButtonType('details', 'submit')).toBeUndefined()
  })

  it('lifts a button surface whether or not interactive is set', () => {
    expect(surfaceIsInteractive('button', false)).toBe(true)
    expect(surfaceIsInteractive('details', false)).toBe(false)
    expect(surfaceIsInteractive('article', true)).toBe(true)
  })

  it('passes the type to the tag only for a button, and spreads the other props last', async () => {
    const source = await read(SURFACE)
    expect(source).toContain('const buttonType = surfaceButtonType(as, type)')
    expect(source).toContain('{...(buttonType ? { type: buttonType } : {})}')
    // The rest of the props spread after the type, so a caller's own attributes win.
    expect(source.indexOf('{...rest}')).toBeGreaterThan(source.indexOf('{...(buttonType'))
  })
})

describe('Surface root styles', () => {
  const BLOCK_MARK = '/* ===== Shared page components: compact state block and surface roots ===== */'

  it('rings a focused button surface with the shared ring, not a new recipe', async () => {
    const css = await read(STYLES)
    const block = css.slice(css.indexOf(BLOCK_MARK))
    expect(css.indexOf(BLOCK_MARK)).toBeGreaterThan(-1)
    expect(block).toContain('.yf-surface.is-interactive:focus-visible { outline: none; box-shadow: var(--ring); }')
  })

  it('presses on the fast clock and turns the press off under reduced motion', async () => {
    const css = await read(STYLES)
    const block = css.slice(css.indexOf(BLOCK_MARK))
    expect(block).toContain('.yf-surface.is-interactive:active { transform: translateY(1px); transition-duration: var(--motion-fast); }')
    expect(block).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.yf-surface\.is-interactive:active \{ transform: none; transition: none; \}/)
  })

  it('declares the button reset with the card font and no raw duration', async () => {
    const css = await read(STYLES)
    const block = css.slice(css.indexOf(BLOCK_MARK)).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(block).toContain(':where(button.yf-surface) {')
    expect(block).toContain('font: inherit; color: inherit;')
    expect(block).not.toMatch(/\d+ms/)
  })
})

describe('PageHeader note slot', () => {
  it('declares an optional note and renders it only when it is given', async () => {
    const source = await read(PAGE_HEADER)
    expect(source).toMatch(/note\?: ReactNode/)
    expect(source).toMatch(/\{note \? \(/)
    expect(source).toContain('<p className="yf-header-note" aria-hidden="true">')
  })

  it('hides the decorative note from assistive technology and keeps the one h1', async () => {
    const source = await read(PAGE_HEADER)
    expect(source.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(source).toContain('aria-hidden="true"')
  })

  it('copies the hero note look: hand font, saffron highlight and the hand-drawn arrow', async () => {
    const css = await read(STYLES)
    const start = css.indexOf('/* ===== Shared page components: the handwritten header note ===== */')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start)
    expect(block).toContain('font-family: var(--font-hand)')
    expect(block).toContain('font-weight: 600')
    expect(block).toContain('color-mix(in srgb, var(--saffron) 45%, transparent)')
    expect(block).toContain('.yf-header-note svg { width: 54px; height: 62px;')
    expect(block).toMatch(/@media \(min-width: 720px\) \{\s*\.yf-header-note \{ display: flex;/)
    expect(block).not.toMatch(/\d+ms/)
  })
})
