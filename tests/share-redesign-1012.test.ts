// #1012 — Share tab redesign, Track A (layout, copy, privacy and motion pins).
// Source-level pins, read with CRLF folded to LF. The pure logic has no state here.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tab = read('../src/pages/trip/ShareTab.tsx')
const css = read('../src/styles/legacy/05-share-and-trip-ticket.css')
const workspace = read('../src/pages/TripWorkspace.tsx')

// The #1012 block of the owning stylesheet, from its opening comment to the keyframes.
const shareBlock = css.slice(css.indexOf('/* #1012'), css.indexOf('@keyframes shr-fade-in'))

describe('Share tab: three columns from one breakpoint', () => {
  it('the JS query and the CSS column width name the same 1100px break', () => {
    expect(tab).toContain("const SHARE_WIDE_QUERY = '(min-width: 1100px)'")
    expect(css).toContain('from 1100px')
  })

  it('the wide layout has no tablist and no hidden tab panels', () => {
    expect(tab).toMatch(/\{!wide && \(\s*<div className="share-tablist"/)
    expect(tab).toMatch(/\{wide \? \(\s*<div className="shr-columns">/)
  })

  it('the three columns use the 1440 grid, and the Share tab alone widens the container', () => {
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, .85fr)')
    expect(css).toContain(".container.yf-workspace[data-share-wide='true']")
    expect(workspace).toContain("data-share-wide={tab === 'share' ? 'true' : undefined}")
    expect(workspace).not.toMatch(/yf-page[^\n]*data-share-wide/)
  })

  it('the Share header names the tab and says what it is for', () => {
    expect(tab).toContain('<span className="shr-eyebrow">Share</span>')
    expect(tab).toContain('<h2 className="shr-page-title">Share this trip</h2>')
    expect(tab).toContain('Three different jobs, in the order people need them.')
  })
})

describe('Share tab: members, invite and copy', () => {
  it('no member email is rendered (#800)', () => {
    expect(tab).not.toMatch(/profile\.email|m\.email|u\?\.email/)
  })

  it('the join line stays honest: there is no role toggle in the invite', () => {
    expect(tab.match(/New members join as editors\./g)).toHaveLength(1)
    expect(tab).not.toMatch(/Joins as Editor|Joins as Viewer|Reset link/)
  })

  it('the members label carries the count', () => {
    expect(tab).toMatch(/Members and roles · \{\(trip\.members \?\? \[\]\)\.length\}/)
  })

  it('the join code is its own tile, separate from the link field', () => {
    expect(tab).toContain('className="shr-join-tile"')
    expect(tab).toContain('aria-labelledby="share-invite-label"')
  })
})

describe('Share tab: danger zone, record and marigold', () => {
  it('the danger zone keeps the app wording and never offers Delete trip', () => {
    expect(tab).toContain('Removal blocks private trip access and replaces the invite link.')
    expect(tab).not.toMatch(/Delete trip|removes it for everyone/)
  })

  it('marigold is on Publish only: one saffron button in the whole tab', () => {
    expect(tab.match(/btn-saffron/g)).toHaveLength(1)
    expect(tab).toMatch(/btn btn-saffron" disabled=\{!isOwner \|\| busy\}/)
  })

  it('the snapshot link is an outline button', () => {
    expect(tab).toMatch(/<button className="btn btn-outline btn-sm" onClick=\{makeLink\}/)
  })

  it('the calendar copy keeps one event per day until the export changes', () => {
    expect(tab).toContain('One event per day, plus timed events')
    expect(tab).not.toMatch(/one event per stop/i)
  })
})

describe('Share tab: hidden-from-public card', () => {
  it('lists only the two items the audit proved (HIDDEN-AUDIT.md)', () => {
    expect(tab).toContain('Crew names, and the booking reference on each flight.')
    expect(tab).not.toMatch(/home address|phone number|private note/i)
  })
})

describe('Share tab: Show QR loads its library only on request', () => {
  it('imports qrcode dynamically, inside the Show QR handler', () => {
    expect(tab).toContain("await import('qrcode')")
    expect(tab).not.toMatch(/^import .* from 'qrcode'/m)
  })

  it('the QR states are three statements: loading, drawn, failed', () => {
    expect(tab).toContain('title="Drawing the QR code…"')
    expect(tab).toContain('title="Could not draw the QR code."')
    expect(tab).toContain('alt="QR code for the invite link"')
  })
})

describe('Share tab: WhatsApp and Email go through the native opener', () => {
  it('both invite buttons open a link with openExternal', () => {
    expect(tab).toContain("import { nativeCopyText, openExternal } from '../../lib/native'")
    expect(tab).toMatch(/openExternal\(whatsAppSendUrl\(/)
    expect(tab).toMatch(/openExternal\(mailtoUrl\(/)
  })
})

describe('Share tab: motion and reduced motion', () => {
  it('every new transition is a token, with no raw millisecond value', () => {
    expect(shareBlock).toContain('var(--motion-fast)')
    expect(shareBlock).not.toMatch(/\d+ms\b/)
  })

  it('the new entrance and hover both have a reduced-motion opt-out', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.shr-take-row \{ transition: none; \}/)
    expect(css).toMatch(/\.shr-qr-image \{ animation: none; \}/)
  })
})

describe('Share tab: compact cover', () => {
  it('the full picker mounts only when the cover is open or holds an error', () => {
    expect(tab).toContain('const coverEditing = coverOpen || !!errs.cover')
    expect(tab).toMatch(/\{coverEditing && \(\s*<div ref=\{el => \{ fieldRefs\.current\.cover = el \}\}/)
  })

  it('a cover error opens the picker before focus moves to it', () => {
    expect(tab).toMatch(/if \(bad\.cover\) \{\s*setCoverOpen\(true\)/)
  })
})
