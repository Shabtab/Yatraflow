// ============ Create trip (P11): header and template strip ============
// Source-level checks, node env. The suite has no DOM, so these pins read the
// page and the stylesheet as text, as the design-system ratchet does. They keep
// the approved P11 structure: the PageHeader title split, the TripArt covers,
// the phone scroll-snap row with its focus and motion rules, and the phone link.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// CRLF to LF first, so every anchor matches on any checkout.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const src = read('../src/pages/CreateTrip.tsx')
const css = read('../src/styles.css')

/** The text from one anchor up to the next. A moved anchor fails loudly. */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from)
  expect(start, `anchor not found: ${from}`).toBeGreaterThan(-1)
  const end = text.indexOf(to, start + from.length)
  expect(end, `end anchor not found: ${to}`).toBeGreaterThan(start)
  return text.slice(start, end)
}

describe('Create trip header (P11)', () => {
  it('renders the title through PageHeader with the kicker and the lead and accent split', () => {
    expect(src).toContain('<PageHeader')
    expect(src).toContain('kicker="Start something"')
    expect(src).toContain("headline={{ lead: 'Plan a new', accent: 'trip' }}")
    expect(src).not.toContain('<h1>Plan a new trip</h1>')
    expect(src).not.toContain('className="ts-head"')
  })

  it('keeps the lede words', () => {
    expect(src).toContain('lede="Fill the blocks — your ticket assembles itself as you go."')
  })

  it('puts the draft banner on the Surface card skin and keeps its status role', () => {
    expect(src).toContain('<Surface className="draft-banner" role="status">')
    expect(src).not.toContain('<div className="draft-banner" role="status">')
  })
})

describe('Create trip template strip (P11)', () => {
  const cover = between(src, 'className="tpl-cov"', 'className="tpl-bd"')

  it('draws each cover with TripArt, not an emoji or an inline gradient', () => {
    expect(cover).toContain('<TripArt region={artRegionFor({ destinations: t.prefill.destinations })} />')
    expect(cover).not.toContain('emoji')
    expect(cover).not.toContain('coverGradient')
    expect(cover).not.toContain('style=')
  })

  it('mounts the TripArt sprite that the motif references', () => {
    expect(src).toContain('<TripArtSprite />')
  })

  it('keeps the desktop start-blank card in the row', () => {
    expect(src).toContain('<button type="button" className="tpl-blank" key="blank" onClick={clearTemplate}>')
  })

  it('puts a start-blank link beside the section title for phones', () => {
    expect(src).toContain('<button type="button" className="tpl-blank-link" onClick={clearTemplate}>Start blank</button>')
  })
})

describe('Create trip stylesheet (P11)', () => {
  const MARK = '/* ===== Create trip (P11)'
  const section = css.slice(css.indexOf(MARK))
  const phone = section.slice(section.indexOf('@media (max-width: 720px) {'))

  it('appends the P11 block after the Profile block at the end of the file', () => {
    expect(css.indexOf(MARK)).toBeGreaterThan(-1)
    expect(css.indexOf(MARK)).toBeGreaterThan(css.indexOf('Profile & settings (P9'))
  })

  it('sets a scroll-snap row of 236px cards on a phone, with scroll-padding', () => {
    expect(phone).toContain('.tpl-strip { display: flex;')
    expect(phone).toContain('scroll-snap-type: x mandatory')
    expect(phone).toContain('scroll-padding-inline:')
    expect(phone).toContain('flex: 0 0 236px')
    expect(phone).toContain('scroll-snap-align: start')
  })

  it('keeps the scrollbar usable', () => {
    expect(section).not.toContain('scrollbar-width: none')
    expect(section).not.toContain('::-webkit-scrollbar')
  })

  it('opts the row out of smooth scrolling under reduced motion', () => {
    expect(section).toContain('@media (max-width: 720px) and (prefers-reduced-motion: reduce)')
    expect(section).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.tpl-warm > \.tpl-strip \{ scroll-behavior: auto; \}/)
  })

  it('gives the phone link a visible keyboard focus ring', () => {
    expect(section).toContain('.tpl-blank-link:focus-visible')
  })

  it('shows the phone link and hides the desktop card tile on a phone', () => {
    expect(phone).toContain('.tpl-warm-head .tpl-blank-link { display: inline-flex;')
    expect(phone).toContain('.tpl-blank { display: none; }')
  })

  it('sets the card title to 18px at weight 800 (R20) and the cover to 92px', () => {
    expect(section).toContain('.tpl-bd b { font-family: var(--font-body); font-size: 18px; font-weight: 800; line-height: 1.3; }')
    expect(section).toContain('.tpl-cov { height: 92px; position: relative; }')
  })
})
