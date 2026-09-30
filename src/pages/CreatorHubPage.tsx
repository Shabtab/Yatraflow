// ============ Creator hub ============
// Standalone home for creator-account management, extracted from the old
// "Creator mode" + "My publications" cards in Profile. Reached from the gated
// "Creator hub" nav pill (and the Profile gateway card). Requires a creator
// account; non-creators see an enable call-to-action.
//
// SHAPE (2026-09-23): rebuilt as a working dashboard rather than a settings
// page. The page now leads with performance — one ruled KPI strip, then the
// recorded-traffic trend for the selected window — because "how are my
// publications doing" is the question a creator arrives with. The creator
// profile (bio, socials, the disable switch) moved into a disclosure at the
// foot: it is a thing you set once, and it used to hold the entire fold.
//
// The trend and the per-publication rows are ONE derivation over ONE clock
// (`now` is computed once and handed to both builders), so the chart can never
// describe a different window from the numbers beneath it.
import { useCallback, useEffect, useState } from 'react'
import { InlineIcon } from '../components/icons'
import { ChevronDown, ExternalLink, Pencil } from 'lucide-react'
import { PillNav } from '../components/PillNav'
import { TrendChart, type UnlockRead } from '../components/TrendChart'
import type { PublishedItinerary } from '../data/types'
import { useDb, currentUser, updateProfile, unpublishItinerary, tripById } from '../store/store'
import {
  projectEarnings, deriveActualSales, deriveLedgerRead, payoutStatus, payoutWalk, payoutPeriodStatus,
  PAYOUT_MINIMUM_INR, PLATFORM_FEE_SUMMARY, type ActualSales,
} from '../lib/earnings'
import { fetchCreatorSales, fetchCreatorFunnel, type FunnelDailyRow } from '../lib/unlock'
import {
  buildDailySeries, buildPubFunnels, describePreLog, formatPct, funnelBarPos, funnelBarScale, FUNNEL_WINDOWS,
  type FunnelSale, type FunnelWindowDays, type PubFunnel,
} from '../lib/pubFunnel'
import { formatInr } from '../lib/engine'
import { formatHM, useTimeFormat } from '../lib/timefmt'
import { Chip, ConfirmDialog, Field, toast } from '../components/ui'
import { appLink } from '../lib/appLink'

/** Social links are stored raw and later emitted as an `href`, so a non-URL
 *  value becomes a live broken link. The inputs are `type="url"` but sit
 *  outside a form, so the browser never validates them — do it here. Accept an
 *  empty value (clearing is fine) or anything that parses as http/https. */
function isValidSocialUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** "26 Sep" — a run date, not a timestamp. */
function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** "Friday, 26 Sep" — the sentence form, where a weekday tells the reader how
 *  far away the run is without their counting. */
function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}

/** "14:12" in the reader's own 12/24-hour preference — WHEN a figure was read.
 *  A kept ledger is only honest if it says how old it is: a stale number with
 *  no age on it is not one a creator can decide anything with. */
function readAtHM(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 5)
}

/** The one clock the page renders against.
 *
 *  A component must be pure, so this is not `Date.now()` in the render body —
 *  that re-derives "now" on every render and makes the output unstable. It is
 *  read once per mount (or per retry, via `refreshClock`) and held in state, so
 *  the trend, the rows and the note all describe the same instant. Call
 *  `refreshClock()` from a Retry: a retry is a new question, asked later. */
function useStableNow(): [number, () => void] {
  const [now, setNow] = useState(() => Date.now())
  const refresh = useCallback(() => { setNow(Date.now()) }, [])
  return [now, refresh]
}

export function CreatorHubPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const myPubs = me ? db.published.filter(p => p.creatorId === me.id) : []

  const [creatorBio, setCreatorBio] = useState(me?.profile.creatorBio ?? '')
  const [youtube, setYoutube] = useState(me?.profile.socialLinks?.youtube ?? '')
  const [instagram, setInstagram] = useState(me?.profile.socialLinks?.instagram ?? '')
  const [socialErrors, setSocialErrors] = useState<{ youtube?: string; instagram?: string }>({})
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [unpubTarget, setUnpubTarget] = useState<PublishedItinerary | null>(null)
  const [hubTab, setHubTab] = useState<'overview' | 'earnings'>('overview')
  const [earningsView, setEarningsView] = useState<'actual' | 'projection'>('actual')
  /** null until the reader picks one. The tiles and pills have always SHOWN gross
   *  by default, and still do (`shownBasis`); what null tracks is that nobody has
   *  chosen yet — because the tables only take the emphasis once the basis is a
   *  choice. Before this, a fresh load greyed out Net on every ledger, and at
   *  ≤720px that is one of only three columns the mobile policy keeps. */
  const [earningsBasis, setEarningsBasis] = useState<'gross' | 'net' | null>(null)
  // Real sales (I-11): entitlements for MY publications, read through the
  // creator RLS policy. A failed read is an ERROR state with retry, not a
  // silent empty ledger — "No sales yet" and "read failed" are different
  // truths (the conflation hid a live grant bug for a whole session).
  //
  // Three things this owes the reader, in the order their absence bites:
  //   * an attempt must ANNOUNCE itself (`salesReading`), or pressing Retry
  //     looks exactly like a dead button and a creator concludes the app froze;
  //   * a failed REFRESH must not discard a ledger that already loaded — the
  //     figures stay, stamped with the moment they were read (`salesAt`), and
  //     the failure is stated beside them;
  //   * no attempt may hang forever (the abort below). "Reading…" is an
  //     unfalsifiable claim on the tab that holds the money.
  const [sales, setSales] = useState<ActualSales | null>(null)
  const [salesAt, setSalesAt] = useState<number | null>(null)
  const [salesError, setSalesError] = useState(false)
  const [salesRetry, setSalesRetry] = useState(0)
  /** Which attempt last SETTLED. Paired with `salesRetry` this is "an attempt is
   *  in flight", DERIVED rather than stored — storing it would need a setState
   *  in the effect body (which `react-hooks/set-state-in-effect` refuses, and
   *  rightly: it forces a render before the request has even been issued). */
  const [salesSettled, setSalesSettled] = useState(-1)
  const salesReading = salesRetry !== salesSettled
  // The RECORDED funnel (I-22/I-15): the dated event log, read per day so the
  // window control costs no round trip. Deliberately separate from the counter
  // tiles above, which are lifetime totals that include traffic from before
  // recording began — the two are not the same number and are labelled so.
  const [daily, setDaily] = useState<FunnelDailyRow[] | null>(null)
  /** When the log on screen was read. Kept alongside `daily` for the same reason
   *  the ledger keeps `salesAt`: a stale figure whose age is unknown is not one a
   *  reader can act on. */
  const [dailyAt, setDailyAt] = useState<number | null>(null)
  const [funnelError, setFunnelError] = useState(false)
  const [funnelRetry, setFunnelRetry] = useState(0)
  const [funnelSettled, setFunnelSettled] = useState(-1)
  const funnelReading = funnelRetry !== funnelSettled
  const [funnelDays, setFunnelDays] = useState<FunnelWindowDays>(30)
  const timeFmt = useTimeFormat()

  // A read that never answers is not a state we can render honestly, so every
  // attempt is bounded. This is far longer than the RPC takes and far shorter
  // than a creator's patience — the point is that "Reading…" always resolves
  // into a figure, or into a failure that still offers a way to ask again:
  // Retry when nothing is shown, Refresh when the loaded figures were kept.
  const LEDGER_READ_TIMEOUT_MS = 10_000
  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    const attempt = salesRetry
    // The REASON is load-bearing: `unlock.ts` logs a cancelled read differently
    // from a failed one, and with a bare `abort()` this timer is
    // indistinguishable from the effect being torn down.
    const timer = setTimeout(
      () => ac.abort(new DOMException('the sales read timed out', 'TimeoutError')),
      LEDGER_READ_TIMEOUT_MS,
    )
    // Nothing to announce here: `salesRetry` changed, so the DERIVED
    // `salesReading` is already true before this effect body runs.
    // A SUCCESS clears the error flag; an in-flight attempt does not, and does
    // not need to — `salesReading` outranks it wherever the two are read, so a
    // retry reads as "Reading…" while the last failure stays on the books.
    fetchCreatorSales({ signal: ac.signal })
      .then(rows => {
        if (!alive) return
        setSales(deriveActualSales(rows, myPubs))
        setSalesAt(Date.now())
        setSalesError(false)
      })
      // Deliberately does NOT setSales(null): a refresh that failed must leave
      // the last known good ledger on screen, with its read time, rather than
      // punish a creator for a dropped connection.
      .catch(() => { if (alive) setSalesError(true) })
      .finally(() => { clearTimeout(timer); if (alive) setSalesSettled(attempt) })
    return () => { alive = false; clearTimeout(timer); ac.abort() }
  }, [me?.id, salesRetry]) // eslint-disable-line react-hooks/exhaustive-deps
  // Same shape as the sales read above, and for the same reason: a log with
  // nothing in it and a log that could not be read are different truths, and a
  // funnel that quietly reads zero over real traffic is the exact conflation
  // the sales ledger already had to fix once. It is bounded for the same
  // reason too — a retry that cannot be told apart from no retry is not a
  // recovery path.
  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    const attempt = funnelRetry
    const timer = setTimeout(
      () => ac.abort(new DOMException('the funnel read timed out', 'TimeoutError')),
      LEDGER_READ_TIMEOUT_MS,
    )
    fetchCreatorFunnel({ signal: ac.signal })
      .then(rows => { if (alive) { setFunnelError(false); setDaily(rows); setDailyAt(Date.now()) } })
      // Same policy as the sales read above, and for the same reason: a refresh
      // that failed must not blank a log that loaded. `daily` survives, stamped
      // with the moment it was read, and the chart only voids when nothing ever
      // loaded — which is why this catch no longer clears it.
      .catch(() => { if (alive) setFunnelError(true) })
      .finally(() => { clearTimeout(timer); if (alive) setFunnelSettled(attempt) })
    return () => { alive = false; clearTimeout(timer); ac.abort() }
  }, [me?.id, funnelRetry])

  const loggedIn = Boolean(me)
  useEffect(() => { if (!loggedIn) onNavigate('/auth') })
  if (!me) return null

  return (
    <div className="container hub-page">
      <header className="hub-head">
        <div className="hub-head-id">
          <h1>Creator hub</h1>
          <p className="muted small">{me.email}</p>
        </div>
        {me.profile.isCreator && (
          <a className="btn btn-outline btn-sm" {...appLink(`/creator/${me.id}`)}>
            <InlineIcon icon={ExternalLink} size={13} gap={5} />View public page
          </a>
        )}
      </header>

      {!me.profile.isCreator ? (
        <div className="card">
          <h2 className="card-title hub-panel-title">Creator mode</h2>
          <p className="hint-text" style={{ margin: '6px 0 12px' }}>
            Creator mode is a branding badge: your bio and social links appear on the itineraries you publish, and you get a public creator page others can follow.
          </p>
          <button className="btn btn-saffron" onClick={() => { updateProfile({ isCreator: true }); toast('Creator mode enabled — your bio and links now show on published itineraries.') }}>
            Enable creator mode
          </button>
        </div>
      ) : (
        <>
          {/* One view switch for the page, sitting above everything it controls
              so the tabs read as the page's axis rather than a decoration on a
              card. */}
          <PillNav className="filter-pillbar hub-tabs" role="group" aria-label="Creator hub view" activeKey={hubTab}>
            {([['overview', 'Overview'], ['earnings', 'Earnings']] as const).map(([k, label]) => (
              <button key={k} type="button" data-pill-key={k} className={`clickable-chip chip${hubTab === k ? ' on-teal' : ''}`}
                onClick={() => { setHubTab(k) }} aria-pressed={hubTab === k}>{label}</button>
            ))}
          </PillNav>

          {/* ONE status and ONE control for the page's reads, on BOTH tabs. This
              row used to live inside the Earnings ledger, so Overview — whose
              unlock column derives from the same ledger — could go stale with no
              way to ask again, while the funnel beside it offered Retry. It
              re-reads BOTH, because a control reachable only after a failure is
              not reachable at all: the funnel's kept-log branch needs "loaded,
              then a later read failed", and its own Retry cannot produce that —
              the same trap the ledger's Refresh had to fix once already. */}
          {/* The row must exist whenever the sales read has SETTLED, not only when
              it succeeded. Gated on `salesAt !== null` alone, a first read that
              failed left no read time and no Refresh anywhere on the page — the one
              moment a creator needed both — and recovery came from an alert instead.
              While the first read is still in flight there is nothing settled to
              stamp, and the tiles say "Reading…". */}
          {(salesAt !== null || salesError) && (
            <div className="row-between hub-read-stamp">
              <span className="small muted">
                {salesAt !== null ? `Sales read ${formatHM(readAtHM(salesAt), timeFmt)}` : 'Sales not read yet'}
                {dailyAt !== null && ` · Traffic read ${formatHM(readAtHM(dailyAt), timeFmt)}`}
              </span>
              <button className="btn btn-outline btn-sm"
                onClick={() => { setSalesRetry(n => n + 1); setFunnelRetry(n => n + 1) }}
                disabled={salesReading || funnelReading}>
                {salesReading || funnelReading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          )}

          {hubTab === 'overview' ? (
            <HubOverview myPubs={myPubs} onUnpublish={setUnpubTarget} onNavigate={onNavigate}
              daily={daily} dailyAt={dailyAt} salesRows={sales?.rows ?? []} funnelError={funnelError}
              onRetry={() => { setFunnelRetry(n => n + 1) }} days={funnelDays} onDays={setFunnelDays}
              funnelReading={funnelReading}
              unlockRead={sales !== null ? 'ready' : salesReading ? 'reading' : 'failed'}
              salesError={salesError} salesAt={salesAt} salesReading={salesReading}
              onRetrySales={() => { setSalesRetry(n => n + 1) }} />
          ) : (
            <EarningsTab myPubs={myPubs} sales={sales} salesError={salesError} salesAt={salesAt}
              salesReading={salesReading}
              onRetry={() => { setSalesRetry(n => n + 1) }} view={earningsView} onView={setEarningsView}
              basis={earningsBasis} onBasis={setEarningsBasis} />
          )}

          {/* The profile is a thing you set once. It used to own the fold and
              push every number below it; it now closes the page instead. */}
          <details className="card hub-profile">
            <summary className="hub-profile-summary">
              <span className="card-title hub-panel-title">Creator profile</span>
              <Chip tone="ok">Enabled</Chip>
              <ChevronDown className="hub-chev" size={16} aria-hidden />
            </summary>
            <p className="hint-text" style={{ margin: '10px 0 12px' }}>
              Publishing to Explore is open to everyone — do it from any trip&apos;s Share tab.
              Creator mode is a branding badge: your bio and social links appear
              on the itineraries you publish.
            </p>
            <Field label="Creator bio"><textarea className="textarea" value={creatorBio} onChange={e => { setCreatorBio(e.target.value) }} placeholder="Tell readers who you are and why they should trust your routes." /></Field>
            <div className="form-row">
              <Field label="YouTube link" error={socialErrors.youtube}><input className="input" type="url" inputMode="url" value={youtube} onChange={e => { setYoutube(e.target.value); if (socialErrors.youtube) setSocialErrors(s => ({ ...s, youtube: undefined })) }} placeholder="https://youtube.com/@…" /></Field>
              <Field label="Instagram link" error={socialErrors.instagram}><input className="input" type="url" inputMode="url" value={instagram} onChange={e => { setInstagram(e.target.value); if (socialErrors.instagram) setSocialErrors(s => ({ ...s, instagram: undefined })) }} placeholder="https://instagram.com/…" /></Field>
            </div>
            <div className="hub-profile-actions">
              <button className="btn btn-primary btn-sm" onClick={() => {
                const yt = youtube.trim()
                const ig = instagram.trim()
                const nextErrors = {
                  youtube: yt && !isValidSocialUrl(yt) ? 'Enter a full link starting with http:// or https://' : undefined,
                  instagram: ig && !isValidSocialUrl(ig) ? 'Enter a full link starting with http:// or https://' : undefined,
                }
                setSocialErrors(nextErrors)
                if (nextErrors.youtube || nextErrors.instagram) return
                updateProfile({
                  creatorBio: creatorBio.trim() || undefined,
                  socialLinks: (yt || ig)
                    ? { youtube: yt || undefined, instagram: ig || undefined }
                    : undefined,
                })
                toast('Creator profile saved')
              }}>Save creator profile</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setConfirmDisable(true) }}>Disable creator mode</button>
            </div>
          </details>
        </>
      )}

      <ConfirmDialog
        open={confirmDisable}
        title="Disable creator mode?"
        body="Your bio and social links stop showing on your published itineraries and the creator badge is removed. Your publications stay live — you can re-enable the badge anytime."
        confirmLabel="Disable"
        danger
        onConfirm={() => {
          updateProfile({ isCreator: false })
          setConfirmDisable(false)
          toast('Creator mode disabled — your publications stay live.')
        }}
        onClose={() => { setConfirmDisable(false) }}
      />
      <ConfirmDialog
        open={!!unpubTarget}
        title={`Unpublish “${unpubTarget?.title ?? ''}”?`}
        body="It leaves Explore immediately and stops selling. The trip itself is not touched, and anyone who already unlocked it keeps access — you can publish it again from its Share tab. Its views, forks and sales stay on this page."
        confirmLabel="Unpublish"
        danger
        onConfirm={() => {
          if (!unpubTarget) return
          unpublishItinerary(unpubTarget.tripId)
          setUnpubTarget(null)
          toast('Unpublished — removed from Explore')
        }}
        onClose={() => { setUnpubTarget(null) }}
      />
    </div>
  )
}

/** "1 unlock" / "3 unlocks". The counts sit inside sentences, and a plan with a
 *  single unlock used to read "1 unlocks" — the kind of small wrongness that
 *  costs a careful reader's trust in the bigger numbers beside it. */
function unit(n: number, noun: string): string {
  return n === 1 ? noun : `${noun}s`
}

/** One publication's recorded funnel, for the selected window.
 *
 *  Says NOTHING RECORDED rather than printing three zeroes, because "no traffic
 *  yet" and "traffic that converted at 0%" are different claims and only one of
 *  them is a measurement.
 *
 *  The lifetime line is the honesty: a window's numbers sit beside that
 *  publication's own all-time totals, because the counters predate the event
 *  log. "38 forks" alone cannot tell a creator whether that is most of their
 *  forks or a slice of them. */
function FunnelLine({ f, funnelRead, unlockRead = 'ready', windowLabel }: { f: PubFunnel | undefined; funnelRead: UnlockRead; unlockRead?: UnlockRead; windowLabel: string }) {
  if (!f) return null
  // The all-time line reads the counters from the hydrated cache, so it is true
  // whichever way the log read went. The windowed steps are NOT, so an unreadable
  // log withholds them and says why — "no traffic", "not read yet" and "traffic I
  // could not read" are three different claims, and only one is a measurement.
  const lifetime = (
    <span className="pf-lifetime muted num">
      All time {f.lifetimeViews} {unit(f.lifetimeViews, 'visit')} · {f.lifetimeForks} {unit(f.lifetimeForks, 'fork')} · {f.lifetimeUnlocks} {unit(f.lifetimeUnlocks, 'unlock')}
    </span>
  )
  // The counters-vs-log sentence. Computed once here (one derivation, shared
  // with the public page through describePreLog) so the two surfaces cannot
  // disagree about why the numbers differ.
  const preLog = describePreLog(f)
  // IN FLIGHT is its own truth, and it is the one the rows used to get wrong: they
  // announced "nothing to measure for this plan" while the panel above them said
  // "Reading recorded traffic…". A claim about traffic must not be made before the
  // read that reports it — the same rule the unlock stage beside them follows.
  if (funnelRead === 'reading') {
    return (
      <>
        <span className="muted">Traffic still being read…</span>
        {lifetime}
      </>
    )
  }
  if (funnelRead === 'failed') {
    return (
      <>
        <span className="muted">Traffic could not be read just now.</span>
        {lifetime}
      </>
    )
  }
  if (f.unreported) {
    return (
      <>
        <span className="muted">No recorded traffic yet — nothing to measure for this plan.</span>
        {lifetime}
      </>
    )
  }
  return (
    <>
      {/* The accepted hierarchy: the funnel is the row's largest element, each
          stage in the hue the chart above uses for that same stage, so a stage
          means one thing everywhere on the page. */}
      <span className="hub-lead-steps">
        {/* The window, stated ONCE per row rather than implied: the figures
            below are windowed, and "12 / 4 / 1" alone left the reader holding
            the selected window in their head. */}
        <span className="hub-lead-window">in {windowLabel}</span>
        <span className="hub-lead-step hub-lead-visits"><b className="hub-lead-n">{f.views}</b> {unit(f.views, 'visit')}</span>
        {/* #363 — the denominator is named: both stages are one-per-browser-
            session (the store dedupes views and forks the same way), so "of
            visits" alone left the unit to be guessed and made a fork rate over
            two different kinds of count read as a conversion. */}
        <span className="hub-lead-step hub-lead-forks"><b className="hub-lead-n">{f.forks}</b> {unit(f.forks, 'fork')} <span className="hub-lead-rate">{formatPct(f.forkRatePct)} of visit-sessions</span></span>
        {/* Unlocks come from the sales ledger, so an unread ledger leaves this
            stage UNKNOWN. Printing 0 here would say "nobody bought" — the same
            conflation the branches above avoid for the log as a whole. */}
        {unlockRead === 'ready'
          ? <span className="hub-lead-step hub-lead-unlocks"><b className="hub-lead-n">{f.unlocks}</b> {unit(f.unlocks, 'unlock')} <span className="hub-lead-rate">{formatPct(f.unlockRatePct)} of forks</span></span>
          : <span className="hub-lead-step muted">{unlockRead === 'reading' ? 'unlocks still being read' : 'unlocks could not be read'}</span>}
        {f.forksExceedViews && (
          <span className="muted">· more forks than visits — Explore&apos;s card forks a plan without opening it</span>
        )}
      </span>
      {/* The drop-off, as two separated marks on an empty track: the track is
          the traffic you had, the marks are what survived each step, and the
          gap between them keeps them from reading as one stripe. (The earlier
          version overlaid all three at the same origin, which looked like a
          three-colour bar and said nothing the figures hadn't.)
          #358 — BOTH marks are laid out against ONE scale, `funnelBarScale`. The
          bar used to be `min(100, …)`, so a 140% fork rate drew a full-width bar
          identical to a 100% one and put the unlock mark at `calc(100% + 3px)` —
          off its own track. The rate is deliberately NOT clamped (a fork needs
          no visit: Explore's card forks a plan without opening it), so the TRACK
          scales to the row's largest rate and both marks stay on it. The
          inversion stays visible in the bar, not only in the sentence above. */}
      <span className="hub-lead-bar" aria-hidden="true">
        {(() => {
          const scale = funnelBarScale({ forkRatePct: f.forkRatePct, unlockRatePct: f.unlockRatePct, hasUnlock: unlockRead === 'ready' })
          return (
            <>
              <i style={{ inlineSize: funnelBarPos(f.forkRatePct, scale) }} />
              {unlockRead === 'ready' && (
                <i className="is-unlock" style={{ insetInlineStart: `calc(${funnelBarPos(f.forkRatePct, scale)} + 3px)`, inlineSize: `max(0%, calc(${funnelBarPos(f.unlockRatePct, scale)} - ${funnelBarPos(f.forkRatePct, scale)}))` }} />
              )}
            </>
          )
        })()}
      </span>
      {preLog && <span className="pf-prelog muted">{preLog}</span>}
      {lifetime}
    </>
  )
}

/** Overview: the KPI strip, the recorded-traffic trend, and the publication
 *  manager rows — the trend and the rows built from one derivation over one
 *  clock, so the picture and the table describe the same window. */
export function HubOverview({ myPubs, onUnpublish, onNavigate, daily, dailyAt, salesRows, funnelError, onRetry, days, onDays, unlockRead, salesError, salesAt, salesReading, funnelReading, onRetrySales }: {
  myPubs: PublishedItinerary[]
  onUnpublish: (p: PublishedItinerary) => void
  onNavigate: (r: string) => void
  /** null while the funnel read is in flight; [] when it succeeded empty. */
  daily: FunnelDailyRow[] | null
  /** When `daily` was read. Non-null alongside a non-null `daily`. */
  dailyAt: number | null
  /** The sales ledger's own rows — the unlock stage's only source. */
  salesRows: readonly FunnelSale[]
  funnelError: boolean
  onRetry: () => void
  days: FunnelWindowDays
  onDays: (d: FunnelWindowDays) => void
  /** Whether the sales ledger — and therefore every unlock figure — has been
   *  read. Passed down rather than inferred, because "no sales" and "no answer
   *  yet" look identical in the row array. */
  unlockRead: UnlockRead
  /** The ledger read failed. Its own flag and its own retry: Overview used to
   *  offer recovery only for the funnel read, leaving the money-bearing column
   *  the one thing on the page you could not ask again. */
  salesError: boolean
  /** When the figures on screen were read, or null if none ever loaded. The
   *  timestamp is the whole point of keeping a stale ledger — a number whose
   *  age is unknown is not one a creator can act on. */
  salesAt: number | null
  /** An attempt is in flight, including a retry. A retry that renders
   *  identically to the state before it was pressed is a dead button. */
  salesReading: boolean
  /** The funnel read's own in-flight flag, for the same reason. */
  funnelReading: boolean
  onRetrySales: () => void
}) {
  const totalViews = myPubs.reduce((s, p) => s + p.views, 0)
  const totalForks = myPubs.reduce((s, p) => s + p.copies, 0)
  const timeFmt = useTimeFormat()
  // ONE clock for the whole window, held in state rather than re-derived on
  // every render (a component must be pure). The trend and the rows are both
  // cut from it, so switching the window cannot leave the chart a day ahead of
  // the table, and no surface has to re-derive "now" for itself. A Retry
  // re-reads the clock: asking again is a new question, asked later.
  const [now, refreshClock] = useStableNow()
  const handleRetryFunnel = useCallback(() => { refreshClock(); onRetry() }, [refreshClock, onRetry])
  // ONE derivation, read by the trend above, the rows below and the note beside
  // them, so none of the three can disagree about a rate or a window.
  const funnels = buildPubFunnels({
    daily: daily ?? [],
    sales: salesRows,
    pubs: myPubs.map(p => ({
      id: p.id, title: p.title, priceInr: p.premiumPriceInr ?? null,
      lifetimeViews: p.views, lifetimeForks: p.copies,
    })),
    days,
    now,
  })
  const series = buildDailySeries({ daily: daily ?? [], sales: salesRows, days, now })
  const funnelOf = new Map(funnels.map(f => [f.pubId, f]))
  /** The rows' traffic state, derived by the same function the ledger uses — the
   *  three truths are identical (figures, in flight, nothing to read) and a kept log
   *  counts as figures whichever way the last attempt went. The name is historical:
   *  the derivation is not ledger-specific. */
  const trafficRead = deriveLedgerRead({ hasFigures: daily !== null, reading: funnelReading, error: funnelError })
  // When the log's own history starts, page-wide. The tiles above are all-time
  // and most of their number PREDATES the first recorded event, which is
  // exactly the pair a reader would otherwise compare and conclude wrongly from.
  const recordingSince = daily && daily.length > 0
    ? daily.reduce((min, r) => (r.day < min ? r.day : min), daily[0].day)
    : null
  // #350 — the strip answers "how much of my work is up?", so a soft-unpublished
  // publication is neither live nor behind: it cannot be live (that is what the
  // marker means) and it cannot be behind its itinerary either, because a page
  // that is down has nothing to catch up on. The row-level nudge is suppressed
  // for the same reason, and the two MUST agree — a KPI that counts a row the
  // list below it refuses to label is the strip contradicting its own contents.
  // The row itself stays in `myPubs` (and so in every ledger and funnel
  // derivation) because unpublishing does not un-earn a sale or erase reach.
  const liveCount = myPubs.filter(p => !p.unpublishedAt).length
  const unpublishedCount = myPubs.length - liveCount
  const staleCount = myPubs.filter(p => {
    if (p.unpublishedAt) return false
    const t = tripById(p.tripId)
    return !!t && t.updatedAt > (p.refreshedAt ?? p.publishedAt)
  }).length
  const windowLabel = FUNNEL_WINDOWS.find(w => w.days === days)?.label ?? `${days} days`
  // The counters-vs-log fact, said ONCE for the account instead of once per row.
  // Every publication's counters predate the same log, so repeating the sentence
  // under each row made the page's longest text its most-skipped, and left the
  // strip's all-time figures looking like they disagreed with the chart above
  // them. Stated here, it is a frame the reader applies to everything below.
  const framingNote = daily === null
    ? null
    : recordingSince
      ? 'The four figures above are all-time counters. The chart and the rows below count only recorded events, and most of a counter predates the log.'
      : 'The four figures above are all-time counters. Nothing has been recorded yet, so the trend starts with the first visit.'

  return (
    <>
      <div className="hub-strip">
        <div className="hub-cell"><span className="stat-label">Views (all time)</span><span className="stat-value hub-cell-value">{totalViews.toLocaleString('en-IN')}</span></div>
        <div className="hub-cell"><span className="stat-label">Forks (all time)</span><span className="stat-value hub-cell-value">{totalForks.toLocaleString('en-IN')}</span></div>
        <div className="hub-cell"><span className="stat-label">Live</span><span className="stat-value hub-cell-value">{liveCount}</span></div>
        <div className="hub-cell"><span className="stat-label">Behind</span><span className="stat-value hub-cell-value">{staleCount > 0 ? <span className="metric-warn">{staleCount}</span> : 0}</span></div>
      </div>

      {framingNote && <div className="hub-note hub-framing">{framingNote}</div>}

      {/* THE ROLE FOLLOWS THE FIGURES, on both tabs. A failure that leaves nothing
          to show is `alert` — the page has no numbers until it is fixed, so it may
          interrupt. A failure that KEPT the figures is `status` — there is money on
          screen the reader can keep using, so it announces without stealing focus.
          Earnings already draws this line (`status` for its kept-ledger note,
          `alert` for its hard failure); this was the holdout, rendering `alert` in
          both branches and making the same condition cost a screen-reader user
          different attention on each tab. */}
      {salesError && (
        <div className="hub-note is-failure" role={salesAt ? 'status' : 'alert'}>
          {salesAt ? (
            <>
              <b>Couldn&apos;t refresh your sales ledger.</b> The figures on this tab are the ones that loaded at{' '}
              {formatHM(readAtHM(salesAt), timeFmt)} — nothing has been lost, they are simply older than now.
            </>
          ) : (
            <>
              <b>Couldn&apos;t read your sales ledger.</b> Every unlock figure on this tab is unknown until it loads —
              nothing has been lost, it just could not be read.
            </>
          )}
          <button className="btn btn-outline btn-sm hub-note-action" onClick={onRetrySales} disabled={salesReading}>
            {salesReading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* Two columns on a wide screen, one below: the trend and the publication
          list answer two halves of the same question, and stacking them as
          full-width banners made the page a scroll of equal-weight bands. */}
      {/* One instrument panel, two columns, a hairline between them (live mode,
          variant 3). The page used to be a strip, then two cards, then the
          profile card — a tall stack with a maintenance surface at the foot and
          a gap under whichever column was shorter. A single surface has no
          inter-card gap to collapse, and the divider does the grouping two
          borders were doing badly. The pairing starts at 1024 rather than 1280
          because a 1140px window is a perfectly ordinary laptop. */}
      <div className="card hub-instrument">
        <div className="hub-instrument-cols">
          <section className="hub-instrument-col" aria-labelledby="hub-trend-h">
            <div className="hub-panel-head">
              <h2 className="hub-panel-title" id="hub-trend-h">Recorded traffic</h2>
              <PillNav className="filter-pillbar hub-pills-quiet" role="group" aria-label="Funnel window" activeKey={String(days)}>
                {FUNNEL_WINDOWS.map(w => (
                  <button key={w.days} type="button" data-pill-key={String(w.days)}
                    className={`clickable-chip chip${days === w.days ? ' on-teal' : ''}`}
                    onClick={() => { onDays(w.days) }} aria-pressed={days === w.days}>{w.label}</button>
                ))}
              </PillNav>
            </div>
            {/* The state sentence lives here once, and the box below stays silent
                instead of apologising twice. The chain now OPENS with the in-flight
                case, ahead of the failure — the reverse of what it was, because an
                attempt is bounded and can be retried: a read that failed and is
                being asked again is truthfully "reading", and a retry that renders
                the sentence it was pressed against is a dead button. Failure leads
                only when nothing is in flight, and it splits in two: nothing ever
                loaded is the hard sentence, a loaded log that a refresh could not
                replace is the kept-log notice. `role="status"` announces a change
                without needing text in the empty box. */}
            <div className={`hub-panel-note${funnelError && !funnelReading ? ' is-failure' : ''}`} role="status">
              <span className="small muted">
                {funnelReading
                  ? 'Reading recorded traffic…'
                  : funnelError
                    ? daily !== null && dailyAt !== null
                      ? `Couldn't refresh — showing the log read at ${formatHM(readAtHM(dailyAt), timeFmt)}.`
                      : 'Recorded traffic could not be read just now — the trend is unchanged on the server.'
                    : recordingSince
                      // #358 — QUALIFIED. This is the GLOBAL earliest day across
                      // every publication, while each row's own pre-log line
                      // dates ITS plan — and the two sat side by side looking
                      // like a contradiction. Naming the scope is enough; the
                      // dates themselves are both true.
                      ? `Chart shows recorded days only; your log begins ${new Date(`${recordingSince}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} — the earliest of your plans.`
                      : 'Nothing recorded yet — the trend starts with the first visit.'}
              </span>
              {funnelError && <button className="btn btn-outline btn-sm" onClick={handleRetryFunnel} disabled={funnelReading}>{funnelReading ? 'Retrying…' : 'Retry'}</button>}
            </div>
            {/* A failed or in-flight read must not draw as "nothing recorded": the
                chart's own empty state is a measurement, so it is only shown once
                the log was actually read. Reserved box, no second sentence. */}
            {daily === null
              ? <div className="hub-trend-void" aria-hidden="true" />
              : <TrendChart points={series} label={windowLabel} unlockRead={unlockRead} />}
          </section>

          <section className="hub-instrument-col" aria-labelledby="hub-pubs-h">
            <div className="hub-lead-head">
              <h2 id="hub-pubs-h">Publications</h2>
              <span>
                {liveCount} live{unpublishedCount > 0 ? ` · ${unpublishedCount} unpublished` : ''}{staleCount > 0 ? ` · ${staleCount} behind` : ''}
              </span>
            </div>
            {myPubs.length === 0 ? (
              <p className="hint-text" style={{ margin: '6px 0 0' }}>
                Nothing published yet — list a trip on Explore from its Share tab.
              </p>
            ) : (
              <div>
                {myPubs.map(p => {
                  const trip = tripById(p.tripId)
                  // #350 — a soft-unpublished publication STAYS in this list on
                  // purpose: the row is where its funnel and its sales history
                  // live, and unpublishing does not un-earn either. What it must
                  // not do is read as live, so it is labelled, and the
                  // "page behind itinerary" nudge is suppressed — a page that is
                  // down cannot be behind.
                  const unpublished = Boolean(p.unpublishedAt)
                  const stale = !unpublished && !!trip && trip.updatedAt > (p.refreshedAt ?? p.publishedAt)
                  return (
                    <div key={p.id} className="hub-lead-row">
                      <span className="hub-lead-title">
                        <a {...appLink(`/pub/${p.id}`)}>{p.title}</a>
                        {unpublished && <Chip tone="info">Unpublished</Chip>}
                        {stale && <Chip tone="saffron">Page behind itinerary</Chip>}
                        {/* Where it goes and how long — not what it costs. The
                            price belongs with the money surfaces; this row is
                            about whether the page converts. */}
                        <span className="hub-lead-where">
                          {[
                            p.routeSummary.slice(0, 3).join(' · '),
                            p.durationDays ? `${p.durationDays} days` : '',
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {/* `unread` withholds the WINDOWED steps when there is
                          nothing to derive them from — which is not the same as
                          "the last read failed". With a log already on screen the
                          rows are still measurements, and the panel above states
                          how old they are; gating on the error flag alone made the
                          rows contradict the chart beside them. (Before the
                          `funnelRead` branch below, this let the `unreported`
                          sentence through for the WHOLE first read — a separate,
                          older conflation of "loading" with "nothing recorded";
                          the reading state now returns first.) */}
                      <FunnelLine f={funnelOf.get(p.id)} funnelRead={trafficRead} unlockRead={unlockRead} windowLabel={windowLabel} />
                      <span className="pub-row-actions">
                        {unpublished ? (
                          // The way back up: the Share tab's publish form
                          // re-lists it (and clears the marker).
                          <button className="btn btn-saffron btn-sm" aria-label={`Publish ${p.title} again`}
                            onClick={() => { onNavigate(`/trip/${p.tripId}/share`) }}>
                            <InlineIcon icon={Pencil} size={13} gap={3} />Publish again
                          </button>
                        ) : stale ? (
                          <button className="btn btn-saffron btn-sm" aria-label={`Update page for ${p.title}`}
                            onClick={() => { onNavigate(`/trip/${p.tripId}/share`) }}>
                            <InlineIcon icon={Pencil} size={13} gap={3} />Update page
                          </button>
                        ) : (
                          <button className="btn btn-outline btn-sm" aria-label={`Edit ${p.title}`} onClick={() => { onNavigate(`/trip/${p.tripId}/share`) }}>
                            <InlineIcon icon={Pencil} size={13} gap={3} />Edit
                          </button>
                        )}
                        {!unpublished && (
                          <button className="btn btn-ghost btn-sm" aria-label={`Unpublish ${p.title}`} onClick={() => { onUnpublish(p) }}>Unpublish</button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>


    </>
  )
}

/** Earnings tab: the Gumroad-shaped payout ledger. The "Actual" view shows
 *  REAL sales once the payments rail is live (empty honestly until then);
 *  the Projection view stays clearly-labeled not-money. */
export function EarningsTab({ myPubs, sales, salesError, salesAt, salesReading, onRetry, view, onView, basis, onBasis }: {
  myPubs: PublishedItinerary[]
  sales: ActualSales | null   // the last ledger that LOADED — kept across a failed refresh
  salesError: boolean         // the read itself failed — distinct from an empty ledger
  /** When `sales` was read. Non-null alongside a non-null `sales`. */
  salesAt: number | null
  /** An attempt is in flight, retries included — see the `ledgerRead` note. */
  salesReading: boolean
  onRetry: () => void
  view: 'actual' | 'projection'
  onView: (v: 'actual' | 'projection') => void
  /** Which figure the headline tiles read: what buyers paid, or what is kept
   *  after the platform fee. The ledger shows both columns either way, so the
   *  toggle changes emphasis rather than hiding a number. */
  basis: 'gross' | 'net' | null
  onBasis: (b: 'gross' | 'net') => void
}) {
  const projection = projectEarnings(myPubs)
  /** Σ forks across the priced plans — the denominator the potential is built from,
   *  and the same sum the projection table's Total row shows. */
  const projectionForks = projection.rows.reduce((s, r) => s + r.forks, 0)
  // An empty ledger has TWO causes and the copy must not conflate them: nothing
  // is priced, so nothing CAN sell — or things are priced and simply unsold.
  // Those are different truths with different next actions. `projectEarnings`
  // keeps only publications carrying a premium price, so an empty projection is
  // exactly "nothing priced".
  const nothingPriced = projection.rows.length === 0
  const actual = sales
  const timeFmt = useTimeFormat()
  /** Whether the ledger has been READ. The figures below still derive from
   *  `actual ?? 0` — that stays the safe arithmetic — but a figure that was
   *  never read must not be RENDERED as a measured zero. "₹0 lifetime, 0
   *  sales" beside reassuring prose is the page contradicting itself at the
   *  exact moment a money-anxious creator is most attentive, so the render is
   *  gated on this instead. */
  // The ordering rule lives in `deriveLedgerRead`, where tests pin it rather
  // than a comment: figures beat a failed refresh, an in-flight attempt beats
  // the error flag, and only an empty, idle, failed read is 'failed' — the one
  // state that owns the Retry button.
  const ledgerRead = deriveLedgerRead({ hasFigures: actual !== null, reading: salesReading, error: salesError })
  const unreadLabel = ledgerRead === 'reading' ? 'Reading…' : 'Not read'
  /** What the tiles and pills SHOW — gross until told otherwise. The basis control
   *  has always opened on gross, even though the product's own balance copy and the
   *  payout tile beside it are net. */
  const shownBasis = basis ?? 'gross'
  /** Applied to the tables only once the basis is a CHOICE: an emphasis nobody asked
   *  for reads as a disabled column, and at ≤720px the column it mutes is Net — one
   *  of only three the mobile policy keeps. */
  const basisClass = basis === null ? '' : ` basis-${basis}`
  const lifetimeInr = shownBasis === 'net' ? (actual?.netInr ?? 0) : (actual?.grossInr ?? 0)
  // The schedule is about real money, so it reads the actual ledger and is
  // rendered in the Actual view only — a projection has no payout date. The
  // clock is held in state, not re-derived per render: a component must be
  // pure, and a payout date that moves under the reader is its own kind of lie.
  const [now, refreshClock] = useStableNow()
  const handleRetry = useCallback(() => { refreshClock(); onRetry() }, [refreshClock, onRetry])
  // Same rows, same fees, grouped by the run each sale would land in — so this
  // table adds up to the ledger above it rather than re-deriving the ladder. It
  // is ONE walk, and the header reads its end state: the run rows used to judge
  // each period alone while `payoutStatus` judged the total, so a header could
  // offer a payout that no row would ever clear. #348.
  const walk = payoutWalk(actual?.rows ?? [], now)
  const payout = payoutStatus(walk.balanceInr, now)
  const payoutRuns = walk.periods
  return (
    <>
      {view === 'projection' ? (
        /* The Projection view gets its OWN strip. It used to keep the Actual one —
           Lifetime, Sales, Next payout — directly above a table that is explicitly
           not money, so two money scales stacked on one screen and the disclaimer
           had to argue with the tiles above it. These describe what the projection
           is made OF, in the table's own vocabulary. The money is deliberately NOT
           restated: the table's Total row carries Potential, Fee and Net, so showing
           them here too put the headline numbers on the screen twice — the strip
           orients, the table counts. */
        <div className="hub-strip">
          <div className="hub-cell">
            <span className="stat-label">Priced plans</span>
            <span className="stat-value hub-cell-value">{projection.rows.length}</span>
            <span className="hub-cell-hint muted">of {myPubs.length} live</span>
          </div>
          <div className="hub-cell">
            <span className="stat-label">Forks so far</span>
            <span className="stat-value hub-cell-value">{projectionForks.toLocaleString('en-IN')}</span>
          </div>
        </div>
      ) : (
        <div className="hub-strip">
          <div className="hub-cell">
            <span className="stat-label">Lifetime {shownBasis === 'net' ? 'net' : 'gross'}</span>
            {ledgerRead === 'ready'
              ? <span className="stat-value hub-cell-value">{formatInr(lifetimeInr)}</span>
              : <span className="stat-value hub-cell-value hub-cell-unread">{unreadLabel}</span>}
          </div>
          <div className="hub-cell">
            <span className="stat-label">Sales</span>
            {ledgerRead === 'ready'
              ? <span className="stat-value hub-cell-value">{actual?.rows.length ?? 0}</span>
              : <span className="stat-value hub-cell-value hub-cell-unread">{unreadLabel}</span>}
          </div>
          {/* A date only once there is something to send: a run date over a ₹0
              balance reads as money on its way. The dash states its own reason
              underneath, because a bare "—" next to a zero explains nothing — and
              while the ledger is unread, the conclusion is suppressed entirely
              rather than guessed at zero. */}
          <div className="hub-cell">
            <span className="stat-label">Next payout</span>
            {ledgerRead !== 'ready' ? (
              <>
                <span className="stat-value hub-cell-value hub-cell-unread">{unreadLabel}</span>
                <span className="hub-cell-hint muted">balance unknown</span>
              </>
            ) : (
              <>
                <span className="stat-value hub-cell-value">{payout.clearsInr > 0 ? shortDate(payout.dueAt) : '—'}</span>
                {payout.clearsInr === 0 && (
                  <span className="hub-cell-hint muted">
                    {payout.belowMinimum ? `under ${formatInr(payout.minimumInr)} — rolls over` : 'nothing to pay out yet'}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="hub-controls">
        <PillNav className="filter-pillbar" role="group" aria-label="Earnings view" activeKey={view}>
          {([['actual', 'Actual'], ['projection', 'Projection']] as const).map(([k, label]) => (
            <button key={k} type="button" data-pill-key={k} className={`clickable-chip chip${view === k ? ' on-teal' : ''}`}
              onClick={() => { onView(k) }} aria-pressed={view === k}>{label}</button>
          ))}
        </PillNav>
        <span className="hub-controls-div" aria-hidden />
        {/* `shownBasis` and `basis` are deliberately NOT the same variable here.
            The visual highlight reports what the headline tile SHOWS (gross until
            told otherwise, which is what it has always displayed), while
            `aria-pressed` reports what the tables EMPHASISE — and `basis` is null
            until anyone chooses. Driven by one variable, the pills passed a
            pressed-nobody-made to a screen reader and promised an emphasis the
            tables withheld; the state now speaks for the tables and the ink for
            the tile. */}
        <span className="small muted">Show amounts as</span>
        <PillNav className="filter-pillbar" role="group" aria-label="Show amounts as" activeKey={shownBasis}>
          {([['gross', 'Gross'], ['net', 'Net']] as const).map(([k, label]) => (
            <button key={k} type="button" data-pill-key={k} className={`clickable-chip chip${shownBasis === k ? ' on-teal' : ''}`}
              onClick={() => { onBasis(k) }} aria-pressed={basis === k}>{label}</button>
          ))}
        </PillNav>
      </div>

      {view === 'actual' && (
        <section className="card">
          <h2 className="card-title hub-panel-title">Payouts</h2>
          {/* The schedule is a statement about real money, so it waits for the
              ledger. Until then it says the balance is unknown — the old text
              cheerfully described a ₹0 balance the page had never read. */}
          {ledgerRead === 'ready' ? (
            <p className="hint-text" style={{ margin: '6px 0 6px' }}>
              {payout.clearsInr > 0 ? (
                <>The next run is <b>{longDate(payout.dueAt)}</b> — it would clear <b>{formatInr(payout.clearsInr)}</b>, your net balance after the platform fee.</>
              ) : payout.belowMinimum ? (
                <>Runs happen weekly on Fridays. Your balance is under the <b>{formatInr(payout.minimumInr)}</b> minimum, so it stays on the books until it clears it — nothing is lost.</>
              ) : (
                <>Runs happen weekly on Fridays. There is nothing to pay out yet — your balance is <b>{formatInr(0)}</b> until a priced itinerary sells.</>
              )}
            </p>
          ) : (
            <>
              {/* Only the READING case needs a sentence here. The failed case is
                  already on this screen three times — three "Not read" tiles and
                  the ledger's own alert, which also carries the recovery — so a
                  fourth restatement in this card was pure repetition. */}
              {ledgerRead === 'reading' && (
                <p className="hint-text" style={{ margin: '6px 0 6px' }}>
                  Reading your sales ledger… the next run is not stated until it answers.
                </p>
              )}
            </>
          )}
          {/* The fee ladder is stated ONCE, in the ledger note beside the Fee
              column it explains. This card was repeating that same sentence a
              scroll above it. What earns its place here is only what this
              card's own figure means: the balance is what a run would disburse,
              and nothing transfers by itself. */}
          <p className="hint-text" style={{ margin: 0 }}>
            Runs are not automated yet: this balance is what a payout would disburse and nothing transfers
            on its own.
          </p>
        </section>
      )}

      {/* The read stamp and its Refresh used to sit here. They now render one
          level up, in `CreatorHubPage`, so the sales read has ONE status and ONE
          control on both tabs — Overview's unlock column reads the same ledger
          and had neither. */}

      {salesError && salesAt !== null && (
        <div className="hub-note is-failure" role="status">
          <b>Couldn&apos;t refresh — showing what loaded at {formatHM(readAtHM(salesAt), timeFmt)}.</b> The ledger
          below is real; it may simply be older than now.
        </div>
      )}

      {view === 'actual' ? (
        /* Switched on `ledgerRead`, which now outranks the error flag twice over:
             a kept ledger stays 'ready', so a failed refresh cannot erase figures
             that already loaded, and an in-flight attempt is 'reading', so Retry
             cannot look like a dead button. Only "nothing to show AND not in
             flight" reaches 'failed' — the branch that owns Retry, and the only
             one where offering it is honest. */
        ledgerRead === 'reading' ? (
          <div className="container loading-block"><div className="spinner" />Loading sales…</div>
        ) : ledgerRead === 'failed' ? (
          <>
            <div className="hub-note is-failure" role="alert">
              <b>Couldn't load your sales.</b> The ledger read failed or timed out — your recorded sales are safe
              and will appear once the connection works. Check your connection and try again.
            </div>
            <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={handleRetry}>Retry</button>
          </>
        ) : !actual || actual.rows.length === 0 ? (
          <>
            <table className={`compare-table pub-ledger${basisClass} ledger-sales`} tabIndex={0} aria-label="Sales ledger">
              <thead><tr><th>Date</th><th className="col-wide">Itinerary</th><th className="num">Paid</th><th className="num col-opt">Fee</th><th className="num">Net</th></tr></thead>
              <tbody>
                <tr><td colSpan={5} className="empty-ledger">{nothingPriced ? 'Nothing priced yet' : 'No sales yet'}</td></tr>
              </tbody>
            </table>
            <div className="hub-note">
              {/* The table cell above states the state, so this note adds only what
                  the reader cannot see: WHY, and what to do about it. */}
              {nothingPriced ? (
                <>
                  <b>An itinerary needs a price before it can sell.</b> Set one from a trip&apos;s Share tab and
                  its sales land here, with the amount the buyer actually paid.
                </>
              ) : (
                <>
                  <b>Your priced itineraries are live.</b> When someone buys the full plan on one, the sale lands
                  here with the amount they actually paid. The Projection tab shows what the same traffic would be
                  worth if every fork had bought.
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <table className={`compare-table pub-ledger${basisClass} ledger-sales`} tabIndex={0} aria-label="Sales ledger">
              <thead><tr><th>Date</th><th className="col-wide">Itinerary</th><th className="num">Paid</th><th className="num col-opt">Fee</th><th className="num">Net</th></tr></thead>
              <tbody>
                {actual.rows.map(r => (
                  <tr key={`${r.pubId}-${r.grantedAt}`}>
                    <td>{new Date(r.grantedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="col-wide">{r.title}</td>
                    <td className="num">{formatInr(r.amountPaidInr)}</td>
                    <td className="num col-opt">{formatInr(r.feeInr)}</td>
                    <td className="num">{formatInr(r.netInr)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}><b>Total</b></td>
                  <td className="num"><b>{formatInr(actual.grossInr)}</b></td>
                  <td className="num col-opt"><b>{formatInr(actual.feeInr)}</b></td>
                  <td className="num"><b>{formatInr(actual.netInr)}</b></td>
                </tr>
              </tbody>
            </table>
            <p className="hint-text" style={{ marginTop: 8 }}>
              Fee is the platform's cut — {PLATFORM_FEE_SUMMARY}, charged across your sales in the order they
              happened, so a row's fee depends on where it fell on your lifetime gross and not on the order this
              table is read in. Amounts are what buyers actually paid at purchase time, not your publication's
              current price.
            </p>

            {payoutRuns.length > 0 && (
              <>
                <h3 className="hub-subhead">Payout runs</h3>
                <table className={`compare-table pub-ledger${basisClass} ledger-runs`} tabIndex={0} aria-label="Payout runs">
                  {/* The rollover is a COLUMN, not a sentence: a run that sends
                      ₹600 while its own Net reads ₹300 is the whole point of
                      #348, and burying that in the Status cell made the table
                      look like an arithmetic error. `col-opt` on the optional
                      column keeps it in the mobile policy's drop set — the roll-in
                      is context, and Clears is the figure a run exists for. */}
                  <thead><tr><th>Run</th><th className="num">Sales</th><th className="num col-opt">Gross</th><th className="num col-opt">Fee</th><th className="num">Net</th><th className="num col-opt">Rolled in</th><th className="num">Clears</th><th>Status</th></tr></thead>
                  <tbody>
                    {payoutRuns.map(p => (
                      <tr key={p.dueAt}>
                        <td>{new Date(p.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className="num">{p.salesCount}</td>
                        <td className="num col-opt">{formatInr(p.grossInr)}</td>
                        <td className="num col-opt">{formatInr(p.feeInr)}</td>
                        <td className="num">{formatInr(p.netInr)}</td>
                        <td className="num col-opt">{p.carriedInInr > 0 ? formatInr(p.carriedInInr) : '—'}</td>
                        <td className="num">{p.clearsInr > 0 ? formatInr(p.clearsInr) : '—'}</td>
                        <td>{payoutPeriodStatus(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint-text" style={{ marginTop: 8 }}>
                  Each run covers the sales made since the previous one, and a sale lands on the Friday after it
                  was bought. A run under {formatInr(PAYOUT_MINIMUM_INR)} does not clear: it rolls into the next
                  one and is shown there as <b>Rolled in</b>, so a run's <b>Clears</b> is that run's own net plus
                  everything it took with it. Nothing here has been disbursed — a past run is money owed rather
                  than money sent.
                </p>
              </>
            )}
          </>
        )
      ) : projection.rows.length === 0 ? (
        <div className="hub-note">
          <b>Nothing to project yet.</b> Projections need a priced publication — set a premium price on one from its
          Share tab, and its earning potential (clearly marked as not-money) shows up here.
        </div>
      ) : (
        <>
          {/* The not-money marker sits ABOVE the table it qualifies. Below it, the
              reader met two money scales stacked — the real strip, then this —
              with the disclaimer arriving after the figures it disclaims; the
              empty state already promises the potential is "clearly marked as
              not-money". */}
          <p className="hint-text" style={{ marginBottom: 8 }}>
            A projection, not money: price × forks so far, assuming every fork had bought the unlock. The
            potential total is exact for the fee ladder ({PLATFORM_FEE_SUMMARY}); the per-row fee shares are
            illustrative, because which sale earns the lower rate depends on what actually sells first.
          </p>
          <table className={`compare-table pub-ledger${basisClass} ledger-projection`} tabIndex={0} aria-label="Projection ledger">
            <thead><tr><th className="col-wide">Itinerary</th><th className="num col-opt">Price</th><th className="num">Forks</th><th className="num">If all unlocked</th><th className="num col-opt">Fee</th><th className="num">Net</th></tr></thead>
            <tbody>
              {projection.rows.map(r => (
                <tr key={r.pubId}>
                  <td className="col-wide">{r.title}</td>
                  <td className="num col-opt">{formatInr(r.priceInr)}</td>
                  <td className="num">{r.forks}</td>
                  <td className="num">{formatInr(r.grossInr)}</td>
                  {/* The row was FIVE cells under SIX heads, so `netInr` rendered
                      under Fee and Net sat empty — while the Total row below it
                      filled both. The fee was computed and never shown. */}
                  <td className="num col-opt">{formatInr(r.feeInr)}</td>
                  <td className="num">{formatInr(r.netInr)}</td>
                </tr>
              ))}
              <tr>
                <td className="col-wide"><b>Potential to date</b></td>
                <td className="col-opt" />
                <td className="num"><b>{projection.rows.reduce((s, r) => s + r.forks, 0)}</b></td>
                <td className="num"><b>{formatInr(projection.potentialInr)}</b></td>
                <td className="num col-opt"><b>{formatInr(projection.feeInr)}</b></td>
                <td className="num"><b>{formatInr(projection.netInr)}</b></td>
              </tr>
            </tbody>
          </table>
          {projection.unpricedCount > 0 && (
            <div className="hub-note">
              <b>{projection.unpricedCount} free publication{projection.unpricedCount === 1 ? '' : 's'} not shown.</b>{' '}
              Fully free itineraries don’t project — set a premium price on their Share tab to see them here.
            </div>
          )}
        </>
      )}
    </>
  )
}
