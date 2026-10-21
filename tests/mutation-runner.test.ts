import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { allocateScratch, releaseScratch, runScratch } from '../scripts/mutation-check.mjs'
import { classifyRun, exitCodeFor, isContainedPath, tally } from '../scripts/mutation-lib.mjs'

type Status = 'passed' | 'failed' | 'skipped' | 'todo' | 'pending'
type Assertion = { fullName: string; status: Status; message?: string }
type FileRecord = { name: string; status?: 'passed' | 'failed'; message?: string; assertions: Assertion[] }

const A = 'tests/gate-round4-fresh.test.ts'
const B = 'tests/gate-banner-probes.test.ts'
const SEVEN = [
  'tests/recovery-identity-boundaries.test.ts',
  'tests/offline-recovery-ui.test.ts',
  'tests/gate-extra-probes.test.ts',
  'tests/gate-additional-probes.test.ts',
  'tests/gate-banner-probes.test.ts',
  'tests/gate-round4-fresh.test.ts',
  'tests/recovery-liveness-probes.test.ts',
]
/** The inputs of a run that passed every runner check. Each case overrides only what it tests. */
const SINGLE = { expectedFiles: [A], unhandledErrors: [] as string[] }
const PAIR = { expectedFiles: [A, B], unhandledErrors: [] as string[] }

/** A vitest JSON report for several test files. A file with a failed assertion is failed. */
function reportFiles(files: FileRecord[]): string {
  return JSON.stringify({
    testResults: files.map(file => ({
      name: file.name,
      status: file.status ?? (file.assertions.some(a => a.status === 'failed') ? 'failed' : 'passed'),
      message: file.message ?? '',
      assertionResults: file.assertions.map(a => ({
        fullName: a.fullName,
        status: a.status,
        failureMessages: a.status === 'failed' ? [a.message ?? 'AssertionError: expected true to be false'] : [],
      })),
    })),
  })
}

/** A vitest JSON report for one test file, in the shape the runner reads. */
function report(assertions: Assertion[]): string {
  return reportFiles([{ name: `/scratch/${A}`, assertions }])
}

const made: string[] = []

/** A folder for one test. It is removed after the test, and every link inside it is unlinked first. */
function fixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'yf-runner-test-'))
  made.push(dir)
  return dir
}

/** Unlink one link. A directory junction needs rmdir on Windows, and a symlink needs unlink elsewhere. */
function unlinkLink(link: string): void {
  try {
    rmdirSync(link)
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOTDIR') throw error
    unlinkSync(link)
  }
}

/** Unlink every link under a folder. Links are never followed. */
function unlinkLinks(dir: string): void {
  for (const name of readdirSync(dir)) {
    const entry = path.join(dir, name)
    if (lstatSync(entry).isSymbolicLink()) unlinkLink(entry)
    else if (lstatSync(entry).isDirectory()) unlinkLinks(entry)
  }
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    if (!existsSync(dir)) continue
    unlinkLinks(dir)
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('mutation runner: what one run means', () => {
  it('a failed assertion pins the mutation and names that assertion', () => {
    const verdict = classifyRun({ ...SINGLE, exitCode: 1, reportText: report([
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
    expect(classifyRun({ ...SINGLE, exitCode: 0, reportText: report([{ fullName: 'a', status: 'passed' }]) }).kind)
      .toBe('not-pinned')
  })

  it('a runner that cannot start is an infrastructure failure, never a pin', () => {
    expect(classifyRun({ ...SINGLE, exitCode: null, error: 'spawn EPERM', reportText: null }).kind).toBe('infra')
  })

  it('a runner killed by a signal is an infrastructure failure, never a pin', () => {
    const verdict = classifyRun({ ...SINGLE, exitCode: null, signal: 'SIGKILL', reportText: report([{ fullName: 'a', status: 'passed' }]) })
    expect(verdict.kind).toBe('infra')
  })

  it('a missing or unreadable report is an infrastructure failure', () => {
    expect(classifyRun({ ...SINGLE, exitCode: 1, reportText: '' }).kind).toBe('infra')
    expect(classifyRun({ ...SINGLE, exitCode: 1, reportText: '{not json' }).kind).toBe('infra')
  })

  it('a run that executes no test is an infrastructure failure', () => {
    expect(classifyRun({ ...SINGLE, exitCode: 1, reportText: report([]) }).kind).toBe('infra')
  })

  it('a file that fails to load is a suite error, not an assertion pin', () => {
    const reportText = JSON.stringify({ testResults: [{
      name: `/scratch/${A}`, status: 'failed', message: 'SyntaxError: Unexpected token', assertionResults: [],
    }] })
    const verdict = classifyRun({ ...SINGLE, exitCode: 1, reportText })
    expect(verdict.kind).toBe('suite-error')
    expect(verdict.fileErrors).toEqual([{ file: `/scratch/${A}`, message: 'SyntaxError: Unexpected token' }])
  })

  it('a test that throws a runtime error is a suite error, not an assertion pin', () => {
    const verdict = classifyRun({ ...SINGLE, exitCode: 1, reportText: report([{
      fullName: 'discard refresh failures keeps the held copy', status: 'failed',
      message: 'ReferenceError: readSharedTrip is not defined',
    }]) })
    expect(verdict.kind).toBe('suite-error')
    expect(verdict.testErrors).toEqual([{
      name: 'discard refresh failures keeps the held copy',
      message: 'ReferenceError: readSharedTrip is not defined',
    }])
  })

  it('an assertion failure beside another file\'s SyntaxError is a suite error, not a pin', () => {
    const verdict = classifyRun({ ...PAIR, exitCode: 1, reportText: reportFiles([
      { name: `/scratch/${A}`, assertions: [{ fullName: 'discard keeps the held copy', status: 'failed' }] },
      { name: `/scratch/${B}`, status: 'failed', message: 'SyntaxError: Unexpected token', assertions: [] },
    ]) })
    expect(verdict.kind).toBe('suite-error')
    expect(verdict.fileErrors).toEqual([{ file: `/scratch/${B}`, message: 'SyntaxError: Unexpected token' }])
  })

  it('an assertion failure beside a test that throws a ReferenceError is a suite error, not a pin', () => {
    const verdict = classifyRun({ ...SINGLE, exitCode: 1, reportText: report([
      { fullName: 'discard keeps the held copy', status: 'failed' },
      { fullName: 'replays the queue', status: 'failed', message: 'ReferenceError: readSharedTrip is not defined' },
    ]) })
    expect(verdict.kind).toBe('suite-error')
    expect(verdict.testErrors).toEqual([{ name: 'replays the queue', message: 'ReferenceError: readSharedTrip is not defined' }])
  })

  it('an unhandled error beside a failed assertion is a suite error, not a pin', () => {
    const verdict = classifyRun({ ...SINGLE, unhandledErrors: ['late boom'], exitCode: 1, reportText: report([
      { fullName: 'discard keeps the held copy', status: 'failed' },
    ]) })
    expect(verdict.kind).toBe('suite-error')
    expect(verdict.unhandled).toEqual(['late boom'])
  })

  it('an unhandled error with every test green is a suite error, never a clean run', () => {
    const verdict = classifyRun({ ...SINGLE, unhandledErrors: ['late boom'], exitCode: 0, reportText: report([
      { fullName: 'a', status: 'passed' },
    ]) })
    expect(verdict.kind).toBe('suite-error')
  })

  it('a run with no unhandled-error record is infrastructure, never a pin', () => {
    const verdict = classifyRun({ ...SINGLE, unhandledErrors: null, exitCode: 1, reportText: report([
      { fullName: 'discard keeps the held copy', status: 'failed' },
    ]) })
    expect(verdict.kind).toBe('infra')
  })

  it('a report that covers one of seven requested files is incomplete, never a pin', () => {
    const verdict = classifyRun({ expectedFiles: SEVEN, unhandledErrors: [], exitCode: 1, reportText: reportFiles([
      { name: `/scratch/${SEVEN[5]}`, assertions: [{ fullName: 'discard keeps the held copy', status: 'failed' }] },
    ]) })
    expect(verdict.kind).toBe('infra')
  })

  it('skipped and todo records are not executed, so a file with only those is infrastructure', () => {
    const verdict = classifyRun({ ...PAIR, exitCode: 1, reportText: reportFiles([
      { name: `/scratch/${A}`, assertions: [{ fullName: 'discard keeps the held copy', status: 'failed' }] },
      { name: `/scratch/${B}`, assertions: [{ fullName: 'later', status: 'skipped' }, { fullName: 'planned', status: 'todo' }] },
    ]) })
    expect(verdict.kind).toBe('infra')
  })

  it('a run where every record is skipped executes nothing, so it is infrastructure', () => {
    const verdict = classifyRun({ ...SINGLE, exitCode: 0, reportText: report([{ fullName: 'later', status: 'skipped' }]) })
    expect(verdict.kind).toBe('infra')
  })

  it('a clean run that fails an assertion in every requested file is still pinned', () => {
    const verdict = classifyRun({ ...PAIR, exitCode: 1, reportText: reportFiles([
      { name: `/scratch/${A}`, assertions: [{ fullName: 'discard keeps the held copy', status: 'failed' }] },
      { name: `/scratch/${B}`, assertions: [{ fullName: 'replays the queue', status: 'failed' }] },
    ]) })
    expect(verdict.kind).toBe('pinned')
    expect(verdict.failedTests).toHaveLength(2)
  })
})

describe('mutation runner: scratch folders are owned, never adopted', () => {
  it('a folder that already exists at the scratch name is left alone', () => {
    const root = fixture()
    const taken = path.join(root, 'taken')
    mkdirSync(taken)
    writeFileSync(path.join(taken, 'keep.txt'), 'theirs')
    let owned: ReturnType<typeof allocateScratch> | null = null
    let claimError: unknown = null
    try {
      owned = allocateScratch({ root, name: n => (n === 0 ? 'taken' : 'fresh') })
    } catch (error) {
      claimError = error
    } finally {
      releaseScratch(owned)
    }
    expect(existsSync(path.join(taken, 'keep.txt'))).toBe(true)
    expect(claimError).toBeNull()
    expect(owned?.path).toBe(path.join(root, 'fresh'))
  })

  it('a scratch root replaced by a junction is refused, and the junction target survives', () => {
    const root = fixture()
    const victim = fixture()
    writeFileSync(path.join(victim, 'keep.txt'), 'theirs')
    const owned = allocateScratch({ root, name: () => 'job' })
    rmSync(owned.path, { recursive: true, force: true })
    symlinkSync(victim, owned.path, 'junction')
    expect(() => releaseScratch(owned)).toThrow(/not the folder this run created/)
    expect(existsSync(path.join(victim, 'keep.txt'))).toBe(true)
  })

  it('a dependency junction inside the scratch folder is unlinked, and its target survives', () => {
    const root = fixture()
    const deps = fixture()
    writeFileSync(path.join(deps, 'keep.txt'), 'theirs')
    const owned = allocateScratch({ root, name: () => 'job' })
    symlinkSync(deps, path.join(owned.path, 'node_modules'), 'junction')
    writeFileSync(path.join(owned.path, 'copied.txt'), 'x')
    releaseScratch(owned)
    expect(existsSync(owned.path)).toBe(false)
    expect(existsSync(path.join(deps, 'keep.txt'))).toBe(true)
  })
})

describe('mutation runner: a report that cannot be read', () => {
  it('settles the run as an infrastructure result when the report cannot be read', async () => {
    const root = fixture()
    const reportPath = path.join(root, 'vitest-report.json')
    const unhandledPath = path.join(root, 'unhandled-errors.json')
    // The child turns the report path into a folder, so reading it fails after the child exits.
    const run = await runScratch({
      command: process.execPath,
      args: ['-e', `require('node:fs').mkdirSync(${JSON.stringify(reportPath)})`],
      cwd: root,
      reportPath,
      unhandledPath,
    })
    expect(run.reportError).toMatch(/EISDIR/)
    expect(classifyRun({
      ...SINGLE,
      exitCode: run.exitCode,
      reportText: run.reportText,
      reportError: run.reportError,
      unhandledErrors: run.unhandledErrors,
    }).kind).toBe('infra')
  }, 15000)
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
