// ============ The validator CLI accepts the geocoder's provenance (#839) ============
// The app's importer accepts a stop picked from the keyless geocoder, whose
// source is `open-meteo`. The CLI validator had its own copy of the provider list
// and still refused it, so a valid exported itinerary failed Gate 1 on the one
// field that says where the place came from. These assertions run the ACTUAL CLI
// (spawned, not re-implemented) against a real golden shelf file with one stop's
// provenance changed, plus the unknown-source negative control that must keep
// failing.
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLACE_PROVIDERS } from '../src/lib/placeDraft'

const VALIDATOR = 'scripts/validate-itinerary.mjs'
const GOLDEN = 'docs/examples/itineraries/goa-north-to-south.golden.json'

const dir = mkdtempSync(join(tmpdir(), 'yf-geocoder-cli-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let seq = 0

/** Run the real CLI over one document and report its exit code and output. */
function runValidator(doc: unknown): { status: number; stdout: string } {
  const file = join(dir, `case-${++seq}.json`)
  writeFileSync(file, JSON.stringify(doc, null, 2))
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [VALIDATOR, file], { encoding: 'utf8' }) }
  } catch (e) {
    return {
      status: (e as { status?: number }).status ?? 1,
      stdout: (e as { stdout?: string }).stdout ?? '',
    }
  }
}

/** A real shelf export, with the first stop's provenance replaced. */
function goldenWith(source: string) {
  const doc = JSON.parse(readFileSync(GOLDEN, 'utf8'))
  const stop = doc.trip.days[0].stops[0]
  stop.placeSource = source
  stop.exposure = 'unknown'
  return doc
}

describe('the validator CLI and geocoder provenance', () => {
  it('accepts exactly the providers the app persists', () => {
    // The drift tripwire: the CLI's list is a deliberate mirror, and this is what
    // keeps it one. A provider added on the app side fails here until the CLI
    // follows, instead of the CLI quietly rejecting good imports.
    const src = readFileSync(VALIDATOR, 'utf8')
    const line = src.match(/const PLACE_SOURCES = \[(.*?)\]/)
    expect(line, 'the CLI no longer declares PLACE_SOURCES').not.toBeNull()
    const cliSources = line![1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    expect(cliSources).toEqual([...PLACE_PROVIDERS])
  })

  it('passes a valid exported stop picked from the geocoder', () => {
    const result = runValidator(goldenWith('open-meteo'))
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('✗')
    // The stop it validated is the one that carries the geocoder provenance.
    expect(result.stdout).toMatch(/stops: \d+ · days: \d+/)
  })

  it('still rejects a source no build knows', () => {
    const result = runValidator(goldenWith('weather-api'))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('placeSource')
    expect(result.stdout).toContain('not in')
  })

  it('still passes the shelf unchanged, legacy fields included', () => {
    // The change widens one enum, so every existing file must keep validating —
    // the golden shelf is the legacy-format proof (older exports carry the same
    // optional identity fields, and tests/trip-import.test.ts covers reading them).
    const doc = JSON.parse(readFileSync(GOLDEN, 'utf8'))
    const result = runValidator(doc)
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('✗')
  })
})
