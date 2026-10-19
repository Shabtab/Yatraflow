// ============ Transport-aware options: caller seams (2026-10-19) ============
// These are SOURCE pins, not DOM tests: this repo has no render harness for the
// map or timeline panels. They exist because the failure they guard is
// invisible. `drivesPart` is an optional property, so a caller that forgets it
// type-checks, lints, renders, and silently keeps planning a Mixed-No trip as
// driving. Only an explicit pin turns that omission red.
//
// Every pin below names a real caller the plan travels through. If one of these
// files is refactored, the pin fails and the answer has to be re-wired on
// purpose rather than lost in the move.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('MapTab threads the answer into both verdicts', () => {
  const src = read('../src/pages/trip/MapTab.tsx')

  it('passes it to the shared party options both verdicts spread', () => {
    expect(src).toMatch(/const partyOpts = \{[^}]*drivesPart: trip\.drivesPart,/s)
  })

  it('lists it in the split verdict memo deps', () => {
    // The split verdict is the drive-day count; a stale one after the answer
    // changes is the visible bug.
    expect(src).toMatch(/\[planKm, wholeTrip\.min, trip\.travelStyle, trip\.transportMode, trip\.drivesPart,[^\]]*roadProfile\]/)
  })

  it('lists it in the clock verdict memo deps', () => {
    expect(src).toMatch(/\[planKm, wholeTrip\.min, trip\.travelStyle, trip\.transportMode, trip\.drivesPart,[^\]]*roadProfile\]/)
  })

  it('carries it into the nearby options the corridor reads', () => {
    expect(src).toMatch(/nearbyOpts: NearbyOpts = useMemo\(\(\) => \(\{[^}]*drivesPart: trip\.drivesPart,/s)
  })
})

describe('the two cache keys separate the three answers', () => {
  it('useCorridorCache keys the map on it', () => {
    expect(read('../src/pages/trip/map/useCorridorCache.ts'))
      .toMatch(/transportMode: trip\.transportMode,\s*\n\s*drivesPart: trip\.drivesPart,/)
  })

  it('TravelPanel keys the halt stamp on it', () => {
    expect(read('../src/pages/trip/timeline/TravelPanel.tsx'))
      .toMatch(/transportMode: trip\.transportMode,\s*\n\s*drivesPart: trip\.drivesPart,/)
  })
})

describe('Create Trip threads the answer into its own drive-day plan', () => {
  const src = read('../src/pages/CreateTrip.tsx')

  it('passes it to planDriveDays', () => {
    expect(src).toMatch(/planDriveDays\(\{[^}]*transportMode: f\.transportMode, drivesPart: f\.drivesPart,/s)
  })

  it('lists it in that memo\'s deps, so a new answer re-plans the estimate', () => {
    expect(src).toMatch(/\[bill\.roadKm, f\.transportMode, f\.drivesPart,[^\]]*\]/)
  })
})

describe('the Mixed question is a two-way door in Settings', () => {
  const src = read('../src/pages/trip/TripSettingsForm.tsx')

  it('renders whenever the trip IS Mixed, not only while unanswered', () => {
    // Gating the question on `mustAnswerDriving` made Yes one-way: the buttons
    // vanished on click, and a reloaded answered trip showed none. Only the
    // validation may use the open-question flag.
    expect(src).toMatch(/\{f\.transportMode === 'mixed' && \(\s*\n\s*<Surface/)
    expect(src).not.toMatch(/\{policy\.mustAnswerDriving && \(\s*\n\s*<Surface/)
  })

  it('still requires an answer only when Mixed is newly selected', () => {
    expect(src).toMatch(/newlySelectedMixed = f\.transportMode === 'mixed' && trip\.transportMode !== 'mixed'/)
    expect(src).toMatch(/if \(newlySelectedMixed && typeof f\.drivesPart !== 'boolean'\) \{/)
  })
})

describe('the guarded write path reaches the real writers', () => {
  const src = read('../src/store/store.ts')

  it('refuses an unknown probe BEFORE mutating, so the refusal is honest', () => {
    // The refusal copy says nothing changed. If updateTrip mutated the cache
    // first and only the async writer refused, the local trip would keep the
    // new answer while the row never got it — the exact lie the copy forbids.
    expect(src).toMatch(/if \(typeof patchFields\.drivesPart === 'boolean'\) \{\s*\n\s*const cols = lastResolvedOptionalColumns\s*\n\s*if \(!cols\) \{ void tripsHaveOptionalColumns\(\) \}\s*\n\s*if \(!cols \|\| !cols\.drivesPart\) \{[^}]*return false/s)
  })

  it('guards the insert path after the awaited probe', () => {
    // The insert awaits `tripsHaveOptionalColumns()` and then calls
    // tripToRow, which silently omits a missing column. The guard has to sit
    // between those two lines.
    expect(src).toMatch(/await tripsHaveOptionalColumns\(\)\s*\n\s*(?:\/\/[^\n]*\n\s*)*const drivesPartVerdict = drivesPartWriteVerdict\(/)
  })

  it('guards the debounced update path too', () => {
    expect(src.match(/drivesPartWriteVerdict\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('no longer keeps the helper unused', () => {
    expect(src).not.toMatch(/function rememberOptionalColumns[\s\S]*?\n\}\n/)
    expect(src).toContain('rememberOptionalColumns')
  })
})