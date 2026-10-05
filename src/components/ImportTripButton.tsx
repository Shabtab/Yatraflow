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
import type { DroppedStopPatch } from '../lib/tripImport'
import { digestImportReport, type ImportReportDigest } from '../lib/itinerarySpec'
import { useResolvePick } from './ResolvePickDialog'
import { unnamedPick } from '../lib/resolvePick'
import { toast } from './ui'

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
    trip: Trip; summary: string; note: string; digest: ImportReportDigest | null
  } | null>(null)
  const [saving, setSaving] = useState(false)

  /** The success side of both paths, in the order the two toasts must read. */
  function announceImported(done: { trip: Trip; summary: string; note: string; digest: ImportReportDigest | null }) {
    toast(`Imported “${done.trip.name}” — ${done.summary}.${done.note}`)
    if (done.digest) toast(done.digest.message, done.digest.kind)
    onNavigate('/trips')
  }

  async function retrySave() {
    if (!ownerId || !pending || saving) return
    setSaving(true)
    try {
      if (!await retryImportTrip(pending.trip, ownerId)) return
      const done = pending
      setPending(null)
      announceImported(done)
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
      // A gallery file also carries publish details. Say so rather than let
      // them vanish — publishing stays a deliberate step in the Share tab.
      const note = parsed.publication
        ? ' Its publish details (title, price, cover) were not applied.'
        : ''
      const digest = digestImportReport(parsed.report)
      // #551 — the save is awaited and the success toast waits for its truth:
      // persistTrip has already said why a save failed, and a success toast on
      // top would contradict it while a zombie row sits in My Trips.
      const { trip: imported, persisted } = await importTripPersisted(parsed.trip, ownerId)
      if (!persisted) {
        setPending({ trip: imported, summary: parsed.summary, note, digest })
        return
      }
      announceImported({ trip: imported, summary: parsed.summary, note, digest })
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
    </>
  )
}
