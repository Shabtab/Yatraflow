// Mascot placement invariants (docs/MASCOT-PLAN.md §5).
// A pose that names a missing file is a broken image on a state screen, and a
// placement file with live text is a glyph in a fallback font. Both fail here,
// without a browser.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { MASCOT_FILES, mascotFile, type MascotPose } from '../src/lib/mascot'

const root = new URL('../public/brand/mascot/', import.meta.url)
const poses = Object.keys(MASCOT_FILES) as MascotPose[]
const read = (file: string) => readFileSync(new URL(file, root), 'utf8')

/** Every file a pose can resolve to: still, animated and night. */
const poseFiles = (pose: MascotPose): string[] =>
  Object.values(MASCOT_FILES[pose]).filter((f): f is string => !!f)

describe('mascot pose files', () => {
  it('names at least one file for every pose', () => {
    for (const pose of poses) expect(poseFiles(pose).length, pose).toBeGreaterThan(0)
  })

  it('maps every pose name to a file in public/brand/mascot', () => {
    for (const pose of poses) {
      for (const file of poseFiles(pose)) {
        expect(() => read(file), `${pose} -> ${file}`).not.toThrow()
      }
    }
  })

  it('ships no placement file with live text (an <img> cannot load the page font)', () => {
    const used = new Set(poses.flatMap(poseFiles))
    for (const file of used) expect(read(file), file).not.toContain('<text')
  })

  it('covers every still and animated SVG on disk', () => {
    const onDisk = [
      ...readdirSync(root).filter(f => f.startsWith('chakra-') && f.endsWith('.svg')),
      ...readdirSync(new URL('animated/', root)).map(f => `animated/${f}`),
    ]
    // The expression sheet and the night hero are concept art, not poses:
    // the sheet draws all twelve heads at once, and the night hero is hero's
    // dark variant, so neither is a pose of its own.
    const notPoses = new Set(['chakra-expressions.svg', 'chakra-night-hero.svg'])
    const used = new Set(poses.flatMap(poseFiles))
    const orphans = onDisk.filter(f => !notPoses.has(f) && !used.has(f))
    expect(orphans).toEqual([])
  })
})

describe('mascotFile', () => {
  it('takes the night file in a dark theme', () => {
    expect(mascotFile('hero', { dark: true })).toBe('brand/mascot/chakra-night-hero.svg')
    expect(mascotFile('hero', { dark: false })).toBe('brand/mascot/chakra-hero.svg')
  })

  it('takes the animated file only when asked, and always for a loop-only pose', () => {
    expect(mascotFile('sleep')).toBe('brand/mascot/chakra-sleep.svg')
    expect(mascotFile('sleep', { animated: true })).toBe('brand/mascot/animated/chakra-sleep.svg')
    expect(mascotFile('loading')).toBe('brand/mascot/animated/chakra-loading.svg')
    expect(mascotFile('loading', { animated: false })).toBe('brand/mascot/animated/chakra-loading.svg')
  })

  it('keeps every resolved path inside public/brand/mascot', () => {
    for (const pose of poses) {
      for (const dark of [false, true]) {
        for (const animated of [false, true]) {
          const file = mascotFile(pose, { dark, animated })
          expect(file.startsWith('brand/mascot/'), `${pose} ${file}`).toBe(true)
          expect(file.includes('..')).toBe(false)
        }
      }
    }
  })
})
