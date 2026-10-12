// ============ #704 — the creator hub says a profile change happened only after the server accepts it ============
//
// The enable, save and disable paths called updateProfile without waiting for its
// verdict, and then toasted success over a refused write. Each path now waits for
// the verdict. It toasts success only on r.ok, and otherwise shows the error or the
// shared profile-not-saved copy. Save creator profile stays disabled while it is in
// flight. The order of the await and the toast is the whole fix, so this guard reads
// the source, with comments removed.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// Comments name the copy and the calls under test. A source guard reads prose as
// readily as code, so strip them, and a comment can never satisfy or break an order check.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const hub = stripComments(read('../src/pages/CreatorHubPage.tsx'))

describe('#704 — creator mode enables only after the server accepts it', () => {
  it('the enable button waits for the profile write and toasts success only on r.ok', () => {
    expect(hub).toMatch(
      /onClick=\{async \(\) => \{\s*const r = await updateProfile\(\{ isCreator: true \}\)\s*if \(r\.ok\) toast\('Creator mode enabled — your bio and links now show on published itineraries\.'\)\s*else toast\(r\.error \?\? PROFILE_NOT_SAVED, 'err'\)\s*\}\}>/,
    )
  })

  it('the disable confirmation waits for the profile write and toasts success only on r.ok', () => {
    expect(hub).toMatch(
      /onConfirm=\{async \(\) => \{\s*setConfirmDisable\(false\)\s*const r = await updateProfile\(\{ isCreator: false \}\)\s*if \(r\.ok\) toast\('Creator mode disabled — your publications stay live\.'\)\s*else toast\(r\.error \?\? PROFILE_NOT_SAVED, 'err'\)\s*\}\}/,
    )
  })
})

describe('#704 — the creator profile save waits for its write and says so on the button', () => {
  it('Save creator profile is disabled while the save is in flight', () => {
    expect(hub).toMatch(/const \[savingCreator, setSavingCreator\] = useState\(false\)/)
    expect(hub).toMatch(/<button className="btn btn-primary btn-sm" disabled=\{savingCreator\} onClick=\{async \(\) => \{/)
    expect(hub).toMatch(/\}\}>Save creator profile<\/button>/)
  })

  it('the save awaits the write, clears the pending state, and toasts success only on r.ok', () => {
    expect(hub).toMatch(
      /setSavingCreator\(true\)\s*const r = await updateProfile\(\{[\s\S]*?\}\)\s*setSavingCreator\(false\)\s*if \(r\.ok\) toast\('Creator profile saved'\)\s*else toast\(r\.error \?\? PROFILE_NOT_SAVED, 'err'\)/,
    )
  })
})

describe('#704 — the hub never toasts over an unawaited profile write', () => {
  it('every updateProfile call in the hub is awaited', () => {
    expect(hub).toMatch(/updateProfile\(/)
    expect(hub).not.toMatch(/(?<!await )updateProfile\(/)
  })

  it('the refusal falls back to the shared copy the store exports', () => {
    expect(hub).toMatch(/import \{[^}]*\bPROFILE_NOT_SAVED\b[^}]*\} from '\.\.\/store\/store'/)
    expect(read('../src/store/store.ts')).toMatch(/export const PROFILE_NOT_SAVED = /)
  })
})
