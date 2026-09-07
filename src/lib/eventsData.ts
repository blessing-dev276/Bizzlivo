// Phase B — shared loader. One place that fetches the org's events +
// materialized occurrences for a window and resolves them, so the Events
// page, the dashboard widgets and the member home all agree.

import { supabase } from './supabase'
import type { EventOccurrence, HQEvent } from '../types/database'
import { resolveOccurrences, nextUpcoming, type ResolvedOccurrence } from './eventSeries'

export interface LoadedEvents {
  events: HQEvent[]
  occurrences: EventOccurrence[]
}

/** All non-draft events for the org + occurrence rows whose start is in
 *  [from, to). Recurring series are always returned in full (they're few);
 *  occurrence rows are windowed. */
export async function loadOrgEvents(orgId: string, from: Date, to: Date): Promise<LoadedEvents> {
  const [eventsRes, occRes] = await Promise.all([
    supabase.from('events').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
    supabase
      .from('event_occurrences')
      .select('*')
      .eq('org_id', orgId)
      .gte('start_at', from.toISOString())
      .lt('start_at', to.toISOString()),
  ])
  return {
    events: (eventsRes.data as HQEvent[]) ?? [],
    occurrences: (occRes.data as EventOccurrence[]) ?? [],
  }
}

export async function loadResolvedOccurrences(orgId: string, from: Date, to: Date): Promise<ResolvedOccurrence[]> {
  const { events, occurrences } = await loadOrgEvents(orgId, from, to)
  return resolveOccurrences({ events, occurrences, from, to })
}

/** Today's + the next N days of occurrences, plus the single next-upcoming. */
export async function loadUpcoming(orgId: string, days = 45): Promise<{
  occurrences: ResolvedOccurrence[]
  next: ResolvedOccurrence | null
}> {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = new Date(from.getTime() + days * 86400000)
  const { events, occurrences } = await loadOrgEvents(orgId, from, to)
  return {
    occurrences: resolveOccurrences({ events, occurrences, from, to, now }),
    next: nextUpcoming(events, occurrences, now),
  }
}
