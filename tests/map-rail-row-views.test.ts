import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GapRow, LedgerRow } from '../src/pages/trip/map/RailRowViews'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const mapTab = read('../src/pages/trip/MapTab.tsx')
const views = read('../src/pages/trip/map/RailRowViews.tsx')

describe('#420 slice 16 — the rail rows render outside the page', () => {
  it('exports the two row components', () => {
    expect(typeof LedgerRow).toBe('function')
    expect(typeof GapRow).toBe('function')
  })

  it('the page no longer defines the row renderers', () => {
    expect(mapTab).not.toContain('function renderLedgerRow')
    expect(mapTab).not.toContain('function renderGapRow')
    expect(mapTab).toContain("from './map/RailRowViews'")
  })

  it('widening stays a page callback', () => {
    expect(views).toContain('onWiden')
    expect(views).not.toMatch(/setScopeIdx|SCOPE_KM_STEPS/)
    expect(mapTab).toContain('widenScope')
  })

  it('gaps keep their honest row through the ledger', () => {
    expect(views).toContain('<GapRow')
  })
})
