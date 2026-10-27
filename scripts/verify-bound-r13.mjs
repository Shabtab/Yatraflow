// SHA-bound verification for the r13 repair. Records the commit identity and
// every tracked-file hash BEFORE and AFTER one full `npm run verify` run, in
// the same invocation, so the result cannot belong to another tree.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const OUT = process.env.VERIFY_OUT
if (!OUT) throw new Error('VERIFY_OUT must name the evidence directory')

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function identity() {
  const head = git(['rev-parse', 'HEAD']).trim()
  const status = git(['status', '--porcelain'])
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean)
  const hashes = {}
  for (const f of files) {
    try {
      hashes[f] = sha256(execFileSync('git', ['show', `HEAD:${f}`], { maxBuffer: 64 * 1024 * 1024 }))
    } catch {
      hashes[f] = 'UNREADABLE'
    }
  }
  return { when: new Date().toISOString(), head, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), status, trackedFileCount: files.length, hashes }
}

const before = identity()
const started = new Date().toISOString()
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(
  createRequire(import.meta.url).resolve('npm/package.json', {
    paths: [path.dirname(process.execPath), ...(process.env.PATH ?? '').split(path.delimiter)]
      .flatMap((dir) => [dir, path.resolve(dir, '..', 'lib')]),
  }),
), 'bin', 'npm-cli.js')
const r = spawnSync(process.execPath, [npmCli, 'run', 'verify'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'test' },
  maxBuffer: 128 * 1024 * 1024,
})
const ended = new Date().toISOString()
const after = identity()

const changedDuringRun = Object.keys(before.hashes).filter((f) => before.hashes[f] !== after.hashes[f])
const binding = {
  verdict: r.status === 0 ? 'PASS' : 'FAIL',
  exitCode: r.status,
  command: [process.execPath, npmCli, 'run', 'verify'],
  started,
  ended,
  commit: before.head,
  branch: before.branch,
  shaStable: before.head === after.head,
  dirtyBefore: before.status.trim() !== '',
  dirtyAfter: after.status.trim() !== '',
  trackedFileCount: before.trackedFileCount,
  changedDuringRun,
  before,
  after,
}

writeFileSync(`${OUT}/verify-binding.json`, JSON.stringify(binding, null, 1))
writeFileSync(`${OUT}/verify-raw.log`, `exit ${r.status}\nstarted ${started}\nended ${ended}\n\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`)

console.log(JSON.stringify({
  verdict: binding.verdict,
  exitCode: binding.exitCode,
  commit: binding.commit,
  branch: binding.branch,
  shaStable: binding.shaStable,
  dirtyBefore: binding.dirtyBefore,
  dirtyAfter: binding.dirtyAfter,
  trackedFileCount: binding.trackedFileCount,
  changedDuringRun: changedDuringRun.length,
}, null, 1))
if (r.status !== 0 || !binding.shaStable || changedDuringRun.length) process.exitCode = 2
