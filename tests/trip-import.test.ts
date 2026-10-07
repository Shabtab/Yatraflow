// ============ Trip import: formats, versions, and the repair pass ============
// Three bugs this file pins, all of them found on 2026-09-18:
//
//  1. a gallery file is `{ trip, publication }`, and the old import check looked
//     for `days` on the OUTER object — so every shelf itinerary was rejected;
//  2. the shelf files were authored 0-based while the app numbers stops from 1,
//     and nothing in the app noticed;
//  3. several shelf stops reused one town coordinate, so an imported trip drew
//     pins stacked on top of each other — the "map markers bugged out" report.
//
// The last two are now gated: the shelf must import with ZERO repairs and ZERO
// warnings, and the validator CLI must carry the same rule IDs.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseTripImport, TripImportError } from '../src/lib/tripImport'
import {
  ITINERARY_FORMAT_VERSION, SPEC_RULE_IDS, SPEC_VERSION, buildTripExport,
  digestImportReport, migrateTrip, publicationExport, readExport, usableCoords,
  DAY_KEYS, EXPENSE_KEYS, STOP_KEYS, TRIP_KEYS, PUBLICATION_KEYS,
} from '../src/lib/itinerarySpec'
import type { NormalizeReport } from '../src/lib/itinerarySpec'

const SHELF = 'docs/examples/itineraries'
const VALIDATOR = 'scripts/validate-itinerary.mjs'

/** A minimal bare-Trip export, the v1 shape an older "Download JSON" wrote. */
function bareExport() {
  return {
    id: 'trip-1',
    name: 'Goa weekend',
    startLocation: 'Panaji',
    destinations: ['Panaji', 'Palolem'],
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    travellers: 2,
    transportMode: 'car',
    budgetPerPersonInr: 12000,
    travelStyle: 'balanced',
    coverEmoji: '🏖️',
    fixedCommitments: [{ id: 'fc1', dayIndex: 0, title: 'Ferry', time: '09:00' }],
    expenses: [{ id: 'e1', label: 'Fuel', category: 'transport', amountInr: 2000 }],
    days: [
      { id: 'd1', index: 0, stops: [{ id: 's1', title: 'Fort', lat: 15.5, lng: 73.9, visitMinutes: 60, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, category: 'sightseeing', priority: 'must-do', status: 'confirmed', orderInDay: 1 }] },
      { id: 'd2', index: 1, stops: [{ id: 's2', title: 'Beach', lat: 15.01, lng: 74.02, visitMinutes: 90, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, category: 'beach', priority: 'must-do', status: 'confirmed', orderInDay: 1 }] },
    ],
  }
}

const reportOf = (json: unknown): NormalizeReport => parseTripImport(JSON.stringify(json)).report
const clean = (r: NormalizeReport) => r.repairs.length === 0 && r.warnings.length === 0 && r.droppedStops.length === 0 && r.unknownKeys.length === 0

describe('parseTripImport — format detection', () => {
  it('accepts a bare trip export (v1)', () => {
    const r = parseTripImport(JSON.stringify(bareExport()))
    expect(r.format).toBe('trip')
    expect(r.publication).toBeUndefined()
    expect(r.version).toBe(1)
    expect(r.trip.name).toBe('Goa weekend')
    expect(r.trip.days).toHaveLength(2)
    expect(r.summary).toContain('2-day trip')
  })

  it('accepts a gallery file and keeps the publication block (v1 envelope)', () => {
    const r = parseTripImport(JSON.stringify({
      trip: bareExport(),
      publication: { id: 'goa-north-to-south', title: 'Goa, North to the Quiet South', premiumPriceInr: 199 },
    }))
    expect(r.format).toBe('gallery')
    expect(r.publication?.id).toBe('goa-north-to-south')
    expect(r.publication?.premiumPriceInr).toBe(199)
    expect(r.summary).toContain('gallery itinerary')
  })

  it('accepts this build\'s versioned envelope (v2)', () => {
    const exported = buildTripExport({ ...bareExport(), createdAt: 0, updatedAt: 0 } as never, undefined, '9.9.9')
    const r = parseTripImport(JSON.stringify(exported))
    expect(r.version).toBe(ITINERARY_FORMAT_VERSION)
    expect(exported.formatVersion).toBe(ITINERARY_FORMAT_VERSION)
    expect(r.trip.name).toBe('Goa weekend')
  })

  it('round-trips a trip through the exporter without changing it', () => {
    const source = parseTripImport(JSON.stringify(bareExport())).trip
    const back = parseTripImport(JSON.stringify(buildTripExport(source, undefined, '9.9.9'))).trip
    expect(back.name).toBe(source.name)
    expect(back.days.map(d => d.stops.map(s => [s.title, s.lat, s.lng, s.orderInDay]))).toEqual(
      source.days.map(d => d.stops.map(s => [s.title, s.lat, s.lng, s.orderInDay])),
    )
    expect(back.expenses).toHaveLength(1)
    expect(back.fixedCommitments).toHaveLength(1)
  })

  it('accepts a bare trip that carries the version tag, without inventing a warning', () => {
    // A snapshot payload is a bare trip with `formatVersion` stamped in, and a
    // hand-written file may carry it too. The version is FILE metadata: reading
    // it as a trip field made a correct file warn about "a field nothing reads".
    const r = parseTripImport(JSON.stringify({ ...bareExport(), formatVersion: ITINERARY_FORMAT_VERSION }))
    expect(r.version).toBe(ITINERARY_FORMAT_VERSION)
    expect(r.report.unknownKeys).toEqual([])
    expect(clean(r.report)).toBe(true)
  })

  it('round-trips the publication half too, so a shelf file survives the file', () => {
    const pub = {
      id: 'goa-north-to-south', title: 'Goa, North to the Quiet South', tagline: 'Shacks to silence.',
      coverImageUrl: 'https://x/y.jpg', routeSummary: ['Panaji', 'Palolem'], durationDays: 2,
      estimatedBudgetPerPersonInr: 12000, travelStyle: 'balanced', freeDayIndexes: [1],
      views: 40, copies: 3, publishedAt: 1234,
    }
    const trip = parseTripImport(JSON.stringify(bareExport())).trip
    const back = parseTripImport(JSON.stringify(buildTripExport(trip, publicationExport(pub), '9.9.9')))
    expect(back.format).toBe('gallery')
    expect(back.publication).toEqual(publicationExport(pub))
    // …and the stats a reader must never inherit are gone.
    expect(back.publication).not.toHaveProperty('views')
    expect(back.publication).not.toHaveProperty('copies')
    expect(back.publication).not.toHaveProperty('publishedAt')
  })

  it('converges: exporting what it just imported produces the same file', () => {
    // The property that makes format evolution safe — a file that has been
    // through this build must not keep changing shape on every pass.
    const first = buildTripExport(parseTripImport(JSON.stringify({ trip: bareExport(), publication: { id: 'p', title: 'P' } })).trip, { id: 'p', title: 'P' }, '9.9.9')
    const second = parseTripImport(JSON.stringify(first))
    const third = buildTripExport(second.trip, second.publication as Record<string, unknown>, '9.9.9')
    // Ids are excluded on purpose, not to make the test pass: the importer mints
    // `imp_*` ids from a counter and the store re-ids every row on commit, so ids
    // are session-local by design. What must not drift is the SHAPE.
    const shape = (e: typeof first) => {
      const { exportedAt: _stamp, ...rest } = e
      void _stamp
      return JSON.parse(JSON.stringify(rest, (k, v) => (k === 'id' ? '<id>' : v)))
    }
    expect(shape(third)).toEqual(shape(first))
  })

  it('never lets the file decide visibility', () => {
    const trip = { ...bareExport(), visibility: 'public' }
    expect(parseTripImport(JSON.stringify(trip)).trip.visibility).toBe('private')
    expect(parseTripImport(JSON.stringify({ trip, publication: {} })).trip.visibility).toBe('private')
  })

  it('supplies the collections buildTripCopy maps over', () => {
    const { expenses: _e, fixedCommitments: _f, ...without } = bareExport()
    const r = parseTripImport(JSON.stringify(without))
    expect(r.trip.expenses).toEqual([])
    expect(r.trip.fixedCommitments).toEqual([])
  })

  it('drops tool-managed fields the file should not carry', () => {
    const r = parseTripImport(JSON.stringify({ ...bareExport(), inviteCode: 'GOA-K7QF', members: [{ userId: 'x' }] }))
    expect(r.trip.inviteCode).toBeUndefined()
    expect(r.trip.members).toBeUndefined()
    expect(r.trip.id).toBe('import-pending')
  })

  it('says a gallery file\'s publish details were not applied (they ride along)', () => {
    const pub = { id: 'goa', title: 'Goa', coverImageUrl: 'https://x/y.jpg', views: 40, copies: 3, publishedAt: 123 }
    const exported = publicationExport(pub)
    expect(exported.views).toBeUndefined()
    expect(exported.copies).toBeUndefined()
    expect(exported.publishedAt).toBeUndefined()
    expect(exported.coverImageUrl).toBe('https://x/y.jpg')
  })
})

describe('parseTripImport — the format version contract', () => {
  it('refuses a file written by a newer build, and says what to do', () => {
    const future = JSON.stringify({ formatVersion: ITINERARY_FORMAT_VERSION + 1, trip: bareExport() })
    expect(() => parseTripImport(future)).toThrow(TripImportError)
    expect(() => parseTripImport(future)).toThrow(/newer YatraFlow/)
    expect(() => parseTripImport(future)).toThrow(/Update the app/)
  })

  it('refuses a nonsense version', () => {
    for (const v of [0, -1, 1.5, 'two']) {
      expect(() => parseTripImport(JSON.stringify({ formatVersion: v, trip: bareExport() }))).toThrow(/not a version/)
    }
  })

  it('migrates every version below the current one', () => {
    // The chain must actually run — a v1 trip arrives at the current shape.
    expect(migrateTrip({ days: [] }, 1)).toBeTruthy()
    expect(readExport(JSON.stringify(bareExport())).version).toBe(1)
  })
})

describe('parseTripImport — the repair pass', () => {
  it('renumbers 0-based stop order to the app\'s 1-based convention', () => {
    // A CURRENT-version file can still carry a hand-edited 0-based order: the
    // wall repairs it and says so. A v1 file is renumbered by the migration
    // chain before the wall sees it (tests/itinerary-migrations.test.ts).
    const trip = { ...bareExport(), formatVersion: ITINERARY_FORMAT_VERSION }
    trip.days[0].stops[0].orderInDay = 0
    const r = parseTripImport(JSON.stringify(trip))
    expect(r.trip.days[0].stops[0].orderInDay).toBe(1)
    expect(r.report.repairs.join(' ')).toMatch(/Rebuilt the per-day stop order/)
  })

  it('fills missing numbers and collections instead of importing NaN', () => {
    const trip = bareExport()
    // @ts-expect-error deliberately incomplete, like a hand-written export
    delete trip.days[0].stops[0].visitMinutes
    // @ts-expect-error deliberately incomplete
    delete trip.days[0].stops[0].entryFeeInrPerPerson
    const r = parseTripImport(JSON.stringify(trip))
    const stop = r.trip.days[0].stops[0]
    expect(stop.visitMinutes).toBe(0)
    expect(stop.entryFeeInrPerPerson).toBe(0)
    expect(Number.isFinite(stop.transportCostInrTotal)).toBe(true)
    expect(r.report.repairs.join(' ')).toMatch(/visitMinutes/)
  })

  it('makes the date range agree with the plan\'s day count', () => {
    const trip = { ...bareExport(), endDate: '2026-11-09' } // 9 days of dates, 2 days of plan
    const r = parseTripImport(JSON.stringify(trip))
    expect(r.trip.days).toHaveLength(2)
    expect(r.trip.endDate).toBe('2026-11-02')
    expect(r.report.repairs.join(' ')).toMatch(/dates covered 9 days/)
  })

  it('drops hand-written leg fields — the engine measures the road', () => {
    // Same split as the renumber pin: the wall's own note belongs to a
    // current-version file; a v1 file is stripped silently by the chain.
    const trip = { ...bareExport(), formatVersion: ITINERARY_FORMAT_VERSION }
    Object.assign(trip.days[0].stops[0], { legDistanceKm: 220, departTime: '07:00' })
    const r = parseTripImport(JSON.stringify(trip))
    expect('legDistanceKm' in r.trip.days[0].stops[0]).toBe(false)
    expect(r.report.repairs.join(' ')).toMatch(/leg fields/)
  })

  it('re-issues duplicate stop ids', () => {
    const trip = bareExport()
    trip.days[1].stops[0].id = 's1'
    const r = parseTripImport(JSON.stringify(trip))
    const ids = r.trip.days.flatMap(d => d.stops.map(s => s.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reports fields nothing reads', () => {
    const trip = { ...bareExport(), transportCostInrPerPersonTotal: 99, days: bareExport().days.map(d => ({ ...d, vibe: 'chill' })) }
    const r = parseTripImport(JSON.stringify(trip))
    expect(r.report.unknownKeys.join(' ')).toMatch(/transportCostInrPerPersonTotal/)
    expect(r.report.warnings.join(' ')).toMatch(/nothing reads/)
    expect('transportCostInrPerPersonTotal' in r.trip).toBe(false)
  })

  // ---- the href boundary: imported sourceUrl meets StopEditor's own rule ----
  it('drops a non-http(s) sourceUrl and names it — an import cannot smuggle a javascript: link', () => {
    const trip = bareExport()
    Object.assign(trip.days[0].stops[0], { sourceUrl: 'javascript:alert(document.cookie)' })
    const r = parseTripImport(JSON.stringify(trip))
    expect(r.trip.days[0].stops[0].sourceUrl).toBeUndefined()
    expect(r.report.repairs.join(' ')).toMatch(/sourceUrl was not an http\(s\) link/)
  })

  it('keeps a genuine http(s) sourceUrl and drops data:/intent: schemes alike', () => {
    const trip = bareExport()
    Object.assign(trip.days[0].stops[0], { sourceUrl: 'https://en.wikipedia.org/wiki/Golkonda' })
    expect(parseTripImport(JSON.stringify(trip)).trip.days[0].stops[0].sourceUrl).toMatch(/^https:/)
    const sneaky = bareExport()
    Object.assign(sneaky.days[0].stops[0], { sourceUrl: 'data:text/html,<script>alert(1)</script>' })
    const r = parseTripImport(JSON.stringify(sneaky))
    expect(r.trip.days[0].stops[0].sourceUrl).toBeUndefined()
    expect(r.report.repairs.join(' ')).toMatch(/sourceUrl/)
  })

  // ---- the coordinate wall: refuse rather than fabricate ----
  it('drops a stop that cannot be placed, and names it', () => {
    const trip = bareExport()
    Object.assign(trip.days[0].stops[0], { lat: 0, lng: 0 })
    const r = parseTripImport(JSON.stringify(trip))
    expect(r.trip.days[0].stops).toHaveLength(0)
    expect(r.report.droppedStops).toHaveLength(1)
    expect(r.report.droppedStops[0].title).toBe('Fort')
    expect(r.report.droppedStops[0].reason).toMatch(/Null-Island/)
  })

  it('keeps the day when its stops were dropped — never renumbers the trip', () => {
    const trip = bareExport()
    Object.assign(trip.days[0].stops[0], { lat: 0, lng: 0 })
    const r = parseTripImport(JSON.stringify(trip))
    // Day 2 keeps its own content on index 1: dropping day 1 would shift every
    // dayIndex reference (commitments, expenses) by one.
    expect(r.trip.days).toHaveLength(2)
    expect(r.trip.days[0].index).toBe(0)
    expect(r.trip.days[1].index).toBe(1)
    expect(r.trip.days[1].stops[0].title).toBe('Beach')
    expect(r.report.warnings.join(' ')).toMatch(/the day imports empty/)
  })

  it('names the mixed-placeholder case (lat 0 with a real lng)', () => {
    const trip = bareExport()
    Object.assign(trip.days[0].stops[0], { lat: 0, lng: 73.9 })
    expect(parseTripImport(JSON.stringify(trip)).report.droppedStops[0].reason).toMatch(/only one coordinate/)
  })

  it('a hand-entered patch rescues a dropped stop and says so (#424)', () => {
    const trip = bareExport()
    Object.assign(trip.days[0].stops[0], { lat: 0, lng: 0 })
    const first = parseTripImport(JSON.stringify(trip))
    const d = first.report.droppedStops[0]
    // The report carries the keys the rescue needs: exact file position.
    expect(d.dayIndex).toBe(0)
    expect(d.stopIndex).toBe(0)
    const r = parseTripImport(JSON.stringify(trip), [
      { dayIndex: 0, stopIndex: 0, latitude: 15.3, longitude: 73.9 },
    ])
    expect(r.trip.days[0].stops).toHaveLength(1)
    expect(r.trip.days[0].stops[0].lat).toBeCloseTo(15.3)
    expect(r.trip.days[0].stops[0].lng).toBeCloseTo(73.9)
    expect(r.report.droppedStops).toHaveLength(0)
    expect(r.report.repairs.join(' ')).toMatch(/entered by hand/)
  })

  it('an invalid patch rescues nothing — the wall still refuses', () => {
    const trip = bareExport()
    Object.assign(trip.days[0].stops[0], { lat: 0, lng: 0 })
    const r = parseTripImport(JSON.stringify(trip), [
      { dayIndex: 0, stopIndex: 0, latitude: 0, longitude: 0 },
    ])
    expect(r.trip.days[0].stops).toHaveLength(0)
    expect(r.report.droppedStops).toHaveLength(1)
  })

  it('a patch is keyed to the exact file position — it cannot move another stop', () => {
    const trip = bareExport()
    Object.assign(trip.days[0].stops[0], { lat: 0, lng: 0 })
    // Day 1 stop 1 is fine; a patch naming it must not touch the dropped stop 0.
    const r = parseTripImport(JSON.stringify(trip), [
      { dayIndex: 1, stopIndex: 0, latitude: 1.1, longitude: 2.2 },
    ])
    expect(r.trip.days[0].stops).toHaveLength(0)
    expect(r.trip.days[1].stops[0].lat).toBeCloseTo(15.01)
    expect(r.report.droppedStops).toHaveLength(1)
  })

  it('refuses a file where nothing can be placed', () => {
    const trip = bareExport()
    for (const d of trip.days) for (const s of d.stops) { Object.assign(s, { lat: 0, lng: 0 }) }
    expect(() => parseTripImport(JSON.stringify(trip))).toThrow(/None of that file's stops could be placed/)
    expect(() => parseTripImport(JSON.stringify(trip))).toThrow(/Fort/)
  })

  // ---- pins: one per place ----
  it('warns when two sights share one pin', () => {
    const trip = bareExport()
    trip.days[0].stops.push({ ...trip.days[0].stops[0], id: 's1b', title: 'Palace' })
    const r = reportOf(trip)
    expect(r.warnings.join(' ')).toMatch(/share one coordinate/)
  })

  it('accepts a meal sharing its night\'s base — that is one place, not an overlap', () => {
    const trip = bareExport()
    trip.days[0].stops.push({
      id: 'eat', title: 'Dinner', category: 'food', locationName: 'Panaji', lat: 15.5, lng: 73.9,
      visitMinutes: 60, entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
      priority: 'must-do', status: 'confirmed', orderInDay: 2,
    })
    expect(reportOf(trip).warnings.filter(w => /share one coordinate/.test(w))).toHaveLength(0)
  })

  it('warns when two stops that are neither a meal nor a lodging share a pin', () => {
    const trip = bareExport()
    trip.days[0].stops.push({
      id: 'shop', title: 'Market', category: 'shopping', locationName: 'Panaji', lat: 15.5, lng: 73.9,
      visitMinutes: 60, entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
      priority: 'must-do', status: 'confirmed', orderInDay: 2,
    })
    expect(reportOf(trip).warnings.join(' ')).toMatch(/share one coordinate/)
  })

  it('warns when three stops pile onto one pin, even with a meal among them', () => {
    const trip = bareExport()
    for (const [id, category] of [['eat', 'food'], ['sleep', 'hotel']] as const) {
      trip.days[0].stops.push({
        id, title: id, category, locationName: 'Panaji', lat: 15.5, lng: 73.9,
        visitMinutes: 60, entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
        priority: 'must-do', status: 'confirmed', orderInDay: 2,
      })
    }
    expect(reportOf(trip).warnings.join(' ')).toMatch(/share one coordinate/)
  })
})

describe('usableCoords — the ONE coordinate rule the map also applies', () => {
  it('accepts real pairs and numeric strings', () => {
    expect(usableCoords(15.5, 73.9)).toEqual({ lat: 15.5, lng: 73.9 })
    expect(usableCoords('15.5', '73.9')).toEqual({ lat: 15.5, lng: 73.9 })
  })
  it('refuses (0,0), the mixed placeholder, out-of-range and junk', () => {
    for (const [a, b] of [[0, 0], [0, 73.9], [15.5, 0], [91, 20], [20, 181], [null, 10], ['x', 10], [NaN, 1]]) {
      expect(usableCoords(a, b), `${String(a)},${String(b)}`).toBeNull()
    }
  })
})

describe('digestImportReport — what the person holding the file is told', () => {
  it('is silent for a clean import', () => {
    expect(digestImportReport({ repairs: [], warnings: [], droppedStops: [], unknownKeys: [] })).toBeNull()
  })
  it('reports repairs as an ok toast', () => {
    const d = digestImportReport({ repairs: ['a', 'b'], warnings: [], droppedStops: [], unknownKeys: [] })
    expect(d?.kind).toBe('ok')
    expect(d?.message).toMatch(/fixed 2 things/)
  })
  it('treats a dropped stop as an error, not a note', () => {
    const d = digestImportReport({ repairs: [], warnings: [], droppedStops: [{ day: 2, dayIndex: 1, stopIndex: 0, title: 'Gondola', reason: 'x' }], unknownKeys: [] })
    expect(d?.kind).toBe('err')
    expect(d?.message).toMatch(/“Gondola”, Day 2/)
  })
})

describe('parseTripImport — every shelf file the repo ships', () => {
  const files = readdirSync(SHELF).filter(f => f.endsWith('.golden.json'))

  it('finds the shelf', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const f of files) {
    it(`imports ${f} with nothing to repair and nothing to warn about`, () => {
      const r = parseTripImport(readFileSync(join(SHELF, f), 'utf8'))
      // A shelf file is authored against the CURRENT contract: if the importer
      // has to fix it, the file (or the contract) is wrong — that is the gate
      // that would have caught the 2026-09-18 stacked-pin batch.
      expect(r.report).toEqual({ repairs: [], warnings: [], droppedStops: [], unknownKeys: [] })
      expect(r.version).toBe(ITINERARY_FORMAT_VERSION)
      expect(r.format).toBe('gallery')
      expect(r.trip.days.length).toBeGreaterThan(0)
      expect(r.trip.name).toBeTruthy()
      expect(r.publication?.id).toMatch(/^[a-z0-9-]+$/)
      // the publication's own contract: these two must agree with the trip
      expect(r.publication?.durationDays).toBe(r.trip.days.length)
      expect(r.publication?.estimatedBudgetPerPersonInr).toBe(r.trip.budgetPerPersonInr)
    })

    it(`keeps ${f}'s stop order 1-based and contiguous`, () => {
      const { trip } = parseTripImport(readFileSync(join(SHELF, f), 'utf8'))
      for (const d of trip.days) {
        expect(d.stops.map(s => s.orderInDay)).toEqual(d.stops.map((_, i) => i + 1))
      }
    })
  }
})

describe('the validator CLI carries the same contract', () => {
  const src = readFileSync(VALIDATOR, 'utf8')

  it(`implements spec v${SPEC_VERSION}`, () => {
    expect(src).toContain(`const SPEC_VERSION = '${SPEC_VERSION}'`)
  })

  it('names every rule ID the app-side spec declares', () => {
    for (const id of SPEC_RULE_IDS) {
      expect(src, `validator is missing rule ${id}`).toContain(`'${id}'`)
    }
  })

  it('mirrors every key allowlist that decides what is silently dropped', () => {
    for (const keys of [TRIP_KEYS, DAY_KEYS, STOP_KEYS, EXPENSE_KEYS, PUBLICATION_KEYS]) {
      for (const k of keys) expect(src, `validator is missing key "${k}"`).toContain(`'${k}'`)
    }
  })

  it('requires the same format version the app writes', () => {
    expect(src).toContain(`const FORMAT_VERSION = ${ITINERARY_FORMAT_VERSION}`)
  })
})

describe('parseTripImport — refusals say what is actually wrong', () => {
  const cases: [string, string, RegExp][] = [
    ['empty file', '   ', /empty/i],
    ['not JSON', 'name,destinations\nGoa,Panaji', /not JSON/i],
    ['a bare array', '[1,2,3]', /not a YatraFlow trip export/i],
    ['a snapshot payload', 'yf1_eJyrVkrLz1', /snapshot-link payload/i],
    ['a publication row', JSON.stringify({ id: 'p', title: 'X', tagline: 'y', routeSummary: ['A'], premiumPriceInr: 199 }), /published-itinerary row/i],
    ['publication but no trip', JSON.stringify({ publication: { title: 'X' } }), /no `trip` block/i],
    ['no days', JSON.stringify({ name: 'X', destinations: [] }), /no itinerary days/i],
    ['a truncated day', JSON.stringify({ name: 'X', days: [{ id: 'd1' }] }), /Day 1 .* truncated/i],
    ['an empty day list', JSON.stringify({ name: 'X', days: [] }), /no itinerary days/i],
  ]

  for (const [label, input, pattern] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => parseTripImport(input)).toThrow(TripImportError)
      expect(() => parseTripImport(input)).toThrow(pattern)
    })
  }

  it('reports the day number of a truncated file', () => {
    const days = [
      { id: 'd1', stops: [{ id: 'a', title: 'A', lat: 15.5, lng: 73.9 }] },
      { id: 'd2', stops: [{ id: 'b', title: 'B', lat: 15.6, lng: 73.8 }] },
      { id: 'd3' },
    ]
    expect(() => parseTripImport(JSON.stringify({ name: 'X', days }))).toThrow(/Day 3/)
  })
})
