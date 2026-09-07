// Phase B — the unified read model for Events.
//
// Callers never iterate raw `events` rows for display. They load the org's
// series + one-time events plus any materialized `event_occurrences`
// (overrides / cancellations / reschedules) for a window, and this module
// resolves them into a flat, sorted list of ResolvedOccurrence — computed
// dates from the RRULE engine merged with whatever the DB has persisted.

import type { EventOccurrence, HQEvent } from '../types/database'
import { expandOccurrences, nextOccurrence, type SeriesArgs } from './recurrence'

export type OccurrenceDisplayStatus = 'scheduled' | 'live' | 'completed' | 'cancelled'

export interface ResolvedOccurrence {
  eventId: string
  /** DB row id when this date is materialized; null when purely computed. */
  occurrenceId: string | null
  seriesTitle: string
  title: string
  date: string // 'YYYY-MM-DD' local anchor
  startAt: Date
  endAt: Date
  status: OccurrenceDisplayStatus
  isRecurring: boolean
  category: HQEvent['category']
  venueType: HQEvent['venue_type']
  venueLocation: string | null
  meetingProvider: HQEvent['meeting_provider']
  meetingUrl: string | null
  organizerId: string | null
}

export function seriesArgsFrom(ev: HQEvent): SeriesArgs | null {
  if (!ev.is_recurring || !ev.recurrence_rule || !ev.series_start_date || !ev.local_start_time || !ev.duration_minutes) {
    return null
  }
  return {
    recurrenceRule: ev.recurrence_rule,
    seriesStartDate: ev.series_start_date,
    localStartTime: ev.local_start_time,
    durationMinutes: ev.duration_minutes,
    timezone: ev.timezone ?? 'Africa/Lagos',
    endType: ev.recurrence_end_type,
    until: ev.recurrence_until,
    count: ev.recurrence_count,
  }
}

function deriveStatus(startAt: Date, endAt: Date, stored: string | null, now: Date): OccurrenceDisplayStatus {
  if (stored === 'cancelled') return 'cancelled'
  if (now < startAt) return 'scheduled'
  if (now <= endAt) return 'live'
  return 'completed'
}

interface ResolveInput {
  events: HQEvent[]
  occurrences: EventOccurrence[] // materialized rows for the window (any status)
  from: Date
  to: Date
  now?: Date
}

/** All occurrences (computed + materialized) whose start falls in [from, to). */
export function resolveOccurrences({ events, occurrences, from, to, now = new Date() }: ResolveInput): ResolvedOccurrence[] {
  const byKey = new Map<string, EventOccurrence>()
  for (const o of occurrences) byKey.set(`${o.event_id}:${o.occurrence_date}`, o)

  const out: ResolvedOccurrence[] = []
  const seen = new Set<string>()

  for (const ev of events) {
    const base = {
      eventId: ev.id,
      seriesTitle: ev.title,
      isRecurring: ev.is_recurring,
      category: ev.category,
      venueType: ev.venue_type,
      venueLocation: ev.venue_location,
      meetingProvider: ev.meeting_provider,
      organizerId: ev.organizer_id,
    }

    if (!ev.is_recurring) {
      if (ev.status === 'draft') continue
      const startAt = new Date(ev.start_at)
      const endAt = new Date(ev.end_at)
      if (startAt < from || startAt >= to) continue
      out.push({
        ...base,
        occurrenceId: null,
        title: ev.title,
        date: ev.start_at.slice(0, 10),
        startAt,
        endAt,
        status: deriveStatus(startAt, endAt, ev.status === 'cancelled' ? 'cancelled' : null, now),
        meetingUrl: ev.meeting_url ?? ev.meeting_link,
      })
      continue
    }

    if (ev.status === 'draft') continue
    const args = seriesArgsFrom(ev)
    if (!args) continue

    for (const occ of expandOccurrences(args, from, to)) {
      const key = `${ev.id}:${occ.date}`
      seen.add(key)
      const row = byKey.get(key)
      const startAt = row ? new Date(row.start_at) : occ.startAt
      const endAt = row ? new Date(row.end_at) : occ.endAt
      out.push({
        ...base,
        occurrenceId: row?.id ?? null,
        title: row?.override_title ?? ev.title,
        date: occ.date,
        startAt,
        endAt,
        status: deriveStatus(startAt, endAt, row?.status ?? null, now),
        meetingUrl: row?.meeting_url ?? ev.meeting_url,
      })
    }
  }

  // Materialized rows whose (rescheduled) start landed in the window but
  // whose original computed date did not — include them too.
  for (const row of occurrences) {
    const key = `${row.event_id}:${row.occurrence_date}`
    if (seen.has(key)) continue
    const startAt = new Date(row.start_at)
    if (startAt < from || startAt >= to) continue
    const ev = events.find((e) => e.id === row.event_id)
    if (!ev || ev.status === 'draft') continue
    const endAt = new Date(row.end_at)
    out.push({
      eventId: ev.id,
      occurrenceId: row.id,
      seriesTitle: ev.title,
      title: row.override_title ?? ev.title,
      date: row.occurrence_date,
      startAt,
      endAt,
      status: deriveStatus(startAt, endAt, row.status, now),
      isRecurring: ev.is_recurring,
      category: ev.category,
      venueType: ev.venue_type,
      venueLocation: ev.venue_location,
      meetingProvider: ev.meeting_provider,
      meetingUrl: row.meeting_url ?? ev.meeting_url,
      organizerId: ev.organizer_id,
    })
  }

  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

/** The single next non-finished occurrence across every series + one-time event. */
export function nextUpcoming(events: HQEvent[], occurrences: EventOccurrence[], now: Date = new Date()): ResolvedOccurrence | null {
  // One-time: nearest future/live.
  let best: ResolvedOccurrence | null = null
  const consider = (r: ResolvedOccurrence) => {
    if (r.status === 'cancelled' || r.status === 'completed') return
    if (r.endAt < now) return
    if (!best || r.startAt < best.startAt) best = r
  }

  const soon = resolveOccurrences({
    events,
    occurrences,
    from: new Date(now.getTime() - 12 * 3600_000),
    to: new Date(now.getTime() + 120 * 24 * 3600_000),
    now,
  })
  for (const r of soon) consider(r)

  // Never-ending series with no hit in the 120-day window: fall back to the
  // engine's long scan.
  if (!best) {
    for (const ev of events) {
      if (!ev.is_recurring || ev.status === 'draft') continue
      const args = seriesArgsFrom(ev)
      if (!args) continue
      const n = nextOccurrence(args, now)
      if (n) {
        consider({
          eventId: ev.id, occurrenceId: null, seriesTitle: ev.title, title: ev.title,
          date: n.date, startAt: n.startAt, endAt: n.endAt, status: 'scheduled',
          isRecurring: true, category: ev.category, venueType: ev.venue_type,
          venueLocation: ev.venue_location, meetingProvider: ev.meeting_provider,
          meetingUrl: ev.meeting_url, organizerId: ev.organizer_id,
        })
      }
    }
  }
  return best
}
