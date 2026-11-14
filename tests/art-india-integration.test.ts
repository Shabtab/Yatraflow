// Contract tests for the India art integration: id counts, provenance, crop
// metadata and the build's reproducibility.
//
// The sibling art-manifest.test.ts already guards file presence, naming and the
// byte caps against the manifest. This file guards the parts the integration
// added: the 112-id set, the place tables, the focalX metadata, and the promise
// that a full staged rebuild reproduces the selected bytes.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ArtManifest } from '../src/lib/regionArt'

const ART_DIR = fileURLToPath(new URL('../src/assets/art/', import.meta.url))
const ROOT = fileURLToPath(new URL('../', import.meta.url))

/** One entry of the manifest's place tables: a state or a destination that
 *  names the art ids it owns and the names it answers to. */
type PlaceEntry = { ids: string[]; aliases: string[]; state?: string; place?: string }
/** The manifest also carries the place tables the build writes. The app type
 *  reads only the art ids, so the tables are declared here. */
type PlaceTables = { places: { state: Record<string, PlaceEntry>; destination: Record<string, PlaceEntry> } }

const manifest = JSON.parse(readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8')) as ArtManifest & PlaceTables

const files = readdirSync(ART_DIR).filter(name => /\.(avif|webp)$/.test(name))
const totalBytes = files.reduce((sum, name) => sum + statSync(path.join(ART_DIR, name)).size, 0)

describe('integrated id set', () => {
  it('declares 112 ids', () => {
    expect(Object.keys(manifest.ids)).toHaveLength(112)
  })

  it('splits into 50 new destinations, 40 India scenes and 22 inherited scenes', () => {
    const ids = Object.keys(manifest.ids)
    const destinations = ids.filter(id => id.startsWith('dest-'))
    const india = ids.filter(id => !id.startsWith('dest-') && /-v[12]$/.test(id))
    const inherited = ids.filter(id => !id.startsWith('dest-') && !/-v[12]$/.test(id))
    expect(destinations).toHaveLength(50)
    expect(india).toHaveLength(40)
    expect(inherited).toHaveLength(22)
  })

  it('holds 546 derivative files inside the whole-folder budget', () => {
    expect(files).toHaveLength(546)
    // Pin the exact total. A budget-only check allows 1.6 MiB of drift, so a
    // dropped file or a wrong master would still pass.
    expect(totalBytes).toBe(19203488)
    expect(totalBytes).toBeLessThan(manifest.budget.totalMiB * 1024 * 1024)
  })

  it('has no duplicate id key in the manifest text', () => {
    const raw = readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8')
    const idsBlock = raw.slice(raw.indexOf('"ids": {'))
    const keys = [...idsBlock.matchAll(/^ {4}"([^"]+)": \{$/gm)].map(match => match[1])
    expect(keys).toHaveLength(112)
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
  it('declares focalX on Rishikesh and only ids whose crop needs an offset', () => {
    const withFocalX = Object.entries(manifest.ids).filter(([, entry]) => entry.focalX !== undefined).map(([id]) => id)
    expect(withFocalX).toContain('rishikesh-v1')
    for (const id of withFocalX) expect(id === 'rishikesh-v1' || id.startsWith('dest-'), id).toBe(true)
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
    const focalX: Record<string, number> = manifest.ids['rishikesh-v1'].focalX ?? {}
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

  it('declares 36 jurisdictions and 51 destinations, and names every destination owner among them', () => {
    const states = Object.values(manifest.places.state)
    expect(states).toHaveLength(36)
    expect(Object.values(manifest.places.destination)).toHaveLength(51)
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
    expect(script).toMatch(/balanced\/|destinations\//)
  })

  it('keeps a per-file encoder override table', () => {
    expect(script).toContain('ENCODER_OVERRIDES')
  })

  const overrideEntries = () => {
    const block = script.slice(script.indexOf('ENCODER_OVERRIDES = {'))
    const body = block.slice(0, block.indexOf('\n}'))
    return [...body.matchAll(/'([a-z0-9-]+-\d+\.(?:avif|webp))': \{ quality: (\d+), effort: (\d+) \}/g)]
      .map(match => ({ name: match[1], quality: Number(match[2]), effort: Number(match[3]) }))
  }

  it('pins every file that needs a lower rung', () => {
    // Every capped file must keep the exact parameters that produced its bytes,
    // or a full rebuild at the baseline silently loses the encoding. The count
    // catches a deleted row; the spot checks catch a changed rung on the files
    // that sit closest to their cap.
    const entries = overrideEntries()
    expect(entries).toHaveLength(69)
    expect(entries).toEqual(expect.arrayContaining([
      { name: 'uttarakhand-v1-960.avif', quality: 46, effort: 6 },
      { name: 'rishikesh-v1-960.avif', quality: 48, effort: 6 },
      { name: 'dest-jaipur-v2-960.avif', quality: 38, effort: 6 },
      { name: 'dest-shaheed-dweep-v2-960.avif', quality: 38, effort: 6 },
      { name: 'dest-shaheed-dweep-v2-640.webp', quality: 50, effort: 6 },
    ]))
  })

  it('keeps the override table honest: every entry names a produced file', () => {
    const produced = new Set<string>()
    for (const [id, entry] of Object.entries(manifest.ids)) {
      const widths = entry.ratio === '3:2' ? [...entry.widths, ...manifest.coverWidths] : entry.widths
      for (const width of widths) produced.add(`${id}-${width}.avif`)
      produced.add(`${id}-${entry.webp}.webp`)
    }
    for (const entry of overrideEntries()) {
      expect(produced.has(entry.name), `override for unproduced file ${entry.name}`).toBe(true)
    }
  })

  it('takes the masters root as an argument, not from a constant path', () => {
    expect(script).toMatch(/--masters/)
  })
})

describe('evidence handoff', () => {
  // The two accepted masters and their selection record live outside the repo,
  // so the repo stays small and the provenance travels with the handoff. Set
  // YATRAFLOW_ART_SELECTION to read another copy. With no file, the test is
  // skipped and its name says why. It never passes without checking anything.
  const accepted = process.env.YATRAFLOW_ART_SELECTION ?? 'E:/T3/evidence/art-opus-comparison-20261026/SELECTION.json'
  const present = existsSync(accepted)
  const title = present
    ? 'keeps the accepted revisions in the evidence folder, not in the repo'
    : `keeps the accepted revisions in the evidence folder (skipped: no file at ${accepted}; set YATRAFLOW_ART_SELECTION)`

  it.skipIf(!present)(title, () => {
    const selection = JSON.parse(readFileSync(accepted, 'utf8'))
    expect(JSON.stringify(selection)).toMatch(/bihar-study-v2|odisha-study-v2/)
  })
})
