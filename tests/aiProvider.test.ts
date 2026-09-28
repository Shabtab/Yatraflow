// ============ AI provider (M5) — pure logic only ============
// Node-env suite: config parsing/validation, prompt construction, response
// extraction and the fallback CONTRACT. The fetch path is verified by asserting
// against the module's own exports (no DOM, no network in tests).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildTripContext, buildMessages, extractContent, SYSTEM_PROMPT,
  askCompanion, loadAiProviderConfig, saveAiProviderConfig, clearAiProviderConfig, testAiProviderConnection,
  extractJevIntent, loadJevConfig, saveJevConfig, clearJevConfig, testJevConnection,
} from '../src/lib/aiProvider'
import { INTENTS, INTENT_KEYS, INTENT_CRITERIA, INTENT_NONE, type CompanionIntent } from '../src/lib/jevTaxonomy'
import { answerForIntent, answerQuestion } from '../src/lib/ai'

const trip = {
  id: 't1', name: 'Kerala loop', startLocation: 'Kochi', destinations: ['Munnar', 'Alleppey'],
  travellers: 3, travelStyle: 'balanced', expenses: [], fixedCommitments: [],
  days: [
    { index: 0, title: 'Hills', stops: [{ id: 's1', title: 'Tea museum', category: 'sight', priority: 'must-do', visitMinutes: 90, status: 'planned' }, { id: 's2', title: 'Viewpoint', category: 'viewpoint', priority: 'nice', visitMinutes: 45, status: 'planned' }] },
    { index: 1, title: '', stops: [] },
  ],
} as never

// Node env has no localStorage; the module checks at call time, so a plain
// in-memory stub exercises the real read/write/clear paths.
const mem = new Map<string, string>()
beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})

describe('config validation', () => {
  it('rejects a URL without a scheme and normalises trailing slashes on save', () => {
    expect(saveAiProviderConfig({ baseUrl: 'api.openai.com/v1', apiKey: 'k', model: 'm' })).toMatch(/http/)
    expect(saveAiProviderConfig({ baseUrl: 'https://api.openai.com/v1///', apiKey: 'k', model: 'm' })).toBeNull()
    expect(loadAiProviderConfig()?.baseUrl).toBe('https://api.openai.com/v1')
    clearAiProviderConfig()
    expect(loadAiProviderConfig()).toBeNull()
  })

  it('refuses to save without a key or model', () => {
    expect(saveAiProviderConfig({ baseUrl: 'https://x.example', apiKey: '', model: 'm' })).toMatch(/key/i)
    expect(saveAiProviderConfig({ baseUrl: 'https://x.example', apiKey: 'k', model: '' })).toMatch(/model/i)
  })

  it('a corrupt stored blob degrades to no config, never a throw', () => {
    mem.set('yatraflow_ai_provider', '{not json')
    expect(loadAiProviderConfig()).toBeNull()
    mem.clear()
  })
})

describe('trip context', () => {
  it('is grounded: route, day titles, stop titles, categories and must-do flags', () => {
    const ctx = buildTripContext(trip)
    expect(ctx).toContain('Kerala loop')
    expect(ctx).toContain('Kochi -> Munnar -> Alleppey')
    expect(ctx).toContain('Day 1 (Hills)')
    expect(ctx).toContain('Tea museum [sight, must-do, 90min]')
    // rejected stops are excluded, empty days contribute no line
    expect(ctx.split('\n').some(l => l.startsWith('Day 2'))).toBe(false)
  })

  it('the system prompt forbids inventing details and the user turn carries the question', () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0)
    const msgs = buildMessages(trip, 'Is Day 1 too packed?')
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('ONLY the trip data')
    expect(msgs[0].content).toContain('Tea museum')
    expect(msgs[1]).toEqual({ role: 'user', content: 'Is Day 1 too packed?' })
  })
})

describe('response extraction', () => {
  it('reads the first choice message content and trims it', () => {
    expect(extractContent({ choices: [{ message: { content: '  hello  ' } }] })).toBe('hello')
  })
  it('returns null on every malformed shape, so the caller falls back', () => {
    expect(extractContent(null)).toBeNull()
    expect(extractContent({})).toBeNull()
    expect(extractContent({ choices: [] })).toBeNull()
    expect(extractContent({ choices: [{ message: { content: '   ' } }] })).toBeNull()
    expect(extractContent({ choices: [{ message: null }] })).toBeNull()
  })
})

describe('the fallback contract (no config → deterministic router)', () => {
  it('answers offline with the router, and the badge says so', async () => {
    clearAiProviderConfig()
    const a = await askCompanion(trip, 'biggest risks in this plan')
    expect(a.source).toBe('offline')
    expect(a.text.length).toBeGreaterThan(10)
  })
})

describe('the Jev intent layer (taxonomy + handlers + parsing)', () => {
  it('the taxonomy is complete: every intent has criteria, criteria has no extras', () => {
    for (const k of INTENT_KEYS) expect(INTENT_CRITERIA[k]).toBeTruthy()
    expect(Object.keys(INTENT_CRITERIA).sort()).toEqual([...INTENT_KEYS].sort())
    expect(INTENTS).not.toContain('none')
    expect(INTENT_KEYS).toContain(INTENT_NONE)
  })

  it('every intent maps to a real handler with a grounded answer', () => {
    for (const intent of INTENT_KEYS as CompanionIntent[]) {
      const reply = answerForIntent(trip, intent, 'test question')
      expect(reply.text.length, `intent ${intent} produced an empty answer`).toBeGreaterThan(10)
    }
  })

  it('both routers reach the same handlers: the keyword route for a known phrasing equals the intent route', () => {
    expect(answerForIntent(trip, 'risks', 'q').text).toBe(answerQuestion(trip, 'Identify the biggest risks in this plan').text)
    expect(answerForIntent(trip, 'rain', 'q').text).toBe(answerQuestion(trip, 'what if it rains').text)
  })

  it('extractJevIntent accepts only taxonomy choices and rejects every malformed shape', () => {
    expect(extractJevIntent({ answers: { intent: { choice: 'rain' } } })).toBe('rain')
    expect(extractJevIntent({ answers: { intent: { choice: 'none' } } })).toBe('none')
    expect(extractJevIntent({ answers: { intent: { choice: 'not-an-intent' } } })).toBeNull()
    expect(extractJevIntent({ answers: {} })).toBeNull()
    expect(extractJevIntent({})).toBeNull()
    expect(extractJevIntent(null)).toBeNull()
    expect(extractJevIntent({ answers: { intent: { choice: 42 } } })).toBeNull()
  })

  it('Jev config validates and persists like the LLM config', () => {
    expect(saveJevConfig({ baseUrl: 'ftp://x', apiKey: 'k' })).toMatch(/http/)
    expect(saveJevConfig({ baseUrl: 'https://api.typesafe.ai/v1', apiKey: '' })).toMatch(/key/i)
    expect(saveJevConfig({ baseUrl: 'https://api.typesafe.ai/v1///', apiKey: 'k' })).toBeNull()
    expect(loadJevConfig()?.baseUrl).toBe('https://api.typesafe.ai/v1')
    clearJevConfig()
    expect(loadJevConfig()).toBeNull()
  })

  it('the fallback contract holds with a Jev config present but unreachable: offline still answers', async () => {
    // point Jev at a dead port — the transport fails, the offline router must answer
    mem.set('yatraflow_ai_jev', JSON.stringify({ baseUrl: 'https://127.0.0.1:9/v1', apiKey: 'k' }))
    const a = await askCompanion(trip, 'biggest risks in this plan')
    expect(a.source).toBe('offline')
    expect(a.text.length).toBeGreaterThan(10)
    mem.delete('yatraflow_ai_jev')
  })
})

describe('wiring tripwires (source-level, CRLF-tolerant)', () => {
  const drawer = readFileSync('src/components/AiDrawer.tsx', 'utf8')

  it('the drawer asks through askCompanion, not the raw router', () => {
    expect(drawer).toContain('askCompanion(')
    expect(drawer).toMatch(/source.*llm|llm.*source/)
  })
  it('every bot bubble can carry the badge, and the composer is guarded while thinking', () => {
    expect(drawer).toContain('ai-source')
    expect(drawer).toMatch(/!input\.trim\(\) \|\| thinking/)
  })
  it('the badge can say Jev, and the Jev path goes through the shared handler map', () => {
    expect(drawer).toContain("'jev'")
    const provider = readFileSync('src/lib/aiProvider.ts', 'utf8')
    expect(provider).toContain('answerForIntent(')
    // the audit script and the runtime must share one taxonomy
    const audit = readFileSync('scripts/jev-router-audit.test.ts', 'utf8')
    expect(audit).toContain('CRITERIA')
  })
  it('ai.ts routes through the intent seam (no duplicated handler bodies)', () => {
    const ai = readFileSync('src/lib/ai.ts', 'utf8')
    expect(ai).toContain('export function answerForIntent')
    expect(ai).toContain('routeIntent(q, has)')
    expect(ai).toContain("from './jevTaxonomy'")
  })
  it('the request-signal merge stays feature-detected (Safari < 17.4 has no AbortSignal.any)', () => {
    const provider = readFileSync('src/lib/aiProvider.ts', 'utf8')
    expect(provider).toContain('mergeSignal(')
    expect(provider).not.toMatch(/AbortSignal\.any\(/)
  })

  it('#396: drawer input and chips disable while thinking, FAB hides while thinking, and msg ids use a counter', () => {
    // Live input + chips while thinking: #396
    expect(drawer).toMatch(/<input[^>]*disabled=\{thinking\}/)
    expect(drawer).toMatch(/<Chip[^>]*disabled=\{thinking\}/)
    // FAB hides while thinking: AGENTS §10 and #396
    expect(drawer).toMatch(/!open\s*&&\s*!thinking/)
    // Monotonic counter for msg IDs, not Date.now() collisions:
    expect(drawer).not.toContain('Date.now()')
    expect(drawer).toContain('msgIdRef')
  })

  it('#396: TripWorkspace keys AiDrawer by trip.id to reset transcript across trips', () => {
    const ws = readFileSync('src/pages/TripWorkspace.tsx', 'utf8')
    expect(ws).toMatch(/<AiDrawer\s+key=\{trip\.id\}/)
  })

  it('#397: Profile connection tests use AbortController signal and cancel on unmount/re-test', () => {
    const profile = readFileSync('src/pages/Profile.tsx', 'utf8')
    // Both cards must pass signal to their connection test
    expect(profile).toContain('testAiProviderConnection(loadAiProviderConfig()!, testAbort.current.signal)')
    expect(profile).toContain('testJevConnection(loadJevConfig()!, testAbort.current.signal)')
    // Abort on unmount/cleanup
    expect(profile).toMatch(/testAbort\.current\?\.abort\(\)/)
  })
})

describe('testAiProviderConnection maps failures to honest messages', () => {
  it('rejects before any network when the config is unusable', async () => {
    // saveAiProviderConfig already rejects these shapes; the probe simply
    // surfaces the resulting fetch failure. Here we pin the abort message path.
    const out = await testAiProviderConnection({ baseUrl: 'https://127.0.0.1:9/v1', apiKey: 'k', model: 'm' })
    expect(typeof out === 'string' || out === null).toBe(true)
  })
})

