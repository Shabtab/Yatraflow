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
// The masters folder is one staging root with the layout below. MASTER_FILES
// names the path under that root, so no machine path enters the build table:
//
//   <staging>\balanced\      the 55 approved live-set masters, one per id
//   <staging>\destinations\  the 50 approved destination masters, one per id
//   <staging>\es-first-trip-v3.png  the square first-trip vignette
//   <staging>\batch1\        the six other square empty-state vignettes
//
// The same two commands read the root:
//
//   npm run art:build -- --masters <staging> --list-masters
//   npm run art:build -- --masters <staging> --out <scratch>
//
// docs/ART-PIPELINE.md names the external evidence root that holds this shape.

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
// Every path here is RELATIVE to the --masters root, so a staging root of the
// documented shape rebuilds the same bytes on any machine.
const MASTER_FILES = {
  // The seven square empty-state vignettes. They are not part of the balanced
  // refresh and keep their accepted masters.
  'es-first-trip': 'es-first-trip-v3.png',
  'es-no-saved': 'batch1/es-no-saved-v1.png',
  'es-no-results': 'batch1/es-no-results-v1.png',
  'es-no-purchases': 'batch1/es-no-purchases-v1.png',
  'es-no-published': 'batch1/es-no-published-v1.png',
  'es-offline': 'batch1/es-offline-v1.png',
  'es-error': 'batch1/es-error-v1.png',

  // ---- The 55 refreshed live landscape scenes ----
  // Each id keeps its name. The balanced folder holds the SELECTED output for
  // that id, so a review round never enters the manifest id.
  'kerala-1': 'balanced/kerala-1.png',
  'himalaya-1': 'balanced/himalaya-1.png',
  'himalaya-2': 'balanced/himalaya-2.png',
  'rajasthan-1': 'balanced/rajasthan-1.png',
  'rajasthan-2': 'balanced/rajasthan-2.png',
  'goa-1': 'balanced/goa-1.png',
  'goa-2': 'balanced/goa-2.png',
  'coorg-1': 'balanced/coorg-1.png',
  'coorg-2': 'balanced/coorg-2.png',
  'meghalaya-1': 'balanced/meghalaya-1.png',
  'meghalaya-2': 'balanced/meghalaya-2.png',
  'city-1': 'balanced/city-1.png',
  'road-1': 'balanced/road-1.png',
  'road-2': 'balanced/road-2.png',
  'generic-1': 'balanced/generic-1.png',
  'andhra-pradesh-v1': 'balanced/andhra-pradesh-v1.png',
  'arunachal-pradesh-v1': 'balanced/arunachal-pradesh-v1.png',
  'assam-v1': 'balanced/assam-v1.png',
  'bihar-v1': 'balanced/bihar-v1.png',
  'chhattisgarh-v1': 'balanced/chhattisgarh-v1.png',
  'gujarat-v1': 'balanced/gujarat-v1.png',
  'haryana-v1': 'balanced/haryana-v1.png',
  'jharkhand-v1': 'balanced/jharkhand-v1.png',
  'karnataka-v1': 'balanced/karnataka-v1.png',
  'madhya-pradesh-v1': 'balanced/madhya-pradesh-v1.png',
  'maharashtra-v1': 'balanced/maharashtra-v1.png',
  'manipur-v1': 'balanced/manipur-v1.png',
  'mizoram-v1': 'balanced/mizoram-v1.png',
  'nagaland-v1': 'balanced/nagaland-v1.png',
  'odisha-v1': 'balanced/odisha-v1.png',
  'punjab-v1': 'balanced/punjab-v1.png',
  'rajasthan-v1': 'balanced/rajasthan-v1.png',
  'sikkim-v1': 'balanced/sikkim-v1.png',
  'tamil-nadu-v1': 'balanced/tamil-nadu-v1.png',
  'telangana-v1': 'balanced/telangana-v1.png',
  'tripura-v1': 'balanced/tripura-v1.png',
  'uttar-pradesh-v1': 'balanced/uttar-pradesh-v1.png',
  'uttarakhand-v1': 'balanced/uttarakhand-v1.png',
  'west-bengal-v1': 'balanced/west-bengal-v1.png',
  'andaman-and-nicobar-islands-v1': 'balanced/andaman-and-nicobar-islands-v1.png',
  'dadra-and-nagar-haveli-and-daman-and-diu-v1': 'balanced/dadra-and-nagar-haveli-and-daman-and-diu-v1.png',
  'delhi-v1': 'balanced/delhi-v1.png',
  'jammu-and-kashmir-v2': 'balanced/jammu-and-kashmir-v2.png',
  'lakshadweep-v1': 'balanced/lakshadweep-v1.png',
  'puducherry-v1': 'balanced/puducherry-v1.png',
  'chandigarh-v1': 'balanced/chandigarh-v1.png',
  'udaipur-v1': 'balanced/udaipur-v1.png',
  'munnar-v1': 'balanced/munnar-v1.png',
  'darjeeling-v1': 'balanced/darjeeling-v1.png',
  'jaipur-v1': 'balanced/jaipur-v1.png',
  'mumbai-v1': 'balanced/mumbai-v1.png',
  'leh-v1': 'balanced/leh-v1.png',
  'manali-v1': 'balanced/manali-v1.png',
  'rishikesh-v1': 'balanced/rishikesh-v1.png',
  'shillong-v1': 'balanced/shillong-v1.png',

  // ---- The 50 new destination scenes ----
  // The file name is the approved record id; the manifest id adds dest- and the
  // review round so a selected output can never be confused with an older id.
  'dest-agra-v2': 'destinations/agra.png',
  'dest-alappuzha-v2': 'destinations/alappuzha.png',
  'dest-amritsar-v2': 'destinations/amritsar.png',
  'dest-ayodhya-v2': 'destinations/ayodhya.png',
  'dest-cherrapunji-v2': 'destinations/cherrapunji.png',
  'dest-coorg-v2': 'destinations/coorg.png',
  'dest-darjeeling-v2': 'destinations/darjeeling.png',
  'dest-delhi-v2': 'destinations/delhi.png',
  'dest-dharamshala-v2': 'destinations/dharamshala.png',
  'dest-ekta-nagar-v2': 'destinations/ekta-nagar.png',
  'dest-gangtok-v2': 'destinations/gangtok.png',
  'dest-goa-v2': 'destinations/goa.png',
  'dest-gulmarg-v2': 'destinations/gulmarg.png',
  'dest-hampi-v2': 'destinations/hampi.png',
  'dest-haridwar-v2': 'destinations/haridwar.png',
  'dest-jaipur-v2': 'destinations/jaipur.png',
  'dest-jaisalmer-v2': 'destinations/jaisalmer.png',
  'dest-jodhpur-v2': 'destinations/jodhpur.png',
  'dest-kaziranga-v2': 'destinations/kaziranga.png',
  'dest-kochi-v2': 'destinations/kochi.png',
  'dest-kodaikanal-v2': 'destinations/kodaikanal.png',
  'dest-kovalam-v2': 'destinations/kovalam.png',
  'dest-leh-v2': 'destinations/leh.png',
  'dest-madurai-v2': 'destinations/madurai.png',
  'dest-manali-v2': 'destinations/manali.png',
  'dest-mumbai-v2': 'destinations/mumbai.png',
  'dest-munnar-v2': 'destinations/munnar.png',
  'dest-mussoorie-v2': 'destinations/mussoorie.png',
  'dest-mysuru-v2': 'destinations/mysuru.png',
  'dest-nubra-valley-v2': 'destinations/nubra-valley.png',
  'dest-ooty-v2': 'destinations/ooty.png',
  'dest-pahalgam-v2': 'destinations/pahalgam.png',
  'dest-pangong-tso-v2': 'destinations/pangong-tso.png',
  'dest-puri-v2': 'destinations/puri.png',
  'dest-pushkar-v2': 'destinations/pushkar.png',
  'dest-rameswaram-v2': 'destinations/rameswaram.png',
  'dest-ranthambore-v2': 'destinations/ranthambore.png',
  'dest-rishikesh-v2': 'destinations/rishikesh.png',
  'dest-shaheed-dweep-v2': 'destinations/shaheed-dweep.png',
  'dest-shillong-v2': 'destinations/shillong.png',
  'dest-shimla-v2': 'destinations/shimla.png',
  'dest-sonamarg-v2': 'destinations/sonamarg.png',
  'dest-sri-vijaya-puram-v2': 'destinations/sri-vijaya-puram.png',
  'dest-srinagar-v2': 'destinations/srinagar.png',
  'dest-swaraj-dweep-v2': 'destinations/swaraj-dweep.png',
  'dest-tawang-v2': 'destinations/tawang.png',
  'dest-thekkady-v2': 'destinations/thekkady.png',
  'dest-udaipur-v2': 'destinations/udaipur.png',
  'dest-varanasi-v2': 'destinations/varanasi.png',
  'dest-white-rann-v2': 'destinations/white-rann.png',
}

// Per-file encoder overrides, keyed "<id>-<width>.<format>".
//
// Both landscape sets were compressed against their caps with a bounded ladder:
// baseline AVIF q50/effort 6 and WebP q60/effort 6 first, then AVIF q48, q46,
// q44 at effort 6, and for two dense scenes q42 and q38. The first rung that
// fits wins. 69 of the 420 landscape files landed on a non-baseline rung. Those
// exact params are recorded here so a full rebuild reproduces the SELECTED
// bytes rather than silently re-encoding at baseline and losing the cap
// overrides. The 21 square vignette files all stayed at baseline.
const ENCODER_OVERRIDES = {
  'arunachal-pradesh-v1-960.avif': { quality: 48, effort: 6 },
  'bihar-v1-960.avif': { quality: 48, effort: 6 },
  'chhattisgarh-v1-960.avif': { quality: 46, effort: 6 },
  'coorg-1-960.avif': { quality: 48, effort: 6 },
  'darjeeling-v1-640.avif': { quality: 48, effort: 6 },
  'darjeeling-v1-960.avif': { quality: 44, effort: 6 },
  'dest-amritsar-v2-960.avif': { quality: 48, effort: 6 },
  'dest-ayodhya-v2-960.avif': { quality: 48, effort: 6 },
  'dest-coorg-v2-640.avif': { quality: 48, effort: 6 },
  'dest-coorg-v2-960.avif': { quality: 44, effort: 6 },
  'dest-darjeeling-v2-960.avif': { quality: 46, effort: 6 },
  'dest-dharamshala-v2-960.avif': { quality: 48, effort: 6 },
  'dest-gangtok-v2-960.avif': { quality: 48, effort: 6 },
  'dest-hampi-v2-960.avif': { quality: 48, effort: 6 },
  'dest-haridwar-v2-960.avif': { quality: 48, effort: 6 },
  'dest-jaipur-v2-640.avif': { quality: 44, effort: 6 },
  'dest-jaipur-v2-640.webp': { quality: 55, effort: 6 },
  'dest-jaipur-v2-960.avif': { quality: 38, effort: 6 },
  'dest-jaisalmer-v2-960.avif': { quality: 48, effort: 6 },
  'dest-jodhpur-v2-960.avif': { quality: 48, effort: 6 },
  'dest-kochi-v2-960.avif': { quality: 48, effort: 6 },
  'dest-leh-v2-640.avif': { quality: 48, effort: 6 },
  'dest-leh-v2-960.avif': { quality: 44, effort: 6 },
  'dest-madurai-v2-640.avif': { quality: 48, effort: 6 },
  'dest-madurai-v2-960.avif': { quality: 44, effort: 6 },
  'dest-manali-v2-960.avif': { quality: 46, effort: 6 },
  'dest-mumbai-v2-960.avif': { quality: 48, effort: 6 },
  'dest-munnar-v2-960.avif': { quality: 48, effort: 6 },
  'dest-mussoorie-v2-960.avif': { quality: 48, effort: 6 },
  'dest-mysuru-v2-960.avif': { quality: 48, effort: 6 },
  'dest-nubra-valley-v2-640.avif': { quality: 48, effort: 6 },
  'dest-nubra-valley-v2-960.avif': { quality: 46, effort: 6 },
  'dest-ooty-v2-960.avif': { quality: 48, effort: 6 },
  'dest-pangong-tso-v2-960.avif': { quality: 48, effort: 6 },
  'dest-pushkar-v2-960.avif': { quality: 48, effort: 6 },
  'dest-rameswaram-v2-640.avif': { quality: 48, effort: 6 },
  'dest-rameswaram-v2-960.avif': { quality: 44, effort: 6 },
  'dest-ranthambore-v2-640.avif': { quality: 48, effort: 6 },
  'dest-ranthambore-v2-960.avif': { quality: 44, effort: 6 },
  'dest-shaheed-dweep-v2-640.avif': { quality: 42, effort: 6 },
  'dest-shaheed-dweep-v2-640.webp': { quality: 50, effort: 6 },
  'dest-shaheed-dweep-v2-960.avif': { quality: 38, effort: 6 },
  'dest-shillong-v2-640.avif': { quality: 48, effort: 6 },
  'dest-shillong-v2-960.avif': { quality: 44, effort: 6 },
  'dest-shimla-v2-960.avif': { quality: 48, effort: 6 },
  'dest-sonamarg-v2-960.avif': { quality: 46, effort: 6 },
  'dest-srinagar-v2-960.avif': { quality: 48, effort: 6 },
  'dest-swaraj-dweep-v2-640.avif': { quality: 48, effort: 6 },
  'dest-swaraj-dweep-v2-960.avif': { quality: 44, effort: 6 },
  'dest-thekkady-v2-960.avif': { quality: 48, effort: 6 },
  'haryana-v1-640.avif': { quality: 48, effort: 6 },
  'haryana-v1-960.avif': { quality: 46, effort: 6 },
  'jaipur-v1-960.avif': { quality: 46, effort: 6 },
  'jammu-and-kashmir-v2-960.avif': { quality: 48, effort: 6 },
  'jharkhand-v1-960.avif': { quality: 48, effort: 6 },
  'karnataka-v1-960.avif': { quality: 48, effort: 6 },
  'maharashtra-v1-960.avif': { quality: 48, effort: 6 },
  'manali-v1-640.avif': { quality: 48, effort: 6 },
  'manali-v1-960.avif': { quality: 44, effort: 6 },
  'mizoram-v1-960.avif': { quality: 48, effort: 6 },
  'munnar-v1-960.avif': { quality: 48, effort: 6 },
  'nagaland-v1-960.avif': { quality: 48, effort: 6 },
  'rajasthan-v1-960.avif': { quality: 48, effort: 6 },
  'rishikesh-v1-960.avif': { quality: 48, effort: 6 },
  'shillong-v1-960.avif': { quality: 48, effort: 6 },
  'sikkim-v1-960.avif': { quality: 46, effort: 6 },
  'telangana-v1-960.avif': { quality: 48, effort: 6 },
  'uttarakhand-v1-640.avif': { quality: 48, effort: 6 },
  'uttarakhand-v1-960.avif': { quality: 46, effort: 6 },
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
    for (const width of widthsFor(entry, manifest.coverWidths)) {
      expected.push({ id, width, format: 'avif', name: `${id}-${width}.avif`, capBytes: avifCapBytes(manifest, width) })
    }
    expected.push({ id, width: entry.webp, format: 'webp', name: `${id}-${entry.webp}.webp`, capBytes: manifest.budget.webpKiB * 1024 })
  }
  return expected
}

/** The AVIF widths for one id: its declared widths plus cover widths for landscape scenes. */
function widthsFor(entry, coverWidths) {
  return entry.ratio === '3:2' ? [...entry.widths, ...coverWidths] : entry.widths
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
    for (const width of widthsFor(entry, manifest.coverWidths)) {
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
