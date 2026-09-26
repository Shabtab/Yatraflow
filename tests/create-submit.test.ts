// ============ Create funnel: unpicked stop text ============
// Pure rule, node env. Pins the honesty gap found by the launch audit (#375):
// the add-stop fields are autocompletes, so text that was typed but never picked
// lived only in the input's own state and the form dropped it at submit without
// a word — the trip simply came out missing a place the user had typed.
import { describe, it, expect } from 'vitest'
import { unpickedStopErrors, unpickedStopMessage } from '../src/lib/createSubmit'

/** The shape the form passes: both field values, plus whether the return-leg
 *  field is even on screen. */
function errs(dest: string, ret = '', returnOpen = false) {
  return unpickedStopErrors({ dest, ret, returnOpen })
}

describe('unpickedStopErrors', () => {
  it('reports text left in the outbound field instead of discarding it', () => {
    const out = errs('Munnar')
    expect(out.destinations).toBeTruthy()
    // The message has to name what is about to be lost, or the user cannot tell
    // which of their two typed places it is talking about.
    expect(out.destinations).toContain('Munnar')
  })

  it('reports text left in the return field only while that field is open', () => {
    expect(errs('', 'Guruvayur', true).returnStops).toContain('Guruvayur')
    // With no custom return leg the field is not rendered, so its leftover text
    // is neither shown nor thrown away — and must not block the save.
    expect(errs('', 'Guruvayur', false).returnStops).toBeUndefined()
  })

  it('reports both fields at once', () => {
    const out = errs('Munnar', 'Guruvayur', true)
    expect(out.destinations).toContain('Munnar')
    expect(out.returnStops).toContain('Guruvayur')
  })

  it('treats whitespace as an empty field, not as a stop', () => {
    expect(errs('   ')).toEqual({})
    expect(errs('', '\t\n ', true)).toEqual({})
    expect(errs('')).toEqual({})
  })

  it('never silently accepts non-empty text (the rule the issue exists for)', () => {
    for (const text of ['Munnar', ' a ', 'Munnar, Kerala', 'Ünïcödé place', 'x'.repeat(200)]) {
      expect(unpickedStopErrors({ dest: text, ret: '', returnOpen: false }).destinations).toBeTruthy()
    }
  })

  it('shortens a long place name but still quotes its start', () => {
    const long = 'Munnar ' + 'and the whole long tail of a place name '.repeat(4)
    const out = errs(long)
    expect(out.destinations).toContain('Munnar')
    expect(out.destinations).toContain('…')
    // A field error is not the place for a paragraph: the quoted text is bounded.
    expect(out.destinations!.length).toBeLessThan(180)
  })

  it('collapses newlines so the quoted text stays one line', () => {
    expect(errs('Munnar\n\nKerala').destinations).toContain('Munnar Kerala')
  })

  it('points at both ways out — a suggestion, or no map pin at all', () => {
    const msg = unpickedStopMessage('Munnar')
    expect(msg).toMatch(/suggestions/i)
    // The escape hatch is real UI: the block must not trap text it refuses to drop.
    expect(msg).toMatch(/without one/i)
  })
})
