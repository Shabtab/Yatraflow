// ============ Stop add/edit modal ============
import React, { useState } from 'react'
import type { ItineraryStop, StopCategory, StopStatus, Trip } from '../data/types'
import { STOP_CATEGORIES, STOP_STATUSES } from '../data/types'
import { Modal, Field } from './ui'
import { LocationInput } from './LocationInput'
import type { PlaceHit } from './LocationInput'
import { fetchOpeningHours } from '../lib/geocode'
import { roadLegBetween } from '../lib/routing'
import { getAssumptions, hmToMinutes, addMinutesToClock, formatInr } from '../lib/engine'

export interface StopFormValues {
  title: string
  category: StopCategory
  locationName: string
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
  /** true while the leg numbers came from the road-routing lookup */
  legFromOsrm?: boolean
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
}

export function StopEditor({ open, onClose, initial, resetKey, onSave, dayLabel, legContext }: {
  open: boolean
  onClose: () => void
  initial?: Partial<StopFormValues>
  /** stable identity (e.g. stop id or "add-day0") — form resets when this changes */
  resetKey?: string
  onSave: (v: StopFormValues) => void
  dayLabel?: string
  legContext?: LegContext
}) {
  const [v, setV] = useState<StopFormValues>(normalize(initial))
  const [errs, setErrs] = useState<Record<string, string>>({})
  /** "idle" | "loading" | "found" | "none" — OSM hours lookup after picking a place */
  const [hoursState, setHoursState] = useState<'idle' | 'loading' | 'found' | 'none'>('idle')
  /** "idle" | "loading" — road-leg lookup after picking a place */
  const [legState, setLegState] = useState<'idle' | 'loading'>('idle')
  // re-init when opening for a different stop
  const [lastKey, setLastKey] = useState(resetKey)
  if (open && lastKey !== resetKey) { setLastKey(resetKey); setV(normalize(initial)); setErrs({}); setHoursState('idle'); setLegState('idle') }

  async function onPlacePicked(p: PlaceHit) {
    set('locationName', p.name + (p.admin1 ? `, ${p.admin1}` : ''))
    set('lat', p.latitude); set('lng', p.longitude); set('geocoded', true)
    set('pickedKind', p.kind)
    // cities/towns/regions don't have opening hours — drop any stale values
    if (p.kind === 'place') { set('openTime', ''); set('closeTime', ''); setHoursState('idle') }
    // leg-aware flow: once we know where this stop is, auto-fill the travel leg
    if (legContext) {
      setLegState('loading')
      try {
        const leg = await roadLegBetween(legContext.fromPoint, { lat: p.latitude, lng: p.longitude }, getAssumptions({ transportMode: legContext.transportMode, fuelEconomyKmL: legContext.fuelEconomyKmL }))
        const perKm = getAssumptions({ transportMode: legContext.transportMode }).inrPerKm ?? 8
        setV(prev => {
          const depart = prev.departTime || legContext.dayStart
          return {
            ...prev,
            legDistanceKm: Math.round(leg.distanceKm * 10) / 10,
            legTravelMinutes: Math.max(1, Math.round(leg.durationMinutes)),
            transportCostInrTotal: Math.round(leg.distanceKm * perKm),
            departTime: depart,
            arrivalTime: addMinutesToClock(hmToMinutes(depart), leg.durationMinutes),
            legFromOsrm: leg.fromOsrm,
          }
        })
      } catch {
        /* leg fill is best-effort — the manual fields still work */
      } finally {
        setLegState('idle')
      }
    }
    // auto-feed open/close times from OpenStreetMap when the place has them
    if (p.kind === 'poi' && !v.openTime) {
      setHoursState('loading')
      try {
        const hours = await fetchOpeningHours(p.name, p.latitude, p.longitude)
        if (hours && open) {
          set('openTime', hours.openTime); set('closeTime', hours.closeTime)
          setHoursState('found')
        } else {
          setHoursState('none')
        }
      } catch {
        setHoursState('none')
      }
    }
  }

  function set<K extends keyof StopFormValues>(k: K, val: StopFormValues[K]) {
    setV(prev => ({ ...prev, [k]: val }))
  }

  const hoursHint =
    hoursState === 'loading' ? '⏳ Looking up hours from OpenStreetMap…' :
    hoursState === 'found' ? '✓ Auto-filled from OpenStreetMap — edit if needed' :
    undefined

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!v.title.trim()) next.title = 'Give the stop a name.'
    if (!v.locationName.trim()) next.locationName = 'Where is this stop?'
    if (!v.visitMinutes || v.visitMinutes <= 0) next.visitMinutes = 'How long will you spend here?'
    if (v.sourceUrl && !/^https?:\/\//.test(v.sourceUrl)) next.sourceUrl = 'Link must start with http:// or https://'
    if (v.openTime && v.closeTime && v.closeTime <= v.openTime) next.closeTime = 'Closing time must be after opening time.'
    setErrs(next)
    if (Object.keys(next).length) return
    onSave({ ...v, title: v.title.trim(), locationName: v.locationName.trim() })
  }

  return (
    <Modal open={open} onClose={onClose} title={`${initial?.title ? 'Edit stop' : 'Add stop'}${dayLabel ? ` — ${dayLabel}` : ''}`}>
      <form onSubmit={submit}>
        <div className="form-row">
          <Field label="Stop name" error={errs.title}>
            <input className="input" value={v.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Cheeyappara Waterfalls" />
          </Field>
          <Field label="Category">
            <select className="select" value={v.category} onChange={e => set('category', e.target.value as StopCategory)}>
              {STOP_CATEGORIES.map(c => <option key={c} value={c}>{labelCat(c)}</option>)}
            </select>
          </Field>
        </div>

        <div className="form-row">
          <Field label="Location / area" hint={v.geocoded ? '✓ Pinned to a real place on the map' : 'Start typing and pick a suggestion to pin it on the map'} error={errs.locationName}>
            <LocationInput
              value={v.locationName}
              onChange={val => { set('locationName', val); if (v.geocoded) set('geocoded', false) }}
              onPick={onPlacePicked}
              placeholder="Search, e.g. Idukki district, Kerala"
            />
          </Field>
          <Field label="Priority">
            <select className="select" value={v.priority} onChange={e => set('priority', e.target.value as ItineraryStop['priority'])}>
              <option value="must-do">Must do</option>
              <option value="nice-to-have">Nice to have</option>
              <option value="optional">Optional</option>
            </select>
          </Field>
        </div>

        {(() => {
          const hoursRelevant = v.pickedKind === 'poi' || !!v.openTime || !!v.closeTime ||
            (!v.geocoded && HOURS_CATEGORIES.has(v.category))
          return (
            <div className="form-row" style={{ gridTemplateColumns: hoursRelevant ? '1fr 1fr 1fr' : '1fr' }}>
              <Field label="Visit duration (min)" error={errs.visitMinutes}>
                <input type="number" min={0} step={5} className="input" value={v.visitMinutes} onChange={e => set('visitMinutes', Number(e.target.value))} />
              </Field>
              {hoursRelevant && (
                <Field label="Opens at" hint={hoursHint}>
                  <input type="time" className="input" value={v.openTime} onChange={e => set('openTime', e.target.value)} />
                </Field>
              )}
              {hoursRelevant && (
                <Field label="Closes at" error={errs.closeTime}>
                  <input type="time" className="input" value={v.closeTime} onChange={e => set('closeTime', e.target.value)} />
                </Field>
              )}
            </div>
          )
        })()}

        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Entry fee per person (₹)" hint="0 for free places">
            <input type="number" min={0} className="input" value={v.entryFeeInrPerPerson} onChange={e => set('entryFeeInrPerPerson', Number(e.target.value))} />
          </Field>
          <Field label="Transport cost to reach (₹, total)" hint="Fuel share, taxi or bus fare to this stop">
            <input type="number" min={0} className="input" value={v.transportCostInrTotal} onChange={e => set('transportCostInrTotal', Number(e.target.value))} />
          </Field>
        </div>

        {legContext && v.geocoded && (
          <div className="card" style={{ background: 'var(--bg-2, #f7f7f5)', padding: 12, marginBottom: 12 }}>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
              🚗 Travel to this stop {legState === 'loading' ? <span className="muted">— measuring road…</span> : ''}
            </div>
            <div className="small muted" style={{ marginBottom: 10 }}>
              {legContext.fromName} → {v.title || v.locationName || 'this stop'}
              {legContext.nextName ? <> → {legContext.nextName}</> : null}
              {v.legFromOsrm ? ' · real road data' : ''}
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
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
              </Field>
              <Field label="Arrive at">
                <input type="time" className="input" value={v.arrivalTime} onChange={e => set('arrivalTime', e.target.value)} />
              </Field>
            </div>
            {v.legDistanceKm > 0 && (
              <div className="small muted">
                ≈ {formatInr(v.legDistanceKm * (getAssumptions({ transportMode: legContext.transportMode, fuelEconomyKmL: legContext.fuelEconomyKmL }).inrPerKm ?? 8))} fuel/fare at {legContext.transportMode} rates{legContext.fuelEconomyKmL ? ` · ${legContext.fuelEconomyKmL} km/L` : ''}
              </div>
            )}
          </div>
        )}

        <Field label="Description">
          <textarea className="textarea" value={v.description} onChange={e => set('description', e.target.value)} placeholder="What makes this place worth the detour?" />
        </Field>
        <Field label="Notes">
          <textarea className="textarea" style={{ minHeight: 52 }} value={v.notes} onChange={e => set('notes', e.target.value)} placeholder="Parking tips, booking links, reminders…" />
        </Field>

        <div className="form-row">
          <Field label="Source link (optional)">
            <input className="input" value={v.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Status">
            <select className="select" value={v.status} onChange={e => set('status', e.target.value as StopStatus)}>
              {STOP_STATUSES.map(s => <option key={s} value={s}>{labelStatus(s)}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 6 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{initial?.title ? 'Save changes' : 'Add to timeline'}</button>
        </div>
      </form>
    </Modal>
  )
}

function normalize(v?: Partial<StopFormValues>): StopFormValues {
  return {
    title: '', category: 'sightseeing', locationName: '',
    lat: DEFAULT_LATLNG.lat, lng: DEFAULT_LATLNG.lng,
    description: '', visitMinutes: 60, openTime: '', closeTime: '',
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', notes: '', sourceUrl: '', status: 'suggested', geocoded: false,
    pickedKind: '',
    departTime: '', arrivalTime: '', legDistanceKm: 0, legTravelMinutes: 0,
    ...v,
  }
}

/** Categories whose stops plausibly have opening hours even without a geocoded pick. */
const HOURS_CATEGORIES = new Set<string>(['temple', 'museum', 'food', 'hotel', 'adventure', 'shopping', 'event'])

const DEFAULT_LATLNG = { lat: 10.0889, lng: 77.0595 } // Munnar default until geocoding exists

function labelCat(c: StopCategory): string {
  return c.replace('-', ' ').replace(/\b\w/g, m => m.toUpperCase())
}
function labelStatus(s: StopStatus): string {
  return s === 'needs-booking' ? 'Needs booking' : s[0].toUpperCase() + s.slice(1)
}
