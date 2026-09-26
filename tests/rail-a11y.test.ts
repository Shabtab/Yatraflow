// ============ Rail announcements, names and associations (#333 A2/A5/A6/A8) ============
// Each of these states a sentence the rail used to withhold: a result list that
// arrived in silence, a "Fill" button that named no place, a slider whose value
// lived only in the markup beside it, and a vote status nothing pointed at. The
// guards below fail on the pre-fix file — that is the point of them.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  candidatesAnnouncement,
  fillLabel,
  scopeValueText,
  searchAnnouncement,
  voteStatusId,
} from '../src/lib/railA11y'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mapTabSrc = readFileSync(join(root, 'src', 'pages', 'trip', 'MapTab.tsx'), 'utf8')

describe('searchAnnouncement (A5)', () => {
  it('counts the results and names the query', () => {
    expect(searchAnnouncement('hampi', 7, 5)).toBe('7 results for hampi, showing the closest 5.')
    expect(searchAnnouncement('hampi', 3, 3)).toBe('3 results for hampi.')
  })

  it('is grammatical at one, and says so when there are none', () => {
    expect(searchAnnouncement('hampi', 1, 1)).toBe('1 result for hampi.')
    expect(searchAnnouncement('hampi', 0, 0)).toBe('No results for hampi.')
  })

  it('degrades honestly on an empty query instead of announcing an empty string', () => {
    // The search box clears its results on edit, so a zero-length query reaches
    // here legitimately — the announcement must still be a sentence.
    expect(searchAnnouncement('   ', 0, 0)).toBe('No results for that search.')
    expect(searchAnnouncement('', 2, 2)).toBe('2 results for that search.')
  })
})

describe('candidatesAnnouncement (A5) and fillLabel (A2)', () => {
  it('announces a slot\'s candidates in the slot\'s own words', () => {
    expect(candidatesAnnouncement('Lunch', 4)).toBe('4 candidates for Lunch.')
    expect(candidatesAnnouncement('Lunch', 1)).toBe('1 candidate for Lunch.')
    expect(candidatesAnnouncement('Lunch', 0)).toBe('No candidates in reach for Lunch.')
  })

  it('names the place in the action, not just the verb', () => {
    // "Fill" alone told a screen-reader user nothing about which place they were
    // about to use — the name lived in a sibling span the button does not own.
    expect(fillLabel('Hampi Ruins', 'Lunch')).toBe('Fill Lunch with Hampi Ruins')
    expect(fillLabel('Hampi Ruins', 'Lunch')).toContain('Hampi Ruins')
  })
})

describe('scopeValueText (A8) and voteStatusId (A6)', () => {
  it('states the slider value in words', () => {
    expect(scopeValueText(20)).toBe('20 km from the route')
    expect(scopeValueText(0)).toBe('0 km from the route')
  })

  it('mints a usable id for any slot key', () => {
    expect(voteStatusId('lunch')).toBe('slot-vote-lunch')
    // A key with characters that would break a selector, or split the
    // aria-describedby token list on whitespace, must come out inert.
    expect(voteStatusId('day 2:lunch/alt')).toBe('slot-vote-day-2-lunch-alt')
    expect(voteStatusId('a b')).not.toContain(' ')
    expect(voteStatusId('x"y')).not.toContain('"')
  })
})

describe('MapTab wires those sentences into the DOM', () => {
  it('A5: both result lists announce their arrival through a live region', () => {
    expect(mapTabSrc).toMatch(/searchAnnouncement\(/)
    expect(mapTabSrc).toMatch(/candidatesAnnouncement\(/)
    // a polite live region, not a static label the user has to go find
    expect(mapTabSrc).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/)
  })

  it('A2: the Fill button carries the place name', () => {
    expect(mapTabSrc).toMatch(/aria-label=\{fillLabel\(/)
  })

  it('A8: the slider states its own value and its steps', () => {
    const slider = /<input[\s\S]{0,600}?type="range"[\s\S]{0,900}?\/>/.exec(mapTabSrc)
    expect(slider, 'the scope slider is missing or reshaped').not.toBeNull()
    expect(slider![0]).toContain('aria-valuetext={scopeValueText(')
    // The step list is a plain string reference to the datalist; the association
    // is by id, so the datalist's position in the tree does not matter.
    expect(slider![0]).toMatch(/list="scope-km-ticks"/)
    expect(mapTabSrc).toMatch(/<datalist id="scope-km-ticks">\{SCOPE_KM_STEPS\.map/)
  })

  it('A6: the toggle points at the vote status element', () => {
    // The toggle only describes itself when it has a vote to route to, so the
    // attribute is a ternary — match the association, not one spelling of it.
    expect(mapTabSrc).toMatch(/aria-describedby=\{[^}]*voteStatusId\(/)
    expect(mapTabSrc).toMatch(/id=\{voteStatusId\(/)
    expect(mapTabSrc).toMatch(/className="day-slot-vote" id=\{voteStatusId\(/)
  })
})
