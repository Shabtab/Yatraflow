// ============ The map and the rail say which scope they are planning (#416) ============
// The map's own chips include "All days" while the rail always plans exactly one, and
// nothing said so: the map's choice never reached the rail. The fix is disclosure, not a
// trip-wide rail -- the rail's slots are per-day by construction, so a "whole trip" rail
// would have to invent a scope the data does not have. These pin the sentence and, more
// importantly, the honesty rule behind it: MapTab does not know the map's initial filter
// (the filter lives inside TripMap and is only reported on a chip click), so the state is
// null-initialised and the rail must say NOTHING until the map has said something.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapScopeNote } from '../src/lib/railA11y'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tab = readFileSync(join(root, 'src', 'pages', 'trip', 'MapTab.tsx'), 'utf8')

describe('mapScopeNote (A416)', () => {
  it('says nothing before the map has reported its scope', () => {
    expect(mapScopeNote(null, 0)).toBeNull()
    expect(mapScopeNote(null, 3)).toBeNull()
  })

  it('says nothing when both surfaces are on the same day', () => {
    expect(mapScopeNote(0, 0)).toBeNull()
    expect(mapScopeNote(2, 2)).toBeNull()
  })

  it('names both scopes when the map shows all days and the rail plans one', () => {
    const note = mapScopeNote('all', 2)
    expect(note).toContain('all days')
    expect(note).toContain('Day 3')
  })

  it('counts the day the way the rest of the app does', () => {
    expect(mapScopeNote('all', 0)).toContain('Day 1')
  })
})

describe('MapTab wires the scope note honestly (A416)', () => {
  it('initialises the map scope as unknown, never as a guess', () => {
    expect(tab).toMatch(/useState<number \| 'all' \| null>\(null\)/)
  })

  it('records what the map reports, including all days', () => {
    expect(tab).toMatch(/onDayFilterChange=\{day => \{[\s\S]{0,220}setMapFilter\(day\)/)
  })

  it('renders the sentence from that state and the rail\'s own day', () => {
    expect(tab).toMatch(/mapScopeNote\(mapFilter, activeDayIndex\)/)
    expect(tab).toMatch(/role="status"/)
  })
})