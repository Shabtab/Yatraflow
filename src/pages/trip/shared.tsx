// ============ Pieces shared by several trip-workspace tabs ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.

export { cap } from '../../lib/labels'
export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
