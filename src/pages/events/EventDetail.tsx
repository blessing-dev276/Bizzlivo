import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { PageSkeleton } from '../../components/AppSkeleton'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { EVENT_CATEGORY_LABEL, dayLabel } from '../../lib/events'
import { describeRRule } from '../../lib/recurrence'
import { seriesArgsFrom } from '../../lib/eventSeries'
import { expandOccurrences } from '../../lib/recurrence'
import type { EventOccurrence, HQEvent } from '../../types/database'

const ADMIN_ROLES = new Set(['admin', 'trainer'])

function fmtTime(d: Date) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const { currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const orgId = currentMembership?.organization.id

  const [event, setEvent] = useState<HQEvent | null>(null)
  const [overrides, setOverrides] = useState<EventOccurrence[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!orgId || !eventId) return
    setLoading(true)
    ;(async () => {
      const [{ data: ev }, { data: occ }] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).eq('org_id', orgId).single(),
        supabase.from('event_occurrences').select('*').eq('event_id', eventId).gte('occurrence_date', new Date().toISOString().slice(0, 10)),
      ])
      setEvent(ev as HQEvent | null)
      setOverrides((occ as EventOccurrence[]) ?? [])
      setLoading(false)
    })()
  }, [orgId, eventId])

  const upcoming = useMemo(() => {
    if (!event || !event.is_recurring) return []
    const args = seriesArgsFrom(event)
    if (!args) return []
    const from = new Date()
    const to = new Date(from.getTime() + 60 * 86400000)
    const overrideByDate = new Map(overrides.map((o) => [o.occurrence_date, o]))
    return expandOccurrences(args, from, to).slice(0, 20).map((o) => {
      const ov = overrideByDate.get(o.date)
      return {
        date: o.date,
        startAt: ov ? new Date(ov.start_at) : o.startAt,
        endAt: ov ? new Date(ov.end_at) : o.endAt,
        status: ov?.status ?? 'scheduled',
        title: ov?.override_title ?? event.title,
      }
    })
  }, [event, overrides])

  if (loading) return <PageSkeleton />
  if (!event) return <div className="page"><h1>Event not found</h1><Link to="/events">← Back to Events</Link></div>

  // One-time events have a single occurrence — send straight to it.
  if (!event.is_recurring && event.start_at) {
    return <Navigate to={`/events/${event.id}/${event.start_at.slice(0, 10)}`} replace />
  }

  const args = seriesArgsFrom(event)

  async function cancelSeries() {
    if (!confirm('Cancel the entire series? Every future session is cancelled. Existing attendance history is kept.')) return
    setBusy(true)
    await supabase.from('events').update({ status: 'cancelled' }).eq('id', eventId)
    setBusy(false)
    navigate('/events')
  }
  async function deleteSeries() {
    if (!confirm('Delete this series permanently? This removes all its occurrences and attendance.')) return
    setBusy(true)
    await supabase.from('events').delete().eq('id', eventId)
    navigate('/events')
  }

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <Link to="/events" style={{ fontSize: 13.5 }}>← Back to Events</Link>

      <div className="growth-pillar" style={{ marginTop: 14 }}>
        <div className="growth-pillar-head">
          <h2 style={{ marginBottom: 0 }}>{event.title}</h2>
          <span className={`badge ${event.status === 'cancelled' ? 'rejected' : ''}`}>{event.status === 'cancelled' ? 'Cancelled' : 'Active series'}</span>
        </div>
        <p className="event-category" style={{ marginBottom: 12 }}>{EVENT_CATEGORY_LABEL[event.category]}</p>
        {event.description && <p style={{ color: 'var(--text-dim)' }}>{event.description}</p>}

        <dl className="bp-facts" style={{ marginTop: 12 }}>
          <div><dt>Repeats</dt><dd>{event.recurrence_rule ? describeRRule(event.recurrence_rule, event.local_start_time ?? undefined) : '—'}</dd></div>
          <div><dt>Timezone</dt><dd>{args?.timezone ?? '—'}</dd></div>
          <div><dt>Starts</dt><dd>{event.series_start_date ?? '—'}</dd></div>
          <div><dt>Ends</dt><dd>{event.recurrence_end_type === 'never' ? 'Never'
            : event.recurrence_end_type === 'until' ? event.recurrence_until
            : `after ${event.recurrence_count} occurrences`}</dd></div>
          <div><dt>Location</dt><dd>{event.venue_type === 'online'
            ? event.meeting_provider === 'google_meet' ? `Google Meet (${event.sync_status})` : 'Online link'
            : (event.venue_location ?? 'Physical')}</dd></div>
          <div><dt>Reminders</dt><dd>{(event.reminder_minutes ?? []).map((m) => m >= 60 ? `${m / 60}h` : `${m}m`).join(', ') || 'None'}{event.email_reminders ? ' · email on' : ''}</dd></div>
        </dl>

        {isAdmin && (
          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <Link to={`/events/${event.id}/edit`}><button type="button" className="secondary">Edit series</button></Link>
            {event.status !== 'cancelled' && <button type="button" className="secondary" disabled={busy} onClick={cancelSeries}>Cancel series</button>}
            <button type="button" className="danger" disabled={busy} onClick={deleteSeries}>Delete</button>
          </div>
        )}
      </div>

      <h4 className="overview-heading" style={{ marginTop: 24 }}>NEXT SESSIONS</h4>
      {upcoming.length === 0 ? (
        <p className="empty-row">No upcoming sessions in the next 60 days.</p>
      ) : (
        <div className="occ-list">
          {upcoming.map((o) => (
            <Link to={`/events/${event.id}/${o.date}`} key={o.date} className={`occ-row ${o.status === 'cancelled' ? 'is-cancelled' : ''}`} style={{ textDecoration: 'none' }}>
              <div className="occ-main">
                <span className="occ-title">{o.title}</span>
                <div className="occ-meta"><span>{dayLabel(o.startAt)}</span><span>{fmtTime(o.startAt)} – {fmtTime(o.endAt)}</span></div>
              </div>
              <span className={`badge ${o.status === 'cancelled' ? 'rejected' : o.status === 'rescheduled' ? 'active' : ''}`}>
                {o.status === 'cancelled' ? 'Cancelled' : o.status === 'rescheduled' ? 'Rescheduled' : 'Scheduled'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
