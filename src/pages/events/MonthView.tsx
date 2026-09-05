import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { HQEvent } from '../../types/database'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_CHIPS_PER_DAY = 3

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function MonthView({ events }: { events: HQEvent[] }) {
  const [anchor, setAnchor] = useState(() => new Date())
  const year = anchor.getFullYear()
  const month = anchor.getMonth()

  const firstOfMonth = new Date(year, month, 1)
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    return d
  })

  function shift(months: number) {
    setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + months, 1))
  }

  return (
    <div>
      <div className="calendar-nav">
        <button type="button" className="secondary" onClick={() => shift(-1)}>← Prev</button>
        <h3 style={{ margin: 0 }}>{firstOfMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="secondary" onClick={() => setAnchor(new Date())}>Today</button>
          <button type="button" className="secondary" onClick={() => shift(1)}>Next →</button>
        </div>
      </div>

      <div className="month-grid">
        {WEEKDAY_LABELS.map((label) => <div className="month-weekday-label" key={label}>{label}</div>)}
        {cells.map((day, idx) => {
          const inMonth = day.getMonth() === month
          const isToday = sameDay(day, new Date())
          const dayEvents = events
            .filter((e) => sameDay(new Date(e.start_at), day))
            .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
          const overflow = dayEvents.length - MAX_CHIPS_PER_DAY

          return (
            <div className={`month-cell ${inMonth ? '' : 'outside'} ${isToday ? 'today' : ''}`} key={idx}>
              <span className="month-cell-num">{day.getDate()}</span>
              {dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((e) => (
                <Link to={`/events/${e.id}`} className="month-event-chip" key={e.id} title={e.title}>{e.title}</Link>
              ))}
              {overflow > 0 && <span className="month-overflow">+{overflow} more</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
