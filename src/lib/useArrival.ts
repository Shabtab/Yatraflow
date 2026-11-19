// ============ Page arrival ============
// A page that cascades its blocks in reading order holds its first list back
// until the blocks above it have landed. That wait is a base step count read
// from a CSS custom property (`--mt-grid-at` on My trips, `--ex-list-at` on
// Explore). The property is set only while the page root carries
// `data-arriving`. This hook removes the attribute when the arrival is over, so
// a list that mounts later plays at once instead of waiting again.
//
// CSS cannot do this alone: an animation reads its own delay from the style
// before animated custom properties apply, so a custom property that a keyframe
// animates is read as its base value there. A plain attribute is not.
import { useEffect, type RefObject } from 'react'
import { motionTiming } from './motion'

/** The arrival lasts three `--motion-slower` steps. The last card of a first grid ends inside that. */
export const ARRIVAL_STEPS = 3

export function useArrival(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current
    const timer = window.setTimeout(() => el?.removeAttribute('data-arriving'), motionTiming('--motion-slower').duration * ARRIVAL_STEPS)
    return () => window.clearTimeout(timer)
  }, [root])
}
