// ============ Brand mark: one geometry in every place it ships ============
// The Ribbon Y is drawn by hand in several files (the React mark, the favicon,
// the exported SVGs, the OG card source and the calculator page). A copy that
// drifts back to the retired mountain mark, or loses a stroke, fails here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')

const FOLD = 'M15 6C15 26 32 24 32 40'
const ROAD = 'M49 6C49 26 32 24 32 40V46'
const DOT = 'cx="32" cy="56" r="5.5"'
const RETIRED = 'M28 62 L44 34 L56 52 L64 40 L76 62 Z'

const carriers = [
  'src/components/ui.tsx',
  'public/favicon.svg',
  'scripts/og-default-card.html',
  'public/ladakh-trip-cost-calculator/index.html',
  ...['primary', 'dark', 'reversed', 'mono'].flatMap(v => [
    `public/brand/yatraflow-mark-${v}.svg`,
    `public/brand/yatraflow-logo-${v}.svg`,
  ]),
]

describe('the Ribbon Y', () => {
  it.each(carriers)('%s draws the fold, the road and the destination', rel => {
    const text = read(rel)
    expect(text).toContain(FOLD)
    expect(text).toContain(ROAD)
    expect(text).toContain(DOT)
  })

  it('leaves no copy of the retired mountain mark', () => {
    for (const rel of [...carriers, 'index.html']) expect(read(rel), rel).not.toContain(RETIRED)
  })

  it('draws the share card mark at the spec size', () => {
    expect(read('scripts/og-default-card.html')).toContain('<svg width="31" height="34" viewBox="7.5 5.5 49 56.5"')
  })

  it('gives the Android adaptive icon the Planning Teal ground', () => {
    expect(read('android/app/src/main/res/values/ic_launcher_background.xml')).toContain('#0E7A72')
  })
})
