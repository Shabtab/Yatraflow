// ============ An empty login form asks for the fields before any request ============
// Source pins, node env. The login branch checks the identifier and the password
// before it calls the store, so an empty form never reaches the server. The
// message shows in the form error line, which keeps role="alert".
// The scan folds CRLF to LF, so it reads the same on a Windows checkout and in CI.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const auth = readFileSync(new URL('../src/pages/Auth.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// The guard sits inside the login branch and returns before the store call.
const EMPTY_LOGIN_GUARD =
  /if \(mode === 'login'\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(!email\.trim\(\) \|\| !password\) \{\n\s*clearTimeout\(failSafe\)\n\s*setError\('Enter your email and password\.'\)\n\s*setSaving\(false\)\n\s*return\n\s*\}\n\s*const r = await login\(email, password\)/

describe('an empty login form returns before the request', () => {
  it('checks the identifier and the password in the login branch, before the store call', () => {
    expect(auth).toMatch(EMPTY_LOGIN_GUARD)
  })

  it('shows the field message once, in the form error state', () => {
    expect(auth.match(/setError\('Enter your email and password\.'\)/g)).toHaveLength(1)
  })

  it('keeps the sign-up checks as they were', () => {
    expect(auth).toContain("setNameErr('Tell us your name.')")
    expect(auth).toContain("setPasswordErr('Passwords need at least 8 characters.')")
    expect(auth).toContain('if (password.length < 8) {')
    expect(auth).toContain('if (!isAdultSignup(dob, new Date())) {')
  })
})

describe('the form error keeps its alert role', () => {
  it('renders the form error with role="alert"', () => {
    expect(auth).toMatch(/className="err-text auth-submit-error" role="alert"/)
  })
})
