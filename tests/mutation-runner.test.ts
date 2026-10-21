import { describe, expect, it } from 'vitest'
import { classifyRun, exitCodeFor, isContainedPath, tally } from '../scripts/mutation-lib.mjs'

type Assertion = { fullName: string; status: 'passed' | 'failed'; message?: string }

/** A vitest JSON report for one test file, in the shape the runner reads. */
function report(assertions: Assertion[]): string {
  const failed = assertions.some(a => a.status === 'failed')
  return JSON.stringify({
    testResults: [{
      name: '/scratch/tests/gate-round4-fresh.test.ts',
      status: failed ? 'failed' : 'passed',
      message: '',
      assertionResults: assertions.map(a => ({
        fullName: a.fullName,
        status: a.status,
        failureMessages: a.status === 'failed' ? [a.message ?? 'AssertionError: expected true to be false'] : [],
      })),
    }],
  })
}

describe('mutation runner: what one run means', () => {
  it('a failed assertion pins the mutation and names that assertion', () => {
    const verdict = classifyRun({ exitCode: 1, reportText: report([
      { fullName: 'discard refresh failures keeps the held copy', status: 'failed' },
      { fullName: 'fresh round four interleavings replays', status: 'passed' },
    ]) })
    expect(verdict.kind).toBe('pinned')
    expect(verdict.failedTests).toEqual([{
      name: 'discard refresh failures keeps the held copy',
      message: 'AssertionError: expected true to be false',
    }])
  })

  it('a suite with no failed assertion is not pinned', () => {
    expect(classifyRun({ exitCode: 0, reportText: report([{ fullName: 'a', status: 'passed' }]) }).kind)
      .toBe('not-pinned')
  })

  it('a runner that cannot start is an infrastructure failure, never a pin', () => {
    expect(classifyRun({ exitCode: null, error: 'spawn EPERM', reportText: null }).kind).toBe('infra')
  })

  it('a runner killed by a signal is an infrastructure failure, never a pin', () => {
    const verdict = classifyRun({ exitCode: null, signal: 'SIGKILL', reportText: report([{ fullName: 'a', status: 'passed' }]) })
    expect(verdict.kind).toBe('infra')
  })

  it('a missing or unreadable report is an infrastructure failure', () => {
    expect(classifyRun({ exitCode: 1, reportText: '' }).kind).toBe('infra')
    expect(classifyRun({ exitCode: 1, reportText: '{not json' }).kind).toBe('infra')
  })

  it('a run that executes no test is an infrastructure failure', () => {
    expect(classifyRun({ exitCode: 1, reportText: report([]) }).kind).toBe('infra')
  })

  it('a file that fails to load is a suite error, not an assertion pin', () => {
    const reportText = JSON.stringify({ testResults: [{
      name: '/scratch/tests/x.test.ts', status: 'failed', message: 'SyntaxError: Unexpected token', assertionResults: [],
    }] })
    const verdict = classifyRun({ exitCode: 1, reportText })
    expect(verdict.kind).toBe('suite-error')
    expect(verdict.fileErrors).toEqual([{ file: '/scratch/tests/x.test.ts', message: 'SyntaxError: Unexpected token' }])
  })

  it('a test that throws a runtime error is a suite error, not an assertion pin', () => {
    const verdict = classifyRun({ exitCode: 1, reportText: report([{
      fullName: 'discard refresh failures keeps the held copy', status: 'failed',
      message: 'ReferenceError: readSharedTrip is not defined',
    }]) })
    expect(verdict.kind).toBe('suite-error')
    expect(verdict.testErrors).toEqual([{
      name: 'discard refresh failures keeps the held copy',
      message: 'ReferenceError: readSharedTrip is not defined',
    }])
  })
})

describe('mutation runner: containment, exit codes and tallies', () => {
  it('only a path strictly inside its parent counts as contained', () => {
    expect(isContainedPath('/tmp/yf-mutation-1', '/tmp')).toBe(true)
    expect(isContainedPath('/tmp', '/tmp')).toBe(false)
    expect(isContainedPath('/tmp/../repo', '/tmp')).toBe(false)
    expect(isContainedPath('/repo/worktree', '/tmp')).toBe(false)
  })

  it('a cancelled run keeps its signal code, even after the loop ends', () => {
    expect(exitCodeFor({ cancelledWith: 'SIGINT' })).toBe(130)
    expect(exitCodeFor({ cancelledWith: 'SIGTERM', infra: 0, skipped: 0 })).toBe(143)
  })

  it('an infrastructure failure or a skipped mutation makes the run non-zero', () => {
    expect(exitCodeFor({ infra: 1 })).toBe(2)
    expect(exitCodeFor({ skipped: 1 })).toBe(2)
    expect(exitCodeFor({})).toBe(0)
  })

  it('a suite error leaves a mutation unjudged, so the run exits non-zero', () => {
    expect(exitCodeFor({ suiteError: 1 })).toBe(2)
  })

  it('tallies each kind of result on its own line', () => {
    expect(tally([{ kind: 'pinned' }, { kind: 'not-pinned' }, { kind: 'infra' }, { kind: 'pinned' }, { kind: 'skipped' }]))
      .toEqual({ pinned: 2, notPinned: 1, suiteError: 0, skipped: 1, infra: 1 })
  })
})
