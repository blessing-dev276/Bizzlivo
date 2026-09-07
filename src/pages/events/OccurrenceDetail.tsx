import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageSkeleton } from '../../components/AppSkeleton'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { EVENT_CATEGORY_LABEL, canJoinNow, dayLabel, relativeStart } from '../../lib/events'
import { expandOccurrences } from '../../lib/recurrence'
import { seriesArgsFrom } from '../../lib/eventSeries'
import type { EventAttendanceRow, EventOccurrence, HQEvent } from '../../types/database'

const ADMIN_ROLES = new Set(['admin', 'trainer'])

interface MemberRow { id: string; name: string }

function fmtTime(d: Date) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }
function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function OccurrenceDetail() {
  const { eventId, date } = useParams<{ eventId: string; date: string }>()
  const { profile, currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const orgId = currentMembership?.organization.id

  const [event, setEvent] = useState<HQEvent | null>(null)
  const [row, setRow] = useState<EventOccurrence | null>(null)
  const [attendance, setAttendance] = useState<EventAttendanceRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rescheduleTo, setRescheduleTo] = useState('')

  const load = useCallback(async () => {
    if (!orgId || !eventId || !date) return
    const { data: ev } = await supabase.from('events').select('*').eq('id', eventId).eq('org_id', orgId).single()
    const e = ev as HQEvent | null
    setEvent(e)
    if (!e) { setLoading(false); return }

    const { data: occ } = await supabase
      .from('event_occurrences').select('*').eq('event_id', eventId).eq('occurrence_date', date).maybeSingle()
    const r = (occ as EventOccurrence | null) ?? null
    setRow(r)

    if (r) {
      const { data: att } = await supabase.from('event_attendance').select('*').eq('occurrence_id', r.id)
      setAttendance((att as EventAttendanceRow[]) ?? [])
    } else {
      setAttendance([])
    }
    if (isAdmin) {
      const { data: mem } = await supabase
        .from('memberships').select('user_id, profile:profiles(id, full_name)').eq('org_id', orgId).eq('status', 'active')
      const rows = (mem as unknown as { profile: { id: string; full_name: string } | null }[]) ?? []
      setMembers(rows.filter((x) => x.profile).map((x) => ({ id: x.profile!.id, name: x.profile!.full_name })))
    }
    setLoading(false)
  }, [orgId, eventId, date, isAdmin])

  useEffect(() => { setLoading(true); load() }, [load])

  // Resolve the instants for this date: override row wins, else compute
  // from the series rule, else the one-time event's own times.
  const instants = useMemo(() => {
    if (!event || !date) return null
    if (row) return { start: new Date(row.start_at), end: new Date(row.end_at) }
    if (!event.is_recurring) return { start: new Date(event.start_at), end: new Date(event.end_at) }
    const args = seriesArgsFrom(event)
    if (!args) return null
    const d = new Date(`${date}T00:00:00Z`)
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const to = new Date(from.getTime() + 86400000)
    const hit = expandOccurrences(args, from, to)[0]
    return hit ? { start: hit.startAt, end: hit.endAt } : null
  }, [event, row, date])

  if (loading) return <PageSkeleton />
  if (!event || !instants || !date) {
    return <div className="page"><h1>Session not found</h1><Link to="/events">← Back to Events</Link></div>
  }

  const status: 'scheduled' | 'live' | 'completed' | 'cancelled' =
    row?.status === 'cancelled' ? 'cancelled'
    : new Date() < instants.start ? 'scheduled'
    : new Date() <= instants.end ? 'live'
    : 'completed'
  const title = row?.override_title ?? event.title
  const meetingUrl = row?.meeting_url ?? event.meeting_url
  const joinable = canJoinNow({ venueType: event.venue_type, meetingUrl, status, startAt: instants.start, endAt: instants.end })
  const myAttendance = attendance.find((a) => a.user_id === profile?.id)
  const checkInOpen = new Date() >= new Date(instants.start.getTime() - 15 * 60000) && new Date() <= new Date(instants.start.getTime() + 30 * 60000)

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true); setErr(null); setMsg(null)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) setErr(error.message)
    else { setMsg(ok); await load() }
  }

  async function selfCheckIn() {
    await rpc('check_in_by_date', {
      p_event_id: eventId, p_date: date,
      p_start_at: instants!.start.toISOString(), p_end_at: instants!.end.toISOString(),
    }, "You're checked in.")
  }

  async function markAttendance(userId: string, next: 'present' | 'absent') {
    if (!orgId) return
    setBusy(true); setErr(null)
    const { data: occId, error: mErr } = await supabase.rpc('materialize_occurrence', {
      p_event_id: eventId, p_date: date,
      p_start_at: instants!.start.toISOString(), p_end_at: instants!.end.toISOString(),
    })
    if (mErr) { setBusy(false); setErr(mErr.message); return }
    const { error } = await supabase.from('event_attendance').upsert({
      occurrence_id: occId as string, user_id: userId, org_id: orgId,
      status: next, method: 'admin', marked_by: profile?.id ?? null, marked_at: new Date().toISOString(),
    })
    setBusy(false)
    if (error) setErr(error.message)
    else await load()
  }

  async function cancelOccurrence() {
    if (!confirm('Cancel just this session? The rest of the series is unaffected.')) return
    const { data: occId, error } = await supabase.rpc('materialize_occurrence', {
      p_event_id: eventId, p_date: date,
      p_start_at: instants!.start.toISOString(), p_end_at: instants!.end.toISOString(),
    })
    if (error) { setErr(error.message); return }
    await rpc('set_occurrence_state', { p_occurrence_id: occId, p_status: 'cancelled' }, 'Session cancelled.')
  }

  async function reschedule() {
    if (!rescheduleTo) return
    const newStart = new Date(rescheduleTo)
    const durationMs = instants!.end.getTime() - instants!.start.getTime()
    const { data: occId, error } = await supabase.rpc('materialize_occurrence', {
      p_event_id: eventId, p_date: date,
      p_start_at: instants!.start.toISOString(), p_end_at: instants!.end.toISOString(),
    })
    if (error) { setErr(error.message); return }
    await rpc('set_occurrence_state', {
      p_occurrence_id: occId, p_status: 'rescheduled',
      p_start_at: newStart.toISOString(), p_end_at: new Date(newStart.getTime() + durationMs).toISOString(),
    }, 'Session rescheduled.')
    setRescheduleTo('')
  }

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <Link to={event.is_recurring ? `/events/${event.id}` : '/events'} style={{ fontSize: 13.5 }}>← Back</Link>

      <div className="growth-pillar" style={{ marginTop: 14 }}>
        <div className="growth-pillar-head">
          <h2 style={{ marginBottom: 0 }}>{title}</h2>
          <span className={`badge ${status === 'live' ? 'active' : status === 'cancelled' ? 'rejected' : ''}`}>
            {status === 'live' ? 'Live now' : status[0].toUpperCase() + status.slice(1)}
          </span>
        </div>
        <p className="event-category" style={{ marginBottom: 12 }}>{EVENT_CATEGORY_LABEL[event.category]}{event.is_recurring ? ' · recurring series' : ''}</p>

        <p style={{ color: 'var(--text-dim)', fontSize: 13.5 }}>
          {dayLabel(instants.start)} · {fmtTime(instants.start)} – {fmtTime(instants.end)}
          {' · '}
          {event.venue_type === 'online'
            ? event.meeting_provider === 'google_meet' ? 'Online · Google Meet' : 'Online'
            : (event.venue_location ?? 'Physical')}
        </p>
        {event.description && <p style={{ color: 'var(--text-dim)' }}>{event.description}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          {joinable && meetingUrl
            ? <a href={meetingUrl} target="_blank" rel="noreferrer"><button type="button">Join {event.meeting_provider === 'google_meet' ? 'Google Meet' : 'meeting'}</button></a>
            : status !== 'cancelled' && <span className="occ-when">{relativeStart(instants.start, instants.end)}</span>}

          {!isAdmin && status !== 'cancelled' && (
            myAttendance
              ? <span className="badge active">Checked in</span>
              : checkInOpen && <button type="button" className="secondary" onClick={selfCheckIn} disabled={busy}>Check in</button>
          )}
        </div>
      </div>

      {msg && <p className="form-info">{msg}</p>}
      {err && <p className="form-error">{err}</p>}

      {isAdmin && (
        <>
          <h4 className="overview-heading" style={{ marginTop: 24 }}>ATTENDANCE</h4>
          <div className="occ-list">
            {members.map((m) => {
              const a = attendance.find((x) => x.user_id === m.id)
              return (
                <div className="occ-row" key={m.id}>
                  <span className="occ-title" style={{ fontWeight: 500 }}>{m.name}{a?.method === 'self_checkin' ? ' · self' : ''}</span>
                  <div className="occ-side">
                    <button type="button" className={a?.status === 'present' ? '' : 'secondary'} disabled={busy} onClick={() => markAttendance(m.id, 'present')}>Present</button>
                    <button type="button" className={a?.status === 'absent' ? 'danger' : 'secondary'} disabled={busy} onClick={() => markAttendance(m.id, 'absent')}>Absent</button>
                  </div>
                </div>
              )
            })}
            {members.length === 0 && <p className="empty-row">No active members.</p>}
          </div>

          <h4 className="overview-heading" style={{ marginTop: 24 }}>MANAGE THIS SESSION</h4>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {status !== 'cancelled' && <button type="button" className="danger" disabled={busy} onClick={cancelOccurrence}>Cancel this session</button>}
            <label style={{ margin: 0 }}>
              Reschedule to
              <input type="datetime-local" value={rescheduleTo || toLocalInput(instants.start)} onChange={(e) => setRescheduleTo(e.target.value)} />
            </label>
            <button type="button" className="secondary" disabled={busy || !rescheduleTo} onClick={reschedule}>Apply</button>
          </div>
          <p className="set-hint">Changes here affect only {date}. The recurring rule is untouched.</p>
        </>
      )}
    </div>
  )
}
