// ============ Stop add/edit modal ============
import React, { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { InlineIcon } from './icons'
import type { ItineraryStop, StopCategory, StopStatus, Trip } from '../data/types'
import { STOP_CATEGORIES, STOP_STATUSES } from '../data/types'
import { Car } from 'lucide-react'
import { Modal, Field } from './ui'
import { Select } from './Select'
import { LocationInput } from './LocationInput'
import type { PlaceHit } from './LocationInput'
import { useResolvePick } from './ResolvePickDialog'
import { unnamedPick } from '../lib/resolvePick'
import { fetchOpeningHours } from '../lib/geocode'
import { roadLegBetween } from '../lib/routing'
import { groundAssumptions, hmToMinutes, addMinutesToClock, formatInr } from '../lib/engine'
import { titleCase, statusLabel } from '../lib/labels'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { STOP_PRIORITY_CHOICES, stopEditorSummaries, type StopPlanFacts } from '../lib/stopForm'

export interface StopFormValues {
  title: string
  category: StopCategory
  locationName: string
  /** provider place-id of the picked place ('' when hand-typed) — lodging identity (#146) */
  placeId: string
  lat: number
  lng: number
  description: string
  visitMinutes: number
  openTime: string
  closeTime: string
  entryFeeInrPerPerson: number
  transportCostInrTotal: number
  priority: ItineraryStop['priority']
  notes: string
  sourceUrl: string
  status: StopStatus
  /** true once the user picked a real geocoded place (lat/lng verified) */
  geocoded?: boolean
  /** kind of the picked place ('place' = city/town — hours are illogical for these) */
  pickedKind: 'place' | 'poi' | ''
  /** leg-aware travel fields (auto-filled when a geocoded place is picked) */
  departTime: string
  arrivalTime: string
  legDistanceKm: number
  legTravelMinutes: number
  /** which provider produced the auto-filled leg ('estimate' = haversine fallback) */
  legFromSource?: 'google' | 'osrm' | 'estimate'
}

/** Where the user is travelling FROM (and optionally the next destination after). */
export interface LegContext {
  fromName: string
  fromPoint: { lat: number; lng: number }
  nextName?: string
  /** engine day start ("08:30") used as the default departure */
  dayStart: string
  transportMode: Trip['transportMode']
  /** trip's stated fuel economy — sharpens the per-leg fuel estimate */
  fuelEconomyKmL?: number
  /** trip's stated local pump price — used instead of the indicative default */
  fuelPricePerL?: number
}

export function StopEditor({ open, onClose, initial, resetKey, onSave, dayLabel, legContext, banner, planFacts }: {
  open: boolean
  onClose: () => void
  initial?: Partial<StopFormValues>
  /** stable identity (e.g. stop id or "add-day0") — form resets when this changes */
  resetKey?: string
  onSave: (v: StopFormValues) => void
  dayLabel?: string
  legContext?: LegContext
  planFacts?: StopPlanFacts
  /** M6 B3 — non-blocking remote-edit conflict banner rendered above the form */
  banner?: React.ReactNode
}) {
  const timeFormat = useTimeFormat()
  const [sectionsOpen, setSectionsOpen] = useState(0)
  // #424 guard: saving a location that was never pinned asks for coordinates
  // before the write. Hook stays with the others, above every exit (§6e).
  const { resolvePick, dialog: resolvePickDialog } = useResolvePick()
  /** true while the pin prompt is up — the editor's own Escape handling must
   *  stand down so the prompt is the only layer that answers. */
  const pinPrompting = useRef(false)
  const onModalClose = React.useCallback(() => { if (!pinPrompting.current) onClose() }, [onClose])
  const [v, setV] = useState<StopFormValues>(normalizeStopForm(initial))
  const [errs, setErrs] = useState<Record<string, string>>({})
  /** first-invalid focus targets (F-15) — plain inputs register here */
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  /** "idle" | "loading" | "found" | "none" — OSM hours lookup after picking a place */
  const [hoursState, setHoursState] = useState<'idle' | 'loading' | 'found' | 'none'>('idle')
  /** "idle" | "loading" — road-leg lookup after picking a place */
  const [legState, setLegState] = useState<'idle' | 'loading'>('idle')
  const placeRequest = useRef(0)
  useLayoutEffect(() => {
    ++placeRequest.current
    setHoursState('idle')
    setLegState('idle')
    return () => { ++placeRequest.current }
  }, [open, resetKey])

  function invalidatePlaceRequest() {
    ++placeRequest.current
    setHoursState('idle')
    setLegState('idle')
  }

  // re-init when opening for a different stop
  const [lastKey, setLastKey] = useState(resetKey)
  if (open && lastKey !== resetKey) { setLastKey(resetKey); setV(normalizeStopForm(initial)); setErrs({}); setHoursState('idle'); setLegState('idle') }

  /** assumptions for the travel-leg preview (null when no leg context) */
  const legAssumptions = legContext
    ? groundAssumptions(legContext)
    : null
  /** one-line fuel/fare preview under the leg fields — litres-first when an economy is stated */
  const legPreview = (() => {
    if (!legAssumptions || v.legDistanceKm <= 0) return null
    if (legAssumptions.kmPerLiter) {
      const litres = v.legDistanceKm / legAssumptions.kmPerLiter
      return `≈ ${litres.toFixed(1)} L ≈ ${formatInr(litres * (legAssumptions.fuelPricePerL ?? 0))} fuel for this leg · ${legAssumptions.kmPerLiter} km/L × ₹${legAssumptions.fuelPricePerL}/L`
    }
    return `≈ ${formatInr(v.legDistanceKm * (legAssumptions.inrPerKm ?? 8))} fuel/fare at ${legAssumptions.mode} rates`
  })()

  async function onPlacePicked(p: PlaceHit) {
    if (!open) return
    invalidatePlaceRequest()
    const request = placeRequest.current
    const ownsRequest = () => request === placeRequest.current
    set('locationName', p.name + (p.admin1 ? `, ${p.admin1}` : ''))
    set('lat', p.latitude); set('lng', p.longitude); set('geocoded', true)
    set('pickedKind', p.kind)
    // #146: carry the provider place-id so lodging identity keys on it
    set('placeId', p.placeId ?? '')
    // cities/towns/regions don't have opening hours — drop any stale values
    if (p.kind === 'place') { set('openTime', ''); set('closeTime', ''); setHoursState('idle') }
    // leg-aware flow: once we know where this stop is, auto-fill the travel leg
    if (legContext) {
      setLegState('loading')
      try {
        const leg = await roadLegBetween(legContext.fromPoint, { lat: p.latitude, lng: p.longitude }, groundAssumptions(legContext))
        if (!ownsRequest()) return
        const perKm = groundAssumptions(legContext).inrPerKm ?? 8
        setV(prev => {
          if (!ownsRequest()) return prev
          const depart = prev.departTime || legContext.dayStart
          return {
            ...prev,
            legDistanceKm: Math.round(leg.distanceKm * 10) / 10,
            legTravelMinutes: Math.max(1, Math.round(leg.durationMinutes)),
            transportCostInrTotal: Math.round(leg.distanceKm * perKm),
            departTime: depart,
            arrivalTime: addMinutesToClock(hmToMinutes(depart), leg.durationMinutes),
            legFromSource: leg.source,
          }
        })
      } catch {
        /* leg fill is best-effort — the manual fields still work */
      } finally {
        if (ownsRequest()) setLegState('idle')
      }
    }
    if (!ownsRequest()) return
    // auto-feed open/close times from OpenStreetMap when the place has them
    if (p.kind === 'poi' && !v.openTime) {
      setHoursState('loading')
      try {
        const hours = await fetchOpeningHours(p.name, p.latitude, p.longitude)
        if (!ownsRequest()) return
        if (hours) {
          set('openTime', hours.openTime); set('closeTime', hours.closeTime)
          setHoursState('found')
        } else {
          setHoursState('none')
        }
      } catch {
        if (ownsRequest()) setHoursState('none')
      }
    }
  }

  function set<K extends keyof StopFormValues>(k: K, val: StopFormValues[K]) {
    setV(prev => ({ ...prev, [k]: val }))
  }

  const summaries = stopEditorSummaries(v, timeFormat)

  const hoursHint =
    hoursState === 'loading' ? 'Looking up hours from OpenStreetMap…' :
    hoursState === 'found' ? 'Auto-filled from OpenStreetMap. Edit if needed' :
    undefined

  // Time pickers on the shared listbox (the calendar's design language):
  // 15-minute steps in the user's 12/24h format, "Not set" to clear, and a
  // preserved exact entry for legacy values that aren't on the grid.
  const timeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: '', label: 'Not set' }]
    for (let m = 0; m < 24 * 60; m += 15) {
      const val = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      opts.push({ value: val, label: formatHM(val, timeFormat) })
    }
    return opts
  }, [timeFormat])
  const openTimeOptions = useMemo(
    () => (v.openTime && !timeOptions.some(o => o.value === v.openTime)
      ? [{ value: v.openTime, label: formatHM(v.openTime, timeFormat) }, ...timeOptions]
      : timeOptions),
    [timeOptions, v.openTime, timeFormat],
  )
  const closeTimeOptions = useMemo(
    () => (v.closeTime && !timeOptions.some(o => o.value === v.closeTime)
      ? [{ value: v.closeTime, label: formatHM(v.closeTime, timeFormat) }, ...timeOptions]
      : timeOptions),
    [timeOptions, v.closeTime, timeFormat],
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!v.title.trim()) next.title = 'Give the stop a name.'
    if (!v.locationName.trim()) next.locationName = 'Where is this stop?'
    if (!v.visitMinutes || v.visitMinutes <= 0) next.visitMinutes = 'How long will you spend here?'
    if (v.sourceUrl && !/^https?:\/\//.test(v.sourceUrl)) next.sourceUrl = 'Link must start with http:// or https://'
    if (v.openTime && v.closeTime && v.closeTime <= v.openTime) next.closeTime = 'Closing time must be after opening time.'
    setErrs(next)
    if (Object.keys(next).length) {
      setSectionsOpen(n => n + 1)
      // F-15: focus the first invalid field (role="alert" announces the message;
      // LocationInput fields don't register a ref, so the first focusable one wins)
      const first = Object.keys(next).find(k => fieldRefs.current[k])
      if (first) requestAnimationFrame(() => fieldRefs.current[first]?.focus())
      return
    }
    // #424: a NEW stop whose location was never pinned must not write the
    // form's default coordinates. (An existing stop keeps its stored pin — a
    // rename is not a position change, and `initial?.title` is how the form
    // knows it is editing one.) The shared guard asks — manual coordinates or
    // an explicit skip — and a skip refuses the save rather than guessing.
    if (!v.geocoded && !initial?.title) {
      pinPrompting.current = true
      let picked: PlaceHit | null = null
      try {
        picked = await resolvePick(unnamedPick('stop-editor', v.locationName.trim()))
      } finally { pinPrompting.current = false }
      if (!picked) {
        setErrs({ locationName: 'Pick a suggestion, or enter the coordinates. A stop cannot go on the map without a position.' })
        return
      }
      onSave({
        ...v, title: v.title.trim(), locationName: v.locationName.trim(),
        lat: picked.latitude, lng: picked.longitude, placeId: '', geocoded: true,
      })
      return
    }
    onSave({ ...v, title: v.title.trim(), locationName: v.locationName.trim() })
  }

  return (
    <>
    <Modal variant="stop-editor" open={open} onClose={onModalClose} title={`${initial?.title ? 'Edit stop' : 'Add stop'}${dayLabel ? ` · ${dayLabel}` : ''}`}>
      {banner}
      <form onSubmit={submit}>
        {planFacts && <PlanFactsRow facts={planFacts} timeFormat={timeFormat} />}
        <div className="stop-editor-key">
          <Field label="Stop name" error={errs.title}>
            <input className="input" ref={el => { fieldRefs.current.title = el }} aria-invalid={!!errs.title} value={v.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Cheeyappara Waterfalls" />
          </Field>
          <Field label="Location / area" hint={v.geocoded ? 'Pinned to a real place on the map' : 'Start typing and pick a suggestion to pin it on the map'} error={errs.locationName}>
            <LocationInput
              value={v.locationName}
              onChange={val => { invalidatePlaceRequest(); set('locationName', val); if (v.geocoded) { set('geocoded', false); set('placeId', '') } }}
              onPick={onPlacePicked}
              placeholder="Search, e.g. Idukki district, Kerala"
            />
          </Field>
              <Field label="Visit duration (min)" error={errs.visitMinutes}>
                <input type="number" min={0} step={5} className="input" ref={el => { fieldRefs.current.visitMinutes = el }} aria-invalid={!!errs.visitMinutes} value={v.visitMinutes} onChange={e => set('visitMinutes', Number(e.target.value))} />
              </Field>
          <Field label="Priority">
            <div className="stop-editor-priority" role="group" aria-label="Priority">
              {STOP_PRIORITY_CHOICES.map(choice => <button key={choice.value} type="button" className="clickable-chip"
                aria-label={choice.accessibleLabel} aria-pressed={v.priority === choice.value}
                onClick={() => set('priority', choice.value)}>{choice.label}</button>)}
            </div>
          </Field>
        </div>
        <div className="stop-editor-details">
          <EditorSection title="Category and hours" summary={summaries.categoryHours} forceOpen={sectionsOpen}>
          <Field label="Category">
            <Select value={v.category} onChange={val => set('category', val as StopCategory)}
              options={STOP_CATEGORIES.map(c => ({ value: c, label: titleCase(c) }))} />
          </Field>
            {(() => {
              const hoursRelevant = v.pickedKind === 'poi' || !!v.openTime || !!v.closeTime || (!v.geocoded && HOURS_CATEGORIES.has(v.category))
              return hoursRelevant ? <div className="form-row">
              {hoursRelevant && (
                <Field label="Opens at" hint={hoursHint}>
                  <Select value={v.openTime} onChange={val => set('openTime', val)} options={openTimeOptions} aria-label="Opens at" />
                </Field>
              )}
              {hoursRelevant && (
                <Field label="Closes at" error={errs.closeTime}>
                  <Select value={v.closeTime} onChange={val => set('closeTime', val)} options={closeTimeOptions} aria-label="Closes at"
                    buttonRef={el => (fieldRefs.current.closeTime = el)} />
                </Field>
              )}
              </div> : null
            })()}
          </EditorSection>
          <EditorSection title="Costs" summary={summaries.costs} forceOpen={sectionsOpen}>
        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Entry fee per person (₹)" hint="0 for free places">
            <input type="number" min={0} className="input" value={v.entryFeeInrPerPerson} onChange={e => set('entryFeeInrPerPerson', Number(e.target.value))} />
          </Field>
          <Field label="Transport cost to reach (₹, total)" hint="Fuel share, taxi or bus fare to this stop">
            <input type="number" min={0} className="input" value={v.transportCostInrTotal} onChange={e => set('transportCostInrTotal', Number(e.target.value))} />
          </Field>
        </div>

          </EditorSection>
        </div>
        {legContext && v.geocoded && (
          <div className="card" style={{ background: 'var(--bg-soft)', padding: 12, marginBottom: 12 }}>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
              <InlineIcon icon={Car} size={13} gap={4} />Travel to this stop {legState === 'loading' ? <span className="muted">(measuring road…)</span> : ''}
            </div>
            <div className="small muted" style={{ marginBottom: 10 }}>
              {legContext.fromName} → {v.title || v.locationName || 'this stop'}
              {legContext.nextName ? <> → {legContext.nextName}</> : null}
              {v.legFromSource && v.legFromSource !== 'estimate' ? ' · real road data' : ''}
            </div>
            <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
              <Field label="Distance (km)">
                <input type="number" min={0} step={0.1} className="input" value={v.legDistanceKm} onChange={e => set('legDistanceKm', Number(e.target.value))} />
              </Field>
              <Field label="Travel time (min)">
                <input type="number" min={0} step={1} className="input" value={v.legTravelMinutes} onChange={e => set('legTravelMinutes', Number(e.target.value))} />
              </Field>
              <Field label="Depart at">
                <input type="time" className="input" value={v.departTime} onChange={e => {
                  const dep = e.target.value
                  setV(prev => ({ ...prev, departTime: dep, arrivalTime: dep && prev.legTravelMinutes ? addMinutesToClock(hmToMinutes(dep), prev.legTravelMinutes) : prev.arrivalTime }))
                }} />
                {v.departTime && <div className="time-preview small muted">= {formatHM(v.departTime, timeFormat)}</div>}
              </Field>
              <Field label="Arrive at">
                <input type="time" className="input" value={v.arrivalTime} onChange={e => set('arrivalTime', e.target.value)} />
                {v.arrivalTime && <div className="time-preview small muted">= {formatHM(v.arrivalTime, timeFormat)}</div>}
              </Field>
            </div>
            {legPreview && (
              <div className="small muted">{legPreview}</div>
            )}
          </div>
        )}

        <EditorSection title="Details and status" summary={summaries.details} forceOpen={sectionsOpen}>
          <div className="stop-editor-details">
        <Field label="Description">
          <textarea className="textarea" value={v.description} onChange={e => set('description', e.target.value)} placeholder="What makes this place worth the detour?" />
        </Field>
        <Field label="Notes">
          <textarea className="textarea" style={{ minHeight: 52 }} value={v.notes} onChange={e => set('notes', e.target.value)} placeholder="Parking tips, booking links, reminders…" />
        </Field>

        <div className="form-row">
          <Field label="Source link (optional)" error={errs.sourceUrl}>
            <input className="input" ref={el => { fieldRefs.current.sourceUrl = el }} value={v.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Status">
            <Select value={v.status} onChange={val => set('status', val as StopStatus)}
              options={STOP_STATUSES.map(s => ({
                value: s,
                label: statusLabel(s),
                icon: <span className="opt-dot" style={{
                  background: s === 'confirmed' ? 'var(--ok)'
                    : s === 'rejected' ? 'var(--coral)'
                    : s === 'maybe' ? 'var(--warn)'
                    : s === 'needs-booking' ? 'var(--saffron)'
                    : 'var(--gray-400)',
                }} />,
              }))} />
          </Field>
        </div>

          </div>
        </EditorSection>

        <div className="stop-editor-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{initial?.title ? 'Save changes' : 'Add to timeline'}</button>
        </div>
      </form>
    </Modal>
    {resolvePickDialog}
    </>
  )
}

export function PlanFactsRow({ facts, timeFormat }: { facts: StopPlanFacts; timeFormat: '12h' | '24h' }) {
  const parts = [
    facts.arrive ? `arrive ${formatHM(facts.arrive, timeFormat)}` : '',
    facts.leave ? `leave ${formatHM(facts.leave, timeFormat)}` : '',
    facts.stayMin != null ? `stay ${facts.stayMin} min` : '',
    facts.distanceKm != null ? `${facts.distanceKm.toFixed(1)} km` : '',
    facts.driveMin != null ? `drive ${Math.round(facts.driveMin)} min` : '',
  ].filter(Boolean)
  return parts.length ? <p className="stop-editor-plan">In the plan: {parts.join(' · ')}</p> : null
}

function editorIsPhone() { return window.matchMedia('(max-width: 639px)').matches }
function subscribeEditorPhone(callback: () => void) {
  const query = window.matchMedia('(max-width: 639px)')
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function EditorSection({ title, summary, forceOpen, children }: { title: string; summary: string; forceOpen: number; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const phone = useSyncExternalStore(subscribeEditorPhone, editorIsPhone, () => false)
  const [seenForceOpen, setSeenForceOpen] = useState(forceOpen)
  if (forceOpen !== seenForceOpen) { setSeenForceOpen(forceOpen); setExpanded(true) }
  const buttonRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const id = React.useId()
  const visible = !phone || expanded
  return <section className="stop-editor-section">
    <button ref={buttonRef} type="button" className="stop-editor-disclosure" aria-expanded={visible} aria-controls={id}
      onClick={() => {
        if (expanded && bodyRef.current?.contains(document.activeElement)) buttonRef.current?.focus()
        setExpanded(!expanded)
      }}><span className="stop-editor-disclosure-copy"><span>{title}</span>{summary && <span className="stop-editor-summary">{summary}</span>}</span><span aria-hidden="true">{expanded ? '-' : '+'}</span></button>
    <h3 className="stop-editor-section-title">{title}</h3>
    <div id={id} className={`stop-editor-fold${visible ? ' is-open' : ''}`} ref={bodyRef} inert={!visible ? true : undefined}>
      <div className="stop-editor-fold-inner">{children}</div>
    </div>
  </section>
}

/** The blank form every add starts from — exported so the Timeline's quick
 *  add (#422) seeds itself with the SAME defaults the full editor does, instead
 *  of growing a second copy of them. */
export function normalizeStopForm(v?: Partial<StopFormValues>): StopFormValues {
  return {
    title: '', category: 'sightseeing', locationName: '',
    lat: DEFAULT_LATLNG.lat, lng: DEFAULT_LATLNG.lng,
    description: '', visitMinutes: 60, openTime: '', closeTime: '',
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', notes: '', sourceUrl: '', status: 'suggested', geocoded: false,
    pickedKind: '',
    placeId: '',
    departTime: '', arrivalTime: '', legDistanceKm: 0, legTravelMinutes: 0,
    ...v,
  }
}

/** Categories whose stops plausibly have opening hours even without a geocoded pick. */
const HOURS_CATEGORIES = new Set<string>(['temple', 'museum', 'food', 'hotel', 'adventure', 'shopping', 'event'])

const DEFAULT_LATLNG = { lat: 10.0889, lng: 77.0595 } // Munnar default until geocoding exists
