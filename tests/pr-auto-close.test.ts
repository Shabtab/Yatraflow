// The closing-keyword grammar that scripts/pr-auto-close.mjs applies to a PR
// body (AGENTS.md rule 12's automation). GitHub only auto-closes issues on
// merges into the DEFAULT branch, so this parser is what mirrors the tracker
// for `test` — these fixtures pin it to GitHub's keyword grammar plus this
// repo's claim spellings, so a future tweak can neither miss a real reference
// nor close a stray one.
import { describe, expect, it } from 'vitest'
import { buildComment, parseClosingIssueRefs, stripCode } from '../scripts/pr-auto-close.mjs'

describe('parseClosingIssueRefs — GitHub closing-keyword grammar', () => {
  it('binds each keyword spelling to the reference that follows it', () => {
    expect(parseClosingIssueRefs('Closes #12')).toEqual([12])
    expect(parseClosingIssueRefs('Close #12')).toEqual([12])
    expect(parseClosingIssueRefs('closed #12')).toEqual([12])
    expect(parseClosingIssueRefs('Fix #12')).toEqual([12])
    expect(parseClosingIssueRefs('Fixes #12')).toEqual([12])
    expect(parseClosingIssueRefs('fixed #12')).toEqual([12])
    expect(parseClosingIssueRefs('Resolve #12')).toEqual([12])
    expect(parseClosingIssueRefs('Resolves #12')).toEqual([12])
    expect(parseClosingIssueRefs('resolved #12')).toEqual([12])
  })

  it('accepts the colon, GH- and full-URL spellings', () => {
    expect(parseClosingIssueRefs('Closes: #3')).toEqual([3])
    expect(parseClosingIssueRefs('Resolves GH-8')).toEqual([8])
    expect(parseClosingIssueRefs('Closes https://github.com/hasnaina955/Yatraflow/issues/331')).toEqual([331])
  })

  it('consumes ref lists joined by commas, whitespace or "and"', () => {
    expect(parseClosingIssueRefs('Fixes #1, #2 and #3')).toEqual([1, 2, 3])
    expect(parseClosingIssueRefs('Closes #4 #5')).toEqual([4, 5])
    expect(parseClosingIssueRefs('Closes #1, and #2')).toEqual([1, 2])
    expect(parseClosingIssueRefs('Fixes #1 and #2.')).toEqual([1, 2])
  })

  it('dedupes repeated references', () => {
    expect(parseClosingIssueRefs('Closes #5, fixes #5')).toEqual([5])
    expect(parseClosingIssueRefs('Closes #5\nFixes #5')).toEqual([5])
    expect(parseClosingIssueRefs('Claiming #5, closes #5')).toEqual([5])
  })

  it('treats a work claim like a closing keyword (the #617 miss)', () => {
    // PR #617's body said "Claiming #607, #608, #609, #610, #611" and the
    // mirror closed nothing, because a claim is not a GitHub keyword. Claims
    // in this repo mean taken work (AGENTS.md rule 4), so a merged PR closes
    // the issues it names either way. Same trade-off as the closing grammar:
    // no negation is read, and the number must sit outside a claim's reach.
    expect(parseClosingIssueRefs('Claim #12')).toEqual([12])
    expect(parseClosingIssueRefs('Claims #12')).toEqual([12])
    expect(parseClosingIssueRefs('Claiming #607, #608, #609, #610, #611')).toEqual([607, 608, 609, 610, 611])
    expect(parseClosingIssueRefs('claimed #12')).toEqual([12])
    expect(parseClosingIssueRefs('Claiming #607, #608, #609, #610, #611 (all filed by the audit)')).toEqual([607, 608, 609, 610, 611])
    expect(parseClosingIssueRefs('not claiming #12')).toEqual([12])
    expect(parseClosingIssueRefs('Reclaim #5')).toEqual([])
    expect(parseClosingIssueRefs('See issue #44 for context')).toEqual([])
  })

  it('binds nothing without the keyword, and no keyword without the ref', () => {
    expect(parseClosingIssueRefs('See #44 for context')).toEqual([])
    expect(parseClosingIssueRefs('This fix closes the gap')).toEqual([])
    expect(parseClosingIssueRefs('This PR fixes the tests. Closes none')).toEqual([])
    expect(parseClosingIssueRefs('')).toEqual([])
    expect(parseClosingIssueRefs(undefined)).toEqual([])
  })

  it('ignores keywords inside code — fenced or inline', () => {
    expect(parseClosingIssueRefs('```\nCloses #7\n```')).toEqual([])
    expect(parseClosingIssueRefs('The comment `Closes #7` is only an example')).toEqual([])
    expect(stripCode('a `x` b')).toBe('a   b')
  })

  it('cannot read negation — "does not close #N" closes #N (the #427 surprise)', () => {
    // Not a bug being blessed: the parser mirrors GitHub's own grammar, which
    // has no negation either, and guessing wrong in THIS direction leaves a P0
    // closed while everyone believes it shipped. Written after a PR body that
    // said "**It does not close #427**, because production is still dark…"
    // closed #427 on merge (PR #443, 2026-09-25) — the bot did it twelve
    // seconds before a hand reopened it.
    expect(parseClosingIssueRefs('It does not close #427')).toEqual([427])
    expect(parseClosingIssueRefs('This does not fix #12 or resolve #13')).toEqual([12, 13])
    // The spellings that are actually inert, for contrast: `refs` is not a
    // keyword, and a bare number with no keyword before it binds nothing. Keep
    // the number OUT of a keyword's reach rather than behind a "does not".
    expect(parseClosingIssueRefs('Refs #427')).toEqual([])
    expect(parseClosingIssueRefs('Related to issue #427')).toEqual([])
  })

  it('reads a real PR body (the Wave-0 map batch)', () => {
    const body = '## Summary\n- reuse the workspace road measurement\n\nCloses #324\nCloses #326\nCloses #327\n'
    expect(parseClosingIssueRefs(body)).toEqual([324, 326, 327])
  })
})

describe('buildComment', () => {
  it('names the landing PR and merge, and says why the mirror exists', () => {
    const c = buildComment(399, '5550fae')
    expect(c).toContain('PR #399')
    expect(c).toContain('5550fae')
    expect(c).toContain('DEFAULT branch')
    expect(c).toContain('work claim')
    expect(c).toContain('Reopen')
  })
})
