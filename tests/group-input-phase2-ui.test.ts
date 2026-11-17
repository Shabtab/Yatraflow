import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STOP_CATEGORIES, type CrewPreference, type TripDecision } from '../src/data/types'
import { summarizeCrewPreferences } from '../src/lib/crewPreferences'
import {
  CREW_QUIZ_INTERESTS, QUIZ_EXCLUDED_CATEGORIES, closingStamp, crewBars, localInputValue, sameInterests, dayOptionLabel, decisionDayLabel,
  joinNames, optionLabelRefusal, parseClosesAt, votingClosedLine,
} from '../src/lib/groupInputView'
import { canAddOption } from '../src/lib/decisionOptions'

// Phase 2 UI wiring for the Group input tab: pure view helpers plus source pins.
// Node env, no DOM. CRLF is turned into LF first.
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tab = read('src/pages/trip/GroupInputTab.tsx')
const own = read('src/styles/pages/group-input.css')

const NOW = Date.UTC(2026, 10, 17, 10, 0, 0)
const decision = (over: Partial<TripDecision> = {}): TripDecision => ({
  id: 'd1', tripId: 't1', question: 'Where?', raisedBy: 'u1', createdAt: NOW - 1000, status: 'open',
  options: [{ id: 'a', label: 'Beach' }, { id: 'b', label: 'Backwater' }, { id: 'c', label: 'Hills' }],
  votesByUserId: {}, comments: [], ...over,
} as TripDecision)

describe('the closing-time lock line', () => {
  it('names the leader', () => {
    const d = decision({ votesByUserId: { u1: 'a', u2: 'a', u3: 'b' } })
    expect(votingClosedLine(d)).toBe('Voting closed · Beach leads')
  })
  it('names every tied option', () => {
    expect(votingClosedLine(decision({ votesByUserId: { u1: 'a', u2: 'b' } }))).toBe('Voting closed · tie between Beach and Backwater')
    expect(votingClosedLine(decision({ votesByUserId: { u1: 'a', u2: 'b', u3: 'c' } }))).toBe('Voting closed · tie between Beach, Backwater and Hills')
  })
  it('says so when nobody voted', () => {
    expect(votingClosedLine(decision())).toBe('Voting closed · no votes')
  })
  it('joins names', () => {
    expect(joinNames(['A'])).toBe('A')
    expect(joinNames(['A', 'B'])).toBe('A and B')
  })
})

describe('the closing-time lock UI', () => {
  it('locks the radios and drops the Vote button once the closing time has passed', () => {
    expect(tab).toContain('const locked = open && isVoteClosed(d, now)')
    expect(tab).toMatch(/disabled=\{locked\} onChange=\{\(\) => setPick\(o\.id\)\}/)
    expect(tab).toMatch(/\{!locked && \(\s*<button type="button" className="btn btn-primary btn-sm" disabled=\{!pick \|\| pick === myOptionId\}/)
  })
  it('says who picks a tie, and keeps the resolve controls for editors', () => {
    expect(tab).toContain("outcome.kind === 'tie' ? '. An editor picks the winner.' : ''")
    expect(tab).toMatch(/\{editable && locked && \(\s*<div className="resolve-btns">/)
    expect(tab).toMatch(/\{editable && !locked && \(\s*<div className="resolve-btns">/)
  })
  it('resolves nothing on its own: resolveChoice( is only called from an onClick handler', () => {
    const calls = [...tab.matchAll(/resolveChoice\(/g)].map(m => m.index as number)
      .filter(i => !tab.slice(Math.max(0, i - 16), i).includes('function '))
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const i of calls) {
      const before = tab.slice(Math.max(0, i - 220), i)
      const handler = before.lastIndexOf('onClick={')
      expect(handler, 'a call outside an onClick handler').toBeGreaterThanOrEqual(0)
      expect(before.slice(handler)).not.toMatch(/useEffect|useMemo|useCallback/)
    }
  })
  it('useNow clears its interval on unmount', () => {
    const start = tab.indexOf('function useNow()')
    const body = tab.slice(start, tab.indexOf('\n}\n', start))
    expect(body).toContain('window.setInterval(')
    expect(body).toMatch(/return \(\) => window\.clearInterval\(timer\)/)
  })
  it('names the lock "Closed" in the eyebrow and keeps the verdict line', () => {
    expect(tab).toContain('{locked && <p className="gin-eyebrow">Closed</p>}')
    expect(tab).not.toContain('<p className="gin-eyebrow">Voting closed</p>')
    expect(tab).toContain('{votingClosedLine(d)}')
  })
  it('a closed decision no longer needs my vote', () => {
    expect(tab).toMatch(/d\.status === 'open' && !isVoteClosed\(d, now\) && !d\.votesByUserId\[me\.id\]/)
  })
  it('shows the closing time in the eyebrow, with or without my vote, and the day in the sub-line', () => {
    expect(tab).toContain("Needs your vote{hasClosingTime(d) ? ` · closes ${closingStamp(d.closesAt as number, timeFormat, now)} · in ${formatSpan((d.closesAt as number) - now)}` : ''}")
    expect(tab).toContain('Open · closes {closingStamp(d.closesAt as number, timeFormat, now)} · in {formatSpan((d.closesAt as number) - now)}')
    expect(tab).toContain('Raised by {raiser}{dayLabel ? ` · ${dayLabel}` : \'\'} · {voterCount} of {memberCount} voted')
  })
  it('leaves a server refusal to the shared report path', () => {
    expect(tab).toMatch(/void voteOnDecision\(d\.id, pick\)\.then\(o => reportCollabOutcome\(o\)\)/)
  })
})

describe('the closing stamp', () => {
  const at = new Date(2026, 10, 19, 20, 5).getTime() // Thu 19 Nov 2026, local
  const now = new Date(2026, 10, 17, 10, 0).getTime()
  it('shows weekday and time in the reader clock', () => {
    expect(closingStamp(at, '24h', now)).toBe('Thu 20:05')
    expect(closingStamp(at, '12h', now)).toBe('Thu 8:05 PM')
  })
  it('names the date when the time is a week away', () => {
    expect(closingStamp(at, '24h', at - 7 * 86_400_000)).toMatch(/^Thu 19 Nov 20:05$/)
  })
  it('writes a local datetime-local value', () => {
    expect(localInputValue(at)).toBe('2026-11-19T20:05')
  })
})

describe('the composer fields', () => {
  it('reads a local date and time, and refuses a time that is not in the future', () => {
    expect(parseClosesAt('', NOW)).toEqual({ ok: true })
    expect(parseClosesAt('not a date', NOW)).toEqual({ ok: false, reason: 'invalid' })
    expect(parseClosesAt('2020-01-01T10:00', NOW)).toEqual({ ok: false, reason: 'past' })
    const ok = parseClosesAt('2099-01-01T10:00', NOW)
    expect(ok.ok && typeof ok.closesAt === 'number').toBe(true)
  })
  it('sets a min of now on Closes, and moves focus to it on a refused time', () => {
    expect(tab).toContain('min={minCloses}')
    expect(tab).toMatch(/closesRef\.current\?\.focus\(\)\n\s+return/)
    expect(tab).toContain('<input ref={closesRef} className="input" type="datetime-local"')
  })
  it('wires Closes and Day into addDecision with the shared Field', () => {
    expect(tab).toContain('<Field label="Closes (optional)"')
    expect(tab).toContain('type="datetime-local"')
    expect(tab).toContain('<Field label="Day (optional)">')
    expect(tab).toContain('...(closing.closesAt !== undefined ? { closesAt: closing.closesAt } : {}),')
    expect(tab).toContain('...(dayId ? { dayId } : {}),')
  })
  it('labels days as Day n · title and ignores a day that left the trip', () => {
    const days = [{ id: 'x', index: 1, title: 'Munnar' }, { id: 'y', index: 2 }]
    expect(dayOptionLabel(days[0])).toBe('Day 2 · Munnar')
    expect(dayOptionLabel(days[1])).toBe('Day 3')
    expect(decisionDayLabel(days, 'x')).toBe('Day 2 · Munnar')
    expect(decisionDayLabel(days, 'gone')).toBeNull()
    expect(decisionDayLabel(days, undefined)).toBeNull()
  })
})

describe('add option visibility', () => {
  const future = NOW + 3_600_000
  it('shows only on an open decision before its closing time, to editors', () => {
    expect(canAddOption({ status: 'open', closesAt: future, options: decision().options }, NOW)).toBe(true)
    expect(canAddOption({ status: 'open', options: decision().options }, NOW)).toBe(true)
    expect(canAddOption({ status: 'open', closesAt: NOW - 1, options: decision().options }, NOW)).toBe(false)
    expect(canAddOption({ status: 'resolved', options: decision().options }, NOW)).toBe(false)
    expect(tab).toContain('{editable && canAddOption(d, now) && (')
    // The field opens and closes with the day collapse, which takes the same gate.
    expect(tab).toContain('<SmoothCollapse open={addingOption && editable && canAddOption(d, now)} fallbackFocus={addTriggerRef} onExpanded={focusOptionField}>')
  })
  it('checks a duplicate on the client, then submits through the store with a busy claim', () => {
    expect(tab).toContain('checkNewOptionLabel(d.options, optionLabel)')
    expect(tab).toMatch(/void addDecisionOption\(d\.id, \{ label: checked\.label \}\)/)
    expect(tab).toContain('optionClaim.claim()')
    expect(optionLabelRefusal('duplicate')).toBe('This decision already has that option.')
  })
  it('returns focus to the trigger after a good add, and names the question on both buttons', () => {
    expect(tab).toContain('<button ref={addTriggerRef}')
    expect(tab).toMatch(/setAddingOption\(false\)\n\s+if \(stranded\) addTriggerRef\.current\?\.focus\(\)/)
    expect(tab.match(/aria-label=\{`Add option to \$\{d\.question\}`\}/g)).toHaveLength(2)
    expect(tab).toContain("aria-label={`Add option to ${q.trim() || 'this decision'}`}")
  })
})

describe('the crew preferences card', () => {
  it('reads on mount and keeps failed, loading and empty apart', () => {
    expect(tab).toMatch(/useEffect\(\(\) => \{ void loadCrewPreferences\(trip\.id\) \}, \[trip\.id\]\)/)
    expect(tab).toContain('const read = sliceState(reads, trip.id)')
    expect(tab).toMatch(/read === 'failed' && hasRows && \(\s*<StateBlock kind="kept"/)
    expect(tab).toMatch(/read === 'failed' && !hasRows && \(\s*<StateBlock kind="failed"/)
    expect(tab).toMatch(/read === 'reading' && !hasRows && \(\s*<StateBlock kind="loading"/)
    expect(tab).toMatch(/read === 'ready' && !hasRows && \(\s*<StateBlock kind="empty"/)
  })
  it('keeps the helper line free of the engine claim', () => {
    expect(tab).toContain('From each person’s answers.')
    expect(tab).not.toMatch(/leans toward/)
  })
  it('shows the quiz only after a good read, open until I answer and folded after', () => {
    expect(tab).toContain("read === 'ready' && isMember && (")
    expect(tab).toContain('const quizOpen = !mine || editing || pending')
    expect(tab).toContain('Edit your answers')
  })
  it('lists only interests with a pick, high to low, from the answered members', () => {
    const rows: CrewPreference[] = [
      { tripId: 't1', userId: 'u1', interests: ['food', 'beach'], updatedAt: 1 },
      { tripId: 't1', userId: 'u2', interests: ['food'], updatedAt: 1 },
      { tripId: 't1', userId: 'u3', interests: [], updatedAt: 1 },
    ]
    const summary = summarizeCrewPreferences(rows, { tripId: 't1', memberIds: ['u1', 'u2', 'u3', 'u4'] })
    expect(summary.answered).toBe(3)
    const bars = crewBars(summary)
    expect(bars.map(b => b.interest)).toEqual(['food', 'beach'])
    expect(bars.map(b => b.percent)).toEqual([67, 33])
    expect(crewBars(summarizeCrewPreferences([], { tripId: 't1' }))).toEqual([])
  })
  it('reads the answers through the summary with the current member ids', () => {
    expect(tab).toContain('summarizeCrewPreferences(rows, { tripId: trip.id, memberIds })')
    expect(tab).toContain('{summary.answered} of {memberIds.length} answered')
  })
  it('uses the vote-bar fill, with the reduced-motion mirror already on it', () => {
    expect(tab).toContain('<ShareBar percent={b.percent} lead />')
    expect(own).toMatch(/\.gin-fill \{ transition: none; \}/)
  })
  it('sits in the activity column', () => {
    const activity = tab.slice(tab.indexOf('id="gi-section-activity"'), tab.indexOf('// ================= Crew preferences card'))
    expect(activity).toContain('<CrewPreferencesCard trip={trip} meId={me.id} />')
  })
})

describe('the crew quiz', () => {
  it('leaves out the logistics categories and keeps the rest in order', () => {
    expect([...QUIZ_EXCLUDED_CATEGORIES].sort()).toEqual(['event', 'hotel', 'transport-hub', 'travel'])
    for (const c of QUIZ_EXCLUDED_CATEGORIES) expect(CREW_QUIZ_INTERESTS).not.toContain(c)
    expect(CREW_QUIZ_INTERESTS).toEqual(['sightseeing', 'food', 'nature', 'beach', 'temple', 'adventure', 'shopping', 'museum', 'rest'])
    for (const c of CREW_QUIZ_INTERESTS) expect(STOP_CATEGORIES).toContain(c)
  })
  it('renders pressed chips from the quiz list and saves through the store', () => {
    expect(tab).toContain('{CREW_QUIZ_INTERESTS.map(interest => (')
    expect(tab).toContain('<FilterChip key={interest} pressed={picked.includes(interest)}')
    expect(tab).toContain('function save(list: CrewInterest[] = picked)')
    expect(tab).toMatch(/void setMyCrewPreferences\(trip\.id, list\)\.then\(o => \{\s*reportCollabOutcome\(o, 'Your answers are saved'\)/)
    expect(tab).toContain('const picked = draft ?? mine?.interests ?? []')
  })
  it('moves focus: first chip on Edit, the Edit button (or heading) after Save or Cancel', () => {
    expect(tab).toContain('onClick={() => { setEditing(true); setFocusChip(true) }}')
    expect(tab).toContain("querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })")
    expect(tab).toContain('(editBtnRef.current ?? headingRef.current)?.focus()')
    expect(tab).toContain('setEditing(false); setRestoreFocus(true) }')
    expect(tab).toContain('onClick={() => { setDraft(null); setEditing(false); setRestoreFocus(true) }}')
  })
  it('enables Save only for a change, and offers None of these to a first-time answer', () => {
    expect(sameInterests(['food', 'beach'], ['beach', 'food'])).toBe(true)
    expect(sameInterests(['food'], ['food', 'beach'])).toBe(false)
    expect(tab).toContain('const dirty = mine ? !sameInterests(picked, mine.interests) : picked.length > 0')
    expect(tab).toContain('disabled={pending || !dirty}')
    expect(tab).toMatch(/\{!mine && \(\s*<button type="button" className="gin-text-btn" disabled=\{pending\} onClick=\{\(\) => save\(\[\]\)\}>None of these/)
  })
  it('lets any trip member answer, viewers included', () => {
    const card = tab.slice(tab.indexOf('function CrewPreferencesCard'), tab.indexOf('function ShareBar'))
    expect(card).not.toMatch(/editable/)
    expect(card).toContain('memberIds.includes(meId)')
  })
})
