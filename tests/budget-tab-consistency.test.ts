// ============ P12 - the Budget tab reads like the other workspace tabs ============
// The tab's five panels sit on the shared card skin, their titles read the R20
// rule, and each read state is its own compact block. The money is untouched:
// the pins at the end read the figure expressions, so a pass that rounds,
// merges or rewords a number fails here rather than in a screenshot review.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stateBlockRole } from '../src/components/page/StateBlock'

const tab = readFileSync(new URL('../src/pages/trip/BudgetTab.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const baseline = JSON.parse(
  readFileSync(new URL('./page-consistency-baseline.json', import.meta.url), 'utf8'),
) as { pageFiles: Record<string, Record<string, number>> }

/** Code only - comments removed, so prose cannot satisfy an assertion. */
const code = tab.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('P12 — the panels sit on the shared card skin', () => {
  it('every panel root is a Surface, and none is a bare card div', () => {
    // Five panels: cost per day, where it goes, expense lines, who paid, and
    // essential vs optional (the last one carries its own gap class).
    expect([...code.matchAll(/<Surface className=/g)]).toHaveLength(5)
    expect(code).not.toMatch(/<div className="card/)
    expect(code).toContain("import { Surface } from '../../components/page/Surface'")
  })

  it('the skin is restated as a same-element compound, so it wins in any order (R5)', () => {
    expect(css).toMatch(/\.yf-surface\.bud-panel \{ border-radius: var\(--radius\); box-shadow: var\(--shadow-card\); \}/)
  })

  it('the step between the right-hand cards is a class, and its condition stays in the markup', () => {
    expect(css).toMatch(/\.bud-panel-gap \{ margin-top: 14px; \}/)
    expect(code).toContain("${trip.travellers >= 2 ? ' bud-panel-gap' : ''}")
  })

  it('the panels take no entrance of their own: the tab panel already owns one', () => {
    // `.tab-panel` animates on mount, so a card entrance inside it would double
    // the movement (docs/MOTION-TOKENS.md, "Page / section entrance").
    expect(css).toMatch(/^\.tab-panel \{ animation: panelIn /m)
    expect(code).not.toMatch(/enterIndex=/)
  })
})

describe('P12 — the panel titles read R20', () => {
  it('every card title carries the shared rule, and the rule is the R20 one', () => {
    expect([...code.matchAll(/<h3 className="bud-card-title">/g)]).toHaveLength(5)
    expect(code).not.toMatch(/<h3>/)
    expect(css).toMatch(
      /\.bud-card-title \{ font-family: var\(--font-body\); font-size: 18px; font-weight: 800; line-height: 1\.3; color: var\(--text\); \}/,
    )
  })
})

describe('P12 — each read state is its own compact block (R22, R23)', () => {
  it('the ledger has a failed room, a loading room and an empty room', () => {
    expect(code).toMatch(/<StateBlock kind="failed" size="compact" title=\{copy\.title\} body=\{copy\.body\}/)
    expect(code).toMatch(/<StateBlock kind="loading" size="compact" title="Loading expenses…" \/>/)
    expect(code).toMatch(/<StateBlock kind="empty" size="compact" title="No expense lines yet"/)
  })

  it('the crew card keeps the ledger one status, in its own words', () => {
    expect(code).toMatch(/emptyCopyFor\('failed', 'expense lines', retryExpenses\)/)
    expect(code).toMatch(/<StateBlock kind="loading" size="compact" title="Loading expense lines…" \/>/)
  })

  it('the empty copy is reachable only after a read that succeeded', () => {
    // The order IS the bug that #383 fixed: the failure branch has to come
    // first, then loading, and only then the friendly empty line.
    const failed = code.indexOf("emptyCopyFor('failed', 'expenses', retryExpenses)")
    const loading = code.indexOf('Loading expenses…')
    const empty = code.indexOf('No expense lines yet')
    expect(failed).toBeGreaterThan(-1)
    expect(failed, 'the failure branch precedes the loading state').toBeLessThan(loading)
    expect(loading, 'the loading state precedes the empty copy').toBeLessThan(empty)
  })

  it('the tab renders no ad-hoc loading line and no full-size block', () => {
    expect(code).not.toContain('loading-block')
    expect(code).not.toContain('<EmptyState')
    expect(code).not.toMatch(/<StateBlock(?![^>]*size="compact")/)
  })

  it('the roles are the shared ones, and the tab writes none of them by hand', () => {
    expect(stateBlockRole('failed')).toBe('alert')
    expect(stateBlockRole('loading')).toBe('status')
    expect(stateBlockRole('empty')).toBeUndefined()
    expect(code).not.toMatch(/bud-state[^"]*"[^>]*role=/)
  })

  it('a failed read still offers Try again, and it re-issues the read', () => {
    expect(code.match(/onClick=\{retryExpenses\}>Try again<\/button>/g) ?? []).toHaveLength(2)
    expect(code).toMatch(/const retryExpenses = \(\) => \{ void resumeSync\(\) \}/)
  })
})

describe('P12 — the motion is on the tokens, with the opt-out', () => {
  it('a state block that appears inside a panel keeps the entrance it had', () => {
    expect(css).toMatch(/\.bud-state \{ animation: errIn var\(--motion-med\) var\(--ease-out\); \}/)
  })

  it('the state entrance and the bar widths both opt out under reduced motion', () => {
    // The bars glide when a read lands and never had an opt-out, so a reader
    // who asked for less motion watched them travel anyway.
    const optOut = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .bud-state'))
    expect(optOut).toContain('.bud-state { animation: none; }')
    expect(optOut).toContain('.budget-bar-fill, .daybar-fill { transition: none; }')
    // The opt-out adds nothing else: the durations the bars already use stay.
    expect(css).toMatch(/--motion-med: 180ms; --motion-slow: 240ms;/)
  })

  it('the new section names no raw duration', () => {
    // Comments are stripped, so a note that names a duration cannot trip the
    // check - the rule the other page passes scan under.
    const section = css.slice(css.indexOf('/* ===== P12: Budget tab')).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(section).not.toMatch(/\d+ms/)
  })
})

describe('P12 — the money did not move', () => {
  it('every figure still comes from the same expression', () => {
    for (const figure of [
      'value={formatInr(totals.costPerPersonInr)}',
      'value={formatInr(totals.costPerDayInr)}',
      'value={`${pctUsed}%`}',
      'remaining < 0 ? fmtNeg(remaining) : formatInr(remaining)',
      '{perPersonDeltaPct > 0 ? \'+\' : \'−\'}{Math.abs(perPersonDeltaPct)}%',
      '<b>{formatInr(-remaining)} over</b>',
      '<b>{formatInr(remaining)} under</b>',
      'formatInr(totals.essentialInr)}</b>',
      'formatInr(totals.optionalInr)}</b>',
      'Fair share is {formatInr(fairShare)} {sharePer}',
      '{formatInr(openPayableTotal)}</b>',
    ]) {
      expect(code, figure).toContain(figure)
    }
  })

  it('the caveats that make a figure honest are still on screen', () => {
    for (const caveat of [
      'All figures are estimates in INR.',
      'Amounts are group totals unless marked per person.',
      'The estimates above are your planning figure, not a debt.',
      'of the estimate',
      'trip over · the whole lump, not a daily rate',
    ]) {
      expect(code, caveat).toContain(caveat)
    }
  })

  it('the maths and its inputs are untouched', () => {
    // The engine and the settlement lib own every figure; the tab only reads.
    expect(code).toContain("from '../../lib/engine'")
    expect(code).toContain("from '../../lib/settlement'")
    expect(code).toContain('const pacing = safeToSpendPerDay(trip, totals.totalCostInr)')
    expect(code).toContain('const balances = computeBalances(members, trip.expenses, trip.travellers, userById)')
  })
})

describe('P12 — the inline styles are the ten data-driven ones', () => {
  it('no static declaration is left inline, and the baseline agrees', () => {
    // The first property of each survivor. The values themselves are template
    // literals full of braces, so the property name is what can be read here.
    const properties = [...code.matchAll(/style=\{\{\s*([a-zA-Z-]+)\s*:/g)].map(m => m[1])
    expect(properties).toHaveLength(10)
    // Each survivor reads the trip: a width, a position, or a category colour.
    for (const property of properties) {
      expect(['width', 'left', 'background', 'color'], property).toContain(property)
    }
    expect(baseline.pageFiles['src/pages/trip/BudgetTab.tsx'].inlineStyle).toBe(10)
  })
})
