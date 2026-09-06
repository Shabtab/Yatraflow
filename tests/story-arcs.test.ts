// Horizon 3.5: story arcs.
// Candidate sights cluster by theme (fort, spice, backwater, pilgrimage…)
// and offer a themed bundle as a one-tap multi-add.
import { describe, it, expect } from 'vitest'
import { clusterStoryArcs } from '../src/lib/storyArcs'

function hit(name: string, category = 'sightseeing', description = '') {
  return { id: name, name, category, description }
}

describe('story arcs', () => {
  it('clusters fort sights into one arc', () => {
    const arcs = clusterStoryArcs([
      hit('Amer Fort', 'fort', 'Rajput fort overlooking Maota lake'),
      hit('Nahargarh Fort', 'fort'),
      hit('Jal Mahal', 'palace', 'water palace near the old fort'),
    ])
    expect(arcs).toHaveLength(1)
    expect(arcs[0].theme).toBe('fort')
    expect(arcs[0].hitIds).toHaveLength(3)
  })

  it('splits themes and drops singletons', () => {
    const arcs = clusterStoryArcs([
      hit('Amer Fort', 'fort'),
      hit('Jaigarh Fort', 'fort'),
      hit('Lonely Cafe', 'cafe'),
    ])
    expect(arcs).toHaveLength(1)
    expect(arcs[0].hitIds).toEqual(['Amer Fort', 'Jaigarh Fort'])
  })

  it('labels the arc from member names', () => {
    const arcs = clusterStoryArcs([hit('Amer Fort', 'fort'), hit('Jaigarh Fort', 'fort')])
    expect(arcs[0].label).toContain('Fort day')
    expect(arcs[0].label).toContain('Amer Fort')
  })

  it('returns nothing for an empty pool', () => {
    expect(clusterStoryArcs([])).toEqual([])
  })
})
