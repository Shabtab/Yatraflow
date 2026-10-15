// ============ Rail overflow — the scroll state of a horizontal pill rail ============
// The workspace tab rail scrolls sideways at phone width. It hides its
// scrollbar. CSS cannot read a scroll position, so PillNav publishes this state
// instead. The `.tabbar[data-overflow]` rules in styles.css paint the edge fade.
//
// 'none'   the rail fits; nothing is hidden
// 'start'  the rail sits at its left edge; tabs hide past the right edge
// 'middle' the rail sits between the edges; tabs hide on both sides
// 'end'    the rail sits at its right edge; tabs hide past the left edge

export type RailOverflow = 'none' | 'start' | 'middle' | 'end'

/** A scroll offset this close to an edge counts as that edge. */
const EDGE_EPSILON = 1

export function railOverflow(scrollLeft: number, scrollWidth: number, clientWidth: number): RailOverflow {
  const max = scrollWidth - clientWidth
  if (max <= EDGE_EPSILON) return 'none'
  if (scrollLeft <= EDGE_EPSILON) return 'start'
  if (scrollLeft >= max - EDGE_EPSILON) return 'end'
  return 'middle'
}
