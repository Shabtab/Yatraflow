// ============ Timeline quick add (#422) — the lightweight first step ============
// The insertion control on a leg opens THIS, not the full StopEditor: a coffee,
// fuel, lunch or stretch stop needs a name, a place, a category and a dwell,
// and nothing else. "More details…" hands the same draft to the full editor at
// the same day AND slot, so detail work never starts over.
//
// Two contracts are shared with every other add path, deliberately:
//   - coordinates: a place is resolved by LocationInput's own pick, or by the
//     shared resolve-or-prompt guard at submit (#424) — the form's default
//     coordinates are NEVER written, and a skip refuses the save;
//   - the write: this component writes nothing. It hands a full StopFormValues
//     to TimelineTab, which commits through the ONE add path
//     (`applyChange` + `insertStopAt`) that the editor's add branch uses too.
import React, { useState } from 'react'
import type { Trip } from '../../../data/types'
import { STOP_CATEGORIES } from '../../../data/types'
import { Field, Modal } from '../../../components/ui'
import { Select } from '../../../components/Select'
import { LocationInput } from '../../../components/LocationInput'
import type { PlaceHit } from '../../../components/LocationInput'
import { useResolvePick } from '../../../components/ResolvePickDialog'
import { unnamedPick } from '../../../lib/resolvePick'
import { normalizeStopForm, type StopFormValues } from '../../../components/StopEditor'
import { titleCase, insertionWhere } from '../../../lib/labels'
import { stopsInOrder } from '../../../lib/stopOrder'

/** The slot the leg's control picked: a day and the index a new stop goes before. */
export interface QuickAddTarget {
  dayIndex: number
  slot: number
}

export function QuickAddStop({ target, trip, onClose, onAdd, onMore }: {
  /** null = closed. A new target re-seeds the form (the slot is its identity). */
  target: QuickAddTarget | null
  trip: Trip
  onClose: () => void
  onAdd: (dayIndex: number, slot: number, v: StopFormValues) => void
  /** hand the same draft to the full StopEditor, at the same day + slot */
  onMore: (dayIndex: number, slot: number, v: StopFormValues) => void
}) {
  // The shared ingestion guard, at the top with the other hooks (§6e).
  const { resolvePick, dialog: resolvePickDialog } = useResolvePick()
  const [v, setV] = useState<StopFormValues>(() => normalizeStopForm())
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [lastKey, setLastKey] = useState('')

  const key = target ? `${target.dayIndex}:${target.slot}` : ''
  // Re-seed on a new slot (render-phase reset, the editor's own pattern): a
  // half-typed draft belongs to the leg that was clicked, not to the next one.
  if (target && lastKey !== key) {
    setLastKey(key)
    setV(normalizeStopForm())
    setErrs({})
    setBusy(false)
  }

  // Where this stop is going, in words — the same clause the leg's own control
  // announces, so the dialog repeats exactly what the button said.
  const day = target ? trip.days.find(d => d.index === target.dayIndex) : undefined
  const ordered = day ? stopsInOrder(day) : []
  const before = target && target.slot > 0 ? ordered[target.slot - 1] : undefined
  const after = target ? ordered[target.slot] : undefined
  const where = insertionWhere(before?.title, after?.title)

  function set<K extends keyof StopFormValues>(k: K, val: StopFormValues[K]) {
    setV(prev => ({ ...prev, [k]: val }))
  }

  function onPlacePicked(p: PlaceHit) {
    // Same semantics as the full editor's pick: the stored location name is the
    // place plus its region, the pick carries its provider id, and the point is
    // what the map will draw.
    setV(prev => ({
      ...prev,
      locationName: p.name + (p.admin1 ? `, ${p.admin1}` : ''),
      lat: p.latitude, lng: p.longitude, geocoded: true,
      placeId: p.placeId ?? '',
      // The name is the one field a quick add leaves empty by default — fill it
      // from the place the user just picked, never over something they typed.
      title: prev.title.trim() ? prev.title : p.name,
    }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!target || busy) return
    const next: Record<string, string> = {}
    if (!v.title.trim()) next.title = 'Give the stop a name.'
    if (!v.locationName.trim()) next.locationName = 'Where is this stop?'
    if (!Number.isFinite(v.visitMinutes) || v.visitMinutes <= 0) next.visitMinutes = 'How long will you spend here?'
    setErrs(next)
    if (Object.keys(next).length) return
    // §6a: the async window disables the inputs below.
    setBusy(true)
    try {
      // A typed-but-never-picked place takes the SHARED guard: resolve, or ask
      // for coordinates / an explicit skip. Never a placeholder write.
      if (!v.geocoded) {
        const picked = await resolvePick(unnamedPick('timeline-quick-add', v.locationName.trim() || v.title.trim()))
        if (!picked) {
          setErrs({ locationName: 'Pick a suggestion, or use “More details…” to enter coordinates — a stop cannot go on the map without a position.' })
          return
        }
        onAdd(target.dayIndex, target.slot, {
          ...v, title: v.title.trim(), locationName: v.locationName.trim(),
          lat: picked.latitude, lng: picked.longitude, geocoded: true,
        })
        return
      }
      onAdd(target.dayIndex, target.slot, { ...v, title: v.title.trim(), locationName: v.locationName.trim() })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal open={!!target} onClose={onClose} title={target ? `Add a stop — Day ${target.dayIndex + 1}` : 'Add a stop'}>
        {target && (
          <form onSubmit={submit} noValidate>
            {/* The insertion slot, in words. Announced with the dialog and
                repeated under the fields, so keyboard and screen-reader users
                know where the stop will land before they fill anything in. */}
            <p className="hint-text" style={{ marginTop: 0 }} role="note" aria-label="Insertion position">
              Inserting <b>{where}</b> on Day {target.dayIndex + 1}.
            </p>
            <Field label="Stop name" error={errs.title}>
              <input className="input" value={v.title} disabled={busy} aria-invalid={!!errs.title}
                onChange={e => set('title', e.target.value)} placeholder="e.g. Coffee at the ghat road" autoFocus />
            </Field>
            <Field label="Location / area" hint={v.geocoded ? 'Pinned to a real place on the map' : 'Start typing and pick a suggestion to pin it on the map'} error={errs.locationName}>
              <LocationInput
                value={v.locationName}
                disabled={busy}
                onChange={val => { set('locationName', val); if (v.geocoded) setV(prev => ({ ...prev, geocoded: false, placeId: '' })) }}
                onPick={onPlacePicked}
                placeholder="Search the place this stop is at"
              />
            </Field>
            <div className="form-row">
              <Field label="Category">
                <Select value={v.category} onChange={val => set('category', val as StopFormValues['category'])}
                  options={STOP_CATEGORIES.map(c => ({ value: c, label: titleCase(c) }))} />
              </Field>
              <Field label="Visit duration (min)" error={errs.visitMinutes}>
                <input type="number" min={0} step={5} className="input" value={v.visitMinutes} disabled={busy}
                  aria-invalid={!!errs.visitMinutes} onChange={e => set('visitMinutes', Number(e.target.value))} />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-outline" disabled={busy}
                onClick={() => onMore(target.dayIndex, target.slot, v)}>More details…</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add stop'}</button>
            </div>
          </form>
        )}
      </Modal>
      {resolvePickDialog}
    </>
  )
}
