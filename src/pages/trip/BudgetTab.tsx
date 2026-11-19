// ============ Trip workspace — Budget tab ============
// PW-13: the Budget artboard, drawn on real trip money. A four-card glance
// strip answers "are we over?"; the cost-per-day chart stacks each day's spend
// by category against a day target; the category card splits share, group and
// each; the who-paid card draws balances around an even line and keeps the
// settlement; the essential/optional card carries the optional watch; the
// expense lines stay the one ledger, with capture, inline edit and delete.
//
// Every figure is still the engine's or the settlement lib's. This file adds
// presentation and two read-only views (the ledger filter, the chart split).
// The five direct writers keep the shared staged-change refusal.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  BedDouble, Car, Check, Fuel, LifeBuoy, Mountain, MoreHorizontal, Pencil,
  RotateCcw, Ticket, TrainFront, Trash2, Utensils,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Trip, Expense, ExpenseCategory, ID, CachedUser } from '../../data/types'
import { EXPENSE_CATEGORIES } from '../../data/types'
import {
  addExpense, deleteExpense, restoreExpense, updateExpense,
  markExpenseSettled, markExpenseUnsettled,
  currentUser, userById, useDb, canEdit, roleOf, resumeSync, tripById,
} from '../../store/store'
import { computeTotals, getAssumptions, formatInr, isRoundTrip, safeToSpendPerDay } from '../../lib/engine'
import { splitDaySpend } from '../../lib/budgetDaySplit'
import { largestRemainderShares } from '../../lib/budgetShares'
import { amountRefusal } from '../../lib/expenseAmount'
import { sliceState, emptyCopyFor } from '../../lib/readState'
import { computeBalances, settleBalances, fairSharePerHead, linesTotal, openTaggedLines } from '../../lib/settlement'
import { loadFlag, saveFlag } from '../../lib/uiPrefs'
import { titleCase as baseTitleCase } from '../../lib/labels'
import { avatarToneFor, assignAvatarTones, type AvatarTone } from '../../lib/avatarTone'
import { Avatar, Chip, Field, toast, undoToast, useInView, usePageVisible } from '../../components/ui'
import { StateBlock } from '../../components/page/StateBlock'
import { Surface } from '../../components/page/Surface'
import { refuseWhileStaged } from '../../lib/mutationLifecycle'
import { Mascot } from '../../components/mascot/Mascot'

// ================= Budget tab =================

/** Category → icon. The bar and chip colours come from the `.bud-cat--*`
 *  classes in the budget stylesheet, so both themes read one token family. */
const CAT_META: Record<ExpenseCategory, { icon: LucideIcon }> = {
  transport: { icon: Car },
  accommodation: { icon: BedDouble },
  food: { icon: Utensils },
  activities: { icon: Mountain },
  'entry-fees': { icon: Ticket },
  'tolls-parking': { icon: Fuel },
  'local-travel': { icon: TrainFront },
  'emergency-buffer': { icon: LifeBuoy },
}

/** −₹6,168 with a real minus sign — formatInr alone renders "₹-6,168". */
function fmtNeg(n: number): string { return `−${formatInr(-n)}` }

/** The category class that carries the validated spend hue. */
function catClass(c: ExpenseCategory): string { return `bud-cat--${c}` }

/** The one category the mockup names differently. */
const CAT_LABEL: Partial<Record<ExpenseCategory, string>> = { accommodation: 'Stays' }
/** Category label as the budget surfaces print it. */
function titleCase(c: string): string { return CAT_LABEL[c as ExpenseCategory] ?? baseTitleCase(c) }

/** One solid tone per person, for every avatar this tab draws.
 *
 *  The mockup paints each participant a solid brand chip instead of the pale
 *  mint default, so the money rows read as people. The tone must also match the
 *  header's member stack, which assigns tones across the whole cast: a lone
 *  hash cannot promise that two people differ, and it could paint one person two
 *  colours on one page. So this reads the stack's own assignment — same members,
 *  same order — and falls back to the lone hash only for an identity the trip
 *  does not hold. */
function toneMapFor(members: { userId: ID }[]): Map<string, AvatarTone> {
  const tones = assignAvatarTones(members.map(member => member.userId))
  return new Map(members.map((member, index) => [member.userId, tones[index]]))
}

type ToneUser = { id?: string; profile?: { name?: string } } | null | undefined

/** The member's assigned tone, or the lone-identity tone for a non-member. */
function toneFrom(toneMap: Map<string, AvatarTone>, user: ToneUser): AvatarTone {
  const assigned = user?.id ? toneMap.get(user.id) : undefined
  return assigned ?? avatarToneFor(user?.id ?? user?.profile?.name)
}

interface FormState {
  label: string; amount: string; category: ExpenseCategory
  perPerson: boolean; optional: boolean; paidBy: string; attachStop: string
}

function stateFromExpense(e: Expense): FormState {
  return { label: e.label, amount: String(e.amountInr), category: e.category, perPerson: !!e.perPerson, optional: !!e.optional, paidBy: e.paidBy ?? '', attachStop: e.stopId ?? '' }
}

function validateForm(form: FormState): string | null {
  if (!form.label.trim()) return 'Give the expense a name.'
  if (!form.amount.trim()) return 'Enter an amount.'
  // #382: blank-and-falsy used to be the WHOLE gate, so '-5', '1e3' and
  // 'Infinity' walked into the store — and the native min= on the input is
  // bypassable by typing anyway. One rule now, the same one the store, the
  // codec and the importer speak (lib/expenseAmount): a finite number of
  // rupees above zero, or the sentence that says why not.
  return amountRefusal(Number(form.amount))
}

function patchOf(form: FormState): Omit<Expense, 'id'> {
  return {
    label: form.label.trim(), category: form.category, amountInr: Number(form.amount),
    perPerson: form.perPerson, optional: form.optional,
    paidBy: form.paidBy || undefined, stopId: form.attachStop || undefined,
  }
}

/** The fields an EDIT actually changed, as a patch (#829).
 *
 *  `baseline` is the line as the editor opened it, NOT the line as it stands
 *  now. The difference matters: the form only ever holds what the person has
 *  typed, so a field they never touched must not be in the patch. Diffing
 *  against the live line would put the stale value back — the exact overwrite
 *  this is here to prevent.
 *
 *  A field cleared back to empty is sent as `undefined`, not omitted — that is
 *  a real edit (un-tag the payer, detach the stop), and omitting it would make
 *  the clear impossible to express. */
function changedFields(form: FormState, baseline: Expense): Partial<Omit<Expense, 'id'>> {
  const next = patchOf(form)
  const patch: Partial<Omit<Expense, 'id'>> = {}
  if (next.label !== baseline.label) patch.label = next.label
  if (next.amountInr !== baseline.amountInr) patch.amountInr = next.amountInr
  if (next.category !== baseline.category) patch.category = next.category
  if (next.perPerson !== !!baseline.perPerson) patch.perPerson = next.perPerson
  if (next.optional !== !!baseline.optional) patch.optional = next.optional
  if (next.paidBy !== baseline.paidBy) patch.paidBy = next.paidBy
  if (next.stopId !== baseline.stopId) patch.stopId = next.stopId
  return patch
}

function PayerSelect({ members, value, onChange, id, 'aria-describedby': describedBy, 'aria-invalid': invalid }: {
  members: { userId: ID }[]
  value: string
  onChange: (v: string) => void
  // Field clones this custom control and injects id/aria-* (ui.tsx isCustomControl
  // branch); forwarding them is what makes the "Paid by" label's htmlFor resolve
  // — otherwise the select has no accessible name and the label can't focus it.
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}) {
  return (
    <select className="select" id={id} aria-describedby={describedBy} aria-invalid={invalid} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Shared kitty</option>
      {members.map(m => {
        const u = userById(m.userId)
        return <option key={m.userId} value={m.userId}>{u?.profile.name ?? 'Traveller'}</option>
      })}
    </select>
  )
}

/** Category / payer / flags / stop-attach — shared by quick-add and edit. */
function ExpenseFormFields({ trip, members, form, setForm }: {
  trip: Trip
  members: { userId: ID }[]
  form: FormState
  setForm: (fn: (f: FormState) => FormState) => void
}) {
  return (
    <>
      <div className="form-row">
        <Field label="Category">
          <select className="select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as ExpenseCategory }))}>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{titleCase(c)}</option>)}
          </select>
        </Field>
        <Field label="Paid by">
          <PayerSelect members={members} value={form.paidBy} onChange={v => setForm(f => ({ ...f, paidBy: v }))} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Attach to stop (optional)">
          <select className="select" value={form.attachStop} onChange={e => setForm(f => ({ ...f, attachStop: e.target.value }))}>
            <option value="">Whole trip</option>
            {trip.days.flatMap(d => d.stops.map(s => <option key={s.id} value={s.id}>{`Day ${d.index + 1}: ${s.title}`}</option>))}
          </select>
        </Field>
        <Field label="Flags">
          <span className="chip-row">
            <Chip onClick={() => setForm(f => ({ ...f, perPerson: !f.perPerson }))} active={form.perPerson} aria-pressed={form.perPerson}>Per person</Chip>
            <Chip onClick={() => setForm(f => ({ ...f, optional: !f.optional }))} active={form.optional} aria-pressed={form.optional}>Optional</Chip>
          </span>
        </Field>
      </div>
    </>
  )
}

/** The optional-spend watch's soft line, as a share of the estimate. Tips
 *  only — nothing in the trip changes when it's crossed. */
const OPTIONAL_WATCH_PCT = 20

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A day's date, derived from the trip start. Manual names keep it stable. */
function dayDateLabel(startDate: string, index: number): string {
  if (!startDate) return ''
  const base = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(base.getTime())) return ''
  base.setDate(base.getDate() + index)
  return `${WEEKDAYS[base.getDay()]} ${base.getDate()} ${MONTHS[base.getMonth()]}`
}

interface DayChartRow {
  dayIndex: number
  label: string
  dateLabel: string
  title?: string
  totalInr: number
  segments: { category: ExpenseCategory; amount: number }[]
}

/** The chart rows: the pure split, plus the label the day card carries. */
function chartRows(trip: Trip, totals: ReturnType<typeof computeTotals>): DayChartRow[] {
  return splitDaySpend(trip, totals).map((row, i) => {
    const day = trip.days.find(d => d.index === row.dayIndex)
    return {
      ...row,
      label: `Day ${i + 1}`,
      dateLabel: dayDateLabel(trip.startDate, row.dayIndex),
      title: day?.title,
    }
  })
}

/** The day a line belongs to, as the ledger prints it. */
function expenseDayLabel(trip: Trip, e: Expense): string {
  const day = typeof e.dayIndex === 'number' && Number.isFinite(e.dayIndex)
    ? trip.days.find(d => d.index === e.dayIndex)
    : e.stopId !== undefined
      ? trip.days.find(d => d.stops.some(s => s.id === e.stopId))
      : undefined
  return day ? `Day ${day.index + 1}` : 'Whole trip'
}

function lineTotal(e: Expense, travellers: number): number {
  return e.amountInr * (e.perPerson ? travellers : 1)
}

/** The chart's fixed drawing box. Its own scale keeps every label legible. */
const PLOT = { w: 600, h: 300, left: 58, right: 10, top: 26, bottom: 46 }
const PLOT_W = PLOT.w - PLOT.left - PLOT.right
const PLOT_H = PLOT.h - PLOT.top - PLOT.bottom

/** A rectangle with one radius per corner, as an SVG path.
 *
 *  `r` is [top-left, top-right, bottom-right, bottom-left] in px. The small bars
 *  need a rounded OUTER end and a square inner one (the balance bars start on the
 *  zero line, the target track's over-segment starts at the target), and a rect
 *  carries one radius for all four corners. The path is drawn by hand, so those
 *  radii stay real px at every column width, where a stretched `rx` drew ellipses. */
function roundedBox(x: number, y: number, w: number, h: number, r: number[]): string {
  const [tl, tr, br, bl] = r.map(v => Math.max(0, Math.min(v, w / 2, h / 2)))
  return `M${x + tl} ${y}H${x + w - tr}`
    + (tr ? `A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : '')
    + `V${y + h - br}`
    + (br ? `A${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : '')
    + `H${x + bl}`
    + (bl ? `A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : '')
    + `V${y + tl}`
    + (tl ? `A${tl} ${tl} 0 0 1 ${x + tl} ${y}` : '')
    + 'Z'
}

/** The drawn width of an SVG, in CSS px, kept current across resizes.
 *
 *  The bars that span a card cannot use a `viewBox`: `preserveAspectRatio="none"`
 *  stretches every declared radius with the column, which is what turned the
 *  caps into ellipses. Geometry in px needs the width, so this reads it. It is a
 *  measurement, not a style: the value always lands in an SVG attribute. */
function useSvgWidth(ref: { current: SVGSVGElement | null }): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // The bar grows with a scaleX on its own SVG, so its rect reads 0 on the
    // first frame and stays 0 unless the wrapper is measured: the wrapper keeps
    // the layout width the bar will fill.
    const read = () => {
      const wrapper = el.parentElement ? el.parentElement.getBoundingClientRect().width : 0
      setWidth(wrapper || el.getBoundingClientRect().width)
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const watcher = new ResizeObserver(read)
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [ref])
  return width
}

/** Where the target mark sits on the glance track, as a share of its width.
 *  The mockup draws the target at 92% so the over-target segment has room on
 *  the right of the mark instead of piling up on the end of the bar. */
const TARGET_SHARE = 92
/** The gap the mockup leaves between the fill and the over segment, in px. */
const TRACK_GAP = 2
/** The narrowest a segment may be drawn, so a real share never reads as 0. */
const MIN_SEG = 6


export function BudgetTab({ trip, totals, editable, previewOpen, stagedRef, onOpenSettings }: {
  trip: Trip
  totals: ReturnType<typeof computeTotals>
  editable: boolean
  /** true while the workspace holds a staged change — every expense writer
   *  below writes the committed row directly, so each refuses instead of
   *  landing under the preview (#334, same policy as the timeline's). */
  previewOpen?: boolean
  /** The workspace's live staged flag. A deferred Undo can outlive this
   *  component's remount, so it reads the parent ref, not a local copy. */
  stagedRef?: { current: unknown }
  /** Opens the workspace's Settings tab, where the per-person target lives.
   *  Optional: a Budget tab rendered outside the workspace still gets the
   *  textual prompt for a missing target, just without the link. */
  onOpenSettings?: () => void
}) {
  const visible = usePageVisible()
  const dayBarsRef = useRef<HTMLDivElement>(null)
  const categoryBarsRef = useRef<HTMLDivElement>(null)
  const optionalBarsRef = useRef<HTMLDivElement>(null)
  const balancesRef = useRef<HTMLDivElement>(null)
  const daysInView = useInView(dayBarsRef)
  const categoriesInView = useInView(categoryBarsRef)
  const optionalInView = useInView(optionalBarsRef)
  const balancesInView = useInView(balancesRef)
  // The three full-width bars are drawn in px from these measured widths, so a
  // rounded end stays round at every column width.
  const trackRef = useRef<SVGSVGElement>(null)
  const shareRef = useRef<SVGSVGElement>(null)
  const essentialRef = useRef<SVGSVGElement>(null)
  const balRef = useRef<SVGSVGElement>(null)
  const trackW = useSvgWidth(trackRef)
  const shareW = useSvgWidth(shareRef)
  const essentialW = useSvgWidth(essentialRef)
  const balW = useSvgWidth(balRef)
  const db = useDb()
  const me = currentUser(db)
  const members = trip.members ?? []
  // One tone per person, from the same assignment the header's member stack
  // reads, so a colour means one person everywhere on this page.
  const toneMap = useMemo(() => toneMapFor(trip.members ?? []), [trip.members])
  const toneFor = (user: ToneUser) => toneFrom(toneMap, user)
  const [editingId, setEditingId] = useState<ID | null>(null)
  const [adding, setAdding] = useState(false)
  const [lineFilter, setLineFilter] = useState<'all' | 'open' | 'settled'>('all')
  const [watchOptional, setWatchOptional] = useState<boolean>(() => loadFlag('optional_watch', false))
  // The parent's staged ref is stable across a role remount. A standalone
  // render falls back to a local copy, which is enough when nothing unmounts.
  const canWrite = !!me?.id && canEdit(roleOf(trip, me.id))
  const fallbackStagedRef = useRef(!!previewOpen)
  useEffect(() => { fallbackStagedRef.current = !!previewOpen }, [previewOpen])
  const liveStagedRef = stagedRef ?? fallbackStagedRef

  const groupTarget = trip.budgetPerPersonInr * trip.travellers
  // #381: a zero target is a degenerate state, not an overspend. Gate every
  // target-relative surface on this so a budget-less trip is asked for a
  // budget instead of lectured with a red −₹total and a ₹0 "target".
  const hasTarget = groupTarget > 0
  const remaining = groupTarget - totals.totalCostInr
  const pctUsed = Math.min(150, Math.round((totals.totalCostInr / Math.max(1, groupTarget)) * 100))
  const perPersonDeltaPct = Math.round(((totals.costPerPersonInr - trip.budgetPerPersonInr) / Math.max(1, trip.budgetPerPersonInr)) * 100)
  const A = getAssumptions(trip)
  // #383: the expense ledger's read status. There is no `expenses` slice —
  // expenses ride inside the trips row — so the TRIPS slice is the ledger's
  // verdict, per-slice and never the global `ready` (a global ready is exactly
  // what let a failed read print the friendly empty copy). Saying it here saves
  // the next reader the hunt through the hydrate.
  const expensesRead = sliceState(db.sliceReads, 'trips')
  // Retry re-issues the read (the same full re-hydrate the app-resume path
  // runs — fresh generation, replace-on-success verdict), it does not merely
  // re-render the rows already in the cache.
  const retryExpenses = () => { void resumeSync() }
  // #384: settle/reopen is owner/editor only — the store enforces it (the
  // real guard), and the affordance matches so a viewer never sees a control
  // whose write would be refused. The expense writers share the same right.
  const canSettle = canWrite
  // Pacing: the dial's ESTIMATE headroom — how much room the plan still has
  // per remaining day without blowing the group target. Settled payments are
  // deliberately not fed in (#381, decided 2026-09-25: relabel, don't re-plumb
  // the ledger into the dial), so the tile names its basis instead of implying
  // cash. Null when no budget is set — the tile then asks for one instead of
  // inventing a number. With zero days left the figure is the whole remaining
  // lump, so the tile branches to a lump label rather than a daily one.
  const pacing = safeToSpendPerDay(trip, totals.totalCostInr)

  const days = chartRows(trip, totals)
  const dayTarget = hasTarget ? groupTarget / Math.max(1, trip.days.length) : totals.costPerDayInr
  const maxDay = Math.max(dayTarget, ...days.map(d => d.totalInr), 1)
  const chartCats = EXPENSE_CATEGORIES.filter(c => days.some(d => d.segments.some(s => s.category === c)))
  const overDay = days
    .filter(d => dayTarget > 0 && d.totalInr > dayTarget * 1.15)
    .sort((a, b) => b.totalInr - a.totalInr)[0]

  const cats = EXPENSE_CATEGORIES
    .map(c => [c, totals.byCategory[c] ?? 0] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const topCat = cats[0]
  // Displayed shares use largest remainder, so the rows can never sum to
  // 99 or 101 under a hardcoded footer.
  const catShares = largestRemainderShares(cats.map(([, v]) => v))
  const catShareTotal = catShares.reduce((sum, share) => sum + share, 0)
  const topCatShare = catShares[0] ?? 0
  // The ledger's own rows, as the glance cards report them. The settled card
  // measures the EXPENSE LINES, never the planning estimate: the engine's
  // transport and lodging are not a ledger balance.
  const settledExpenses = trip.expenses.filter(e => e.settled).sort((a, b) => (b.settled?.at ?? 0) - (a.settled?.at ?? 0))
  const settledTotal = linesTotal(settledExpenses, trip.travellers)
  const ledgerTotal = linesTotal(trip.expenses, trip.travellers)
  const openLedgerExpenses = trip.expenses.filter(e => !e.settled)
  const openLedgerTotal = linesTotal(openLedgerExpenses, trip.travellers)
  const settledPct = ledgerTotal > 0 ? Math.min(100, Math.round((settledTotal / ledgerTotal) * 100)) : 0
  const kittyLines = trip.expenses.filter(e => !e.paidBy)
  const kittyTotal = linesTotal(kittyLines, trip.travellers)
  const kittyPct = ledgerTotal > 0 ? Math.round((kittyTotal / ledgerTotal) * 100) : 0
  const biggestLine = trip.expenses
    .map(e => ({ expense: e, total: lineTotal(e, trip.travellers) }))
    .filter(line => Number.isFinite(line.total))
    .sort((a, b) => b.total - a.total)[0]
  const biggestShare = biggestLine && totals.totalCostInr > 0 ? Math.round((biggestLine.total / totals.totalCostInr) * 100) : 0
  // The read verdict branches explicitly. A missing ledger is "reading" or
  // "failed", never a zero; kept rows may still print their last read.
  const ledgerReady = expensesRead === 'ready'
  const ledgerReading = expensesRead === 'reading'
  const ledgerKept = !ledgerReady && trip.expenses.length > 0
  const ledgerUnread = !ledgerReady && !ledgerKept
  const optionalLines = trip.expenses.filter(e => e.optional)
  const withoutOptional = totals.totalCostInr - totals.optionalInr
  const withoutOptionalRoom = groupTarget - withoutOptional
  const shownExpenses = trip.expenses.filter(e => lineFilter === 'all' ? true : lineFilter === 'settled' ? !!e.settled : !e.settled)

  // I-19 — the balances measure the OPEN lines: fair share = open crew-tagged
  // total ÷ accounts, credited to whoever fronted those same lines. #548: the
  // split follows the members (a family of four travellers on two accounts
  // splits two ways) and non-member payers sit outside the population. One
  // population on both sides, so the card nets to zero and marking a line
  // settled really does remove it — settle every line and every row reads 0. The trip estimate
  // is deliberately NOT part of this card any more: it stays in the metric strip
  // above, which is where a planning figure belongs. Math lives in the pure
  // lib/settlement.ts (unit-tested there; the component is presentation only).
  // Newest-settled first in the history so the last action is on top.
  const openExpenses = trip.expenses.filter(e => !e.settled)
  // I-6 nudge: only tagged lines move money between people, so both the "still
  // to square up" count and the card's fair share are over those alone (an
  // untagged shared-kitty line owes nobody anything, and a payer who has left
  // the trip feeds neither) — and both come from the same two helpers, so the
  // figures can never disagree.
  // #548: the balances' population is the crew — members' open tagged lines.
  const memberIds = members.map(m => m.userId)
  const openPayable = openTaggedLines(trip.expenses, memberIds)
  const openPayableTotal = linesTotal(openPayable, trip.travellers)
  const balances = computeBalances(members, trip.expenses, trip.travellers, userById)
  const fairShare = fairSharePerHead(members.length, openPayableTotal)
  const tagged = openPayable.length > 0
  // #548 card copy: name the split's population when the counts diverge.
  const sharePer = members.length === trip.travellers ? 'each' : 'per account'
  const splitNote = members.length !== trip.travellers
    ? ` Your ${trip.travellers} travellers share it across ${members.length} account${members.length === 1 ? '' : 's'}.`
    : ''
  const transfers = settleBalances(balances)
  const maxBalance = Math.max(1, ...balances.map(b => Math.abs(b.bal)))
  const nameOf = (u: CachedUser | undefined) => u?.profile.name ?? 'Traveller'

  // The glance track's geometry, in px at the measured width: the mark sits at
  // 92% of the bar, the fill runs up to it, then a 2px gap and the over-target
  // segment. The old 0..100 viewBox stretched every radius and pushed the mark
  // and the over-segment onto the bar's last pixels.
  const usedPct = (totals.totalCostInr / Math.max(1, groupTarget)) * 100
  const targetX = (TARGET_SHARE / 100) * trackW
  const estimateX = (usedPct / 100) * (TARGET_SHARE / 100) * trackW
  const isOver = usedPct > 100
  const fillEnd = isOver ? targetX : Math.min(trackW, estimateX)
  const overStart = targetX + TRACK_GAP
  const overEnd = Math.max(overStart + MIN_SEG, Math.min(trackW, estimateX))
  const capText = `Target ${formatInr(groupTarget)}`
  const capRef = useRef<SVGTextElement>(null)
  const [capW, setCapW] = useState(0)
  useLayoutEffect(() => {
    if (capRef.current) setCapW(capRef.current.getBBox().width)
  }, [capText, trackW])
  // Centred under the mark, but never past the card edge on a narrow column.
  const capX = Math.max(capW / 2 + 1, Math.min(targetX, trackW - capW / 2 - 1))

  // The stacked share bar, in px at the measured width: a real 2px gap between
  // segments, 4px corners on every one, and a 6px floor for a tiny share. The
  // floor is taken from the largest segment, so the segments still add up to
  // the bar and no share is invented.
  const shareGaps = TRACK_GAP * Math.max(0, cats.length - 1)
  const shareAvail = Math.max(0, shareW - shareGaps)
  const shareIdeal = cats.map(([, v]) => (v / Math.max(1, totals.totalCostInr)) * shareAvail)
  const sharePx = shareIdeal.map(w => Math.max(MIN_SEG, w))
  const shareOver = sharePx.reduce((a, w) => a + w, 0) - shareIdeal.reduce((a, w) => a + w, 0)
  if (shareOver > 0 && sharePx.length > 0) {
    const biggest = sharePx.indexOf(Math.max(...sharePx))
    sharePx[biggest] = Math.max(MIN_SEG, sharePx[biggest] - shareOver)
  }
  let shareCursor = 0
  const shareSegs = sharePx.map((w, i) => {
    const x = shareCursor
    shareCursor += w + TRACK_GAP
    return { key: cats[i][0], klass: catClass(cats[i][0]), x, w: Math.max(0.5, w) }
  })
  const chartTargetLabel = hasTarget ? 'day target' : 'daily average'
  const chartTargetY = PLOT.top + PLOT_H - (Math.min(dayTarget, maxDay) / maxDay) * PLOT_H
  const chartTicks = [1, 0.75, 0.5, 0.25, 0].map(f => ({ f, value: maxDay * f, y: PLOT.top + PLOT_H * (1 - f) }))
  // A target that lands on a grid tick would print the same rupee value twice.
  // The comparison is on the VALUE, not on pixels: a tick 200 rupees away from
  // the target is not the target, and bolding it claimed otherwise.
  const targetHasTick = chartTicks.some(tick => Math.abs(Math.round(tick.value) - Math.round(dayTarget)) <= 1)
  const chartColW = PLOT_W / Math.max(1, days.length)
  const chartBarW = Math.min(58, chartColW * 0.56)

  return (
    <div className="bud-page">
      {/* A kept read says so once, above the cards. Reading is
          stale-while-revalidate; failed adds the retry. The panels keep their
          own rooms below, so a read with no rows still gets the failed block
          where the line would have been (#383, #704). */}
      {expensesRead === 'failed' && trip.expenses.length > 0 && (
        <div className="bud-read">
          <StateBlock kind="kept" size="compact" title="Couldn’t refresh expense lines"
            body="These figures are the last read. Nothing is missing from your account. Try again."
            actions={<button className="btn btn-primary btn-sm" onClick={retryExpenses}>Try again</button>} />
        </div>
      )}
      {expensesRead === 'reading' && trip.expenses.length > 0 && (
        <div className="bud-read">
          <StateBlock kind="kept" size="compact" title="Refreshing expense lines"
            body="These figures are the last read. They update when the refresh lands." />
        </div>
      )}

      <section className="bud-glance" role="group" aria-label="Budget at a glance">
        <article className="card bud-glance-main">
          <div className="bud-glance-head">
            <span className="bud-kicker">{hasTarget ? 'Trip estimate' : 'Estimate so far'}</span>
            {hasTarget && Math.abs(remaining) >= 1 && (
              <span className={`bud-pill ${remaining > 0 ? 'bud-pill-ok' : 'bud-pill-risk'}`}>
                {remaining > 0 ? <>{formatInr(remaining)} under target</> : <>{formatInr(-remaining)} over target</>}
              </span>
            )}
          </div>
          <div className="bud-glance-figure">
            <span className="bud-glance-num">{formatInr(totals.totalCostInr)}</span>
            <span className="bud-glance-each">
              {hasTarget && isOver && <Mascot pose="head-worried" size={26} inline />}
              {formatInr(totals.costPerPersonInr)} each · {trip.travellers} traveller{trip.travellers === 1 ? '' : 's'}
              {hasTarget
                ? perPersonDeltaPct !== 0 && <> · <b className={perPersonDeltaPct > 0 ? 'bud-delta-bad' : 'bud-delta-ok'}>{perPersonDeltaPct > 0 ? '+' : '−'}{Math.abs(perPersonDeltaPct)}%</b></>
                : ' · no per‑person target yet'}
            </span>
          </div>
          {hasTarget ? (
            <div className="bud-target-wrap">
              <svg className="bud-target-track" ref={trackRef} height="42" role="img"
                aria-label={isOver
                  ? `Estimate ${formatInr(totals.totalCostInr)} against a ${formatInr(groupTarget)} target, ${pctUsed}% of the target, ${formatInr(Math.max(0, -remaining))} over`
                  : `Estimate ${formatInr(totals.totalCostInr)} against a ${formatInr(groupTarget)} target, ${pctUsed}% of the target, ${formatInr(Math.max(0, remaining))} to go`}>
                <rect className="bud-track" x="0" y="8" width="100%" height="12" rx="6" />
                {trackW > 0 && (
                  <>
                    <path className="bud-track-fill"
                      d={isOver
                        ? roundedBox(0, 8, Math.max(1, fillEnd), 12, [6, 2, 2, 6])
                        : roundedBox(0, 8, Math.max(1, fillEnd), 12, [6, 6, 6, 6])} />
                    {isOver && (
                      <>
                        {/* The gap the mockup leaves between fill and over-run. */}
                        <rect className="bud-track-gap" x={targetX} y="8" width={TRACK_GAP} height="12" />
                        <path className="bud-track-fill is-over"
                          d={roundedBox(overStart, 8, Math.max(1, overEnd - overStart), 12, [2, 6, 6, 2])} />
                      </>
                    )}
                    <line className="bud-target-mark" x1={targetX} x2={targetX} y1="0" y2="28" />
                    <text className="bud-target-caption" ref={capRef} x={capX} y="41" textAnchor="middle">{capText}</text>
                  </>
                )}
              </svg>
            </div>
          ) : (
            <div className="bud-target-wrap">
              <p className="bud-glance-sub">Set a per-person target to measure this estimate{onOpenSettings && <> · <button className="link-btn teal" onClick={onOpenSettings}>Open Trip settings →</button></>}</p>
            </div>
          )}
          <div className="bud-glance-foot">
            {pacing ? (
              pacing.daysLeft === 0 ? (
                <span>
                  <b>Budget headroom</b>{' '}
                  <span className={pacing.perDayInr < 0 ? 'bud-delta-bad' : 'bud-delta-ok'}>
                    {pacing.perDayInr < 0 ? <>{formatInr(-pacing.perDayInr)} over</> : <>{formatInr(pacing.perDayInr)} left</>}
                  </span>{' '}· trip over · the whole lump, not a daily rate
                </span>
              ) : (
                <span>
                  <b>Budget headroom / day</b>{' '}
                  <span className={pacing.perDayInr < 0 ? 'bud-delta-bad' : 'bud-delta-ok'}>{formatInr(pacing.perDayInr)}</span>
                  {' '}· {formatInr(pacing.perPersonPerDayInr)} per person · {pacing.daysLeft} day{pacing.daysLeft !== 1 ? 's' : ''} left · of the estimate
                </span>
              )
            ) : (
              <span>
                <b>Budget headroom / day</b>: {Number.isFinite(totals.totalCostInr)
                  ? 'Set a per-person target to start pacing'
                  : 'Pacing needs a readable spend figure. Fix or remove the line that broke it'}
              </span>
            )}
          </div>
        </article>

        <article className="card bud-glance-tile">
          <span className="bud-kicker">Settled so far</span>
          <span className="bud-glance-num sm">{ledgerUnread ? 'Not available' : formatInr(settledTotal)}</span>
          {ledgerUnread ? (
            <span className="bud-mini-track is-unread" aria-hidden="true" />
          ) : (
            <svg className="bud-mini-track" height="8" role="img"
              aria-label={`${settledPct}% of recorded spend is marked settled${ledgerKept ? ' (last read)' : ''}`}>
              <rect className="bud-track" x="0" y="0" width="100%" height="8" rx="4" />
              <rect className="bud-track-fill" x="0" y="0" width={`${Math.max(0, settledPct)}%`} height="8" rx="4" />
            </svg>
          )}
          <span className="bud-glance-sub">
            {ledgerUnread
              ? (ledgerReading ? 'Reading the expense lines…' : 'Couldn’t read the expense lines. This is not a zero')
              : trip.expenses.length === 0
                ? 'No expense lines yet'
                : <>{settledPct}% of recorded spend · {settledExpenses.length} of {trip.expenses.length} line{trip.expenses.length === 1 ? '' : 's'} marked settled</>}
          </span>
          <span className="bud-glance-foot strong">
            {ledgerUnread
              ? 'Not available'
              : trip.expenses.length === 0
                ? 'Nothing on the ledger'
                : <>{formatInr(openLedgerTotal)} still open across {openLedgerExpenses.length} line{openLedgerExpenses.length === 1 ? '' : 's'}</>}
          </span>
        </article>

        <article className="card bud-glance-tile bud-glance-kitty">
          <span className="bud-kicker">Shared kitty spend</span>
          <span className="bud-glance-num sm">{ledgerUnread ? 'Not available' : formatInr(kittyTotal)}</span>
          {ledgerUnread ? (
            <span className="bud-mini-track is-unread" aria-hidden="true" />
          ) : (
            <svg className="bud-mini-track" height="8" role="img"
              aria-label={`${kittyPct}% of recorded spend sits in untagged lines${ledgerKept ? ' (last read)' : ''}`}>
              <rect className="bud-track" x="0" y="0" width="100%" height="8" rx="4" />
              <rect className="bud-track-fill soft" x="0" y="0" width={`${Math.max(0, kittyPct)}%`} height="8" rx="4" />
            </svg>
          )}
          <span className="bud-glance-sub">
            {ledgerUnread
              ? (ledgerReading ? 'Reading the expense lines…' : 'Couldn’t read the expense lines. This is not a zero')
              : kittyLines.length === 0
                ? 'No untagged lines.'
                : <>{kittyLines.length} untagged line{kittyLines.length === 1 ? '' : 's'} · no one is owed</>}
          </span>
          <span className="bud-glance-foot strong">
            {ledgerUnread ? 'Not available' : ledgerTotal > 0 ? <>{kittyPct}% of recorded spend</> : 'Nothing on the ledger'}
          </span>
        </article>

        <article className="card bud-glance-tile">
          <span className="bud-kicker">Biggest line</span>
          <span className="bud-glance-num sm">{ledgerUnread || !biggestLine ? 'Not available' : formatInr(biggestLine.total)}</span>
          <span className="bud-glance-sub">
            {ledgerUnread
              ? (ledgerReading ? 'Reading the expense lines…' : 'Couldn’t read the expense lines')
              : biggestLine
                ? <>{biggestLine.expense.label} · {expenseDayLabel(trip, biggestLine.expense)}</>
                : 'No expense lines yet'}
          </span>
          <span className="bud-glance-foot strong">{ledgerUnread || !biggestLine ? 'Not available' : <>{biggestShare}% of the trip</>}</span>
        </article>
      </section>

      <div className="bud-grid bud-grid-charts">
        <Surface className="card bud-panel bud-chart-card">
          <div className="bud-card-head">
            <h3 className="bud-card-title">Cost per day</h3>
            <p className="bud-card-note">
              <span className="bud-chart-hint-wide">Focus or tap a day for the split · every value is in the table below · dashed line is the {chartTargetLabel}{dayTarget > 0 ? ` (${formatInr(dayTarget)})` : ''}</span>
              <span className="bud-chart-hint-narrow">Open the table below for every day’s split · dashed line is the {chartTargetLabel}{dayTarget > 0 ? ` (${formatInr(dayTarget)})` : ''}</span>
            </p>
          </div>
          {chartCats.length > 0 && (
            <ul className="bud-legend" aria-label="Cost categories">
              {chartCats.map(c => (
                <li key={c}><i className={`bud-swatch ${catClass(c)}`} aria-hidden="true" />{titleCase(c)}</li>
              ))}
            </ul>
          )}
          {days.length > 0 && maxDay > 0 ? (
            <>
              <div className="bud-plot-scroll" ref={dayBarsRef} data-motion-paused={!visible || !daysInView}>
                <div className="bud-plot">
                  <svg className="bud-plot-svg" viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} role="img"
                    aria-label={`Cost per day. ${days.map(d => `${d.label} ${formatInr(d.totalInr)}`).join('; ')}. Dashed line is the ${chartTargetLabel} at ${formatInr(dayTarget)}. The axis runs from ${formatInr(0)} to ${formatInr(Math.round(maxDay))}.`}>
                    <title>Cost per day</title>
                    <desc>{`Each column stacks one day's spend by category. The dashed line marks the ${chartTargetLabel}. Every value is also written in the table below the chart.`}</desc>
                    {chartTicks.map(t => {
                      // Only the tick that IS the target carries the weight.
                      const onTarget = dayTarget > 0 && Math.abs(Math.round(t.value) - Math.round(dayTarget)) <= 1
                      return (
                        <g key={t.f}>
                          <line className="bud-grid-line" x1={PLOT.left} x2={PLOT.w - PLOT.right} y1={t.y} y2={t.y} />
                          <text className={onTarget ? 'bud-axis-label is-on' : 'bud-axis-label'} x={PLOT.left - 8} y={t.y + 4} textAnchor="end">
                            {formatInr(Math.round(t.value))}
                          </text>
                        </g>
                      )
                    })}
                    {dayTarget > 0 && (
                      <g className="bud-target-group">
                        <line className="bud-target-line" x1={PLOT.left} x2={PLOT.w - PLOT.right} y1={chartTargetY} y2={chartTargetY} />
                      </g>
                    )}
                    <g className="bud-bars">
                      {days.map((d, i) => {
                        const cx = PLOT.left + chartColW * (i + 0.5)
                        const barTop = PLOT.top + PLOT_H - (d.totalInr / maxDay) * PLOT_H
                        let cursor = PLOT.top + PLOT_H
                        return (
                          <g key={d.dayIndex} className="bud-day-group">
                            <g className="bud-stack">
                              {d.segments.map(s => {
                                const h = Math.max(1, (s.amount / maxDay) * PLOT_H)
                                const y = cursor - h
                                cursor = y - 2
                                return <rect key={s.category} className={`bud-seg ${catClass(s.category)}`}
                                  x={cx - chartBarW / 2} y={y} width={chartBarW} height={h} rx="2" />
                              })}
                            </g>
                            {d.totalInr > 0 && (
                              <text className={d.totalInr > dayTarget && dayTarget > 0 ? 'bud-bar-total is-over' : 'bud-bar-total'}
                                x={cx} y={barTop - 8} textAnchor="middle">{formatInr(d.totalInr)}</text>
                            )}
                            <text className="bud-day-name" x={cx} y={PLOT.h - 22} textAnchor="middle">Day {i + 1}</text>
                            {d.dateLabel && <text className="bud-day-date" x={cx} y={PLOT.h - 8} textAnchor="middle">{d.dateLabel}</text>}
                          </g>
                        )
                      })}
                    </g>
                    {/* Drawn after the bars so a tall first day cannot paint over the figure. */}
                    {dayTarget > 0 && !targetHasTick && (
                      <text className="bud-target-text" x={PLOT.left + 2} y={chartTargetY - 6}>{formatInr(Math.round(dayTarget))}</text>
                    )}
                  </svg>
                  <div className="bud-hits">
                    {days.map(d => {
                      const over = dayTarget > 0 && d.totalInr > dayTarget
                      return (
                        <div key={d.dayIndex} tabIndex={0} role="group"
                          className={over ? 'bud-hit is-over' : 'bud-hit'}
                          aria-label={`${d.label}${d.title ? `, ${d.title}` : ''}, ${formatInr(d.totalInr)}${dayTarget > 0 ? (over ? `, ${formatInr(d.totalInr - dayTarget)} over the day target` : ', within the day target') : ''}`}>
                          <span className="bud-tip" aria-hidden="true">
                            <b>{d.label}{d.title ? ` · ${d.title}` : ''}</b>
                            {d.segments.map(s => (
                              <span key={s.category}><i className={`bud-swatch ${catClass(s.category)}`} />{titleCase(s.category)}<b>{formatInr(s.amount)}</b></span>
                            ))}
                            <em>Total {formatInr(d.totalInr)}{dayTarget > 0 ? (over ? ` · ${formatInr(d.totalInr - dayTarget)} over the ${chartTargetLabel}` : ` · within the ${chartTargetLabel}`) : ''}</em>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              {overDay && (
                <p className="bud-note">
                  {overDay.label} runs {Math.round(((overDay.totalInr - dayTarget) / Math.max(1, dayTarget)) * 100)}% over the {chartTargetLabel}. Trim an optional line or shorten the drive.
                </p>
              )}
              <details className="bud-table-view">
                <summary>Table view of cost per day</summary>
                <div className="bud-table-scroll" tabIndex={0} role="region" aria-labelledby="bud-day-table-caption">
                  <table className="compare-table bud-data-table">
                    <caption id="bud-day-table-caption" className="sr-only">Cost per day by category</caption>
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        {chartCats.map(c => <th key={c} scope="col" className="num">{titleCase(c)}</th>)}
                        <th scope="col" className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d, i) => (
                        <tr key={d.dayIndex}>
                          <th scope="row">Day {i + 1}{d.dateLabel ? ` · ${d.dateLabel}` : ''}</th>
                          {chartCats.map(c => (
                            <td key={c} className="num">{formatInr(d.segments.find(s => s.category === c)?.amount ?? 0)}</td>
                          ))}
                          <td className="num"><b>{formatInr(d.totalInr)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <p className="hint-text bud-empty-line">No days to chart yet. Add a day to the plan.</p>
          )}
        </Surface>

        <Surface className="card bud-panel bud-cat-card">
          <div className="bud-card-head">
            <h3 className="bud-card-title">Where the money goes</h3>
            <span className="bud-card-note">Group totals and the per-traveller share</span>
          </div>
          {cats.length > 0 ? (
            <>
              <div ref={categoryBarsRef} data-motion-paused={!visible || !categoriesInView}>
                <svg className="bud-share-bar" ref={shareRef} height="16" role="img"
                  aria-label={`Category shares: ${cats.map(([c], i) => `${titleCase(c)} ${catShares[i]}%`).join(', ')}`}>
                  {shareW > 0 && shareSegs.map(seg => (
                    <rect key={seg.key} className={`bud-seg ${seg.klass}`}
                      x={seg.x} y="0" width={seg.w} height="16" rx="4" />
                  ))}
                </svg>
              </div>
              <div className="bud-cat-table-wrap">
                <table className="compare-table bud-cat-table" tabIndex={0}>
                  <caption className="sr-only">Where the money goes, by category</caption>
                  <thead>
                    <tr>
                      <th scope="col" aria-label="Category colour" />
                      <th scope="col">Category</th>
                      <th scope="col" className="num">Share</th>
                      <th scope="col" className="num">Group</th>
                      <th scope="col" className="num">Per traveller</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cats.map(([c, v], i) => {
                      const Icon = CAT_META[c].icon
                      return (
                        <tr key={c}>
                          <td><span className={`bud-line-cat ${catClass(c)}`} aria-hidden="true"><Icon size={12} /></span></td>
                          <th scope="row">{titleCase(c)}</th>
                          <td className="num">{catShares[i]}%</td>
                          <td className="num">{formatInr(v)}</td>
                          <td className="num">{formatInr(v / Math.max(1, trip.travellers))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td />
                      <th scope="row">Total</th>
                      <td className="num">{catShareTotal}%</td>
                      <td className="num"><b>{formatInr(totals.totalCostInr)}</b></td>
                      <td className="num"><b>{formatInr(totals.costPerPersonInr)}</b></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {topCat && (
                <p className="bud-insight">
                  <span aria-hidden="true">i</span>
                  <span>
                    Biggest share: {titleCase(topCat[0])} at {topCatShare}%.
                    {biggestLine && biggestLine.expense.category === topCat[0] && <> {biggestLine.expense.label} alone is {biggestShare}% of the trip.</>}
                  </span>
                </p>
              )}
              <details className="bud-method">
                <summary>How these estimates are made</summary>
                <p className="bud-card-note">
                  {A.kmPerLiter
                    ? <>All figures are estimates in INR. Transport is fuel-based: route distance{isRoundTrip(trip) ? ' (incl. return drive)' : ''} ≈{Math.round(totals.totalDistanceKm)} km ÷ {A.kmPerLiter} km/L ≈ <b>{Math.round(totals.totalDistanceKm / A.kmPerLiter)} L</b> of fuel × ₹{A.fuelPricePerL}/L ({A.fuelPriceIsUserSet ? 'your local pump price' : 'indicative petrol price. Actual consumption varies'}).</>
                    : <>All figures are estimates in INR. Transport is derived from route distance × ₹{A.inrPerKm}/km for {trip.transportMode}.</>}
                  {totals.lodgingNights > 0 && (
                    <> Stay is priced from your hotel stops: {totals.lodgingNights} overnight base{totals.lodgingNights !== 1 ? 's' : ''} · the drive needs a stay · × {totals.lodgingRooms} room{totals.lodgingRooms !== 1 ? 's' : ''} × ₹{totals.lodgingRatePerNight.toLocaleString('en-IN')}/night.</>
                  )}
                </p>
              </details>
            </>
          ) : (
            <StateBlock kind="empty" size="compact" title="No spend yet" body="Add an expense or a stay to see where the money goes." />
          )}
        </Surface>
      </div>

      <div className="bud-grid bud-grid-mid">
        <Surface className="card bud-panel bud-crew-card">
          <div className="bud-card-head">
            <h3 className="bud-card-title">Who paid · who owes</h3>
            <span className="bud-card-note">Split equally over the open tagged lines</span>
          </div>
          {/* #383: the balances read the same list the ledger does — one
              status, both consumers. A failed read must not print as a
              settled-up crew or an empty split. */}
          {expensesRead !== 'ready' && (
            expensesRead === 'failed' ? (() => {
              const copy = emptyCopyFor('failed', 'expense lines', retryExpenses)
              return (
                <div className="bud-state">
                  <StateBlock kind="failed" size="compact" title={copy.title} body={copy.body}
                    actions={<button className="btn btn-primary btn-sm" onClick={retryExpenses}>Try again</button>} />
                </div>
              )
            })() : (
              <div className="bud-state">
                <StateBlock kind="loading" size="compact" title="Loading expense lines…" />
              </div>
            )
          )}
          {expensesRead === 'ready' && (members.length < 2
            ? <p className="hint-text bud-crew-invite">{tagged && <>Fair share is {formatInr(fairShare)} {sharePer}. </>}Invite your crew from the Share tab, then tag who paid on expense lines. Who owes whom shows up here.</p>
            : <>
                <p className="hint-text bud-crew-status">
                  {tagged
                    ? <>Fair share is {formatInr(fairShare)} {sharePer}, counted over the {openPayable.length} open tagged line{openPayable.length !== 1 ? 's' : ''}.
                      {splitNote}
                    </>
                    : settledExpenses.length > 0
                      ? <>Every tagged line is squared up. Nothing left to split.</>
                      : <>Nothing to split yet. Tag who paid on expense lines and balances appear here. The estimates above are your planning figure, not a debt.</>}
                </p>
                {tagged && (
                  <>
                    <div className="bud-balances" ref={balancesRef} data-motion-paused={!visible || !balancesInView}>
                      <div className="bud-bal-head" aria-hidden="true">
                        <span /><span><span>← owes</span><span>Gets back →</span></span><span />
                      </div>
                      {balances.map((b, i) => {
                        const bal = Math.abs(b.bal) <= 0.5 ? 0 : b.bal
                        // The bars start exactly on the zero line and end with a
                        // 4px rounded OUTER end: the inner end is square, so an
                        // owes bar and a gets-back bar never overlap on the axis.
                        const half = balW / 2
                        const barW = (Math.abs(bal) / maxBalance) * half
                        return (
                          <div key={b.id} className="bud-bal-row">
                            <span className="bud-bal-who"><Avatar user={b.user} tone={toneFor(b.user)} /> {nameOf(b.user)}</span>
                            <span className="bud-bal-track" role="img"
                              aria-label={bal === 0 ? `${nameOf(b.user)} is settled` : bal > 0 ? `${nameOf(b.user)} gets back ${formatInr(bal)}` : `${nameOf(b.user)} owes ${formatInr(-bal)}`}>
                              <svg ref={i === 0 ? balRef : undefined} height="24" aria-hidden="true">
                                <line className="bud-bal-even" x1={half} x2={half} y1="0" y2="24" />
                                {bal !== 0 && balW > 0 && (
                                  <path className={`bud-bal-bar ${bal > 0 ? 'pos' : 'neg'}`}
                                    d={bal > 0
                                      ? roundedBox(half, 4, Math.max(1, barW), 16, [0, 4, 4, 0])
                                      : roundedBox(half - Math.max(1, barW), 4, Math.max(1, barW), 16, [4, 0, 0, 4])} />
                                )}
                              </svg>
                            </span>
                            <span className="bud-bal-amount">
                              <b className={bal === 0 ? 'muted' : bal > 0 ? 'bud-bal-pos' : 'bud-bal-neg'}>
                                {bal === 0 ? 'Settled' : bal > 0 ? `+${formatInr(bal)}` : fmtNeg(bal)}
                              </b>
                              <span className="bud-bal-note">{bal === 0 ? 'Even' : bal > 0 ? 'Gets back' : 'Owes'}</span>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    {transfers.length > 0 && (
                      <div className="bud-transfers">
                        <p className="bud-transfer-head"><b>Simplest way to settle</b> · {transfers.length} payment{transfers.length === 1 ? '' : 's'}</p>
                        {transfers.map((t, i) => (
                          <div key={`${t.from.id}-${t.to.id}-${i}`} className="bud-transfer-row">
                            <Avatar user={t.from.user} tone={toneFor(t.from.user)} />
                            <span>{nameOf(t.from.user)} → {nameOf(t.to.user)}</span>
                            <b>{formatInr(t.amount)}</b>
                          </div>
                        ))}
                        <p className="hint-text bud-transfer-note">The app records money per expense line. Move the money outside the app, then mark each line settled below.</p>
                      </div>
                    )}
                    {openPayable.length > 0 && (
                      <p className="hint-text bud-hint-note">
                        <b>{formatInr(openPayableTotal)}</b> across {openPayable.length} tagged line{openPayable.length !== 1 ? 's' : ''} still to square up. Mark each settled as the money moves.
                      </p>
                    )}
                    {canSettle && openExpenses.length > 0 && (
                      <div className="settled-strip bud-settle-strip">
                        <span className="hint-text bud-settle-lead">
                          <b>Settle up:</b> mark a line squared up. It leaves the balances and moves to the settled history below.
                        </span>
                        <div className="settled-list">
                          {openExpenses.map(e => (
                            <div key={e.id} className="settled-row">
                              <span className="settled-label">{e.label}</span>
                              <span className="num muted small">{formatInr(lineTotal(e, trip.travellers))}</span>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline settled-btn"
                                aria-label={`Mark ${e.label} settled`}
                                onClick={() => {
                                  if (refuseWhileStaged(previewOpen)) return
                                  if (!me?.id) return
                                  // #384: the store re-checks the role — this
                                  // is the affordance, not the guard. The
                                  // handler stays synchronous, so there is
                                  // no busy state to keep honest.
                                  markExpenseSettled(trip.id, e.id, me.id)
                                  toast(`Marked “${e.label}” settled`)
                                }}
                              >Mark settled</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {settledExpenses.length > 0 && (
                      <details className="settled-history">
                        <summary>{settledExpenses.length} settled · {formatInr(settledTotal)} already squared up</summary>
                        <div className="settled-list">
                          {settledExpenses.map(e => (
                            <div key={e.id} className="settled-row is-done">
                              <span className="settled-label">{e.label}</span>
                              <span className="num muted small">{formatInr(lineTotal(e, trip.travellers))}</span>
                              {canSettle && (
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label={`Reopen ${e.label}`}
                                  onClick={() => {
                                    if (refuseWhileStaged(previewOpen)) return
                                    // #384: the reopen path now needs the
                                    // session too — the hole the settle path
                                    // already closed.
                                    if (!me?.id) return
                                    markExpenseUnsettled(trip.id, e.id, me.id)
                                    toast(`Reopened “${e.label}”`)
                                  }}
                                ><RotateCcw size={14} /></button>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </>)}
        </Surface>

        <Surface className="card bud-panel bud-optional-card">
          <div className="bud-card-head">
            <h3 className="bud-card-title">Essential vs optional</h3>
            <span className="bud-card-note">Read-only: the optional flag lives on each line</span>
          </div>
          <div ref={optionalBarsRef} data-motion-paused={!visible || !optionalInView}>
            <svg className="bud-essential-bar" ref={essentialRef} height="16" role="img"
              aria-label={`Essential ${formatInr(totals.essentialInr)}, optional ${formatInr(totals.optionalInr)}`}>
              <defs>
                <pattern id="bud-optional-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect className="bud-hatch-base" x="0" y="0" width="6" height="6" />
                  <line className="bud-hatch-line" x1="0" y1="0" x2="0" y2="6" />
                </pattern>
              </defs>
              {essentialW > 0 && (
                <>
                  <path className="bud-essential-fill"
                    d={roundedBox(0, 0, Math.max(1, (totals.essentialInr / Math.max(1, totals.totalCostInr)) * essentialW), 16, [4, 4, 4, 4])} />
                  {totals.optionalInr > 0 && (
                    <path className="bud-optional-fill"
                      d={roundedBox(
                        (totals.essentialInr / Math.max(1, totals.totalCostInr)) * essentialW, 0,
                        Math.max(1, (totals.optionalInr / Math.max(1, totals.totalCostInr)) * essentialW), 16, [4, 4, 4, 4],
                      )} />
                  )}
                </>
              )}
            </svg>
          </div>
          <div className="bud-optional-split">
            <span><b>Essential {formatInr(totals.essentialInr)}</b> <span className="muted">stays, fuel, meals</span></span>
            <span><b className={totals.optionalInr > 0 ? 'bud-optional-key' : 'muted'}>Optional {formatInr(totals.optionalInr)}</b></span>
          </div>
          {optionalLines.length > 0 ? (
            <>
              <ul className="bud-optional-list">
                {optionalLines.map(e => (
                  <li key={e.id} className="bud-optional-row">
                    <span className="bud-optional-check" aria-hidden="true"><Check size={14} /></span>
                    <span className="bud-optional-name">{e.label} <span className="muted">· {expenseDayLabel(trip, e)}</span></span>
                    <b>{formatInr(lineTotal(e, trip.travellers))}</b>
                  </li>
                ))}
              </ul>
              <p className="bud-optional-result">
                <Check size={20} aria-hidden="true" />
                <span>
                  Without {optionalLines.length === 1 ? 'that line' : `those ${optionalLines.length}`}: <b>{formatInr(withoutOptional)}</b>
                  {hasTarget && <> · {withoutOptionalRoom >= 0
                    ? <>{formatInr(withoutOptionalRoom)} under target</>
                    : <>{formatInr(-withoutOptionalRoom)} over target</>}</>}
                </span>
              </p>
            </>
          ) : (
            <p className="hint-text bud-empty-line">No optional lines. Mark a line optional in its editor to test what the plan costs without it.</p>
          )}
          <div className="row-between bud-watch-row">
            <span className="small muted">A soft line at {OPTIONAL_WATCH_PCT}% of the estimate. Tips only, nothing changes.</span>
            <button
              className={`btn btn-sm ${watchOptional ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => { const next = !watchOptional; setWatchOptional(next); saveFlag('optional_watch', next) }}
              aria-pressed={watchOptional}
            >
              {watchOptional ? 'Watching optional' : 'Watch optional spends'}
            </button>
          </div>
          {watchOptional && totals.totalCostInr > 0 && (() => {
            const pct = (totals.optionalInr / totals.totalCostInr) * 100
            return (
              <p className={`small bud-watch-status ${pct > OPTIONAL_WATCH_PCT ? 'dayplanner-red' : 'muted'}`} role="status">
                Optional watch: {formatInr(totals.optionalInr)} · {Math.round(pct)}% of the estimate,{' '}
                {pct > OPTIONAL_WATCH_PCT ? `over the ${OPTIONAL_WATCH_PCT}% soft line. Trimming one optional line brings it back under.` : `inside the ${OPTIONAL_WATCH_PCT}% soft line.`}
              </p>
            )
          })()}
        </Surface>
      </div>

      <Surface className="card bud-panel bud-lines">
        <div className="bud-card-head">
          <div>
            <h3 className="bud-card-title">Expense lines</h3>
            <p className="bud-card-note">Amounts are group totals unless marked per person. Tag who paid to settle up above.</p>
          </div>
          <div className="bud-line-tools">
            <div className="bud-filter-group" role="group" aria-label="Filter expense lines">
              {(['all', 'open', 'settled'] as const).map(f => (
                <button key={f} type="button" className={lineFilter === f ? 'bud-filter is-on' : 'bud-filter'}
                  aria-pressed={lineFilter === f} onClick={() => setLineFilter(f)}>
                  {f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Settled'}
                </button>
              ))}
            </div>
            {editable && canWrite && (
              <button type="button" className="btn btn-primary" aria-expanded={adding}
                onClick={() => setAdding(v => !v)}>
                {adding ? 'Close capture' : '+ Add expense'}
              </button>
            )}
          </div>
        </div>
        {editable && canWrite && adding && (
          <QuickAdd trip={trip} members={members} meId={me?.id} canWrite={canWrite} previewOpen={previewOpen} />
        )}
        {/* #383: the three states, in the order that makes the bug
            impossible — the failure branch first (it is the only one that
            offers a way back), then loading, and only then the genuine
            empty copy. Branching data-only on a slice that can fail is
            what printed the friendly empty copy over a dropped connection.
            Each is its own compact block (R22), so the roles are the shared
            ones: a failed read is an alert, a pending read is a status. */}
        {expensesRead !== 'ready' ? (
          expensesRead === 'failed' ? (() => {
            const copy = emptyCopyFor('failed', 'expenses', retryExpenses)
            return (
              <div className="bud-state">
                <StateBlock kind="failed" size="compact" title={copy.title} body={copy.body}
                  actions={<button className="btn btn-primary btn-sm" onClick={retryExpenses}>Try again</button>} />
              </div>
            )
          })() : (
            <div className="bud-state">
              <StateBlock kind="loading" size="compact" title="Loading expenses…" />
            </div>
          )
        ) : trip.expenses.length === 0 ? (
          <div className="bud-state">
            <StateBlock kind="empty" size="compact" title="No expense lines yet"
              body="Add the big ones first (stay, fuel, food)." />
          </div>
        ) : (
            <div className="bud-ledger-scroll">
            <table className="compare-table bud-lines-table" tabIndex={0} aria-label="Expense lines">
              <thead>
                <tr>
                  <th scope="col" aria-label="Category" />
                  <th scope="col">What</th>
                  <th scope="col">Day</th>
                  <th scope="col">Paid by</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shownExpenses.map(e => {
                  const Icon = CAT_META[e.category].icon
                  const payer = e.paidBy ? userById(e.paidBy) : undefined
                  return editingId === e.id && editable && canWrite ? (
                    <tr key={e.id}>
                      <td colSpan={7}>
                        <ExpenseEditor trip={trip} members={members} expense={e} onDone={() => setEditingId(null)}
                          meId={me?.id} canWrite={canWrite} previewOpen={previewOpen} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id}>
                      <td><span className={`bud-line-cat ${catClass(e.category)}`} aria-hidden="true"><Icon size={12} /></span></td>
                      <th scope="row">
                        <span className="bud-line-name">
                          {e.label}
                          {e.perPerson && <span className="chip chip-info bud-line-chip">Per person</span>}
                          {e.optional && <span className="chip chip-saffron bud-line-chip">Optional</span>}
                        </span>
                        <span className="bud-line-amount-inline">
                          <b>{formatInr(lineTotal(e, trip.travellers))}</b>
                          <span className={e.settled ? 'bud-pill bud-pill-ok' : 'bud-pill bud-pill-quiet'}>
                            {e.settled ? 'Settled' : 'Estimate'}
                          </span>
                        </span>
                      </th>
                      <td>{expenseDayLabel(trip, e)}</td>
                      <td>{payer
                        ? <span className="bud-payer"><Avatar user={payer} tone={toneFor(payer)} /> {payer.profile.name}</span>
                        : <span className="bud-payer bud-payer-kitty">Shared kitty</span>}</td>
                      <td className="num">{formatInr(lineTotal(e, trip.travellers))}</td>
                      <td>
                        <span className={e.settled ? 'bud-pill bud-pill-ok' : 'bud-pill bud-pill-quiet'}>
                          {e.settled ? 'Settled' : 'Estimate'}
                        </span>
                      </td>
                      <td>{editable && canWrite && (
                        <span className="bud-row-actions">
                          <button className="icon-btn" aria-label={`Edit ${e.label}`} onClick={() => setEditingId(e.id)}><Pencil size={14} /></button>
                          <button className="icon-btn" aria-label={`Delete ${e.label}`} onClick={() => {
                            // #334: a direct write while a preview is open would
                            // make Keep refuse (stale base) — refuse it here instead.
                            if (refuseWhileStaged(previewOpen)) return
                            if (!canWrite) { toast('You can no longer edit this trip.', 'err'); return }
                            const idx = trip.expenses.findIndex(x => x.id === e.id)
                            const deleteOutcome = deleteExpense(trip.id, e.id, me?.id ?? null)
                            if (deleteOutcome === 'refused') { toast('You can no longer edit this trip.', 'err'); return }
                            if (deleteOutcome === 'no-such-line') { toast('That line is no longer on the trip.', 'err'); return }
                            undoToast(`Removed “${e.label}”`, () => {
                              // The toast can outlive this tab. Read the live
                              // staged flag, trip, account and role instead of
                              // the render that raised it.
                              if (refuseWhileStaged(!!liveStagedRef.current)) return
                              const liveTrip = tripById(trip.id)
                              const liveMe = currentUser()
                              const liveCanWrite = !!liveTrip && !!liveMe?.id
                                && canEdit(roleOf(liveTrip, liveMe.id))
                              if (!liveCanWrite) { toast('You can no longer edit this trip.', 'err'); return }
                              const outcome = restoreExpense(trip.id, e, idx, liveMe.id)
                              if (outcome === 'applied') toast(`Restored “${e.label}”`)
                              else if (outcome === 'duplicate') toast(`“${e.label}” is already back on the trip.`)
                              else if (outcome === 'invalid') return
                              else toast(`“${e.label}” was not restored. You can no longer edit this trip.`, 'err')
                            })
                          }}><Trash2 size={14} /></button>
                        </span>
                      )}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        {expensesRead === 'ready' && trip.expenses.length > 0 && (
          <p className="bud-lines-foot">
            Showing {shownExpenses.length} of {trip.expenses.length} lines
            {lineFilter !== 'all' && (
              <>
                {' · '}
                <button type="button" className="link-btn teal" onClick={() => setLineFilter('all')}>Show all lines</button>
              </>
            )}
          </p>
        )}
        {expensesRead === 'ready' && trip.expenses.length > 0 && shownExpenses.length === 0 && (
          <p className="hint-text bud-empty-line">
            No {lineFilter === 'settled' ? 'settled' : 'open'} lines. <button className="link-btn teal" onClick={() => setLineFilter('all')}>Show all lines</button>
          </p>
        )}
      </Surface>
    </div>
  )
}

// ================= Quick add + inline edit =================

const EMPTY_FORM: FormState = { label: '', amount: '', category: 'food', perPerson: false, optional: false, paidBy: '', attachStop: '' }

function QuickAdd({ trip, members, meId, canWrite, previewOpen }: { trip: Trip; members: { userId: ID }[]; meId?: ID; canWrite: boolean; previewOpen?: boolean }) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, paidBy: meId ?? '' })
  const [more, setMore] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    // Refused BEFORE validation so the typed line survives for the retry.
    if (refuseWhileStaged(previewOpen)) return
    if (!canWrite) { toast('You can no longer edit this trip.', 'err'); return }
    const problem = validateForm(form)
    if (problem) { toast(problem, 'err'); return }
    const addOutcome = addExpense(trip.id, patchOf(form), meId ?? null)
    if (addOutcome === 'applied') {
      setForm(f => ({ ...f, label: '', amount: '' }))
      toast('Expense added')
    } else if (addOutcome === 'refused') {
      toast('You can no longer edit this trip.', 'err')
    }
  }

  return (
    <form className="quick-add" onSubmit={submit}>
      <div className="quick-add-row">
        <input className="input" placeholder="What was it: e.g. Houseboat boarding" aria-label="Expense name" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        <input className="input qa-amount" type="number" min={0} placeholder="₹" aria-label="Amount in rupees" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
        <button type="submit" className="btn btn-primary btn-sm">Add</button>
        <button type="button" className="icon-btn" aria-expanded={more} aria-label={more ? 'Hide expense options' : 'Show expense options'} onClick={() => setMore(m => !m)}>
          <MoreHorizontal size={16} />
        </button>
      </div>
      {more && (
        <div className="quick-add-more">
          <ExpenseFormFields trip={trip} members={members} form={form} setForm={setForm} />
        </div>
      )}
    </form>
  )
}

function ExpenseEditor({ trip, members, expense, onDone, meId, canWrite, previewOpen }: {
  trip: Trip
  members: { userId: ID }[]
  expense: Expense
  onDone: () => void
  meId?: ID
  canWrite: boolean
  previewOpen?: boolean
}) {
  const [form, setForm] = useState<FormState>(stateFromExpense(expense))
  // The line as this editor opened it — the baseline the patch is measured
  // against. A ref, not the prop: the prop can move under us when a
  // collaborator's edit lands, and measuring against THAT would resend every
  // field the person never touched (#829).
  const openedWith = useRef(expense)

  function submit(e: FormEvent) {
    e.preventDefault()
    // Refused before the save (and before onDone) so the editor stays open
    // with the edits intact for the retry (#334).
    if (refuseWhileStaged(previewOpen)) return
    if (!canWrite) { toast('You can no longer edit this trip.', 'err'); return }
    const problem = validateForm(form)
    if (problem) { toast(problem, 'err'); return }
    // #829: the store reports what it did. The editor used to announce a save
    // the store refused — or one it never found a line for — and close on a row
    // that had not changed. The person was told the edit worked while the old
    // amount was still on screen. Only an applied write earns the success
    // sentence and the close. A refusal keeps the editor open, exactly as the
    // two branches above do, because the typed values are the retry.
    const outcome = updateExpense(trip.id, expense.id, changedFields(form, openedWith.current), meId ?? null)
    if (outcome === 'no-such-line') {
      toast('That expense is no longer on this trip. It was not saved.', 'err')
      return
    }
    if (outcome === 'refused') return
    toast('Expense updated')
    onDone()
  }

  return (
    <form className="expense-edit" onSubmit={submit}>
      <div className="quick-add-row">
        <input className="input" aria-label="Expense name" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        <input className="input qa-amount" type="number" min={0} aria-label="Amount in rupees" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
      </div>
      <ExpenseFormFields trip={trip} members={members} form={form} setForm={setForm} />
      <div className="bud-editor-actions">
        <button type="submit" className="btn btn-primary btn-sm">Save changes</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
