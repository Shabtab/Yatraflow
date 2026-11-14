import { scrollBehavior } from './motion'

/** Keep section selection in step with links, deep links and history. */
export function watchSectionHash(
  sectionIds: readonly string[],
  select: (id: string | null) => void,
): () => void {
  const update = () => {
    const id = sectionIds.find(candidate => `#${candidate}` === location.hash)
    select(id ?? null)
  }
  window.addEventListener('hashchange', update)
  update()
  const controller = new AbortController()
  let cancelled = false
  const cancel = () => { cancelled = true }
  const initialId = sectionIds.find(id => `#${id}` === location.hash)
  const initialTarget = initialId ? document.getElementById(initialId) : null
  if (initialTarget && window.scrollY === 0) {
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
      window.addEventListener(type, cancel, { passive: true, signal: controller.signal })
    }
    // The browser can read a fragment before React mounts its target.
    // Wait for the section entrance so its final position sets the offset.
    void Promise.allSettled(initialTarget.getAnimations().map(animation => animation.finished)).then(() => {
      if (!cancelled && window.scrollY === 0 && location.hash === `#${initialId}`) {
        initialTarget.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
      }
    })
  }
  return () => {
    cancel()
    controller.abort()
    window.removeEventListener('hashchange', update)
  }
}
