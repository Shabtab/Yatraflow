// #574 — a trip card's per-person figure is an unmeasured estimate until the
// workspace measures the real road. TripsList marks it with `~`; NativeHome
// (the Android home) printed the same computeTotals number as fact. The pin
// reads both sources so the vocabulary stays in step. The workspace tabs stay
// marker-free by design — their totals pass legCorrections and are measured.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const tripsList = readFileSync(new URL('../src/pages/TripsList.tsx', import.meta.url), 'utf8')
const nativeHome = readFileSync(new URL('../src/pages/NativeHome.tsx', import.meta.url), 'utf8')

const MARKER = '~{formatInrShort(totals.costPerPersonInr)}/person'

describe('unmeasured per-person figures carry the ~ marker (#574)', () => {
  it('TripsList keeps its marker', () => {
    expect(tripsList).toContain(MARKER)
  })

  it('NativeHome matches TripsList exactly', () => {
    expect(nativeHome).toContain(MARKER)
  })

  it('both surfaces price unmeasured — a measured surface must lose its marker', () => {
    for (const [name, src] of [['TripsList', tripsList], ['NativeHome', nativeHome]] as const) {
      expect(src, name).toContain('computeTotals(')
      expect(src, name).not.toContain('legCorrections')
    }
  })
})
