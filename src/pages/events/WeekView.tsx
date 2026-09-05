import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { HQEvent } from '../../types/database'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function startOfWeek(d: Date) {
  const s = new Date(d)
  s.setDate(s.getDate() - s.getDay())
  s.setHours(0, 0, 0, 0)
  return s
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function WeekView({ events }: { events: HQEvent[] }) {
  const [anchor, setAnchor] = useState(() => new Date())
  const weekStart = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })

  function shift(weeks: number) {
    setAnchor((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + weeks * 7)
      return next
    })
  }

  const weekEnd = days[6]

  return (
    <div>
      <div className="calendar-nav">
        <button type="button" className="secondary" onClick={() => shift(-1)}>← Prev</button>
        <h3 style={{ margin: 0 }}>
          {weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          {' – '}
          {weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="secondary" onClick={() => setAnchor(new Date())}>Today</button>
          <button type="button" className="secondary" onClick={() => shift(1)}>Next →</button>
        </div>
      </div>

      <div className="week-view-grid">
        {days.map((day, idx) => {
          const dayEvents = events
            .filter((e) => sameDay(new Date(e.start_at), day))
            .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
          const isToday = sameDay(day, new Date())
          return (
            <div className={`week-day-col ${isToday ? 'today' : ''}`} key={idx}>
              <div className="week-day-head">
                <span>{DAY_LABELS[idx]}</span>
                <span className="week-day-num">{day.getDate()}</span>
              </div>
              {dayEvents.length === 0 ? (
                <span className="cell-dim" style={{ fontSize: 11.5 }}>—</span>
              ) : (
                dayEvents.map((e) => (
                  <Link to={`/events/${e.id}`} className="week-event-chip" key={e.id}>
                    <span className="week-event-time">
                      {new Date(e.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    {e.title}
                  </Link>
                ))
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
