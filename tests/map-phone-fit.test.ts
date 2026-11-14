// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  MARK_FRAME_MARGIN,
  clampInsets,
  firstFitPadding,
  openArea,
  safeRect,
  settlePadding,
  settleStep,
  type FrameInsets,
} from '../src/lib/mapStyles/cameraFrame'
import { layoutMarks } from '../src/lib/mapStyles/placeMarks'

const PHONE_SIZE = { width: 388, height: 898 }
const PHONE_INSETS: FrameInsets = { top: 91, bottom: 148, left: 0, right: 0 }
const ZERO: FrameInsets = { top: 0, bottom: 0, left: 0, right: 0 }

// The 390px phone canvas keeps 292px open after the mark margin.
describe('phone route fit insets', () => {
  it('keeps the 390px canvas clear', () => {
    const padding = firstFitPadding(PHONE_SIZE, PHONE_INSETS)
    expect(PHONE_SIZE.width - padding.left - padding.right).toBe(292)
    expect(PHONE_SIZE.height - padding.top - padding.bottom).toBe(573)
    expect(padding.left).toBe(MARK_FRAME_MARGIN.left)
    expect(padding.right).toBe(MARK_FRAME_MARGIN.right)
  })

  it('counts each side inset once', () => {
    const oldFloors: FrameInsets = { top: 90, bottom: 148, left: 24, right: 70 }
    const old = firstFitPadding(PHONE_SIZE, oldFloors)
    const measured = firstFitPadding(PHONE_SIZE, PHONE_INSETS)
    expect(old.left).toBe(24 + MARK_FRAME_MARGIN.left)
    expect(old.right).toBe(70 + MARK_FRAME_MARGIN.right)
    expect(measured.left).toBe(MARK_FRAME_MARGIN.left)
    expect(measured.right).toBe(MARK_FRAME_MARGIN.right)
    expect(openArea(PHONE_SIZE, measured)).toBeGreaterThan(openArea(PHONE_SIZE, old))
  })

  it('hides pills outside the fit bounds', () => {
    const base = firstFitPadding(PHONE_SIZE, PHONE_INSETS)
    const safe = safeRect(PHONE_SIZE, base)
    const marks = [
      { id: 'stop:1', layer: 'stop' as const, x: 300, y: 400, w: 44, h: 44 },
      { id: 'route:tick', layer: 'clock' as const, x: 420, y: 400, w: 132, h: 62, maxTravel: 0 },
    ]
    const unbounded = layoutMarks(marks)
    expect(unbounded.get('route:tick')?.hidden).toBe(false)
    const bounded = layoutMarks(marks, { bounds: safe })
    expect(bounded.get('route:tick')?.hidden).toBe(true)
    const boxes = marks.filter(m => m.layer === 'stop').map(m => {
      const spot = bounded.get(m.id)!
      return { x: m.x + spot.dx, y: m.y + spot.dy, w: m.w, h: m.h }
    })
    expect(settleStep(PHONE_SIZE, PHONE_INSETS, ZERO, boxes)).toBeNull()
  })

  it('keeps the first open area on repeated settle passes', () => {
    const base = firstFitPadding(PHONE_SIZE, PHONE_INSETS)
    const firstArea = openArea(PHONE_SIZE, base)
    const covered = safeRect(PHONE_SIZE, PHONE_INSETS)
    const boxes = [
      { x: covered.left - 20, y: 400, w: 20, h: 20 },
      { x: covered.right + 20, y: 400, w: 20, h: 20 },
      { x: 194, y: covered.top - 20, w: 20, h: 20 },
      { x: 194, y: covered.bottom + 20, w: 20, h: 20 },
    ]
    let extra: FrameInsets = { ...ZERO }
    for (let pass = 0; pass < 5; pass += 1) {
      const grown = settleStep(PHONE_SIZE, PHONE_INSETS, extra, boxes)
      expect(grown).not.toBeNull()
      if (!grown) break
      const padding = settlePadding(PHONE_SIZE, PHONE_INSETS, grown)
      expect(openArea(PHONE_SIZE, padding)).toBeGreaterThanOrEqual(firstArea)
      expect(padding.left + padding.right).toBeLessThanOrEqual(base.left + base.right)
      expect(padding.top + padding.bottom).toBeLessThanOrEqual(base.top + base.bottom)
      extra = grown
    }
  })

  it('grows padding once for a stop in the top strip', () => {
    const stop = { x: 194, y: 40, w: 44, h: 44 }
    const grown = settleStep(PHONE_SIZE, PHONE_INSETS, ZERO, [stop])
    expect(grown).not.toBeNull()
    expect(grown!.top).toBeGreaterThan(0)
    const moved = { ...stop, y: stop.y + grown!.top }
    expect(settleStep(PHONE_SIZE, PHONE_INSETS, grown!, [moved])).toBeNull()
  })

  it('keeps a 120px open floor on a tiny canvas', () => {
    const out = clampInsets({ width: 200, height: 400 }, { top: 90, bottom: 148, left: 24, right: 70 })
    expect(200 - out.left - out.right).toBeGreaterThanOrEqual(120)
    expect(400 - out.top - out.bottom).toBeGreaterThanOrEqual(120)
  })
})
