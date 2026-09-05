import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { EVENT_CATEGORY_LABEL, displayStatus, statusBadgeClass } from '../../lib/events'
import type { HQEvent } from '../../types/database'

const ADMIN_ROLES = new Set(['admin', 'trainer'])

interface AttendeeRow {
  userId: string
  fullName: string
}

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const { profile, currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const orgId = currentMembership?.organization.id

  const [event, setEvent] = useState<(HQEvent & { organizerName: string | null }) | null>(null)
  const [attendees, setAttendees] = useState<AttendeeRow[]>([])
  const [joined, setJoined] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load(org: string, id: string) {
    const eventRes = await supabase
      .from('events')
      .select('*, organizer:profiles!organizer_id(full_name)')
      .eq('id', id)
      .eq('org_id', org)
      .single()
    const e = eventRes.data as unknown as (HQEvent & { organizer: { full_name: string } | null }) | null
    if (!e) {
      setEvent(null)
      setLoading(false)
      return
    }
    setEvent({ ...e, organizerName: e.organizer?.full_name ?? null })

    const attendeesRes = await supabase
      .from('event_attendees')
      .select('user_id, profile:profiles(full_name)')
      .eq('event_id', id)
    const rows = (attendeesRes.data as unknown as { user_id: string; profile: { full_name: string } | null }[]) ?? []
    setAttendees(rows.map((r) => ({ userId: r.user_id, fullName: r.profile?.full_name ?? 'Unknown' })))
    setJoined(rows.some((r) => r.user_id === profile?.id))
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId || !eventId) return
    setLoading(true)
    load(orgId, eventId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, eventId])

  async function toggleJoin() {
    if (!orgId || !eventId || !profile) return
    setBusy(true)
    if (joined) {
      await supabase.from('event_attendees').delete().eq('event_id', eventId).eq('user_id', profile.id)
    } else {
      await supabase.from('event_attendees').insert({ event_id: eventId, user_id: profile.id })
    }
    await load(orgId, eventId)
    setBusy(false)
  }

  async function handleDelete() {
    if (!eventId) return
    if (!confirm('Delete this event? This cannot be undone.')) return
    setBusy(true)
    await supabase.from('events').delete().eq('id', eventId)
    navigate('/events')
  }

  async function handleDuplicate() {
    if (!event || !profile) return
    setBusy(true)
    const { data, error } = await supabase
      .from('events')
      .insert({
        org_id: event.org_id,
        title: `${event.title} (copy)`,
        description: event.description,
        category: event.category,
        start_at: event.start_at,
        end_at: event.end_at,
        venue_type: event.venue_type,
        venue_location: event.venue_location,
        meeting_link: event.meeting_link,
        organizer_id: event.organizer_id,
        status: 'draft',
        created_by: profile.id,
      })
      .select('id')
      .single()
    setBusy(false)
    if (!error && data) navigate(`/events/${data.id}/edit`)
  }

  if (loading) return <div className="page"><p>Loading…</p></div>
  if (!event) {
    return (
      <div className="page">
        <h1>Event not found</h1>
        <Link to="/events">← Back to Events</Link>
      </div>
    )
  }

  const status = displayStatus(event)

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <Link to="/events" style={{ fontSize: 13.5 }}>← Back to Events</Link>

      <div className="growth-pillar" style={{ marginTop: 14 }}>
        <div className="growth-pillar-head">
          <h2 style={{ marginBottom: 0 }}>{event.title}</h2>
          <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
        </div>
        <p className="event-category" style={{ marginBottom: 16 }}>{EVENT_CATEGORY_LABEL[event.category]}</p>

        {event.description && <p style={{ color: 'var(--text-dim)' }}>{event.description}</p>}

        <div className="overview-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16 }}>
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">DATE & TIME</span></div>
            <div className="kpi-value" style={{ fontSize: 16 }}>
              {new Date(event.start_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              {', '}
              {new Date(event.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              {' – '}
              {new Date(event.end_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">VENUE</span></div>
            <div className="kpi-value" style={{ fontSize: 16 }}>
              {event.venue_type === 'online' ? 'Online' : 'Physical'}
              {event.venue_location && <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 4 }}>{event.venue_location}</div>}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-top"><span className="kpi-label">ORGANIZER</span></div>
            <div className="kpi-value" style={{ fontSize: 16 }}>{event.organizerName ?? 'Unassigned'}</div>
          </div>
        </div>

        {event.meeting_link && (
          <p style={{ marginTop: 14, fontSize: 13.5 }}>
            Meeting link: <a href={event.meeting_link} target="_blank" rel="noreferrer">{event.meeting_link}</a>
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
          {status !== 'Cancelled' && status !== 'Completed' && (
            <button type="button" onClick={toggleJoin} disabled={busy}>{joined ? 'Leave event' : 'Join event'}</button>
          )}
          {isAdmin && (
            <>
              <Link to={`/events/${event.id}/edit`}><button type="button" className="secondary">Edit</button></Link>
              <button type="button" className="secondary" onClick={handleDuplicate} disabled={busy}>Duplicate</button>
              <button type="button" className="danger" onClick={handleDelete} disabled={busy}>Delete</button>
            </>
          )}
        </div>
      </div>

      <h4 className="overview-heading" style={{ marginTop: 28 }}>ATTENDEES ({attendees.length})</h4>
      {attendees.length === 0 ? (
        <p className="empty-row">No one has joined yet.</p>
      ) : (
        <div className="upcoming-list">
          {attendees.map((a) => <span className="upcoming-pill" key={a.userId}>{a.fullName}</span>)}
        </div>
      )}
    </div>
  )
}
