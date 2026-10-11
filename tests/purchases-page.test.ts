// The Purchases page on the shared page components, and the honesty branches it keeps.
// Node env, no DOM. The tests read source text, with CRLF turned into LF first.
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const read = async (relativePath: string) =>
  (await readFile(join(process.cwd(), relativePath), 'utf8')).replace(/\r\n/g, '\n')

const PAGE = 'src/pages/Purchases.tsx'

describe('Purchases page: shared components', () => {
  it('imports PageHeader, StateBlock and Surface', async () => {
    const source = await read(PAGE)
    expect(source).toContain("import { PageHeader } from '../components/page/PageHeader'")
    expect(source).toContain("import { StateBlock } from '../components/page/StateBlock'")
    expect(source).toContain("import { Surface } from '../components/page/Surface'")
  })

  it('carries the page scope on its root and no longer uses the old state components', async () => {
    const source = await read(PAGE)
    expect(source).toContain('className="container yf-page pur-page"')
    expect(source).not.toContain('<EmptyState')
    expect(source).not.toContain('loading-block')
    expect(source).not.toContain('purchases-error')
  })

  it('has no inline style object', async () => {
    // No dynamic value in this file needs one. The row delay is set inside Surface.
    const source = await read(PAGE)
    expect(source).not.toContain('style={{')
  })

  it('opens the header with the back link and the serif accent, and no kicker that repeats the link', async () => {
    const source = await read(PAGE)
    expect(source).toContain("back={{ label: 'My trips', onClick: () => onNavigate('/trips') }}")
    expect(source).not.toContain('kicker=')
    expect(source).toContain("headline={{ lead: 'My', accent: 'purchases' }}")
    expect(source).toContain('meta={summaryLine}')
  })

  it('renders each purchase row on a Surface with its place in the list', async () => {
    const source = await read(PAGE)
    expect(source).toContain('<Surface as="article" className="pur-row" key={row.pubId} enterIndex={rowIndex}>')
  })
})

describe('Purchases page: state branches stay separate', () => {
  it('renders signed out, failed, loading and empty as four StateBlock kinds', async () => {
    const source = await read(PAGE)
    expect(source).toMatch(/!meId \? \(\s*<StateBlock kind="empty"[\s\S]{0,160}?title="Sign in to see what you own"/)
    expect(source).toMatch(/failed \? \(\s*<StateBlock kind="failed"[\s\S]{0,160}?title="Couldn’t load your purchases"/)
    expect(source).toMatch(/entitlements === null \|\| orders === null \? \(\s*<StateBlock kind="loading"/)
    expect(source).toMatch(/shelf\.rows\.length === 0 \? \(\s*<StateBlock kind="empty"[\s\S]{0,160}?title="Nothing bought yet"/)
  })

  it('checks failed before it checks empty, so a failed read is never an empty shelf', async () => {
    const source = await read(PAGE)
    const failedAt = source.indexOf('failed ? (')
    const loadingAt = source.indexOf('entitlements === null || orders === null ? (')
    const emptyAt = source.indexOf('shelf.rows.length === 0 ? (')
    expect(failedAt).toBeGreaterThan(-1)
    expect(failedAt).toBeLessThan(loadingAt)
    expect(loadingAt).toBeLessThan(emptyAt)
  })

  it('keeps the failed copy and the retry handler', async () => {
    const source = await read(PAGE)
    expect(source).toContain('The request failed, which is not the same as owning nothing')
    expect(source).toContain('your plans are safe on your account')
    expect(source).toContain('onClick={() => setAttempt(n => n + 1)}>Try again</button>')
  })
})

describe('Purchases page: the summary keeps its honesty', () => {
  it('says "at least" when the total is not readable', async () => {
    const source = await read(PAGE)
    expect(source).toContain('shelf.totalReadable')
    expect(source).toContain('at least <b>{formatInr(shelf.totalPaidInr)}</b> paid')
    expect(source).toContain('this total is a floor rather than the')
  })

  it('names every part of the summary and builds it only when the shelf is shown', async () => {
    const source = await read(PAGE)
    expect(source).toContain('const isShelfShown = Boolean(meId) && !failed && entitlements !== null && orders !== null && shelf.rows.length > 0')
    expect(source).toContain('const summaryLine = isShelfShown ? (')
    expect(source).toContain('updated since you bought')
    expect(source).toContain('shelf.refundedCount > 0')
    expect(source).toContain('being finalized')
  })

  it('does not turn the summary into counts', async () => {
    const source = await read(PAGE)
    expect(source).not.toContain('stats={')
  })
})
