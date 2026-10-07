// ============ Trip import ============
// One parser for every JSON a user can hand the app. The RULES live in
// `lib/itinerarySpec.ts` (shared with the exporter, the validator CLI and the
// authoring tool); this module is the file-shaped facade over them.
//
// Formats, and what happens to each:
//
//   v1  a bare `Trip`            — what older "Download JSON" wrote
//   v1  `{ trip, publication }`  — the pre-versioning gallery import format
//   v2  `{ formatVersion, trip }`— what this build writes (see snapshot.ts)
//
// Parsing is pure and side-effect free so it can be tested without a browser.
// Applying it is the store's job (`importTrip`).
//
// Two properties this module owes its caller:
//   1. It NEVER returns a trip the rest of the app cannot render — every stop
//      it keeps has usable coordinates, every number is a number, every day is
//      numbered from 1 and contiguous, and the date range matches the day count.
//   2. It SAYS what it changed. `report.repairs` is the compatibility story for
//      an older file; `report.warnings` and `report.droppedStops` are the parts
//      a person has to look at. Nothing is fixed or lost silently.
import type { Trip } from '../data/types'
import {
  emptyReport, migrateTrip, normalizeTrip, readExport, TripImportError,
  type DroppedStopPatch, type NormalizeReport, type PublicationDraft,
} from './itinerarySpec'

export { TripImportError } from './itinerarySpec'
export type { DroppedStopPatch, PublicationDraft, NormalizeReport } from './itinerarySpec'

export interface ParsedTripImport {
  /** A complete `Trip`. `id` / `createdAt` / `updatedAt` are placeholders — the
   *  store assigns real ones and re-ids every day, stop and expense. */
  trip: Trip
  /** Present when the file carried a `publication` block. */
  publication?: PublicationDraft
  /** Set when the file carried a publish block the publish rules refuse:
   *  the block is dropped and this names the rule it broke. */
  publicationRefused?: string
  format: 'trip' | 'gallery'
  /** One short phrase for the toast, e.g. "6-day gallery itinerary, 23 stops". */
  summary: string
  /** The wire version the file declared (1 when it predates versioning). */
  version: number
  /** What was repaired, what could not be, and which keys nothing reads. */
  report: NormalizeReport
}

/** Parse a trip export, in any supported version, into something importable.
 *  Throws `TripImportError` with a specific reason on anything it cannot read
 *  or rebuild.
 *
 *  `patches` are hand-entered coordinates for stops the file could not place
 *  (the resolve-or-prompt guard's answers, keyed to their file positions by
 *  `report.droppedStops`): re-parsing with them rescues those stops instead of
 *  leaving them to the report. */
export function parseTripImport(text: string, patches: DroppedStopPatch[] = []): ParsedTripImport {
  const found = readExport(text)
  const report = emptyReport()

  const trip = normalizeTrip(migrateTrip(found.trip, found.version), report, patches)
  if (!trip) {
    // Nothing survived the coordinate wall. Say why, with the first example —
    // this is the one case where the file cannot be made importable.
    const first = report.droppedStops[0]
    throw new TripImportError(
      first
        ? `None of that file's stops could be placed on the map — starting with “${first.title}” (${first.reason}). Re-add the places from the map instead.`
        : 'That export has no itinerary days — it is not a trip.',
    )
  }

  if (report.unknownKeys.length > 0) {
    const shown = report.unknownKeys.slice(0, 3).join(', ')
    const more = report.unknownKeys.length > 3 ? ` and ${report.unknownKeys.length - 3} more` : ''
    report.warnings.push(`Fields nothing reads were ignored: ${shown}${more}.`)
  }

  // "Gallery" is decided by the publication block, not by the envelope: a v2
  // export of a private trip is an envelope with nothing to publish.
  const isGallery = !!found.publication
  const stopCount = trip.days.reduce((n, d) => n + d.stops.length, 0)
  return {
    trip,
    publication: found.publication,
    publicationRefused: found.publicationRefused,
    format: isGallery ? 'gallery' : 'trip',
    summary: `${trip.days.length}-day ${isGallery ? 'gallery itinerary' : 'trip'}, ${stopCount} stops`,
    version: found.version,
    report,
  }
}
