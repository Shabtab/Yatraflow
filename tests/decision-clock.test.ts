// Decision closing time: pure helpers (node env, no DOM).
import { describe, expect, it } from 'vitest'
import {
  closingLabel, formatSpan, hasClosingTime, isTie, isVoteClosed, isVoteOpen, leadingOptions, tallyVotes, voteOutcome,
} from '../src/lib/decisionClock'
import type { DecisionOption } from '../src/data/types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = 1_800_000_000_000

const opt = (id: string): DecisionOption => ({ id, label: id.toUpperCase() })
const decision = (votes: Record<string, string>, ids = ['a', 'b', 'c']) => ({ options: ids.map(opt), votesByUserId: votes })

describe('hasClosingTime', () => {
  it('accepts a positive finite number only', () => {
    expect(hasClosingTime({ closesAt: NOW })).toBe(true)
    expect(hasClosingTime({})).toBe(false)
    expect(hasClosingTime({ closesAt: 0 })).toBe(false)
    expect(hasClosingTime({ closesAt: -5 })).toBe(false)
    expect(hasClosingTime({ closesAt: Number.NaN })).toBe(false)
    expect(hasClosingTime({ closesAt: Number.POSITIVE_INFINITY })).toBe(false)
  })
})

describe('isVoteClosed', () => {
  it('is false with no closing time, whatever the clock says', () => {
    expect(isVoteClosed({}, NOW)).toBe(false)
    expect(isVoteClosed({}, Number.MAX_SAFE_INTEGER)).toBe(false)
  })
  it('is false before the closing time', () => {
    expect(isVoteClosed({ closesAt: NOW }, NOW - 1)).toBe(false)
  })
  it('is true at the closing time, like the server (closes_at <= now)', () => {
    expect(isVoteClosed({ closesAt: NOW }, NOW)).toBe(true)
  })
  it('is true after the closing time', () => {
    expect(isVoteClosed({ closesAt: NOW }, NOW + 1)).toBe(true)
  })
})

describe('isVoteOpen', () => {
  it('needs an open decision and a closing time that has not passed', () => {
    expect(isVoteOpen({ status: 'open' }, NOW)).toBe(true)
    expect(isVoteOpen({ status: 'open', closesAt: NOW + 1 }, NOW)).toBe(true)
    expect(isVoteOpen({ status: 'open', closesAt: NOW }, NOW)).toBe(false)
    expect(isVoteOpen({ status: 'resolved' }, NOW)).toBe(false)
    expect(isVoteOpen({ status: 'resolved', closesAt: NOW + HOUR }, NOW)).toBe(false)
  })
})

describe('formatSpan', () => {
  it('reads in minutes, hours and days', () => {
    expect(formatSpan(0)).toBe('less than 1 min')
    expect(formatSpan(59_999)).toBe('less than 1 min')
    expect(formatSpan(MIN)).toBe('1 min')
    expect(formatSpan(42 * MIN + 30_000)).toBe('42 min')
    expect(formatSpan(HOUR)).toBe('1 h')
    expect(formatSpan(2 * HOUR + 5 * MIN)).toBe('2 h 5 min')
    expect(formatSpan(DAY)).toBe('1 d')
    expect(formatSpan(3 * DAY + 4 * HOUR + 30 * MIN)).toBe('3 d 4 h')
  })
  it('never reads a negative span', () => {
    expect(formatSpan(-5 * MIN)).toBe('less than 1 min')
  })
})

describe('closingLabel', () => {
  it('is null with no closing time', () => {
    expect(closingLabel({ status: 'open' }, NOW)).toBeNull()
  })
  it('is null once the decision is resolved', () => {
    expect(closingLabel({ status: 'resolved', closesAt: NOW + HOUR }, NOW)).toBeNull()
    expect(closingLabel({ status: 'resolved', closesAt: NOW - HOUR }, NOW)).toBeNull()
  })
  it('counts down while the vote is open', () => {
    expect(closingLabel({ status: 'open', closesAt: NOW + 2 * HOUR + 5 * MIN }, NOW)).toBe('Voting closes in 2 h 5 min')
    expect(closingLabel({ status: 'open', closesAt: NOW + 10_000 }, NOW)).toBe('Voting closes in less than 1 min')
  })
  it('says how long ago the vote closed', () => {
    expect(closingLabel({ status: 'open', closesAt: NOW }, NOW)).toBe('Voting closed just now')
    expect(closingLabel({ status: 'open', closesAt: NOW - 3 * HOUR }, NOW)).toBe('Voting closed 3 h ago')
    expect(closingLabel({ status: 'open', closesAt: NOW - 2 * DAY - HOUR }, NOW)).toBe('Voting closed 2 d 1 h ago')
  })
})

describe('tallyVotes', () => {
  it('counts one ballot per member and lists every option', () => {
    const { counts, total } = tallyVotes(decision({ u1: 'a', u2: 'a', u3: 'b' }))
    expect(counts).toEqual({ a: 2, b: 1, c: 0 })
    expect(total).toBe(3)
  })
  it('ignores a ballot for an option that is not on the decision', () => {
    const { counts, total } = tallyVotes(decision({ u1: 'a', u2: 'ghost', u3: 'toString' }))
    expect(counts).toEqual({ a: 1, b: 0, c: 0 })
    expect(total).toBe(1)
  })
  it('returns zero for a decision nobody voted on', () => {
    expect(tallyVotes(decision({})).total).toBe(0)
  })
})

describe('leadingOptions, isTie and voteOutcome', () => {
  it('names no leader without votes', () => {
    const d = decision({})
    expect(leadingOptions(d)).toEqual([])
    expect(isTie(d)).toBe(false)
    expect(voteOutcome(d)).toEqual({ kind: 'noVotes' })
  })
  it('names one winner', () => {
    const d = decision({ u1: 'b', u2: 'b', u3: 'a' })
    expect(leadingOptions(d).map(o => o.id)).toEqual(['b'])
    expect(isTie(d)).toBe(false)
    expect(voteOutcome(d)).toEqual({ kind: 'winner', option: opt('b'), votes: 2 })
  })
  it('flags a tie and keeps the decision order', () => {
    const d = decision({ u1: 'c', u2: 'a' })
    expect(leadingOptions(d).map(o => o.id)).toEqual(['a', 'c'])
    expect(isTie(d)).toBe(true)
    expect(voteOutcome(d)).toEqual({ kind: 'tie', options: [opt('a'), opt('c')], votes: 1 })
  })
  it('does not count a tie at zero as a tie', () => {
    expect(isTie(decision({ u1: 'ghost' }))).toBe(false)
  })
  it('a three-way tie lists all three', () => {
    expect(leadingOptions(decision({ u1: 'a', u2: 'b', u3: 'c' }))).toHaveLength(3)
  })
  it('a one-vote lead is not a tie', () => {
    expect(isTie(decision({ u1: 'a', u2: 'a', u3: 'b' }))).toBe(false)
  })
})
