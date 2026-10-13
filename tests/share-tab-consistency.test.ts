// ============ P12 - the Share tab reads like the other workspace tabs ============
// The tab's four panels sit on the shared card skin, their titles read the R20
// rule, and each state is its own compact block instead of a paragraph that
// borrows the block's voice. These pins read the shipped source and the shared
// role table, so a later pass that undoes one of them fails here rather than in
// a screenshot review.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stateBlockRole } from '../src/components/page/StateBlock'

const tab = readFileSync(new URL('../src/pages/trip/ShareTab.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const baseline = JSON.parse(
  readFileSync(new URL('./page-consistency-baseline.json', import.meta.url), 'utf8'),
) as { pageFiles: Record<string, Record<string, number>> }

/** Code only - comments removed, so prose cannot satisfy an assertion. */
const code = tab.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('P12 — the panels sit on the shared card skin', () => {
  it('every panel root is a Surface, and none is a bare card div', () => {
    // Four panels: invite, danger zone, publish, snapshot.
    expect([...code.matchAll(/<Surface className="card shr-panel">/g)]).toHaveLength(4)
    expect(code).not.toMatch(/<div className="card">/)
    expect(code).toContain("import { Surface } from '../../components/page/Surface'")
  })

  it('the skin is restated as a same-element compound, so it wins in any order (R5)', () => {
    expect(css).toMatch(/\.yf-surface\.shr-panel \{ border-radius: var\(--radius\); box-shadow: var\(--shadow-card\); \}/)
  })

  it('the panels do not take their own entrance: the tab panel already owns it', () => {
    // `.tab-panel` animates on mount, so a card entrance inside it would double
    // the movement. A page or section entrance is the container's job
    // (docs/MOTION-TOKENS.md, "Page / section entrance").
    expect(css).toMatch(/^\.tab-panel \{ animation: panelIn /m)
    expect(code).not.toMatch(/enterIndex=/)
  })
})

describe('P12 — the panel titles read R20', () => {
  it('every card title carries the shared rule, and the rule is the R20 one', () => {
    const titles = [...code.matchAll(/<h3 className="shr-card-title">/g)]
    expect(titles).toHaveLength(5)
    expect(code).not.toMatch(/<h3>/)
    expect(css).toMatch(
      /\.shr-card-title \{ font-family: var\(--font-body\); font-size: 18px; font-weight: 800; line-height: 1\.3; color: var\(--text\); \}/,
    )
  })

  it('the panel names stay as the screen-reader h2s above each tab panel', () => {
    for (const name of ['Plan together', 'Share publicly', 'Keep a record']) {
      expect(code).toContain(`<h2 className="sr-only">${name}</h2>`)
    }
  })
})

describe('P12 — every state is its own compact block (R22, R23)', () => {
  it('the three publish-read states are three blocks, not one paragraph shape', () => {
    // The kept note's copy is the sentence pair the old paragraph carried, so it
    // is held as one string rather than restated inside a pattern.
    const KEPT_TITLE = [
      'Couldn’t refresh. Showing the last status that loaded.',
    ].join('')
    expect(code).toMatch(/<StateBlock kind="loading" size="compact" title="Checking whether this trip is on Explore…" \/>/)
    expect(code).toMatch(/<StateBlock kind="failed" size="compact" title="Couldn’t check if this trip is on Explore\."/)
    expect(code).toContain(`<StateBlock kind="kept" size="compact" title="${KEPT_TITLE}"`)
    // Each state is still its own branch on the verdict, and a failed read is
    // still never an empty statement.
    expect(code).toMatch(/\{publishView === 'reading' && \(/)
    expect(code).toMatch(/\{publishView === 'failed' && \(/)
    expect(code).toMatch(/\{publishView === 'kept' && \(/)
    expect(code).not.toContain('shr-read-failed')
    expect(code).not.toContain('shr-read-kept')
    expect(code).not.toContain('shr-read-loading')
  })

  it('the invite code is a write, so its two outcomes are blocks too', () => {
    expect(code).toMatch(/<StateBlock kind="failed" size="compact" title="We could not make an invite link\."/)
    expect(code).toMatch(/<StateBlock kind="loading" size="compact" title="Making your invite link…" \/>/)
    expect(code).not.toContain('shr-invite-status')
  })

  it('an empty member list says so, instead of rendering nothing', () => {
    // Nothing on screen reads as "nobody is here" only by accident; a trip with
    // no members used to leave a bare container under the heading.
    expect(code).toMatch(/<StateBlock kind="empty" size="compact" title="No one is on this trip yet\."/)
  })

  it('no block in this tab takes the full size', () => {
    expect(code).not.toMatch(/<StateBlock(?![^>]*size="compact")/)
  })

  it('the roles the tab relies on are the shared ones', () => {
    // failed interrupts, a pending read and a kept note do not, and an empty
    // state is silent. The tab writes none of them by hand.
    expect(stateBlockRole('failed')).toBe('alert')
    expect(stateBlockRole('loading')).toBe('status')
    expect(stateBlockRole('kept')).toBe('status')
    expect(stateBlockRole('empty')).toBeUndefined()
    expect(code).not.toMatch(/shr-state[^"]*"[^>]*role=/)
  })

  it('a failed read and a kept read still offer Try again, and say Trying…', () => {
    expect(code.match(/\{publishRetrying \? 'Trying…' : 'Try again'\}/g)?.length ?? 0).toBe(2)
  })
})

describe('P12 — the motion is on the tokens, with the opt-out', () => {
  it('a state block that appears inside a panel keeps the entrance it had', () => {
    expect(css).toMatch(/\.shr-state \{ animation: errIn var\(--motion-med\) var\(--ease-out\); \}/)
  })

  it('every new animated rule opts out under reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.shr-state \{ animation: none; \} \}/)
    // The section switch had a transition and no opt-out, so a reader who asked
    // for less motion still got a colour fade on hover and on the active tab.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.share-tab \{ transition: none; \} \}/)
  })

  it('the new section names no raw duration', () => {
    // Comments are stripped, so a note that names a duration cannot trip the
    // check - the same rule `state-block.test.ts` scans under.
    const section = css.slice(css.indexOf('/* ===== P12: Share tab'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(section).not.toMatch(/\d+ms/)
  })
})

describe('P12 — the inline styles stay at zero', () => {
  it('the file carries no inline style attribute, and the baseline says none', () => {
    expect([...code.matchAll(/style=\{\{/g)]).toHaveLength(0)
    expect(baseline.pageFiles['src/pages/trip/ShareTab.tsx'].inlineStyle).toBe(0)
  })
})
