// ============ PillNav — pill navs with a sliding active indicator ============
// One mechanic for every pill nav (top nav, workspace tab bar): an absolutely
// positioned "glider" pill slides behind the active item instead of each item
// painting its own background, so switching reads as one continuous motion.
// The glider is measured (offsetLeft/Width), re-measured on resize, and skips
// its transition on first paint so pages don't animate on load.
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

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
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const glider = gliderRef.current
    if (!wrap || !glider) return
    const move = () => {
      const el = wrap.querySelector<HTMLElement>(`[data-pill-key="${CSS.escape(activeKey)}"]`)
      if (!el) { glider.style.opacity = '0'; return }
      glider.style.opacity = '1'
      glider.style.left = `${el.offsetLeft}px`
      glider.style.width = `${el.offsetWidth}px`
    }
    move()
    // First measurement positions the glider without a transition; from then
    // on it glides (the global reduced-motion guard freezes it there too).
    const raf = requestAnimationFrame(() => setReady(true))
    window.addEventListener('resize', move)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', move) }
  }, [activeKey, children])

  return (
    <div ref={wrapRef} className={`pill-nav ${className ?? ''}`} role={role} aria-label={ariaLabel}>
      <span ref={gliderRef} className="pill-glider" aria-hidden style={ready ? undefined : { transition: 'none' }} />
      {children}
    </div>
  )
}
