// ============ Auth failure diagnosis (preview login bug) ============
// Pure logic, node env. Guards the fix for "login fails on preview builds with
// no useful message": the placeholder Supabase client must be *reported*, not
// silently used, and a thrown network error must not surface as a bad password.
import { describe, it, expect } from 'vitest'
import {
  MISSING_BACKEND_MESSAGE,
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

  it('reframes thrown/returned network failures as unreachable-backend', () => {
    for (const err of [new TypeError('Failed to fetch'), { message: 'fetch failed' }]) {
      const out = describeAuthFailure(err, { configured: true })
      expect(out).toContain('Cannot reach the Supabase backend')
    }
  })

  it('passes genuine Supabase responses through untouched', () => {
    expect(
      describeAuthFailure({ message: 'Invalid login credentials' }, { configured: true }),
    ).toBe('Invalid login credentials')
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
