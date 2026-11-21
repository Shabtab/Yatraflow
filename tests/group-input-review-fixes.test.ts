import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Source pins for the Group input review fixes. This is a node-env test: it
// reads text and renders nothing. CRLF is turned into LF first.
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tab = read('src/pages/trip/GroupInputTab.tsx')
const own = read('src/styles/pages/group-input.css')

describe('Group input review fixes', () => {
  it('shows a pill count only after its slice read is ready, and never a zero', () => {
    expect(tab).toMatch(/return ready && count > 0 \? `\$\{base\} · \$\{count\}` : base/)
    expect(tab).toMatch(/pillLabel\('Needs you', needsYouCount, listReady\)/)
    expect(tab).toMatch(/pillLabel\('Decisions', openDecisions\.length, decisionsRead === 'ready'\)/)
    expect(tab).toMatch(/pillLabel\('Stop ideas', openIdeas\.length, suggestionsRead === 'ready'\)/)
    expect(tab).toMatch(/const listReady = suggestionsRead === 'ready' && decisionsRead === 'ready'/)
  })

  it('reads the decided time from resolvedAt only', () => {
    expect(tab).toMatch(/d\.resolvedAt \? `Decided · \$\{timeAgo\(d\.resolvedAt\)\}` : 'Decided'/)
    expect(tab).not.toMatch(/resolvedAt \?\? d\.createdAt/)
  })

  it('hides the agreed line and the repeated question when no option was resolved', () => {
    expect(tab).toMatch(/\{resolvedOption && <p className="small muted gin-sub">\{agreed\} of \{memberCount\} agreed · \{d\.question\}<\/p>\}/)
  })

  it('shows the context on a decided card', () => {
    const decided = tab.slice(tab.indexOf('className="gin-decided"'))
    expect(decided.slice(0, 900)).toContain('{d.context && <p className="small muted gin-decision-context">{d.context}</p>}')
  })

  it('marks an idea that needs my vote with text, and pads the row off the border', () => {
    expect(tab).toMatch(/\{needsMe && <span className="gin-pop"><Chip tone="saffron">Needs your vote<\/Chip><\/span>\}/)
    expect(own).toMatch(/\.gin-row\.gi-needs-you \{ padding-left: 12px; \}/)
  })

  it('gives every section target a region role, a name and a visible focus ring', () => {
    for (const name of ['decisions', 'ideas', 'activity']) {
      expect(tab).toContain(`id="gi-section-${name}" tabIndex={-1} role="region" aria-labelledby="gi-heading-${name}"`)
      expect(tab).toContain(`id="gi-heading-${name}"`)
    }
    expect(tab).toContain('<h3 id="gi-heading-decisions" className="sr-only">Decisions</h3>')
    expect(own).toMatch(/\.gin-col:focus \{[^}]*box-shadow: var\(--ring\)/)
    expect(own).not.toMatch(/\.gin-col:focus \{[^}]*outline: none/)
  })

  it('shows "No open stop ideas" when every idea is resolved, gated on a ready read', () => {
    expect(tab).toContain("title: 'No open stop ideas'")
    expect(tab).toMatch(/suggestionsRead === 'ready' && sortedIdeas\.length > 0 && openIdeas\.length === 0 && !ideasExiting && \(\s*<StateBlock kind="empty" size="compact" title=\{EMPTY_COPY\.ideasOpen\.title\}/)
  })

  it('keeps one primary in the decision footer, and states the helper line without a fit claim', () => {
    // The Resolve buttons are secondary while Vote shows. Only a locked decision with a winner promotes one.
    expect(tab).toContain("className={`btn btn-sm ${locked && outcome.kind === 'winner' && outcome.option.id === o.id ? 'btn-primary' : 'btn-outline'}`} disabled={busy}")
    expect(tab).toContain('Suggest a stop for the group. Editors add the ones the group likes to the timeline.')
    expect(tab).not.toMatch(/the engine says where/)
  })

  it('stamps only a settled outcome that applied', () => {
    expect(tab).toMatch(/flow\.kind === 'settled' && \(flow\.outcome\.status === 'applied' \|\| flow\.outcome\.status === 'alreadyApplied'\)/)
  })

  it('links each comment toggle to its form and moves the focus into the field', () => {
    expect(tab.match(/aria-controls=\{commenting \? `gi-comment-\$\{d\.id\}` : undefined\}/g)).toHaveLength(2)
    // The field mounts hidden inside the day collapse, so the focus moves once the collapse is open.
    expect(tab).toContain('<SmoothCollapse open={commenting} fallbackFocus={commentToggleRef} onExpanded={focusCommentField}>')
    expect(tab).toContain("document.getElementById(`gi-comment-${d.id}`)?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true })")
    expect(tab).not.toContain('focusOnMount')
    expect(tab).toMatch(/if \(ideaComposerOpen\) ideaComposerRef\.current\?\.querySelector/)
  })

  it('names each radio by its label and describes it by the detail and the share', () => {
    expect(tab).toContain('aria-labelledby={`gi-opt-${d.id}-${o.id}-label`}')
    expect(tab).toMatch(/aria-describedby=\{\[detail \? `gi-opt-\$\{d\.id\}-\$\{o\.id\}-detail` : '', `gi-opt-\$\{d\.id\}-\$\{o\.id\}-pct`\]/)
  })

  it('no longer carries the retired digest, vote-col, consensus-bar or decision-option-row rules', () => {
    const files = ['02-select-and-print', '04-mobile-usability']
    for (const f of files) {
      const css = read(`src/styles/legacy/${f}.css`)
      expect(css).not.toMatch(/\.(digest-row|digest-title|digest-sub|decision-option-row|vote-col|consensus-bar)\b/)
    }
  })
})
