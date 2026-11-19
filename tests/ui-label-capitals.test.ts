import { describe, expect, it } from 'vitest'
import { isExampleValue, lowercaseUiLabels, sourceFiles } from './uiSourceScan'

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
  ...entry('src/components/creator/StoreWeekend.tsx', ['about'], 'MID: qualifier before a rupee value in a table cell'),
  ...entry('src/components/storefront/ride/RideTimeline.tsx', ['to'], 'MID: range prefix after the arrival time'),
  ...entry('src/components/trips/OverviewRouteCard.tsx', ['about'], 'MID: qualifier written before a number inside <b>'),
  ...entry('src/lib/budgetBenchmarks.ts', ['the Konkan coast', 'the North-East'], 'MID: region label used inside a sentence'),
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

  it('allows a unit after a number and an example value, but not a new line of lowercase', () => {
    const unit = 'const view = <p><b>{n}</b> {n === 1 ? \'place\' : \'places\'} <span>per person</span></p>'
    expect(lowercaseUiLabels('example.tsx', unit)).toEqual([])
    const newBlock = 'const view = <div><h3>Title</h3>\n<p>lowercase start</p></div>'
    expect(lowercaseUiLabels('example.tsx', newBlock)).toEqual([expect.stringMatching(/^example\.tsx:2: lowercase start$/)])
    expect(['https://example.com', 'www.site.in', 'you@example.com', 'gpt-4o-mini', 'sk-…', 'e.g. Kochi'].filter(value => !isExampleValue(value))).toEqual([])
    expect(['co-planner', 'planner', 'app'].filter(isExampleValue)).toEqual([])
  })
})
