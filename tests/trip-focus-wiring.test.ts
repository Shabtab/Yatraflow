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

  it('openTimeline resolves the target and sets the shared day focus', () => {
    const openTimeline = ws.match(/function openTimeline\([\s\S]*?\n  \}/)?.[0] ?? ''
    expect(openTimeline).toContain('const next = resolveTimelineFocus(trip, target)')
    expect(openTimeline).toContain('if (next.dayIndex != null) setFocusedDay(next.dayIndex)')
  })

  it('both onOpenDay call sites pass the day target to openTimeline', () => {
    // map tab + settings both hand days to the timeline
    expect((ws.match(/onOpenDay=\{dayIndex => openTimeline\(\{ dayIndex \}\)\}/g) ?? []).length).toBe(2)
    const mapTab = ws.match(/<MapTab\b[\s\S]*?\/>/)?.[0] ?? ''
    const settings = ws.match(/<TripSettingsForm\b[\s\S]*?\/>/)?.[0] ?? ''
    expect(mapTab).toContain('onOpenDay={dayIndex => openTimeline({ dayIndex })}')
    expect(settings).toContain('onOpenDay={dayIndex => openTimeline({ dayIndex })}')
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

describe('#425 PR 2 — the map validates its inbound day filter', () => {
  it('TripMap refuses a focusDay no day of THIS trip matches (reads as all)', () => {
    // PR 2 flipped this boundary deliberately: the map's filter now honors
    // the same validate-before-use rule as every other focus consumer.
    const map = codeOf('../src/components/TripMap.tsx')
    expect(map).toMatch(/trip\.days\.some\(d => d\.index === focusDay\)/)
  })

  it('the workspace passes the ONE shared axis to Board and MapTab', () => {
    const ws = codeOf('../src/pages/TripWorkspace.tsx')
    expect(ws).toMatch(/dayFocus=\{sharedDay\}/)
    expect((ws.match(/dayFocus=\{sharedDay\}/g) ?? []).length).toBe(2)
    expect(ws).toMatch(/dayFromFocus\(focus, trip\.id\)/)
  })

  it('MapTab consumes the axis through resolveRailDay, not a day-zero reset (#610)', () => {
    // #420 slice 12: the rule lives in the rail-view hook; the page consumes it.
    const hook = codeOf('../src/pages/trip/map/useRailView.ts')
    expect(hook).toMatch(/const activeDayIndex = resolveRailDay\(dayFocus/)
    const tab = codeOf('../src/pages/trip/MapTab.tsx')
    expect(tab).toContain('} = useRailView(')
  })

  it('Board and MapTab hold no second selection when the axis is handed over', () => {
    const board = codeOf('../src/components/BoardView.tsx')
    expect(board).toMatch(/dayFocus \?\? localFocusDay/)
    expect(board).toMatch(/onDayFocusChange\?\.\(day\)/)
    const tab = codeOf('../src/pages/trip/MapTab.tsx')
    // The map's day picker (chooseDay) is the one day control. The Day plan
    // lost its own day chips, so it cannot hold a second selection.
    expect(tab).toMatch(/function chooseDay\(index: number\) \{[^}]*onDayFocusChange\?\.\(index\)/)
    expect(tab).not.toMatch(/onDayFocusChange\?\.\(d\.index\)/)
    expect(tab).toMatch(/onDayFocusChange\?\.\(day\)/)
  })
})
