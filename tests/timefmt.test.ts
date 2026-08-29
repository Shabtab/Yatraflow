// ============ timefmt — 12h/24h clock preference ============
import { describe, it, expect, beforeEach } from 'vitest'
import { formatHM, formatHMRange, getTimeFormat, setTimeFormat, useTimeFormat } from '../src/lib/timefmt'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

describe('formatHM (12h default)', () => {
  it('converts afternoon/evening times to PM', () => {
    expect(formatHM('18:30', '12h')).toBe('6:30 PM')
    expect(formatHM('13:05', '12h')).toBe('1:05 PM')
    expect(formatHM('23:59', '12h')).toBe('11:59 PM')
  })

  it('converts morning times to AM', () => {
    expect(formatHM('08:00', '12h')).toBe('8:00 AM')
    expect(formatHM('09:45', '12h')).toBe('9:45 AM')
  })

  it('handles midnight and noon edge cases', () => {
    expect(formatHM('00:15', '12h')).toBe('12:15 AM')
    expect(formatHM('00:00', '12h')).toBe('12:00 AM')
    expect(formatHM('12:00', '12h')).toBe('12:00 PM')
    expect(formatHM('12:01', '12h')).toBe('12:01 PM')
  })

  it('passes through placeholders and invalid values untouched', () => {
    expect(formatHM('', '12h')).toBe('')
    expect(formatHM('--:--', '12h')).toBe('--:--')
    expect(formatHM('99:99', '12h')).toBe('99:99')
    expect(formatHM('6 PM', '12h')).toBe('6 PM')
  })

  it('normalizes in 24h mode (zero-padded)', () => {
    expect(formatHM('8:00', '24h')).toBe('08:00')
    expect(formatHM('18:30', '24h')).toBe('18:30')
    expect(formatHM('', '24h')).toBe('')
    expect(formatHM('--:--', '24h')).toBe('--:--')
  })
})

describe('formatHMRange', () => {
  it('formats both ends', () => {
    expect(formatHMRange('09:00', '17:30', '12h')).toBe('9:00 AM–5:30 PM')
    expect(formatHMRange('09:00', '17:30', '24h')).toBe('09:00–17:30')
  })

  it('skips missing sides and empty pairs', () => {
    expect(formatHMRange('', '', '12h')).toBe('')
    expect(formatHMRange('09:00', '', '12h')).toBe('9:00 AM')
    expect(formatHMRange('', '17:30', '12h')).toBe('5:30 PM')
  })

  it('accepts undefined sides (optional fields in the data model)', () => {
    expect(formatHMRange(undefined, undefined, '12h')).toBe('')
    expect(formatHMRange('09:00', undefined, '12h')).toBe('9:00 AM')
    expect(formatHMRange(undefined, '17:30', '24h')).toBe('17:30')
    expect(formatHMRange('09:00', '17:30', '12h')).toBe('9:00 AM–5:30 PM')
  })
})

describe('preference store', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size },
    } as Storage
    // reset module state to default for each test
    setTimeFormat('12h')
  })

  it('defaults to 12h', () => {
    expect(getTimeFormat()).toBe('12h')
  })

  it('switches to 24h and persists', () => {
    setTimeFormat('24h')
    expect(getTimeFormat()).toBe('24h')
    expect(globalThis.localStorage.getItem('yatraflow_time_format')).toBe('24h')
    setTimeFormat('12h')
    expect(globalThis.localStorage.getItem('yatraflow_time_format')).toBe('12h')
  })

  it('hook reflects the current format and re-renders on change', () => {
    function Probe() {
      const fmt = useTimeFormat()
      return createElement('span', null, formatHM('18:30', fmt))
    }
    expect(renderToString(createElement(Probe))).toContain('6:30 PM')
    setTimeFormat('24h')
    expect(renderToString(createElement(Probe))).toContain('18:30')
    setTimeFormat('12h')
    expect(renderToString(createElement(Probe))).toContain('6:30 PM')
  })
})
