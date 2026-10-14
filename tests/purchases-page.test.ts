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
    expect(source).toContain('className="container yf-page pur-page page-enter"')
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
    expect(source).toContain("<Surface as=\"article\" className={isHighlighted ? 'pur-row is-new' : 'pur-row'} key={row.pubId} id={purchaseCardId(row.pubId)} enterIndex={rowIndex}>")
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

  it('keeps the caveat phrases of the summary line exactly', async () => {
    const source = await read(PAGE)
    expect(source).toContain('<><b>{formatInr(shelf.totalPaidInr)}</b> paid</>')
    expect(source).toContain("{shelf.updatedCount > 0 && <> · <b>{shelf.updatedCount}</b> updated since you bought {shelf.updatedCount === 1 ? 'it' : 'them'}</>}")
    expect(source).toContain('{shelf.refundedCount > 0 && <> · <b>{shelf.refundedCount}</b> refunded</>}')
    expect(source).toContain("{shelf.pendingGrantCount > 0 && <> · <b>{shelf.pendingGrantCount}</b> {shelf.pendingGrantCount === 1 ? 'payment' : 'payments'} being finalized</>}")
  })
})

describe('Purchases page: honest update and arrival copy', () => {
  it('says what the creator did, not what changed, and drops the old chip', async () => {
    const source = await read(PAGE)
    expect(source).toContain('republishedLine(row)')
    expect(source).toContain('{updateSentence && <p className="pur-update">{updateSentence}</p>}')
    expect(source).not.toContain('<Chip tone="info">Updated ')
  })

  it('tells the truth about the dates of a fork in the footer', async () => {
    const source = await read(PAGE)
    expect(source).toContain('the plan’s original dates')
    expect(source).toContain('You can change')
    expect(source).toContain('Your copy stays yours, even if the creator updates the plan later.')
    expect(source).not.toContain('with your dates')
  })

  it('reads the new parameter once, plays the highlight only for a card on the shelf, and clears the parameter', async () => {
    const source = await read(PAGE)
    expect(source).toContain("useRef(currentQuery().get('new'))")
    expect(source).toContain('if (!shelf.rows.some(row => row.pubId === wantedId)) return')
    expect(source).toContain('hasPlayedNew.current = true')
    expect(source).toContain("query.delete('new')")
    expect(source).toContain('replaceRoute(')
    expect(source).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches")
  })

  it('passes one handwritten note to the header', async () => {
    const source = await read(PAGE)
    expect(source).toContain('note="Yours to keep."')
    expect((source.match(/\bnote=/g) ?? [])).toHaveLength(1)
  })
})

describe('UnlockReveal: true copy and a way to the shelf', () => {
  const REVEAL = 'src/components/UnlockReveal.tsx'

  it('no longer promises today’s dates', async () => {
    const source = await read(REVEAL)
    expect(source).not.toMatch(/today[\s\S]{0,40}dates/i)
    expect(source).toContain('with the creator’s dates')
    expect(source).toContain('change the dates')
  })

  it('links to My purchases and names the new purchase in the query', async () => {
    const source = await read(REVEAL)
    expect(source).toContain("import { appLink } from '../lib/appLink'")
    expect(source).toContain('appLink(`/purchases?new=${encodeURIComponent(pub.id)}`)')
    expect(source).toContain('>My purchases</a>')
  })

  it('keeps the primary action and the share control', async () => {
    const source = await read(REVEAL)
    expect(source).toContain('onClick={onFork}')
    expect(source).toContain('Fork into my trips')
    expect(source).toContain('Share what you bought')
  })
})

describe('Styles: the page blocks take their entrance from page-enter', () => {
  it('declares no entrance on the My purchases page rules, so the shared cascade owns every block', async () => {
    const css = await read('src/styles.css')
    const start = css.indexOf('/* ===== My purchases (page rules) ===== */')
    const end = css.indexOf('/* ===== My purchases: the kept-for-you card')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(css.slice(start, end)).not.toMatch(/animation\s*:/)
  })
})

describe('Styles: the new rules use tokens and opt out of motion', () => {
  it('fades the new-card outline with the slow token and the out easing, and has a still fallback', async () => {
    const css = await read('src/styles.css')
    const start = css.indexOf('.pur-row.is-new::after')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, start + 900)
    expect(block).toContain('animation: purNewRing var(--motion-slow) var(--ease-out)')
    expect(block).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.pur-row\.is-new::after \{ animation: none;/)
    expect(block).not.toMatch(/\d+ms/)
  })
})
