// Mutation check: remove one guard at a time and record which test fails.
//
// A mutation removes one guard, or one set of guards that overlap. The matching
// regression test must then fail. A mutation whose suite stays green is a guard
// that nothing pins, and the report names it.
//
// SAFETY. The mutations run in a scratch copy in the temp folder. The copy is
// built from ONE commit, read with git, so the bytes under test are committed
// bytes. The worktree is never written. The copy is removed in a finally block,
// and SIGINT and SIGTERM stop the run at the next step.
//
// Usage: node scripts/mutation-check.mjs <report-path> [--anchors-only] [--only=<name-part>]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyRun, exitCodeFor, isContainedPath, tally } from './mutation-lib.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const STORE = 'src/store/store.ts'
const BANNER = 'src/components/OfflineBanner.tsx'
const TESTS = [
  'tests/recovery-identity-boundaries.test.ts',
  'tests/offline-recovery-ui.test.ts',
  'tests/gate-extra-probes.test.ts',
  'tests/gate-additional-probes.test.ts',
  'tests/gate-banner-probes.test.ts',
  'tests/gate-round4-fresh.test.ts',
  'tests/recovery-liveness-probes.test.ts',
]
// The copy holds the folders and files the tests read. Nothing else is copied.
const COPY_DIRS = ['src/', 'tests/', 'scripts/', 'supabase/', 'docs/']
const COPY_FILES = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'eslint.config.js', 'eslint-baseline.json'])
const REPORT_FILE = 'vitest-report.json'
const SHOWN = 5

const args = process.argv.slice(2)
const ANCHORS_ONLY = args.includes('--anchors-only')
const onlyArg = args.find(arg => arg.startsWith('--only='))
const ONLY = onlyArg ? onlyArg.slice('--only='.length) : null
const OUT = args.find(arg => !arg.startsWith('--'))
const UNKNOWN = args.filter(arg => arg.startsWith('--') && arg !== '--anchors-only' && !arg.startsWith('--only='))

/** The scratch copy, the running vitest child, and the signal that stopped the run. */
let scratch = null
let running = null
let cancelledWith = null

/** Anchors use LF. A checkout may hold CRLF, so both sides are compared as LF. */
const norm = text => text.replace(/\r\n/g, '\n')

/** A signal stops the run at the next step. The running child is killed first. */
function cancel(signal) {
  if (cancelledWith) return
  cancelledWith = signal
  killRunning()
}

function killRunning() {
  const child = running
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // taskkill fails once the child has exited. The loop then ends on its own.
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // The process group has already exited, so there is nothing to stop.
  }
}

process.on('SIGINT', () => cancel('SIGINT'))
process.on('SIGTERM', () => cancel('SIGTERM'))
// A hard exit still removes the copy. An error here cannot be reported, so it is dropped.
process.on('exit', () => {
  try {
    removeScratch()
  } catch {
    // The finally block in main has already reported this failure.
  }
})

/** Every copied file at one commit. The worktree is not read. */
function readCopyFiles(sha) {
  const listing = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', sha], { cwd: ROOT, maxBuffer: 1024 ** 3 })
  const paths = listing.toString('utf8').split('\0')
    .filter(file => file && (COPY_FILES.has(file) || COPY_DIRS.some(dir => file.startsWith(dir))))
  return readBlobs(sha, paths)
}

/** Read blobs from one commit in one git process. Returns each path with its bytes. */
function readBlobs(sha, paths) {
  const input = `${paths.map(file => `${sha}:${file}`).join('\n')}\n`
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: ROOT, input, maxBuffer: 1024 ** 3 })
  const blobs = new Map()
  let at = 0
  for (const file of paths) {
    const end = out.indexOf(0x0a, at)
    const [, type, size] = out.toString('utf8', at, end).split(' ')
    if (type !== 'blob') throw new Error(`git cannot read ${file} at ${sha}`)
    const start = end + 1
    blobs.set(file, out.subarray(start, start + Number(size)))
    at = start + Number(size) + 1
  }
  return blobs
}

/** Write the copy from the commit's bytes, then link the worktree's dependencies into it. */
function buildScratch(files) {
  mkdirSync(scratch)
  for (const [file, data] of files) {
    const target = path.join(scratch, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, data)
  }
  const deps = path.join(ROOT, 'node_modules')
  if (!existsSync(deps)) throw new Error('the worktree has no node_modules. Link it before the check.')
  // A directory junction needs no admin rights on Windows. Removing it leaves the target alone.
  symlinkSync(deps, path.join(scratch, 'node_modules'), 'junction')
}

function linkPresent(file) {
  try {
    lstatSync(file)
    return true
  } catch {
    return false
  }
}

/** Remove the copy. Only a path inside the temp folder is removed, and the dependency link goes first. */
function removeScratch() {
  if (!scratch) return
  if (!isContainedPath(scratch, tmpdir())) throw new Error(`refusing to remove ${scratch}: it is outside the temp folder`)
  const link = path.join(scratch, 'node_modules')
  if (linkPresent(link)) {
    // The link points at the worktree's dependencies. It is unlinked without
    // being followed, so the recursive removal below never reaches them.
    if (!lstatSync(link).isSymbolicLink()) throw new Error(`refusing to remove ${scratch}: node_modules is not a link`)
    rmdirSync(link)
  }
  rmSync(scratch, { recursive: true, force: true })
  scratch = null
}

/** Run the test files once in the copy. Resolves with the exit code, the signal, the report and the output tail. */
function runVitest() {
  const reportPath = path.join(scratch, REPORT_FILE)
  rmSync(reportPath, { force: true })
  return new Promise(resolve => {
    const child = spawn(process.execPath, [
      path.join(scratch, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...TESTS,
      '--reporter=json', `--outputFile=${reportPath}`,
    ], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
    running = child
    let output = ''
    const keep = chunk => { output = (output + chunk.toString('utf8')).slice(-8000) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', error => {
      running = null
      resolve({ error: error.message, output })
    })
    child.on('close', (exitCode, signal) => {
      running = null
      const reportText = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : null
      resolve({ exitCode, signal, reportText, output })
    })
  })
}

/** Apply every anchor of one mutation. Each anchor must match exactly once, so no edit lands in the wrong place. */
function applyMutation(source, mutation) {
  let text = norm(source)
  let line = null
  for (const [from, to] of [[mutation.from, mutation.to], ...(mutation.also ?? [])]) {
    const needle = norm(from)
    const hits = text.split(needle).length - 1
    if (hits !== 1) return { ok: false, hits, anchor: needle.split('\n')[0].trim() }
    const at = text.indexOf(needle)
    if (line === null) line = text.slice(0, at).split('\n').length
    text = text.slice(0, at) + norm(to) + text.slice(at + needle.length)
  }
  return { ok: true, text, line }
}

/** Check one mutation's anchors against the commit. Nothing is run. */
function checkAnchors(files, mutation) {
  const applied = applyMutation(files.get(mutation.file).toString('utf8'), mutation)
  if (!applied.ok) return { kind: 'skipped', hits: applied.hits, anchor: applied.anchor }
  return { kind: 'anchors-ok', line: applied.line }
}

/** Apply one mutation to the copy, run the tests, and restore the copy from the commit's bytes. */
async function runMutation(files, mutation) {
  const original = files.get(mutation.file)
  const applied = applyMutation(original.toString('utf8'), mutation)
  if (!applied.ok) return { kind: 'skipped', hits: applied.hits, anchor: applied.anchor }
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const target = path.join(scratch, mutation.file)
  writeFileSync(target, applied.text.replace(/\n/g, eol))
  let run
  try {
    run = await runVitest()
  } finally {
    writeFileSync(target, original)
  }
  if (cancelledWith) return null
  const verdict = classifyRun({ exitCode: run.exitCode, signal: run.signal, error: run.error, reportText: run.reportText })
  return { ...verdict, line: applied.line, output: run.output }
}

const lastLines = (text, count) => text.split('\n').map(line => line.trimEnd()).filter(Boolean).slice(-count)

/** The report lines for one mutation. Each outcome keeps its own label. */
function describeMutation(mutation, result) {
  const where = `  file: ${mutation.file}${result.line ? ` (line ${result.line})` : ''}`
  switch (result.kind) {
    case 'anchors-ok':
      return [`ANCHORS OK   ${mutation.name}`, where, '']
    case 'pinned':
      return [`PINNED      ${mutation.name}`, where, '  failing assertions:',
        ...result.failedTests.slice(0, SHOWN).flatMap(test => [`    - ${test.name}`, `      ${test.message}`]), '']
    case 'not-pinned':
      return [`NOT PINNED  ${mutation.name}`, where, '  no assertion failed: the suite stayed green', '']
    case 'suite-error':
      return [`SUITE ERROR ${mutation.name}`, where,
        ...result.fileErrors.map(error => `  ${error.file}: ${error.message}`),
        ...result.testErrors.slice(0, SHOWN).map(error => `  ${error.name}: ${error.message}`), '']
    case 'infra':
      return [`INFRA       ${mutation.name}`, where, `  reason: ${result.reason}`,
        ...lastLines(result.output, 6).map(line => `    | ${line}`), '']
    case 'skipped':
      return [`SKIP        ${mutation.name}`, `  file: ${mutation.file}`,
        `  anchor "${result.anchor}" matches ${result.hits} times; it must match once.`, '']
    default:
      return []
  }
}

function headerLines(sha, selected) {
  const mode = ANCHORS_ONLY ? 'anchors only' : 'full run'
  const scope = ONLY === null ? '' : ` matching "${ONLY}"`
  return [
    'Mutation check: each mutation removes one guard, or one set of overlapping guards.',
    'A mutation whose suite stays green is a guard that nothing pins.',
    `HEAD ${sha}`,
    `Mode: ${mode}. Mutations: ${selected.length}${scope}.`,
    'The mutations ran in a scratch copy built from HEAD. The worktree was never written.',
    '',
    'READING A NOT PINNED RESULT. Two guards that overlap cover the same case. Removing',
    'one of them leaves the case covered by the other, so the defect does not come back.',
    'A COLLECTIVE mutation removes the whole overlapping set. A NOT PINNED result is a',
    'finding to read, not a pass.',
    '',
  ]
}

/** Run the selected mutations, or only check their anchors, and write one report. */
async function main() {
  const selected = MUTATIONS.filter(mutation => ONLY === null || mutation.name.includes(ONLY))
  if (selected.length === 0) {
    console.error(`no mutation name contains "${ONLY}"`)
    return 2
  }
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const files = readCopyFiles(sha)
  const lines = headerLines(sha, selected)
  const results = []
  let fatal = null
  let leftover = null

  if (ANCHORS_ONLY) {
    for (const mutation of selected) {
      const result = checkAnchors(files, mutation)
      results.push(result)
      lines.push(...describeMutation(mutation, result))
    }
  } else {
    scratch = path.join(tmpdir(), `yf-mutation-${process.pid}-${Date.now()}`)
    try {
      buildScratch(files)
      for (const mutation of selected) {
        if (cancelledWith) break
        const result = await runMutation(files, mutation)
        if (cancelledWith || result === null) break
        results.push(result)
        lines.push(...describeMutation(mutation, result))
      }
    } catch (error) {
      fatal = error.message
    } finally {
      try {
        removeScratch()
      } catch (error) {
        leftover = error.message
      }
    }
    if (cancelledWith) lines.push(`CANCELLED by ${cancelledWith}. The mutation in progress was not counted.`, '')
  }

  const counts = tally(results)
  const notRun = selected.length - results.length
  const infra = counts.infra + (fatal || leftover ? 1 : 0)
  const exit = exitCodeFor({ cancelledWith, infra, skipped: counts.skipped, suiteError: counts.suiteError })
  if (ANCHORS_ONLY) {
    lines.push(`Anchors matched once: ${results.filter(r => r.kind === 'anchors-ok').length} of ${selected.length}. Skipped: ${counts.skipped}.`)
  } else {
    lines.push(`Pinned ${counts.pinned}. Not pinned ${counts.notPinned}. Suite error ${counts.suiteError}. Infra ${counts.infra}. Skipped ${counts.skipped}. Not run ${notRun}. Total ${selected.length}.`)
  }
  if (fatal) lines.push(`Fatal error: ${fatal}`)
  lines.push(leftover ? `The scratch copy was NOT removed: ${leftover}` : 'The scratch copy was removed. The worktree was never written.')
  lines.push(`exit=${exit}`, `HEAD ${sha}`)
  const text = `${lines.join('\n')}\n`
  writeFileSync(OUT, text, 'utf8')
  console.log(text)
  return exit
}

/** Each mutation: a name, a file, and one or more anchors. Each anchor must match exactly once. */
const MUTATIONS = [
  {
    name: 'P1a-discard-identity-after-queue-read',
    file: STORE,
    from: `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current || !stillLive(scope, tripId, accessEpoch)) return false`,
    to: `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current) return false`,
  },
  {
    name: 'P1b-discard-generation-after-server-read',
    file: STORE,
    from: `      const refresh = await readForDiscard(tripId, token)
      if (!stillLive(scope, tripId, accessEpoch)) return false`,
    to: `      const refresh = await readForDiscard(tripId, token)`,
  },
  {
    name: 'P1c-revocation-scope-before-invalidation',
    file: STORE,
    from: `      await retainRevokedCopy(entry, scope, reason)
      // The retention awaited storage, so the scope is checked once more. A
      // copy that changed hands in the meantime is not this scope's work.
      if (!stillLive(scope, entry.tripId, accessEpoch)) return false
      // The invalidation bumps the access generation, so the refresh below
      // must compare against the NEW generation. The captured one is stale
      // from here on.
      const nextEpoch = invalidateTripWork(entry.tripId, scope.userId, reason)`,
    to: `      await retainRevokedCopy(entry, scope, reason)
      // The invalidation bumps the access generation, so the refresh below
      // must compare against the NEW generation. The captured one is stale
      // from here on.
      const nextEpoch = invalidateTripWork(entry.tripId, scope.userId, reason)`,
    also: [
      [`      if (!stillLive(scope, entry.tripId, nextEpoch)) return false
        if (shared) {`,
      `      if (shared) {`],
    ],
  },
  {
    name: 'P1c-missing-trip-scope-before-invalidation',
    file: STORE,
    from: `      await retainRevokedCopy(entry, scope, 'trip-unavailable')
      if (!stillLive(scope, entry.tripId, accessEpoch)) return false
      invalidateTripWork(entry.tripId, scope.userId, 'trip-unavailable')`,
    to: `      await retainRevokedCopy(entry, scope, 'trip-unavailable')
      invalidateTripWork(entry.tripId, scope.userId, 'trip-unavailable')`,
  },
  {
    name: 'P2d-demotion-shared-plan',
    file: STORE,
    from: `          queuedLocalTrips.delete(tripId)
          void refreshSharedPlanAfterDemotion(tripId)`,
    to: `          queuedLocalTrips.delete(tripId)`,
  },
  {
    name: 'P2e-reasoned-copy-excluded-from-overlay',
    file: STORE,
    from: `    if (!write) return trip
    if (!isHeldCopy(write)) {`,
    to: `    if (!write) return trip
    if (false) {`,
  },
  {
    // The demotion refresh must compare against the generation the
    // invalidation returned. Comparing against the captured one is always
    // false, so the shared plan never reaches the screen.
    name: 'REVISE2-demotion-uses-the-new-generation',
    file: STORE,
    from: `        if (!stillLive(scope, entry.tripId, nextEpoch)) return false
        if (shared) {
          cache.trips = cache.trips.map(t => t.id === entry.tripId ? shared.trip : t)`,
    to: `        if (shared) {
          cache.trips = cache.trips.map(t => t.id === entry.tripId ? shared.trip : t)`,
  },
  {
    // A discard that cannot read the shared plan must refuse while the
    // overlay is on screen, or the discarded content stays editable.
    name: 'REVISE2-discard-refuses-on-a-failed-read',
    file: STORE,
    from: `      if (!refresh && isHeldCopy(current) && cache.trips.some(t => t.id === tripId)) return false`,
    to: `      if (false && !refresh && isHeldCopy(current) && cache.trips.some(t => t.id === tripId)) return false`,
  },
  {
    // A REASONED copy is never an overlay, so the refusal must not apply to
    // it. Refusing it would leave the account with a copy it can neither
    // sync nor remove.
    name: 'REVISE3-reasoned-copy-is-not-refused',
    file: STORE,
    from: `      if (!refresh && isHeldCopy(current) && cache.trips.some(t => t.id === tripId)) return false`,
    to: `      if (!refresh && cache.trips.some(t => t.id === tripId)) return false`,
  },
  {
    // The access generation must be captured BEFORE the first await. A
    // tombstone that lands during the queue read bumps the generation, and an
    // action that reads the generation after the await would take the bumped
    // value and treat itself as current.
    name: 'REVISE4-generation-captured-before-the-await',
    file: STORE,
    from: `  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0
  const write = (await pendingWrites()).find(w => w.ownerId === scope.userId && w.tripId === tripId)
  if (!write || !isCurrentIdentity(scope)) return false
  // The generation moved while the queue was read, so this action is stale.
  if ((tripAccessEpochs.get(tripId) ?? 0) !== accessEpoch) return false`,
    to: `  const write = (await pendingWrites()).find(w => w.ownerId === scope.userId && w.tripId === tripId)
  if (!write || !isCurrentIdentity(scope)) return false
  const accessEpoch = tripAccessEpochs.get(tripId) ?? 0`,
  },
  {
    // The published plan must carry the AUTHORITATIVE membership. The cached
    // members still say owner or editor after a demotion, so reusing them
    // leaves the edit controls on screen.
    name: 'REVISE4-authoritative-membership',
    file: STORE,
    from: `        const shared = await readSharedTripWithMembership(entry.tripId, token)`,
    to: `        const shared = await readSharedTripWithMembership(entry.tripId, token)
          .then(s => s ? { ...s, trip: { ...s.trip, members: tripById(entry.tripId)?.members ?? s.trip.members } } : null)`,
  },
  {
    // A failed shared read must not leave the local proposal on screen for an
    // account that may no longer edit it.
    name: 'REVISE4-failed-read-removes-the-proposal',
    file: STORE,
    from: `    const trip = tripById(tripId)
    if (trip && canEdit(roleOf(trip, scope.userId))) return
    cache.trips = cache.trips.filter(t => t.id !== tripId)`,
    to: `    cache.trips = cache.trips.filter(t => t.id !== tripId)`,
    // The edit-right check and the liveness check OVERLAP here: the realtime
    // demotion bumps the generation, so the liveness check already stops the
    // removal under a newer grant. The mutation removes the whole
    // set, which is what reproduces the defect.
    also: [
      [`  const shared = await readSharedTripForCurrentIdentity(tripId)
  if (!stillLive(scope, tripId, accessEpoch)) return
  if (!shared) {`,
      `  const shared = await readSharedTripForCurrentIdentity(tripId)
  if (!shared) {`],
    ],
  },
  {
    // A removal that was in flight when the generation moved must put the
    // copy back, because a tombstone asked for it to be kept.
    name: 'REVISE4-inflight-removal-restores-the-copy',
    file: STORE,
    from: `        const recorded = tripInvalidationReasons.get(tripId)
        if (recorded && durable && recorded.userId === scope.userId
          && recorded.generation === tripAccessEpochs.get(tripId)
          && isCurrentIdentity(scope)) {`,
    to: `        const recorded = tripInvalidationReasons.get(tripId)
        if (false && recorded) {`,
  },
  {
    // The hydrate must keep the deletion reason it observed, because a
    // tombstoned trip and a removed membership are different reasons.
    name: 'REVISE4-hydrate-keeps-the-deletion-reason',
    file: STORE,
    from: `        const reason = tombstonedTripIds.has(write.tripId)
          ? 'trip-unavailable'
          : readable.has(write.tripId) ? 'access-revoked' : 'access-removed'`,
    to: `        const reason = readable.has(write.tripId) ? 'access-revoked' : 'access-removed'`,
  },
  {
    // A reasoned copy is never held as the local copy.
    name: 'REVISE2-reasoned-copy-never-held',
    file: STORE,
    from: `        if (isHeldCopy(latest)) queuedLocalTrips.set(tripId, latest)
        else queuedLocalTrips.delete(tripId)`,
    to: `        queuedLocalTrips.set(tripId, latest)`,
  },
  {
    name: 'SHOULD-FIX-offline-removal-handler',
    file: BANNER,
    from: `onClick={() => { void removeCopy(write) }}`,
    to: `onClick={() => { void recover(write.tripId, 'discard') }}`,
  },
  {
    // The published plan must carry the server membership. The mutation reuses
    // the cached roles, which can still show an old role after a change.
    name: 'REVISE5-second-read-uses-authoritative-membership',
    file: STORE,
    from: `        cache.trips = [...cache.trips.filter(t => t.id !== tripId), refresh.trip]`,
    to: `        const cachedMembers = tripById(tripId)?.members
        cache.trips = [...cache.trips.filter(t => t.id !== tripId),
          { ...refresh.trip, members: cachedMembers ?? refresh.trip.members }]`,
  },
  {
    // B2: the failed read of the replay demotion must not remove the trip
    // under a scope that a newer grant has superseded.
    name: 'REVISE5-replay-demotion-failed-read-checks-liveness',
    file: STORE,
    from: `        if (!stillLive(scope, entry.tripId, nextEpoch)) return false
        if (shared) {
          cache.trips = cache.trips.map(t => t.id === entry.tripId ? shared.trip : t)`,
    to: `        if (shared) {
          cache.trips = cache.trips.map(t => t.id === entry.tripId ? shared.trip : t)`,
  },
  {
    // The reason is bound to the identity AND the generation that recorded it.
    // A sign-out clears the trip's generation, so a reason recorded before the
    // sign-out no longer matches and the copy is not put back. The identity
    // check and the generation binding OVERLAP, so this mutation removes both.
    name: 'REVISE5-restore-requires-the-captured-identity',
    file: STORE,
    from: `        if (recorded && durable && recorded.userId === scope.userId
          && recorded.generation === tripAccessEpochs.get(tripId)
          && isCurrentIdentity(scope)) {`,
    to: `        if (recorded && durable) {`,
  },
  {
    // The replay demotion's failed read must not remove the trip. Both guards
    // go, because the liveness check and the edit-right check overlap.
    name: 'REVISE5-replay-demotion-does-not-remove-the-trip',
    file: STORE,
    from: `        if (!stillLive(scope, entry.tripId, nextEpoch)) return false
        if (shared) {`,
    to: `        if (shared) {`,
    also: [
      [`          const trip = tripById(entry.tripId)
          if (trip && canEdit(roleOf(trip, scope.userId))) return false
          cache.trips = cache.trips.filter(t => t.id !== entry.tripId)`,
      `          cache.trips = cache.trips.filter(t => t.id !== entry.tripId)`],
    ],
  },
  {
    // Every scope guard between the queue read and the publication, at once.
    // The guards overlap, so removing one alone can leave the case covered by a
    // neighbour. The set is what holds the line.
    name: 'COLLECTIVE-all-discard-scope-guards',
    file: STORE,
    from: `      if (!current || !stillLive(scope, tripId, accessEpoch)) return false`,
    to: `      if (!current) return false`,
    also: [
      [`      if (!stillLive(scope, tripId, accessEpoch)) return false
      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))`,
      `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))`],
      [`      const token = await tripWriteToken(scope)
      if (!stillLive(scope, tripId, accessEpoch)) return false
      const refresh = await readForDiscard(tripId, token)`,
      `      const token = await tripWriteToken(scope)
      const refresh = await readForDiscard(tripId, token)`],
      [`      const refresh = await readForDiscard(tripId, token)
      if (!stillLive(scope, tripId, accessEpoch)) return false`,
      `      const refresh = await readForDiscard(tripId, token)`],
      [`      if (!stillLive(scope, tripId, accessEpoch)) {
        // The generation moved while the removal was in flight`,
      `      if (false) {
        // The generation moved while the removal was in flight`],
      [`      if (!stillLive(scope, tripId, accessEpoch)) return false
      if (latest) {`,
      `      if (latest) {`],
      [`        if (!stillLive(scope, tripId, accessEpoch)) return false
        const nextEpoch = invalidateTripWork(tripId, scope.userId)
        if (!stillLive(scope, tripId, nextEpoch)) return false`,
      `        const nextEpoch = invalidateTripWork(tripId, scope.userId)`],
    ],
  },
  {
    // B2: a local edit made during the refresh is newer than the plan the
    // refresh read. The queue recheck and the held-copy recheck overlap, so
    // both go together. Without them the discard publishes the server plan over
    // the newer edit.
    name: 'B2-newer-edit-during-the-refresh-is-published-over',
    file: STORE,
    from: `      if (latest) {`,
    to: `      if (false && latest) {`,
    also: [
      [`      if (held && !sameQueuedWrite(held, current)) return false
      queuedLocalTrips.delete(tripId)
      if (!refresh) {`,
      `      if (false && held && !sameQueuedWrite(held, current)) return false
      queuedLocalTrips.delete(tripId)
      if (!refresh) {`],
    ],
  },
  {
    // B3: a failed membership read is a failed read. The mutation turns it back
    // into an empty membership, which hides every role on screen.
    name: 'B3-membership-error-becomes-an-empty-list',
    file: STORE,
    from: `  if (memberRead.error || !Array.isArray(memberRead.data)) return null`,
    to: `  if (false) return null`,
    also: [
      [`  const members = (memberRead.data as MemberRow[]).map(m => ({`,
      `  const members = ((memberRead.data as MemberRow[] | null) ?? []).map(m => ({`],
    ],
  },
  {
    // A re-read that is still older than the server ledger must refuse the
    // discard. The mutation publishes the older plan instead.
    name: 'STALE-reread-older-than-the-ledger-is-published',
    file: STORE,
    from: `    if (isStaleServerRow(serverTripTimestamps.get(tripId), row.updated_at)) return null`,
    to: `    if (false) return null`,
  },
]

const invalid = UNKNOWN.length > 0 || !OUT
if (invalid) {
  console.error(`usage: node scripts/mutation-check.mjs <report-path> [--anchors-only] [--only=<name-part>]${UNKNOWN.length ? `\nunknown option: ${UNKNOWN.join(' ')}` : ''}`)
  process.exitCode = 2
} else {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
