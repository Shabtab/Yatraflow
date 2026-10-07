// ============ Import a trip JSON ============
// One affordance, two homes: My Trips (where a user arrives with a file) and
// the trip Share tab (where they already were). It accepts both formats a user
// can arrive with — see lib/tripImport.ts for why that matters.
//
// The file input is the whole interaction: no dummy trip, no placeholder
// details to fill in first.
import { useRef, useState } from 'react'
import { InlineIcon } from './icons'
import { Upload } from 'lucide-react'
import type { ID, Trip } from '../data/types'
import { importTripPersisted, retryImportTrip } from '../store/store'
import { parseTripImport, TripImportError } from '../lib/tripImport'
import type { DroppedStopPatch, PublicationDraft } from '../lib/tripImport'
import { digestImportReport, type ImportReportDigest } from '../lib/itinerarySpec'
import { stashPublishDraft } from '../lib/publishDraft'
import { useResolvePick } from './ResolvePickDialog'
import { unnamedPick } from '../lib/resolvePick'
import { toast, ConfirmDialog } from './ui'

/** How many dropped rows get the pin prompt. A hand-edited file drops a stop
 *  or two; a corrupt one could drop dozens, and stacking dialogs past this
 *  point helps nobody — the rest stay in the import report, as before. */
const RESCUE_PROMPT_CAP = 12

export function ImportTripButton({ ownerId, onNavigate, className = 'btn btn-outline', label = 'Import JSON' }: {
  ownerId: ID | null
  onNavigate: (r: string) => void
  className?: string
  label?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  // #424 guard: rows the file could not place are offered coordinates before
  // the import lands. Hook with the others, above every exit (§6e).
  const { resolvePick, dialog: resolvePickDialog } = useResolvePick()
  // #551 — a save that failed holds the built copy for a same-object retry:
  // its id is the idempotency key, so a first save that reached the server is
  // not followed by a twin (#374's rule). `digest` rides along so the retry's
  // success tells the same story the first save would have.
  const [pending, setPending] = useState<{
    trip: Trip; summary: string; note: string; digest: ImportReportDigest | null; offer?: PublicationDraft
  } | null>(null)
  const [saving, setSaving] = useState(false)
  // #368 — a file's publish block becomes an offer: the dialog stashes it
  // for the Share tab's form. Nothing is stored until the creator confirms,
  // and nothing goes live until they publish.
  const [offer, setOffer] = useState<{ trip: Trip; draft: PublicationDraft } | null>(null)

  /** The success side of both paths, in the order the two toasts must read. */
  function announceImported(done: { trip: Trip; summary: string; note: string; digest: ImportReportDigest | null }) {
    toast(`Imported “${done.trip.name}” — ${done.summary}.${done.note}`)
    if (done.digest) toast(done.digest.message, done.digest.kind)
    onNavigate('/trips')
  }

  /** The offer path toasts the import but leaves navigation to the dialog.
   *  Confirm opens the prefilled Share tab; cancel goes to My Trips. */
  function offerPrefill(trip: Trip, draft: PublicationDraft, digest: ImportReportDigest | null, summary: string) {
    toast(`Imported “${trip.name}” — ${summary}.`)
    if (digest) toast(digest.message, digest.kind)
    setOffer({ trip, draft })
  }

  function confirmOffer() {
    if (!offer) return
    stashPublishDraft(offer.trip.id, offer.draft)
    onNavigate(`/trip/${offer.trip.id}/share`)
    setOffer(null)
  }

  function closeOffer() {
    // ConfirmDialog runs onConfirm, then onClose — a confirmed offer already
    // navigated. A cancelled offer lands in My Trips like any other import.
    if (offer) onNavigate('/trips')
    setOffer(null)
  }

  async function retrySave() {
    if (!ownerId || !pending || saving) return
    setSaving(true)
    try {
      if (!await retryImportTrip(pending.trip, ownerId)) return
      const done = pending
      setPending(null)
      if (done.offer) offerPrefill(done.trip, done.offer, done.digest, done.summary)
      else announceImported(done)
    } finally {
      setSaving(false)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so re-picking the same file fires again
    if (!file) return
    if (!ownerId) { onNavigate('/auth'); return }
    if (saving) return // one import in flight — a second pick would twin it
    setSaving(true)
    try {
      const text = await file.text()
      const first = parseTripImport(text)
      // The coordinate wall refuses FABRICATION, not a person's own numbers:
      // each dropped row gets the shared pin prompt (manual coordinates or an
      // explicit skip), and rescued rows are re-parsed in with patches —
      // never left to a report alone.
      const patches: DroppedStopPatch[] = []
      for (const d of first.report.droppedStops.slice(0, RESCUE_PROMPT_CAP)) {
        const pinned = await resolvePick(unnamedPick(`import-${d.dayIndex}-${d.stopIndex}`, d.title))
        if (pinned) patches.push({ dayIndex: d.dayIndex, stopIndex: d.stopIndex, latitude: pinned.latitude, longitude: pinned.longitude })
      }
      const parsed = patches.length > 0 ? parseTripImport(text, patches) : first
      // A gallery file can also carry a publish block. Refused blocks ride
      // out as a reason on the import toast; a valid block becomes the
      // prefill offer. Publishing stays a deliberate Share-tab step.
      const note = parsed.publicationRefused ? ` Its publish block was refused on import: ${parsed.publicationRefused}` : ''
      const digest = digestImportReport(parsed.report)
      // #551 — the save is awaited and the success toast waits for its truth:
      // persistTrip has already said why a save failed, and a success toast on
      // top would contradict it while a zombie row sits in My Trips.
      const { trip: imported, persisted } = await importTripPersisted(parsed.trip, ownerId)
      if (!persisted) {
        setPending({ trip: imported, summary: parsed.summary, note, digest, offer: parsed.publication })
        return
      }
      if (parsed.publication) offerPrefill(imported, parsed.publication, digest, parsed.summary)
      else announceImported({ trip: imported, summary: parsed.summary, note, digest })
    } catch (err) {
      toast(
        err instanceof TripImportError ? err.message : 'That file could not be read.',
        'err',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button className={className} onClick={() => fileRef.current?.click()} disabled={saving} aria-busy={saving}>
        <InlineIcon icon={Upload} size={15} gap={5} />
        {label}
      </button>
      {pending && (
        <button className={className} onClick={retrySave} disabled={saving} aria-busy={saving}>
          Retry save
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={e => void onFile(e)}
      />
      {resolvePickDialog}
      <ConfirmDialog
        open={!!offer}
        title="Publish details found"
        body="This file carries a publish block. The import only prefills the publish form — nothing goes live until you publish in the Share tab."
        confirmLabel="Prefill the publish form"
        onConfirm={confirmOffer}
        onClose={closeOffer}
      />
    </>
  )
}
