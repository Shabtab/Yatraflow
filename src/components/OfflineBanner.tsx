// Connection state and saved edits share one account-scoped recovery surface.
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSnapshot, resolveQueuedTripWrite, resumeSync, useDb } from '../store/store'
import { formatHM, useTimeFormat } from '../lib/timefmt'
import { pendingWrites, subscribePendingWrites, type QueuedWrite } from '../lib/writeQueue'
import { downloadTripJson } from '../lib/snapshot'
import type { Trip } from '../data/types'

type RecoveryChoice = 'retry' | 'replace' | 'discard'
type Identity = { userId: string | null }
type RecoveryAction = { identity: Identity; tripId: string | null }

export function OfflineBanner() {
  const db = useDb()
  const userId = db.sessionUserId
  const timeFormat = useTimeFormat()
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const [saved, setSaved] = useState<{ identity: Identity; writes: QueuedWrite[]; error: string | null } | null>(null)
  const [action, setAction] = useState<RecoveryAction | null>(null)
  const [notice, setNotice] = useState<{ identity: Identity; text: string; failed: boolean } | null>(null)
  const identity = useMemo<Identity>(() => ({ userId }), [userId])
  const identityRef = useRef<Identity | null>(null)
  const actionRef = useRef<RecoveryAction | null>(null)
  const refreshRef = useRef<(() => Promise<void>) | null>(null)
  const summaryRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    identityRef.current = identity
    let alive = true
    let readId = 0
    const refresh = async () => {
      const currentRead = ++readId
      if (!userId) return
      try {
        const writes = await pendingWrites()
        if (!alive || identityRef.current !== identity || currentRead !== readId) return
        setSaved({ identity, writes: writes.filter(write => write.ownerId === userId), error: null })
      } catch {
        if (!alive || identityRef.current !== identity || currentRead !== readId) return
        setSaved({ identity, writes: [], error: 'Could not read saved edits on this device. Try again.' })
      }
    }
    const refreshSoon = () => { void refresh() }
    const up = () => { setOnline(true); refreshSoon() }
    const down = () => { setOnline(false); refreshSoon() }
    refreshRef.current = refresh
    const unsubscribe = subscribePendingWrites(refreshSoon)
    refreshSoon()
    addEventListener('online', up)
    addEventListener('offline', down)
    return () => {
      alive = false
      if (identityRef.current === identity) identityRef.current = null
      readId += 1
      unsubscribe()
      if (refreshRef.current === refresh) refreshRef.current = null
      removeEventListener('online', up)
      removeEventListener('offline', down)
    }
  }, [userId, identity])

  const writes = userId && saved?.identity === identity ? saved.writes : []
  const readError = userId && saved?.identity === identity ? saved.error : null
  const feedback = userId && notice?.identity === identity ? notice : null
  const busy = action?.identity === identity
  const paused = writes.filter(write => write.state === 'conflict' || write.state === 'failed').length

  async function recover(tripId: string | null, choice: RecoveryChoice = 'retry') {
    if (!userId || !online || identityRef.current !== identity || getSnapshot().sessionUserId !== userId
      || actionRef.current?.identity === identity) return
    const token = { identity, tripId }
    actionRef.current = token
    setAction(token)
    setNotice(null)
    summaryRef.current?.focus({ preventScroll: true })
    try {
      const succeeded = tripId
        ? await resolveQueuedTripWrite(tripId, choice)
        : (await resumeSync(), true)
      if (identityRef.current !== identity) return
      await refreshRef.current?.()
      if (identityRef.current !== identity) return
      if (!succeeded) {
        setNotice({ identity, text: 'This action did not save a change. Check your trip access and connection.', failed: true })
      } else if (tripId) {
        const text = choice === 'discard' ? 'The saved edit was removed. The shared plan stays unchanged.' : 'Your saved edit synced.'
        setNotice({ identity, text, failed: false })
      } else {
        setNotice({ identity, text: 'Sync check finished. Check any edits that remain.', failed: false })
      }
      summaryRef.current?.focus({ preventScroll: true })
    } catch {
      if (identityRef.current !== identity) return
      setNotice({ identity, text: 'Could not finish this action. Check saved edits and your connection.', failed: true })
    } finally {
      if (actionRef.current === token) {
        actionRef.current = null
        setAction(null)
      }
    }
  }

  function download(write: QueuedWrite) {
    const current = getSnapshot()
    const authorized = current.sessionUserId === userId
      && current.trips.some(trip => trip.id === write.tripId && trip.members?.some(member => member.userId === userId
        && (member.role === 'owner' || member.role === 'editor')))
    if (!userId || identityRef.current !== identity || write.ownerId !== userId || !authorized) return
    try {
      const trip = write.trip as Trip | null
      if (!trip || trip.id !== write.tripId || typeof trip.name !== 'string' || !Array.isArray(trip.days)) {
        throw new Error('Saved trip is not exportable')
      }
      downloadTripJson(trip)
      setNotice({ identity, text: 'Your local copy was downloaded. Keep it private.', failed: false })
    } catch {
      setNotice({ identity, text: 'Could not download this copy. Keep this tab open and try again.', failed: true })
    }
  }

  if (online && writes.length === 0 && !readError && !feedback && !busy) return null

  const clock = userId && db.cachedAt ? formatHM(new Date(db.cachedAt).toTimeString().slice(0, 5), timeFormat) : null
  const connection = online
    ? 'Trip edit recovery'
    : `No connection — showing ${clock ? `your saved plan from ${clock}` : 'what loaded last'}.`

  return (
    <section className="offline-banner" aria-label="Saved edits and connection" aria-busy={busy}>
      <div className="offline-banner-summary">
        <p ref={summaryRef} tabIndex={-1} role="status">
          <strong>{connection}</strong>{' '}
          {writes.length > 0 && `${writes.length} trip edit${writes.length === 1 ? '' : 's'} waiting to sync.`}{' '}
          {paused > 0 && `${paused} edit${paused === 1 ? ' needs' : 's need'} your attention.`}{' '}
          {!online && 'Reconnect to sync saved edits.'}
        </p>
        {userId && (
          <button className="btn btn-outline btn-sm" disabled={!online || busy} onClick={() => { void recover(null) }}>
            {busy && action?.tripId === null ? 'Checking sync…' : 'Check sync'}
          </button>
        )}
      </div>
      {readError && <p className="offline-banner-message" role="alert">{readError}</p>}
      {feedback && <p className="offline-banner-message" role={feedback.failed ? 'alert' : 'status'}>{feedback.text}</p>}
      {writes.length > 0 && (
        <ul className="offline-recovery-list">
          {writes.map(write => {
            const visibleTrip = db.trips.find(trip => trip.id === write.tripId && trip.members?.some(member => member.userId === userId
              && (member.role === 'owner' || member.role === 'editor')))
            const title = visibleTrip?.name || 'Saved trip edit'
            const conflict = write.state === 'conflict'
            const failed = write.state === 'failed'
            const sending = busy && action?.tripId === write.tripId
            return (
              <li className="offline-recovery-row" key={write.tripId}>
                <div className="offline-recovery-copy">
                  <strong>{title}</strong>
                  <p>
                    {conflict
                      ? 'The shared plan has newer changes. Replacing it removes those changes.'
                      : write.storageFailed
                        ? 'This edit has not synced.'
                        : failed
                        ? 'This edit could not sync. Your saved copy stays on this device.'
                        : 'Waiting to sync. Your saved copy stays on this device.'}
                  </p>
                  {write.storageFailed && <p role="alert">Device storage is unavailable. Keep this tab open and download your copy.</p>}
                  {conflict && <p>Use shared plan discards your saved edit. Download your copy before you choose.</p>}
                </div>
                <div className="offline-recovery-actions">
                  {visibleTrip && (
                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => download(write)}>
                      Download my copy
                    </button>
                  )}
                  {conflict ? (
                    <>
                      <button className="btn btn-outline btn-sm" disabled={!online || busy} onClick={() => { void recover(write.tripId, 'discard') }}>
                        Use shared plan
                      </button>
                      <button className="btn btn-sm" disabled={!online || busy} onClick={() => { void recover(write.tripId, 'replace') }}>
                        {sending ? 'Saving…' : 'Replace shared plan'}
                      </button>
                    </>
                  ) : (
                    <>
                      {failed && (
                        <button className="btn btn-outline btn-sm" disabled={!online || busy} onClick={() => { void recover(write.tripId, 'discard') }}>
                          Discard saved edit
                        </button>
                      )}
                      <button className="btn btn-outline btn-sm" disabled={!online || busy} onClick={() => { void recover(write.tripId) }}>
                        {sending ? 'Retrying…' : 'Retry'}
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
