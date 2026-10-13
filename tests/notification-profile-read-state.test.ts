import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { routeParts } from '../src/lib/pageTitle'
import {
  NotificationReadNotice,
  NotificationPanelContent,
  ProfileLookupNotice,
  needsProfileLookup,
  notificationPanelModel,
  profileLookupState,
  profileLookupTakesPage,
  retryProfileLookup,
} from '../src/App'
import type { Notification } from '../src/data/types'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function notification(id: string, userId: string, at: number): Notification {
  return { id, userId, text: id, read: false, at }
}

afterEach(() => vi.unstubAllGlobals())

describe('notification read state', () => {
  it('filters to the signed-in user before it chooses a failed or kept view', () => {
    const rows = [notification('mine', 'userA', 1), notification('theirs', 'userB', 2)]

    expect(notificationPanelModel({ notifications: 'failed' }, rows, 'userA')).toEqual({
      rows: [rows[0]], view: 'kept',
    })
    expect(notificationPanelModel({ notifications: 'failed' }, rows, 'userC')).toEqual({
      rows: [], view: 'failed',
    })
    expect(notificationPanelModel({ notifications: 'ok' }, [], 'userA')).toEqual({
      rows: [], view: 'empty',
    })
    expect(notificationPanelModel({}, [], 'userA')).toEqual({ rows: [], view: 'reading' })
  })

  it('keeps an authenticated profile available after a failed refresh', () => {
    expect(needsProfileLookup('userA', false)).toBe(true)
    expect(needsProfileLookup('userA', true)).toBe(false)
    expect(needsProfileLookup(null, false)).toBe(false)
    expect(profileLookupState('userA', true, { profiles: 'failed' })).toBe('ready')
    expect(profileLookupState('userA', false, { profiles: 'failed' })).toBe('failed')
    expect(profileLookupState('userA', false, {})).toBe('reading')
    expect(profileLookupState('userA', false, { profiles: 'ok' })).toBe('missing')
    expect(profileLookupState(null, false, { profiles: 'failed' })).toBe('anonymous')
  })

  it('renders failed, kept, and loading notification notices with their real roles', () => {
    const failed = renderToStaticMarkup(createElement(NotificationReadNotice, {
      view: 'failed', onRetry: () => {},
    }))
    const kept = renderToStaticMarkup(createElement(NotificationReadNotice, {
      view: 'kept', onRetry: () => {},
    }))
    const reading = renderToStaticMarkup(createElement(NotificationReadNotice, {
      view: 'reading', onRetry: () => {},
    }))

    expect(failed).toContain('role="alert"')
    expect(failed).toContain('Try again')
    expect(kept).toContain('role="status"')
    expect(kept).toContain('Refresh failed. The app shows your last notifications.')
    expect(kept).toContain('Try again')
    expect(reading).toContain('role="status"')
    expect(renderToStaticMarkup(createElement(NotificationReadNotice, {
      view: 'empty', onRetry: () => {},
    }))).toBe('')
  })

  it('renders real panel failure and kept states without claiming an empty inbox', () => {
    const retry = vi.fn()
    const openTrip = vi.fn()
    const failed = renderToStaticMarkup(createElement(NotificationPanelContent, {
      model: notificationPanelModel({ notifications: 'failed' }, [], 'userA'),
      showAll: false,
      onRetry: retry,
      onOpenTrip: openTrip,
    }))
    const keptRows = [notification('still-here', 'userA', 1)]
    const kept = renderToStaticMarkup(createElement(NotificationPanelContent, {
      model: notificationPanelModel({ notifications: 'failed' }, keptRows, 'userA'),
      showAll: false,
      onRetry: retry,
      onOpenTrip: openTrip,
    }))
    const empty = renderToStaticMarkup(createElement(NotificationPanelContent, {
      model: notificationPanelModel({ notifications: 'ok' }, [], 'userA'),
      showAll: false,
      onRetry: retry,
      onOpenTrip: openTrip,
    }))

    expect(failed).toContain('role="alert"')
    expect(failed).toContain('Try again')
    expect(failed).not.toContain('You’re all caught up')
    expect(kept).toContain('role="status"')
    expect(kept).toContain('The app shows your last notifications.')
    expect(kept).toContain('Try again')
    expect(kept).toContain('still-here')
    expect(kept).not.toContain('You’re all caught up')
    expect(empty).toContain('You’re all caught up')
  })

  it('renders a profile failure instead of a signed-out screen and retries the current URL', () => {
    const failed = renderToStaticMarkup(createElement(ProfileLookupNotice, { state: 'failed' }))
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })

    retryProfileLookup()

    expect(failed).toContain('role="alert"')
    expect(failed).toContain('Your profile could not load.')
    expect(failed).toContain('Try again')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('lets a failed profile lookup take the bare route, and keeps the landing while the lookup reads', () => {
    expect(profileLookupTakesPage('userA', false, 'failed', true, false)).toBe(true)
    expect(profileLookupTakesPage('userA', false, 'reading', true, false)).toBe(false)
    expect(profileLookupTakesPage('userA', false, 'missing', true, false)).toBe(false)
    expect(profileLookupTakesPage('userA', false, 'reading', true, true)).toBe(true)
    expect(profileLookupTakesPage('userA', false, 'reading', false, false)).toBe(true)
    expect(profileLookupTakesPage('userA', true, 'failed', true, false)).toBe(false)
    expect(profileLookupTakesPage(null, false, 'anonymous', true, false)).toBe(false)
    // The invite gate passes the profile notice as actions, so it does not sit inside a paragraph.
    expect(appSource).not.toContain('body={<ProfileLookupNotice')
    expect(appSource).toContain('actions={<ProfileLookupNotice state={profileState} />}')
  })

  it('wires the helpers to the current-user notification list and known-session route', () => {
    const inviteGate = appSource.slice(appSource.indexOf('function InviteGate'))
    const profileGate = inviteGate.indexOf('if (needsProfileLookup(db.sessionUserId, !!me))')
    const signInActions = inviteGate.indexOf('Log in or create a free account')

    expect(appSource).toContain('notificationPanelModel(sliceReads, notifications, sessionUserId)')
    expect(appSource).toContain('<NotificationPanelContent')
    expect(appSource).toContain('<NotificationReadNotice view={view} onRetry={onRetry} />')
    expect(appSource).toContain('profileLookupState(sessionUserId, !!me, sliceReads)')
    expect(appSource).toContain('<ProfileLookupNotice state={profileState} />')
    expect(appSource).toMatch(/else if \(profileLookupTakesPage\(sessionUserId, !!me, profileState, bareRoute, isNative\)\) page = <ProfileLookupPage state=\{profileState\} \/>/)
    expect(appSource).toContain('needsProfileLookup(sessionUserId, hasProfile)')
    expect(appSource).toContain('needsProfileLookup(db.sessionUserId, !!me)')
    expect(appSource).toContain('window.location.reload()')
    expect(appSource).toContain('className="container page-enter yf-page"')
    expect(appSource).toContain('{!me && !sessionUserId && parts[0] !== \'auth\' && (')
    expect(routeParts('/')).toEqual([])
    expect(routeParts('/?utm_source=x')).toEqual([''])
    expect(appSource).toContain("const bareRoute = parts[0] === undefined || parts[0] === ''")
    expect(appSource).toContain('profileLookupTakesPage(sessionUserId, !!me, profileState, bareRoute, isNative)')
    expect(profileGate).toBeGreaterThan(-1)
    expect(profileGate).toBeLessThan(signInActions)
    expect(appSource).toMatch(/profileLookupPending \? \(\s*<ProfileLookupNotice state=\{profileState\} \/>/)
  })
})
