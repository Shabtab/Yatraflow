// ============ The shared transport policy (2026-10-19) ============
// One function answers the only question every surface keeps asking: is the
// wheel the traveller's own? Create Trip, Trip Settings, the summaries and the
// planner all ask it, and the specification demands they answer it identically.
//
// Why one table and not a predicate per surface: the behaviour is a mode table,
// and a mode table copied into four files is one that will disagree with itself
// the first time a mode is added. `MODE_CAPABILITIES` is a `Record` keyed by
// `TransportMode`, so omitting a mode here is a COMPILE error rather than a
// silent fall-through. A `Set` plus a membership test cannot do that, which is
// exactly why this is a Record.
//
// Fuel-versus-fare is deliberately NOT in this table. `isFuelEconomyMode` owns
// that, and it is a different question: a taxi is a passenger trip that still
// prices fares, and folding the two together would make every driving trip
// fuel-priced.
import { TRANSPORT_MODES, type TransportMode } from '../data/types'

/** What a surface knows about how this trip moves. */
export interface TransportChoice {
  transportMode: TransportMode | undefined
  /** Mixed only: does the traveller drive any part of the trip?
   *  `undefined` means nobody has answered yet. */
  drivesPart?: boolean
}

/** What every surface needs to decide. */
export interface TransportPolicy {
  /** The planner treats the wheel as the traveller's. */
  driving: boolean
  /** Render the driving controls: driver counts, driving after dinner, and the
   *  private-vehicle block. */
  showsDrivingControls: boolean
  /** The Mixed question is open, and a new trip cannot be created until it is
   *  answered. */
  mustAnswerDriving: boolean
  /** The traveller has answered the Mixed question. Always true outside Mixed. */
  answered: boolean
}

/**
 * The mode table. `Record<TransportMode, ...>` is load-bearing: add a mode to
 * `TRANSPORT_MODES` and this object stops type-checking until the new mode is
 * given its capabilities.
 *
 * `mixed` records the UNAANSWERED state on purpose, because that is the state
 * every Mixed trip written before this feature has always planned as. The
 * traveller's answer narrows it below; it does not replace this entry.
 */
const MODE_CAPABILITIES: Record<TransportMode, { driving: boolean }> = {
  car: { driving: true },
  rental: { driving: true },
  motorcycle: { driving: true },
  train: { driving: false },
  bus: { driving: false },
  flight: { driving: false },
  taxi: { driving: false },
  mixed: { driving: true },
}

/** The mode a trip must NAME before the app guesses. A missing or unrecognised
 *  mode is not a car. The historical predicate returned false for anything it
 *  did not recognise, and callers rely on that to mean "no wheel, ask the user". */
function readMode(transportMode: TransportMode | undefined): TransportMode | null {
  const raw = String(transportMode ?? '')
  return isDeclaredMode(raw) ? raw : null
}

function isDeclaredMode(mode: string): mode is TransportMode {
  return (TRANSPORT_MODES as readonly string[]).includes(mode)
}

/**
 * The capability record for a trip. Pure, total, and safe for a row whose
 * `transport_mode` is missing or unrecognised. An unreadable mode answers
 * "nobody drives", which matches `isSelfDrivenMode(undefined) === false`.
 *
 * Mixed is the only mode that asks. `driving` is what the PLANNER does and an
 * unanswered Mixed keeps driving. `showsDrivingControls` is what the UI renders
 * and an unanswered Mixed hides them, because the question is still open.
 * Outside Mixed the two agree and the answer is ignored.
 */
export function transportPolicy(choice: TransportChoice): TransportPolicy {
  const mode = readMode(choice.transportMode)
  if (mode === null) {
    // No readable mode means no wheel. Not a car, not a Mixed.
    return { driving: false, showsDrivingControls: false, answered: false, mustAnswerDriving: false }
  }
  const base = MODE_CAPABILITIES[mode]

  if (mode === 'mixed') {
    const answered = typeof choice.drivesPart === 'boolean'
    const driving = answered ? choice.drivesPart === true : base.driving
    return {
      driving,
      // Controls follow the ANSWER, not the fallback. An open question shows
      // the question, not the dials behind it.
      showsDrivingControls: answered && driving,
      answered,
      mustAnswerDriving: !answered,
    }
  }

  return {
    driving: base.driving,
    showsDrivingControls: base.driving,
    answered: true,
    mustAnswerDriving: false,
  }
}

/** Convenience for the many call sites that only need the planner's answer.
 *  Reads the same record, so it can never disagree with the full form. */
export function isDrivingTrip(choice: TransportChoice): boolean {
  return transportPolicy(choice).driving
}

/** Convenience for the call sites that render. */
export function showsDrivingControls(choice: TransportChoice): boolean {
  return transportPolicy(choice).showsDrivingControls
}

/**
 * The PLANNER boundary. It answers a different question from `isDrivingTrip`:
 * "may this plan carry a fuel or charge halt?".
 *
 * A row with no readable mode keeps the caller's own choice. A missing mode
 * means "no mode verdict asked for", not "conducted" — several legacy callers
 * omit it, and their `includeFuel` flag is the only statement about the wheel.
 * A DECLARED mode answers through the same table, so a stale flag cannot add a
 * halt the trip does not own.
 */
export function plannerDrives(choice: TransportChoice): boolean {
  const mode = String(choice.transportMode ?? '').trim().toLowerCase()
  if (mode === '') return true
  return transportPolicy({ transportMode: mode as TransportMode, drivesPart: choice.drivesPart }).driving
}