// P5 Trip created: the honesty of its states (ruling R23).
//
// These are the page's own decisions, imported from the page's own module, so
// the rules pinned here are the ones the page follows. A read that fails must
// never look like empty data, and a write must never report success before it
// has a result.
import { describe, expect, it } from 'vitest'
import {
  createdReadView, inviteRowStatus, createdInviteUrl, createdCanSend,
  windowDidOpen, clipboardDidCopy, shareDidSend, inviteReadError,
} from '../src/lib/createdStates'

describe('createdReadView', () => {
  it('shows a failed read as failed, never as empty', () => {
    expect(createdReadView({ loading: false, failed: true, rows: 0 })).toBe('failed')
  })

  it('shows a failed read as failed even when stale rows are still held', () => {
    expect(createdReadView({ loading: false, failed: true, rows: 3 })).toBe('failed')
  })

  it('shows a successful read with rows as rows', () => {
    expect(createdReadView({ loading: false, failed: false, rows: 2 })).toBe('rows')
  })

  it('shows a successful read with no rows as empty', () => {
    expect(createdReadView({ loading: false, failed: false, rows: 0 })).toBe('empty')
  })

  it('shows a read in flight with nothing yet as reading', () => {
    expect(createdReadView({ loading: true, failed: false, rows: 0 })).toBe('reading')
  })

  it('shows a read in flight that already failed as failed, not reading', () => {
    expect(createdReadView({ loading: true, failed: true, rows: 0 })).toBe('failed')
  })
})

describe('inviteRowStatus', () => {
  it('is idle before any attempt', () => {
    expect(inviteRowStatus(null)).toBe('idle')
  })

  it('is opened only when the window opened', () => {
    expect(inviteRowStatus({ opened: true })).toBe('opened')
  })

  it('is blocked, not opened, when the popup blocker stopped the window', () => {
    expect(inviteRowStatus({ blocked: true })).toBe('blocked')
  })

  it('is copied only after the clipboard write resolves', () => {
    expect(inviteRowStatus({ copied: true })).toBe('copied')
  })

  it('is idle after a refused clipboard write, so the row does not read as copied', () => {
    expect(inviteRowStatus({})).toBe('idle')
  })
})

describe('createdInviteUrl', () => {
  it('builds the join link from the code', () => {
    expect(createdInviteUrl('https://yatraflow.app', 'abc123')).toBe('https://yatraflow.app/join/abc123')
  })

  it('has no link when the code read failed, and never falls back to the bare origin', () => {
    expect(createdInviteUrl('https://yatraflow.app', null)).toBeNull()
  })

  it('has no link when the code is an empty string', () => {
    expect(createdInviteUrl('https://yatraflow.app', '')).toBeNull()
  })
})

describe('createdCanSend', () => {
  it('allows a send when a link exists', () => {
    expect(createdCanSend('https://yatraflow.app/join/abc123')).toBe(true)
  })

  it('refuses a send with no link', () => {
    expect(createdCanSend(null)).toBe(false)
  })

  it('refuses a send with an empty link', () => {
    expect(createdCanSend('')).toBe(false)
  })
})

describe('windowDidOpen', () => {
  it('is opened when the browser returned a window', () => {
    expect(windowDidOpen({} as Window)).toBe(true)
  })

  it('is not opened when a popup blocker returned null', () => {
    expect(windowDidOpen(null)).toBe(false)
  })
})

describe('clipboardDidCopy', () => {
  it('is copied when the clipboard write resolved true', () => {
    expect(clipboardDidCopy(true)).toBe(true)
  })

  it('is not copied when the clipboard write resolved false', () => {
    expect(clipboardDidCopy(false)).toBe(false)
  })

  it('is not copied when the clipboard write rejected', () => {
    expect(clipboardDidCopy(new Error('denied'))).toBe(false)
  })
})

describe('shareDidSend', () => {
  it('is sent only when the share sheet resolved shared', () => {
    expect(shareDidSend('shared')).toBe(true)
  })

  it('is not sent when the share sheet is unavailable', () => {
    expect(shareDidSend('unavailable')).toBe(false)
  })
})

describe('inviteReadError', () => {
  it('is a failure when the read gave no code', () => {
    expect(inviteReadError(null)).toBe('unavailable')
  })

  it('is not a failure when the read gave a code', () => {
    expect(inviteReadError('abc123')).toBeNull()
  })
})
