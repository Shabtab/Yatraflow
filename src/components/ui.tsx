// ============ Reusable UI components ============
import React, { useEffect, useRef, useState } from 'react'
import { formatInr } from '../lib/engine'

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

/** Accessible move up/down controls + HTML5 drag-and-drop wrapper for stop cards. */
export function useReorder<T extends { id: string }>(
  items: T[],
  onMove: (fromIdx: number, toIdx: number) => void,
) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  const dndHandlers = (idx: number) => ({
    draggable: true,
    onDragStart: () => setDragIdx(idx),
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (overIdx !== idx) setOverIdx(idx) },
    onDragLeave: () => setOverIdx(i => (i === idx ? null : i)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      if (dragIdx !== null && dragIdx !== idx) onMove(dragIdx, idx)
      setDragIdx(null); setOverIdx(null)
    },
    onDragEnd: () => { setDragIdx(null); setOverIdx(null) },
  })

  return {
    dndHandlers,
    dragging: dragIdx,
    over: overIdx,
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
