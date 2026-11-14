// ============ Day ribbon scroll target ============
// Pure geometry for the Ride along day ribbon. The ribbon scrolls sideways.
// When a visitor picks a day at the edge of the strip, the days after it must
// come into view. This module says where to scroll. The component does the
// scrolling.

export interface RibbonBox {
  left: number
  right: number
}

export interface RibbonScrollInput {
  /** The scroll host, in viewport coordinates. */
  host: RibbonBox
  /** The host's inline scroll padding, in pixels. */
  inset: number
  scrollLeft: number
  /** The largest scrollLeft the host allows. */
  max: number
  day: RibbonBox
  prev?: RibbonBox
  next?: RibbonBox
}

/**
 * The scrollLeft that puts the chosen day in the middle of the strip, so one
 * neighbour shows on each side where the strip allows it. Returns null when the
 * day and both neighbours already sit in view, or when the strip cannot move
 * any closer to the centre. The target never leaves the scroll range.
 */
export function ribbonScrollTarget(input: RibbonScrollInput): number | null {
  const { host, inset, scrollLeft, max, day, prev, next } = input
  const viewLeft = host.left + inset
  const viewRight = host.right - inset
  const spanLeft = (prev ?? day).left
  const spanRight = (next ?? day).right
  if (spanLeft >= viewLeft && spanRight <= viewRight) return null
  const shift = (day.left + day.right) / 2 - (host.left + host.right) / 2
  const target = Math.min(Math.max(scrollLeft + shift, 0), Math.max(0, max))
  return Math.abs(target - scrollLeft) < 1 ? null : target
}
