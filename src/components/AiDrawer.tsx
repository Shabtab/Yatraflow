// ============ AI travel companion drawer ============
import React, { useEffect, useRef, useState } from 'react'
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
    text: `Hi! I'm your YatraFlow companion. I can see “${trip.name}” — ${trip.days.length} days, ${trip.destinations.join(' → ')}. Ask me to lighten a day, check timings against a fixed commitment, find savings or plan for rain.`,
  }])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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
      {!open && (
        <button className="ai-fab" onClick={onOpen} aria-label="Open AI travel companion">✨</button>
      )}
      <div className="ai-drawer" style={{ display: open ? 'flex' : 'none' }} role="dialog" aria-label="AI travel companion">
        <div className="ai-head">
          <span style={{ fontSize: 20 }}>✨</span>
          <div>
            <b style={{ fontFamily: 'var(--font-display)' }}>YatraFlow Companion</b>
            <div className="small muted">Grounded in this trip's data · estimates only</div>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close assistant">✕</button>
        </div>

        <div className="ai-msgs" ref={scrollRef} role="log" aria-live="polite">
          {msgs.map(m => (
            <div key={m.id} className={`ai-bubble ${m.role}`}>
              {m.text}
              {m.assumptions && <div className="ai-assumption">📋 {m.assumptions}</div>}
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
            className="input"
            placeholder="Ask about this trip…"
            aria-label="Ask the travel companion"
            value={input}
            onChange={e => setInput(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={!input.trim() || thinking}>Send</button>
        </form>
      </div>
    </>
  )
}
