// ============ Timeline all-days review mode (#421) — the wiring ============
// The decision this issues carries is recorded in the handoff ledger before the
// code (per-trip view choice, continuous with sticky day headers, the saved open
// day untouched, one viewport observer for the provider pitfall). These pins
// hold the code to it: node has no DOM, so what can be checked is the source the
// surfaces are built from — and the prefs round-trip in tests/uiPrefs.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const tab = read('src/pages/trip/TimelineTab.tsx')
const day = read('src/pages/trip/timeline/DaySection.tsx')
const prefs = read('src/lib/uiPrefs.ts')
const css = read('src/styles.css')

const slice = (src: string, from: string, to: string) => {
  const at = src.indexOf(from)
  expect(at, `missing anchor: ${from}`).toBeGreaterThan(-1)
  const end = src.indexOf(to, at)
  expect(end, `missing end anchor: ${to}`).toBeGreaterThan(at)
  return src.slice(at, end + to.length)
}

describe('the view choice is a per-trip pref, not trip data (#421)', () => {
  it('reads and writes it per trip, through its own storage key', () => {
    expect(prefs).toMatch(/const REVIEW_ALL_KEY = 'yatraflow_review_all'/)
    expect(prefs).toMatch(/export function loadReviewAll\(tripId: string\): boolean/)
    expect(prefs).toMatch(/export function saveReviewAll\(tripId: string, on: boolean\): void/)
    // parsed by the shared flat-boolean helper, so junk degrades to OFF
    expect(prefs).toMatch(/parseDayCollapseMap\(localStorage\.getItem\(REVIEW_ALL_KEY\)\)\[tripId\] \?\? false/)
    expect(tab).toMatch(/const \[reviewAll, setReviewAll\] = useState\(\(\) => loadReviewAll\(trip\.id\)\)/)
  })

  it('persists the choice when the switch is used', () => {
    expect(tab).toMatch(/saveReviewAll\(trip\.id, on\)/)
  })

  it('is rendered as an explicit two-way choice, not a hidden mode', () => {
    expect(tab).toMatch(/aria-label="Days shown"/)
    expect(tab).toMatch(/onClick=\{\(\) => setReview\(false\)\} aria-pressed=\{!reviewAll\}/)
    expect(tab).toMatch(/onClick=\{\(\) => setReview\(true\)\} aria-pressed=\{reviewAll\}/)
  })

  it('switching views mutates no trip data', () => {
    const setter = slice(tab, 'const setReview = useCallback', '}, [trip.id, reviewAll])')
    expect(setter).not.toMatch(/updateTrip|applyChange|setStopStatus|restoreStop/)
  })
})

describe('review never touches the saved open day (#421)', () => {
  it('guards both accordion writers instead of writing from review', () => {
    // openDay + toggleDay both bail out before touching the pref
    for (const fn of ['const toggleDay = useCallback', 'const openDay = useCallback']) {
      const body = slice(tab, fn, '}, [trip.id, reviewAll])')
      expect(body, fn).toMatch(/if \(reviewAll\) return/)
      const guard = body.indexOf('if (reviewAll) return')
      const write = body.indexOf('saveOpenDay(')
      expect(write, fn).toBeGreaterThan(guard)
    }
    expect(tab.match(/saveOpenDay\(/g)?.length).toBe(2)
  })

  it('opens every day from the mode, keeping the accordion value intact', () => {
    expect(tab).toMatch(/open=\{reviewAll \|\| openDayIndex === day\.index\}/)
    expect(tab).toMatch(/onToggleOpen=\{toggleDay\}/)
  })

  it('jump-to-day scrolls in review without opening a day', () => {
    const jump = slice(tab, 'function jumpToDay(dayIndex: number)', 'scrollIntoView({ behavior: scrollBehavior(), block: \'start\' })')
    expect(jump).toMatch(/openDay\(dayIndex\)/)
    expect(jump).not.toMatch(/saveOpenDay|setOpenDayIndex/)
  })
})

describe('the provider pitfall is answered by one viewport gate (#421)', () => {
  it('observes the day cards once, with a warming margin', () => {
    expect(tab).toMatch(/typeof IntersectionObserver === 'undefined'/)
    expect(tab).toMatch(/new IntersectionObserver\(entries => \{/)
    expect(tab).toMatch(/rootMargin: '600px 0px'/)
    expect(tab).toMatch(/return \(\) => observer\.disconnect\(\)/)
    // and the gate is released when the mode is off
    expect(tab).toMatch(/if \(!reviewAll \|\| typeof IntersectionObserver === 'undefined'\) \{/)
  })

  it('hands the live trip to review days on screen only', () => {
    expect(tab).toMatch(/trip=\{openDayIndex === day\.index \|\| \(reviewAll && visibleDays\.has\(day\.index\)\) \? trip : undefined\}/)
    expect(tab).toMatch(/reviewMode=\{reviewAll\} inView=\{!reviewAll \|\| visibleDays\.has\(day\.index\)\}/)
  })

  it('gates the two provider-backed extras on it — and nothing else', () => {
    expect(day).toMatch(/\{!collapsed && \(!reviewMode \|\| inView\) && <DayWeatherChip/)
    expect(day).toMatch(/ordered\.length > 0 \|\| \(reviewMode && !inView\)/)
    expect(day).toMatch(/\[editable, open, trip, ordered\.length, reviewMode, inView, facts\.prevPoint, facts\.homeCenter, facts\.assumptions\.mode\]/)
    // What the day shows from its own resolved facts is never gated: every stop
    // row and leg below the day body still renders, in review too.
    expect(day.slice(day.indexOf('data-yf-list={listId}'))).not.toMatch(/inView/)
  })
})

describe('review keeps every editing affordance (#421)', () => {
  it('hands the same per-day handlers in both modes', () => {
    const render = slice(tab, '<DaySection key={day.id}', '/>')
    for (const prop of [
      'onAdd={handleAdd}', 'onEdit={handleEdit}', 'onDelete={handleDelete}',
      'onMoveWithinDay={handleMoveWithinDay}', 'onReorderDay={handleReorderDay}',
      'onMoveStopIn={handleMoveStopInto}', 'onMoveBetweenDays={setMoveModalStop}',
      'onRenameDay={handleRenameDay}', 'onCopyDay={handleCopyDay}',
      'onAddQuickStop={handleAddQuickStop}', 'onSetDayStart={handleSetDayStart}',
      'onAddPlannedHalts={handleAddPlannedHalts}', 'onStatus={handleStatus}',
    ]) expect(render, prop).toContain(prop)
    // editability is the Plan/Inspect axis, untouched by the view axis
    expect(tab).toMatch(/const planEditable = editable && mode === 'plan'/)
    expect(render).toContain('editable={planEditable}')
  })

  it('hides the per-day disclosure in review, where the mode owns openness', () => {
    expect(day).toMatch(/\{!reviewMode && \(\r?\n        <button ref=\{collapseRef\} className="day-collapse"/)
    expect(day).toMatch(/const collapsed = !open/)
  })
})

describe('review mode is a continuous read, oriented by the day rail (#421)', () => {
  it('marks the root and the card so the CSS can hand the sticky rung over', () => {
    expect(tab).toMatch(/<div className=\{reviewAll \? 'tl-root-review' : undefined\}>/)
    expect(day).toMatch(/\$\{reviewMode \? ' day-review' : ''\}/)
  })

  it('keeps the day header in flow and gives the sticky rung to the rail', () => {
    // Measured: a review-mode header is 193–309px tall (its clocks, chips,
    // warnings and actions), so sticking it would cost a fifth of a phone's
    // screen to say one word. The compact rail is the mode's own label row.
    expect(css).toMatch(/\.tl-root-review \.tl-total-strip \{ position: static; \}/)
    expect(css).toMatch(/\.tl-root-review \.day-rail \{\r?\n  position: sticky;/)
    expect(css).toMatch(/top: calc\(12px \+ var\(--nav-h\) \+ 10px \+ var\(--safe-area-inset-top, env\(safe-area-inset-top, 0px\)\)\);/)
    expect(css).not.toMatch(/\.day-review \.day-header \{[^}]*position: sticky/)
  })

  it('marks the day the reader is in, and grows the rail for any trip length', () => {
    expect(tab).toMatch(/\(days\.length >= 4 \|\| reviewAll\) && \(/)
    expect(tab).toMatch(/aria-current=\{current \? 'true' : undefined\}/)
    expect(tab).toMatch(/const current = reviewAll && currentDay === d\.index/)
    expect(tab).toMatch(/if \(el\.getBoundingClientRect\(\)\.top - line <= 1\) best = idx/)
    expect(css).toMatch(/\.day-rail-chip\[aria-current='true'\] \{/)
  })
})
