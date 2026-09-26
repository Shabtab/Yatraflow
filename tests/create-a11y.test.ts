// ============ Create funnel: where a field error puts the focus ============
// Source-level checks, node env — the suite has no DOM, so this pins the markup
// contract by reading the page (the design-system ratchet reads CSS the same way).
// #379: the travellers error focused the number input, which lives inside
// `.sr-only` — focusable, and invisible. A sighted keyboard user pressing submit
// with 0 travellers lost their place, and the same message rendered a second time
// for screen readers only. Both halves are assertions here because both are
// invisible to a pure-logic test: the rule lives in markup, not in a helper.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/pages/CreateTrip.tsx', import.meta.url), 'utf8')

/** A slice of the source, guarded so a moved anchor fails loudly instead of
 *  silently matching an empty string. */
function window_(anchor: string, ahead = 0, back = 0): string {
  const at = src.indexOf(anchor)
  expect(at, `anchor not found: ${anchor}`).toBeGreaterThan(-1)
  return src.slice(at - back, at + ahead)
}

/** The whole body of a top-level function, found by matching its braces — a
 *  character window would silently drift as comments are added to the function. */
function functionBody(name: string): string {
  const at = src.indexOf(`function ${name}(`)
  expect(at, `function not found: ${name}`).toBeGreaterThan(-1)
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`unbalanced braces after ${name}`)
}

describe('#379 — the travellers error lands on the visible stepper', () => {
  const stepperAt = src.indexOf('className="ct-step"')
  const hiddenAt = src.indexOf('<Field label="Travellers">')
  const errorAt = src.indexOf('id="ct-travellers-err"')

  it('has all three anchors in source order: group, visible error, hidden input', () => {
    // The order is the fix: the error paragraph sits between the group that
    // describes itself with it and the hidden input that used to own it.
    expect(stepperAt).toBeGreaterThan(-1)
    expect(errorAt).toBeGreaterThan(stepperAt)
    expect(hiddenAt).toBeGreaterThan(errorAt)
  })

  it('registers the stepper group as the focus target, not the hidden input', () => {
    const group = src.slice(stepperAt, errorAt)
    expect(group).toContain('role="group"')
    expect(group).toContain('tabIndex={-1}')
    expect(group).toContain('fieldRefs.current.travellers')
    // `min`/`max` live on the input nobody can see, so the range travels with the label.
    expect(group).toMatch(/aria-label=\{`Party size.*CREW_MIN.*CREW_MAX/)
    expect(group).toContain('ct-travellers-err')
  })

  it('renders the message once, visibly, as a polite status', () => {
    const para = src.slice(errorAt - 60, errorAt + 140)
    expect(para).toContain('className="err-text"')
    expect(para).toContain('role="status"')
    expect(para).toContain('aria-live="polite"')
    // One element owns the id: a second copy is the double-announcement bug back.
    expect(src.split('id="ct-travellers-err"').length - 1).toBe(1)
  })

  it('keeps the hidden input as the value channel, without the error text', () => {
    const input = src.slice(hiddenAt, hiddenAt + 420)
    // Still a real input to type into...
    expect(input).toContain('type="number"')
    expect(input).toContain('clampCrew')
    // ...but it no longer renders its own error copy, and no longer takes focus.
    expect(input).not.toContain('error={errs.travellers}')
    expect(input).not.toContain('fieldRefs.current.travellers')
    expect(input).toContain('aria-describedby')
  })
})

describe('#379 — the bill reveal moves focus with it', () => {
  it('focuses the bill region it just revealed', () => {
    const fn = functionBody('printBill')
    expect(fn).toContain('setBillPrinted(true)')
    expect(fn).toContain('billRef.current?.focus()')
    // The region does not exist until that render lands.
    expect(fn).toContain('requestAnimationFrame')
  })

  it('makes the bill region a focus target', () => {
    const region = window_('className="bill-printer"', 160)
    expect(region).toContain('role="region"')
    expect(region).toContain('tabIndex={-1}')
    expect(region).toContain('ref={billRef}')
  })
})
