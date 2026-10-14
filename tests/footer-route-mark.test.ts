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
const markBlock = css.slice(css.indexOf(MARK_BLOCK_START))

describe('footer route mark (P1)', () => {
  it('renders one decorative svg inside the footer, hidden from assistive tech', () => {
    expect(footer).not.toBe('')
    expect(footer.match(/<svg\b/g)?.length).toBe(1)
    expect(footer).toMatch(/<svg\b[^>]*aria-hidden="true"/)
  })

  it('keeps the feedback link and the calculator link, and adds no anchor', () => {
    expect(footer).toContain('href={feedbackHref()}')
    expect(footer).toContain('Send feedback')
    expect(footer).toContain('href="/ladakh-trip-cost-calculator/"')
    expect(footer.match(/<a\s/g)?.length).toBe(2)
  })

  it('lifts the mark by the footer top padding, so its midline sits on the border', () => {
    expect(css).toMatch(/\.footer \{[^}]*padding: 26px 0 34px/)
    expect(markBlock).toMatch(/top: -32px;/)
  })

  it('adds a static CSS block with no raw milliseconds, transition or animation', () => {
    expect(css.indexOf(MARK_BLOCK_START)).toBeGreaterThan(-1)
    expect(markBlock).not.toMatch(/\d\s*ms\b/)
    expect(markBlock).not.toMatch(/transition|animation/i)
  })
})
