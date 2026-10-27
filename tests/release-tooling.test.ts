import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { killed } from '../scripts/control-runs-r13.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmPackage = path.dirname(createRequire(import.meta.url).resolve('npm/package.json', {
  paths: [path.dirname(process.execPath), ...(process.env.PATH ?? '').split(path.delimiter)],
}))
const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

describe('named mutation failure', () => {
  const title = 'keeps [a.b] (x+y)? $literal × inside'
  it('matches the literal title after an ANSI-colored failure cross', () => {
    expect(killed({ status: 1, stdout: ` × \u001b[31m${title}\u001b[0m 4ms` }, title)).toBe(true)
  })
  it.each([
    { status: 0, stdout: ` × ${title}` },
    { status: 1, stdout: ` ✓ ${title}\n × a different assertion` },
    { status: 1, stdout: 'Test Files 1 failed\nCannot find module' },
    { status: 1, stdout: ' × keeps aXb xxy literal' },
  ])('does not count an unrelated failure as a kill: %j', (run) => {
    expect(killed(run, title)).toBe(false)
  })
})

describe('SHA-bound verifier process', () => {
  function runFixture(exitCode: number, lifecyclePath: boolean) {
    const fixture = mkdtempSync(path.join(tmpdir(), 'release-tooling-'))
    fixtures.push(fixture)
    const cwd = path.join(fixture, 'repo & literal')
    const out = path.join(fixture, 'evidence')
    const bin = path.join(fixture, 'bin')
    for (const dir of [cwd, out, bin]) mkdirSync(dir)
    const npmLink = path.join(fixture, 'npm & literal')
    symlinkSync(npmPackage, npmLink, process.platform === 'win32' ? 'junction' : 'dir')
    copyFileSync(path.join(root, 'scripts/verify-bound-r13.mjs'), path.join(cwd, 'verify-bound.mjs'))
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'local-verifier-fixture', version: '1.0.0', scripts: { verify: 'node verify.cjs' } }))
    writeFileSync(path.join(cwd, 'verify.cjs'), `console.log('REAL_VERIFY ' + process.env.NODE_ENV); console.error('REAL_STDERR'); process.exit(${exitCode})`)
    const marker = path.join(fixture, 'shell-wrapper-ran')
    const wrapper = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    writeFileSync(path.join(bin, wrapper), process.platform === 'win32'
      ? `@echo unsafe>"${marker}"\r\n@exit /b 0\r\n`
      : `#!/bin/sh\nprintf unsafe > '${marker}'\nexit 0\n`, { mode: 0o755 })
    const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
    git(['init', '--quiet'])
    git(['add', '.'])
    git(['-c', 'user.name=Local QA', '-c', 'user.email=qa@example.invalid', '-c', 'core.hooksPath=hooks-disabled', 'commit', '--quiet', '-m', 'fixture'])
    const env = { ...process.env, VERIFY_OUT: out, PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter) }
    if (lifecyclePath) env.npm_execpath = path.join(npmLink, 'bin', 'npm-cli.js')
    else delete env.npm_execpath
    const result = spawnSync(process.execPath, ['verify-bound.mjs'], { cwd, env, encoding: 'utf8' })
    const binding = JSON.parse(readFileSync(path.join(out, 'verify-binding.json'), 'utf8'))
    const raw = readFileSync(path.join(out, 'verify-raw.log'), 'utf8')
    expect(existsSync(marker)).toBe(false)
    expect(raw).toContain('REAL_VERIFY test')
    expect(raw).toContain('REAL_STDERR')
    expect(raw).not.toContain('DEP0190')
    expect(binding).toMatchObject({ exitCode, commit: git(['rev-parse', 'HEAD']).trim(), shaStable: true, dirtyBefore: false, dirtyAfter: false, trackedFileCount: 3, changedDuringRun: [] })
    expect(binding.command).toEqual([process.execPath, path.join(lifecyclePath ? npmLink : npmPackage, 'bin', 'npm-cli.js'), 'run', 'verify'])
    return { result, binding }
  }

  it('uses the real npm CLI at a literal lifecycle path and records success', () => {
    const { result, binding } = runFixture(0, true)
    expect(result.status).toBe(0)
    expect(binding.verdict).toBe('PASS')
  })
  it('resolves installed npm without a lifecycle path or a PATH shell wrapper', () => {
    const { result, binding } = runFixture(0, false)
    expect(result.status).toBe(0)
    expect(binding.verdict).toBe('PASS')
  })
  it('keeps a failing real npm verify status and its durable transcript', () => {
    const { result, binding } = runFixture(7, true)
    expect(result.status).toBe(2)
    expect(binding.verdict).toBe('FAIL')
  })
})
