#!/usr/bin/env node
// ============ YatraFlow itinerary validator — Gate 1 of the gallery pipeline ============
// The executable half of docs/ITINERARY-IMPORT-SPEC.md (v2.0). Zero dependencies,
// node >= 18. Checks every structural contract the spec names; the ENGINE outcomes
// (health score, budget truth) are Gate 2's job — tests/golden-itineraries.test.ts —
// because re-implementing engine math here is how two truths drift apart.
//
// The RULES application-side live in src/lib/itinerarySpec.ts (the importer, the
// exporter and the repair pass share them). This CLI mirrors them deliberately —
// it must stay dependency-free so it runs on any checkout — and two tests keep the
// mirror honest: tests/trip-import.test.ts pins RULE_IDS + the key tables + the
// enums against the spec, and the golden test requires every shelf file to import
// with ZERO repairs. A rule that exists on one side only fails there.
//
// Usage:
//   node scripts/validate-itinerary.mjs <file.json> [more.json ...]
//   node scripts/validate-itinerary.mjs docs/examples/itineraries/
//
// Exit 0 = all files clean; exit 1 = at least one error. Warnings don't fail a run
// but are listed — gallery-grade means zero errors AND zero warnings.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const SPEC_VERSION = '2.0'

// ---- the rule set, shared with src/lib/itinerarySpec.ts (pinned by tests)
const FORMAT_VERSION = 3
const RULE_IDS = [
  'TRIP_SHAPE', 'FORMAT_VERSION', 'DAYS_SPAN', 'DAY_INDEX', 'ORDER_IN_DAY',
  'STOP_IDS_UNIQUE', 'NUMERIC_REQUIRED', 'COORDS_VALID', 'COORDS_NOT_PLACEHOLDER',
  'COORDS_DISTINCT', 'LEG_FIELDS_OMITTED', 'UNKNOWN_KEYS', 'ENUM_VOCAB',
  'PUBLICATION_MIRRORS_TRIP', 'REFERENCES_INTACT',
]

// ---- key allowlists, mirrored from src/lib/itinerarySpec.ts
const TRIP_KEYS = new Set(['id', 'name', 'startLocation', 'startLocationCoords', 'destinations', 'destinationCoords', 'startDate', 'endDate', 'travellers', 'driverCount', 'hasVulnerable', 'driveAfterDinnerMin', 'transportMode', 'drivesPart', 'fuelEconomyKmL', 'fuelPricePerL', 'roundTrip', 'vehicleProfile', 'tankL', 'rentPerDayInr', 'localTrain', 'flights', 'budgetPerPersonInr', 'travelStyle', 'stayStyle', 'fixedCommitments', 'days', 'expenses', 'coverEmoji', 'coverImageUrl', 'visibility', 'createdAt', 'updatedAt'])
const STOP_KEYS = new Set(['id', 'title', 'category', 'locationName', 'placeId', 'lat', 'lng', 'description', 'visitMinutes', 'openTime', 'closeTime', 'entryFeeInrPerPerson', 'transportCostInrTotal', 'priority', 'notes', 'sourceUrl', 'status', 'orderInDay', 'weatherSensitive', 'auto', 'eLoc', 'placeSource', 'exposure'])

// ---- enums mirrored from src/data/types.ts (keep in sync — pinned by tests/golden-itineraries.test.ts)
const TRANSPORT_MODES = ['car', 'rental', 'motorcycle', 'train', 'bus', 'flight', 'taxi', 'mixed']
const TRAVEL_STYLES = ['relaxed', 'balanced', 'packed', 'adventure', 'luxury', 'budget', 'family', 'spiritual', 'food-focused', 'creator']
const STOP_CATEGORIES = ['sightseeing', 'food', 'nature', 'beach', 'temple', 'adventure', 'shopping', 'museum', 'travel', 'hotel', 'rest', 'event', 'transport-hub']
const STOP_STATUSES = ['suggested', 'confirmed', 'rejected', 'maybe', 'needs-booking']
const PRIORITIES = ['must-do', 'nice-to-have', 'optional']
const PLACE_SOURCES = ['google', 'mappls', 'wikipedia', 'osm']
const EXPENSE_CATEGORIES = ['transport', 'accommodation', 'food', 'activities', 'entry-fees', 'tolls-parking', 'local-travel', 'emergency-buffer']
const COMMITMENT_TYPES = ['hotel-checkin', 'train-departure', 'flight-departure', 'event', 'other']
const STAY_STYLES = ['budget', 'comfort', 'luxury']
const PRICE_LADDER = [149, 199, 249, 499]

// ---- collectors
/** @type {Map<string, {errors: string[], warnings: string[]}>} */
const report = new Map()
let file = ''
const err = (m) => report.get(file).errors.push(m)
const warn = (m) => report.get(file).warnings.push(m)

// ---- strict-key tables: a typo'd key must never be silently dropped (the
// "breaks absolutely nothing" rule — an ignored field is a lie in the data).
const DAY_KEYS = new Set(['id', 'index', 'title', 'startTime', 'stops'])
const EXPENSE_KEYS = new Set(['id', 'label', 'category', 'amountInr', 'perPerson', 'optional', 'stopId', 'dayIndex', 'paidBy', 'settled'])
const COMMITMENT_KEYS = new Set(['id', 'title', 'type', 'dayIndex', 'time', 'notes'])
const PUB_KEYS = new Set(['id', 'tripId', 'creatorId', 'title', 'tagline', 'coverImageUrl', 'routeSummary', 'durationDays', 'estimatedBudgetPerPersonInr', 'travelStyle', 'bestSeason', 'travelTips', 'warningsAndAssumptions', 'freeDayIndexes', 'premiumPriceInr', 'subscriberCta'])
/** the export envelope (src/lib/itinerarySpec.ts buildTripExport) */
const ROOT_KEYS = new Set(['formatVersion', 'exportedAt', 'app', 'trip', 'publication'])
function checkKeys(obj, allowed, label) {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) err(`${label}: unknown key "${k}" — typo? (unknown keys are rejected so a silently-dropped field can't poison the import)`)
}

// ---- primitive checks
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isHHMM = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const isISODate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const hhmmToMin = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }

function checkCoords(label, lat, lng, { soft = false } = {}) {
  if (!isFiniteNum(lat) || !isFiniteNum(lng)) { err(`${label}: lat/lng must be finite numbers`); return }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { err(`${label}: lat/lng out of range (lat ±90, lng ±180)`); return }
  // Null Island and the MIXED placeholder (lat 0, real lng — the live incident): both coordinates checked
  if (lat === 0 && lng === 0) { err(`${label}: (0,0) is the Null-Island placeholder — real coordinates required`); return }
  if (lat === 0 || lng === 0) { err(`${label}: exactly one coordinate is 0 (the mixed-placeholder case that poisoned a live route) — both must be real`); return }
  if (!soft) {
    if (lat < 6 || lat > 37.5 || lng < 68 || lng > 97.5) warn(`${label}: coordinates outside the India corridor (${lat}, ${lng}) — intended?`)
  }
}

// ---- per-file validation
function validate(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { err('root: must be an object `{ trip, publication? }`'); return }

  // ===== the wire format declares itself =====
  for (const k of Object.keys(parsed)) {
    if (!ROOT_KEYS.has(k)) err(`root: unknown key "${k}" — typo? (allowed: ${[...ROOT_KEYS].join(', ')})`)
  }
  const declaredVersion = typeof parsed.formatVersion === 'number' ? parsed.formatVersion : undefined
  if (declaredVersion === undefined) {
    err(`root.formatVersion: missing — a gallery file declares the wire format it was authored for (currently ${FORMAT_VERSION}). Add "formatVersion": ${FORMAT_VERSION}.`)
  } else if (!Number.isInteger(declaredVersion) || declaredVersion < 1) {
    err(`root.formatVersion: ${JSON.stringify(parsed.formatVersion)} is not a version`)
  } else if (declaredVersion > FORMAT_VERSION) {
    err(`root.formatVersion: ${declaredVersion} is newer than this build reads (${FORMAT_VERSION}) — the shelf cannot ship a file readers cannot open`)
  } else if (declaredVersion < FORMAT_VERSION) {
    warn(`root.formatVersion: ${declaredVersion} is older than ${FORMAT_VERSION} — the importer migrates it, but the shelf ships current files`)
  }

  const { trip, publication } = parsed
  if (!trip || typeof trip !== 'object') { err('trip: required object missing'); return }
  checkKeys(trip, TRIP_KEYS, 'trip')

  // ===== trip required scalars =====
  for (const k of ['name', 'startLocation', 'startDate', 'endDate', 'coverEmoji', 'visibility']) {
    if (typeof trip[k] !== 'string' || !trip[k].trim()) err(`trip.${k}: required non-empty string`)
  }
  if (typeof trip.name === 'string' && trip.name.length > 80) err(`trip.name: ${trip.name.length} chars — max 80 (card display)`)
  if (trip.visibility !== 'public' && publication) warn('trip.visibility is not "public" but a publication is attached — gallery imports must be public')
  if (!isISODate(trip.startDate)) err(`trip.startDate: "${trip.startDate}" is not yyyy-mm-dd`)
  if (!isISODate(trip.endDate)) err(`trip.endDate: "${trip.endDate}" is not yyyy-mm-dd`)
  if (isISODate(trip.startDate) && isISODate(trip.endDate) && trip.endDate < trip.startDate) err('trip: endDate precedes startDate')

  if (!Number.isInteger(trip.travellers) || trip.travellers < 1) err(`trip.travellers: must be an integer ≥ 1`)
  if (!TRANSPORT_MODES.includes(trip.transportMode)) err(`trip.transportMode: "${trip.transportMode}" not in ${TRANSPORT_MODES.join(' · ')}`)
  // Mixed-only, tri-state (2026-10-19): a real boolean or absent. A string or
  // a number here would reach the planner as a truthy lie.
  if (trip.drivesPart !== undefined && typeof trip.drivesPart !== 'boolean') err(`trip.drivesPart: "${trip.drivesPart}" must be true, false, or absent`)
  if (trip.drivesPart !== undefined && trip.transportMode !== 'mixed') warn(`trip.drivesPart is set but transportMode is "${trip.transportMode}", which never asks`)
  if (!TRAVEL_STYLES.includes(trip.travelStyle)) err(`trip.travelStyle: "${trip.travelStyle}" not in ${TRAVEL_STYLES.join(' · ')}`)
  if (trip.stayStyle !== undefined && !STAY_STYLES.includes(trip.stayStyle)) err(`trip.stayStyle: "${trip.stayStyle}" not in ${STAY_STYLES.join(' · ')}`)
  if (trip.stayStyle === undefined) warn('trip.stayStyle: unset — it would derive from legacy travelStyle; set it explicitly so pricing is deliberate')

  if (!isFiniteNum(trip.budgetPerPersonInr) || trip.budgetPerPersonInr <= 0) err('trip.budgetPerPersonInr: required finite number > 0 (Gate 2 checks it against the engine ±15%)')

  // ===== coords =====
  if (!trip.startLocationCoords) err('trip.startLocationCoords: required for gallery imports (the map anchors here)')
  else checkCoords('trip.startLocationCoords', trip.startLocationCoords.lat, trip.startLocationCoords.lng)
  if (!Array.isArray(trip.destinations) || trip.destinations.length < 1) err('trip.destinations: required array with ≥ 1 entry')
  if (!Array.isArray(trip.destinationCoords) || trip.destinationCoords.length !== (trip.destinations?.length ?? 0)) {
    err('trip.destinationCoords: must be a parallel array to destinations (null-free for gallery imports)')
  } else {
    trip.destinationCoords.forEach((c, i) => {
      if (!c) err(`trip.destinationCoords[${i}]: null — gallery imports need every destination geocoded`)
      else checkCoords(`trip.destinationCoords[${i}]`, c.lat, c.lng)
    })
  }

  // ===== self-drive optional-but-checked fields =====
  const selfDrive = trip.transportMode === 'car' || trip.transportMode === 'rental' || trip.transportMode === 'motorcycle'
  if (selfDrive) {
    if (typeof trip.roundTrip !== 'boolean') warn('trip.roundTrip: unset on a self-drive trip — defaults to true (returns to start); set it to match the plan')
    if (trip.fuelEconomyKmL !== undefined) {
      const eco = trip.fuelEconomyKmL, moto = trip.transportMode === 'motorcycle'
      const lo = moto ? 25 : 10, hi = moto ? 45 : 25
      if (!isFiniteNum(eco) || eco <= 0) err(`trip.fuelEconomyKmL: must be a finite positive number`)
      else if (eco < lo || eco > hi) warn(`trip.fuelEconomyKmL: ${eco} km/L outside the plausible ${moto ? 'motorcycle' : 'car'} band ${lo}–${hi} — the engine flags implausible economies`)
    }
    if (trip.fuelPricePerL !== undefined && (!isFiniteNum(trip.fuelPricePerL) || trip.fuelPricePerL < 90 || trip.fuelPricePerL > 115)) {
      warn(`trip.fuelPricePerL: ${trip.fuelPricePerL} outside the ₹94–110 pump band — cite the state reality in warningsAndAssumptions or drop the field`)
    }
    if (trip.driverCount !== undefined && (!Number.isInteger(trip.driverCount) || trip.driverCount < 1)) err('trip.driverCount: integer ≥ 1')
  }

  // ===== days & stops =====
  if (!Array.isArray(trip.days) || trip.days.length === 0) { err('trip.days: required non-empty array'); return }
  const spanDays = isISODate(trip.startDate) && isISODate(trip.endDate)
    ? Math.round((Date.parse(trip.endDate + 'T00:00:00Z') - Date.parse(trip.startDate + 'T00:00:00Z')) / 86400000) + 1
    : null
  if (spanDays !== null && trip.days.length !== spanDays) {
    err(`trip.days: ${trip.days.length} days but the date span is ${spanDays} (inclusive) — these must match`)
  }
  const stopIds = new Set()
  const hotelBaseDays = new Set()
  let totalStops = 0

  trip.days.forEach((day, di) => {
    const tag = `days[${di}]`
    if (!day || typeof day !== 'object') { err(`${tag}: not an object`); return }
    checkKeys(day, DAY_KEYS, tag)
    if (day.index !== di) err(`${tag}.index: must equal the array position (${di}), got ${JSON.stringify(day.index)}`)
    if (typeof day.id !== 'string' || !day.id) err(`${tag}.id: required`)
    if (day.startTime !== undefined && !isHHMM(day.startTime)) err(`${tag}.startTime: "${day.startTime}" is not "HH:MM" 24h`)
    if (!Array.isArray(day.stops) || day.stops.length === 0) { err(`${tag}.stops: every day needs ≥ 1 stop (the day must go somewhere)`); return }
    if (day.stops.length < 3) warn(`${tag}.stops: only ${day.stops.length} — gallery rhythm is 3–6 per day`)
    if (day.stops.length > 6) warn(`${tag}.stops: ${day.stops.length} — gallery rhythm is 3–6 per day; six ticketed boxes make a checklist, not a day`)

    let wheelMinutes = 0
    day.stops.forEach((s, si) => {
      const t = `${tag}.stops[${si}]`
      if (!s || typeof s !== 'object') { err(`${t}: not an object`); return }
      checkKeys(s, STOP_KEYS, t)
      totalStops++
      for (const k of ['id', 'title', 'locationName']) {
        if (typeof s[k] !== 'string' || !s[k].trim()) err(`${t}.${k}: required non-empty string`)
      }
      if (typeof s.title === 'string' && s.title.length > 60) err(`${t}.title: ${s.title.length} chars — max 60`)
      if (stopIds.has(s.id)) err(`${t}.id: "${s.id}" duplicated — stop ids must be unique trip-wide`)
      stopIds.add(s.id)
      if (!STOP_CATEGORIES.includes(s.category)) err(`${t}.category: "${s.category}" not in ${STOP_CATEGORIES.join(' · ')}`)
      if (!PRIORITIES.includes(s.priority)) err(`${t}.priority: "${s.priority}" not in ${PRIORITIES.join(' · ')}`)
      if (!STOP_STATUSES.includes(s.status)) err(`${t}.status: "${s.status}" not in ${STOP_STATUSES.join(' · ')}`)
      else if (s.status !== 'confirmed') warn(`${t}.status: "${s.status}" — a gallery trip reads unfinished with unconfirmed stops`)
      if (s.placeSource !== undefined && !PLACE_SOURCES.includes(s.placeSource)) err(`${t}.placeSource: "${s.placeSource}" not in ${PLACE_SOURCES.join(' - ')}`)
      if (s.exposure !== undefined && s.exposure !== 'unknown') err(`${t}.exposure: "${s.exposure}" is not valid (only unknown in this format)`)
      checkCoords(`${t}`, s.lat, s.lng)
      if (!isFiniteNum(s.visitMinutes) || s.visitMinutes < 0) err(`${t}.visitMinutes: required finite number ≥ 0 (NaN here poisons the day's dwell)`)
      if (isFiniteNum(s.visitMinutes) && (s.visitMinutes < 10 || s.visitMinutes > 240)) warn(`${t}.visitMinutes: ${s.visitMinutes} min outside the sane 10–240 band`)
      if (!isFiniteNum(s.entryFeeInrPerPerson) || s.entryFeeInrPerPerson < 0) err(`${t}.entryFeeInrPerPerson: required finite number ≥ 0`)
      if (!isFiniteNum(s.transportCostInrTotal) || s.transportCostInrTotal < 0) err(`${t}.transportCostInrTotal: required finite number ≥ 0`)
      if (s.openTime !== undefined && s.closeTime === undefined) err(`${t}: openTime without closeTime — both or neither`)
      if (s.closeTime !== undefined && s.openTime === undefined) err(`${t}: closeTime without openTime — both or neither`)
      if (s.openTime !== undefined && s.closeTime !== undefined) {
        if (!isHHMM(s.openTime) || !isHHMM(s.closeTime)) err(`${t}: open/close times must be "HH:MM" 24h`)
        else if (hhmmToMin(s.openTime) > hhmmToMin(s.closeTime)) err(`${t}: openTime after closeTime (a venue past midnight is out of spec — split it across days)`)
      }
      if (s.departTime !== undefined || s.arrivalTime !== undefined || s.legDistanceKm !== undefined || s.legTravelMinutes !== undefined) {
        err(`${t}: leg fields (departTime/arrivalTime/legDistanceKm/legTravelMinutes) must be omitted — the engine measures legs; hand values contradict the road math`)
      }
      if (s.sourceUrl !== undefined && !/^https:\/\//.test(s.sourceUrl)) err(`${t}.sourceUrl: HTTPS only`)
      if (s.entryFeeInrPerPerson > 0 && s.sourceUrl === undefined) {
        warn(`${t}: a ticketed stop with no sourceUrl — the playbook's citation rule wants fees cited`)
      }
      if (s.category === 'hotel') hotelBaseDays.add(day.id)
      if (s.weatherSensitive === true && !['beach', 'nature', 'adventure', 'sightseeing'].includes(s.category)) {
        warn(`${t}.weatherSensitive: true on a "${s.category}" stop — reserve it for beach/nature/adventure/viewpoints`)
      }
    })
    // orderInDay contiguity — 1-based, because that is what the app itself
    // writes (createTrip / addStop / every renumber path use i+1). A 0-based
    // file does not throw, it silently repaints every stop's order, and any
    // `if (orderInDay)` style guard treats the first stop as unnumbered.
    // One message per day, not per stop: a wholly 0-based day is ONE mistake,
    // and printing it four times buries the other findings.
    const orders = day.stops.map(s => s.orderInDay).sort((a, b) => a - b)
    const nonInteger = orders.find(o => !Number.isInteger(o))
    if (nonInteger !== undefined) {
      err(`${tag}.stops: orderInDay must be an integer, got ${JSON.stringify(nonInteger)}`)
    } else if (orders.some((o, i) => o !== i + 1)) {
      err(`${tag}.stops: orderInDay must be 1-based and contiguous per day (the app numbers stops from 1) — sorted got [${orders.join(', ')}]`)
    }

    // One pin per place. Two stops on one coordinate are two pins drawn on top
    // of each other, a zero-length leg, and — when the day then drives — the
    // engine's own backtracking warning. This is the check whose absence let an
    // imported trip draw four stacked pins in Gulmarg (2026-09-18).
    //
    // ONE exception, because it is a fact rather than a shortcut: a meal at the
    // place you sleep or break IS one place. So at most two stops may share a
    // coordinate, and one of them must be a `food`, `hotel` or `rest` stop.
    const byCoord = new Map()
    for (const s of day.stops) {
      if (!s || typeof s !== 'object' || !isFiniteNum(s.lat) || !isFiniteNum(s.lng)) continue
      const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`
      byCoord.set(k, [...(byCoord.get(k) ?? []), s])
    }
    for (const [k, shared] of byCoord) {
      if (shared.length === 1) continue
      const isBaseOverlap = shared.length === 2 && shared.some(s => s.category === 'food' || s.category === 'hotel' || s.category === 'rest')
      if (isBaseOverlap) continue
      const names = shared.map(s => `"${s.title ?? '(untitled)'}" [${s.category ?? '?'}]`).join(', ')
      err(`${tag}.stops: ${shared.length} stops share the coordinate ${k} (${names}) — the map stacks their pins and the leg between them measures 0 km. Geocode each place separately: node scripts/gallery-geocode.mjs "<place, district, state>" (only a meal sharing its night's base may stay on one pin)`)
    }
  })

  // hotel coverage: every non-last day of a multi-day trip should sleep somewhere
  if (trip.days.length > 1 && hotelBaseDays.size < trip.days.length - 1) {
    warn(`trip: ${trip.days.length}-day trip but only ${hotelBaseDays.size} day(s) carry a hotel stop — nights must land where nights fall (lodging pricing keys on these)`)
  }

  // ===== expenses / commitments =====
  if (!Array.isArray(trip.expenses)) err('trip.expenses: required array (may be empty)')
  ;(trip.expenses ?? []).forEach((e, i) => {
    const t = `expenses[${i}]`
    if (!e || typeof e !== 'object') { err(`${t}: not an object`); return }
    checkKeys(e, EXPENSE_KEYS, t)
    if (typeof e.label !== 'string' || !e.label.trim()) err(`${t}.label: required`)
    if (!EXPENSE_CATEGORIES.includes(e.category)) err(`${t}.category: "${e.category}" not in ${EXPENSE_CATEGORIES.join(' · ')}`)
    if (!isFiniteNum(e.amountInr) || e.amountInr <= 0) err(`${t}.amountInr: required finite number > 0`)
    if (e.stopId !== undefined && !stopIds.has(e.stopId)) err(`${t}.stopId: "${e.stopId}" references no stop — broken references break the per-day stacks`)
    if (e.dayIndex !== undefined && (!Number.isInteger(e.dayIndex) || e.dayIndex < 0 || e.dayIndex >= trip.days.length)) err(`${t}.dayIndex: out of range`)
  })
  if (!Array.isArray(trip.fixedCommitments)) err('trip.fixedCommitments: required array (may be empty)')
  ;(trip.fixedCommitments ?? []).forEach((c, i) => {
    const t = `fixedCommitments[${i}]`
    if (!c || typeof c !== 'object') { err(`${t}: not an object`); return }
    checkKeys(c, COMMITMENT_KEYS, t)
    if (typeof c.title !== 'string' || !c.title.trim()) err(`${t}.title: required`)
    if (!COMMITMENT_TYPES.includes(c.type)) err(`${t}.type: "${c.type}" not in ${COMMITMENT_TYPES.join(' · ')}`)
    if (!Number.isInteger(c.dayIndex) || c.dayIndex < 0 || c.dayIndex >= trip.days.length) err(`${t}.dayIndex: out of range`)
    if (!isHHMM(c.time)) err(`${t}.time: "${c.time}" is not "HH:MM" 24h`)
  })

  // ===== publication =====
  if (publication) {
    const p = publication, pt = 'publication'
    checkKeys(p, PUB_KEYS, pt)
    if (typeof p.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id)) err(`${pt}.id: required slug matching ^[a-z0-9-]+$`)
    else if (p.id.length > 48) err(`${pt}.id: ${p.id.length} chars — max 48 (it IS the URL)`)
    if (typeof p.title !== 'string' || !p.title.trim()) err(`${pt}.title: required`)
    else if (p.title.length > 70) err(`${pt}.title: ${p.title.length} chars — max 70`)
    if (typeof p.tagline !== 'string' || !p.tagline.trim()) err(`${pt}.tagline: required — one honest sentence`)
    if (typeof p.coverImageUrl !== 'string' || !/^https:\/\//.test(p.coverImageUrl)) err(`${pt}.coverImageUrl: required HTTPS URL — the first impression lives here`)
    if (!Array.isArray(p.routeSummary) || p.routeSummary.length < 2) err(`${pt}.routeSummary: ordered place names, start → end`)
    if (p.durationDays !== trip.days.length) err(`${pt}.durationDays: ${p.durationDays} ≠ trip.days.length (${trip.days.length}) — the fork must not re-shape`)
    if (p.estimatedBudgetPerPersonInr !== trip.budgetPerPersonInr) err(`${pt}.estimatedBudgetPerPersonInr: ${p.estimatedBudgetPerPersonInr} ≠ trip.budgetPerPersonInr (${trip.budgetPerPersonInr}) — the fork must not re-price`)
    if (p.travelStyle !== trip.travelStyle) err(`${pt}.travelStyle: must equal trip.travelStyle (drives the Explore filter)`)
    if (!Array.isArray(p.travelTips) || p.travelTips.length < 3) err(`${pt}.travelTips: 3–6 trip-specific tips required`)
    else if (p.travelTips.length > 6) warn(`${pt}.travelTips: ${p.travelTips.length} — keep 3–6`)
    if (!Array.isArray(p.warningsAndAssumptions) || p.warningsAndAssumptions.length < 1) err(`${pt}.warningsAndAssumptions: required — the app's ethos is honesty about what an estimate assumes`)
    if (!Array.isArray(p.freeDayIndexes) || p.freeDayIndexes.length < 1) err(`${pt}.freeDayIndexes: ≥ 1 free day required`)
    else {
      const idx = new Set(trip.days.map((_, i) => i))
      for (const fi of p.freeDayIndexes) if (!idx.has(fi)) err(`${pt}.freeDayIndexes: ${fi} out of range`)
      const share = p.freeDayIndexes.length / trip.days.length
      if (share < 0.4) warn(`${pt}.freeDayIndexes: ${(share * 100).toFixed(0)}% of days free — the spec's generosity bar is ≥ ~40% (prove quality before the ask)`)
    }
    if (p.premiumPriceInr !== undefined && !PRICE_LADDER.includes(p.premiumPriceInr)) err(`${pt}.premiumPriceInr: ${p.premiumPriceInr} not on the ladder ${PRICE_LADDER.join(' / ')}`)
    for (const k of ['views', 'copies', 'publishedAt', 'refreshedAt']) {
      if (p[k] !== undefined) warn(`${pt}.${k}: tool-managed — omit it (import starts at 0/0/now)`)
    }
    if (/\(copy\)/i.test(p.title ?? '')) err(`${pt}.title: contains "(copy)" — never import a forked duplicate (the provenance rule)`)
  }

  // ===== first-impression summary (informational, not a check) =====
  console.log(`         stops: ${totalStops} · days: ${trip.days.length} · hotels: ${hotelBaseDays.size}`)
}

// ---- run
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error(`YatraFlow itinerary validator (spec v${SPEC_VERSION})\nUsage: node scripts/validate-itinerary.mjs <file.json | directory> [...]`)
  process.exit(2)
}
const files = []
for (const a of args) {
  if (statSync(a).isDirectory()) files.push(...readdirSync(a).filter(f => f.endsWith('.json')).map(f => join(a, f)))
  else files.push(a)
}
for (const f of files) {
  file = basename(f)
  report.set(file, { errors: [], warnings: [] })
  let parsed
  try { parsed = JSON.parse(readFileSync(f, 'utf8')) } catch (e) { err(`not valid JSON: ${e.message}`); continue }
  validate(parsed)
}
let failed = false
for (const [f, r] of report) {
  const status = r.errors.length ? 'FAIL' : r.warnings.length ? 'WARN' : 'PASS'
  console.log(`${status}  ${f}`)
  for (const e of r.errors) { console.log(`  ✗ ${e}`); failed = true }
  for (const w of r.warnings) console.log(`  ⚠ ${w}`)
}
process.exit(failed ? 1 : 0)
