import { describe, expect, it } from 'vitest'
import { authNext } from '../src/lib/authNext'

describe('safe auth return paths', () => {
  it.each(['/pub/pub_growth', '/join/GOA-ABCD', '/invite/00000000-0000-0000-0000-000000000001', '/trips'])('keeps %s', path => {
    expect(authNext(path)).toBe(path)
    expect(authNext(encodeURIComponent(path))).toBe(path)
  })
  it.each([null, 'https://example.com', '//example.com', '/pub/x?ref=wa', '/pub/x#part', '/pub/%2F%2Fexample.com', '/pub/%zz', '/\nexample.com'])('refuses unsafe next values: %s', path => {
    expect(authNext(path)).toBe('/trips')
  })
})
