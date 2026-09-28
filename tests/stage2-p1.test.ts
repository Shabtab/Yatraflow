import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const group = source('pages/trip/GroupInputTab.tsx')
const editor = source('components/StopEditor.tsx')
const travel = source('pages/trip/timeline/TravelPanel.tsx')

// Execute the shipped handlers in node, with their UI/provider boundaries injected.
// This is not a browser render test; reverting a handler changes the code exercised.
function evaluate(code: string, bindings: Record<string, unknown>, result: string) {
  const js = ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
  return new Function(...Object.keys(bindings), `${js}\nreturn ${result}`)(...Object.values(bindings))
}
function handler(text: string, name: string, bindings: Record<string, unknown>) {
  const file = ts.createSourceFile('component.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let code = ''
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) code = node.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  expect(code).not.toBe('')
  return evaluate(code, bindings, name)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

describe('Stage 2 P1 regressions', () => {
  it('parks a filtered digest target, then scrolls and focuses only after render', () => {
    let pending: string | null = null
    let filter = 'resolved'
    let effect = () => {}
    const card = { scrollIntoView: vi.fn(), focus: vi.fn() }
    const document = { getElementById: vi.fn(() => filter === 'all' ? card : null) }
    const start = group.indexOf('  const [pendingTarget, setPendingTarget]')
    expect(start).toBeGreaterThan(-1)
    const code = group.slice(start, group.indexOf('\n  return (', start))
    const render = (shown: { id: string }[]) => evaluate(code, {
      useState: () => [pending, (id: string | null) => { pending = id }],
      useEffect: (fn: () => void) => { effect = fn },
      document, scrollBehavior: () => 'auto', shown,
      itemId: (item: { id: string }) => item.id,
      setFilter: (value: string) => { filter = value },
    }, 'focusItem')
    render([])('idea-1')
    expect(pending).toBe('idea-1')
    expect(filter).toBe('all')
    expect(card.scrollIntoView).not.toHaveBeenCalled()
    render([{ id: 'idea-1' }])
    effect()
    expect(document.getElementById).toHaveBeenCalledWith('gi-item-idea-1')
    expect(card.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
    expect(card.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(card.scrollIntoView.mock.invocationCallOrder[0]).toBeLessThan(card.focus.mock.invocationCallOrder[0])
    expect(pending).toBeNull()
    render([{ id: 'idea-1' }])
    effect()
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(group.match(/tabIndex=\{-1\} className=\{`card gi-item/g)).toHaveLength(2)
  })

  it('keeps the cross-day append target outside the collapsed body, including empty days', () => {
    const day = source('pages/trip/timeline/DaySection.tsx')
    const header = day.slice(day.indexOf('<div className={`day-header'), day.indexOf('<SmoothCollapse open='))
    expect(header).toContain('editable ? dayDropHandlers(ordered.length) : {}')
    expect(day).toContain('onClick={() => onMoveBetweenDays(s)}')
  })

  it('places the existing narrow reset after all desktop folded rules and uses only ring ink', () => {
    const css = source('styles.css')
    expect(css.match(/@media \(max-width: 1278px\)/g)).toHaveLength(1)
    expect(css.indexOf('@media (max-width: 1278px)')).toBeGreaterThan(css.lastIndexOf('grid-template-columns: 48px minmax(0, 1fr) 48px'))
    expect(css).toContain('.gi-item:focus, .day-header.foreign-over { outline: none; box-shadow: var(--ring); }')
  })

  it('discards an old road lookup before it can fill a newer stop or start an hours lookup', async () => {
    const road = deferred<unknown>()
    const placeRequest = { current: 0 }
    const setV = vi.fn()
    const hours = vi.fn()
    const setLegState = vi.fn()
    const pick = handler(editor, 'onPlacePicked', {
      open: true, placeRequest, invalidatePlaceRequest: () => { ++placeRequest.current },
      set: vi.fn(), setV, setLegState, setHoursState: vi.fn(), v: { openTime: '' },
      legContext: { fromPoint: {}, transportMode: 'car', dayStart: '08:00' },
      roadLegBetween: () => road.promise, getAssumptions: () => ({}), fetchOpeningHours: hours,
    })
    const work = pick({ name: 'Old place', kind: 'poi', latitude: 10, longitude: 76 })
    ++placeRequest.current // stop/reset/close ownership invalidation
    road.resolve({ distanceKm: 10, durationMinutes: 20 })
    await work
    expect(setV).not.toHaveBeenCalled()
    expect(hours).not.toHaveBeenCalled()
    expect(setLegState).toHaveBeenCalledTimes(1) // stale finally cannot clear a newer spinner
    expect(editor).toContain('return () => { ++placeRequest.current }')
    expect(editor).toContain('}, [open, resetKey])')
  })

  it('discards stale opening hours after another pick', async () => {
    const hours = deferred<unknown>()
    const placeRequest = { current: 0 }
    const set = vi.fn()
    const setHoursState = vi.fn()
    const pick = handler(editor, 'onPlacePicked', {
      open: true, placeRequest, invalidatePlaceRequest: () => { ++placeRequest.current },
      set, setHoursState, legContext: undefined, v: { openTime: '' },
      fetchOpeningHours: () => hours.promise,
    })
    const work = pick({ name: 'Old place', kind: 'poi', latitude: 10, longitude: 76 })
    ++placeRequest.current
    set.mockClear()
    hours.resolve({ openTime: '09:00', closeTime: '17:00' })
    await work
    expect(set).not.toHaveBeenCalled()
    expect(setHoursState).toHaveBeenCalledTimes(1)
  })

  it('removing all halts invalidates the search without restoring them or writing stale cache', async () => {
    const spots = deferred<never[]>()
    const spotRequest = { current: 0 }
    const setPlan = vi.fn()
    const setHaltCache = vi.fn()
    const setResolving = vi.fn()
    const setSearched = vi.fn()
    const setHaltCacheTick = vi.fn()
    const toast = vi.fn()
    const roadPolylineRef = { current: null }
    const planRef = { current: [{ id: 'halt', km: 50, minutes: 20, purpose: 'meal', hit: null, pin: false }] }
    const journeyRef = { current: { points: [{ lat: 10, lng: 76 }], distanceKm: 100, driveMinutes: 120 } }
    const bindings = {
      spotRequest, setPlan, setHaltCache, setResolving, setSearched, setHaltCacheTick,
      journey: journeyRef.current, day: { index: 0 }, segmentsFromPlan: () => [],
      // #346: commitPlan reads the in-flight state. The harness extracts each
      // function separately, so the component's shared per-render closure is
      // simulated by binding the scenario's state statically.
      // #414: the halt stamp rides along the same way — the plan-inputs hash
      // the entry is checked against on read.
      haltInputsHash: 'hash-0', setHaltStale: vi.fn(),
      resolving: false, searchCommitting: false,
    }
    // The scenario: a search IS in flight when the user commits a plan edit.
    const commitPlan = handler(travel, 'commitPlan', { ...bindings, resolving: true, toast })
    const resolve = handler(travel, 'resolveSpots', {
      ...bindings, editable: true, plan: planRef.current,
      roadPolylineRef, planRef, journeyRef,
      trip: { transportMode: 'car', startLocationCoords: null, days: [] }, corridorAnchors: () => [],
      searchNearbyPoisMulti: () => spots.promise, googleEnabled: () => false,
      searchCitiesAlong: async () => [], commitPlan, toast, filterPlannedNearby: (c: unknown[]) => c,
      assignSegmentHits: () => [], annotateSegmentHits: (h: unknown[]) => h,
      setSlackPool: vi.fn(), MODE_SPEED: { car: 40 }, asymmetricDetourMinutes: () => null,
    })
    const work = resolve()
    // The user removes all halts BEFORE the search resolves: the supersede is
    // loud (#346), the plan is written empty, and the search's own late write
    // is then dropped by the bump rather than landing over the user's edit.
    commitPlan([])
    expect(toast).toHaveBeenCalledWith('Plan changed — the spot search was restarted. Press search again when ready.')
    ++spotRequest.current // the cancel the bump causes
    spots.resolve([])
    await work
    expect(setPlan).toHaveBeenCalledExactlyOnceWith([])
    // #414: the empty plan is written WITH its stamp — a cached entry with no
    // hash to check is exactly the stale-plan hole this closes.
    expect(setHaltCache).toHaveBeenCalledExactlyOnceWith(0, [], [], 'hash-0')
    expect(setSearched).not.toHaveBeenCalled()
    expect(setResolving.mock.calls).toEqual([[true], [false]])
    expect(travel).toContain('return () => { ++spotRequest.current }')
  })
})
