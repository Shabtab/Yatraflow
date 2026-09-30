// ============ Masteradmin console — #/admin ============
// Gated on the JWT app_metadata role (useIsAdmin): non-admins fall through to
// the landing page, exactly like CreatorHub's creator gate. All data comes
// from the admin-widened hydration (full trips/users slices + audit log);
// every destructive button calls an audited SECURITY DEFINER RPC via the
// store. Destructive actions confirm first; trip delete confirms by typing
// the trip name (no undo — cascades take the collab layer).
import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, ShieldAlert, Trash2, UserX, Users } from 'lucide-react'
import { PillNav } from '../components/PillNav'
import { useTablist } from '../hooks/useTablist'
import { Avatar, Chip, ConfirmDialog, EmptyState, Modal } from '../components/ui'
import {
  useDb, useIsAdmin, useAdminAudit, useAdminAuditFailed, useSessionUserId, refreshAdminAuditNow,
  adminSetDisabled, adminSetCreator, adminSetTripVisibility,
  adminRemoveMember, adminUnpublish, adminDeleteTrip, adminDeleteUser,
} from '../store/store'
import {
  computeAdminOverview, computeGrowthSeries, computeFunnel, recentJoins,
  platformRevenue, type PlatformRevenue, type PlatformSale,
} from '../lib/adminStats'
import { fetchAdminRevenue, fetchAdminShareAttribution, type ShareAttributionRow } from '../lib/unlock'
import { SHARE_SOURCE_LABELS } from '../lib/shareUrl'
import { fetchCreateFunnelEvents } from '../lib/createFunnelRead'
import { deriveCreateFunnel } from '../lib/createEvents'
import { formatInr } from '../lib/engine'
import type { Trip, User } from '../data/types'
import { appLink } from '../lib/appLink'

type AdminTab = 'overview' | 'users' | 'trips' | 'invites' | 'content' | 'analytics' | 'audit'

const ADMIN_TABS: [AdminTab, string][] = [
  ['overview', 'Overview'], ['users', 'Users'], ['trips', 'Trips'],
  ['invites', 'Invites'], ['content', 'Content'],
  ['analytics', 'Analytics'], ['audit', 'Audit log'],
]
const ADMIN_TAB_IDS = ADMIN_TABS.map(([k]) => k)

export function AdminPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const isAdmin = useIsAdmin()
  const readyGate = useDb().ready
  const [tab, setTab] = useState<AdminTab>('overview')
  const loggedIn = Boolean(useSessionUserId())
  // #87: roving tabindex + arrow keys for the section tablist.
  const { refs: tabRefs, tabProps } = useTablist(ADMIN_TAB_IDS, tab, setTab)

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
      <h1>Master admin</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>
        Full-control console — every destructive action is audit-logged.
        {/* #367: the hatch boundary, said where admins will see it. Direct
            writes through the workspace's own UI are the documented escape
            hatch (admin FOR ALL policies) and only the console's RPC actions
            land in the audit log. */}
        Actions taken here are logged. Actions taken through the regular workspace are not.
      </p>
      {/* #87: role="tab" children with aria-pressed and no keyboard contract —
          now the shared useTablist primitive (roving tabindex + arrows). */}
      <PillNav className="filter-pillbar" role="tablist" aria-label="Admin sections" activeKey={tab}>
        {ADMIN_TABS.map(([k, label], i) => (
          <button key={k} ref={tabRefs(i)} type="button" data-pill-key={k}
            className={`clickable-chip chip${tab === k ? ' on-teal' : ''}`}
            onClick={() => setTab(k)} role="tab" id={`admin-tab-${k}`}
            aria-selected={tab === k} aria-controls="admin-panel" {...tabProps(k, i)}>{label}</button>
        ))}
      </PillNav>
      <div style={{ marginTop: 18 }} id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'trips' && <TripsTab />}
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
  // Type-to-confirm delete (same pattern as the Trips tab's trip deletion —
  // ConfirmDialog has no child slot, so this is a Modal). `force` is the
  // second explicit opt-in the RPC demands before destroying published
  // Explore listings; it only becomes checkable inside the modal.
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const [deleteForce, setDeleteForce] = useState(false)
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
        <table className="compare-table" tabIndex={0} aria-label="Users">
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
                    {u.id !== meId && (
                      <button className="btn btn-outline btn-sm" disabled={busy}
                        aria-label={`Delete ${u.profile.name} permanently`}
                        onClick={() => { setDeleteTarget(u); setDeleteName(''); setDeleteForce(false) }}>
                        <UserX size={13} aria-hidden />
                      </button>
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
      {/* Type-to-confirm PERMANENT delete — no undo: the FK cascades take the
          account, every owned trip (plan + collab layer), authored rows in
          other crews' trips, and (force only) public Explore listings. The
          audit log keeps a snapshot row. */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.profile.name ?? ''} permanently?`}>
        <p className="muted" style={{ marginTop: 0 }}>
          This cannot be undone. Deleting <strong>{deleteTarget?.email ?? ''}</strong> removes
          every trip they own (plans, expenses, votes, decisions, activity), their rows in other
          crews' trips, and their notifications. The audit log keeps a snapshot.
        </p>
        {(() => {
          const pubs = deleteTarget ? db.published.filter(p => p.creatorId === deleteTarget.id).length : 0
          const owned = deleteTarget ? db.trips.filter(t => (t.members ?? []).some(m => m.userId === deleteTarget.id && m.role === 'owner')).length : 0
          return (
            <p className="muted small">
              {owned} owned trip{owned === 1 ? '' : 's'}
              {pubs > 0 && <> · <strong>{pubs} published listing{pubs === 1 ? '' : 's'}</strong></>}
            </p>
          )
        })()}
        {(() => {
          const pubs = deleteTarget ? db.published.filter(p => p.creatorId === deleteTarget.id).length : 0
          return pubs > 0 ? (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '10px 0' }}>
              <input type="checkbox" checked={deleteForce} onChange={e => setDeleteForce(e.target.checked)}
                style={{ marginTop: 3 }} />
              <span className="small">
                Also delete the published itinerary(ies) — they are public on Explore and will
                disappear for everyone. The RPC refuses the deletion without this.
              </span>
            </label>
          ) : null
        })()}
        <input className="input" value={deleteName} onChange={e => setDeleteName(e.target.value)}
          placeholder={deleteTarget?.email ?? 'Email'} aria-label="Type the user's email to confirm"
          style={{ marginTop: 10 }} />
        <div className="confirm-actions">
          <button
            className="btn btn-sm btn-danger"
            disabled={busy || deleteName.trim().toLowerCase() !== (deleteTarget?.email ?? '').trim().toLowerCase() || (deleteTarget?.email.trim() ?? '') === ''}
            onClick={() => {
              if (!deleteTarget) return
              const target = deleteTarget
              setDeleteTarget(null)
              setBusy(true)
              void adminDeleteUser(target.id, deleteForce).finally(() => setBusy(false))
            }}
          >Delete user forever</button>
          <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
        </div>
      </Modal>
    </div>
  )
}

function TripsTab() {
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
      <table className="compare-table" tabIndex={0} aria-label="Trips">
        <thead><tr><th>Trip</th><th>Owner</th><th className="num">Crew</th><th>Visibility</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>
          {trips.map(t => (
            <tr key={t.id}>
              <td><a {...appLink(`/trip/${t.id}`)}>{t.name}</a><br /><span className="muted small">{t.days.length}d · {t.destinations.join(' → ') || t.startLocation}</span></td>
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
      <table className="compare-table" tabIndex={0} aria-label="Invites">
        <thead><tr><th>Trip</th><th className="num">Joins 30d</th><th className="num">Crew</th><th>Members</th></tr></thead>
        <tbody>
          {rows.map(({ trip: t, joins30d }) => (
            <tr key={t.id}>
              <td><a {...appLink(`/trip/${t.id}`)}>{t.name}</a><br /><span className="muted small">{t.visibility}</span></td>
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
                          <ShieldAlert size={13} aria-hidden />
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
        <table className="compare-table" tabIndex={0} aria-label="Published itineraries">
          <thead><tr><th>Itinerary</th><th>Creator</th><th className="num">Views</th><th className="num">Forks</th><th>Published</th><th>Actions</th></tr></thead>
          <tbody>
            {pubs.map(p => {
              const creator = db.users.find(u => u.id === p.creatorId)
              return (
                <tr key={p.id}>
                  <td><a {...appLink(`/pub/${p.id}`)}>{p.title}</a><br /><span className="muted small">{p.routeSummary.join(' → ')}</span></td>
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
        body="It leaves Explore and stops selling. The trip itself is not touched, the creator keeps its sales history, and anyone who already unlocked it keeps the full plan. The creator can re-publish from their Share tab."
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

/** Reading the sales ledger: the read is async and can fail, and a console
 *  that renders ₹0 for a failed read has told the operator something false. */
type RevenueState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; rows: PlatformSale[] }

function AnalyticsTab() {
  const db = useDb()
  const funnel = useMemo(() => computeFunnel(db.users, db.trips, db.published), [db])
  const growth = useMemo(() => computeGrowthSeries(db.users, db.trips, 12), [db.users, db.trips])
  const [revenue, setRevenue] = useState<RevenueState>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // #230 — share attribution: how readers ARRIVED. pub_events is scoped by
  // RLS to its creator (and now the admin RPC), so like revenue this is its
  // own network read — with the same empty-vs-error rule: a failed read
  // renders Retry, never a friendly zero that reads as "no shares".
  const [attr, setAttr] = useState<{ phase: 'loading' | 'ready' | 'error'; rows?: ShareAttributionRow[]; message?: string }>({ phase: 'loading' })
  const [attrAttempt, setAttrAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setAttr({ phase: 'loading' })
    fetchAdminShareAttribution()
      .then(rows => { if (live) setAttr({ phase: 'ready', rows }) })
      .catch((err: unknown) => {
        if (!live) return
        const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)
        setAttr({ phase: 'error', message })
      })
    return () => { live = false }
  }, [attrAttempt])
  // #428: the create funnel's dated event log. Same empty-vs-error rule as the
  // revenue read — a failed read renders a Retry, never a friendly zero.
  const [cf, setCf] = useState<{ phase: 'loading' | 'ready' | 'error'; message?: string }>({ phase: 'loading' })
  const [cfAttempt, setCfAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setCf({ phase: 'loading' })
    fetchCreateFunnelEvents()
      .then(rows => { if (live) { setCfRows(rows); setCf({ phase: 'ready' }) } })
      .catch((err: unknown) => {
        if (!live) return
        const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)
        setCf({ phase: 'error', message })
      })
    return () => { live = false }
  }, [cfAttempt])
  const [cfRows, setCfRows] = useState<Parameters<typeof deriveCreateFunnel>[0]>([])
  const cfStats = useMemo(
    () => (cf.phase === 'ready' ? deriveCreateFunnel(cfRows) : null),
    [cf, cfRows],
  )
  const creatorName = (id: string) => db.users.find(u => u.id === id)?.profile.name ?? id.slice(0, 8)
  // The per-publication breakdown needs publication TITLES, and it can normally
  // have them: `published read` is open to everyone, and a soft-unpublished plan
  // KEEPS its row (#350 — that is precisely what preserves its buyers' access
  // and the creator's history), so the cache still resolves it. A row that is
  // genuinely gone — the reserved permanent-delete path — keeps its id as the
  // label rather than leaving the row nameless.
  const pubTitle = useMemo(() => {
    const titles = new Map(db.published.map(p => [p.id, p.title]))
    return (pubId: string) => titles.get(pubId) ?? pubId
  }, [db.published])
  // Entitlements are not in the hydrated cache — they are owner-scoped by RLS —
  // so unlike every other figure on this tab the revenue read is a network call
  // through the admin-gated RPC. It rejects rather than degrading to [], which
  // is why this has a real error state instead of an empty one.
  useEffect(() => {
    let live = true
    setRevenue({ phase: 'loading' })
    fetchAdminRevenue()
      .then(rows => { if (live) setRevenue({ phase: 'ready', rows }) })
      .catch((err: unknown) => {
        if (!live) return
        const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)
        setRevenue({ phase: 'error', message })
      })
    return () => { live = false }
  }, [attempt])
  // Derived from the fetched rows rather than folded into the fetch: the titles
  // come from the hydrated cache, which changes on its own, and a breakdown frozen
  // at fetch time would label a plan with whatever its title happened to be then.
  const books = useMemo<PlatformRevenue | null>(
    () => (revenue.phase === 'ready' ? platformRevenue(revenue.rows, pubTitle) : null),
    [revenue, pubTitle],
  )
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
      <p className="hint-text" style={{ marginTop: 8 }}>
        Raw: {db.published.reduce((s, p) => s + p.views, 0)} views · {db.published.reduce((s, p) => s + p.copies, 0)} forks.
      </p>
      <h2 style={{ marginTop: 18 }}>Growth — last 12 weeks</h2>
      <table className="compare-table" tabIndex={0} aria-label="Growth — last 12 weeks">
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
        Teal bar = signups, saffron = trips.
      </p>

      <h2 style={{ marginTop: 18 }}>Share attribution — how readers arrived</h2>
      {attr.phase === 'loading' && <p className="hint-text">Reading the funnel log…</p>}
      {attr.phase === 'error' && (
        <>
          <p className="hint-text">
            The funnel log could not be read — {attr.message}. This section shows nothing rather
            than a zero it cannot vouch for.
          </p>
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setAttrAttempt(a => a + 1)}>
            Retry
          </button>
        </>
      )}
      {attr.phase === 'ready' && (attr.rows ?? []).length === 0 && (
        <p className="hint-text">
          No recorded traffic yet — this fills in from the first view of a shared link.
        </p>
      )}
      {attr.phase === 'ready' && (attr.rows ?? []).length > 0 && (
        <>
          <table className="compare-table" tabIndex={0} aria-label="Share attribution — how readers arrived">
            <thead><tr><th>Route in</th><th className="num">Views</th><th className="num">Forks</th><th className="num">View → fork</th><th>Last seen</th></tr></thead>
            <tbody>
              {(attr.rows ?? []).map(row => (
                <tr key={row.source}>
                  <td>{SHARE_SOURCE_LABELS[row.source] ?? row.source}</td>
                  <td className="num">{row.views}</td>
                  <td className="num">{row.forks}</td>
                  <td className="num">{row.views === 0 ? '—' : pct((row.forks / row.views) * 100)}</td>
                  <td className="small">{row.lastAt ? new Date(row.lastAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint-text" style={{ marginTop: 8 }}>
            Route in = the ref a shared link carried, or the in-app surface that forked. Direct
            is a visitor who arrived some other way. The two stages count the same kind of thing
            (one view and one fork per browser session), so a rate above 100% is possible and
            means a reader forked without a recorded visit.
          </p>
        </>
      )}

      <h2 style={{ marginTop: 18 }}>Revenue</h2>
      {revenue.phase === 'loading' && <p className="hint-text">Reading the sales ledger…</p>}
      {revenue.phase === 'error' && (
        <>
          <p className="hint-text">
            The sales ledger could not be read — {revenue.message}. The numbers below are the
            books as the database reports them, so this tab shows nothing rather than a zero it
            cannot vouch for.
          </p>
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setAttempt(a => a + 1)}>
            Retry
          </button>
        </>
      )}
      {revenue.phase === 'ready' && books && (books.sales.rows.length === 0 ? (
        <p className="hint-text">
          No sales yet — this fills in as soon as someone buys a priced publication.
        </p>
      ) : (
        <>
          <div className="creator-stats" role="group" aria-label="Platform revenue">
            <div className="stat-tile"><div className="stat-label">Gross</div><div className="stat-value">{formatInr(books.sales.grossInr)}</div></div>
            <div className="stat-tile"><div className="stat-label">Platform fee</div><div className="stat-value">{formatInr(books.sales.feeInr)}</div></div>
            <div className="stat-tile"><div className="stat-label">Creator net</div><div className="stat-value">{formatInr(books.sales.netInr)}</div></div>
            <div className="stat-tile"><div className="stat-label">Sales</div><div className="stat-value">{books.sales.rows.length}</div></div>
          </div>
          <table className="compare-table" tabIndex={0} aria-label="Platform revenue by week">
            <thead><tr><th>Week of</th><th className="num">Sales</th><th className="num">Gross</th><th className="num">Fee</th><th className="num">Net</th></tr></thead>
            <tbody>
              {books.periods.map(p => (
                <tr key={p.runAt}>
                  <td className="small">{new Date(p.runAt).toLocaleDateString()}</td>
                  <td className="num">{p.salesCount}</td>
                  <td className="num">{formatInr(p.grossInr)}</td>
                  <td className="num">{formatInr(p.feeInr)}</td>
                  <td className="num">{formatInr(p.netInr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint-text" style={{ marginTop: 8 }}>
            Weeks are the payout runs creators are told about. The fee is the 15% / 10% ladder
            charged to each of {books.creators} {books.creators === 1 ? 'creator' : 'creators'}
            {' '}separately — the tier follows a creator's own lifetime gross, so it is not one
            ladder over the platform total. Figures cover current unlocks: a refunded sale is
            revoked, so refunded money leaves these totals.
          </p>

          <h3 style={{ marginTop: 18, marginBottom: 6 }}>By publication</h3>
          <table className="compare-table" tabIndex={0} aria-label="Revenue by publication">
            <thead><tr><th>Plan</th><th>Creator</th><th className="num">Sales</th><th className="num">Gross</th><th className="num">Fee</th><th className="num">Net</th></tr></thead>
            <tbody>
              {books.publications.map(p => (
                <tr key={p.pubId}>
                  <td className="small">{p.title}</td>
                  <td className="small">{creatorName(p.creatorId)}</td>
                  <td className="num">{p.salesCount}</td>
                  <td className="num">{formatInr(p.grossInr)}</td>
                  <td className="num">{formatInr(p.feeInr)}</td>
                  <td className="num">{formatInr(p.netInr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint-text" style={{ marginTop: 8 }}>
            The same rows as the weekly table, grouped by plan instead of by date, and they add up
            to the tiles above — each fee is its own sale's slice of that creator's ladder, not a
            rate applied to a plan's total. A plan nobody bought is absent rather than a ₹0 row.
          </p>
        </>
      ))}

      <h2 style={{ marginTop: 18 }}>Create funnel — last 30 days</h2>
      {cf.phase === 'loading' && <p className="hint-text">Reading the funnel log…</p>}
      {cf.phase === 'error' && (
        <>
          <p className="hint-text">
            The funnel log could not be read — {cf.message}. This tab shows nothing rather
            than a zero it cannot vouch for.
          </p>
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setCfAttempt(a => a + 1)}>
            Retry
          </button>
        </>
      )}
      {cf.phase === 'ready' && cfStats && (
        <>
          <div className="creator-stats" role="group" aria-label="Create funnel">
            <div className="stat-tile"><div className="stat-label">Started /new</div><div className="stat-value">{cfStats.counts.started}</div></div>
            <div className="stat-tile"><div className="stat-label">Submitted</div><div className="stat-value">{cfStats.counts.submitted}</div></div>
            <div className="stat-tile"><div className="stat-label">Started → submitted</div><div className="stat-value">{pct(cfStats.conversionPct)}</div></div>
            <div className="stat-tile"><div className="stat-label">Drafts resumed</div><div className="stat-value">{cfStats.counts.draft_resumed}</div></div>
          </div>
          <table className="compare-table" tabIndex={0} aria-label="Create funnel events, last 30 days">
            <thead><tr><th>Event</th><th className="num">Count</th></tr></thead>
            <tbody>
              {(Object.entries(cfStats.counts) as [string, number][]).filter(([, n]) => n > 0).map(([ev, n]) => (
                <tr key={ev}><td className="small">{ev}</td><td className="num">{n}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="hint-text" style={{ marginTop: 8 }}>
            Top abandonment stage: {cfStats.topAbandonStage ?? '—'}.
            {cfStats.templates.length > 0 && ` Template picks: ${cfStats.templates.slice(0, 5).map(t => `${t.templateId} (${t.picks})`).join(', ')}.`}
            {' '}The abandoned event is best-effort (mobile kills page beacons), so it is
            directional — never read it as an exact denominator.
          </p>
        </>
      )}
    </div>
  )
}

function AuditTab() {
  const audit = useAdminAudit()
  const auditFailed = useAdminAuditFailed()
  const db = useDb()
  const actorName = (id: string) => db.users.find(u => u.id === id)?.profile.name ?? id.slice(0, 8)
  // #367: focus-poll — the realtime channel carries live rows, but a socket
  // gap (laptop sleep) is replayed for trips only, so returning to the tab
  // re-reads. A failed read surfaces a Retry instead of the friendly empty
  // copy: an empty log and a broken read must not render identically.
  useEffect(() => {
    void refreshAdminAuditNow()
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshAdminAuditNow() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  return (
    <div>
      {auditFailed && (
        <div className="warn-item sev-mid" role="status" style={{ marginBottom: 12 }}>
          <span className="warn-icon"><ShieldAlert size={13} aria-hidden /></span>
          <div style={{ flex: 1 }}>
            <div className="warn-title">The audit log couldn't be read.</div>
            <div className="warn-fix">Rows shown below may be out of date — nothing was lost.</div>
          </div>
          <button type="button" className="btn btn-outline" onClick={() => void refreshAdminAuditNow()}>Retry</button>
        </div>
      )}
      {audit.length === 0 ? (
        <EmptyState icon={<ShieldAlert size={38} aria-hidden />} title="No admin actions yet"
          body="Every disable, visibility flip, removal, unpublish and delete lands here with who did it and when." />
      ) : (
        <table className="compare-table" tabIndex={0} aria-label="Audit log">
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






