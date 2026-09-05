import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { EVENT_CATEGORY_LABEL, displayStatus, statusBadgeClass } from '../../lib/events'
import DayView from './DayView'
import WeekView from './WeekView'
import MonthView from './MonthView'
import type { HQEvent } from '../../types/database'

type ViewMode = 'agenda' | 'day' | 'week' | 'month'
const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]

const ADMIN_ROLES = new Set(['admin', 'trainer'])
const DAY_MS = 24 * 60 * 60 * 1000

interface EventRow extends HQEvent {
  organizerName: string | null
  attendeeCount: number
  joined: boolean
}

function EventCard({ event, onToggleJoin }: { event: EventRow; onToggleJoin: (event: EventRow) => void }) {
  const status = displayStatus(event)
  return (
    <div className="event-card">
      <div className="event-card-top">
        <span className="event-category">{EVENT_CATEGORY_LABEL[event.category]}</span>
        <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
      </div>
      <h3 className="event-title">{event.title}</h3>
      <div className="event-meta">
        <span>{new Date(event.start_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        <span>{new Date(event.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
        <span>{event.venue_type === 'online' ? 'Online' : (event.venue_location ?? 'Physical')}</span>
      </div>
      {event.organizerName && <p className="event-organizer">Organized by {event.organizerName}</p>}
      <div className="event-card-foot">
        <span className="cell-dim">{event.attendeeCount} joined</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {status !== 'Cancelled' && status !== 'Completed' && (
            <button type="button" className="secondary" onClick={() => onToggleJoin(event)}>
              {event.joined ? 'Leave' : 'Join'}
            </button>
          )}
          <Link to={`/events/${event.id}`} className="btn-primary-link">View Details →</Link>
        </div>
      </div>
    </div>
  )
}

export default function Events() {
  const { profile, currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const orgId = currentMembership?.organization.id

  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('agenda')

  async function load(org: string) {
    const eventsRes = await supabase
      .from('events')
      .select('*, organizer:profiles!organizer_id(full_name)')
      .eq('org_id', org)
      .order('start_at', { ascending: true })
    const rawEvents = (eventsRes.data as unknown as (HQEvent & { organizer: { full_name: string } | null })[]) ?? []
    const eventIds = rawEvents.map((e) => e.id)

    const attendeesRes = eventIds.length > 0
      ? await supabase.from('event_attendees').select('event_id, user_id').in('event_id', eventIds)
      : { data: [] }
    const countByEvent = new Map<string, number>()
    const joinedByEvent = new Set<string>()
    for (const row of attendeesRes.data ?? []) {
      countByEvent.set(row.event_id, (countByEvent.get(row.event_id) ?? 0) + 1)
      if (row.user_id === profile?.id) joinedByEvent.add(row.event_id)
    }

    setEvents(rawEvents.map((e) => ({
      ...e,
      organizerName: e.organizer?.full_name ?? null,
      attendeeCount: countByEvent.get(e.id) ?? 0,
      joined: joinedByEvent.has(e.id),
    })))
    setLoading(false)
  }

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    load(orgId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function toggleJoin(event: EventRow) {
    if (!orgId || !profile) return
    if (event.joined) {
      await supabase.from('event_attendees').delete().eq('event_id', event.id).eq('user_id', profile.id)
    } else {
      await supabase.from('event_attendees').insert({ event_id: event.id, user_id: profile.id })
    }
    await load(orgId)
  }

  const buckets = useMemo(() => {
    const filtered = search.trim()
      ? events.filter((e) => e.title.toLowerCase().includes(search.toLowerCase()))
      : events

    if (search.trim()) return { searchResults: filtered, today: [], week: [], month: [], completed: [] }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const todayEnd = todayStart + DAY_MS
    const weekEnd = todayEnd + 7 * DAY_MS
    const monthEnd = todayEnd + 30 * DAY_MS

    const today: EventRow[] = []
    const week: EventRow[] = []
    const month: EventRow[] = []
    const completed: EventRow[] = []

    for (const e of filtered) {
      if (displayStatus(e) === 'Completed') {
        completed.push(e)
        continue
      }
      const startTime = new Date(e.start_at).getTime()
      if (startTime >= todayStart && startTime < todayEnd) today.push(e)
      else if (startTime >= todayEnd && startTime < weekEnd) week.push(e)
      else if (startTime >= weekEnd && startTime < monthEnd) month.push(e)
    }
    completed.sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())

    return { searchResults: null, today, week, month, completed: completed.slice(0, 10) }
  }, [events, search])

  function renderSection(title: string, rows: EventRow[]) {
    if (rows.length === 0) return null
    return (
      <section style={{ marginBottom: 28 }}>
        <h4 className="overview-heading">{title}</h4>
        <div className="event-card-grid">
          {rows.map((e) => <EventCard key={e.id} event={e} onToggleJoin={toggleJoin} />)}
        </div>
      </section>
    )
  }

  return (
    <div className="page">
      <div className="page-head list-header">
        <h1>Events</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="secondary" disabled title="Coming soon">Export Calendar</button>
          {isAdmin && <Link to="/events/new"><button type="button">+ Create Event</button></Link>}
        </div>
      </div>
      <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
        Keep members informed and centralize your office's trainings, meetings, and announcements.
      </p>

      <div className="view-tabs">
        {VIEW_MODES.map((v) => (
          <button
            key={v.key}
            type="button"
            className={`view-tab ${viewMode === v.key ? 'active' : ''}`}
            onClick={() => setViewMode(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {viewMode === 'agenda' && (
        <input
          placeholder="Search events…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280, marginBottom: 24 }}
        />
      )}

      {loading ? (
        <p className="empty-row">Loading…</p>
      ) : events.length === 0 && !search ? (
        <p className="empty-row">No events yet. {isAdmin ? 'Create your first one above.' : 'Check back soon.'}</p>
      ) : viewMode === 'day' ? (
        <DayView events={events} />
      ) : viewMode === 'week' ? (
        <WeekView events={events} />
      ) : viewMode === 'month' ? (
        <MonthView events={events} />
      ) : buckets.searchResults !== null ? (
        buckets.searchResults.length === 0 ? (
          <p className="empty-row">No events match "{search}".</p>
        ) : (
          <div className="event-card-grid">
            {buckets.searchResults.map((e) => <EventCard key={e.id} event={e} onToggleJoin={toggleJoin} />)}
          </div>
        )
      ) : (
        <>
          {renderSection('UPCOMING TODAY', buckets.today)}
          {renderSection('UPCOMING THIS WEEK', buckets.week)}
          {renderSection('UPCOMING THIS MONTH', buckets.month)}
          {renderSection('RECENTLY COMPLETED', buckets.completed)}
          {buckets.today.length === 0 && buckets.week.length === 0 && buckets.month.length === 0 && buckets.completed.length === 0 && (
            <p className="empty-row">Nothing scheduled in the next 30 days.</p>
          )}
        </>
      )}

      <h4 className="overview-heading" style={{ marginTop: 32 }}>COMING SOON</h4>
      <div className="upcoming-list">
        {['Attendance tracking', 'RSVP capacity & waitlists', 'Recurring events', 'Calendar integrations', 'AI scheduling', 'Push / WhatsApp / SMS reminders', 'Event reports & export'].map((s) => (
          <span className="upcoming-pill" key={s}>{s}<span className="badge soon-badge">Soon</span></span>
        ))}
      </div>
    </div>
  )
}
