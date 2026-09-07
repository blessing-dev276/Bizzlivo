import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { loadUpcoming, loadOrgEvents } from '../../lib/eventsData'
import { seriesArgsFrom, type ResolvedOccurrence } from '../../lib/eventSeries'
import {
  EVENT_CATEGORY_LABEL, canJoinNow, dayLabel, relativeStart,
  occurrenceStatusLabel, statusBadgeClass,
} from '../../lib/events'
import { describeRRule } from '../../lib/recurrence'
import type { HQEvent } from '../../types/database'

const ADMIN_ROLES = new Set(['admin', 'trainer'])

function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function OccurrenceRow({ o }: { o: ResolvedOccurrence }) {
  const join = canJoinNow(o)
  return (
    <div className={`occ-row ${o.status === 'cancelled' ? 'is-cancelled' : ''}`}>
      <div className="occ-main">
        <Link to={`/events/${o.eventId}/${o.date}`} className="occ-title">{o.title}</Link>
        <div className="occ-meta">
          <span>{fmtTime(o.startAt)} – {fmtTime(o.endAt)}</span>
          <span>{o.venueType === 'online'
            ? o.meetingProvider === 'google_meet' ? 'Online · Google Meet' : 'Online'
            : (o.venueLocation ?? 'Physical')}</span>
          <span className="occ-cat">{EVENT_CATEGORY_LABEL[o.category]}</span>
        </div>
      </div>
      <div className="occ-side">
        {o.status === 'cancelled'
          ? <span className="badge rejected">Cancelled</span>
          : <span className="occ-when">{relativeStart(o.startAt, o.endAt)}</span>}
        {join && o.meetingUrl && (
          <a href={o.meetingUrl} target="_blank" rel="noreferrer" className="btn-primary-link">
            Join {o.meetingProvider === 'google_meet' ? 'Google Meet' : 'meeting'}
          </a>
        )}
      </div>
    </div>
  )
}

export default function Events() {
  const { currentMembership } = useAuth()
  const isAdmin = currentMembership ? ADMIN_ROLES.has(currentMembership.role) : false
  const orgId = currentMembership?.organization.id

  const [occ, setOcc] = useState<ResolvedOccurrence[]>([])
  const [series, setSeries] = useState<HQEvent[]>([])
  const [next, setNext] = useState<ResolvedOccurrence | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    ;(async () => {
      const [{ occurrences, next: n }, { events }] = await Promise.all([
        loadUpcoming(orgId, 45),
        loadOrgEvents(orgId, new Date(), new Date()),
      ])
      setOcc(occurrences)
      setNext(n)
      setSeries(events.filter((e) => e.is_recurring && e.status !== 'draft'))
      setLoading(false)
    })()
  }, [orgId])

  const { today, upcomingByDay } = useMemo(() => {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const endOfDay = new Date(startOfDay.getTime() + 86400000)
    const today = occ.filter((o) => o.startAt >= startOfDay && o.startAt < endOfDay && o.status !== 'completed')
    const rest = occ.filter((o) => o.startAt >= endOfDay && o.status !== 'cancelled')
    const groups: { label: string; rows: ResolvedOccurrence[] }[] = []
    for (const o of rest.slice(0, 40)) {
      const label = dayLabel(o.startAt, now)
      const g = groups.find((x) => x.label === label)
      if (g) g.rows.push(o)
      else groups.push({ label, rows: [o] })
    }
    return { today, upcomingByDay: groups }
  }, [occ])

  return (
    <div className="page">
      <div className="page-head list-header">
        <h1>Events</h1>
        {isAdmin && <Link to="/events/new"><button type="button">+ Create event</button></Link>}
      </div>
      <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
        Your office's meetings and trainings — one-time or recurring. Members see the next session, not a wall of duplicates.
      </p>

      {loading ? (
        <p className="empty-row">Loading…</p>
      ) : (
        <>
          {next && (
            <section className="next-event-card">
              <span className="ne-eyebrow">{next.status === 'live' ? 'LIVE NOW' : 'NEXT EVENT'}</span>
              <h2>{next.title}</h2>
              <p className="ne-when">
                {dayLabel(next.startAt)} · {fmtTime(next.startAt)} – {fmtTime(next.endAt)}
                {' · '}
                {next.venueType === 'online'
                  ? next.meetingProvider === 'google_meet' ? 'Google Meet' : 'Online'
                  : (next.venueLocation ?? 'Physical')}
              </p>
              <div className="ne-actions">
                {canJoinNow(next) && next.meetingUrl
                  ? <a href={next.meetingUrl} target="_blank" rel="noreferrer"><button type="button">Join {next.meetingProvider === 'google_meet' ? 'Google Meet' : 'meeting'}</button></a>
                  : <span className="occ-when">{relativeStart(next.startAt, next.endAt)}</span>}
                <Link to={`/events/${next.eventId}/${next.date}`} className="btn-primary-link">Details →</Link>
              </div>
            </section>
          )}

          <section style={{ marginTop: 24 }}>
            <h4 className="overview-heading">TODAY</h4>
            {today.length === 0
              ? <p className="empty-row">No meeting today.{next ? ` Next: ${dayLabel(next.startAt)} • ${fmtTime(next.startAt)}` : ''}</p>
              : <div className="occ-list">{today.map((o) => <OccurrenceRow key={`${o.eventId}:${o.date}`} o={o} />)}</div>}
          </section>

          {upcomingByDay.length > 0 && (
            <section style={{ marginTop: 24 }}>
              <h4 className="overview-heading">UPCOMING</h4>
              {upcomingByDay.map((g) => (
                <div key={g.label} className="occ-day-group">
                  <span className="occ-day-label">{g.label}</span>
                  <div className="occ-list">{g.rows.map((o) => <OccurrenceRow key={`${o.eventId}:${o.date}`} o={o} />)}</div>
                </div>
              ))}
            </section>
          )}

          {isAdmin && series.length > 0 && (
            <section style={{ marginTop: 28 }}>
              <h4 className="overview-heading">RECURRING SERIES</h4>
              <div className="occ-list">
                {series.map((s) => {
                  const args = seriesArgsFrom(s)
                  return (
                    <div className="occ-row" key={s.id}>
                      <div className="occ-main">
                        <Link to={`/events/${s.id}`} className="occ-title">{s.title}</Link>
                        <div className="occ-meta">
                          <span>{s.recurrence_rule ? describeRRule(s.recurrence_rule, s.local_start_time ?? undefined) : 'Recurring'}</span>
                          {args && <span>{args.timezone}</span>}
                          <span className={`badge ${statusBadgeClass(s.sync_status === 'sync_failed' ? 'cancelled' : 'scheduled')}`}>
                            {s.meeting_provider === 'google_meet'
                              ? s.sync_status === 'synced' ? 'Meet synced' : s.sync_status === 'sync_failed' ? 'Sync failed' : 'Meet pending'
                              : occurrenceStatusLabel('scheduled')}
                          </span>
                        </div>
                      </div>
                      <div className="occ-side">
                        <Link to={`/events/${s.id}/edit`} className="btn-primary-link">Manage →</Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {!next && today.length === 0 && upcomingByDay.length === 0 && (
            <p className="empty-row">No upcoming events. {isAdmin ? 'Create one above.' : 'Check back soon.'}</p>
          )}
        </>
      )}
    </div>
  )
}
