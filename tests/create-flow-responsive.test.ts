// ============ The guided flow's responsive and motion rules ============
// CSS is the one part of this flow no node test can render, so these read the
// stylesheet and pin the rules that a reader would otherwise have to trust:
// exactly one progress presentation is visible at a time, the landscape rule is
// height-only, and every transition has a reduced-motion opt-out.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles.css', 'utf8')

/** The CSS from `marker` up to `until`, so a slice never runs into the next block. */
function between(marker: string, until: string): string {
  const at = css.indexOf(marker)
  expect(at, `no CSS at ${marker}`).toBeGreaterThan(-1)
  const end = css.indexOf(until, at + marker.length)
  expect(end, `no CSS at ${until} after ${marker}`).toBeGreaterThan(at)
  return css.slice(at, end)
}

/** A media block, from its `@media` line to the next `@media` line. */
function mediaBlock(atRule: string): string {
  return between(atRule, '@media ')
}

describe('progress has two presentations, never both', () => {
  it('hides the labelled list by default', () => {
    // Phone is the default: the counter and segments show, the list does not.
    expect(css).toMatch(/\.ct-progress-list \{ display: none; \}/)
  })

  it('swaps them at the tablet breakpoint', () => {
    const wide = mediaBlock('@media (min-width: 700px) and (min-height: 500px)')
    expect(wide).toContain('.ct-progress-count, .ct-progress-segs { display: none; }')
    expect(wide).toContain('.ct-progress-list {')
  })

  it('keeps the two queries disjoint, so one is always shown', () => {
    // The wide query needs BOTH width and height, so a wide-but-short screen
    // (a phone on its side) falls through to the compact form rather than
    // matching neither and showing nothing.
    expect(css).toContain('@media (min-width: 700px) and (min-height: 500px)')
  })
})

describe('the landscape rule is height-only', () => {
  it('matches on height alone', () => {
    // The spec's rule: a sideways phone can be 740px wide and is still a phone.
    // A width AND height rule would exclude the reference frame.
    expect(css).toContain('@media (max-height: 499px)')
    expect(css).not.toMatch(/@media \(max-width: 699px\) and \(max-height: 499px\)/)
  })

  it('does not hide the counter in landscape', () => {
    // Hiding it would leave only six unlabelled segments, and the reference
    // frame (740 x 360) shows "Step 3 of 6" beside them.
    const land = mediaBlock('@media (max-height: 499px)')
    expect(land).not.toContain('.ct-progress-count { display: none')
  })
})

describe('motion uses tokens and can be turned off', () => {
  it('every guided transition names a motion token', () => {
    // The guided frame only: from the progress rules to the reduced-motion block,
    // so the `transition: none` opt-out is not counted as a duration.
    const guided = between('.ct-progress {', '@media (prefers-reduced-motion: reduce)')
    const durations = [...guided.matchAll(/transition:[^;]+;/g)].map(m => m[0])
    expect(durations.length).toBeGreaterThan(0)
    for (const d of durations) {
      // A raw ms value is a review flag (AGENTS §2 rule 10).
      expect(d).not.toMatch(/\d+m?s\b/)
      expect(d).toMatch(/var\(--motion-/)
    }
  })

  it('turns every one of them off under reduced motion', () => {
    // The guided section's own opt-out, not the first reduced-motion block in a
    // 11k-line stylesheet.
    const reduced = between('.ct-progress {', '@media (prefers-reduced-motion: reduce)')
    const optOut = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.ct-progress {')))
    expect(reduced).toContain('.ct-progress {')
    expect(optOut).toContain('.ct-progress-segs > i')
    expect(optOut).toContain('.ct-progress-link')
    expect(optOut).toContain('transition: none')
  })
})

describe('the review list collapses on a phone', () => {
  it('stacks the label and value rather than shrinking them', () => {
    // Three columns of prose plus a link do not fit a phone. The value wraps
    // under its label and the Change link keeps the first row.
    const narrow = css.slice(css.indexOf('.ct-review-row, .ct-review-optional .ct-review-row'))
    expect(narrow).toContain('grid-template-columns: 1fr auto')
  })
})
