// ============ Basemap licensing guard (issue #23) ============
// Pure logic, node env: reads the map sources off disk and asserts the basemap
// stays on a provider whose terms allow public/commercial deployment.
// CARTO's free basemaps are non-commercial-only and Esri World Imagery needs a
// paid ArcGIS Developer plan; both were replaced by keyless OpenFreeMap.
// This is the tripwire — it also catches the failure mode that hid the Esri
// URLs for months (unused constants + noUnusedLocals:false), because it scans
// for the *URL strings* anywhere in src/, not just live call sites.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const MAP_TSX = resolve(SRC, 'components/mapcn/map.tsx')

/** Tile/style hosts that are NOT licensed for public commercial deployment. */
const BANNED_TILE_HOSTS = [
  'basemaps.cartocdn.com',
  'a.basemaps.cartocdn.com',
  'services.arcgisonline.com',
  'server.arcgisonline.com',
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(entry) ? [p] : []
  })
}

describe('basemap licensing (issue #23)', () => {
  it('no non-commercial / paid-production tile host appears anywhere in src/', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const host of BANNED_TILE_HOSTS) {
        if (text.includes(host)) offenders.push(`${file} -> ${host}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('both theme basemaps are OpenFreeMap vector styles', () => {
    const text = readFileSync(MAP_TSX, 'utf8')
    const block = text.slice(
      text.indexOf('const defaultStyles'),
      text.indexOf('};', text.indexOf('const defaultStyles')),
    )
    expect(block).toContain('https://tiles.openfreemap.org/styles/dark')
    expect(block).toContain('https://tiles.openfreemap.org/styles/positron')
  })

  it('credits OSM + OpenMapTiles, since OpenFreeMap styles carry no attribution field', () => {
    const text = readFileSync(MAP_TSX, 'utf8')
    const decl = /export const BASEMAP_ATTRIBUTION\s*=\s*\n?\s*"([^"]+)"/.exec(text)
    expect(decl).not.toBeNull()
    const value = decl![1]
    expect(value).toContain('OpenMapTiles')
    expect(value).toContain('OpenStreetMap')
    expect(value).toContain('OpenFreeMap')
  })

  it('wires that attribution into the map attribution control', () => {
    const text = readFileSync(MAP_TSX, 'utf8')
    expect(text).toMatch(/attributionControl:\s*\{[^}]*customAttribution:\s*BASEMAP_ATTRIBUTION/s)
  })
})
