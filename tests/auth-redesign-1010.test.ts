// ============ Log in and sign up redesign (#1010): source pins ============
// Node env, no DOM. The page markup and the stylesheet are read as text.
// Each scan folds CRLF to LF, so it reads the same on a Windows checkout and in CI.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const source = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const auth = source('../src/pages/Auth.tsx')
const cover = source('../src/components/AuthCover.tsx')
const css = source('../src/styles/pages/auth.css')
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the cover panel keeps the locked main line', () => {
  it('states the headline with its em dash and the support line', () => {
    expect(auth).toContain("const COVER_HEADLINE = 'Plan Indian trips together — not in a chaotic group chat.'")
    expect(auth).toContain("const COVER_LINE = 'Every stop, hour and rupee in one plan your group can actually follow.'")
    expect(auth).toContain('{COVER_HEADLINE}')
  })

  it('shows the three chips', () => {
    expect(auth).toContain("const COVER_CHIPS = ['Free to plan', 'Works offline', 'Made for India'] as const")
  })

  it('does not bring back the retired road-trip line', () => {
    expect(auth).not.toContain('Plan the road trip together')
  })
})

describe('the cover uses the app art, with a night file wired', () => {
  it('draws one generated scene through RegionArt', () => {
    expect(cover).toContain("export const AUTH_COVER_ID = 'road-2'")
    expect(cover).toContain('<RegionArt')
  })

  it('marks the artwork as decoration', () => {
    expect(cover).toMatch(/alt=""/)
    expect(cover).toContain('aria-hidden="true"')
  })

  it('sets width and height on the night image', () => {
    expect(cover).toMatch(/width=\{960\}/)
    expect(cover).toMatch(/height=\{640\}/)
  })

  it('shows the night layer only under the dark theme', () => {
    expect(css).toMatch(/\.auth-cover-night \{ display: none;/)
    expect(css).toContain("[data-theme='dark'] .auth-cover-night { display: block; }")
  })
})

describe('the invite cue shows only for an invite route, on the log in form', () => {
  it('gates the cue on the log in mode and the invite check', () => {
    expect(auth).toContain('const inviteRoute = isInviteNext(nextRoute())')
    expect(auth).toMatch(/\{inviteRoute && \(\s*<div className="auth-invite-clip" inert=\{mode !== 'login'\} aria-hidden=\{mode !== 'login'\}>/)
    expect(css).toContain(".auth-card[data-mode='login'] .auth-invite-clip { grid-template-rows: 1fr; }")
  })

  it('renders the cue copy once', () => {
    expect(auth.match(/Joining with an invite\? Log in and you land straight in the trip\./g)).toHaveLength(1)
  })
})

describe('the sign-up password hint counts live', () => {
  it('feeds the hint from the pure helper', () => {
    expect(auth).toContain('const meter = passwordMeter(password)')
    expect(auth).toContain("hint={meter.text}")
    expect(auth).toContain("hideHintFromAssistiveTech={mode === 'login'}")
  })

  it('turns the hint to the error colour while the password is short', () => {
    expect(css).toMatch(/input\[data-short='true'\]\) ~ \.hint-text \{ color: var\(--pw-risk\); \}/)
    expect(css).toMatch(/\.auth-form \.hint-text \{ transition: color var\(--motion-instant\) var\(--ease-paper\); \}/)
  })
})

describe('motion: tokens only, with a reduced-motion opt-out', () => {
  it('introduces no raw duration in the stylesheet', () => {
    expect(cssNoComments).not.toMatch(/(?<![\w-])\d*\.?\d+m?s\b(?![\w-])/)
  })

  it('names a token for every animation', () => {
    expect(css).toContain('animation: authSettle var(--motion-slower) var(--ease-glide) both')
    expect(css).toContain('grid-template-rows var(--motion-med) var(--ease-glide)')
    expect(auth).toContain("className=\"auth-extra-clip\" inert={mode !== 'signup'}")
    expect(auth).toContain("name={mode === 'signup' ? 'name' : undefined}")
    expect(css).toContain(".auth-card[data-mode='login'] .auth-extra")
    expect(css).toContain('animation: authSpin calc(var(--motion-slower) * 2) linear infinite')
  })

  it('turns every animation off under prefers-reduced-motion', () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{\n  \.auth-cover-art, \.auth-spin \{ animation: none; \}[^]*?\n\}/)?.[0] ?? ''
    expect(block).not.toBe('')
    expect(block).toContain('.auth-extra-clip, .auth-reset-clip, .auth-invite-clip, .auth-extra, .auth-form .auth-reset-help, .auth-invite-clip > div, .auth-crossfade > span { transition: none; }')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.auth-submit-notice \{ animation: none; \} \}/)
  })
})

describe('the submit button shows progress and keeps its floor', () => {
  it('spins an icon while busy and keeps the busy labels', () => {
    expect(auth).toContain('{saving && <RefreshCw className="auth-spin" size={15} aria-hidden="true" />}')
    expect(auth).toContain("'Signing in…'")
    expect(auth).toContain("'Creating account…'")
  })

  it('stays at or above the 44px touch floor', () => {
    const height = css.match(/--btn-min-height: (\d+)px/)
    expect(Number(height?.[1])).toBeGreaterThanOrEqual(44)
  })
})
