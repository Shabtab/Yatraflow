// Pure-logic tests for the Landing overflow probe. Node env, no DOM — the
// classification is a pure function over element boxes and a window width, so
// the fixtures below are the whole surface. What matters is that the function
// sorts a real overflow from decoration that a within-window ancestor clips.
// A probe that calls decoration a defect teaches the team to ignore it, and a
// probe that calls a defect decoration lets the bug ship.
import { describe, it, expect } from 'vitest'
import { classifyCrossings, hasRealPageOverflow, CLIPPING } from '../scripts/landing-overflow-probe.mjs'

// One element box, in the shape the page collector returns.
const box = (id: string, right: number, position = 'static') => ({ id, right, position })

// One ancestor box. `cb` says where a containing-block chain starts, and
// `root` marks the root element, whose clip is a global guard.
const anc = (id: string, right: number, overflowX: string, cb = 'none', root = false) =>
  ({ id, right, overflowX, cb, root })

// A wide element with no ancestors at all.
const orphan = (id: string, right: number, position = 'static') => ({ ...box(id, right, position), ancestors: [] })

describe('classifyCrossings', () => {
  it('is silent on an element that stays inside the window', () => {
    const r = classifyCrossings([box('div.hero-copy', 390)], 390)
    expect(r).toEqual({ real: [], clipped: [] })
  })

  it('calls a wide element with no clipping ancestor a real overflow', () => {
    const r = classifyCrossings([orphan('span.hero-blob-b', 495)], 390)
    expect(r.real).toHaveLength(1)
    expect(r.real[0]).toMatchObject({ id: 'span.hero-blob-b', past: 105 })
    expect(r.real[0].reason).toContain('no ancestor clips it')
    expect(r.clipped).toEqual([])
  })

  it('calls a wide element that a within-window ancestor clips decoration', () => {
    const el = {
      ...box('span.hero-blob-b', 495, 'absolute'),
      ancestors: [anc('section.hero', 390, 'clip', 'positioned')],
    }
    const r = classifyCrossings([el], 390)
    expect(r.real).toEqual([])
    expect(r.clipped).toHaveLength(1)
    expect(r.clipped[0]).toMatchObject({ id: 'span.hero-blob-b', clipper: 'section.hero' })
  })

  it('calls a wide element whose clipping ancestor is itself past the window a real overflow', () => {
    const el = {
      ...box('div.ticker-track', 900, 'static'),
      ancestors: [anc('div.band', 700, 'hidden', 'block')],
    }
    const r = classifyCrossings([el], 390)
    expect(r.clipped).toEqual([])
    expect(r.real).toHaveLength(1)
    expect(r.real[0].reason).toContain('div.band')
    expect(r.real[0].reason).toContain('700px')
  })

  it('calls an element that only the root clip holds a real overflow', () => {
    // The root rule is a global guard. It hides a document that is wider than
    // the window, so an element that only the root holds is a defect, not
    // decoration. This is the shape of issue #670 before the section clips.
    const el = {
      ...box('span.hero-blob-b', 495, 'absolute'),
      ancestors: [
        anc('section.hero', 390, 'visible', 'positioned'),
        anc('html', 390, 'clip', 'block', true),
      ],
    }
    const r = classifyCrossings([el], 390)
    expect(r.clipped).toEqual([])
    expect(r.real).toHaveLength(1)
    expect(r.real[0].reason).toContain('root clip')
  })

  it('still calls decoration decoration when a section, and not the root, holds it', () => {
    const el = {
      ...box('span.hero-blob-b', 495, 'absolute'),
      ancestors: [
        anc('section.hero', 390, 'clip', 'positioned'),
        anc('html', 390, 'clip', 'block', true),
      ],
    }
    expect(classifyCrossings([el], 390).clipped).toHaveLength(1)
  })

  it('treats every clipping overflow value as a clip', () => {
    for (const overflowX of ['hidden', 'clip', 'auto', 'scroll']) {
      const el = {
        ...box('span.blob', 500, 'absolute'),
        ancestors: [anc('section.hero', 390, overflowX, 'positioned')],
      }
      expect(classifyCrossings([el], 390).clipped).toHaveLength(1)
    }
    expect([...CLIPPING].sort()).toEqual(['auto', 'clip', 'hidden', 'scroll'])
  })

  it('treats overflow-x visible as no clip', () => {
    const el = {
      ...box('span.blob', 500, 'absolute'),
      ancestors: [anc('section.hero', 390, 'visible', 'positioned')],
    }
    expect(classifyCrossings([el], 390).real).toHaveLength(1)
  })

  it('ignores a box that crosses by less than the tolerance', () => {
    const r = classifyCrossings([orphan('div.edge', 390.5)], 390)
    expect(r).toEqual({ real: [], clipped: [] })
  })

  it('counts a box that crosses by more than the tolerance', () => {
    const r = classifyCrossings([orphan('div.edge', 392)], 390)
    expect(r.real).toHaveLength(1)
  })

  it('returns two empty lists for an empty page', () => {
    expect(classifyCrossings([], 390)).toEqual({ real: [], clipped: [] })
  })

  it('sorts each crossing once, and keeps both lists apart', () => {
    const inside = { ...box('span.blob', 400, 'absolute'), ancestors: [anc('section.hero', 390, 'clip', 'positioned')] }
    const outside = orphan('div.wide', 600)
    const r = classifyCrossings([inside, outside, box('p.hero-sub', 380)], 390)
    expect(r.clipped.map((c) => c.id)).toEqual(['span.blob'])
    expect(r.real.map((c) => c.id)).toEqual(['div.wide'])
  })
})

describe('the containing-block chain', () => {
  it('lets a plain block ancestor clip a box in normal flow', () => {
    const el = {
      ...box('div.wide', 500, 'static'),
      ancestors: [anc('div.band', 390, 'hidden', 'block')],
    }
    expect(classifyCrossings([el], 390).clipped).toHaveLength(1)
  })

  it('does not let an unpositioned block ancestor clip an absolute box', () => {
    const el = {
      ...box('span.blob', 500, 'absolute'),
      ancestors: [
        anc('div.plain', 390, 'hidden', 'block'),
        anc('section.hero', 390, 'visible', 'positioned'),
      ],
    }
    expect(classifyCrossings([el], 390).real).toHaveLength(1)
  })

  it('lets a positioned ancestor clip an absolute box', () => {
    const el = {
      ...box('span.blob', 500, 'absolute'),
      ancestors: [
        anc('div.plain', 390, 'visible', 'block'),
        anc('section.hero', 390, 'clip', 'positioned'),
      ],
    }
    expect(classifyCrossings([el], 390).clipped).toHaveLength(1)
  })

  it('does not let an overflow ancestor clip a fixed box that it does not position', () => {
    const el = {
      ...box('div.pill', 500, 'fixed'),
      ancestors: [anc('div.band', 390, 'hidden', 'positioned')],
    }
    expect(classifyCrossings([el], 390).real).toHaveLength(1)
  })

  it('lets a transform ancestor clip a fixed box', () => {
    const el = {
      ...box('div.pill', 500, 'fixed'),
      ancestors: [anc('div.band', 390, 'hidden', 'transform')],
    }
    expect(classifyCrossings([el], 390).clipped).toHaveLength(1)
  })

  it('skips an inline ancestor, which is not a containing block', () => {
    const el = {
      ...box('span.blob', 500, 'absolute'),
      ancestors: [
        anc('span.label', 390, 'hidden', 'none'),
        anc('section.hero', 390, 'clip', 'positioned'),
      ],
    }
    expect(classifyCrossings([el], 390).clipped).toHaveLength(1)
  })
})

describe('the shapes the Landing page uses at HEAD', () => {
  // Three decorations paint past the right edge on purpose. Each one is held
  // by the section that carries it, and each of those sections is no wider
  // than the window. This is the pin for the state that issue #670 reported.
  const heroBlob = {
    ...box('span.hero-blob.hero-blob-b', 495, 'absolute'),
    ancestors: [anc('section.hero', 390, 'clip', 'positioned')],
  }
  const tickerTrack = {
    ...box('div.ticker-track', 5727.75, 'static'),
    ancestors: [anc('div.dest-ticker', 390, 'hidden', 'positioned')],
  }
  const benchBlob = {
    ...box('div.bench-blob.bench-blob-b', 525, 'absolute'),
    ancestors: [anc('section.container.plan-bench', 390, 'clip', 'positioned')],
  }

  it('holds every decoration inside its own section', () => {
    const r = classifyCrossings([heroBlob, tickerTrack, benchBlob], 390)
    expect(r.real).toEqual([])
    expect(r.clipped).toHaveLength(3)
  })

  it('stays clean at every measured width', () => {
    for (const width of [320, 360, 375, 390, 414]) {
      const scaled = [heroBlob, tickerTrack, benchBlob].map((el) => ({
        ...el,
        right: el.right - (390 - width),
        ancestors: el.ancestors.map((a) => ({ ...a, right: width })),
      }))
      expect(classifyCrossings(scaled, width).real).toEqual([])
    }
  })

  it('reports the same blob as a real overflow once the section clip is gone', () => {
    // The state before a64c5f6c: the section held no clip, so the blob pushed
    // the document wider than the window and the page scrolled sideways.
    const before = {
      ...heroBlob,
      ancestors: [anc('section.hero', 390, 'visible', 'positioned')],
    }
    const r = classifyCrossings([before], 390)
    expect(r.real).toHaveLength(1)
    expect(r.real[0].id).toBe('span.hero-blob.hero-blob-b')
  })
})

describe('the state before the section clips landed', () => {
  // Measured numbers from a build with `.hero, .plan-bench { overflow-x: clip }`
  // removed, at a 390px window. Both blobs then fall through to the root clip,
  // and the ticker stays held by its own band. The page signal reports a scroll
  // width of 586px, which is the number the first report on issue #670 gave.
  const heroBlob = {
    ...box('span.hero-blob.hero-blob-b', 495, 'absolute'),
    ancestors: [
      anc('section.hero', 390, 'visible', 'positioned'),
      anc('html', 390, 'clip', 'block', true),
    ],
  }
  const benchBlob = {
    ...box('div.bench-blob.bench-blob-b', 525, 'absolute'),
    ancestors: [
      anc('section.container.plan-bench', 390, 'visible', 'positioned'),
      anc('html', 390, 'clip', 'block', true),
    ],
  }
  const tickerTrack = {
    ...box('div.ticker-track', 5727.75, 'static'),
    ancestors: [anc('div.dest-ticker', 390, 'hidden', 'positioned')],
  }

  it('reports both atmosphere blobs as real overflows, and the ticker as decoration', () => {
    const r = classifyCrossings([heroBlob, benchBlob, tickerTrack], 390)
    expect(r.real.map((c) => c.id)).toEqual(['span.hero-blob.hero-blob-b', 'div.bench-blob.bench-blob-b'])
    expect(r.clipped.map((c) => c.id)).toEqual(['div.ticker-track'])
  })

  it('agrees with the page signal, which reports a scroll width of 586px', () => {
    expect(hasRealPageOverflow(586, 390)).toBe(true)
  })
})

describe('hasRealPageOverflow', () => {
  it('is false when the page is no wider than the window', () => {
    expect(hasRealPageOverflow(375, 390)).toBe(false)
    expect(hasRealPageOverflow(390, 390)).toBe(false)
  })

  it('is true when the page is wider than the window', () => {
    expect(hasRealPageOverflow(586, 375)).toBe(true)
  })

  it('ignores a difference inside the tolerance', () => {
    expect(hasRealPageOverflow(390.5, 390)).toBe(false)
    expect(hasRealPageOverflow(392, 390)).toBe(true)
  })
})
