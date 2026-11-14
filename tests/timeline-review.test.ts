// ============ Timeline all-days review mode (#421) — the wiring ============
// The decision this issues carries is recorded in the handoff ledger before the
// code (per-trip view choice, continuous with sticky day headers, the saved open
// day untouched, one viewport observer for the provider pitfall). These pins
// hold the code to it: node has no DOM, so what can be checked is the source the
// surfaces are built from — and the prefs round-trip in tests/uiPrefs.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { readCssSource } from '../scripts/css-source-graph.mjs'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const tab = read('src/pages/trip/TimelineTab.tsx')
const day = read('src/pages/trip/timeline/DaySection.tsx')
const prefs = read('src/lib/uiPrefs.ts')
const css = readCssSource('src/styles.css')

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
    expect(tab).toMatch(/open=\{openDayIndex === day\.index \|\| \(reviewAll && revealStep > Math\.min\(ordinal, REVEAL_STEPS - 1\)\)\}/)
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
    // The weather chip moved inside the collapse: it lands asynchronously and
    // grew the header 18px in a single frame when it did. The viewport gate is
    // unchanged — it still waits for the day to be near the screen.
    expect(day).toMatch(/\{\(!reviewMode \|\| inView\) && <DayWeatherChip/)
    // #842 F17: automatic anchors and rejected suggestions do not make a day
    // "planned"; the effect keys on the bias VALUE and anchor coords, so a
    // title rename cannot re-fire the paid search.
    expect(day).toMatch(/hasPlannedStop \|\| \(reviewMode && !inView\)/)
    expect(day).toMatch(/\[editable, open, nearbyBiasKey, hasPlannedStop, reviewMode, inView,/)
    expect(day).not.toMatch(/\[editable, open, trip,/)
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

describe('a stop card carries one menu, not a row of buttons', () => {
  it('folds edit, status, move-day and delete into the ⋯ disclosure', () => {
    const at = day.indexOf('<div className="stop-actions">')
    expect(at, 'missing anchor: stop-actions').toBeGreaterThan(-1)
    const actions = day.slice(at, day.indexOf('{i < ordered.length - 1', at))
    expect(actions).toContain('className="stop-more"')
    for (const label of ['Edit', 'Mark maybe', 'Move to another day', 'Delete']) {
      expect(actions, label).toContain(label)
    }
    // The reorder arrows stay inline: they are the keyboard alternative to drag.
    expect(actions).toContain('className="move-btns"')
    // And the seven-button row is gone — no bare icon-btn on the card.
    expect(actions).not.toMatch(/<button className="icon-btn" onClick=\{\(\) => onEdit/)
  })

  it('styles the menu so its labels never wrap and it clears the next card', () => {
    expect(css).toMatch(/\.stop-more-menu > button \{[^}]*white-space: nowrap/)
    expect(css).toMatch(/\.stop-card:has\(\.stop-more\[open\]\) \{ position: relative; z-index:/)
  })
})

describe('a stop card leads with the artboard duotone tile', () => {
  it('draws one 48px tile per stop, with a glyph for its kind', () => {
    expect(day).toContain('className={`stop-tile tile-${kind}`}')
    // Seven kinds, seven glyphs: colour alone would fail a greyscale print.
    for (const glyph of ['Utensils', 'BedDouble', 'Fuel', 'Armchair', 'Mountain', 'Car', 'Landmark']) {
      expect(day, glyph).toContain(`<${glyph} size={22}`)
    }
  })

  it('uses one lagoon tint for every kind, as Ride along does', () => {
    expect(css).toMatch(/\.stop-tile \{\s*\n\s*width: 48px; height: 48px;/)
    // The kind tag and the glyph already name the kind, so colour adds nothing.
    expect(css).toMatch(/\.stop-tile \{[^}]*background: var\(--pw-lagoon-100\); color: var\(--pw-sea-700\);/)
    expect(css).not.toMatch(/\.stop-tile\.tile-/)
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
    // PW-08 folded the totals strip and the rail into one ribbon, so the rung
    // moves as one surface: in review the totals column drops out and what is
    // left is the compact rail.
    expect(css).toMatch(/\.tl-root-review \.tl-ribbon-total \{\r?\n {2}width: 0; padding-inline-end: 0;/)
    expect(css).toMatch(/\.tl-root-review \.tl-ribbon-total \{[^}]*visibility: hidden;/)
    expect(css).toMatch(/\.tl-root-review \.tl-ribbon \{\r?\n  position: sticky;/)
    expect(css).toMatch(/top: calc\(12px \+ var\(--nav-h\) \+ 10px \+ var\(--safe-area-inset-top, env\(safe-area-inset-top, 0px\)\)\);/)
    expect(css).not.toMatch(/\.day-review \.day-header \{[^}]*position: sticky/)
  })

  it('marks the day the reader is in, and grows the rail for any trip length', () => {
    // PW-08: the ribbon is the trip's own header, so it renders for every trip
    // length — the old rail's "4+ days or review" gate retired with it.
    expect(tab).not.toMatch(/days\.length >= 4 \|\| reviewAll/)
    expect(tab).toMatch(/aria-current=\{current \? 'true' : undefined\}/)
    // MR7 renamed the loop variable: the rail renders the derived strip now, so
    // the item is `it` and its index is `it.dayIndex`. MR9 marks the day the
    // reader is in on both modes: the day in view in review, the open day
    // otherwise. PW-08 renders the same loop as ribbon cards.
    expect(tab).toMatch(/const current = reviewAll \? currentDay === it\.dayIndex : openDayIndex === it\.dayIndex/)
    expect(tab).toMatch(/if \(el\.getBoundingClientRect\(\)\.top - line <= 1\) best = idx/)
    expect(css).toMatch(/\.tl-ribbon-card\[aria-current='true'\] \{/)
  })

  it('renders the rail from the tested strip, and marks the day the route moves on (MR7)', () => {
    // The rail must not re-derive the place itself: the boundary logic lives in
    // lib/dayStrip.ts with its own tests, and a second copy here is how the
    // marker would drift onto the wrong day.
    expect(tab).toMatch(/const dayStrip = useMemo\(\(\) => dayStripItems\(days\), \[days\]\)/)
    // PW-08 renders the ribbon from that same strip: `ribbonDays` adds only the
    // display facts (date label, km, tone, planned share) and never re-derives
    // the boundary, so there is still exactly one copy of the logic.
    expect(tab).toMatch(/const ribbonDays = useMemo\(\(\) => dayStrip\.map\(it => \{/)
    // PW-08: the transit marker no longer needs its own glyph — the day that
    // changes city spells the route in the card, so the boundary is the label.
    expect(tab).toMatch(/const route = it\.changesCity && it\.from && it\.place \? `\$\{it\.from\} → \$\{it\.place\}` : it\.place/)
  })
})

describe('the timeline blocks cascade in, like the Overview beside them', () => {
  // The tab renders inside TripWorkspace's `tab-panel`, one level down from the
  // page root, so the shared `.page-enter > *` cascade never reached the
  // toolbar, the ribbon or a day card: measured in the browser, every one of
  // them went from opacity 0 to 1 between two frames while the Overview's cards
  // stepped in. The tab owns a `page-enter` wrapper for its own blocks instead
  // of restating the cascade — one owner, so the stagger stays the house's.
  it('wraps the toolbar, the ribbon and the day list in the shared cascade', () => {
    const open = tab.indexOf('<div className="page-enter">')
    expect(open, 'the tab has no `page-enter` wrapper').toBeGreaterThan(-1)
    // Anchor on the wrapper's own close: the modals follow it, so the block
    // between them is exactly what the cascade owns.
    const close = tab.indexOf('      </div>\n\n      <StopEditor')
    expect(close, 'the wrapper does not close before the modals').toBeGreaterThan(open)
    const wrapped = tab.slice(open, close)
    expect(wrapped).toMatch(/className="row-between tl-head"/)
    expect(wrapped).toMatch(/className="tl-ribbon"/)
    expect(wrapped).toMatch(/\{days\.map\(\(day, ordinal\) => \(/)
  })

  it('gives the day cards the Overview card entrance, not the generic page rise', () => {
    expect(css).toContain('.page-enter > .day-section { animation-name: cardIn; }')
  })

  it('leaves the modals outside it, so an opened sheet is not re-entered', () => {
    // The editor and the move sheet are siblings of the wrapper, not children:
    // they animate on their own open, and a second entrance would play on every
    // render of the list beneath them.
    const afterWrap = tab.slice(tab.indexOf('      <StopEditor'))
    expect(afterWrap).toMatch(/<StopEditor/)
    expect(afterWrap).toMatch(/<MoveStopModal/)
    expect(afterWrap).not.toMatch(/<div className="page-enter">/)
  })
})
