// ============ Masteradmin console — #/admin ============
// Gated on the JWT app_metadata role (useIsAdmin): non-admins fall through to
// the landing page, exactly like CreatorHub's creator gate. All data comes
// from the admin-widened hydration (full trips/users slices + audit log);
// every destructive button calls an audited SECURITY DEFINER RPC via the
// store. Destructive actions confirm first; trip delete confirms by typing
// the trip name (no undo — cascades take the collab layer).
import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, GitFork, ShieldAlert, Trash2, Users } from 'lucide-react'
import { PillNav } from '../components/PillNav'
import { Avatar, Chip, ConfirmDialog, EmptyState, Modal, toast } from '../components/ui'
import {
  useDb, useIsAdmin, useAdminAudit, useSessionUserId, currentUser,
  adminSetDisabled, adminSetCreator, adminSetTripVisibility,
  adminRemoveMember, adminUnpublish, adminDeleteTrip,
} from '../store/store'
import {
  computeAdminOverview, computeGrowthSeries, computeFunnel, recentJoins, weekBucket,
} from '../lib/adminStats'
import { formatInr } from '../lib/engine'
import type { Trip, User } from '../data/types'

type AdminTab = 'overview' | 'users' | 'trips' | 'invites' | 'content' | 'analytics' | 'audit'

export function AdminPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const isAdmin = useIsAdmin()
  const readyGate = useDb().ready
  const [tab, setTab] = useState<AdminTab>('overview')
  const loggedIn = Boolean(useSessionUserId())

  useEffect(() => { if (!loggedIn) onNavigate('/auth') }, [loggedIn, onNavigate])
  // Gate AFTER the first hydrate settles: the admin flag rides the JWT fetch
  // inside hydrate(), so gating on first paint would bounce a real admin to
  // the landing page on every hard refresh.
  useEffect(() => {
    if (readyGate && loggedIn && !isAdmin) onNavigate('/')
  }, [readyGate, loggedIn, isAdmin, onNavigate])
  if (!loggedIn || !readyGate) return null
  if (!isAdmin) return null

  return (
    <div className="container form-page">
      <h1>Masteradmin</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>Full-control console — every destructive action is audit-logged.</p>
      <PillNav className="filter-pillbar" role="tablist" aria-label="Admin sections" activeKey={tab}>
        {([
          ['overview', 'Overview'], ['users', 'Users'], ['trips', 'Trips'],
          ['invites', 'Invites'], ['content', 'Content'],
          ['analytics', 'Analytics'], ['audit', 'Audit log'],
        ] as [AdminTab, string][]).map(([k, label]) => (
          <button key={k} type="button" data-pill-key={k}
            className={`clickable-chip chip${tab === k ? ' on-teal' : ''}`}
            onClick={() => setTab(k)} aria-pressed={tab === k} role="tab">{label}</button>
        ))}
      </PillNav>
      <div style={{ marginTop: 18 }}>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'trips' && <TripsTab onNavigate={onNavigate} />}
        {tab === 'invites' && <InvitesTab />}
        {tab === 'content' && <ContentTab />}
        {tab === 'analytics' && <AnalyticsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  )
}

function OverviewTab() {
  const db = useDb()
  const o = useMemo(() => computeAdminOverview(
    db.users, db.trips, db.suggestions, db.decisions, db.published, db.activity,
  ), [db])
  const tiles: [string, string][] = [
    ['Users', String(o.totalUsers)],
    ['Trips', String(o.totalTrips)],
    ['Private / public', `${o.privateTrips} / ${o.publicTrips}`],
    ['Published', String(o.publishedCount)],
    ['Explore views', String(o.totalViews)],
    ['Forks', String(o.totalCopies)],
    ['Open suggestions', String(o.openSuggestions)],
    ['Open decisions', String(o.openDecisions)],
    ['Avg crew / trip', o.avgMembersPerTrip.toFixed(1)],
    ['Activity 7d (prev)', `${o.activityLast7d} (${o.activityPrev7d})`],
    ['Creators', String(o.creators)],
    ['Disabled', String(o.disabledUsers)],
  ]
  return (
    <div className="creator-stats" role="group" aria-label="App overview">
      {tiles.map(([label, value]) => (
        <div key={label} className="stat-tile"><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>
      ))}
    </div>
  )
}

function UsersTab() {
  const db = useDb()
  const meId = useSessionUserId()
  const [q, setQ] = useState('')
  const [confirmDisable, setConfirmDisable] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)
  const users = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? db.users.filter(u => `${u.profile.name} ${u.email}`.toLowerCase().includes(needle))
      : db.users
    return [...list].sort((a, b) => b.createdAt - a.createdAt)
  }, [db.users, q])
  const ownedCount = (id: string) => db.trips.filter(t => (t.members ?? []).some(m => m.userId === id && m.role === 'owner')).length

  return (
    <div>
      <input className="input" type="search" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search name or email…" aria-label="Search users" style={{ maxWidth: 320, marginBottom: 12 }} />
      <p className="sr-only" role="status">{users.length} users</p>
      {users.length === 0 ? (
        <EmptyState icon={<Users size={38} aria-hidden />} title="No users match" body="Clear the search to see everyone." />
      ) : (
        <table className="compare-table">
          <thead><tr><th>User</th><th className="num">Trips</th><th>Flags</th><th>Joined</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={u.profile.isDisabled ? { opacity: 0.6 } : undefined}>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Avatar user={u} size="sm" />
                    <span>{u.profile.name}<br /><span className="muted small">{u.email}</span></span>
                  </span>
                </td>
                <td className="num">{ownedCount(u.id)}</td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                    {u.profile.isCreator && <Chip tone="ok">Creator</Chip>}
                    {u.profile.isDisabled && <Chip tone="danger">Disabled</Chip>}
                    {u.id === meId && <Chip tone="info">You</Chip>}
                  </span>
                </td>
                <td className="small muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-outline btn-sm" disabled={busy}
                      onClick={() => { setBusy(true); void adminSetCreator(u.id, !u.profile.isCreator).finally(() => setBusy(false)) }}>
                      {u.profile.isCreator ? 'Unmake creator' : 'Make creator'}
                    </button>
                    {u.id !== meId && (
                      u.profile.isDisabled ? (
                        <button className="btn btn-outline btn-sm" disabled={busy}
                          onClick={() => { setBusy(true); void adminSetDisabled(u.id, false).finally(() => setBusy(false)) }}>
                          Re-enable
                        </button>
                      ) : (
                        <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => setConfirmDisable(u)}>
                          Disable
                        </button>
                      )
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ConfirmDialog
        open={!!confirmDisable}
        title={`Disable ${confirmDisable?.profile.name ?? ''}?`}
        body="They stay able to sign in, but every table reads as denied and the app signs them back out with an explanation. Reversible from this same table."
        confirmLabel="Disable account"
        danger
        onConfirm={() => {
          if (!confirmDisable) return
          const target = confirmDisable
          setConfirmDisable(null)
          setBusy(true)
          void adminSetDisabled(target.id, true).finally(() => setBusy(false))
        }}
        onClose={() => setConfirmDisable(null)}
      />
    </div>
  )
}

function TripsTab({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const [q, setQ] = useState('')
  const [vis, setVis] = useState<'all' | 'private' | 'public'>('all')
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Trip | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const trips = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return db.trips
      .filter(t => (vis === 'all' || t.visibility === vis))
      .filter(t => !needle || `${t.name} ${t.startLocation} ${t.destinations.join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [db.trips, q, vis])
  const ownerOf = (t: Trip) => db.users.find(u => u.id === (t.members ?? []).find(m => m.role === 'owner')?.userId)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <input className="input" type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search trips…" aria-label="Search trips" style={{ maxWidth: 280 }} />
        <PillNav className="filter-pillbar" role="group" aria-label="Visibility filter" activeKey={vis}>
          {([['all', 'All'], ['private', 'Private'], ['public', 'Public']] as const).map(([k, label]) => (
            <button key={k} type="button" data-pill-key={k} className={`clickable-chip chip${vis === k ? ' on-teal' : ''}`}
              onClick={() => setVis(k)} aria-pressed={vis === k}>{label}</button>
          ))}
        </PillNav>
      </div>
      <p className="sr-only" role="status">{trips.length} trips</p>
      <table className="compare-table">
        <thead><tr><th>Trip</th><th>Owner</th><th className="num">Crew</th><th>Visibility</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>
          {trips.map(t => (
            <tr key={t.id}>
              <td><a href={`#/trip/${t.id}`}>{t.name}</a><br /><span className="muted small">{t.days.length}d · {t.destinations.join(' → ') || t.startLocation}</span></td>
              <td className="small">{ownerOf(t)?.profile.name ?? '—'}<br /><span className="muted small">{ownerOf(t)?.email ?? ''}</span></td>
              <td className="num">{t.members?.length ?? 0}</td>
              <td><Chip tone={t.visibility === 'public' ? 'ok' : 'info'}>{t.visibility}</Chip></td>
              <td className="small muted">{new Date(t.updatedAt).toLocaleDateString()}</td>
              <td>
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-outline btn-sm" disabled={busy}
                    onClick={() => { setBusy(true); void adminSetTripVisibility(t.id, t.visibility === 'public' ? 'private' : 'public').finally(() => setBusy(false)) }}>
                    {t.visibility === 'public' ? <><EyeOff size={13} aria-hidden /> Make private</> : <><Eye size={13} aria-hidden /> Make public</>}
                  </button>
                  <button className="btn btn-danger btn-sm" disabled={busy} aria-label={`Delete ${t.name}`}
                    onClick={() => { setDeleteTarget(t); setDeleteName('') }}>
                    <Trash2 size={13} aria-hidden />
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {trips.length === 0 && (
        <EmptyState icon={<Eye size={38} aria-hidden />} title="No trips match" body="Clear the search or visibility filter." />
      )}
      {/* Type-to-confirm delete: ConfirmDialog has no child slot, so the
          destructive modal is a Modal with the same .confirm-actions row.
          The input auto-focuses (Modal aims at the first input); the Delete
          button stays disabled until the typed name matches exactly. */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        title={`Delete “${deleteTarget?.name ?? ''}”?`}>
        <p className="muted" style={{ marginTop: 0 }}>
          This is permanent — the trip, its votes, decisions, activity and publication go with it
          (the audit log keeps a snapshot). Type the trip name to confirm.
        </p>
        <input className="input" value={deleteName} onChange={e => setDeleteName(e.target.value)}
          placeholder={deleteTarget?.name ?? 'Trip name'} aria-label="Type the trip name to confirm"
          style={{ marginTop: 10 }} />
        <div className="confirm-actions">
          <button
            className="btn btn-sm btn-danger"
            disabled={deleteName.trim() !== (deleteTarget?.name ?? '').trim() || (deleteTarget?.name.trim() ?? '') === ''}
            onClick={() => {
              if (!deleteTarget) return
              const id = deleteTarget.id
              setDeleteTarget(null)
              setBusy(true)
              void adminDeleteTrip(id).finally(() => setBusy(false))
            }}
          >Delete trip</button>
          <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
        </div>
      </Modal>
    </div>
  )
}

function InvitesTab() {
  const db = useDb()
  const [busy, setBusy] = useState(false)
  const [confirmKick, setConfirmKick] = useState<{ trip: Trip; user: User } | null>(null)
  // No invite-link table exists (links are capability URLs: #/invite/:tripId),
  // so member-join velocity IS the invite signal — rank by joins in 30d.
  const rows = useMemo(() => db.trips
    .map(t => ({ trip: t, joins30d: recentJoins(t.members ?? []) }))
    .sort((a, b) => b.joins30d - a.joins30d || b.trip.updatedAt - a.trip.updatedAt)
    .slice(0, 50), [db.trips])
  const nameOf = (id: string) => db.users.find(u => u.id === id)

  return (
    <div>
      <p className="hint-text" style={{ margin: '0 0 12px' }}>
        Ranked by member joins in the last 30 days, so unusual invite spread surfaces first.
      </p>
      <table className="compare-table">
        <thead><tr><th>Trip</th><th className="num">Joins 30d</th><th className="num">Crew</th><th>Members</th></tr></thead>
        <tbody>
          {rows.map(({ trip: t, joins30d }) => (
            <tr key={t.id}>
              <td><a href={`#/trip/${t.id}`}>{t.name}</a><br /><span className="muted small">{t.visibility}</span></td>
              <td className="num">{joins30d}</td>
              <td className="num">{t.members?.length ?? 0}</td>
              <td>
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {(t.members ?? []).slice(0, 8).map(m => {
                    const u = nameOf(m.userId)
                    return (
                      <span key={m.userId} className="chip" title={`${u?.profile.name ?? m.userId} · ${m.role}`}>
                        {u?.profile.name ?? 'Unknown'}
                        <button className="icon-btn" style={{ width: 20, height: 20, marginLeft: 4 }}
                          aria-label={`Remove ${u?.profile.name ?? 'member'} from ${t.name}`}
                          disabled={busy}
                          onClick={() => u && setConfirmKick({ trip: t, user: u })}>
                          <ShieldAlert size={12} aria-hidden />
                        </button>
                      </span>
                    )
                  })}
                  {(t.members?.length ?? 0) > 8 && <span className="small muted num">+{(t.members?.length ?? 0) - 8}</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <EmptyState icon={<Users size={38} aria-hidden />} title="No trips yet" body="Invite activity appears here once trips exist." />
      )}
      <ConfirmDialog
        open={!!confirmKick}
        title={`Remove ${confirmKick?.user.profile.name ?? ''}?`}
        body="They lose access immediately. The last owner cannot be removed — transfer ownership first."
        confirmLabel="Remove member"
        danger
        onConfirm={() => {
          if (!confirmKick) return
          const { trip, user } = confirmKick
          setConfirmKick(null)
          setBusy(true)
          void adminRemoveMember(trip.id, user.id).finally(() => setBusy(false))
        }}
        onClose={() => setConfirmKick(null)}
      />
    </div>
  )
}

function ContentTab() {
  const db = useDb()
  const [busy, setBusy] = useState(false)
  const [confirmUnpub, setConfirmUnpub] = useState<Trip | null>(null)
  const pubs = useMemo(() => [...db.published].sort((a, b) => b.publishedAt - a.publishedAt), [db.published])
  const tripOf = (tripId: string) => db.trips.find(t => t.id === tripId)

  return (
    <div>
      <p className="hint-text" style={{ margin: '0 0 12px' }}>
        Every public Explore page. Unpublishing removes the page and flips the trip back to private.
      </p>
      {pubs.length === 0 ? (
        <EmptyState icon={<Eye size={38} aria-hidden />} title="Nothing published" body="Published itineraries appear here for moderation." />
      ) : (
        <table className="compare-table">
          <thead><tr><th>Itinerary</th><th>Creator</th><th className="num">Views</th><th className="num">Forks</th><th>Published</th><th>Actions</th></tr></thead>
          <tbody>
            {pubs.map(p => {
              const creator = db.users.find(u => u.id === p.creatorId)
              return (
                <tr key={p.id}>
                  <td><a href={`#/p/${p.id}`}>{p.title}</a><br /><span className="muted small">{p.routeSummary.join(' → ')}</span></td>
                  <td className="small">{creator?.profile.name ?? '—'}</td>
                  <td className="num">{p.views}</td>
                  <td className="num">{p.copies}</td>
                  <td className="small muted">{new Date(p.publishedAt).toLocaleDateString()}</td>
                  <td>
                    {tripOf(p.tripId) ? (
                      <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirmUnpub(tripOf(p.tripId)!)}>Unpublish</button>
                    ) : (
                      <span className="small muted">trip gone</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <ConfirmDialog
        open={!!confirmUnpub}
        title={`Unpublish “${confirmUnpub?.name ?? ''}”?`}
        body="The Explore page disappears and the trip flips back to private. The creator can re-publish from their Share tab."
        confirmLabel="Unpublish"
        danger
        onConfirm={() => {
          if (!confirmUnpub) return
          const id = confirmUnpub.id
          setConfirmUnpub(null)
          setBusy(true)
          void adminUnpublish(id).finally(() => setBusy(false))
        }}
        onClose={() => setConfirmUnpub(null)}
      />
    </div>
  )
}

function AnalyticsTab() {
  const db = useDb()
  const funnel = useMemo(() => computeFunnel(db.users, db.trips, db.published), [db])
  const growth = useMemo(() => computeGrowthSeries(db.users, db.trips, 12), [db.users, db.trips])
  const maxBar = Math.max(1, ...growth.map(g => Math.max(g.signups, g.trips)))
  const pct = (n: number) => `${n.toFixed(1)}%`
  return (
    <div>
      <div className="creator-stats" role="group" aria-label="Funnels">
        <div className="stat-tile"><div className="stat-label">Activation (users with a trip)</div><div className="stat-value">{pct(funnel.activationPct)}</div></div>
        <div className="stat-tile"><div className="stat-label">Trips with collaborators</div><div className="stat-value">{pct(funnel.collabPct)}</div></div>
        <div className="stat-tile"><div className="stat-label">Trips published</div><div className="stat-value">{pct(funnel.publishPct)}</div></div>
        <div className="stat-tile"><div className="stat-label">Explore views → forks</div><div className="stat-value">{pct(funnel.viewToCopyPct)}</div></div>
      </div>
      <h3 style={{ marginTop: 18 }}>Growth — last 12 weeks</h3>
      <table className="compare-table">
        <thead><tr><th>Week of</th><th className="num">Signups</th><th className="num">Trips</th><th>Trend</th></tr></thead>
        <tbody>
          {growth.map(g => (
            <tr key={g.week}>
              <td className="small">{new Date(g.week).toLocaleDateString()}</td>
              <td className="num">{g.signups}</td>
              <td className="num">{g.trips}</td>
              <td>
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'end', height: 18 }} aria-hidden>
                  <span style={{ display: 'inline-block', width: 10, height: Math.max(2, Math.round((g.signups / maxBar) * 18)), background: 'var(--yf-teal-600)' }} />
                  <span style={{ display: 'inline-block', width: 10, height: Math.max(2, Math.round((g.trips / maxBar) * 18)), background: 'var(--yf-saffron)' }} />
                </span>
                <span className="sr-only">{g.signups} signups, {g.trips} trips</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint-text" style={{ marginTop: 8 }}>
        Teal bar = signups, saffron = trips. When M7 payments land, this tab grows the revenue row
        (payout periods, gross → net) on the existing earnings-ledger contract.
      </p>
    </div>
  )
}

function AuditTab() {
  const audit = useAdminAudit()
  const db = useDb()
  const actorName = (id: string) => db.users.find(u => u.id === id)?.profile.name ?? id.slice(0, 8)
  return (
    <div>
      {audit.length === 0 ? (
        <EmptyState icon={<ShieldAlert size={38} aria-hidden />} title="No admin actions yet"
          body="Every disable, visibility flip, removal, unpublish and delete lands here with who did it and when." />
      ) : (
        <table className="compare-table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>
            {audit.map(e => (
              <tr key={e.id}>
                <td className="small muted">{new Date(e.at).toLocaleString()}</td>
                <td className="small">{actorName(e.actorId)}</td>
                <td><Chip tone="info">{e.action}</Chip></td>
                <td className="small muted">{e.targetType ?? '—'}{e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ''}</td>
                <td className="small muted">{formatAuditDetail(e.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function formatAuditDetail(detail: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(detail)) {
    if (v === null || v === undefined) continue
    const s = Array.isArray(v) ? v.join(', ') : String(v)
    if (s.length > 80) continue // keep the row readable; full JSON lives in the DB
    parts.push(`${k}: ${s}`)
  }
  return parts.join(' · ') || '—'
}






