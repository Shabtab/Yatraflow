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
// Reads: `published_itineraries` (anon-readable), page by page until the last
// row (#652 — the header promises EVERY publication, so no 500-row cap), then
// `get_public_trip` per publication for the trip row itself. A PRICED
// publication returns its locked days stubbed, which is marked in the output —
// those rows report `plan-day` for the paywall, not for the plan.
//
// The pure helpers (`readAllPages`, `readAccessState`) are exported for
// tests/next-step-probe.test.ts. The run sits behind the main-module check, so
// importing this file never starts a probe.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
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

const HEADERS = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }

// Every network wait is bounded (#652): a request that never answers must fail
// the probe, not hold it open until the runner gives up. Same bound as
// scripts/checkMigrations.mjs's per-request default.
const NET_TIMEOUT_MS = 15_000

async function getJson(path, init) {
  // Headers are merged here, not only at the call site: the publications read
  // passes no init, and without this merge it went out keyless and 401'd.
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: { ...HEADERS, ...init?.headers },
    signal: AbortSignal.timeout(NET_TIMEOUT_MS),
  })
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

// ------------------------------------------------------------------ pagination
// Read the whole collection, one page at a time (#652 AC1). The caller hands
// over a page fetch; the helper keeps asking with a rising offset until a page
// comes back short. A server that ignores the offset would repeat pages
// forever, so a repeated first row aborts instead of looping.
export const PAGE_SIZE = 500

export async function readAllPages(fetchPage, pageSize = PAGE_SIZE) {
  const all = []
  let prevFirst = null
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(pageSize, offset)
    if (!Array.isArray(page)) throw new ProbeAbort(`page at offset ${offset} is not an array`)
    const first = page.length > 0 ? JSON.stringify(page[0]) : null
    if (first !== null && first === prevFirst) {
      throw new ProbeAbort(`the server ignored offset ${offset} — the same page came back; refusing to loop`)
    }
    prevFirst = first
    all.push(...page)
    if (page.length < pageSize) return all
  }
}

// -------------------------------------------------------------- access state
// What this anonymous read actually RECEIVED, read from the SHAPE
// get_public_trip returned — not from the publication's price (#652 AC3). The
// RPC stamps LOCKED_STOP_MARKER onto every stubbed stop (#352), so the shape
// decides whenever stops exist. The price only narrows the last case: a locked
// preview whose days carry no stops to stamp, where the always-stripped money
// fields are the remaining signal.
export const LOCKED_STOP_MARKER = 'Locked — the full plan is on the original itinerary.'

export function readAccessState(pub, rawTrip) {
  if (!rawTrip) return 'no-row'
  const days = Array.isArray(rawTrip.days) ? rawTrip.days : []
  const stops = days.flatMap(d => (Array.isArray(d?.stops) ? d.stops : []))
  const stubbed = stops.filter(s => s?.description === LOCKED_STOP_MARKER).length
  if (stubbed > 0) return stubbed === stops.length ? 'locked' : 'partly-locked'
  if (typeof pub?.premium_price_inr === 'number') {
    const money = [rawTrip.expenses, rawTrip.fixed_commitments]
    if (money.every(m => Array.isArray(m) && m.length === 0)) return 'locked'
  }
  return 'whole'
}

// ------------------------------------------------------------------- surfaces
// Both output formats name what this probe checked and what it did not (#652
// AC7). The successful run reads anonymous publication rows only: the
// signed-in My Trips collection and the entitled views stay outside it.
export const SURFACES = {
  covered: [
    'collection published_itineraries (anon, paginated to the last row)',
    'RPC get_public_trip, one anon read per publication',
  ],
  notCovered: [
    'trips as the signed-in reader (the My Trips collection)',
    'entitled reads — creator and buyer views of a priced publication',
  ],
}

// ------------------------------------------------------------------------ run
async function run() {
  try {
    if (!URL_BASE || !ANON) die('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local or the environment).')

    const { rowToTrip, nextTripStep, plannedDayRatio } = await loadDerivation()

    const rows = []
    const pubs = await readAllPages((limit, offset) =>
      getJson(`/rest/v1/published_itineraries?select=id,premium_price_inr,duration_days,unpublished_at&limit=${limit}&offset=${offset}`))

    for (const pub of pubs) {
      const data = await getJson('/rest/v1/rpc/get_public_trip', {
        method: 'POST',
        body: JSON.stringify({ p_pub_id: pub.id }),
      })
      if (!Array.isArray(data) || data.length === 0) {
        rows.push({ pub, trip: null, error: 'rpc returned no rows', access: 'no-row' })
        continue
      }
      rows.push({
        pub,
        trip: rowToTrip(data[0], []),
        error: null,
        // The access state comes from the shape this read returned (see
        // readAccessState above), so a changed paywall shows up here as a
        // changed state instead of a price guess that still matches.
        access: readAccessState(pub, data[0]),
      })
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

    // ---------------------------------------------------------------- output
    if (JSON_OUT) {
      console.log(JSON.stringify({
        collection: 'published_itineraries',
        publications: rows.length,
        histogram,
        dateless,
        fixtures,
        problems,
        surfaces: SURFACES,
        rows: rows.map(r => ({
          id: r.pub.id,
          priced: r.pub.premium_price_inr !== null,
          access: r.access,
          fixture: r.pub.id.startsWith('pub-fixture-'),
          dates: r.trip ? { start: r.trip.startDate, end: r.trip.endDate } : null,
          planned: r.trip ? plannedDayRatio(r.trip) : null,
          step: r.trip ? nextTripStep(r.trip) : null,
        })),
      }, null, 2))
    } else {
      const pad = (s, n) => String(s).padEnd(n)
      console.log(`\npublished_itineraries: ${rows.length} publications — ${fixtures} fixture, ${rows.length - fixtures} real\n`)
      console.log(
        pad('publication', 28) + pad('dates', 13) + pad('planned', 16) + 'next step',
      )
      console.log('-'.repeat(96))
      for (const r of rows) {
        if (!r.trip) { console.log(pad(r.pub.id, 28) + r.error); continue }
        const step = nextTripStep(r.trip)
        const ratio = plannedDayRatio(r.trip)
        const dates = r.trip.startDate ? `${r.trip.startDate.slice(5)}` : 'NONE'
        const flag = r.access === 'locked' ? ' (days locked)'
          : r.access === 'partly-locked' ? ' (some days locked)' : ''
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
      console.log(`covers     ${SURFACES.covered.join(' · ')}`)
      console.log(`not covered ${SURFACES.notCovered.join(' · ')}`)
      if (problems.length) {
        console.log(`\nproblems   ${problems.length}`)
        for (const p of problems) console.log(`  - ${p}`)
      } else {
        console.log('\ninvariants OK')
      }
    }

    process.exitCode = problems.length ? 1 : 0
  } catch (e) {
    if (!(e instanceof ProbeAbort)) throw e
    // exitCode, never process.exit: an immediate exit can truncate this message
    // on Windows while the write is still queued (#656).
    console.error(`[probe:next-step] ${e.message}`)
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error('[probe:next-step]', e); process.exitCode = 1 })
}
