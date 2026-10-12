// ============ Sign-up confirmation is a notice, not an error (#704) ============
// Source pins, node env. The page shows "check your email" in a polite status
// region with the info note style. The error line keeps role="alert". The scan
// folds CRLF to LF, so it reads the same on a Windows checkout and in CI.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const source = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const auth = source('../src/pages/Auth.tsx')
const store = source('../src/store/store.ts')
const css = source('../src/styles.css')

const confirmCopy = auth.match(/const CONFIRM_EMAIL_COPY = '([^']+)'/)?.[1] ?? ''

describe('the confirmation copy matches the store', () => {
  it('Auth.tsx holds the copy that signup returns', () => {
    expect(confirmCopy).toBe('Check your email to confirm your account, then log in.')
  })

  it('the store still reports the copy as a failed result', () => {
    // The page relies on this shape. A changed copy must change both files.
    expect(store).toContain(`return { ok: false, error: '${confirmCopy}' }`)
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
  it('the signup failure sends the confirmation to the notice and other failures to the error', () => {
    expect(auth).toContain('if (r.error === CONFIRM_EMAIL_COPY) setNotice(r.error)')
    expect(auth).toContain("else setError(r.error ?? 'Signup failed')")
  })

  it('every place that clears the error also clears the notice', () => {
    const clearsError = auth.match(/setError\(null\)/g)?.length ?? 0
    const clearsNotice = auth.match(/setNotice\(null\)/g)?.length ?? 0
    expect(clearsError).toBeGreaterThan(0)
    expect(clearsNotice).toBe(clearsError)
  })
})

describe('the notice reuses the existing info style', () => {
  it('uses the hub-note info class, not a new one', () => {
    expect(auth).toContain('hub-note auth-submit-notice')
    expect(css).toMatch(/^\.hub-note \{/m)
  })

  it('keeps the same gap above the submit button as the error line', () => {
    expect(css).toMatch(/\.auth-submit-notice\s*\{\s*margin-bottom:\s*10px;?\s*\}/)
  })
})
