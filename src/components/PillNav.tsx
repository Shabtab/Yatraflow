// ============ PillNav — pill navs with a sliding active indicator ============
// One mechanic for every pill nav (top nav, workspace tab bar): an absolutely
// positioned "glider" pill slides behind the active item instead of each item
// painting its own background, so switching reads as one continuous motion.
// The glider is measured from the active item, re-measured when the row
// reflows or the webfont swaps in, and skips its transition on first paint so
// pages don't animate on load.
//
// The glide is a FLIP — the same technique the drag settle uses: the target
// box's width/height are WRITTEN to the element and never transitioned, while
// the visible motion is a transform from the previous box (translate to the old
// origin, scaled by oldWidth/newWidth, settling at scaleX(1)). Transitioning
// left/width/top/height instead relaid out the nav on every tab change, which
// is what docs/MOTION-TOKENS.md's "thumb `transform` slide" row described all
// along — the code now matches the catalog.
import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { railOverflow } from '../lib/railOverflow'

export function PillNav({ activeKey, className, role = 'presentation', 'aria-label': ariaLabel, children }: {
  activeKey: string
  className?: string
  /** the workspace tab bar keeps its tablist semantics; navs use 'navigation' */
  role?: 'presentation' | 'tablist' | 'group' | 'navigation'
  'aria-label'?: string
  children: ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const gliderRef = useRef<HTMLSpanElement>(null)
  /** The last placed box, in the wrap's padding-box space: the FLIP's frame 1.
      A ref, not state — it is read and written during layout, and none of it
      should cost a render. */
  const prevRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  /** Distinguishes "the active key changed" (glide) from every other re-measure
      (snap) — the two arrive through the same effect. */
  const firstRunRef = useRef(true)
  const lastKeyRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const glider = gliderRef.current
    if (!wrap || !glider) return

    const place = (animate: boolean) => {
      const el = wrap.querySelector<HTMLElement>(`[data-pill-key="${CSS.escape(activeKey)}"]`)
      if (!el) { glider.style.opacity = '0'; return }
      glider.style.opacity = '1'
      // getBoundingClientRect rather than offsetLeft/offsetWidth: those round to
      // whole pixels while flex and text layout are fractional, which leaves a
      // sub-pixel sliver at the pill's edge on fractional-DPR and zoomed
      // viewports.
      //
      // A rect difference is a VIEWPORT delta, but the glider's own box is
      // resolved in the wrap's padding box. So the conversion has to add back
      // the scroller's scroll offset (a horizontally scrolling .tabbar would
      // otherwise drag the glider along with it) and drop the wrap's border,
      // since the padding box starts inside it.
      const box = wrap.getBoundingClientRect()
      const item = el.getBoundingClientRect()
      const x = item.left - box.left + wrap.scrollLeft - wrap.clientLeft
      // track the row too, so wrapping pillbars glide correctly, and INSET the
      // glider 4px from the top to match the `- 8` on the height below, which
      // centres the pill's fill on its label. The FLIP rewrite dropped this +4
      // and every active pill across the UI read as off-centre - the fill sat
      // flush at the top and 8px short at the bottom.
      const y = item.top - box.top + wrap.scrollTop - wrap.clientTop + 4
      const w = item.width
      const h = item.height - 8

      const prev = prevRef.current
      // A re-measure that found the same box has nothing to correct, and acting
      // on it would be worse than ignoring it: ResizeObserver fires once on
      // observe(), so an unguarded re-place here would animate a correction that
      // nobody asked for.
      if (!animate && prev && prev.x === x && prev.y === y && prev.w === w && prev.h === h) return

      // The glide animates the glider's own BOX - left/top/width/height together -
      // and NOT a transform. Resizing a rounded pill with `scaleX` stretches its
      // ends into ellipses; at a 76px -> 146px tab change that is a scaleX of
      // 1.93, and it read as the animation breaking rather than the pill gliding.
      // It is also not the layout cost it looks like: the glider is absolutely
      // positioned, so its own box cannot reflow its siblings - the work is this
      // one element's layout and paint, which is why the original animation was
      // cheap all along.
      // A non-glide write (first paint, or a correction) suppresses the
      // transition so it places instantly instead of animating into position.
      const canAnimate = animate && !!prev
      if (!canAnimate) glider.style.transition = 'none'
      glider.style.left = `${x}px`
      glider.style.top = `${y}px`
      glider.style.width = `${w}px`
      glider.style.height = `${h}px`
      if (!canAnimate) {
        void glider.offsetWidth       // commit the placement before handing the curve back
        glider.style.transition = ''
      }

      prevRef.current = { x, y, w, h }
    }

    // The rail can overflow at phone width, and it hides its scrollbar. So the
    // rail's own scroll position is published for CSS to paint the edge fade on
    // a side that still holds hidden tabs. `.tabbar[data-overflow]` reads it.
    const syncOverflow = () => {
      const state = railOverflow(wrap.scrollLeft, wrap.scrollWidth, wrap.clientWidth)
      if (wrap.dataset.overflow !== state) wrap.dataset.overflow = state
    }

    // Only a change of activeKey glides; the first paint and every later
    // re-measure snap.
    const keyChanged = lastKeyRef.current !== activeKey
    place(!firstRunRef.current && keyChanged)
    syncOverflow()
    firstRunRef.current = false
    lastKeyRef.current = activeKey

    // A pillbar can reflow with no viewport change — a wrapping filter bar, or
    // the active item gaining a count badge — so watch the box itself, and
    // re-measure once the webfont swaps in, because the first measurement can
    // run against fallback metrics. The font promise outlives this effect, so it
    // needs its own cancellation: without it a stale closure could write the
    // previous active key's geometry after the tab already changed.
    //
    // These are corrections, not switches, so they snap: gliding away from
    // wherever the row happened to be would read as a second, unasked-for
    // movement.
    let live = true
    const remeasure = () => { place(false); syncOverflow() }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure)
    ro?.observe(wrap)
    document.fonts?.ready.then(() => { if (live) remeasure() }).catch(() => {})
    window.addEventListener('resize', remeasure)
    // A sideways swipe is the common case, and it is the only one a resize
    // observer cannot see. The listener is passive: it never blocks the swipe.
    wrap.addEventListener('scroll', syncOverflow, { passive: true })
    return () => {
      live = false
      ro?.disconnect()
      window.removeEventListener('resize', remeasure)
      wrap.removeEventListener('scroll', syncOverflow)
    }
  }, [activeKey, children])

  return (
    <div ref={wrapRef} className={`pill-nav ${className ?? ''}`} role={role} aria-label={ariaLabel}>
      <span ref={gliderRef} className="pill-glider" aria-hidden />
      {children}
    </div>
  )
}
