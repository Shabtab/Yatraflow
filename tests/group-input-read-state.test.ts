// ============ #704 — a failed group read is never an empty group ============
//
// The bug this pins: Group input printed "Nothing waiting on the group" when
// the suggestions or decisions read had failed. A failed hydrate leaves both
// arrays empty, so the empty copy showed over a dropped connection. The fix
// reads each slice's verdict through `sliceState`, then branches failed,
// reading, ready, in the order BudgetTab uses. The branch order is the whole
// fix and lives in the render, so this guard reads the source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// Comments name the copy under test, and a source guard reads prose as readily
// as code. Strip them, so a comment can never satisfy or break an order check.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const src = stripComments(read('../src/pages/trip/GroupInputTab.tsx'))
const component = src.slice(src.indexOf('export function GroupInputTab'))

describe('#704 — Group input reads its verdicts before it renders', () => {
  it('reads the suggestions, decisions and activity slices through sliceState', () => {
    expect(src).toMatch(/import \{[^}]*\bsliceState\b[^}]*\} from '\.\.\/\.\.\/lib\/readState'/)
    expect(src).toMatch(/sliceState\(db\.sliceReads, 'suggestions'\)/)
    expect(src).toMatch(/sliceState\(db\.sliceReads, 'decisions'\)/)
    expect(src).toMatch(/sliceState\(db\.sliceReads, 'activity'\)/)
  })

  it('the list fails when either slice fails, and reads while either is pending', () => {
    expect(src).toMatch(/const listFailed = suggestionsRead === 'failed' \|\| decisionsRead === 'failed'/)
    expect(src).toMatch(/const listReading = !listFailed && \(suggestionsRead === 'reading' \|\| decisionsRead === 'reading'\)/)
  })

  it('the failed branch calls emptyCopyFor(failed) before the reading branch, and both before the empty copy', () => {
    const failedAt = component.indexOf("emptyCopyFor('failed'")
    const readingAt = component.indexOf('Loading group input')
    const readyEmptyAt = component.indexOf('EMPTY_COPY.all.title')
    expect(failedAt, 'the failed branch').toBeGreaterThan(-1)
    expect(readingAt, 'the reading branch').toBeGreaterThan(-1)
    expect(readyEmptyAt, 'the ready branch keeps its all-empty copy').toBeGreaterThan(-1)
    expect(failedAt).toBeLessThan(readingAt)
    expect(readingAt).toBeLessThan(readyEmptyAt)
  })

  it('the friendly all-empty copy is defined once, above the component, and not rendered outside the ready branch', () => {
    const copyAt = src.indexOf("'Nothing waiting on the group'")
    expect(copyAt).toBeGreaterThan(-1)
    expect(copyAt).toBeLessThan(src.indexOf('export function GroupInputTab'))
    expect(component).not.toContain("'Nothing waiting on the group'")
  })

  it('the failed branch offers a Try again that re-issues the read through resumeSync, as Budget does', () => {
    expect(src).toMatch(/import \{[^}]*\bresumeSync\b[^}]*\} from '\.\.\/\.\.\/store\/store'/)
    expect(src).toMatch(/const retryGroupInput = \(\) => \{ void resumeSync\(\) \}/)
    expect(component).toMatch(/onClick=\{retryGroupInput\}>Try again<\/button>/)
  })

  it('the reading branch uses the loading markup Budget uses', () => {
    expect(component).toMatch(/<div className="loading-block"><div className="spinner" \/>Loading group input…<\/div>/)
  })

  it('the activity feed fails to a line with a retry, and shows the empty line only once it has loaded', () => {
    expect(component).toMatch(/activityRead === 'failed' \?/)
    expect(component).toMatch(/activityRead === 'ready' && tripActivity\.length === 0/)
    expect(component).toMatch(/No activity yet\./)
  })
})
