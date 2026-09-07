// ============ Calendar export (.ics) ============
// Client-side iCalendar generation for the Share tab export — no dependency,
// no server. One all-day-ish VEVENT per trip day (summary = day route, the
// schedule in the description) plus timed VEVENTs for fixed commitments
// (hotel check-ins, train/flight departures). Google/Apple/Outlook all
// import the result via a plain blob download.
//
// Pure string-building: node-testable. Dates are local-time ("floating" —
// no TZ component) which is correct for an itinerary whose clocks are the
// traveller's wall-clock times.

import type { Trip } from '../data/types'
import { simulateDay, originOf, buildJourney, minutesToHM, type LegEstimate } from './engine'

/** Fold per RFC 5545 §3.1: content lines longer than 75 octets are split,
 *  continuation lines start with a space. Uppercase property names preserved. */
function foldLine(line: string): string[] {
  const octets = [...line]
  if (octets.length <= 73) return [line]
  const out: string[] = [octets.slice(0, 73).join('')]
  for (let i = 73; i < octets.length; i += 72) out.push(' ' + octets.slice(i, i + 72).join(''))
  return out
}

/** Escape text values per RFC 5545 §3.3.11. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** "YYYY-MM-DD" + 0-based day offset → "YYYYMMDD". Invalid dates (bad
 *  startDate, empty days) yield "" and the event is skipped — one malformed
 *  date must not kill the whole calendar. */
export function icsDate(startDate: string, dayIndex: number): string {
  const d = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + dayIndex)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** "HH:MM" + "YYYYMMDD" → "YYYYMMDDTHHMMSS" (floating local time). */
function icsDateTime(hm: string, ymd: string): string {
  return `${ymd}T${hm.replace(':', '')}00`
}

const CRLF = '\r\n'

/** Build the full VCALENDAR text for a trip. */
export function buildIcs(trip: Trip, legCorrections?: Record<string, LegEstimate>): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YatraFlow//Trip Planner//EN',
    'CALSCALE:GREGORIAN',
  ]

  const push = (l: string) => lines.push(...foldLine(l))

  trip.days.forEach(day => {
    const ymd = icsDate(trip.startDate, day.index)
    if (!ymd) return
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index, legCorrections)
    const journey = buildJourney(trip, day, legCorrections)
    const startTitle = journey.startTitle
    const endTitle = journey.endTitle
    const summary = day.title
      ? `Day ${day.index + 1}: ${day.title}`
      : `Day ${day.index + 1}: ${startTitle} → ${endTitle}`
    const rows: string[] = []
    sim.activeStops.forEach((s, i) => {
      const arrive = sim.arrivalTimes[i]
      rows.push(`${arrive} ${s.title}${s.visitMinutes ? ` (${minutesToHM(s.visitMinutes)})` : ''}`)
    })
    const desc = [
      `${Math.round(sim.totalDistanceKm)} km · ${minutesToHM(sim.totalTravelMinutes)} driving`,
      ...rows,
    ].filter(Boolean).join('\n')

    push(`BEGIN:VEVENT`)
    push(`UID:${trip.id}-day-${day.index}@yatraflow`)
    push(`DTSTAMP:${stamp}`)
    push(`DTSTART;VALUE=DATE:${ymd}`)
    push(`DTEND;VALUE=DATE:${nextYmd(ymd)}`)
    push(`SUMMARY:${esc(`${trip.name} — ${summary}`)}`)
    push(`DESCRIPTION:${esc(desc)}`)
    push('END:VEVENT')
  })

  trip.fixedCommitments.forEach(fc => {
    const ymd = icsDate(trip.startDate, fc.dayIndex)
    if (!ymd || !/^\d{2}:\d{2}$/.test(fc.time)) return
    push(`BEGIN:VEVENT`)
    push(`UID:${trip.id}-fc-${fc.id}@yatraflow`)
    push(`DTSTAMP:${stamp}`)
    push(`DTSTART:${icsDateTime(fc.time, ymd)}`)
    // commitments get a 1h default so busy slots show on calendar grids
    push(`DTEND:${icsDateTime(addHour(fc.time), ymd)}`)
    push(`SUMMARY:${esc(`${fc.type.replace('-', ' ')} — ${fc.title}`)}`)
    if (fc.notes) push(`DESCRIPTION:${esc(fc.notes)}`)
    push('END:VEVENT')
  })

  lines.push('END:VCALENDAR')
  return lines.join(CRLF) + CRLF
}

/** "YYYYMMDD" → the next day's "YYYYMMDD" (all-day events are end-exclusive). */
function nextYmd(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00`)
  d.setDate(d.getDate() + 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function addHour(hm: string): string {
  const [h, m] = hm.split(':').map(Number)
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Download helper — Blob + object URL, mirroring snapshot's downloadTripJson. */
export function downloadTripIcs(trip: Trip, legCorrections?: Record<string, LegEstimate>): void {
  const ics = buildIcs(trip, legCorrections)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${trip.name.replace(/[^\w-]+/g, '_') || 'trip'}_yatraflow.ics`
  a.click()
  URL.revokeObjectURL(url)
}
