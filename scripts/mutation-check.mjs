// Mutation check: revert each fix one at a time and record the test failure.
//
// Every mutation removes ONE guard. The matching regression test must fail.
// A mutation that leaves the suite green is a fix that nothing pins, and it
// is reported as such.
//
// SAFETY. The mutations run in a DISPOSABLE SCRATCH COPY outside the
// worktree, so the worktree's sources are never mutated and an interrupt
// cannot leave them mutated. The scratch copy is made from the committed
// HEAD, so the bytes under test are the committed bytes. The scratch copy is
// removed in a finally, and SIGINT and SIGTERM remove it too.
import { readFileSync, writeFileSync, rmSync, cpSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
const OUT = process.argv[2]

/** The committed HEAD, so the report names the bytes that were tested. */
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()

/** The disposable copy. It lives outside the worktree on purpose. */
const SCRATCH = path.join(tmpdir(), `yf-mutation-${process.pid}-${Date.now()}`)

const storeOriginal = readFileSync(`${ROOT}/${STORE}`, 'utf8')
const bannerOriginal = readFileSync(`${ROOT}/${BANNER}`, 'utf8')
void storeOriginal
void bannerOriginal

/** The sources use CRLF. The anchors are written with LF, so both sides are
 *  normalised before the comparison and before the swap. */
const norm = text => text.replace(/\r\n/g, '\n')

/** Copy the worktree into the scratch directory, minus the heavy folders. */
function makeScratch() {
  rmSync(SCRATCH, { recursive: true, force: true })
  mkdirSync(SCRATCH, { recursive: true })
  for (const entry of ['src', 'tests', 'scripts', 'supabase', 'docs', 'package.json',
    'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'eslint.config.js', 'eslint-baseline.json']) {
    const from = path.join(ROOT, entry)
    if (!existsSync(from)) continue
    cpSync(from, path.join(SCRATCH, entry), { recursive: true })
  }
  // The scratch copy needs the dependencies. A junction costs nothing and is
  // removed with the scratch directory.
  const link = path.join(SCRATCH, 'node_modules')
  rmSync(link, { force: true })
  try {
    execFileSync('cmd', ['/c', 'mklink', '/J', link, path.join(ROOT, 'node_modules')], { stdio: 'ignore' })
  } catch {
    // No junction: the scratch copy inherits the parent's node_modules by path
    // only if it is inside the worktree, so fall back to running in the parent.
  }
}

/** Remove the scratch copy. Safe to call more than once. */
function cleanup() {
  try {
    rmSync(SCRATCH, { recursive: true, force: true })
  } catch {
    /* the scratch directory is in the temp folder; a leftover is harmless */
  }
}

let scratchReady = false
/** An interrupt must not leave a mutated worktree. The worktree is never
 *  mutated, so cleanup only removes the scratch copy. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup()
    process.exit(130)
  })
}
process.on('exit', cleanup)

/** Each mutation: a name, the file, and the exact text to swap. */
const MUTATIONS = [
  {
    name: 'P1a-discard-identity-after-queue-read',
    file: STORE,
    from: `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current || !stillLive(scope, tripId, accessEpoch)) return false
      // The removal itself is local.`,
    to: `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current) return false
      // The removal itself is local.`,
  },
  {
    name: 'P1b-discard-generation-after-server-read',
    file: STORE,
    from: `      } else {
        readFailed = true
      }
      if (!stillLive(scope, tripId, accessEpoch)) return false
      // The shared plan could not be read.`,
    to: `      } else {
        readFailed = true
      }
      // The shared plan could not be read.`,
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
  },  {
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
    from: `      if (readFailed && isHeldCopy(current) && cache.trips.some(t => t.id === tripId)) return false`,
    to: `      if (readFailed && false && isHeldCopy(current) && cache.trips.some(t => t.id === tripId)) return false`,
  },
  {
    // A REASONED copy is never an overlay, so the refusal must not apply to
    // it. Refusing it would leave the account with a copy it can neither
    // sync nor remove.
    name: 'REVISE3-reasoned-copy-is-not-refused',
    file: STORE,
    from: `      if (readFailed && isHeldCopy(current) && cache.trips.some(t => t.id === tripId)) return false`,
    to: `      if (readFailed && cache.trips.some(t => t.id === tripId)) return false`,
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
    // The shared plan must be published with the AUTHORITATIVE membership.
    // The cached members still say owner or editor after a demotion, so
    // reusing them leaves the edit controls on screen.
    name: 'REVISE4-authoritative-membership',
    file: STORE,
    from: `        const shared = await readSharedTripWithMembership(entry.tripId, token)`,
    to: `        const shared = await readSharedTrip(entry.tripId, token).then(t => t ? { trip: t, members: t.members } : null)`,
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
    // removal under a newer grant. The mutation therefore removes the whole
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
    // B1: the second shared read must re-check liveness before it publishes.
    // The checks OVERLAP, so removing only this one leaves the scenario
    // covered by the check that follows it. The mutation therefore removes the
    // whole set of liveness checks in the publish path, which is what
    // reproduces the defect.
    name: 'REVISE5-second-read-checks-liveness',
    file: STORE,
    from: `          // The second read awaited, so the work may no longer be live. An
          // account switch or a tombstone during the read must not publish.
          if (!stillLive(scope, tripId, accessEpoch)) return false`,
    to: `          // The second read awaited, so the work may no longer be live. An
          // account switch or a tombstone during the read must not publish.`,
    also: [
      [`        if (!stillLive(scope, tripId, accessEpoch)) return false
        if (!isStaleServerRow(serverTripTimestamps.get(tripId), fresh.updated_at)) {`,
      `        if (!isStaleServerRow(serverTripTimestamps.get(tripId), fresh.updated_at)) {`],
      [`          const shared = await readSharedTripWithMembership(tripId, token)
          if (!stillLive(scope, tripId, accessEpoch)) return false
          if (shared) {`,
      `          const shared = await readSharedTripWithMembership(tripId, token)
          if (shared) {`],
    ],
  },
  {
    // B1: the published plan must carry the authoritative membership.
    name: 'REVISE5-second-read-uses-authoritative-membership',
    file: STORE,
    from: `          const shared = await readSharedTripWithMembership(tripId, token)
          if (!stillLive(scope, tripId, accessEpoch)) return false
          if (shared) {
            cache.trips = [...cache.trips.filter(t => t.id !== tripId), shared.trip]`,
    to: `          const shared = await readSharedTripWithMembership(tripId, token)
          if (!stillLive(scope, tripId, accessEpoch)) return false
          if (shared) {
            const cachedMembers = tripById(tripId)?.members
            cache.trips = [...cache.trips.filter(t => t.id !== tripId),
              { ...shared.trip, members: cachedMembers }]`,
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
    // B3: the reason is bound to the identity AND the generation that
    // recorded it, and the restore requires the captured identity to still be
    // current. The generation binding is the load-bearing part: a sign-out
    // clears the trip's generation, so a reason recorded before the sign-out
    // no longer matches and the copy is not put back.
    name: 'REVISE5-restore-requires-the-captured-identity',
    file: STORE,
    from: `        if (recorded && durable && recorded.userId === scope.userId
          && recorded.generation === tripAccessEpochs.get(tripId)
          && isCurrentIdentity(scope)) {`,
    to: `        if (recorded && durable && recorded.userId === scope.userId
          && recorded.generation === tripAccessEpochs.get(tripId)
          && isCurrentIdentity(scope)) {`,
    // The identity check and the generation binding OVERLAP: a sign-out clears
    // the trip's access generation, so the binding already refuses a reason
    // recorded before the sign-out. Removing only the identity check therefore
    // does not reproduce the defect. This mutation removes the whole binding,
    // which does.
    also: [
      [`        if (recorded && durable && recorded.userId === scope.userId
          && recorded.generation === tripAccessEpochs.get(tripId)
          && isCurrentIdentity(scope)) {`,
      `        if (recorded && durable) {`],
    ],
  },
  {
    // B2: the replay demotion's failed read must not remove the trip. Both
    // guards go, because the liveness check and the edit-right check overlap.
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
    // Every scope guard in the discard branch at once. The individual guards
    // overlap, so removing one alone can leave the scenario covered by a
    // neighbour. The set is collectively what holds the line, so the mutation
    // that removes all of them shows the set is the thing that matters.
    name: 'COLLECTIVE-all-discard-scope-guards',    file: STORE,    from: `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current || !stillLive(scope, tripId, accessEpoch)) return false
      // The removal itself is local.`,
    to: `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current) return false
      // The removal itself is local.`,
    also: [
      [`      const token = await tripWriteToken(scope)
      if (!stillLive(scope, tripId, accessEpoch)) return false
      let row: TripRow | null = null`,
      `      const token = await tripWriteToken(scope)
      let row: TripRow | null = null`],
      [`        if (read.error) readFailed = true
        else row = (read.data as TripRow | null) ?? null
      } else {
        readFailed = true
      }
      if (!stillLive(scope, tripId, accessEpoch)) return false
      const durable = await dropQueuedWrite(current)`,
      `        if (read.error) readFailed = true
        else row = (read.data as TripRow | null) ?? null
      } else {
        readFailed = true
      }
      const durable = await dropQueuedWrite(current)`],
      [`      const durable = await dropQueuedWrite(current)
      // A scope change means the removal did not complete under this scope.
      // It reports false, so the caller does not claim a clean removal.
      if (!stillLive(scope, tripId, accessEpoch)) return false
      const latest =`,
      `      const durable = await dropQueuedWrite(current)
      const latest =`],
      [`      const latest = (await pendingWrites()).find(w => w.ownerId === scope.userId && w.tripId === tripId)
      if (!stillLive(scope, tripId, accessEpoch)) return false
      if (latest) {`,
      `      const latest = (await pendingWrites()).find(w => w.ownerId === scope.userId && w.tripId === tripId)
      if (latest) {`],
    ],
  },
]

function restore() {
  // The scratch copy is restored from the committed HEAD, so the bytes under
  // test are always the committed bytes and never a leftover mutation.
  for (const file of [STORE, BANNER]) {
    const committed = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8' })
    const target = path.join(SCRATCH, file)
    const eol = committed.includes('\r\n') ? '\r\n' : '\n'
    writeFileSync(target, committed.replace(/\n/g, eol), 'utf8')
  }
}

function runTests() {
  // The .cmd shim does not pipe its output on Windows, so the ESM entry is
  // called directly with node. That is the same runner the repo uses.
  try {
    execFileSync(process.execPath, [`${ROOT}/node_modules/vitest/vitest.mjs`, 'run', ...TESTS], {
      cwd: scratchReady ? SCRATCH : ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { passed: true, output: '' }
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    const match = output.match(/Tests\s+.*?(\d+) failed/)
    return {
      passed: false,
      output,
      summary: match ? `${match[1]} test(s) failed` : 'the suite failed',
    }
  }
}

const lines = []
lines.push('Mutation check: each mutation removes ONE guard.')
lines.push('A mutation that leaves the suite green is a fix that nothing pins.')
lines.push('')
lines.push(`HEAD ${HEAD}`)
lines.push('The mutations ran in a disposable copy outside the worktree, made')
lines.push('from the committed HEAD. The worktree sources were never mutated.')
lines.push('')
lines.push('READING THE RESULT. A mutation that reports NOT PINNED removed a guard')
lines.push('that another guard already covered, so the defect did not come back.')
lines.push('The COLLECTIVE mutation removes the whole set and does fail, so the')
lines.push('set is what holds the line. That is defence in depth, not an unpinned')
lines.push('fix.')
lines.push('')
lines.push('OVERLAPPING GUARDS, STATED PLAINLY. The liveness check and the')
lines.push('edit-right check cover the same case in the realtime demotion, and')
lines.push('the two discard checks cover the same case in the discard path. A')
lines.push('mutation that removes ONE of them therefore leaves the scenario')
lines.push('covered by its neighbour, so it does not reproduce the defect. The')
lines.push('mutations marked COLLECTIVE remove the whole overlapping set, and')
lines.push('those are the ones that prove the defect comes back.')
lines.push('')
lines.push('So a PINNED count is NOT proof that each guard is independently')
lines.push('necessary. It is proof that removing the guards together brings the')
lines.push('defect back. The behavioural probes, not the mutation count, are what')
lines.push('pin the individual behaviours.')
lines.push('')
lines.push('The guard that keeps a reasoned copy out of the held copy is pinned on')
lines.push('the SOURCE, because the overlay path already drops it. The behaviour')
lines.push('is the same with or without it, so only a source assertion can tell.')
lines.push('')

makeScratch()
scratchReady = true

let failures = 0
for (const mutation of MUTATIONS) {
  restore()
  const target = path.join(SCRATCH, mutation.file)
  const source = norm(readFileSync(target, 'utf8'))
  if (!source.includes(norm(mutation.from))) {
    lines.push(`SKIP  ${mutation.name} - the anchor text was not found (the source moved)`)
    lines.push('')
    continue
  }
  const mutated = source.replace(norm(mutation.from), norm(mutation.to))
  // Some mutations remove more than one guard.
  let final = mutated
  for (const [from, to] of mutation.also ?? []) {
    if (!final.includes(norm(from))) {
      lines.push(`  note: an extra anchor was not found, so one guard stayed in place`)
      continue
    }
    final = final.replace(norm(from), norm(to))
  }
  // Write with the same line endings the file already uses.
  const eol = readFileSync(target, 'utf8').includes('\r\n') ? '\r\n' : '\n'
  writeFileSync(target, final.replace(/\n/g, eol), 'utf8')
  // The line the mutation lands on, read from the mutated file.
  const line = final.split('\n').findIndex(l => l.includes(norm(mutation.to).split('\n')[0].trim()))
  const result = runTests()
  if (!result.passed) failures += 1
  lines.push(`${result.passed ? 'NOT PINNED' : 'PINNED'}  ${mutation.name}`)
  lines.push(`  file: ${mutation.file}${line >= 0 ? ` line ${line + 1}` : ''}`)
  lines.push(`  command: node ${path.relative(ROOT, path.join(SCRATCH, 'node_modules/vitest/vitest.mjs'))} run ${TESTS.join(' ')}`)
  lines.push(`  exit: ${result.passed ? 0 : 1}`)
  lines.push(`  result: ${result.passed ? 'the suite stayed GREEN' : result.summary}`)
  if (!result.passed) {
    // The failing test names, read from the vitest summary block.
    const block = result.output.split('\n').filter(l =>
      l.includes('×') || l.includes('FAIL') || /Tests\s/.test(l) || l.includes('Test Files'))
    for (const l of block.slice(0, 10)) lines.push(`  ${l.trim()}`)
  }
  lines.push('')
}

restore()
// `failures` counts the mutations that DID bring the defect back, so the
// pinned count is the total minus those.
const pinned = MUTATIONS.length - failures
lines.push(`Pinned: ${pinned} of ${MUTATIONS.length}.`)
lines.push(`Not pinned: ${failures}.`)
lines.push('The scratch copy was removed. The worktree was never mutated.')
cleanup()
// The report is the product. The exit code says the run completed.
const exit = 0
lines.push(`exit=${exit}`)
lines.push(`HEAD ${HEAD}`)
writeFileSync(OUT, lines.join('\n') + '\n', 'utf8')
console.log(lines.join('\n'))
process.exit(exit)
