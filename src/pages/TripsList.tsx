// ============ My trips ============
import { useState } from 'react'
import { useDb, currentUser, tripsForUser, userById, deleteTrip, restoreTrip } from '../store/store'
import { computeTotals } from '../lib/engine'
import { Avatar, Chip, EmptyState, toast, undoToast, ConfirmDialog } from '../components/ui'
import type { Trip } from '../data/types'

export function TripsListPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const trips = tripsForUser(me?.id ?? null).sort((a, b) => b.updatedAt - a.updatedAt)
  const [pendingDelete, setPendingDelete] = useState<Trip | null>(null)

  function confirmDelete() {
    if (!pendingDelete) return
    const doomed = pendingDelete
    const idx = db.trips.findIndex(t => t.id === doomed.id)
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
          <p className="muted small">Everything you're planning or collaborating on.</p>
        </div>
        <button className="btn btn-primary" onClick={() => onNavigate('/new')}>+ Plan a new trip</button>
      </div>

      {trips.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="No trips yet"
          body="Start from scratch with dates and budget, or copy a public itinerary from Explore."
          action={
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => onNavigate('/new')}>Plan your first trip</button>
              <button className="btn btn-outline" onClick={() => onNavigate('/explore')}>Browse Explore</button>
            </div>
          }
        />
      ) : (
        <div className="explore-grid">
          {trips.map(t => {
            const totals = computeTotals(t)
            const others = (t.members ?? []).filter(m => m.userId !== me?.id)
            return (
              <div key={t.id} className="card itin-card">
                <button className="trip-card-hit" onClick={() => onNavigate(`/trip/${t.id}`)} aria-label={`Open ${t.name}`}>
                  <div className="itin-emoji">{t.coverEmoji}</div>
                  <div className="itin-body">
                    <h3>{t.name}</h3>
                    <div className="small muted">
                      {t.startLocation} → {t.destinations[t.destinations.length - 1]} · {t.days.length} days
                    </div>
                    <div className="stop-meta">
                      <span>💰 ~{formatShort(totals.costPerPersonInr)}/person</span>
                      <span>🕒 {Math.round(totals.totalTravelMinutes / 60)}h travel</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Chip tone="teal">{cap(t.travelStyle)}</Chip>
                      {(t.members ?? []).length > 1 && <Chip tone="info">{(t.members ?? []).length} planners</Chip>}
                    </div>
                  </div>
                </button>
                <div className="row-between itin-meta">
                  <div className="member-stack">
                    {others.slice(0, 3).map(m => <Avatar key={m.userId} user={userById(m.userId)} />)}
                    {!others.length && <span className="small muted">Just you so far</span>}
                  </div>
                  <button className="icon-btn" aria-label={`Delete ${t.name}`} onClick={() => setPendingDelete(t)}>🗑️</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete “${pendingDelete?.name ?? ''}”?`}
        body="This removes the trip from your workspace. You'll get a short window to undo from the toast."
        confirmLabel="Delete trip"
        danger
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
function formatShort(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000) return `₹${Math.round(n / 1000)}k`
  return `₹${Math.round(n)}`
}
