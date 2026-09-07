// Admin syncs one event to the office's connected Google Calendar
// (one-way, Bizzlivo -> Google). Creates the calendar event on first
// sync, patches it after; for a recurring series it's ONE Google
// recurring event (recurrence: [RRULE...]), not many. When the event's
// provider is google_meet a conference is requested and the returned
// hangoutLink becomes the event's meeting_url.
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID/SECRET, INTEGRATION_ENC_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import { decryptSecret, integrationConfigured } from '../_shared/googleCrypto.ts'
import { refreshAccessToken, insertCalendarEvent, patchCalendarEvent, type CalendarEventInput } from '../_shared/google.ts'
import { expandOccurrences, type SeriesArgs } from '../_shared/recurrence.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

function googleRRule(ev: Record<string, unknown>): string[] {
  const rule = ev.recurrence_rule as string
  let s = rule
  if (ev.recurrence_end_type === 'count' && ev.recurrence_count) s += `;COUNT=${ev.recurrence_count}`
  if (ev.recurrence_end_type === 'until' && ev.recurrence_until) {
    s += `;UNTIL=${String(ev.recurrence_until).replace(/-/g, '')}T235959Z`
  }
  return [`RRULE:${s}`]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (!integrationConfigured()) return json({ error: 'not_configured' }, 200)

  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Missing Authorization.' }, 401)
    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: u } = await caller.auth.getUser()
    if (!u.user) return json({ error: 'Invalid session.' }, 401)

    const { eventId } = await req.json()
    if (!eventId) return json({ error: 'eventId required.' }, 400)

    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: ev } = await db.from('events').select('*').eq('id', eventId).maybeSingle()
    if (!ev) return json({ error: 'Event not found.' }, 404)

    const { data: m } = await db.from('memberships').select('role').eq('org_id', ev.org_id).eq('user_id', u.user.id).eq('status', 'active').maybeSingle()
    if (!m || !['admin', 'trainer'].includes(m.role)) return json({ error: 'Not authorized.' }, 403)

    const { data: integ } = await db.from('organization_integrations')
      .select('*').eq('org_id', ev.org_id).eq('provider', 'google').maybeSingle()
    if (!integ || integ.status !== 'connected' || !integ.encrypted_refresh_token) {
      return json({ error: 'Google is not connected for this office.' }, 409)
    }

    await db.from('events').update({ sync_status: 'syncing', sync_error: null }).eq('id', eventId)

    // Access token from the stored refresh token.
    let accessToken: string
    try {
      const refreshed = await refreshAccessToken(await decryptSecret(integ.encrypted_refresh_token))
      if (refreshed.error || !refreshed.access_token) throw new Error(refreshed.error_description ?? 'token refresh failed')
      accessToken = refreshed.access_token
    } catch (e) {
      await db.from('organization_integrations').update({ status: 'attention', last_error: String(e) }).eq('id', integ.id)
      await db.from('events').update({ sync_status: 'sync_failed', sync_error: 'Google access needs reconnecting.' }).eq('id', eventId)
      return json({ error: 'reconnect_required' }, 409)
    }

    // Resolve start/end + recurrence for the Google event.
    const tz = ev.timezone ?? 'Africa/Lagos'
    let startISO: string, endISO: string, recurrence: string[] | undefined
    if (ev.is_recurring) {
      const args: SeriesArgs = {
        recurrenceRule: ev.recurrence_rule, seriesStartDate: ev.series_start_date,
        localStartTime: ev.local_start_time, durationMinutes: ev.duration_minutes,
        timezone: tz, endType: ev.recurrence_end_type, until: ev.recurrence_until, count: ev.recurrence_count,
      }
      const first = expandOccurrences(args, new Date(`${ev.series_start_date}T00:00:00Z`), new Date(Date.now() + 400 * 86400000))[0]
      if (!first) return json({ error: 'Series has no occurrences.' }, 400)
      startISO = first.startAt.toISOString()
      endISO = first.endAt.toISOString()
      recurrence = googleRRule(ev)
    } else {
      startISO = new Date(ev.start_at).toISOString()
      endISO = new Date(ev.end_at).toISOString()
    }

    const input: CalendarEventInput = {
      summary: ev.title,
      description: ev.description ?? undefined,
      location: ev.venue_type === 'physical' ? (ev.venue_location ?? undefined) : undefined,
      timeZone: tz,
      start: startISO,
      end: endISO,
      recurrence,
      wantMeet: ev.venue_type === 'online' && ev.meeting_provider === 'google_meet',
    }

    try {
      const result = ev.google_event_id
        ? await patchCalendarEvent(accessToken, integ.calendar_id, ev.google_event_id, input)
        : await insertCalendarEvent(accessToken, integ.calendar_id, input)

      const meetUrl = result.hangoutLink ?? (ev.meeting_provider === 'google_meet' ? ev.meeting_url : ev.meeting_url)
      await db.from('events').update({
        google_calendar_id: integ.calendar_id,
        google_event_id: result.id,
        google_conference_id: result.conferenceData?.conferenceId ?? ev.google_conference_id,
        meeting_url: input.wantMeet ? (result.hangoutLink ?? ev.meeting_url) : ev.meeting_url,
        sync_status: 'synced',
        sync_error: null,
        synced_at: new Date().toISOString(),
      }).eq('id', eventId)
      await db.from('organization_integrations').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('id', integ.id)

      return json({ ok: true, googleEventId: result.id, meetUrl: input.wantMeet ? result.hangoutLink ?? null : null, calendarLink: result.htmlLink ?? null })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Google sync failed.'
      await db.from('events').update({ sync_status: 'sync_failed', sync_error: msg }).eq('id', eventId)
      return json({ error: msg }, 502)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500)
  }
})
