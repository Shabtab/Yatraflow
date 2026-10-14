#!/usr/bin/env node
// ============ Itinerary authoring scaffold (the "create a trip" script) ============
// Straightens out the boring, error-prone half of authoring a gallery itinerary so
// the authoring loop starts from a file that is already structurally right:
//
//   • the envelope + the formatVersion the reader expects
//   • one day per overnight, dated from --start-date
//   • every place GEOCODED, never typed (scripts/geocode-places.mjs — the same
//     lookup gallery-geocode.mjs uses)
//   • stops numbered 1-based and contiguous, the app's own convention
//   • a publication block whose durationDays already matches the plan
//
// It cannot write the trip for you: fees, visit times, opening hours, tips and the
// engine-priced budget are judgement calls. It prints them as the checklist, and it
// then runs the validator, whose report IS that checklist.
//
// Usage:
//   node scripts/new-itinerary.mjs \
//     --slug ladakh-leh-nubra-pangong \
//     --name "Ladakh — Leh, Nubra, Pangong" \
//     --start "Leh, Ladakh" \
//     --night "Leh, Ladakh" --night "Nubra Valley, Ladakh" --night "Pangong Lake, Ladakh" --night "Leh, Ladakh" \
//     --start-date 2026-06-06 \
//     --mode rental --style adventure --tier comfort \
//     [--travellers 2] [--driver-count 2] [--one-way] [--out <path>] [--force]

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { execFileSync } from 'node:child_process'
import { geocodeMany } from './geocode-places.mjs'

const FORMAT_VERSION = 2
const MODES = ['car', 'rental', 'motorcycle', 'train', 'bus', 'flight', 'taxi', 'mixed']
const STYLES = ['relaxed', 'balanced', 'packed', 'adventure', 'luxury', 'budget', 'family', 'spiritual', 'food-focused', 'creator']
const TIERS = ['budget', 'comfort', 'luxury']
const SHELF = 'docs/examples/itineraries'

// ---- args ----
function parseArgs(argv) {
  // Null-prototype: the keys come from the command line, so a `--__proto__`
  // argument must land as an own property rather than on Object.prototype.
  const out = { __proto__: null, night: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`)
    const key = a.slice(2)
    if (key === 'one-way' || key === 'force' || key === 'help') { out[key] = true; continue }
    const value = argv[++i]
    if (value === undefined) throw new Error(`--${key} needs a value`)
    if (key === 'night') out.night.push(value)
    else out[key] = value
  }
  return out
}

const USAGE = `Create a structurally-correct gallery itinerary draft.

  --slug <slug>          URL/identity slug, ^[a-z0-9-]+$ (also the file name)
  --name "<title>"       trip name (<= 80 chars)
  --start "<place>"      where the trip begins (geocoded)
  --night "<place>"      the place each day ends at — one per day, in order (geocoded)
  --start-date <date>    yyyy-mm-dd (days are dated consecutively from here)
  --mode <mode>          ${MODES.join(' · ')}
  --style <style>        ${STYLES.join(' · ')}
  --tier <tier>          ${TIERS.join(' · ')}   (the stay budget)
  [--travellers n] [--driver-count 2|3] [--one-way] [--out <path>] [--force]

Example:
  node scripts/new-itinerary.mjs --slug hampi-and-badami --name "Hampi & Badami" \\
    --start "Bangalore" --night "Hampi, Karnataka" --night "Badami, Karnataka" --night "Bangalore" \\
    --start-date 2026-11-14 --mode car --style balanced --tier comfort`

// Returns null when parsing fails: the message below is already printed.
function parseCli() {
  try {
    return parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`\n${e.message}\n\n${USAGE}`)
    return null
  }
}

// Prints the first problem and returns false. exitCode, not process.exit:
// the message must reach the terminal (#656).
function validateArgs(args) {
  const missing = ['slug', 'name', 'start', 'start-date', 'mode', 'style', 'tier'].filter(k => !args[k])
  if (missing.length || args.night.length === 0) {
    console.error(`Missing: ${[...missing.map(m => `--${m}`), ...(args.night.length ? [] : ['--night'])].join(', ')}\n\n${USAGE}`)
    return false
  }
  if (!/^[a-z0-9-]+$/.test(args.slug)) { console.error('--slug must match ^[a-z0-9-]+$'); return false }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args['start-date'])) { console.error('--start-date must be yyyy-mm-dd'); return false }
  if (!MODES.includes(args.mode)) { console.error(`--mode must be one of ${MODES.join(', ')}`); return false }
  if (!STYLES.includes(args.style)) { console.error(`--style must be one of ${STYLES.join(', ')}`); return false }
  if (!TIERS.includes(args.tier)) { console.error(`--tier must be one of ${TIERS.join(', ')}`); return false }
  return true
}

/**
 * The write target is a path from the command line, so confine it: the scaffolder
 * creates directories and writes a file, and a fumbled `--out ../../notes` must fail
 * loudly instead of writing outside the shelf.
 */
function shelfTarget(raw) {
  const target = resolve(raw)
  const rel = relative(resolve(SHELF), target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`--out must be a path inside ${SHELF}/ (got "${raw}")`)
  }
  if (!target.toLowerCase().endsWith('.json')) throw new Error(`--out must name a .json file (got "${raw}")`)
  return target
}

async function scaffold(args) {
  let outPath
  try {
    outPath = shelfTarget(args.out ?? join(SHELF, `${args.slug}.draft.json`))
  } catch (e) {
    console.error(`\n${e.message}\n\n${USAGE}`)
    // exitCode, not process.exit: the message must reach the terminal (#656).
    process.exitCode = 2
    return
  }
  if (existsSync(outPath) && !args.force) {
    console.error(`${outPath} exists — pass --force to overwrite.`)
    process.exitCode = 2
    return
  }

  // ---- geocode every place (looked up, never typed) ----
  const places = [args.start, ...args.night]
  console.log(`Geocoding ${places.length} places…`)
  const { results, missed } = await geocodeMany(places, {
    onResult: row => console.log(row.lat === null
      ? `  NO HIT  ${row.query}`
      : `  ${row.query}\n    -> ${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}   [${row.matched}]`),
  })
  if (missed > 0) {
    console.error(`\n${missed} place(s) could not be geocoded. Rephrase them with district + state and run again — a guessed coordinate is the one error the import gates cannot catch.`)
    // exitCode, not process.exit: this message must reach the terminal (#656).
    process.exitCode = 1
    return
  }

  const start = results[0]
  const nights = results.slice(1)
  const days = nights.length
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date(`${args['start-date']}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

  /** Readable, unique ids from a place name: "Nubra Valley, Ladakh" -> "nubra-valley". */
  function slugOf(place) {
    return place.split(',')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place'
  }

  const slugSeen = new Map()
  function uniqueSlug(prefix, place) {
    const base = `${prefix}-${slugOf(place)}`
    const n = (slugSeen.get(base) ?? 0) + 1
    slugSeen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }

  const trip = {
    name: args.name,
    startLocation: args.start,
    startLocationCoords: { lat: start.lat, lng: start.lng },
    destinations: args.night,
    destinationCoords: nights.map(n => ({ lat: n.lat, lng: n.lng })),
    startDate: dates[0],
    endDate: dates[days - 1],
    travellers: args.travellers ? Number(args.travellers) : 2,
    transportMode: args.mode,
    travelStyle: args.style,
    stayStyle: args.tier,
    roundTrip: !args['one-way'],
    // Priced by the engine, never guessed: 0 is the explicit TODO the validator reports.
    budgetPerPersonInr: 0,
    coverEmoji: '🧭',
    visibility: 'public',
    fixedCommitments: [],
    expenses: [],
    days: nights.map((n, i) => ({
      id: `d${i + 1}`,
      index: i,
      title: '',
      stops: [{
        id: uniqueSlug(`d${i + 1}`, n.query),
        title: n.query.split(',')[0].trim(),
        category: 'sightseeing',
        locationName: n.query,
        lat: n.lat,
        lng: n.lng,
        visitMinutes: 0,
        entryFeeInrPerPerson: 0,
        transportCostInrTotal: 0,
        priority: 'must-do',
        status: 'confirmed',
        orderInDay: 1,
      }],
    })),
  }

  const doc = {
    formatVersion: FORMAT_VERSION,
    trip,
    publication: {
      id: args.slug,
      title: args.name,
      tagline: `${days}-day ${args.style} trip: ${args.night.map(n => n.split(',')[0].trim()).join(' → ')}.`,
      routeSummary: [args.start.split(',')[0].trim(), ...args.night.map(n => n.split(',')[0].trim())],
      durationDays: days,
      estimatedBudgetPerPersonInr: 0,
      travelStyle: args.style,
      travelTips: [],
      warningsAndAssumptions: [],
      freeDayIndexes: [],
    },
  }
  if (args['driver-count']) Object.assign(trip, { driverCount: Number(args['driver-count']) })

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n')
  console.log(`\nWrote ${outPath}`)

  console.log(`
\n── What is already right ─────────────────────────────────────────────
  formatVersion ${FORMAT_VERSION} · ${days} days dated ${dates[0]} → ${dates[days - 1]}
  ${places.length} places geocoded (start + ${days} overnights)
  one 1-based, contiguous anchor stop per day · publication.durationDays matches

── Your checklist (the validator below reports the same list) ─────────
  ☐ 3–6 real stops per day, each with its own coordinate. Two stops on one
    place is only allowed for a meal at your night's base.
  ☐ visitMinutes, entryFeeInrPerPerson and a sourceUrl for every ticketed stop
  ☐ opening hours where they matter (both or neither, open before close)
  ☐ a hotel stop where each night actually falls
  ☐ a cover image (HTTPS), 3–6 travel tips, honest warningsAndAssumptions,
    at least one free day index
  ☐ the budget: run  npx vitest run tests/golden-itineraries.test.ts  and set
    budgetPerPersonInr + publication.estimatedBudgetPerPersonInr from the
    engine's own printed estimate — never pick it by hand

── Gate 1 now ───────────────────────────────────────────────────────
`)

  try {
    execFileSync(process.execPath, ['scripts/validate-itinerary.mjs', outPath], { stdio: 'inherit' })
  } catch {
    console.log('\nThe draft is expected to fail Gate 1 until the checklist above is done — that report is the to-do list.')
  }
}

const args = parseCli()
if (!args) {
  // The message above must reach the terminal. exitCode, not process.exit (#656).
  process.exitCode = 2
} else if (args.help) {
  console.log(USAGE)
  // --help stops here: the scaffold must not run. exitCode, not process.exit (#656).
  process.exitCode = 0
} else if (!validateArgs(args)) {
  // The message above must reach the terminal. exitCode, not process.exit (#656).
  process.exitCode = 2
} else {
  await scaffold(args)
}
