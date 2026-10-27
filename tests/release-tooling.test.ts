import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { killed } from '../scripts/control-runs-r13.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
  // A stub stands in for the npm entry point so the layout is identical on
  // every platform. It refuses anything but the literal `run verify` the
  // verifier must pass, then runs the fixture script with node directly.
  function writeNpmStub(dir: string, marker?: string) {
    mkdirSync(path.join(dir, 'bin'), { recursive: true })
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'npm', version: '0.0.0-fixture', bin: { npm: 'bin/npm-cli.js' } }))
    writeFileSync(path.join(dir, 'bin', 'npm-cli.js'), [
      "const { spawnSync } = require('node:child_process')",
      ...(marker ? [`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`] : []),
      "const argv = process.argv.slice(2)",
      "if (argv.join(' ') !== 'run verify') { console.error('BAD_ARGV ' + JSON.stringify(argv)); process.exit(64) }",
      "const run = spawnSync(process.execPath, ['verify.cjs'], { stdio: 'inherit' })",
      "process.exit(typeof run.status === 'number' ? run.status : 70)",
      '',
    ].join('\n'))
    return path.join(dir, 'bin', 'npm-cli.js')
  }

  // The verifier shells out to git, so the child PATH needs git and nothing
  // else from the host. Inheriting host PATH would leak the real npm: npm
  // injects repo .bin directories, and module resolution walks up from them
  // into the install. The git directory is asserted not to expose npm at all.
  const gitDir = path.dirname((process.env.PATH ?? '').split(path.delimiter)
    .map((dir) => path.join(dir, process.platform === 'win32' ? 'git.exe' : 'git'))
    .find((candidate) => existsSync(candidate)) ?? '')
  const exposesNpm = (dir: string) => existsSync(path.join(dir, 'node_modules', 'npm'))
    || existsSync(path.join(dir, '..', 'lib', 'node_modules', 'npm'))

  type Layout = {
    runtimeNpm?: boolean
    pathNpm?: boolean
    competingNpm?: boolean
    lifecycleNpm?: boolean
    verifyExit?: number
  }

  function runFixture(layout: Layout) {
    const fixture = mkdtempSync(path.join(tmpdir(), 'release-tooling-'))
    fixtures.push(fixture)
    const cwd = path.join(fixture, 'repo & literal')
    const out = path.join(fixture, 'evidence')
    const wrapperBin = path.join(fixture, 'bin')
    const runtimeBin = path.join(fixture, 'runtime', 'bin')
    const prefixBin = path.join(fixture, 'prefix', 'bin')
    const competingBin = path.join(fixture, 'competing', 'bin')
    for (const dir of [cwd, out, wrapperBin, runtimeBin, prefixBin, competingBin]) mkdirSync(dir, { recursive: true })

    // The verifier derives its runtime prefix from process.execPath, so run it
    // under a linked node whose sibling `lib` the fixture controls on every
    // platform. A link is instant and keeps execPath at the fixture path.
    const nodeCopy = path.join(runtimeBin, process.platform === 'win32' ? 'node.exe' : 'node')
    try {
      linkSync(process.execPath, nodeCopy)
    } catch {
      copyFileSync(process.execPath, nodeCopy)
      if (process.platform !== 'win32') chmodSync(nodeCopy, 0o755)
    }
    const runtimeNpmCli = path.join(fixture, 'runtime', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const prefixNpmCli = path.join(fixture, 'prefix', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const lifecycleNpmCli = path.join(fixture, 'lifecycle & literal', 'bin', 'npm-cli.js')
    const competingMarker = path.join(fixture, 'competing-npm-ran')
    if (layout.runtimeNpm) writeNpmStub(path.join(fixture, 'runtime', 'lib', 'node_modules', 'npm'))
    if (layout.pathNpm) writeNpmStub(path.join(fixture, 'prefix', 'lib', 'node_modules', 'npm'))
    if (layout.lifecycleNpm) writeNpmStub(path.join(fixture, 'lifecycle & literal'))
    if (layout.competingNpm) writeNpmStub(path.join(fixture, 'competing', 'lib', 'node_modules', 'npm'), competingMarker)

    copyFileSync(path.join(root, 'scripts/verify-bound-r13.mjs'), path.join(cwd, 'verify-bound.mjs'))
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'local-verifier-fixture', version: '1.0.0', scripts: { verify: 'node verify.cjs' } }))
    writeFileSync(path.join(cwd, 'verify.cjs'), `console.log('REAL_VERIFY ' + process.env.NODE_ENV); console.error('REAL_STDERR'); process.exit(${layout.verifyExit ?? 0})`)

    // A wrapper named npm on PATH must never run: the verifier must not shell.
    const wrapperMarker = path.join(fixture, 'shell-wrapper-ran')
    writeFileSync(path.join(wrapperBin, process.platform === 'win32' ? 'npm.cmd' : 'npm'), process.platform === 'win32'
      ? `@echo unsafe>"${wrapperMarker}"\r\n@exit /b 0\r\n`
      : `#!/bin/sh\nprintf unsafe > '${wrapperMarker}'\nexit 0\n`, { mode: 0o755 })

    const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
    git(['init', '--quiet'])
    git(['add', '.'])
    git(['-c', 'user.name=Local QA', '-c', 'user.email=qa@example.invalid', '-c', 'core.hooksPath=hooks-disabled', 'commit', '--quiet', '-m', 'fixture'])

    expect(exposesNpm(gitDir)).toBe(false)
    const pathEntries = [wrapperBin, gitDir]
    if (layout.competingNpm) pathEntries.push(competingBin)
    if (layout.pathNpm) pathEntries.push(prefixBin)
    const env: NodeJS.ProcessEnv = { ...process.env, VERIFY_OUT: out, PATH: pathEntries.join(path.delimiter) }
    // npm exports npm_execpath and NODE_PATH to its children. Either would let
    // the host's real npm answer for a layout that is meant to have none.
    for (const key of Object.keys(env)) {
      if (['npm_execpath', 'node_path'].includes(key.toLowerCase())) delete env[key]
    }
    if (layout.lifecycleNpm) env.npm_execpath = lifecycleNpmCli

    const result = spawnSync(nodeCopy, ['verify-bound.mjs'], { cwd, env, encoding: 'utf8' })
    const bindingPath = path.join(out, 'verify-binding.json')
    expect(existsSync(wrapperMarker)).toBe(false)
    if (layout.competingNpm) expect(existsSync(competingMarker)).toBe(false)

    return {
      result,
      nodeCopy,
      runtimeNpmCli,
      prefixNpmCli,
      lifecycleNpmCli,
      binding: existsSync(bindingPath) ? JSON.parse(readFileSync(bindingPath, 'utf8')) : null,
      raw: existsSync(path.join(out, 'verify-raw.log')) ? readFileSync(path.join(out, 'verify-raw.log'), 'utf8') : '',
      git,
    }
  }

  function expectPassed(binding: any, raw: string, exitCode: number) {
    expect(raw).toContain('REAL_VERIFY test')
    expect(raw).toContain('REAL_STDERR')
    expect(raw).not.toContain('DEP0190')
    expect(binding).toMatchObject({
      verdict: exitCode === 0 ? 'PASS' : 'FAIL',
      exitCode,
      shaStable: true,
      dirtyBefore: false,
      dirtyAfter: false,
      trackedFileCount: 3,
      changedDuringRun: [],
    })
  }

  it('uses the npm CLI named by the lifecycle path and records success', () => {
    const { result, nodeCopy, lifecycleNpmCli, binding, raw } = runFixture({ lifecycleNpm: true })
    expect(result.status).toBe(0)
    expectPassed(binding, raw, 0)
    expect(binding.command).toEqual([nodeCopy, lifecycleNpmCli, 'run', 'verify'])
  })

  it('resolves the npm CLI from the runtime prefix without a PATH shell wrapper', () => {
    const { result, nodeCopy, runtimeNpmCli, binding, raw, git } = runFixture({ runtimeNpm: true })
    expect(result.status).toBe(0)
    expectPassed(binding, raw, 0)
    expect(binding.command).toEqual([nodeCopy, runtimeNpmCli, 'run', 'verify'])
    expect(binding.commit).toBe(git(['rev-parse', 'HEAD']).trim())
  })

  it('prefers the runtime prefix over a different npm prefix on PATH', () => {
    const { result, nodeCopy, runtimeNpmCli, binding, raw } = runFixture({ runtimeNpm: true, competingNpm: true })
    expect(result.status).toBe(0)
    expectPassed(binding, raw, 0)
    expect(binding.command).toEqual([nodeCopy, runtimeNpmCli, 'run', 'verify'])
  })

  it('falls back to an install prefix on PATH when the runtime has no npm', () => {
    const { result, nodeCopy, prefixNpmCli, binding, raw } = runFixture({ pathNpm: true })
    expect(result.status).toBe(0)
    expectPassed(binding, raw, 0)
    expect(binding.command).toEqual([nodeCopy, prefixNpmCli, 'run', 'verify'])
  })

  it('fails closed instead of running verify when no npm CLI resolves', () => {
    const { result, binding, raw } = runFixture({})
    expect(result.status).not.toBe(0)
    expect(binding).toBeNull()
    expect(raw).toBe('')
    expect(`${result.stdout}${result.stderr}`).not.toContain('REAL_VERIFY')
    expect(`${result.stdout}${result.stderr}`).toContain('npm')
  })

  it('keeps a failing real npm verify status and its durable transcript', () => {
    const { result, binding, raw } = runFixture({ runtimeNpm: true, verifyExit: 7 })
    expect(result.status).toBe(2)
    expectPassed(binding, raw, 7)
    expect(binding.verdict).toBe('FAIL')
  })
})
