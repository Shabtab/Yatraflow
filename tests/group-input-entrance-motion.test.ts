import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-reading gate for the Group input tab's motion (src/styles/pages/group-input.css
// and src/pages/trip/GroupInputTab.tsx). It mirrors the Budget pins: the cascade is owned
// by the tab body, every rule is at the top level, every time value is a token, and one
// reduced-motion block turns each new animation off. The tab also plays a list exit and
// opens its panels with the day collapse. This file reads text and renders nothing.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const CSS = read('src/styles/pages/group-input.css')
const TAB = read('src/pages/trip/GroupInputTab.tsx')
const DAY = read('src/pages/trip/timeline/DaySection.tsx')
const MARK = '/* ---------- Entrance: one cascade, owned by the tab body ----------'

type Block = { selector: string; body: string; depth: number }

function blocks(css: string): Block[] {
  const out: Block[] = []
  const stack: { start: number; selector: string; depth: number }[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      const selector = css.slice(last, i).replace(/\/\*[\s\S]*?\*\//g, '').trim()
      stack.push({ start: i + 1, selector, depth })
      depth++
      last = i + 1
    } else if (ch === '}') {
      depth--
      const open = stack.pop()
      if (open) out.push({ selector: open.selector, body: css.slice(open.start, i), depth: open.depth })
      last = i + 1
    } else if (ch === ';') {
      last = i + 1
    }
  }
  return out
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const top = blocks(stripComments(CSS)).filter((b) => b.depth === 0)
const ruleOf = (selector: string) => top.find((b) => b.selector.replace(/\s+/g, ' ') === selector)

describe('Group input entrance: one cascade, owned by the tab body', () => {
  it('puts the entrance block after the base rules and ahead of the reduced-motion block', () => {
    const at = CSS.indexOf(MARK)
    expect(at).toBeGreaterThan(CSS.indexOf('.gin-quiz-chips'))
    expect(at).toBeLessThan(CSS.indexOf('@media (prefers-reduced-motion: reduce)'))
  })

  it('takes the tab panel block fade off this tab only', () => {
    expect(stripComments(CSS)).toMatch(/div\[role="tabpanel"\]:has\(> \.gin-page\)\s*\{\s*animation:\s*none;?\s*\}/)
  })

  it('gives the root and its wrappers no fade, so nothing fades twice', () => {
    expect(ruleOf('.gin-page > *')?.body).toMatch(/animation:\s*none/)
    for (const wrapper of ['.gin-head', '.gin-grid', '.gin-col']) {
      const own = top.find((b) => b.selector === wrapper)
      expect(own?.body ?? '', wrapper).not.toMatch(/animation/)
    }
  })

  it('keeps the state banners on errIn, outside the cascade', () => {
    const banner = ruleOf('.gin-state > [data-kind]')
    expect(banner?.body).toMatch(/animation:\s*errIn var\(--motion-med\) var\(--ease-paper\)/)
    expect(banner?.body).not.toMatch(/pageRise/)
    expect(TAB).toMatch(/<div className="gin-state">\s*\{items\.length > 0 && listFailed && \(/)
  })

  it('rises the header on beat 0 and the pill bar on beat 1, on the page-rise tokens', () => {
    expect(ruleOf('.gin-head > *')?.body).toMatch(/animation:\s*pageRise var\(--motion-slow\) var\(--ease-paper\) backwards/)
    expect(ruleOf('.gin-head > .gin-pillbar')?.body).toMatch(/animation-delay:\s*calc\(var\(--stagger-step\) \* 1\)/)
  })

  it('orders the cards: column 1, then column 2, then column 3, one beat each', () => {
    // Each card writes its beat as an offset from the start of its column.
    const beat = (selector: string) => {
      const m = ruleOf(selector)?.body.match(/--gin-beat:\s*calc\(var\(--col-beat, (\d+)\) \+ (\d+)\)/)
      return { fallback: Number(m?.[1]), offset: Number(m?.[2]) }
    }
    const rules = [
      beat('.gin-col--decisions > .yf-surface:nth-of-type(1)'),
      beat('.gin-col--decisions > .yf-surface:nth-of-type(2)'),
      beat('.gin-col--decisions > .yf-surface:nth-of-type(n+3)'),
      beat('.gin-col--ideas > .yf-surface:nth-of-type(1)'),
      beat('.gin-col--ideas > .yf-surface:nth-of-type(2)'),
      beat('.gin-col--activity > .yf-surface:nth-of-type(1)'),
      beat('.gin-col--activity > .yf-surface:nth-of-type(2)'),
    ]
    expect(rules.map(r => r.offset)).toEqual([0, 1, 2, 0, 1, 0, 1])
    // Without a value from the tab, the beats are the full order: 2, 3, 4, 5, 6, 7, 8.
    expect(rules.map(r => r.fallback + r.offset)).toEqual([2, 3, 4, 5, 6, 7, 8])
    // Beat 0 is the header and beat 1 the bar, so the cards start at 2 and never meet them.
    expect(Math.min(...rules.map(r => r.fallback + r.offset))).toBeGreaterThan(1)
  })

  it('starts each column on the beat after the cards before it, so an empty column leaves no gap', () => {
    expect(TAB).toContain('const decisionBeats = Math.min(sortedDecisions.length, 3)')
    expect(TAB).toContain('const ideasBeat = 2 + decisionBeats')
    expect(TAB).toContain('const activityBeat = ideasBeat + 2')
    expect(TAB).toContain("const beatOf = (beat: number) => ({ '--col-beat': beat }) as CSSProperties")
    expect(TAB).toContain('style={beatOf(2)} className={colClass(\'decisions\')}')
    expect(TAB).toContain('style={beatOf(ideasBeat)} className={colClass(\'ideas\')}')
    expect(TAB).toContain('style={beatOf(activityBeat)} className={colClass(\'activity\')}')
  })

  it('rises each card on the page-rise tokens and caps the later decision cards on one beat', () => {
    expect(ruleOf('.gin-col > .yf-surface')?.body).toMatch(/animation:\s*pageRise var\(--motion-slow\) var\(--ease-paper\) backwards/)
    expect(ruleOf('.gin-col--decisions > .yf-surface:nth-of-type(n+3)')).toBeDefined()
  })

  it('waits for the intro before it delays, and never delays a leaving card', () => {
    const rule = ruleOf(".gin-page[data-intro='true'] .gin-col > .yf-surface:not([data-presence='exit'])")
    expect(rule?.body).toMatch(/animation-delay:\s*calc\(var\(--stagger-step\) \* var\(--gin-beat, 0\)\)/)
    expect(TAB).toContain("data-intro={intro ? 'true' : undefined}")
    expect(TAB).toContain("window.setTimeout(() => setIntro(false), motionTiming('--motion-slower').duration * 3)")
  })

  it('starts the intro window when the list read first settles, not at mount', () => {
    expect(TAB).toContain('const listSettled = listReady || listFailed')
    expect(TAB).toMatch(/useEffect\(\(\) => \{\s*if \(!listSettled\) return\s*const timer = window\.setTimeout\(\(\) => setIntro\(false\)[^\n]*\n[^\n]*clearTimeout\(timer\)\s*\}, \[listSettled\]\)/)
    // No timer sits in an effect with an empty dependency list.
    expect(TAB).not.toMatch(/setIntro\(false\)[\s\S]{0,160}\}, \[\]\)/)
  })

  it('trails the rows from their card: idea rows and activity rows, capped on the fourth step', () => {
    expect(ruleOf('.gin-rows > .gin-row')?.body).toMatch(/animation:\s*pageRise var\(--motion-slow\) var\(--ease-paper\) backwards/)
    expect(ruleOf('.gin-feed > .feed-item')?.body).toMatch(/animation:\s*pageRise var\(--motion-slow\) var\(--ease-paper\) backwards/)
    const steps = top.filter((b) => /--gin-k:\s*\d/.test(b.body) && b.selector.includes('.gin-rows > .gin-row:nth-child('))
    expect(steps.map((b) => b.body.match(/--gin-k:\s*(\d)/)?.[1])).toEqual(['1', '2', '3', '4'])
    expect(steps[3].selector).toContain(':nth-child(n+4)')
    const delay = top.find((b) => b.selector.includes(".gin-page[data-intro='true'] .gin-rows > .gin-row[data-presence='live']"))
    expect(delay?.body).toMatch(/animation-delay:\s*calc\(var\(--stagger-step\) \* \(var\(--gin-beat, 0\) \+ var\(--gin-k, 0\)\)\)/)
  })

  it('writes every entrance rule at the top level, not inside a media query', () => {
    const code = stripComments(CSS.slice(CSS.indexOf(MARK)))
    const inside = blocks(code).filter((b) => b.depth > 0 && /pageRise|errIn|gin-grow-x|gin-pop-in/.test(b.body)).map((b) => b.selector)
    // The only media block in the section is the reduced-motion opt-out, and it carries `animation: none`.
    for (const b of blocks(code).filter((x) => x.depth > 0)) expect(b.body, b.selector).not.toMatch(/animation:\s*(?!none)\S/)
    expect(inside.filter((s) => !/^@keyframes/.test(s))).toEqual([])
  })
})

describe('Group input chart entrance: the bars grow from the zero edge', () => {
  it('grows both bar kinds on scaleX from the left, on the slower step', () => {
    const grow = ruleOf('.gin-option .gin-fill, .gin-crew-row .gin-fill')
    expect(grow?.body).toMatch(/transform-origin:\s*left center/)
    expect(grow?.body).toMatch(/animation:\s*gin-grow-x var\(--motion-slower\) var\(--ease-paper\) backwards/)
    expect(CSS).toMatch(/@keyframes gin-grow-x \{ from \{ transform: scaleX\(0\); \} to \{ transform: none; \} \}/)
  })

  it('keeps the width transition for a later vote, because the pinned fill rule is unchanged', () => {
    expect(ruleOf('.gin-fill')?.body).toContain('transition: width var(--motion-med) var(--ease-paper)')
    expect(ruleOf('.gin-fill')?.body).not.toMatch(/animation/)
  })

  it('staggers each bar one step after its row, and holds the intro delay behind data-intro', () => {
    const bar = top.find((b) => b.selector.includes(".gin-page[data-intro='true'] .gin-option .gin-fill"))
    expect(bar?.body).toMatch(/animation-delay:\s*calc\(var\(--stagger-step\) \* \(var\(--gin-beat, 0\) \+ var\(--gin-k, 0\)\)\)/)
    const options = top.filter((b) => /--gin-k:\s*\d/.test(b.body) && b.selector.includes('.gin-option:nth-child('))
    expect(options).toHaveLength(4)
  })

  it('fades each percentage label in after its bar', () => {
    const label = ruleOf('.gin-option-end .gin-option-pct, .gin-crew-row .gin-option-pct')
    expect(label?.body).toMatch(/animation:\s*fadeIn var\(--motion-med\) var\(--ease-paper\) backwards/)
    expect(label?.body).toMatch(/animation-delay:\s*var\(--motion-slower\)/)
    const intro = top.find((b) => b.selector.includes(".gin-page[data-intro='true'] .gin-option-end .gin-option-pct"))
    expect(intro?.body).toMatch(/\+ var\(--motion-slower\)\)/)
  })

  it('pauses the bars and the labels while they are off screen or the tab is hidden', () => {
    const paused = ruleOf("[data-motion-paused='true'] .gin-fill, [data-motion-paused='true'] .gin-option-pct")
    expect(paused?.body).toMatch(/animation-play-state:\s*paused/)
    expect(TAB).toMatch(/import \{[^}]*\buseInView\b[^}]*\busePageVisible\b[^}]*\} from '\.\.\/\.\.\/components\/ui'/)
    expect(TAB).toContain('const optionsInView = useInView(optionsRef)')
    expect(TAB).toContain('data-motion-paused={!pageVisible || !optionsInView}')
    // The crew list owns its own observer, so it reads a real element once it mounts.
    expect(TAB).toContain('<ul ref={listRef} className="gin-crew-list" data-motion-paused={!visible || !inView}>')
    expect(TAB).toContain('<CrewBarList bars={bars} />')
  })
})

describe('Group input small pops', () => {
  it('pops the Needs your vote chip and the Best fit chip on the settle ease, under 48px', () => {
    expect(ruleOf('.gin-pop')?.body).toMatch(/animation:\s*gin-pop-in var\(--motion-fast\) var\(--ease-settle\) backwards/)
    expect(CSS).toMatch(/@keyframes gin-pop-in \{ from \{ opacity: 0; transform: scale\(0\.4\); \} to \{ opacity: 1; transform: none; \} \}/)
    expect(TAB).toContain('<span className="gin-pop"><Chip tone="saffron">Needs your vote</Chip></span>')
    expect(TAB).toContain('<span className="gin-pop"><Chip tone="teal">Best fit · engine</Chip></span>')
  })

  it('keeps the Chosen stamp and plays it for a resolve that this tab made', () => {
    expect(ruleOf('.gin-stamp')?.body).toMatch(/animation:\s*gin-stamp-in var\(--motion-med\) var\(--ease-settle\) both/)
    expect(TAB).toContain('onStamp(d.id)')
    expect(TAB).toContain('stamped={stampedIds.has(d.id)}')
    expect(TAB).toContain("className={`chip chip-ok${stamped ? ' gin-stamp' : ''}`}")
  })
})

describe('Group input list exit', () => {
  it('keeps a leaving idea mounted for one exit, and a removed decision with it', () => {
    expect(TAB).toContain("import { presenceAttrs, usePresenceList } from '../../lib/usePresenceList'")
    expect(TAB).toMatch(/usePresenceList\(openIdeas, sg => sg\.id, \{\s*fallbackFocus: \(\) => document\.getElementById\(SECTION_DOM\.ideas\),/)
    // A decision keys on its id only, so one card instance lives through the resolve.
    expect(TAB).toMatch(/usePresenceList\(\s*\[\.\.\.openDecisions, \.\.\.resolvedDecisions\],\s*d => d\.id,/)
    expect(TAB).not.toMatch(/d => `\$\{d\.id\}:\$\{d\.status\}`/)
    expect(TAB).toContain('<div ref={attachIdeaList} className="gin-rows">')
    expect(TAB).toContain('ref={attachDecisionList}')
  })

  it('marks each leaving item with the presence attributes and drops its id, so no id repeats', () => {
    expect(TAB).toContain('{...presenceAttrs({ exiting })}')
    expect(TAB).toContain('id={exiting ? undefined : `gi-item-${sg.id}`}')
    expect(TAB).toContain('id={exiting ? undefined : `gi-item-${d.id}`}')
  })

  it('drops every id of a leaving item, so no id repeats while it fades', () => {
    for (const id of ['gi-row-panel-${sg.id}', 'gi-add-option-${d.id}', 'gi-opt-${d.id}-${o.id}-label', 'gi-opt-${d.id}-${o.id}-detail', 'gi-opt-${d.id}-${o.id}-pct', 'gi-comment-${d.id}']) {
      expect(TAB, id).toContain('id={exiting ? undefined : `' + id + '`}')
    }
  })

  it('holds the empty message back until the last idea has left', () => {
    expect(TAB).toMatch(/openIdeas\.length === 0 && !ideasExiting && \(/)
  })

  it('never gives a leaving item an entrance or a delay', () => {
    // The exit rule has three attribute pseudo-classes of weight. The entrance rules for a
    // presence item stay lower, and the one delay rule that could reach a leaving item opts out.
    expect(ruleOf('.gin-rows > .gin-row')?.selector).not.toMatch(/data-presence/)
    expect(CSS).toContain(".gin-col > .yf-surface:not([data-presence='exit'])")
    expect(CSS).toContain(".gin-rows > .gin-row[data-presence='live']")
  })
})

describe('Group input row and field collapse', () => {
  it('exports the day collapse and lets a caller act once it is open', () => {
    expect(DAY).toContain('export function SmoothCollapse({ open, children, fallbackFocus, fold, onExpanded }')
    expect(DAY).toContain('useEffect(() => { if (expanded) expandedCallback.current?.() }, [expanded])')
  })

  it('opens each panel with the day collapse and hands focus back when a close would strand it', () => {
    expect(TAB).toContain("import { SmoothCollapse } from './timeline/DaySection'")
    expect(TAB).toContain('<SmoothCollapse open={expanded} fallbackFocus={headRef}>')
    expect(TAB).toContain('<SmoothCollapse open={commenting} fallbackFocus={commentToggleRef} onExpanded={focusCommentField}>')
    expect(TAB).toContain('<SmoothCollapse open={addingOption && editable && canAddOption(d, now)} fallbackFocus={addTriggerRef} onExpanded={focusOptionField}>')
    expect(TAB).toContain('<SmoothCollapse open={showAllActivity} fallbackFocus={feedToggleRef}>')
    expect(TAB).toContain('<SmoothCollapse open={quizOpen} fallbackFocus={editBtnRef} onExpanded={focusFirstChip}>')
    expect(TAB.match(/<SmoothCollapse /g)).toHaveLength(5)
  })

  it('moves focus after the content is open, because a hidden element cannot take it', () => {
    // The clip is about 0px high when onExpanded runs, so no focus call may scroll.
    expect(TAB).toContain('const focusOptionField = () => optionRef.current?.focus({ preventScroll: true })')
    expect(TAB).toContain("chipsRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })")
    expect(TAB).toContain("?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true })")
    expect(DAY).toContain('Runs each time the clip starts to open')
    expect(DAY).not.toContain('finishes opening')
    expect(TAB).not.toContain('focusOnMount')
  })

  it('drops the day-body spacer, so a panel sits flush', () => {
    expect(ruleOf('.gin-panel .day-body-clip-inner::before')?.body).toMatch(/content:\s*none/)
  })

  it('keeps the pill bar on PillNav, which carries the glider', () => {
    expect(TAB).toContain('<PillNav className="mode-pillbar gin-pillbar"')
  })
})

describe('Group input decision card keeps its state through a resolve', () => {
  it('keys the decision card on its id only, so a resolve never remounts it', () => {
    expect(TAB).toContain('<DecisionCard key={key} d={d}')
    expect(TAB).not.toMatch(/<DecisionCard key=\{`/)
    // The one id-only key reaches the card through the presence list.
    expect(TAB).toMatch(/decisionEntries\.map\(\(\{ item: d, key, exiting \}\)/)
  })

  it('holds the drafts in the one card instance, above the open and decided branches', () => {
    const card = TAB.slice(TAB.indexOf('function DecisionCard('), TAB.indexOf('// ================= The one follow-up'))
    const branch = card.indexOf('{open ? (')
    for (const draft of ['setCommenting', 'setAddingOption', 'setOptionLabel', 'setPlacementDayId', 'setPlacementDays']) {
      const at = card.indexOf(`${draft}] = useState`) >= 0 ? card.indexOf(`${draft}] = useState`) : card.indexOf(`, ${draft}`)
      expect(at, draft).toBeGreaterThan(-1)
      expect(at, draft).toBeLessThan(branch)
    }
    // The comment field and the day picker sit outside the open branch, so they persist.
    expect(card.indexOf('<SmoothCollapse open={commenting}')).toBeGreaterThan(card.indexOf('<div className="gin-decided">'))
    expect(card.indexOf('{pickerOptionId && pickerOption?.place && (')).toBeGreaterThan(card.indexOf('<div className="gin-decided">'))
  })

  it('marks a card that changed phase on screen, and rises only its decided body', () => {
    expect(TAB).toContain("data-turned={turned && !open ? 'true' : undefined}")
    expect(TAB).toContain('if (!open) setTurned(true)')
    const rise = top.find((b) => b.selector.includes(".gin-decision[data-turned='true'] .gin-decided"))
    expect(rise?.body).toMatch(/animation:\s*pageRise var\(--motion-med\) var\(--ease-paper\) backwards/)
    expect(rise?.selector.replace(/\s+/g, ' ')).toContain(".gin-decision[data-turned='true'] .gin-decided + .gin-foot")
  })

  it('moves focus only when the resolve stranded it, and never out of a field the member is typing in', () => {
    expect(TAB).toContain('const cardHadFocus = !!document.getElementById(`gi-item-${d.id}`)?.contains(document.activeElement)')
    expect(TAB).toContain('if (cardHadFocus) setRefocusCard(true)')
    expect(TAB).toContain('if (!active || active === document.body) document.getElementById(`gi-item-${d.id}`)?.focus({ preventScroll: true })')
    // Someone else's resolve sets no refocus request, so it cannot take focus.
    expect(TAB.match(/setRefocusCard\(true\)/g)).toHaveLength(1)
  })

  it('keeps the Chosen stamp on the same card', () => {
    expect(TAB).toContain('onStamp(d.id)')
    expect(TAB).toContain("className={`chip chip-ok${stamped ? ' gin-stamp' : ''}`}")
  })
})

describe('Group input narrow layout does not replay a column', () => {
  const narrow = top.find((b) => b.selector === '@media (max-width: 860px)' && /gin-col--seen/.test(b.body))

  it('marks a column that has been on screen and left it', () => {
    expect(TAB).toContain("const [seenCols, setSeenCols] = useState<ReadonlySet<Section>>(() => new Set())")
    expect(TAB).toContain('if (lastShown) setSeenCols(current => new Set(current).add(lastShown))')
    expect(TAB).toContain("seenCols.has(section) ? ' gin-col--seen' : ''")
  })

  it('turns every entrance of a seen column off, and only in the narrow layout', () => {
    expect(narrow).toBeDefined()
    expect(narrow?.body).toMatch(/\{\s*animation:\s*none;\s*\}\s*$/)
    for (const part of ['> .yf-surface', '.gin-rows > .gin-row', '.gin-feed > .feed-item', '.gin-option .gin-fill', '.gin-crew-row .gin-fill', '.gin-option-pct', '.gin-pop', '.gin-stamp', '.gin-decided']) {
      expect(narrow?.body, part).toContain(`.gin-col.gin-col--seen ${part.startsWith('>') ? part : part}`.replace('seen  ', 'seen '))
    }
    // No other rule switches a seen column off, so a wide screen keeps its later entrances.
    expect(top.filter((b) => !b.selector.startsWith('@') && /gin-col--seen/.test(b.selector))).toEqual([])
  })

  it('keeps the seen rule ahead of the reduced-motion block and registers the class', () => {
    expect(CSS.indexOf('.gin-col.gin-col--seen')).toBeLessThan(CSS.indexOf('@media (prefers-reduced-motion: reduce)'))
    const ownership = JSON.parse(read('docs/css-ownership.json')) as { owners: Array<{ file: string; owned?: string[] }> }
    const owner = ownership.owners.find((o) => o.file === 'src/styles/pages/group-input.css')
    expect(owner?.owned).toContain('gin-col--seen')
  })
})

describe('Group input reduced motion', () => {
  const reduce = top.find((b) => b.selector === '@media (prefers-reduced-motion: reduce)')

  it('ends the file with one reduced-motion block', () => {
    expect(reduce).toBeDefined()
    expect(top.filter((b) => b.selector === '@media (prefers-reduced-motion: reduce)')).toHaveLength(1)
    expect(top[top.length - 1].selector).toBe('@media (prefers-reduced-motion: reduce)')
  })

  it('turns off every rule that names an animation, with a selector of the same weight', () => {
    const animated = top
      .filter((b) => !b.selector.startsWith('@') && /(^|;|\s)animation:\s*(?!none)\S/.test(b.body))
      .map((b) => b.selector.replace(/\s+/g, ' '))
    expect(animated.length).toBeGreaterThan(8)
    const off = reduce?.body ?? ''
    for (const selector of animated) {
      // The tab panel rule is itself `animation: none`, so it is not in this list.
      const entry = `${selector} { animation: none; }`
      const grouped = selector.split(/,\s*/).every((part) => off.includes(part))
      expect(off.includes(entry) || grouped, selector).toBe(true)
    }
  })

  it('keeps the vote bar transition and the stamp opt-out the layout pins read', () => {
    expect(reduce?.body).toMatch(/\.gin-fill \{ transition: none; \}[^}]*\.gin-stamp \{ animation: none; \}/)
  })

  it('writes no raw time value anywhere in the file', () => {
    expect(stripComments(CSS)).not.toMatch(/(?<![\w.-])\d+(\.\d+)?m?s\b/)
  })
})
