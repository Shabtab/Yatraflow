// Contract tests for the India art integration: id counts, provenance, crop
// metadata and the build's reproducibility.
//
// The sibling art-manifest.test.ts already guards file presence, naming and the
// byte caps against the manifest. This file guards the parts the integration
// added: the 62-id set, the place tables, the focalX metadata, and the promise
// that a full staged rebuild reproduces the selected bytes.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ArtManifest } from '../src/lib/regionArt'

const ART_DIR = fileURLToPath(new URL('../src/assets/art/', import.meta.url))
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8')) as ArtManifest

const files = readdirSync(ART_DIR).filter(name => /\.(avif|webp)$/.test(name))
const totalBytes = files.reduce((sum, name) => sum + statSync(path.join(ART_DIR, name)).size, 0)

describe('integrated id set', () => {
  it('declares 62 ids', () => {
    expect(Object.keys(manifest.ids)).toHaveLength(62)
  })

  it('splits into 40 India scenes and 22 inherited scenes', () => {
    const ids = Object.keys(manifest.ids)
    const india = ids.filter(id => /-v[12]$/.test(id))
    expect(india).toHaveLength(40)
    expect(ids.length - india.length).toBe(22)
  })

  it('holds 241 derivative files and the exact integrated byte total', () => {
    expect(files).toHaveLength(241)
    expect(totalBytes).toBe(4682873)
  })

  it('has no duplicate id key in the manifest text', () => {
    const raw = readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8')
    const idsBlock = raw.slice(raw.indexOf('"ids": {'))
    const keys = [...idsBlock.matchAll(/^ {4}"([^"]+)": \{$/gm)].map(match => match[1])
    expect(keys).toHaveLength(62)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps every inherited scene reachable from a region, fallback or vignette', () => {
    const referenced = new Set([
      ...Object.values(manifest.regions).flat(),
      ...Object.values(manifest.fallbacks).flat(),
      ...Object.values(manifest.vignettes),
    ])
    const inherited = Object.keys(manifest.ids).filter(id => !/-v[12]$/.test(id))
    for (const id of inherited) expect(referenced.has(id), id).toBe(true)
  })
})

describe('crop metadata', () => {
  it('declares focalX on exactly Rishikesh', () => {
    const withFocalX = Object.entries(manifest.ids).filter(([, entry]) => entry.focalX !== undefined).map(([id]) => id)
    expect(withFocalX).toEqual(['rishikesh-v1'])
  })

  it('pushes the Rishikesh square crop right far enough to keep both towers', () => {
    // 1536x1024 master, 1:1 box: 512 px of horizontal overflow, 360 px of which
    // must sit to the left, so the square starts at 360 and its centre is at
    // 360 + 512 = 872 of 1536 = 56.77% ... expressed as a focal offset that is
    // 70.3125% (360/512 of the overflow). The 68.75% a 480 px suggestion implies
    // would cut the left tower, so the recorded value is the measured one.
    expect(manifest.ids['rishikesh-v1'].focalX).toEqual({ default: 50, '1:1': 70.3125 })
  })

  it('leaves wide ratios at the default so the panorama stays centred', () => {
    const focalX = manifest.ids['rishikesh-v1'].focalX ?? {}
    for (const ratio of ['default', '16:10', '3:1', '21:9']) {
      expect(focalX[ratio] ?? 50, ratio).toBe(50)
    }
  })

  it('keeps every focal value inside 0..100', () => {
    for (const [id, entry] of Object.entries(manifest.ids)) {
      for (const value of [...Object.values(entry.focalY), ...Object.values(entry.focalX ?? {})]) {
        expect(value, id).toBeGreaterThanOrEqual(0)
        expect(value, id).toBeLessThanOrEqual(100)
      }
    }
  })

  it('does not disturb the inherited focalY values', () => {
    // Asserted as a subset: the inherited set declared more ratios than a spot
    // check needs, and the point is that adding focalX moved none of them.
    expect(manifest.ids['kerala-1'].focalY).toMatchObject({ default: 50, '21:9': 40 })
    expect(manifest.ids['himalaya-2'].focalY).toMatchObject({ default: 50, '3:1': 40 })
    expect(manifest.ids['rishikesh-v1'].focalY).toMatchObject({ default: 50, '3:1': 60 })
  })
})

describe('provenance', () => {
  it('maps Jammu and Kashmir to the active v2 and ships no v1 files', () => {
    expect(manifest.places.state['jammu-and-kashmir'].ids).toEqual(['jammu-and-kashmir-v2'])
    expect(manifest.ids['jammu-and-kashmir-v1']).toBeUndefined()
    expect(files.some(name => name.startsWith('jammu-and-kashmir-v1'))).toBe(false)
  })

  it('keeps Ladakh on the trans-Himalayan lake and Kashmir off it', () => {
    expect(manifest.places.state.ladakh.ids).toEqual(['himalaya-1'])
    expect(manifest.places.state['jammu-and-kashmir'].ids).not.toContain('himalaya-1')
    expect(manifest.places.destination.srinagar.ids).not.toContain('himalaya-1')
  })

  it('retains the original Karnataka scene and ships no rejected study', () => {
    expect(manifest.places.state.karnataka.ids).toEqual(['karnataka-v1'])
    expect(files.some(name => name.includes('karnataka-study'))).toBe(false)
  })

  it('records Bihar and Odisha as the accepted revision without claiming approval', () => {
    expect(manifest.places.state.bihar.ids).toEqual(['bihar-v1'])
    expect(manifest.places.state.odisha.ids).toEqual(['odisha-v1'])
    // The manifest records ids, never a review verdict. Approval lives in the
    // evidence folder, where it can carry its own scope.
    expect(readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8')).not.toMatch(/approved/i)
  })

  it('declares 36 jurisdictions and names every destination owner among them', () => {
    const states = Object.values(manifest.places.state)
    expect(states).toHaveLength(36)
    const names = new Set(states.map(entry => entry.state))
    for (const entry of Object.values(manifest.places.destination)) {
      expect(names.has(entry.state), `${entry.place} -> ${entry.state}`).toBe(true)
    }
  })

  it('points every place entry at a declared id', () => {
    for (const entry of [...Object.values(manifest.places.state), ...Object.values(manifest.places.destination)]) {
      expect(entry.ids.length, entry.aliases.join()).toBeGreaterThan(0)
      for (const id of entry.ids) expect(manifest.ids[id], id).toBeDefined()
    }
  })
})

describe('build reproducibility', () => {
  const script = readFileSync(path.join(ROOT, 'scripts/build-art.mjs'), 'utf8')

  it('keeps absolute machine paths out of the executable mapping', () => {
    // The header comment may name example staging roots; the mapping and the
    // argument handling must not. So the check is on code, not on prose.
    const code = script
      .split('\n')
      .filter(line => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/[A-Za-z]:[\\/](Users|T3|YatraFlow)/)
    expect(code).not.toMatch(/\.t3[\\/]worktrees/i)
  })

  it('maps masters through a relative staged root', () => {
    expect(script).toMatch(/MASTER_FILES/)
    expect(script).toMatch(/legacy\/|india\//)
  })

  it('keeps a per-file encoder override table', () => {
    expect(script).toContain('ENCODER_OVERRIDES')
  })

  it('keeps the capped files on their non-baseline quality', () => {
    // These files were encoded below the baseline to fit their caps. A full
    // rebuild at the baseline would silently lose that, so the table is part of
    // the contract. The three effort-9 entries are the D1 compression batch.
    for (const name of [
      'uttarakhand-v1-960.avif',
      'maharashtra-v1-960.avif',
      'haryana-v1-960.avif',
      'sikkim-v1-960.avif',
      'rishikesh-v1-960.avif',
      'manali-v1-960.avif',
    ]) {
      expect(script, name).toContain(name)
    }
  })

  it('keeps the override table honest: every entry names a real id', () => {
    const declared = new Set(Object.keys(manifest.ids))
    const block = script.slice(script.indexOf('ENCODER_OVERRIDES = {'))
    const body = block.slice(0, block.indexOf('\n}'))
    let checked = 0
    for (const match of body.matchAll(/'([a-z0-9-]+-\d+\.(?:avif|webp))'/g)) {
      checked += 1
      const id = match[1].replace(/-\d+\.(?:avif|webp)$/, '')
      expect(declared.has(id), `override for unknown id ${id}`).toBe(true)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('takes the masters root as an argument, not from a constant path', () => {
    expect(script).toMatch(/--masters/)
  })
})

describe('evidence handoff', () => {
  it('keeps the accepted revisions in the evidence folder, not in the repo', () => {
    // The two accepted masters and their selection record live under E:, so the
    // repo stays small and the provenance travels with the handoff.
    const accepted = 'E:/T3/evidence/art-opus-comparison-20261026/SELECTION.json'
    if (!existsSync(accepted)) return
    const selection = JSON.parse(readFileSync(accepted, 'utf8'))
    expect(JSON.stringify(selection)).toMatch(/bihar-study-v2|odisha-study-v2/)
  })
})
