// ============ #408 + #411 + #412 + #414 — the settings form says what it will do ============
//
// #408: a refused shrink (a trailing day holding stops) was a toast, and the
// Preview had nothing to say about it — so the user learned the save failed
// after the toast faded, with no way to the day that blocked it. One dry-run
// predicate now answers "would this save be accepted, and if not, why" for
// BOTH the live receipt and the Save button, and the refusal renders inline
// with the blocking days linked to their timeline day.
//
// #411: the form held destinations and their coords as two independent
// states and re-zipped them optimistically, so a rename or a remove slid
// names out from under their pins (Kochi inherited Munnar's coords). The form
// boundary now carries ONE array of {name, lat?, lng?} pairs; the row's
// parallel arrays exist only at the save mapping.
//
// #412: capacity/economy are read against the mode's own default vehicle
// profile. A mode change left the previous vehicle's numbers in the boxes,
// and a stated 200 km/L parsed to undefined and CLEARED the stored value.
// Non-blank out-of-range now refuses the save; blank still means default.
//
// #414: halt plans survived settings changes they were not authored against
// (km points tuned for a 3-day bus trip served on a 4-day car trip), zombie
// keys named days the grid no longer had, and Settings last-writer-wins a
// remote edit silently. Stamp, prune, warn — pinned at the pure boundary;
// the React wiring is pinned by source guards below.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Trip, ItineraryStop } from '../src/data/types'
import { seedData } from '../src/data/seed'

const { state } = vi.hoisted(() => ({ state: { tables: {} as Record<string, unknown[]>, sessionUser: null as string | null } }))
vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let method: string | undefined
    const builder: Record<string, unknown> = {}
    const chain = (m: string) => { method = m; return builder }
    builder.update = () => chain('update')
    builder.insert = () => chain('insert')
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => resolve({ data: state.tables[table] ?? [], error: null })).then(res)
    return builder
  }
  const chain: Record<string, unknown> = { on: () => chain, subscribe: () => ({}) }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: () => Promise.resolve({ data: [], error: null }),
      channel: () => chain,
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  }
})

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
import { readFileSync } from 'node:fs'
// The predicate and the seed factory live on the form; the store import chain
// rides the same mock the session-lifecycle harness uses.
import { settingsDryRun, formFromTrip } from '../src/pages/trip/TripSettingsForm'
import { zipDests, splitDests, renameDest } from '../src/lib/destPairs'
import { parseCapacityL, parseVehicleEconomy } from '../src/lib/vehicleProfile'
import { reconcileDays } from '../src/store/store'
import { pruneHaltKeys, isHaltCacheFresh } from '../src/hooks/useSuggestionCache'

const stop = (id: string): ItineraryStop => ({ id, index: 0, title: 'A stop', orderInDay: 0 } as ItineraryStop)

/** A four-day trip, budget + party set, empty grid by default. */
function trip4(fill: 'none' | 'tail-stops' = 'none'): Trip {
  const t = structuredClone(seedData.trips[0]) as Trip
  t.budgetPerPersonInr = 5000
  t.travellers = 2
  t.startDate = '2026-10-01'
  t.endDate = '2026-10-04'
  t.fixedCommitments = []
  t.days = [0, 1, 2, 3].map(i => ({
    id: `d${i}`, index: i,
    stops: fill === 'tail-stops' && i >= 2 ? [stop(`s${i}`)] : [],
  }))
  return t
}

beforeEach(() => { state.tables = {}; state.sessionUser = null })

// ================= #411 — one pair array, split only at the boundary =================

describe('#411 — the name/coord pair boundary', () => {
  it('zips positionally and preserves pin-less nulls — never compacts', () => {
    const pairs = zipDests(['Kochi', 'Munnar', 'Thekkady'], [{ lat: 9.9, lng: 76.3 }, null, null])
    expect(pairs).toEqual([
      { name: 'Kochi', lat: 9.9, lng: 76.3 },
      { name: 'Munnar' },
      { name: 'Thekkady' },
    ])
    // The nulls survive the split at their own indexes — byte-for-byte the
    // create-path convention, so a settings re-save never "heals" the row.
    const { destinations, destinationCoords } = splitDests(pairs)
    expect(destinations).toEqual(['Kochi', 'Munnar', 'Thekkady'])
    expect(destinationCoords).toEqual([{ lat: 9.9, lng: 76.3 }, null, null])
  })

  it('a legacy row with more names than coords keeps every name, unpinned', () => {
    const pairs = zipDests(['A', 'B'], [{ lat: 1, lng: 2 }])
    expect(pairs).toEqual([{ name: 'A', lat: 1, lng: 2 }, { name: 'B' }])
  })

  it('rename keeps the pin and the position — the bug was the array rebuild', () => {
    const pairs = zipDests(['Kochi', 'Munnar'], [{ lat: 9.9, lng: 76.3 }, null])
    const renamed = renameDest(pairs, 1, 'Munnar Hills')
    expect(renamed[1]).toEqual({ name: 'Munnar Hills' })
    expect(renamed[0]).toEqual({ name: 'Kochi', lat: 9.9, lng: 76.3 })
  })

  it('the dry run writes the pair split, so names and pins cannot disagree', () => {
    const trip = trip4()
    trip.destinations = ['Kochi', 'Munnar']
    trip.destinationCoords = [{ lat: 9.9, lng: 76.3 }, null]
    const f = formFromTrip(trip)
    const run = settingsDryRun(f, zipDests(trip.destinations, trip.destinationCoords), null, trip)
    expect(run.ok).toBe(true)
    if (!run.ok) return
    expect(run.patch.destinations).toEqual(['Kochi', 'Munnar'])
    expect(run.patch.destinationCoords).toEqual([{ lat: 9.9, lng: 76.3 }, null])
  })
})

// ================= #412 — mode-defaulted vehicles, ranges that refuse =================

describe('#412 — the vehicle dial refuses instead of clearing', () => {
  it('blank is the vehicle default; non-blank out-of-range is not a number', () => {
    expect(parseCapacityL('')).toBeUndefined()
    expect(parseCapacityL('45')).toBe(45)
    expect(parseCapacityL('500')).toBeUndefined()
    expect(parseVehicleEconomy('')).toBeUndefined()
    expect(parseVehicleEconomy('6.5')).toBe(6.5)
    expect(parseVehicleEconomy('200')).toBeUndefined()
    expect(parseVehicleEconomy('1')).toBeUndefined()
  })

  it('a stated 200 km/L refuses the save with the reason — it does not clear', () => {
    const trip = trip4()
    const f = { ...formFromTrip(trip), capacity: '500', vehicleEconomy: '200' }
    const run = settingsDryRun(f, [], null, trip)
    expect(run.ok).toBe(false)
    if (run.ok) return
    expect(run.reason).toMatch(/capacity must be 1-300/)
  })

  it('an out-of-range economy refuses on its own', () => {
    const trip = trip4()
    const f = { ...formFromTrip(trip), vehicleEconomy: '120' }
    const run = settingsDryRun(f, [], null, trip)
    expect(run.ok).toBe(false)
    if (run.ok) return
    expect(run.reason).toMatch(/Economy must be 2-80/)
  })

  it('blank boxes save the CHOSEN vehicle default, not car numbers', () => {
    const trip = trip4()
    const f = { ...formFromTrip(trip), vehicleType: 'motorcycle', capacity: '', vehicleEconomy: '' }
    const run = settingsDryRun(f, [], null, trip)
    expect(run.ok).toBe(true)
    if (!run.ok) return
    // The motorcycle's own 12 L / 40 km-L — the pre-#412 code wrote car numbers.
    expect(run.patch.vehicleProfile).toMatchObject({ vehicleType: 'motorcycle', capacity: 12, economy: 40 })
  })
})

// ================= #408 — one predicate for the preview and the write =================

describe('#408 — the dry run answers before any write', () => {
  it('a refused shrink names the blocking days, by index', () => {
    const trip = trip4('tail-stops')
    const f = { ...formFromTrip(trip), endDate: '2026-10-02' }
    const run = settingsDryRun(f, [], null, trip)
    expect(run.ok).toBe(false)
    if (run.ok) return
    expect(run.reason).toMatch(/Day 3 still has stops/)
    expect(run.blocked).toEqual([2, 3])
  })

  it('reconcileDays publishes the same indexes for the UI to link', () => {
    const trip = trip4('tail-stops')
    const rec = reconcileDays(trip.days, '2026-10-01', '2026-10-02', new Set(trip.fixedCommitments.map(c => c.dayIndex)))
    expect(rec.error).toBeTruthy()
    expect(rec.blocked).toEqual([2, 3])
    // The error string is unchanged — existing pins of the copy still hold.
    expect(rec.error).toMatch(/Day 3 still has stops or a fixed commitment/)
  })

  it('the date pair and the end-before-start are refused before any store write', () => {
    const trip = trip4()
    const bad = settingsDryRun({ ...formFromTrip(trip), startDate: 'not-a-date' }, [], null, trip)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toMatch(/Pick both a start and an end date/)
    const flipped = settingsDryRun({ ...formFromTrip(trip), endDate: '2026-09-01' }, [], null, trip)
    expect(flipped.ok).toBe(false)
    if (!flipped.ok) expect(flipped.reason).toMatch(/must be on or after/)
  })

  it('an unchanged date range skips the reconcile entirely', () => {
    const trip = trip4('tail-stops')
    const f = formFromTrip(trip)
    const run = settingsDryRun(f, [], null, trip)
    // The same dates the row carries: the tail stops are nobody's business.
    expect(run.ok).toBe(true)
  })
})

// ================= the React wiring, pinned by source guards =================

describe('#408/#412/#414 — the form and its neighbours are wired as pinned', () => {
  const form = read('../src/pages/trip/TripSettingsForm.tsx')
  const ws = read('../src/pages/TripWorkspace.tsx')
  const cache = read('../src/hooks/useSuggestionCache.ts')
  const panel = read('../src/pages/trip/timeline/TravelPanel.tsx')
  const banner = read('../src/components/RemoteEditBanner.tsx')

  it('the preview and Save share the ONE dry run — derived, never stored', () => {
    // Computed once per render...
    expect(form).toMatch(/const dry = settingsDryRun\(f, dests, startPin, trip\)/)
    // ...the Save button runs it (a refusal is a no-op — the reason is already
    // rendered inline), not a second copy of the checks...
    expect(form).toMatch(/if \(!dry\.ok\) return/)
    expect(form).toMatch(/updateTrip\(trip\.id, dry\.patch\)/)
    // ...and the receipt renders the same refusal, with the day links.
    expect(form).toMatch(/ts-receipt-refusal/)
    expect(form).toMatch(/<BlockedDayLinks blocked=\{dry\.blocked\} onOpenDay=\{onOpenDay\} \/>/)
    // The inline render sits under the dates, not only in a toast.
    expect(form).toMatch(/ts-save-refusal/)
    // The refusal is derived, so there is no reason STATE to go stale.
    expect(form).not.toMatch(/setSaveErr/)
  })

  it('a mode change carries the vehicle profile defaults in with it', () => {
    expect(form).toMatch(/const vt = m === 'motorcycle' \? 'motorcycle' : 'car'/)
    expect(form).toMatch(/defaultVehicleProfile\(vt\)/)
    expect(form).toMatch(/capacity: String\(d\.capacity\), vehicleEconomy: String\(d\.economy\)/)
  })

  it('the rename affordance edits in place and keeps the pins', () => {
    expect(form).toMatch(/renameDest\(list, i, renameDraft\.trim\(\)/)
    expect(form).toMatch(/renamingDest === i \? \(/)
    expect(form).toMatch(/aria-label=\{`Rename \$\{d\.name\}`\}/)
  })

  it('settings warns on a remote edit with the shared banner', () => {
    expect(form).toMatch(/import \{ RemoteEditBanner \}/)
    expect(form).toMatch(/\{remoteAt !== null && \(/)
    expect(form).toMatch(/noun="trip settings"/)
    // keep-mine rebases the watch; take-theirs reseeds the whole draft.
    expect(form).toMatch(/onTakeTheirs=\{\(\) => reseedFrom\(trip\)\}/)
    // The shared banner keeps its stop-editor default — one component, two nouns.
    expect(banner).toMatch(/noun = 'stop'/)
    expect(banner).toMatch(/edited this \{noun\} while you had it open/)
  })

  it('halt plans are stamped, freshness-checked, and zombies pruned', () => {
    // One version bump so un-stamped payloads evict rather than hydrate "fresh".
    expect(cache).toMatch(/const CACHE_VERSION = 7/)
    expect(cache).toMatch(/inputsHash: string; ts: number \}>/)
    expect(cache).toMatch(/setHaltCache = useCallback\(\(dayIndex: number, segments: SegmentHit\[\], plan: HaltPlanItem\[\], inputsHash: string\)/)
    // The stamp and the check are the pure exports, not inline copies.
    expect(panel).toMatch(/setHaltCache\(day\.index, hits, sorted\.map\(.*\), haltInputsHash\)/)
    expect(panel).toMatch(/if \(!isHaltCacheFresh\(cached, haltInputsHash\)\) \{ setHaltStale\(true\); return \[\] \}/)
    expect(panel).toMatch(/planInputsHash\(\{/)
    // The workspace hands the hook the day count — the single eviction point.
    expect(ws).toMatch(/useSuggestionCache\(tripId, trip \? trip\.days\.length : Number\.POSITIVE_INFINITY\)/)
    // Settings can jump to a timeline day.
    expect(ws).toMatch(/onOpenDay=\{\(dayIndex\) => \{ setTimelineFocusDay\(dayIndex\); setTab\('timeline'\) \}\}/)
  })

  it('the pure helpers the guards above lean on', () => {
    expect(pruneHaltKeys({ 0: x, 1: x, 4: x }, 2)).toEqual({ 0: x, 1: x })
    expect(isHaltCacheFresh({ inputsHash: 'a' }, 'a')).toBe(true)
    expect(isHaltCacheFresh({ inputsHash: 'a' }, 'b')).toBe(false)
    expect(isHaltCacheFresh(null, 'a')).toBe(false)
  })
})

const x = { segments: [], plan: [], inputsHash: 'h', ts: 0 }
