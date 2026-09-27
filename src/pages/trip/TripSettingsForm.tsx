// ============ Trip workspace — trip settings form (Share tab) ============
// Bench-fidelity rebuild: the controls speak the Plan Bench's language (eyebrow
// blocks, big-value heads, mode grid, crew buttons, slider dials with drag
// bubbles) and a live "settings bill" receipt on the right mirrors every choice
// before it is saved. The sticky save bar spans both columns.
import { useState } from 'react'
import {
  ChevronDown, ChevronUp, TriangleAlert, X,
} from 'lucide-react'
import type { Trip, LatLngPoint, TransportMode } from '../../data/types'
import { TRANSPORT_MODES, TRAVEL_STYLES, STAY_STYLES } from '../../data/types'
import { updateTrip } from '../../store/store'
import { FUEL_PRICE_INR_PER_L, DEFAULT_FUEL_ECONOMY_KML, MODE_SPEED, formatInr, isFuelEconomyMode, parseFuelEconomyKmL, isImplausibleFuelEconomy, parseFuelPricePerL } from '../../lib/engine'
import { cap } from '../../lib/labels'
import { InlineIcon, modeIcon } from '../../components/icons'
import { isSelfDrivenMode } from '../../lib/ridePlan'
import { CREW_CHIPS, CREW_MAX, CREW_MIN, clampCrew } from '../../lib/crew'
import { defaultVehicleProfile } from '../../lib/vehicleProfile'
import { Field, RangeDial, StickyFormBar, toast } from '../../components/ui'
import { Select } from '../../components/Select'
import { DateRangeCalendar } from '../../components/DateRangeCalendar'
import { PillNav } from '../../components/PillNav'
import { LocationInput, pickLabel } from '../../components/LocationInput'
import type { StartPin } from '../../lib/startPin'
import { coordsForText, pinMatchesText } from '../../lib/startPin'
import { CoverImagePicker } from '../../components/CoverImagePicker'

/** The allowance the "drive after dinner" toggle turns on when a trip has none
 *  (#122's dhaba case: dinner at X, two more hours to Y). */
const DEFAULT_DRIVE_AFTER_DINNER_MIN = 120

/** #410: the two things the form says when the start's text and its pin stop
 *  agreeing — one for the edit that dropped the pin, one for the pair a save
 *  refused to persist. "Unpinned" is not an error: the trip still plans, and
 *  the existing degraders measure it honestly without a position. */
const START_UNPINNED = 'The start pin is off — the text now names a different city. Pick the city to pin it on the map again.'
const START_DROPPED = 'The stored start pin named a different city, so it was not saved. Pick the city to pin it.'

/** Icon per transport mode — the ONE map lives in components/icons (modeIcon);
 *  this file used to keep a private copy that drifted from the bench's. */

export function TripSettingsForm({ trip, editable }: { trip: Trip; editable: boolean }) {
  const [f, setF] = useState({
    name: trip.name, startLocation: trip.startLocation,
    destinations: [...trip.destinations],
    startDate: trip.startDate, endDate: trip.endDate,
    travellers: trip.travellers, budget: trip.budgetPerPersonInr,
    transportMode: trip.transportMode, travelStyle: trip.travelStyle,
    stayStyle: (trip.stayStyle ?? (trip.travelStyle === 'budget' || trip.travelStyle === 'luxury' ? trip.travelStyle : 'comfort')) as 'budget' | 'comfort' | 'luxury',
    fuelEconomy: trip.fuelEconomyKmL?.toString() ?? '',
    fuelPrice: trip.fuelPricePerL?.toString() ?? '',
    roundTrip: trip.roundTrip ?? true,
    // #189 / 20260915_trip_party_prefs.sql: the persisted profile wins; a
    // motorcycle or rental trip no longer opens the form looking like a car.
    // Unknown / conducted modes fall back to the car default via the shared
    // owner in lib/vehicleProfile (the engine and Create trip agree on it).
    vehicleType: trip.vehicleProfile?.vehicleType
      ?? defaultVehicleProfile(trip.transportMode).vehicleType,
    fuelType: trip.vehicleProfile?.fuelType
      ?? defaultVehicleProfile(trip.transportMode).fuelType,
    capacity: trip.vehicleProfile?.capacity?.toString() ?? '',
    vehicleEconomy: trip.vehicleProfile?.economy?.toString() ?? '',
    // Who is behind the wheel (#142) — the same three inputs Create-trip asks
    // for, so an existing trip can change its party without being recreated.
    // The engine already honours all three (wheelCapHoursForParty + anchors).
    driverCount: trip.driverCount,
    hasVulnerable: trip.hasVulnerable,
    driveAfterDinner: (trip.driveAfterDinnerMin ?? 0) > 0,
  })
  const [dateErr, setDateErr] = useState<string | null>(null)
  // The day grid follows the date range — show what the picker will do to it.
  const dayDelta = (() => {
    const s = new Date(`${f.startDate}T00:00:00`), e = new Date(`${f.endDate}T00:00:00`)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return null
    const target = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
    return target - trip.days.length
  })()
  const [startPin, setStartPin] = useState<StartPin | null>(
    trip.startLocationCoords ? { coords: trip.startLocationCoords, label: trip.startLocation } : null,
  )
  /** #410: soft notice under the start field — the pin is off, and why. */
  const [startNotice, setStartNotice] = useState('')
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
  // #213 Phase 5: clampCrew, not Math.min(12,…) — the old clamp misrepresented a
  // larger party as 12 and any chip tap then dropped it.
  const travellers = clampCrew(f.travellers)
  const clampedBudget = Math.min(300000, Math.max(0, f.budget))
  const dayCount = dayDelta === null ? trip.days.length : trip.days.length + dayDelta
  const dayDeltaLabel = dayDelta === null
    ? 'Pick both dates to preview the day grid'
    : dayDelta === 0 ? 'Day count unchanged'
    : dayDelta > 0 ? `Adds ${dayDelta} empty day${dayDelta !== 1 ? 's' : ''} at the end`
    : `Drops ${-dayDelta} empty trailing day${dayDelta !== -1 ? 's' : ''} (days with stops are kept)`
  const fuelMode = isFuelEconomyMode(f.transportMode)
  // Party controls are gated on the ENGINE's own predicate, so Settings and
  // Create Trip agree (Create used to hard-code a slightly different set that
  // included `taxi` and omitted `mixed` — dead controls in one place, hidden
  // controls in the other).
  const selfDriven = isSelfDrivenMode(f.transportMode)
  const ecoNum = parseFuelEconomyKmL(f.fuelEconomy)
  const priceNum = parseFuelPricePerL(f.fuelPrice)
  const ecoSet = typeof ecoNum === 'number' && Number.isFinite(ecoNum)
  const priceSet = typeof priceNum === 'number' && Number.isFinite(priceNum)
  // ONE default across the app (#213 Phase 5): the bench and Create Trip both
  // use 15 km/L, and this dial used to show 18 — three "defaults" for the same
  // car. The constant lives next to the fuel price in lib/engine.
  const ecoVal = ecoSet ? ecoNum : DEFAULT_FUEL_ECONOMY_KML
  const priceVal = priceSet ? priceNum : FUEL_PRICE_INR_PER_L
  // The engine prices a self-drive trip from fuel only when BOTH are stated
  // (engine.ts `economy && price`); with the price set and no mileage the ₹/L
  // is silently unused. Say so instead of letting the bill read the blended rate.
  const priceIgnored = priceSet && !ecoSet

  return (
    <div className="ts-form">
      {/* Two dials, two bars. These used to share one block with the style bar on
          top and the price bar tucked underneath it, so the second read as a
          sub-option of the first. Budget preference asks what the bed costs;
          Travel style asks how the trip moves and what it suggests. Neither
          touches the other, and the bars now say so. */}
      <div className="bench-block">
        <span className="bench-eyebrow">Budget preference</span>
        <PillNav className="tabbar" role="group" aria-label="Budget preference" activeKey={f.stayStyle}>
          {STAY_STYLES.map(s => (
            <button key={s} type="button" data-pill-key={s} disabled={!editable}
              aria-pressed={f.stayStyle === s}
              className={`tab-btn${f.stayStyle === s ? ' active' : ''}`}
              onClick={() => setF(x => ({ ...x, stayStyle: s }))}>
              {cap(s)}
            </button>
          ))}
        </PillNav>
        <p className="bench-hint">Prices the bed: ₹1,200 / ₹3,200 / ₹8,000 per room per night (2 guests per room). Shows up honestly on the Budget tab when you have hotel stops.</p>
      </div>

      {/* Travel style — the trip navbar's exact look, full width so all ten
          styles sit in one row like the workspace tab bar: same .tabbar glass
          bar, same .tab-btn pills, same sliding glider. */}
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
        <p className="bench-hint">Tunes stop frequency and the kind of places suggested — relaxed stops sooner, packed pushes further. It never touches pricing.</p>
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
            <DateRangeCalendar
              start={f.startDate} end={f.endDate}
              disabled={!editable}
              error={dateErr ?? undefined}
              hint={dayDeltaLabel}
              onChange={({ startDate, endDate }) => { setF(x => ({ ...x, startDate, endDate })); setDateErr(null) }}
            />
            {dateErr && <p className="err-text ts-warn-note" role="alert">{dateErr}</p>}
            <Field label="Starting location">
              <LocationInput
                value={f.startLocation}
                onChange={v => {
                  setF(x => ({ ...x, startLocation: v }))
                  // #410: the pin belongs to the text it was picked for. An
                  // edit that names a different city DROPS the pin — keeping
                  // the old coordinates here is how a renamed trip silently
                  // keeps measuring the city it no longer names. A pick
                  // restores it instantly, below.
                  if (startPin && !pinMatchesText(startPin, v)) {
                    setStartPin(null)
                    setStartNotice(START_UNPINNED)
                  }
                }}
                onPick={p => {
                  setStartPin({ coords: { lat: p.latitude, lng: p.longitude }, label: pickLabel(p) })
                  setStartNotice('')
                }}
                placeholder="Search a city…"
                disabled={!editable}
              />
              {startNotice && <p className="hint-text" role="status" style={{ marginTop: 6 }}>{startNotice}</p>}
            </Field>
            <Field label={`Destinations (${f.destinations.length})`} hint="Search to add — arrows reorder the route">
              <LocationInput
                value={destInput}
                onChange={setDestInput}
                onPick={p => addDest(p.name + (p.admin1 ? `, ${p.admin1}` : ''), { lat: p.latitude, lng: p.longitude })}
                placeholder={f.destinations.length ? 'Add another destination…' : 'Add your first destination…'}
                disabled={!editable}
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
                {CREW_CHIPS.map(n => (
                  <button key={n} type="button" className={`bench-crew-btn${travellers === n ? ' on' : ''}`}
                    aria-pressed={travellers === n} disabled={!editable}
                    onClick={() => setF(x => ({ ...x, travellers: n }))}>
                    {n}
                  </button>
                ))}
              </div>
              {/* A party bigger than the chips needs a way in — Create Trip has
                  the same field, so the two surfaces accept the same range. */}
              <div className="bench-line" style={{ marginTop: 8 }}>
                <label className="bench-hint" htmlFor="ts-crew-custom">More than 10? </label>
                <input id="ts-crew-custom" className="input mono" type="number" inputMode="numeric"
                  min={CREW_MIN} max={CREW_MAX} disabled={!editable} value={f.travellers}
                  style={{ maxWidth: 96 }}
                  onChange={e => setF(x => ({ ...x, travellers: clampCrew(Number(e.target.value)) }))} />
                <span className="bench-hint">up to {CREW_MAX}</span>
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
              <p className="bench-hint">The Budget tab’s pacing tile reads this target.</p>
            </div>
          </div>

          {/* Who's driving — party + dinner pace (#142). Same three inputs the
              Create-trip flow asks for; until now an existing trip could not
              change them, so the split verdict and the clock walk were frozen
              at whatever the trip was created with. #213 Phase 5: gated on the
              ENGINE's own `isSelfDrivenMode` (car/rental/motorcycle/mixed) so the
              two surfaces agree and no dial is shown for a mode that ignores it
              (train/bus/flight/taxi have nobody at the wheel to fatigue). */}
          {selfDriven && (
            <div className="bench-block">
              <div className="bench-block-head">
                <span className="bench-eyebrow">Who&apos;s driving</span>
                <span className="bench-block-value">
                  {(f.driverCount ?? 1) === 1 ? 'One driver' : `${f.driverCount} drivers`}
                </span>
              </div>
              <div className="bench-line" role="group" aria-label="Drivers sharing the wheel">
                {[1, 2, 3].map(n => (
                  <button key={n} type="button" className={`bench-crew-btn${(f.driverCount ?? 1) === n ? ' on' : ''}`}
                    aria-pressed={(f.driverCount ?? 1) === n} disabled={!editable}
                    title={n === 1 ? 'One driver — the honest solo cap' : `${n} drivers rotate — the day earns real hours`}
                    onClick={() => setF(x => ({ ...x, driverCount: n === 1 ? undefined : n }))}>
                    {n}
                  </button>
                ))}
                <span className="bench-hint">Rotating drivers buy hours; one driver keeps the solo cap.</span>
              </div>
              <div className="bench-line" role="group" aria-label="Who is aboard">
                <button type="button" className={`bench-crew-btn${!f.hasVulnerable ? ' on' : ''}`}
                  aria-pressed={!f.hasVulnerable} disabled={!editable}
                  title="Everyone adult — full-length driving days"
                  onClick={() => setF(x => ({ ...x, hasVulnerable: undefined }))}>Everyone adult</button>
                <button type="button" className={`bench-crew-btn${f.hasVulnerable ? ' on' : ''}`}
                  aria-pressed={!!f.hasVulnerable} disabled={!editable}
                  title="Infants or seniors aboard — shorter days, earlier dinner"
                  onClick={() => setF(x => ({ ...x, hasVulnerable: true }))}>Infants / seniors</button>
              </div>
              <div className="bench-line" role="group" aria-label="Dinner and driving">
                <button type="button" className={`bench-crew-btn${f.driveAfterDinner ? ' on' : ''}`}
                  aria-pressed={f.driveAfterDinner} disabled={!editable}
                  title="Halt for dinner, then keep going within the allowance and the night end"
                  onClick={() => setF(x => ({ ...x, driveAfterDinner: !f.driveAfterDinner }))}>Drive after dinner</button>
              </div>
              <p className="bench-hint">The split verdict and the travel clock re-derive from these — meals, halts and the honest daily cap all move.</p>
            </div>
          )}

          {/* Transport mode — bench mode grid */}
          <div className="bench-block bench-mode-block">
            <span className="bench-eyebrow">How you travel</span>
            <div className="bench-mode-grid" role="group" aria-label="Transport mode">
              {TRANSPORT_MODES.map(m => (
                <button key={m} type="button" className={`bench-mode-btn${f.transportMode === m ? ' on' : ''}`}
                  aria-pressed={f.transportMode === m} disabled={!editable}
                  onClick={() => setF(x => ({ ...x, transportMode: m }))}>
                  {modeIcon(m)}
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
                  <InlineIcon icon={TriangleAlert} size={12} gap={3} />Unusual for a {f.transportMode} — most do far better. Double-check the mileage.
                </p>
              )}
              {priceIgnored && (
                <p className="hint-text ts-warn-note">
                  <InlineIcon icon={TriangleAlert} size={12} gap={3} />Your fuel price is unused until you set a mileage — the bill is pricing the blended {cap(f.transportMode)} rate instead.
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
                    <Select disabled={!editable} value={f.vehicleType} onChange={v => setF(x => ({ ...x, vehicleType: v as never }))}
                      options={[{ value: 'car', label: 'Car' }, { value: 'motorcycle', label: 'Motorcycle' }, { value: 'ev', label: 'Electric (EV)' }]} />
                  </Field>
                  <Field label="Fuel / energy">
                    <Select disabled={!editable} value={f.fuelType} onChange={v => setF(x => ({ ...x, fuelType: v as never }))}
                      options={[{ value: 'petrol', label: 'Petrol' }, { value: 'diesel', label: 'Diesel' }, { value: 'electric', label: 'Electric' }, { value: 'cng', label: 'CNG' }]} />
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
            <span className="bench-stamp" aria-hidden="true">Preview</span>
            <div className="bench-receipt-head">
              <span className="bench-receipt-kicker">Trip settings bill</span>
              <span className="bench-receipt-date">{f.startDate && f.endDate ? `${f.startDate} → ${f.endDate}` : 'Dates not set'}</span>
            </div>
            <div className="ts-receipt-name">{f.name || 'Untitled trip'}</div>
            <div className="bench-meta-row">
              {modeIcon(f.transportMode)}
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
          // updateTrip toasts the rejection itself (e.g. a shrink blocked by a
          // day holding stops) and returns false — no success toast then.
          // #410 backstop: never persist a pair whose text and pin disagree,
          // whatever produced it. The interactive path drops the pin at edit
          // time (above); this catches a state the form did not create — and a
          // legacy row saved by the old code, which the pin's own label cannot
          // reveal. The trip saves unpositioned rather than measuring the
          // wrong city under the right name.
          const startCoordsToSave = coordsForText(startPin, f.startLocation)
          if (startPin && !startCoordsToSave) setStartNotice(START_DROPPED)
          const saved = updateTrip(trip.id, {
            name: f.name, startLocation: f.startLocation,
            startLocationCoords: startCoordsToSave ?? undefined,
            startDate: f.startDate, endDate: f.endDate,
            destinations: f.destinations.map(s => s.trim()).filter(Boolean),
            destinationCoords: destCoords,
            travellers: clampCrew(f.travellers),
            // The party dials only exist for self-drive modes (the block above is
            // gated on the same predicate), so a conducted trip never carries
            // them — and switching to one clears what a previous mode set.
            driverCount: selfDriven ? f.driverCount : undefined,
            hasVulnerable: selfDriven ? f.hasVulnerable : undefined,
            // #213 Phase 5: only write the 120-minute default when the toggle is
            // being turned ON. A trip stored with a custom allowance (say 60)
            // used to be silently rewritten to 120 by any unrelated save.
            driveAfterDinnerMin: !selfDriven
              ? undefined
              : f.driveAfterDinner
                ? (trip.driveAfterDinnerMin ?? DEFAULT_DRIVE_AFTER_DINNER_MIN)
                : undefined,
            budgetPerPersonInr: Math.max(0, f.budget),
            transportMode: f.transportMode, travelStyle: f.travelStyle,
            stayStyle: f.stayStyle,
            fuelEconomyKmL: isFuelEconomyMode(f.transportMode) ? parseFuelEconomyKmL(f.fuelEconomy) : undefined,
            fuelPricePerL: isFuelEconomyMode(f.transportMode) ? parseFuelPricePerL(f.fuelPrice) : undefined,
            roundTrip: isFuelEconomyMode(f.transportMode) ? f.roundTrip : undefined,
            // #213 Phase 6: the fallbacks come from the CHOSEN vehicle's own
            // profile, not hardcoded car numbers. `Number('45') || 45` used to
            // write a 45 L / 15 km-L car onto a motorcycle (12 / 40) or an EV
            // (50 kWh / 6) whenever the fields were left blank.
            vehicleProfile: isFuelEconomyMode(f.transportMode) ? {
              vehicleType: f.vehicleType as 'car' | 'motorcycle' | 'ev',
              fuelType: f.fuelType as 'petrol' | 'diesel' | 'electric' | 'cng',
              capacity: Number(f.capacity) || defaultVehicleProfile(f.vehicleType).capacity,
              economy: Number(f.vehicleEconomy) || defaultVehicleProfile(f.vehicleType).economy,
            } : undefined,
          })
          if (saved) {
            setDateErr(null)
            toast('Trip settings updated')
          }
        }}>Save settings</button>
      </StickyFormBar>
    </div>
  )
}
