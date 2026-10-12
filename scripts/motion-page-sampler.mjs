export function samplePageMotion(windowMs) {
  window.__blocks = []
  let sampledRoot = null
  const start = performance.now()
  const read = () => {
    const root = document.querySelector('.route-panel > *')
    if (root) {
      // A lazy route replaces its loading screen. Measure the page that remains.
      if (root !== sampledRoot) {
        sampledRoot = root
        window.__blocks = []
      }
      const rows = []
      for (const el of root.children) {
        const box = el.getBoundingClientRect()
        if (box.height < 24) continue
        const cs = getComputedStyle(el)
        rows.push({
          cls: (typeof el.className === 'string' && el.className.trim()) || '(no class)',
          op: +(+cs.opacity).toFixed(3),
          tf: cs.transform === 'none' ? 'none' : cs.transform,
          vis: cs.visibility,
        })
      }
      window.__blocks.push({ t: Math.round(performance.now()), rows })
    }
    if (performance.now() - start < windowMs) requestAnimationFrame(read)
  }
  requestAnimationFrame(read)
}
