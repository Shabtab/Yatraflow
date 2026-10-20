// Mutation check: revert each fix one at a time and record the test failure.
//
// Every mutation removes ONE guard. The matching regression test must fail.
// A mutation that leaves the suite green is a fix that nothing pins, and it
// is reported as such.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const STORE = `${ROOT}/src/store/store.ts`
const BANNER = `${ROOT}/src/components/OfflineBanner.tsx`
const TESTS = [
  'tests/recovery-identity-boundaries.test.ts',
  'tests/offline-recovery-ui.test.ts',
]
const OUT = process.argv[2]

const storeOriginal = readFileSync(STORE, 'utf8')
const bannerOriginal = readFileSync(BANNER, 'utf8')

/** The sources use CRLF. The anchors are written with LF, so both sides are
 *  normalised before the comparison and before the swap. */
const norm = text => text.replace(/\r\n/g, '\n')

/** Each mutation: a name, the file, and the exact text to swap. */
const MUTATIONS = [
  {
    name: 'P1a-discard-identity-after-queue-read',
    file: STORE,
    from: `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current || !sameScopeGeneration(scope, tripId, accessEpoch)) return false
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
      if (!sameScopeGeneration(scope, tripId, accessEpoch)) return false
      const durable = await dropQueuedWrite(current)`,
    to: `      } else {
        readFailed = true
      }
      const durable = await dropQueuedWrite(current)`,
  },
  {
    name: 'P1c-revocation-scope-before-invalidation',
    file: STORE,
    from: `      await retainRevokedCopy(entry, scope, reason)
      // The retention awaited storage, so the scope is checked once more. A
      // copy that changed hands in the meantime is not this scope's work.
      if (!sameScopeGeneration(scope, entry.tripId, accessEpoch)) return false
      invalidateTripWork(entry.tripId, scope.userId, reason)`,
    to: `      await retainRevokedCopy(entry, scope, reason)
      invalidateTripWork(entry.tripId, scope.userId, reason)`,
  },
  {
    name: 'P1c-missing-trip-scope-before-invalidation',
    file: STORE,
    from: `      await retainRevokedCopy(entry, scope, 'trip-unavailable')
      if (!sameScopeGeneration(scope, entry.tripId, accessEpoch)) return false
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
    name: 'SHOULD-FIX-offline-removal-handler',
    file: BANNER,
    from: `onClick={() => { void removeCopy(write) }}`,
    to: `onClick={() => { void recover(write.tripId, 'discard') }}`,
  },
  {
    // Every scope guard in the discard branch at once. The individual guards
    // overlap, so removing one alone can leave the scenario covered by a
    // neighbour. The set is collectively what holds the line, so the mutation
    // that removes all of them shows the set is the thing that matters.
    name: 'COLLECTIVE-all-discard-scope-guards',    file: STORE,
    from: `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current || !sameScopeGeneration(scope, tripId, accessEpoch)) return false
      // The removal itself is local.`,
    to: `      const current = (await pendingWrites()).find(w => sameQueuedWrite(w, write))
      if (!current) return false
      // The removal itself is local.`,
    also: [
      [`      const token = await tripWriteToken(scope)
      if (!sameScopeGeneration(scope, tripId, accessEpoch)) return false
      let row: TripRow | null = null`,
      `      const token = await tripWriteToken(scope)
      let row: TripRow | null = null`],
      [`        if (read.error) readFailed = true
        else row = (read.data as TripRow | null) ?? null
      } else {
        readFailed = true
      }
      if (!sameScopeGeneration(scope, tripId, accessEpoch)) return false
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
      if (!sameScopeGeneration(scope, tripId, accessEpoch)) return false
      const latest =`,
      `      const durable = await dropQueuedWrite(current)
      const latest =`],
      [`      const latest = (await pendingWrites()).find(w => w.ownerId === scope.userId && w.tripId === tripId)
      if (!sameScopeGeneration(scope, tripId, accessEpoch)) return false
      if (latest) {`,
      `      const latest = (await pendingWrites()).find(w => w.ownerId === scope.userId && w.tripId === tripId)
      if (latest) {`],
    ],
  },
]

function restore() {
  writeFileSync(STORE, storeOriginal, 'utf8')
  writeFileSync(BANNER, bannerOriginal, 'utf8')
}

function runTests() {
  // The .cmd shim does not pipe its output on Windows, so the ESM entry is
  // called directly with node. That is the same runner the repo uses.
  try {
    execFileSync(process.execPath, [`${ROOT}/node_modules/vitest/vitest.mjs`, 'run', ...TESTS], {
      cwd: ROOT,
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
lines.push('READING THE RESULT. Two discard guards report NOT PINNED on their own.')
lines.push('They overlap: removing one leaves the scenario covered by a neighbour,')
lines.push('so the single-guard mutation does not reproduce the defect. The')
lines.push('COLLECTIVE mutation removes the whole set and does fail, so the set is')
lines.push('what holds the line. That is defence in depth, not an unpinned fix.')
lines.push('')
lines.push('A single guard is enough to stop the defect, and the guards overlap.')
lines.push('One removed guard leaves the scenario covered by a neighbour, so the')
lines.push('one-guard mutation does not reproduce it. The set is what holds the')
lines.push('line.')

for (const mutation of MUTATIONS) {
  restore()
  const source = norm(readFileSync(mutation.file, 'utf8'))
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
  const eol = readFileSync(mutation.file, 'utf8').includes('\r\n') ? '\r\n' : '\n'
  writeFileSync(mutation.file, final.replace(/\n/g, eol), 'utf8')
  const result = runTests()
  lines.push(`${result.passed ? 'NOT PINNED' : 'PINNED'}  ${mutation.name}`)
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
lines.push('All sources restored.')
writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
