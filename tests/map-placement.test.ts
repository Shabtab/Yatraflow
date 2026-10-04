/**
 * #418 — the map's own search files nothing by itself.
 *
 * The placement list is pure, so it is tested directly; the two properties that
 * cannot be seen in a return value (the surface writes nothing on its own, and
 * there is still exactly ONE route-aware search) are pinned as source guards, the
 * way this repo tests page-level wiring without a DOM.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { placementOptions, placementPrompt, canPlaceHit, VOTE_MIN_PLACES } from '../src/pages/trip/mapPlacement'
import type { PlaceHit } from '../src/lib/providers/hits'

const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')
const omnibar = readFileSync(new URL('../src/pages/trip/MapOmnibar.tsx', import.meta.url), 'utf8')
const placementHook = readFileSync(new URL('../src/pages/trip/map/useOmnibarPlacement.ts', import.meta.url), 'utf8')

const hit = (over: Partial<PlaceHit> = {}): PlaceHit =>
  ({ id: 'h1', name: 'Kodikuthy View Point', latitude: 9.9, longitude: 76.7, kind: 'poi', ...over }) as PlaceHit

const base = {
  dayIndex: 0,
  placeDayIndex: 0,
  placeDayLabel: 'Kochi to Munnar — waterfalls en route',
  km: 73,
  filingOptions: [] as Array<{ key: string; label: string; noun: string }>,
  alreadyAdded: false,
  shortlisted: false,
  shortlistCount: 0,
}

describe('#418 — placement choices', () => {
  it('offers nothing until a place is selected', () => {
    expect(placementOptions({ ...base, hit: null })).toEqual([])
  })

  it('asks where the place should go, by name', () => {
    expect(placementPrompt('Valara Waterfalls')).toBe('Where should “Valara Waterfalls” go?')
  })

  it('names the day it would land on, and says so when that day is a guess', () => {
    const measured = placementOptions({ ...base, hit: hit() })
    expect(measured[0].kind).toBe('day')
    expect(measured[0].label).toBe('Add to Day 1')
    expect(measured[0].hint).toContain('~73 km into the route')
    expect(measured[0].hint).toContain('Kochi to Munnar')

    const unplaced = placementOptions({ ...base, hit: hit(), km: null })
    expect(unplaced[0].hint).toMatch(/guess/i)
    expect(unplaced[0].hint).toMatch(/change it in the stop editor/i)
  })

  it('names the day the stop editor will open on, not the rail\'s day (#I-41)', () => {
    // The defect: the label named the active day while the editor preselected
    // the day the hit's road position reaches.
    const options = placementOptions({
      ...base,
      dayIndex: 0,
      placeDayIndex: 2,
      placeDayLabel: 'Munnar to Madurai',
      km: 420,
      hit: hit(),
      filingOptions: [{ key: 'day1:lunch', label: 'Add as Lunch', noun: 'lunch' }],
    })
    const dayOption = options.find(o => o.kind === 'day')!
    expect(dayOption.label).toBe('Add to Day 3')
    expect(dayOption.hint).toContain('Day 3: Munnar to Madurai')
    // The slots belong to the rail's own day, so their hint keeps naming it.
    const slot = options.find(o => o.kind === 'slot')!
    expect(slot.hint).toContain("Day 1's empty lunch")
  })

  it('offers one option per empty part the place could serve, carrying its slot', () => {
    const options = placementOptions({
      ...base,
      hit: hit({ category: 'food' }),
      filingOptions: [
        { key: 'day1:lunch', label: 'Add as Lunch', noun: 'lunch' },
        { key: 'day1:dinner', label: 'Add as Dinner', noun: 'dinner' },
      ],
    })
    const slots = options.filter(o => o.kind === 'slot')
    expect(slots.map(o => o.slotKey)).toEqual(['day1:lunch', 'day1:dinner'])
    expect(slots.every(o => !o.disabled)).toBe(true)
    expect(slots[0].hint).toContain('lunch')
  })

  it('collects onto the shortlist without touching the plan, and offers to undo it', () => {
    const off = placementOptions({ ...base, hit: hit() }).find(o => o.kind === 'shortlist')!
    expect(off.label).toBe('Put it on the shortlist')
    expect(off.disabled).toBe(false)
    expect(off.hint).toMatch(/without touching the plan/i)

    const on = placementOptions({ ...base, hit: hit(), shortlisted: true }).find(o => o.kind === 'shortlist')!
    expect(on.label).toBe('Remove from the shortlist')
  })

  it('will not offer a vote for a place that is not on the shortlist', () => {
    // A vote is raised FROM the tray: offering it here would either promise a poll
    // that cannot be posted, or quietly shortlist the place for the user.
    const vote = placementOptions({ ...base, hit: hit() }).find(o => o.kind === 'vote')!
    expect(vote.disabled).toBe(true)
    expect(vote.reason).toMatch(/put this one on the shortlist first/i)
  })

  it('offers the vote once the shortlist can actually compare two places', () => {
    const alone = placementOptions({ ...base, hit: hit(), shortlisted: true }).find(o => o.kind === 'vote')!
    expect(alone.disabled).toBe(true)
    expect(alone.reason).toContain(`needs ${VOTE_MIN_PLACES} places`)

    const ready = placementOptions({ ...base, hit: hit(), shortlisted: true, shortlistCount: 1 }).find(o => o.kind === 'vote')!
    expect(ready.disabled).toBe(false)
    expect(ready.label).toBe('Ask the crew to vote')
  })

  it('files nothing when the place has no map position yet', () => {
    // The pitfall the issue names: an unresolved placeholder must not reach trip
    // data through this surface. Two shapes of "unplaced", both refused.
    for (const unplaced of [hit({ latitude: Number.NaN }), hit({ latitude: 0, longitude: 0 })]) {
      expect(canPlaceHit(unplaced)).toBe(false)
      const options = placementOptions({ ...base, hit: unplaced })
      expect(options.length).toBeGreaterThan(0)
      expect(options.every(o => o.disabled)).toBe(true)
      expect(options.every(o => (o.reason ?? '').includes('no map position yet'))).toBe(true)
    }
  })

  it('files nothing for a place that is already in the trip, on any path', () => {
    const options = placementOptions({ ...base, hit: hit(), alreadyAdded: true })
    expect(options.every(o => o.disabled)).toBe(true)
    expect(options.every(o => (o.reason ?? '').includes('already in your trip'))).toBe(true)
  })

  it('says why every disabled option is disabled', () => {
    const cases = [
      placementOptions({ ...base, hit: hit({ latitude: Number.NaN }) }),
      placementOptions({ ...base, hit: hit(), alreadyAdded: true }),
      placementOptions({ ...base, hit: hit() }),
    ]
    for (const options of cases) {
      for (const option of options) {
        if (option.disabled) expect(option.reason, `${option.kind} is disabled without a reason`).toBeTruthy()
      }
    }
  })
})

describe('#418 — the omnibar files nothing on its own', () => {
  it('never reaches for a writer: it renders choices and calls back', () => {
    expect(omnibar).not.toMatch(/\bapplyChange\b/)
    expect(omnibar).not.toMatch(/\bnewStopId\b/)
    expect(omnibar).not.toMatch(/\baddDecision\b/)
    expect(omnibar).not.toMatch(/from '[^']*\/store'/)
    expect(omnibar).not.toMatch(/useStore/)
    // …and the only thing that places is a click on a rendered option.
    expect(omnibar).toMatch(/onClick=\{\(\) => onPlace\(option\)\}/)
  })

  it('is mounted on the map with the pure placement list, not with bespoke rules', () => {
    // #420 slice 7: the wiring lives in the hook now — the page only mounts
    // the hook's outputs, and the pure list still feeds the omnibar.
    expect(mapTab).toContain("from './map/useOmnibarPlacement'")
    expect(mapTab).toMatch(/<MapOmnibar[\s\S]{0,900}?placement=\{omniPlacement\}/)
    expect(mapTab).toMatch(/const \{ omniPlacement, placeOmnibarHit \} = useOmnibarPlacement\(\{/)
    expect(mapTab).not.toContain('placementOptions({')
    expect(placementHook).toContain("from '../mapPlacement'")
    expect(placementHook).toMatch(/placementOptions\(\{/)
  })

  it('routes each choice into a path that already existed', () => {
    // #420 slice 7: the router moved with the wiring — same four paths, same
    // order, now closing over the hook's named deps instead of page locals.
    const start = placementHook.indexOf('function placeOmnibarHit(')
    expect(start, 'placeOmnibarHit moved — re-anchor this guard').toBeGreaterThan(0)
    const handler = placementHook.slice(start, start + 1400)
    expect(handler).toContain('openAddModal(picked.h, picked.km, omniPlaceDay)')
    expect(handler).toContain('addManualCandidate(slot, picked.h)')
    expect(handler).toContain('toggleShortlist(picked.h)')
    expect(handler).toContain('raiseShortlistVote()')
  })

  it('names every page touch in the hook deps (#420)', () => {
    // The slice contract: a reviewer reads the deps and knows all of it.
    for (const dep of ['picked:', 'activeDayIndex', 'days:', 'dayForKm', 'activeDaySlots', 'shortlist', 'trayShortlist', 'identity', 'openAddModal', 'addManualCandidate', 'toggleShortlist', 'raiseShortlistVote']) {
      expect(placementHook, `hook lost its ${dep} dep`).toContain(dep)
    }
  })

  it('keeps ONE route-aware search for the corridor and the map together', () => {
    // Two call sites are correct and both are named here: the corridor/map runner
    // (`runRouteSearch`, shared by the rail's box and the omnibar) and the slot's
    // own "find inside this part" flow, which #418 says to KEEP as a specialized
    // path. A third would be a parallel search, so this pins the number.
    const sites = mapTab.match(/\bsearchPlacesText\((?=\S)/g) ?? []
    expect(sites.length, 'a third search appeared — the omnibar must share runRouteSearch').toBe(2)
    expect(mapTab).toContain('async function runRouteSearch(')
    expect(mapTab).toContain('async function runSlotSearch(')
    expect(mapTab).toMatch(/onSearch[\s\S]{0,200}?await runRouteSearch\(searchQ\)/)
    expect(mapTab).toMatch(/onOmniSearch[\s\S]{0,200}?await runRouteSearch\(omniQ\)/)
  })

  it('the omnibar itself never searches — it renders what it is handed', () => {
    expect(omnibar).not.toMatch(/\bsearchPlacesText\(/)
    expect(omnibar).not.toMatch(/\bsearchPlaces\(/)
    expect(omnibar).toMatch(/results: OmnibarHit\[\]/)
  })

  it('feeds the placement label and the stop editor one resolved day (#I-41)', () => {
    // One memo resolves the day; the label reads it and the click forwards it,
    // so no second derivation can name a different day.
    expect(mapTab).toMatch(/placeDayIndex:\s*omniPlaceDay/)
    expect(mapTab).toMatch(/const omniPlaceDay = useMemo/)
    expect(mapTab).toMatch(/dayForKm\([\s\S]{0,120}?\)\s*\?\?\s*trip\.days\[0\]/)
  })

  it('keeps the omnibar pick out of the rail\'s hover state', () => {
    // The pitfall in the issue's own words: the surface must not inherit the stale
    // context of whatever rail was last active. The pick is its own state.
    expect(mapTab).toMatch(/const \[omniPicked, setOmniPicked\]/)
    expect(mapTab).toMatch(/const \[omniQ, setOmniQ\]/)
    expect(mapTab).toMatch(/selectedId=\{omniPicked\?\.h\.id \?\? null\}/)
  })
})
