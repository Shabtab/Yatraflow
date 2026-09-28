// #424 step 3 — what this browser keeps, and whether the clear button can reach it.
//
// The crash screen's most destructive control removed `yatraflow_db_v1`, a key
// NOTHING in this repo writes. So the audit for "every destructive action has a way
// back" had to start one level down: which local keys actually exist, and are they
// all reachable by the one clear that claims to clear them?
//
// Two halves: the module's behaviour against a fake storage, and a source scan that
// keeps the namespace contract true — a new local key outside `LOCAL_KEY_PREFIXES`
// fails here rather than surviving a "clear local data" in the wild.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_KEY_PREFIXES, LOCAL_DATA_NOTE, clearLocalAppData, isAppLocalKey } from '../src/lib/localData'

class FakeStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

let fake: FakeStorage
const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage

beforeEach(() => {
  fake = new FakeStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = fake
})
afterEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = realLocalStorage
})

describe('isAppLocalKey', () => {
  it('claims the namespaces this app writes in', () => {
    expect(isAppLocalKey('yatraflow_theme')).toBe(true)
    expect(isAppLocalKey('yatraflow_suggestions_v6_trip-1')).toBe(true)
    expect(isAppLocalKey('yf.savedPubs')).toBe(true)
    expect(isAppLocalKey('yf.gquota.2026-09.google_places')).toBe(true)
  })

  it('leaves anything else alone — it is not this app\'s to remove', () => {
    expect(isAppLocalKey('theme')).toBe(false)
    expect(isAppLocalKey('yatraflow')).toBe(false)   // the prefix itself
    expect(isAppLocalKey('yf')).toBe(false)
    expect(isAppLocalKey('other-app:token')).toBe(false)
    expect(isAppLocalKey('***')).toBe(false)
  })
})

describe('clearLocalAppData', () => {
  it('removes the app keys and nothing else, and says how many went', () => {
    fake.setItem('yatraflow_theme', 'dark')
    fake.setItem('yatraflow_open_day', '{"t1":1}')
    fake.setItem('yf.savedPubs', '["p1"]')
    fake.setItem('other-app:token', 'keep-me')
    fake.setItem('theme', 'keep-me-too')

    expect(clearLocalAppData()).toBe(3)
    expect(fake.getItem('yatraflow_theme')).toBeNull()
    expect(fake.getItem('yf.savedPubs')).toBeNull()
    // The foreign keys survive — a crash-recovery button has no business
    // tidying another app's storage on the same origin.
    expect(fake.getItem('other-app:token')).toBe('keep-me')
    expect(fake.getItem('theme')).toBe('keep-me-too')
  })

  it('is idempotent and never throws on an empty or hostile storage', () => {
    expect(clearLocalAppData()).toBe(0)
    fake.setItem('yatraflow_x', '1')
    expect(clearLocalAppData()).toBe(1)
    expect(clearLocalAppData()).toBe(0)
    ;(globalThis as { localStorage?: unknown }).localStorage = undefined
    expect(clearLocalAppData()).toBe(0)
  })

  it('promises only what it does', () => {
    // The copy may not imply the user is about to lose their trips.
    expect(LOCAL_DATA_NOTE).toMatch(/browser saved/)
    expect(LOCAL_DATA_NOTE).toMatch(/not affected/)
  })
})

// ---------------------------------------------------------------------------
// Source scan: the namespace contract, both directions.
// ---------------------------------------------------------------------------

function srcFiles(rel = 'src'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(rel, { withFileTypes: true })) {
    const p = join(rel, entry.name)
    if (entry.isDirectory()) out.push(...srcFiles(p))
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) out.push(p)
  }
  return out.map(p => p.replace(/\\/g, '/'))
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const isNamespaced = (v: string) => LOCAL_KEY_PREFIXES.some(p => v.startsWith(p))
/** Source with comments and module choreography removed — so a scan judges CODE,
 *  not prose, and does not read a statement heading on one line as the import it
 *  belongs to on the next. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\n)\s*\/\/.*/g, '$1')
  .replace(/import\s+[^;]*?from\s*'[^']*'/gs, '')
  .replace(/export\s*(?:type\s*)?\{[^}]*\}/gs, '')

describe('every local key this app writes is inside its namespace', () => {
  const files = srcFiles()

  it('writes no bare localStorage key', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = read(file)
      // const NAME = 'literal' — so an identifier argument can be resolved.
      const consts = new Map<string, string>()
      for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'/g)) consts.set(m[1], m[2])
      for (const m of src.matchAll(/localStorage\.(?:set|get|remove)Item\(\s*([^,)]+)/g)) {
        const arg = m[1].trim()
        const literal = arg.startsWith("'") ? (arg.match(/^'([^']*)'/) ?? [])[1] : consts.get(arg)
        if (literal !== undefined && !isNamespaced(literal)) offenders.push(`${file}: ${arg} → '${literal}'`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps any *KEY* constant either namespaced or scoped to loadPref/savePref', () => {
    // A key constant that is NOT namespaced is only legitimate when it is a NAME
    // handed to the pref helpers (which add the `yatraflow_` prefix themselves).
    // This is what catches a literal like `***` being used as a real key.
    const offenders: string[] = []
    for (const file of files) {
      const src = read(file)
      for (const m of src.matchAll(/const\s+([A-Z_]*KEY[A-Z_]*)\s*=\s*'([^']*)'/g)) {
        const [, name, value] = m
        if (isNamespaced(value)) continue
        // Every mention of the constant, minus comments, the declaration itself
        // and import/export lists — what is left must be a pref-helper argument,
        // because that is the only place a bare name is legitimate.
        const mentions = files
          .flatMap(f => code(f).split('\n').map(line => ({ file: f, line })))
          .filter(({ line }) => line.includes(name))
          .filter(({ line }) => !new RegExp(`const\\s+${name}\\s*=`).test(line))
        const onlyPrefNames = mentions.length > 0
          && mentions.every(({ line }) => new RegExp(`(loadPref|savePref|removePref)\\(\\s*${name}\\b`).test(line))
        if (!onlyPrefNames) offenders.push(`${file}: ${name} = '${value}'`)
      }
    }
    expect(offenders).toEqual([])
  })
})
