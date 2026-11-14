// Pure rules to frame a route. The camera must keep marks clear of the panels,
// the journey bar and the attribution. Nothing here reads the DOM or the map.

export interface FrameRect { left: number; top: number; right: number; bottom: number }
export interface FrameInsets { top: number; bottom: number; left: number; right: number }

/** Room a mark needs beyond its coordinate: the pin body draws upward, the
 *  badge hangs below, and the pills need side room. */
export const MARK_FRAME_MARGIN: FrameInsets = { top: 40, bottom: 46, left: 48, right: 48 }

const ZERO: FrameInsets = { top: 0, bottom: 0, left: 0, right: 0 }

/**
 * How far each edge of the canvas is covered by overlays. A tall overlay on the left or
 * right half covers that side. A wide overlay covers the top or the bottom. A small corner
 * control covers nothing, because a mark under it is still reachable around it.
 */
export function coverInsets(canvas: FrameRect, covers: FrameRect[]): FrameInsets {
  const width = canvas.right - canvas.left
  const height = canvas.bottom - canvas.top
  const out = { ...ZERO }
  if (width <= 0 || height <= 0) return out
  for (const cover of covers) {
    const left = Math.max(cover.left, canvas.left)
    const right = Math.min(cover.right, canvas.right)
    const top = Math.max(cover.top, canvas.top)
    const bottom = Math.min(cover.bottom, canvas.bottom)
    if (right <= left || bottom <= top) continue
    const widthShare = (right - left) / width
    const heightShare = (bottom - top) / height
    const centreX = (left + right) / 2 - canvas.left
    const centreY = (top + bottom) / 2 - canvas.top
    if (heightShare >= 0.6 && widthShare < 0.6) {
      if (centreX < width / 2) out.left = Math.max(out.left, right - canvas.left)
      else out.right = Math.max(out.right, canvas.right - left)
    } else if (widthShare >= 0.3) {
      if (centreY < height / 2) out.top = Math.max(out.top, bottom - canvas.top)
      else out.bottom = Math.max(out.bottom, canvas.bottom - top)
    }
  }
  return out
}

/** The larger of the stored insets and the measured covers, per edge. */
export function mergeInsets(base: FrameInsets, measured: FrameInsets): FrameInsets {
  return {
    top: Math.max(base.top, measured.top),
    bottom: Math.max(base.bottom, measured.bottom),
    left: Math.max(base.left, measured.left),
    right: Math.max(base.right, measured.right),
  }
}

export function addInsets(a: FrameInsets, b: FrameInsets): FrameInsets {
  return { top: a.top + b.top, bottom: a.bottom + b.bottom, left: a.left + b.left, right: a.right + b.right }
}

/** Keep the open canvas at least `minOpen` wide and high. Shrink all edges by one shared ratio. */
export function clampInsets(size: { width: number; height: number }, insets: FrameInsets, minOpen: number | { width: number; height: number } = 120): FrameInsets {
  const minWidth = typeof minOpen === 'number' ? minOpen : minOpen.width
  const minHeight = typeof minOpen === 'number' ? minOpen : minOpen.height
  const horizontal = Math.min(1, Math.max(0, size.width - minWidth) / Math.max(1, insets.left + insets.right))
  const vertical = Math.min(1, Math.max(0, size.height - minHeight) / Math.max(1, insets.top + insets.bottom))
  return {
    top: Math.floor(insets.top * vertical),
    bottom: Math.floor(insets.bottom * vertical),
    left: Math.floor(insets.left * horizontal),
    right: Math.floor(insets.right * horizontal),
  }
}

/** The padding the first route fit uses: the measured insets plus the room the marks need, once. */
export function firstFitPadding(size: { width: number; height: number }, insets: FrameInsets): FrameInsets {
  return clampInsets(size, addInsets(insets, MARK_FRAME_MARGIN))
}

/** Keep the first open area when a settle pass grows the padding. */
export function settlePadding(size: { width: number; height: number }, insets: FrameInsets, extra: FrameInsets): FrameInsets {
  const base = firstFitPadding(size, insets)
  const minOpen = {
    width: Math.max(0, size.width - base.left - base.right),
    height: Math.max(0, size.height - base.top - base.bottom),
  }
  return clampInsets(size, addInsets(base, extra), minOpen)
}

/**
 * One settle pass. Boxes use the covered rect, not the mark margin.
 * The first fit margin already leaves room for a stop badge.
 */
export function settleStep(size: { width: number; height: number }, insets: FrameInsets, extra: FrameInsets, boxes: FrameBox[]): FrameInsets | null {
  const overflow = frameOverflow(boxes, safeRect(size, insets))
  if (!hasOverflow(overflow)) return null
  return addInsets(extra, overflow)
}

/** The open rectangle in canvas pixels, after the insets. */
export function safeRect(size: { width: number; height: number }, insets: FrameInsets): FrameRect {
  return { left: insets.left, top: insets.top, right: size.width - insets.right, bottom: size.height - insets.bottom }
}

/** The open canvas area in square pixels. */
export function openArea(size: { width: number; height: number }, insets: FrameInsets): number {
  const open = safeRect(size, insets)
  return Math.max(0, open.right - open.left) * Math.max(0, open.bottom - open.top)
}

export interface FrameBox { x: number; y: number; w: number; h: number }

/**
 * How many pixels each edge must grow so every box (centred on x and y) fits in `safe`.
 * Zero on an edge means that edge already holds all the boxes.
 */
export function frameOverflow(boxes: FrameBox[], safe: FrameRect): FrameInsets {
  const out = { ...ZERO }
  for (const box of boxes) {
    out.left = Math.max(out.left, Math.ceil(safe.left - (box.x - box.w / 2)))
    out.right = Math.max(out.right, Math.ceil(box.x + box.w / 2 - safe.right))
    out.top = Math.max(out.top, Math.ceil(safe.top - (box.y - box.h / 2)))
    out.bottom = Math.max(out.bottom, Math.ceil(box.y + box.h / 2 - safe.bottom))
  }
  return out
}

export function hasOverflow(overflow: FrameInsets): boolean {
  return overflow.top > 0 || overflow.bottom > 0 || overflow.left > 0 || overflow.right > 0
}
