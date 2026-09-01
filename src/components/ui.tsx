// ============ Reusable UI components ============
import React, { useEffect, useId, useRef, useState } from 'react'
import { formatInr } from '../lib/engine'
import { registerTouchDnd, touchPressAbort, touchPressStart, encodeDropKey, isInteractiveTarget } from '../lib/touchDnd'

export function Avatar({ user, size = 'sm' }: { user?: { profile: { name: string; avatarUrl?: string } }; size?: 'sm' | 'lg' }) {
  const cls = `avatar ${size === 'lg' ? 'lg' : ''}`
  const px = size === 'lg' ? 44 : 26
  // width/height give the <img> an intrinsic size so the row doesn't shift
  // while the avatar loads (matches .avatar / .avatar.lg in styles.css).
  if (user?.profile.avatarUrl) return <img className={cls} src={user.profile.avatarUrl} alt={user.profile.name} width={px} height={px} />
  const initials = (user?.profile.name ?? '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return <span className={cls}>{initials}</span>
}

export function Chip({ children, tone, onClick, active }: { children: React.ReactNode; tone?: 'teal' | 'saffron' | 'danger' | 'ok' | 'info'; onClick?: () => void; active?: boolean }) {
  if (onClick) {
    return <button type="button" className={`clickable-chip ${tone === 'teal' ? 'on-teal' : tone === 'saffron' ? 'on-saffron' : ''} ${active ? 'on-teal' : ''}`} onClick={onClick}>{children}</button>
  }
  const cls = tone ? `chip chip-${tone}` : 'chip'
  return <span className={cls}>{children}</span>
}

export function Modal({ open, onClose, title, children, initialFocus }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; initialFocus?: string }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      // trap Tab focus inside the dialog so keyboard users can't wander behind it
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(el => !el.hasAttribute('disabled'))
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    // lock page scroll while the dialog is up
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // focus the first sensible control so keyboard users can start typing
    // immediately — callers can override via `initialFocus` (ConfirmDialog
    // aims at Cancel so a stray Enter can't confirm a destructive action)
    const t = setTimeout(() => {
      const el = (initialFocus ? dialogRef.current?.querySelector<HTMLElement>(initialFocus) : null)
        ?? bodyRef.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, select')
        ?? dialogRef.current?.querySelector<HTMLElement>('button')
      el?.focus()
    }, 30)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      clearTimeout(t)
      previouslyFocused?.isConnected && previouslyFocused.focus()
    }
  }, [open, onClose, initialFocus])
  if (!open) return null
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  )
}

/** Styled replacement for window.confirm — destructive actions go through here. */
export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onClose }: {
  open: boolean
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} initialFocus=".confirm-actions .btn-outline">
      {body && <p className="muted" style={{ marginTop: 0 }}>{body}</p>}
      <div className="confirm-actions">
        <button
          className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => { onConfirm(); onClose() }}
        >{confirmLabel}</button>
        <button className="btn btn-outline btn-sm" onClick={onClose}>{cancelLabel}</button>
      </div>
    </Modal>
  )
}

/** Form row: label + control + hint/error. The label is programmatically
 *  associated with the row's control (UI audit F-01): Field generates an id
 *  and injects it into the first control child via cloneElement — host
 *  controls (input/select/textarea) take it directly, custom control
 *  components (LocationInput) accept an `id` prop and forward it to their
 *  input. An explicit `id` on the child wins. Non-control children (chip
 *  rows, time previews) are left untouched and the label gets no htmlFor. */
export function Field(props: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  const controlId = useId()
  let associated = false
  const wired = React.Children.toArray(props.children).map(child => {
    if (associated || !React.isValidElement(child)) return child
    const el = child as React.ReactElement<{ id?: string }>
    const tag = typeof el.type === 'string' ? el.type : null
    const isHostControl = tag === 'input' || tag === 'select' || tag === 'textarea'
    const isCustomControl = typeof el.type === 'function'
    if (!isHostControl && !isCustomControl) return child
    if (el.props.id != null) { associated = true; return child }
    associated = true
    return React.cloneElement(el, { id: controlId })
  })
  return (
    <div className="field">
      <label className="label" htmlFor={associated ? controlId : undefined}>{props.label}</label>
      {wired}
      {props.hint && !props.error && <span className="hint-text">{props.hint}</span>}
      {props.error && <span className="err-text" role="alert">{props.error}</span>}
    </div>
  )
}

/** Simple toast system. */
let pushToastFn: ((msg: string, kind?: 'ok' | 'err', action?: { label: string; run: () => void }) => void) | null = null
export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  pushToastFn?.(msg, kind)
}
/** Toast with an Undo button — for destructive actions that can be reversed. */
export function undoToast(msg: string, undo: () => void) {
  pushToastFn?.(msg, 'ok', { label: 'Undo', run: undo })
}
let dismissToastFn: ((id: number) => void) | null = null
export function ToastZone() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string; action?: { label: string; run: () => void } }[]>([])
  useEffect(() => {
    pushToastFn = (msg, kind = 'ok', action) => {
      const id = Date.now() + Math.random()
      setToasts(t => [...t, { id, msg, kind, action }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), action ? 7000 : 3400)
    }
    dismissToastFn = (id) => setToasts(t => t.filter(x => x.id !== id))
    return () => { pushToastFn = null; dismissToastFn = null }
  }, [])
  return (
    <div className="toast-zone" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.msg}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => { t.action!.run(); dismissToastFn?.(t.id) }}
            >{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-block"><div className="spinner" style={{ marginBottom: 12 }} /><div>{label}</div></div>
}

export function EmptyState({ icon = '🗺️', title, body, action }: { icon?: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="big">{icon}</div>
      <h3>{title}</h3>
      {body && <p style={{ marginTop: 6 }}>{body}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

export function HealthRing({ score, band }: { score: number; band: string }) {
  const R = 46, CIRC = 2 * Math.PI * R
  const color = band === 'Comfortable' ? 'var(--ok)' : band === 'Manageable' ? 'var(--teal)' : band === 'Tight' ? 'var(--warn)' : 'var(--danger)'
  return (
    <div className="health-ring">
      <svg width="108" height="108" viewBox="0 0 108 108">
        <circle cx="54" cy="54" r={R} fill="none" stroke="var(--bg-soft)" strokeWidth="10" />
        <circle
          cx="54" cy="54" r={R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * CIRC} ${CIRC}`}
          style={{ transition: 'stroke-dasharray .5s ease' }}
        />
      </svg>
      <div className="health-num"><b style={{ color }}>{score}</b><span>health</span></div>
    </div>
  )
}

/** Route snapshot for dark hero/snapshot cards (CTI homepage mockup): the trip
 *  route as an illustration — a gradient road (saffron→gold→coral) with a dashed
 *  cream centreline and white day-numbered badges (1 · 3 · 6 · 10), exactly the
 *  mockup's grammar. Aspect preserved: 'none' stretching is what made the old
 *  version read as a decorative wave instead of a route. */
export function RouteSquiggle({ height }: { height?: number }) {
  const gid = React.useId().replace(/[:]/g, '')
  const stops: Array<[number, number, number]> = [[21, 91, 1], [176, 55, 3], [361, 67, 6], [510, 36, 10]]
  return (
    <svg viewBox="0 0 532 132" style={height ? { width: '100%', height, display: 'block' } : { width: '100%', height: 'auto', display: 'block' }} aria-hidden="true" role="presentation">
      <defs>
        <linearGradient id={`rg-${gid}`} x1="0" x2="1">
          <stop stopColor="#EFAD54" /><stop offset=".5" stopColor="#FFDF93" /><stop offset="1" stopColor="#E8684C" />
        </linearGradient>
      </defs>
      <path d="M21 104 C 83 40, 139 107, 197 55 S 320 5, 382 67 S 484 128, 531 36"
        fill="none" stroke={`url(#rg-${gid})`} strokeWidth="8" strokeLinecap="round" />
      <path d="M21 104 C 83 40, 139 107, 197 55 S 320 5, 382 67 S 484 128, 531 36"
        fill="none" stroke="#FFF8D7" strokeWidth="2" strokeDasharray="7 9" strokeLinecap="round" />
      {stops.map(([x, y, n]) => (
        <g key={n}>
          <circle cx={x} cy={y} r="13" fill="#FFFFFF" />
          <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#155B60">{n}</text>
        </g>
      ))}
    </svg>
  )
}

/** Dynamic route snapshot (CTI homepage mockup grammar) for real trip data.
 *  With `points` (stop coordinates in visit order, `day` = day index), the road
 *  is a simplified, north-up snapshot of the actual geography: bounds fitted
 *  aspect-true (like the map's fitBounds), points decimated and smoothed into a
 *  flowing road, day badges on each day's first stop. Without points it falls
 *  back to the mockup's illustrative curve. Pure math — no DOM measurement. */
export function RouteSnapshot({ count, startLabel, endLabel, roundTripNote, points }: {
  count: number
  startLabel?: string
  endLabel?: string
  /** set when the trip returns to its start — a small note; the end label stays
      the final destination, never a duplicate of the start */
  roundTripNote?: string
  /** ordered stop coordinates (lat/lng) with day index; optional */
  points?: Array<{ lat: number; lng: number; day: number }>
}) {
  const gid = React.useId().replace(/[:]/g, '')
  const W = 540, H = 168, PAD = 34
  const MOCK_D = 'M21 104 C 83 40, 139 107, 197 55 S 320 5, 382 67 S 484 128, 531 36'

  // ---- real-geometry path ----
  let realPath: string | null = null
  let dayAnchors: Array<{ day: number; x: number; y: number }> = []
  if (points && points.length >= 2) {
    const lats = points.map(p => p.lat), lngs = points.map(p => p.lng)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    // metres-ish scaling so longitude stretch doesn't flatten the north-up shape
    const kcos = Math.max(0.2, Math.cos(((minLat + maxLat) / 2 * Math.PI) / 180))
    const wKm = Math.max((maxLng - minLng) * kcos * 111, 1e-4)
    const hKm = Math.max((maxLat - minLat) * 111, 1e-4)
    const s = Math.min((W - 2 * PAD) / wKm, (H - 2 * PAD) / hKm)
    // project with the fit scale (raw, unoffset), then centre the *drawn*
    // bounds in the canvas — a route flatter or narrower than the viewBox
    // would otherwise sit small in the top-left instead of filling the card
    const raw = points.map(p => ({
      x: (p.lng - minLng) * kcos * 111 * s,
      y: -(p.lat) * 111 * s, // north up: higher lat sits higher (negated)
    }))
    const rawXs = raw.map(r => r.x), rawYs = raw.map(r => r.y)
    const dx = (W - (Math.max(...rawXs) - Math.min(...rawXs))) / 2 - Math.min(...rawXs)
    const dy = (H - (Math.max(...rawYs) - Math.min(...rawYs))) / 2 - Math.min(...rawYs)
    const px = (p: { lat: number; lng: number }, i: number): [number, number] => [
      raw[i].x + dx,
      raw[i].y + dy,
    ]
    // decimate points landing on nearly the same canvas spot
    const kept: Array<{ x: number; y: number; day: number }> = []
    for (let i = 0; i < points.length; i++) {
      const [x, y] = px(points[i], i)
      const last = kept[kept.length - 1]
      if (!last || Math.hypot(x - last.x, y - last.y) > 3) kept.push({ x, y, day: points[i].day })
    }
    if (kept.length >= 2) {
      realPath = catmullRomPath(kept)
      // badge on each day's first stop (dedup: several days may share a base)
      const seen = new Set<number>()
      for (const k of kept) {
        if (!seen.has(k.day)) { seen.add(k.day); dayAnchors.push({ day: k.day, x: k.x, y: k.y }) }
      }
    }
  }
  // ---- badge thinning for long trips ----
  const thin = (nums: number[]) => {
    if (nums.length <= 9) return nums
    const out: number[] = []
    for (let i = 0; i < 7; i++) out.push(nums[Math.round((i * (nums.length - 1)) / 6)])
    if (out[out.length - 1] !== nums[nums.length - 1]) out[out.length - 1] = nums[nums.length - 1]
    return out
  }

  // ---- fallback: mockup illustrative curve, badges at even arc positions ----
  let badges: Array<{ day: number; x: number; y: number }>
  if (realPath) {
    badges = thin(dayAnchors.map(a => a.day)).map(day => dayAnchors.find(a => a.day === day)!)
  } else {
    const segs: Array<[number, number, number, number, number, number, number, number]> = [
      [21, 104, 83, 40, 139, 107, 197, 55],
      [197, 55, 255, 3, 320, 5, 382, 67],
      [382, 67, 444, 129, 484, 128, 531, 36],
    ]
    const SAMPLES = 90
    const pts: Array<[number, number]> = []
    for (const [x0, y0, x1, y1, x2, y2, x3, y3] of segs) {
      for (let i = 1; i <= SAMPLES; i++) {
        const t = i / SAMPLES, u = 1 - t
        pts.push([
          u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        ])
      }
    }
    const cum: number[] = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    const pointAt = (f: number): [number, number] => {
      const target = f * cum[cum.length - 1]
      let i = cum.findIndex(c => c >= target)
      if (i < 1) i = 1
      return pts[i - 1]
    }
    const dayNums = thin(Array.from({ length: Math.max(2, Math.min(count || 2, 30)) }, (_, i) => i + 1))
    badges = dayNums.map((day, i) => { const [x, y] = pointAt(i / (dayNums.length - 1)); return { day, x, y } })
  }

  const short = (s?: string) => (s && s.length > 16 ? s.slice(0, 15) + '…' : s)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
      aria-label={`Route across ${count} days${startLabel ? `, starting at ${startLabel}` : ''}${endLabel ? `, ending at ${endLabel}` : ''}`}>
      <defs>
        <linearGradient id={`rs-${gid}`} x1="0" x2="1">
          <stop stopColor="#EFAD54" /><stop offset=".5" stopColor="#FFDF93" /><stop offset="1" stopColor="#E8684C" />
        </linearGradient>
      </defs>
      <path d={realPath ?? MOCK_D} fill="none" stroke={`url(#rs-${gid})`} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d={realPath ?? MOCK_D} fill="none" stroke="#FFF8D7" strokeWidth="2" strokeDasharray="7 9" strokeLinecap="round" />
      {badges.map(({ day, x, y }) => (
        <g key={day}>
          <circle cx={x} cy={y} r="13" fill="#FFFFFF" />
          <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#155B60">{day}</text>
        </g>
      ))}
      {/* start label bottom-left, final destination top-right — never duplicated */}
      {startLabel && (
        <text x="6" y={H - 6} textAnchor="start" fontSize="12.5" fontWeight="800" fill="#EAF6F2">{short(startLabel)}</text>
      )}
      {endLabel && (
        <text x={W - 6} y="18" textAnchor="end" fontSize="12.5" fontWeight="800" fill="#EAF6F2">{short(endLabel)}</text>
      )}
      {roundTripNote && (
        <text x={W - 6} y={H - 6} textAnchor="end" fontSize="11" fontWeight="650" fill="#A9CFC7">{roundTripNote}</text>
      )}
    </svg>
  )
}

/** Catmull-Rom → cubic bezier smoothing for a flowing-road polyline. */
function catmullRomPath(pts: Array<{ x: number; y: number }>): string {
  const at = (i: number) => pts[Math.max(0, Math.min(i, pts.length - 1))]
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const p0 = at(i - 2), p1 = at(i - 1), p2 = at(i), p3 = at(i + 1)
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

export function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function DeltaText({ value, suffix }: { value: number; suffix?: (v: number) => string }) {
  const cls = value > 0 ? 'delta-pos' : value < 0 ? 'delta-neg' : 'delta-zero'
  const sign = value > 0 ? '+' : ''
  const text = suffix ? suffix(value) : `${sign}${Math.round(value * 100) / 100}`
  return <span className={cls}>{text}</span>
}

export function InrDelta({ value }: { value: number }) {
  const cls = value > 0 ? 'delta-pos' : value < 0 ? 'delta-neg' : 'delta-zero'
  return <span className={cls}>{value > 0 ? '+' : ''}{formatInr(value)}</span>
}

export function CopyButton({ text, label = 'Copy link', onCopied }: { text: string; label?: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className={`btn btn-sm ${done ? 'btn-outline' : 'btn-primary'}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {})
        setDone(true)
        toast('Copied to clipboard')
        setTimeout(() => setDone(false), 1800)
        onCopied?.()
      }}
    >{done ? '✓ Copied' : label}</button>
  )
}

/**
 * Accessible move up/down controls + HTML5 drag-and-drop wrapper for stop cards.
 * Supports same-list reordering plus foreign (cross-list) drags: cards carry a
 * `application/x-yf-stop` payload via `dragPayload`, and `onForeignDrop` is
 * called when such a drag is released on a card (insert at its index) or a
 * `dayDropHandlers` zone (insert at that index). `dayDropHandlers` also serve
 * as gap drop targets for foreign drags.
 */
export function useReorder<T extends { id: string }>(
  items: T[],
  onMove: (fromIdx: number, toIdx: number) => void,
  options?: {
    /** serialised payload attached to every drag (identifies the item across lists) */
    dragPayload?: (item: T) => string
    /** called with the payload and the insertion index when a foreign drag lands */
    onForeignDrop?: (payload: string, toIdx: number) => void
    /** touch dragging is enabled only for editable lists (default true) */
    touch?: boolean
  },
) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  /** insertion index a foreign drag is hovering (cards + gap zones) */
  const [foreignOver, setForeignOver] = useState<number | null>(null)

  // ---- touch long-press integration (see lib/touchDnd.ts) ----
  // The engine is a module singleton and needs stable callbacks; route it
  // through a ref that always points at the latest closures.
  const instId = useId()
  const latest = useRef({ items, onMove, options, touch: options?.touch ?? true })
  latest.current = { items, onMove, options, touch: options?.touch ?? true }
  useEffect(() => {
    return registerTouchDnd(instId, {
      onOwnDragStart: idx => setDragIdx(idx),
      onDragOver: (idx, foreign) => { if (foreign) setForeignOver(idx); else setOverIdx(idx) },
      onDropOnSelf: (from, to) => latest.current.onMove(from, to),
      onForeignDrop: (payload, to) => latest.current.options?.onForeignDrop?.(payload, to),
      onDragEnd: () => { setDragIdx(null); setOverIdx(null); setForeignOver(null) },
    })
  }, [instId])
  // unmount safety: end any press/drag owned by this list
  useEffect(() => () => touchPressAbort(), [])

  /** True when a touch/pen pointer is pressing an interactive control — those
      keep their normal behaviour; long-press drag is for the row background. */
  const touchPress = (idx: number) => (e: React.PointerEvent<HTMLElement>) => {
    if (!latest.current.touch) return
    if (e.pointerType === 'mouse') return
    if (isInteractiveTarget(e.target as Element)) return
    const item = latest.current.items[idx]
    touchPressStart({
      instanceId: instId,
      idx,
      payload: latest.current.options?.dragPayload?.(item) ?? '',
      element: e.currentTarget as HTMLElement,
      x: e.clientX,
      y: e.clientY,
    })
  }

  // During dragover, dataTransfer values are unreadable — only its `types` list.
  // A drag started in this same list is tracked by dragIdx instead.
  const isForeign = (e: React.DragEvent) =>
    dragIdx === null && !!options?.onForeignDrop && e.dataTransfer.types.includes('application/x-yf-stop')

  const dndHandlers = (idx: number) => ({
    draggable: true,
    'data-yf-drop': encodeDropKey(instId, idx),
    onPointerDown: touchPress(idx),
    onDragStart: (e: React.DragEvent) => {
      setDragIdx(idx)
      const payload = options?.dragPayload?.(items[idx])
      if (payload) {
        e.dataTransfer.setData('application/x-yf-stop', payload)
        e.dataTransfer.effectAllowed = 'move'
      }
      e.dataTransfer.setData('text/plain', items[idx].id) // Firefox needs some data to drag
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      if (isForeign(e)) { if (foreignOver !== idx) setForeignOver(idx); return }
      if (overIdx !== idx) setOverIdx(idx)
    },
    onDragLeave: () => {
      setOverIdx(i => (i === idx ? null : i))
      setForeignOver(i => (i === idx ? null : i))
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation() // never let the day-level zone double-handle it
      if (isForeign(e)) {
        const p = e.dataTransfer.getData('application/x-yf-stop')
        if (p) options?.onForeignDrop?.(p, idx)
      } else if (dragIdx !== null && dragIdx !== idx) onMove(dragIdx, idx)
      setDragIdx(null); setOverIdx(null); setForeignOver(null)
    },
    onDragEnd: () => { setDragIdx(null); setOverIdx(null); setForeignOver(null) },
  })

  /** Drop zone for gap/empty areas of the list — foreign drags only. */
  const dayDropHandlers = (idx: number) => ({
    'data-yf-gap': encodeDropKey(instId, idx),
    onDragOver: (e: React.DragEvent) => {
      if (!isForeign(e)) return
      e.preventDefault()
      if (foreignOver !== idx) setForeignOver(idx)
    },
    onDragLeave: () => setForeignOver(i => (i === idx ? null : i)),
    onDrop: (e: React.DragEvent) => {
      if (!isForeign(e)) return
      e.preventDefault()
      e.stopPropagation()
      const p = e.dataTransfer.getData('application/x-yf-stop')
      if (p) options?.onForeignDrop?.(p, idx)
      setForeignOver(null)
    },
  })

  return {
    dndHandlers,
    dayDropHandlers,
    dragging: dragIdx,
    over: overIdx,
    foreignOver,
    moveUp: (idx: number) => { if (idx > 0) onMove(idx, idx - 1) },
    moveDown: (idx: number) => { if (idx < items.length - 1) onMove(idx, idx + 1) },
  }
}

export function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onOutside])
  return ref
}

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="#0B2545" />
      <path d="M28 62 L44 34 L56 52 L64 40 L76 62 Z" fill="#149A90" />
      <circle cx="66" cy="30" r="7" fill="#F59E2D" />
    </svg>
  )
}
