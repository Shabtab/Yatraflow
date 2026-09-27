// ============ Trip workspace — Budget tab ============
// v0.36 redesign: everything attributed, nothing sparse. A four-tile metric
// strip answers "are we over?" in one glance; per-day bars stack each day's
// expenses + drive against the daily average; expense lines gain an inline
// quick-add, in-place editing (updateExpense) and a paid-by tag that powers a
// who-paid/who-owes balances card with the simplest settlement.
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  BedDouble, Car, Fuel, LifeBuoy, Mountain, MoreHorizontal, Pencil,
  RotateCcw, Ticket, TrainFront, Trash2, Utensils,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Trip, Expense, ExpenseCategory, ID, User } from '../../data/types'
import { EXPENSE_CATEGORIES } from '../../data/types'
import {
  addExpense, deleteExpense, restoreExpense, updateExpense,
  markExpenseSettled, markExpenseUnsettled,
  currentUser, userById, useDb,
} from '../../store/store'
import { computeTotals, getAssumptions, formatInr, isRoundTrip, safeToSpendPerDay } from '../../lib/engine'
import { amountRefusal } from '../../lib/expenseAmount'
import { computeBalances, settleBalances, fairSharePerHead, linesTotal, openTaggedLines } from '../../lib/settlement'
import { loadFlag, saveFlag } from '../../lib/uiPrefs'
import { titleCase } from '../../lib/labels'
import { Avatar, Chip, Field, StatTile, toast, undoToast, useInView, usePageVisible } from '../../components/ui'
import { PREVIEW_BUSY } from '../../lib/previewChain'

// ================= Budget tab =================

/** Category → icon + bar color (color tokens live in styles.css so themes
 *  can retune them; the icon set mirrors CatIcon's language). */
const CAT_META: Record<ExpenseCategory, { icon: LucideIcon; color: string }> = {
  transport: { icon: Car, color: 'var(--cat-transport)' },
  accommodation: { icon: BedDouble, color: 'var(--cat-accommodation)' },
  food: { icon: Utensils, color: 'var(--cat-food)' },
  activities: { icon: Mountain, color: 'var(--cat-activities)' },
  'entry-fees': { icon: Ticket, color: 'var(--cat-entry-fees)' },
  'tolls-parking': { icon: Fuel, color: 'var(--cat-tolls-parking)' },
  'local-travel': { icon: TrainFront, color: 'var(--cat-local-travel)' },
  'emergency-buffer': { icon: LifeBuoy, color: 'var(--cat-emergency-buffer)' },
}


/** −₹6,168 with a real minus sign — formatInr alone renders "₹-6,168". */
function fmtNeg(n: number): string { return `−${formatInr(-n)}` }

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
            <option value="">— whole trip —</option>
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

export function BudgetTab({ trip, totals, editable, previewOpen }: {
  trip: Trip
  totals: ReturnType<typeof computeTotals>
  editable: boolean
  /** true while the workspace holds a staged change — every expense writer
   *  below writes the committed row directly, so each refuses instead of
   *  landing under the preview (#334, same policy as the timeline's). */
  previewOpen?: boolean
}) {
  const visible = usePageVisible()
  const dayBarsRef = useRef<HTMLDivElement>(null)
  const categoryBarsRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const optionalBarsRef = useRef<HTMLDivElement>(null)
  const daysInView = useInView(dayBarsRef)
  const categoriesInView = useInView(categoryBarsRef)
  const heroInView = useInView(heroRef)
  const optionalInView = useInView(optionalBarsRef)
  const db = useDb()
  const me = currentUser(db)
  const members = trip.members ?? []
  const [editingId, setEditingId] = useState<ID | null>(null)
  const [watchOptional, setWatchOptional] = useState<boolean>(() => loadFlag('optional_watch', false))
  // M6 B4 — settle-up: the id currently being toggled (AGENTS 6a: async
  // write-through needs its input guard matching the visual state).
  const [busySettleId, setBusySettleId] = useState<ID | null>(null)

  const groupTarget = trip.budgetPerPersonInr * trip.travellers
  const remaining = groupTarget - totals.totalCostInr
  const pctUsed = Math.min(150, Math.round((totals.totalCostInr / Math.max(1, groupTarget)) * 100))
  const perPersonDeltaPct = Math.round(((totals.costPerPersonInr - trip.budgetPerPersonInr) / Math.max(1, trip.budgetPerPersonInr)) * 100)
  const A = getAssumptions(trip)
  // Pacing: how much the group can still spend per day without blowing the
  // target. Null when no budget is set — the tile then asks for one instead
  // of inventing a number.
  const pacing = safeToSpendPerDay(trip, totals.totalCostInr)

  // Per-day bars: over the daily average by >15% = amber, with one nudge.
  const days = totals.byDay
  const avg = totals.costPerDayInr
  const maxDay = Math.max(avg, ...days.map(d => d.totalInr), 1)
  const overAvg = trip.days.length > 1
    ? days.filter(d => d.totalInr > avg * 1.15).sort((a, b) => b.totalInr - a.totalInr)[0]
    : undefined

  const cats = EXPENSE_CATEGORIES
    .map(c => [c, totals.byCategory[c] ?? 0] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const maxCat = cats.length ? cats[0][1] : 1

  // I-19 — the balances measure the OPEN lines: fair share = open tagged total
  // ÷ travellers, credited to whoever fronted those same lines. One population
  // on both sides, so the card nets to zero and marking a line settled really
  // does remove it — settle every line and every row reads 0. The trip estimate
  // is deliberately NOT part of this card any more: it stays in the metric strip
  // above, which is where a planning figure belongs. Math lives in the pure
  // lib/settlement.ts (unit-tested there; the component is presentation only).
  // Newest-settled first in the history so the last action is on top.
  const openExpenses = trip.expenses.filter(e => !e.settled)
  const settledExpenses = trip.expenses.filter(e => e.settled).sort((a, b) => (b.settled?.at ?? 0) - (a.settled?.at ?? 0))
  // I-6 nudge: only tagged lines move money between people, so both the "still
  // to square up" count and the card's fair share are over those alone (an
  // untagged shared-kitty line owes nobody anything) — and both come from the
  // same two helpers, so the figures can never disagree.
  const openPayable = openTaggedLines(trip.expenses)
  const openPayableTotal = linesTotal(openPayable, trip.travellers)
  const settledTotal = linesTotal(settledExpenses, trip.travellers)
  const balances = computeBalances(members, trip.expenses, trip.travellers, userById)
  const fairShare = fairSharePerHead(trip.travellers, openPayableTotal)
  const tagged = openPayable.length > 0
  const transfers = settleBalances(balances)
  const nameOf = (u: User | undefined) => u?.profile.name ?? 'Traveller'

  return (
    <div>
      <div className="metric-strip" role="group" aria-label="Budget at a glance">
        <StatTile label="Per person" value={formatInr(totals.costPerPersonInr)}
          sub={<>target {formatInr(trip.budgetPerPersonInr)}{' '}
            {perPersonDeltaPct !== 0 && <b className={perPersonDeltaPct > 0 ? 'metric-bad' : 'metric-good'}>{perPersonDeltaPct > 0 ? '+' : '−'}{Math.abs(perPersonDeltaPct)}%</b>}</>} />
        <StatTile label="Per day" value={formatInr(totals.costPerDayInr)}
          sub={<>across {trip.days.length} {trip.days.length === 1 ? 'day' : 'days'}</>} />
        <StatTile label="Remaining vs target"
          value={<span className={remaining < 0 ? 'metric-bad' : 'metric-good'}>{remaining < 0 ? fmtNeg(remaining) : formatInr(remaining)}</span>}
          sub={<>group target {formatInr(groupTarget)}</>} />
        <StatTile label="Spent of target" value={`${pctUsed}%`}
          sub={<>{formatInr(totals.totalCostInr)} of {formatInr(groupTarget)}</>} />
        {pacing ? (
          <StatTile label="Safe to spend / day"
            value={<span className={pacing.perDayInr < 0 ? 'metric-bad' : ''}>{formatInr(pacing.perDayInr)}</span>}
            sub={<>{formatInr(pacing.perPersonPerDayInr)} per person · {pacing.daysLeft === 0 ? 'trip over' : `${pacing.daysLeft} day${pacing.daysLeft !== 1 ? 's' : ''} left`}</>} />
        ) : (
          <StatTile label="Safe to spend / day" value="—"
            sub={<>{Number.isFinite(totals.totalCostInr)
              ? 'Set a per-person target in Trip settings to see pacing'
              : 'Pacing needs a readable spend figure — fix or remove the line that broke it'}</>} />
        )}
      </div>

      {/* Capture bar sits above everything — an expense should take one
          glance at the metrics and one row, not a hunt for the right card. */}
      {editable && <QuickAdd trip={trip} members={members} meId={me?.id} topline previewOpen={previewOpen} />}

      <div className="two-col">
        <div>
          <div className="card">
            <h3>Cost per day</h3>
            <p className="hint-text" style={{ margin: '4px 0 14px' }}>
              Day expenses + that day’s drive{avg > 0 && <> · <span className="avg-key" aria-hidden /> tick = daily average ({formatInr(avg)})</>}{avg > 0 && <> · <span className="daybar-over" aria-hidden>▲</span> = over the average</>}
            </p>
            <div className="daybars" ref={dayBarsRef} data-motion-paused={!visible || !daysInView}>
              {days.map(d => {
                const over = avg > 0 && d.totalInr > avg * 1.15
                return (
                  <div key={d.dayIndex} className="daybar-row">
                    <span className="daybar-label">Day {d.dayIndex + 1}</span>
                    <div className="daybar-track">
                      <div className="daybar-fill" style={{ width: `${(d.totalInr / maxDay) * 100}%`, background: over ? 'var(--saffron)' : 'var(--teal)' }} />
                      {avg > 0 && <span className="daybar-avg" style={{ left: `${(avg / maxDay) * 100}%` }} aria-hidden />}
                    </div>
                    <span className="daybar-meta">
                      <b>{formatInr(d.totalInr)}</b>
                      {/* shape cue so "over average" isn't fill-colour-only */}
                      {over && <><span className="daybar-over" aria-hidden>▲</span><span className="sr-only">above the daily average</span></>}
                      <span className="muted">{d.stops} {d.stops === 1 ? 'stop' : 'stops'} · {Math.round(d.distanceKm)} km</span>
                    </span>
                  </div>
                )
              })}
            </div>
            {overAvg && (
              <p className="hint-text" style={{ marginTop: 10 }}>
                Day {overAvg.dayIndex + 1} runs {Math.round(((overAvg.totalInr - avg) / avg) * 100)}% over the daily average — trim an optional line or shorten the drive.
              </p>
            )}
          </div>

          <div className="card">
            <h3>Where the money goes</h3>
            <p className="hint-text" style={{ margin: '4px 0 14px' }}>
              {A.kmPerLiter
                ? <>All figures are estimates in INR. Transport is fuel-based: route distance{isRoundTrip(trip) ? ' (incl. return drive)' : ''} ≈{Math.round(totals.totalDistanceKm)} km ÷ {A.kmPerLiter} km/L ≈ <b>{Math.round(totals.totalDistanceKm / A.kmPerLiter)} L</b> of fuel × ₹{A.fuelPricePerL}/L ({A.fuelPriceIsUserSet ? 'your local pump price' : 'indicative petrol price — actual consumption varies'}).</>
                : <>All figures are estimates in INR. Transport is derived from route distance × ₹{A.inrPerKm}/km for {trip.transportMode}.</>}
              {totals.lodgingNights > 0 && (
                <> Stay is priced from your hotel stops: {totals.lodgingNights} overnight base{totals.lodgingNights !== 1 ? 's' : ''} — the drive needs a stay — × {totals.lodgingRooms} room{totals.lodgingRooms !== 1 ? 's' : ''} × ₹{totals.lodgingRatePerNight.toLocaleString('en-IN')}/night.</>
              )}
            </p>
            <div className="budget-bars catbars" ref={categoryBarsRef} data-motion-paused={!visible || !categoriesInView}>
              {cats.map(([c, v]) => {
                const meta = CAT_META[c]
                const Icon = meta.icon
                return (
                  <div key={c} className="budget-bar-row">
                    <span className="cat-name">
                      <span className="cat-chip" style={{ background: `color-mix(in srgb, ${meta.color} 15%, transparent)` }}>
                        <Icon size={13} style={{ color: meta.color }} aria-hidden />
                      </span>
                      {titleCase(c)}
                    </span>
                    <div className="budget-bar-track">
                      <div className="budget-bar-fill" style={{ width: `${(v / maxCat) * 100}%`, background: meta.color }} />
                    </div>
                    <b className="num">{formatInr(v)}</b>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="card">
            <div className="row-between">
              <h3>Expense lines · {trip.expenses.length}</h3>
            </div>
            <hr className="divider" />
            {trip.expenses.length === 0
              ? <p className="muted small">No expense lines yet — add the big ones first (stay, fuel, food).</p>
              : (
                <table className="compare-table expense-table" tabIndex={0} aria-label="Expense lines">
                  <thead><tr><th>Line</th><th>Paid by</th><th className="num">Amount</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {trip.expenses.map(e => {
                      const meta = CAT_META[e.category]
                      const Icon = meta.icon
                      const payer = e.paidBy ? userById(e.paidBy) : undefined
                      return editingId === e.id ? (
                        <tr key={e.id}>
                          <td colSpan={4}>
                            <ExpenseEditor trip={trip} members={members} expense={e} onDone={() => setEditingId(null)} previewOpen={previewOpen} />
                          </td>
                        </tr>
                      ) : (
                        <tr key={e.id}>
                          <td>
                            <span className="exp-line">
                              <span className="cat-chip sm" style={{ background: `color-mix(in srgb, ${meta.color} 15%, transparent)` }}>
                                <Icon size={12} style={{ color: meta.color }} aria-hidden />
                              </span>
                              {e.label}
                            </span>
                            {e.perPerson && <span className="chip chip-info" style={{ marginLeft: 6 }}>per person</span>}
                            {e.optional && <span className="chip chip-saffron" style={{ marginLeft: 6 }}>optional</span>}
                          </td>
                          <td>{payer
                            ? <span className="payer-cell"><Avatar user={payer} /> {payer.profile.name}</span>
                            : <span className="muted">Shared kitty</span>}</td>
                          <td className="num">{formatInr(e.amountInr * (e.perPerson ? trip.travellers : 1))}</td>
                          <td>{editable && (
                            <span className="row-actions">
                              <button className="icon-btn" aria-label={`Edit ${e.label}`} onClick={() => setEditingId(e.id)}><Pencil size={14} /></button>
                              <button className="icon-btn" aria-label={`Delete ${e.label}`} onClick={() => {
                                // #334: a direct write while a preview is open would
                                // make Keep refuse (stale base) — refuse it here instead.
                                if (previewOpen) { toast(PREVIEW_BUSY, 'err'); return }
                                const idx = trip.expenses.findIndex(x => x.id === e.id)
                                deleteExpense(trip.id, e.id)
                                undoToast(`Removed “${e.label}”`, () => {
                                  restoreExpense(trip.id, e, idx)
                                  toast(`Restored “${e.label}”`)
                                })
                              }}><Trash2 size={14} /></button>
                            </span>
                          )}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            <p className="hint-text" style={{ marginTop: 10 }}>
              Amounts are group totals unless marked per person. Tag who paid to settle up below.
            </p>
          </div>
        </div>

        <div>
          <div className="budget-hero" ref={heroRef} data-motion-paused={!visible || !heroInView}>
            <span className="budget-hero-label">Group budget</span>
            <div className="budget-hero-num">{formatInr(totals.totalCostInr)}</div>
            <div className="budget-hero-sub">
              {remaining < 0
                ? <><b>{formatInr(-remaining)} over</b> the {formatInr(groupTarget)} group target · {formatInr(totals.costPerPersonInr)}/person · {formatInr(totals.costPerDayInr)}/day</>
                : <><b>{formatInr(remaining)} under</b> the {formatInr(groupTarget)} group target · {formatInr(totals.costPerPersonInr)}/person · {formatInr(totals.costPerDayInr)}/day</>}
            </div>
            <div className="budget-bar-track" style={{ marginTop: 10 }}>
              <div className="budget-bar-fill" style={{ width: `${Math.min(100, pctUsed)}%`, background: pctUsed > 100 ? 'var(--coral)' : pctUsed > 85 ? 'var(--saffron)' : 'var(--teal)' }} />
            </div>
            <div className="budget-hero-pct">
              {pctUsed}% of group budget{pctUsed > 100 ? ' — over budget' : pctUsed > 85 ? ' — getting close' : ''}
            </div>
            {remaining < 0
              ? <span className="budget-hero-action warn">Trim {formatInr(-remaining)} to hit target</span>
              : <span className="budget-hero-action ok">{formatInr(remaining)} headroom — room for one more stop</span>}
          </div>

          {trip.travellers >= 2 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h3>Who paid · who owes</h3>
              {members.length < 2
                ? <p className="hint-text" style={{ margin: '6px 0 0' }}>{tagged && <>Fair share is {formatInr(fairShare)} each. </>}Invite your crew from the Share tab, then tag who paid on expense lines — who owes whom shows up here.</p>
                : <>
                    <p className="hint-text" style={{ margin: '6px 0 10px' }}>
                      {tagged
                        ? <>Fair share is {formatInr(fairShare)} each, counted over the {openPayable.length} open tagged line{openPayable.length !== 1 ? 's' : ''}.</>
                        : settledExpenses.length > 0
                          ? <>Every tagged line is squared up — nothing left to split.</>
                          : <>Nothing to split yet — tag who paid on expense lines and balances appear here. The estimates above are your planning figure, not a debt.</>}
                    </p>
                    {tagged && (
                      <>
                        <div className="balances">
                          {balances.map(b => (
                            <div key={b.id} className="balance-row">
                              <span className="balance-who"><Avatar user={b.user} /> {nameOf(b.user)}</span>
                              {Math.abs(b.bal) <= 0.5
                                ? <span className="muted small">Settled</span>
                                : b.bal > 0
                                  ? <span className="balance-pos">gets {formatInr(b.bal)}</span>
                                  : <span className="balance-neg">owes {formatInr(-b.bal)}</span>}
                            </div>
                          ))}
                        </div>
                        {transfers.length > 0 && (
                          <p className="hint-text" style={{ marginTop: 10 }}>
                            <b>Simplest settlement:</b> {transfers.map(t => `${nameOf(t.from.user)} → ${nameOf(t.to.user)} ${formatInr(t.amount)}`).join(' · ')}
                          </p>
                        )}
                        {openPayable.length > 0 && (
                          <p className="hint-text" style={{ marginTop: 10 }}>
                            <b>{formatInr(openPayableTotal)}</b> across {openPayable.length} tagged line{openPayable.length !== 1 ? 's' : ''} still to square up — mark each settled as the money moves.
                          </p>
                        )}
                        {editable && openExpenses.length > 0 && (
                          <div className="settled-strip" style={{ marginTop: 12 }}>
                            <span className="hint-text" style={{ margin: 0 }}>
                              <b>Settle up:</b> mark a line squared up — it leaves the balances and moves to the settled history below.
                            </span>
                            <div className="settled-list">
                              {openExpenses.map(e => (
                                <div key={e.id} className="settled-row">
                                  <span className="settled-label">{e.label}</span>
                                  <span className="num muted small">{formatInr(e.amountInr * (e.perPerson ? trip.travellers : 1))}</span>
                                  <button
                                    type="button"
                                    className="btn btn-sm settled-btn"
                                    aria-label={`Mark ${e.label} settled`}
                                    disabled={busySettleId === e.id}
                                    onClick={() => {
                                      if (previewOpen) { toast(PREVIEW_BUSY, 'err'); return }
                                      if (!me?.id) return
                                      setBusySettleId(e.id)
                                      try {
                                        markExpenseSettled(trip.id, e.id, me.id)
                                        toast(`Marked “${e.label}” settled`)
                                      } finally {
                                        setBusySettleId(null)
                                      }
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
                                  <span className="num muted small">{formatInr(e.amountInr * (e.perPerson ? trip.travellers : 1))}</span>
                                  {editable && (
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      aria-label={`Reopen ${e.label}`}
                                      disabled={busySettleId === e.id}
                                      onClick={() => {
                                        if (previewOpen) { toast(PREVIEW_BUSY, 'err'); return }
                                        setBusySettleId(e.id)
                                        try {
                                          markExpenseUnsettled(trip.id, e.id)
                                          toast(`Reopened “${e.label}”`)
                                        } finally {
                                          setBusySettleId(null)
                                        }
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
                  </>}
            </div>
          )}

          <div className="card" style={{ marginTop: trip.travellers >= 2 ? 14 : 0 }}>
            <h3>Essential vs optional</h3>
            <hr className="divider" />
            <div className="budget-bars" ref={optionalBarsRef} data-motion-paused={!visible || !optionalInView}>
              <div className="budget-bar-row">
                <span>Essential</span>
                <div className="budget-bar-track"><div className="budget-bar-fill" style={{ width: `${(totals.essentialInr / Math.max(1, totals.totalCostInr)) * 100}%`, background: 'var(--teal)' }} /></div>
                <b className="num">{formatInr(totals.essentialInr)}</b>
              </div>
              <div className="budget-bar-row">
                <span>Optional</span>
                <div className="budget-bar-track"><div className="budget-bar-fill" style={{ width: `${(totals.optionalInr / Math.max(1, totals.totalCostInr)) * 100}%`, background: 'var(--saffron)' }} /></div>
                <b className="num">{formatInr(totals.optionalInr)}</b>
              </div>
            </div>
            <p className="hint-text" style={{ marginTop: 10 }}>Optional includes buffers & shopping that you can trim to save.</p>
            {/* Optional-spend watch (user ask, P1-E follow-up): a TIP, not a
                change — opt-in, session-persistent, never edits anything. */}
            <div className="row-between" style={{ marginTop: 8, gap: 8 }}>
              <span className="small muted">A soft line at 20% of the estimate — tips only, nothing changes.</span>
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
                <p className={`small ${pct > OPTIONAL_WATCH_PCT ? 'dayplanner-red' : 'muted'}`} style={{ marginTop: 6 }} role="status">
                  Optional watch: {formatInr(totals.optionalInr)} — {Math.round(pct)}% of the estimate,{' '}
                  {pct > OPTIONAL_WATCH_PCT ? `over the ${OPTIONAL_WATCH_PCT}% soft line. Trimming one optional line brings it back under.` : `inside the ${OPTIONAL_WATCH_PCT}% soft line.`}
                </p>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}

// ================= Quick add + inline edit =================

const EMPTY_FORM: FormState = { label: '', amount: '', category: 'food', perPerson: false, optional: false, paidBy: '', attachStop: '' }

function QuickAdd({ trip, members, meId, topline, previewOpen }: { trip: Trip; members: { userId: ID }[]; meId?: ID; topline?: boolean; previewOpen?: boolean }) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, paidBy: meId ?? '' })
  const [more, setMore] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    // Refused BEFORE validation so the typed line survives for the retry.
    if (previewOpen) { toast(PREVIEW_BUSY, 'err'); return }
    const problem = validateForm(form)
    if (problem) { toast(problem, 'err'); return }
    addExpense(trip.id, patchOf(form))
    setForm(f => ({ ...f, label: '', amount: '' }))
    toast('Expense added')
  }

  return (
    <form className={`quick-add${topline ? ' topline' : ''}`} onSubmit={submit}>
      <div className="quick-add-row">
        <input className="input" placeholder="What was it — e.g. Houseboat boarding" aria-label="Expense name" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
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

function ExpenseEditor({ trip, members, expense, onDone, previewOpen }: {
  trip: Trip
  members: { userId: ID }[]
  expense: Expense
  onDone: () => void
  previewOpen?: boolean
}) {
  const [form, setForm] = useState<FormState>(stateFromExpense(expense))

  function submit(e: FormEvent) {
    e.preventDefault()
    // Refused before the save (and before onDone) so the editor stays open
    // with the edits intact for the retry (#334).
    if (previewOpen) { toast(PREVIEW_BUSY, 'err'); return }
    const problem = validateForm(form)
    if (problem) { toast(problem, 'err'); return }
    updateExpense(trip.id, expense.id, patchOf(form))
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
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="submit" className="btn btn-primary btn-sm">Save changes</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
