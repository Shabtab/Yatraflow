// Source pins for the app shell's state blocks (consistency page P1).
// The lazy route fallback and the start-up gate use StateBlock in its loading kind.
// The crash fallback uses the failed kind and keeps every recovery action.
// The footer keeps its element, its feedback link and its calculator link.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { stateBlockRole } from '../src/components/page/StateBlock'

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const app = read('src/App.tsx')
const boundary = read('src/components/ErrorBoundary.tsx')

describe('app shell loading states (P1)', () => {
  it('renders the lazy route fallback through StateBlock kind="loading", and the start-up gate reuses it', () => {
    expect(app).toMatch(/const lazyRouteFallback = <div className="container"><StateBlock kind="loading"[^\n]*title="Loading…" \/><\/div>/)
    expect(app).toMatch(/if \(!ready && [^\n]*\{\n\s*page = lazyRouteFallback\n/)
  })

  it('no longer contains the retired loading-block markup', () => {
    expect(app).not.toContain('loading-block')
  })

  it('announces the loading state as a status, as the old start-up gate did', () => {
    expect(stateBlockRole('loading')).toBe('status')
  })
})

describe('app shell error boundary (P1)', () => {
  it('renders the crash fallback through StateBlock kind="failed", which announces as an alert', () => {
    expect(boundary).toMatch(/<StateBlock\s+kind="failed"/)
    expect(stateBlockRole('failed')).toBe('alert')
  })

  it('keeps every recovery action, the reload guard and the error report', () => {
    for (const label of ['Reload the app', 'Try again', 'Clear saved data…', 'Clear and reload', 'Cancel']) {
      expect(boundary).toContain(label)
    }
    expect(boundary).toMatch(/removeItem\(RELOAD_FLAG\)[\s\S]{0,80}location\.reload\(\)/)
    expect(boundary).toContain("console.error('YatraFlow crashed:'")
  })

  it('never draws the crash fallback as an empty state', () => {
    expect(boundary).not.toContain('empty-state')
  })
})

describe('app shell footer (P1)', () => {
  it('keeps the footer element, the feedback link and the calculator link', () => {
    expect(app).toContain('<footer className="footer">')
    expect(app).toContain('Send feedback')
    expect(app).toContain('href="/ladakh-trip-cost-calculator/"')
  })
})
