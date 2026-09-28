// ============ #378 — the create page's honesty wiring ============
// The pure rules live in lib/createHonesty (tests/createHonesty.test.ts). What
// needs pinning HERE is the page's wiring: that submit actually consults the
// composer rule, that the day-count revalidation runs on the day-count change
// itself (not per widget — the issue's "centralize on the dayCount change"
// pitfall: pickTemplate and applyDayOutShape rewrite dates programmatically,
// so a calendar-only hook would miss them), and that the ticket prints the
// parsed segments rather than the raw strings. The node env has no DOM to
// render the form in, so this is a source contract like the repo's other
// page pins (tests/create-persist-submit.test.ts, tests/map-slot-filing.test.ts).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/CreateTrip.tsx', 'utf8')

describe('CreateTrip #378 wiring', () => {
  it('submit consults the composer-row rule before any network work', () => {
    // The composer error joins the same `next` map the other field errors use,
    // so it rides the F-15 first-invalid focus too.
    expect(page).toMatch(/composerRowError\(c\.title\)/)
    expect(page).toMatch(/next\.composerRow = composer/)
  })

  it('revalidates commitments on the day-count change, in an effect on dayCount', () => {
    // Centralized on the VALUE: the effect must depend on `dayCount` (the
    // bill's number) — not on a calendar widget's onChange, which the template
    // and day-out shapes bypass.
    expect(page).toMatch(/revalidateCommitments\(list, dayCount\)/)
    expect(page).toMatch(/useEffect\(\(\) => \{[\s\S]{0,400}revalidateCommitments[\s\S]{0,200}\}, \[dayCount\]\)/)
    // The move is said, not silent:
    expect(page).toMatch(/commitmentMoveMessage\(movedCount\)/)
  })

  it('submits only revalidated commitments, never the raw list', () => {
    // The submit path builds fixedCommitments from state that the effect has
    // already revalidated; the raw-list shape must not reappear on the wire.
    expect(page).toMatch(/fixedCommitments: commitments\.filter\(x => x\.title\.trim\(\)\)/)
    // And the composer's own day pick cannot exceed the day count it is
    // rendered from (the Select is built from dayCount):
    expect(page).toMatch(/options=\{Array\.from\(\{ length: Math\.max\(1, dayCount\) \}/)
  })

  it('renders the fuel notice and the parsed ticket segments, not raw strings', () => {
    expect(page).toMatch(/fuelFallbackNotice\(f\.transportMode, f\.fuelEconomy, f\.fuelPrice\)/)
    expect(page).toMatch(/\{fuelNotice && \(/)
    // The old raw-string line must be gone — segments only:
    expect(page).not.toMatch(/\$\{f\.fuelEconomy\} km\/L/)
    expect(page).toMatch(/ticketFuelSegments\(f\.fuelEconomy, f\.fuelPrice, f\.tankL\)\.join\(' · '\)/)
  })

  it('the composer input is reachable by the F-15 focus path', () => {
    expect(page).toMatch(/ct-composer-input/)
    expect(page).toMatch(/composerRow: 'ct-composer-input'/)
  })
})
