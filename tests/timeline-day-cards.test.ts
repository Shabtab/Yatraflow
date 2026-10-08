// ============ Timeline day cards — wiring (#340, #347) ============
// The pure half lives in tests/day-cards.test.ts and tests/weather.test.ts.
// What node can still check is that the SURFACES consume it: the card takes
// pre-resolved facts instead of the whole trip, only the open day is handed a
// live trip at all, the weather chip asks about its own day, and the handlers
// the memo compares hold a stable identity.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const tab = read('src/pages/trip/TimelineTab.tsx')
const day = read('src/pages/trip/timeline/DaySection.tsx')

describe('TimelineTab hands each day its facts (#347)', () => {
  it('builds the cards once per trip change, through the reusable builder', () => {
    expect(tab).toMatch(/buildDayCards\(trip, days, legCorrections, cardsCache\.current\)/)
    expect(tab).toMatch(/cardsCache\.current = next/)
  })

  it('passes the resolved facts to the card instead of a fresh day-scoped slice', () => {
    expect(tab).toMatch(/facts=\{cards\.byDay\.get\(day\.index\)!\}/)
    expect(tab).not.toMatch(/totals\.byDay\.find\(b => b\.dayIndex === day\.index\)/)
  })

  it('hands a live trip to the OPEN day only — a closed card cannot read one', () => {
    // #421 extends the same rule instead of breaking it: in review every day is
    // open, so the live trip goes to the days actually on screen (at most a card
    // or two), which is what keeps the memo biting and the provider calls bounded.
    expect(tab).toMatch(/trip=\{openDayIndex === day\.index \|\| \(reviewAll && visibleDays\.has\(day\.index\)\) \? trip : undefined\}/)
    expect(tab).toMatch(/open=\{reviewAll \|\| openDayIndex === day\.index\}/)
  })

  it('keeps the money and warning props reference-stable across commits', () => {
    expect(tab).toMatch(/reuseDayTotals\(totalsCache\.current, totals\.byDay \?\? \[\]\)/)
    expect(tab).toMatch(/reuseWarningGroups\(warningsCache\.current, byDay\)/)
    expect(tab).toMatch(/warnings=\{dayWarnings\.get\(day\.index\) \?\? NO_WARNINGS\}/)
  })

  it('does not rebuild a day card from a handler that flips on every edit', () => {
    // applyChange/trip are re-created per save, so the handlers that need them
    // read through a latest-value ref and keep an empty (stable) dep list.
    expect(tab).toMatch(/const latest = useRef\(\{ applyChange, trip \}\)/)
    // and the editor opener (onAdd/onEdit's source) reads the live trip the same
    // way, so a store commit does not hand every card a new pair of handlers
    const conflict = read('src/components/useStopConflict.ts')
    expect(conflict).toMatch(/const tripRef = useRef\(trip\)\r?\n  tripRef\.current = trip/)
    expect(conflict).toMatch(/for \(const d of tripRef\.current\.days\)/)
    expect(conflict).toMatch(/\}, \[\]\)\r?\n\r?\n  const liveStop/)
    expect(tab).toMatch(/const handleDelete = useCallback\(\(stopId: string, dayIndex: number\) => \{\r?\n    const \{ applyChange, trip \} = latest\.current/)
    for (const name of ['handleMoveWithinDay', 'handleReorderDay', 'handleCopyDay', 'handleAddQuickStop']) {
      const body = tab.slice(tab.indexOf(`const ${name} = useCallback`))
      expect(body.slice(0, body.indexOf('}, [') + 6)).toContain('latest.current.applyChange')
      expect(body.slice(0, body.indexOf('}, [') + 6)).toContain('}, [])')
    }
  })
})

describe('DaySection reads its facts, never the trip on a closed path (#347)', () => {
  it('takes the trip as optional and the facts as required', () => {
    expect(day).toMatch(/trip\?: Trip/)
    expect(day).toMatch(/facts: DayCardFacts/)
  })

  it('compares `day` by content, through the exhaustive comparator', () => {
    expect(day).toMatch(/\}, sameDaySectionProps\)/)
    expect(day).toMatch(/import \{ sameDaySectionProps, type DayCardFacts, type DayTotals \}/)
  })

  it('takes the journey, schedule, origin, anchors and commitments from the facts', () => {
    expect(day).toMatch(/const sim = facts\.sim/)
    expect(day).toMatch(/const journey = facts\.journey/)
    expect(day).toMatch(/const A = facts\.assumptions/)
    expect(day).toMatch(/const hasNextDay = facts\.hasNextDay/)
    expect(day).toMatch(/const optOrigin = facts\.origin/)
    expect(day).toMatch(/const commitmentsToday = facts\.commitments/)
    expect(day).toMatch(/const alreadyAtNext = facts\.alreadyAtNext/)
  })

  it('does not re-run the engine per card render any more', () => {
    for (const call of ['simulateDay(', 'buildJourney(', 'originOf(', 'nextAfter(', 'predecessorOf(']) {
      expect(day).not.toContain(call)
    }
  })

  it('keeps the travel panel alive through the collapse animation', () => {
    expect(day).toMatch(/const bodyTrip = trip \?\? lastTrip\.current/)
    expect(day).toMatch(/\{bodyTrip && <TravelPanel trip=\{bodyTrip\}/)
  })
})

describe('the weather chip asks about its own day (#340)', () => {
  it('resolves the anchor from the day, with no trip and no guess-city fallback', () => {
    expect(day).toMatch(/<DayWeatherChip day=\{day\} startDate=\{facts\.startDate\} \/>/)
    expect(day).toMatch(/const anchor = useMemo\(\(\) => weatherAnchor\(day\), \[day\]\)/)
    expect(day).not.toMatch(/10\.5\b/)
    expect(day).not.toMatch(/76\.5\b/)
    expect(day).not.toMatch(/flatMap\(d => d\.stops\)\[0\]/)
  })

  it('depends on the resolved coordinates instead of suppressing exhaustive-deps', () => {
    const chip = day.slice(day.indexOf('function DayWeatherChip'), day.indexOf('function ClampedText'))
    expect(chip).toContain('}, [lat, lng, date, tick])')
    // and it gates on its OWN day's date, not the trip's start (#340)
    expect(chip).toContain('!forecastAvailable(date)')
    // and it re-pulls on the refresh cadence / tab focus, forcing past the cache
    expect(chip).toContain('useWeatherRefreshTick()')
    expect(chip).toContain('{ force: tick > 0 }')
    expect(chip).not.toContain('eslint-disable')
  })
})
