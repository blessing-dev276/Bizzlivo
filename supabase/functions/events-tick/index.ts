// Supabase Edge Function (Deno): the Events heartbeat.
//
// Invoked ~every 10 min by pg_cron (see 0072_events_tick.sql). One pass:
//   1. materialize occurrences that fall inside the reminder horizon
//      (up to the largest reminder window ahead), so reminders_sent can be
//      tracked per date — nothing is materialized further out than needed;
//   2. dispatch due reminders: for each upcoming occurrence and each
//      reminder window not yet sent, insert in-app notifications (and,
//      when the series opts in, enqueue one email per recipient) with a
//      stable dedupe key, then record the window on reminders_sent;
//   3. mark finished occurrences 'completed'.
//
// Cancelled occurrences never get reminders. Auth: an x-worker-secret
// header matching EMAIL_WORKER_SECRET (same secret the email worker uses).
//
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Required secret: EMAIL_WORKER_SECRET

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { expandOccurrences, type SeriesArgs } from '../_shared/recurrence.ts'

const REMINDER_HORIZON_MIN = 1500 // 25h — covers a "1 day before" window
const MATERIALIZE_AHEAD_DAYS = 2

interface EventRow {
  id: string
  org_id: string
  title: string
  is_recurring: boolean
  status: string
  start_at: string | null
  end_at: string | null
  timezone: string | null
  local_start_time: string | null
  duration_minutes: number | null
  recurrence_rule: string | null
  series_start_date: string | null
  recurrence_end_type: 'never' | 'until' | 'count'
  recurrence_until: string | null
  recurrence_count: number | null
  reminder_minutes: number[]
  email_reminders: boolean
  meeting_provider: string
  meeting_url: string | null
  venue_type: string
}

interface OccRow {
  id: string
  event_id: string
  occurrence_date: string
  start_at: string
  end_at: string
  status: string
  reminders_sent: number[]
  meeting_url: string | null
}

function seriesArgs(e: EventRow): SeriesArgs | null {
  if (!e.recurrence_rule || !e.series_start_date || !e.local_start_time || !e.duration_minutes) return null
  return {
    recurrenceRule: e.recurrence_rule,
    seriesStartDate: e.series_start_date,
    localStartTime: e.local_start_time,
    durationMinutes: e.duration_minutes,
    timezone: e.timezone ?? 'Africa/Lagos',
    endType: e.recurrence_end_type,
    until: e.recurrence_until,
    count: e.recurrence_count,
  }
}

async function run(db: SupabaseClient) {
  const now = new Date()
  const horizon = new Date(now.getTime() + REMINDER_HORIZON_MIN * 60000)
  const materializeTo = new Date(now.getTime() + MATERIALIZE_AHEAD_DAYS * 86400000)

  const { data: events } = await db
    .from('events')
    .select('id, org_id, title, is_recurring, status, start_at, end_at, timezone, local_start_time, duration_minutes, recurrence_rule, series_start_date, recurrence_end_type, recurrence_until, recurrence_count, reminder_minutes, email_reminders, meeting_provider, meeting_url, venue_type')
    .neq('status', 'draft')
    .neq('status', 'cancelled')
  const rows = (events as EventRow[]) ?? []

  // Candidate occurrences within the horizon: one-time events + expanded series.
  type Cand = { event: EventRow; date: string; start: Date; end: Date }
  const cands: Cand[] = []
  for (const e of rows) {
    if (!e.is_recurring) {
      if (!e.start_at || !e.end_at) continue
      const s = new Date(e.start_at)
      if (s >= now && s <= horizon) cands.push({ event: e, date: e.start_at.slice(0, 10), start: s, end: new Date(e.end_at) })
      continue
    }
    const args = seriesArgs(e)
    if (!args) continue
    for (const o of expandOccurrences(args, now, materializeTo > horizon ? materializeTo : horizon)) {
      cands.push({ event: e, date: o.date, start: o.startAt, end: o.endAt })
    }
  }

  // Load any existing occurrence rows for these (event, date) pairs.
  const eventIds = [...new Set(cands.map((c) => c.event.id))]
  const existing = new Map<string, OccRow>()
  if (eventIds.length) {
    const { data: occ } = await db
      .from('event_occurrences')
      .select('id, event_id, occurrence_date, start_at, end_at, status, reminders_sent, meeting_url')
      .in('event_id', eventIds)
      .gte('occurrence_date', now.toISOString().slice(0, 10))
      .lte('occurrence_date', materializeTo.toISOString().slice(0, 10))
    for (const o of (occ as OccRow[]) ?? []) existing.set(`${o.event_id}:${o.occurrence_date}`, o)
  }

  let notified = 0
  let emailsQueued = 0

  for (const c of cands) {
    const key = `${c.event.id}:${c.date}`
    let row = existing.get(key)

    // Materialize (only inside the reminder horizon — that's all we act on).
    if (!row && c.start <= horizon) {
      const { data: ins } = await db
        .from('event_occurrences')
        .insert({ org_id: c.event.org_id, event_id: c.event.id, occurrence_date: c.date, start_at: c.start.toISOString(), end_at: c.end.toISOString() })
        .select('id, event_id, occurrence_date, start_at, end_at, status, reminders_sent, meeting_url')
        .single()
      row = (ins as OccRow) ?? undefined
      if (row) existing.set(key, row)
    }
    if (!row || row.status === 'cancelled') continue

    const start = new Date(row.start_at)
    const windows = (c.event.reminder_minutes ?? [])
      .filter((m) => !(row!.reminders_sent ?? []).includes(m))
      .filter((m) => now >= new Date(start.getTime() - m * 60000) && now < start)
    if (windows.length === 0) continue

    // Audience → user ids (SECURITY DEFINER helper from 0072).
    const { data: aud } = await db.rpc('event_audience_user_ids', { p_event_id: c.event.id })
    const userIds = ((aud as { user_id: string }[]) ?? []).map((r) => r.user_id)
    if (userIds.length === 0) {
      await db.from('event_occurrences').update({ reminders_sent: [...(row.reminders_sent ?? []), ...windows] }).eq('id', row.id)
      continue
    }

    const joinUrl = row.meeting_url ?? c.event.meeting_url
    for (const m of windows) {
      const mins = m >= 60 ? `${Math.round(m / 60)} hour${m >= 120 ? 's' : ''}` : `${m} minutes`
      const text = `${c.event.title} starts in ${mins}.`
      const link = `/events/${c.event.id}/${c.date}`

      await db.from('notifications').insert(
        userIds.map((uid) => ({
          org_id: c.event.org_id, user_id: uid, type: 'event_reminder', channel: 'in_app',
          payload: { text, link, join_url: c.event.venue_type === 'online' ? joinUrl : null }, status: 'sent',
        })),
      )
      notified += userIds.length

      if (c.event.email_reminders) {
        for (const uid of userIds) {
          try {
            await db.rpc('enqueue_email', {
              p_org: c.event.org_id, p_recipient_user: uid, p_email_type: 'event_reminder',
              p_category: 'event',
              p_template_data: { template_type: 'generic', subject: `Reminder: ${c.event.title}`, headline: text, message: text, cta_label: 'Open event', cta_path: link },
              p_dedupe_key: `evt:${row.id}:${uid}:${m}`,
              p_related_type: 'event', p_related_id: c.event.id,
            })
            emailsQueued++
          } catch { /* non-critical */ }
        }
      }
    }

    await db.from('event_occurrences')
      .update({ reminders_sent: [...(row.reminders_sent ?? []), ...windows] })
      .eq('id', row.id)
  }

  // Close out finished occurrences.
  const { count: completed } = await db
    .from('event_occurrences')
    .update({ status: 'completed' }, { count: 'exact' })
    .eq('status', 'scheduled')
    .lt('end_at', now.toISOString())

  return { candidates: cands.length, notified, emailsQueued, completed: completed ?? 0 }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = Deno.env.get('EMAIL_WORKER_SECRET')
  if (!secret || req.headers.get('x-worker-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const result = await run(db)
    return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
