// ============ My trips ============
import { useState } from 'react'
import { Clock, Compass, Plus, Rocket, Trash2, Wallet } from 'lucide-react'
import { MetaIcon } from '../components/icons'
import { useTrips, useUsers, useSessionUserId, tripsForUser, deleteTrip, restoreTrip, addDemoTrips } from '../store/store'
import { computeTotals, formatInrShort } from '../lib/engine'
import { Avatar, Chip, EmptyState, toast, undoToast, ConfirmDialog } from '../components/ui'
import { CoverThumb } from '../components/CoverThumb'
import type { Trip, User } from '../data/types'

export function TripsListPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  // Slice subscriptions: this page only re-renders when trips, profiles or the
  // session actually change — not on every unrelated store commit.
  const allTrips = useTrips()
  const users = useUsers()
  const meId = useSessionUserId()
  const trips = tripsForUser(meId).sort((a, b) => b.updatedAt - a.updatedAt)
  const [pendingDelete, setPendingDelete] = useState<Trip | null>(null)

  function confirmDelete() {
    if (!pendingDelete) return
    const doomed = pendingDelete
    const idx = allTrips.findIndex(t => t.id === doomed.id)
    deleteTrip(doomed.id)
    undoToast(`Deleted “${doomed.name}”`, () => {
      restoreTrip(doomed, idx)
      toast(`Restored “${doomed.name}”`)
    })
  }

  return (
    <div className="container" style={{ paddingTop: 26 }}>
      <div className="row-between" style={{ marginBottom: 18 }}>
        <div>
          <h1>My trips</h1>
          <p className="muted small">Everything you’re planning or collaborating on.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={addDemoTrips} title="Adds 3 sample trips — Kerala, Goa & Rajasthan — to your account"><Rocket size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />Load demo trips</button>
          <button className="btn btn-primary" onClick={() => onNavigate('/new')}><Plus size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Plan a new trip</button>
        </div>
      </div>

      {trips.length === 0 ? (
        <EmptyState
          icon={<Compass size={38} aria-hidden />}
          title="No trips yet"
          body="Start from scratch with dates and budget, or copy a public itinerary from Explore."
          action={
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => onNavigate('/new')}>Plan your first trip</button>
              <button className="btn btn-outline" onClick={addDemoTrips}><Rocket size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />Load demo trips</button>
              <button className="btn btn-outline" onClick={() => onNavigate('/explore')}>Browse Explore</button>
            </div>
          }
        />
      ) : (
        <div className="explore-grid">
          {trips.map((t, i) => {
            const totals = computeTotals(t)
            const others = (t.members ?? []).filter(m => m.userId !== meId)
            return (
              <div key={t.id} className="card itin-card trip-enter" style={{ animationDelay: `${Math.min(i, 8) * 70}ms` }}>
                <a className="trip-card-hit" href={`#/trip/${t.id}`}>
                  <CoverThumb
                    variant="short"
                    trip={t}
                    explicitUrl={t.coverImageUrl}
                    emoji={t.coverEmoji}
                  />
                  <div className="itin-body">
                    <h2 className="card-title">{t.name}</h2>
                    <div className="small muted">
                      {t.startLocation} → {t.destinations[t.destinations.length - 1] ?? t.startLocation} · {t.days.length} days
                    </div>
                    <div className="stop-meta num">
                      <span><MetaIcon icon={ Wallet } tone="money" />~{formatInrShort(totals.costPerPersonInr)}/person</span>
                      <span><MetaIcon icon={ Clock } tone="time" />{Math.round(totals.totalTravelMinutes / 60)}h travel</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Chip tone="teal">{cap(t.travelStyle)}</Chip>
                      {(t.members ?? []).length > 1 && <Chip tone="info">{(t.members ?? []).length} planners</Chip>}
                    </div>
                  </div>
                </a>
                <div className="row-between itin-meta">
                  <div className="member-stack">
                    {others.slice(0, 3).map(m => <Avatar key={m.userId} user={userOf(users, m.userId)} />)}
                    {others.length > 3 && <span className="small muted num">+{others.length - 3}</span>}
                    {!others.length && <span className="small muted">Just you so far</span>}
                  </div>
                  <button className="icon-btn" aria-label={`Delete ${t.name}`} onClick={() => setPendingDelete(t)}><Trash2 size={14} aria-hidden /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete “${pendingDelete?.name ?? ''}”?`}
        body="This removes the trip from your workspace. You’ll get a short window to undo from the toast."
        confirmLabel="Delete trip"
        danger
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
function userOf(users: User[], id: string): User | undefined {
  return users.find(u => u.id === id)
}
