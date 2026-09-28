// ============ AI travel companion drawer ============
import React, { useEffect, useRef, useState } from 'react'
import { InlineIcon } from './icons'
import { ClipboardList, Sparkles, X } from 'lucide-react'
import type { Trip } from '../data/types'
import { quickPrompts } from '../lib/ai'
import { askCompanion, type CompanionSource } from '../lib/aiProvider'
import { scrollBehavior } from '../lib/motion'
import { Chip } from './ui'
interface Msg {
  id: number
  role: 'user' | 'bot'
  text: string
  assumptions?: string
  /** Which brain answered — shown as a badge so the user is never misled. */
  source?: CompanionSource
}

export function AiDrawer({ trip, open, onOpen, onClose }: { trip: Trip; open: boolean; onOpen: () => void; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([{
    id: 1, role: 'bot',
    text: `Hi! I’m your YatraFlow companion. I can see “${trip.name}” — ${trip.days.length} days, ${trip.destinations.join(' → ')}. Ask me to lighten a day, check timings against a fixed commitment, find savings or plan for rain.`,
  }])
  const msgIdRef = useRef(1)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The parent hands us a fresh onClose on every render. Reading it through a
  // ref keeps it out of the effect's deps, so the contract below is armed once
  // per open instead of torn down and re-armed on every parent render — which
  // used to yank focus back to the composer 300ms after the user tabbed to a
  // quick-prompt chip (same latest-callback idiom as useReorder in ui.tsx).
  const onCloseRef = useRef(onClose)
  /** handle of the pending simulated reply, so it can be cancelled */
  const replyTimer = useRef(0)
  /** aborts an in-flight LLM request when the drawer unmounts */
  const askAbort = useRef<AbortController | null>(null)
  useEffect(() => { onCloseRef.current = onClose })

  // The drawer behaves as a dialog (fixed full-height panel), so it gets the
  // dialog contract: focus moves in on open, Tab cycles inside, Escape closes,
  // and focus returns to whatever triggered it (UI audit finding).
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 300)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const root = drawerRef.current
      if (!root) return
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'),
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey, true)
    // aria-modal tells assistive tech the rest of the page is inert, so the page
    // behind must not stay scrollable — same lock (and restore) as Modal in ui.tsx.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.clearTimeout(focusTimer)
      document.body.style.overflow = prevOverflow
      if (prev?.isConnected) prev.focus()
    }
  }, [open])

  // Unmount only — closing must NOT cancel an in-flight reply, or the answer
  // the user asked for is lost; it lands in the transcript to be seen on reopen.
  useEffect(() => () => {
    window.clearTimeout(replyTimer.current)
    askAbort.current?.abort()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: scrollBehavior() })
  }, [msgs, thinking, open])

  function ask(q: string) {
    if (!q.trim() || thinking) return
    const userMsgId = ++msgIdRef.current
    setMsgs(m => [...m, { id: userMsgId, role: 'user', text: q }])
    setInput('')
    setThinking(true)
    // A short minimum-latency so an instant offline answer still feels like an
    // assistant, not a form post; the LLM path takes as long as it takes.
    replyTimer.current = window.setTimeout(() => {
      askAbort.current = new AbortController()
      askCompanion(trip, q, askAbort.current.signal)
        .then(reply => {
          setMsgs(m => [...m, { id: ++msgIdRef.current, role: 'bot', text: reply.text, assumptions: reply.assumptions, source: reply.source }])
        })
        .catch(() => {
          // askCompanion already falls back internally; this only guards an
          // unexpected rejection so the composer can never stay disabled.
          setMsgs(m => [...m, { id: ++msgIdRef.current, role: 'bot', text: 'Something went wrong analysing the plan. Try rephrasing that.', source: 'offline' }])
        })
        .finally(() => setThinking(false))
    }, 250)
  }

  return (
    <>
      {!open && !thinking && (
        <button className="ai-fab" onClick={onOpen} aria-label="Open AI travel companion"><Sparkles size={20} aria-hidden /></button>
      )}
      <div ref={drawerRef} className={`ai-drawer ${open ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label="AI travel companion">
        <div className="ai-head">
          <span className="ai-head-icon"><Sparkles size={19} aria-hidden /></span>
          <div>
            <b>YatraFlow Companion</b>
            <div className="ai-head-sub">Grounded in this trip’s data · estimates only</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close assistant"><X size={16} aria-hidden /></button>
        </div>

        <div className="ai-msgs" ref={scrollRef} role="log" aria-live="polite">
          {msgs.map(m => (
            <div key={m.id} className={`ai-bubble ${m.role}`}>
              {/* Who is speaking is otherwise carried by colour + alignment alone,
                  which is invisible in a linearised transcript. */}
              <span className="sr-only">{m.role === 'user' ? 'You: ' : 'Companion: '}</span>
              {m.text}
              {m.source && (
                <span className={`ai-source ${m.source === 'llm' ? 'llm' : m.source === 'jev' ? 'jev' : 'off'}`}>
                  {m.source === 'llm' ? 'LLM' : m.source === 'jev' ? 'Jev' : 'offline'}
                </span>
              )}
              {m.assumptions && <div className="ai-assumption"><InlineIcon icon={ClipboardList} size={12} gap={3} />{m.assumptions}</div>}
            </div>
          ))}
          {thinking && (
            <div className="ai-bubble bot"><span className="sr-only">Companion is thinking…</span><span className="typing-dots"><span /><span /><span /></span></div>
          )}
        </div>

        <div className="ai-quick">
          <div className="ai-quick-scroll">
            {quickPrompts().map(p => (
              <Chip key={p} disabled={thinking} onClick={() => ask(p)}>{p}</Chip>
            ))}
          </div>
        </div>

        <form className="ai-input-row" onSubmit={e => { e.preventDefault(); ask(input) }}>
          <input
            ref={inputRef}
            className="input"
            placeholder="Ask about this trip…"
            aria-label="Ask the travel companion"
            value={input}
            disabled={thinking}
            onChange={e => setInput(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={!input.trim() || thinking}>Send</button>
        </form>
      </div>
    </>
  )
}
