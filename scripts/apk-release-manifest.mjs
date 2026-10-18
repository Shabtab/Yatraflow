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
//     --download-url https://www.yatraflow.in/android/yatraflow-0.15.apk \
//     --notes "What changed." [--out manifest.json] [--hosts a,b]
//
//   node scripts/apk-release-manifest.mjs --check <manifest.json> \
//     --apk <path.apk> [--hosts a,b]     # check an existing document
//
// Exit codes: 0 ok, 1 a check failed, 2 bad usage or a missing tool. The script
// sets process.exitCode and returns; it never calls process.exit, so a message
// cannot be lost in a truncated write (#656).
//
// The checks, and why each one exists:
//   availability  the APK file must exist and be readable on disk;
//   package       the APK's applicationId must match the channel's own id, so a
//                 production device is never told to install an audit build;
//   version       the versionCode must be a positive integer, and must not be
//                 one already published — 14 belongs to the build in users'
//                 hands today, so the next release needs a higher one;
//   signature     apksigner must verify the APK, because Android refuses to
//                 install over an existing app whose signer changed;
//   destination   the download URL must be HTTPS on the approved host list.
// The shape emitted is exactly what src/lib/apkUpdates.ts parses.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const APP_ID_FOR_CHANNEL = {
  production: 'app.yatraflow.mobile',
  audit: 'app.yatraflow.mobile.t3audit',
}

// Version codes already published. A new release must be higher than all of
// them. A rebuild of an already published release keeps its own code.
const PUBLISHED_VERSION_CODES = [14]

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

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** The newest build-tools copy of one executable. */
function androidTool(name) {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (!home) usage(`ANDROID_HOME or ANDROID_SDK_ROOT must be set to find ${name}`)
  const buildTools = path.join(home, 'build-tools')
  if (!existsSync(buildTools)) usage(`no build-tools directory under ${home}`)
  const exe = process.platform === 'win32' ? `${name}.bat` : name
  const versions = readdirSync(buildTools).sort().reverse()
  for (const version of versions) {
    const candidate = path.join(buildTools, version, exe)
    if (existsSync(candidate)) return candidate
  }
  usage(`${name} was not found in any build-tools version under ${home}`)
}

/** Package id, version code and version name, read from the APK itself. */
function readApkIdentity(apkPath) {
  const badging = execFileSync(androidTool('aapt2'), ['dump', 'badging', apkPath], { encoding: 'utf8' })
  const line = badging.split('\n').find((l) => l.startsWith('package:'))
  if (!line) usage(`aapt2 returned no package line for ${apkPath}`)
  return {
    packageId: /name='([^']+)'/.exec(line)?.[1] ?? '',
    versionCode: Number(/versionCode='(\d+)'/.exec(line)?.[1]),
    versionName: /versionName='([^']*)'/.exec(line)?.[1] ?? '',
  }
}

/** The signer's distinguished name, or null when apksigner refuses the APK. */
function verifySignature(apkPath) {
  try {
    const out = execFileSync(androidTool('apksigner'), ['verify', '--print-certs', apkPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return /certificate DN: (.+)/.exec(out)?.[1]?.trim() ?? '(signer with no DN)'
  } catch {
    return null
  }
}

function approvedHosts() {
  const raw = arg('hosts') ?? process.env.APK_UPDATE_HOSTS ?? ''
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
}

function destinationProblem(url, hosts) {
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

/** Prints every problem, then stops with code 1. */
function fail(problems) {
  for (const problem of problems) console.error(`FAIL ${problem}`)
  throw new Stop(1)
}

function checkExisting(manifestPath, identity, signer, hosts) {
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
  if (!signer) problems.push('apksigner did not verify the APK')
  if (problems.length) fail(problems)
  console.log(JSON.stringify({ ok: true, signer, manifest }, null, 2))
}

function generate(identity, signer, hosts) {
  const channel = arg('channel')
  if (!APP_ID_FOR_CHANNEL[channel]) usage('--channel must be production or audit')
  const downloadUrl = arg('download-url')
  const notes = arg('notes') ?? ''

  const problems = []
  if (identity.packageId !== APP_ID_FOR_CHANNEL[channel]) {
    problems.push(`channel ${channel} must ship as ${APP_ID_FOR_CHANNEL[channel]}, but this APK is ${identity.packageId}`)
  }
  if (!Number.isInteger(identity.versionCode) || identity.versionCode <= 0) {
    problems.push(`the APK's versionCode "${identity.versionCode}" is not a positive integer`)
  }
  if (PUBLISHED_VERSION_CODES.includes(identity.versionCode)) {
    problems.push(`versionCode ${identity.versionCode} is already published; a new release needs a higher one`)
  }
  const bad = destinationProblem(downloadUrl, hosts)
  if (bad) problems.push(bad)
  if (!signer) problems.push('apksigner did not verify the APK')
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
  console.error(`apk=${arg('apk')} package=${identity.packageId} versionCode=${identity.versionCode} versionName=${identity.versionName} signer=${signer}`)
}

function main() {
  const apkPath = arg('apk')
  if (!apkPath) usage('--apk is required')
  if (!existsSync(apkPath)) usage(`no APK at ${apkPath} (availability)`)

  const identity = readApkIdentity(apkPath)
  const signer = verifySignature(apkPath)
  const hosts = approvedHosts()
  const manifestPath = arg('check')

  if (manifestPath) checkExisting(manifestPath, identity, signer, hosts)
  else generate(identity, signer, hosts)
}

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
