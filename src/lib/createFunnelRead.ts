/**
 * The admin read half of the create-funnel event log (#428).
 *
 * Reads are admin-only by RLS (the table's only SELECT policy), so this runs
 * as a straight client read under an admin session — the same shape the
 * hydrated tables would take if they carried funnel rows. It THROWS on a
 * failed read rather than degrading to [], so the Analytics tab can render a
 * Retry instead of a friendly-looking empty state (the empty-vs-error rule).
 */
import { supabase } from './supabase'
import type { CreateFunnelRow } from './createEvents'
import { funnelWindowStart } from './pubFunnel'

/** Read the bounded UTC window in stable order. Reject incomplete reads. */
export async function fetchCreateFunnelEvents(days = 30): Promise<CreateFunnelRow[]> {
  const now = new Date()
  const span = Number.isFinite(days) ? Math.min(90, Math.max(1, Math.floor(days))) : 30
  const since = new Date(funnelWindowStart(span, now.getTime())).toISOString()
  const rows: CreateFunnelRow[] = []
  let total: number | null = null
  do {
    const { data, error, count } = await supabase
      .from('create_funnel_events')
      .select('id, event, at, meta, trip_id', { count: 'exact' })
      .gte('at', since)
      .lte('at', now.toISOString())
      .order('at', { ascending: true })
      .order('id', { ascending: true })
      .range(rows.length, rows.length + 999)
    if (error) throw error
    if (count == null || (total !== null && count !== total)) throw new Error('The create log changed during this read. Retry.')
    total = count
    const page = Array.isArray(data) ? data : []
    if (page.length === 0 && rows.length < total) throw new Error('The create log read was incomplete. Retry.')
    rows.push(...page as CreateFunnelRow[])
  } while (rows.length < total)
  return rows
}
