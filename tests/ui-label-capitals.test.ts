import { describe, expect, it } from 'vitest'
import { isExampleValue, lowercaseMapLabels, lowercaseUiLabels, sourceFiles } from './uiSourceScan'

/**
 * The whole-app capital gate. A user-visible label in `src/` starts with a capital or a number.
 * A FIX never goes in the allowlist: capitalise the string instead. An entry is for a piece that
 * the scanner cannot tell from a label, and that always follows other words on screen (MID),
 * a unit that sits in its own element after a number (UNIT), or text that never reaches the screen (NOT-UI).
 * `tests/map-label-capitals.test.ts` keeps the stricter Map gate with no allowlist.
 */
interface Allowed { file: string, text: string, reason: string }

const entry = (file: string, texts: string[], reason: string): Allowed[] => texts.map(text => ({ file, text, reason }))

export const ALLOWLIST: Allowed[] = [
  ...entry('src/components/creator/CrRankTile.tsx', ['of'], 'MID: "of {total} creators" follows the rank value'),
  ...entry('src/components/creator/OwnerLayer.tsx', ['page visits', 'route activity', 'unlocks', 'share sources'], 'MID: label prop joined into "Loading/Could not load {label}" sentences'),
  ...entry('src/components/PlanBench.tsx', ['actually'], 'MID: inside "What will your road trip actually cost?"'),
  ...entry('src/components/explore/RouteTrail.tsx', ['stop', 'stops'], 'UNIT: follows "{n} more" in "3 more stops not shown"'),
  ...entry('src/components/PlanBench.tsx', ['round trip', 'one way'], 'MID: inside the parentheses after "km on the road"'),
  ...entry('src/components/PlanBench.tsx', ['fuel', 'fares'], 'MID: "{cost} in fuel" and "{cost} in fares"'),
  ...entry('src/components/PrintExport.tsx', ['flight', 'ground travel'], 'UNIT: follows a number and unit, as "45 min flight"'),
  ...entry('src/components/StopEditor.tsx', ['this stop'], 'MID: fallback after the arrow in the leg line'),
  ...entry('src/components/storefront/ride/RideLockedPreview.tsx', ['opens with the full plan.', 'open together.'], 'MID: end of a sentence that starts with the day range'),
  ...entry('src/components/TrendChart.tsx', ['reading…', 'not read'], 'MID: value after the "Unlocks" label on one line'),
  ...entry('src/pages/CreateTrip.tsx', ['planner', 'rented car', 'below', 'above', 'within'], 'MID: word inside a hint sentence'),
  ...entry('src/pages/CreatorHubPage.tsx', ['net', 'gross'], 'MID: basis word after "Lifetime"'),
  ...entry('src/pages/PublicItinerary.tsx', ['day', 'days'], 'MID: "Read the free {day or days} first"'),
  ...entry('src/pages/Purchases.tsx', ['it', 'them'], 'MID: end of "updated since you bought it or them"'),
  ...entry('src/pages/trip/BudgetTab.tsx', ['your local pump price', 'indicative petrol price. Actual consumption varies'], 'MID: inside a parenthetical in one sentence'),
  ...entry('src/pages/trip/BudgetTab.tsx', ['stays, fuel, meals'], 'MID: descriptor after "Essential {amount}"'),
  ...entry('src/pages/trip/BudgetTab.tsx', ['that line', 'those'], 'MID: "Without {that line or those N}:"'),
  ...entry('src/pages/trip/BudgetTab.tsx', ['settled', 'open'], 'MID: "No {settled or open} lines."'),
  ...entry('src/pages/trip/timeline/DaySection.tsx', ['car'], 'MID: mode word inside parentheses after the cost'),
  ...entry('src/pages/trip/TripSettingsForm.tsx', ['the start'], 'MID: fallback inside "Drive back to {place} at the end"'),
  ...entry('src/components/creator/StoreWeekend.tsx', ['about'], 'MID: qualifier before a rupee value in a table cell'),
  ...entry('src/components/storefront/ride/RideTimeline.tsx', ['to'], 'MID: range prefix after the arrival time'),
  ...entry('src/components/trips/OverviewRouteCard.tsx', ['about'], 'MID: qualifier written before a number inside <b>'),
  ...entry('src/lib/budgetBenchmarks.ts', ['the Konkan coast', 'the North-East'], 'MID: region label used inside a sentence'),
  ...entry('src/pages/FaqPage.tsx', ['mail us'], 'MID: inside the intro sentence "If yours isn\u2019t here, mail us and we\u2019ll add it."'),
  ...entry('src/lib/budgetBenchmarks.ts', ['shoestring', 'budget', 'comfort', 'premium', 'heritage'], 'NOT-UI: tier data label, no UI call site (tests only)'),
  ...entry('src/lib/createDraft.ts', ['earlier', 'just now', 'yesterday'], 'MID: draft age, always joined after "Saved"'),
  ...entry('src/lib/native.ts', ['shared', 'unavailable'], 'NOT-UI: internal status return code, never rendered'),
  ...entry('src/lib/seasonality.ts', ['the Konkan coast', 'the North-East'], 'MID: region label used inside a sentence'),
  ...entry('src/pages/CreateTrip.tsx', ['i'], 'NOT-UI: aria-hidden info glyph'),
  ...entry('src/pages/trip/BudgetTab.tsx', ['i'], 'NOT-UI: aria-hidden info glyph'),
  ...entry('src/pages/CreatorHubPage.tsx', ['in', 'of'], 'MID: "in {window}" and "of {n} published" follow a heading or value'),
  ...entry('src/pages/PublicItinerary.tsx', ['days', 'places', 'on the route'], 'UNIT: hero fact label that follows a number'),
  ...entry('src/pages/Purchases.tsx', ['at least'], 'MID: follows the dot after the plan count'),
  ...entry('src/pages/trip/BudgetTab.tsx', ['over the', 'inside the'], 'MID: ends "% of the estimate," on the same line'),
  ...entry('src/pages/trip/OverviewTab.tsx', ['of 100'], 'MID: follows the score number ("78 of 100")'),
  ...entry('src/pages/trip/timeline/DaySection.tsx', ['from', 'to'], 'MID: "from {place}" in the leg line, and the "to" range prefix before a time'),
  ...entry('src/pages/trip/TripSettingsForm.tsx', ['up to'], 'MID: hint beside the crew input ("up to 12")'),
  ...entry('src/pages/trip/TripSettingsForm.tsx', ['per litre'], 'UNIT: follows the fuel price value'),
  ...entry('src/pages/TripCreated.tsx', ['per head'], 'UNIT: follows the per-head price value'),
]

export function uiLabelHits(files: string[]): string[] {
  if (files.length === 0) throw new Error('The capital gate scanned zero files, so it proves nothing')
  return files.flatMap(file => lowercaseUiLabels(file))
}

const normalise = (hit: string) => hit.replace(/\\/g, '/')
const hitKey = (hit: string) => {
  const [, file, text] = /^(.*?):\d+: (.*)$/.exec(normalise(hit)) ?? []
  return `${file}|${text}`
}
const allowedKeys = new Set(ALLOWLIST.map(item => `${item.file}|${item.text}`))

describe('UI label capitals', () => {
  const files = sourceFiles('src')
  const hits = uiLabelHits(files)

  it('starts every visible label in src with a capital or a number', () => {
    expect(hits.filter(hit => !allowedKeys.has(hitKey(hit)))).toEqual([])
  })

  it('keeps every allowlist entry live, with a reason, and never lists a FIX', () => {
    const seen = new Set(hits.map(hitKey))
    expect(ALLOWLIST.filter(item => !seen.has(`${item.file}|${item.text}`)).map(item => `${item.file}: ${item.text}`)).toEqual([])
    expect(ALLOWLIST.filter(item => item.reason.trim() === '' || !/^(?:MID|UNIT|NOT-UI): /.test(item.reason))).toEqual([])
  })

  it('scans the whole app, not an empty list', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(() => uiLabelHits([])).toThrow(/zero files/)
  })

  it('fails on a known-bad sample, so the gate is proven to fire', () => {
    const source = '// lowercase comment\nconst view = <><h2>planner</h2><button title="open menu">Go</button><p>{ready ? \'saved\' : \'Draft\'}</p></>'
    expect(lowercaseUiLabels('example.tsx', source)).toEqual([
      expect.stringMatching(/^example\.tsx:2: planner$/), expect.stringMatching(/^example\.tsx:2: open menu$/), expect.stringMatching(/^example\.tsx:2: saved$/),
    ])
  })

  it('does not treat source whitespace as proof of a unit: a block that starts in lowercase fails', () => {
    const sameLine = 'const view = <div><h3>Title</h3> <p>lowercase start</p></div>'
    expect(lowercaseUiLabels('example.tsx', sameLine)).toEqual([expect.stringMatching(/^example\.tsx:1: lowercase start$/)])
    const newLine = 'const view = <div><h3>Title</h3>\n<p>lowercase start</p></div>'
    expect(lowercaseUiLabels('example.tsx', newLine)).toEqual([expect.stringMatching(/^example\.tsx:2: lowercase start$/)])
  })

  it('allows only a proven unit: text right after a count on the same text run', () => {
    const units = [
      'const view = <p><b>{n}</b> {n === 1 ? \'place\' : \'places\'}</p>',
      'const view = <p>{trips.length} trips</p>',
      'const view = <p>{row.forks} {row.forks === 1 ? \'fork\' : \'forks\'}</p>',
      'const view = <p>₹{Math.round(x)} <span>per person</span></p>',
      'const view = <p>12 <span>trips</span></p>',
    ]
    expect(units.flatMap(source => lowercaseUiLabels('example.tsx', source))).toEqual([])
    const notUnits = ['const view = <p>{title} <span>trips</span></p>', 'const view = <p>{name} {ready ? \'saved\' : \'Draft\'}</p>']
    expect(notUnits.flatMap(source => lowercaseUiLabels('example.tsx', source))).toHaveLength(2)
  })

  it('allows an example only in a verified example context', () => {
    const examples = [
      '<input placeholder="e.g. Kochi" />', '<button title="e.g. 45">Go</button>', '<input aria-label="e.g. 45" />',
      '<input placeholder="gpt-4o-mini" />', '<input placeholder="sk-…" />', '<p>https://example.com</p>', '<p>you@example.com</p>', '<p><code>day-1</code></p>',
    ].map(markup => 'const view = ' + markup)
    expect(examples.flatMap(source => lowercaseUiLabels('example.tsx', source))).toEqual([])
    expect(isExampleValue('gpt-4o-mini')).toBe(false)
    expect(isExampleValue('day-1', 'placeholder')).toBe(true)
    expect(isExampleValue('e.g. 45', 'hint')).toBe(false)
  })

  it('fails on an id-shaped label that is not in an example context, as a button named day-1', () => {
    const badSamples = ['const view = <button>day-1</button>', 'const view = <p>e.g. 45</p>', 'const view = <Field hint="e.g. 50" />', 'const view = <button>gpt-4o-mini</button>']
    expect(badSamples.flatMap(source => lowercaseUiLabels('example.tsx', source))).toEqual([
      expect.stringMatching(/^example\.tsx:1: day-1$/), expect.stringMatching(/^example\.tsx:1: e\.g\. 45$/),
      expect.stringMatching(/^example\.tsx:1: e\.g\. 50$/), expect.stringMatching(/^example\.tsx:1: gpt-4o-mini$/),
    ])
  })

  it('checks text after a decorative element: a dot, an icon or an aria-hidden glyph', () => {
    const legend = 'const view = <div><span><span className="dot" />stays 40%</span><span><Icon />food</span><span><i aria-hidden>*</i>fuel</span></div>'
    expect(lowercaseUiLabels('example.tsx', legend)).toEqual([
      expect.stringMatching(/^example\.tsx:1: stays 40%$/), expect.stringMatching(/^example\.tsx:1: food$/), expect.stringMatching(/^example\.tsx:1: fuel$/),
    ])
    expect(lowercaseMapLabels('example.tsx', legend)).toHaveLength(3)
  })
})
