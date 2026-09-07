// ============ AI travel companion drawer ============
import React, { useEffect, useRef, useState } from 'react'
import { ClipboardList, Sparkles, X } from 'lucide-react'
import type { Trip } from '../data/types'
import { answerQuestion, quickPrompts, type AiReply } from '../lib/ai'
import { scrollBehavior } from '../lib/motion'
import { Chip } from './ui'
interface Msg {
  id: number
  role: 'user' | 'bot'
  text: string
  assumptions?: string
}

export function AiDrawer({ trip, open, onOpen, onClose }: { trip: Trip; open: boolean; onOpen: () => void; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([{
    id: 1, role: 'bot',
    text: `Hi! I’m your YatraFlow companion. I can see “${trip.name}” — ${trip.days.length} days, ${trip.destinations.join(' → ')}. Ask me to lighten a day, check timings against a fixed commitment, find savings or plan for rain.`,
  }])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The drawer behaves as a dialog (fixed full-height panel), so it gets the
  // dialog contract: focus moves in on open, Tab cycles inside, Escape closes,
  // and focus returns to whatever triggered it (UI audit finding).
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 300)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab') return
      const root = drawerRef.current
      if (!root) return
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (prev?.isConnected) prev.focus()
    }
  }, [open, onClose, inputRef])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: scrollBehavior() })
  }, [msgs, thinking])

  function ask(q: string) {
    if (!q.trim() || thinking) return
    setMsgs(m => [...m, { id: Date.now(), role: 'user', text: q }])
    setInput('')
    setThinking(true)
    // Simulated reasoning latency so the interaction feels like an assistant,
    // while every answer stays grounded in the actual trip data.
    setTimeout(() => {
      let reply: AiReply
      try {
        reply = answerQuestion(trip, q)
      } catch (err) {
        reply = { text: 'Something went wrong analysing the plan. Try rephrasing that.' }
      }
      setMsgs(m => [...m, { id: Date.now() + 1, role: 'bot', text: reply.text, assumptions: reply.assumptions }])
      setThinking(false)
    }, 650)
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
              {m.text}
              {m.assumptions && <div className="ai-assumption"><ClipboardList size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{m.assumptions}</div>}
            </div>
          ))}
          {thinking && (
            <div className="ai-bubble bot"><span className="typing-dots"><span /><span /><span /></span></div>
          )}
        </div>

        <div className="ai-quick">
          <div className="ai-quick-scroll">
            {quickPrompts().map(p => (
              <Chip key={p} onClick={() => ask(p)}>{p}</Chip>
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
            onChange={e => setInput(e.target.value)}
            disabled={thinking}
          />
          <button className="btn btn-primary" type="submit" disabled={!input.trim() || thinking}>Send</button>
        </form>
      </div>
    </>
  )
}
