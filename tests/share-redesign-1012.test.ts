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

  it('the narrow jobs use the shared pill glider, with ids that label the panels', () => {
    expect(tab).toMatch(/\{!wide && \(\s*<SegmentedTabs semantics="tablist" className="tabbar share-job-tabs"/)
    expect(tab).toContain('label="Share and trip options"')
    expect(tab).toContain('id: `share-tab-${t.id}`')
    expect(tab).toContain('controls: `share-panel-${t.id}`')
    expect(tab).toMatch(/<div className=\{wide \? 'shr-columns' : 'share-panels'\}>/)
  })

  it('the panels never remount between the tabs and the columns, because only attributes switch', () => {
    // A remount drops PublicationForm's local drafts (price, free days, tagline)
    // when the window crosses the 1100px break. The wrapper and each keyed section
    // exist in both layouts, so only className, role, aria and hidden change.
    expect(tab).not.toMatch(/wide \?\s*\(\s*<div/)
    expect(tab).toContain('<section key={t.id} id={`share-panel-${t.id}`} data-share-column={t.id}')
    expect(tab).toContain("className={wide ? 'shr-column' : 'share-panel'}")
    expect(tab).toContain("role={wide ? undefined : 'tabpanel'}")
    expect(tab).toContain("aria-labelledby={wide ? undefined : `share-tab-${t.id}`}")
    expect(tab).toContain('hidden={!wide && tab !== t.id}')
  })

  it('phones show short job names but keep the full accessible name', () => {
    expect(tab).toContain("short: '1 · Plan'")
    expect(tab).toContain("short: '2 · Publish'")
    expect(tab).toContain("short: '3 · Keep'")
    expect(tab).toContain('<span className="shr-tab-name">{t.label}</span>')
    expect(tab).toContain('<span className="shr-tab-short" aria-hidden="true">{t.short}</span>')
    expect(css).toMatch(/@media \(max-width: 479px\) \{\s*\.shr-tab-name \{/)
    expect(css).toContain('.shr-tab-short { display: inline; }')
    expect(css).toContain('.shr-tab-short { display: none; }')
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

  it('the join line follows the link role, and no role label is hard-coded', () => {
    // #1012: the role sentence is built from the role the server read, never a fixed word.
    expect(tab).toMatch(/New members join as \$\{readRole\}s\. /)
    expect(tab).not.toMatch(/Joins as Editor|Joins as Viewer/)
    expect(tab).not.toMatch(/Returning members keep their assigned role/)
    expect(tab).toContain('Reset link')
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

  it('the snapshot link is one of the four equal take-it rows', () => {
    expect(tab).toMatch(/<button type="button" className="shr-take-row" onClick=\{makeLink\}/)
    expect(tab.match(/className="shr-take-row"/g)).toHaveLength(3)
    expect(tab).toContain('<PrintExport trip={trip} legCorrections={legCorrections} variant="row" />')
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

describe('Share tab: round 2 (REVIEW-1)', () => {
  it('Free or Premium is a toggle on the shr-seg glider, with no raw Premium price for Free', () => {
    expect(tab).toMatch(/<SegmentedTabs semantics="toggle" className="shr-seg"/)
    expect(tab).toContain('const entirelyFree = !premium')
    expect(tab).toContain("{premium && (\n        <Field label=\"Premium price (₹)\"")
  })

  it('the reader copy sits behind More details, which the CTA error opens', () => {
    expect(tab).toContain('aria-expanded={moreEditing}')
    expect(tab).toContain('<div id="pub-more-details" hidden={!moreEditing}>')
    expect(tab).toMatch(/if \(bad\.cta\) setMoreOpen\(true\)/)
  })

  it('the member rows come from usePresenceList, and a join is the only entrance', () => {
    expect(tab).toContain('usePresenceList(members, m => m.userId)')
    expect(tab).toContain("className={`feed-item shr-member-row${entering ? ' is-entering' : ''}`}")
    expect(css).toContain('.shr-member-row.is-entering { animation: shr-member-in')
  })

  it('the join tile puts Copy beside the label, so the 14-character code keeps the full tile width', () => {
    expect(tab).toContain('<div className="shr-join-head">')
    expect(css).toContain('.shr-join-head { display: flex')
    expect(css).not.toContain('.shr-join-code-row')
  })

  it('the Premium segment names the price once one is typed', () => {
    expect(tab).toContain('premium && priceNum > 0 ? `Premium · ${formatInr(priceNum)}` : \'Premium\'')
  })

  it('the DAY tiles are small square buttons, six to a row', () => {
    expect(tab).toContain('className={`shr-day-tile${isFree ? \' is-free\' : \'\'}`}')
    expect(css).toMatch(/\.shr-day-grid \{ display: grid; grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/)
  })
})

describe('Share tab: compact cover', () => {
  it('the full picker mounts only when the cover is open or holds an error', () => {
    expect(tab).toContain('const coverEditing = coverOpen || !!errs.cover')
    expect(tab).toMatch(/\{coverEditing && \(\s*<div ref=\{el => \{ fieldRefs\.current\.cover = el \}\}/)
  })

  it('a cover error opens the picker before focus moves to it', () => {
    expect(tab).toMatch(/if \(bad\.cover\) setCoverOpen\(true\)/)
  })
})
