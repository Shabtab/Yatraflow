import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Trip } from '../data/types'
import { currentUser, updateTrip } from '../store/store'
import { fetchFirstAvailableThumb, pickTripQueryCandidates, sizedCoverUrl } from '../lib/tripThumb'
import { useDestinationCover } from '../hooks/useDestinationCover'
import { COVER_TYPES, coverFileError, uploadCover } from '../lib/coverUpload'

/**
 * Owner-facing control to set / change / clear a trip's cover image.
 *   • "Use destination photo" fetches a popular Wikipedia image of the trip's
 *     headline destination and stores it as coverImageUrl (the default the
 *     product prefers — see types.ts), sized through `Special:Redirect` so no
 *     row ever holds a multi-megabyte original.
 *   • A custom URL lets the owner override with any image.
 *   • "Use emoji only" clears the image so the card falls back to the emoji.   *   • "Upload image" shrinks a picked photo to 1200px, re-encodes it as JPEG
 *     and stores it in our own public bucket (lib/coverUpload.ts), so the
 *     creator is not limited to photos someone else hosts. Replacing one adds
 *     a new object and leaves the old in place — see uploadCover for why.
 * The choice is carried over on fork / publish via store.ts.
 */
/**
 * Whether a storage failure means the `covers` bucket itself is absent.
 *
 * Matched on the SUPABASE ERROR SHAPE rather than on the whole sentence the
 * picker would have shown: `uploadCover` wraps the message as `Upload failed:
 * <message>`, so a substring test against the full string is brittle by
 * construction and would break the moment that wrapper changed. A missing
 * bucket is a deployment state (`20260919_covers_bucket.sql` unapplied), which
 * is worth its own sentence; everything else keeps the raw message, because a
 * real refusal (policy, size, network) IS something a creator can act on.
 */
function isBucketMissing(message: string | undefined): boolean {
  if (!message) return false
  return /bucket not found|not found|404/i.test(message) && /bucket/i.test(message)
}

/**
 * A cover URL the publish form, this picker and the OG handler all accept.
 *
 * ONE literal, three call sites, and `tests/share-preview.test.ts` pins all
 * three to it — which is the only reason they cannot drift. The picker used to
 * accept literally any string, so a pasted `http://…`, a bare word or a
 * non-image URL was stored happily and only discovered at publish time (or,
 * worse, published and then previewed as the brand card because the handler's
 * `^https://\S+$` refused it). Refusing here names the field instead.
 *
 * It is deliberately the SAME test the handler runs, not a stricter one: a
 * stricter picker would reject an address the handler accepts, which is the
 * same class of disagreement in the other direction.
 */
const COVER_URL_PATTERN = /^https:\/\/\S+$/

/** Why a pasted cover URL cannot be used, in the creator's words. null = fine. */
export function coverUrlError(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null // empty is "no value typed", not a bad value
  if (!COVER_URL_PATTERN.test(v)) {
    return 'That doesn’t look like an https image URL — it must start with https:// and contain no spaces.'
  }
  return null
}

export function CoverImagePicker({ trip, editable, error: externalError }: {
  trip: Trip
  editable: boolean
  /** #389 — the host form's own validation message for the cover rule. Two of
   *  the six publish rules target this control and it took no `error` prop, so
   *  a refused publish said "add a cover photo" with nothing on the control it
   *  was talking about. Rendered in the SAME `role="status"` channel as this
   *  component's own messages, so the two cannot shout over each other. */
  error?: string | null
}) {
  // Which of the two long operations is running, not merely that one is. They
  // share both buttons' `disabled`, but a single boolean would make the
  // destination button claim "Finding photo…" while an upload is what is
  // actually in flight.
  const [busy, setBusy] = useState<'auto' | 'upload' | null>(null)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  // #389 — the picker's own message wins over the host form's, because it is
  // the more specific one ("no suggested photo found" is actionable where
  // "add a cover photo" is not), and the control's aria wiring points at
  // whichever is actually shown. One node, never two stacked error lines.
  const showError = error ?? externalError ?? null
  const fileRef = useRef<HTMLInputElement>(null)
  // Try the headline destination first, then earlier stops / start city, so
  // a single "no photo on Wikipedia" page doesn't make the cover picker look
  // empty when a perfectly good image exists for the next stop.
  const candidates = pickTripQueryCandidates(trip)
  const auto = useDestinationCover(candidates)
  const current = trip.coverImageUrl ? sizedCoverUrl(trip.coverImageUrl) : (auto ?? null)

  function setCover(url: string | undefined) {
    // Size on the way IN: a row written before sizing existed is fixed at
    // render time, but nothing should write a new oversized URL either.
    updateTrip(trip.id, { coverImageUrl: url ? sizedCoverUrl(url) : undefined })
    // A new cover is the answer to whatever the last refusal was about, so a
    // stale "that image is 12 MB" must not outlive it.
    setError(null)
  }
  async function onAuto() {
    setBusy('auto')
    setError(null)
    try {
      const u = await fetchFirstAvailableThumb(candidates)
      // #390 — `fetchFirstAvailableThumb` never throws (a total miss resolves
      // `undefined`), so this used to clear the cover in silence: the button
      // reset, nothing appeared, and the only sign anything happened was a
      // cover that had quietly gone away. Say it through the same polite
      // channel as every other picker message.
      if (u) { setCover(u); return }
      setError('No suggested photo found for these places — paste a URL or upload an image instead.')
    } catch (e) {
      console.error('[yatraflow] destination cover lookup failed', e)
      setError('Couldn’t look up a destination photo just now — check your connection.')
    } finally { setBusy(null) }
  }
  function onCustom() {
    const v = custom.trim()
    if (!v) return
    // #390 — validated BEFORE storing, with the same literal the publish form
    // and the OG handler use. Storing an address the handler will later refuse
    // is how a published link ends up previewing as the brand card instead of
    // the photo its own page is showing.
    const refusal = coverUrlError(v)
    if (refusal) { setError(refusal); return }
    setCover(v)
    setCustom('')
  }
  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset first: picking the same file twice must still fire a change event.
    e.target.value = ''
    if (!file) return
    const refusal = coverFileError(file)
    if (refusal) { setError(refusal); return }
    const me = currentUser()
    if (!me) { setError('Sign in again to upload an image.'); return }
    setError(null)
    setBusy('upload')
    try {
      // The *uploader* owns the object, not the trip owner: an editor setting a
      // cover uploads under their own id, which is what the bucket's policies
      // require.
      const { url, error: uploadError } = await uploadCover(me.id, file)
      if (uploadError || !url) {
        // #390 — a missing `covers` bucket is a DEPLOYMENT state (the migration
        // has not been run), not a bad file, and the raw text said so verbatim
        // ("Upload failed: Bucket not found"). Classified here rather than by
        // string-matching the whole sentence, and the raw message is logged so
        // the cause is still diagnosable — the creator gets a way forward
        // instead of a storage-layer term.
        if (isBucketMissing(uploadError)) {
          console.error('[yatraflow] cover upload failed — storage bucket missing', uploadError)
          setError('Cover uploads aren’t set up on this project yet — an emoji or a pasted image URL still works.')
          return
        }
        setError(uploadError ?? 'Upload failed.')
        return
      }
      setCover(url)
    } finally { setBusy(null) }
  }

  return (
    <div className="cover-picker">
      <div
        className="cover-picker-preview"
        style={current ? { backgroundImage: `url("${current}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        {!current && <span className="cover-picker-emoji">{trip.coverEmoji}</span>}
      </div>
      {editable && (
        <div className="cover-picker-controls">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy !== null} onClick={onAuto}>
            {busy === 'auto' ? 'Finding photo…' : trip.coverImageUrl ? 'Refresh destination photo' : 'Use destination photo'}
          </button>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            {busy === 'upload' ? 'Uploading…' : 'Upload image'}
          </button>
          <input
            ref={fileRef} type="file" accept={COVER_TYPES.join(',')} className="sr-only"
            onChange={onPick} tabIndex={-1} aria-hidden="true"
          />
          <div className="cover-picker-custom">
            <input
              className="input" placeholder="Paste an image URL…" value={custom}
              aria-invalid={showError ? true : undefined}
              aria-describedby={showError ? 'cover-picker-error' : undefined}
              onChange={e => { setCustom(e.target.value); if (error) setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onCustom() } }}
            />
            <button type="button" className="btn btn-outline btn-sm" onClick={onCustom}>Set</button>
          </div>
          {/* Field-tied, so polite — FormErrorSummary (when the host form mounts
              one) owns the assertive beat. #389: the host form's own cover
              message and this component's messages share ONE node, so the
              control's `aria-describedby` points at something real and the two
              cannot stack into a wall of red. The picker's own message wins when
              both are present — it is the more specific one. */}
          {showError && <p id="cover-picker-error" className="err-text" role="status" aria-live="polite">{error}</p>}
          {trip.coverImageUrl && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCover(undefined)}>Use emoji only</button>
          )}
        </div>
      )}
    </div>
  )
}
