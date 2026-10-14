// ============ The post-hydrate gates (issue #759) ============
// hydrate() settles its fetch, then runs five follow-up steps. Each step must
// stay behind ALL THREE conditions:
//
//   hydrationSucceeded                    a failed or absent fetch runs nothing
//   gen === hydrateGen                    a superseded hydrate touches nothing
//   cache.sessionUserId === userId         a sign-out or account switch is not acted on
//
// Every step is fire-and-forget, so a deleted condition does not fail a
// behavioural test. It hands a stale account live realtime, DNA or queued
// writes instead. That is why the gates are pinned on the source.
//
// resumeSync repeats two of the five. The issue names both ranges, so both
// functions are scanned here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The store is CRLF on Windows checkouts, so the scan runs on LF text. A
// missing normalise would match one platform and miss the other.
const SOURCE = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const LINES = SOURCE.split('\n')

/** The three conditions every follow-up step must carry. */
const GATES = ['hydrationSucceeded', 'gen === hydrateGen', 'cache.sessionUserId === userId']

/** The five steps hydrate() runs after its fetch settles. */
const STEPS = [
  'enforceDisabledCheck',
  'connectRealtime',
  'attachDnaAccount',
  'replayQueuedWrites',
  'backfillCreateFunnelSession',
]

/** The two steps resumeSync repeats after its refetch. */
const RESUME_STEPS = ['connectRealtime', 'replayQueuedWrites']

/** The body of a declared function, found by the indentation of its own
 *  declaration. hydrate() is an arrow inside init(), so both forms are read. */
function bodyOf(name: string): string {
  const decl = LINES.findIndex((line) => new RegExp(`function\\s+${name}\\s*\\(|const\\s+${name}\\s*=\\s*async`).test(line))
  if (decl === -1) throw new Error(`${name}() is not declared in src/store/store.ts. The pin is stale.`)
  const indent = /^\s*/.exec(LINES[decl])![0].length
  const end = LINES.findIndex((line, i) => i > decl && line.trim() === '}' && /^\s*/.exec(line)![0].length <= indent)
  if (end === -1) throw new Error(`The end of ${name}() was not found. The pin cannot read the file.`)
  return LINES.slice(decl, end + 1).join('\n')
}

/** The lines of a body that hold code, with comments and blanks removed. */
function codeLines(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.replace(/\s\/\/.*$/, ''))
    .filter((line) => line.trim() !== '' && !/^\s*(\/\/|\*|\/\*)/.test(line))
}

/** Every call of a step, as the line that makes it. */
function callsOf(body: string, step: string): string[] {
  return codeLines(body).filter((line) => new RegExp(`(?:^|[^\\w.])${step}\\(`).test(line))
}

/** The condition of the `if (...)` that guards a call, or null for a bare call. */
function gateOn(line: string): string | null {
  const match = /^\s*if \((.*)\)\s+(?:await\s+|void\s+)?\w+(?:\.\w+)*\(/.exec(line)
  return match ? match[1] : null
}

/** A step must run at least once here, and each run must carry every gate. */
function expectGated(calls: string[], step: string, where: string) {
  expect(calls.length, `${step}() must run in ${where}; if it moved, this pin is stale`).toBeGreaterThan(0)
  for (const line of calls) {
    const gate = gateOn(line)
    expect(gate, `${step}() in ${where} sits behind no condition at all`).not.toBeNull()
    for (const condition of GATES) {
      expect(gate!, `${step}() in ${where} dropped the ${condition} gate`).toContain(condition)
    }
  }
}

describe('the post-hydrate gates (#759)', () => {
  const hydrate = bodyOf('hydrate')
  const resume = bodyOf('resumeSync')

  it('reads the hydrate body it means to scan', () => {
    // A wrong slice would make every later assertion vacuous. The body must
    // hold the fetch verdict and the last of the five steps.
    expect(hydrate).toContain('hydrateFromSupabase(userId, gen)')
    expect(hydrate).toContain('backfillCreateFunnelSession(userId)')
  })

  it('guards each of the five steps with all three conditions', () => {
    for (const step of STEPS) expectGated(callsOf(hydrate, step), step, 'hydrate()')
  })

  it('guards the two steps resumeSync repeats', () => {
    for (const step of RESUME_STEPS) expectGated(callsOf(resume, step), step, 'resumeSync()')
  })

  it('takes the verdict from the awaited fetch, so a failure runs none of them', () => {
    const code = codeLines(hydrate).join('\n')
    expect(code).toMatch(/let hydrationSucceeded = false/)
    expect(code).toMatch(/hydrationSucceeded = await promise/)
  })
})
