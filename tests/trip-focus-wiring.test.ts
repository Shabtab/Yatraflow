import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Strip comment lines so prose about the contract cannot impersonate it
 *  (§6x: a negative source assertion judges code, never comments). */
function codeOf(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
}

describe('#425 PR 1 — the shared focus contract is wired at the workspace', () => {
  const ws = codeOf('../src/pages/TripWorkspace.tsx')

  it('the workspace imports the shared contract module', () => {
    expect(ws).toMatch(/from '\.\.\/lib\/tripFocus'/)
  })

  it('raising a day focus validates the request against the trip (canFocusDay)', () => {
    // the raise path must call the shared validator before setting state
    expect(ws).toMatch(/canFocusDay\(/)
    expect(ws).toMatch(/normalizeFocus\(/)
  })

  it('both onOpenDay call sites raise through the validated path', () => {
    // map tab + settings both hand days to the timeline
    const raises = (ws.match(/setFocusedDay\(dayIndex\)/g) ?? []).length
    expect(raises).toBe(2)
  })

  it('focus is local UI state only — never written through updateTrip', () => {
    // the focus setter must not appear inside any persist/write call
    expect(ws).not.toMatch(/updateTrip\([^)]*setFocus/)
  })
})

describe('#425 PR 1 — Timeline consumes through the shared validator', () => {
  const tab = codeOf('../src/pages/trip/TimelineTab.tsx')

  it('the consume gate is canFocusDay, not a hand-rolled day scan', () => {
    expect(tab).toMatch(/canFocusDay\(\{ dayIndex: focusDay \}, trip\)/)
    expect(tab).not.toMatch(/trip\.days\.some\(d => d\.index === focusDay\)/)
  })

  it('a refused request is still consumed (no re-fire on remount)', () => {
    // refused branch must call onFocusConsumed before returning
    const refused = tab.match(/if \(!canFocusDay\([\s\S]{0,200}?return\s*\n\s*\}/)
    expect(refused).toBeTruthy()
    expect(refused![0]).toContain('onFocusConsumed?.()')
  })
})

describe('#425 PR 2 boundary — TripMap untouched in this PR', () => {
  it('TripMap still uses its own day-filter prop, not the shared contract', () => {
    // guards the two-PR split: when PR 2 adopts the contract, this is the
    // line to flip deliberately.
    const map = codeOf('../src/components/TripMap.tsx')
    expect(map).not.toMatch(/from '\.\.\/lib\/tripFocus'/)
  })
})
