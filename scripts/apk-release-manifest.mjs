#!/usr/bin/env node
// ============================================================================
// APK release manifest — local generation and checking. NOTHING IS PUBLISHED.
//
// The update client reads one JSON document. This script produces that document
// from a real APK, and refuses to produce one unless the artifact passes every
// compatibility check first. It writes to stdout or a local file; putting it on
// a public host is a separate, approved step (docs/APK-UPDATE-FEED.md).
//
// Usage:
//   node scripts/apk-release-manifest.mjs \
//     --apk <path.apk> --channel production \
//     --expect-signer-sha256 <cert-fingerprint> \
//     --download-url https://www.yatraflow.in/android/yatraflow-0.15.apk \
//     --notes "What changed." [--out manifest.json] [--hosts a,b]
//
//   node scripts/apk-release-manifest.mjs --check <manifest.json> \
//     --apk <path.apk> --expect-signer-sha256 <cert-fingerprint> [--hosts a,b]
//
// Exit codes: 0 ok, 1 a check failed, 2 bad usage or a missing tool. The script
// sets process.exitCode and returns; it never calls process.exit, so a message
// cannot be lost in a truncated write (#656).
//
// The checks, and why each one exists:
//   availability  the APK file must exist and be readable on disk;
//   package       the APK's applicationId must match the channel's own id, so a
//                 production device is never told to install an audit build;
//   version       the versionCode must be a positive integer ABOVE every code
//                 already published. Code 14 belongs to the build in users'
//                 hands today, so the next release needs a higher one;
//   signature     apksigner must verify the APK, AND the signer's certificate
//                 fingerprint must equal the expected one the caller supplies;
//   destination   the download URL must be HTTPS on the approved host list.
//
// Why the fingerprint is required. `apksigner verify` proves the APK is intact
// and self-consistent. It does NOT prove which key signed it: any valid key
// passes. Android refuses to install over an app whose signer changed, so an
// APK signed with a different but valid key would be offered to users who then
// cannot install it. The expected fingerprint must come from the release owner.
// This script never reads a key, and it never derives an expectation from the
// APK it is checking.
//
// Why the tools are launched this way. On Windows a `.bat` cannot be spawned
// without a shell (Node hardening for CVE-2024-27980). `aapt2` ships as an
// `.exe` but `apksigner` ships only as a `.bat` wrapper. So aapt2 runs as a
// program and apksigner runs as its jar through java. Both use an argument
// vector; neither builds a command string.
//
// The shape emitted is exactly what src/lib/apkUpdates.ts parses.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const APP_ID_FOR_CHANNEL = {
  production: 'app.yatraflow.mobile',
  audit: 'app.yatraflow.mobile.t3audit',
}

// Version codes already published. A new release must be HIGHER than the
// highest one here, not merely different from every entry. This list stays as
// the audit record of what shipped.
export const PUBLISHED_VERSION_CODES = [14]

/**
 * The file each tool has on each platform. One suffix per platform is wrong:
 * on Windows `aapt2` is an `.exe` while `apksigner` is a `.bat`.
 */
export const TOOL_FILES = {
  aapt2: { win32: 'aapt2.exe', default: 'aapt2' },
  apksigner: { win32: 'apksigner.bat', default: 'apksigner' },
}

/** A stopping condition with the exit code it deserves. */
class Stop extends Error {
  constructor(code, message) {
    super(message ?? '')
    this.code = code
    this.silent = !message
  }
}

function usage(problem) {
  throw new Stop(2, `apk-release-manifest: ${problem}\nSee the header of this file for usage.`)
}

function arg(name, argv = process.argv) {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? undefined : argv[index + 1]
}

function platformKey(platform = process.platform) {
  return platform === 'win32' ? 'win32' : 'default'
}

/** Build-tools versions, newest first, compared numerically. */
export function buildToolsVersions(buildToolsDir) {
  const numeric = (v) => v.split('.').map((p) => Number(p) || 0)
  return readdirSync(buildToolsDir)
    .filter((v) => /^\d+(\.\d+)*/.test(v))
    .sort((a, b) => {
      const x = numeric(a)
      const y = numeric(b)
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        const d = (y[i] ?? 0) - (x[i] ?? 0)
        if (d !== 0) return d
      }
      return 0
    })
}

/** The build-tools directory the tools are resolved from. */
export function buildToolsHome(env = process.env) {
  const home = env.ANDROID_HOME || env.ANDROID_SDK_ROOT
  if (!home) usage('ANDROID_HOME or ANDROID_SDK_ROOT must be set to find the Android tools')
  const buildTools = path.join(home, 'build-tools')
  if (!existsSync(buildTools)) usage(`no build-tools directory under ${home}`)
  return buildTools
}

/**
 * The path to one tool, in the form the target platform ships it, from the
 * newest build-tools version that has it. The message names the real file, so a
 * missing tool is never reported under a name that does not exist.
 *
 * `platform` is injectable so the regression can reproduce the Windows shape
 * from a Linux CI runner, where the gate actually runs.
 */
export function resolveTool(name, buildTools, platform = process.platform) {
  const files = TOOL_FILES[name]
  if (!files) usage(`unknown Android tool "${name}"`)
  const fileName = files[platformKey(platform)] ?? files.default
  for (const version of buildToolsVersions(buildTools)) {
    const candidate = path.join(buildTools, version, fileName)
    if (existsSync(candidate)) return { file: candidate, version, fileName }
  }
  usage(`${fileName} was not found in any build-tools version under ${buildTools}`)
}

/**
 * The java executable, from JAVA_HOME when set, else `java` from PATH. A batch
 * wrapper would search the same way, but launching it would need a shell.
 */
export function javaExecutable(env = process.env, platform = process.platform) {
  if (env.JAVA_HOME) {
    const exe = platform === 'win32' ? 'java.exe' : 'java'
    const candidate = path.join(env.JAVA_HOME, 'bin', exe)
    if (existsSync(candidate)) return candidate
    usage(`JAVA_HOME is set to ${env.JAVA_HOME}, but ${candidate} does not exist`)
  }
  return platform === 'win32' ? 'java.exe' : 'java'
}

/** Package id, version code and version name, read from the APK itself. */
export function readApkIdentity(apkPath, options = {}) {
  const buildTools = options.buildTools ?? buildToolsHome(options.env ?? process.env)
  const { file } = resolveTool('aapt2', buildTools, options.platform)
  const run = options.spawnSync ?? spawnSync
  const result = run(file, ['dump', 'badging', apkPath], { encoding: 'utf8' })
  if (result.error) {
    throw new Stop(2, `apk-release-manifest: aapt2 could not run: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/)[0]
    throw new Stop(2, `apk-release-manifest: aapt2 failed on ${apkPath}${detail ? `: ${detail}` : ''}`)
  }
  const line = String(result.stdout).split('\n').find((l) => l.startsWith('package:'))
  if (!line) usage(`aapt2 returned no package line for ${apkPath}`)
  return {
    packageId: /name='([^']+)'/.exec(line)?.[1] ?? '',
    versionCode: Number(/versionCode='(\d+)'/.exec(line)?.[1]),
    versionName: /versionName='([^']*)'/.exec(line)?.[1] ?? '',
  }
}

/** The certificate digests apksigner prints, as lower-case hex. */
export function parseCertDigests(out) {
  const digests = []
  for (const line of String(out).split(/\r?\n/)) {
    const m = /^Signer #\d+ certificate (SHA-256|SHA-1|MD5) digest: ([0-9a-fA-F:]+)\s*$/.exec(line.trim())
    if (m) digests.push({ algorithm: m[1], hex: m[2].replace(/:/g, '').toLowerCase() })
  }
  return digests
}

/** The first certificate DN apksigner prints, or null. */
export function parseCertDn(out) {
  return /certificate DN: (.+)/.exec(String(out))?.[1]?.trim() ?? null
}

/** Normalises a caller-supplied fingerprint for comparison. */
export function normaliseFingerprint(value) {
  return String(value ?? '').replace(/[:\s]/g, '').toLowerCase()
}

/**
 * Runs apksigner through its jar. Returns `{ status, stdout, stderr, error }`.
 * A non-zero status is a verify result; `error` is a launch fault. The caller
 * must keep those apart.
 */
export function runApksigner(args, options = {}) {
  const buildTools = options.buildTools ?? buildToolsHome(options.env ?? process.env)
  const { file: wrapper } = resolveTool('apksigner', buildTools, options.platform)
  const candidates = [
    path.join(path.dirname(wrapper), 'apksigner.jar'),
    path.join(path.dirname(wrapper), 'lib', 'apksigner.jar'),
  ]
  const jar = candidates.find((c) => existsSync(c))
  if (!jar) usage(`apksigner.jar was not found beside ${wrapper}`)
  const java = javaExecutable(options.env ?? process.env, options.platform)
  const run = options.spawnSync ?? spawnSync
  return run(java, ['-jar', jar, ...args], { encoding: 'utf8' })
}

/**
 * The signer identity, or a problem string.
 *
 * A launch fault is exit 2, because the environment is broken rather than the
 * artifact. A verify failure is exit 1, because the artifact is bad. Merging
 * those two reports a valid APK as invalid, or the reverse.
 *
 * A missing or malformed expected fingerprint is a usage error (exit 2) and is
 * rejected before the APK is touched: an unpinned check proves nothing, so
 * running the comparison anyway would only produce a misleading pass.
 */
export function checkSignature(apkPath, expectedFingerprint, options = {}) {
  const expected = requireFingerprint(expectedFingerprint)

  const result = runApksigner(['verify', '--print-certs', apkPath], options)

  if (result.error) {
    throw new Stop(2, `apk-release-manifest: apksigner could not run: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/)[0]
    return { problem: `apksigner did not verify the APK${detail ? `: ${detail}` : ''}` }
  }

  const out = String(result.stdout || '')
  const sha256 = parseCertDigests(out).find((d) => d.algorithm === 'SHA-256')
  const dn = parseCertDn(out)
  if (!sha256) {
    return { problem: 'apksigner printed no SHA-256 certificate digest, so the signer cannot be pinned' }
  }
  if (sha256.hex !== expected) {
    return {
      problem: 'the APK signer does not match the expected certificate.'
        + ` expected sha256 ${expected}, got ${sha256.hex}${dn ? ` (${dn})` : ''}`,
      actual: sha256.hex,
      dn,
    }
  }
  return { signer: { sha256: sha256.hex, dn } }
}

/**
 * Validates the caller-supplied fingerprint. Required, with no default: the
 * expected value must come from the release owner, never from the artifact.
 */
export function requireFingerprint(value) {
  const expected = normaliseFingerprint(value)
  if (!expected) {
    usage('--expect-signer-sha256 is required; pass the release certificate SHA-256 fingerprint')
  }
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    usage(`the expected signer fingerprint "${value}" is not a SHA-256 certificate digest`)
  }
  return expected
}

function approvedHosts(argv = process.argv, env = process.env) {
  const raw = arg('hosts', argv) ?? env.APK_UPDATE_HOSTS ?? ''
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
}

export function destinationProblem(url, hosts) {
  if (!url) return 'the download URL is missing'
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return 'the download URL is not a URL'
  }
  if (parsed.protocol !== 'https:') return 'the download URL is not HTTPS'
  if (parsed.username || parsed.password) return 'the download URL carries credentials'
  if (parsed.port) return 'the download URL uses a non-default port'
  if (hosts.length === 0) return 'no approved hosts were given, so no destination can pass'
  if (!hosts.includes(parsed.hostname.toLowerCase())) return `${parsed.hostname} is not an approved host`
  return null
}

/** The highest published code. A release must exceed it. */
export function highestPublishedVersionCode(codes = PUBLISHED_VERSION_CODES) {
  return codes.length === 0 ? 0 : Math.max(...codes)
}

/**
 * Every reason a release cannot be published, as text. Empty means it can.
 * Pure, so the test can drive it without an SDK.
 */
export function releaseProblems({
  identity,
  channel,
  downloadUrl,
  hosts,
  signerCheck,
  publishedCodes = PUBLISHED_VERSION_CODES,
}) {
  const problems = []
  const expectedId = APP_ID_FOR_CHANNEL[channel]
  if (!expectedId) problems.push(`channel ${channel} is unknown`)
  else if (identity.packageId !== expectedId) {
    problems.push(`channel ${channel} must ship as ${expectedId}, but this APK is ${identity.packageId}`)
  }

  const floor = highestPublishedVersionCode(publishedCodes)
  if (!Number.isInteger(identity.versionCode) || identity.versionCode <= 0) {
    problems.push(`the APK's versionCode "${identity.versionCode}" is not a positive integer`)
  } else if (identity.versionCode <= floor) {
    problems.push(
      `versionCode ${identity.versionCode} is not above the highest published code ${floor};`
      + ' a new release needs a higher one',
    )
  }

  const bad = destinationProblem(downloadUrl, hosts)
  if (bad) problems.push(bad)
  if (signerCheck?.problem) problems.push(signerCheck.problem)
  return problems
}

/** Prints every problem, then stops with code 1. */
function fail(problems) {
  for (const problem of problems) console.error(`FAIL ${problem}`)
  throw new Stop(1)
}

function checkExisting(manifestPath, identity, signerCheck, hosts) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const problems = []
  if (manifest.packageId !== identity.packageId) problems.push(`packageId ${manifest.packageId} does not match the APK's ${identity.packageId}`)
  if (manifest.versionCode !== identity.versionCode) problems.push(`versionCode ${manifest.versionCode} does not match the APK's ${identity.versionCode}`)
  if (manifest.versionName !== identity.versionName) problems.push(`versionName ${manifest.versionName} does not match the APK's ${identity.versionName}`)
  if (!APP_ID_FOR_CHANNEL[manifest.channel]) problems.push(`channel ${manifest.channel} is unknown`)
  else if (manifest.packageId !== APP_ID_FOR_CHANNEL[manifest.channel]) problems.push(`channel ${manifest.channel} must ship as ${APP_ID_FOR_CHANNEL[manifest.channel]}`)
  if (typeof manifest.notes !== 'string') problems.push('notes must be text')
  const bad = destinationProblem(manifest.downloadUrl, hosts)
  if (bad) problems.push(bad)
  if (signerCheck.problem) problems.push(signerCheck.problem)
  if (problems.length) fail(problems)
  console.log(JSON.stringify({ ok: true, signer: signerCheck.signer, manifest }, null, 2))
}

function generate(identity, signerCheck, hosts) {
  const channel = arg('channel')
  if (!APP_ID_FOR_CHANNEL[channel]) usage('--channel must be production or audit')
  const downloadUrl = arg('download-url')
  const notes = arg('notes') ?? ''

  const problems = releaseProblems({ identity, channel, downloadUrl, hosts, signerCheck })
  if (problems.length) fail(problems)

  // The manifest fields, in the shape src/lib/apkUpdates.ts parses.
  const manifest = {
    packageId: identity.packageId,
    channel,
    versionCode: identity.versionCode,
    versionName: identity.versionName,
    notes,
    downloadUrl,
  }

  const out = arg('out')
  if (out) {
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
    console.error(`wrote ${out} — publish it only after approval`)
  } else {
    console.log(JSON.stringify(manifest, null, 2))
  }
  const { dn, sha256 } = signerCheck.signer
  console.error(
    `apk=${arg('apk')} package=${identity.packageId} versionCode=${identity.versionCode}`
    + ` versionName=${identity.versionName} signer-sha256=${sha256} signer-dn=${dn ?? '(none)'}`,
  )
}

function main() {
  const apkPath = arg('apk')
  if (!apkPath) usage('--apk is required')
  if (!existsSync(apkPath)) usage(`no APK at ${apkPath} (availability)`)

  const identity = readApkIdentity(apkPath)
  const expected = arg('expect-signer-sha256') ?? process.env.APK_UPDATE_EXPECT_SIGNER_SHA256
  const signerCheck = checkSignature(apkPath, expected)
  const hosts = approvedHosts()
  const manifestPath = arg('check')

  if (manifestPath) checkExisting(manifestPath, identity, signerCheck, hosts)
  else generate(identity, signerCheck, hosts)
}

// Only run when invoked directly, so a test can import the pure helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (err) {
    if (err instanceof Stop) {
      if (!err.silent) console.error(err.message)
      process.exitCode = err.code
    } else {
      console.error(err?.stack ?? String(err))
      process.exitCode = 1
    }
  }
}
