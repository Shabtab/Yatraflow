import { describe, expect, it } from 'vitest'
import { authNext, isInviteNext } from '../src/lib/authNext'

describe('the invite cue gate', () => {
  it.each(['/join/GOA-ABCD', '/invite/00000000-0000-0000-0000-000000000001'])('is on for %s', path => {
    expect(isInviteNext(authNext(path))).toBe(true)
  })
  it.each([null, '/trips', '/pub/pub_growth', '/joint/x', '//join/x', 'https://example.com/join/x'])('is off for %s', path => {
    expect(isInviteNext(authNext(path))).toBe(false)
  })
})

describe('safe auth return paths', () => {
  it.each(['/pub/pub_growth', '/join/GOA-ABCD', '/invite/00000000-0000-0000-0000-000000000001', '/trips'])('keeps %s', path => {
    expect(authNext(path)).toBe(path)
    expect(authNext(encodeURIComponent(path))).toBe(path)
  })
  it.each([null, 'https://example.com', '//example.com', '/pub/x?ref=wa', '/pub/x#part', '/pub/%2F%2Fexample.com', '/pub/%zz', '/\nexample.com'])('refuses unsafe next values: %s', path => {
    expect(authNext(path)).toBe('/trips')
  })
})
