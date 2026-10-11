// Guards the committed illustration files in src/assets/art/ against the
// manifest: names, presence, size caps and the header dimensions.
// Reads the disk. Header parsing is local, so no image library is needed.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ArtManifest } from '../src/lib/regionArt'

const ART_DIR = fileURLToPath(new URL('../src/assets/art/', import.meta.url))
const manifest = JSON.parse(readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8')) as ArtManifest
const FILE_PATTERN = /^[a-z0-9-]+-\d+\.(avif|webp)$/
const DIMENSION_TOLERANCE_PX = 2

interface Expected {
  id: string
  format: 'avif' | 'webp'
  width: number
  ratio: string
  name: string
  capBytes: number
}

function expectedFiles(): Expected[] {
  const files: Expected[] = []
  for (const [id, entry] of Object.entries(manifest.ids)) {
    for (const width of entry.widths) {
      const cap = manifest.budget.avifKiB[String(width)]
      files.push({ id, format: 'avif', width, ratio: entry.ratio, name: `${id}-${width}.avif`, capBytes: (cap ?? 0) * 1024 })
    }
    files.push({ id, format: 'webp', width: entry.webp, ratio: entry.ratio, name: `${id}-${entry.webp}.webp`, capBytes: manifest.budget.webpKiB * 1024 })
  }
  return files
}

/** Width and height from the AVIF `ispe` box (image spatial extents). */
function avifDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return null
  const index = buffer.indexOf('ispe', 0, 'ascii')
  if (index < 0) return null
  return { width: buffer.readUInt32BE(index + 8), height: buffer.readUInt32BE(index + 12) }
}

/** Width and height from a WebP RIFF header (VP8X, VP8 or VP8L). */
function webpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 }
  if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  if (chunk === 'VP8L') {
    const packed = buffer.readUInt32LE(21)
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
  }
  return null
}

function readFileBuffer(name: string): Buffer {
  return readFileSync(path.join(ART_DIR, name))
}

describe('art manifest', () => {
  it('declares a file for every width and a WebP fallback for every id', () => {
    for (const expected of expectedFiles()) {
      expect(existsSync(path.join(ART_DIR, expected.name)), `missing ${expected.name}`).toBe(true)
    }
  })

  it('uses the declared WebP width, which is one of the AVIF widths', () => {
    for (const [id, entry] of Object.entries(manifest.ids)) {
      expect(entry.widths, `${id} webp width`).toContain(entry.webp)
    }
  })

  it('has no orphan file in the art folder', () => {
    const declared = new Set(expectedFiles().map(file => file.name))
    const orphans = readdirSync(ART_DIR).filter(name => name !== 'manifest.json' && !declared.has(name))
    expect(orphans).toEqual([])
  })

  it('names every image file <id>-<width>.<avif|webp>', () => {
    for (const name of readdirSync(ART_DIR)) {
      if (name === 'manifest.json') continue
      expect(name, `bad name ${name}`).toMatch(FILE_PATTERN)
    }
  })
})

describe('art size budget', () => {
  it('keeps each file under its per-width cap', () => {
    for (const expected of expectedFiles()) {
      const size = statSync(path.join(ART_DIR, expected.name)).size
      expect(size, `${expected.name} is ${size} bytes, cap ${expected.capBytes}`).toBeLessThanOrEqual(expected.capBytes)
    }
  })

  it('keeps the whole illustration set under the total budget', () => {
    const total = readdirSync(ART_DIR)
      .filter(name => name !== 'manifest.json')
      .reduce((sum, name) => sum + statSync(path.join(ART_DIR, name)).size, 0)
    expect(total).toBeLessThan(manifest.budget.totalMiB * 1024 * 1024)
  })
})

describe('art file headers', () => {
  it('has AVIF files whose ispe width matches the file name and whose height matches the ratio', () => {
    for (const expected of expectedFiles().filter(file => file.format === 'avif')) {
      const dimensions = avifDimensions(readFileBuffer(expected.name))
      expect(dimensions, `${expected.name} has no AVIF header`).not.toBeNull()
      if (!dimensions) continue
      expect(Math.abs(dimensions.width - expected.width), `${expected.name} width ${dimensions.width}`).toBeLessThanOrEqual(DIMENSION_TOLERANCE_PX)
      const [ratioWidth, ratioHeight] = expected.ratio.split(':').map(Number)
      const wantHeight = (expected.width * ratioHeight) / ratioWidth
      expect(Math.abs(dimensions.height - wantHeight), `${expected.name} height ${dimensions.height}`).toBeLessThanOrEqual(DIMENSION_TOLERANCE_PX)
    }
  })

  it('has WebP files whose width matches the file name', () => {
    for (const expected of expectedFiles().filter(file => file.format === 'webp')) {
      const dimensions = webpDimensions(readFileBuffer(expected.name))
      expect(dimensions, `${expected.name} has no WebP header`).not.toBeNull()
      if (!dimensions) continue
      expect(Math.abs(dimensions.width - expected.width), `${expected.name} width ${dimensions.width}`).toBeLessThanOrEqual(DIMENSION_TOLERANCE_PX)
    }
  })
})
