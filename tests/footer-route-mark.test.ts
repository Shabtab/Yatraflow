// Source pins for the footer route mark (consistency P1).
// The mark is a decorative svg. It is hidden from assistive tech, it is not a link, and it does not move.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const app = read('src/App.tsx')
const css = read('src/styles.css')

const footerOpen = app.indexOf('<footer className="footer">')
const footerClose = app.indexOf('</footer>', footerOpen)
const footer = footerOpen < 0 || footerClose < 0 ? '' : app.slice(footerOpen, footerClose + '</footer>'.length)
const MARK_BLOCK_START = '/* ---------- Footer route mark'
// The block ends at the next section comment. Sections append after it, so a slice to the end of the file would read their rules too.
const markStart = css.indexOf(MARK_BLOCK_START)
// A section comment opens with dashes or with equals signs. Stop at either style.
const markTail = css.slice(markStart + MARK_BLOCK_START.length)
const markNext = markTail.search(/\n\/\* (?:-{3,}|={3,})/)
const markBlock = css.slice(markStart, markNext < 0 ? undefined : markStart + MARK_BLOCK_START.length + markNext)

describe('footer route mark (P1)', () => {
  it('renders one decorative svg inside the footer, hidden from assistive tech', () => {
    expect(footer).not.toBe('')
    expect(footer.match(/<svg\b/g)?.length).toBe(1)
    expect(footer).toMatch(/<svg\b[^>]*aria-hidden="true"/)
    expect(footer).toMatch(/<svg\b[^>]*focusable="false"/)
  })

  it('keeps the feedback link and the calculator link, and adds no anchor', () => {
    expect(footer).toContain('href={feedbackHref()}')
    expect(footer).toContain('Send feedback')
    expect(footer).toContain('href="/ladakh-trip-cost-calculator/"')
    expect(footer.match(/<a\s/g)?.length).toBe(2)
  })

  it('positions the mark against the footer itself, not against its padding', () => {
    expect(css).toMatch(/\.footer \{[^}]*position: relative/)
    expect(markBlock).toMatch(/position: absolute;/)
    expect(markBlock).toMatch(/top: -6px;/)
  })

  it('adds a static CSS block with no raw milliseconds, transition or animation', () => {
    expect(css.indexOf(MARK_BLOCK_START)).toBeGreaterThan(-1)
    expect(markBlock).not.toMatch(/\d\s*ms\b/)
    expect(markBlock).not.toMatch(/transition|animation/i)
  })
})
