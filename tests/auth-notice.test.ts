// ============ Sign-up confirmation is a notice, not an error (#704) ============
// Source pins, node env. The store reports the waiting-for-email state as a
// field, and the page routes on that field. The notice shows in a polite status
// region with the info note style. The error line keeps role="alert".
// The scan folds CRLF to LF, so it reads the same on a Windows checkout and in CI.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const source = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const auth = source('../src/pages/Auth.tsx')
const store = source('../src/store/store.ts')
const css = source('../src/styles.css')

describe('the store reports the waiting state as a field', () => {
  it('signup types the field and returns it when no session exists', () => {
    expect(store).toContain('needsConfirmation?: boolean')
    expect(store).toContain('if (data.session === null) return { ok: true, needsConfirmation: true }')
  })
})

describe('the page routes on the field, not on copy text', () => {
  it('a needsConfirmation result goes to the notice and returns', () => {
    expect(auth).toContain('if (r.needsConfirmation) { clearTimeout(failSafe); setNotice(CONFIRM_EMAIL_COPY); setSaving(false); return }')
  })

  it('other signup failures still go to the error', () => {
    expect(auth).toContain("if (!r.ok) { clearTimeout(failSafe); setError(r.error ?? 'Signup failed'); setSaving(false); return }")
  })

  it('no branch matches a failure by its copy', () => {
    expect(auth).not.toMatch(/r\.error ===/)
  })
})

describe('the confirmation renders as a status notice', () => {
  it('the notice sits inside a polite role="status" region', () => {
    expect(auth).toMatch(
      /<div role="status" aria-live="polite">\s*\{notice && <div className="hub-note auth-submit-notice">\{notice\}<\/div>\}\s*<\/div>/,
    )
  })

  it('the notice carries no alert role and no error style', () => {
    const notice = auth.match(/\{notice && <div[^\n]*\{notice\}<\/div>\}/)?.[0] ?? ''
    expect(notice).not.toBe('')
    expect(notice).not.toMatch(/alert|err-text|TriangleAlert/)
  })

  it('the page has one alert region, and it still renders the error', () => {
    expect(auth.match(/role="alert"/g)).toHaveLength(1)
    expect(auth).toMatch(/className="err-text auth-submit-error" role="alert"[^\n]*\{error\}<\/div>/)
  })
})

describe('errors and notices clear each other', () => {
  it('every place that clears the error also clears the notice', () => {
    const clearsError = auth.match(/setError\(null\)/g)?.length ?? 0
    const clearsNotice = auth.match(/setNotice\(null\)/g)?.length ?? 0
    expect(clearsError).toBeGreaterThan(0)
    expect(clearsNotice).toBe(clearsError)
  })
})

describe('the notice reuses the existing info style and the error entrance', () => {
  it('uses the hub-note info class, not a new one', () => {
    expect(auth).toContain('hub-note auth-submit-notice')
    expect(css).toMatch(/^\.hub-note \{/m)
  })

  it('enters with the errIn entrance on motion tokens, with no raw milliseconds', () => {
    const rule = css.match(/\.auth-submit-notice \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('animation: errIn var(--motion-med) var(--ease-out)')
    expect(rule).not.toMatch(/\d+\s?ms/)
  })

  it('opts out under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.auth-submit-notice \{ animation: none; \} \}/)
  })

  it('keeps the gap above the submit button at 8px, on the spacing ladder', () => {
    expect(css).toMatch(/\.auth-submit-notice \{ margin-bottom: 8px;/)
  })
})
