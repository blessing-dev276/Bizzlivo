import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EVENT_CATEGORY_LABEL, displayStatus, statusBadgeClass } from '../../lib/events'
import type { HQEvent } from '../../types/database'

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function DayView({ events }: { events: HQEvent[] }) {
  const [current, setCurrent] = useState(() => new Date())

  const dayEvents = events
    .filter((e) => sameDay(new Date(e.start_at), current))
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())

  function shift(days: number) {
    setCurrent((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + days)
      return next
    })
  }

  return (
    <div>
      <div className="calendar-nav">
        <button type="button" className="secondary" onClick={() => shift(-1)}>← Prev</button>
        <h3 style={{ margin: 0 }}>{current.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="secondary" onClick={() => setCurrent(new Date())}>Today</button>
          <button type="button" className="secondary" onClick={() => shift(1)}>Next →</button>
        </div>
      </div>

      {dayEvents.length === 0 ? (
        <p className="empty-row">Nothing scheduled this day.</p>
      ) : (
        <div className="day-view-list">
          {dayEvents.map((e) => {
            const status = displayStatus(e)
            return (
              <Link to={`/events/${e.id}`} className="day-view-row" key={e.id}>
                <span className="day-view-time">
                  {new Date(e.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="day-view-title">{e.title}</span>
                <span className="event-category">{EVENT_CATEGORY_LABEL[e.category]}</span>
                <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
