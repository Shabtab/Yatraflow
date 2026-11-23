// ============ Auth failure diagnosis (preview login bug) ============
// Pure logic, node env. Guards the fix for "login fails on preview builds with
// no useful message": the placeholder Supabase client must be *reported*, not
// silently used, and a thrown network error must not surface as a bad password.
import { describe, it, expect, vi } from 'vitest'
import {
  INVALID_CREDENTIALS_MESSAGE,
  MISSING_BACKEND_MESSAGE,
  NETWORK_FAILURE_MESSAGE,
  PLACEHOLDER_SUPABASE_URL,
  describeAuthFailure,
  isRealSupabaseUrl,
} from '../src/lib/authErrors'

describe('isRealSupabaseUrl', () => {
  it('rejects absent values and the placeholder origin', () => {
    expect(isRealSupabaseUrl(undefined)).toBe(false)
    expect(isRealSupabaseUrl('')).toBe(false)
    expect(isRealSupabaseUrl(PLACEHOLDER_SUPABASE_URL)).toBe(false)
  })

  it('rejects an unfilled .env.example template', () => {
    expect(isRealSupabaseUrl('https://YOUR-PROJECT-ref.supabase.co')).toBe(false)
  })

  it('rejects non-URLs but accepts hosted and local-dev projects', () => {
    expect(isRealSupabaseUrl('supabase.co')).toBe(false)
    expect(isRealSupabaseUrl('https://abcdefghijkmnop.supabase.co')).toBe(true)
    expect(isRealSupabaseUrl('http://localhost:54321 ')).toBe(false)
    expect(isRealSupabaseUrl('http://127.0.0.1:54321')).toBe(true)
  })
})

describe('describeAuthFailure', () => {
  it('blames the missing build-time env, not the credentials, when unconfigured', () => {
    // Even a real-looking error is secondary: the request never left the browser.
    const out = describeAuthFailure(new TypeError('Failed to fetch'), { configured: false })
    expect(out).toBe(MISSING_BACKEND_MESSAGE)
  })

  it('names both variables so the fix is obvious from the message alone', () => {
    expect(MISSING_BACKEND_MESSAGE).toContain('VITE_SUPABASE_URL')
    expect(MISSING_BACKEND_MESSAGE).toContain('VITE_SUPABASE_ANON_KEY')
    expect(MISSING_BACKEND_MESSAGE.toLowerCase()).toContain('redeploy')
  })

  it('reframes thrown/returned network failures as one plain line', () => {
    for (const err of [new TypeError('Failed to fetch'), { message: 'fetch failed' }, { message: 'Load failed' }]) {
      const out = describeAuthFailure(err, { configured: true })
      expect(out).toBe(NETWORK_FAILURE_MESSAGE)
      // The line names no provider, no browser rule and no raw error text.
      expect(out).not.toMatch(/supabase|cors|failed to fetch|fetch failed/i)
    }
  })

  it('keeps the raw network text in the console, not on the screen', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      describeAuthFailure(new TypeError('Failed to fetch'), { configured: true })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('sign-in request did not reach the server'), 'Failed to fetch')
    } finally { warn.mockRestore() }
  })

  it('maps the rejected-credentials response to the plain copy', () => {
    const out = describeAuthFailure({ message: 'Invalid login credentials' }, { configured: true })
    expect(out).toBe(INVALID_CREDENTIALS_MESSAGE)
    expect(out).toBe("That email and password don't match. Try again, or mail support to reset.")
    expect(describeAuthFailure(new Error('invalid login credentials'), { configured: true })).toBe(INVALID_CREDENTIALS_MESSAGE)
  })

  it('passes other genuine Supabase responses through untouched', () => {
    expect(
      describeAuthFailure(
        { message: 'Email not confirmed' },
        { configured: true },
      ),
    ).toBe('Email not confirmed')
  })

  it('never returns an empty message', () => {
    for (const err of [undefined, null, '', {}, { message: '   ' }]) {
      expect(describeAuthFailure(err, { configured: true }).trim().length).toBeGreaterThan(0)
    }
  })
})
