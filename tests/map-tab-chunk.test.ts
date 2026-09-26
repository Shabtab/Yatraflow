import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the Map tab is a real chunk boundary (#332 R4)', () => {
  // Source invariant, in the project's established shape (trip-road /
  // route-integrity / mobile-shell). Nothing else in the gate can see this: tsc,
  // every other test and the build all pass with the whole suggestion stack
  // inlined into the workspace chunk. Before R4, TripWorkspace imported MapTab
  // statically — so geocode, engine, daySlots, tripDna, storyArcs and
  // slackPrompts shipped to every workspace visitor whether or not they ever
  // opened the Map tab, and the Suspense boundary around the tab waited only for
  // MapLibre. The measured chunk sizes are the proof; this is the guard that
  // stops the edge quietly re-forming.
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

  it('the workspace holds no static value-import of its lazy tab', () => {
    const lines = read('../src/pages/TripWorkspace.tsx').split('\n')
    const importsFromMapTab = lines.filter(
      l => /^\s*import\b/.test(l) && /from\s+'\.\/trip\/MapTab'/.test(l),
    )
    // `import type { … }` is erased at compile time and costs no chunk, so it is
    // allowed on purpose — only a value import re-creates the static edge.
    expect(importsFromMapTab.filter(l => !/^\s*import\s+type\b/.test(l))).toEqual([])
  })

  it('it lazy-imports the tab itself, not just the renderer inside it', () => {
    expect(read('../src/pages/TripWorkspace.tsx'))
      .toMatch(/lazy\(\(\)\s*=>\s*import\('\.\/trip\/MapTab'\)/)
  })

  it('the Suspense fallback comes from the dependency-free module', () => {
    const workspace = read('../src/pages/TripWorkspace.tsx')
    expect(workspace).toMatch(/from\s+'\.\/trip\/MapTabSkeleton'/)
    expect(workspace).toMatch(/<MapTabSkeleton\s*\/>/)
  })

  it('the skeleton module imports nothing — a fallback must not suspend on itself', () => {
    const skeleton = read('../src/pages/trip/MapTabSkeleton.tsx')
    expect(skeleton).not.toMatch(/^\s*import\b/m)
    expect(skeleton).not.toMatch(/MapTab'/)
  })

  it('MapTab no longer defines the skeleton it waits behind', () => {
    expect(read('../src/pages/trip/MapTab.tsx')).not.toMatch(/export function MapTabSkeleton/)
  })
})
