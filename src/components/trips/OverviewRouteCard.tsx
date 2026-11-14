import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Pin } from 'lucide-react'
import type { MapTarget } from '../../lib/mapTarget'
import { minutesToHM } from '../../lib/engine'
import { staggerStep } from '../../lib/motion'
import type { OverviewRouteRow } from '../../lib/overviewTruth'
import {
  OVERVIEW_PIN_HIT_DIAMETER,
  groupOverviewPins,
  overviewPinAriaLabel,
  overviewPinDetailLines,
  overviewPinTag,
  overviewPinText,
  overviewPinTitle,
  overviewRoadSummary,
  overviewPinStopId,
  overviewRouteRowMeta,
  overviewRoutePath,
  overviewRouteSegments,
  overviewTerrainModel,
  projectOverviewRoute,
  type OverviewPinTarget,
} from '../../lib/overviewRouteMap'
import type { TripRoadView } from '../../lib/tripRoad'
import { ELEVATION_ATTRIBUTION, ELEVATION_CREDIT_URL } from '../../lib/elevation'
import type { TripElevation } from '../../hooks/useTripElevation'
import { OverviewElevationProfile } from './OverviewElevationProfile'
import { StateBlock } from '../page/StateBlock'

function useCompactPlate(): boolean {
  const query = '(max-width: 720px)'
  const [compact, setCompact] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const change = () => setCompact(media.matches)
    change()
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return compact
}

/** Keep SVG user units equal to CSS pixels, so every pin keeps a 44px target.
 *  The plate paints a 1px border and the SVG fills the CONTENT box, so the
 *  measured width must exclude that border. A border-box width would stretch
 *  the viewBox and shrink every hit circle below 44px. */
function usePlateSize(compact: boolean, routeReady: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const fallback = compact ? 420 : 720
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    // The observer reports the content box, which is the box the SVG fills.
    // The mount pass reads the same box from the border-box rect.
    const drawableWidth = (entry?: ResizeObserverEntry) => {
      if (entry) return Math.max(1, entry.contentRect.width)
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      return Math.max(1, rect.width - border - padding)
    }
    const update = (entry?: ResizeObserverEntry) => setWidth(drawableWidth(entry))
    update()
    const observer = new ResizeObserver(entries => update(entries[0]))
    observer.observe(element)
    return () => observer.disconnect()
  }, [compact, routeReady])
  const height = Math.round(width * (compact ? 320 / 420 : 340 / 720))
  return { ref, width, height }
}

function legFacts(row: OverviewRouteRow): string | null {
  const leg = row.arrivingLeg
  if (!leg) return null
  const suffix = leg.estimated ? ' (est.)' : ''
  return `${leg.distanceKm.toLocaleString('en-IN')} km${suffix} · ${minutesToHM(leg.durationMinutes)}${suffix}`
}

function pinAction(row: OverviewRouteRow): MapTarget | undefined {
  return row.kind === 'stop' && row.stopId
    ? { kind: 'stop', stopId: row.stopId }
    : undefined
}

function legAnimationStyle(index: number): CSSProperties {
  return { '--i': staggerStep(index) } as CSSProperties
}

/** The trip's true shape, small, in the card header beside the title block.
 *  It stays out of the plot: a corner inside a mountain profile covers the
 *  route line, and this is the line's own shape. */
function TrueShapeInset({ path }: { path: string }) {
  const start = path.match(/^M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/)
  return (
    <div className="ovw-elev-inset" title="True shape · north up">
      <svg className="ovw-elev-inset-svg" viewBox="0 0 112 96" aria-hidden="true" focusable="false">
        <g className="ovw-elev-inset-grid">
          <path d="M0 24 Q56 22 112 24" />
          <path d="M0 48 Q56 46 112 48" />
          <path d="M0 72 Q56 70 112 72" />
          <path d="M28 0 Q26 48 28 96" />
          <path d="M56 0 Q54 48 56 96" />
          <path d="M84 0 Q82 48 84 96" />
        </g>
        <path className="ovw-elev-inset-case" d={path} />
        <path className="ovw-elev-inset-line" d={path} />
        {start ? <circle className="ovw-elev-inset-start" cx={+start[1]} cy={+start[2]} r={3.6} /> : null}
        <circle className="ovw-elev-inset-n" cx={104} cy={8} r={7} />
        <text className="ovw-elev-inset-n-text" x={104} y={11.2} textAnchor="middle">N</text>
      </svg>
      <span className="sr-only">True shape · north up</span>
    </div>
  )
}

export function OverviewRouteCard({
  rows,
  road,
  transportMode,
  coverUrl,
  onOpenMap,
  elevation,
  elevationRole,
}: {
  rows: readonly OverviewRouteRow[]
  road?: TripRoadView | null
  transportMode: string
  coverUrl?: string | null
  onOpenMap?: (target?: MapTarget) => void
  /** The trip's ONE height reading, shared with the "Highest stop" tile. */
  elevation?: TripElevation | null
  /** The alert role when this is the first failed read on the page, else status. */
  elevationRole?: 'alert' | 'status'
}) {
  const compact = useCompactPlate()
  const terrain = overviewTerrainModel()
  const routeReady = rows.length >= 2 && terrain.kind === 'flat'
  const plate = usePlateSize(compact, routeReady)
  const { ref: plateRef, width, height } = plate
  const measured = elevation?.result ?? null
  const showElevation = !!measured
  const elevationPending = elevation?.view === 'loading' && !measured
  const elevationFailed = elevation?.view === 'failed' && !measured
  const elevationEmpty = elevation?.view === 'empty' && !measured
  const stopElevation = useMemo(() => {
    const out = new Map<string, number>()
    for (const point of elevation?.points ?? []) {
      if (point.elevationM != null) out.set(point.key, point.elevationM)
    }
    return out
  }, [elevation])
  // The true-shape inset keeps the route's own shape visible beside the height
  // plate. It rides in the card HEADER, not in the plot: a corner inside a
  // mountain profile always covers part of the route line. It is its own small
  // projection, drawn with the same bounded curve as the plate, so a short hop
  // between two stops never becomes a kink.
  const insetPath = useMemo(() => {
    if (!showElevation || rows.length < 2) return null
    const points = projectOverviewRoute(rows, 112, 96, 10)
    if (points.length < 2) return null
    const path = overviewRoutePath(points)
    return path || null
  }, [showElevation, rows])
  const projected = useMemo(
    () => projectOverviewRoute(rows, width, height, compact ? 24 : 32),
    [rows, width, height, compact],
  )
  const pins = useMemo(
    () => groupOverviewPins(projected, OVERVIEW_PIN_HIT_DIAMETER),
    [projected],
  )
  const segments = useMemo(() => overviewRouteSegments(projected), [projected])
  const summary = useMemo(
    () => overviewRoadSummary(rows, road, transportMode),
    [rows, road, transportMode],
  )
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [activeRows, setActiveRows] = useState<readonly string[]>([])
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null)
  const cover = coverUrl?.trim()
  const atmosphereStyle: CSSProperties | undefined = cover && /^(https?:\/\/|blob:|\/)/i.test(cover)
    ? { '--ovw-cover': `url(${JSON.stringify(cover)})` } as CSSProperties
    : undefined

  const rowToGroup = useMemo(() => {
    const out = new Map<string, OverviewPinTarget>()
    for (const pin of pins) {
      for (const key of pin.rowKeys) out.set(key, pin)
    }
    return out
  }, [pins])

  const clearActive = () => {
    setActiveGroup(null)
    setActiveRows([])
    setActiveRowKey(null)
  }

  const activatePin = (pin: OverviewPinTarget) => {
    setActiveGroup(pin.key)
    setActiveRows(pin.rowKeys)
    setActiveRowKey(null)
  }

  const activateRow = (row: OverviewRouteRow) => {
    const pin = rowToGroup.get(row.key)
    setActiveGroup(pin?.key ?? null)
    setActiveRows(pin?.rowKeys ?? [row.key])
    setActiveRowKey(row.key)
  }

  if (!routeReady) {
    return (
      <>
        <div className="ovw-head">
          <h2 className="ovw-title" id="ovw-route-title">Route</h2>
        </div>
        <div className="ovw-route-empty">
          <StateBlock
            kind="empty"
            size="compact"
            icon={<Pin size={18} aria-hidden />}
            title="No route to draw yet"
            body="This plan needs at least two places with confirmed coordinates. Add a stop, or pin the missing ones."
          />
        </div>
      </>
    )
  }

  const stopNumbers = new Map<string, number>()
  rows.forEach((row, index) => stopNumbers.set(row.key, index + 1))
  const routeDistance = summary.distanceKm == null
    ? null
    : Math.round(summary.distanceKm).toLocaleString('en-IN')
  const routeTime = summary.durationMinutes == null ? null : minutesToHM(summary.durationMinutes)
  const showRoadFacts = summary.state === 'measured' || summary.state === 'estimated'
  const openGenericMap = () => onOpenMap?.()

  return (
    <>
      <div className="ovw-head">
        <h2 className="ovw-title" id="ovw-route-title">{showElevation ? 'The road, by height' : 'Route'}</h2>
        <div className="ovw-head-side">
          {showElevation && insetPath ? <TrueShapeInset path={insetPath} /> : null}
          <div className="ovw-head-meta">
            <span className={`ovw-route-caption ${showElevation ? 'is-elevation' : `is-${summary.state}`}`}>
              {showElevation ? 'Illustrative elevation' : summary.caption}
            </span>
            {onOpenMap && <button type="button" className="ovw-link" onClick={openGenericMap}>Open map <span aria-hidden="true">→</span></button>}
          </div>
        </div>
      </div>

      {showElevation && measured ? (
        <OverviewElevationProfile
          points={measured.points}
          runs={measured.runs}
          stats={measured.stats}
          compact={compact}
        />
      ) : (
      <div ref={plateRef} className={`ovw-map${summary.state === 'schematic' ? ' is-neutral' : ''}`}>
        <div className="ovw-map-atmosphere" style={atmosphereStyle} aria-hidden="true" />
        <span className="ovw2-map-north" aria-hidden="true">N</span>
        <span className="ovw2-map-basis">North up</span>
        <svg
          className="ovw-map-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label="Route map. Each available pin opens the Map at its stop."
          focusable="false"
        >
          <g className="ovw-survey" aria-hidden="true">
            <path d={`M ${width * .06} ${height * .24} C ${width * .16} ${height * .12}, ${width * .24} ${height * .31}, ${width * .3} ${height * .19} S ${width * .56} ${height * .08}, ${width * .69} ${height * .24}`} />
            <path d={`M ${width * .12} ${height * .8} C ${width * .22} ${height * .62}, ${width * .32} ${height * .74}, ${width * .44} ${height * .61} S ${width * .72} ${height * .53}, ${width * .9} ${height * .7}`} />
            <circle cx={width * .29} cy={height * .2} r="3" />
            <circle cx={width * .75} cy={height * .62} r="3" />
          </g>

          <g aria-hidden="true">
            {segments.map((segment, index) => segment && (
              <path key={`case-${index}`} className="rm-case" d={segment} pathLength={1} style={legAnimationStyle(index)} />
            ))}
          </g>
          <g aria-hidden="true">
            {segments.map((segment, index) => segment && (
              <path
                key={`road-${index}`}
                className="rm-road"
                d={segment}
                pathLength={1}
                style={legAnimationStyle(index)}
              />
            ))}
          </g>
          <g aria-hidden="true">
            {segments.map((segment, index) => {
              if (!segment) return null
              const row = rows[index + 1]
              return (
                <path
                  key={`highlight-${index}`}
                  className={`rm-leghit${row && activeRows.includes(row.key) ? ' is-hl' : ''}`}
                  d={segment}
                />
              )
            })}
          </g>

          {pins.map(pin => {
            const primary = pin.rows.find(row => row.kind === 'stop') ?? pin.rows[0]
            const groupStopId = overviewPinStopId(pin)
            const target = groupStopId ? { kind: 'stop' as const, stopId: groupStopId } : undefined
            // One callback drives the role, the tab stop, the click and the
            // spoken label, so a pin can never say it opens the Map and then
            // do nothing.
            const openMap = pin.interactive && onOpenMap ? () => onOpenMap(target) : undefined
            const canOpen = !!openMap
            const label = overviewPinAriaLabel(pin, {
              canOpen,
              hasMapAction: !!onOpenMap,
              hasStopTarget: !!groupStopId,
            })
            const activeRow = activeRowKey
              ? pin.rows.find(row => row.key === activeRowKey) ?? null
              : null
            const pinTitle = overviewPinTitle(pin, activeRowKey)
            const displayTag = overviewPinTag(pin, activeRowKey)
            const detailRow = activeRow ?? (pin.rows.length === 1 ? primary : null)
            const detailLines = overviewPinDetailLines(pin)
            const legLine = detailRow ? legFacts(detailRow) : null
            const guidance = !legLine && pin.rows.length > 1
              ? 'Choose a route row for leg details.'
              : null
            const footerLine = legLine ?? guidance
            const x = pin.x
            const y = pin.y
            const nameY = y > height - 72 ? y - 34 : y + 38
            const tagY = nameY + 15
            const estimate = detailRow?.arrivingLeg?.estimated === true
            const tipWidth = pin.rows.length > 1 || estimate ? 280 : 204
            const footerY = 36 + detailLines.length * 16
            const tipHeight = 40 + detailLines.length * 16 + (footerLine ? 16 : 0) + (estimate ? 16 : 0)
            const tipX = Math.min(Math.max(x - tipWidth / 2, 8), width - tipWidth - 8)
            const rawTipY = y < tipHeight + 12 ? y + 26 : y - tipHeight - 16
            const tipY = Math.max(8, Math.min(rawTipY, height - tipHeight - 8))
            return (
              <g
                key={pin.key}
                className={`rm-pin${activeGroup === pin.key ? ' is-hl' : ''}${pin.isStart ? ' is-start' : ''}${pin.isEnd ? ' is-end' : ''}`}
                role={canOpen ? 'button' : 'img'}
                tabIndex={canOpen ? 0 : undefined}
                aria-label={label}
                onClick={openMap}
                onMouseEnter={() => activatePin(pin)}
                onMouseLeave={clearActive}
                onFocus={() => activatePin(pin)}
                onBlur={clearActive}
                onKeyDown={event => {
                  if (canOpen && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    openMap?.()
                  } else if (event.key === 'Escape') {
                    clearActive()
                    event.currentTarget.blur()
                  }
                }}
              >
                <circle className="rm-hit" cx={x} cy={y} r={OVERVIEW_PIN_HIT_DIAMETER / 2} />
                <circle className="rm-ring" cx={x} cy={y} r={15} />
                <circle className="rm-dot" cx={x} cy={y} r={9} />
                {(pin.interactive || pin.tag)
                  && pin.rows.filter(row => row.kind === 'stop').length <= 1 && (
                  <text className="rm-num" x={x} y={y + 3} textAnchor="middle">
                    {stopNumbers.get(primary.key) ?? ''}
                  </text>
                )}
                {displayTag && (
                  <>
                    <text className="rm-name" x={x} y={nameY} textAnchor="middle">{overviewPinText(pinTitle, 30)}</text>
                    <text className="rm-tag" x={x} y={tagY} textAnchor="middle">{displayTag}</text>
                  </>
                )}
                {activeGroup === pin.key && (
                  <g className="rm-tip" transform={`translate(${tipX} ${tipY})`}>
                    <rect className="rm-tip-box" width={tipWidth} height={tipHeight} rx="9" />
                    <text className="rm-tip-title" x="12" y="19">{overviewPinText(pinTitle, tipWidth > 240 ? 44 : 32)}</text>
                    {detailLines.map((line, index) => (
                      <text className="rm-tip-line" x="12" y={36 + index * 16} key={`${index}-${line}`}>{overviewPinText(line, tipWidth > 240 ? 52 : 38)}</text>
                    ))}
                    {footerLine && (
                      <text className="rm-tip-line" x="12" y={footerY}>{overviewPinText(footerLine, tipWidth > 240 ? 52 : 38)}</text>
                    )}
                    {estimate && (
                      <text className="rm-tip-estimate" x="12" y={footerY + 16}>
                        Straight-line estimate, not a measured road.
                      </text>
                    )}
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      )}

      <p className="ovw-rsum">
        {showRoadFacts && routeDistance != null && (
          <>
            <span><b>{summary.state === 'estimated' ? 'about ' : ''}{routeDistance}</b> km</span>
            <span><b>{summary.state === 'estimated' ? 'about ' : ''}{routeTime}</b> driving</span>
          </>
        )}
        <span><b>{new Set(rows.filter(row => row.dayIndex != null).map(row => row.dayIndex)).size}</b> days</span>
        <span><b>{rows.filter(row => row.kind === 'stop').length}</b> stops</span>
      </p>
      {showElevation && measured && (
        <div className="ovw-elev-foot">
          {measured.stats.missing > 0 && (
            <span className="ovw-elev-note">
              {measured.stats.missing} of {measured.stats.sampled + measured.stats.missing} places could not be read.
            </span>
          )}
          <details className="ovw-sources">
            <summary>Data sources</summary>
            <div className="ovw-sources-body">
              <p>Heights are public terrain estimates at each place. The curve between places is illustrative.</p>
              <p>{ELEVATION_ATTRIBUTION}</p>
              <a href={ELEVATION_CREDIT_URL} target="_blank" rel="noreferrer">Full source list and terms</a>
            </div>
          </details>
        </div>
      )}
      {elevationPending && <p className="ovw-elev-note is-pending">Reading heights…</p>}
      {elevationEmpty && <p className="ovw-elev-note">No height data for this road.</p>}
      {(elevationFailed || elevation?.view === 'retained') && (
        <div className={`ovw-road-note ${elevationFailed ? 'is-failed' : 'is-kept'}`} role={elevationFailed ? elevationRole : undefined}>
          <span>
            {elevationFailed
              ? <><b>Heights could not load.</b></>
              : <>Couldn’t refresh the heights. The last profile stays.</>}
          </span>
          {elevation?.retry && <button type="button" className="ovw-btn ovw-btn--quiet" onClick={elevation.retry}>Try again</button>}
        </div>
      )}
      {summary.state === 'failed' ? (
        <div className="ovw-road-note">
          <span><b>Road not measured.</b> Distance and drive time will appear after a retry.</span>
          {road?.retry && <button type="button" className="ovw-btn ovw-btn--quiet" onClick={road.retry}>Try again</button>}
        </div>
      ) : summary.note ? (
        <p className={`ovw-road-note is-${summary.state}`}>{summary.note}</p>
      ) : null}

      <ol className={`ovw-stoplist${rows.length > 8 ? ' is-long' : ''}${showElevation ? ' is-elevated' : ''}`} aria-label="Stops on the route">
        {rows.map(row => {
          const pin = rowToGroup.get(row.key)
          const facts = legFacts(row)
          const isActive = activeRows.includes(row.key)
          const height = stopElevation.get(row.key)
          // The right column reads "Day N · km" as the artboard does, or "Day N · height m" on the elevation view.
          const km = row.arrivingLeg ? `${row.arrivingLeg.distanceKm.toLocaleString('en-IN')} km${row.arrivingLeg.estimated ? ' (est.)' : ''}` : null
          const tail = height != null ? `${Math.round(height).toLocaleString('en-IN')} m` : km
          const stopMeta = tail ? `${overviewRouteRowMeta(row)} · ${tail}` : overviewRouteRowMeta(row)
          const body = (
            <>
              <span className="ovw-stop-pin" aria-hidden="true">{stopNumbers.get(row.key)}</span>
              <span className="ovw-stop-name">{row.title}</span>
              <span className="ovw-stop-meta">{stopMeta}</span>
              <span className="ovw-stop-t">{row.arrivingLeg ? `${minutesToHM(row.arrivingLeg.durationMinutes)}${row.arrivingLeg.estimated ? ' (est.)' : ''}` : ''}</span>
            </>
          )
          return (
            <li
              key={row.key}
              className={[
                isActive ? 'is-hl' : '',
                row.kind === 'start' || row.kind === 'return' ? 'is-start' : '',
                row.kind === 'destination' ? 'is-end' : '',
              ].filter(Boolean).join(' ') || undefined}
            >
              {onOpenMap ? (
                <button
                  type="button"
                  className={`ovw-stop-btn${isActive ? ' is-hl' : ''}`}
                  title={row.title}
                  aria-label={`${row.title}. ${overviewRouteRowMeta(row)}.${facts ? ` ${facts} from the previous stop.` : ''} Opens the Map.`}
                  onClick={() => onOpenMap(pinAction(row))}
                  onMouseEnter={() => activateRow(row)}
                  onMouseLeave={clearActive}
                  onFocus={() => activateRow(row)}
                  onBlur={clearActive}
                >
                  {body}
                </button>
              ) : (
                <div className={`ovw-stop-btn${isActive ? ' is-hl' : ''}`} title={row.title} onMouseEnter={() => activateRow(row)} onMouseLeave={clearActive}>
                  {body}
                </div>
              )}
              {isActive && pin && <span className="sr-only">Pin {stopNumbers.get(pin.rows[0].key)} highlighted.</span>}
            </li>
          )
        })}
      </ol>
    </>
  )
}
