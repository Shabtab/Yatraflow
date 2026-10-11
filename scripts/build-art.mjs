#!/usr/bin/env node
// Builds the illustration derivatives in src/assets/art/ from the master PNGs.
//
// The masters are large (about 2 MB each) and stay OUT of the repo. Only the
// derivatives and manifest.json are committed. See docs/ART-PIPELINE.md.
//
// Usage:
//   npm run art:build -- --masters <dir>            # write src/assets/art/
//   npm run art:build -- --masters <dir> --out <dir> # write elsewhere (for comparison)
//   npm run art:build -- --check                    # report and check the committed files only
//   add --report <file> to also write the byte report as JSON
//
// Exit code 1 when a master is missing, a file exceeds its cap, or the total
// exceeds the budget. Never writes to the masters directory.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = path.join(ROOT, 'src', 'assets', 'art')
const MANIFEST_PATH = path.join(DEFAULT_OUT, 'manifest.json')
const FILE_PATTERN = /^[a-z0-9-]+-\d+\.(avif|webp)$/

// Encoder settings. These match the pilot (records/manifest-pilot.json,
// sharp 0.35.5). Changing one changes every derivative, so bump the budget
// review with it.
const ENCODE = {
  avif: { quality: 50, effort: 6, chromaSubsampling: '4:2:0' },
  webp: { quality: 60, effort: 6 },
}

// The master file for each manifest id. The master names carry the review
// round (for example -v3). Update this table when a master is replaced.
const MASTER_FILES = {
  'kerala-1': 'kerala-1-v3.png',
  'himalaya-1': 'himalaya-1-v3.png',
  'rajasthan-1': 'rajasthan-1-v4.png',
  'city-1': 'city-1-v3.png',
  'road-1': 'road-1-v2.png',
  'es-first-trip': 'es-first-trip-v3.png',
}

const RATIO_VALUE = { '3:2': 3 / 2, '1:1': 1 }
const RATIO_TOLERANCE = 0.02

function parseArgs(argv) {
  const args = { masters: null, out: DEFAULT_OUT, check: false, report: null }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--check') args.check = true
    else if (flag === '--masters') args.masters = argv[++i]
    else if (flag === '--out') args.out = path.resolve(argv[++i])
    else if (flag === '--report') args.report = path.resolve(argv[++i])
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (!args.check && !args.masters) throw new Error('Pass --masters <dir> or --check.')
  return args
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

/** Every file this manifest expects in the output folder, with its cap. */
function expectedFiles(manifest) {
  const expected = []
  for (const [id, entry] of Object.entries(manifest.ids)) {
    for (const width of entry.widths) {
      expected.push({ id, width, format: 'avif', name: `${id}-${width}.avif`, capBytes: avifCapBytes(manifest, width) })
    }
    expected.push({ id, width: entry.webp, format: 'webp', name: `${id}-${entry.webp}.webp`, capBytes: manifest.budget.webpKiB * 1024 })
  }
  return expected
}

function avifCapBytes(manifest, width) {
  const kib = manifest.budget.avifKiB[String(width)]
  if (kib === undefined) throw new Error(`No AVIF cap in manifest budget for width ${width}.`)
  return kib * 1024
}

async function encodeAll(manifest, mastersDir, outDir, errors) {
  mkdirSync(outDir, { recursive: true })
  for (const [id, entry] of Object.entries(manifest.ids)) {
    const masterPath = path.join(mastersDir, MASTER_FILES[id] ?? '')
    if (!MASTER_FILES[id] || !existsSync(masterPath)) {
      errors.push(`Missing master for ${id}: ${MASTER_FILES[id] ?? '(no entry in MASTER_FILES)'}`)
      continue
    }
    const metadata = await sharp(masterPath).metadata()
    const wantRatio = RATIO_VALUE[entry.ratio]
    const gotRatio = metadata.width / metadata.height
    if (Math.abs(gotRatio - wantRatio) / wantRatio > RATIO_TOLERANCE) {
      errors.push(`Master ${id} is ${metadata.width}x${metadata.height}, not ${entry.ratio}.`)
      continue
    }
    for (const width of entry.widths) {
      const buffer = await sharp(masterPath).rotate().toColorspace('srgb').resize({ width }).avif(ENCODE.avif).toBuffer()
      writeFileSync(path.join(outDir, `${id}-${width}.avif`), buffer)
    }
    const webpBuffer = await sharp(masterPath).rotate().toColorspace('srgb').resize({ width: entry.webp }).webp(ENCODE.webp).toBuffer()
    writeFileSync(path.join(outDir, `${id}-${entry.webp}.webp`), webpBuffer)
  }
}

/** Remove stale derivatives that match the naming pattern but are no longer in the manifest. */
function removeOrphans(outDir, expectedNames) {
  const removed = []
  if (!existsSync(outDir)) return removed
  for (const name of readdirSync(outDir)) {
    if (FILE_PATTERN.test(name) && !expectedNames.has(name)) {
      unlinkSync(path.join(outDir, name))
      removed.push(name)
    }
  }
  return removed
}

/** Build the byte report rows and the list of cap failures. */
function report(manifest, outDir) {
  const rows = []
  const problems = []
  for (const file of expectedFiles(manifest)) {
    const fullPath = path.join(outDir, file.name)
    if (!existsSync(fullPath)) {
      problems.push(`Missing ${file.name}`)
      continue
    }
    const buffer = readFileSync(fullPath)
    const overCap = buffer.length > file.capBytes
    if (overCap) problems.push(`${file.name} is ${buffer.length} bytes, cap is ${file.capBytes}.`)
    rows.push({ file: file.name, format: file.format, width: file.width, bytes: buffer.length, capBytes: file.capBytes, sha256: sha256(buffer), overCap })
  }
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  const totalCapBytes = manifest.budget.totalMiB * 1024 * 1024
  if (totalBytes > totalCapBytes) problems.push(`Total ${totalBytes} bytes is over the ${totalCapBytes}-byte budget.`)
  return { rows, totalBytes, totalCapBytes, problems }
}

function printReport(result) {
  console.log('file'.padEnd(28), 'bytes'.padStart(8), 'cap'.padStart(8), '  status')
  for (const row of result.rows) {
    const status = row.overCap ? 'OVER CAP' : 'ok'
    console.log(row.file.padEnd(28), String(row.bytes).padStart(8), String(row.capBytes).padStart(8), `  ${status}`)
  }
  console.log(`total ${result.totalBytes} bytes (${(result.totalBytes / 1024).toFixed(1)} KiB), budget ${result.totalCapBytes} bytes`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const errors = []
  if (!args.check) {
    if (path.resolve(args.masters) === path.resolve(args.out)) throw new Error('--out must not be the masters folder.')
    await encodeAll(manifest, path.resolve(args.masters), args.out, errors)
  }
  const expectedNames = new Set(expectedFiles(manifest).map(file => file.name))
  const removed = args.check ? [] : removeOrphans(args.out, expectedNames)
  if (removed.length) console.log(`Removed stale derivatives: ${removed.join(', ')}`)
  const result = report(manifest, args.out)
  printReport(result)
  if (args.report) writeFileSync(args.report, `${JSON.stringify({ outDir: args.out, ...result }, null, 2)}\n`)
  const allProblems = [...errors, ...result.problems]
  for (const problem of allProblems) console.error(`FAIL: ${problem}`)
  if (allProblems.length) process.exitCode = 1
  else console.log(`ok: ${result.rows.length} files within their caps.`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
