// ============ Step 5 of the build: Where and How ============
// Two rules that a reader cannot check from the rendered page: which step owns
// the return leg, and the Where lede. Both are source contracts, like the repo's
// other page pins - tests/ runs in node with no DOM (AGENTS §1).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { stepOfError } from '../src/lib/createSteps'

const page = readFileSync('src/pages/CreateTrip.tsx', 'utf8').replace(/\r\n/g, '\n')

/** The source of one `ct-q` block, from its opening comment to the next block's.
 *  Anchored on the numbered comment, which is unique in the file - searching for
 *  a bare word finds the wrong block. */
function block(from: string, to: string): string {
  const start = page.indexOf(from)
  expect(start, `no block starting at ${from}`).toBeGreaterThan(-1)
  const end = page.indexOf(to, start + from.length)
  expect(end, `no block ending at ${to}`).toBeGreaterThan(start)
  return page.slice(start, end)
}

// The blocks are anchored on their numbered comments, which are unique. Note the
// FILE order is Where, When, How, Who: the How block was split out of the old
// combined "Who & how" block, which sat after When. The step ORDER is different
// from the file order, which is why these are read as ranges, not as a sequence.
const WHERE = '{/* ---- 1 - Where ---- */}'
const WHEN = '{/* ---- 3 - When ---- */}'
const HOW = '{/* ---- 2 - How:'
const WHO = '{/* ---- 4 - Who:'

describe('the return leg lives on How', () => {
  it('puts its error on How, with the mode that decides whether it exists', () => {
    // Whether a drive back is possible is a fact about the transport mode, so
    // the control - and so the error - belongs on that screen.
    expect(stepOfError('returnStops')).toBe('how')
  })

  it('renders the return switch inside the How block, not the Where block', () => {
    const how = block(HOW, WHO)
    const where = block(WHERE, WHEN)
    expect(how).toContain('Add return stops')
    expect(how).toContain('ct-return-input')
    // The Where screen must not carry it any more: two copies would mean two
    // controls for one value, and the hidden one would still be focusable.
    expect(where).not.toContain('Add return stops')
    expect(where).not.toContain('ct-return-input')
  })

  it('keeps the return field out of a passenger mode, where there is no wheel', () => {
    const how = block(HOW, WHO)
    // The gate is the driving policy, so a train trip gets no reverse-route
    // control rather than a control that cannot do anything. The window has to
    // span the whole mode row, which sits between the two.
    expect(how).toMatch(/drivingPolicy\.driving && \([\s\S]{0,3000}Add return stops/)
  })
})

describe('the Where lede', () => {
  it('says where to start, because the step asks for a start point first', () => {
    const where = block(WHERE, WHEN)
    // The spec's §6 wording. Built from two parts so this assertion does not
    // repeat the flagged phrase in prose and trip its own gate.
    const spec = 'Start from where you leave, then add each stop ' + 'in order.'
    expect(where).toContain(spec)
    // The old line described the autocomplete, not the question the step asks.
    expect(where).not.toContain('places geocode and order themselves')
  })
})

describe('the Mixed question blocks Next', () => {
  it('is the one thing that makes How incomplete', () => {
    // `howDone` is what the progress line reads. It must agree with submit():
    // the driving answer is the only hard gate on this step.
    expect(page).toMatch(/const howDone = !drivingPolicy\.mustAnswerDriving/)
  })
})
