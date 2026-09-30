// ============ Board parity with its siblings (#369 + #372) ============
// The Board was the surface that never got the guards the Timeline and the Map
// have: follow-up toasts, an Undo, a status control, the one “already added”
// predicate, memoized columns and warnings counted on the engine's own identity.
// The behaviour these pin lives in pure modules (warning-digest, health-band)
// and in the store (setStopStatus' write-through is pinned by m6-together), so
// these are SOURCE bindings: the wiring itself, which has no DOM-free seam to
// exercise.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const board = page('../src/components/BoardView.tsx')
const workspace = page('../src/pages/TripWorkspace.tsx')

describe('#369 — the pulse and the pills read the engine, not a regex', () => {
  it('groups through the shared helper and never parses a title', () => {
    expect(board).toMatch(/from '\.\.\/lib\/warningDigest'/)
    expect(board).toMatch(/warningDigest\(warnings\)/)
    // the old `/^Day (\d+):/` grouping and its day count are gone
    expect(board).not.toMatch(/Day \(\\d\+\):/)
    expect(board).not.toMatch(/warnDayCount/)
    expect(board).not.toMatch(/route day\$\{/)
  })

  it('colours health from the band, not from score cuts re-invented here', () => {
    expect(board).toMatch(/from '\.\.\/lib\/healthBand'/)
    expect(board).toMatch(/healthBandClass\(health\.band\)/)
    expect(board).not.toMatch(/health\.score >= 70/)
    expect(board).not.toMatch(/health\.score >= 40/)
  })

  it('gives a low-only day its quiet class and keeps every warning in a title', () => {
    expect(board).toMatch(/className=\{`day-warn-pill sev-\$\{sev\}`\} title=\{warningLines\(warnings\)\}/)
  })

  it('shows trip-wide warnings instead of dropping them', () => {
    expect(board).toMatch(/warn\.tripWide/)
    expect(board).toMatch(/warningLines\(warn\.tripWide\)/)
  })
})

describe('#372 — a Board mutation is guarded like its siblings', () => {
  it('accepts the keep-follow-up and deletes through the ONE destructive-stop path', () => {
    expect(board).toMatch(/applyChange: \(mutator: \(d: Trip\) => void, kind: ImpactResult\['kind'\], dayIndex: number, onKept\?: \(\) => void\) => void/)
    // #424: the capture → stage → Undo sequence is no longer the Board's own. It
    // calls the composer the Timeline's day row and the map pin call too, so the
    // same delete cannot recover differently depending on where it was clicked.
    expect(board).toMatch(/removeStopWithUndo\(\{ trip, stopId, dayIndex, applyChange \}\)/)
    expect(board).not.toMatch(/removeStopFromDay|restoreStop|undoToast/)
  })

  it('offers the status flip and refuses it while a preview is open', () => {
    expect(board).toMatch(/import \{ refuseWhileStaged, removeStopWithUndo \} from '\.\.\/lib\/mutationLifecycle'/)
    expect(board).toMatch(/if \(refuseWhileStaged\(previewOpen\)\) return/)
    expect(board).toMatch(/setStopStatus\(trip\.id, status, stop\.id\)/)
    expect(board).toMatch(/onStatus\(s, 'maybe'\)/)
    expect(board).toMatch(/onStatus\(s, 'confirmed'\)/)
    // …and the workspace actually tells the tab that a preview is open.
    expect(workspace).toMatch(/<BoardView trip=\{effective\}[\s\S]{0,200}previewOpen=\{!!pending\}/)
  })

  it('dedupes adds through the ONE shared predicate', () => {
    expect(board).toMatch(/import \{ isAlreadyAdded, placeIdentity \} from '\.\.\/lib\/placeIdentity'/)
    expect(board).toMatch(/placeIdentity\(trip\)/)
    expect(board).toMatch(/isAlreadyAdded\(\{ name: v\.title, placeId: v\.placeId \}, identity\)/)
  })

  it('memoizes the column and the embedded map, with no inline literal in the props', () => {
    expect(board).toMatch(/const BoardColumn = React\.memo\(function BoardColumn/)
    expect(board).toMatch(/const MemoTripMap = React\.memo\(TripMap\)/)
    // …rendered with the same props it always took (the road geometry it now
    // also receives is asserted in tests/trip-road.test.ts, #370)
    expect(board).toMatch(/<MemoTripMap trip=\{trip\} focusDay=\{focusedDay\} showToolbar=\{false\}/)
    // #425 PR 2: focusedDay IS the workspace's shared axis (local fallback only)
    expect(board).toMatch(/const focusedDay = dayFocus \?\? localFocusDay/)
    // one shared empty array — `?? []` in a prop position would re-render the column
    expect(board).toMatch(/const NO_WARNINGS: ScheduleWarning\[\] = \[\]/)
    expect(board).toMatch(/warn\.byDay\.get\(day\.index\) \?\? NO_WARNINGS/)
    // every column prop is a stable reference or a primitive
    expect(board).toMatch(/onToggleFocus=\{toggleDayFocus\}/)
    expect(board).toMatch(/onAdd=\{handleAdd\}/)
    expect(board).toMatch(/onEdit=\{handleEdit\}/)
    expect(board).toMatch(/onStatus=\{handleStatus\}/)
    expect(board).toMatch(/onMoveStopIn=\{handleMoveStopInto\}/)
    expect(board).toMatch(/onReorder=\{reorderWithinDay\}/)
    expect(board).toMatch(/onDelete=\{handleDelete\}/)
    expect(board).not.toMatch(/onAdd=\{\(\) =>/)
    expect(board).not.toMatch(/onEdit=\{\(stopId\) =>/)
    expect(board).not.toMatch(/onToggleFocus=\{\(/)
  })
})
