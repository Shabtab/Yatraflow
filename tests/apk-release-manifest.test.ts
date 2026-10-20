// scripts/apk-release-manifest.mjs — the release gate for the APK update feed.
//
// These are behavioural tests, not source-text pins. Each one drives the real
// functions with injected SDK fixtures and a fake spawn, so the gate's decisions
// are measured rather than restated. The three defects this file was written to
// close, and the case that would have caught each:
//
//   R1  aapt2 was resolved as `aapt2.bat`, which does not exist  -> resolution
//   R2  apksigner.bat was spawned without a shell                 -> invocation
//   R3  any valid signer passed; the expected key was never used  -> fingerprint
//   R4  a code BELOW the highest published one was accepted       -> version floor
//
// No test here needs the Android SDK, a JRE, or a signing key. The SDK shape is
// built as fixtures in a temp directory; the spawn is a stub.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildToolsVersions,
  checkSignature,
  highestPublishedVersionCode,
  normaliseFingerprint,
  parseCertDigests,
  parseCertDn,
  PUBLISHED_VERSION_CODES,
  readApkIdentity,
  releaseProblems,
  resolveTool,
  TOOL_FILES,
} from '../scripts/apk-release-manifest.mjs'

// The real audit certificate from this workstream's own build evidence. A
// PUBLIC fingerprint: it identifies the throwaway audit key and is not a secret.
const AUDIT_CERT_SHA256 = '8e4c634df4bb72af022d5a9da9ae8ebfc4c5a8377ea61ad7ee59f0e9fecd25f8'

// Every case names its platform explicitly, so the Windows regression runs on
// the Linux CI runner the gate actually uses.
const WIN = 'win32' as const
const POSIX = 'linux' as const

const APKSIGNER_OUTPUT = [
  'Verifies',
  'Verified using v2 scheme (APK Signature Scheme v2): true',
  'Number of signers: 1',
  'Signer #1 certificate DN: CN=YatraFlow T3 Audit Test, OU=Local Test Only, O=T3 Audit, C=IN',
  'Signer #1 certificate SHA-256 digest: 8e4c634df4bb72af022d5a9da9ae8ebfc4c5a8377ea61ad7ee59f0e9fecd25f8',
  'Signer #1 certificate SHA-1 digest: 0000000000000000000000000000000000000000',
  'Signer #1 certificate MD5 digest: 00000000000000000000000000000000',
  '',
].join('\n')

const BADGING = [
  "package: name='app.yatraflow.mobile.t3audit' versionCode='15' versionName='0.15-native' platformBuildVersionName='16'",
  'sdkVersion:\'24\'',
  'targetSdkVersion:\'36\'',
  '',
].join('\n')

const temps: string[] = []

/**
 * Builds a fake SDK tree. `tools` names the files to create per build-tools
 * version, so a test can reproduce the real Windows shape (aapt2.exe plus
 * apksigner.bat) or a broken one.
 */
function fakeSdk(toolsByVersion: Record<string, string[]>) {
  const root = mkdtempSync(path.join(tmpdir(), 'apk-manifest-'))
  temps.push(root)
  const home = path.join(root, 'sdk')
  for (const [version, files] of Object.entries(toolsByVersion)) {
    const dir = path.join(home, 'build-tools', version)
    mkdirSync(dir, { recursive: true })
    for (const f of files) writeFileSync(path.join(dir, f), '', 'utf8')
  }
  return { home, buildTools: path.join(home, 'build-tools') }
}

/** A spawn stub that answers by executable name. */
function fakeSpawn(answers: Record<string, { status?: number; stdout?: string; stderr?: string; error?: Error }>) {
  return vi.fn((file: string, args: string[]) => {
    const key = Object.keys(answers).find((k) => file.includes(k))
    const a = key ? answers[key] : { status: 0, stdout: '', stderr: '' }
    if (a.error) return { error: a.error, status: null, stdout: '', stderr: '', args }
    return {
      error: undefined,
      status: a.status ?? 0,
      stdout: a.stdout ?? '',
      stderr: a.stderr ?? '',
      args,
    }
  })
}

afterEach(() => {
  while (temps.length) {
    const t = temps.pop()
    if (t) rmSync(t, { recursive: true, force: true })
  }
})

describe('R1 — tool resolution picks the file the platform actually ships', () => {

  it('resolves aapt2.exe, not aapt2.bat, for the real Windows build-tools shape', () => {
    // The shape that broke the script: aapt2 exists ONLY as .exe, while
    // apksigner exists only as .bat. Both live in the same directory.
    const { buildTools } = fakeSdk({ '36.0.0': ['aapt2.exe', 'aapt.exe', 'apksigner.bat', 'zipalign.exe'] })
    expect(resolveTool('aapt2', buildTools, WIN).fileName).toBe('aapt2.exe')
    expect(resolveTool('apksigner', buildTools, WIN).fileName).toBe('apksigner.bat')
  })

  it('never asks for a .bat when the tool ships as an .exe', () => {
    // The regression in one assertion: the old code appended .bat to EVERY tool.
    const { buildTools } = fakeSdk({ '36.0.0': ['aapt2.exe', 'apksigner.bat'] })
    const aapt2 = resolveTool('aapt2', buildTools, WIN)
    const signer = resolveTool('apksigner', buildTools, WIN)
    expect(aapt2.file.endsWith('aapt2.exe')).toBe(true)
    expect(signer.file.endsWith('apksigner.bat')).toBe(true)
    // The two tools must not share one suffix rule.
    expect(aapt2.fileName).not.toBe(signer.fileName)
  })

  it('the OLD rule would have failed: aapt2.bat does not exist in this shape', () => {
    // This is what the defect did: `${name}.bat` for every tool. Prove the file
    // it looked for is absent, so the failure is reproduced, not assumed.
    const { buildTools } = fakeSdk({ '36.0.0': ['aapt2.exe', 'apksigner.bat'] })
    const oldStyle = path.join(buildTools, '36.0.0', 'aapt2.bat')
    expect(existsSync(oldStyle)).toBe(false)
    // The repaired resolver finds the tool the old one missed.
    expect(existsSync(resolveTool('aapt2', buildTools, WIN).file)).toBe(true)
  })

  it('resolves the bare name on a POSIX platform', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['aapt2', 'apksigner'] })
    expect(resolveTool('aapt2', buildTools, POSIX).fileName).toBe('aapt2')
    expect(resolveTool('apksigner', buildTools, POSIX).fileName).toBe('apksigner')
  })

  it('reports a genuinely missing tool under its real file name', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat'] })
    expect(() => resolveTool('aapt2', buildTools, WIN)).toThrow(/aapt2\.exe was not found/)
    // The message must not claim a name that never existed on this platform.
    try {
      resolveTool('aapt2', buildTools, WIN)
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('aapt2.bat')
    }
  })

  it('prefers the newest build-tools version, compared numerically', () => {
    const { buildTools } = fakeSdk({
      '9.0.0': ['aapt2.exe'],
      '35.0.0': ['aapt2.exe'],
      '36.0.0': ['aapt2.exe'],
    })
    // Lexical sort would put 9.0.0 above 36.0.0.
    expect(buildToolsVersions(buildTools)[0]).toBe('36.0.0')
    expect(resolveTool('aapt2', buildTools, WIN).version).toBe('36.0.0')
  })

  it('falls back to an older build-tools that does have the tool', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat'], '35.0.0': ['aapt2.exe', 'apksigner.bat'] })
    expect(resolveTool('aapt2', buildTools, WIN).version).toBe('35.0.0')
  })

  it('declares one file name per tool, so no suffix rule can apply to all', () => {
    expect(TOOL_FILES.aapt2.win32).toBe('aapt2.exe')
    expect(TOOL_FILES.apksigner.win32).toBe('apksigner.bat')
    expect(TOOL_FILES.aapt2.win32).not.toBe(TOOL_FILES.apksigner.win32)
  })
})

describe('R2 — apksigner is launched as a jar, and a launch fault is not a verify failure', () => {
  it('runs java with -jar and the build-tools apksigner.jar, not the .bat', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['aapt2.exe', 'apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: APKSIGNER_OUTPUT } })
    const r = checkSignature('/tmp/x.apk', AUDIT_CERT_SHA256, {
      buildTools,
      env: { JAVA_HOME: '' } as NodeJS.ProcessEnv,
      spawnSync: spawn,
      platform: WIN,
    })
    expect(r.signer?.sha256).toBe(AUDIT_CERT_SHA256)

    const [exe, args] = spawn.mock.calls[0]
    expect(String(exe)).not.toMatch(/apksigner\.bat$/)
    expect(args.slice(0, 3)).toEqual(['-jar', path.join(buildTools, '36.0.0', 'apksigner.jar'), 'verify'])
    expect(args).toContain('--print-certs')
    expect(args).toContain('/tmp/x.apk')
  })

  it('passes the APK path as one argument, so a space cannot split it', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: APKSIGNER_OUTPUT } })
    const spaced = 'C:\\Users\\a b\\my app.apk'
    checkSignature(spaced, AUDIT_CERT_SHA256, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    const [, args] = spawn.mock.calls[0]
    expect(args).toContain(spaced)
    // No argument is a concatenation of the path with other text.
    expect(args.some((a: string) => a !== spaced && a.includes('my app.apk'))).toBe(false)
  })

  it('reports a launch fault as a tool error, not as an invalid APK', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { error: new Error('spawn EINVAL') } })
    // Exit 2 = environment. Exit 1 would blame the artifact.
    expect(() => checkSignature('/tmp/x.apk', AUDIT_CERT_SHA256, { buildTools, env: {}, spawnSync: spawn, platform: WIN }))
      .toThrow(/apksigner could not run/)
    try {
      checkSignature('/tmp/x.apk', AUDIT_CERT_SHA256, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    } catch (err) {
      expect((err as { code: number }).code).toBe(2)
    }
  })

  it('reports a verify failure as a verify failure, not a tool error', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 1, stderr: 'DOES NOT VERIFY' } })
    const r = checkSignature('/tmp/x.apk', AUDIT_CERT_SHA256, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    expect(r.problem).toMatch(/apksigner did not verify the APK/)
    expect(r.problem).toContain('DOES NOT VERIFY')
    expect(r.signer).toBeUndefined()
  })
})

describe('R3 — the signer is pinned to an expected public fingerprint', () => {
  it('accepts an APK whose certificate digest equals the expected one', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: APKSIGNER_OUTPUT } })
    const r = checkSignature('/tmp/x.apk', AUDIT_CERT_SHA256, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    expect(r.problem).toBeUndefined()
    expect(r.signer.sha256).toBe(AUDIT_CERT_SHA256)
    expect(r.signer.dn).toContain('YatraFlow T3 Audit Test')
  })

  it('REJECTS an APK signed with a different key even though verify succeeds', () => {
    // This is the defect R3 named: `verify` passing proves integrity, not
    // identity. A wrong-key release would be offered to users who cannot
    // install it, because Android refuses a signer change.
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const otherKey = 'f'.repeat(64)
    const spawn = fakeSpawn({ java: { status: 0, stdout: APKSIGNER_OUTPUT } })
    const r = checkSignature('/tmp/x.apk', otherKey, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    expect(r.problem).toMatch(/does not match the expected certificate/)
    expect(r.problem).toContain(AUDIT_CERT_SHA256)
    expect(r.actual).toBe(AUDIT_CERT_SHA256)
    expect(r.signer).toBeUndefined()
  })

  it('refuses to run when no expected fingerprint is given', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: APKSIGNER_OUTPUT } })
    // Exit 2: an unpinned check is a usage error, not a failed verification.
    expect(() => checkSignature('/tmp/x.apk', '', { buildTools, env: {}, spawnSync: spawn, platform: WIN }))
      .toThrow(/--expect-signer-sha256 is needed/)
    // It must not even consult the APK: an unpinned check proves nothing.
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects a fingerprint that is not a SHA-256 certificate digest', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: APKSIGNER_OUTPUT } })
    for (const bad of ['abc', 'not-a-digest', 'z'.repeat(64)]) {
      expect(() => checkSignature('/tmp/x.apk', bad, { buildTools, env: {}, spawnSync: spawn, platform: WIN }))
        .toThrow(/is not a SHA-256 certificate digest/)
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it('normalises colons, spaces and case before comparing', () => {
    expect(normaliseFingerprint('8E:4C:63:4D')).toBe('8e4c634d')
    expect(normaliseFingerprint(' 8e4c 634d ')).toBe('8e4c634d')
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: APKSIGNER_OUTPUT } })
    const colonised = AUDIT_CERT_SHA256.toUpperCase().match(/.{2}/g)!.join(':')
    const r = checkSignature('/tmp/x.apk', colonised, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    expect(r.problem).toBeUndefined()
  })

  it('reads the digest from apksigner output rather than trusting the DN', () => {
    const digests = parseCertDigests(APKSIGNER_OUTPUT)
    expect(digests.find((d) => d.algorithm === 'SHA-256')?.hex).toBe(AUDIT_CERT_SHA256)
    expect(parseCertDn(APKSIGNER_OUTPUT)).toContain('CN=YatraFlow T3 Audit Test')
  })

  it('fails closed when apksigner prints no SHA-256 digest', () => {
    const noDigest = APKSIGNER_OUTPUT.split('\n').filter((l) => !l.includes('SHA-256')).join('\n')
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: noDigest } })
    const r = checkSignature('/tmp/x.apk', AUDIT_CERT_SHA256, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    expect(r.problem).toMatch(/printed no SHA-256 certificate digest/)
  })

  it('REJECTS a multi-signer APK even when one signer matches the expected one', () => {
    // The hole a plain `find()` left: take the first digest, match it, pass.
    // An APK that is (expected signer) + (unrelated signer) cannot update an
    // app installed from a single-signer build, so it must not be offered.
    const second = 'b'.repeat(64)
    const twoSigners = APKSIGNER_OUTPUT
      + 'Signer #2 certificate DN: CN=Some Other Key, O=Elsewhere\n'
      + `Signer #2 certificate SHA-256 digest: ${second}\n`
      + `Signer #2 certificate SHA-1 digest: ${'1'.repeat(40)}\n`
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: twoSigners } })
    const r = checkSignature('/tmp/x.apk', AUDIT_CERT_SHA256, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    expect(r.problem).toMatch(/carries 2 signers/)
    expect(r.problem).toMatch(/exactly one expected signer is supported/)
    expect(r.signer).toBeUndefined()
    // Both digests are reported, so the failure is diagnosable.
    expect(r.signers).toEqual([AUDIT_CERT_SHA256, second])
  })

  it('rejects a multi-signer APK whose expected signer is NOT among the signers', () => {
    const other = 'c'.repeat(64)
    const third = 'd'.repeat(64)
    const twoSigners = `Signer #1 certificate DN: CN=A\nSigner #1 certificate SHA-256 digest: ${other}\n`
      + `Signer #2 certificate DN: CN=B\nSigner #2 certificate SHA-256 digest: ${third}\n`
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: twoSigners } })
    const r = checkSignature('/tmp/x.apk', AUDIT_CERT_SHA256, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    // Still refused, and for the count rather than a misleading mismatch.
    expect(r.problem).toMatch(/carries 2 signers/)
  })

  it('accepts a single signer, so the guard is not over-broad', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat', 'apksigner.jar'] })
    const spawn = fakeSpawn({ java: { status: 0, stdout: APKSIGNER_OUTPUT } })
    const r = checkSignature('/tmp/x.apk', AUDIT_CERT_SHA256, { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    expect(r.problem).toBeUndefined()
    expect(r.signer.sha256).toBe(AUDIT_CERT_SHA256)
  })
})

describe('R4 — a release code must EXCEED every published code', () => {
  const identity = (versionCode: number) => ({
    packageId: 'app.yatraflow.mobile',
    versionCode,
    versionName: `0.${versionCode}-native`,
  })
  const good = {
    channel: 'production',
    downloadUrl: 'https://www.yatraflow.in/android/yatraflow.apk',
    hosts: ['www.yatraflow.in'],
    signerCheck: { signer: { sha256: AUDIT_CERT_SHA256, dn: null } },
  }

  it('the published floor is the MAXIMUM, not the last entry', () => {
    expect(highestPublishedVersionCode([14])).toBe(14)
    expect(highestPublishedVersionCode([9, 14, 12])).toBe(14)
    expect(highestPublishedVersionCode([])).toBe(0)
    expect(highestPublishedVersionCode()).toBe(Math.max(...PUBLISHED_VERSION_CODES))
  })

  it('rejects code 13, which equality against [14] used to accept', () => {
    // The exact regression: `[14].includes(13)` is false, so the old check
    // emitted a manifest the client compares as 13 <= 14 and never offers.
    const problems = releaseProblems({ ...good, identity: identity(13) })
    expect(problems.some((p) => /not above the highest published code 14/.test(p))).toBe(true)
  })

  it('rejects the published code 14 itself', () => {
    const problems = releaseProblems({ ...good, identity: identity(14) })
    expect(problems.some((p) => /not above the highest published code 14/.test(p))).toBe(true)
  })

  it('accepts code 15', () => {
    const problems = releaseProblems({ ...good, identity: identity(15) })
    expect(problems).toEqual([])
  })

  it('rejects a non-integer or non-positive code', () => {
    for (const code of [0, -1, 1.5, Number.NaN]) {
      const problems = releaseProblems({ ...good, identity: identity(code) })
      expect(problems.some((p) => /is not a positive integer/.test(p))).toBe(true)
    }
  })

  it('the message states the bound it enforced', () => {
    const problems = releaseProblems({ ...good, identity: identity(13) })
    const msg = problems.join('\n')
    expect(msg).toContain('14')
    expect(msg).toMatch(/needs a higher one/)
  })
})

describe('the release gate as a whole', () => {
  const base = {
    identity: { packageId: 'app.yatraflow.mobile', versionCode: 15, versionName: '0.15-native' },
    channel: 'production',
    downloadUrl: 'https://www.yatraflow.in/android/yatraflow.apk',
    hosts: ['www.yatraflow.in'],
    signerCheck: { signer: { sha256: AUDIT_CERT_SHA256, dn: null } },
  }

  it('passes a well-formed release', () => {
    expect(releaseProblems(base)).toEqual([])
  })

  it('refuses a package that belongs to the other channel', () => {
    const problems = releaseProblems({
      ...base,
      identity: { ...base.identity, packageId: 'app.yatraflow.mobile.t3audit' },
    })
    expect(problems.some((p) => /must ship as app\.yatraflow\.mobile/.test(p))).toBe(true)
  })

  it('refuses an unknown channel', () => {
    const problems = releaseProblems({ ...base, channel: 'beta' })
    expect(problems.some((p) => /channel beta is unknown/.test(p))).toBe(true)
  })

  it('keeps every destination guard', () => {
    // Built from parts: the guard must reject embedded userinfo, and writing a
    // literal `user:pass@` in a source file is itself a bad habit.
    const withCredentials = `https://${'user'}:${'secret'}@www.yatraflow.in/a.apk`
    const cases: Array<[string, RegExp]> = [
      ['http://www.yatraflow.in/a.apk', /not HTTPS/],
      ['https://evil.test/a.apk', /is not an approved host/],
      [withCredentials, /carries credentials/],
      ['https://www.yatraflow.in:8443/a.apk', /non-default port/],
      ['', /is missing/],
      ['not a url', /is not a URL/],
    ]
    for (const [url, expected] of cases) {
      const problems = releaseProblems({ ...base, downloadUrl: url })
      expect(problems.some((p) => expected.test(p)), `expected ${expected} for ${url}`).toBe(true)
    }
  })

  it('refuses when no host is approved', () => {
    const problems = releaseProblems({ ...base, hosts: [] })
    expect(problems.some((p) => /no approved hosts/.test(p))).toBe(true)
  })

  it('carries a signer problem through to the failure list', () => {
    const problems = releaseProblems({ ...base, signerCheck: { problem: 'signer mismatch' } })
    expect(problems).toContain('signer mismatch')
  })

  it('accepts the audit channel for the audit package', () => {
    const problems = releaseProblems({
      ...base,
      channel: 'audit',
      identity: { packageId: 'app.yatraflow.mobile.t3audit', versionCode: 15, versionName: '0.15-native' },
    })
    expect(problems).toEqual([])
  })
})

describe('APK identity is read through the resolved aapt2, not a hard-coded name', () => {
  it('runs aapt2 dump badging and parses the package line', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['aapt2.exe', 'apksigner.bat'] })
    const spawn = fakeSpawn({ aapt2: { status: 0, stdout: BADGING } })
    const id = readApkIdentity('/tmp/x.apk', { buildTools, env: {}, spawnSync: spawn, platform: WIN })
    expect(id).toEqual({
      packageId: 'app.yatraflow.mobile.t3audit',
      versionCode: 15,
      versionName: '0.15-native',
    })
    const [exe, args] = spawn.mock.calls[0]
    expect(path.basename(String(exe))).toMatch(/^aapt2(\.exe)?$/)
    expect(args).toEqual(['dump', 'badging', '/tmp/x.apk'])
  })

  it('treats a missing tool as an environment error, not a bad APK', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['apksigner.bat'] })
    expect(() => readApkIdentity('/tmp/x.apk', { buildTools, env: {}, spawnSync: fakeSpawn({}), platform: WIN }))
      .toThrow(/aapt2/)
  })

  it('treats an aapt2 launch fault as an environment error', () => {
    const { buildTools } = fakeSdk({ '36.0.0': ['aapt2.exe'] })
    const spawn = fakeSpawn({ aapt2: { error: new Error('spawn ENOENT') } })
    expect(() => readApkIdentity('/tmp/x.apk', { buildTools, env: {}, spawnSync: spawn, platform: WIN }))
      .toThrow(/aapt2 could not run/)
  })
})

describe('the script keeps the #656 exit contract', () => {
  it('sets process.exitCode and never calls process.exit', () => {
    const src = readFileSync(new URL('../scripts/apk-release-manifest.mjs', import.meta.url), 'utf8')
    expect(src).not.toMatch(/process\.exit\(/)
    expect(src).toContain('process.exitCode')
  })

  it('does not build a shell command string for a tool call', () => {
    const src = readFileSync(new URL('../scripts/apk-release-manifest.mjs', import.meta.url), 'utf8')
    // No shell: true, and no execSync with an interpolated command.
    expect(src).not.toMatch(/shell:\s*true/)
    expect(src).not.toMatch(/execSync\(/)
    expect(src).not.toMatch(/execFileSync\(/)
  })
})
