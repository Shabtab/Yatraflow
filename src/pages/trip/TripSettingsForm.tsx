// ============ Trip workspace — trip settings form (Share tab) ============
// Bench-fidelity rebuild: the controls speak the Plan Bench's language (eyebrow
// blocks, big-value heads, mode grid, crew buttons, slider dials with drag
// bubbles) and a live "settings bill" receipt on the right mirrors every choice
// before it is saved. The sticky save bar spans both columns.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  AlignLeft, CalendarDays, Car, CarFront, ChevronDown, ChevronUp, MapPin, Pencil, Plus, Share2, Trash2, TriangleAlert, Users, X,
} from 'lucide-react'
import type { Trip, TransportMode } from '../../data/types'
import { TRANSPORT_MODES, TRAVEL_STYLES, STAY_STYLES } from '../../data/types'
import { currentUser, updateTrip, reconcileDays, tripWriteVerdict, membersOf, roleOf, trashTrip, restoreTrashedTrip, useSessionUserId, useUsers } from '../../store/store'
import { FUEL_PRICE_INR_PER_L, DEFAULT_FUEL_ECONOMY_KML, MODE_SPEED, computeTotals, formatInr, isFuelEconomyMode, minutesToHM, parseFuelEconomyKmL, isImplausibleFuelEconomy, parseFuelPricePerL } from '../../lib/engine'
import { settingsPreview } from '../../lib/settingsPreview'
import type { LegEstimate } from '../../lib/engine'
import { healthBandClass, healthBandTone } from '../../lib/healthBand'
import { cap } from '../../lib/labels'
import { InlineIcon, modeIcon } from '../../components/icons'
import { transportPolicy } from '../../lib/transportPolicy'
import { CREW_MAX, CREW_MIN, clampCrew } from '../../lib/crew'
import { defaultVehicleProfile, parseCapacityL, parseVehicleEconomy } from '../../lib/vehicleProfile'
import { zipDests, splitDests, renameDest, type DestPair } from '../../lib/destPairs'
import { Field, RangeDial, StickyFormBar, toast, undoToast, useMedia } from '../../components/ui'
import { Select } from '../../components/Select'
import { DateRangeCalendar } from '../../components/DateRangeCalendar'
import { PillNav } from '../../components/PillNav'
import { LocationInput, pickLabel } from '../../components/LocationInput'
import type { StartPin } from '../../lib/startPin'
import { coordsForText, pinMatchesText } from '../../lib/startPin'
import { CoverMedia } from '../../components/CoverMedia'
import { COVER_TYPES, coverFileError, uploadCover } from '../../lib/coverUpload'
import { fetchFirstAvailableThumb, pickTripQueryCandidates, sizedCoverUrl } from '../../lib/tripThumb'
import { coverPlanFor } from '../../lib/regionArt'
import { regionFor } from '../../lib/tripsPage'
import { RemoteEditBanner } from '../../components/RemoteEditBanner'
import { Surface } from '../../components/page/Surface'
import { StateBlock } from '../../components/page/StateBlock'
import { watchSectionHash } from '../../lib/sectionNavigation'

/** The allowance the "drive after dinner" toggle turns on when a trip has none
 *  (#122's dhaba case: dinner at X, two more hours to Y). */
const DEFAULT_DRIVE_AFTER_DINNER_MIN = 120

/** #410: the two things the form says when the start's text and its pin stop
 *  agreeing — one for the edit that dropped the pin, one for the pair a save
 *  refused to persist. "Unpinned" is not an error: the trip still plans, and
 *  the existing degraders measure it honestly without a position. */
const START_UNPINNED = 'The start pin is off. The text now names a different city. Pick the city to pin it on the map again.'
const START_DROPPED = 'The stored start pin named a different city, so it was not saved. Pick the city to pin it.'

/** Icon per transport mode — the ONE map lives in components/icons (modeIcon);
 *  this file used to keep a private copy that drifted from the bench's. */

/** The form's editable field set. `destinations` lives in the pair array
 *  beside it (#411) — this shape is the scalar fields only. */
export interface SettingsFormState {
  name: string
  startLocation: string
  startDate: string
  endDate: string
  travellers: number
  budget: number
  transportMode: TransportMode
  travelStyle: Trip['travelStyle']
  stayStyle: 'budget' | 'comfort' | 'luxury'
  fuelEconomy: string
  fuelPrice: string
  roundTrip: boolean
  vehicleType: string
  fuelType: string
  capacity: string
  vehicleEconomy: string
  driverCount: number | undefined
  hasVulnerable: boolean | undefined
  driveAfterDinner: boolean
  /** Mixed only: the traveller's answer to the driving question. Undefined is
   *  the open state, and it is a real third value, not a false. */
  drivesPart: boolean | undefined
}

/** Seed the scalar field set from a trip row. One factory, used by mount and
 *  by #414's take-theirs reseed, so a reload can never drift from the open. */
export function formFromTrip(trip: Trip): SettingsFormState {
  return {
    name: trip.name, startLocation: trip.startLocation,
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
    // Tri-state on purpose. A trip saved before this field existed has no
    // answer, and undefined is how that state survives a reopen.
    drivesPart: trip.drivesPart,
  }
}

export type SettingsDryRun =
  | { ok: true; patch: Partial<Trip>; startCoordsDropped: boolean }
  | { ok: false; reason: string; blocked?: number[] }

/**
 * #408: ONE predicate, run by the live Preview AND the Save button, so the
 * preview is never a guess and a refusal is never a surprise. It answers
 * "would this save be accepted, and if not, why" BEFORE any write touches the
 * store — the reason is rendered inline (and under the blocking days, which
 * link to their timeline day) instead of living in a toast that fades.
 *
 * Every check here is a check updateTrip re-runs server-side of the form;
 * running it twice is the point — the UI's copy of the verdict is derived,
 * never stored, so the two cannot drift apart.
 */
export function settingsDryRun(
  f: SettingsFormState,
  dests: readonly DestPair[],
  startPin: StartPin | null,
  trip: Trip,
): SettingsDryRun {
  const s = new Date(`${f.startDate}T00:00:00`), e = new Date(`${f.endDate}T00:00:00`)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return { ok: false, reason: 'Pick both a start and an end date.' }
  }
  if (e < s) {
    return { ok: false, reason: 'The end date must be on or after the start date.' }
  }
  const fuel = isFuelEconomyMode(f.transportMode)
  // #412: a non-blank out-of-range capacity/economy REFUSES the save with the
  // reason. Clearing the stored value (200 km/L parsing to undefined and the
  // save writing undefined) was worse than the refusal — a refusal is visible.
  if (fuel) {
    if (f.capacity.trim() !== '' && parseCapacityL(f.capacity) === undefined) {
      return {
        ok: false,
        reason: `Tank or battery capacity must be 1-300 ${f.fuelType === 'electric' ? 'kWh' : 'L'}. Clear the box to use the vehicle default.`,
      }
    }
    if (f.vehicleEconomy.trim() !== '' && parseVehicleEconomy(f.vehicleEconomy) === undefined) {
      return {
        ok: false,
        reason: 'Economy must be 2-80 km/L (km/kWh for an EV). Clear the box to use the vehicle default.',
      }
    }
  }
  // Reconcile the DRAFT dates against the trip's real days — the same pure
  // check updateTrip makes, but here the refusal can carry the blocking day
  // indexes so each one links straight to its timeline day.
  const datesChanged = f.startDate !== trip.startDate || f.endDate !== trip.endDate
  if (datesChanged) {
    const protectedIdx = new Set([...trip.fixedCommitments, ...(trip.flights ?? [])].map(c => c.dayIndex))
    const rec = reconcileDays(trip.days, f.startDate, f.endDate, protectedIdx)
    if (rec.error) return { ok: false, reason: rec.error, blocked: rec.blocked }
  }
  // Selecting Mixed is a change the traveller has just made, so it needs the
  // answer now. A trip that was ALREADY Mixed and unanswered is a different
  // case: it keeps its planning and its preferences, and an unrelated save
  // must not be blocked by a question the traveller never saw (2026-10-19).
  const newlySelectedMixed = f.transportMode === 'mixed' && trip.transportMode !== 'mixed'
  if (newlySelectedMixed && typeof f.drivesPart !== 'boolean') {
    return { ok: false, reason: 'Answer whether you will drive any part of this trip.' }
  }
  const { destinations, destinationCoords } = splitDests(dests)
  // #410 backstop (now inside the shared predicate, so the preview shows it
  // too): never persist a pair whose text and pin disagree, whatever produced
  // it. The trip saves unpositioned rather than measuring the wrong city.
  const startCoordsToSave = coordsForText(startPin, f.startLocation)
  return {
    ok: true,
    startCoordsDropped: !!startPin && !startCoordsToSave,
    patch: {
      name: f.name, startLocation: f.startLocation,
      startLocationCoords: startCoordsToSave ?? undefined,
      startDate: f.startDate, endDate: f.endDate,
      // #411: the ONE pair array splits into the row's two arrays exactly
      // here — the save mapping is the only writer of either.
      destinations, destinationCoords,
      travellers: clampCrew(f.travellers),
      // The party dials are shown only while the trip has a wheel, but the
      // choice must OUTLIVE the mode (2026-10-19). This block used to clear the
      // pair for any trip without a wheel, so saving a No answer on a Mixed
      // trip, or switching to a passenger mode, erased three drivers and a
      // custom dinner allowance, and turning the wheel back on found them gone.
      //
      // The DRAFT is the truth about what the traveller chose, so the save
      // writes the draft. The answer and the mode only decide what the
      // PLANNER uses, and the transport policy gates that use. A draft the
      // traveller edited before the wheel went away keeps those edits.
      driverCount: f.driverCount,
      hasVulnerable: f.hasVulnerable,
      // #213 Phase 5: only write the 120-minute default when the toggle is
      // being turned ON. A trip stored with a custom allowance (say 60)
      // used to be silently rewritten to 120 by any unrelated save.
      // The draft toggle decides the allowance. Off clears it. On keeps a
      // custom duration that the trip already has.
      driveAfterDinnerMin: !f.driveAfterDinner
        ? undefined
        : (trip.driveAfterDinnerMin ?? DEFAULT_DRIVE_AFTER_DINNER_MIN),
      budgetPerPersonInr: Math.max(0, f.budget),
      transportMode: f.transportMode, travelStyle: f.travelStyle,
      // The Mixed answer is stored whatever the mode, so a later switch back to
      // Mixed still knows what the traveller said.
      drivesPart: typeof f.drivesPart === 'boolean' ? f.drivesPart : undefined,
      stayStyle: f.stayStyle,
      fuelEconomyKmL: fuel ? parseFuelEconomyKmL(f.fuelEconomy) : undefined,
      fuelPricePerL: fuel ? parseFuelPricePerL(f.fuelPrice) : undefined,
      roundTrip: fuel ? f.roundTrip : undefined,
      // #213 Phase 6: the fallbacks come from the CHOSEN vehicle's own
      // profile, not hardcoded car numbers. `Number('45') || 45` used to
      // write a 45 L / 15 km-L car onto a motorcycle (12 / 40) or an EV
      // (50 kWh / 6) whenever the fields were left blank.
      vehicleProfile: fuel ? {
        vehicleType: f.vehicleType as 'car' | 'motorcycle' | 'ev',
        fuelType: f.fuelType as 'petrol' | 'diesel' | 'electric' | 'cng',
        capacity: parseCapacityL(f.capacity) ?? defaultVehicleProfile(f.vehicleType).capacity,
        economy: parseVehicleEconomy(f.vehicleEconomy) ?? defaultVehicleProfile(f.vehicleType).economy,
      } : undefined,
    },
  }
}

/**
 * #413: would this save change anything? The Save bar stays disabled until
 * it would — a no-change click used to rewrite the trip, bump updatedAt,
 * sync, toast success and ping collaborators for nothing.
 *
 * The compare runs over the SAVED field set: the patch a save would write,
 * against the patch the UNTOUCHED draft would write, one field at a time,
 * by VALUE — never the control states. The baseline is the untouched draft,
 * not the row, because a row missing a normalizable field (stayStyle,
 * roundTrip) would make EVERY draft read dirty on open while the save would
 * write back exactly what the form already shows. A toggle that reads "on"
 * can hold a stored 60-minute allowance the save would write back as 120:
 * nothing visible moved, and it is a real change. Arrays compare
 * element-wise (fresh arrays every render would otherwise never compare
 * equal — the polarity trap).
 */
export function settingsBaselinePatch(trip: Trip): Partial<Trip> {
  const pin = trip.startLocationCoords ? { coords: trip.startLocationCoords, label: trip.startLocation } : null
  const run = settingsDryRun(formFromTrip(trip), zipDests(trip.destinations, trip.destinationCoords), pin, trip)
  return run.ok ? run.patch : {}
}

export function settingsAreDirty(patch: Partial<Trip>, trip: Trip): boolean {
  const base = settingsBaselinePatch(trip)
  return (Object.keys(patch) as (keyof Trip)[])
    .some(k => !sameSavedValue(patch[k], base[k]))
}

/** The saved fields this draft would change, named. The nav rail and the
 *  preview panel both read this, so "2 unsaved changes" and the two marked
 *  sections come from one answer instead of two counts that can drift. */
export function settingsDirtyFields(patch: Partial<Trip>, trip: Trip): (keyof Trip)[] {
  const base = settingsBaselinePatch(trip)
  return (Object.keys(patch) as (keyof Trip)[]).filter(k => !sameSavedValue(patch[k], base[k]))
}

/** The six sections, in page order. The nav rail and the scroll-spy both read
 *  this list, so a section cannot appear in one and not the other. */
const SECTIONS = ['identity', 'dates', 'group', 'travel', 'people', 'danger'] as const

/** Which section owns each saved field. A field with no row here still counts
 *  as a change; it just does not mark a section. */
const SECTION_OF_FIELD: Partial<Record<keyof Trip, string>> = {
  name: 'identity',
  coverImageUrl: 'identity',
  coverEmoji: 'identity',
  startDate: 'dates',
  endDate: 'dates',
  startLocation: 'dates',
  startLocationCoords: 'dates',
  destinations: 'dates',
  destinationCoords: 'dates',
  roundTrip: 'dates',
  travellers: 'group',
  budgetPerPersonInr: 'group',
  stayStyle: 'group',
  transportMode: 'travel',
  travelStyle: 'travel',
  drivesPart: 'travel',
  driverCount: 'travel',
  fuelEconomyKmL: 'travel',
  fuelPricePerL: 'travel',
  vehicleProfile: 'travel',
  hasVulnerable: 'travel',
  driveAfterDinnerMin: 'travel',
}

/** The two letters an avatar stack shows when there is no photo: the first
 *  letter of the first two words, so "Has9 Naina" reads "HN". */
function initialsOf(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

/** "Sat 14 Nov" for a stored ISO day, the artboard's own shape. The date is
 *  parsed at midnight local so a stored day never slides back one day in a
 *  timezone behind UTC. An unparseable or missing day reads "Not set". */
function fmtTripDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (!iso || Number.isNaN(d.getTime())) return 'Not set'
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`
}

export interface SettingsRouteSummary {
  destinationCount: number
  returnPlace: string | null
  endPlace: string
}

/** The route as the draft shows it. The return row is derived from the round
 *  trip switch; it is never a stored destination. */
export function settingsRouteSummary(
  destinations: readonly { name: string }[],
  startLocation: string,
  showReturn: boolean,
): SettingsRouteSummary {
  let lastDestination = ''
  for (let i = destinations.length - 1; i >= 0; i--) {
    const name = destinations[i]?.name.trim()
    if (name) {
      lastDestination = name
      break
    }
  }
  const start = startLocation.trim()
  const hasReturn = showReturn && !!start
  const endPlace = hasReturn
    ? start
    : lastDestination || start || 'No destination yet'
  return {
    destinationCount: destinations.length + (hasReturn ? 1 : 0),
    returnPlace: hasReturn ? start : null,
    endPlace,
  }
}

/** The place the route ends at, from the draft that is on screen. */
export function settingsEndPlace(
  destinations: readonly { name: string }[],
  startLocation: string,
  roundTrip = false,
): string {
  return settingsRouteSummary(destinations, startLocation, roundTrip).endPlace
}

export const TYPICAL_BUDGET_MIN_INR = 5_000
export const TYPICAL_BUDGET_MAX_INR = 40_000
export const FALLBACK_BUDGET_MAX_INR = 300_000

export interface SettingsBudgetScale {
  min: number
  max: number
  step: number
  minLabel: string
  maxLabel: string
  isTypical: boolean
}

/** Keep the artboard's readable budget range for ordinary plans. Values outside
 *  it keep the older wide scale so an existing budget is still editable. */
export function settingsBudgetScale(budget: number, planPerPerson: number): SettingsBudgetScale {
  const inTypicalRange =
    Number.isFinite(budget) && Number.isFinite(planPerPerson) &&
    budget >= TYPICAL_BUDGET_MIN_INR && budget <= TYPICAL_BUDGET_MAX_INR &&
    planPerPerson >= TYPICAL_BUDGET_MIN_INR && planPerPerson <= TYPICAL_BUDGET_MAX_INR
  if (inTypicalRange) {
    return {
      min: TYPICAL_BUDGET_MIN_INR,
      max: TYPICAL_BUDGET_MAX_INR,
      step: 500,
      minLabel: formatInr(TYPICAL_BUDGET_MIN_INR),
      maxLabel: formatInr(TYPICAL_BUDGET_MAX_INR),
      isTypical: true,
    }
  }
  return {
    min: 0,
    max: FALLBACK_BUDGET_MAX_INR,
    step: 500,
    minLabel: '₹0',
    maxLabel: '₹3L',
    isTypical: false,
  }
}

const SPENDING_STYLE_LABEL: Record<SettingsFormState['stayStyle'], string> = {
  budget: 'Shoestring',
  comfort: 'Balanced',
  luxury: 'Comfort',
}

export function spendingStyleLabel(style: SettingsFormState['stayStyle']): string {
  return SPENDING_STYLE_LABEL[style]
}

export const SPENDING_STYLE_HINT = 'Changes which stays and restaurants the app suggests first.'
export const NEW_DAY_HINT = 'Existing stops stay on their dates. The new day starts empty, ready to plan.'
// A blocked save must not promise a date change. The plan keeps its days.
export const SAVE_REFUSED_HINT = 'Save is blocked: the plan keeps its days.'

export function settingsDayDeltaLabel(dayDelta: number | null, saveRefused: boolean): string {
  if (saveRefused && dayDelta !== null && dayDelta !== 0) return 'Save is blocked: the plan keeps its days'
  if (dayDelta === null) return 'Pick both dates to preview the day grid'
  if (dayDelta === 0) return 'Day count unchanged'
  if (dayDelta > 0) return `Adds ${dayDelta} empty day${dayDelta !== 1 ? 's' : ''} at the end`
  return `Drops ${-dayDelta} empty trailing day${dayDelta !== -1 ? 's' : ''} (days with stops are kept)`
}

export function settingsDayGridHint(dayDelta: number | null, dayDeltaLabel: string, saveRefused: boolean): string {
  if (saveRefused && dayDelta !== null && dayDelta !== 0) return SAVE_REFUSED_HINT
  if (!saveRefused && dayDelta !== null && dayDelta > 0) return NEW_DAY_HINT
  return `${dayDeltaLabel}. Existing stops stay on their dates.`
}

export function settingsPeopleSummary(
  memberCount: number,
  editorCount: number,
  visibility: Trip['visibility'],
): string {
  const memberLabel = `${memberCount} member${memberCount === 1 ? '' : 's'}`
  const sharingLabel = visibility === 'public' ? 'link sharing on' : 'link sharing off'
  return `${memberLabel} · ${editorCount} can edit · ${sharingLabel}`
}

/** The day cards the artboard draws: one per day of the grid this save would
 *  write, each with the stops it already carries. A day past the trip's own
 *  length is new, so it reads "New · empty" before the save instead of
 *  pretending the write already happened. */
function dayGrid(startDate: string, existing: Trip['days'], total: number): {
  key: string; dow: string; dayOfMonth: string; stops: number; isNew: boolean
}[] {
  const start = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return []
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return Array.from({ length: total }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    return {
      key: `${i}`,
      dow: DOW[date.getDay()].toUpperCase(),
      dayOfMonth: String(date.getDate()),
      stops: (existing[i]?.stops ?? []).filter(s => s.status !== 'rejected').length,
      isNew: i >= existing.length,
    }
  })
}


/** null and undefined are the same "not set" — the row writes nulls where the
 *  write mapping writes undefined, and calling that a change pins the bar
 *  open for ever. */
function sameSavedValue(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameSavedValue(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    return ka.length === kb.length && ka.every(k =>
      sameSavedValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

/** #408: the days a refused shrink is waiting on, each one a jump to its
 *  timeline day. Without a workspace to jump from, the days still get named. */
function BlockedDayLinks({ blocked, onOpenDay }: { blocked?: number[]; onOpenDay?: (dayIndex: number) => void }) {
  if (!blocked || blocked.length === 0) return null
  return (
    <span className="ts-blocked-days">
      {(onOpenDay
        ? blocked.map(i => (
            <button key={i} type="button" className="link-btn teal btn-sm"
              onClick={() => onOpenDay(i)}>Day {i + 1} →</button>
          ))
        : blocked.map(i => <span key={i} className="muted small">Day {i + 1}</span>)
      )}
    </span>
  )
}

/** #704: the line a refused settings save shows. The edit stays in the cache and the durable queue, and the queue retries it. */
const TRIP_SETTINGS_NOT_SAVED = 'Settings not saved. They stay here, and the app will retry.'

/** How many route photos the cover strip shows beside the current cover and
 *  the upload tile. The artboard draws three beside a wide current slot; the
 *  strip never grows past them, because the tiles are a choice, not a gallery. */
const COVER_THUMB_SLOTS = 3

/** The one-line sublabel under each mode card. It is prose on purpose: the
 *  artboard says what a mode costs you in the day, where the bare km/h number
 *  this replaced said nothing a traveller could act on. The speed it quotes is
 *  `MODE_SPEED`'s own number, written out — the planner still reads the table,
 *  so the two cannot disagree about the mode, only about how it is said. */
const MODE_NOTE: Record<TransportMode, string> = {
  car: '~42 km/h on hills',
  rental: '~42 km/h, plus the day rate',
  motorcycle: '~44 km/h, more breaks',
  train: 'Fares, not fuel',
  bus: 'Fares, fixed times',
  flight: 'Fares, airport transfers',
  taxi: '~38 km/h, metered',
  mixed: 'A blend of the modes',
}

export function TripSettingsForm({ trip, editable, onOpenDay, legCorrections, onOpenShare }: {
  trip: Trip
  editable: boolean
  legCorrections?: Record<string, LegEstimate>
  /** #408: jump to a timeline day — the workspace plumbs the same focus
   *  mechanism the Map tab's day links use. Optional: the form renders the
   *  blocking days as plain text when no workspace is wired up. */
  onOpenDay?: (dayIndex: number) => void
  /** The artboard's People strip defers member management to the Share tab
   *  ("Manage in Share"). Optional: the button stays hidden when the host
   *  cannot switch tabs. */
  onOpenShare?: () => void
}) {
  /** The signed-in member, read once at the top so the owner-only section and
   *  the avatar stack resolve against the same person. */
  const meId = useSessionUserId()
  const users = useUsers()
  const showBottomSave = useMedia('(max-width: 1180px)')
  /** #704: the last write the server did not keep. Shown beside the Save button; the draft stays. */
  const [writeErr, setWriteErr] = useState<string | null>(null)
  /** #704: true from the Save click until the server answers. Save stays disabled meanwhile. */
  const [savingSettings, setSavingSettings] = useState(false)
  const [f, setFState] = useState(() => formFromTrip(trip))
  /** Any edit to the draft clears a refusal, because the refusal described the draft before the edit (#704). */
  const setF = (next: Parameters<typeof setFState>[0]) => { setWriteErr(null); setFState(next) }
  /** #414: when the trip row moves under the open draft (a crew member saved
   *  while this form was open), the banner offers keep-mine / take-theirs.
   *  `openedAtRef` is the updatedAt the draft was born against; our OWN save
   *  rebases it through `ownSaveRef` so it never fires on ourselves. */
  const openedAtRef = useRef(trip.updatedAt)
  const ownSaveRef = useRef(false)
  const [remoteAt, setRemoteAt] = useState<number | null>(null)
  useEffect(() => {
    if (ownSaveRef.current) { ownSaveRef.current = false; openedAtRef.current = trip.updatedAt; return }
    if (trip.updatedAt > openedAtRef.current) setRemoteAt(trip.updatedAt)
  }, [trip.updatedAt])
  // The day grid follows the date range — show what the picker will do to it.
  const dayDelta = (() => {
    const s = new Date(`${f.startDate}T00:00:00`), e = new Date(`${f.endDate}T00:00:00`)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return null
    const target = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
    return target - trip.days.length
  })()
  /** The artboard marks the dates card as changed when either date moves. The
   *  same comparison drives the two struck old values below, so the pill and
   *  the fields cannot disagree. */
  const datesChanged = f.startDate !== trip.startDate || f.endDate !== trip.endDate
  const [startPin, setStartPinState] = useState<StartPin | null>(
    trip.startLocationCoords ? { coords: trip.startLocationCoords, label: trip.startLocation } : null,
  )
  const setStartPin = (next: Parameters<typeof setStartPinState>[0]) => { setWriteErr(null); setStartPinState(next) }
  /** #410: soft notice under the start field — the pin is off, and why. */
  const [startNotice, setStartNotice] = useState('')
  /** #411: the route tail as ONE array of {name, lat?, lng?} pairs — the
   *  form's single source of truth. The row's parallel arrays exist only at
   *  the boundary (zip on open, split on save), so a rename or a remove can
   *  no longer slide names out from under their pins. */
  const [dests, setDestsState] = useState<DestPair[]>(() => zipDests(trip.destinations, trip.destinationCoords))
  const setDests = (next: Parameters<typeof setDestsState>[0]) => { setWriteErr(null); setDestsState(next) }
  const [destInput, setDestInput] = useState('')
  /** #411: rename-in-place. The chip edits its own name; coords and position
   *  are untouched by construction (renameDest rebuilds nothing). */
  const [renamingDest, setRenamingDest] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  /** True while a picked photo is being resized and stored. The upload tile
   *  says so in its own label, so the strip needs no second status line. */
  const [coverBusy, setCoverBusy] = useState(false)
  /** The strip's own refusal. It is cleared by the next successful pick, so a
   *  stale "that image is 12 MB" never outlives the photo that replaced it. */
  const [coverMsg, setCoverMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  /** The route's own places, as photos. One lookup per stop, headline first,
   *  resolved through the same Wikipedia cache the picker's auto button uses.
   *  A stop with no photo simply contributes no tile. */
  const [coverThumbs, setCoverThumbs] = useState<{ key: string; label: string; url: string }[]>([])
  useEffect(() => {
    let alive = true
    // A long route must not turn one page open into a dozen lookups. The strip
    // shows four tiles, so the first candidates are the ones worth asking for.
    const wanted = pickTripQueryCandidates(trip).slice(0, COVER_THUMB_SLOTS + 2)
    void Promise.all(wanted.map(async query => {
      const url = await fetchFirstAvailableThumb([query])
      return url ? { key: query, label: query, url } : null
    })).then(found => {
      if (!alive) return
      const seen = new Set<string>()
      setCoverThumbs(found.filter((t): t is { key: string; label: string; url: string } => {
        if (!t || seen.has(t.url)) return false
        seen.add(t.url)
        return true
      }).slice(0, COVER_THUMB_SLOTS))
    })
    return () => { alive = false }
    // The strip follows the places the trip names, not the draft: a stop typed
    // into the route editor has no photo until it is saved.
  }, [trip])
  /** The one writer for this control. It is the same call the picker makes —
   *  sized on the way in, and undefined clears back to the artwork — so the
   *  strip adds no second write path. */
  function setCoverUrl(url: string | undefined) {
    updateTrip(trip.id, { coverImageUrl: url ? sizedCoverUrl(url) : undefined })
    setCoverMsg('')
  }
  async function onCoverFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset first: picking the same file twice must still fire a change event.
    e.target.value = ''
    if (!file) return
    const refusal = coverFileError(file)
    if (refusal) { setCoverMsg(refusal); return }
    const me = currentUser()
    if (!me) { setCoverMsg('Sign in again to upload an image.'); return }
    setCoverMsg('')
    setCoverBusy(true)
    try {
      // The uploader owns the object, not the trip owner: the bucket's policies
      // read the first path segment as the uploader's id.
      const { url, error } = await uploadCover(me.id, file)
      if (error || !url) { setCoverMsg(error ?? 'Upload failed.'); return }
      setCoverUrl(url)
    } finally { setCoverBusy(false) }
  }

  function addDest(name: string, coords: { lat: number; lng: number } | null) {
    const clean = name.trim()
    if (!clean) return
    if (dests.some(d => d.name.toLowerCase() === clean.toLowerCase())) {
      toast('Already on the route.', 'err'); return
    }
    setDests(list => [...list, coords ? { name: clean, lat: coords.lat, lng: coords.lng } : { name: clean }])
    setDestInput('')
  }

  /** Swap with a neighbour — on the PAIRS, so a pin travels with its name. */
  function moveDest(i: number, dir: -1 | 1) {
    setDests(list => {
      const j = i + dir
      if (j < 0 || j >= list.length) return list
      const next = [...list]; const tmp = next[i]; next[i] = next[j]; next[j] = tmp
      return next
    })
  }

  function commitRename(i: number) {
    setDests(list => renameDest(list, i, renameDraft.trim() || list[i]?.name || ''))
    setRenamingDest(null)
    setRenameDraft('')
  }

  /** #414 "take theirs": rebuild the whole draft from the row as it stands. */
  function reseedFrom(t: Trip) {
    setF(formFromTrip(t))
    setDests(zipDests(t.destinations, t.destinationCoords))
    setStartPin(t.startLocationCoords ? { coords: t.startLocationCoords, label: t.startLocation } : null)
    setStartNotice(''); setDestInput(''); setRenamingDest(null); setRenameDraft('')
    openedAtRef.current = t.updatedAt
    setRemoteAt(null)
  }

  // #408: the Preview and the Save button read the SAME dry run — computed
  // once per render, never stored, so the receipt and the write can never
  // disagree about what this form would do.
  const dry = settingsDryRun(f, dests, startPin, trip)
  // #413: the bar is enabled exactly when a click would WRITE — a clean
  // draft is disabled ("No changes"), and a refusal pending is disabled too.
  const canSave = dry.ok && settingsAreDirty(dry.patch, trip)

  // Derived values the bench-style blocks and the live receipt read from.
  // #213 Phase 5: clampCrew, not Math.min(12,…) — the old clamp misrepresented a
  // larger party as 12 and any chip tap then dropped it.
  const travellers = clampCrew(f.travellers)
  const clampedBudget = Math.min(300000, Math.max(0, f.budget))
  const dayCount = dayDelta === null ? trip.days.length : trip.days.length + dayDelta
  const dayDeltaLabel = settingsDayDeltaLabel(dayDelta, !dry.ok)
  const dayGridHint = settingsDayGridHint(dayDelta, dayDeltaLabel, !dry.ok)
  const fuelMode = isFuelEconomyMode(f.transportMode)
  const routeSummary = settingsRouteSummary(dests, f.startLocation, fuelMode && f.roundTrip)
  const endPlace = routeSummary.endPlace
  // One shared answer for every surface (2026-10-19). `showsDrivingControls`
  // gates what renders; `driving` gates what the planner keeps, so an
  // unanswered Mixed keeps its stored preferences while hiding the dials.
  const policy = transportPolicy({ transportMode: f.transportMode, drivesPart: f.drivesPart })
  const showsDriving = policy.showsDrivingControls
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
  // V2 derived values: the stopped-day count for the day grid, and the
  // engine's read over the trip AS DRAFTED (the validated patch and
  // reconciled days drive the preview).
  const daysWithStops = trip.days.filter(d => d.stops.some(s => s.status !== 'rejected')).length
  const preview = useMemo(() => {
    const valid = settingsDryRun(f, dests, startPin, trip)
    if (!valid.ok) return null
    const protectedIdx = new Set([...trip.fixedCommitments, ...(trip.flights ?? [])].map(c => c.dayIndex))
    const rec = reconcileDays(trip.days, f.startDate, f.endDate, protectedIdx)
    if (rec.error) return null
    return settingsPreview(trip, valid.patch, rec.days, legCorrections)
  }, [trip, f, dests, startPin, legCorrections])
  const engineRead = preview?.health
  const topWarning = engineRead?.warnings[0]

  // The nav rail's edit marks and the preview panel's count come from ONE
  // list of changed fields, so the two can never disagree.
  const dirtyFields = dry.ok ? settingsDirtyFields(dry.patch, trip) : []
  const editedSections = new Set(dirtyFields.map(k => SECTION_OF_FIELD[k]).filter(Boolean) as string[])
  const dirtyCount = dirtyFields.length
  /** How many saved fields each section carries, so the rail's badge can show
   *  the count the artboard shows rather than a bare mark. */
  const editedPerSection = new Map<string, number>()
  for (const field of dirtyFields) {
    const section = SECTION_OF_FIELD[field]
    if (section) editedPerSection.set(section, (editedPerSection.get(section) ?? 0) + 1)
  }
  const grid = dayGrid(f.startDate, trip.days, dayCount)
  // A day tile first drawn after the form has mounted rises at once (is-late),
  // instead of waiting for its place in the entrance cascade. The mark is
  // sticky while the tile stays on the page: a delay that changed while a tile
  // animates would restart it. A tile that leaves and returns is drawn anew.
  // The state is adjusted during render, so the tile has its class on its first paint.
  const [dayMarks, setDayMarks] = useState(() => ({ live: new Set(grid.map(d => d.key)), late: new Set<string>() }))
  const gridKeys = grid.map(d => d.key)
  const enteringDays = gridKeys.filter(k => !dayMarks.live.has(k))
  const leavingDays = [...dayMarks.live].filter(k => !gridKeys.includes(k))
  let lateDays = dayMarks.late
  if (enteringDays.length > 0 || leavingDays.length > 0) {
    lateDays = new Set([...dayMarks.late].filter(k => !leavingDays.includes(k)).concat(enteringDays))
    setDayMarks({ live: new Set(gridKeys), late: lateDays })
  }
  const tripTotals = computeTotals(trip)
  /** What the plan already costs each head, read from the engine's own total
   *  and split by the party being drafted. The budget dial is read against
   *  this, so "over target" is a measurement, not a warning we invented. */
  const planPerPerson = Math.round(tripTotals.totalCostInr / Math.max(1, travellers))
  const planOverPerPerson = Math.max(0, planPerPerson - clampedBudget)
  const budgetScale = settingsBudgetScale(clampedBudget, planPerPerson)
  /** Two to a room, rounded up, in the artboard's words. A solo traveller gets
   *  one room, and one room is never "1 rooms". */
  const rooms = Math.max(1, Math.ceil(travellers / 2))
  const roomsLine = rooms === 1
    ? '1 room'
    : `${rooms} rooms at 2 a room`
  const members = membersOf(trip)
  const role = roleOf(trip, meId)
  const editors = members.filter(m => m.role === 'owner' || m.role === 'editor').length
  const peopleCopy = settingsPeopleSummary(members.length, editors, trip.visibility)
  const nameOf = (userId: string) => users.find(u => u.id === userId)?.profile.name ?? 'Member'
  /** The current cover, resolved through the shared plan so the strip shows
   *  exactly what a shared link and a WhatsApp preview will show: the upload,
   *  else the artwork for these places, else the saved emoji. */
  const coverPlan = coverPlanFor({
    userCover: trip.coverImageUrl ? sizedCoverUrl(trip.coverImageUrl) : '',
    fallbackEmoji: trip.coverEmoji,
    region: regionFor(trip),
    seed: trip.id,
    placeCount: trip.destinations?.length ?? 0,
    destinations: trip.destinations,
    startLocation: trip.startLocation,
  })

  /** Mark the section at the reading line, including the phone rail offset. */
  const [activeSection, setActiveSection] = useState<string>('identity')
  const railClick = useRef(false)
  useEffect(() => {
    const sections = SECTIONS
      .map(id => document.getElementById(`tset-${id}`))
      .filter((el): el is HTMLElement => el !== null)
    if (sections.length === 0) return
    const mark = () => {
      if (railClick.current) return
      const padding = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
      const margin = Number.parseFloat(getComputedStyle(sections[0]).scrollMarginTop) || 0
      let active = sections[0]
      for (const section of sections) if (section.getBoundingClientRect().top <= padding + margin + 1) active = section
      if (Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2) active = sections[sections.length - 1]
      setActiveSection(active.id.replace('tset-', ''))
    }
    const io = new IntersectionObserver(mark, { rootMargin: '-96px 0px -60% 0px', threshold: 0 })
    sections.forEach(el => io.observe(el))
    const release = () => { railClick.current = false }
    window.addEventListener('scroll', mark, { passive: true })
    window.addEventListener('resize', mark)
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(type, release, { passive: true })
    const unwatchHash = watchSectionHash(sections.map(section => section.id), id => {
      railClick.current = id !== null
      if (id) setActiveSection(id.replace('tset-', ''))
      else mark()
    })
    return () => {
      unwatchHash()
      io.disconnect()
      window.removeEventListener('scroll', mark)
      window.removeEventListener('resize', mark)
      for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(type, release)
    }
  }, [])
  /** On a phone the nav is a sideways strip. When the section you are reading
   *  changes, bring its item into view so the mark is never off screen. The
   *  strip scrolls only when it overflows, so the desktop rail never moves. */
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navRef.current
    if (!nav || nav.scrollWidth <= nav.clientWidth) return
    const item = nav.querySelector<HTMLElement>('[aria-current="true"]')
    if (!item) return
    const rail = nav.getBoundingClientRect(), row = item.getBoundingClientRect()
    if (row.left < rail.left) nav.scrollLeft += row.left - rail.left
    else if (row.right > rail.right) nav.scrollLeft += row.right - rail.right
  }, [activeSection])

  // The sticky preview panel. It sits last in the grid, after every section,
  // so the artboard's three columns hold their shape on any section count.
  const saveAside = (
    <aside className="tset-aside" aria-label="What changes when you save">
      {/* #408: the preview shows what WOULD happen — including a save that
          would be refused. A "Preview" that hides the refusal is a guess,
          not a preview; the reason and the blocking days (linked to their
          timeline day) sit at the top, from the same dry run the Save
          button runs. */}
      {!dry.ok && (
        <div className="bench-receipt card ts-receipt-refusal" role="status">
          <span className="bench-stamp" aria-hidden="true">Would be refused</span>
          <div className="bench-receipt-head">
            <span className="bench-receipt-kicker">Save preview</span>
          </div>
          <p className="err-text ts-warn-note set-receipt-reason">{dry.reason}</p>
          <BlockedDayLinks blocked={dry.blocked} onOpenDay={onOpenDay} />
        </div>
      )}
      <div className="tset-savecard">
        <div className="tset-save-head">
          <span className="tset-dot" aria-hidden="true" />
          <span className="disp tset-save-title">{dirtyCount === 0 ? 'No unsaved changes' : `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`}</span>
        </div>
        <p className="tset-save-sub">Here is what happens to the plan when you save.</p>
        {/* The three diffs the artboard asks for, each read from the same
            dry run and preview the Save button uses, so a diff can never
            promise something the write refuses. An arrow appears only when a
            save is actually pending: the panel must not draw "4 days → 5
            days" under a title that says nothing will be saved. */}
        <div className="tset-diff">
          <span className="tset-diff-lbl">Days</span>
          <b>{canSave && dayDelta
            ? <><span className="tset-was">{trip.days.length} days</span> → {dayCount} days</>
            : `${dayCount} day${dayCount === 1 ? '' : 's'}`}</b>
          <span>{canSave && dayDelta
            ? dayDeltaLabel
            : dayDelta
              ? `The dates cover ${dayCount} days; the plan holds ${trip.days.length}.`
              : 'The dates and the day grid already agree.'}</span>
        </div>
        <div className="tset-diff">
          <span className="tset-diff-lbl">Budget</span>
          <b>{canSave && clampedBudget !== trip.budgetPerPersonInr
            ? <><span className="tset-was">{formatInr(trip.budgetPerPersonInr)}</span> → {formatInr(clampedBudget)} each</>
            : `${formatInr(clampedBudget)} each`}</b>
          {/* The same computed delta the group card shows, in the panel's own
              words, so the two can never tell different stories about cost. */}
          <span>{planOverPerPerson > 0
            ? `${formatInr(clampedBudget * travellers)} for the group. You’re ${formatInr(planOverPerPerson)} a head over.`
            : `${formatInr(clampedBudget * travellers)} for the group.`}</span>
        </div>
        {engineRead && (
          <div className={`tset-diff${topWarning ? '' : ' is-good'}`}>
            <span className="tset-diff-lbl">{topWarning ? 'Engine' : 'Good news'}</span>
            <b>{topWarning ? topWarning.title : 'The plan reads clean'}</b>
            <span>{topWarning ? topWarning.detail : 'No warnings against the engine’s assumptions.'}</span>
          </div>
        )}
        {/* #413: a viewer used to get a vanished bar under disabled inputs —
            permissioned read as broken. The bar renders for everyone; a
            viewer gets it disabled with the reason said out loud. */}
        {!editable && (
          <span className="ts-savebar-note hint-text" role="status">
            <InlineIcon icon={TriangleAlert} size={12} gap={3} />Only editors can change trip settings. Ask an editor on this trip, or duplicate it to edit your own copy.
          </span>
        )}
        {savingSettings && (
          <div className="set-save-state">
            <StateBlock kind="loading" size="compact" title="Saving your settings." />
          </div>
        )}
        {writeErr && <span className="err-text" role="alert">{writeErr}</span>}
        <div className="tset-save-actions">
          <button className="btn btn-primary tset-save-btn" disabled={!canSave || savingSettings}
            title={canSave ? undefined : dry.ok ? 'No changes' : dry.reason} onClick={() => {
            if (!dry.ok) return
            if (dry.startCoordsDropped) setStartNotice(START_DROPPED)
            setWriteErr(null)
            if (updateTrip(trip.id, dry.patch)) {
              ownSaveRef.current = true
              const verdict = tripWriteVerdict(trip.id)
              if (verdict) {
                setSavingSettings(true)
                void verdict.then(saved => {
                  setSavingSettings(false)
                  if (saved) toast('Trip settings updated')
                  else setWriteErr(TRIP_SETTINGS_NOT_SAVED)
                })
              }
            }
          }}>{savingSettings ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="tset-discard" disabled={!dirtyCount || savingSettings}
            onClick={() => reseedFrom(trip)}>Discard</button>
        </div>
        <span className="tset-save-foot">Saving applies these settings to everyone on the trip.</span>
      </div>

      {/* the engine's read — recomputed from this form as you type. Band
          word, number and bar derive from one call (lib/healthBand), so
          they cannot drift apart. */}
      {engineRead && (
        <div className="tset-glance" aria-label="The engine's read of these settings">
          <span className="tset-nav-lbl">The plan at a glance</span>
          {preview?.estimated && <p className="muted small">Route changes need fresh road measurements after saving.</p>}
          <div className="tset-glance-grid">
            <div className="tset-stat"><span className="tset-stat-v">{tripTotals.totalDistanceKm > 0 ? `${Math.round(tripTotals.totalDistanceKm)} km` : '–'}</span><span className="tset-stat-k">road measured</span></div>
            <div className="tset-stat"><span className="tset-stat-v">{minutesToHM(tripTotals.totalTravelMinutes)}</span><span className="tset-stat-k">driving</span></div>
            <div className="tset-stat"><span className="tset-stat-v">{tripTotals.stopCount} stops</span><span className="tset-stat-k">on {daysWithStops} of {dayCount} days</span></div>
            <div className="tset-stat"><span className="tset-stat-v">{formatInr(tripTotals.totalCostInr)}</span><span className="tset-stat-k">plan total, estimate</span></div>
          </div>
          <div className="tset-read">
            <span className="tset-diff-lbl">The engine&apos;s read</span>
            <span className={`chip chip-${healthBandTone(engineRead.band)}`}>{engineRead.band}</span>
            <div className="health-big set-read-gap">
              <div className={`health-num-big ${healthBandClass(engineRead.band)} set-read-score`}>{engineRead.score}</div>
              <div className="health-bar set-read-bar"><i className={healthBandClass(engineRead.band)} style={{ width: `${engineRead.score}%` }} /></div>
            </div>
          </div>
        </div>
      )}
    </aside>
  )

  return (
    <div className="ts-form tsx-form">
      {/* #414: a crew member saved while this form sat open. The banner
          offers the same two verbs the stop editor uses — keep my draft, or
          take theirs and rebuild from the row as it stands. Non-blocking,
          role=status: it must not steal focus mid-edit. */}
      {remoteAt !== null && (
        <RemoteEditBanner
          noun="trip settings"
          byName=""
          onKeepMine={() => { openedAtRef.current = trip.updatedAt; setRemoteAt(null) }}
          onTakeTheirs={() => reseedFrom(trip)}
        />
      )}
      <div className="tset-grid">
        {/* The artboard's short nav: one long page, six sections, and the two
            that carry unsaved edits say so. Every item is an in-page anchor,
            so it works with no JavaScript and keeps the URL. */}
        <nav className="tset-nav" aria-label="Settings sections" ref={navRef}>
          <span className="tset-nav-lbl">Trip settings</span>
          {([['identity', 'Name & cover', AlignLeft], ['dates', 'Dates & days', CalendarDays], ['group', 'Group & budget', Users],
            ['travel', 'How you travel', CarFront], ['people', 'People & sharing', Share2], ['danger', 'Archive or delete', Trash2]] as const)
            .map(([key, label, Icon]) => {
              const edited = editedSections.has(key)
              const count = editedPerSection.get(key) ?? 0
              return (
                <Fragment key={key}>
                  {key === 'danger' && <span className="tset-nav-divider" aria-hidden="true" />}
                  <a href={`#tset-${key}`}
                    className={`tset-nav-item${edited ? ' is-edited' : ''}${key === 'danger' ? ' is-danger' : ''}`}
                    onClick={() => { railClick.current = true; setActiveSection(key) }}
                    aria-current={activeSection === key ? 'true' : undefined}>
                    <Icon size={16} aria-hidden />
                    {label}
                    {edited && <i aria-hidden="true">{count}</i>}
                    {edited && <span className="sr-only">, {count} unsaved</span>}
                  </a>
                </Fragment>
              )
            })}
        </nav>

        <div className="tset-main">

          {/* ---------- Name & cover ---------- */}
          <Surface as="section" className="tsx-card" id="tset-identity" aria-label="Trip name and cover">
            <header className="tsx-head">
              <span className="tsx-ico" aria-hidden="true"><AlignLeft size={18} /></span>
              <span className="tsx-head-copy">
                <h3 className="tsx-q">Name &amp; cover</h3>
                <p className="tsx-a">What the group and anyone you share with will see first.</p>
              </span>
            </header>
            {/* The artboard's name field: the counter rides INSIDE the input,
                right-aligned, so the limit is visible while typing. */}
            <div className="field">
              <label className="flab" htmlFor="tset-name">Trip name</label>
              <div className={`inp${f.name !== trip.name ? ' changed' : ''}`}>
                <input id="tset-name" disabled={!editable} maxLength={60} value={f.name}
                  onChange={e => setF(x => ({ ...x, name: e.target.value }))} />
                <span className="inp-count">{f.name.length} / 60</span>
              </div>
            </div>
            {/* The cover strip: the current cover wide on the left, then the
                route's own places as thumbnails, then the upload tile. A thumb
                click sets that photo as the cover through the same writer the
                picker's own buttons use — no new write path. The current tile
                is a div, not a button: it holds the cover itself, and a control
                inside a control is one tap target too many. */}
            <div className="field">
              <span className="flab">Cover</span>
              <div className="tset-coverstrip" role="group" aria-label="Cover choices">
                <div className="tset-cover-slot tset-cover-slot--now">
                  <CoverMedia plan={coverPlan} ratio="16:10" sizes="(min-width: 1180px) 380px, 92vw" className="tset-cover-img" emojiClassName="tset-cover-emoji" alt="" />
                  <span className="tset-cover-now">Current</span>
                </div>
                {coverThumbs.map(c => (
                  <button key={c.key} type="button" className="tset-cover-slot"
                    aria-label={`Use the ${c.label} photo`} title={c.label}
                    disabled={!editable} onClick={() => setCoverUrl(c.url)}>
                    <img src={c.url} alt="" loading="lazy" />
                  </button>
                ))}
                {editable && (
                  <button type="button" className="tset-cover-add" disabled={coverBusy}
                    onClick={() => fileRef.current?.click()}>
                    <Plus size={20} aria-hidden />{coverBusy ? 'Uploading…' : 'Your photo'}
                  </button>
                )}
                <input ref={fileRef} type="file" accept={COVER_TYPES.join(',')} className="sr-only"
                  aria-hidden="true" tabIndex={-1} onChange={onCoverFile} />
              </div>
              {coverMsg && <p className="err-text" role="status">{coverMsg}</p>}
              {/* The picker's "Use artwork" is the one action the strip would
                  otherwise lose: it is how a traveller goes back to the
                  generated scene without uploading anything. It writes through
                  the same setter, with no URL. */}
              {editable && trip.coverImageUrl && (
                <button type="button" className="tset-cover-clear" disabled={coverBusy}
                  onClick={() => setCoverUrl(undefined)}>Use artwork</button>
              )}
              <p className="hint-text">Picked from the places on your route. Shared links and WhatsApp previews use it.</p>
            </div>
          </Surface>

          {/* ---------- Dates & days ---------- */}
          <Surface as="section" className="tsx-card" id="tset-dates" aria-label="Where does it go, and for how many days">
            <header className="tsx-head">
              <span className="tsx-ico" aria-hidden="true"><CalendarDays size={18} /></span>
              <span className="tsx-head-copy">
                <h3 className="tsx-q">Dates &amp; days</h3>
                <p className="tsx-a">Where it starts and ends, and how many days you have.</p>
              </span>
              {datesChanged && <span className="tset-changed">Changed</span>}
            </header>
            {/* #411: the strip renders the pair array — rename edits the chip
                in place, the pin travels with its name by construction. */}
            <div className="tsx-route" role="group" aria-label="The route">
              <span className="tsx-node tsx-node--start"><MapPin size={13} aria-hidden />{f.startLocation || 'Set a start'}</span>
              {dests.map((d, i) => (
                <Fragment key={`${d.name}-${i}`}>
                  <span className="tsx-road" aria-hidden="true" />
                  <span className="tsx-node">
                    <span className="tsx-node-line">
                      <span className="tsx-node-ord" aria-hidden="true">{i + 1}</span>
                      <span className="tsx-node-name">
                        {renamingDest === i ? (
                          <input
                            className="input input--compact"
                            aria-label={`Rename ${d.name}`}
                            autoFocus
                            value={renameDraft}
                            onChange={e => setRenameDraft(e.target.value)}
                            onBlur={() => commitRename(i)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitRename(i)
                              if (e.key === 'Escape') { setRenamingDest(null); setRenameDraft('') }
                            }}
                          />
                        ) : (
                          <>
                            {d.name}
                            {d.lat != null && d.lng != null && <span className="dest-pin" aria-hidden>📍</span>}
                          </>
                        )}
                      </span>
                    </span>
                    {renamingDest !== i && editable && (
                      <button type="button" aria-label={`Rename ${d.name}`}
                        onClick={() => { setRenamingDest(i); setRenameDraft(d.name) }}><Pencil size={13} aria-hidden /></button>
                    )}
                    <span className="tsx-node-tools">
                      <button type="button" aria-label={`Move ${d.name} earlier`} disabled={!editable || i === 0}
                        onClick={() => moveDest(i, -1)} style={{ opacity: i === 0 ? .25 : undefined }}><ChevronUp size={13} aria-hidden /></button>
                      <button type="button" aria-label={`Move ${d.name} later`} disabled={!editable || i === dests.length - 1}
                        onClick={() => moveDest(i, 1)} style={{ opacity: i === dests.length - 1 ? .25 : undefined }}><ChevronDown size={13} aria-hidden /></button>
                      {editable && (
                        <button type="button" aria-label={`Remove ${d.name}`}
                          onClick={() => setDests(list => list.filter((_, j) => j !== i))}><X size={13} aria-hidden /></button>
                      )}
                    </span>
                  </span>
                </Fragment>
              ))}
              {routeSummary.returnPlace !== null && (
                <>
                  <span className="tsx-road" aria-hidden="true" />
                  <span className="tsx-node tsx-node--return" aria-label={`Return: ${routeSummary.returnPlace}`}>
                    <span className="tsx-node-ord" aria-hidden="true">{dests.length + 1}</span>
                    <span className="tsx-node-name">{routeSummary.returnPlace}</span>
                    <span className="dest-pin" aria-hidden>📍</span>
                    <span className="tsx-return-marker">Return</span>
                  </span>
                </>
              )}
            </div>
            <div className="bench-pair">
              <Field label="Starting location">
                <LocationInput
                  id="tset-start-location"
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
                {startNotice && <p className="hint-text set-start-notice" role="status">{startNotice}</p>}
              </Field>
              <Field label={`Destinations (${routeSummary.destinationCount})`} hint="Search to add. Arrows reorder saved stops">
                <LocationInput
                  value={destInput}
                  onChange={setDestInput}
                  onPick={p => addDest(p.name + (p.admin1 ? `, ${p.admin1}` : ''), { lat: p.latitude, lng: p.longitude })}
                  placeholder={dests.length ? 'Add another destination…' : 'Add your first destination…'}
                  disabled={!editable}
                />
              </Field>
            </div>
            <div className="tsx-when">
              <DateRangeCalendar
                label="Trip dates"
                start={f.startDate} end={f.endDate}
                disabled={!editable}
                error={dry.ok ? undefined : dry.reason}
                hint={dayDeltaLabel}
                onChange={({ startDate, endDate }) => { setF(x => ({ ...x, startDate, endDate })) }}
              />
            </div>
            {/* The artboard reads the range back as two plain fields, so the
                chosen dates are legible without opening the calendar. A field
                whose draft moved from the saved row shows the old date struck
                through beside it — the same "before → after" the aside gives. */}
            <div className="tset-when-pair">
              <div className="field">
                <span className="flab">Starts</span>
                <div className={`inp${f.startDate !== trip.startDate ? ' changed' : ''}`}>
                  <CalendarDays size={14} aria-hidden className="tset-when-ico" />
                  <span className="tset-when-value" title={`${fmtTripDay(f.startDate)} · ${f.startLocation || 'No start yet'}`}>
                    {fmtTripDay(f.startDate)} · {f.startLocation || 'No start yet'}
                  </span>
                  {f.startDate !== trip.startDate && (
                    <span className="tset-was tset-when-was">{fmtTripDay(trip.startDate)}</span>
                  )}
                </div>
              </div>
              <div className="field">
                <span className="flab">Ends</span>
                <div className={`inp${f.endDate !== trip.endDate ? ' changed' : ''}`}>
                  <CalendarDays size={14} aria-hidden className="tset-when-ico" />
                  <span className="tset-when-value" title={`${fmtTripDay(f.endDate)} · ${endPlace}`}>
                    {fmtTripDay(f.endDate)} · {endPlace}
                  </span>
                  {f.endDate !== trip.endDate && (
                    <span className="tset-was tset-when-was">{fmtTripDay(trip.endDate)}</span>
                  )}
                </div>
              </div>
            </div>
            {/* The artboard's "your days" grid: each day as a real day, with
                the stops it already carries, so a date change shows which days
                gain or lose. `dayPlan` is the reconciled grid, so an added day
                reads "New · empty" before the save — the same shape the save
                will write. */}
            <div className="field">
              <span className="flab">Your days</span>
              <div className="tset-daygrid">
                {grid.map(d => (
                  <div key={d.key} className={`tset-day${d.isNew ? ' is-new' : ''}${lateDays.has(d.key) ? ' is-late' : ''}`}>
                    <span className="tset-day-dow">{d.dow}</span>
                    <b className="tset-day-num">{d.dayOfMonth}</b>
                    <em className="tset-day-stops">
                      {d.isNew ? 'New · empty' : `${d.stops} stop${d.stops === 1 ? '' : 's'}`}
                    </em>
                  </div>
                ))}
              </div>
              <span className="hint-text">{dayGridHint}</span>
            </div>
            {/* The artboard puts the return leg with the dates, because it is a
                property of the shape of the trip, not of the vehicle. The row
                renders only for a mode that prices fuel, which is the only
                case the write reads it in (settingsDryRun writes roundTrip as
                undefined otherwise). */}
            {fuelMode && (
              <button type="button" className={`tog${f.roundTrip ? ' on' : ''}`}
                role="switch" aria-checked={f.roundTrip} disabled={!editable}
                onClick={() => setF(x => ({ ...x, roundTrip: !x.roundTrip }))}>
                <span className="sw" aria-hidden="true" />
                <span className="tog-copy">
                  <b>Round trip</b>
                  <span>Drive back to {f.startLocation || 'the start'} at the end. Adds the return to time and fuel.</span>
                </span>
              </button>
            )}
            {/* #408: the refusal lives here, inline, where the dates are —
                with the blocking days linked to their timeline day. It is
                derived from the shared dry run, so the receipt above/beside
                and this line can never disagree. */}
            {!dry.ok && (
              <div className="ts-save-refusal" role="alert">
                <p className="err-text ts-warn-note"><InlineIcon icon={TriangleAlert} size={12} gap={3} />{dry.reason}</p>
                <BlockedDayLinks blocked={dry.blocked} onOpenDay={onOpenDay} />
              </div>
            )}
          </Surface>

          {/* ---------- Group & budget ---------- */}
          <Surface as="section" className="tsx-card" id="tset-group" aria-label="Who is going, and how do they split the money">
            <header className="tsx-head">
              <span className="tsx-ico" aria-hidden="true"><Users size={18} /></span>
              <span className="tsx-head-copy">
                <h3 className="tsx-q">Group &amp; budget</h3>
                <p className="tsx-a">Rooms, per-head splits and the Budget tab all read these.</p>
              </span>
            </header>
            <div className="tset-group-pair">
              <div className="field">
                <span className="flab">Travellers</span>
                {/* The artboard's stepper. `CREW_CHIPS` is still the set of
                    counts the dials round to, so a tap lands on the same
                    numbers the old chip row offered; the typed field below
                    stays for a party past 10. */}
                <div className="tset-stepper" role="group" aria-label="Number of travellers">
                  <button type="button" aria-label="One fewer" disabled={!editable || travellers <= CREW_MIN}
                    onClick={() => setF(x => ({ ...x, travellers: clampCrew(travellers - 1) }))}>−</button>
                  <b className="disp" aria-live="polite">{travellers}</b>
                  <button type="button" aria-label="One more" disabled={!editable || travellers >= CREW_MAX}
                    onClick={() => setF(x => ({ ...x, travellers: clampCrew(travellers + 1) }))}>+</button>
                </div>
                <span className="hint-text">{roomsLine}</span>
                {/* A party bigger than the stepper's easy range needs a way in —
                    Create Trip has the same field, so the two surfaces accept
                    the same range. */}
                <div className="bench-line set-bench-line-top">
                  <label className="bench-hint" htmlFor="ts-crew-custom">More than 10? </label>
                  <input id="ts-crew-custom" className="input mono set-bench-total-cap" type="number" inputMode="numeric"
                    min={CREW_MIN} max={CREW_MAX} disabled={!editable} value={f.travellers}
                    onChange={e => setF(x => ({ ...x, travellers: clampCrew(Number(e.target.value)) }))} />
                  <span className="bench-hint">up to {CREW_MAX}</span>
                </div>
              </div>
              <div className="field">
                <div className="tset-budget-head">
                  <span className="flab">Budget per person</span>
                  <span className="tset-budget-sum">
                    <b className="disp">{formatInr(clampedBudget)}</b>
                    {' '}
                    <span>· {formatInr(clampedBudget * travellers)} for the group</span>
                  </span>
                </div>
                {/* The artboard's plan marker rides the dial's own track, so the
                    target is read against what the trip already costs. The same
                    figure is printed in the scale line below. */}
                <RangeDial value={clampedBudget} min={budgetScale.min} max={budgetScale.max} step={budgetScale.step}
                  fmt={v => formatInr(v)} ariaLabel="Budget per person in rupees"
                  disabled={!editable} onChange={v => setF(x => ({ ...x, budget: v }))}
                  marker={{ value: planPerPerson, label: `Current plan ${formatInr(planPerPerson)} each` }} />
                {/* The artboard's scale: both ends named, and the plan's own
                    cost per head in the middle so the target is read against
                    what the trip already costs — not against an empty axis. */}
                <div className="tset-scale" aria-hidden="true">
                  <span>{budgetScale.minLabel}</span>
                  <span className="tset-scale-plan">Current plan {formatInr(planPerPerson)} each</span>
                  <span>{budgetScale.maxLabel}</span>
                </div>
                <div className="tset-budget-exact">
                  <label htmlFor="tset-budget-exact">Exact amount</label>
                  <div className="inp">
                    <span aria-hidden="true">₹</span>
                    <input id="tset-budget-exact" type="number" inputMode="numeric" min={0} max={300000} step={1}
                      disabled={!editable} value={clampedBudget}
                      onChange={e => {
                        const next = Number(e.target.value)
                        setF(x => ({ ...x, budget: Number.isFinite(next) ? Math.max(0, Math.min(300000, next)) : 0 }))
                      }} />
                  </div>
                </div>
                <p className="bench-hint">The Budget tab’s pacing tile reads this target.</p>
              </div>
            </div>
            {/* Over budget is a real, computed delta — never a guess. The strip
                appears only when the plan actually costs more per head than the
                target being set. */}
            {planOverPerPerson > 0 && (
              <p className="tset-over" role="status">
                <InlineIcon icon={TriangleAlert} size={14} gap={6} />
                The plan already costs <b>{formatInr(planOverPerPerson)} a head more</b> than this target. Budget will show where to trim.
              </p>
            )}
            <div className="field">
              <span className="flab">Spending style</span>
              <PillNav className="seg" role="group" aria-label="Budget preference" activeKey={f.stayStyle}>
                {STAY_STYLES.map(s => (
                  <button key={s} type="button" data-pill-key={s} disabled={!editable}
                    aria-pressed={f.stayStyle === s}
                    className={`seg-btn${f.stayStyle === s ? ' on' : ''}`}
                    onClick={() => setF(x => ({ ...x, stayStyle: s }))}>
                    {spendingStyleLabel(s)}
                  </button>
                ))}
              </PillNav>
              <span className="hint-text">{SPENDING_STYLE_HINT}</span>
            </div>
          </Surface>

      {/* ---------- Q3 · the machine ---------- */}
      {/* Mixed asks whenever the trip IS Mixed, not only while unanswered
          (2026-10-19). Gating on the open question made Yes a one-way door: the
          buttons vanished on click, and a reloaded answered trip showed none.
          Only the VALIDATION uses `mustAnswerDriving`. */}
      {f.transportMode === 'mixed' && (
        <Surface as="section" className="tsx-card" aria-label="Will you drive any part of this trip?">
          <header className="tsx-head tsx-head--plain">
            <h3 className="tsx-q">Will you drive any part of this trip?</h3>
            <p className="tsx-a">This trip mixes ways of travelling. Your answer sets the driving options. Nothing changes until you pick one.</p>
          </header>
          <div className="transport-answer-pair" role="group" aria-label="Will you drive any part of this trip?" data-sel={f.drivesPart === true ? '0' : f.drivesPart === false ? '1' : 'none'}>
            <button type="button" className={`crew-btn${f.drivesPart === true ? ' on' : ''}`}
              aria-pressed={f.drivesPart === true} disabled={!editable}
              onClick={() => setF(s => ({ ...s, drivesPart: true }))}>Yes, I drive</button>
            <button type="button" className={`crew-btn${f.drivesPart === false ? ' on' : ''}`}
              aria-pressed={f.drivesPart === false} disabled={!editable}
              onClick={() => setF(s => ({ ...s, drivesPart: false }))}>No, passenger only</button>
          </div>
        </Surface>
      )}
      <Surface as="section" className="tsx-card tsx-card--machine" id="tset-travel" aria-label={showsDriving ? 'What moves you, and who is behind the wheel' : 'What moves you'}>
        <header className="tsx-head">
          <span className="tsx-ico" aria-hidden="true"><Car size={18} /></span>
          <span className="tsx-head-copy">
            <h3 className="tsx-q">How you travel</h3>
            <p className="tsx-a">Sets drive times, rest breaks and fuel cost.</p>
          </span>
        </header>
        {/* Transport mode — bench mode grid. The sublabel is prose, not the raw
            speed number: "~40 km/h on hills" says what the mode costs a day,
            where a bare "42" was a number nobody could act on. */}
        <div className="bench-block bench-mode-block">
          <span className="bench-eyebrow">How you travel</span>
          <div className="bench-mode-grid" role="group" aria-label="Transport mode">
            {TRANSPORT_MODES.map(m => (
              <button key={m} type="button" className={`bench-mode-btn${f.transportMode === m ? ' on' : ''}`}
                aria-pressed={f.transportMode === m} disabled={!editable}
                onClick={() => {
                  // #412: the vehicle fields are READ against the mode's own
                  // default profile. Switching car → motorcycle used to leave
                  // the previous vehicle's capacity/economy sitting in the
                  // boxes, so the dial re-read 45 L / 15 km-L on a bike — and
                  // a save then priced the bike trip with car numbers. The
                  // mode carries its profile defaults in with it. ('ev' is a
                  // vehicle TYPE, not a transport mode — an EV trip is
                  // car-mode with the electric profile picked below.)
                  const vt = m === 'motorcycle' ? 'motorcycle' : 'car'
                  const d = defaultVehicleProfile(vt)
                  const ft = m === 'motorcycle'
                    ? 'petrol'
                    : f.fuelType === 'electric' || f.fuelType === 'cng' ? 'petrol' : f.fuelType
                  setF(x => ({
                    ...x, transportMode: m,
                    vehicleType: vt, fuelType: ft,
                    capacity: String(d.capacity), vehicleEconomy: String(d.economy),
                  }))
                }}>
                {modeIcon(m)}
                <b className="bench-mode-name">{cap(m)}</b>
                <span className="bench-mode-speed">{MODE_NOTE[m] ?? `~${MODE_SPEED[m] ?? 40} km/h`}</span>
              </button>
            ))}
          </div>
          <p className="bench-hint">Car and motorcycle switch cost math to fuel: distance ÷ economy × pump price.</p>
        </div>
        {/* Who's driving — the artboard's two-option segment over the stored
            count (#142). "Take turns" is every count above one: a trip stored
            with 2 or 3 drivers keeps that number, and the planner reads it. */}
        {showsDriving && (
          <div className="bench-block">
            <div className="tset-driver-pace-pair">
              <div className="field">
                <span className="flab">Who&apos;s driving</span>
                <PillNav className="seg" role="group" aria-label="Drivers sharing the wheel"
                  activeKey={(f.driverCount ?? 1) === 1 ? 'one' : 'turns'}>
                  <button type="button" data-pill-key="one" disabled={!editable}
                    aria-pressed={(f.driverCount ?? 1) === 1}
                    className={`seg-btn${(f.driverCount ?? 1) === 1 ? ' on' : ''}`}
                    onClick={() => setF(x => ({ ...x, driverCount: undefined }))}>One driver</button>
                  <button type="button" data-pill-key="turns" disabled={!editable}
                    aria-pressed={(f.driverCount ?? 1) > 1}
                    className={`seg-btn${(f.driverCount ?? 1) > 1 ? ' on' : ''}`}
                    onClick={() => setF(x => ({ ...x, driverCount: f.driverCount ?? 2 }))}>Take turns</button>
                </PillNav>
                <span className="hint-text">Taking turns allows up to 9 h a day; one driver caps at 6 h.</span>
                {/* A party that already rotates keeps its own number, so the
                    choice is still reachable after "Take turns" is picked. */}
                {(f.driverCount ?? 1) > 1 && (
                  <div className="tset-choice-row" role="group" aria-label="How many drivers rotate">
                    {[2, 3].map(n => (
                      <button key={n} type="button" className={`bench-crew-btn${f.driverCount === n ? ' on' : ''}`}
                        aria-pressed={f.driverCount === n} disabled={!editable}
                        onClick={() => setF(x => ({ ...x, driverCount: n }))}>{n} drivers</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="field">
                <span className="flab">Pace</span>
                {/* The approved row grid keeps all ten choices in view. */}
                <div className="tset-pace-rows" role="group" aria-label="Travel style">
                  {TRAVEL_STYLES.map(s => (
                    <button key={s} type="button" data-pill-key={s} disabled={!editable}
                      aria-pressed={f.travelStyle === s}
                      className={`seg-btn tset-pace-row${f.travelStyle === s ? ' on' : ''}`}
                      onClick={() => setF(x => ({ ...x, travelStyle: s }))}>
                      {cap(s)}
                    </button>
                  ))}
                </div>
                <span className="hint-text">Relaxed leaves 2 h free and ends days by 8 pm; packed pushes further. It never touches pricing.</span>
              </div>
            </div>
            <div className="tset-tog-pair">
              <button type="button" className={`tog${f.hasVulnerable ? ' on' : ''}`}
                role="switch" aria-checked={!!f.hasVulnerable} disabled={!editable}
                onClick={() => setF(x => ({ ...x, hasVulnerable: x.hasVulnerable ? undefined : true }))}>
                <span className="sw" aria-hidden="true" />
                <span className="tog-copy">
                  <b>Infants or seniors along</b>
                  <span>Shorter legs, a break every 90 min</span>
                </span>
              </button>
              <button type="button" className={`tog${f.driveAfterDinner ? ' on' : ''}`}
                role="switch" aria-checked={f.driveAfterDinner} disabled={!editable}
                onClick={() => setF(x => ({ ...x, driveAfterDinner: !x.driveAfterDinner }))}>
                <span className="sw" aria-hidden="true" />
                <span className="tog-copy">
                  <b>Drive after dinner</b>
                  <span>Allows legs that end after 9 pm</span>
                </span>
              </button>
            </div>
          </div>
        )}
        {/* Fuel + vehicle — only for self-drive modes */}
        {fuelMode && (
          <>
            {/* The artboard reads both fuel dials back as plain fields with the
                unit inside, so the number is legible beside the slider that set
                it. The slider below still writes the same draft value. */}
            <div className="tset-when-pair">
              <div className="field">
                <span className="flab">Mileage</span>
                <div className="inp">
                  <span>{ecoSet ? `${ecoNum}` : 'Not set'}</span>
                  <span className="tset-inp-unit">km per litre</span>
                </div>
                <RangeDial value={ecoVal} min={2} max={80} step={0.5}
                  fmt={v => `${v} km/L`} ariaLabel="Fuel economy in kilometres per litre"
                  disabled={!editable} onChange={v => setF(x => ({ ...x, fuelEconomy: String(v) }))} />
              </div>
              <div className="field">
                <span className="flab">Fuel price</span>
                <div className="inp">
                  <span>{priceSet ? `₹${priceNum}` : `₹${FUEL_PRICE_INR_PER_L} default`}</span>
                  <span className="tset-inp-unit">per litre</span>
                </div>
                <RangeDial value={priceVal} min={50} max={250} step={0.5}
                  fmt={v => `₹${v}/L`} ariaLabel="Fuel price in rupees per litre"
                  disabled={!editable} onChange={v => setF(x => ({ ...x, fuelPrice: String(v) }))} />
              </div>
            </div>
            {isImplausibleFuelEconomy(f.transportMode, ecoSet ? ecoNum : undefined) && (
              <p className="hint-text ts-warn-note">
                <InlineIcon icon={TriangleAlert} size={12} gap={3} />Unusual for a {f.transportMode}. Most do far better. Double-check the mileage.
              </p>
            )}
            {priceIgnored && (
              <p className="hint-text ts-warn-note">
                <InlineIcon icon={TriangleAlert} size={12} gap={3} />Your fuel price is unused until you set a mileage. The bill is pricing the blended {cap(f.transportMode)} rate instead.
              </p>
            )}
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
      </Surface>

          {/* ---------- People & sharing ----------
              The artboard's one-row strip: the stack, who can edit, and the
              one verb that belongs to another tab. "Manage in Share" is the
              only way to add or remove a member, so the strip defers to it
              rather than growing a second member list that could disagree. */}
          <Surface as="section" className="tsx-card tsx-card--people" id="tset-people" aria-label="People and sharing">
            <span className="tset-stack" aria-hidden="true">
              {members.slice(0, 4).map((m, i) => (
                <span key={m.userId} className={`tset-av tset-av--${i % 4}`}>
                  {initialsOf(nameOf(m.userId))}
                </span>
              ))}
            </span>
            <span className="tset-people-copy">
              <b className="tset-people-title">People &amp; sharing</b>
              <span>{peopleCopy}</span>
            </span>
            {onOpenShare && (
              <button type="button" className="tset-manage" onClick={onOpenShare}>Manage in Share</button>
            )}
          </Surface>

          {/* ---------- Archive or delete ----------
              Owner only, as the artboard says. Archive has no API yet, so the
              card says so instead of offering a button that would do nothing;
              trash is real and carries its undo. */}
          {role === 'owner' && (
            <Surface as="section" className="tsx-card tsx-card--danger" id="tset-danger" aria-label="Archive or delete">
              <header className="tsx-head">
                <span className="tsx-ico" aria-hidden="true"><Trash2 size={18} /></span>
                <span className="tsx-head-copy">
                  <h3 className="tsx-q">Archive or delete</h3>
                  <p className="tsx-a">Only the owner sees this section.</p>
                </span>
              </header>
              <div className="tset-danger-pair">
                <div className="tset-danger-cell">
                  <b>Archive</b>
                  <span>Not built yet. The trip stays where it is.</span>
                  <button type="button" className="tset-danger-btn" disabled title="Archive is not built yet">Archive</button>
                </div>
                <div className="tset-danger-cell tset-danger-cell--trash">
                  <b>Move to trash</b>
                  <span>Restorable for 30 days, then gone.</span>
                  <button type="button" className="tset-danger-btn tset-danger-btn--trash" onClick={() => {
                    trashTrip(trip)
                    undoToast(`Moved “${trip.name}” to trash`, () => {
                      restoreTrashedTrip(trip)
                      toast(`Restored “${trip.name}”`)
                    })
                  }}>Move to trash</button>
                </div>
              </div>
            </Surface>
          )}
        </div>

        {saveAside}
      </div>

      {/* Narrow layouts keep the same verbs reachable past the panel. */}
      <StickyFormBar show={showBottomSave}>
        {/* #413: a viewer used to get a vanished bar under disabled inputs —
            permissioned read as broken. The narrow bar renders for everyone; a
            viewer gets it disabled with the reason said out loud. */}
        {!editable && (
          <span className="ts-savebar-note hint-text" role="status">
            <InlineIcon icon={TriangleAlert} size={12} gap={3} />Only editors can change trip settings. Ask an editor on this trip, or duplicate it to edit your own copy.
          </span>
        )}
        {/* #704: a save in flight is its own answer, so it gets its own block
            with its own role. The failed line keeps its own markup: it is
            pinned verbatim by tests/trip-settings-result.test.ts. */}
        {savingSettings && (
          <div className="set-save-state">
            <StateBlock kind="loading" size="compact" title="Saving your settings." />
          </div>
        )}
        {writeErr && <span className="err-text" role="alert">{writeErr}</span>}
        <button className="btn btn-primary" disabled={!canSave || savingSettings}
          title={canSave ? undefined : dry.ok ? 'No changes' : dry.reason} onClick={() => {
          // #408: the Preview and this button run the SAME dry run. A refusal
          // is already rendered inline (and in the receipt) — clicking Save on
          // a refused form is a no-op, never a toast that fades.
          if (!dry.ok) return
          if (dry.startCoordsDropped) setStartNotice(START_DROPPED)
          setWriteErr(null)
          if (updateTrip(trip.id, dry.patch)) {
            // Our own save moves updatedAt — rebase the remote-edit watch so
            // the banner cannot fire on ourselves (#414).
            ownSaveRef.current = true
            // #704: "Trip settings updated" waits for the server. The cache
            // already holds the edit, so the page reads the saved values meanwhile.
            const verdict = tripWriteVerdict(trip.id)
            if (verdict) {
              setSavingSettings(true)
              void verdict.then(saved => {
                setSavingSettings(false)
                if (saved) toast('Trip settings updated')
                else setWriteErr(TRIP_SETTINGS_NOT_SAVED)
              })
            }
          }
        }}>{savingSettings ? 'Saving…' : 'Save settings'}</button>
      </StickyFormBar>
    </div>
  )
}
