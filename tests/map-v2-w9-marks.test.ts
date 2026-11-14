import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CORRIDOR_PAINT,
  baseTagText,
  corridorDayForLens,
  corridorEdgeGeoJson,
  corridorEdgeOffset,
  drawsCorridor,
  showsHotelTag,
} from '../src/lib/mapStyles/lensMarks'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const marksCss = read('../src/components/map/mapMarks.css')
const stylesCss = read('../src/styles/components/map-v2-rail.css')
const map = read('../src/components/TripMap.tsx')
const tab = read('../src/pages/trip/MapTab.tsx')

const FAMILY_HEXES = [
  '#228CC8', '#4A9539', '#0D8D82', '#7D5EFC', '#C27109', '#E15279', '#CE5245',
  '#67B6E8', '#8CCB72', '#6CCAB3', '#B9A2F8', '#E8AE63', '#F19BB4', '#F08B81',
]

describe('baseTagText', () => {
  it('drops the check in lead and keeps the place name', () => {
    expect(baseTagText('Check in · Spice Village')).toBe('Spice Village')
    expect(baseTagText('Check-in · Munnar hill resort')).toBe('Munnar hill resort')
    expect(baseTagText('Spice Village')).toBe('Spice Village')
    expect(baseTagText(null)).toBe('')
  })
})

describe('showsHotelTag', () => {
  it('shows the active day base tag at any zoom', () => {
    expect(showsHotelTag({ category: 'hotel', dayIndex: 2 }, 2, 5)).toBe(true)
  })

  it('shows other days only at zoom 9 or more', () => {
    expect(showsHotelTag({ category: 'hotel', dayIndex: 3 }, 2, 8)).toBe(false)
    expect(showsHotelTag({ category: 'hotel', dayIndex: 3 }, 2, 9)).toBe(true)
    expect(showsHotelTag({ category: 'hotel', dayIndex: 3 }, null, 12)).toBe(true)
  })

  it('never tags a non-hotel or an auto stop', () => {
    expect(showsHotelTag({ category: 'nature', dayIndex: 2 }, 2, 12)).toBe(false)
    expect(showsHotelTag({ category: 'hotel', dayIndex: 2, auto: true }, 2, 12)).toBe(false)
  })
})

describe('corridorDayForLens', () => {
  it('names a day only for the Drive lens', () => {
    expect(corridorDayForLens('drive', 2)).toBe(2)
    expect(corridorDayForLens('stay', 2)).toBeNull()
    expect(corridorDayForLens('fix', 2)).toBeNull()
    expect(corridorDayForLens('gap', 2)).toBeNull()
    expect(corridorDayForLens('drive', null)).toBeNull()
  })
})

describe('drawsCorridor', () => {
  it('draws only the named day', () => {
    expect(drawsCorridor(2, 2)).toBe(true)
    expect(drawsCorridor(2, 3)).toBe(false)
    expect(drawsCorridor(null, 2)).toBe(false)
    expect(drawsCorridor(undefined, 2)).toBe(false)
  })
})

describe('corridorEdgeGeoJson', () => {
  it('returns one closed-ready LineString feature', () => {
    const data = corridorEdgeGeoJson([[1, 2], [3, 4]])
    expect(data.type).toBe('FeatureCollection')
    expect(data.features).toHaveLength(1)
    expect(data.features[0].geometry.type).toBe('LineString')
    expect(data.features[0].geometry.coordinates).toEqual([[1, 2], [3, 4]])
  })
})

describe('corridor paint', () => {
  it('holds the board width, opacity and dashed edge', () => {
    expect(CORRIDOR_PAINT.width).toEqual(['interpolate', ['linear'], ['zoom'], 7, 8, 10, 12, 12, 16, 15, 46])
    expect(CORRIDOR_PAINT.opacity).toBeCloseTo(0.15)
    expect(CORRIDOR_PAINT.edgeWidth).toBe(1)
    expect(CORRIDOR_PAINT.edgeOpacity).toEqual(['step', ['zoom'], 0, 9, 0.5])
    expect(CORRIDOR_PAINT.edgeDash).toHaveLength(2)
  })

  it('keeps both offsets at half the wash width at each stop', () => {
    for (const side of [-1, 1] as const) {
      const offset = corridorEdgeOffset(side)
      expect(offset.slice(0, 3)).toEqual(CORRIDOR_PAINT.width.slice(0, 3))
      for (let i = 3; i < CORRIDOR_PAINT.width.length; i += 2) {
        expect(offset[i]).toBe(CORRIDOR_PAINT.width[i])
        expect(offset[i + 1]).toBe(Number(CORRIDOR_PAINT.width[i + 1]) * side / 2)
      }
    }
    expect(CORRIDOR_PAINT.width.at(-1)).toBe(46)
  })
})

describe('the corridor render', () => {
  it('gates the single-day wash on the named day', () => {
    expect(map).toMatch(/drawsCorridor\(corridorDay, d\.index\)/)
    expect(map).toMatch(/id=\{`yf-day-corridor-\$\{d\.index\}`\}/)
  })

  it('draws two dashed edges with a line offset', () => {
    expect(map).toContain("'line-offset': corridorEdgeOffset(side)")
    expect(map.match(/tolerance=\{CORRIDOR_PAINT\.tolerance\}/g)).toHaveLength(2)
    expect(map).toMatch(/linePaint=\{\{/)
    expect(map).toMatch(/fillPaint=\{false\}/)
  })

  it('keeps the all-days wash on the active day only', () => {
    expect(map).toMatch(/slice\.selected && slice\.dayIndex === corridorDay/)
  })

  it('sends the Drive day from the one MapTab line', () => {
    expect(tab).toMatch(/corridorDay=\{lens === 'drive' \? activeDayIndex : null\}/)
  })

  it('has no corridor in Stay, Fix or Gap', () => {
    expect(corridorDayForLens('stay', 1)).toBeNull()
    expect(corridorDayForLens('fix', 1)).toBeNull()
    expect(corridorDayForLens('gap', 1)).toBeNull()
  })
})

describe('the base tag', () => {
  it('renders the place name and hides the clock pill', () => {
    expect(map).toMatch(/isBase \? baseTagText\(p\.title\) : p\.title/)
    expect(map).toMatch(/\{c && !warn && !\(showTag && isBase\) && \(workspaceChrome/)
  })

  it('sits to the left of the mark', () => {
    expect(marksCss).toMatch(/\.mv2-pin-anchor > \.mv2-stop-tag--base(?:, [^{]*)? \{[^}]*right: calc\(100% \+ 8px\)/)
  })

  it('gives the Stay base the board rings', () => {
    expect(stylesCss).toMatch(/\.mv2-workspace \.mv2-map-stop\.is-stay-hero \{[^}]*0 0 0 11px #F2A33A55/)
    expect(stylesCss).toMatch(/\.mv2-workspace \.mv2-map-stop\.is-stay-hero::after \{ content: none; \}/)
  })
})

describe('pick tiles', () => {
  it('removes the plus dot in the workspace', () => {
    expect(map).toMatch(/onAddNearby && !workspaceChrome && \(/)
    expect(map).toMatch(/type="button"/)
  })

  it('puts a divider between the time and the km', () => {
    expect(marksCss).toMatch(/\.mv2-pin-clock small \{[^}]*border-left: 1px solid/)
  })
})

describe('one family colour source', () => {
  it('leaves no family hex in styles.css', () => {
    const familyRules = stylesCss.match(/\[data-family[^\]]*\][^{]*\{[^}]*\}/g) ?? []
    for (const rule of familyRules) {
      for (const hex of FAMILY_HEXES) expect(rule).not.toContain(hex)
    }
    expect(stylesCss).not.toContain('--tile-ink')
  })

  it('makes the place tile read the mark variables', () => {
    const rule = stylesCss.match(/\.mv2-lens-place-tile \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('background: var(--mark-tint')
    expect(rule).toContain('border: 1.5px solid var(--mark-edge')
    expect(rule).toContain('color: var(--mark-ink')
  })

  it('covers the place tile with one rule set for every family', () => {
    for (const family of ['water', 'nature', 'views', 'faith', 'heritage', 'culture', 'needs']) {
      const light = marksCss.match(new RegExp(`\\.mv2-lens-place-tile\\[data-family='${family}'\\](?:, [^{]*)? \\{[^}]*\\}`))?.[0] ?? ''
      expect(light).toContain('--mark-family:')
      expect(light).toContain('--mark-tint:')
      expect(light).toContain('--mark-edge:')
      expect(light).toContain('--mark-ink:')
    }
  })

  it('keeps a dark theme set for every family', () => {
    for (const family of ['water', 'nature', 'views', 'faith', 'heritage', 'culture', 'needs']) {
      expect(marksCss).toContain(`:root:where([data-theme='dark']) .mv2-lens-place-tile[data-family='${family}']`)
    }
  })
})
