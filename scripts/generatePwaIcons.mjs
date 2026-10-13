#!/usr/bin/env node
// ============ PWA icon generator ============
// Draws icon-192.png, icon-512.png, icon-maskable-512.png and apple-touch-icon.png
// from the Ribbon Y mark. The art matches the
// construction in DESIGN.md → Brand mark, so the launcher icon cannot drift
// from the header mark:
//
//   fold: M15 6C15 26 32 24 32 40 in pale mist #BFE3DD, 11 units wide
//   road: M49 6C49 26 32 24 32 40V46 in white, 11 units wide, over the fold
//   dot : centre (32, 56) r=5.5 in saffron #F5A94A
//
// The tile is Planning Teal #0E7A72 on every file. Variants: 192/512 with
// round corners and clear corners ("any" launcher), a 512 maskable tile
// (square, art at 78% so it clears the centre-80% safe zone) and a square
// 180 apple-touch-icon (iOS cuts its own round corners).
//
// The path strings below are the same lines tests/brand-mark.test.ts pins,
// parsed here into raster math. Run it when the mark changes, then let
// tests/pwa.test.ts check each file size:
//
//   node scripts/generatePwaIcons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

// The Ribbon Y path data. tests/brand-mark.test.ts pins these same lines,
// so a redraw of the mark fails the build here first.
const FOLD_D = 'M15 6C15 26 32 24 32 40'
const ROAD_D = 'M49 6C49 26 32 24 32 40V46'
const DOT = { cx: 32, cy: 56, r: 5.5 }

const TILE = [0x0e, 0x7a, 0x72]
const FOLD_INK = [0xbf, 0xe3, 0xdd]
const ROAD_INK = [0xff, 0xff, 0xff]
const DOT_INK = [0xf5, 0xa9, 0x4a]
const HALF_WIDTH = 11 / 2
const SS = 3 // supersample factor per axis

// A move-curve record from one path string. Only the forms above occur:
// M x y, C x1 y1 x2 y2 x y, and a closing V y on the road tail.
function parseArms() {
  const nums = s => s.match(/-?\d+\.?\d*/g).map(Number)
  const fold = nums(FOLD_D)
  const road = nums(ROAD_D)
  return {
    fold: { p0: [fold[0], fold[1]], p1: [fold[2], fold[3]], p2: [fold[4], fold[5]], p3: [fold[6], fold[7]] },
    road: { p0: [road[0], road[1]], p1: [road[2], road[3]], p2: [road[4], road[5]], p3: [road[6], road[7]], tail: road[8] },
  }
}

function cubicAt(c, t) {
  const u = 1 - t
  return [
    u * u * u * c.p0[0] + 3 * u * u * t * c.p1[0] + 3 * u * t * t * c.p2[0] + t * t * t * c.p3[0],
    u * u * u * c.p0[1] + 3 * u * u * t * c.p1[1] + 3 * u * t * t * c.p2[1] + t * t * t * c.p3[1],
  ]
}

// One arm as short links. 64 links follow the bend within a small
// fraction of the stroke half width, so the joints stay smooth.
function armLinks(c, tailTo) {
  const N = 64
  const pts = []
  for (let i = 0; i <= N; i++) pts.push(cubicAt(c, i / N))
  if (tailTo != null) pts.push([pts[pts.length - 1][0], tailTo])
  const links = []
  for (let i = 0; i < pts.length - 1; i++) links.push([pts[i], pts[i + 1]])
  return links
}

const ARMS = parseArms()
const FOLD_LINKS = armLinks(ARMS.fold)
const ROAD_LINKS = armLinks(ARMS.road, ARMS.road.tail)
// A quick reject box per arm, grown by the half width.
function grownBox(links) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [[ax, ay], [bx, by]] of links) {
    x0 = Math.min(x0, ax, bx); y0 = Math.min(y0, ay, by)
    x1 = Math.max(x1, ax, bx); y1 = Math.max(y1, ay, by)
  }
  return [x0 - HALF_WIDTH, y0 - HALF_WIDTH, x1 + HALF_WIDTH, y1 + HALF_WIDTH]
}
const FOLD_BOX = grownBox(FOLD_LINKS)
const ROAD_BOX = grownBox(ROAD_LINKS)

function distToLinks(x, y, links) {
  let best = Infinity
  for (let i = 0; i < links.length; i++) {
    const [[ax, ay], [bx, by]] = links[i]
    const dx = bx - ax, dy = by - ay
    const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
    // Flat caps: past either open end is outside, not a round bulb.
    if (i === 0 && t < 0) continue
    if (i === links.length - 1 && t > 1) continue
    const c = Math.min(1, Math.max(0, t))
    const ex = x - (ax + c * dx), ey = y - (ay + c * dy)
    const d = ex * ex + ey * ey
    // Inside check only: one link within the half width decides it.
    if (d <= HALF_WIDTH * HALF_WIDTH) return 0
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

function inBox(x, y, box) {
  return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]
}

/** Ink at one art-space point. Draw order: dot, road, fold, tile. */
function sample(artX, artY, scale) {
  // The mark box (x 9.5–54.5, y 6–61.5) sits centred on the tile.
  const mx = (artX - 50) / scale + 32
  const my = (artY - 50) / scale + 33.75
  if ((mx - DOT.cx) ** 2 + (my - DOT.cy) ** 2 <= DOT.r * DOT.r) return DOT_INK
  // Flat caps: both arms start at y=6 with a vertical tangent, so all arm
  // ink sits at or below that line. The fold ends at y=40 and the road tail
  // ends at y=46, each with a vertical tangent too.
  if (my >= 6) {
    if (my <= 46 && inBox(mx, my, ROAD_BOX) && distToLinks(mx, my, ROAD_LINKS) <= HALF_WIDTH) return ROAD_INK
    if (my <= 40 && inBox(mx, my, FOLD_BOX) && distToLinks(mx, my, FOLD_LINKS) <= HALF_WIDTH) return FOLD_INK
  }
  return TILE
}

/** True inside a round-corner tile. Tile runs 0–100, r is the corner size. */
function inRoundTile(tx, ty, r) {
  const cx = Math.min(Math.max(tx, r), 100 - r)
  const cy = Math.min(Math.max(ty, r), 100 - r)
  return (tx - cx) ** 2 + (ty - cy) ** 2 <= r * r
}

function render(size, scale, radius) {
  const w = size * SS
  const rows = []
  for (let py = 0; py < w; py++) {
    const row = Buffer.alloc(w * 4)
    for (let px = 0; px < w; px++) {
      const tx = ((px + 0.5) / w) * 100, ty = ((py + 0.5) / w) * 100
      // Square tiles (radius 0) keep every pixel. Round tiles cut clear
      // corners, so alpha stays 0 outside the round shape.
      if (radius > 0 && !inRoundTile(tx, ty, radius)) continue
      const c = sample(tx, ty, scale)
      const o = px * 4
      row[o] = c[0]
      row[o + 1] = c[1]
      row[o + 2] = c[2]
      row[o + 3] = 0xff
    }
    rows.push(row)
  }
  const out = Buffer.alloc(size * (size * 4 + 1))
  const n = SS * SS
  for (let y = 0; y < size; y++) {
    let off = y * (size * 4 + 1)
    out[off++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < SS; dy++) {
        const row = rows[y * SS + dy]
        for (let dx = 0; dx < SS; dx++) {
          const o = (x * SS + dx) * 4
          r += row[o]
          g += row[o + 1]
          b += row[o + 2]
          a += row[o + 3]
        }
      }
      out[off++] = r / n
      out[off++] = g / n
      out[off++] = b / n
      out[off++] = a / n
    }
  }
  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(tag, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(tag), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function writePng(path, size, scale, radius) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(render(size, scale, radius), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
  console.log(`${path}  ${size}x${size}  ${png.length} bytes`)
}

mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true })
const out = name => new URL(`../public/icons/${name}`, import.meta.url)
const CORNER = 20.2 // round-corner size in tile units, read off the shipped art
writePng(out('icon-192.png'), 192, 1.0, CORNER)
writePng(out('icon-512.png'), 512, 1.0, CORNER)
writePng(out('icon-maskable-512.png'), 512, 0.78, 0)
writePng(out('apple-touch-icon.png'), 180, 0.99, 0)
