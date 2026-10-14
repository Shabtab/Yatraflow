#!/usr/bin/env node
// ============ Gallery research — geocode the places a draft itinerary names ============
// Stage 2 of docs/PLAYBOOK-GALLERY-RESEARCH.md: coordinates are LOOKED UP, never typed
// from memory. Hand-recalled coordinates for the Bylakuppe/Dubare/Nisargadhama cluster
// came out ~15 km off in the first reference draft — enough to bend every distance the
// engine then computed.
//
// The lookup itself lives in scripts/geocode-places.mjs, shared with the authoring
// scaffold (scripts/new-itinerary.mjs) so both resolve a place identically.
//
// Usage:
//   node scripts/gallery-geocode.mjs "Abbey Falls, Madikeri, Karnataka" "Dubare Elephant Camp, Karnataka"
//   node scripts/gallery-geocode.mjs --json places.txt        # one place per line → JSON array
//
// Output per place:  Name  ->  lat, lng  [matched display name]
// Exit 1 if any place has no match (so a research loop can't silently skip a stop).

import { geocodeMany, GEOCODE_USER_AGENT } from './geocode-places.mjs'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const inputs = args.filter(a => a !== '--json')

let places = inputs
if (inputs.length === 1 && /\.(txt|md)$/i.test(inputs[0])) {
  const { readFileSync } = await import('node:fs')
  places = readFileSync(inputs[0], 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
}
if (places.length === 0) {
  console.error('Usage: node scripts/gallery-geocode.mjs [--json] "<place, district, state>" [...] | <places.txt>')
  // Usage path: one message, then the empty list must stop the script before
  // geocodeMany runs. An immediate exit is allowed here (#656).
  process.exit(2)
}

void GEOCODE_USER_AGENT // exported for callers that need to identify themselves
const { results, missed } = await geocodeMany(places, {
  onResult: (row) => {
    if (asJson) return
    if (row.lat === null) console.log(`NO HIT  ${row.query}   ← rephrase with district + state, or drop the stop`)
    else console.log(`${row.query}\n  -> ${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}   [${row.matched}]`)
  },
})

if (asJson) console.log(JSON.stringify(results, null, 2))
else console.log(`\n${places.length - missed}/${places.length} geocoded.${missed ? ' Fix the misses before drafting — a guessed coordinate is the one error the import gates cannot catch.' : ''}`)

// exitCode, not process.exit: the summary above must not be truncated (#656).
process.exitCode = missed ? 1 : 0
