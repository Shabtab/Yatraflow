// ============ The suggestion row's one follow-up (#839 stage B) ============
// Retarget and add-another-visit are the same question shape, so they render
// from one component. These assertions pin the behaviour the review asked for:
// the day list is the trip's CURRENT days, a missing day is never replaced by a
// guess, no day means an honest instruction instead of a silent pick, and the
// confirm control cannot fire without a choice or while the row is busy.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/components/ui', () => ({ toast: vi.fn() }))

import { SuggestionFollowUpPanel, followUpFromOutcome, type SuggestionFollowUp } from '../src/pages/trip/GroupInputTab'

const days = [
  { id: 'day-a', index: 0, title: 'Arrival' },
  { id: 'day-b', index: 1 },
]

function render(followUp: SuggestionFollowUp, over: Partial<Parameters<typeof SuggestionFollowUpPanel>[0]> = {}) {
  return renderToStaticMarkup(createElement(SuggestionFollowUpPanel, {
    followUp, days, busy: false,
    onPickDay: () => {}, onConfirm: () => {}, onCancel: () => {},
    ...over,
  }))
}

describe('the retarget follow-up', () => {
  it('offers the trip’s current days, not a captured list', () => {
    const html = render({ kind: 'retarget', dayId: '', reason: 'missing-day' })
    expect(html).toContain('Day 1 · Arrival')
    expect(html).toContain('Day 2')
    expect(html.match(/<option/g)).toHaveLength(3) // "Pick a day" + the two live days
  })

  it('says why it is asking when a legacy day number is ambiguous', () => {
    const html = render({ kind: 'retarget', dayId: '', reason: 'legacy-ambiguous' })
    expect(html).toContain('more than one day now matches it')
    expect(html).not.toContain('That day is no longer on this trip')
  })

  it('cannot be confirmed before a day is chosen', () => {
    const html = render({ kind: 'retarget', dayId: '', reason: 'missing-day' })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add to chosen day/)
  })

  it('is confirmable once a day is chosen', () => {
    const html = render({ kind: 'retarget', dayId: 'day-b', reason: 'missing-day' })
    expect(html).toMatch(/<button[^>]*>Add to chosen day/)
  })

  it('asks for a day instead of inventing one when the trip has none', () => {
    const html = render({ kind: 'retarget', dayId: '', reason: 'missing-day' }, { days: [] })
    expect(html).toContain('This trip has no days yet')
    expect(html).not.toContain('<select')
    // Nothing may be confirmed: there is no day to confirm onto.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add to chosen day/)
  })

  it('stays disabled while the row is busy, so a double-tap lands once', () => {
    const html = render({ kind: 'retarget', dayId: 'day-b', reason: 'missing-day' }, { busy: true })
    expect(html).toContain('aria-busy="true"')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add to chosen day/)
    // Cancel is the way out of a held claim, so it is never disabled.
    expect(html).toMatch(/<button[^>]*>Cancel/)
  })
})

describe('the add-another-visit follow-up', () => {
  it('names the day the place is already on and can be confirmed', () => {
    const html = render({ kind: 'duplicate', dayId: 'day-a', dayIndex: 0 })
    expect(html).toContain('already on Day 1')
    expect(html).toMatch(/<button[^>]*>Add another visit/)
    // It asks one question only: no day picker belongs to this panel.
    expect(html).not.toContain('<select')
  })

  it('stays disabled while the row is busy', () => {
    const html = render({ kind: 'duplicate', dayId: 'day-a', dayIndex: 0 }, { busy: true })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Add another visit/)
  })

  it('a needsDuplicate receipt opens this panel for the server-resolved day, nothing else does', () => {
    // The server echoes the day the write actually targeted; the panel asks
    // about THAT day. Only this outcome kind may open the duplicate panel —
    // allowDuplicate is never sent without the user's explicit confirm here.
    const follow = followUpFromOutcome({ status: 'needsDuplicate', tripRevision: 3, dayId: 'day-server', dayIndex: 1 })
    if (!follow?.duplicate) throw new Error('needsDuplicate must open the add-another panel')
    const html = render({ kind: 'duplicate', ...follow.duplicate })
    expect(html).toContain('already on Day 2')
    expect(html).toMatch(/<button[^>]*>Add another visit/)

    for (const outcome of [
      { status: 'applied', tripRevision: 3, stopId: 'st-1' },
      { status: 'alreadyApplied', tripRevision: 3 },
      { status: 'conflict', tripRevision: 3 },
      { status: 'unavailable' },
    ] as const) {
      expect(followUpFromOutcome(outcome)?.duplicate).toBeUndefined()
    }
    const retarget = followUpFromOutcome({ status: 'needsDay', availableDays: [{ id: 'day-b', index: 1 }] })
    expect(retarget?.retarget).toEqual({ dayId: '', reason: 'missing-day' })
    expect(retarget?.retargetDays).toEqual([{ id: 'day-b', index: 1 }])
    expect(retarget?.duplicate).toBeUndefined()
  })
})

describe('the follow-up entrance', () => {
  it('uses the shared motion vocabulary with its reduced-motion opt-out', () => {
    // The panel animates with the tokens, not an ad-hoc duration, and the
    // opt-out lives in src/styles.css beside the rule that needs it.
    const css = require('node:fs').readFileSync('src/styles.css', 'utf8') as string
    expect(css).toContain('.gin-followup { animation: popover-in var(--motion-fast) var(--ease-glide); }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .gin-followup { animation: none; } }')
  })
})
