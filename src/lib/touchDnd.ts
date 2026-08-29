// ============ Touch long-press drag engine ============
// The timeline reorder uses the HTML5 drag-and-drop API, which is desktop-only
// — touch devices never fire dragstart. This module adds pointer-based
// long-press dragging: press & hold a row (~350ms, <12px movement) to lift it,
// then drag; drop targets are found via `data-yf-drop` / `data-yf-gap`
// attributes (rendered by useReorder), so SAME-LIST reorder and CROSS-LIST
// (day-to-day) moves work with the exact semantics of the desktop flow.
//
// React-free singleton by design: the engine lives across renders and routes
// events to whichever list instance is under the finger; React integrates via
// the instance callbacks registered by useReorder.

export const LONG_PRESS_MS = 350
export const MOVE_CANCEL_PX = 12
/** viewport edge zones that auto-scroll while dragging */
export const EDGE_ZONE_PX = 90
export const EDGE_SCROLL_SPEED = 14

/** Stable drop-target key rendered into the DOM: "<instanceId>:<index>". */
export function encodeDropKey(instanceId: string, index: number): string {
  return `${instanceId}:${index}`
}

export function parseDropKey(key: string | null | undefined): { instanceId: string; index: number } | null {
  if (!key) return null
  const i = key.lastIndexOf(':')
  if (i <= 0) return null
  const index = Number(key.slice(i + 1))
  if (!Number.isFinite(index) || index < 0) return null
  return { instanceId: key.slice(0, i), index }
}

/** A long press activates only when held long enough AND held still. */
export function longPressActivated(elapsedMs: number, movedPx: number): boolean {
  return elapsedMs >= LONG_PRESS_MS && movedPx <= MOVE_CANCEL_PX
}

export function movedPx(startX: number, startY: number, x: number, y: number): number {
  return Math.hypot(x - startX, y - startY)
}

/** Scroll speed near viewport edges while dragging (0 when away from edges). */
export function edgeScrollDelta(y: number, viewportH: number, zone = EDGE_ZONE_PX, speed = EDGE_SCROLL_SPEED): number {
  if (y < zone) return -Math.round(speed * (1 - y / zone))
  const fromBottom = viewportH - y
  if (fromBottom < zone) return Math.round(speed * (1 - fromBottom / zone))
  return 0
}

/** Interactive elements a press-and-hold must never hijack. */
export function isInteractiveTarget(el: Element | null): boolean {
  return !!el?.closest?.('button, a, input, select, textarea, [contenteditable="true"], [data-no-touch-drag]')
}

type Instance = {
  /** the source row visually enters "dragging" state */
  onOwnDragStart(idx: number): void
  /** a row/gap in this list is (or is no longer, null) the hover target */
  onDragOver(idx: number | null, foreign: boolean): void
  onDropOnSelf(fromIdx: number, toIdx: number): void
  onForeignDrop(payload: string, toIdx: number): void
  onDragEnd(): void
}

const instances = new Map<string, Instance>()
export function registerTouchDnd(id: string, inst: Instance): () => void {
  instances.set(id, inst)
  return () => { if (instances.get(id) === inst) instances.delete(id) }
}

type Active = {
  srcId: string
  srcIdx: number
  payload: string
  target: { id: string; index: number } | null
  lastX: number
  lastY: number
  raf: number
}

type Pending = {
  srcId: string
  srcIdx: number
  payload: string
  element: HTMLElement
  startX: number
  startY: number
  timer: number
}

let active: Active | null = null
let pending: Pending | null = null
let bound = false

function cleanupBinding() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onCancel)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('contextmenu', onContextMenu, true)
  bound = false
}

function clearPress() {
  if (pending?.timer) window.clearTimeout(pending.timer)
  pending?.element.classList.remove('yf-pressing')
  pending = null
}

function onTouchMove(e: TouchEvent) {
  // Only while a drag is active — scrolling must keep working otherwise.
  if (active) e.preventDefault()
}

function onContextMenu(e: MouseEvent) {
  if (pending || active) e.preventDefault()
}

function hitTest(x: number, y: number) {
  if (!active) return
  const el = document.elementFromPoint(x, y)
  const dropEl = el?.closest('[data-yf-drop]')
  const gapEl = el?.closest('[data-yf-gap]')
  const parsed = parseDropKey(dropEl?.getAttribute('data-yf-drop') ?? gapEl?.getAttribute('data-yf-gap'))
  const next = parsed ? { id: parsed.instanceId, index: parsed.index } : null
  if (next && next.id === active.target?.id && next.index === active.target?.index) return
  if (active.target) instances.get(active.target.id)?.onDragOver(null, active.target.id !== active.srcId)
  active.target = next
  if (next) instances.get(next.id)?.onDragOver(next.index, next.id !== active.srcId)
}

function frame() {
  if (!active) return
  const delta = edgeScrollDelta(active.lastY, window.innerHeight)
  if (delta !== 0) {
    window.scrollBy(0, delta)
    active.lastY += delta
  }
  hitTest(active.lastX, active.lastY)
  active.raf = window.requestAnimationFrame(frame)
}

function activate() {
  if (!pending) return
  const { srcId, srcIdx, payload, element, startX, startY } = pending
  element.classList.remove('yf-pressing')
  active = { srcId, srcIdx, payload, target: null, lastX: startX, lastY: startY, raf: 0 }
  pending = null
  try { navigator.vibrate?.(20) } catch { /* haptics are best-effort */ }
  instances.get(srcId)?.onOwnDragStart(srcIdx)
  active.raf = window.requestAnimationFrame(frame)
  hitTest(active.lastX, active.lastY)
}

function finish(drop: boolean) {
  const cur = active
  if (!cur) { clearPress(); return }
  active = null
  window.cancelAnimationFrame(cur.raf)
  const srcInst = instances.get(cur.srcId)
  if (drop && cur.target) {
    if (cur.target.id === cur.srcId) {
      if (cur.target.index !== cur.srcIdx) srcInst?.onDropOnSelf(cur.srcIdx, cur.target.index)
    } else {
      instances.get(cur.target.id)?.onForeignDrop(cur.payload, cur.target.index)
    }
  }
  if (cur.target) instances.get(cur.target.id)?.onDragOver(null, cur.target.id !== cur.srcId)
  srcInst?.onDragEnd()
  // swallow the click that follows finger-lift so no button underneath fires
  window.addEventListener('click', e => { e.preventDefault(); e.stopPropagation() }, { capture: true, once: true })
  cleanupBinding()
}

function onMove(e: PointerEvent) {
  if (pending) {
    if (movedPx(pending.startX, pending.startY, e.clientX, e.clientY) > MOVE_CANCEL_PX) clearPress()
    return
  }
  if (!active) return
  active.lastX = e.clientX
  active.lastY = e.clientY
}

function onUp() {
  if (pending) { clearPress(); cleanupBinding(); return }
  if (active) finish(true)
}

function onCancel() {
  if (pending) { clearPress(); cleanupBinding(); return }
  if (active) finish(false)
}

/** Begin tracking a potential long-press on a row. Safe no-op while busy. */
export function touchPressStart(opts: {
  instanceId: string
  idx: number
  payload: string
  element: HTMLElement
  x: number
  y: number
}): void {
  if (pending || active) return
  clearPress()
  pending = {
    srcId: opts.instanceId,
    srcIdx: opts.idx,
    payload: opts.payload,
    element: opts.element,
    startX: opts.x,
    startY: opts.y,
    timer: 0,
  }
  opts.element.classList.add('yf-pressing')
  pending.timer = window.setTimeout(activate, LONG_PRESS_MS)
  if (!bound) {
    bound = true
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('contextmenu', onContextMenu, true)
  }
}

/** Force-end any press/drag (e.g. unmount of the owning list). */
export function touchPressAbort(): void {
  if (pending) { clearPress(); cleanupBinding(); return }
  if (active) finish(false)
}

