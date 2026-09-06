import { Link } from 'react-router-dom'
import { EVENT_CATEGORY_LABEL } from '../../lib/events'
import type { EventCategory } from '../../types/database'
import type { OfficeSnapshot } from './useOfficeSnapshot'
import { Skeleton, untilLabel } from './dashboardShared'

export default function UpcomingEvents({ data, loading }: { data: OfficeSnapshot | null; loading: boolean }) {
  return (
    <section className="dash-card col-5">
      <div className="dash-card-head">
        <h2>Upcoming Events</h2>
        <Link to="/events" className="dash-see-all">View all →</Link>
      </div>

      {loading || !data ? (
        <>
          {[0, 1, 2].map((i) => (
            <div className="ev-row" key={i}>
              <Skeleton w={40} h={38} />
              <Skeleton w="60%" h={30} />
            </div>
          ))}
        </>
      ) : data.upcomingEvents.length === 0 ? (
        <p className="md-muted" style={{ padding: '20px 0' }}>
          No upcoming events scheduled. <Link to="/events/new" className="dash-see-all">Create one →</Link>
        </p>
      ) : (
        data.upcomingEvents.slice(0, 4).map((ev) => {
          const start = new Date(ev.start_at)
          return (
            <Link to={`/events/${ev.id}`} className="ev-row" key={ev.id} style={{ color: 'inherit' }}>
              <div className="ev-date">
                <span className="ev-mon">{start.toLocaleDateString(undefined, { month: 'short' })}</span>
                <span className="ev-day">{start.getDate()}</span>
              </div>
              <div className="ev-body">
                <div className="ev-title">{ev.title}</div>
                <div className="ev-meta">
                  {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  {' · '}
                  {ev.venue_type === 'online' ? 'Online' : ev.venue_location ?? 'In person'}
                  {' · '}
                  {EVENT_CATEGORY_LABEL[ev.category as EventCategory] ?? ev.category}
                </div>
              </div>
              <span className="ev-when">{untilLabel(ev.start_at)}</span>
            </Link>
          )
        })
      )}
    </section>
  )
}
