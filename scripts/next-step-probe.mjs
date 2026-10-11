#!/usr/bin/env node
// ============ Next-step probe (live data) ============
// Reports what `nextTripStep` derives for EVERY published itinerary, read live
// from Supabase through the app's own `rowToTrip` normalizer.
//
//   npm run probe:next-step            human table + histogram
//   npm run probe:next-step -- --json  machine-readable
//
// WHY THIS IS A SCRIPT AND NOT A TEST: it needs credentials and a network, so
// it can never join `npm test`. It is a REPORT, and it is also a check — a
// broken invariant exits non-zero.
//
// WHY IT LOADS THE MODULES THROUGH VITE: the point is to exercise the shipped
// derivation and normalizer. A hand-copied mapper would drift from `tripRow.ts`
// and quietly report on a different function than the one the card calls.
//
// RUN IT AFTER A SCHEMA CHANGE. A new column, a renamed status, or a different
// days JSONB shape shows up here as a changed histogram, a derived label that
// reads wrong, or a non-zero exit — long before a user sees a wrong card.
//
// Reads: `published_itineraries` (anon-readable), then `get_public_trip` per
// publication for the trip row itself. A PRICED publication returns its locked
// days stubbed, which is marked in the output — those rows report `plan-day`
// for the paywall, not for the plan.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const JSON_OUT = process.argv.includes('--json')

// ---------------------------------------------------------------- env loading
// Same shape as scripts/seedCreatorFixture.mjs and the integration harness:
// `.env.local` first, then process.env overrides. One Map, no dynamic access.
function loadEnv() {
  const env = new Map()
  try {
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      env.set(m[1], v)
    }
  } catch { /* no .env.local — process.env only */ }
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env.set(k, v)
  return env
}

const dotenv = loadEnv()
const URL_BASE = dotenv.get('VITE_SUPABASE_URL') ?? ''
const ANON = dotenv.get('VITE_SUPABASE_ANON_KEY') ?? ''

// Thrown rather than `process.exit`ed: an explicit exit right after Vite closes
// trips a libuv handle assert on Windows and swallows the real status. The
// script sets `process.exitCode` at the end and lets node exit on its own.
class ProbeAbort extends Error {}
function die(msg) {
  throw new ProbeAbort(msg)
}

if (!URL_BASE || !ANON) die('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local or the environment).')

const HEADERS = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }

async function getJson(path, init) {
  // Headers are merged here, not only at the call site: the publications read
  // passes no init, and without this merge it went out keyless and 401'd.
  const res = await fetch(`${URL_BASE}${path}`, { ...init, headers: { ...HEADERS, ...init?.headers } })
  if (!res.ok) die(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

// ------------------------------------------------------- the shipped derivation
// Loaded through Vite so this runs the REAL modules, not a copy of them.
async function loadDerivation() {
  const { createServer } = await import('vite')
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    const rowMod = await vite.ssrLoadModule('/src/lib/tripRow.ts')
    const stepMod = await vite.ssrLoadModule('/src/lib/tripNextStep.ts')
    return { rowToTrip: rowMod.rowToTrip, ...stepMod }
  } finally {
    await vite.close()
  }
}

// ------------------------------------------------------------------------ run
const { rowToTrip, nextTripStep, plannedDayRatio } = await loadDerivation()

const rows = []
try {
  const pubs = await getJson(
    '/rest/v1/published_itineraries?select=id,premium_price_inr,duration_days,unpublished_at&limit=500',
  )

  for (const pub of pubs) {
    const data = await getJson('/rest/v1/rpc/get_public_trip', {
      method: 'POST',
      body: JSON.stringify({ p_pub_id: pub.id }),
    })
    if (!Array.isArray(data) || data.length === 0) {
      rows.push({ pub, trip: null, error: 'rpc returned no rows' })
      continue
    }
    // The published table has no `members`, which rowToTrip takes as an argument.
    rows.push({
      pub,
      trip: rowToTrip(data[0], []),
      error: null,
      // A priced publication hides its days from anon, so its stop counts are
      // the paywall's, not the plan's. Say so instead of reporting it as fact.
      locked: pub.premium_price_inr !== null && pub.unpublished_at === null,
    })
  }
} catch (e) {
  if (!(e instanceof ProbeAbort)) throw e
  console.error(`[probe:next-step] ${e.message}`)
  process.exit(2)
}

// ------------------------------------------------------------- invariants
// What must hold for EVERY row, live data included. A failure here means the
// derivation met a shape it does not handle, which is the whole reason to run it.
const problems = []
for (const r of rows) {
  const id = r.pub.id
  if (!r.trip) { problems.push(`${id}: ${r.error}`); continue }
  const step = nextTripStep(r.trip)
  const ratio = plannedDayRatio(r.trip)
  if (!/^(add-dates|plan-day|book-stop|confirm-stop|add-cover|done)$/.test(step.kind)) problems.push(`${id}: bad kind ${step.kind}`)
  if (!step.label) problems.push(`${id}: empty label`)
  if (ratio.planned > ratio.total) problems.push(`${id}: planned ${ratio.planned} > total ${ratio.total}`)
  if (ratio.pct < 0 || ratio.pct > 100) problems.push(`${id}: pct out of range ${ratio.pct}`)
  if (ratio.total > 0 && Math.round((ratio.planned / ratio.total) * 100) !== ratio.pct) problems.push(`${id}: pct does not match its own ratio`)
}

const histogram = {}
for (const r of rows) {
  if (!r.trip) continue
  const kind = nextTripStep(r.trip).kind
  histogram[kind] = (histogram[kind] ?? 0) + 1
}
const dateless = rows.filter(r => r.trip && (!r.trip.startDate || !r.trip.endDate)).length
const fixtures = rows.filter(r => r.pub.id.startsWith('pub-fixture-')).length

// ------------------------------------------------------------------- output
if (JSON_OUT) {
  console.log(JSON.stringify({
    publications: rows.length,
    histogram,
    dateless,
    fixtures,
    problems,
    rows: rows.map(r => ({
      id: r.pub.id,
      priced: r.pub.premium_price_inr !== null,
      fixture: r.pub.id.startsWith('pub-fixture-'),
      dates: r.trip ? { start: r.trip.startDate, end: r.trip.endDate } : null,
      planned: r.trip ? plannedDayRatio(r.trip) : null,
      step: r.trip ? nextTripStep(r.trip) : null,
    })),
  }, null, 2))
} else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`\n${rows.length} publications — ${fixtures} fixture, ${rows.length - fixtures} real\n`)
  console.log(
    pad('publication', 28) + pad('dates', 13) + pad('planned', 16) + 'next step',
  )
  console.log('-'.repeat(96))
  for (const r of rows) {
    if (!r.trip) { console.log(pad(r.pub.id, 28) + r.error); continue }
    const step = nextTripStep(r.trip)
    const ratio = plannedDayRatio(r.trip)
    const dates = r.trip.startDate ? `${r.trip.startDate.slice(5)}` : 'NONE'
    const flag = r.locked ? ' (days locked)' : ''
    console.log(
      pad(r.pub.id, 28) +
      pad(dates, 13) +
      pad(`${ratio.planned}/${ratio.total} ${ratio.pct}%`, 16) +
      `${step.kind}: ${step.label}${flag}`,
    )
  }
  console.log(`\nhistogram  ${JSON.stringify(histogram)}`)
  console.log(`dateless   ${dateless} of ${rows.length}`)
  console.log(`fixtures   ${fixtures} (a fixture row skews the histogram — read it as a share, not a product fact)`)
  if (problems.length) {
    console.log(`\nproblems   ${problems.length}`)
    for (const p of problems) console.log(`  - ${p}`)
  } else {
    console.log('\ninvariants OK')
  }
}

process.exitCode = problems.length ? 1 : 0
