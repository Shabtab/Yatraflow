// ============ Security-invariant pins (2026-09-22 audit) ============
// Source-level: these read the shipped config, manifest and page as text, so
// dropping a header, re-opening backups or loosening the password floor fails
// CI without a deployment, a device or a browser.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  headers?: { source: string; headers: { key: string; value: string }[] }[]
}
const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
const auth = readFileSync(new URL('../src/pages/Auth.tsx', import.meta.url), 'utf8')

const headerMap = new Map<string, string>()
for (const group of vercel.headers ?? [])
  for (const h of group.headers) headerMap.set(h.key.toLowerCase(), h.value)

describe('web security headers (vercel.json)', () => {
  it('allows the exact YouTube thumbnail host for images only', () => {
    const csp = headerMap.get('content-security-policy-report-only') ?? ''
    const image = csp.split(';').map(rule => rule.trim()).find(rule => rule.startsWith('img-src '))
    expect(image).toBe("img-src 'self' data: blob: https://*.wikimedia.org https://*.supabase.co https://tiles.openfreemap.org https://i.ytimg.com")
    expect(csp.split('https://i.ytimg.com')).toHaveLength(2)
  })
  it('ships the baseline set on every path', () => {
    // nosniff kills MIME confusion on uploaded/blob content; DENY is the
    // clickjacking wall (no surface of this app is legitimately framed);
    // Referrer-Policy keeps share URLs' query strings off third-party logs.
    expect(headerMap.get('x-content-type-options')).toBe('nosniff')
    expect(headerMap.get('x-frame-options')).toBe('DENY')
    expect(headerMap.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(headerMap.get('permissions-policy')).toContain('geolocation=(self)')
    expect(headerMap.get('permissions-policy')).toContain('camera=()')
    expect(headerMap.get('permissions-policy')).toContain('microphone=()')
  })

  it('runs a report-only CSP — measurement mode, not the wall', () => {
    // Report-only is deliberate: a map app with six third-party origins cannot
    // ship an enforced CSP blind without risking a self-DoS, so this measures
    // first. frame-ancestors/object-src/base-uri are nonetheless pinned so the
    // shape can't quietly rot before enforcement.
    const csp = headerMap.get('content-security-policy-report-only') ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("form-action 'self'")
    // The app's real egress must stay allowed — a spot-check, not the list.
    expect(csp).toContain('https://*.supabase.co')
    expect(csp).toContain('wss://*.supabase.co')
    expect(csp).toContain('https://places.googleapis.com')
    expect(csp).toContain('https://tiles.openfreemap.org')
  })

  it('keeps the rewrites intact (the headers block must not displace them)', () => {
    const raw = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
    expect(raw).toContain('"source": "/i/:id"')
    expect(raw).toContain('"source": "/mappls/:path*"')
  })
})

describe('the Android shell keeps its credentials out of cloud backups', () => {
  it('allowBackup is false — the WebView localStorage holds session refresh tokens and device-local AI keys', () => {
    expect(manifest).toContain('android:allowBackup="false"')
  })
})

describe('signup enforces the password floor its hint promises', () => {
  it('the 8-character minimum is a rule, not a suggestion (Supabase allows 6)', () => {
    expect(auth).toContain('password.length < 8')
    expect(auth).toContain("minLength={mode === 'signup' ? 8 : undefined}")
  })
})
