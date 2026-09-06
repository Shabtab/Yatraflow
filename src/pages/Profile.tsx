// ============ Profile & settings ============
import { useEffect, useState } from 'react'
import { ExternalLink, Pencil } from 'lucide-react'
import type { PublishedItinerary, TravelStyle } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import { useDb, currentUser, updateProfile, tripsForUser, unpublishItinerary, tripById } from '../store/store'
import { projectEarnings } from '../lib/earnings'
import { formatInr } from '../lib/engine'
import { Avatar, Chip, ConfirmDialog, Field, toast } from '../components/ui'
import { useTimeFormat, setTimeFormat, formatHM, type TimeFormat } from '../lib/timefmt'

export function ProfilePage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const timeFormat = useTimeFormat()
  const tripCount = tripsForUser(me?.id ?? null).length
  const myPubs = me ? db.published.filter(p => p.creatorId === me.id) : []

  const [f, setF] = useState(() => ({
    name: me?.profile.name ?? '',
    homeCity: me?.profile.homeCity ?? '',
    languages: (me?.profile.languages ?? ['en']).join(', '),
  }))
  const [creatorBio, setCreatorBio] = useState(me?.profile.creatorBio ?? '')
  const [youtube, setYoutube] = useState(me?.profile.socialLinks?.youtube ?? '')
  const [instagram, setInstagram] = useState(me?.profile.socialLinks?.instagram ?? '')
  const [nameErr, setNameErr] = useState<string | null>(null)
  // Disable-creator-mode + Unpublish both go through a confirm dialog.
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [unpubTarget, setUnpubTarget] = useState<PublishedItinerary | null>(null)
  // Creator-hub tabs: component state, deliberately NOT a ?tab= hash param —
  // App keys the route panel on the full route string, so a hash change would
  // remount this page and wipe the creator-bio form mid-typing.
  const [hubTab, setHubTab] = useState<'overview' | 'earnings'>('overview')
  const [earningsView, setEarningsView] = useState<'actual' | 'projection'>('actual')
  // Not logged in: route to auth instead of rendering a blank page.
  const loggedIn = Boolean(me)
  useEffect(() => { if (!loggedIn) onNavigate('/auth') })
  if (!me) return null

  function toggleStyle(s: TravelStyle) {
    const has = me!.profile.travelStyles.includes(s)
    updateProfile({ travelStyles: has ? me!.profile.travelStyles.filter(x => x !== s) : [...me!.profile.travelStyles, s] })
  }

  return (
    <div className="container form-page">
      <h1>Profile & settings</h1>
      <p className="muted small" style={{ marginBottom: 20 }}>{tripCount} trip{tripCount !== 1 ? 's' : ''} · {me.email}</p>

      <div className="two-col" style={{ alignItems: 'start' }}>
        <div>
          <div className="card">
            <h3>Your details</h3>
            <hr className="divider" />
            <div className="creator-line" style={{ marginBottom: 14 }}>
              <Avatar user={me} size="lg" />
              <span className="small muted">Avatars use your initials in this MVP.</span>
            </div>
            <Field label="Display name" error={nameErr ?? undefined}><input className="input" autoComplete="name" value={f.name} onChange={e => { setF(x => ({ ...x, name: e.target.value })); if (nameErr) setNameErr(null) }} /></Field>
            <Field label="Home city"><input className="input" autoComplete="address-level2" value={f.homeCity} onChange={e => setF(x => ({ ...x, homeCity: e.target.value }))} placeholder="e.g. Kochi" /></Field>
            <Field label="Languages you speak" hint="Comma separated — e.g. en, hi, ml">
              <input className="input" value={f.languages} onChange={e => setF(x => ({ ...x, languages: e.target.value }))} />
            </Field>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Travel styles</h3>
            <p className="hint-text" style={{ margin: '6px 0 10px' }}>Pick all that fit — helps collaborators know what kind of trip to invite you to.</p>
            <div className="chip-row">
              {TRAVEL_STYLES.map(s => (
                <Chip key={s} active={me.profile.travelStyles.includes(s)} aria-pressed={me.profile.travelStyles.includes(s)} onClick={() => toggleStyle(s)}>{cap(s)}</Chip>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Display preferences</h3>
            <hr className="divider" />
            <Field label="Clock format" hint={`Applies across the app. Example: ${formatHM('18:30', timeFormat)}`}>
              <div className="chip-row">
                {(['12h', '24h'] as TimeFormat[]).map(opt => (
                  <Chip key={opt} active={timeFormat === opt} aria-pressed={timeFormat === opt} onClick={() => setTimeFormat(opt)}>
                    {opt === '12h' ? '12h (AM/PM)' : '24h'}
                  </Chip>
                ))}
              </div>
            </Field>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="row-between">
              <h3>Creator mode</h3>
              <Chip tone={me.profile.isCreator ? 'ok' : 'info'}>{me.profile.isCreator ? 'Enabled' : 'Off'}</Chip>
            </div>
            <p className="hint-text" style={{ margin: '6px 0 12px' }}>
              Publishing to Explore is open to everyone — do it from any trip&apos;s Share tab.
              Creator mode is a trust and branding badge: your bio and social links appear
              on the itineraries you publish.
            </p>
            {me.profile.isCreator ? (
              <>
                <Field label="Creator bio"><textarea className="textarea" value={creatorBio} onChange={e => setCreatorBio(e.target.value)} placeholder="Tell readers who you are and why they should trust your routes." /></Field>
                <div className="form-row">
                  <Field label="YouTube link"><input className="input" type="url" inputMode="url" value={youtube} onChange={e => setYoutube(e.target.value)} placeholder="https://youtube.com/@…" /></Field>
                  <Field label="Instagram link"><input className="input" type="url" inputMode="url" value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="https://instagram.com/…" /></Field>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => {
                  updateProfile({
                    creatorBio: creatorBio.trim() || undefined,
                    socialLinks: (youtube.trim() || instagram.trim())
                      ? { youtube: youtube.trim() || undefined, instagram: instagram.trim() || undefined }
                      : undefined,
                  })
                  toast('Creator profile saved')
                }}>Save creator profile</button>
                <button className="btn btn-outline btn-sm" style={{ marginLeft: 10 }}
                  onClick={() => onNavigate(`/creator/${me.id}`)}>View your public page</button>
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 10 }}
                  onClick={() => setConfirmDisable(true)}>Disable creator mode</button>
              </>
            ) : (
              <button className="btn btn-saffron" onClick={() => { updateProfile({ isCreator: true }); toast('Creator mode enabled ✨ Your bio and links now show on published itineraries.') }}>
                Enable creator mode
              </button>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="row-between">
              <h3>My publications</h3>
              {myPubs.length > 0 && (
                <a className="small" href={`#/creator/${me.id}`} style={{ fontWeight: 650 }}>
                  <ExternalLink size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />View public page
                </a>
              )}
            </div>
            <div className="filter-pillbar" style={{ margin: '10px 0 12px' }} role="group" aria-label="Publications view">
              {([['overview', 'Overview'], ['earnings', 'Earnings']] as const).map(([k, label]) => (
                <button key={k} type="button" className={`clickable-chip chip${hubTab === k ? ' on-teal' : ''}`}
                  onClick={() => setHubTab(k)} aria-pressed={hubTab === k}>{label}</button>
              ))}
            </div>

            {hubTab === 'overview' ? (
              myPubs.length === 0 ? (
                <p className="hint-text" style={{ margin: '6px 0 0' }}>
                  Nothing published yet — list a trip on Explore from its Share tab.
                </p>
              ) : (
                <>
                  <PubOverview myPubs={myPubs} onUnpublish={setUnpubTarget} onNavigate={onNavigate} />
                </>
              )
            ) : (
              <EarningsTab myPubs={myPubs} view={earningsView} onView={setEarningsView} />
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Save details</h3>
            <hr className="divider" />
            <button className="btn btn-primary" onClick={() => {
              // Inline validation — the name silently reverting to the old one
              // read as "save doesn't work". Say so, next to the field.
              if (!f.name.trim()) { setNameErr('Pick a display name — it shows on shared trips.'); return }
              setNameErr(null)
              updateProfile({
                name: f.name.trim(),
                homeCity: f.homeCity.trim() || undefined,
                languages: f.languages.split(',').map(s => s.trim()).filter(Boolean),
              })
              toast('Profile saved')
            }}>Save profile</button>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 10 }} onClick={() => onNavigate('/trips')}>← Back to my trips</button>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>About your data</h3>
            <p className="hint-text" style={{ marginTop: 6 }}>
              This MVP stores everything locally in your browser. Costs and timings are transparent
              estimates — always verify prices before travelling.
            </p>
          </div>
        </div>
      </div>

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
        onClose={() => setConfirmDisable(false)}
      />
      <ConfirmDialog
        open={!!unpubTarget}
        title={`Unpublish “${unpubTarget?.title ?? ''}”?`}
        body="It is removed from Explore immediately and its public page stops working. The trip itself is not touched — you can publish it again from its Share tab."
        confirmLabel="Unpublish"
        danger
        onConfirm={() => {
          if (!unpubTarget) return
          unpublishItinerary(unpubTarget.tripId)
          setUnpubTarget(null)
          toast('Unpublished — removed from Explore')
        }}
        onClose={() => setUnpubTarget(null)}
      />
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }

/** Overview tab: lifetime KPIs + the per-publication manager rows. */
function PubOverview({ myPubs, onUnpublish, onNavigate }: {
  myPubs: PublishedItinerary[]
  onUnpublish: (p: PublishedItinerary) => void
  onNavigate: (r: string) => void
}) {
  const totalViews = myPubs.reduce((s, p) => s + p.views, 0)
  const totalForks = myPubs.reduce((s, p) => s + p.copies, 0)
  const staleCount = myPubs.filter(p => {
    const t = tripById(p.tripId)
    return !!t && t.updatedAt > (p.refreshedAt ?? p.publishedAt)
  }).length
  return (
    <>
      <div className="pub-kpis">
        <div className="stat-tile"><div className="stat-label">Views</div><div className="stat-value">{totalViews}</div></div>
        <div className="stat-tile"><div className="stat-label">Forks</div><div className="stat-value">{totalForks}</div></div>
        <div className="stat-tile"><div className="stat-label">Live</div><div className="stat-value">{myPubs.length}</div></div>
        <div className="stat-tile"><div className="stat-label">Behind</div><div className="stat-value">{staleCount > 0 ? <span className="metric-warn">{staleCount}</span> : 0}</div></div>
      </div>
      <div style={{ marginTop: 4 }}>
        {myPubs.map(p => {
          const trip = tripById(p.tripId)
          // "Page behind itinerary": the trip changed after the last
          // publish/refresh. refreshedAt is absent on pre-v0.37 rows.
          const stale = !!trip && trip.updatedAt > (p.refreshedAt ?? p.publishedAt)
          return (
            <div key={p.id} className="pub-row">
              <div className="pub-row-main">
                <span className="pub-row-title">
                  <a href={`#/pub/${p.id}`}>{p.title}</a>
                  {stale && <Chip tone="saffron">Page behind itinerary</Chip>}
                </span>
                <span className="small muted num">{p.views} view{p.views === 1 ? '' : 's'} · {p.copies} fork{p.copies === 1 ? '' : 's'}</span>
              </div>
              <span className="pub-row-actions">
                {stale && (
                  <button className="btn btn-saffron btn-sm" onClick={() => onNavigate(`/trip/${p.tripId}/share`)}>Update page</button>
                )}
                <button className="btn btn-outline btn-sm" aria-label={`Edit ${p.title}`} onClick={() => onNavigate(`/trip/${p.tripId}/share`)}>
                  <Pencil size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Edit
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => onUnpublish(p)}>Unpublish</button>
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** Earnings tab: the Gumroad-shaped payout ledger (empty, honestly) plus a
 *  clearly-labeled projection view powered by real counters. */
function EarningsTab({ myPubs, view, onView }: {
  myPubs: PublishedItinerary[]
  view: 'actual' | 'projection'
  onView: (v: 'actual' | 'projection') => void
}) {
  const projection = projectEarnings(myPubs)
  return (
    <>
      <div className="pub-kpis">
        <div className="stat-tile wide"><div className="stat-label">Available balance</div><div className="stat-value">{formatInr(0)}</div></div>
        <div className="stat-tile"><div className="stat-label">Lifetime</div><div className="stat-value">{formatInr(0)}</div></div>
        <div className="stat-tile"><div className="stat-label">Next payout</div><div className="stat-value">—</div></div>
      </div>
      <div className="filter-pillbar" style={{ marginBottom: 12 }} role="group" aria-label="Earnings view">
        {([['actual', 'Actual'], ['projection', 'Projection']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`clickable-chip chip${view === k ? ' on-teal' : ''}`}
            onClick={() => onView(k)} aria-pressed={view === k}>{label}</button>
        ))}
      </div>

      {view === 'actual' ? (
        <>
          <table className="compare-table pub-ledger">
            <thead><tr><th>Payout period</th><th className="num">Sales</th><th className="num">Platform fee</th><th className="num">Net payout</th></tr></thead>
            <tbody>
              <tr><td colSpan={4} className="empty-ledger">No payouts yet</td></tr>
            </tbody>
          </table>
          <div className="hub-note">
            <b>Payments arrive with the premium launch.</b> Until then this ledger tracks nothing — but its shape is
            final: when Razorpay lands, each payout lands here as a row with its sale period, sales, fees and net.
          </div>
        </>
      ) : projection.rows.length === 0 ? (
        <div className="hub-note">
          <b>Nothing to project yet.</b> Projections need a priced publication — set a premium price on one from its
          Share tab, and its earning potential (clearly marked as not-money) shows up here.
        </div>
      ) : (
        <>
          <table className="compare-table pub-ledger">
            <thead><tr><th>Itinerary</th><th className="num">Price</th><th className="num">Forks</th><th className="num">If all unlocked</th><th className="num">Net*</th></tr></thead>
            <tbody>
              {projection.rows.map(r => (
                <tr key={r.pubId}>
                  <td>{r.title}</td>
                  <td className="num">{formatInr(r.priceInr)}</td>
                  <td className="num">{r.forks}</td>
                  <td className="num">{formatInr(r.grossInr)}</td>
                  <td className="num">{formatInr(r.netInr)}</td>
                </tr>
              ))}
              <tr>
                <td><b>Potential to date</b></td>
                <td />
                <td className="num"><b>{projection.rows.reduce((s, r) => s + r.forks, 0)}</b></td>
                <td className="num"><b>{formatInr(projection.potentialInr)}</b></td>
                <td className="num"><b>{formatInr(projection.netInr)}</b></td>
              </tr>
            </tbody>
          </table>
          <p className="hint-text" style={{ marginTop: 8 }}>
            * A projection, not money: price × forks so far, assuming every fork had bought the unlock. The
            platform-fee model arrives with Razorpay — until then the fee stays ₹0 (TBD).
          </p>
          {projection.unpricedCount > 0 && (
            <div className="hub-note">
              <b>{projection.unpricedCount} free publication{projection.unpricedCount === 1 ? '' : 's'} not shown.</b>{' '}
              Fully free itineraries don't project — set a premium price on their Share tab to see them here.
            </div>
          )}
        </>
      )}
    </>
  )
}
