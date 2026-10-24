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

/** Whether the queued copy can be exported as a trip file. */
function exportableCopy(write: QueuedWrite): boolean {
  const trip = write.trip as Trip | null
  return !!trip && trip.id === write.tripId && typeof trip.name === 'string' && Array.isArray(trip.days)
}

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
  // A copy that lost the right to write is not waiting to sync. It is held.
  const held = writes.filter(write => !!write.reason).length
  const waiting = writes.length - held

  /**
   * The notice for a discard that did not complete.
   *
   * A copy with no reason is the local overlay on screen, and its removal
   * needs the shared plan to replace it. When the removal of a held overlay
   * is refused, the shared plan could not be read, so the cause is named. If
   * the device is offline, the retry only helps once it is back online. A
   * copy WITH a reason is never an overlay, so it is removed either way and
   * never gets that wording.
   */
  function discardFailureNotice(write: QueuedWrite | null): string {
    const overlayOnScreen = !!write && !write.reason
    if (!overlayOnScreen) return 'The saved copy was not removed. Try again.'
    return online
      ? 'The saved copy was not removed. The shared plan could not be read. Try again.'
      : 'The saved copy was not removed. The shared plan could not be read. Try again when you are back online.'
  }

  /**
   * Remove a kept copy from this device.
   *
   * This is a LOCAL action. It removes the copy from this device and writes
   * nothing to the server, so it works without a connection. The network
   * choices above it are the ones that need a connection.
   */
  async function removeCopy(write: QueuedWrite) {
    if (!userId || identityRef.current !== identity || getSnapshot().sessionUserId !== userId
      || write.ownerId !== userId || actionRef.current?.identity === identity) return
    const runId = { identity, tripId: write.tripId }
    actionRef.current = runId
    setAction(runId)
    setNotice(null)
    try {
      const removed = await resolveQueuedTripWrite(write.tripId, 'discard')
      if (identityRef.current !== identity) return
      await refreshRef.current?.()
      if (identityRef.current !== identity) return
      if (removed) {
        setNotice({ identity, text: 'The saved copy was removed from this device.', failed: false })
        return
      }
      setNotice({ identity, text: discardFailureNotice(write), failed: true })
    } catch {
      if (identityRef.current !== identity) return
      setNotice({ identity, text: 'Could not remove this copy. Try again.', failed: true })
    } finally {
      if (actionRef.current === runId) {
        actionRef.current = null
        setAction(null)
      }
    }
  }
  async function recover(tripId: string | null, choice: RecoveryChoice = 'retry') {
    if (!userId || !online || identityRef.current !== identity || getSnapshot().sessionUserId !== userId
      || actionRef.current?.identity === identity) return
    // The guard asks "is this still the action I started". It compares two
    // in-memory object identities, so it is not a secret comparison.
    const runId = { identity, tripId }
    actionRef.current = runId
    setAction(runId)
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
        // A failed discard names its cause, so the advice matches it. The
        // held-copy buttons reach this handler, so the message has to live
        // here and not only in the removal handler.
        const discarded = choice === 'discard'
        const held = discarded ? writes.find(w => w.tripId === tripId) ?? null : null
        setNotice({
          identity,
          text: discarded
            ? discardFailureNotice(held)
            : 'This action did not save a change. Check your trip access and connection.',
          failed: true,
        })
      } else if (tripId) {
        const text = choice === 'discard'
          ? 'The saved edit was removed from this device. The shared plan stays unchanged.'
          : 'Your saved edit synced.'
        setNotice({ identity, text, failed: false })
      } else {
        setNotice({ identity, text: 'Sync check finished. Check any edits that remain.', failed: false })
      }
      summaryRef.current?.focus({ preventScroll: true })
    } catch {
      if (identityRef.current !== identity) return
      setNotice({ identity, text: 'Could not finish this action. Check saved edits and your connection.', failed: true })
    } finally {
      if (actionRef.current === runId) {
        actionRef.current = null
        setAction(null)
      }
    }
  }

  /**
   * Export the account's own saved copy.
   *
   * The copy is already on this device, so the export needs the queued owner
   * and the current identity. It does NOT need a live edit role: a demoted
   * editor still owns the copy they made. The queued snapshot's own name is
   * never shown, because it may name a trip the account can no longer read.
   */
  function download(write: QueuedWrite) {
    const current = getSnapshot()
    const owns = current.sessionUserId === userId && userId !== null
    if (!userId || identityRef.current !== identity || write.ownerId !== userId || !owns) return
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
          {waiting > 0 && `${waiting} trip edit${waiting === 1 ? '' : 's'} waiting to sync.`}{' '}
          {held > 0 && `${held} trip edit${held === 1 ? '' : 's'} kept on this device.`}{' '}
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
            // The title comes from the trip the account can READ. The queued
            // snapshot's own name is never shown, because it may name a trip
            // the account can no longer read.
            const readableTrip = db.trips.find(trip => trip.id === write.tripId && trip.members?.some(member => member.userId === userId))
            const title = readableTrip?.name || 'Saved trip edit'
            const conflict = write.state === 'conflict'
            const failed = write.state === 'failed'
            const sending = busy && action?.tripId === write.tripId
            // A copy the account cannot export must not promise a download.
            const exportable = exportableCopy(write)
            const reason = write.reason
            return (
              <li className="offline-recovery-row" key={write.tripId}>
                <div className="offline-recovery-copy">
                  <strong>{title}</strong>
                  <p>
                    {reason === 'access-revoked'
                      ? 'You can no longer edit this trip. Your saved copy stays on this device.'
                      : reason === 'access-removed'
                        ? 'You are no longer on this trip. Your saved copy stays on this device.'
                        : reason === 'trip-unavailable'
                          ? 'This trip is no longer on the server. Your saved copy stays on this device.'
                          : conflict
                            ? 'The shared plan has newer changes. Replacing it removes those changes.'
                            : write.storageFailed
                              ? 'This edit has not synced.'
                              : failed
                                ? 'This edit could not sync. Your saved copy stays on this device.'
                                : 'Waiting to sync. Your saved copy stays on this device.'}
                  </p>
                  {write.storageFailed && (
                    <p role="alert">
                      {exportable
                        ? 'Device storage is unavailable. Keep this tab open and download your copy.'
                        : 'Device storage is unavailable. This copy stays in this tab only, and it cannot be exported.'}
                    </p>
                  )}
                  {conflict && (
                    // The download is only offered when the copy can be
                    // exported, so the instruction must not promise one that
                    // is not there.
                    <p>
                      Use shared plan discards your saved edit.
                      {exportable ? ' Download your copy before you choose.' : ''}
                    </p>
                  )}
                  {reason && !exportable && <p role="alert">This copy cannot be exported. It stays on this device.</p>}
                </div>
                <div className="offline-recovery-actions">
                  {exportable && (
                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => download(write)}>
                      Download my copy
                    </button>
                  )}
                  {reason ? (
                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => { void removeCopy(write) }}>
                      Remove saved copy
                    </button>
                  ) : conflict ? (
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
