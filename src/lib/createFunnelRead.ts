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

/** Last 30 days of funnel events, newest first is fine — deriveCreateFunnel
 *  buckets by date, not order. */
export async function fetchCreateFunnelEvents(days = 30): Promise<CreateFunnelRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('create_funnel_events')
    .select('event, at, meta')
    .gte('at', since)
    .order('at', { ascending: false })
    .limit(20000)
  if (error) {
    console.error('[yatraflow] create funnel read failed', error)
    throw error
  }
  return (Array.isArray(data) ? data : []) as CreateFunnelRow[]
}
