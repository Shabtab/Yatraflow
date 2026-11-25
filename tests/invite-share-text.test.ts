// @vitest-environment node
// The pre-filled invite message. Pure text, so every template and every
// optional fact is pinned here instead of being eyeballed in the Share tab.
import { describe, expect, it } from 'vitest'
import { tripInviteMessage, inviteFactsLine, type InviteShareFacts } from '../src/lib/inviteShareText'

const base: InviteShareFacts = {
  title: 'Goa run',
  days: 4,
  stops: 9,
  perPersonInr: 8450,
  url: 'https://app.test/join/GOA-K7QF',
  code: 'GOA-K7QF',
  role: 'editor',
}

describe('the facts line prints only real numbers', () => {
  it('lists days, stops and the per-person estimate in reading order', () => {
    expect(inviteFactsLine({ days: 4, stops: 9, perPersonInr: 8450 }))
      .toEqual(['4 days', '9 stops', '~₹8,450/person est.'])
  })

  it('uses the singular for one day and one stop', () => {
    expect(inviteFactsLine({ days: 1, stops: 1, perPersonInr: 0 })).toEqual(['1 day', '1 stop'])
  })

  it('leaves out every zero, negative and non-finite value', () => {
    expect(inviteFactsLine({ days: 0, stops: 0, perPersonInr: 0 })).toEqual([])
    expect(inviteFactsLine({ days: -2, stops: -1, perPersonInr: Number.NaN })).toEqual([])
    expect(inviteFactsLine({ days: Number.POSITIVE_INFINITY, stops: 3, perPersonInr: 0 })).toEqual(['3 stops'])
  })
})

describe('an editor invite asks for the decisions', () => {
  const message = tripInviteMessage(base)

  it('names the plan, its size, the link and the join code', () => {
    expect(message).toContain('Moving our Goa run plan out of chat chaos')
    expect(message).toContain('4 days · 9 stops · ~₹8,450/person est.')
    expect(message).toContain(base.url)
    expect(message).toContain('(Join code if needed: GOA-K7QF)')
  })

  it('frames the reason: stops and budget, out of chat', () => {
    expect(message).toContain('so we actually agree on stops and budget')
    expect(message).toContain('Open the plan, vote on the open decisions, or drop your own stops here:')
  })
})

describe('a viewer invite never promises a vote', () => {
  const message = tripInviteMessage({ ...base, role: 'viewer' })

  it('reads as a day-by-day summary plus the link', () => {
    expect(message).toBe('Here\'s our live day-by-day plan for Goa run (4 days, 9 stops, ~₹8,450/person est.):\nhttps://app.test/join/GOA-K7QF')
  })

  it('drops the join code line and the vote words', () => {
    expect(message).not.toMatch(/vote/i)
    expect(message).not.toContain('Join code')
  })
})

describe('an unconfirmed role promises only what both roles can do', () => {
  it.each([null])('a %s role makes no voting claim', role => {
    const message = tripInviteMessage({ ...base, role })
    expect(message).not.toMatch(/vote/i)
    expect(message).toContain(base.url)
    expect(message).toContain('Open the plan here:')
  })
})

describe('a brand-new trip prints no empty facts', () => {
  const empty: InviteShareFacts = { title: '', days: 0, stops: 0, perPersonInr: 0, url: 'https://app.test/join/NEW-CODE', code: 'NEW-CODE', role: 'editor' }

  it('has no zero stops, no zero budget and no blank title', () => {
    const message = tripInviteMessage(empty)
    expect(message).not.toContain('0 stops')
    expect(message).not.toContain('₹0')
    expect(message).not.toContain('  ')
    expect(message).toContain('Moving our trip plan out of chat chaos')
    expect(message).toContain(empty.url)
  })

  it('keeps the link even when the code is unknown', () => {
    const message = tripInviteMessage({ ...empty, code: '' })
    expect(message).toContain(empty.url)
    expect(message).not.toContain('Join code')
  })
})
