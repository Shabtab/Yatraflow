// ============ The Auth form checks the email shape itself ============
// Node env. The form sets noValidate, so the browser shows no bubble of its
// own. A filled email field with the wrong shape must get the app's form error
// line before any request. The scan folds CRLF to LF.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { looksLikeEmail } from '../src/lib/emailShape'

const auth = readFileSync(new URL('../src/pages/Auth.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('looksLikeEmail', () => {
  it('accepts an address with text on both sides of one @ and a dot in the domain', () => {
    expect(looksLikeEmail('you@example.com')).toBe(true)
    expect(looksLikeEmail('  a.b+c@mail.example.in  ')).toBe(true)
  })

  it('rejects text without the shape of an address', () => {
    for (const bad of ['you', 'you@', '@example.com', 'you@example', 'you @example.com', 'a@b@c.com']) {
      expect(looksLikeEmail(bad), bad).toBe(false)
    }
  })
})

describe('the Auth form owns email validation', () => {
  it('sets noValidate on the form', () => {
    expect(auth).toContain('<form onSubmit={submit} noValidate>')
  })

  it('checks a filled email before the login and sign-up branches', () => {
    const guard = auth.indexOf("if (email.trim() && !looksLikeEmail(email)) {")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(auth.indexOf("if (mode === 'login') {"))
    expect(auth.match(/setError\('Enter a valid email address\.'\)/g)).toHaveLength(1)
  })
})
