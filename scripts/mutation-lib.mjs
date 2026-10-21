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

/**
 * Read a vitest JSON report. Text that is not a report returns null.
 * A broken report must never look like a passing suite.
 */
export function parseVitestJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  let data
  try { data = JSON.parse(text) } catch { return null }
  if (!data || !Array.isArray(data.testResults)) return null
  let total = 0
  const failedTests = []
  const fileErrors = []
  for (const file of data.testResults) {
    const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : []
    total += assertions.length
    for (const assertion of assertions) {
      if (assertion.status !== 'failed') continue
      failedTests.push({
        name: assertion.fullName || assertion.title || '(unnamed test)',
        message: firstLine(assertion.failureMessages?.[0]),
      })
    }
    const hasFailedAssertion = assertions.some(assertion => assertion.status === 'failed')
    if (file.status === 'failed' && !hasFailedAssertion) {
      fileErrors.push({ file: file.name || '(unknown file)', message: firstLine(file.message) })
    }
  }
  return { total, failedTests, fileErrors }
}

/**
 * Decide what one mutation run means. Only a failed assertion pins a mutation.
 * A runner failure, or a report that cannot be read, is an infrastructure
 * failure. It never counts as a pin.
 */
export function classifyRun({ exitCode = null, signal = null, error = null, reportText = null }) {
  if (error) return { kind: 'infra', reason: `the test runner could not start: ${error}` }
  if (signal) return { kind: 'infra', reason: `the test runner ended on signal ${signal}` }
  const report = parseVitestJson(reportText)
  if (!report) return { kind: 'infra', reason: 'the test report is missing or unreadable' }
  // Only a failed expectation checks the guard. Any other error means the
  // mutation broke the code, so it is not a pin.
  const assertions = report.failedTests.filter(test => isAssertionFailure(test.message))
  if (assertions.length > 0) return { kind: 'pinned', failedTests: assertions }
  // A file that cannot load has no assertions. A thrown error is not a check either.
  if (report.fileErrors.length > 0 || report.failedTests.length > 0) {
    return { kind: 'suite-error', fileErrors: report.fileErrors, testErrors: report.failedTests }
  }
  if (report.total === 0) return { kind: 'infra', reason: 'no test ran' }
  if (exitCode === 0) return { kind: 'not-pinned' }
  return { kind: 'infra', reason: `the runner exited with ${exitCode} and reported no failed test` }
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
