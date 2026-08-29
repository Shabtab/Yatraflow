// ============ Reusable UI components ============
import React, { useEffect, useId, useRef, useState } from 'react'
import { formatInr } from '../lib/engine'
import { registerTouchDnd, touchPressAbort, touchPressStart, encodeDropKey, isInteractiveTarget } from '../lib/touchDnd'

export function Avatar({ user, size = 'sm' }: { user?: { profile: { name: string; avatarUrl?: string } }; size?: 'sm' | 'lg' }) {
  const cls = `avatar ${size === 'lg' ? 'lg' : ''}`
  if (user?.profile.avatarUrl) return <img className={cls} src={user.profile.avatarUrl} alt={user.profile.name} />
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

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
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
    // focus the first sensible control so keyboard users can start typing immediately
    const t = setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, select')
        ?? dialogRef.current?.querySelector<HTMLElement>('button')
      el?.focus()
    }, 30)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      clearTimeout(t)
      previouslyFocused?.isConnected && previouslyFocused.focus()
    }
  }, [open, onClose])
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
    <Modal open={open} onClose={onClose} title={title}>
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

export function Field(props: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="field">
      <label className="label">{props.label}</label>
      {props.children}
      {props.hint && !props.error && <span className="hint-text">{props.hint}</span>}
      {props.error && <span className="err-text">{props.error}</span>}
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
