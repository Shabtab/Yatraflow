// Pure helpers for scripts/mutation-check.mjs. Tests call them with synthetic
// results, so each rule that decides a pin is proven without a real run.
// This file never touches the disk or starts a process.
import path from 'node:path'

/** True only when `child` is strictly inside `parent`. Equal paths are not inside. */
export function isContainedPath(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  if (relative === '' || path.isAbsolute(relative)) return false
  return relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

/** The first non-empty line of a failure message. */
function firstLine(text) {
  return String(text ?? '').split('\n').map(line => line.trim()).find(Boolean) ?? ''
}

/** Vitest names a failed expectation with the AssertionError prefix. */
function isAssertionFailure(message) {
  return message.startsWith('AssertionError')
}

/** Only a passed or failed record ran. Skipped, todo and pending records did not run. */
const EXECUTED = new Set(['passed', 'failed'])

/** True when a report's file name is the requested file. The folder part differs, so the tail decides. */
function namesFile(reportName, requested) {
  const name = String(reportName ?? '').replace(/\\/g, '/')
  return name === requested || name.endsWith(`/${requested}`)
}

/**
 * Read a vitest JSON report and sort its records against the files that were
 * requested. Text that is not a report returns null. A broken report must never
 * look like a passing suite.
 */
export function parseVitestJson(text, expectedFiles) {
  if (typeof text !== 'string' || text.trim() === '') return null
  let data
  try { data = JSON.parse(text) } catch { return null }
  if (!data || !Array.isArray(data.testResults)) return null
  const failedTests = []
  const testErrors = []
  const fileErrors = []
  for (const file of data.testResults) {
    const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : []
    const failed = assertions.filter(assertion => assertion.status === 'failed')
    for (const assertion of failed) {
      const entry = {
        name: assertion.fullName || assertion.title || '(unnamed test)',
        message: firstLine(assertion.failureMessages?.[0]),
      }
      // Only a failed expectation checks the guard. Any other failure is an error,
      // so it is never counted as a pin.
      if (isAssertionFailure(entry.message)) failedTests.push(entry)
      else testErrors.push(entry)
    }
    // A file that cannot load has a message and no records. A failed file with no
    // failed record is also an error, because nothing names what broke.
    const message = firstLine(file.message)
    if (message || (file.status === 'failed' && failed.length === 0)) {
      fileErrors.push({ file: file.name || '(unknown file)', message })
    }
  }
  const missing = []
  const idle = []
  for (const expected of expectedFiles) {
    const record = data.testResults.find(file => namesFile(file.name, expected))
    if (!record) {
      missing.push(expected)
      continue
    }
    const assertions = Array.isArray(record.assertionResults) ? record.assertionResults : []
    if (!assertions.some(assertion => EXECUTED.has(assertion.status))) idle.push(expected)
  }
  return { failedTests, testErrors, fileErrors, missing, idle }
}

function infra(reason) {
  return { kind: 'infra', reason }
}

/**
 * Decide what one mutation run means. A pin needs a failed expectation and
 * nothing else wrong. The checks run first. A failed check returns before any
 * pin is counted.
 *
 * - `reportError` is set when the report could not be read.
 * - `unhandledErrors` lists the unhandled errors of the run. Null means no record was written.
 * - `expectedFiles` lists the files the run requested. Each one must appear, and run at least one test.
 */
export function classifyRun({
  exitCode = null, signal = null, error = null, reportText = null, reportError = null,
  unhandledErrors = null, expectedFiles = null,
}) {
  if (error) return infra(`the test runner could not start: ${error}`)
  if (signal) return infra(`the test runner ended on signal ${signal}`)
  if (reportError) return infra(`the test report could not be read: ${reportError}`)
  if (!Array.isArray(expectedFiles) || expectedFiles.length === 0) {
    return infra('no requested test files were given to check the report against')
  }
  const report = parseVitestJson(reportText, expectedFiles)
  if (!report) return infra('the test report is missing or unreadable')
  // Vitest's JSON report omits unhandled errors, so the runner records them in a
  // separate file. A missing record is not the same as a run with no errors.
  if (!Array.isArray(unhandledErrors)) return infra('the unhandled-error record is missing or unreadable')
  if (unhandledErrors.length > 0 || report.testErrors.length > 0 || report.fileErrors.length > 0) {
    return { kind: 'suite-error', fileErrors: report.fileErrors, testErrors: report.testErrors, unhandled: unhandledErrors }
  }
  if (report.missing.length > 0) return infra(`the report has no record for: ${report.missing.join(', ')}`)
  if (report.idle.length > 0) return infra(`no test ran in: ${report.idle.join(', ')}`)
  if (report.failedTests.length > 0) return { kind: 'pinned', failedTests: report.failedTests }
  if (exitCode === 0) return { kind: 'not-pinned' }
  return infra(`the runner exited with ${exitCode} and reported no failed test`)
}

/**
 * The exit code for the whole run. It says whether every mutation was judged,
 * not whether the suite pinned them all. A cancelled run keeps its signal code.
 */
export function exitCodeFor({ cancelledWith = null, infra = 0, skipped = 0, suiteError = 0 } = {}) {
  if (cancelledWith === 'SIGINT') return 130
  if (cancelledWith === 'SIGTERM') return 143
  return infra > 0 || skipped > 0 || suiteError > 0 ? 2 : 0
}

/** Count each kind of result, so the report can print each count on its own line. */
export function tally(results) {
  const count = kind => results.filter(result => result.kind === kind).length
  return {
    pinned: count('pinned'),
    notPinned: count('not-pinned'),
    suiteError: count('suite-error'),
    skipped: count('skipped'),
    infra: count('infra'),
  }
}
