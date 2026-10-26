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
//   npm run art:build -- --masters <dir> --list-masters  # resolve every master, encode nothing
//   add --report <file> to also write the byte report as JSON
//
// Exit code 1 when a master is missing, a file exceeds its cap, or the total
// exceeds the budget. Never writes to the masters directory.
//
// The masters folder holds the pilot masters flat and the batch masters in a
// `batch1/` or `batch2/` subfolder, so one root serves every id. MASTER_FILES
// names the path under that root. The art workspace's own layout is the
// reference:
//
//   E:\YatraFlow\yatraflow-art-codex\masters\            pilot masters (flat)
//   E:\YatraFlow\yatraflow-art-codex\masters\batch1\     batch-1 masters
//   E:\YatraFlow\yatraflow-art-codex\masters\batch2\     batch-2 masters
//
// A batch-2 master that was generated outside that workspace is not copied into
// it. Instead, stage a root of the same shape under E:\T3 and point --masters at
// it. Every file in the staging root is a byte-identical copy. Only the staging
// root can rebuild every id; the art workspace root has no batch-2 master and so
// rebuilds all but generic-1:
//
//   <staging>\             the six pilot masters, flat
//   <staging>\batch1\      the fifteen batch-1 masters
//   <staging>\batch2\      the batch-2 masters
//
// All three of these commands read the same root:
//
//   npm run art:build -- --masters E:\YatraFlow\yatraflow-art-codex\masters --check
//   npm run art:build -- --masters E:\YatraFlow\yatraflow-art-codex\masters --list-masters
//   npm run art:build -- --masters E:\T3\evidence\art-batch2-generation-20261025\staging --list-masters

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
// sharp 0.35.5). A change affects every derivative, so review the budget too.
const ENCODE = {
  avif: { quality: 50, effort: 6, chromaSubsampling: '4:2:0' },
  webp: { quality: 60, effort: 6 },
}

// The master file for each manifest id, relative to the --masters folder. The
// master names carry the review round (for example -v3); the manifest id does
// not. Update this table when a master is replaced.
//
// A bare name is a pilot master at the root. A name with a folder is a batch
// master under it, which is how the batch-1 set stays in `masters/batch1/`
// instead of being copied flat next to the pilot files. The India set lives in
// `india/`. Every path here is RELATIVE: no machine path is ever named, so any
// staging root of the documented shape rebuilds the same bytes.
const MASTER_FILES = {
  'kerala-1': 'kerala-1-v3.png',
  'himalaya-1': 'himalaya-1-v3.png',
  'rajasthan-1': 'rajasthan-1-v4.png',
  'city-1': 'city-1-v3.png',
  'road-1': 'road-1-v2.png',
  'es-first-trip': 'es-first-trip-v3.png',
  // Batch 1, active set. goa-2-v2 and coorg-2-v2 are the cleanup revisions; the
  // superseded goa-2-v1 and coorg-2-v1 stay in masters/batch1/archive and are
  // named by nothing here.
  'goa-1': 'batch1/goa-1-v1.png',
  'goa-2': 'batch1/goa-2-v2.png',
  'coorg-1': 'batch1/coorg-1-v1.png',
  'coorg-2': 'batch1/coorg-2-v2.png',
  'meghalaya-1': 'batch1/meghalaya-1-v1.png',
  'meghalaya-2': 'batch1/meghalaya-2-v1.png',
  'himalaya-2': 'batch1/himalaya-2-v1.png',
  'rajasthan-2': 'batch1/rajasthan-2-v1.png',
  'road-2': 'batch1/road-2-v1.png',
  'es-no-saved': 'batch1/es-no-saved-v1.png',
  'es-no-results': 'batch1/es-no-results-v1.png',
  'es-no-purchases': 'batch1/es-no-purchases-v1.png',
  'es-no-published': 'batch1/es-no-published-v1.png',
  'es-offline': 'batch1/es-offline-v1.png',
  'es-error': 'batch1/es-error-v1.png',
  // Batch 2. The generic scene is the only approved batch-2 master. Its file
  // lives under a `batch2/` folder so the masters root stays a single --masters
  // argument. That root may be the art workspace or an external staging folder
  // built from it; either way this table names only a path relative to the root.
  'generic-1': 'batch2/generic-1-v1.png',

  // ---- India jurisdiction set (31 new scenes) ----
  // The 31 needed-new rows of the coverage plan. Bihar and Odisha map to the
  // ACCEPTED comparison revisions (bihar-study-v2 / odisha-study-v2), staged
  // under these file names. The remaining 29 are the plan's active v1 masters.
  'andhra-pradesh-v1': 'india/andhra-pradesh-v1.png',
  'arunachal-pradesh-v1': 'india/arunachal-pradesh-v1.png',
  'assam-v1': 'india/assam-v1.png',
  'bihar-v1': 'india/bihar-v1.png',
  'chhattisgarh-v1': 'india/chhattisgarh-v1.png',
  'gujarat-v1': 'india/gujarat-v1.png',
  'haryana-v1': 'india/haryana-v1.png',
  'jharkhand-v1': 'india/jharkhand-v1.png',
  'karnataka-v1': 'india/karnataka-v1.png',
  'madhya-pradesh-v1': 'india/madhya-pradesh-v1.png',
  'maharashtra-v1': 'india/maharashtra-v1.png',
  'manipur-v1': 'india/manipur-v1.png',
  'mizoram-v1': 'india/mizoram-v1.png',
  'nagaland-v1': 'india/nagaland-v1.png',
  'odisha-v1': 'india/odisha-v1.png',
  'punjab-v1': 'india/punjab-v1.png',
  'rajasthan-v1': 'india/rajasthan-v1.png',
  'sikkim-v1': 'india/sikkim-v1.png',
  'tamil-nadu-v1': 'india/tamil-nadu-v1.png',
  'telangana-v1': 'india/telangana-v1.png',
  'tripura-v1': 'india/tripura-v1.png',
  'uttar-pradesh-v1': 'india/uttar-pradesh-v1.png',
  'uttarakhand-v1': 'india/uttarakhand-v1.png',
  'west-bengal-v1': 'india/west-bengal-v1.png',
  'andaman-and-nicobar-islands-v1': 'india/andaman-and-nicobar-islands-v1.png',
  'dadra-and-nagar-haveli-and-daman-and-diu-v1': 'india/dadra-and-nagar-haveli-and-daman-and-diu-v1.png',
  'delhi-v1': 'india/delhi-v1.png',
  // The active revision is v2. jammu-and-kashmir-v1 stays on disk as the
  // superseded revision and is named by nothing here.
  'jammu-and-kashmir-v2': 'india/jammu-and-kashmir-v2.png',
  'lakshadweep-v1': 'india/lakshadweep-v1.png',
  'puducherry-v1': 'india/puducherry-v1.png',
  'chandigarh-v1': 'india/chandigarh-v1.png',

  // ---- India destination set (9 new scenes) ----
  'udaipur-v1': 'india/udaipur-v1.png',
  'munnar-v1': 'india/munnar-v1.png',
  'darjeeling-v1': 'india/darjeeling-v1.png',
  'jaipur-v1': 'india/jaipur-v1.png',
  'mumbai-v1': 'india/mumbai-v1.png',
  'leh-v1': 'india/leh-v1.png',
  'manali-v1': 'india/manali-v1.png',
  'rishikesh-v1': 'india/rishikesh-v1.png',
  'shillong-v1': 'india/shillong-v1.png',
}

// Per-file encoder overrides, keyed "<id>-<width>.<format>".
//
// The India set was compressed against its caps with a bounded ladder: baseline
// q50/effort 6 first, then q48, q46, q44 at effort 6, first rung that fits wins.
// 18 of those 160 files landed on a non-baseline rung. Those exact params are
// recorded here so a full rebuild reproduces the SELECTED bytes rather than
// silently re-encoding at q50 and losing the cap overrides.
//
// The four D1 compression-batch files (jaipur-v1-960, manali-v1-640,
// manali-v1-960, rishikesh-v1-960) were recompressed at effort 9 outside the
// batch ladder; their selected params are recorded the same way.
const ENCODER_OVERRIDES = {
  'arunachal-pradesh-v1-960.avif': { quality: 48, effort: 6 },
  'chhattisgarh-v1-960.avif': { quality: 48, effort: 6 },
  'haryana-v1-640.avif': { quality: 48, effort: 6 },
  'haryana-v1-960.avif': { quality: 46, effort: 6 },
  'jharkhand-v1-960.avif': { quality: 48, effort: 6 },
  'karnataka-v1-960.avif': { quality: 48, effort: 6 },
  'madhya-pradesh-v1-960.avif': { quality: 48, effort: 6 },
  'maharashtra-v1-640.avif': { quality: 48, effort: 6 },
  'maharashtra-v1-960.avif': { quality: 46, effort: 6 },
  'mizoram-v1-960.avif': { quality: 48, effort: 6 },
  'rajasthan-v1-960.avif': { quality: 48, effort: 6 },
  'sikkim-v1-960.avif': { quality: 46, effort: 6 },
  'telangana-v1-960.avif': { quality: 48, effort: 6 },
  'uttarakhand-v1-640.avif': { quality: 48, effort: 6 },
  'uttarakhand-v1-960.avif': { quality: 44, effort: 6 },
  'munnar-v1-960.avif': { quality: 48, effort: 6 },
  'darjeeling-v1-640.avif': { quality: 48, effort: 6 },
  'darjeeling-v1-960.avif': { quality: 46, effort: 6 },
  // D1 compression batch: effort 9, outside the ladder.
  'jaipur-v1-960.avif': { quality: 48, effort: 9 },
  'manali-v1-640.avif': { quality: 48, effort: 9 },
  'manali-v1-960.avif': { quality: 44, effort: 9 },
  'rishikesh-v1-960.avif': { quality: 48, effort: 9 },
}

/** Encoder settings for one output file: the override if any, else the baseline. */
function encoderFor(name, format) {
  const base = ENCODE[format]
  const override = ENCODER_OVERRIDES[name]
  return override ? { ...base, effort: override.effort, quality: override.quality } : base
}

const RATIO_VALUE = { '3:2': 3 / 2, '1:1': 1 }
const RATIO_TOLERANCE = 0.02

function parseArgs(argv) {
  const args = { masters: null, out: DEFAULT_OUT, check: false, report: null, listMasters: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--check') args.check = true
    else if (flag === '--list-masters') args.listMasters = true
    else if (flag === '--masters') args.masters = argv[++i]
    else if (flag === '--out') args.out = path.resolve(argv[++i])
    else if (flag === '--report') args.report = path.resolve(argv[++i])
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (!args.check && !args.listMasters && !args.masters) throw new Error('Pass --masters <dir>, --check or --list-masters.')
  if (args.listMasters && !args.masters) throw new Error('--list-masters needs --masters <dir>.')
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
      const name = `${id}-${width}.avif`
      const buffer = await sharp(masterPath).rotate().toColorspace('srgb').resize({ width }).avif(encoderFor(name, 'avif')).toBuffer()
      writeFileSync(path.join(outDir, name), buffer)
    }
    const webpName = `${id}-${entry.webp}.webp`
    const webpBuffer = await sharp(masterPath).rotate().toColorspace('srgb').resize({ width: entry.webp }).webp(encoderFor(webpName, 'webp')).toBuffer()
    writeFileSync(path.join(outDir, webpName), webpBuffer)
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

/**
 * Resolve every manifest id to its master and report what is there, without
 * encoding anything. This is the cheap proof that the folder layout and
 * MASTER_FILES still agree: a missing file, an extra id, or a master whose
 * dimensions contradict the manifest ratio all show up here in a second rather
 * than after a full re-encode.
 */
async function listMasters(manifest, mastersDir) {
  const rows = []
  const problems = []
  for (const [id, entry] of Object.entries(manifest.ids)) {
    const relative = MASTER_FILES[id]
    if (!relative) {
      problems.push(`No MASTER_FILES entry for ${id}.`)
      continue
    }
    const fullPath = path.join(mastersDir, relative)
    if (!existsSync(fullPath)) {
      problems.push(`Missing master for ${id}: ${relative}`)
      continue
    }
    const metadata = await sharp(fullPath).metadata()
    const wantRatio = RATIO_VALUE[entry.ratio]
    const gotRatio = metadata.width / metadata.height
    const ratioOk = Math.abs(gotRatio - wantRatio) / wantRatio <= RATIO_TOLERANCE
    if (!ratioOk) problems.push(`Master ${id} is ${metadata.width}x${metadata.height}, not ${entry.ratio}.`)
    rows.push({ id, master: relative, width: metadata.width, height: metadata.height, ratio: entry.ratio, ratioOk })
  }
  const extra = Object.keys(MASTER_FILES).filter(id => !manifest.ids[id])
  for (const id of extra) problems.push(`MASTER_FILES names ${id}, which the manifest does not declare.`)
  console.log('id'.padEnd(18), 'master'.padEnd(30), 'size'.padStart(12), ' ratio')
  for (const row of rows) {
    console.log(row.id.padEnd(18), row.master.padEnd(30), `${row.width}x${row.height}`.padStart(12), `  ${row.ratio}${row.ratioOk ? '' : ' MISMATCH'}`)
  }
  console.log(`${rows.length} of ${Object.keys(manifest.ids).length} ids resolved under ${mastersDir}`)
  for (const problem of problems) console.error(`FAIL: ${problem}`)
  if (problems.length) process.exitCode = 1
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const errors = []
  // An override that names no expected file is a typo that would silently do
  // nothing, so it is an error rather than a no-op.
  const expectedNames = new Set(expectedFiles(manifest).map(file => file.name))
  for (const name of Object.keys(ENCODER_OVERRIDES)) {
    if (!expectedNames.has(name)) errors.push(`ENCODER_OVERRIDES names ${name}, which the manifest does not produce.`)
  }
  if (args.listMasters) {
    await listMasters(manifest, path.resolve(args.masters))
    return
  }
  if (!args.check) {
    if (path.resolve(args.masters) === path.resolve(args.out)) throw new Error('--out must not be the masters folder.')
    await encodeAll(manifest, path.resolve(args.masters), args.out, errors)
  }
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
