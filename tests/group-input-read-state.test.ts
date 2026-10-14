// ============ #704 — a failed or waiting group read never hides loaded cards ============
//
// The bug this pins: Group input printed "Nothing waiting on the group" when
// the suggestions or decisions read had failed. A failed hydrate leaves both
// arrays empty, so the empty copy showed over a dropped connection. The fix
// reads each slice's verdict through `sliceState`. The failed and reading
// branches render only for an empty list, and the empty copy comes last.
// Loaded cards stay on screen, and a failed read adds one note above them.
// The branch order is the whole fix, so this guard reads the source.
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

  it('the failed and reading branches render only for an empty list, so loaded cards stay visible', () => {
    expect(component).toMatch(/items\.length === 0 && listFailed && \(\(\) => \{/)
    expect(component).toMatch(/items\.length === 0 && listReading && \(\s*<StateBlock kind="loading"/)
    expect(component).not.toMatch(/listFailed \?/)
    expect(component).not.toMatch(/listReading \?/)
    expect(component).toMatch(/\{shown\.map\(item => item\.kind === 'idea'/)
  })

  it('the all-empty copy is gated on a ready, empty list, and comes after the failed and reading branches', () => {
    expect(component).toMatch(/items\.length === 0 && !listFailed && !listReading && \(\s*<StateBlock kind="empty"/)
    const failedAt = component.indexOf("emptyCopyFor('failed'")
    const readingAt = component.indexOf('Loading group input')
    const readyEmptyAt = component.indexOf('EMPTY_COPY.all.title')
    expect(readyEmptyAt).toBeGreaterThan(failedAt)
    expect(readyEmptyAt).toBeGreaterThan(readingAt)
  })

  it('the friendly all-empty copy is defined once, above the component, and not rendered outside the ready branch', () => {
    const copyAt = src.indexOf("'Nothing waiting on the group'")
    expect(copyAt).toBeGreaterThan(-1)
    expect(copyAt).toBeLessThan(src.indexOf('export function GroupInputTab'))
    expect(component).not.toContain("'Nothing waiting on the group'")
  })

  it('a failed read with loaded cards adds one note above them, with a retry', () => {
    expect(component).toMatch(/items\.length > 0 && listFailed && \(\s*<StateBlock kind="kept" size="compact" title="Couldn’t refresh group input\. Showing what was loaded\."\s*actions=\{<button className="btn btn-outline btn-sm" onClick=\{retryGroupInput\}>Try again<\/button>\} \/>/)
  })

  it('the failed branch offers a Try again that re-issues the read through resumeSync, as Budget does', () => {
    expect(src).toMatch(/import \{[^}]*\bresumeSync\b[^}]*\} from '\.\.\/\.\.\/store\/store'/)
    expect(src).toMatch(/const retryGroupInput = \(\) => \{ void resumeSync\(\) \}/)
    expect(component).toMatch(/onClick=\{retryGroupInput\}>Try again<\/button>/)
  })

  it('the reading branch uses the shared loading block, with its spinner', () => {
    expect(component).toMatch(/<StateBlock kind="loading" size="compact" title="Loading group input…" art=\{<div className="spinner" \/>\} \/>/)
  })

  it('the activity feed always shows loaded rows, with a note, a failed line or an empty line around them', () => {
    expect(component).toMatch(/activityRead === 'failed' && tripActivity\.length > 0 && \(\s*<StateBlock kind="kept" size="compact" title="Couldn’t refresh activity\. Showing what was loaded\./)
    expect(component).toMatch(/activityRead === 'failed' && tripActivity\.length === 0 && \(\s*<StateBlock kind="failed" size="compact" title="Couldn’t load activity\./)
    expect(component).toMatch(/activityRead === 'ready' && tripActivity\.length === 0 && \(\s*<StateBlock kind="empty" size="compact" title="No activity yet\./)
    expect(component).toMatch(/\{tripActivity\.slice\(0, 20\)\.map\(a => \(/)
    expect(component).not.toMatch(/activityRead === '[a-z]+' \?/)
  })
})
