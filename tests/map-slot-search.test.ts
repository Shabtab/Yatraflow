/**
 * #420, slice 17 — the slot filing writer as a hook.
 *
 * Filing a found place into its day-part was a closure in the page, so
 * only the page could be read to review it. The writer lives in the hook
 * now; the query runner keeps its quota-mapped catch in the page, where
 * the render compiler needs it.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useSlotSearch } from '../src/pages/trip/map/useSlotSearch'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const mapTab = read('../src/pages/trip/MapTab.tsx')
const hook = read('../src/pages/trip/map/useSlotSearch.ts')

describe('#420 slice 17 — the filing writer leaves the page', () => {
  it('exports the writer from the hook', () => {
    expect(typeof useSlotSearch).toBe('function')
    expect(hook).toMatch(/function addManualCandidate\(slot: DaySlot, h: PlaceHit\)/)
  })

  it('the page mounts the writer with its cells as deps', () => {
    expect(mapTab).toContain("from './map/useSlotSearch'")
    expect(mapTab).toMatch(/const \{ addManualCandidate \} = useSlotSearch\(\{/)
    for (const dep of ['slotManual,', 'setSlotManual,', 'setSlotSearch,', 'identity,']) {
      expect(hook, `hook lost its ${dep} dep`).toContain(dep)
    }
    expect(mapTab).not.toMatch(/function addManualCandidate\(slot: DaySlot/)
  })

  it('the writer keeps the refusal order and the plan guard', () => {
    expect(hook).toContain("from './slotFiling'")
    expect(hook).toMatch(/slotFileRefusal\(\{/)
    expect(hook).toContain('setSlotManual')
    expect(hook).toContain('setSlotSearch')
    expect(mapTab).not.toContain('slotFileRefusal')
  })

  it('the runner keeps its quota-mapped catch in the page', () => {
    expect(mapTab).toMatch(/async function runSlotSearch\(slot: DaySlot\)/)
    expect(mapTab).toContain('err instanceof QuotaExhaustedError')
    expect(hook).not.toContain('QuotaExhaustedError')
    expect(hook).not.toContain('searchPlacesText')
  })
})
