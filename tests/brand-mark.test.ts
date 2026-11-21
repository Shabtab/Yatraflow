// ============ Brand mark: one geometry in every place it ships ============
// The Ribbon Y is drawn by hand in several files. The React mark, the favicon
// and the icon script carry it. The exported SVGs, the OG card source and the
// calculator page carry it too. A copy that drifts back to the retired mountain
// mark, or loses a stroke, fails here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')

const FOLD = 'M15 6C15 26 32 24 32 40'
const ROAD = 'M49 6C49 26 32 24 32 40V46'
const DOT = 'cx="32" cy="56" r="5.5"'
const DARK_DOT = 'cx="32" cy="56" r="5.5" fill="#F5A94A"'
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

  // The icon script parses the same path lines into raster math, so a rerun
  // of the script keeps the mark.
  it('scripts/generatePwaIcons.mjs rasterizes the same Ribbon Y', () => {
    const text = read('scripts/generatePwaIcons.mjs')
    expect(text).toContain(FOLD)
    expect(text).toContain(ROAD)
    expect(text).toContain('cx: 32, cy: 56, r: 5.5')
  })

  it('scripts/generatePwaIcons.mjs carries no retired mountain mark', () => {
    expect(read('scripts/generatePwaIcons.mjs')).not.toContain(RETIRED)
  })

  it.each([
    'public/brand/yatraflow-mark-dark.svg',
    'public/brand/yatraflow-logo-dark.svg',
    'public/brand/yatraflow-mark-reversed.svg',
    'public/brand/yatraflow-logo-reversed.svg',
  ])('%s uses the dark saffron for its destination dot', rel => {
    expect(read(rel)).toContain(DARK_DOT)
  })

  it('draws the share card mark at the spec size', () => {
    // 60 px tall on the 1200 px card, so the mark is 30 px at the 600 px thumbnail.
    expect(read('scripts/og-default-card.html')).toContain('<svg width="52" height="60" viewBox="7.5 5.5 49 56.5"')
  })

  it('keeps the Y mark as the share card brand, with Chakra outside the brand block', () => {
    const card = read('scripts/og-default-card.html')
    const brand = card.slice(card.indexOf('<div class="brand">'), card.indexOf('</div>', card.indexOf('<div class="brand">')))
    expect(brand).toContain(FOLD)
    expect(brand).not.toContain('mascot')
    // Chakra stands right of the centre square (x 285 to 915) that WhatsApp crops to.
    expect(card).toMatch(/\.chakra \{[^}]*left: (9[2-9]\d|1\d{3})px/)
  })

  it('ships the rendered share card at 1200x630 and under 300 KB', () => {
    const png = readFileSync(new URL('../public/og-default.png', import.meta.url))
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
    expect(png.length).toBeLessThan(300 * 1024)
  })

  it('gives the Android adaptive icon the Planning Teal ground', () => {
    expect(read('android/app/src/main/res/values/ic_launcher_background.xml')).toContain('#0E7A72')
  })
})
