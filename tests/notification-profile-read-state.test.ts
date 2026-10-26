import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { routeParts } from '../src/lib/pageTitle'

const { resumeSync } = vi.hoisted(() => ({ resumeSync: vi.fn(async () => {}) }))

// The retry's contract is that it reaches the store's authorized re-hydration.
// Everything else about the store is the real module.
vi.mock('../src/store/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/store/store')>()),
  resumeSync,
}))

const {
  NotificationReadNotice,
  NotificationPanelContent,
  ProfileLookupNotice,
  needsProfileLookup,
  notificationPanelModel,
  profileLookupState,
  profileLookupBlocksRoute,
  retryProfileLookup,
} = await import('../src/App')
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

  it('shows an account with no trips as empty, not as loading for good', () => {
    // hydrate issues no notifications read for an account with no trips, so the
    // slice is unreported while the trips verdict is in.
    expect(notificationPanelModel({ trips: 'ok', profiles: 'ok' }, [], 'userA')).toEqual({
      rows: [], view: 'empty',
    })
    // A failed trips read says nothing about notifications: still not empty.
    expect(notificationPanelModel({ trips: 'failed' }, [], 'userA')).toEqual({
      rows: [], view: 'reading',
    })
    // A failed notifications read stays failed whatever trips says.
    expect(notificationPanelModel({ trips: 'ok', notifications: 'failed' }, [], 'userA')).toEqual({
      rows: [], view: 'failed',
    })
  })

  it('keeps an authenticated profile available after a failed refresh', () => {
    // The verdict argument has no default: a caller that omits it would silently
    // treat a failed read as settled.
    expect(needsProfileLookup('userA', false, 'ready')).toBe(true)
    expect(needsProfileLookup('userA', true, 'ready')).toBe(false)
    expect(needsProfileLookup('userA', false, 'reading')).toBe(true)
    // A row plus a read still in flight is settled: the previous row stands.
    expect(needsProfileLookup('userA', true, 'reading')).toBe(false)
    expect(needsProfileLookup('userA', true, 'failed')).toBe(true)
    expect(needsProfileLookup(null, false, 'failed')).toBe(false)
    expect(profileLookupState('userA', false, { profiles: 'ok' })).toBe('missing')
    expect(profileLookupState('userA', false, {})).toBe('reading')
    expect(profileLookupState(null, false, { profiles: 'failed' })).toBe('anonymous')
  })

  it('a stale private row does not certify an account whose latest read failed', () => {
    // Root's executable probe at 2c31f6bd recorded this exact hole
    // (owner-edge-ui-2c31f6bd.json, "Stale private profile does not hide failure
    // and retry"): a private row left over from an earlier successful read made
    // `hasProfile` true, the lookup read as settled, and the failure notice with
    // its working retry never rendered. The read's own verdict outranks whatever
    // the cache happens to still hold.
    expect(profileLookupState('userA', true, { 'self profile': 'failed' })).toBe('failed')
    expect(profileLookupState('userA', true, { profiles: 'failed' })).toBe('failed')
    // A row under a read that SUCCEEDED is still a ready account.
    expect(profileLookupState('userA', true, { 'self profile': 'ok', profiles: 'ok' })).toBe('ready')
    // Nothing has been read yet and nothing contradicts the row: still ready.
    expect(profileLookupState('userA', true, {})).toBe('ready')
    // A read still in flight with no row yet is loading, not missing — and not
    // an account that read as missing either.
    expect(profileLookupState('userA', false, { 'self profile': 'ok' })).toBe('reading')
    // Both reads settled with no row: that IS a completed lookup with no account.
    expect(profileLookupState('userA', false, { 'self profile': 'ok', profiles: 'ok' })).toBe('missing')
    // And the lookup is still outstanding, so its notice is reachable.
    expect(needsProfileLookup('userA', true, 'failed')).toBe(true)
    expect(needsProfileLookup('userA', true, 'ready')).toBe(false)
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

  it('renders a profile failure and its Try again re-issues the authorized read', async () => {
    const failed = renderToStaticMarkup(createElement(ProfileLookupNotice, { state: 'failed' }))
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    resumeSync.mockClear()

    await retryProfileLookup()

    expect(failed).toContain('role="alert"')
    expect(failed).toContain('Your profile could not load.')
    expect(failed).toContain('Try again')
    // The retry reaches the authorized re-hydration under the same generation,
    // rather than reloading the whole app and re-reading the public catalogue
    // that already succeeded.
    expect(resumeSync).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
  })

  it('lets a failed profile lookup take the bare route, and keeps the landing while the lookup reads', () => {
    expect(profileLookupBlocksRoute('userA', false, 'failed', true, false)).toBe(true)
    expect(profileLookupBlocksRoute('userA', false, 'reading', true, false)).toBe(false)
    expect(profileLookupBlocksRoute('userA', false, 'missing', true, false)).toBe(false)
    expect(profileLookupBlocksRoute('userA', false, 'reading', true, true)).toBe(true)
    expect(profileLookupBlocksRoute('userA', false, 'reading', false, false)).toBe(true)
    // A stale private row does not settle the lookup, so a failed read still
    // takes the route and its Try again is never hidden behind the landing.
    expect(profileLookupBlocksRoute('userA', true, 'failed', true, false)).toBe(true)
    expect(profileLookupBlocksRoute('userA', true, 'ready', true, false)).toBe(false)
    expect(profileLookupBlocksRoute(null, false, 'anonymous', true, false)).toBe(false)
    // The invite gate passes the profile notice as actions, so it does not sit inside a paragraph.
    expect(appSource).not.toContain('body={<ProfileLookupNotice')
    expect(appSource).toContain('actions={<ProfileLookupNotice state={profileState} />}')
  })

  it('wires the helpers to the current-user notification list and known-session route', () => {
    const inviteGate = appSource.slice(appSource.indexOf('function InviteGate'))
    const profileGate = inviteGate.indexOf('if (needsProfileLookup(db.sessionUserId, !!me, profileState))')
    const signInActions = inviteGate.indexOf('Log in or create a free account')

    expect(appSource).toContain('notificationPanelModel(sliceReads, notifications, sessionUserId)')
    expect(appSource).toContain('<NotificationPanelContent')
    expect(appSource).toContain('<NotificationReadNotice view={view} onRetry={onRetry} />')
    expect(appSource).toContain('profileLookupState(sessionUserId, !!me, sliceReads)')
    expect(appSource).toContain('<ProfileLookupNotice state={profileState} />')
    expect(appSource).toMatch(/else if \(profileLookupBlocksRoute\(sessionUserId, !!me, profileState, bareRoute, isNative\)\) page = <ProfileLookupPage state=\{profileState\} \/>/)
    expect(appSource).toContain('needsProfileLookup(sessionUserId, hasProfile, state)')
    expect(appSource).toContain('needsProfileLookup(db.sessionUserId, !!me, profileState)')
    expect(appSource).toContain('window.location.reload()')
    expect(appSource).toContain('className="container page-enter yf-page"')
    expect(appSource).toContain('{!me && !sessionUserId && parts[0] !== \'auth\' && (')
    expect(routeParts('/')).toEqual([])
    expect(routeParts('/?utm_source=x')).toEqual([''])
    expect(appSource).toContain("const bareRoute = parts[0] === undefined || parts[0] === ''")
    expect(appSource).toContain('profileLookupBlocksRoute(sessionUserId, !!me, profileState, bareRoute, isNative)')
    expect(profileGate).toBeGreaterThan(-1)
    expect(profileGate).toBeLessThan(signInActions)
    expect(appSource).toMatch(/profileLookupPending \? \(\s*<ProfileLookupNotice state=\{profileState\} \/>/)
  })
})
