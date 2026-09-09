// ============ Trip workspace — trip settings form (Share tab) ============
// Bench-fidelity rebuild: the controls speak the Plan Bench's language (eyebrow
// blocks, big-value heads, mode grid, crew buttons, slider dials with drag
// bubbles) and a live "settings bill" receipt on the right mirrors every choice
// before it is saved. The sticky save bar spans both columns.
import { useState, type ReactNode } from 'react'
import {
  Bike, Bus, Car, CarTaxiFront, ChevronDown, ChevronUp,
  KeyRound, Plane, Shuffle, TrainFront, TriangleAlert, X,
} from 'lucide-react'
import type { Trip, LatLngPoint, TransportMode } from '../../data/types'
import { TRANSPORT_MODES, TRAVEL_STYLES } from '../../data/types'
import { updateTrip } from '../../store/store'
import { FUEL_PRICE_INR_PER_L, MODE_SPEED, formatInr, isFuelEconomyMode, parseFuelEconomyKmL, isImplausibleFuelEconomy, parseFuelPricePerL } from '../../lib/engine'
import { cap } from '../../lib/labels'
import { Field, RangeDial, StickyFormBar, toast } from '../../components/ui'
import { PillNav } from '../../components/PillNav'
import { LocationInput } from '../../components/LocationInput'
import { CoverImagePicker } from '../../components/CoverImagePicker'

/** Icon per transport mode — mirrors the bench's mode tiles. */
const MODE_ICON: Record<TransportMode, ReactNode> = {
  car: <Car size={15} />, rental: <KeyRound size={15} />, motorcycle: <Bike size={15} />, train: <TrainFront size={15} />,
  bus: <Bus size={15} />, flight: <Plane size={15} />, taxi: <CarTaxiFront size={15} />,
  mixed: <Shuffle size={15} />,
}

export function TripSettingsForm({ trip, editable }: { trip: Trip; editable: boolean }) {
  const [f, setF] = useState({
    name: trip.name, startLocation: trip.startLocation,
    destinations: [...trip.destinations],
    startDate: trip.startDate, endDate: trip.endDate,
    travellers: trip.travellers, budget: trip.budgetPerPersonInr,
    transportMode: trip.transportMode, travelStyle: trip.travelStyle,
    fuelEconomy: trip.fuelEconomyKmL?.toString() ?? '',
    fuelPrice: trip.fuelPricePerL?.toString() ?? '',
    roundTrip: trip.roundTrip ?? true,
    vehicleType: trip.vehicleProfile?.vehicleType ?? 'car',
    fuelType: trip.vehicleProfile?.fuelType ?? 'petrol',
    capacity: trip.vehicleProfile?.capacity?.toString() ?? '',
    vehicleEconomy: trip.vehicleProfile?.economy?.toString() ?? '',
  })
  const [dateErr, setDateErr] = useState<string | null>(null)
  // The day grid follows the date range — show what the picker will do to it.
  const dayDelta = (() => {
    const s = new Date(`${f.startDate}T00:00:00`), e = new Date(`${f.endDate}T00:00:00`)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return null
    const target = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
    return target - trip.days.length
  })()
  const [startCoords, setStartCoords] = useState<LatLngPoint | null>(trip.startLocationCoords ?? null)
  const [destCoords, setDestCoords] = useState<(LatLngPoint | null)[]>(trip.destinationCoords ?? [])
  const [destInput, setDestInput] = useState('')

  function addDest(name: string, coords: LatLngPoint | null) {
    const clean = name.trim()
    if (!clean) return
    if (f.destinations.some(d => d.toLowerCase() === clean.toLowerCase())) {
      toast('Already on the route.', 'err'); return
    }
    setF(x => ({ ...x, destinations: [...x.destinations, clean] }))
    setDestCoords(list => [...list, coords])
    setDestInput('')
  }

  // Derived values the bench-style blocks and the live receipt read from.
  const travellers = Math.min(12, Math.max(1, f.travellers))
  const clampedBudget = Math.min(300000, Math.max(0, f.budget))
  const dayCount = dayDelta === null ? trip.days.length : trip.days.length + dayDelta
  const dayDeltaLabel = dayDelta === null
    ? 'Pick both dates to preview the day grid'
    : dayDelta === 0 ? 'Day count unchanged'
    : dayDelta > 0 ? `Adds ${dayDelta} empty day${dayDelta !== 1 ? 's' : ''} at the end`
    : `Drops ${-dayDelta} empty trailing day${dayDelta !== -1 ? 's' : ''} (days with stops are kept)`
  const fuelMode = isFuelEconomyMode(f.transportMode)
  const ecoNum = parseFuelEconomyKmL(f.fuelEconomy)
  const priceNum = parseFuelPricePerL(f.fuelPrice)
  const ecoSet = typeof ecoNum === 'number' && Number.isFinite(ecoNum)
  const priceSet = typeof priceNum === 'number' && Number.isFinite(priceNum)
  const ecoVal = ecoSet ? ecoNum : 18
  const priceVal = priceSet ? priceNum : FUEL_PRICE_INR_PER_L

  return (
    <div className="ts-form">
      {/* Travel style — the trip navbar's exact look, at the top of the form and
          full width so all ten styles sit in one row like the workspace tab bar:
          same .tabbar glass bar, same .tab-btn pills, same sliding glider. */}
      <div className="bench-block">
        <span className="bench-eyebrow">Travel style</span>
        <PillNav className="tabbar" role="group" aria-label="Travel style" activeKey={f.travelStyle}>
          {TRAVEL_STYLES.map(s => (
            <button key={s} type="button" data-pill-key={s} disabled={!editable}
              aria-pressed={f.travelStyle === s}
              className={`tab-btn${f.travelStyle === s ? ' active' : ''}`}
              onClick={() => setF(x => ({ ...x, travelStyle: s }))}>
              {cap(s)}
            </button>
          ))}
        </PillNav>
        <p className="bench-hint">The engine tunes break cadence — relaxed stops sooner, packed pushes further.</p>
      </div>
      <div className="ts-layout">
        <div className="ts-controls">

          {/* Identity */}
          <div className="bench-block">
            <span className="bench-eyebrow">Identity</span>
            <Field label="Trip name">
              <input className="input" disabled={!editable} value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} />
            </Field>
            <Field label="Cover image">
              <CoverImagePicker trip={trip} editable={editable} />
              <p className="hint-text">Pick a popular photo of your destination, paste your own image URL, or leave it to the emoji.</p>
            </Field>
          </div>

          {/* Route + dates */}
          <div className="bench-block">
            <div className="bench-block-head">
              <span className="bench-eyebrow">Route & dates</span>
              <span className="bench-block-value">{dayCount} day{dayCount === 1 ? '' : 's'}</span>
            </div>
            <div className="form-row">
              <Field label="Start date">
                <input type="date" className="input" disabled={!editable} value={f.startDate}
                  aria-invalid={!!dateErr}
                  onChange={e => { setF(x => ({ ...x, startDate: e.target.value })); setDateErr(null) }} />
              </Field>
              <Field label="End date" hint={dayDeltaLabel}>
                <input type="date" className="input" disabled={!editable} value={f.endDate}
                  aria-invalid={!!dateErr}
                  onChange={e => { setF(x => ({ ...x, endDate: e.target.value })); setDateErr(null) }} />
              </Field>
            </div>
            {dateErr && <p className="err-text ts-warn-note" role="alert">{dateErr}</p>}
            <Field label="Starting location">
              <LocationInput
                value={f.startLocation}
                onChange={v => setF(x => ({ ...x, startLocation: v }))}
                onPick={p => setStartCoords({ lat: p.latitude, lng: p.longitude })}
                placeholder="Search a city…"
              />
            </Field>
            <Field label={`Destinations (${f.destinations.length})`} hint="Search to add — arrows reorder the route">
              <LocationInput
                value={destInput}
                onChange={setDestInput}
                onPick={p => addDest(p.name + (p.admin1 ? `, ${p.admin1}` : ''), { lat: p.latitude, lng: p.longitude })}
                placeholder={f.destinations.length ? 'Add another destination…' : 'Add your first destination…'}
              />
              {f.destinations.length > 0 && (
                <div className="dest-chips">
                  {f.destinations.map((d, i) => (
                    <span key={`${d}-${i}`} className="dest-chip">
                      <span className="dest-order">{i + 1}</span>{d}
                      <button type="button" aria-label={`Move ${d} earlier`} disabled={!editable || i === 0}
                        onClick={() => setF(x => {
                          const list = [...x.destinations]; if (i === 0) return x
                          ;[list[i - 1], list[i]] = [list[i], list[i - 1]]
                          const dc = [...destCoords]; [dc[i - 1], dc[i]] = [dc[i], dc[i - 1]]; setDestCoords(dc)
                          return { ...x, destinations: list }
                        })} style={{ opacity: i === 0 ? .25 : undefined }}><ChevronUp size={12} aria-hidden /></button>
                      <button type="button" aria-label={`Move ${d} later`} disabled={!editable || i === f.destinations.length - 1}
                        onClick={() => setF(x => {
                          const list = [...x.destinations]; if (i >= list.length - 1) return x
                          ;[list[i + 1], list[i]] = [list[i], list[i + 1]]
                          const dc = [...destCoords]; [dc[i + 1], dc[i]] = [dc[i], dc[i + 1]]; setDestCoords(dc)
                          return { ...x, destinations: list }
                        })} style={{ opacity: i === f.destinations.length - 1 ? .25 : undefined }}><ChevronDown size={12} aria-hidden /></button>
                      {editable && (
                        <button type="button" aria-label={`Remove ${d}`}
                          onClick={() => {
                            setF(x => ({ ...x, destinations: x.destinations.filter((_, j) => j !== i) }))
                            setDestCoords(list => list.filter((_, j) => j !== i))
                          }}><X size={12} aria-hidden /></button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </Field>
          </div>

          {/* Crew + budget — bench pair */}
          <div className="bench-pair">
            <div className="bench-block">
              <div className="bench-block-head">
                <span className="bench-eyebrow">Travellers</span>
                <span className="bench-block-value">{travellers}</span>
              </div>
              <div className="bench-crew" role="group" aria-label="Number of travellers">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                  <button key={n} type="button" className={`bench-crew-btn${travellers === n ? ' on' : ''}`}
                    aria-pressed={travellers === n} disabled={!editable}
                    onClick={() => setF(x => ({ ...x, travellers: n }))}>
                    {n}
                  </button>
                ))}
              </div>
              <p className="bench-hint">Rooms and per-head splits follow this count.</p>
            </div>
            <div className="bench-block">
              <div className="bench-block-head">
                <span className="bench-eyebrow">Budget / person</span>
                <span className="bench-block-value">{formatInr(clampedBudget)}</span>
              </div>
              <RangeDial value={clampedBudget} min={0} max={300000} step={500}
                fmt={v => formatInr(v)} ariaLabel="Budget per person in rupees"
                disabled={!editable} onChange={v => setF(x => ({ ...x, budget: v }))} />
              <div className="bench-scale-ends" aria-hidden="true"><span>₹0</span><span>₹3L</span></div>
              <p className="bench-hint">The Budget tab's pacing tile reads this target.</p>
            </div>
          </div>

          {/* Transport mode — bench mode grid */}
          <div className="bench-block">
            <span className="bench-eyebrow">How you travel</span>
            <div className="bench-mode-grid" role="group" aria-label="Transport mode">
              {TRANSPORT_MODES.map(m => (
                <button key={m} type="button" className={`bench-mode-btn${f.transportMode === m ? ' on' : ''}`}
                  aria-pressed={f.transportMode === m} disabled={!editable}
                  onClick={() => setF(x => ({ ...x, transportMode: m }))}>
                  {MODE_ICON[m]}
                  <span className="bench-mode-name">{cap(m)}</span>
                  <span className="bench-mode-speed" aria-hidden="true">{MODE_SPEED[m] ?? 40}</span>
                </button>
              ))}
            </div>
            <p className="bench-hint">Car and motorcycle switch cost math to fuel: distance ÷ economy × pump price.</p>
          </div>

          {/* Fuel + vehicle — only for self-drive modes */}
          {fuelMode && (
            <>
              <div className="bench-block bench-fuel-pair">
                <div className="bench-fuel-col">
                  <span className="bench-eyebrow">Your mileage</span>
                  <span className="bench-fuel-value">{ecoSet ? `${ecoNum} km/L` : 'Not set'}</span>
                  <RangeDial value={ecoVal} min={2} max={80} step={0.5}
                    fmt={v => `${v} km/L`} ariaLabel="Fuel economy in kilometres per litre"
                    disabled={!editable} onChange={v => setF(x => ({ ...x, fuelEconomy: String(v) }))} />
                </div>
                <div className="bench-fuel-col">
                  <span className="bench-eyebrow">Fuel price</span>
                  <span className="bench-fuel-value">{priceSet ? `₹${priceNum}/L` : `₹${FUEL_PRICE_INR_PER_L}/L default`}</span>
                  <RangeDial value={priceVal} min={50} max={250} step={0.5}
                    fmt={v => `₹${v}/L`} ariaLabel="Fuel price in rupees per litre"
                    disabled={!editable} onChange={v => setF(x => ({ ...x, fuelPrice: String(v) }))} />
                </div>
              </div>
              {isImplausibleFuelEconomy(f.transportMode, ecoSet ? ecoNum : undefined) && (
                <p className="hint-text ts-warn-note">
                  <TriangleAlert size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Unusual for a {f.transportMode} — most do far better. Double-check the mileage.
                </p>
              )}
              <button type="button" className={`bench-toggle${f.roundTrip ? ' on' : ''}`}
                aria-pressed={f.roundTrip} disabled={!editable}
                aria-label={`Round trip${f.roundTrip ? ' — the return to start is included in transport costs' : ' — off, one-way costs only'}`}
                onClick={() => setF(x => ({ ...x, roundTrip: !x.roundTrip }))}>
                Round trip{f.roundTrip ? ' — return included' : ''}
              </button>
              <div className="vehicle-profile-form">
                <div className="form-row">
                  <Field label="Vehicle type">
                    <select className="select" disabled={!editable} value={f.vehicleType} onChange={e => setF(x => ({ ...x, vehicleType: e.target.value as never }))}>
                      <option value="car">Car</option>
                      <option value="motorcycle">Motorcycle</option>
                      <option value="ev">Electric (EV)</option>
                    </select>
                  </Field>
                  <Field label="Fuel / energy">
                    <select className="select" disabled={!editable} value={f.fuelType} onChange={e => setF(x => ({ ...x, fuelType: e.target.value as never }))}>
                      <option value="petrol">Petrol</option>
                      <option value="diesel">Diesel</option>
                      <option value="electric">Electric</option>
                      <option value="cng">CNG</option>
                    </select>
                  </Field>
                </div>
                <div className="form-row">
                  <Field label={f.fuelType === 'electric' ? 'Battery (kWh)' : 'Tank capacity (L)'} hint={f.fuelType === 'electric' ? 'e.g. 50' : 'e.g. 45'}>
                    <input type="number" min={1} max={300} step={0.5} className="input" disabled={!editable} value={f.capacity}
                      onChange={e => setF(x => ({ ...x, capacity: e.target.value }))} placeholder={f.fuelType === 'electric' ? '50' : '45'} />
                  </Field>
                  <Field label={f.fuelType === 'electric' ? 'Efficiency (km / kWh)' : 'Economy (km / L)'} hint={f.fuelType === 'electric' ? 'e.g. 6' : 'e.g. 15'}>
                    <input type="number" min={1} max={200} step={0.1} className="input" disabled={!editable} value={f.vehicleEconomy}
                      onChange={e => setF(x => ({ ...x, vehicleEconomy: e.target.value }))} placeholder={f.fuelType === 'electric' ? '6' : '15'} />
                  </Field>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Live settings bill — mirrors every choice before Save */}
        <aside className="ts-receiptcol" aria-label="Live preview of these settings">
          <div className="bench-receipt card">
            <span className="bench-barcode" aria-hidden="true" />
            <span className="bench-stamp" aria-hidden="true">PREVIEW</span>
            <div className="bench-receipt-head">
              <span className="bench-receipt-kicker">Trip settings bill</span>
              <span className="bench-receipt-date">{f.startDate && f.endDate ? `${f.startDate} → ${f.endDate}` : 'Dates not set'}</span>
            </div>
            <div className="ts-receipt-name">{f.name || 'Untitled trip'}</div>
            <div className="bench-meta-row">
              {MODE_ICON[f.transportMode]}
              <span>{cap(f.transportMode)} · {travellers} travelling · {cap(f.travelStyle)}</span>
            </div>
            <div className="bench-total" aria-live="polite">
              <div className="bench-total-label">Group budget</div>
              <div className="bench-total-main">{formatInr(clampedBudget * travellers)}</div>
              <span className="bench-total-sub">{formatInr(clampedBudget)} / head · split {travellers} way{travellers === 1 ? '' : 's'} · {dayCount} day{dayCount === 1 ? '' : 's'}</span>
            </div>
            <div className="bench-receipt-lines">
              <div className="bench-line">
                <div className="bench-line-head"><span>Day grid</span><b>{dayCount} days</b></div>
                <span className="bench-line-formula">{dayDeltaLabel} on save</span>
              </div>
              <div className="bench-line">
                <div className="bench-line-head"><span>Cost math</span><b>{fuelMode ? 'Fuel' : 'Default rates'}</b></div>
                <span className="bench-line-formula">
                  {fuelMode
                    ? (ecoSet && priceSet
                      ? `${ecoNum} km/L × ₹${priceNum}/L${f.roundTrip ? ' · round trip billed twice' : ' · one way'}`
                      : `Defaults (≈${ecoVal} km/L · ₹${FUEL_PRICE_INR_PER_L}/L) until you set mileage and price`)
                    : `Per-km fare for ${cap(f.transportMode)}`}
                </span>
              </div>
            </div>
            <div className="bench-receipt-rules" />
            <p className="bench-fineprint">
              Saving applies these settings to everyone on the trip · budgets, pacing and cost math recompute from mode, economy and dates
            </p>
          </div>
        </aside>
      </div>

      <StickyFormBar show={editable}>
        <button className="btn btn-primary" onClick={() => {
          // Dates drive the day grid — validate the pair here for an inline
          // message (updateTrip re-checks and toasts on reconcile failures).
          const s = new Date(`${f.startDate}T00:00:00`), e = new Date(`${f.endDate}T00:00:00`)
          if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) { setDateErr('Pick both a start and an end date.'); return }
          if (e < s) { setDateErr('The end date must be on or after the start date.'); return }
          updateTrip(trip.id, {
            name: f.name, startLocation: f.startLocation,
            startLocationCoords: startCoords ?? undefined,
            startDate: f.startDate, endDate: f.endDate,
            destinations: f.destinations.map(s => s.trim()).filter(Boolean),
            destinationCoords: destCoords,
            travellers: Math.max(1, f.travellers),
            budgetPerPersonInr: Math.max(0, f.budget),
            transportMode: f.transportMode, travelStyle: f.travelStyle,
            fuelEconomyKmL: isFuelEconomyMode(f.transportMode) ? parseFuelEconomyKmL(f.fuelEconomy) : undefined,
            fuelPricePerL: isFuelEconomyMode(f.transportMode) ? parseFuelPricePerL(f.fuelPrice) : undefined,
            roundTrip: isFuelEconomyMode(f.transportMode) ? f.roundTrip : undefined,
            vehicleProfile: isFuelEconomyMode(f.transportMode) ? {
              vehicleType: f.vehicleType as 'car' | 'motorcycle' | 'ev',
              fuelType: f.fuelType as 'petrol' | 'diesel' | 'electric' | 'cng',
              capacity: Number(f.capacity) || 45,
              economy: Number(f.vehicleEconomy) || 15,
            } : undefined,
          })
          setDateErr(null)
          toast('Trip settings updated')
        }}>Save settings</button>
      </StickyFormBar>
    </div>
  )
}
