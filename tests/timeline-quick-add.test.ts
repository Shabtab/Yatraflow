// ============ Timeline inline quick insertion (#422) — the wiring ============
// The issue's own constraint matters more than the feature: the insertion must
// route through the EXISTING stop-add + undo contract, because #424 (lane S)
// rewrites that contract and must not have to hunt a private second writer.
// So the pins below are about shape — one commit path, the shared coordinate
// guard, the shared form defaults — rather than about pixels.
//
// The pure half (insertStopAt / insertionSlotBetween) lives in
// tests/stop-order.test.ts; the phrasing in tests/labels.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
/** Code lines only — a comment may name a call the module deliberately does not
 *  make (the docs in these files do), so the `not.toMatch` assertions below
 *  judge code, as the Math.random tripswire does in stop-order.test.ts. */
const code = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
const tab = read('src/pages/trip/TimelineTab.tsx')
const day = read('src/pages/trip/timeline/DaySection.tsx')
const quick = read('src/pages/trip/timeline/QuickAddStop.tsx')
const stopForm = read('src/lib/stopForm.ts')

describe('the leg control offers the slot and writes nothing (#422)', () => {
  it('sits on the leg between two stops, in the stops list', () => {
    const legrow = day.slice(day.indexOf('i < ordered.length - 1 && !(ordered[i + 1].auto === true)'), day.indexOf('className="tl-end"'))
    expect(legrow).toContain('className="leg-insert"')
    expect(legrow).toContain('className="tl-leg-cell"')
    // between-stop means exactly that: the control is not offered after the
    // last row (the day's own "+ Add here" owns appending)
    expect(legrow).toMatch(/i < ordered\.length - 1/)
  })

  it('derives the slot from the two neighbouring rows at click time', () => {
    expect(day).toMatch(/onClick=\{\(\) => onInsertHere\(day\.index, insertionSlotBetween\(ordered, ordered\[i\]\?\.id \?\? null, ordered\[i \+ 1\]\?\.id \?\? null\)\)\}/)
    expect(day).toMatch(/import \{ insertionSlotBetween \} from '\.\.\/\.\.\/\.\.\/lib\/stopOrder'/)
  })

  it('announces the slot and the day before it is used', () => {
    expect(day).toMatch(/aria-label=\{`Insert a stop on Day \$\{day\.index \+ 1\} \$\{insertionWhere\(ordered\[i\]\?\.title, ordered\[i \+ 1\]\?\.title\)\}`\}/)
  })

  it('is reachable without hover, and only acts when activated', () => {
    // the handler is an onClick — merely focusing the control cannot mutate
    const onClickAt = day.indexOf('className="leg-insert"')
    const region = day.slice(onClickAt, onClickAt + 700)
    expect(region).toMatch(/onClick=\{/)
    expect(region).not.toMatch(/onFocus|onMouseEnter=|onPointerEnter=/)
    // and it hands a slot over; the write happens in the tab's one add path
    expect(day.slice(onClickAt, onClickAt + 700)).not.toMatch(/applyChange|updateTrip|setStopStatus/)
  })
})

describe('one add path, shared with the editor (#422)', () => {
  it('commits through applyChange + insertStopAt, with a staged preview', () => {
    const commit = tab.slice(tab.indexOf('const commitNewStop = useCallback'), tab.indexOf('}, [])', tab.indexOf('const commitNewStop = useCallback')) + 6)
    expect(commit).toMatch(/latest\.current\.applyChange\(draft => \{/)
    expect(commit).toMatch(/insertStopAt\(day, \{ \.\.\.\(fields as unknown as ItineraryStop\), id: pendingStopId\(\), orderInDay: 0 \}, position \?\? day\.stops\.length\)/)
    expect(commit).toMatch(/\}, 'add', dayIndex, announce \? \(\) => toast\(announce\) : undefined\)/)
    // the announcement is the impact sheet's own onKept hook — it cannot claim a
    // stop the user discarded
    expect(commit).toMatch(/announce\?: string/)
  })

  it('is used by BOTH the editor\u2019s add branch and the quick add', () => {
    expect(tab).toMatch(/commitNewStop\(editorState\.dayIndex, editorState\.position, v\)/)
    expect(tab).toMatch(/const handleQuickAdd = useCallback\(\(dayIndex: number, slot: number, values: StopFormValues\) => \{/)
    expect(tab).toMatch(/commitNewStop\(dayIndex, slot, values, `“\$\{values\.title\}” inserted \$\{where\} on Day \$\{dayIndex \+ 1\}`\)/)
    // the tab hands its handler to the modal, and the modal never writes
    expect(tab).toMatch(/onAdd=\{handleQuickAdd\}/)
    expect(code(quick)).not.toMatch(/applyChange|updateTrip|setStopStatus|removeStopFromDay/)
  })

  it('keeps the editor reachable with the same day and slot', () => {
    expect(tab).toMatch(/const handleQuickAddMore = useCallback\(\(dayIndex: number, slot: number, values: StopFormValues\) => \{/)
    expect(tab).toMatch(/setEditorSeed\(\{ key: stopEditorKey\(\{ mode: 'add', dayIndex, position: slot \}\), values \}\)/)
    expect(tab).toMatch(/openEditorState\(\{ mode: 'add', dayIndex, position: slot \}\)/)
    // the seed is keyed, so a stale draft cannot seed an unrelated add — and it
    // is cleared when the editor saves or closes
    expect(tab).toMatch(/initial=\{editorSeed && editorSeed\.key === stopEditorKey\(editorState\) \? editorSeed\.values : stopInitialValues\(editorState, trip\)\}/)
    expect(tab).toMatch(/setEditorState\(null\); setEditorSeed\(null\)/)
    expect(quick).toMatch(/onMore\(target\.dayIndex, target\.slot, v\)/)
  })

  it('carries the slot in the editor target', () => {
    expect(stopForm).toMatch(/\| \{ mode: 'add'; dayIndex: number; position\?: number \}/)
    expect(stopForm).toMatch(/state\.mode === 'edit' \? state\.stopId : `add-\$\{state\.dayIndex\}-\$\{state\.position \?\? 'end'\}`/)
  })
})

describe('the quick add keeps the shared add-path contracts (#422)', () => {
  it('seeds itself with the editor\u2019s own defaults', () => {
    expect(quick).toMatch(/import \{ normalizeStopForm, type StopFormValues \} from '\.\.\/\.\.\/\.\.\/components\/StopEditor'/)
    expect(quick).toMatch(/useState<StopFormValues>\(\(\) => normalizeStopForm\(\)\)/)
    expect(quick).toMatch(/setV\(normalizeStopForm\(\)\)/)
  })

  it('resolves coordinates through the shared guard — never a placeholder', () => {
    expect(quick).toMatch(/const \{ resolvePick, dialog: resolvePickDialog \} = useResolvePick\(\)/)
    expect(quick).toMatch(/await resolvePick\(unnamedPick\('timeline-quick-add', v\.locationName\.trim\(\) \|\| v\.title\.trim\(\)\)\)/)
    expect(quick).toMatch(/if \(!picked\) \{/)
    expect(quick).toMatch(/lat: picked\.latitude, lng: picked\.longitude, geocoded: true/)
    // the place POINT comes from the picker's own resolved hit, as in the editor
    expect(quick).toMatch(/onPick=\{onPlacePicked\}/)
    expect(quick).toMatch(/placeId: p\.placeId \?\? ''/)
  })

  it('announces the slot in the dialog too, in the same words', () => {
    expect(quick).toMatch(/const where = insertionWhere\(before\?\.title, after\?\.title\)/)
    expect(quick).toMatch(/Inserting <b>\{where\}<\/b> on Day \{target\.dayIndex \+ 1\}/)
  })

  it('re-seeds for a new slot and disables its inputs while saving (§6a)', () => {
    expect(quick).toMatch(/if \(target && lastKey !== key\) \{/)
    expect(quick).toMatch(/disabled=\{busy\}/)
    expect(quick).toMatch(/\{busy \? 'Adding…' : 'Add stop'\}/)
  })
})
