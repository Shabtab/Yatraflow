// ============ Printable day cards (offline PDF export) ============
// Share tab → "Print day cards": renders the whole plan as print-optimized
// day cards and calls window.print(). The browser's print dialog does the
// PDF (Microsoft Print to PDF / Save as PDF) — no JS PDF dependency, so the
// export works fully offline and costs nothing to the bundle.
//
// Structure: a hidden-but-rendered `.print-sheet` that only becomes visible
// under @media print, where the rest of the app is suppressed. The preview
// modal shows the same markup scaled down, so what you see is what prints.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import type { Trip } from '../data/types'
import { buildPrintModel } from '../lib/printModel'
import { collectWarnings, type LegEstimate } from '../lib/engine'
import { formatHM, useTimeFormat } from '../lib/timefmt'
import { Modal, toast } from './ui'

/** One row: stop with clocks, or the drive leg between two places. */
function PrintRow({ row, timeFormat }: { row: ReturnType<typeof buildPrintModel>['days'][number]['rows'][number]; timeFormat: ReturnType<typeof useTimeFormat> }) {
  if (row.kind === 'leg') {
    const { leg } = row
    return (
      <div className="pr-leg">
        <span className="pr-leg-route">{leg.fromTitle} → {leg.toTitle}</span>
        <span className="pr-leg-meta">{Math.round(leg.distanceKm)} km · {Math.round(leg.durationMinutes)} min drive</span>
      </div>
    )
  }
  const { stop } = row
  return (
    <div className="pr-stop">
      <span className="pr-stop-title">
        {stop.title}
        {stop.status === 'confirmed' && <span className="pr-badge pr-badge--ok">✓</span>}
        {stop.status === 'needs-booking' && <span className="pr-badge pr-badge--warn">book</span>}
      </span>
      <span className="pr-stop-meta">
        {stop.arrive && formatHM(stop.arrive, timeFormat)}
        {stop.arrive && stop.depart && stop.depart !== stop.arrive ? `–${formatHM(stop.depart, timeFormat)}` : ''}
      </span>
      <span className="pr-stop-meta">
        {stop.visitMinutes != null && stop.visitMinutes > 0 && `${stop.visitMinutes} min`}
        {stop.entryFeeInrPerPerson != null && stop.entryFeeInrPerPerson > 0 && ` · ₹${Math.round(stop.entryFeeInrPerPerson)}/person`}
        {stop.notes ? ` · ${stop.notes}` : ''}
      </span>
    </div>
  )
}

export function PrintExport({ trip, legCorrections }: { trip: Trip; legCorrections?: Record<string, LegEstimate> }) {
  const [open, setOpen] = useState(false)
  const timeFormat = useTimeFormat()
  // Portal host on <body>: the print stylesheet hides #root entirely, so the
  // sheet must live OUTSIDE the app tree to survive into the printed page.
  const hostRef = useRef<HTMLDivElement | null>(null)
  if (hostRef.current === null) {
    hostRef.current = document.createElement('div')
    hostRef.current.className = 'pr-sheet-portal'
  }
  useEffect(() => {
    const host = hostRef.current!
    document.body.appendChild(host)
    return () => { host.remove() }
  }, [])

  const model = useMemo(() => {
    const warningsByDay: Record<number, string[]> = {}
    for (const w of collectWarnings(trip)) {
      const m = /^Day (\d+):/.exec(w.title)
      // the model strips the "Day n:" prefix itself; pass titles raw
      if (m) { const di = Number(m[1]) - 1; (warningsByDay[di] ??= []).push(w.title) }
    }
    return buildPrintModel(trip, { legCorrections, warningsByDay })
  }, [trip, legCorrections])

  function doPrint() {
    // The sheet is always in the DOM (visually hidden except in print), so
    // print can render it without a state round-trip; a resize first makes
    // browsers that re-layout for print (Firefox) see final geometry.
    window.print()
  }

  return (
    <>
      <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <Printer size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Print day cards
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Print day cards / offline PDF">
        <p className="hint-text" style={{ margin: '0 0 12px' }}>
          A road-friendly copy of the plan — every day as a card with clocks, drives and stops. Use your browser's
          print dialog and pick <b>Save as PDF</b> to keep it on your phone for no-signal stretches.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={doPrint}>Open print dialog</button>
          <button className="btn btn-outline btn-sm" onClick={() => { toast('Tip: pick "Save as PDF" as the printer destination') }}>How do I get a PDF?</button>
        </div>

        {/* Live preview of the print sheet, scaled to fit the modal. */}
        <div className="pr-preview" aria-label="Preview of the printed day cards">
          <PrintSheet model={model} timeFormat={timeFormat} />
        </div>
      </Modal>

      {/* The real print target — portaled to <body>, hidden on screen, only
          visible to the printer (see print CSS + hostRef note above). */}
      {createPortal(<PrintSheet model={model} timeFormat={timeFormat} />, hostRef.current)}
    </>
  )
}

function PrintSheet({ model, timeFormat }: { model: ReturnType<typeof buildPrintModel>; timeFormat: ReturnType<typeof useTimeFormat> }) {
  const fmtInr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
  return (
    <div className="pr-sheet">
      <header className="pr-trip">
        <h1>{model.tripName}</h1>
        <p className="pr-trip-meta">{model.metaLine}</p>
        <p className="pr-trip-meta">
          <b>{fmtInr(model.totals.costInr)}</b> estimated · {Math.round(model.totals.distanceKm).toLocaleString('en-IN')} km ·{' '}
          {Math.round(model.totals.travelMinutes / 60)}h driving · {model.totals.stops} stops
        </p>
      </header>

      {model.days.map(d => (
        <section key={d.index} className="pr-day">
          <div className="pr-day-head">
            <h2>Day {d.index + 1}{d.title ? ` — ${d.title}` : ''}{d.date ? ` · ${d.date}` : ''}</h2>
            <span className="pr-day-route">{d.routeLine}</span>
            <span className="pr-day-meta">
              {formatHM(d.startTime, timeFormat)} → {formatHM(d.endsAt, timeFormat)} · {Math.round(d.totalDistanceKm)} km ·{' '}
              {fmtInr(d.costInr)} day cost
            </span>
            {d.warnings.length > 0 && (
              <ul className="pr-warns">
                {d.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}
          </div>
          <div className="pr-rows">
            {d.rows.map((row, i) => <PrintRow key={i} row={row} timeFormat={timeFormat} />)}
          </div>
        </section>
      ))}

      {model.expenses.length > 0 && (
        <section className="pr-expenses">
          <h2>Trip expenses</h2>
          <table>
            <tbody>
              {model.expenses.map((e, i) => (
                <tr key={i}>
                  <td>{e.label}{e.dayIndex != null ? ` (Day ${e.dayIndex + 1})` : ''}</td>
                  <td>{e.category}</td>
                  <td className="pr-num">{fmtInr(e.amountInr)}{e.perPerson ? ' × person' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="pr-foot">
        <span>{model.assumptionsLine}</span>
        <span>Printed from YatraFlow · {new Date(model.printedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      </footer>
    </div>
  )
}
